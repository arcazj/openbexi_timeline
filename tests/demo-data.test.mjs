import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createTimelineHarness, root} from './helpers/timeline-dom.mjs';

const catalog = JSON.parse(await fs.readFile(path.join(root, 'demos/catalog.json'), 'utf8'));

test('Every supplied dataset has one catalog entry and existing model/reference files', async () => {
    const files = (await fs.readdir(path.join(root, 'json/test-data'))).filter(file => file.endsWith('.json')).sort();
    assert.deepEqual(catalog.demos.map(demo => path.basename(demo.dataset)).sort(), files);
    assert.equal(new Set(catalog.demos.map(demo => demo.id)).size, files.length);
    for (const demo of catalog.demos) for (const key of ['dataset', 'model', 'reference']) {
        if (demo[key]) await fs.access(path.join(root, demo[key]));
    }
});

for (const demo of catalog.demos) test(demo.id + ': load and build real scene geometry; exercise views and search', async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const timeline = new OB_TIMELINE();
        await timeline.loadModel(demo.model, {dataset: demo.dataset});
        assert.equal(timeline.staticData.events.filter(event => !event.zone).length, demo.recordCount);
        assert.ok(harness.renderCount > 0, 'Scene construction reached the renderer');
        assert.ok(timeline.ob_scene[0].bands.some(band => band.sessions.length), 'Initial view contains events');
        assert.ok(timeline.ob_scene[0].ob_height < 4000, 'Initial canvas has a bounded height');
        const canvas = timeline.ob_scene[0].ob_renderer.domElement;
        const camera = timeline.ob_scene[0].ob_camera;
        timeline.ob_views.setMode('table');
        assert.equal(timeline.ob_views.tablePanel.querySelectorAll('tbody tr').length, demo.recordCount);
        timeline.ob_views.setMode('split');
        assert.equal(timeline.ob_timeline_body_frame.hidden, false);
        assert.equal(timeline.ob_views.tablePanel.hidden, false);
        assert.equal(timeline.ob_scene[0].ob_camera, camera);
        timeline.ob_views.setMode('timeline');
        assert.equal(timeline.ob_scene[0].ob_renderer.domElement, canvas);
        const first = timeline.staticData.events.find(event => !event.zone);
        timeline.ob_open_descriptor(0, first);
        assert.ok(timeline.ob_timeline_right_panel.textContent.includes(first.data.title));
        const {searchTimelineData} = await harness.importModule('src/openbexi_timeline_data.js');
        const result = searchTimelineData(timeline.staticData, first.data.title);
        assert.ok(result.events.some(event => event.id === first.id));
        assert.ok(result.events.filter(event => !event.zone).length < demo.recordCount);
        assert.equal(searchTimelineData(timeline.staticData, 'no-such-event-xyz').events.filter(event => !event.zone).length, 0);
        timeline.ob_views.setMode('split');
        timeline.ob_search_input.value = 'no-such-event-xyz';
        timeline.ob_search_input.dispatchEvent(new harness.window.KeyboardEvent('keydown', {key: 'Enter'}));
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(timeline.ob_views.mode, 'split');
        assert.ok(timeline.ob_views.tablePanel.textContent.includes('No events to display.'));
        assert.deepEqual(harness.requests, ['/' + demo.model, '/' + demo.dataset], 'Static demos do not contact a live data backend');
    } finally { harness.close(); }
});

test('The shared demo page loads catalog-selected data and the requested view without a page header', async () => {
    const demo = catalog.demos[0];
    const harness = await createTimelineHarness({html: await fs.readFile(path.join(root, 'demos.html'), 'utf8'),
        url: 'http://localhost/demos.html?demo=' + demo.id + '&view=split'});
    try {
        const {demoReady} = await harness.importModule('src/openbexi_demo.js');
        const timeline = await demoReady;
        assert.equal(timeline.ob_views.mode, 'split');
        assert.equal(harness.window.document.querySelector('body > header'), null);
        assert.equal(harness.window.document.getElementById('demo-workspace').getAttribute('aria-label'), demo.title + ' live timeline demo');
        assert.ok(harness.window.document.title.startsWith(demo.title));
        assert.ok(harness.window.document.getElementById('demo-status').textContent.includes(demo.recordCount + ' records'));
    } finally { harness.close(); }
});

test('Historical dates, legacy colors and model annotations retain their meaning', async () => {
    const harness = await createTimelineHarness();
    try {
        const {parseTimelineDate, formatTimelineDate, parseTimelineData} = await harness.importModule('src/openbexi_timeline_data.js');
        assert.equal(new Date(parseTimelineDate('1 AD')).getUTCFullYear(), 1);
        assert.equal(new Date(parseTimelineDate('1 BC')).getUTCFullYear(), 0);
        assert.equal(new Date(parseTimelineDate('44 BCE')).getUTCFullYear(), -43);
        assert.equal(new Date(parseTimelineDate('6')).getUTCFullYear(), 6);
        assert.equal(formatTimelineDate('1 BC', 'yyyy'), '1 BCE');
        const model = JSON.parse(await fs.readFile(path.join(root, 'models/demos/monet.json'), 'utf8'));
        const dataset = parseTimelineData(await fs.readFile(path.join(root, 'json/test-data/monet.json'), 'utf8'), model.dataSource);
        assert.equal(dataset.events.find(event => event.data.title === 'Camille').render.color, '#00aa22');
        assert.equal(dataset.events.find(event => event.data.title === 'Camille').end, undefined, 'An uncertain point event is not promoted to a duration');
        assert.ok(dataset.events.find(event => event.data.title === 'Joined Cavalry in Algeria').end);
        assert.equal(dataset.events.filter(event => !event.zone).length, 27);
        assert.equal(dataset.events.some(event => event.zone), false, 'The age strip is an axis annotation rather than a fabricated event');
        assert.equal(Date.parse(model.bands[0].secondaryScale.origin), Date.parse(dataset.events.find(event => event.data.title === 'Birth').start));
        assert.equal(formatTimelineDate('1870', 'elapsedYears', 0, '1840'), '30');
        assert.throws(() => parseTimelineData('{"events":[{"start":"invalid","title":"bad"}]}'), /Invalid start/);
    } finally { harness.close(); }
});

test('Existing view controls pass their regression suite', async () => {
    const harness = await createTimelineHarness();
    try {
        const {runTimelineViewTests} = await harness.importModule('tests/timeline_views.test.js');
        assert.equal(runTimelineViewTests().at(-1), '37 checks passed.');
    } finally { harness.close(); }
});

test('Numeric uncertainty and nested activities survive the shared import and renderer', async () => {
    const harness = await createTimelineHarness();
    try {
        const {parseTimelineData, formatTimelineValue, searchTimelineData} = await harness.importModule('src/openbexi_timeline_data.js');
        const time = {kind: 'numeric', unit: 'Ma', millisecondsPerUnit: 31536000000, direction: -1, approximatePrefixes: ['?']};
        const numeric = parseTimelineData(JSON.stringify({events: [{start: '?70', end: 60, title: 'Approximate range'}]}), {time});
        assert.equal(numeric.events[0].data.startValue, '?70');
        assert.equal(formatTimelineValue(numeric.events[0].start, time), '70 Ma');
        assert.ok(Date.parse(numeric.events[0].start) < Date.parse(numeric.events[0].end));
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const timeline = new OB_TIMELINE();
        await timeline.loadModel(catalog.demos[0].model, {dataset: catalog.demos[0].dataset});
        timeline.staticData = parseTimelineData(JSON.stringify({events: [{id: 'parent', start: '2026-09-12T12:00:00Z',
            title: 'Activity group', activities: [
                {id: 'child-a', title: 'First activity', start: '2026-09-12T12:00:00Z', end: '2026-09-12T13:00:00Z'},
                {id: 'child-b', title: 'Second activity', start: '2026-09-12T12:30:00Z', end: '2026-09-12T13:30:00Z'}
            ]}]}));
        timeline.ob_scene[0].sessions = searchTimelineData(timeline.staticData);
        timeline.update_all_timelines(0, timeline.header, timeline.params, timeline.ob_scene[0].bands,
            timeline.ob_scene[0].model, timeline.ob_scene[0].sessions, 'Orthographic');
        const session = timeline.ob_scene[0].bands[0].sessions[0];
        assert.equal(session.activities.length, 2);
        assert.ok(Number.isFinite(session.x_relative) && session.width > 0 && session.height > 0);
        timeline.ob_views.setMode('table');
        assert.ok(timeline.ob_views.tablePanel.textContent.includes('Second activity'));
    } finally { harness.close(); }
});
