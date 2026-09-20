import {OB_TIMELINE} from './openbexi_timeline.js';

export async function startDemoPage() {
    const status = document.getElementById('demo-status');
    const header = document.getElementById('demo-header');
    const catalogURL = new URL('../demos/catalog.json', import.meta.url);
    const response = await fetch(catalogURL);
    if (!response.ok) throw new Error('Unable to load the demo catalog (' + response.status + ').');
    const catalog = await response.json();
    const root = new URL(catalog.basePath, catalogURL);
    const select = document.getElementById('demo-select');
    for (const entry of catalog.demos) {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.title;
        select.appendChild(option);
    }
    const query = new URLSearchParams(location.search);
    const id = query.get('demo') || catalog.demos[0]?.id;
    const demo = catalog.demos.find(entry => entry.id === id);
    if (!demo) throw new Error('Unknown demo. Choose a dataset from the menu.');
    select.value = demo.id;
    document.title = demo.title + ' — OpenBEXI Timeline';
    document.getElementById('demo-description').textContent = demo.description;
    for (const key of ['dataset', 'model', 'reference']) {
        const link = document.getElementById('demo-' + key);
        link.hidden = !demo[key];
        if (demo[key]) link.href = new URL(demo[key], root).href;
    }
    status.textContent = 'Loading ' + demo.title + '…';
    const timeline = new OB_TIMELINE();
    const size = () => ({width: Math.max(640, window.innerWidth - 24), top: header.offsetHeight + 12, left: 12});
    await timeline.loadModel(new URL(demo.model, root).href, {...size(), dataset: new URL(demo.dataset, root).href});
    const view = query.get('view') || 'timeline';
    if (!timeline.ob_views.buttons.has(view)) throw new Error('Unknown view. Use timeline, table, or split.');
    timeline.ob_views.setMode(view);
    const updateStatus = () => {
        const events = timeline.ob_scene[0].sessions.events.filter(event => !event.zone);
        status.textContent = events.length + ' records · ' + (timeline.params[0].timeZoneLabel || 'UTC');
    };
    timeline.ob_timeline_panel.addEventListener('timeline-rendered', updateStatus);
    updateStatus();
    let resize;
    window.addEventListener('resize', () => {
        clearTimeout(resize);
        resize = setTimeout(() => {
            Object.assign(timeline, size());
            timeline.update_scene(0, timeline.header, timeline.params, timeline.ob_scene[0].bands,
                timeline.ob_scene[0].model, timeline.ob_scene[0].sessions, timeline.ob_scene[0].ob_camera_type, null, false);
        }, 150);
    });
    return timeline;
}

export const demoReady = startDemoPage();
demoReady.catch(error => {
    const status = document.getElementById('demo-status');
    status.dataset.error = 'true';
    status.textContent = error.message;
    console.error(error);
});
