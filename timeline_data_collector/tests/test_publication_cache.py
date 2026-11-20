"""Cache hits preserve publication isolation, integrity checks and recovery."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zlib

from timeline_data_collector import publication
from timeline_data_collector.contracts import RecordBatch
from timeline_data_collector.io import atomic_write
from timeline_data_collector.publisher import Publisher


class PublicationCacheTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.cache = publication.PublicationFileCache()
        replaced = patch.object(publication, '_FILE_CACHE', self.cache)
        replaced.start()
        self.addCleanup(replaced.stop)

    def prepare(self):
        records = [dict(id='one', start='2026-01-01T12:00:00Z', data={'title': 'original'})]
        raw, parts = publication.encode_publication(dict(version=2, record_count=1, events=records))
        index = self.root / 'publication.json'
        index.write_bytes(raw)
        for name, payload in parts.items():
            part = self.root / name
            part.parent.mkdir(exist_ok=True)
            part.write_bytes(payload)
        return index, part

    def test_warm_reads_do_not_open_files_and_return_independent_records(self):
        index, _ = self.prepare()
        first = publication.read_publication(index)
        with patch.object(Path, 'open', side_effect=AssertionError('unchanged file reopened')):
            second = publication.read_publication(index)
        second['events'][0]['data']['title'] = 'caller edit'
        self.assertEqual(publication.read_publication(index), first)

    def test_same_size_part_edit_is_reverified(self):
        index, part = self.prepare()
        publication.read_publication(index)
        stat = part.stat()
        part.write_bytes(part.read_bytes().replace(b'original', b'corrupt!'))
        os.utime(part, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
        with self.assertRaisesRegex(ValueError, 'integrity'):
            publication.read_publication(index)

    def test_replaced_index_and_deleted_cached_part_are_not_hidden(self):
        index, part = self.prepare()
        original = publication.read_publication(index)
        raw = index.read_bytes()
        atomic_write(index, raw.replace(b'"record_count":1', b'"record_count":2'))
        with self.assertRaisesRegex(ValueError, 'count mismatch'):
            publication.read_publication(index)
        atomic_write(index, raw)
        payload = part.read_bytes()
        part.unlink()
        with self.assertRaises(FileNotFoundError):
            publication.read_publication(index)
        part.write_bytes(payload)
        self.assertEqual(publication.read_publication(index), original)

    def test_cached_bytes_still_validate_index_digest_and_part_counts(self):
        index, _ = self.prepare()
        publication.read_publication(index)
        value = json.loads(index.read_bytes())
        for field, replacement, message in [('sha256', '0' * 64, 'integrity'),
                                             ('bytes', 1, 'integrity'),
                                             ('records', 2, 'count mismatch')]:
            changed = deepcopy(value)
            changed['event_parts'][0][field] = replacement
            atomic_write(index, json.dumps(changed))
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, message):
                publication.read_publication(index)

    def test_cache_is_bounded_and_evicted_files_are_read_again(self):
        payload = b'some publication bytes' * 10
        size = len(zlib.compress(payload, level=1))
        cache = publication.PublicationFileCache(max_bytes=size, max_entries=1)
        first, second = self.root / 'first', self.root / 'second'
        for path in (first, second):
            path.write_bytes(payload)
            cache.read(path)
        self.assertEqual(cache.bytes, size)
        self.assertEqual(list(cache.entries), [second])
        with patch.object(Path, 'open', side_effect=OSError('evicted file read')):
            with self.assertRaisesRegex(OSError, 'evicted file read'): cache.read(first)
        cache.clear()
        self.assertEqual(cache.bytes, 0)
        self.assertFalse(cache.entries)

    def test_concurrent_readers_share_only_immutable_bytes(self):
        index, _ = self.prepare()
        with ThreadPoolExecutor(max_workers=4) as pool:
            values = list(pool.map(publication.read_publication, [index] * 12))
        self.assertTrue(all(value == values[0] for value in values))
        values[0]['events'].clear()
        self.assertEqual(len(values[-1]['events']), 1)
        self.assertEqual(self.cache.bytes, sum(len(entry[1]) for entry in self.cache.entries.values()))

    def test_scoped_checkpoint_update_preserves_history_and_rolls_back_failure(self):
        writer = Publisher(self.root / 'yyyy/mm/dd', 'DEMO')
        event = dict(id='one', start='2026-01-01T12:00:00Z', data={'title': 'one'})
        writer.publish('source', 'input', 'test', RecordBatch([event], {'files': {'old': 1}}),
                       checkpoint_scope='history:2026-01-01')
        before = writer.state_path.read_bytes()
        with patch('timeline_data_collector.publisher.atomic_write', side_effect=OSError('interrupted')):
            with self.assertRaises(OSError):
                writer.publish('source', 'input', 'test', RecordBatch([], {'files': {'today': 2}}),
                               checkpoint_scope='current')
        self.assertEqual(writer.state_path.read_bytes(), before)
        writer.publish('source', 'input', 'test', RecordBatch([], {'files': {'today': 2}}),
                       checkpoint_scope='current')
        self.assertEqual(writer.checkpoint('source')['_collector_scopes'], {
            'history:2026-01-01': {'files': {'old': 1}}, 'current': {'files': {'today': 2}}})


if __name__ == '__main__':
    unittest.main()
