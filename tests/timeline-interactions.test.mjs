import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createTimelineHarness, root} from './helpers/timeline-dom.mjs';

const settle = () => new Promise(resolve => setTimeout(resolve, 30));

async function waitFor(predicate, message) {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
        assert.ok(Date.now() < deadline, message);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

function assertViewportCovered(timeline) {
    const scene = timeline.ob_scene[0];
    const bands = scene.bands.map(band => scene.getObjectByName(band.name));
    let top = scene.ob_camera.top;
    for (const band of bands) {
        const height = band.geometry.parameters.height;
        assert.ok(Math.abs(band.position.y + height / 2 - top) < 0.001,
            `Uncovered space above ${band.name}: camera/band edge ${top}, mesh top ${band.position.y + height / 2}`);
        top = band.position.y - height / 2;
    }
    assert.ok(Math.abs(top - scene.ob_camera.bottom) < 0.001, 'Bands cover the bottom of the viewport');
    assert.equal(scene.ob_renderer.domElement.height, scene.ob_height);
}

for (const mode of ['timeline', 'split']) test(`Server layout covers the viewport through repeated Overview toggles (${mode})`, async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const model = JSON.parse(await fs.readFile(path.join(root, 'models/regular_timeline.json'), 'utf8'));
        const timeline = new OB_TIMELINE();
        timeline.params = model.params;
        Object.assign(timeline.params[0], {date: '2024-05-03T07:00:00Z', showCurrentTime: false});
        timeline.bands = model.bands;
        timeline.initializeTimeline();
        timeline.ob_scene[0].height = timeline.height;
        const events = Array.from({length: 65}, (_, i) => ({id: 'event-' + i,
            start: '2024-05-03T07:00:00Z', end: '2024-05-03T07:15:00Z',
            data: {title: 'Overlapping session ' + i, description: 'Test event'}, render: {color: '#7853ba'}}));
        const payload = {events: []};
        timeline.ob_visible_view = true;
        // Replace transport only; the server renderer, toolbar, and refresh path remain real.
        timeline.load_data = index => {
            const scene = timeline.ob_scene[index];
            scene.sessions = structuredClone(payload);
            timeline.update_scene(index, timeline.header, timeline.params, scene.bands,
                scene.model, scene.sessions, 'Orthographic', null, false);
        };
        timeline.load_data(0);
        await settle();
        timeline.ob_views.setMode(mode);
        assertViewportCovered(timeline);
        for (let i = 0; i < 6; i++) {
            payload.events = events.slice(0, [0, 65, 65, 0, 5, 5][i]);
            (timeline.ob_view.style.visibility === 'visible' ? timeline.ob_view : timeline.ob_no_view).click();
            await settle();
            assertViewportCovered(timeline);
            assert.equal(timeline.ob_views.mode, mode);
            assert.equal(timeline.ob_scene[0].bands.filter(band => band.name.includes('overview_')).length,
                timeline.ob_visible_view ? 1 : 0);
        }
    } finally { harness.close(); }
});

for (const mode of ['timeline', 'split']) test(`Selecting a demo event preserves its descriptor across refreshes (${mode})`, async () => {
    const harness = await createTimelineHarness({calendar: true});
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const timeline = new OB_TIMELINE();
        await timeline.loadModel('models/demos/space_exploration.json', {dataset: 'json/test-data/space_exploration.json'});
        timeline.ob_views.setMode(mode);
        timeline.ob_calendar.click();
        assert.ok(harness.window.document.getElementById(timeline.name + '_cal'));
        for (let i = 0; i < 3; i++) {
            const scene = timeline.ob_scene[0];
            const events = [];
            scene.traverse(object => {
                if (object.isMesh && object.name === '' && object.data && !object.parent.name.includes('overview_')) events.push(object);
            });
            assert.ok(events.length > i, 'Selectable event meshes exist');
            const selected = events[i];
            scene.dragControls.dispatchEvent({type: 'dragstart', object: selected});
            if (i === 1) {
                selected.position.x += 12;
                scene.dragControls.dispatchEvent({type: 'drag', object: selected});
            }
            scene.dragControls.dispatchEvent({type: 'dragend', object: selected});
            await settle();
            const descriptor = harness.window.document.getElementById(timeline.name + '_descriptor');
            assert.ok(descriptor?.textContent.includes(selected.data.data.title), 'Selected descriptor stays visible');
            assert.equal(harness.window.document.getElementById(timeline.name + '_cal'), null, 'Calendar stays closed');
            (timeline.ob_visible_view ? timeline.ob_view : timeline.ob_no_view).click();
            await settle();
            assert.ok(harness.window.document.getElementById(timeline.name + '_descriptor')?.textContent.includes(selected.data.data.title));
            assertViewportCovered(timeline);
        }
        timeline.ob_calendar.click();
        assert.ok(harness.window.document.getElementById(timeline.name + '_cal'), 'Calendar still opens explicitly');
        assert.equal(harness.window.document.getElementById(timeline.name + '_descriptor'), null);
        (timeline.ob_visible_view ? timeline.ob_view : timeline.ob_no_view).click();
        await settle();
        assert.ok(harness.window.document.getElementById(timeline.name + '_cal'), 'An explicitly opened calendar survives a refresh');
        timeline.div_cal.querySelector('tbody td').click();
        await waitFor(() => harness.window.document.getElementById(timeline.name + '_cal'),
            'Date navigation must finish rebuilding the calendar');
        assert.ok(harness.window.document.getElementById(timeline.name + '_cal'), 'Date navigation keeps the calendar open');
        assert.ok(Number.isFinite(timeline.ob_scene.sync_time));
        timeline.ob_open_descriptor(0, timeline.staticData.events.find(event => !event.zone));
        timeline.ob_timeline_right_panel.querySelector('button[aria-label="Close event details"]').click();
        assert.equal(harness.window.document.getElementById(timeline.name + '_descriptor'), null, 'Event details close explicitly');
        assert.equal(timeline.ob_timeline_right_panel.style.visibility, 'hidden');
    } finally { harness.close(); }
});
