import concurrent.futures
import io
import json
from pathlib import Path
import tempfile
import time
import unittest

from starlette.testclient import TestClient

from openbexi_timeline_server.app import create_app
from openbexi_timeline_server.config import Configuration, Source, load_configuration
from openbexi_timeline_server.index import BoundedReader, TimelineIndex, event_stream
from openbexi_timeline_server.matching import Search, compile_filter, instant, iso
from openbexi_timeline_server.query import Queries
from openbexi_timeline_server.storage import Storage, atomic_json

REPO = Path(__file__).resolve().parents[2]
PARAMS = {"startDate": "2026-09-12T00:00:00Z", "endDate": "2026-09-13T00:00:00Z", "scene": "0", "filter": "", "search": "", "progressive": "1"}


def event(identity, **extra):
    return {"id": identity, "start": "2026-09-12T12:00:00Z", "data": {"title": identity}, **extra}


class MatchingTests(unittest.TestCase):
    def test_literal_and_grouped_legacy_patterns_preserve_regex_meaning(self):
        import regex
        from openbexi_timeline_server.matching import pattern
        expressions = ['NOK', 'system:RNG', 'description:(90% used)', '(one)(two)', '()',
                       r'\Q[a+b] (quoted)\E', r'a\+b', r'\(literal\)', r'path\\file',
                       r'\d+', '^NOK$', 'N.K', '(a|b)', '(?i)nok', r'(a)\1']
        candidates = ['', 'NOK', 'nok', 'a+b', '(literal)', 'path\\file', 'onetwo', 'aa', '123',
                      '[a+b] (quoted)', 'description:90% used', 'system:RNG', 'prefix NOK suffix']
        for expression in expressions:
            reference = (lambda text: '[a+b] (quoted)' in text) if expression.startswith(r'\Q') else regex.compile(expression).search
            for candidate in candidates:
                with self.subTest(expression=expression, candidate=candidate):
                    self.assertEqual(pattern(expression)(candidate), bool(reference(candidate)))

    def test_text_search_matches_literal_punctuation_in_large_descriptors(self):
        record = event('large')
        record['data']['description'] = 'trace ' * 300000 + 'VT:NOK [a+b] Caf\u00e9'
        for query in ('nok', '[a+b]', 'CAF\u00c9'):
            self.assertTrue(Search(query, 'text').matches(record))
        for query in ('NO_MATCH', 'a.*b'):
            self.assertFalse(Search(query, 'text').matches(record))

    def test_actual_regex_keeps_its_processing_limit(self):
        from openbexi_timeline_server.matching import pattern
        with self.assertRaisesRegex(ValueError, 'processing limit'):
            pattern('(a+)+$')('a' * 100000 + '!')

    def test_shared_filter_contract(self):
        fixture = json.loads((REPO / "tests/fixtures/filter-expressions.json").read_text(encoding="utf-8"))
        for case in fixture["cases"]:
            with self.subTest(case=case["expression"]):
                predicate = compile_filter(case["expression"])
                self.assertEqual(case["ids"], [r["id"] for r in fixture["records"] if predicate(r)])
        for expression in fixture["invalid"]:
            with self.subTest(invalid=expression), self.assertRaises(ValueError):
                compile_filter(expression)

    def test_shared_search_contract(self):
        fixture = json.loads((REPO / "tests/fixtures/search-modes.json").read_text(encoding="utf-8"))
        for case in fixture["cases"]:
            with self.subTest(case=case):
                search = Search(case["query"], case["mode"])
                self.assertEqual(case["ids"], [r["id"] for r in fixture["events"] if search.matches(r)])

    def test_dates_include_bce_offsets_and_browser_limits(self):
        for value in (0, -8640000000000000, 8640000000000000, -62167219200000, 1790000000123):
            self.assertEqual(value, instant(iso(value)))
        self.assertEqual(instant("2026-09-12T12:00:00Z"), instant("2026-09-12T08:00:00-04:00"))
        for invalid in ("2026-02-30T12:00:00Z", "2026-01-01T25:00:00Z", float("nan"), True):
            with self.assertRaises(ValueError):
                instant(invalid)


class ServerTests(unittest.TestCase):
    def test_previous_nok_activity_with_literal_saved_filter_avoids_regex_deadline(self):
        from unittest.mock import patch, Mock
        import regex
        description = 'trace ' * 250000 + ' VT:NOK'
        failed = event('failed')
        failed['data'].update(system='CMD', status='FINISHED_WITH_WARNING', description=description)
        nominal = event('nominal')
        nominal['data'].update(system='RNG', status='FINISHED', description=description)
        self.write([failed, nominal, event('unmatched')])
        expression = '|system:RNG+status:FINISHED;description:(90% used);system:CRON;system:SCRIPT;description:attribute MonitorProgram not set'
        compile_regex = regex.compile
        def expired_regex(value, flags=0):
            compile_regex(value, flags)  # Keep real syntax validation.
            return Mock(search=Mock(side_effect=TimeoutError('regex budget expired')))
        with patch('openbexi_timeline_server.matching.regex.compile', side_effect=expired_regex):
            records, metadata = self.scan({'history':'backward', 'search':'NOK', 'searchMode':'text', 'filter':expression})
        self.assertEqual([r['id'] for r in records], ['failed'])
        self.assertTrue(metadata['complete'])
        self.assertTrue(records[0]['searchMatch'])

    def test_forward_pages_skip_retired_versions_with_bounded_database_work(self):
        from unittest.mock import patch
        self.write([event(str(i)) for i in range(6)])
        first = self.queries.page(PARAMS)
        with self.index.connect() as db:
            start = instant(event('old')['start'])
            key = db.execute('SELECT key FROM files').fetchone()[0]
            db.executemany('INSERT INTO records(file_key,version,start,end,payload,created) VALUES(?,?,?,?,?,?)',
                          [(key, 'retired', start, start, '{}', time.time())] * 20000)
        connect = self.index.connect
        instructions = 0
        def counted_connect():
            db = connect()
            def progress():
                nonlocal instructions
                instructions += 100
                return 0
            db.set_progress_handler(progress, 100)
            return db
        with patch.object(self.index, 'connect', counted_connect):
            second = self.queries.page({**PARAMS, 'cursor': first['timelineMatch']['nextCursor']})
        self.assertEqual([r['id'] for r in second['events']], ['2', '3'])
        self.assertLess(instructions, 10000, 'A continuation scanned retired record versions')

    def test_initial_history_snapshot_skips_retired_versions_with_bounded_database_work(self):
        self.write([event(str(i)) for i in range(6)])
        with self.index.connect() as db:
            key = db.execute('SELECT key FROM files').fetchone()[0]
            older = instant('2025-01-01T00:00:00Z')
            db.executemany('INSERT INTO records(file_key,version,start,end,payload,created) VALUES(?,?,?,?,?,?)',
                          [(key, 'retired', older, older, '{}', time.time())] * 20000)
            instructions = 0
            def progress():
                nonlocal instructions
                instructions += 100
                return instructions > 10000
            db.set_progress_handler(progress, 100)
            try:
                self.queries.snapshot(db, 'history', instant('-271821-04-20T00:00:00Z'), instant(PARAMS['endDate']))
            finally:
                db.set_progress_handler(None, 0)
            self.assertEqual([row[0] for row in db.execute("SELECT file_key FROM cursor_files WHERE cursor='history'")], [key])
            self.assertLess(instructions, 10000, 'Creating a history cursor scanned retired versions')

    def test_history_merge_skips_retired_versions_and_orders_files_globally(self):
        self.write([event('one'), event('two')])
        self.write([event('three'), event('four')], self.source / 'other.json')
        with self.index.connect() as db:
            start = instant(event('old')['start'])
            key = db.execute('SELECT key FROM files').fetchone()[0]
            db.executemany('INSERT INTO records(file_key,version,start,end,payload,created) VALUES(?,?,?,?,?,?)',
                          [(key, 'retired', start, start, '{}', time.time())] * 20000)
            lower, upper = self.queries.validate({**PARAMS, 'history': 'backward'})
            self.queries.snapshot(db, 'merge-test', lower, upper)
            instructions = 0
            def progress():
                nonlocal instructions
                instructions += 100
                return instructions > 10000
            db.set_progress_handler(progress, 100)
            try:
                rows = list(self.queries.history_rows(db, 'merge-test', upper+1, 0, lower, upper))
            finally:
                db.set_progress_handler(None, 0)
            self.assertEqual([row['id'] for row in rows], sorted((row['id'] for row in rows), reverse=True))
            self.assertEqual(len(rows), 4)
            rest = list(self.queries.history_rows(db, 'merge-test', rows[1]['start'], rows[1]['id'], lower, upper))
            self.assertEqual([row['id'] for row in rest], [row['id'] for row in rows[2:]])
            self.assertLess(instructions, 10000)

    def test_snapshot_pins_only_current_overlaps_and_keeps_coverage_warnings(self):
        self.write([event('old')])
        self.write([event('future', start='2028-01-01T00:00:00Z')])
        self.write([event('long', start='2025-01-01T00:00:00Z', end='2027-01-01T00:00:00Z')], self.source / 'long.json')
        self.write([event('invalid', start='bad')], self.source / 'warning.json')
        with self.index.connect() as db:
            by_name = {Path(row['path']).name: row['key'] for row in db.execute('SELECT key,path FROM files')}
            for selected, expected in ((None, ['long.json', 'warning.json']), ([1], ['long.json', 'warning.json']), ([], []), ([9], [])):
                with self.subTest(sources=selected):
                    identifier = str(selected)
                    self.queries.snapshot(db, identifier, instant(PARAMS['startDate']), instant(PARAMS['endDate']), selected)
                    actual = {row[0] for row in db.execute('SELECT file_key FROM cursor_files WHERE cursor=?', (identifier,))}
                    self.assertEqual(actual, {by_name[name] for name in expected})

    def test_request_logs_identify_validation_and_coverage_without_request_contents(self):
        self.write([event('valid'), event('invalid', start='bad')])
        with TestClient(create_app(self.conf, start_indexer=False)) as client:
            with self.assertLogs('openbexi.timeline', level='WARNING') as logs:
                client.get('/openbexi_timeline/sessions', params={**PARAMS, 'search':'private-search'})
            self.assertIn('warning_codes=invalid_record', ''.join(logs.output))
            self.assertNotIn('private-search', ''.join(logs.output))
            with self.assertLogs('openbexi.timeline', level='WARNING') as logs:
                response = client.post('/openbexi_timeline/sessions', params={
                    'ob_request':'readDescriptor', 'event_id':'private/identity', 'start':'private-date'})
            self.assertEqual(response.status_code, 400)
            text = ''.join(logs.output)
            self.assertIn('reason=invalid_descriptor', text)
            self.assertIn('operation=readDescriptor', text)
            self.assertIn('error_type=ValueError', text)
            self.assertIn('location=storage.py:', text)
            self.assertNotIn('private', text)

    def test_read_query_does_not_sweep_retired_record_payloads(self):
        from unittest.mock import patch
        self.write([event('one')])
        with self.index.connect() as db: self.index.put(db,'last_cleanup',0)
        with patch.object(self.index,'cleanup',side_effect=AssertionError('Query triggered full index cleanup')):
            result=self.queries.page(PARAMS)
        self.assertEqual([r['id'] for r in result['events']],['one'])

    def test_busy_index_returns_retryable_page_then_reads_without_losing_records(self):
        self.write([event('one'), event('two'), event('three')])
        with TestClient(create_app(self.conf, start_indexer=False)) as client:
            with self.index.connect() as writer:
                writer.execute('BEGIN IMMEDIATE')
                before = time.monotonic()
                response = client.get('/openbexi_timeline/sessions', params=PARAMS)
                self.assertEqual(response.status_code, 200)
                self.assertLess(time.monotonic()-before, 2)
                metadata = response.json()['timelineMatch']
                self.assertEqual(metadata['reason'], 'index_busy')
                self.assertFalse(metadata['complete'])
                self.assertEqual(metadata['retryAfterMs'], 500)
                self.assertTrue(metadata['nextCursor'].startswith('pending:'))
                self.assertEqual(response.json()['events'], [])
                self.assertNotIn('etag', response.headers)
                self.assertEqual(response.headers['cache-control'], 'no-store')
                pending = {**PARAMS, 'cursor':metadata['nextCursor']}
                retry = client.get('/openbexi_timeline/sessions', params=pending).json()
                self.assertEqual(retry['timelineMatch']['nextCursor'], pending['cursor'])
            result = client.get('/openbexi_timeline/sessions', params=pending).json()
            records = result['events']
            while result['timelineMatch']['nextCursor']:
                result = client.get('/openbexi_timeline/sessions', params={**PARAMS, 'cursor':result['timelineMatch']['nextCursor']}).json()
                records.extend(result['events'])
            self.assertEqual([r['id'] for r in records], ['one','two','three'])
            changed = client.get('/openbexi_timeline/sessions', params={**pending,'search':'other'}).json()
            self.assertIn('expired or unavailable', changed['timelineMatch']['error'])

    def test_busy_existing_cursor_does_not_advance_and_remains_replayable(self):
        self.write([event('one'), event('two'), event('three')])
        first = self.queries.page(PARAMS)
        params = {**PARAMS, 'cursor':first['timelineMatch']['nextCursor']}
        with self.index.connect() as writer:
            writer.execute('BEGIN IMMEDIATE')
            waiting = self.queries.page(params)
            self.assertEqual(waiting['timelineMatch']['nextCursor'], params['cursor'])
            self.assertEqual(waiting['events'], [])
        resumed = self.queries.page(params)
        replayed = self.queries.page(params)
        self.assertEqual([r['id'] for r in resumed['events']], ['three'])
        self.assertEqual(resumed['events'], replayed['events'])
        self.assertEqual(replayed['timelineMatch']['cache'], 'replay')

    def test_non_busy_database_errors_stay_errors_and_logs_exclude_payloads(self):
        import sqlite3
        from unittest.mock import patch
        self.write([event('one')])
        error = sqlite3.OperationalError('PRIVATE SQL AND RECORD PAYLOAD')
        error.sqlite_errorcode = sqlite3.SQLITE_ERROR
        error.sqlite_errorname = 'SQLITE_ERROR'
        with TestClient(create_app(self.conf,start_indexer=False)) as client, \
                patch.object(Queries,'_page',side_effect=error), self.assertLogs('openbexi.timeline','ERROR') as logs:
            response=client.get('/openbexi_timeline/sessions',params=PARAMS)
        self.assertEqual(response.status_code,500)
        self.assertIn('sqlite_error=SQLITE_ERROR','\n'.join(logs.output))
        self.assertIn(response.headers['x-request-id'],'\n'.join(logs.output))
        self.assertNotIn('PRIVATE SQL','\n'.join(logs.output)+response.text)

    def test_cleanup_yields_to_queries_and_retains_current_and_pinned_versions(self):
        from unittest.mock import patch
        self.write([event('old-one'),event('old-two'),event('old-three')])
        first=self.queries.page(PARAMS)
        self.write([event('current')])
        with self.index.connect() as db:
            db.execute('UPDATE records SET created=?',(time.time()-1000,))
            db.executemany('INSERT INTO records(file_key,version,start,end,payload,created) VALUES(?,?,?,?,?,?)',
                          [('retired','obsolete',0,0,'{}',time.time()-1000) for _ in range(9)])
            self.index.put(db,'last_cleanup',0)
        observed=[]
        def between_batches(_):
            reply=self.queries.page(PARAMS)
            self.assertNotEqual(reply['timelineMatch'].get('reason'),'index_busy')
            self.assertEqual([r['id'] for r in reply['events']],['current'])
            observed.append(True)
        with patch.object(self.index,'CLEANUP_BATCH_SIZE',2), patch.object(self.index,'CLEANUP_SECONDS',5), \
                patch('openbexi_timeline_server.index.time.sleep',side_effect=between_batches):
            self.index.cleanup()
        self.assertTrue(observed)
        with self.index.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM records WHERE file_key='retired'").fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM records').fetchone()[0],4)
        old=self.queries.page({**PARAMS,'cursor':first['timelineMatch']['nextCursor']})
        self.assertEqual([r['id'] for r in old['events']],['old-three'])

    def test_checkpoint_only_publication_keeps_indexed_records_and_revision(self):
        from unittest.mock import patch
        snapshot = self.source/'.timeline-collector/publication.json'
        value = {'version': 1, 'generation': 'one', 'events': [event('one')], 'sources': {'input': {'checkpoint': 1}}}
        atomic_json(snapshot, value)
        self.index.refresh()
        before = self.index.status()['revision']
        with self.index.connect() as db:
            rows = [tuple(row) for row in db.execute('SELECT id,version,payload FROM records')]
        value.update(generation='two', sources={'input': {'checkpoint': 2}})
        atomic_json(snapshot, value)
        with patch('openbexi_timeline_server.index.event_stream', side_effect=AssertionError('checkpoint-only reindex')):
            self.index.refresh()
        self.assertEqual(self.index.status()['revision'], before)
        with self.index.connect() as db:
            self.assertEqual([tuple(row) for row in db.execute('SELECT id,version,payload FROM records')], rows)
        value['events'][0]['data']['title'] = 'updated session'
        atomic_json(snapshot, value)
        self.index.refresh()
        self.assertNotEqual(self.index.status()['revision'], before)
        self.assertEqual(self.scan()[0][0]['data']['title'], 'updated session')

    def test_partition_inventory_and_checkpoint_updates_do_not_decode_unchanged_parts(self):
        import hashlib
        from unittest.mock import patch
        from openbexi_timeline_server.publication import inventories
        self.conf.verify_seconds = 3600
        raw = json.dumps({'version': 1, 'events': [event('one')]}).encode()
        sha = hashlib.sha256(raw).hexdigest()
        part = self.source/'.timeline-collector/parts'/(sha+'.json')
        part.parent.mkdir(parents=True); part.write_bytes(raw)
        value = {'version': 2, 'generation': 'one', 'record_count': 1,
                 'event_parts': [{'path': 'parts/'+sha+'.json', 'sha256': sha, 'bytes': len(raw), 'records': 1}]}
        snapshot = self.source/'.timeline-collector/publication.json'
        atomic_json(snapshot, value)
        with patch('openbexi_timeline_server.publication.part_payloads', side_effect=AssertionError('inventory read event parts')):
            self.assertIsNotNone(inventories(self.source)[0])
        self.index.refresh()
        before = self.index.status()['revision']
        value['generation'] = 'checkpoint-two'
        value['event_parts'][0]['ids'] = ['one']
        atomic_json(snapshot, value)
        with patch('openbexi_timeline_server.index.part_payloads', side_effect=AssertionError('unchanged parts reread')):
            self.index.refresh()
        self.assertEqual(self.index.status()['revision'], before)
        # Periodic integrity audits still validate immutable parts.
        self.conf.verify_seconds = 0
        part.write_bytes(raw.replace(b'one', b'bad'))
        self.index.refresh()
        self.assertIn('source_read_failed', [w['code'] for w in self.scan()[1]['warningDetails']])

    def test_partitioned_publication_is_indexed_and_descriptors_remain_complete(self):
        import hashlib
        from openbexi_timeline_server.publication import descriptor
        self.conf.settle_seconds = 3600
        parts = []
        for identity in ('one', 'two'):
            raw = json.dumps({'version': 1, 'events': [event(identity)]}).encode()
            digest = hashlib.sha256(raw).hexdigest()
            path = self.source/'.timeline-collector/parts'/(digest+'.json')
            path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)
            parts.append({'path': 'parts/'+digest+'.json', 'sha256': digest, 'bytes': len(raw), 'records': 1})
        atomic_json(self.source/'.timeline-collector/publication.json',
                    {'version': 2, 'generation': 'partitioned', 'record_count': 2, 'event_parts': parts})
        self.index.refresh()
        records, metadata = self.scan()
        self.assertEqual({r['id'] for r in records}, {'one', 'two'})
        self.assertTrue(metadata['complete'], metadata)
        self.assertEqual(descriptor(self.source, 'two'), event('two'))

    def test_atomic_collector_generation_can_change_while_previous_is_indexed(self):
        from unittest.mock import patch
        self.conf.settle_seconds = 3600
        snapshot=self.source/'.timeline-collector/publication.json'
        atomic_json(snapshot,{'version':1,'generation':'one','events':[event('one')]})
        def replacing(reader, limit):
            for value in event_stream(reader,limit):
                # This replacement must work while the old generation is being
                # parsed, including on Windows. Both generations are complete.
                atomic_json(snapshot,{'version':1,'generation':'two','events':[event('two')]})
                yield value
        with patch('openbexi_timeline_server.index.event_stream',replacing):
            self.index.refresh()
        records,metadata=self.scan()
        self.assertEqual([r['id'] for r in records],['one'])
        self.assertTrue(metadata['complete'])
        self.index.refresh()
        self.assertEqual([r['id'] for r in self.scan()[0]],['two'])

    def test_ordinary_source_still_waits_for_quiet_period(self):
        import os
        self.conf.settle_seconds = 3600
        self.write([event('transferring')])
        records, metadata = self.scan()
        self.assertEqual(records, [])
        self.assertFalse(metadata['complete'])
        self.assertIn('source_changing', [w['code'] for w in metadata['warningDetails']])
        settled = time.time() - 3601
        os.utime(self.file, (settled, settled))
        self.index.refresh()
        records, metadata = self.scan()
        self.assertEqual([r['id'] for r in records], ['transferring'])
        self.assertTrue(metadata['complete'])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "data"
        self.source.mkdir()
        self.file = self.source / "2026/09/12/events.json"
        self.conf = Configuration(self.root, self.root / "state", [Source(1, "operations", str(self.source / "yyyy/mm/dd"), self.source)], page_size=2)
        self.index = TimelineIndex(self.conf)
        self.queries = Queries(self.index)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, events, path=None):
        atomic_json(path or self.file, {"events": events})
        self.index.refresh()

    def scan(self, params=None):
        working, events = {**PARAMS, **(params or {})}, []
        for _ in range(100):
            body = self.queries.page(working)
            events.extend(body["events"])
            cursor = body["timelineMatch"].get("nextCursor")
            if not cursor:
                return events, body["timelineMatch"]
            working["cursor"] = cursor
        self.fail("Unbounded pagination")

    def test_index_skips_nonoverlap_and_keeps_long_sessions(self):
        self.write([event("long", start="2025-01-01T00:00:00Z", end="2027-01-01T00:00:00Z", activities=[event("child"), event("outside", start="2028-01-01T00:00:00Z")]),
                    event("point"), event("outside", start="2028-01-01T00:00:00Z")])
        records, meta = self.scan({"search": "child", "searchMode": "text"})
        self.assertEqual(["long", "point"], [r["id"] for r in records])
        self.assertEqual(["child"], [r["id"] for r in records[0]["activities"]])
        self.assertFalse(records[0]["searchMatch"])
        self.assertTrue(records[0]["activities"][0]["searchMatch"])
        self.assertEqual((1, 2), (meta["uniqueSessions"], meta["uniqueEvents"]))
        self.assertEqual(2, meta["recordsExamined"])
        self.assertTrue(meta["complete"])

    def test_collector_commit_hides_staged_exports_and_keeps_legacy_data(self):
        self.write([event('legacy')])
        snapshot=self.source/'.timeline-collector/publication.json'
        pending=self.source/'.timeline-collector/pending.json'
        export=self.file.parent/'timeline_0123456789ab_report.json'
        atomic_json(pending,{'generation':'next','files':[]})
        atomic_json(export,{'events':[event('staged')]})
        atomic_json(self.file.parent/'operations_0_1_2026-09-12T12Z.json',{'events':[event('hourly-staged')]})
        self.index.refresh()
        self.assertEqual([record['id'] for record in self.scan()[0]],['legacy'])
        atomic_json(snapshot,{'version':1,'generation':'committed','events':[event('legacy'),event('published')],
                              'baseline_reports':['2026/09/12/events.json']})
        self.index.refresh()
        self.assertEqual({record['id'] for record in self.scan()[0]},{'legacy','published'})
        self.assertTrue(self.scan()[1]['complete'])
        # Independent user-created files remain visible after adoption.
        self.write([event('manual')],self.file.parent/'manual.json')
        self.assertEqual({record['id'] for record in self.scan()[0]},{'legacy','published','manual'})

    def test_hourly_exports_read_without_collector_state(self):
        self.write([event('hourly')],self.file.parent/'operations_0_1_2026-09-12T12Z.json')
        self.assertEqual([record['id'] for record in self.scan()[0]],['hourly'])

    def test_collector_descriptor_reads_committed_parent_and_child(self):
        snapshot=self.source/'.timeline-collector/publication.json'
        record=event('session',end='2026-09-12T13:00:00Z',activities=[event('child')])
        atomic_json(snapshot,{'version':1,'generation':'one','events':[record]})
        for identity in ('session','child'):
            body,status=Storage(self.index).descriptor({'event_id':identity,'start':event(identity)['start']})
            self.assertEqual(status,200)
            self.assertEqual(body['event_descriptor'][0]['id'],identity)

    def test_cursor_replay_restart_snapshot_and_identity(self):
        self.write([event(str(i)) for i in range(6)])
        first = self.queries.page(PARAMS)
        cursor = first["timelineMatch"]["nextCursor"]
        self.write([event("replacement")])
        # A new worker uses the same persisted cursor and original file version.
        restarted = Queries(TimelineIndex(self.conf))
        params = {**PARAMS, "cursor": cursor, "traceLevel": "ERROR", "loadId": "new"}
        second = restarted.page(params)
        replay = self.queries.page(params)
        self.assertEqual(second["events"], replay["events"])
        self.assertEqual("replay", replay["timelineMatch"]["cache"])
        self.assertEqual(["2", "3"], [r["id"] for r in second["events"]])
        self.assertIn("expired or unavailable", restarted.page({**params, "filter": "different"})["timelineMatch"]["error"])
        last = restarted.page({**params, "cursor": second["timelineMatch"]["nextCursor"]})
        self.assertEqual(["4", "5"], [r["id"] for r in last["events"]])
        self.assertTrue(last["timelineMatch"]["complete"])
        self.assertEqual("replacement", self.scan()[0][0]["id"])

    def test_concurrent_same_cursor_is_replayed(self):
        self.write([event(str(i)) for i in range(6)])
        cursor = self.queries.page(PARAMS)["timelineMatch"]["nextCursor"]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            replies = list(pool.map(lambda _: Queries(TimelineIndex(self.conf)).page({**PARAMS, "cursor": cursor}), range(4)))
        self.assertTrue(all(r["events"] == replies[0]["events"] for r in replies))
        self.assertEqual(3, sum(r["timelineMatch"]["cache"] == "replay" for r in replies))

    def test_expiry_and_cancel_are_bounded(self):
        self.write([event(str(i)) for i in range(4)])
        cursor = self.queries.page(PARAMS)["timelineMatch"]["nextCursor"]
        self.assertTrue(self.queries.page({**PARAMS, "cursor": cursor, "cancel": "1"})["timelineMatch"]["cancelled"])
        self.assertIn("error", self.queries.page({**PARAMS, "cursor": cursor})["timelineMatch"])
        cursor = self.queries.page(PARAMS)["timelineMatch"]["nextCursor"]
        with self.index.connect() as db:
            db.execute("UPDATE cursors SET touched=0")
        self.assertIn("error", self.queries.page({**PARAMS, "cursor": cursor})["timelineMatch"])

    def test_initial_index_wait_and_empty_completion(self):
        first = self.queries.page(PARAMS)["timelineMatch"]
        self.assertEqual(500, first["retryAfterMs"])
        self.assertFalse(first["complete"])
        self.write([event("new")])
        next_page = self.queries.page({**PARAMS, "cursor": first["nextCursor"]})
        self.assertEqual("new", next_page["events"][0]["id"])
        self.assertTrue(next_page["timelineMatch"]["complete"])
        self.file.unlink()
        self.index.refresh()
        records, meta = self.scan()
        self.assertEqual([], records)
        self.assertIsNone(meta["nextCursor"])
        self.assertTrue(meta["complete"])

    def test_invalid_and_partial_files_never_claim_complete(self):
        self.write([event("valid"), event("invalid", start="bad"), event("null", end=None, data="text")])
        records, meta = self.scan()
        self.assertEqual(2, len(records))
        self.assertFalse(meta["complete"])
        self.assertTrue(meta["warnings"])
        self.file.write_text('{"events":[' + json.dumps(event("prefix")) + ',{"broken":', encoding="utf-8")
        self.index.refresh()
        records, meta = self.scan()
        self.assertEqual("prefix", records[0]["id"])
        self.assertFalse(meta["complete"])

    def test_legacy_control_characters_retry_without_duplicate_prefix_records(self):
        description = 'quote " and backslash \\ with newline\ncontrol\x01'
        raw = json.dumps({"events": [event("prefix"), event("legacy", data={"description": description})]})
        raw = raw.replace("\\n", "\n").replace("\\u0001", "\x01").encode("utf-8")

        class SmallChunks(io.BytesIO):
            def read(self, n=-1):
                return super().read(min(3, n) if n >= 0 else 3)

        records = list(event_stream(BoundedReader(SmallChunks(raw), len(raw)), 2 * 1024 * 1024))
        self.assertEqual(["prefix", "legacy"], [r["id"] for r in records])
        self.assertEqual(description, records[1]["data"]["description"])
        self.file.parent.mkdir(parents=True, exist_ok=True)
        self.file.write_bytes(raw)
        self.index.refresh()
        indexed, meta = self.scan()
        self.assertEqual(["prefix", "legacy"], [r["id"] for r in indexed])
        self.assertTrue(meta["complete"])
        self.assertEqual(2, len({r["sourceRecordKey"] for r in indexed}))
        with self.assertRaises(ValueError):
            list(event_stream(BoundedReader(SmallChunks(raw), len(raw) - 1), 2 * 1024 * 1024))

    def test_update_content_with_preserved_stamp_is_verified(self):
        import os
        self.write([event("one")])
        stamp = self.file.stat()
        self.file.write_text(self.file.read_text().replace("one", "two"))
        os.utime(self.file, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        self.conf.verify_seconds = 0
        self.index.refresh()
        self.assertEqual("two", self.scan()[0][0]["id"])

    def test_saved_filters_roundtrip_and_safe_descriptors(self):
        storage = Storage(self.index)
        params = {"userName": "test", "timelineName": "report", "filterName": "active", "filter": "expr: status = STARTED", "sortBy": "status", "ob_request": "saveFilter"}
        saved = storage.filters(params)
        self.assertEqual("active", saved["openbexi_timeline"][0]["filters"][0]["name"])
        self.assertEqual(params["filter"], storage.resolve({"userName": "test", "timelineName": "report"})["filter"])
        for bad in ("../escape", "x/y", "a:b"):
            with self.assertRaises(ValueError):
                storage.filters({"userName": bad})
        descriptor = self.file.parent / "descriptors/e.json"
        atomic_json(descriptor, {"event_descriptor": [{"id": "e", "namespace": "operations", "data": {"text": "details"}}, {"id": "other"}]})
        body, code = storage.descriptor({"event_id": "e", "start": event("e")["start"], "namespace": "operations"})
        self.assertEqual(200, code)
        self.assertEqual(1, len(body["event_descriptor"]))
        with self.assertRaises(ValueError):
            storage.descriptor({"event_id": "../e", "start": event("e")["start"]})

    def test_workspace_filters_are_isolated_and_only_matching_legacy_profiles_are_reused(self):
        metadata = self.root / 'HBDS'
        first = Configuration(self.root, self.root / 'first-state', self.conf.sources,
                              hbds_root=metadata, workspace_path=metadata / 'First_Workspace.json')
        second = Configuration(self.root, self.root / 'second-state',
                               [Source(1, 'volcano', str(self.source), self.source)],
                               hbds_root=metadata, workspace_path=metadata / 'Second_Workspace.json')
        one, two = Storage(TimelineIndex(first)), Storage(TimelineIndex(second))
        legacy = metadata / 'filters/arcazj_report_filter_setting.json'
        original = {'namespace': '0', 'openbexi_timeline': [{'name': 'old_name', 'user': 'old_user',
                    'sources': [{'namespace': 'operations'}], 'filters': [
                        {'name': 'Commands', 'filter_value': 'system:CMD', 'current': 'yes', 'sortBy': 'NONE'}]}]}
        atomic_json(legacy, original)
        atomic_json(legacy.parent / 'default_filter_setting.json', original)
        before = legacy.read_bytes()
        params = {'userName': 'arcazj', 'timelineName': 'report', 'scene': '0'}
        self.assertEqual('system:CMD', one.resolve(params)['filter'])
        self.assertNotIn('filter', two.resolve(params))
        loaded = two.filters(params)['openbexi_timeline'][0]
        self.assertEqual('ALL', loaded['filters'][0]['name'])
        self.assertEqual(('by_namespace', '', 'namespace', 'no'), tuple(loaded['filters'][1][key] for key in ('name','filter_value','sortBy','current')))
        self.assertEqual('report', loaded['name'])
        saved = {**params, 'ob_request': 'saveFilter', 'filterName': 'Volcano notices',
                 'filter': 'expr: type = volcano', 'sortBy': 'namespace'}
        two.filters(saved)
        self.assertEqual(saved['filter'], two.resolve(params)['filter'])
        self.assertEqual('system:CMD', one.resolve(params)['filter'])
        self.assertEqual(before, legacy.read_bytes())
        self.assertTrue((metadata / 'filters/workspaces/Second_Workspace/arcazj_report_filter_setting.json').is_file())
        restored = one.filters(params)['openbexi_timeline'][0]
        self.assertEqual(('report', 'arcazj'), (restored['name'], restored['user']))
        one.filters({**saved, 'filterName': 'Commands', 'filter': 'system:CMD'})
        self.assertEqual(saved['filter'], two.resolve(params)['filter'])
        self.assertEqual(before, legacy.read_bytes())
        self.assertEqual('', two.resolve({**params, 'filter': ''})['filter'])

    def test_root_opens_yaml_model_timeline_and_keeps_demo_route(self):
        (self.root / "demos.html").write_text("<html>Demo gallery</html>")
        (self.root / "openbexi_timeline.html").write_text("<html>Configured timeline</html>")
        (self.root / "models").mkdir()
        (self.root / "models/operations.json").write_text('{"params": [{"title": "Operations"}]}')
        config = self.root / "sources.yml"
        config.write_text("model: models/operations.json\ndata_sources: []\n")
        for prefix in ("", "/timeline"):
            with self.subTest(prefix=prefix):
                conf = load_configuration(config, root=self.root, state=self.root / "entry-index", context_path=prefix)
                with TestClient(create_app(conf, start_indexer=False)) as client:
                    self.assertEqual("<html>Configured timeline</html>", client.get(prefix + "/").text)
                    self.assertEqual("<html>Demo gallery</html>", client.get(prefix + "/demos.html").text)
                    startup = client.get(prefix + "/openbexi_timeline/config").json()
                    self.assertEqual("models/operations.json", startup["model"])
                    self.assertEqual("Operations", client.get(prefix + "/" + startup["model"]).json()["params"][0]["title"])
        conf.model = None
        with TestClient(create_app(conf, start_indexer=False)) as client:
            self.assertEqual("<html>Demo gallery</html>", client.get(prefix + "/").text)

    def test_descriptor_accepts_legacy_json_without_changing_string_contents(self):
        descriptor = self.file.parent / "descriptors/legacy.json"
        descriptor.parent.mkdir(parents=True)
        descriptor.write_text('{"event_descriptor":[{"id":"legacy","data":{"namespace":"operations","text":"line one\nline two,] and ,}" "description":"legacy",},},],}', encoding="utf-8", newline="")
        params = {"event_id": "legacy", "start": event("legacy")["start"], "namespace": "operations"}
        body, code = Storage(self.index).descriptor(params)
        self.assertEqual(200, code)
        self.assertEqual("line one\nline two,] and ,}", body["event_descriptor"][0]["text"])
        self.assertEqual("legacy", body["event_descriptor"][0]["description"])
        self.assertEqual(404, Storage(self.index).descriptor({**params, "namespace": "other"})[1])
        descriptor.write_text('{"event_descriptor":[{"id":"legacy","data":', encoding="utf-8")
        with self.assertRaises(OSError):
            Storage(self.index).descriptor(params)

    def test_http_assets_errors_cache_trace_and_version(self):
        self.write([event("one")])
        (self.root / "demos.html").write_text("<html>Timeline</html>")
        (self.root / "secret.yml").write_text("secret")
        with TestClient(create_app(self.conf, start_indexer=False)) as client:
            self.assertEqual(200, client.get("/").status_code)
            self.assertEqual(404, client.get("/secret.yml").status_code)
            self.assertEqual(404, client.get("/state/timeline.sqlite3").status_code)
            self.assertEqual("2.9.5", client.get("/openbexi_timeline/config").json()["server"]["version"])
            self.assertEqual(400, client.get("/openbexi_timeline/sessions", params={**PARAMS, "startDate": "bad"}).status_code)
            response = client.get("/openbexi_timeline/sessions", params=PARAMS)
            self.assertEqual(200, response.status_code)
            self.assertEqual("Python/2.9.5", response.headers["x-timeline-server"])
            self.assertEqual(304, client.get("/openbexi_timeline/sessions", params=PARAMS, headers={"If-None-Match": response.headers["etag"]}).status_code)
            self.assertEqual(503, client.get("/api/v1/models").status_code)
            self.assertEqual(200, client.get("/openbexi_timeline_sse/sessions", params=PARAMS).status_code)
            with self.assertLogs("openbexi.timeline", level="INFO") as logs:
                client.get("/openbexi_timeline/sessions", params={**PARAMS, "userName": "secret-user", "search": "secret-query"})
            self.assertNotIn("secret-", "".join(logs.output))
            self.assertIn("method=GET", "".join(logs.output))
            with self.assertLogs("openbexi.timeline", level="INFO") as logs:
                response = client.post("/openbexi_timeline/sessions", params={
                    "ob_request": "readFilters", "userName": "secret-user", "timelineName": "secret-timeline"})
            self.assertEqual(200, response.status_code)
            self.assertIn("method=POST", "".join(logs.output))
            self.assertIn("operation=readFilters", "".join(logs.output))
            self.assertNotIn("secret-", "".join(logs.output))
            with self.assertNoLogs("openbexi.timeline", level="INFO"):
                client.get("/openbexi_timeline/sessions", params={**PARAMS, "traceLevel": "ERROR"})

    def test_template_and_configuration_validation(self):
        template = load_configuration(REPO / "HBDS/templates/yaml/source_template.yml", root=self.root)
        self.assertGreater(len(template.sources), 1)
        path = self.root / "config.yml"
        path.write_text('data_sources:\n  - type: json_file\n    namespace: demo\n    data_model: [data/yyyy/mm/dd, data/archive]\n    filter:\n      include: ["*.json"]\n  - enable: false\n    data_model: ${ABSENT_DISABLED_VARIABLE}\n', encoding="utf-8")
        self.assertEqual(2, len(load_configuration(path, root=self.root).sources))
        for invalid in ('data_sources: []\ndata_sources: []', 'data_sources: []\ntimeline_server:\n  poll_seconds: .nan', 'data_sources: [{enable: 1}]'):
            path.write_text(invalid)
            with self.assertRaises(ValueError):
                load_configuration(path, root=self.root)

    def test_materialized_collector_outputs_do_not_reapply_input_globs(self):
        path = self.root / "sources.yml"
        path.write_text('data_sources:\n - type: local\n   data_model: data/yyyy/mm/dd\n   filter: {include: ["*.csv"], exclude: "*.tmp"}\n', encoding="utf-8")
        conf = load_configuration(path, root=self.root, state=self.root / "collector-index")
        self.assertEqual("", conf.sources[0].include)
        self.assertEqual("", conf.sources[0].exclude)

    def test_dead_indexer_lease_is_recovered(self):
        with self.index.connect() as db:
            self.index.put(db, "lease", {"owner": "crashed", "pid": 99999999, "until": time.time()+120})
        self.write([event("recovered")])
        self.assertFalse(self.index.status()["indexing"])
        self.assertEqual("recovered", self.scan()[0][0]["id"])

    def test_java_bridge_preserves_authentication_body_and_status(self):
        import httpx
        class Body(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b'{"error":"Access denied"}'
        self.conf.java_url = "http://java.example:8080"
        async def upstream(request):
            self.assertEqual("http://java.example:8080/api/v1/models/demo?revision=2", str(request.url))
            self.assertEqual("Bearer test-token", request.headers["authorization"])
            self.assertEqual(b'{"title":"New"}', await request.aread())
            return httpx.Response(403, stream=Body(), headers={"Content-Type": "application/json", "Set-Cookie": "session=test; HttpOnly"})
        application = create_app(self.conf, start_indexer=False)
        with TestClient(application) as client:
            # The test owns this replacement client; close it in the app's event loop.
            async def replace_client():
                await application.state.java.aclose()
                application.state.java = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
            client.portal.call(replace_client)
            response = client.put('/api/v1/models/demo?revision=2', content=b'{"title":"New"}', headers={"Authorization":"Bearer test-token"})
            self.assertEqual(403, response.status_code)
            self.assertEqual("Access denied", response.json()["error"])
            self.assertIn("HttpOnly", response.headers["set-cookie"])
            client.portal.call(application.state.java.aclose)

    def test_event_creation_escapes_json_and_indexes_the_result(self):
        storage = Storage(self.index)
        storage.add_event({"startEvent": event("x")["start"], "endEvent": "2026-09-12T13:00:00Z", "title": 'Quoted "event"', "description": "a\nb"})
        records, meta = self.scan()
        self.assertEqual('Quoted "event"', records[0]["data"]["title"])
        self.assertEqual("operations", records[0]["data"]["namespace"])
        self.assertTrue(meta["complete"])

    def test_history_pages_equal_timestamps_without_skips_or_duplicates(self):
        self.write([event(str(i), data={"title": "match" if i % 3 == 0 else "other"}) for i in range(33)])
        # The historical domain includes records older than the visible window.
        records, meta = self.scan({"startDate": "2026-09-12T13:00:00Z", "history": "backward", "search": "match", "searchMode": "text"})
        self.assertEqual([str(i) for i in reversed(range(33)) if i % 3 == 0], [r["id"] for r in records])
        self.assertEqual(11, len({r["sourceRecordKey"] for r in records}))
        self.assertTrue(meta["complete"])
        self.assertTrue(meta["history"]["exhausted"])

    def test_history_finds_recent_records_after_incremental_ingestion(self):
        self.conf.page_size = 1
        self.write([event("older", start="2026-09-10T12:00:00Z")])
        self.write([event("latest", start="2026-09-12T12:00:00Z")], self.source / "latest.json")
        body = self.queries.page({**PARAMS, "history": "backward"})
        self.assertEqual("latest", body["events"][0]["id"])
        cursor = body["timelineMatch"]["nextCursor"]
        body = self.queries.page({**PARAMS, "history": "backward", "cursor": cursor})
        self.assertEqual("older", body["events"][0]["id"])
        self.assertTrue(body["timelineMatch"]["complete"])

    def test_descriptor_failure_shapes_and_finite_totals(self):
        self.write([event(str(i)) for i in range(5)])
        path = self.file.parent / "descriptors/bad.json"
        path.parent.mkdir();path.write_text('{"broken":')
        with TestClient(create_app(self.conf, start_indexer=False)) as client:
            response = client.post('/openbexi_timeline/sessions', params={"ob_request":"readDescriptor", "event_id":"bad", "start":event('x')['start']})
            self.assertEqual(500, response.status_code)
            self.assertEqual([], response.json()['event_descriptor'])
            response = client.get('/openbexi_timeline/sessions', params={**PARAMS, 'progressive':'0'})
            self.assertEqual(5, response.json()['timelineMatch']['recordsReturned'])
            response = client.get('/openbexi_timeline/sessions', params={**PARAMS, 'search':'['})
            self.assertEqual(200, response.status_code)
            self.assertIn('error', response.json()['timelineMatch'])


if __name__ == "__main__":
    unittest.main()
