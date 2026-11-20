"""HANS pagination, migration and released-format regression tests."""
from pathlib import Path
from unittest.mock import patch
import json
import tempfile
import unittest
from timeline_data_collector.acquisition import RetryableRequestError, epoch_millis, report_records
from timeline_data_collector.contracts import Context
from timeline_data_collector.io import read_json, write_json
from timeline_plugin_volcano.engine import Importer, acquire, convert, save

BASE = epoch_millis('2006-11-21') // 1000


def notice(identifier, stamp=BASE, kind='VAN'):
    return dict(noticeIdentifier=identifier, sentUnixtime=stamp, noticeTypeCd=kind, obsAbbr='example',
                permLink='https://example.test/' + ('vona/' if kind == 'VV' else 'van/') + identifier,
                noticeHtml='<p>Synthetic ' + identifier + '</p>', volcCds='EX')


class Archive:
    def __init__(self, context, total, pages):
        self.context, self.total, self.pages = context, total, pages
        self.requests = []
        self.fail_page = None

    def check(self): self.context.check_cancelled()

    def fetch(self, url, payload):
        self.check()
        self.requests.append((url.rsplit('/', 1)[-1], dict(payload)))
        if url.endswith('/preflight'): return json.dumps(dict(noticeTotal=self.total))
        page = payload['pageIndex']
        if page == self.fail_page: raise RetryableRequestError('Synthetic page failure')
        records = self.pages[page] if page < len(self.pages) else []
        return json.dumps(dict(noticeTotal=len(records), noticeData=records))


class NativeVolcanoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.context = Context(workspace=self.root / 'workspace.json', namespace='DEMO', source={'id': 'input'},
                               source_key='input', workdir=self.root / 'work', checkpoint={})

    def importer(self, archive): return Importer(self.root / 'acquired', 'http://example.test/', archive)
    def records(self): return report_records(self.root / 'acquired', 'volcano', self.context)
    def progress(self): return read_json(self.root / 'acquired/.archive-progress.json')

    def test_released_notice_format_without_java(self):
        fixture = read_json(Path(__file__).parent / 'fixtures/legacy-notices.json')
        raw = self.root / 'input.json'; write_json(raw, fixture['input'])
        with patch('subprocess.Popen', side_effect=AssertionError('Python-only collection')):
            records = acquire(dict(input_file=str(raw), output_root=str(self.root / 'acquired')), self.context)
        self.assertEqual(records, fixture['expected'])

    def test_pagination_overlap_incremental_bounds_and_empty_preflight(self):
        archive = Archive(self.context, 3, [[notice('a'), notice('b')], [notice('b'), notice('c')]])
        self.importer(archive).import_all(BASE + 10)
        self.assertEqual(len(self.records()), 3)
        self.assertEqual([q['pageIndex'] for method, q in archive.requests if method == 'search'], [0, 1, 2])
        self.assertEqual(archive.requests[0][1]['startUnixtime'], '')
        self.assertEqual(self.progress()['completedThrough'], BASE + 10)
        archive.requests.clear(); self.importer(archive).import_all(BASE + 10)
        self.assertEqual(archive.requests, [])
        archive.total = 0
        self.importer(archive).import_all(BASE + 20)
        self.assertEqual(len(archive.requests), 1)
        self.assertEqual(archive.requests[0][1]['startUnixtime'], BASE + 11)
        self.assertEqual(self.progress()['completedThrough'], BASE + 20)

    def test_page_failure_resumes_without_skipping_or_replaying_committed_page(self):
        archive = Archive(self.context, 2, [[notice('a')], [notice('b')]])
        archive.fail_page = 1
        with self.assertRaises(RetryableRequestError): self.importer(archive).import_all(BASE + 10)
        self.assertEqual(len(self.records()), 1)
        self.assertEqual(self.progress()['pending']['query']['pageIndex'], 1)
        self.assertEqual(self.progress()['completedThrough'], -1)
        archive.fail_page = None
        self.importer(archive).import_all(BASE + 10)
        self.assertEqual([q['pageIndex'] for method, q in archive.requests if method == 'search'], [0, 1, 1, 2])
        self.assertEqual(sum(method == 'preflight' for method, _ in archive.requests), 1)
        self.assertEqual(len(self.records()), 2)

    def test_incomplete_and_repeating_pages_never_complete(self):
        for pages, message in (([[notice('a')]], 'Incomplete'), ([[notice('a')], [notice('a')]], 'no progress')):
            with self.subTest(message=message):
                archive = Archive(self.context, 2, pages)
                checkpoint = self.root / ('checkpoint-' + message + '.json')
                with self.assertRaisesRegex(ValueError, message): self.importer(archive).import_notices(0, BASE, checkpoint)
                progress = read_json(checkpoint)
                self.assertEqual(progress['completedThrough'], -1)
                self.assertIn('pending', progress)

    def test_bounded_dates_resume_then_requery_completed_window(self):
        archive = Archive(self.context, 2, [[notice('first', BASE)], [notice('last', BASE + 86399)]])
        archive.fail_page = 1
        with self.assertRaises(RetryableRequestError): self.importer(archive).import_range('2006-11-21', '2006-11-21')
        checkpoint = self.root / 'acquired/.archive-2006-11-21_2006-11-21-progress.json'
        self.assertTrue(checkpoint.is_file())
        archive.fail_page = None
        self.importer(archive).import_range('2006-11-21', '2006-11-21')
        self.assertFalse(checkpoint.exists())
        for _, query in archive.requests:
            self.assertEqual((query['startUnixtime'], query['endUnixtime']), (BASE, BASE + 86399))
        self.assertEqual([q['pageIndex'] for method, q in archive.requests if method == 'search'], [0, 1, 1, 2])
        archive.pages[0][0]['noticeHtml'] = '<p>Corrected</p>'
        self.importer(archive).import_range('2006-11-21', '2006-11-21')
        self.assertEqual(sum(method == 'preflight' for method, _ in archive.requests), 2)
        self.assertEqual(len(self.records()), 2)
        self.assertEqual(next(r for r in self.records() if r['data']['noticeIdentifier'] == 'first')['data']['noticeHtml'], '<p>Corrected</p>')

    def test_old_pending_identity_replayed_and_regular_legacy_id_retained(self):
        staged = convert([dict(noticeIdentifier='shared', sent_unixtime=BASE, noticeType='VAN',
                               notice_url='https://example.test/van/shared', sections=[dict(colorCode='RED', volcanoName='Example')])], self.root / 'acquired')
        next(iter(staged.values()))[0]['id'] = 'legacy-regular-id'; save(staged)
        query = dict(obsAbbr='', noticeTypeCd='', volcCd='', startUnixtime=BASE, endUnixtime=BASE + 86399, searchText='', pageIndex=1)
        checkpoint = self.root / 'acquired/.archive-2006-11-21_2006-11-21-progress.json'
        write_json(checkpoint, dict(version=1, apiBase='http://example.test/', startInclusive=BASE, completedThrough=BASE - 1,
                                    pending=dict(query=query, expected=2, seen=['shared'])))
        archive = Archive(self.context, 2, [[notice('shared'), notice('shared', kind='VV')]])
        self.importer(archive).import_range('2006-11-21', '2006-11-21')
        self.assertEqual([q['pageIndex'] for method, q in archive.requests if method == 'search'], [0, 1])
        self.assertFalse(any(method == 'preflight' for method, _ in archive.requests))
        records = self.records(); self.assertEqual(len(records), 2)
        self.assertEqual(len({r['id'] for r in records}), 2)
        ordinary = next(r for r in records if r['data']['noticeType'] == 'VAN')
        self.assertEqual(ordinary['id'], 'legacy-regular-id')
        self.assertEqual(ordinary['data']['title'], 'RED - Example')
        self.assertEqual(ordinary['render']['image'], 'icon/ob_volcano_very_active.png')
        self.importer(archive).import_range('2006-11-21', '2006-11-21')
        self.assertEqual({r['id'] for r in self.records()}, {r['id'] for r in records})

    def test_invalid_bounds_and_checkpoint_rejected_before_requests(self):
        archive = Archive(self.context, 0, [])
        with self.assertRaises(ValueError): self.importer(archive).import_range('2006-11-22', '2006-11-21')
        write_json(self.root / 'acquired/.archive-progress.json', dict(version=1, apiBase='http://other.test/', completedThrough=-1))
        with self.assertRaisesRegex(ValueError, 'Incompatible'): self.importer(archive).import_all(BASE)
        self.assertEqual(archive.requests, [])
