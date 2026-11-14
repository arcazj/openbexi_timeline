"""Synthetic dictionaries verify normalization without exposing operational mappings."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from timeline_data_collector.metadata import MetadataNormalizer, descriptor_record, merge_descriptor, canonical_satellite, satellite_catalog_snapshot
from unittest.mock import patch
import json


class MetadataTests(unittest.TestCase):
    def test_conversion_catalog_snapshot_avoids_per_record_filesystem_checks_and_refreshes(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict('os.environ', {'OPENBEXI_SATELLITE_CATALOG': ''}):
            root = Path(folder)
            path = root/'reference/satellites.json'; path.parent.mkdir()
            def save(name):
                path.write_text(json.dumps({'satellites': [{'name': name, 'series': 'series_99', 'aliases': ['9991']}]}))
            save('SAT_9991')
            with satellite_catalog_snapshot(root):
                with patch('timeline_data_collector.metadata.catalog_path', side_effect=AssertionError('Repeated catalog filesystem lookup')):
                    for _ in range(100):
                        self.assertEqual(canonical_satellite('9991', root), ('SAT_9991', 'series_99'))
                        self.assertEqual(canonical_satellite(' unknown ', root), ('unknown', 'others'))
                save('SAT_9991_UPDATED')
                self.assertEqual(canonical_satellite('9991', root), ('SAT_9991', 'series_99'))
            with satellite_catalog_snapshot(root):
                self.assertEqual(canonical_satellite('9991', root), ('SAT_9991_UPDATED', 'series_99'))

    def test_catalog_snapshot_is_nested_and_restored_after_failure(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict('os.environ', {'OPENBEXI_SATELLITE_CATALOG': ''}):
            roots = [Path(folder)/name for name in ('first', 'second')]
            for root in roots:
                path = root/'reference/satellites.json'; path.parent.mkdir(parents=True)
                path.write_text(json.dumps({'satellites': [{'name': root.name, 'aliases': ['9991']}]}))
            with satellite_catalog_snapshot(roots[0]):
                self.assertEqual(canonical_satellite('9991', roots[0])[0], 'first')
                with self.assertRaisesRegex(RuntimeError, 'stop'):
                    with satellite_catalog_snapshot(roots[1]):
                        self.assertEqual(canonical_satellite('9991', roots[1])[0], 'second')
                        self.assertEqual(canonical_satellite('9991', roots[0])[0], 'first')
                        raise RuntimeError('stop')
                with patch('timeline_data_collector.metadata.catalog_path', side_effect=AssertionError('Snapshot lost')):
                    self.assertEqual(canonical_satellite('9991', roots[0])[0], 'first')

    def setUp(self):
        self.normalizer = MetadataNormalizer({'flatten_fields': True, 'satellites': [{'name': 'SAT_9991', 'series': 'series_99', 'aliases': ['9991']}]})

    def test_aliases_use_one_dictionary_across_namespaces_and_preserve_unknowns(self):
        for namespace in ('DEMO_TICKET', 'DEMO_ISSUE', 'Operations'):
            record = self.normalizer.record({'id': 'sample', 'data': {'title': 'Subject', 'sat_shortname': ' sat-9991 ', 'serie': 'Series 99'}}, namespace)
            self.assertEqual(('SAT_9991', 'series_99'), (record['data']['satellite'], record['data']['series']))
            self.assertNotIn('sat_shortname', record['data']); self.assertNotIn('serie', record['data'])
        unknown = self.normalizer.record({'data': {'satellite': 'Unmapped spacecraft'}}, 'Operations')
        self.assertEqual('Unmapped spacecraft', unknown['data']['satellite'])
        self.assertEqual('others', unknown['data']['series'])
        self.assertEqual({'Unmapped spacecraft'}, self.normalizer.gaps)

    def test_ticket_fields_flatten_once_and_preserve_canonical_metadata(self):
        source = {'id': 'DEMO_TICKET-1', 'start': '2020-01-01T00:00:00Z', 'data': {'title': 'Subject', 'site': 'Primary',
                  'description': '<table>Old content</table>', 'fields': {'ID': 'wrong', 'Start': 'wrong', 'Subject': 'Subject',
                  'site': 'Different', 'sat': '9991', 'sat_shortname': 'SAT_9991', 'enabled': False, 'count': 0}}}
        before = deepcopy(source); record = self.normalizer.record(source, 'DEMO_TICKET'); descriptor = self.normalizer.descriptor(record, 'DEMO_TICKET')
        self.assertEqual(before, source)
        self.assertEqual(('DEMO_TICKET-1', '2020-01-01T00:00:00Z'), (descriptor['id'], descriptor['start']))
        self.assertEqual('Subject', descriptor['description']); self.assertEqual('Primary', descriptor['site'])
        self.assertEqual('SAT_9991', descriptor['satellite']); self.assertEqual('series_99', descriptor['series'])
        self.assertFalse(descriptor['enabled']); self.assertEqual(0, descriptor['count'])
        for key in ('fields', 'data', 'sat', 'sat_shortname'): self.assertNotIn(key, descriptor)
        self.assertGreater(self.normalizer.issues['attribute_collision'], 0)

    def test_nested_activity_descriptors_have_the_same_flat_shape(self):
        raw = {'id': 'parent', 'start': '2020-01-01T00:00:00Z', 'data': {'title': 'Session'}, 'activities': [
            {'id': 'child', 'start': '2020-01-01T00:01:00Z', 'data': {'title': 'Activity', 'sat': '9991'}}]}
        record = self.normalizer.record(raw, 'Operations'); result = descriptor_record(record)
        self.assertNotIn('data', result); self.assertNotIn('data', result['activities'][0])
        self.assertEqual('SAT_9991', result['activities'][0]['satellite'])

    def test_ambiguous_aliases_are_rejected_instead_of_overwritten(self):
        with self.assertRaisesRegex(ValueError, 'Conflicting canonical'):
            MetadataNormalizer({'flatten_fields': True, 'satellites': [{'name': 'A', 'series': 'one', 'aliases': ['same']}, {'name': 'B', 'series': 'two', 'aliases': ['same']}]})

    def test_adoption_preserves_details_from_flat_and_historical_nested_descriptors(self):
        summary = {'id': 'same', 'start': '2020-01-01T00:00:00Z', 'data': {'title': 'Old', 'status': 'READY'}}
        for detail in ({'id': 'same', 'title': 'Detailed', 'description': 'Complete history'}, {'id': 'same', 'data': {'title': 'Detailed', 'description': 'Complete history'}}):
            result = merge_descriptor(summary, detail)
            self.assertEqual('Complete history', result['data']['description'])
            self.assertEqual('Detailed', result['data']['title']); self.assertEqual('READY', result['data']['status'])
            self.assertEqual('2020-01-01T00:00:00Z', result['start'])

    def test_mapping_upgrade_normalizes_existing_contributions_before_conflict_checks(self):
        from timeline_data_collector.publisher import Publisher
        from timeline_data_collector.contracts import RecordBatch
        with tempfile.TemporaryDirectory() as folder:
            publisher=Publisher(Path(folder)/'yyyy/mm/dd','Operations')
            record={'id':'shared','start':'2020-01-01T00:00:00Z','data':{'title':'Same record','sat':'9991'}}
            publisher.publish('first','one','1',RecordBatch([record],{}))
            publisher.normalizer=self.normalizer
            result=publisher.publish('second','two','1',RecordBatch([record],{}))
            self.assertEqual(1,result['namespace_records'])
            self.assertEqual('SAT_9991',publisher.read_state()['events'][0]['data']['satellite'])
