import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createTimelineHarness, root} from './helpers/timeline-dom.mjs';

const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const isOverview = band => band.name.includes('overview_');
const activities = band => band.sessions.flatMap(session => session.activities);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.0001,
    `${message}: expected ${expected}, received ${actual}`);

function rebuild(timeline, payload = timeline.ob_scene[0].sessions) {
    const scene = timeline.ob_scene[0];
    clearTimeout(timeline.update_this_scene);
    timeline.update_all_timelines(0, timeline.header, timeline.params, scene.bands,
        scene.model, payload, 'Orthographic');
}

async function serverTimeline(harness, events, configure = () => {}) {
    const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
    const model = JSON.parse(await fs.readFile(path.join(root, 'models/regular_timeline.json'), 'utf8'));
    configure(model);
    const timeline = new OB_TIMELINE();
    timeline.params = model.params;
    Object.assign(timeline.params[0], {date: '2024-05-03T07:00:00Z', showCurrentTime: false});
    timeline.bands = model.bands;
    timeline.initializeTimeline();
    timeline.ob_visible_view = true;
    timeline.ob_scene[0].height = timeline.height;
    timeline.load_data = () => rebuild(timeline);
    rebuild(timeline, {events: structuredClone(events)});
    return timeline;
}

function event(id, {point = false, color, category, title = id} = {}) {
    return {id, start: '2024-05-03T07:00:00Z', ...(point ? {} : {end: '2024-05-03T07:15:00Z'}),
        data: {title, ...(category ? {category} : {})}, render: color ? {color} : {}};
}

function meshSize(mesh, axis) {
    mesh.geometry.computeBoundingBox();
    return (mesh.geometry.boundingBox.max[axis] - mesh.geometry.boundingBox.min[axis]) * Math.abs(mesh.scale[axis]);
}

function assertProjection(timeline) {
    const scene = timeline.ob_scene[0];
    const mainBands = scene.bands.filter(band => !isOverview(band));
    const overviewBands = scene.bands.filter(isOverview);
    assert.ok(overviewBands.length, 'At least one Overview is enabled');
    for (const overview of overviewBands) {
        const sources = overview.sourceBands ? mainBands.filter(band => overview.sourceBands.includes(band.name)) : mainBands;
        const count = sources.reduce((sum, band) => sum + activities(band).length, 0);
        const projected = activities(overview);
        assert.equal(projected.length, count, 'Overview contains the same activity occurrences as the main bands');
        for (const source of sources) {
            const originals = activities(source);
            const copies = projected.filter(activity => activity.overviewSourceBand === source.name);
            assert.deepEqual(copies.map(activity => activity.id), originals.map(activity => activity.id),
                'Source grouping, order, and ids survive projection');
            for (const [index, copy] of copies.entries()) {
                const original = originals[index];
                assert.notEqual(copy, original, 'Projection does not mutate the normal view');
                near(copy.overviewSourceY, original.y, 'Source row position is retained');
                assert.ok(copy.overviewScaleY > 0 && Number.isFinite(copy.overviewScaleY));
                if (index) near(copy.y - copies[0].y,
                    (original.y - originals[0].y) * copy.overviewScaleY, 'Relative row positions are preserved');
                assert.equal(copy.start, original.start);
                assert.equal(copy.end, original.end);
            }
        }
        const meshes = scene.getObjectByName(overview.name).children.filter(mesh => mesh.userData.overviewActivity);
        assert.equal(meshes.length, count, 'Every projected activity has exactly one compact marker or duration bar');
        for (const mesh of meshes) {
            assert.ok(meshSize(mesh, 'y') > 0 && meshSize(mesh, 'y') <= 8,
                'Overview markers stay compact instead of becoming vertical streaks');
            const halfHeight = meshSize(mesh, 'y') / 2;
            assert.ok(mesh.position.y + halfHeight <= overview.height / 2 + 0.0001 &&
                mesh.position.y - halfHeight >= -overview.height / 2 - 0.0001,
                `Overview marker ${mesh.data.id} stays inside its band: y=${mesh.position.y}, height=${halfHeight * 2}, band=${overview.height}`);
            assert.equal(mesh.children.length, 0, 'Overview activity shapes do not carry labels or image sprites');
            assert.equal(mesh.material.map, null, 'Overview uses colors rather than detailed image textures');
        }
    }
    return {mainBands, overviewBands};
}

test('Dense server sessions retain rows, source colors, point markers, and a single nested-session box', async () => {
    const harness = await createTimelineHarness();
    try {
        const events = Array.from({length: 48}, (_, i) => event('duration-' + i, {color: i % 2 ? '#7853ba' : '#2a9f76'}));
        events[0].render.opacity = 0.3;
        events.push(event('point', {point: true}), event('fallback-duration'));
        events.find(item => item.id === 'point').render.opacity = 0.6;
        events.push({...event('parent', {color: '#d59135'}), activities: [
            event('child-a', {color: '#b83d45'}), event('child-b', {point: true, color: '#168548'})
        ]});
        const timeline = await serverTimeline(harness, events);
        const {mainBands, overviewBands} = assertProjection(timeline);
        const source = mainBands[0];
        const sourceActivities = activities(source);
        for (const overview of overviewBands) {
            const meshes = timeline.ob_scene[0].getObjectByName(overview.name).children;
            for (const mesh of meshes.filter(mesh => mesh.userData.overviewActivity)) {
                const original = sourceActivities.find(activity => activity.id === mesh.data.id);
                assert.ok(original, 'The compact shape remains associated with its source activity');
                const color = original.render?.color || (original.end ? source.SessionColor : source.eventColor);
                assert.equal('#' + mesh.material.color.getHexString(), color.toLowerCase(), 'Overview uses the normal-view color');
                assert.equal(mesh.material.opacity, original.render?.opacity ?? 1,
                    'Overview preserves source opacity for both durations and points');
                assert.equal(mesh.material.transparent, (original.render?.opacity ?? 1) < 1);
                if (original.end) assert.ok(meshSize(mesh, 'x') > meshSize(mesh, 'y'), 'Sessions appear as horizontal duration bars');
                else assert.ok(meshSize(mesh, 'x') <= 8, 'Point events remain compact');
            }
            assert.equal(meshes.filter(mesh => mesh.userData.overviewSession).length, 1,
                'A nested session has one outline rather than one duplicated box per activity');
        }
    } finally { harness.close(); }
});

test('Fitting Overview to occupied rows expands sparse layouts while preserving groups, spacing, and nested boxes', async () => {
    const harness = await createTimelineHarness();
    try {
        const {projectOverviewSessions} = await harness.importModule('src/openbexi_timeline_overview.js');
        const source = (name, height, rows, containerHeight) => ({
            name, height, trackIncrement: 24, gregorianUnitLengths: 1000, intervalPixels: 10,
            sessions: [{id: name + '-session', y: (rows[0] + rows.at(-1)) / 2, height: containerHeight,
                render: {}, activities: rows.map((y, index) => ({id: name + '-' + index,
                    y, height: 6, size: 3, start: '2000-01-01', pixelOffSetStart: index * 20,
                    render: {color: '#7853ba'}, data: {title: String(index)}}))}],
            zones: [{id: name + '-full', render: {}},
                {id: name + '-top', render: {height: 12, verticalAlign: 'top'}}]
        });
        const sources = [source('main-a', 800, [330, 306, 270], 96), source('main-b', 400, [100, 76], 48)];
        const originals = structuredClone(sources);
        const overview = {name: 'overview_all', height: 180, fontSizeInt: 10,
            gregorianUnitLengths: 1000, intervalPixels: 2, intervalUnitPos: 'BOTTOM'};
        const timeline = {ob_scene: [{bands: [...sources, overview]}]};
        projectOverviewSessions(timeline, 0);
        const defaultProjection = structuredClone(overview);
        overview.fitRows = false;
        projectOverviewSessions(timeline, 0);
        assert.deepEqual(structuredClone(overview.sessions), defaultProjection.sessions, 'Explicit false retains the default projection');
        assert.deepEqual(structuredClone(overview.zones), defaultProjection.zones, 'Default zone geometry is unchanged');
        overview.fitRows = true;
        projectOverviewSessions(timeline, 0);
        assert.deepEqual(sources, originals, 'Fitting does not mutate source row positions or zone geometry');
        const copies = activities(overview);
        for (const main of sources) {
            const originalRows = activities(main);
            const projectedRows = copies.filter(activity => activity.overviewSourceBand === main.name);
            const oldRows = activities(defaultProjection).filter(activity => activity.overviewSourceBand === main.name);
            assert.ok(Math.abs(projectedRows.at(-1).y - projectedRows[0].y) >
                Math.abs(oldRows.at(-1).y - oldRows[0].y) * 4, 'Sparse rows expand into the available Overview space');
            for (let i = 0; i < projectedRows.length; i++) for (let j = 0; j < i; j++) {
                near(projectedRows[i].y - projectedRows[j].y,
                    (originalRows[i].y - originalRows[j].y) * projectedRows[i].overviewScaleY,
                    'Every pair of source rows keeps its relative spacing');
            }
            const region = overview.overviewRegions.find(item => item.sourceBand === main.name);
            const session = overview.sessions.find(item => item.overviewSourceBand === main.name);
            assert.ok(session.y + session.height / 2 <= region.y + region.height / 2 + 0.0001 &&
                session.y - session.height / 2 >= region.y - region.height / 2 - 0.0001,
                'The entire nested-session box stays inside its source region');
            const zone = overview.zones.find(item => item.id === main.name + '-full');
            near(zone.overviewY, region.y, 'Full-band zones are clipped to the occupied region center');
            near(zone.overviewHeight, region.height, 'Full-band zones are clipped to the occupied region height');
            assert.ok(!overview.zones.some(item => item.id === main.name + '-top'),
                'Zones outside the occupied rows do not overflow the fitted Overview');
        }
        const [first, second] = overview.overviewRegions;
        near(first.y - first.height / 2, second.y + second.height / 2, 'Independent source groups remain adjacent');
    } finally { harness.close(); }
});

test('Religious-history Overviews retain their configured source chronology and row layout', async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const timeline = new OB_TIMELINE();
        await timeline.loadModel('models/demos/religions.json', {dataset: 'json/test-data/religions.json'});
        const {mainBands, overviewBands} = assertProjection(timeline);
        assert.equal(mainBands.length, 2);
        assert.equal(overviewBands.length, 2);
        assert.ok(isOverview(timeline.ob_scene[0].bands[0]), 'This model deliberately puts Overview before normal bands');
        assert.ok(mainBands.every(band => band.filter?.field === 'namespace'));
        assert.ok(activities(mainBands[0]).every(activity => activity.data.namespace === mainBands[0].filter.equals));
        assert.ok(activities(mainBands[1]).every(activity => activity.data.namespace === mainBands[1].filter.equals));
        assert.ok(!activities(mainBands[0]).some(activity => activities(mainBands[1]).some(other => other.id === activity.id)),
            'Distinct source chronologies do not duplicate their records in the other band');
        for (const overview of overviewBands) {
            assert.equal(overview.sourceBands.length, 1);
            assert.ok(activities(overview).every(activity => activity.overviewSourceBand === overview.sourceBands[0]),
                'Each Overview projects the source band selected by its model');
        }
    } finally { harness.close(); }
});

test('Static search and repeated Overview toggles keep the miniature synchronized with the normal view', async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const {parseTimelineData} = await harness.importModule('src/openbexi_timeline_data.js');
        const timeline = new OB_TIMELINE();
        await timeline.loadModel('models/demos/default-dataset.json', {dataset: 'json/test-data/default-dataset.json'});
        timeline.staticData = parseTimelineData(JSON.stringify({events: [
            {id: 'a', start: '2026-09-12T13:00:00Z', end: '2026-09-12T14:00:00Z', data: {title: 'Match alpha'}},
            {id: 'b', start: '2026-09-12T13:15:00Z', data: {title: 'Match beta'}},
            {id: 'c', start: '2026-09-12T13:30:00Z', data: {title: 'Different title'}}
        ]}));
        timeline.ob_views.setMode('split');
        for (const [query, expected] of [['Match', 2], ['no-such-event', 0], ['', 3]]) {
            timeline.ob_search_input.value = query;
            timeline.ob_search_input.dispatchEvent(new harness.window.KeyboardEvent('keydown', {key: 'Enter'}));
            await settle();
            const {mainBands} = assertProjection(timeline);
            assert.equal(activities(mainBands[0]).length, expected);
            assert.equal(timeline.ob_views.mode, 'split');
            timeline.ob_view.click();
            await settle();
            assert.equal(timeline.ob_scene[0].bands.filter(isOverview).length, 0);
            timeline.ob_no_view.click();
            await settle();
            assertProjection(timeline);
        }
        assert.equal(harness.requests.length, 2, 'Searching and toggling do not require a new dataset request');
    } finally { harness.close(); }
});

test('The visible-range highlight follows band panning and the actual Split viewport crop', async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const timeline = new OB_TIMELINE();
        await timeline.loadModel('models/demos/jfk.json', {dataset: 'json/test-data/jfk.json'});
        const scene = timeline.ob_scene[0];
        const main = scene.bands.find(band => !isOverview(band));
        const overview = scene.bands.find(isOverview);
        const frame = timeline.ob_timeline_body_frame;
        Object.defineProperty(frame, 'clientWidth', {configurable: true, get: () =>
            timeline.ob_views.mode === 'split' ? Math.floor(scene.width / 2) : scene.width});
        function checkHighlight() {
            const mesh = scene.getObjectByName(overview.name).children.find(object =>
                object.userData.overviewViewport && object.userData.sourceBand === main.name);
            assert.ok(mesh, 'Overview contains a visible-range highlight for the source band');
            const left = frame.scrollLeft - scene.width / 2;
            const mainX = scene.getObjectByName(main.name).position.x;
            const start = main.timeScale.toTime(left - mainX);
            const end = main.timeScale.toTime(left + frame.clientWidth - mainX);
            const overviewStart = overview.timeScale.toPixel(start);
            const overviewEnd = overview.timeScale.toPixel(end);
            near(meshSize(mesh, 'x'), overviewEnd - overviewStart,
                'Highlight width reflects visible dates across the nested Overview focus');
            near(mesh.position.x, (overviewStart + overviewEnd) / 2,
                'Highlight center follows the mapped visible dates after panning');
        }
        timeline.ob_render(0);
        checkHighlight();
        timeline.move_band(0, main.name, 93, main.y, main.z, true);
        timeline.ob_render(0);
        checkHighlight();
        timeline.ob_views.setMode('split');
        checkHighlight();
        frame.scrollLeft += 87;
        frame.dispatchEvent(new harness.window.Event('scroll'));
        checkHighlight();
        timeline.move_band(0, overview.name, -31, overview.y, overview.z, true);
        timeline.ob_render(0);
        checkHighlight();
    } finally { harness.close(); }
});

test('Server grouping and refreshed records update Overview source bands and remove stale activities', async () => {
    const harness = await createTimelineHarness();
    try {
        const timeline = await serverTimeline(harness, [
            event('alpha-a', {category: 'Alpha', color: '#a73441'}),
            event('beta-a', {category: 'Beta', color: '#34a781'}),
            event('alpha-b', {category: 'Alpha', point: true, color: '#734ac8'})
        ]);
        timeline.ob_scene[0].bands[0].model[0].sortBy = 'category';
        rebuild(timeline);
        let {mainBands} = assertProjection(timeline);
        assert.deepEqual(Array.from(mainBands, band => band.layout_name).sort(), ['Alpha', 'Beta']);
        for (const band of mainBands) assert.ok(band.sessions.every(session => session.data.category === band.layout_name));
        rebuild(timeline, {events: [event('beta-new', {category: 'Beta', color: '#d77b31'}),
            event('gamma-new', {category: 'Gamma', point: true, color: '#357ac4'})]});
        ({mainBands} = assertProjection(timeline));
        assert.deepEqual(Array.from(mainBands, band => band.layout_name).sort(), ['Beta', 'Gamma']);
        assert.ok(timeline.ob_scene[0].bands.filter(isOverview).every(band =>
            activities(band).every(activity => activity.id.endsWith('-new'))), 'Refreshed Overview has no stale activities');
    } finally { harness.close(); }
});

test('Different server grouping keys stay independent and namespace groups retain source metadata', async () => {
    const harness = await createTimelineHarness();
    try {
        const records = [['a', 'North', 1], ['b', 'South', 2], ['c', 'North', 2]].map(([id, namespace, priority]) => ({
            ...event(id), data: {title: id, namespace, details: {priority}, sortByValue: 'stale unrelated grouping'}
        }));
        const timeline = await serverTimeline(harness, records, model => {
            const [main, overview] = model.bands;
            model.bands = [
                {...main, name: 'ob_band_namespace', model: [{sortBy: 'namespace'}]},
                {...main, name: 'ob_band_priority', model: [{sortBy: 'details.priority'}]},
                overview
            ];
        });
        const sources = [
            {namespace: 'North', render: {color: '#c4e9d8', textColor: '#123b29', dateColor: '#207f49'}},
            {namespace: 'South', render: {color: '#e8ccf4', textColor: '#4a2857', dateColor: '#9664ac'}}
        ];
        timeline.ob_scene[0].sources = sources;
        rebuild(timeline);
        const {mainBands, overviewBands} = assertProjection(timeline);
        const namespaceBands = mainBands.filter(band => band.model[0].sortBy === 'namespace');
        const priorityBands = mainBands.filter(band => band.model[0].sortBy === 'details.priority');
        assert.deepEqual(Array.from(namespaceBands, band => band.layout_name).sort(), ['North', 'South']);
        assert.deepEqual(Array.from(priorityBands, band => band.layout_name).sort(), ['details.priority 1', 'details.priority 2']);
        for (const band of namespaceBands) {
            assert.ok(band.sessions.length && band.sessions.every(session => session.data.namespace === band.layout_name));
            const source = sources.find(source => source.namespace === band.layout_name);
            for (const key of ['color', 'textColor', 'dateColor']) assert.equal(band[key], source.render[key]);
        }
        for (const band of priorityBands) assert.ok(band.sessions.length && band.sessions.every(session =>
            'details.priority ' + session.data.details.priority === band.layout_name));
        for (const overview of overviewBands) assert.equal(activities(overview).length, records.length * 2,
            'Overview retains each record in both independent source groupings');
    } finally { harness.close(); }
});
