import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

async function load(demo = 'default-dataset') {
    const harness = await createTimelineHarness();
    const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
    const {syncOverviewPanel} = await harness.importModule('src/openbexi_timeline_overview_panel.js');
    const timeline = new OB_TIMELINE();
    await timeline.loadModel('models/demos/' + demo + '.json', {dataset: 'json/test-data/' + demo + '.json', width: 1200, height: 640});
    return {...harness, timeline, sync: () => syncOverviewPanel(timeline, 0)};
}

test('Docked overview uses projected rows, colors, durations, and zones while retaining the original canvas', async () => {
    const harness = await load();
    try {
        const {timeline, sync} = harness;
        timeline.params[0].dockOverview = true;
        sync();
        const scene = timeline.ob_scene[0];
        const overview = scene.bands.at(-1);
        const panel = timeline.ob_timeline_panel.querySelector('.ob_docked_overview');
        const svg = panel.querySelector('svg');
        const activities = overview.sessions.flatMap(session => session.activities);
        assert.equal(panel.hidden, false);
        assert.equal(panel.style.bottom, '0px');
        assert.ok(parseFloat(panel.style.height) <= 140);
        assert.equal(parseFloat(timeline.ob_timeline_panel.style.getPropertyValue('--ob-overview-height')), parseFloat(panel.style.height));
        assert.equal(svg.querySelectorAll('[data-event-id]').length, activities.length);
        assert.equal(svg.querySelectorAll('[data-zone-id]').length, overview.zones.length);
        const rendered = [...svg.querySelectorAll('[data-event-id]')];
        activities.forEach((activity, index) => {
            assert.equal(rendered[index].getAttribute('fill'), activity.render.color);
            assert.equal(rendered[index].tagName, activity.overviewDuration ? 'rect' : 'circle');
            if (activity.overviewDuration) assert.equal(Number(rendered[index].getAttribute('width')), Math.max(0.5, activity.width));
        });
        const rows = activities.map((activity, index) => ({sourceY: activity.y,
            y: Number(rendered[index].getAttribute(activity.overviewDuration ? 'y' : 'cy'))}));
        assert.ok(rows.some(row => row.y > rows[0].y), 'Miniature contains distinct original rows');
        assert.ok(svg.textContent.includes('records / full context'));
        assert.ok(svg.querySelector('[data-overview-window]'));
        assert.equal(scene.ob_renderer.domElement.height, Math.floor(scene.ob_height), 'WebGL canvas dimensions stay intact');
        assert.ok(parseFloat(timeline.ob_timeline_body.style.height) < scene.ob_height, 'Only the original overview tail/axis is cropped');
        assert.equal(timeline.ob_timeline_body.style.overflow, 'hidden');

        timeline.ob_views.setMode('split');
        timeline.ob_timeline_body_frame.scrollLeft = 300;
        sync();
        assert.equal(panel.style.width, '600px');
        assert.equal(timeline.ob_timeline_body.style.width, '1200px', 'Clipping the old tail preserves horizontal canvas scrolling');
        assert.equal(svg.style.left, '-300px', 'Miniature and main timeline share horizontal cropping');
        assert.equal(svg.getAttribute('width'), '1200');
        assert.equal(Number(svg.querySelector('[data-overview-heading="title"]').getAttribute('x')), 308);
        assert.equal(Number(svg.querySelector('[data-overview-heading="count"]').getAttribute('x')), 892,
            'Heading anchors stay within the visible split crop');
        Object.defineProperty(timeline.ob_timeline_body_frame, 'clientWidth', {configurable: true, value: 584});
        sync();
        assert.equal(Number(svg.querySelector('[data-overview-heading="count"]').getAttribute('x')), 876,
            'Record count leaves room for the main viewport scrollbar');
        timeline.ob_views.setMode('table');
        sync();
        assert.equal(panel.hidden, true);
        assert.equal(timeline.ob_timeline_panel.style.getPropertyValue('--ob-overview-height'), '0px');
        timeline.ob_views.setMode('timeline');
        timeline.params[0].dockOverview = false;
        sync();
        assert.equal(timeline.ob_timeline_body.style.height, '');
        assert.equal(timeline.ob_timeline_body.style.overflow, '');
        assert.equal(timeline.ob_timeline_panel.querySelectorAll('.ob_docked_overview').length, 1, 'Rebuilds reuse the panel');
    } finally { harness.close(); }
});

test('Docked overview navigation follows actual time mappings and commits click, drag, and keyboard interactions', async () => {
    const harness = await load();
    try {
        const {timeline, sync, window} = harness;
        timeline.params[0].dockOverview = true;
        sync();
        const svg = timeline.ob_timeline_panel.querySelector('.ob_docked_overview svg');
        svg.getBoundingClientRect = () => ({left: 0, width: 1200});
        const overview = timeline.ob_scene[0].bands.at(-1);
        const expectedTime = timeline.pixelOffSetToBandDate(0, overview, 300).getTime();
        let refreshes = 0;
        timeline.load_data = () => { refreshes++; };
        const pointer = (type, x) => {
            const event = new window.MouseEvent(type, {button: 0, clientX: x, bubbles: true, cancelable: true});
            Object.defineProperty(event, 'pointerId', {value: 1});
            svg.dispatchEvent(event);
        };
        pointer('pointerdown', 900);
        pointer('pointerup', 900);
        assert.equal(timeline.ob_scene.sync_time, expectedTime, 'A click chooses the overview date using its actual axis');
        assert.equal(refreshes, 1);
        sync();
        const mesh = timeline.ob_scene[0].getObjectByName(overview.name);
        const oldX = mesh.position.x;
        pointer('pointerdown', 600);
        pointer('pointermove', 650);
        assert.equal(mesh.position.x, oldX + 50, 'Dragging moves the existing overview band');
        pointer('pointerup', 650);
        assert.equal(refreshes, 2);
        sync();
        svg.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, cancelable: true}));
        assert.equal(refreshes, 3);
    } finally { harness.close(); }
});

test('Panning retains overview events, zones and windows while updating actual axis coordinates', async () => {
    for (const demo of ['default-dataset', 'dinausaurs', 'jfk']) {
        const harness = await load(demo);
        try {
            const {timeline, sync} = harness;
            const scene = timeline.ob_scene[0];
            const main = scene.bands.find(band => !band.name.includes('overview_'));
            const overview = scene.bands.at(-1);
            const mainMesh = scene.getObjectByName(main.name), overviewMesh = scene.getObjectByName(overview.name);
            const svg = timeline.ob_timeline_panel.querySelector('.ob_docked_overview svg');
            const content = svg.querySelector('[data-overview-content]');
            const events = [...svg.querySelectorAll('[data-event-id]')];
            const zones = [...svg.querySelectorAll('[data-zone-id]')];
            const selection = svg.querySelector('[data-overview-window]');
            const mainAxis = svg.querySelector('[data-overview-axis="main"]');
            const firstTicks = [...mainAxis.querySelectorAll('line')];
            const initialAxisX = firstTicks.map(line => line.getAttribute('x1'));
            for (let step = 1; step <= 40; step++) {
                timeline.move_band(0, main.name, -step, mainMesh.position.y, mainMesh.position.z, true);
                sync();
                assert.deepEqual([...svg.querySelectorAll('[data-event-id]')], events,
                    demo + ': pointer movement must not replace event nodes');
                assert.deepEqual([...svg.querySelectorAll('[data-zone-id]')], zones,
                    demo + ': pointer movement must not replace highlighted zones');
                assert.equal(svg.querySelector('[data-overview-window]'), selection);
            }
            assert.equal(content.getAttribute('transform'), `translate(${overviewMesh.position.x} 0)`);
            const retainedTick = firstTicks.find((line, index) => line.isConnected && line.getAttribute('x1') !== initialAxisX[index]);
            assert.ok(retainedTick, demo + ': existing axis ticks move to their current time positions');
            const left = -scene.width / 2 - mainMesh.position.x;
            const start = timeline.dateToBandPixelOffSet(0, overview, timeline.pixelOffSetToBandDate(0, main, left));
            const end = timeline.dateToBandPixelOffSet(0, overview, timeline.pixelOffSetToBandDate(0, main, left + scene.width));
            assert.ok(Math.abs(Number(selection.getAttribute('x')) - (scene.width / 2 + overviewMesh.position.x + start)) < 1e-7);
            assert.ok(Math.abs(Number(selection.getAttribute('width')) - (end - start)) < 1e-7,
                demo + ': the retained selection follows calendar, numeric and magnified axes');
        } finally { harness.close(); }
    }
});

test('Overview content refreshes for edits, changed topology, rebuilt arrays and resizing', async () => {
    const harness = await load();
    try {
        const {timeline, sync} = harness;
        const scene = timeline.ob_scene[0];
        const overview = scene.bands.at(-1);
        const svg = timeline.ob_timeline_panel.querySelector('.ob_docked_overview svg');
        const firstNode = svg.querySelector('[data-event-id]');
        const first = overview.sessions[0].activities[0];
        first.render.color = '#123456';
        first.data.title = 'Updated projected label';
        sync();
        const edited = svg.querySelector('[data-event-id]');
        assert.notEqual(edited, firstNode);
        assert.equal(edited.getAttribute('fill'), '#123456');
        assert.equal(edited.querySelector('title').textContent, 'Updated projected label');
        const previousCount = svg.querySelectorAll('[data-event-id]').length;
        overview.sessions[0].activities.push({...first, id: 'new-activity', y: first.y - 10});
        sync();
        assert.equal(svg.querySelectorAll('[data-event-id]').length, previousCount + 1,
            'Appending within the existing activity array invalidates the projection');
        const beforeArrayChange = svg.querySelector('[data-event-id]');
        overview.sessions = [...overview.sessions];
        sync();
        assert.notEqual(svg.querySelector('[data-event-id]'), beforeArrayChange,
            'A new projected session array begins a new layout');
        scene.width = 900;
        sync();
        assert.equal(svg.getAttribute('width'), '900');
        assert.equal(svg.querySelectorAll('[data-event-id]').length, previousCount + 1);
        timeline.ob_views.setMode('table');
        timeline.ob_views.setMode('timeline');
        sync();
        assert.equal(svg.isConnected, true, 'View changes retain the SVG and its input handlers');
        assert.equal(svg.querySelectorAll('[data-event-id]').length, previousCount + 1);
        timeline.update_all_timelines(0, timeline.header, timeline.params, scene.bands, scene.model, scene.sessions, 'Orthographic');
        sync();
        const rebuilt = timeline.ob_scene[0].bands.at(-1);
        assert.equal(svg.querySelectorAll('[data-event-id]').length, rebuilt.sessions.flatMap(session => session.activities).length,
            'A scene rebuild replaces the previous projection and removes local stale nodes');
    } finally { harness.close(); }
});

test('Ordinary models keep their original overview and toolbar layout', async () => {
    const harness = await load('space_exploration');
    try {
        const {timeline, sync} = harness;
        sync();
        assert.equal(timeline.ob_timeline_panel.querySelector('.ob_docked_overview'), null);
        assert.equal(timeline.ob_timeline_header.style.height, '40px');
        assert.equal(timeline.ob_timeline_body.style.height, '');
    } finally { harness.close(); }
});

test('Docked sparse models fit the actual viewport without a blank scroll tail', async () => {
    for (const demo of ['monet', 'jfk']) {
        const harness = await load(demo);
        try {
            const {timeline, sync} = harness;
            const scene = timeline.ob_scene[0];
            const canvasHeight = scene.ob_renderer.domElement.height;
            const panel = timeline.ob_timeline_panel.querySelector('.ob_docked_overview');
            const fallbackHeight = timeline.height - parseFloat(panel.style.height);
            assert.equal(parseFloat(timeline.ob_timeline_body.style.height), fallbackHeight,
                `${demo}: the footer and main viewport fill the available chart height`);
            const viewportHeight = Math.floor(fallbackHeight) - 8;
            Object.defineProperty(timeline.ob_timeline_body_frame, 'clientHeight', {configurable: true, value: viewportHeight});
            sync();
            assert.equal(parseFloat(timeline.ob_timeline_body.style.height), viewportHeight,
                'A real measured viewport takes precedence over the estimated model height');
            assert.equal(scene.ob_renderer.domElement.height, canvasHeight, 'Clipping never resizes the scene or camera');
            timeline.ob_views.setMode('split');
            sync();
            assert.equal(timeline.ob_timeline_body.style.width, '1200px', 'Split retains the full horizontally navigable scene');
            assert.equal(parseFloat(timeline.ob_timeline_body.style.height), viewportHeight);
        } finally { harness.close(); }
    }
});

test('Docked clipping preserves dense rows, nested containers, and model scale headers', async () => {
    const dense = await load('default-dataset');
    try {
        const {timeline, sync} = dense;
        const originalHeight = parseFloat(timeline.ob_timeline_body.style.height);
        Object.defineProperty(timeline.ob_timeline_body_frame, 'clientHeight', {configurable: true, value: 500});
        sync();
        assert.ok(originalHeight > 500);
        assert.equal(parseFloat(timeline.ob_timeline_body.style.height), originalHeight,
            'Rows extending below the viewport remain reachable by scrolling');
    } finally { dense.close(); }

    const sparse = await load('monet');
    try {
        const {timeline, sync} = sparse;
        const scene = timeline.ob_scene[0];
        const main = scene.bands.find(band => !band.name.includes('overview_'));
        const footer = parseFloat(timeline.ob_timeline_panel.style.getPropertyValue('--ob-overview-height'));
        const viewportHeight = timeline.height - footer;
        const naturalHeight = scene.ob_height - scene.bands.at(-1).height - main.fontSizeInt * 1.5;
        const saved = main.sessions;
        const localY = scene.ob_height - main.y - (viewportHeight - 10);
        const activity = {...saved[0].activities[0], y: localY, textY: 0};
        main.sessions = [{activities: [activity, {...activity}], y: localY, height: 30}];
        sync();
        assert.equal(parseFloat(timeline.ob_timeline_body.style.height), naturalHeight,
            'A nested session box can extend below its individual rows');
        main.sessions = [];
        main.scaleHeader = {height: viewportHeight + 1};
        main.secondaryScale = undefined;
        sync();
        assert.equal(parseFloat(timeline.ob_timeline_body.style.height), naturalHeight,
            'A model header counts as occupied space even without event rows');
    } finally { sparse.close(); }
});

test('Religions keeps Judaism and Christianity in their own bands and overviews without losing table records', async () => {
    const harness = await load('religions');
    try {
        const {timeline, sync} = harness;
        sync();
        const scene = timeline.ob_scene[0];
        const byName = name => scene.bands.find(band => band.name === name);
        const judaism = byName('ob_band_durations');
        const christianity = byName('ob_band_events');
        const top = byName('ob_overview_band_top');
        const bottom = byName('ob_overview_band_bottom');
        const ids = band => [...band.sessions].map(session => session.id).sort();

        assert.equal(timeline.staticData.events.length, 730, 'The complete imported dataset stays available');
        assert.equal(scene.sessions.events.length, 730, 'Band filters do not filter the shared table data');
        assert.equal(timeline.staticData.events.filter(event => event.namespace === 'Christianity').length, 560);
        assert.equal(timeline.staticData.events.filter(event => event.namespace === 'Judaism').length, 170);
        assert.deepEqual([...top.sourceBands], ['ob_band_durations']);
        assert.deepEqual([...bottom.sourceBands], ['ob_band_events']);
        assert.ok(judaism.sessions.length > 0 && christianity.sessions.length > 0);
        for (const band of [judaism, top]) {
            assert.ok(band.sessions.every(session => session.namespace === 'Judaism' && session.end),
                'The upper chronology contains only Jewish durations');
        }
        for (const band of [christianity, bottom]) {
            assert.ok(band.sessions.every(session => session.namespace === 'Christianity'),
                'The lower chronology contains only Christian source records');
        }
        assert.deepEqual(ids(top), ids(judaism), 'The top overview projects precisely the Jewish band');
        assert.deepEqual(ids(bottom), ids(christianity), 'The bottom overview projects precisely the Christian band');
        assert.ok(judaism.sessions.some(session => session.data.title === 'Canonicalization of Tanakh'));
        assert.ok(judaism.sessions.some(session => session.data.title === 'Christianity splits from Judaism'));
        assert.ok(christianity.sessions.some(session => session.data.title === 'Anno Domini'));
        const tiberius = christianity.sessions.find(session => session.data.title === 'Tiberius, Roman Emperor');
        assert.ok(tiberius?.end, 'Christian durations remain with Christian point events');
        assert.ok(!top.sessions.some(session => session.id === tiberius.id), 'Christian durations are not duplicated above');

        const panel = timeline.ob_timeline_panel.querySelector('.ob_docked_overview');
        const svg = panel.querySelector('svg');
        const panelHeight = timeline.height * timeline.params[0].overviewHeightRatio + 20;
        assert.equal(parseFloat(panel.style.height), panelHeight);
        assert.equal(svg.querySelector('[data-overview-heading="title"]').textContent, 'Magnified overview');
        assert.ok([...svg.querySelectorAll('[data-source-band]')].every(element =>
            element.getAttribute('data-source-band') === 'ob_band_events'));
        const axisLabels = [...svg.querySelectorAll('text')].filter(element =>
            Number(element.getAttribute('y')) === panelHeight - 4).map(element => element.textContent);
        assert.ok(axisLabels.includes('1201 BCE'), 'The magnified overview retains historical context before the common era');
        assert.ok(axisLabels.includes('50') && axisLabels.includes('250'), 'The same axis includes common-era dates');

        timeline.ob_views.setMode('table');
        assert.equal(timeline.ob_views.tablePanel.querySelectorAll('tbody tr').length, 730,
            'All source records remain reachable through the table');
    } finally { harness.close(); }
});

test('JFK docked overview combines monthly context with magnified local time and the actual visible time window', async () => {
    const harness = await load('jfk');
    try {
        const {timeline, sync} = harness;
        sync();
        const scene = timeline.ob_scene[0];
        const overview = scene.bands.at(-1);
        const mesh = scene.getObjectByName(overview.name);
        const panel = timeline.ob_timeline_panel.querySelector('.ob_docked_overview');
        const svg = panel.querySelector('svg');
        const panelHeight = timeline.height * timeline.params[0].overviewHeightRatio + 20;
        assert.equal(parseFloat(panel.style.height), panelHeight);
        const axisLabels = [...svg.querySelectorAll('text')].filter(element =>
            Number(element.getAttribute('y')) === panelHeight - 4).map(element => element.textContent);
        assert.ok(axisLabels.includes('1963-09') && axisLabels.includes('1963-11'));
        assert.ok(axisLabels.includes('12:30'), 'The overview itself includes the half-hour tick in local time');
        const pixel = time => timeline.dateToBandPixelOffSet(0, overview, time);
        const zoneElements = [...svg.querySelectorAll('[data-zone-id]')];
        assert.equal(zoneElements.length, 2);
        for (const zone of overview.zones) {
            const element = zoneElements.find(item => item.getAttribute('data-zone-id') === zone.id);
            assert.equal(element.getAttribute('fill'), '#f5bd76');
            assert.equal(Number(element.getAttribute('fill-opacity')), 0.35);
            assert.equal(Number(element.getAttribute('width')), pixel(zone.end) - pixel(zone.start));
        }

        const window = svg.querySelector('[data-overview-window="ob_band_main"]');
        const start = pixel('1963-11-22T18:00:00Z');
        const end = pixel('1963-11-22T20:00:00Z');
        assert.ok(Math.abs(Number(window.getAttribute('x')) - (scene.width / 2 + mesh.position.x + start)) < 1e-8);
        assert.ok(Math.abs(Number(window.getAttribute('width')) - (end - start)) < 1e-8,
            'The selection represents the actual two-hour main range through the magnified overview');
        const uniformWidth = scene.width * (2 * 60 * 60 * 1000) /
            (Date.parse(overview.range.to) - Date.parse(overview.range.from));
        assert.ok(Number(window.getAttribute('width')) > uniformWidth * 100,
            'The view window follows the nonlinear axis rather than a full-range duration ratio');
    } finally { harness.close(); }
});

test('Monet has uniform historical scales, an anniversary age strip, and a compact full-context overview', async () => {
    const harness = await load('monet');
    try {
        const {timeline, sync} = harness;
        sync();
        const scene = timeline.ob_scene[0];
        const main = scene.bands.find(band => band.name === 'ob_band_life');
        const overview = scene.bands.at(-1);
        const activities = main.sessions.flatMap(session => session.activities);
        const byTitle = title => activities.find(activity => activity.data.title === title);
        const pixel = (band, time) => timeline.dateToBandPixelOffSet(0, band, time);
        const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, message);
        assert.equal(timeline.staticData.events.length, 27);
        assert.equal(activities.length, 27, 'All source records remain in the navigable context');
        assert.equal(timeline.ob_timeline_header.style.height, '40px', 'The original toolbar stays unchanged');
        assert.equal(main.timeScale.from, Date.parse('1824-01-01'));
        assert.equal(main.timeScale.to, Date.parse('1916-01-01'));
        assert.equal(overview.timeScale.from, Date.parse('1824-01-01'));
        assert.equal(overview.timeScale.to, Date.parse('1929-01-01'));
        for (const band of [main, overview]) {
            const start = band.timeScale.from, quarter = (band.timeScale.to - start) / 4;
            near(pixel(band, start + quarter) - pixel(band, start), scene.width / 4,
                'An equal time span occupies an equal fraction of the uniform axis');
            near(pixel(band, start + 3 * quarter) - pixel(band, start + 2 * quarter), scene.width / 4);
        }

        const headers = scene.getObjectByName(main.name + '_scale_headers');
        assert.ok(headers, 'The chart owns its model-defined scale annotations');
        const label = tag => headers.children.find(child => child.userData[tag]);
        assert.equal(label('scaleHeaderLabel').text, 'Uniform time scale');
        assert.equal(label('scaleHeaderUnit').text, 'Decade / UTC');
        const strip = label('secondaryScaleStrip');
        assert.equal(strip.geometry.parameters.height, 25);
        assert.equal(strip.material.color.getHexString(), 'ffd58a');
        const ageLabels = headers.children.filter(child => child.userData.secondaryScaleLabel);
        const age0 = ageLabels.find(child => child.text === '0 Age');
        const age10 = ageLabels.find(child => child.text === '10 Age');
        near(age0.position.x, byTitle('Birth').x, 'Age zero aligns exactly with Birth');
        near(age10.position.x, pixel(main, '1850-11-14T00:00:00Z'), 'Age decades align with birthdays');
        assert.ok(Math.abs(age10.position.x - pixel(main, '1850-01-01')) > 1,
            'Age ticks do not reuse January calendar ticks');
        assert.ok(activities.every(activity => activity.y < strip.position.y - 25 / 2), 'Event rows start below both scale strips');
        const cavalry = byTitle('Joined Cavalry in Algeria');
        const paintings = byTitle('Painted landscapes and seascapes');
        assert.equal(cavalry.height, 6);
        assert.ok(cavalry.textY > cavalry.height / 2, 'Duration labels sit above their thin bars');
        assert.equal(cavalry.render.opacity, 0.35, 'Uncertain duration styling uses retained source metadata');
        assert.equal(paintings.render.color, '#0a0');
        assert.equal(paintings.render.opacity, undefined, 'Definite durations retain their source appearance');
        assert.equal(byTitle('Camille').render.color, '#00aa22');
        assert.ok(byTitle('Death').x > scene.width / 2, 'Later events remain available beyond the initial main range');

        const panel = timeline.ob_timeline_panel.querySelector('.ob_docked_overview');
        const svg = panel.querySelector('svg');
        assert.equal(svg.querySelector('[data-overview-heading]'), null, 'The reference overview has no added title or record count');
        assert.equal(svg.querySelectorAll('[data-event-id]').length, 27);
        assert.equal(svg.querySelectorAll('[data-overview-handle]').length, 2);
        const selection = svg.querySelector('[data-overview-window="ob_band_life"]');
        near(Number(selection.getAttribute('width')), pixel(overview, main.range.to) - pixel(overview, main.range.from),
            'The selection spans the main range on the full overview axis');
        const projected = overview.sessions.flatMap(session => session.activities);
        const ys = projected.map(activity => activity.y);
        assert.ok(Math.max(...ys) - Math.min(...ys) > overview.height / 2,
            'Compact overview rows use available height instead of inheriting empty main-band space');
        const sourceRows = [...activities].sort((a, b) => a.y - b.y).map(activity => activity.id);
        const overviewRows = [...projected].sort((a, b) => a.y - b.y).map(activity => activity.id);
        assert.deepEqual(overviewRows, sourceRows, 'Fitting rows preserves their original ordering');
        const panelHeight = parseFloat(panel.style.height);
        const overviewTicks = [...svg.querySelectorAll('text')].filter(element =>
            Number(element.getAttribute('y')) === panelHeight - 4).map(element => element.textContent);
        assert.ok(overviewTicks.includes('1825') && overviewTicks.includes('1925'));
        assert.ok(overviewTicks.includes('1850') && overviewTicks.includes('1855'), 'Overview uses five-year calendar ticks');
        timeline.ob_views.setMode('table');
        assert.equal(timeline.ob_views.tablePanel.querySelectorAll('tbody tr').length, 27);
    } finally { harness.close(); }
});
