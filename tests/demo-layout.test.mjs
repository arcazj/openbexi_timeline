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
    const toolbarHeight = () => window.innerWidth < 700 ? 260 : 112;
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
    Object.defineProperty(timeline.ob_timeline_header, 'offsetHeight', {get: toolbarHeight});
    async function resize(width, height) {
        window.innerWidth = width;
        window.innerHeight = height;
        window.dispatchEvent(new window.Event('resize'));
        // Resize and descriptor observers share a debounce. Wait for the
        // resulting layout instead of assuming a timer has already fired.
        const deadline=Date.now()+5000;
        do { await new Promise(resolve=>setTimeout(resolve,25)); }
        while ((timeline.height!==height || timeline.ob_viewport.headerHeight!==toolbarHeight() ||
            timeline.ob_results.pending || timeline.ob_results.resizeQueued) && Date.now()<deadline);
    }
    await resize(1600, 900);
    return {...harness, timeline, resize, workspace, toolbarHeight};
}

for (const demo of catalog.demos) test(demo.id + ': bounded responsive views retain selection and data', async () => {
    const harness = await createDemo(demo);
    try {
        const {window,timeline:t,workspace,resize,toolbarHeight}=harness;
        const v=t.ob_viewport,document=window.document;
        assert.equal(t.width,1600,'Closed panels leave the full browser width available');
        assert.equal(t.height,900);
        assert.equal(v.preference.fullWindow,true);
        assert.equal(t.ob_timeline_panel.parentElement,document.getElementById('demo-timeline-slot'));
        assert.equal(t.ob_timeline_right_panel.parentElement,document.getElementById('demo-side-slot'));
        assert.equal(window.getComputedStyle(document.body).overflow,'hidden');
        assert.equal(document.body.firstElementChild,workspace);
        assert.equal(document.getElementById('demo-status').dataset.state,'ready');
        assert.equal(t.ob_timeline_panel_resizer.hidden,true);
        assert.equal(t.ob_timeline_header.onmousedown,null);
        const search=[...t.ob_results.search.children];
        const input=search.indexOf(t.ob_search_input);
        assert.equal(t.ob_timeline_header.querySelector('[aria-label="Search mode"]'),null);
        assert.equal(t.ob_timeline_header.querySelector('button[aria-label="Zoom in"], button[aria-label="Zoom out"]'),null);
        assert.ok(t.ob_results.controls.activityControls.contains(t.ob_results.explorer.findPrevious));
        assert.equal(t.ob_filter.parentElement,t.ob_results.filterButton);
        for (const icon of [t.ob_view]) {
            assert.ok(icon.previousElementSibling.classList.contains('ob_toolbar_separator'));
            assert.equal(icon.previousElementSibling.getAttribute('aria-hidden'),'true');
        }
        const first=t.staticData.events.find(e=>!e.zone);
        t.ob_open_descriptor(0,first);
        const deadline=Date.now()+15000;
        while(t.ob_results.focusAnimation || t.ob_results.pending) {
            assert.ok(Date.now()<deadline,'Selection centering must finish before resizing');
            await new Promise(resolve=>setTimeout(resolve,25));
        }
        const descriptor=t.ob_timeline_right_panel.firstElementChild;
        const ids=t.ob_results.snapshot.entries.map(e=>e.key).join(',');
        const time=t.ob_scene.sync_time;
        for (const [width,height,mode] of [[1280,800,'timeline'],[801,700,'table'],[390,844,'split'],[320,568,'timeline']]) {
            t.ob_views.setMode(mode); await resize(width,height);
            const side=width>=900?Math.min(480,Math.max(320,Math.round(width*0.22))):0;
            assert.equal(t.width,width-side);
            assert.equal(t.height,height);
            assert.equal(t.ob_scene[0].width,mode==='split'?Math.floor(t.width/2):t.width);
            assert.equal(t.ob_scene.sync_time,time,'Selected time survives resize');
            assert.equal(t.ob_results.snapshot.entries.map(e=>e.key).join(','),ids);
            assert.equal(t.ob_timeline_right_panel.firstElementChild,descriptor);
            assert.equal(t.ob_timeline_body_frame.scrollTop,0);
            assert.equal(t.ob_timeline_body_frame.scrollLeft,0);
            for (const region of [t.ob_timeline_body_frame,t.ob_views.tablePanel]) {
                assert.equal(window.getComputedStyle(region).overflow,'hidden');
                assert.equal(region.getAttribute('role'),'region');
            }
            assert.equal(v.headerHeight,toolbarHeight());
            assert.ok(v.detailHeight+v.headerHeight+v.overviewHeight+v.pagerHeight<=height);
            assert.equal(t.ob_views.tablePanel.hidden,mode==='timeline');
            assert.equal(t.ob_timeline_body_frame.hidden,mode==='table');
            assert.ok(v.pageIndex>=0 && v.pageIndex<v.pages.length);
        }
        t.ob_remove_descriptor(); await resize(1440,900);
        assert.equal(t.width,1440,'Closing a panel restores available width');
        if (t.staticTimeAxis?.kind!=='numeric') {
            t.ob_calendar.click(); await resize(390,844);
            assert.ok(t.ob_timeline_right_panel.querySelector('.jsCalendar'));
            assert.equal(v.overlay,true);
            assert.equal(t.width,390);
        }
    } finally { harness.close(); }
});
