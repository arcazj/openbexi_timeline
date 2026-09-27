import {OB_TIMELINE} from './openbexi_timeline.js';
import {applyTimelineShareState} from './openbexi_timeline_share.js';
import {validateDemoCatalog} from './openbexi_timeline_model_validation.js';

export function getDemoLayout(workspace, toolbar) {
    const width = workspace.clientWidth || document.documentElement.clientWidth || window.innerWidth;
    const height = workspace.clientHeight || window.innerHeight;
    return {width:Math.max(1,width), height:Math.max(1,height), top:0, left:0, toolbarHeight:toolbar?.offsetHeight || 108};
}

function installDemoLayout(timeline, workspace) {
    document.getElementById('demo-timeline-slot').appendChild(timeline.ob_timeline_panel);
    document.getElementById('demo-side-slot').appendChild(timeline.ob_timeline_right_panel);
    timeline.ob_timeline_right_panel.setAttribute('role','region');
    timeline.ob_timeline_right_panel.setAttribute('aria-label','Timeline details and settings');
    timeline.ob_timeline_right_panel.tabIndex=0;
    timeline.ob_viewport.schedule();
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
    timeline.layoutHost = workspace;
    timeline.demoContext = {id: demo.id, title: demo.title, catalog, rootURL: root.href,
        datasetURL: new URL(demo.dataset, root).href, modelURL: new URL(demo.model, root).href};
    await timeline.loadModel(new URL(demo.model, root).href,
        {dataset: new URL(demo.dataset, root).href});
    applyTimelineShareState(timeline, query);
    const updateStatus = () => {
        const sessions = timeline.ob_scene[0].sessions;
        const events = (sessions.densityRecords || sessions.events).filter(event => !event.zone);
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
