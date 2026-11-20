"""Archive completeness, revision merging and released-format regression tests."""
from copy import deepcopy
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch
import json
import tempfile
import unittest
from timeline_data_collector.acquisition import RetryableRequestError, epoch_millis, report_records
from timeline_data_collector.contracts import Context
from timeline_data_collector.io import read_json, write_json
from timeline_plugin_earthquake.engine import DAY, Importer, acquire, convert, save

BASE = epoch_millis('2024-03-01')


def feature(identifier, stamp=BASE):
    return dict(id='xx' + identifier, properties=dict(time=stamp, updated=stamp + 1, title=identifier, mag=4.5, net='xx', code=identifier))


class Catalog:
    def __init__(self, context, features=()):
        self.context, self.features = context, list(features)
        self.requests = []
        self.truncate = False
        self.duplicate = False
        self.retry_span = None
        self.failed_range = None

    def check(self): self.context.check_cancelled()

    def fetch(self, url, *, retries):
        self.check()
        parsed = urlsplit(url)
        args = parse_qs(parsed.query)
        start, end = epoch_millis(args['starttime'][0]), epoch_millis(args['endtime'][0])
        self.requests.append((parsed.path, start, end))
        if (self.retry_span is not None and end - start >= self.retry_span) or self.failed_range == (start, end):
            raise RetryableRequestError('Synthetic transient failure')
        values = [item for item in self.features if start <= item['properties']['time'] <= end]
        if parsed.path.endswith('count'): return str(len(values))
        if self.truncate: values = values[:-1]
        if self.duplicate and len(values) > 1: values[-1] = values[0]
        return json.dumps(dict(features=values))


class NativeEarthquakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.context = Context(workspace=self.root / 'workspace.json', namespace='DEMO', source={'id': 'input'},
                               source_key='input', workdir=self.root / 'work', checkpoint={})

    def importer(self, catalog): return Importer(self.root / 'acquired', 'http://example.test/', catalog)
    def records(self): return report_records(self.root / 'acquired', 'earthquake', self.context)

    def test_released_geojson_format_without_java(self):
        fixture = read_json(Path(__file__).parent / 'fixtures/legacy-geojson.json')
        raw = self.root / 'input.json'; write_json(raw, fixture['input'])
        with patch('subprocess.Popen', side_effect=AssertionError('Python-only collection')):
            records = acquire(dict(input_file=str(raw), output_root=str(self.root / 'acquired')), self.context)
        self.assertEqual(records, fixture['expected'])

    def test_legacy_identity_and_newer_revision_survive_replay(self):
        old = convert(dict(features=[feature('first')]), self.root / 'acquired')
        record = next(iter(old.values()))[0]
        record['id'] = 'legacy-id'; record['data'].pop('eventId')
        save(old)
        corrected = feature('first'); corrected['properties']['updated'] = BASE + 2
        corrected['properties']['title'] = 'Corrected'
        save(convert(dict(features=[corrected]), self.root / 'acquired'))
        save(convert(dict(features=[feature('first')]), self.root / 'acquired'))
        self.assertEqual(len(self.records()), 1)
        self.assertEqual(self.records()[0]['id'], 'legacy-id')
        self.assertEqual(self.records()[0]['data']['title'], 'Corrected')

    def test_completed_empty_interval_gaps_and_force_refresh(self):
        catalog = Catalog(self.context)
        self.importer(catalog).import_range(BASE, BASE + 999)
        catalog.features.append(feature('late', BASE + 500))
        calls = len(catalog.requests)
        self.importer(catalog).import_range(BASE, BASE + 999)
        self.assertEqual(len(catalog.requests), calls)
        self.importer(catalog).import_range(BASE, BASE + 999, refresh=True)
        self.assertEqual(len(self.records()), 1)
        self.importer(catalog).import_range(BASE + 2000, BASE + 2999)
        catalog.requests.clear()
        self.importer(catalog).import_range(BASE, BASE + 3999)
        self.assertEqual([(a, b) for path, a, b in catalog.requests], [(BASE + 3000, BASE + 3999), (BASE + 1000, BASE + 1999)])

    def test_split_limit_completeness_and_resume(self):
        catalog = Catalog(self.context, [feature('a', BASE), feature('b', BASE + 1000)])
        importer = self.importer(catalog); importer.QUERY_LIMIT = 1
        importer.import_range(BASE, BASE + 1999)
        self.assertEqual(len(self.records()), 2)
        queries = [(a, b) for path, a, b in catalog.requests if path.endswith('query')]
        self.assertEqual(queries, [(BASE + 1000, BASE + 1999), (BASE, BASE + 999)])
        self.assertEqual(importer.completed, [(BASE, BASE + 1999)])
        catalog.requests.clear()
        self.importer(catalog).import_range(BASE, BASE + 1999)
        self.assertEqual(catalog.requests, [])

    def test_incomplete_and_duplicate_responses_never_checkpoint(self):
        for mode in ('truncate', 'duplicate'):
            with self.subTest(mode=mode):
                catalog = Catalog(self.context, [feature('a'), feature('b', BASE + 1)])
                setattr(catalog, mode, True)
                with self.assertRaisesRegex(ValueError, 'incomplete'): self.importer(catalog).import_range(BASE, BASE + 100)
                self.assertFalse((self.root / 'acquired/.import-progress.json').exists())
                self.assertEqual(self.records(), [])

    def test_retry_split_retains_completed_newer_sibling_after_older_failure(self):
        catalog = Catalog(self.context)
        catalog.retry_span = 2 * DAY - 1
        catalog.failed_range = (BASE, BASE + DAY - 1)
        with self.assertRaises(RetryableRequestError): self.importer(catalog).import_range(BASE, BASE + 2 * DAY - 1)
        progress = read_json(self.root / 'acquired/.import-progress.json')
        self.assertEqual(progress['completed'], [dict(start=BASE + DAY, end=BASE + 2 * DAY - 1)])
        catalog.failed_range = None; catalog.requests.clear()
        self.importer(catalog).import_range(BASE, BASE + 2 * DAY - 1)
        self.assertEqual([(a, b) for _, a, b in catalog.requests], [(BASE, BASE + DAY - 1)])

    def test_checkpoint_mismatch_and_reversed_range_rejected(self):
        catalog = Catalog(self.context)
        with self.assertRaises(ValueError): self.importer(catalog).import_range(BASE + 1, BASE)
        self.assertEqual(catalog.requests, [])
        write_json(self.root / 'acquired/.import-progress.json', dict(version=1, apiBase='http://other.test/', completed=[]))
        with self.assertRaisesRegex(ValueError, 'Incompatible'): self.importer(catalog)
