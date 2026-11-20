"""Native equivalents of the historical Mongo adapter safety regressions."""
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import json
import tempfile
import unittest
from bson import ObjectId
from openbexi_timeline_server.config import Configuration, configuration_from_document
from openbexi_timeline_server.providers import MongoAdapter, event_documents, materialize_sources, json_value
from openbexi_timeline_server.index import TimelineIndex
from openbexi_timeline_server.query import Queries


def event(identity, **extra):
    return dict(id=identity, start='2026-09-12T12:00:00Z', data={'title': str(identity)}, **extra)


class Collection:
    def __init__(self, records=()):
        self.records = {value.get('_id', value.get('id')): deepcopy(value) for value in records}
        self.mutations = 0
        self.fail_after = None
        self.closed = 0

    def insert_many(self, records, *, ordered):
        assert ordered
        self.mutations += 1
        for record in records:
            if record['_id'] in self.records: raise ValueError('Duplicate key')
            self.records[record['_id']] = deepcopy(record)

    def _match(self, selector):
        assert len(selector) == 1
        key, equality = next(iter(selector.items()))
        assert set(equality) == {'$eq'}
        target = equality['$eq']
        return next((identity for identity, record in self.records.items() if record.get(key) == target), None)

    def replace_one(self, selector, record, *, upsert):
        assert not upsert
        self.mutations += 1
        matched = self._match(selector)
        if matched is not None:
            record = deepcopy(record); record.setdefault('_id', matched)
            self.records[matched] = record
        return SimpleNamespace(matched_count=0 if matched is None else 1)

    def delete_one(self, selector):
        self.mutations += 1
        matched = self._match(selector)
        if matched is not None: self.records.pop(matched)

    def find(self, query):
        assert query == {}
        try:
            for index, record in enumerate(self.records.values()):
                if index == self.fail_after: raise OSError('Synthetic connection loss with private details')
                yield deepcopy(record)
        finally: self.closed += 1


class MongoSafetyTests(unittest.TestCase):
    def setUp(self):
        self.collection = Collection([event('existing', _id='existing')])
        self.adapter = MongoAdapter(collection=self.collection)

    def test_add_preserves_existing_and_nested_arrays(self):
        self.assertTrue(self.adapter.add_events([event('new', activities=[event('child')])]))
        self.assertEqual(set(self.collection.records), {'existing', 'new'})
        self.assertIsInstance(self.collection.records['new']['activities'], list)

    def test_one_scalar_target_updates_without_upsert_and_deletes_only_selected(self):
        self.adapter.add_events([event('second')])
        self.assertTrue(self.adapter.update_events([event('existing', title='Updated')]))
        self.assertEqual(self.collection.records['existing']['title'], 'Updated')
        self.assertFalse(self.adapter.update_events([event('missing')]))
        self.assertEqual(set(self.collection.records), {'existing', 'second'})
        self.assertTrue(self.adapter.remove_events([dict(id='existing')]))
        self.assertEqual(set(self.collection.records), {'second'})

    def test_invalid_entire_batch_never_mutates(self):
        for payload in (None, {}, [{}], [dict(id={'$ne': None})], [dict(id=True)], [dict(id=' ')],
                        [event('valid'), {}], [event('same'), {'events': [event('same')]}]):
            for method in ('add_events', 'update_events', 'remove_events'):
                with self.subTest(payload=payload, method=method):
                    self.assertFalse(getattr(self.adapter, method)(payload))
        self.assertEqual(self.collection.mutations, 0)
        self.assertEqual(set(self.collection.records), {'existing'})

    def test_empty_batch_envelope_and_object_id(self):
        for method in ('add_events', 'update_events', 'remove_events'): self.assertTrue(getattr(self.adapter, method)([]))
        self.assertEqual(self.collection.mutations, 0)
        identity = ObjectId('507f1f77bcf86cd799439011')
        self.assertTrue(self.adapter.add_events([{'events': [event('a'), event('b', _id={'$oid': str(identity)})]}]))
        self.assertIn(identity, self.collection.records)
        self.assertTrue(self.adapter.remove_events([{'_id': identity}]))
        self.assertEqual(set(self.collection.records), {'existing', 'a'})

    def test_aggregate_read_and_numeric_array_migration(self):
        aggregate = {'dateTimeFormat': 'iso8601', 'events': {'0': event('a', activities={'0': event('nested')}), '1': event('b')}}
        collection = Collection([{'_id': 'legacy-aggregate', '0': aggregate}])
        adapter = MongoAdapter(collection=collection)
        raw = adapter.get_data()
        self.assertEqual(raw[0], {'dateTimeFormat': 'iso8601'})
        self.assertEqual([record['id'] for record in adapter.read_events()], ['a', 'b'])
        self.assertEqual(list(adapter.read_events())[0]['activities'][0]['id'], 'nested')
        self.assertEqual(collection.closed, 3)

    def test_bson_dates_nested_values_and_limits(self):
        identity = ObjectId('507f1f77bcf86cd799439011')
        self.assertEqual(json_value({'nested': [identity, datetime(2026, 1, 1)]}),
                         {'nested': [str(identity), '2026-01-01T00:00:00Z']})
        with self.assertRaisesRegex(ValueError, 'record limit'): list(self.adapter.read_events(limit=0))
        with self.assertRaisesRegex(ValueError, 'byte limit'): list(self.adapter.read_events(max_record_bytes=2))

    def test_bad_aggregate_and_nested_timestamps_are_rejected(self):
        collection = Collection([{'_id': 'aggregate', '0': event('a'), 'unexpected': 'value'}])
        with self.assertRaisesRegex(ValueError, 'aggregate'): list(MongoAdapter(collection=collection).read_events())
        collection = Collection([event('parent', activities=[dict(id='child', start='invalid')])])
        with self.assertRaisesRegex(ValueError, 'timestamps'): list(MongoAdapter(collection=collection).read_events())


class MongoSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = Configuration(self.root, self.root / 'state', [])
        self.snapshot = self.config.state / 'providers/1/events.json'
        self.config.providers = [dict(index=1, namespace='DEMO', snapshot_path=str(self.snapshot),
                                      url='mongodb://example.test', database='demo', collection='events')]
        self.collection = Collection([event('first'), event('second')])
        self.patch = patch('openbexi_timeline_server.providers.MongoAdapter', side_effect=lambda *_: MongoAdapter(collection=self.collection))
        self.patch.start(); self.addCleanup(self.patch.stop)

    def test_snapshot_replaces_only_complete_reads_and_preserves_unchanged_stamp(self):
        self.assertEqual(materialize_sources(self.config), [])
        original, stamp = self.snapshot.read_bytes(), self.snapshot.stat().st_mtime_ns
        self.assertEqual(materialize_sources(self.config), [])
        self.assertEqual(self.snapshot.stat().st_mtime_ns, stamp)
        self.collection.records['first']['data']['title'] = 'Changed'
        self.collection.fail_after = 1
        warnings = materialize_sources(self.config)
        self.assertEqual(self.snapshot.read_bytes(), original)
        self.assertEqual(warnings[0]['code'], 'provider_unavailable')
        self.assertNotIn('private details', json.dumps(warnings))
        self.collection.fail_after = None
        self.assertEqual(materialize_sources(self.config), [])
        self.assertNotEqual(self.snapshot.read_bytes(), original)

    def test_limit_and_invalid_record_retain_good_snapshot(self):
        materialize_sources(self.config); original = self.snapshot.read_bytes()
        self.config.max_records = 1
        self.assertTrue(materialize_sources(self.config))
        self.assertEqual(self.snapshot.read_bytes(), original)
        self.config.max_records = 100
        self.collection.records['second']['start'] = 'invalid'
        self.assertTrue(materialize_sources(self.config))
        self.assertEqual(self.snapshot.read_bytes(), original)

    def test_mixed_mongo_and_file_query_and_failure_coverage(self):
        from openbexi_timeline_server.storage import atomic_json
        local = self.root / 'local'; local.mkdir()
        atomic_json(local / 'events.json', {'events': [event('local')]})
        config = configuration_from_document({'data_sources': [
            dict(namespace='REMOTE', type='mongoDb', url='mongodb://example.test', database='demo', collection='events'),
            dict(namespace='LOCAL', type='json_file', target_path=str(local))]}, self.root, self.root / 'mixed-state')
        index = TimelineIndex(config)
        index.refresh()
        params = dict(startDate='2026-09-12T00:00:00Z', endDate='2026-09-13T00:00:00Z', progressive='0')
        body = Queries(index).query(params)
        self.assertEqual({record['id'] for record in body['events']}, {'first', 'second', 'local'})
        self.assertNotIn('example.test', json.dumps([source.public() for source in config.sources]))
        self.collection.fail_after = 0
        index.refresh()
        body = Queries(index).query(params)
        self.assertEqual({record['id'] for record in body['events']}, {'first', 'second', 'local'})
        self.assertTrue(body['timelineMatch']['warnings'])
