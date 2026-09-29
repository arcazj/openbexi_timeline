import {allTableRows} from './helpers/table-pages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

async function load(demo = 'default-dataset') {
    const harness = await createTimelineHarness();
    const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
    const {syncOverviewPanel} = await harness.importModule('src/openbexi_timeline_overview_panel.js');
    harness.window.innerWidth=1200;harness.window.innerHeight=768;
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
        assert.ok(parseFloat(panel.style.height) <= 180);
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
        const contextNode=svg.querySelector('[data-overview-heading="count"]');
        timeline.ob_results.complete=false; sync();
        assert.match(contextNode.textContent,/loaded records \/ partial context/);
        timeline.ob_results.complete=true; sync();
        assert.match(contextNode.textContent,/records \/ full context/);
        assert.equal(svg.querySelector('[data-overview-heading="count"]'),contextNode);
        assert.ok(svg.querySelector('[data-overview-window]'));
        const sources=timeline.ob_viewport.fullBands.filter(band=>!band.name.includes('overview_'));
        for(const source of sources) {
            const background=[...svg.querySelectorAll('[data-overview-band]')].find(node=>node.dataset.overviewBand===source.name);
            assert.equal(background.getAttribute('fill'),source.color);
        }
        const color=sources[0].color;sources[0].color='#123456';sync();
        assert.equal(svg.querySelector('[data-overview-band]').getAttribute('fill'),'#123456','In-place band color edits repaint the overview');
        sources[0].color=color;sync();
        assert.equal(scene.ob_renderer.domElement.height, Math.floor(scene.ob_height), 'WebGL canvas dimensions stay intact');
        assert.ok(parseFloat(timeline.ob_timeline_body.style.height) < scene.ob_height, 'Only the original overview tail/axis is cropped');
        assert.equal(timeline.ob_timeline_body.style.overflow, 'hidden');

        timeline.ob_views.setMode('split');
        await new Promise(resolve=>setTimeout(resolve,40));sync();
        assert.equal(panel.style.width,'600px');
        assert.equal(timeline.ob_timeline_body.style.width,'600px');
        assert.equal(svg.style.left,'0px');
        assert.equal(svg.getAttribute('width'),'600');
        assert.equal(Number(svg.querySelector('[data-overview-heading="count"]').getAttribute('x')),592);
        timeline.ob_views.setMode('table');sync();
        assert.equal(panel.hidden,true);
        timeline.ob_views.setMode('timeline');
        await new Promise(resolve=>setTimeout(resolve,40));sync();
        assert.equal(timeline.ob_timeline_panel.querySelectorAll('.ob_docked_overview').length,1);
    } finally { harness.close(); }
});

test('Docked overview navigation follows actual time mappings and commits click, drag, and keyboard interactions', async () => {
    const harness = await load();
    try {
        const {timeline, sync, window} = harness;
        timeline.params[0].dockOverview = true;
        sync();
        let svg = timeline.ob_timeline_panel.querySelector('.ob_docked_overview svg');
        svg.getBoundingClientRect = () => ({left: 0, width: 1200});
        const overview = timeline.ob_scene[0].bands.at(-1);
        const expectedTime = timeline.pixelOffSetToBandDate(0, overview, 300).getTime();
        let refreshes = 0;
        const loadData=timeline.load_data.bind(timeline);
        timeline.load_data = (...args) => { refreshes++;return loadData(...args); };
        const pointer = (type, x) => {
            const event = new window.MouseEvent(type, {button: 0, clientX: x, bubbles: true, cancelable: true});
            Object.defineProperty(event, 'pointerId', {value: 1});
            svg.dispatchEvent(event);
        };
        pointer('pointerdown', 900);
        pointer('pointerup', 900);
        assert.equal(timeline.ob_scene.sync_time, expectedTime, 'A click chooses the overview date using its actual axis');
        assert.equal(refreshes, 1);
        await new Promise(resolve=>setTimeout(resolve,50));
        sync();
        svg=timeline.ob_timeline_panel.querySelector('.ob_docked_overview svg');
        svg.getBoundingClientRect=()=>({left:0,width:1200});
        const mesh = timeline.ob_scene[0].getObjectByName(overview.name);
        const oldX = mesh.position.x;
        pointer('pointerdown', 600);
        pointer('pointermove', 650);
        const indicator=svg.querySelector('[data-overview-window]');
        assert.ok(Math.abs(Number(indicator.getAttribute('x'))+Number(indicator.getAttribute('width'))/2-600)<1e-6,
            'Overview translates its context while keeping the visible indicator centered');
        assert.notEqual(mesh.position.x,oldX);
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
            assert.equal(svg.querySelector('[data-overview-axis="main"]'),null,'The current-view axis is drawn only in the main band');
            const mainAxis = svg.querySelector('[data-overview-axis="overview"]');
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
            assert.ok(firstTicks.some(line=>line.isConnected), demo + ': the distinct Overview axis retains its tick nodes');
            assert.ok([...mainAxis.querySelectorAll('line')].every(line=>Number.isFinite(Number(line.getAttribute('x1')))));
            const left = -scene.width / 2 - mainMesh.position.x;
            const start = timeline.dateToBandPixelOffSet(0, overview, timeline.pixelOffSetToBandDate(0, main, left));
            const end = timeline.dateToBandPixelOffSet(0, overview, timeline.pixelOffSetToBandDate(0, main, left + scene.width));
            const projectedLeft=scene.width/2+overviewMesh.position.x+start,projectedRight=scene.width/2+overviewMesh.position.x+end;
            assert.ok(Math.abs(Number(selection.getAttribute('x')) - Math.max(0,Math.min(scene.width-2,projectedLeft))) < 1e-7);
            assert.ok(Math.abs(Number(selection.getAttribute('width')) - Math.max(2,Math.min(scene.width,projectedRight)-Math.max(0,projectedLeft))) < 1e-7,
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

test('All enabled overviews remain bounded beside paginated detail, including models without a dock preference',async()=>{
    for(const demo of ['space_exploration','monet','jfk','religions']) {
        const h=await load(demo);
        try {
            const t=h.timeline,v=t.ob_viewport;h.sync();
            const panels=[...t.ob_timeline_panel.querySelectorAll('.ob_docked_overview')];
            const overviews=t.ob_scene[0].bands.filter(b=>b.name.includes('overview_'));
            assert.equal(panels.length,overviews.length);
            assert.equal(panels.reduce((sum,p)=>sum+parseFloat(p.style.height),0),v.overviewHeight);
            assert.equal(parseFloat(t.ob_timeline_body.style.height),v.detailHeight);
            assert.ok(v.detailHeight+v.headerHeight+v.pagerHeight+v.overviewHeight<=t.height);
            for(const p of panels) assert.equal(p.hidden,false);
        } finally {h.close();}
    }
});

test('Page geometry leaves room for row labels, session boxes and scale headers',async()=>{
    for(const demo of ['default-dataset','monet']) {
        const h=await load(demo);
        try {
            const t=h.timeline,v=t.ob_viewport;
            for(let page=0;page<v.pages.length;page++) {
                v.go(page);await new Promise(resolve=>setTimeout(resolve,40));
                for(const b of t.ob_scene[0].bands.filter(b=>!b.name.includes('overview_'))) {
                    for(const session of b.sessions) {
                        for(const activity of session.activities) {
                            assert.ok(activity.y-(b.fontSizeInt/2)>=-b.height/2,'No label crosses a page boundary');
                            assert.ok(activity.y+b.fontSizeInt/2<b.height/2,'Rows leave room for the header');
                        }
                        if(session.activities.length>1) assert.ok(session.y-session.height/2>=-b.height/2);
                    }
                }
            }
        } finally {h.close();}
    }
});

test('Religions keeps Judaism and Christianity in their own bands and overviews without losing table records', async () => {
    const harness = await load('religions');
    try {
        const {timeline, sync} = harness;
        sync();
        const scene = timeline.ob_scene[0];
        const byName = name => scene.bands.find(band => band.name === name);
        const judaism = timeline.ob_viewport.fullBands.find(b=>b.name==='ob_band_durations');
        const christianity = timeline.ob_viewport.fullBands.find(b=>b.name==='ob_band_events');
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
        assert.ok(ids(judaism).every(id => ids(top).includes(id)), 'Overview includes offscreen eligible Jewish durations');
        assert.ok(ids(christianity).every(id => ids(bottom).includes(id)), 'Overview includes offscreen eligible Christian records');
        assert.ok(judaism.sessions.some(session => session.data.title === 'Canonicalization of Tanakh'));
        assert.ok(judaism.sessions.some(session => session.data.title === 'Christianity splits from Judaism'));
        assert.ok(christianity.sessions.some(session => session.data.title === 'Anno Domini'));
        const tiberius = christianity.sessions.find(session => session.data.title === 'Tiberius, Roman Emperor');
        assert.ok(tiberius?.end, 'Christian durations remain with Christian point events');
        assert.ok(!top.sessions.some(session => session.id === tiberius.id), 'Christian durations are not duplicated above');

        const panel = timeline.ob_timeline_panel.querySelector('[data-overview-band="ob_overview_band_bottom"]');
        const svg = panel.querySelector('svg');
        const panelHeight = timeline.ob_viewport.overviewHeight / scene.bands.filter(b=>b.name.includes('overview_')).length;
        assert.equal(parseFloat(panel.style.height), panelHeight);
        assert.equal(svg.querySelector('[data-overview-heading="title"]').textContent, 'Linear overview');
        assert.ok([...svg.querySelectorAll('[data-source-band]')].every(element =>
            element.getAttribute('data-source-band') === 'ob_band_events'));
        const axisLabels = [...svg.querySelectorAll('text')].filter(element =>
            Number(element.getAttribute('y')) === panelHeight - 4).map(element => element.textContent);
        assert.ok(axisLabels.some(label => label.includes('BCE')), 'Linear full-scope overview retains historical context');
        assert.ok(axisLabels.some(label => !label.includes('BCE')), 'The same axis includes common-era dates');

        timeline.ob_views.setMode('table');
        assert.equal(allTableRows(timeline.ob_views).length, 730,
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
        const panelHeight = timeline.ob_viewport.overviewHeight / scene.bands.filter(b=>b.name.includes('overview_')).length;
        assert.equal(parseFloat(panel.style.height), panelHeight);
        const axisLabels = [...svg.querySelectorAll('text')].filter(element =>
            Number(element.getAttribute('y')) === panelHeight - 4).map(element => element.textContent);
        assert.ok(axisLabels.length > 2, 'Linear overview retains calendar labels across the full data domain');
        assert.equal(overview.timeScale.magnification, 1);
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
        assert.ok(Math.abs(Number(window.getAttribute('width')) - Math.max(2,end - start)) < 1e-8,
            'The selection represents the actual two-hour main range through the magnified overview');
        const uniformWidth = scene.width * (2 * 60 * 60 * 1000) /
            (overview.timeScale.to - overview.timeScale.from);
        assert.ok(Math.abs(Number(window.getAttribute('width')) - Math.max(2,uniformWidth)) < 1e-8,
            'Linear overview keeps a visible minimum width for very small detail windows');
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
        assert.ok(parseFloat(timeline.ob_timeline_header.style.height) >= 108, 'Results controls receive their own toolbar row');
        assert.equal(main.timeScale.from, Date.parse('1824-01-01'));
        assert.equal(main.timeScale.to, Date.parse('1916-01-01'));
        assert.equal(overview.timeScale.to-overview.timeScale.from, Date.parse('1929-01-01')-Date.parse('1824-01-01'));
        assert.equal(overview.timeScale.to+overview.timeScale.from,main.timeScale.to+main.timeScale.from);
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
        assert.ok(overviewTicks.includes('1825') && overviewTicks.includes('1920'));
        assert.ok(overviewTicks.includes('1850') && overviewTicks.includes('1855'), 'Overview uses five-year calendar ticks');
        timeline.ob_views.setMode('table');
        assert.equal(allTableRows(timeline.ob_views).length, 27);
    } finally { harness.close(); }
});
