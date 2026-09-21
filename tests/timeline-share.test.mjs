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
        const query = new URLSearchParams({view: 'split', time: targetTime, search: 'Tyrannosaurus', overview: '0'});
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
        assert.deepEqual([...result.searchParams.keys()], ['demo', 'view', 'time', 'overview']);
        assert.equal(result.searchParams.get('demo'), 'monet');
        assert.equal(buildTimelineShareURL(timeline, {baseURL, demoId: 'unknown'}), 'https://example.org/project/demos.html');
        assert.throws(() => buildTimelineShareURL(timeline, {baseURL: 'javascript:alert(1)'}), /HTTP/);
        timeline.staticData = undefined;
        timeline.data = 'https://backend/private?token=secret';
        assert.equal(buildTimelineShareURL(timeline, {baseURL}), 'https://example.org/project/demos.html');
    } finally { harness.close(); }
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
