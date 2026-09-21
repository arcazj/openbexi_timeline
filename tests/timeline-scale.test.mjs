import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const time = value => Date.parse('2026-09-12T' + value + ':00Z');
const minute = 60000;
const day = 86400000;
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.001,
    `${message}: expected ${expected}, received ${actual}`);

function scaleFixture(width = 1200) {
    const scene = {width};
    const timeline = {params: [{date: '2026-09-12T12:30:00Z'}], ob_scene: [scene]};
    timeline.ob_scene.sync_time = time('12:30');
    const band = {name: 'configured-band', gregorianUnitLengths: minute, intervalPixels: 30,
        range: {from: '2026-09-12T08:00:00Z', to: '2026-09-12T17:00:00Z'},
        context: {from: '2026-09-12T00:00:00Z', to: '2026-09-13T00:00:00Z'},
        focus: {from: '2026-09-12T12:10:00Z', to: '2026-09-12T13:20:00Z', magnification: 3}};
    return {timeline, scene, band};
}

function rebuild(timeline) {
    const scene = timeline.ob_scene[0];
    timeline.update_all_timelines(0, timeline.header, timeline.params, scene.bands,
        scene.model, scene.sessions, 'Orthographic');
}

test('Model-defined focus scales are invertible through focus boundaries and scale to viewport width', async () => {
    const harness = await createTimelineHarness();
    try {
        const {prepareBandScale, bandTimeToPixel, bandPixelToTime} = await harness.importModule('src/openbexi_timeline_scale.js');
        const {timeline, scene, band} = scaleFixture();
        prepareBandScale(timeline, 0, band);
        near(bandTimeToPixel(timeline, 0, band, time('08:00')), -600, 'The configured start maps to the left edge');
        near(bandTimeToPixel(timeline, 0, band, time('17:00')), 600, 'The configured end maps to the right edge');
        const inside = band.timeScale.toPixel(time('12:40')) - band.timeScale.toPixel(time('12:30'));
        const outside = band.timeScale.toPixel(time('10:10')) - band.timeScale.toPixel(time('10:00'));
        near(inside / outside, 3, 'Focus magnification is controlled by the model');
        let previous = -Infinity;
        for (let at = time('00:00'); at <= time('23:50') + 10 * minute; at += 5 * minute) {
            const pixel = bandTimeToPixel(timeline, 0, band, at);
            assert.ok(pixel > previous, 'Time ordering remains monotonic inside and outside the viewport');
            near(bandPixelToTime(timeline, 0, band, pixel), at, 'Pixel-to-time inversion preserves the instant');
            previous = pixel;
        }
        const beforeResize = band.timeScale.toPixel(time('12:30'));
        scene.width = 600;
        prepareBandScale(timeline, 0, band);
        near(band.timeScale.toPixel(time('12:30')), beforeResize / 2, 'Resizing preserves relative time positions');
        timeline.ob_scene.sync_time += day;
        prepareBandScale(timeline, 0, band);
        assert.equal(band.timeScale.from, time('08:00') + day);
        assert.equal(band.timeScale.contextFrom, time('00:00') + day);
        near(band.timeScale.toPixel(time('12:30') + day), beforeResize / 2, 'Navigation advances the whole focus/context together');
    } finally { harness.close(); }
});

test('Unconfigured time scales retain linear behavior and invalid model ranges are rejected', async () => {
    const harness = await createTimelineHarness();
    try {
        const {prepareBandScale, bandTimeToPixel, bandPixelToTime} = await harness.importModule('src/openbexi_timeline_scale.js');
        const {timeline, band} = scaleFixture();
        assert.throws(() => prepareBandScale(timeline, 0, {...band, range: {from: 'invalid', to: band.range.to}}), /Invalid band range/);
        assert.throws(() => prepareBandScale(timeline, 0, {...band, focus: {...band.focus, magnification: 0}}), /Invalid band focus/);
        const linear = {name: 'legacy-linear', gregorianUnitLengths: 3600000, intervalPixels: 150};
        prepareBandScale(timeline, 0, linear);
        assert.equal(linear.timeScale, undefined);
        near(bandTimeToPixel(timeline, 0, linear, time('13:30')), 150, 'An existing hour interval stays unchanged');
        near(bandPixelToTime(timeline, 0, linear, -150), time('11:30'), 'Linear inverse stays unchanged');
        assert.ok(Number.isNaN(bandTimeToPixel(timeline, 0, linear, undefined)), 'Missing ends remain point events');
    } finally { harness.close(); }
});

test('Nested model focus intervals multiply magnification and remain invertible at every boundary', async () => {
    const harness = await createTimelineHarness();
    try {
        const {prepareBandScale} = await harness.importModule('src/openbexi_timeline_scale.js');
        const {timeline, band} = scaleFixture();
        band.focus = [
            {from: '2026-09-12T10:00:00Z', to: '2026-09-12T15:00:00Z', magnification: 8},
            {from: '2026-09-12T12:00:00Z', to: '2026-09-12T13:00:00Z', magnification: 3},
            {from: '2026-09-12T16:00:00Z', to: '2026-09-12T17:00:00Z', magnification: 2}
        ];
        prepareBandScale(timeline, 0, band);
        const width = (from, to) => band.timeScale.toPixel(time(to)) - band.timeScale.toPixel(time(from));
        near(width('11:00', '11:30') / width('08:00', '08:30'), 8, 'Outer focus expands equal time intervals');
        near(width('12:00', '12:30') / width('11:00', '11:30'), 3, 'Nested focus magnification multiplies the outer weight');
        near(width('16:00', '16:30') / width('08:00', '08:30'), 2, 'A disjoint focus uses its own magnification');
        assert.equal(band.timeScale.focuses.length, 3);
        let last = -Infinity;
        for (let instant = time('07:00'); instant <= time('18:00'); instant += 5 * minute) {
            const pixel = band.timeScale.toPixel(instant);
            assert.ok(pixel > last, 'Nested focus preserves time order, including the spaces between focuses');
            near(band.timeScale.toTime(pixel), instant, 'Every boundary and interior instant round-trips');
            last = pixel;
        }
    } finally { harness.close(); }
});

test('Religions uses historical context with tenfold detail and calendar-aligned BCE/CE ticks', async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const {bandTicks} = await harness.importModule('src/openbexi_timeline_ticks.js');
        const timeline = new OB_TIMELINE();
        await timeline.loadModel('models/demos/religions.json', {dataset: 'json/test-data/religions.json'});
        const main = timeline.ob_scene[0].bands.find(band => !band.name.includes('overview_'));
        const overview = timeline.ob_scene[0].bands.find(band => band.name.includes('overview_'));
        const year = value => { const date = new Date(0); date.setUTCFullYear(value, 0, 1); return date.getTime(); };
        assert.equal(main.timeScale.from, year(-365));
        assert.equal(main.timeScale.to, year(36));
        assert.equal(overview.timeScale.from, year(-1310));
        assert.equal(overview.timeScale.to, year(255));
        const oneBCE = main.timeScale.toPixel(year(0)) / timeline.ob_scene[0].width + 0.5;
        assert.ok(oneBCE > 0.49 && oneBCE < 0.52, 'The era boundary sits near the reference midpoint');
        near((main.timeScale.toPixel(year(10)) - main.timeScale.toPixel(year(5))) / (year(10) - year(5)) /
            ((main.timeScale.toPixel(year(-100)) - main.timeScale.toPixel(year(-105))) / (year(-100) - year(-105))),
        10, 'CE detail receives ten times the scale of earlier history');
        const ticks = bandTicks(main, main.timeScale.from, main.timeScale.to);
        const years = Array.from(ticks, tick => new Date(tick.time).getUTCFullYear());
        assert.ok(years.includes(-350) && years.includes(-50) && years.includes(0), 'BCE ticks align to whole calendar years');
        assert.ok(years.includes(5) && years.includes(35), 'Focus ticks retain five-year detail');
        assert.equal(timeline.staticData.events.filter(event => !event.zone).length, 730, 'Focused rendering retains all source records');
    } finally { harness.close(); }
});

test('JFK combines a two-hour detail view with month, day and nested half-hour context', async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const {bandTicks} = await harness.importModule('src/openbexi_timeline_ticks.js');
        const timeline = new OB_TIMELINE();
        await timeline.loadModel('models/demos/jfk.json', {dataset: 'json/test-data/jfk.json'});
        const main = timeline.ob_scene[0].bands.find(band => !band.name.includes('overview_'));
        const overview = timeline.ob_scene[0].bands.find(band => band.name.includes('overview_'));
        const local = (date, hour) => Date.parse(date + 'T' + hour + ':00-06:00');
        assert.equal(main.timeScale.from, local('1963-11-22', '12:00'));
        assert.equal(main.timeScale.to, local('1963-11-22', '14:00'));
        const width = (from, to) => overview.timeScale.toPixel(local('1963-11-22', to)) - overview.timeScale.toPixel(local('1963-11-22', from));
        near(width('12:00', '12:30') / width('10:00', '10:30'), 3, 'The highlighted hour is expanded inside the day context');
        const mainTicks = bandTicks(main, main.timeScale.from, main.timeScale.to, -360);
        assert.equal(mainTicks[1].time - mainTicks[0].time, 5 * minute, 'The main chart retains five-minute ticks');
        const ticks = bandTicks(overview, overview.timeScale.from, overview.timeScale.to, -360);
        assert.ok(ticks.some(tick => tick.time === local('1963-09-01', '00:00') && tick.format === 'yyyy-MM'));
        assert.ok(ticks.some(tick => tick.time === local('1963-11-22', '10:00') && tick.format === 'HH:mm'));
        assert.ok(ticks.some(tick => tick.time === local('1963-11-22', '12:30') && tick.format === 'HH:mm'));
        assert.equal(timeline.staticData.events.filter(event => !event.zone).length, 130);
    } finally { harness.close(); }
});

test('Dinosaurs magnifies the main age scale fourfold while retaining every source age in Overview', async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const {bandTicks} = await harness.importModule('src/openbexi_timeline_ticks.js');
        const {prepareBandScale} = await harness.importModule('src/openbexi_timeline_scale.js');
        const timeline = new OB_TIMELINE();
        await timeline.loadModel('models/demos/dinausaurs.json', {dataset: 'json/test-data/dinausaurs.json'});
        const scene = timeline.ob_scene[0];
        const main = scene.bands.find(band => !band.name.includes('overview_'));
        const overview = scene.bands.find(band => band.name.includes('overview_'));
        const ma = value => -value * timeline.staticTimeAxis.millisecondsPerUnit;
        assert.equal(timeline.staticData.events.filter(event => !event.zone).length, 224);
        assert.equal(main.sessions.length, 224, 'Every dinosaur remains in the layout when the visible range is magnified');
        assert.equal(overview.sessions.length, 224, 'The fixed Overview retains all normal-view events');
        assert.equal(main.timeScale.from, ma(165));
        assert.equal(main.timeScale.to, ma(115));
        assert.equal(main.timeScale.contextFrom, ma(240));
        assert.equal(main.timeScale.contextTo, ma(40));
        assert.equal(overview.timeScale.from, ma(240));
        assert.equal(overview.timeScale.to, ma(40));
        const intervalWidth = band => band.timeScale.toPixel(ma(130)) - band.timeScale.toPixel(ma(150));
        near(intervalWidth(main) / intervalWidth(overview), 4, 'The same age interval is four times wider in the main view');
        assert.ok(main.timeScale.toPixel(ma(228)) < main.timeScale.toPixel(ma(65)), 'Older ages are left of younger ages');
        for (const session of main.sessions) for (const activity of session.activities) {
            if (Number.isFinite(activity.pixelOffSetEnd)) {
                assert.ok(activity.pixelOffSetEnd > activity.pixelOffSetStart, 'Numeric durations extend toward younger ages');
                assert.ok(activity.textY > activity.height / 2, 'Duration labels are above their compact bars');
            }
        }
        for (const session of overview.sessions) for (const activity of session.activities) {
            assert.ok(activity.pixelOffSetStart > -scene.width / 2 && activity.pixelOffSetStart < scene.width / 2,
                'Every source start remains inside the Overview time span');
            if (Number.isFinite(activity.pixelOffSetEnd)) {
                assert.ok(activity.pixelOffSetEnd < scene.width / 2, 'Every source duration remains inside Overview');
            }
        }
        const ticks = bandTicks(main, main.timeScale.from, main.timeScale.to);
        assert.deepEqual(Array.from(ticks, tick => timeline.formatEventDate(tick.time)),
            ['165 Ma', '160 Ma', '155 Ma', '150 Ma', '145 Ma', '140 Ma', '135 Ma', '130 Ma', '125 Ma', '120 Ma', '115 Ma']);
        assert.equal(timeline.ob_calendar.hidden, true, 'A numeric axis has no calendar control');
        assert.ok(timeline.ob_timeline_panel.querySelector('.ob_docked_overview'), 'Overview remains docked below scrollable rows');
        const originalPosition = main.timeScale.toPixel(ma(150));
        scene.width /= 2;
        prepareBandScale(timeline, 0, main);
        near(main.timeScale.toPixel(ma(150)), originalPosition / 2, 'Resizing retains the numeric age positions');
        timeline.ob_scene.sync_time += 20 * timeline.staticTimeAxis.millisecondsPerUnit;
        prepareBandScale(timeline, 0, main);
        prepareBandScale(timeline, 0, overview);
        assert.equal(main.timeScale.from, ma(145), 'Navigation advances the range in native axis units');
        assert.equal(main.timeScale.to, ma(95));
        assert.equal(overview.timeScale.contextFrom, ma(220), 'Overview context advances with the detail view');
        near(main.timeScale.toPixel(ma(130)), originalPosition / 2, 'Navigation does not convert internal timestamps twice');
        near(main.timeScale.toTime(main.timeScale.toPixel(ma(100))), ma(100), 'Numeric positions remain invertible after navigation');
        timeline.ob_views.setMode('table');
        assert.equal(timeline.ob_views.tablePanel.querySelectorAll('tbody tr').length, 224);
    } finally { harness.close(); }
});

test('Operations keeps every record while the initial context shows the 48 reference records with readable labels', async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const timeline = new OB_TIMELINE();
        await timeline.loadModel('models/demos/default-dataset.json', {dataset: 'json/test-data/default-dataset.json'});
        assert.equal(timeline.staticData.events.filter(event => !event.zone).length, 1008);
        assert.equal(timeline.ob_scene[0].sessions.events.filter(event => !event.zone).length, 1008);
        const main = timeline.ob_scene[0].bands.find(band => !band.name.includes('overview_'));
        const overview = timeline.ob_scene[0].bands.find(band => band.name.includes('overview_'));
        assert.equal(main.sessions.length, 48, 'The day context controls layout without deleting the other 960 records');
        assert.equal(overview.sessions.length, 48, 'Overview uses the same complete day context');
        assert.equal(main.timeScale.from, time('08:00'));
        assert.equal(main.timeScale.to, time('17:00'));
        assert.equal(overview.timeScale.from, time('00:00'));
        assert.equal(overview.timeScale.to, time('00:00') + day);
        const tied = main.sessions.filter(session => Date.parse(session.start) === time('12:10'));
        assert.deepEqual(Array.from(tied, session => session.data.title), [
            'Link verification 29', 'Signal acquisition 15', 'Quality checkpoint 08', 'Clock alignment 36', 'Archive checksum 22'
        ], 'Equal-start durations use the reference packing order, followed by point events');
        const ground = main.sessions.find(session => session.data.title === 'Ground-station coverage').activities[0];
        assert.ok(ground.textY > ground.height / 2, 'Duration labels sit above their bars');
        const labelCenter = ground.x_relative + ground.textX;
        assert.ok(labelCenter > -timeline.ob_scene[0].width / 2, 'A session starting before the visible range retains a visible label');
        const packet = main.sessions.find(session => session.data.title === 'Packet validation 09').activities[0];
        assert.ok(packet.total_width < packet.width + timeline.getTextWidth(packet.data.title, main.fontSize + ' ' + main.fontFamily, 6),
            'Labels above bars share horizontal space rather than being appended to the duration');
        timeline.ob_views.setMode('table');
        assert.equal(timeline.ob_views.tablePanel.querySelectorAll('tbody tr').length, 1008, 'The complete dataset remains accessible');
    } finally { harness.close(); }
});

test('Changing the context day exposes surrounding records without another dataset fetch', async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const timeline = new OB_TIMELINE();
        await timeline.loadModel('models/demos/default-dataset.json', {dataset: 'json/test-data/default-dataset.json'});
        timeline.ob_scene.sync_time += day;
        rebuild(timeline);
        const main = timeline.ob_scene[0].bands.find(band => !band.name.includes('overview_'));
        assert.equal(main.sessions.length, 16);
        assert.ok(main.sessions.every(session => session.start.startsWith('2026-09-13')));
        assert.equal(main.timeScale.contextFrom, time('00:00') + day);
        assert.equal(timeline.staticData.events.filter(event => !event.zone).length, 1008);
        assert.equal(harness.requests.length, 2);
    } finally { harness.close(); }
});

test('A nonlinear main view projects real dates into the uniform Overview and highlights the visible range', async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const timeline = new OB_TIMELINE();
        await timeline.loadModel('models/demos/default-dataset.json', {dataset: 'json/test-data/default-dataset.json'});
        const scene = timeline.ob_scene[0];
        const main = scene.bands.find(band => !band.name.includes('overview_'));
        const overview = scene.bands.find(band => band.name.includes('overview_'));
        for (const session of overview.sessions) for (const activity of session.activities) {
            near(activity.pixelOffSetStart, overview.timeScale.toPixel(Date.parse(activity.start)), 'Overview places actual start times');
            if (activity.end) near(activity.width,
                overview.timeScale.toPixel(Date.parse(activity.end)) - overview.timeScale.toPixel(Date.parse(activity.start)),
                'Overview duration remains linear even when the main duration crosses focus boundaries');
        }
        const frame = timeline.ob_timeline_body_frame;
        Object.defineProperty(frame, 'clientWidth', {configurable: true, get: () =>
            timeline.ob_views.mode === 'split' ? Math.floor(scene.width / 2) : scene.width});
        function checkWindow() {
            const mesh = scene.getObjectByName(overview.name).children.find(object =>
                object.userData.overviewViewport && object.userData.sourceBand === main.name);
            assert.ok(mesh);
            const offset = scene.getObjectByName(main.name).position.x;
            const leftTime = main.timeScale.toTime(frame.scrollLeft - scene.width / 2 - offset);
            const rightTime = main.timeScale.toTime(frame.scrollLeft + frame.clientWidth - scene.width / 2 - offset);
            const left = overview.timeScale.toPixel(leftTime), right = overview.timeScale.toPixel(rightTime);
            near(mesh.position.x, (left + right) / 2, 'Range window follows the nonlinear inverse');
            mesh.geometry.computeBoundingBox();
            const size = (mesh.geometry.boundingBox.max.x - mesh.geometry.boundingBox.min.x) * mesh.scale.x;
            near(size, right - left, 'Range window represents actual visible start and end dates');
        }
        timeline.ob_render(0);
        checkWindow();
        timeline.ob_views.setMode('split');
        frame.scrollLeft += 90;
        frame.dispatchEvent(new harness.window.Event('scroll'));
        checkWindow();
    } finally { harness.close(); }
});
