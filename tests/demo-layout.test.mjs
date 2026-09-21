import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createTimelineHarness, root} from './helpers/timeline-dom.mjs';

const html = await fs.readFile(path.join(root, 'demos.html'), 'utf8');
const css = await fs.readFile(path.join(root, 'css/ob_demos.css'), 'utf8');
const timelineCSS = await fs.readFile(path.join(root, 'css/ob_timeline_modern.css'), 'utf8');
const catalog = JSON.parse(await fs.readFile(path.join(root, 'demos/catalog.json'), 'utf8'));

async function createDemo(demo) {
    const harness = await createTimelineHarness({html, calendar: true,
        url: 'http://localhost/demos.html?demo=' + demo.id});
    const {window} = harness;
    window.innerWidth = 1600;
    window.innerHeight = 900;
    // jsdom has no layout engine. Supply measured viewport/toolbar sizes; the
    // real scene, event handlers, view controller, and panel DOM remain in use.
    const toolbarHeight = () => 40;
    const document = window.document;
    const workspace = document.getElementById('demo-workspace');
    Object.defineProperties(workspace, {
        clientWidth: {get: () => window.innerWidth},
        clientHeight: {get: () => window.innerHeight}
    });
    const style = document.createElement('style');
    style.textContent = timelineCSS + '\n' + css;
    document.head.appendChild(style);
    const module = await harness.importModule('src/openbexi_demo.js');
    const timeline = await module.demoReady;
    Object.defineProperty(timeline.ob_timeline_header, 'offsetHeight', {get: () => 40});
    async function resize(width, height) {
        window.innerWidth = width;
        window.innerHeight = height;
        window.dispatchEvent(new window.Event('resize'));
        await new Promise(resolve => setTimeout(resolve, 140));
    }
    await resize(1600, 900);
    return {...harness, timeline, resize, workspace, toolbarHeight};
}

for (const demo of catalog.demos) test(demo.id + ': demo resize retains 75/25 slots, views, and event selection', async () => {
    const harness = await createDemo(demo);
    try {
        const {window, timeline, workspace, resize, toolbarHeight} = harness;
        const document = window.document;
        const timelineSlot = document.getElementById('demo-timeline-slot');
        const sideSlot = document.getElementById('demo-side-slot');
        assert.equal(timeline.ob_timeline_panel.parentElement, timelineSlot);
        assert.equal(timeline.ob_timeline_right_panel.parentElement, sideSlot);
        assert.equal(window.getComputedStyle(workspace).gridTemplateColumns, 'minmax(0, 3fr) minmax(0, 1fr)');
        assert.equal(window.getComputedStyle(document.body).overflow, 'hidden');
        assert.equal(window.getComputedStyle(document.body).gridTemplateRows, 'minmax(0, 1fr)', 'Workspace fills the viewport without a page header');
        assert.equal(document.querySelector('body > header'), null);
        assert.equal(document.body.firstElementChild, workspace, 'Timeline toolbar starts at the top of the page');
        const status = document.getElementById('demo-status');
        assert.equal(status.dataset.state, 'ready');
        assert.equal(window.getComputedStyle(status).clipPath, 'inset(50%)', 'Loaded record count is screen-reader only');
        assert.equal(window.getComputedStyle(sideSlot).overflow, 'hidden');
        assert.equal(timeline.ob_timeline_panel_resizer.hidden, true);
        assert.equal(timeline.ob_timeline_header.onmousedown, null);
        assert.equal(timeline.ob_timeline_right_panel.childElementCount, 0, 'Empty side slot stays reserved');
        const toolbarViewport = timeline.ob_timeline_header.parentElement;
        assert.equal(timeline.ob_timeline_header.style.height, '40px', 'Original toolbar height is retained');
        assert.equal(window.getComputedStyle(timeline.ob_timeline_header).display, 'block', 'Toolbar does not wrap or reorder controls');
        assert.equal(window.getComputedStyle(timeline.ob_calendar).position, 'absolute');
        assert.equal(timeline.ob_calendar.style.left, '47px', 'Original control position is retained');
        assert.equal(timeline.ob_search_input.style.left, '214px');
        assert.equal(window.getComputedStyle(timeline.ob_views.controls).position, 'absolute');
        assert.equal(window.getComputedStyle(timeline.ob_time_marker).position, 'absolute');
        assert.equal(window.getComputedStyle(timeline.ob_time_marker).textAlign, 'center');
        assert.notEqual(window.getComputedStyle(timeline.ob_marker).display, 'none', 'Original date marker is visible');
        assert.equal(toolbarViewport.dataset.overflow, 'false');
        for (const region of [timeline.ob_timeline_body_frame, timeline.ob_views.tablePanel,
            timeline.ob_timeline_right_panel]) {
            assert.equal(region.tabIndex, 0, 'Scroll regions remain reachable with the keyboard');
            assert.equal(region.getAttribute('role'), 'region');
            assert.ok(region.getAttribute('aria-label'));
        }

        const first = timeline.staticData.events.find(event => !event.zone);
        timeline.ob_open_descriptor(0, first);
        const descriptor = timeline.ob_timeline_right_panel.firstElementChild;
        const sessions = timeline.ob_scene[0].sessions;
        const referenceTime = timeline.ob_scene.sync_time;
        timeline.ob_timeline_body_frame.scrollTop = 36;
        timeline.ob_views.tablePanel.scrollTop = 24;
        timeline.ob_timeline_right_panel.scrollTop = 12;

        for (const [width, height, mode] of [[1280, 800, 'timeline'], [801, 700, 'table'], [390, 844, 'split'], [320, 568, 'timeline']]) {
            timeline.ob_views.setMode(mode);
            await resize(width, height);
            assert.equal(timeline.width, Math.floor(width * 0.75), 'Renderer fits the 75% timeline slot');
            assert.equal(timeline.height, height - toolbarHeight(), 'Scene fills all viewport space below the original toolbar');
            assert.equal(timeline.params[0].height, timeline.height);
            assert.equal(timeline.ob_views.mode, mode);
            assert.equal(timeline.ob_scene[0].sessions, sessions, 'Resize reuses current data');
            assert.equal(timeline.ob_scene.sync_time, referenceTime, 'Resize keeps the selected time reference');
            assert.equal(timeline.ob_timeline_right_panel.firstElementChild, descriptor, 'Selected descriptor survives resize');
            assert.equal(timeline.ob_timeline_right_panel.style.visibility, 'visible');
            assert.equal(timeline.ob_timeline_body_frame.scrollTop, 36);
            assert.equal(timeline.ob_views.tablePanel.scrollTop, 24);
            assert.equal(timeline.ob_timeline_right_panel.scrollTop, 12);
            assert.equal(workspace.style.getPropertyValue('--demo-toolbar-height'), toolbarHeight() + 'px');
            assert.equal(timeline.ob_timeline_header.style.height, '40px');
            const narrowToolbar = timeline.width < 700;
            assert.equal(toolbarViewport.dataset.overflow, String(narrowToolbar));
            assert.equal(toolbarViewport.tabIndex, narrowToolbar ? 0 : -1, 'Narrow toolbar can be scrolled with the keyboard');
            if (narrowToolbar) assert.equal(window.getComputedStyle(toolbarViewport).overflowX, 'auto');
            assert.equal(window.getComputedStyle(timeline.ob_timeline_body_frame).overflow, 'auto', 'Dense timeline scrolls inside its slot');
            assert.equal(window.getComputedStyle(timeline.ob_views.tablePanel).overflow, 'auto');
            for (const region of [timeline.ob_timeline_body_frame, timeline.ob_views.tablePanel,
                timeline.ob_timeline_right_panel, toolbarViewport]) {
                assert.equal(window.getComputedStyle(region).getPropertyValue('scrollbar-width'), 'none',
                    'Scrolling remains available without consuming space for scrollbar tracks');
            }
            assert.equal(timeline.ob_views.tablePanel.hidden, mode === 'timeline');
            assert.equal(timeline.ob_timeline_body_frame.hidden, mode === 'table');
            if (mode === 'split') {
                assert.equal(parseInt(timeline.ob_timeline_body_frame.style.width), Math.floor(timeline.width / 2));
                assert.equal(parseInt(timeline.ob_views.tablePanel.style.width), timeline.width - Math.floor(timeline.width / 2));
            }
        }
        timeline.ob_remove_descriptor();
        await resize(1440, 900);
        assert.equal(timeline.ob_timeline_right_panel.childElementCount, 0);
        assert.equal(timeline.ob_timeline_right_panel.style.visibility, 'hidden');
        assert.equal(timeline.width, 1080, 'Closing a panel does not expand the timeline');

        if (timeline.staticTimeAxis?.kind !== 'numeric') {
            timeline.ob_calendar.click();
            assert.ok(timeline.ob_timeline_right_panel.querySelector('.jsCalendar'));
            await resize(390, 844);
            assert.equal(timeline.ob_timeline_right_panel.parentElement, sideSlot);
            assert.equal(timeline.ob_timeline_right_panel.style.visibility, 'visible');
            assert.equal(window.getComputedStyle(timeline.ob_timeline_right_panel).overflow, 'auto');
            assert.ok(timeline.ob_timeline_right_panel.querySelector('.jsCalendar'), 'Calendar remains in the reserved slot');
        }
    } finally { harness.close(); }
});
