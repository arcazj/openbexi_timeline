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
    def test_optional_descriptor_hints_do_not_exhaust_the_index_budget(self):
        from timeline_data_collector.publication import encode_publication
        records = [event('x' * 350), event('y' * 350)]
        raw, parts = encode_publication(dict(version=2, events=records, record_count=2), max_bytes=1024)
        self.assertLessEqual(len(raw), 1024)
        self.assertTrue(all(len(payload) <= 1024 for payload in parts.values()))
        self.assertTrue(all('ids' not in part for part in json.loads(raw)['event_parts']))
        self.assertEqual([record for payload in parts.values() for record in json.loads(payload)['events']], records)

    def test_reused_legacy_part_gains_descriptor_ids_without_rewriting_payload(self):
        from timeline_data_collector.publication import encode_publication
        records = [event('parent')]
        records[0]['activities'] = [event('child')]
        self.publish(records)
        state = self.writer.read_state(); state['version'] = 2
        raw, payloads = encode_publication(state)
        index = json.loads(raw)
        self.assertEqual(index['event_parts'][0]['ids'], ['child', 'parent'])
        for name, payload in payloads.items():
            path = self.writer.state_dir / name
            path.parent.mkdir(exist_ok=True); path.write_bytes(payload)
        for part in index['event_parts']: part.pop('ids')
        self.writer.state_path.write_text(json.dumps(index))
        before = {name: (self.writer.state_dir / name).stat().st_mtime_ns for name in payloads}
        self.publish([], {'offset': 2})
        current = read_json(self.writer.state_path)
        self.assertEqual(current['event_parts'][0]['ids'], ['child', 'parent'])
        self.assertEqual(before, {name: (self.writer.state_dir / name).stat().st_mtime_ns for name in payloads})

    def test_unchanged_part_is_verified_once_and_not_serialized_again(self):
        from timeline_data_collector import publication
        with patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', 8192):
            self.publish([event('old'+str(i), description='detail'*250) for i in range(8)])
        previous = read_json(self.writer.state_path)
        old_paths = {self.writer.state_dir/p['path'] for p in previous['event_parts']}
        original = Path.open
        opened = []
        def tracked(path, *args, **kwargs):
            if path in old_paths: opened.append(path)
            return original(path, *args, **kwargs)
        original_dumps = publication.json.dumps
        def encode(value, *args, **kwargs):
            if isinstance(value, dict) and str(value.get('id', '')).startswith('old'):
                self.fail('Unchanged historical event was serialized again')
            return original_dumps(value, *args, **kwargs)
        with patch.object(Path, 'open', tracked), patch.object(publication.json, 'dumps', encode):
            self.publish([event('today', '02')])
        self.assertCountEqual(opened, old_paths)
        self.assertEqual(len(self.writer.read_state()['events']), 9)
        # Reuse must not hide a corrupt old part or advance the checkpoint.
        before = self.writer.state_path.read_bytes()
        next(iter(old_paths)).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'integrity'):
            self.publish([], {'offset': 'invalid'})
        self.assertEqual(self.writer.state_path.read_bytes(), before)

    def test_part_reuse_preserves_order_after_insert_move_delete_and_content_change(self):
        from timeline_data_collector.publication import encode_publication, read_publication
        from timeline_data_collector.io import timestamp
        self.publish([event('alpha'), event('omega'), event('later', '02')])
        state = read_json(self.writer.state_path); state['version'] = 2
        raw, parts = encode_publication(state)
        for name, payload in parts.items():
            path = self.writer.state_dir/name; path.parent.mkdir(exist_ok=True); path.write_bytes(payload)
        self.writer.state_path.write_bytes(raw)
        for records, deleted in [([event('middle')], []), ([event('alpha','03')], []),
                                  ([], ['omega']), ([event('later','02','updated')], [])]:
            self.writer.publish('source','input','test',RecordBatch(records,{},deleted_ids=deleted))
            result = read_publication(self.writer.state_path)
            self.assertEqual(result['events'], sorted(result['events'], key=lambda r:(timestamp(r['start']),r['id'])))
            self.assertEqual(result['record_count'], len(result['events']))
            self.assert_parts(read_json(self.writer.state_path), Publisher.MAX_SNAPSHOT_BYTES)
        self.assertEqual({r['id'] for r in result['events']}, {'alpha','middle','later'})
        self.assertEqual(next(r for r in result['events'] if r['id']=='later')['data']['description'], 'updated')

    def test_metadata_upgrade_replaces_affected_part_and_keeps_pinned_snapshot(self):
        from timeline_data_collector.metadata import MetadataNormalizer
        from timeline_data_collector.publication import read_publication
        records = [event('old'+str(i), description='detail'*250) for i in range(8)]
        records[0]['data']['satellite'] = '9991'
        with patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', 8192):
            self.publish(records)
        pinned = self.writer.state_dir/'pinned.json'
        pinned.write_bytes(self.writer.state_path.read_bytes())
        self.writer.normalizer = MetadataNormalizer({'satellites': [
            {'name': 'SAT_9991', 'series': 'series_99', 'aliases': ['9991']}]})
        result = self.publish([], {'offset': 2})
        self.assertEqual(result['records_updated'], 1)
        self.assertEqual(read_publication(pinned)['events'][0]['data']['satellite'], '9991')
        current = self.writer.read_state()
        self.assertEqual(current['events'][0]['data']['satellite'], 'SAT_9991')
        self.assertEqual(current['sources']['source']['checkpoint'], {'offset': 2})

    def test_metadata_verification_still_checks_every_partition(self):
        from timeline_data_collector.publication import encode_publication, read_publication
        self.publish([event('one'), event('two')])
        value = read_json(self.writer.state_path); value['version'] = 2
        raw, parts = encode_publication(value)
        for name, payload in parts.items():
            path = self.writer.state_dir / name
            path.parent.mkdir(exist_ok=True); path.write_bytes(payload)
        self.writer.state_path.write_bytes(raw)
        metadata = read_publication(self.writer.state_path, metadata_only=True)
        self.assertNotIn('events', metadata)
        self.assertEqual(metadata['record_count'], 2)
        self.assertEqual(len(read_publication(self.writer.state_path)['events']), 2)
        path.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'integrity'):
            read_publication(self.writer.state_path, metadata_only=True)

    def test_existing_partitioned_namespace_accepts_new_batches_over_file_budget(self):
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
        self.assertEqual(self.writer.read_state()['events'], original['events'])
        with patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', 8192):
            self.publish([event('new'+str(i), description='detail' * 250) for i in range(12)], {'offset': 12})
        committed = read_json(self.writer.state_path)
        self.assertEqual(committed['version'], 2)
        self.assertNotIn('events', committed)
        state = self.writer.read_state()
        self.assertEqual(len(state['events']), 14)
        self.assertEqual(state['sources']['source']['checkpoint'], {'offset': 12})
        self.assertEqual(state['events'][-2:], original['events'])
        self.assertEqual(part.read_bytes(), raw)
        self.assert_parts(committed, 8192)
        self.assertFalse(self.writer.pending.exists())

    def test_inline_namespace_migrates_to_bounded_parts_and_keeps_old_records(self):
        self.publish([event('one')])
        self.assertEqual(read_json(self.writer.state_path)['version'], 1)
        with patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', 8192):
            self.publish([event('new'+str(i), description='\u20ac' * 500) for i in range(12)])
        state = read_json(self.writer.state_path)
        self.assertEqual(state['version'], 2)
        self.assertEqual(state['record_count'], 13)
        self.assertGreater(sum(p['bytes'] for p in state['event_parts']), 8192)
        self.assert_parts(state, 8192)
        self.assertIn('one', self.writer.read_state()['sources']['source']['records'])
        # Once migrated, even a small replacement remains version 2.
        self.writer.publish('source', 'input', 'test', RecordBatch([event('one')], {}, snapshot=True))
        self.assertEqual(read_json(self.writer.state_path)['version'], 2)
        self.assertEqual([r['id'] for r in self.writer.read_state()['events']], ['one'])

    def assert_parts(self, state, limit):
        self.assertLessEqual(self.writer.state_path.stat().st_size, limit)
        count = 0
        for part in state['event_parts']:
            raw = (self.writer.state_dir / part['path']).read_bytes()
            self.assertLessEqual(len(raw), limit)
            self.assertEqual(len(raw), part['bytes'])
            self.assertEqual(hashlib.sha256(raw).hexdigest(), part['sha256'])
            self.assertEqual(len(json.loads(raw)['events']), part['records'])
            count += part['records']
        self.assertEqual(count, state['record_count'])

    def test_unchanged_hours_reuse_parts_and_pinned_previous_index_remains_readable(self):
        from timeline_data_collector.publication import read_publication
        with patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', 8192):
            self.publish([event('old'+str(i), description='detail'*250) for i in range(8)] +
                         [event('today', '02')])
        index = read_json(self.writer.state_path)
        old_state = self.writer.read_state()
        pinned = self.writer.state_dir / 'pinned.json'
        pinned.write_bytes(self.writer.state_path.read_bytes())
        unchanged = [(self.writer.state_dir / p['path']) for p in index['event_parts']
                     if json.loads((self.writer.state_dir / p['path']).read_bytes())['events'][0]['id'].startswith('old')]
        before = [(p.read_bytes(), p.stat().st_mtime_ns) for p in unchanged]
        with patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', 8192):
            self.publish([event('today', '02', 'changed'), event('new', '02')])
        self.assertEqual(before, [(p.read_bytes(), p.stat().st_mtime_ns) for p in unchanged])
        self.assertEqual(read_publication(pinned)['events'], old_state['events'])
        self.assertEqual(len(self.writer.read_state()['events']), 10)

    def test_partition_and_index_failures_restore_outputs_and_checkpoint(self):
        import timeline_data_collector.publisher as module
        with patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', 8192):
            self.publish([event('old'+str(i), description='detail'*250) for i in range(8)], {'offset': 1})
        before = {p: p.read_bytes() for p in self.root.rglob('*.json')}
        original = module.atomic_write
        for failure in ('part', 'index'):
            def failing(path, raw):
                if (failure == 'index' and path == self.writer.state_path or
                        failure == 'part' and path.parent.name == 'parts'):
                    raise OSError('publication interrupted')
                return original(path, raw)
            with self.subTest(failure=failure), patch.object(module, 'atomic_write', side_effect=failing):
                with self.assertRaisesRegex(OSError, 'interrupted'):
                    self.publish([event('new', '02')], {'offset': 2})
            self.assertEqual({p: p.read_bytes() for p in self.root.rglob('*.json')}, before)
            self.assertEqual(self.writer.checkpoint('source'), {'offset': 1})
            self.assertFalse(self.writer.pending.exists())

    def test_oversized_record_or_checkpoint_preserves_committed_files(self):
        self.publish([event('one')], {'offset': 1})
        before = {p: p.read_bytes() for p in self.root.rglob('*.json')}
        for records, checkpoint, message in [
                ([event('huge', description='x'*8192)], {'offset': 2}, 'record.*budget'),
                ([event('new')], {'huge': 'x'*8192}, 'index.*budget')]:
            with self.subTest(message=message), patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', 8192):
                with self.assertRaisesRegex(ValueError, message): self.publish(records, checkpoint)
            self.assertEqual({p: p.read_bytes() for p in self.root.rglob('*.json')}, before)
            self.assertEqual(self.writer.checkpoint('source'), {'offset': 1})
        self.assertFalse((self.writer.state_dir / 'parts').exists())

    def test_corrupt_part_is_rejected_before_advancing_checkpoint(self):
        with patch.object(Publisher, 'MAX_SNAPSHOT_BYTES', 8192):
            self.publish([event('old'+str(i), description='detail'*250) for i in range(8)], {'offset': 1})
        before = self.writer.state_path.read_bytes()
        part = self.writer.state_dir / read_json(self.writer.state_path)['event_parts'][0]['path']
        part.write_bytes(part.read_bytes().replace(b'detail', b'broken', 1))
        with self.assertRaisesRegex(ValueError, 'integrity'):
            self.publish([event('new')], {'offset': 2})
        self.assertEqual(self.writer.state_path.read_bytes(), before)
        self.assertFalse(self.writer.pending.exists())

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

    def publish(self, records, checkpoint=None):
        return self.writer.publish('source','input',{'id':'test'},RecordBatch(records, checkpoint or {}))

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
