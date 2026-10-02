import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const catalog = JSON.parse(await fs.readFile(new URL('../demos/catalog.json', import.meta.url), 'utf8'));

async function fixture(id) {
    const harness = await createTimelineHarness();
    const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
    const helpers = await harness.importModule('src/openbexi_timeline_share.js');
    const demo = catalog.demos.find(entry => entry.id === id);
    const timeline = new OB_TIMELINE();
    await timeline.loadModel(demo.model, {dataset: demo.dataset});
    timeline.demoContext = {id, catalog, selectedDemo: demo};
    return {harness, timeline, ...helpers};
}

test('Share links round-trip numeric Ma time, view, search and overview without moving the reset reference', async () => {
    const {harness, timeline, buildTimelineShareURL, applyTimelineShareState} = await fixture('dinausaurs');
    try {
        const originalDate = timeline.params[0].date;
        const targetTime = new Date(-130 * timeline.staticTimeAxis.millisecondsPerUnit).toISOString();
        const query = new URLSearchParams({view: 'split', time: targetTime, search: 'Tyrannosaurus', overview: '0', results: 'only'});
        applyTimelineShareState(timeline, query);
        assert.equal(timeline.ob_scene.sync_time, Date.parse(targetTime));
        assert.equal(timeline.formatEventDate(timeline.ob_markerDate), '130 Ma');
        assert.equal(timeline.params[0].date, originalDate, 'Reset still returns to the model reference time');
        assert.equal(timeline.ob_views.mode, 'split');
        assert.equal(timeline.ob_scene[0].ob_search_value, 'Tyrannosaurus');
        assert.equal(timeline.ob_search_input.value, 'Tyrannosaurus');
        assert.ok(timeline.ob_scene[0].sessions.events.some(event => /Tyrannosaurus/i.test(event.data.title)));
        assert.ok(timeline.ob_scene[0].sessions.events.filter(event => !event.zone).length < timeline.staticData.events.length);
        assert.ok(timeline.ob_scene[0].bands.every(band => !band.name.includes('overview_')));
        const url = new URL(buildTimelineShareURL(timeline, {baseURL: 'https://example.org/timeline/demos.html'}));
        assert.equal(url.searchParams.get('time'), targetTime);
        assert.equal(url.searchParams.get('view'), 'split');
        assert.equal(url.searchParams.get('search'), 'Tyrannosaurus');
        assert.equal(url.searchParams.get('overview'), '0');
        assert.equal(url.searchParams.get('demo'), 'dinausaurs');
        applyTimelineShareState(timeline, new URLSearchParams({view: 'timeline', overview: '1', search: ''}));
        applyTimelineShareState(timeline, url.searchParams);
        assert.equal(timeline.formatEventDate(timeline.ob_markerDate), '130 Ma');
        assert.equal(timeline.ob_views.mode, 'split');
        assert.equal(timeline.ob_visible_view, false);
    } finally { harness.close(); }
});

test('Shared historical calendar dates retain their instant and model display offset', async () => {
    const {harness, timeline, buildTimelineShareURL, applyTimelineShareState} = await fixture('jfk');
    try {
        const instant = '1963-11-22T19:00:00.000Z';
        applyTimelineShareState(timeline, new URLSearchParams({time: instant, view: 'table'}));
        assert.equal(timeline.formatEventDate(timeline.ob_markerDate), '1963-11-22 13:00');
        assert.equal(new URL(buildTimelineShareURL(timeline)).searchParams.get('time'), instant);
        assert.equal(timeline.ob_views.mode, 'table');
    } finally { harness.close(); }
});

test('Invalid state is ignored and supplied search text remains bounded plain data', async () => {
    const {harness, timeline, applyTimelineShareState} = await fixture('monet');
    try {
        const initialTime = timeline.ob_scene.sync_time;
        const initialOverview = timeline.ob_visible_view;
        for (const time of ['invalid', '2026-02-31T12:00:00.000Z', '140', '9999999999999999999']) {
            assert.equal(applyTimelineShareState(timeline, new URLSearchParams({time, view: 'no-such-view', overview: 'yes'})), false);
        }
        assert.equal(timeline.ob_scene.sync_time, initialTime);
        assert.equal(timeline.ob_visible_view, initialOverview);
        assert.equal(timeline.ob_views.mode, 'timeline');
        applyTimelineShareState(timeline, new URLSearchParams({search: '\u0000<script>' + 'a'.repeat(600)}));
        assert.equal(timeline.ob_search_input.value.length, 500);
        assert.ok(timeline.ob_search_input.value.startsWith('<script>'));
        assert.equal(harness.window.document.querySelectorAll('script').length, 0);
    } finally { harness.close(); }
});

test('Links remove credentials, fragments and all unapproved query parameters', async () => {
    const {harness, timeline, buildTimelineShareURL} = await fixture('monet');
    try {
        const baseURL = 'https://alice:password@example.org/project/demos.html?token=secret&email=private&dataset=https://backend/private&demo=untrusted#private';
        const result = new URL(buildTimelineShareURL(timeline, {baseURL}));
        assert.equal(result.origin, 'https://example.org');
        assert.equal(result.username, '');
        assert.equal(result.password, '');
        assert.equal(result.hash, '');
        const approved = new Set(['demo', 'view', 'time', 'overview', 'search', 'searchMode', 'group', 'filter',
            'filterName', 'selected', 'results', 'highlight', 'auto', 'ratio', 'locked', 'scale', 'from', 'to', 'overviewFrom', 'overviewTo', 'table']);
        assert.ok([...result.searchParams.keys()].every(key => approved.has(key)));
        assert.doesNotMatch(result.href, /password|secret|private|backend|untrusted/);
        assert.equal(result.searchParams.get('demo'), 'monet');
        assert.equal(buildTimelineShareURL(timeline, {baseURL, demoId: 'unknown'}), 'https://example.org/project/demos.html');
        assert.throws(() => buildTimelineShareURL(timeline, {baseURL: 'javascript:alert(1)'}), /HTTP/);
        timeline.staticData = undefined;
        timeline.data = 'https://backend/private?token=secret';
        assert.equal(buildTimelineShareURL(timeline, {baseURL}), 'https://example.org/project/demos.html');
    } finally { harness.close(); }
});

test('Complete views restore exact zoom, grouping, filter, selected record and default result settings', async () => {
    const {harness, timeline, buildTimelineShareURL, applyTimelineShareState} = await fixture('monet');
    try {
        const from = '1870-01-01T00:00:00.000Z', to = '1900-01-01T00:00:00.000Z';
        applyTimelineShareState(timeline, new URLSearchParams({from, to, group:'namespace',
            filter:'expr: EXISTS(title)', filterName:'Titled records', view:'split', auto:'0', locked:'1',
            search:'', results:'highlight', highlight:'1', ratio:'8'}));
        const selected = timeline.ob_results.snapshot.entries[2].key;
        timeline.ob_results.selectActivity(selected);
        timeline.ob_views.restorePresentation({sort:{field:'start',direction:'descending'},columns:{description:true,source:false}});
        const saved = new URL(buildTimelineShareURL(timeline)).searchParams;
        assert.equal(saved.get('from'), from); assert.equal(saved.get('to'), to);
        applyTimelineShareState(timeline, new URLSearchParams({from:'1800-01-01T00:00:00.000Z', to:'1810-01-01T00:00:00.000Z',
            group:'NONE', filter:'', filterName:'', selected:'', view:'table', auto:'1', results:'only', highlight:'0', ratio:'2', locked:'0'}));
        timeline.ob_views.restorePresentation({sort:{field:'title',direction:'ascending'},columns:{description:false,source:true}});
        applyTimelineShareState(timeline, saved);
        const range = timeline.ob_results.controls.currentRange();
        assert.equal(range.from, Date.parse(from)); assert.equal(range.to, Date.parse(to));
        assert.equal(timeline.ob_sortBy, 'namespace');
        assert.equal(timeline.ob_scene[0].ob_filter_value, 'expr: EXISTS(title)');
        assert.equal(timeline.ob_scene[0].ob_filter_name, 'Titled records');
        assert.equal(timeline.ob_results.selectedKey, selected);
        assert.equal(timeline.ob_views.mode, 'split');
        assert.equal(timeline.ob_results.state.auto, false);
        assert.equal(timeline.ob_results.state.mode, 'highlight');
        assert.equal(timeline.ob_results.state.highlight, true);
        assert.equal(timeline.ob_results.state.ratio, 8);
        assert.equal(timeline.ob_results.explorer.locked, true);
        assert.equal(timeline.ob_views.tableSort.field, 'start');
        assert.equal(timeline.ob_views.tableSort.direction, 'descending');
        assert.equal(timeline.ob_views.columnVisibility.description, true);
        assert.equal(timeline.ob_views.columnVisibility.source, false);
        assert.ok(timeline.ob_scene[0].bands.filter(band => !band.name.includes('overview_')).every(band => band.groupBy === 'namespace'));
    } finally { harness.close(); }
});

test('Unusable ranges and malformed filters/search do not corrupt the active view', async () => {
    const {harness, timeline, applyTimelineShareState} = await fixture('monet');
    try {
        const range = {...timeline.ob_results.controls.currentRange()};
        for (const state of [{from:'2026-02-31T00:00:00.000Z', to:'2027-01-01T00:00:00.000Z'},
            {from:'2027-01-01T00:00:00.000Z', to:'2026-01-01T00:00:00.000Z'}, {group:'__proto__.polluted'},
            {filter:'expr: title ='}, {search:'[', searchMode:'pattern'}]) {
            assert.equal(applyTimelineShareState(timeline, new URLSearchParams(state)), false);
        }
        assert.deepEqual({...timeline.ob_results.controls.currentRange()}, range);
        assert.equal(timeline.ob_results.state.query, '');
        assert.equal(timeline.ob_scene[0].ob_filter_value, '');
    } finally { harness.close(); }
});

test('Named local views survive reopen, replace by name, isolate sources and report storage failures', async () => {
    const {harness, timeline, applyTimelineShareState} = await fixture('monet');
    try {
        const saved = await harness.importModule('src/openbexi_timeline_saved_views.js');
        applyTimelineShareState(timeline, new URLSearchParams({view:'split', search:'Monet'}));
        saved.saveTimelineView(timeline, 'Investigation');
        applyTimelineShareState(timeline, new URLSearchParams({view:'table', search:''}));
        assert.equal(saved.openTimelineSavedView(timeline, 'Investigation'), true);
        assert.equal(timeline.ob_views.mode, 'split');
        assert.equal(timeline.ob_results.state.query, 'Monet');
        saved.saveTimelineView(timeline, 'Investigation');
        assert.equal(saved.listTimelineSavedViews(timeline).length, 1);
        const source = timeline.localSource.url;
        timeline.localSource.url = 'another-dataset.json';
        assert.equal(saved.listTimelineSavedViews(timeline).length, 0);
        timeline.localSource.url = source;
        assert.equal(saved.listTimelineSavedViews(timeline).length, 1);
        saved.deleteTimelineSavedView(timeline, 'Investigation');
        assert.equal(saved.listTimelineSavedViews(timeline).length, 0);
        assert.throws(() => saved.saveTimelineView(timeline, ' '), /name/);
        const store = harness.window.localStorage;
        Object.defineProperty(harness.window, 'localStorage', {configurable:true, get() { throw new Error('Blocked'); }});
        assert.throws(() => saved.listTimelineSavedViews(timeline), /blocked local storage/);
        Object.defineProperty(harness.window, 'localStorage', {configurable:true, value:store});
        const original = harness.window.Storage.prototype.setItem;
        harness.window.Storage.prototype.setItem = () => { throw new Error('Quota exceeded'); };
        assert.throws(() => saved.saveTimelineView(timeline, 'Investigation'), /full or blocked/);
        harness.window.Storage.prototype.setItem = original;
    } finally { harness.close(); }
});

test('Connected views stay browser-local and restore through the existing data loader', async () => {
    const {harness, timeline, buildTimelineShareURL} = await fixture('monet');
    try {
        const saved = await harness.importModule('src/openbexi_timeline_saved_views.js');
        timeline.staticData = undefined;
        timeline.params[0].data = 'https://private.example/api?token=PRIVATE_TOKEN';
        timeline.ob_scene[0].ob_search_value = timeline.ob_results.state.query = 'PRIVATE_SEARCH';
        timeline.ob_scene[0].ob_filter_value = 'expr: title CONTAINS "PRIVATE_FILTER"';
        saved.saveTimelineView(timeline, 'Private investigation');
        assert.equal(buildTimelineShareURL(timeline, {baseURL:'https://example.org/timeline?private=true#token'}), 'https://example.org/timeline');
        const storage = harness.window.localStorage;
        assert.doesNotMatch(storage.key(0), /PRIVATE|private\.example/);
        const serialized = storage.getItem(storage.key(0));
        assert.doesNotMatch(serialized, /PRIVATE_TOKEN|private\.example/);
        timeline.ob_scene[0].ob_search_value = timeline.ob_results.state.query = '';
        timeline.ob_scene[0].ob_filter_value = '';
        let reloads = 0; timeline.load_data = () => { reloads++; };
        saved.openTimelineSavedView(timeline, 'Private investigation');
        assert.equal(reloads, 1);
        assert.equal(timeline.ob_results.state.query, 'PRIVATE_SEARCH');
        assert.equal(timeline.ob_scene[0].ob_filter_value, 'expr: title CONTAINS "PRIVATE_FILTER"');
        timeline.params[0].data = 'https://another.example/api';
        assert.equal(saved.listTimelineSavedViews(timeline).length, 0);
    } finally { harness.close(); }
});

test('A saved connected selection returns to its packed page when the record arrives after empty and partial responses', async () => {
    const {harness, timeline} = await fixture('monet');
    try {
        const saved = await harness.importModule('src/openbexi_timeline_saved_views.js');
        const {parseTimelineData} = await harness.importModule('src/openbexi_timeline_data.js');
        const r = timeline.ob_results;
        timeline.staticData = undefined;
        timeline.params[0].data = 'http://localhost/synthetic-saved-view';
        timeline.load_data = () => {};
        r.state.auto = false;
        const events = Array.from({length:48}, (_, index) => ({id:'record-'+index, start:'1880-01-01T00:00:00.000Z',
            end:'1885-01-01T00:00:00.000Z', data:{title:'Record '+String(index).padStart(2, '0'), priority:'critical'}, searchMatch:false}));
        const accept = async (records, revision) => {
            r.acceptRemote(parseTimelineData(JSON.stringify({events:records})), {version:1, searchMode:'text', progressive:true, query:'', hasCondition:false,
                complete:false, revision, domain:{from:'1800-01-01T00:00:00.000Z', to:'2000-01-01T00:00:00.000Z'}});
            const deadline = Date.now() + 6000;
            while (r.pending) {
                assert.ok(Date.now() < deadline, 'The asynchronous response must render');
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            assert.equal(r.error, '');
        };
        await accept(events, 'initial');
        assert.ok(timeline.ob_viewport.pages.length > 1, 'The selected record needs a later packed page');
        const selected = r.snapshot.entries.at(-1).key;
        r.selectActivity(selected);
        saved.saveTimelineView(timeline, 'Later page');
        r.selectActivity(null);
        saved.openTimelineSavedView(timeline, 'Later page');
        await accept([], 'empty-placeholder');
        assert.equal(r.selectedKey, selected);
        await accept(events.slice(0, 3), 'first-page');
        assert.notEqual(timeline.ob_viewport.anchor, selected);
        await accept(events, 'later-page');
        assert.equal(r.selectedKey, selected);
        assert.equal(timeline.ob_viewport.anchor, selected);
        assert.ok(timeline.ob_viewport.pageIndex > 0);
        assert.ok(timeline.ob_scene[0].bands.filter(band => !band.name.includes('overview_'))
            .flatMap(band => band.sessions.flatMap(session => session.activities)).some(record => record.matchKey === selected));
    } finally { harness.close(); }
});

test('Locked connected views discard the previous adaptive map, wait for full data and render cached restores', async () => {
    const {harness, timeline} = await fixture('monet');
    try {
        const saved = await harness.importModule('src/openbexi_timeline_saved_views.js');
        const {densityMap} = await harness.importModule('src/openbexi_timeline_adaptive.js');
        const {parseTimelineData} = await harness.importModule('src/openbexi_timeline_data.js');
        const events = timeline.staticData.events.filter(event => !event.zone).map(event => ({...event, searchMatch:false}));
        timeline.staticData = undefined;
        timeline.params[0].data = 'http://localhost/synthetic-saved-map';
        timeline.load_data = () => {};
        const r = timeline.ob_results;
        const settle = async () => {
            const deadline = Date.now() + 6000;
            while (r.pending) {
                assert.ok(Date.now() < deadline, 'The restored presentation must finish rendering');
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            assert.equal(r.error, '');
        };
        const accept = async (records, complete, revision) => {
            r.acceptRemote(parseTimelineData(JSON.stringify({events:records})), {version:1, searchMode:'text', progressive:true,
                query:'', hasCondition:false, complete, revision, domain:{from:'1800-01-01T00:00:00.000Z', to:'2000-01-01T00:00:00.000Z'}});
            await settle();
        };
        await accept(events, true, 'initial');
        r.state.auto = true; r.state.ratio = 2; r.explorer.locked = true;
        timeline.ob_scene[0].ob_filter_value = 'expr: EXISTS(title)';
        saved.saveTimelineView(timeline, 'Locked map');
        const expected = r.controls.currentRange();
        r.state.ratio = 16;
        r.map = densityMap(events, r.domain, 16);
        timeline.ob_scene[0].ob_filter_value = '';
        saved.openTimelineSavedView(timeline, 'Locked map');
        const linear = r.map;
        assert.equal(linear.ratio, 1, 'The previous view cannot remain pinned during restoration');
        await accept([], false, 'empty');
        await accept(events.slice(0, 3), false, 'partial');
        assert.equal(r.map, linear, 'Partial batches retain one stable linear map');
        assert.equal(r.explorer.locked, true);
        timeline.ob_viewport.descriptorOpen = true;
        await accept(events, true, 'complete');
        assert.notEqual(r.map, linear, 'Complete records rebuild the map even while locked and reading');
        assert.ok(r.map.ratio <= 2);
        assert.ok(r.map.segments.some(segment => segment.density > 0));
        assert.equal(r.explorer.locked, true);
        const range = r.controls.currentRange();
        assert.ok(Math.abs(range.from - expected.from) <= 1 && Math.abs(range.to - expected.to) <= 1);
        // Reopening an unchanged, fully cached source produces no provider response.
        r.state.ratio = 16; r.map = densityMap(events, r.domain, 16);
        saved.openTimelineSavedView(timeline, 'Locked map');
        await settle();
        assert.ok(r.map.ratio <= 2);
        assert.equal(r.explorer.locked, true);
    } finally { harness.close(); }
});

test('Static saved views restore their adaptive scale while event details are open', async () => {
    const {harness, timeline, applyTimelineShareState, buildTimelineShareURL} = await fixture('monet');
    try {
        const {densityMap} = await harness.importModule('src/openbexi_timeline_adaptive.js');
        const r = timeline.ob_results;
        const from = '1870-01-01T00:00:00.000Z', to = '1900-01-01T00:00:00.000Z';
        applyTimelineShareState(timeline, new URLSearchParams({from, to, auto:'1', ratio:'2', locked:'1'}));
        const saved = new URL(buildTimelineShareURL(timeline)).searchParams;
        r.state.ratio = 16;
        r.map = densityMap(r.projection.densityRecords, r.domain, 16);
        timeline.ob_open_descriptor(0, r.snapshot.entries[0].record);
        assert.ok(r.explorer.reading(), 'The real event-details panel protects its current map during ordinary updates');
        assert.equal(r.map.ratio, 16);
        applyTimelineShareState(timeline, saved);
        assert.equal(r.state.ratio, 2);
        assert.ok(r.map.ratio <= 2, 'Restoring explicitly must replace the old map even while details are open');
        assert.equal(r.explorer.locked, true);
        const range = r.controls.currentRange();
        assert.ok(Math.abs(range.from - Date.parse(from)) <= 1 && Math.abs(range.to - Date.parse(to)) <= 1);
        assert.ok(harness.window.document.querySelector('.ob_record_details'), 'The event details stay open');
    } finally { harness.close(); }
});

test('Public links preserve highlighting independently from matches-only visibility', async () => {
    const {harness,timeline,buildTimelineShareURL,applyTimelineShareState}=await fixture('monet');
    try {
        timeline.ob_results.state.highlight=false;
        timeline.ob_results.state.mode='only';
        const query=new URL(buildTimelineShareURL(timeline)).searchParams;
        assert.equal(query.get('highlight'),'0');assert.equal(query.get('results'),'only');
        timeline.ob_results.state.highlight=true;timeline.ob_results.state.mode='highlight';
        applyTimelineShareState(timeline,query);
        assert.equal(timeline.ob_results.highlight.checked,false);
        assert.equal(timeline.ob_results.mode.checked,true);
    } finally {harness.close();}
});

test('Diagnostics expose useful aggregate presentation state without private data or URLs', async () => {
    const {harness, timeline, getTimelineDiagnostics, applyTimelineShareState} = await fixture('dinausaurs');
    try {
        timeline.params[0].data = 'https://private.example/api?token=SECRET';
        timeline.ob_user_name = 'PRIVATE_PERSON';
        timeline.demoContext.datasetURL = 'https://PRIVATE_USER:SECRET@example.org/data?token=SECRET';
        timeline.ob_scene[0].ob_search_value = 'PRIVATE_SEARCH';
        harness.window.localStorage.setItem('credential', 'SECRET_STORAGE');
        const diagnostics = getTimelineDiagnostics(timeline);
        const serialized = JSON.stringify(diagnostics);
        assert.equal(diagnostics.version, '1.1');
        assert.equal(diagnostics.demo.id, 'dinausaurs');
        assert.equal(diagnostics.demo.model, 'models/demos/dinausaurs.json');
        assert.equal(diagnostics.reference.label, '140 Ma');
        assert.equal(diagnostics.counts.records, 224);
        assert.equal(diagnostics.searchActive, true);
        assert.equal(diagnostics.timeAxis.kind, 'numeric');
        assert.equal(diagnostics.bands[0].range.from, '165 Ma');
        assert.equal(diagnostics.bands[0].range.to, '115 Ma');
        assert.doesNotMatch(serialized, /SECRET|PRIVATE_|private\.example|Tyrannosaurus/);
        assert.doesNotThrow(() => JSON.parse(serialized));
        const before = harness.requests.length;
        getTimelineDiagnostics(timeline);
        applyTimelineShareState(timeline, new URLSearchParams({view: 'table'}));
        assert.equal(harness.requests.length, before, 'Share and diagnostics helpers do not access a network');
    } finally { harness.close(); }
});
