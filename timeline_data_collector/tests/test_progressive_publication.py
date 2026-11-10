from pathlib import Path
import tempfile
import unittest
import os
import json
import hashlib
from unittest.mock import patch
from timeline_data_collector.contracts import RecordBatch
from timeline_data_collector.io import read_json, write_json
from timeline_data_collector.publisher import Publisher


def event(key, day='01', description='initial'):
    return dict(id=key,start='2026-01-'+day+'T12:00:00Z',end='',data=dict(title=key,description=description))


class PublicationTests(unittest.TestCase):
    def test_existing_partitioned_data_survives_restored_limit(self):
        self.publish([event('one'), event('two')])
        original = self.writer.read_state()
        index = read_json(self.writer.state_path)
        records = index.pop('events')
        raw = json.dumps({'version': 1, 'events': records}).encode()
        digest = hashlib.sha256(raw).hexdigest()
        part = self.writer.state_dir / 'parts' / (digest + '.json')
        part.parent.mkdir(); part.write_bytes(raw)
        index.update(version=2, event_parts=[dict(path='parts/'+digest+'.json',
                     sha256=digest, bytes=len(raw), records=len(records))])
        write_json(self.writer.state_path, index)
        before = self.writer.state_path.read_bytes()
        exports = {path: path.read_bytes() for path in self.root.rglob('*.json')}
        self.assertEqual(self.writer.read_state()['events'], original['events'])
        with patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', 1200):
            with self.assertRaisesRegex(ValueError, '64 MiB'):
                self.publish([event('new', description='detail' * 1000)])
        self.assertEqual(self.writer.state_path.read_bytes(), before)
        self.assertEqual(exports, {path: path.read_bytes() for path in self.root.rglob('*.json')})
        self.assertEqual(self.writer.read_state()['sources'], original['sources'])
        self.assertFalse(self.writer.pending.exists())
        # A namespace that fits the restored budget returns to the old format.
        self.publish([event('new')])
        committed = read_json(self.writer.state_path)
        self.assertEqual(committed['version'], 1)
        self.assertNotIn('event_parts', committed)
        self.assertEqual({record['id'] for record in committed['events']}, {'one', 'two', 'new'})
        self.assertEqual(part.read_bytes(), raw)

    def test_restored_writer_does_not_create_parts_when_over_budget(self):
        self.publish([event('one')])
        before = self.writer.state_path.read_bytes()
        with patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', 1200):
            with self.assertRaisesRegex(ValueError, '64 MiB'):
                self.publish([event('new', description='detail' * 1000)])
        self.assertEqual(self.writer.state_path.read_bytes(), before)
        self.assertFalse((self.writer.state_dir / 'parts').exists())

    def test_publication_part_path_escape_is_rejected(self):
        write_json(self.writer.state_path, {'version': 2, 'record_count': 1, 'event_parts': [
            {'path': '../outside.json', 'bytes': 1, 'sha256': 'x', 'records': 1}]})
        with self.assertRaisesRegex(ValueError, 'path'): self.writer.read_state()

    @unittest.skipUnless(os.name=='nt','Windows file sharing regression')
    def test_atomic_replace_waits_for_a_reader_to_release_file(self):
        import ctypes,threading,time
        from ctypes import wintypes
        from timeline_data_collector.io import atomic_write
        target=self.root/'locked.json'; target.write_bytes(b'old')
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.CreateFileW.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE]
        kernel.CreateFileW.restype=wintypes.HANDLE
        kernel.CloseHandle.argtypes=[wintypes.HANDLE]
        handle=kernel.CreateFileW(str(target),0x80000000,3,None,3,0,None)
        if handle==wintypes.HANDLE(-1).value: raise ctypes.WinError(ctypes.get_last_error())
        def release():
            time.sleep(.8);kernel.CloseHandle(handle)
        thread=threading.Thread(target=release);thread.start()
        try: atomic_write(target,b'new')
        finally: thread.join()
        self.assertEqual(target.read_bytes(),b'new')
        self.assertFalse(list(self.root.glob('*.part')))

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.writer=Publisher(self.root/'yyyy/mm/dd','DEMO')

    def publish(self, records):
        return self.writer.publish('source','input',{'id':'test'},RecordBatch(records))

    def test_backup_reference_is_hidden_without_being_read_or_adopted(self):
        reference=self.root/'2026/01/01_legacy/broken.json'
        reference.parent.mkdir(parents=True); reference.write_bytes(b'{invalid reference')
        result=self.publish([event('new')])
        state=self.writer.read_state()
        self.assertEqual(result['namespace_records'],1)
        self.assertEqual(state['baseline_reports'],['2026/01/01_legacy/broken.json'])
        self.assertEqual(reference.read_bytes(),b'{invalid reference')

    def test_historical_extensions_and_blank_ids_are_adopted_safely(self):
        report=self.root/'2026/01/01/old.json'
        write_json(report,{'events':[event(''),event('second')]})
        desc=report.parent/'descriptors/second.json'
        desc.parent.mkdir()
        desc.write_text('{"event_descriptor":[{"data":{"AsRun":"C:\\logs\\thing""description":"detail",}},]}',encoding='utf-8')
        self.publish([event('new')])
        values=self.writer.read_state()['events']
        self.assertEqual(len(values),3)
        self.assertTrue(all(value['id'] for value in values))
        self.assertEqual(next(v for v in values if v['id']=='second')['data']['description'],'detail')

    def test_update_touches_only_changed_day_and_descriptor(self):
        self.publish([event('one'),event('two','02')])
        state=self.writer.read_state()
        report=self.root/next(p for p in state['reports'] if '/02/' in p)
        descriptor=self.root/'2026/01/02/descriptors/two.json'
        before=[(p.read_bytes(),p.stat().st_mtime_ns) for p in (report,descriptor)]
        self.publish([event('one',description='enriched')])
        self.assertEqual(before,[(p.read_bytes(),p.stat().st_mtime_ns) for p in (report,descriptor)])
        self.assertEqual(len(self.writer.read_state()['reports']),2)
        self.assertEqual(read_json(self.root/'2026/01/01/descriptors/one.json')['event_descriptor'][0]['description'],'enriched')
