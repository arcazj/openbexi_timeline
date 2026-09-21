import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const catalog = JSON.parse(await fs.readFile(new URL('../demos/catalog.json', import.meta.url), 'utf8'));
const html = await fs.readFile(new URL('../demos.html', import.meta.url), 'utf8');
const resources = JSON.parse(await fs.readFile(new URL('../help/resources.json', import.meta.url), 'utf8'));

async function fixture(id = 'monet', page = false) {
    const harness = await createTimelineHarness({calendar: true, ...(page ? {html} : {}),
        url: 'http://localhost/demos.html?demo=' + id + '&token=PRIVATE_TOKEN#PRIVATE_HASH'});
    let timeline;
    if (page) {
        const module = await harness.importModule('src/openbexi_demo.js');
        timeline = await module.demoReady;
    } else {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        timeline = new OB_TIMELINE();
        const selectedDemo = catalog.demos.find(demo => demo.id === id);
        await timeline.loadModel(selectedDemo.model, {dataset: selectedDemo.dataset});
        timeline.demoContext = {id, title: selectedDemo.title, catalog, selectedDemo};
    }
    const helpers = await harness.importModule('src/openbexi_timeline_share.js');
    async function open() {
        timeline.ob_help.click();
        assert.ok(timeline.helpReady, 'The real Help toolbar button creates its asynchronous panel');
        await timeline.helpReady;
        const panel = harness.window.document.getElementById(timeline.name + '_help');
        assert.ok(panel, 'Help is attached to the right panel');
        assert.equal(timeline.ob_timeline_right_panel.style.visibility, 'visible');
        return panel;
    }
    return {...harness, timeline, ...helpers, open};
}

const button = (panel, label) => [...panel.querySelectorAll('button')].find(node => node.textContent === label);
const anchor = (panel, label) => [...panel.querySelectorAll('a')].find(node => node.textContent === label);
const tab = (panel, label) => [...panel.querySelectorAll('[role="tab"]')].find(node => node.textContent === label);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('Help opens in the reserved demo panel, replaces descriptors and calendars, and closes explicitly', async () => {
    const harness = await fixture('monet', true);
    try {
        const {timeline, window} = harness;
        assert.equal(timeline.demoContext.id, 'monet', 'Demo startup supplies the selected public demo');
        timeline.ob_open_descriptor(0, timeline.staticData.events.find(event => !event.zone));
        assert.ok(window.document.getElementById(timeline.name + '_descriptor'));
        let panel = await harness.open();
        assert.equal(window.document.getElementById(timeline.name + '_descriptor'), null);
        assert.equal(panel.parentElement, timeline.ob_timeline_right_panel);
        assert.equal(timeline.ob_timeline_right_panel.parentElement.id, 'demo-side-slot');
        panel.querySelector('[aria-label="Close help"]').click();
        assert.equal(window.document.getElementById(timeline.name + '_help'), null);
        assert.equal(timeline.ob_timeline_right_panel.style.visibility, 'hidden');
        timeline.ob_calendar.click();
        assert.ok(window.document.getElementById(timeline.name + '_cal'));
        panel = await harness.open();
        assert.equal(window.document.getElementById(timeline.name + '_cal'), null);
        timeline.ob_open_descriptor(0, timeline.staticData.events.find(event => !event.zone));
        assert.equal(window.document.getElementById(timeline.name + '_help'), null, 'Selecting an event replaces Help');
        assert.ok(window.document.getElementById(timeline.name + '_descriptor'));
        await harness.open();
        timeline.ob_help.click();
        assert.equal(window.document.getElementById(timeline.name + '_help'), null, 'The toolbar Help control also toggles the panel closed');
    } finally { harness.close(); }
});

test('Help renders configured resource groups and every catalog dataset with usable safe links', async () => {
    const harness = await fixture('jfk');
    try {
        const panel = await harness.open();
        assert.deepEqual([...panel.querySelectorAll('.ob_help_resource_group > .ob_help_section_heading h3')].map(node => node.textContent),
            ['Project', 'Developer docs', 'Guides']);
        assert.match(panel.textContent, /Version 1\.1/);
        for (const resource of resources.sections.flatMap(section => section.links)) {
            if (resource.disabledReason) {
                const disabled = button(panel, resource.label);
                assert.ok(disabled.disabled);
                assert.equal(disabled.title, resource.disabledReason);
                assert.match(disabled.getAttribute('aria-label'), new RegExp(resource.disabledReason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
                continue;
            }
            const link = anchor(panel, resource.label);
            assert.ok(link, resource.label + ' link is visible');
            assert.equal(link.href, new URL(resource.href, 'http://localhost/').href);
            assert.ok(['http:', 'https:'].includes(new URL(link.href).protocol));
            if (resource.download) assert.equal(link.download, resource.download);
            else {
                assert.equal(link.target, '_blank');
                assert.equal(link.rel, 'noopener noreferrer');
            }
        }
        const selector = panel.querySelector('select[aria-label="Local dataset"]');
        assert.equal(selector.options.length, 7);
        assert.deepEqual([...selector.options].map(option => option.value), catalog.demos.map(demo => demo.id));
        assert.equal(selector.value, 'jfk');
        assert.equal(anchor(panel, 'Open dataset').href, 'http://localhost/demos.html?demo=jfk');
        selector.value = 'dinausaurs';
        selector.dispatchEvent(new harness.window.Event('change'));
        assert.equal(anchor(panel, 'Open dataset').href, 'http://localhost/demos.html?demo=dinausaurs');
        assert.doesNotMatch(anchor(panel, 'Open dataset').href, /PRIVATE/);
    } finally { harness.close(); }
});

test('Help tabs support arrow, Home and End navigation with a single selected accessible panel', async () => {
    const harness = await fixture();
    try {
        const panel = await harness.open();
        const tabs = [...panel.querySelectorAll('[role="tab"]')];
        const sections = [...panel.querySelectorAll('[role="tabpanel"]')];
        const assertSelected = index => {
            tabs.forEach((node, i) => {
                assert.equal(node.getAttribute('aria-selected'), String(i === index));
                assert.equal(node.tabIndex, i === index ? 0 : -1);
                assert.equal(sections[i].hidden, i !== index);
                assert.equal(node.getAttribute('aria-controls'), sections[i].id);
                assert.equal(sections[i].getAttribute('aria-labelledby'), node.id);
            });
        };
        assertSelected(0);
        tabs[0].focus();
        for (const [key, expected] of [['ArrowRight', 1], ['ArrowRight', 2], ['ArrowRight', 0],
            ['ArrowLeft', 2], ['Home', 0], ['End', 2]]) {
            harness.window.document.activeElement.dispatchEvent(new harness.window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
            assertSelected(expected);
            assert.equal(harness.window.document.activeElement, tabs[expected]);
        }
        tabs[1].click();
        assertSelected(1);
    } finally { harness.close(); }
});

test('Share copies a sanitized current view and provides a selectable fallback when clipboard access fails', async () => {
    const harness = await fixture('dinausaurs');
    try {
        const {timeline, applyTimelineShareState, window} = harness;
        applyTimelineShareState(timeline, new URLSearchParams({view: 'split', overview: '0', search: 'Tyrannosaurus',
            time: new Date(-130 * timeline.staticTimeAxis.millisecondsPerUnit).toISOString()}));
        const panel = await harness.open();
        tab(panel, 'Share').click();
        const input = panel.querySelector('[aria-label="Link to this view"]');
        const shared = new URL(input.value);
        assert.equal(shared.searchParams.get('demo'), 'dinausaurs');
        assert.equal(shared.searchParams.get('view'), 'split');
        assert.equal(shared.searchParams.get('search'), 'Tyrannosaurus');
        assert.equal(shared.searchParams.get('overview'), '0');
        assert.doesNotMatch(input.value, /PRIVATE/);
        let copied;
        Object.defineProperty(window.navigator, 'clipboard', {configurable: true,
            value: {writeText: async value => { copied = value; }}});
        button(panel, 'Copy link').click();
        await settle();
        assert.equal(copied, input.value);
        assert.equal(input.parentElement.querySelector('[role="status"]').textContent, 'Copied.');
        timeline.ob_views.setMode('table');
        button(panel, 'Copy link').click();
        await settle();
        assert.equal(new URL(copied).searchParams.get('view'), 'table', 'Copy reflects toolbar changes made while Share stays open');
        assert.equal(input.value, copied, 'The displayed link matches the copied current state');
        window.navigator.clipboard.writeText = async () => { throw new Error('Clipboard blocked'); };
        button(panel, 'Copy link').click();
        await settle();
        assert.equal(window.document.activeElement, input);
        assert.equal(input.selectionStart, 0);
        assert.equal(input.selectionEnd, input.value.length);
        assert.match(input.parentElement.querySelector('[role="status"]').textContent, /Ctrl\+C/);
        applyTimelineShareState(timeline, new URLSearchParams({time: timeline.params[0].date, view: 'timeline', search: '', overview: '1'}));
        applyTimelineShareState(timeline, shared.searchParams);
        assert.equal(timeline.formatEventDate(timeline.ob_markerDate), '130 Ma');
        assert.equal(timeline.ob_views.mode, 'split');
        assert.equal(timeline.ob_visible_view, false);
    } finally { harness.close(); }
});

test('Reset reference view restores numeric model time, all records, overview, view mode and scroll', async () => {
    const harness = await fixture('dinausaurs');
    try {
        const {timeline, applyTimelineShareState} = harness;
        const baseline = timeline.params[0].date;
        applyTimelineShareState(timeline, new URLSearchParams({view: 'split', overview: '0', search: 'Tyrannosaurus',
            time: new Date(-130 * timeline.staticTimeAxis.millisecondsPerUnit).toISOString()}));
        timeline.ob_timeline_body_frame.scrollTop = 234;
        timeline.ob_timeline_body_frame.scrollLeft = 125;
        const panel = await harness.open();
        button(panel, 'Reset reference view').click();
        assert.equal(timeline.params[0].date, baseline);
        assert.equal(timeline.ob_scene.sync_time, Date.parse(baseline));
        assert.equal(timeline.formatEventDate(timeline.ob_markerDate), '140 Ma');
        assert.equal(timeline.ob_views.mode, 'timeline');
        assert.equal(timeline.ob_visible_view, true);
        assert.equal(timeline.ob_search_input.value, '');
        assert.equal(timeline.ob_scene[0].ob_search_value, '');
        assert.equal(timeline.ob_scene[0].sessions.events.length, timeline.staticData.events.length);
        assert.equal(timeline.ob_timeline_body_frame.scrollLeft, 0);
        assert.equal(timeline.ob_timeline_body_frame.scrollTop, 0);
        assert.equal(Object.keys(timeline.ob_views.scrollPositions).join(','), 'timeline');
        assert.match(panel.textContent, /Reference view restored/);
        assert.ok(panel.isConnected, 'Reset preserves the open Help panel');
    } finally { harness.close(); }
});

test('Diagnostics refresh counts and copied output excludes private state', async () => {
    const harness = await fixture('dinausaurs');
    try {
        const {timeline, applyTimelineShareState, window} = harness;
        timeline.data = 'https://PRIVATE_ENDPOINT/sessions?token=PRIVATE_AUTH';
        timeline.ob_user_name = 'PRIVATE_USER';
        window.localStorage.setItem('auth', 'PRIVATE_STORAGE');
        const panel = await harness.open();
        tab(panel, 'Diagnostics').click();
        const input = panel.querySelector('[aria-label="Timeline diagnostics"]');
        let report = JSON.parse(input.value);
        assert.equal(report.counts.records, 224);
        assert.equal(report.counts.matchingRecords, 224);
        assert.equal(report.reference.label, '140 Ma');
        applyTimelineShareState(timeline, new URLSearchParams({search: 'PRIVATE_SEARCH', view: 'table'}));
        button(panel, 'Refresh').click();
        report = JSON.parse(input.value);
        assert.equal(report.counts.records, 224);
        assert.equal(report.counts.matchingRecords, 0);
        assert.equal(report.view, 'table');
        assert.equal(report.searchActive, true);
        assert.doesNotMatch(input.value, /PRIVATE_/);
        let copied;
        Object.defineProperty(window.navigator, 'clipboard', {value: {writeText: async value => { copied = value; }}});
        timeline.ob_views.setMode('split');
        button(panel, 'Copy diagnostics').click();
        await settle();
        assert.equal(copied, input.value);
        assert.equal(JSON.parse(copied).view, 'split', 'Copy diagnostics refreshes state changed since the last Refresh');
        assert.equal(input.parentElement.querySelector('[role="status"]').textContent, 'Copied.');
    } finally { harness.close(); }
});

test('Help reports unavailable resources while keeping Share and Diagnostics usable', async () => {
    const harness = await fixture();
    try {
        const fetch = harness.window.fetch;
        harness.window.fetch = resource => String(resource).endsWith('/help/resources.json') ?
            Promise.resolve(new Response('Unavailable', {status: 503})) : fetch(resource);
        const panel = await harness.open();
        assert.match(panel.textContent, /Unable to load Help resources \(503\)/);
        tab(panel, 'Share').click();
        assert.equal(new URL(panel.querySelector('[aria-label="Link to this view"]').value).searchParams.get('demo'), 'monet');
        tab(panel, 'Diagnostics').click();
        assert.equal(JSON.parse(panel.querySelector('[aria-label="Timeline diagnostics"]').value).counts.records, 27);
        panel.querySelector('[aria-label="Close help"]').click();
        assert.equal(panel.isConnected, false);
    } finally { harness.close(); }
});
