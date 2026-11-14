"""Descriptor lookup verifies selected immutable parts, including nested IDs."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from openbexi_timeline_server import publication


class PublicationLookupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.state = self.root / '.timeline-collector'
        (self.state / 'parts').mkdir(parents=True)
        self.parts = []
        for identity in ('first', 'second', 'third'):
            records = [dict(id=identity, activities=[dict(id=identity + '-child')])]
            raw = json.dumps(dict(events=records)).encode()
            digest = hashlib.sha256(raw).hexdigest()
            name = f'parts/{digest}.json'
            (self.state / name).write_bytes(raw)
            self.parts.append(dict(path=name, sha256=digest, bytes=len(raw), records=1,
                                   ids=[identity, identity + '-child']))
        self.save()

    def save(self, **extra):
        (self.state / 'publication.json').write_text(json.dumps(dict(
            version=2, event_parts=self.parts, record_count=3, **extra)))

    def test_nested_lookup_reads_only_matching_part(self):
        with patch.object(publication, 'read_part', wraps=publication.read_part) as read:
            self.assertEqual(publication.descriptor(self.root, 'third-child'), dict(id='third-child'))
        self.assertEqual(read.call_count, 1)
        self.assertEqual(read.call_args.args[1]['path'], self.parts[2]['path'])

    def test_old_and_incorrect_hints_fall_back_without_hiding_records(self):
        for hints in (None, ['wrong']):
            for part in self.parts:
                part.pop('ids', None)
                if hints is not None: part['ids'] = hints
            self.save()
            self.assertEqual(publication.descriptor(self.root, 'third-child'), dict(id='third-child'))
            self.assertIsNone(publication.descriptor(self.root, 'absent'))

    def test_selected_part_integrity_and_retired_identity(self):
        (self.state / self.parts[2]['path']).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'integrity'):
            publication.descriptor(self.root, 'third')
        self.save(retired_ids=['third'])
        self.assertIs(publication.descriptor(self.root, 'third'), False)

    def test_collector_commit_during_lookup_preserves_pinned_part(self):
        from openbexi_timeline_server.storage import atomic_json
        original = publication.read_part
        replacement = dict(id='third-child', data=dict(description='new evidence'))
        raw = json.dumps(dict(events=[dict(id='third', activities=[replacement])])).encode()
        digest = hashlib.sha256(raw).hexdigest()
        name = f'parts/{digest}.json'
        (self.state / name).write_bytes(raw)
        def publish_while_reading(root, part):
            parts = self.parts[:2] + [dict(path=name, sha256=digest, bytes=len(raw), records=1,
                                         ids=['third', 'third-child'])]
            atomic_json(self.state / 'publication.json', dict(version=2, event_parts=parts, record_count=3))
            return original(root, part)
        with patch.object(publication, 'read_part', side_effect=publish_while_reading):
            self.assertEqual(publication.descriptor(self.root, 'third-child'), dict(id='third-child'))
        self.assertEqual(publication.descriptor(self.root, 'third-child'), replacement)


if __name__ == '__main__':
    unittest.main()
