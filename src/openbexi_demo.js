import {OB_TIMELINE} from './openbexi_timeline.js';
import {applyTimelineShareState} from './openbexi_timeline_share.js';
import {validateDemoCatalog} from './openbexi_timeline_model_validation.js';

const minimumToolbarWidth = 700;

// The two slots retain the same proportions even when the side panel is empty.
export function getDemoLayout(workspace, toolbar) {
    const width = workspace.clientWidth || document.documentElement.clientWidth || window.innerWidth;
    const availableHeight = workspace.clientHeight || Math.max(1, window.innerHeight);
    const timelineWidth = Math.max(1, Math.floor(width * 0.75));
    const toolbarHeight = toolbar?.offsetHeight || 40;
    return {width: timelineWidth, height: Math.max(1, availableHeight - toolbarHeight),
        top: 0, left: 0, toolbarHeight};
}

function installDemoLayout(timeline, workspace) {
    const timelineSlot = document.getElementById('demo-timeline-slot');
    const sideSlot = document.getElementById('demo-side-slot');
    timelineSlot.appendChild(timeline.ob_timeline_panel);
    sideSlot.appendChild(timeline.ob_timeline_right_panel);
    timeline.ob_timeline_body_frame.classList.add('ob_demo_timeline_viewport');
    for (const [region, label] of [[timeline.ob_timeline_body_frame, 'Timeline events'],
        [timeline.ob_timeline_right_panel, 'Timeline details and settings']]) {
        region.setAttribute('role', 'region');
        region.setAttribute('aria-label', label);
        region.tabIndex = 0;
    }
    // Retain the original toolbar layout. At small widths it scrolls as a whole
    // instead of wrapping, reordering, or overlapping its existing controls.
    const toolbarViewport = document.createElement('div');
    toolbarViewport.className = 'ob_demo_toolbar_viewport';
    toolbarViewport.setAttribute('role', 'region');
    toolbarViewport.setAttribute('aria-label', 'Timeline toolbar');
    timeline.ob_timeline_header.before(toolbarViewport);
    toolbarViewport.appendChild(timeline.ob_timeline_header);
    timeline.ob_timeline_header.style.minWidth = minimumToolbarWidth + 'px';
    // The page owns these boundaries. Header dragging and the legacy resize grip
    // must not displace a panel into the neighboring reserved slot.
    for (const event of ['onmousedown', 'onmousemove', 'onmouseup', 'onmouseout']) timeline.ob_timeline_header[event] = null;
    timeline.ob_timeline_panel_resizer.hidden = true;

    let current;
    let resize;
    let pendingScroll;
    const restoreLayout = () => {
        const panel = timeline.ob_timeline_right_panel;
        if (pendingScroll) {
            timeline.ob_timeline_body_frame.scrollTop = pendingScroll.timeline;
            timeline.ob_views.tablePanel.scrollTop = pendingScroll.table;
            panel.scrollTop = pendingScroll.panel;
            pendingScroll = undefined;
        }
    };
    const fit = () => {
        const layout = getDemoLayout(workspace, timeline.ob_timeline_header);
        workspace.style.setProperty('--demo-toolbar-height', layout.toolbarHeight + 'px');
        const toolbarOverflows = layout.width < minimumToolbarWidth;
        toolbarViewport.dataset.overflow = String(toolbarOverflows);
        toolbarViewport.tabIndex = toolbarOverflows ? 0 : -1;
        if (current && current.width === layout.width && current.height === layout.height) return;
        current = layout;
        pendingScroll = {timeline: timeline.ob_timeline_body_frame.scrollTop,
            table: timeline.ob_views.tablePanel.scrollTop, panel: timeline.ob_timeline_right_panel.scrollTop};
        Object.assign(timeline, {width: layout.width, height: layout.height, top: 0, left: 0});
        Object.assign(timeline.params[0], {width: layout.width, height: layout.height, top: 0, left: 0});
        const scene = timeline.ob_scene[0];
        // Reuse current sessions, filters, time reference, and view controller.
        timeline.update_all_timelines(0, timeline.header, timeline.params, scene.bands,
            scene.model, scene.sessions, scene.ob_camera_type);
    };
    const schedule = () => {
        clearTimeout(resize);
        resize = setTimeout(fit, 100);
    };
    timeline.ob_timeline_panel.addEventListener('timeline-rendered', restoreLayout);
    window.addEventListener('resize', schedule);
    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(schedule);
        observer.observe(workspace);
        observer.observe(timeline.ob_timeline_header);
    }
    fit();
}

export async function startDemoPage() {
    const status = document.getElementById('demo-status');
    const workspace = document.getElementById('demo-workspace');
    const catalogURL = new URL('../demos/catalog.json', import.meta.url);
    const response = await fetch(catalogURL);
    if (!response.ok) throw new Error('Unable to load the demo catalog (' + response.status + ').');
    const catalog = validateDemoCatalog(await response.json(), {label: 'demos/catalog.json'});
    const root = new URL(catalog.basePath, catalogURL);
    const query = new URLSearchParams(location.search);
    const id = query.get('demo') || catalog.demos[0]?.id;
    const demo = catalog.demos.find(entry => entry.id === id);
    if (!demo) throw new Error('Unknown demo. Open a live demo from the README.');
    document.title = demo.title + ' — OpenBEXI Timeline';
    workspace.setAttribute('aria-label', demo.title + ' live timeline demo');
    status.textContent = 'Loading ' + demo.title + '…';
    const timeline = new OB_TIMELINE();
    timeline.demoContext = {id: demo.id, title: demo.title, catalog, rootURL: root.href,
        datasetURL: new URL(demo.dataset, root).href, modelURL: new URL(demo.model, root).href};
    await timeline.loadModel(new URL(demo.model, root).href,
        {...getDemoLayout(workspace), dataset: new URL(demo.dataset, root).href});
    applyTimelineShareState(timeline, query);
    const updateStatus = () => {
        const events = timeline.ob_scene[0].sessions.events.filter(event => !event.zone);
        status.textContent = events.length + ' records · ' + (timeline.params[0].timeZoneLabel || 'UTC');
        status.dataset.state = 'ready';
    };
    timeline.ob_timeline_panel.addEventListener('timeline-rendered', updateStatus);
    installDemoLayout(timeline, workspace);
    updateStatus();
    return timeline;
}

export const demoReady = startDemoPage();
demoReady.catch(error => {
    const status = document.getElementById('demo-status');
    status.dataset.error = 'true';
    status.dataset.state = 'error';
    status.textContent = error.message;
    console.error(error);
});
