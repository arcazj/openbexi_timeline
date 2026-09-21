import {buildTimelineShareURL, applyTimelineShareState, getTimelineDiagnostics} from './openbexi_timeline_share.js';

const rootURL = new URL('../', import.meta.url);
const paths = {
    help: 'M12 17h.01 M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    share: 'M8 11l8-5 M8 13l8 5 M8 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M22 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M22 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    diagnostics: 'M2 12h4l3-9 5 18 3-9h5',
    github: 'M6 7v7a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V7 M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M12 22v-8 M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
    book: 'M12 5v16 M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1',
    history: 'M3 3v6h6 M3 9a9 9 0 1 1 0 7 M12 7v5l4 2',
    license: 'M12 3v18 M5 21h14 M3 7h18 M6 7l-4 8h8L6 7 M18 7l-4 8h8l-4-8',
    code: 'M8 3H6v7l-3 2 3 2v7h2 M16 3h2v7l3 2-3 2v7h-2',
    file: 'M4 2h10l6 6v14H4z M14 2v6h6 M8 12h8 M8 16h8',
    globe: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M2 12h20 M12 2c-5 5-5 15 0 20 5-5 5-15 0-20',
    layout: 'M3 3h18v14H3z M8 21h8 M12 17v4',
    database: 'M3 6c0-5 18-5 18 0s-18 5-18 0 M3 6v12c0 5 18 5 18 0V6 M3 12c0 5 18 5 18 0',
    layers: 'M12 2L2 7l10 5 10-5-10-5 M2 12l10 5 10-5 M2 17l10 5 10-5',
    check: 'M3 5l2 2 3-4 M11 5h10 M3 12l2 2 3-4 M11 12h10 M3 19l2 2 3-4 M11 19h10',
    server: 'M3 5l6 7-6 7 M12 19h9',
    download: 'M12 2v13 M7 10l5 5 5-5 M4 15v6h16v-6',
    folder: 'M2 6V4h7l3 3h10v13H2V6 M2 10h20',
    reset: 'M3 3v6h6 M3 9a9 9 0 1 1 0 7',
    design: 'M3 3h18v14H3z M8 21h8 M12 17v4',
    architecture: 'M9 2h6v5H9z M3 17h6v5H3z M15 17h6v5h-6z M12 7v5 M6 17v-5h12v5',
    tests: 'M3 5l2 2 3-4 M11 5h10 M3 12l2 2 3-4 M11 12h10 M3 19l2 2 3-4 M11 19h10',
    terminal: 'M3 5l6 7-6 7 M12 19h9',
    copy: 'M8 8h13v13H8z M16 8V3H3v13h5',
    close: 'M6 6l12 12 M18 6L6 18'
};
const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};
function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', paths[name] || paths.book);
    svg.appendChild(path);
    return svg;
}
function action(label, name, tag = 'button') {
    const node = element(tag, 'ob_help_action');
    if (tag === 'button') node.type = 'button';
    node.append(icon(name), element('span', '', label));
    return node;
}
async function readJSON(path) {
    const response = await fetch(new URL(path, rootURL));
    if (!response.ok) throw new Error('Unable to load Help resources (' + response.status + ').');
    return response.json();
}
function resourceLink(resource) {
    if (resource.disabledReason) {
        const node = action(resource.label, resource.icon);
        node.disabled = true;
        node.title = resource.disabledReason;
        node.setAttribute('aria-label', resource.label + ': ' + resource.disabledReason);
        return node;
    }
    const url = new URL(resource.href, rootURL);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const node = action(resource.label, resource.icon, 'a');
    node.href = url.href;
    if (resource.download) node.download = typeof resource.download === 'string' ? resource.download : url.pathname.split('/').at(-1);
    else { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
    return node;
}
async function copyText(input, status) {
    try {
        await navigator.clipboard.writeText(input.value);
        status.textContent = 'Copied.';
    } catch {
        input.focus();
        input.select();
        status.textContent = 'Select and copy the text with Ctrl+C or your browser’s copy command.';
    }
}

export function createTimelineHelp(timeline, sceneIndex = 0) {
    const panel = element('section', 'ob_help_panel');
    panel.id = timeline.name + '_help';
    panel.setAttribute('aria-label', 'Help and sharing');
    const heading = element('div', 'ob_help_heading');
    heading.append(element('h2', '', 'Help and sharing'));
    const close = action('Close', 'close');
    close.setAttribute('aria-label', 'Close help');
    close.addEventListener('click', () => { timeline.ob_remove_help(); timeline.ob_help?.focus(); });
    heading.append(close);
    panel.append(heading);
    const tabs = element('div', 'ob_help_tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Help sections');
    panel.append(tabs);
    const buttons = [], sections = [];
    let updateShare = () => {}, updateDiagnostics = () => {};
    const selectTab = index => {
        buttons.forEach((button, i) => {
            button.setAttribute('aria-selected', String(i === index));
            button.tabIndex = i === index ? 0 : -1;
            sections[i].hidden = i !== index;
        });
        if (index === 1) updateShare();
        if (index === 2) updateDiagnostics();
    };
    for (const [key, label] of [['help', 'Help'], ['share', 'Share'], ['diagnostics', 'Diagnostics']]) {
        const index = buttons.length;
        const button = action(label, key);
        button.id = panel.id + '_tab_' + key;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-controls', panel.id + '_' + key);
        button.addEventListener('click', () => selectTab(index));
        const section = element('div', 'ob_help_tabpanel');
        section.id = panel.id + '_' + key;
        section.setAttribute('role', 'tabpanel');
        section.setAttribute('aria-labelledby', button.id);
        buttons.push(button); sections.push(section);
        tabs.append(button); panel.append(section);
    }
    tabs.addEventListener('keydown', event => {
        const current = buttons.indexOf(document.activeElement);
        if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
            (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        selectTab(next); buttons[next].focus();
    });

    const help = sections[0];
    const loading = element('p', 'ob_help_note', 'Loading Help resources…');
    loading.setAttribute('role', 'status');
    help.append(loading);
    panel.ready = Promise.all([readJSON('help/resources.json'),
        timeline.demoContext?.catalog || readJSON('demos/catalog.json')]).then(([resources, catalog]) => {
        loading.remove();
        for (const section of resources.sections) {
            const group = element('section', 'ob_help_resource_group');
            const title = element('div', 'ob_help_section_heading');
            title.append(element('h3', '', section.title));
            if (section.title === 'Project') title.append(element('span', 'ob_help_note', 'Version ' + resources.version));
            group.append(title);
            const links = element('div', 'ob_help_actions');
            for (const resource of section.links) {
                const link = resourceLink(resource); if (link) links.append(link);
                if (resource.probe && link) {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 4000);
                    fetch(new URL(resource.probe, rootURL), {signal: controller.signal}).then(async response => {
                        if (response.ok && (await response.json()).apiVersion === '1') {
                            const available = resourceLink({...resource, disabledReason: undefined});
                            if (available) link.replaceWith(available);
                        }
                    }).catch(() => {}).finally(() => clearTimeout(timeout));
                }
            }
            group.append(links); help.append(group);
        }
        const datasetGroup = element('section', 'ob_help_resource_group ob_help_datasets');
        datasetGroup.append(element('h3', '', 'Test local data'));
        const selector = element('select');
        selector.setAttribute('aria-label', 'Local dataset');
        for (const demo of catalog.demos) {
            const option = element('option', '', demo.title);
            option.value = demo.id;
            selector.append(option);
        }
        selector.value = timeline.demoContext?.id || catalog.demos[0]?.id || '';
        const open = action('Open dataset', 'folder', 'a');
        const updateDataset = () => {
            const url = new URL('demos.html', rootURL);
            url.searchParams.set('demo', selector.value);
            open.href = url.href;
        };
        selector.addEventListener('change', updateDataset);
        updateDataset();
        const reset = action('Reset reference view', 'reset');
        reset.disabled = !timeline.staticData;
        if (reset.disabled) reset.title = 'Reference reset is available for local datasets.';
        const resetStatus = element('p', 'ob_help_note');
        resetStatus.setAttribute('role', 'status');
        reset.addEventListener('click', () => {
            applyTimelineShareState(timeline, new URLSearchParams({view: 'timeline', time: timeline.params[0].date,
                search: '', overview: timeline.params[0].overview === false ? '0' : '1'}));
            timeline.ob_timeline_body_frame.scrollTop = 0;
            timeline.ob_timeline_body_frame.scrollLeft = 0;
            if (timeline.ob_views) timeline.ob_views.scrollPositions = {timeline: 0};
            timeline.ob_render(sceneIndex);
            resetStatus.textContent = 'Reference view restored.';
        });
        const controls = element('div', 'ob_help_actions');
        controls.append(selector, open, reset);
        datasetGroup.append(controls, resetStatus); help.append(datasetGroup);
    }).catch(error => { loading.textContent = error.message; });

    const share = sections[1];
    share.append(element('h3', '', 'Share this view'), element('p', 'ob_help_note',
        timeline.staticData && timeline.demoContext ?
            'Copy a link with the selected dataset, date, view, search, and overview setting.' :
            'Copy a link to this page. View settings are included for catalog demos.'));
    const shareURL = element('textarea', 'ob_help_text');
    shareURL.readOnly = true; shareURL.rows = 4;
    shareURL.setAttribute('aria-label', 'Link to this view');
    const shareStatus = element('p', 'ob_help_note');
    shareStatus.setAttribute('role', 'status');
    updateShare = () => {
        shareURL.value = buildTimelineShareURL(timeline);
        shareStatus.textContent = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ?
            'This local link opens on a computer running the demo server.' : '';
    };
    const copyLink = action('Copy link', 'copy');
    copyLink.addEventListener('click', () => { updateShare(); return copyText(shareURL, shareStatus); });
    share.append(shareURL, copyLink, shareStatus);

    const diagnostics = sections[2];
    diagnostics.append(element('h3', '', 'Current timeline'), element('p', 'ob_help_note',
        'View information and loaded record counts for troubleshooting.'));
    const report = element('textarea', 'ob_help_text ob_help_diagnostics');
    report.readOnly = true; report.rows = 16;
    report.setAttribute('aria-label', 'Timeline diagnostics');
    const diagnosticStatus = element('p', 'ob_help_note');
    diagnosticStatus.setAttribute('role', 'status');
    updateDiagnostics = () => { report.value = JSON.stringify(getTimelineDiagnostics(timeline, sceneIndex), null, 2); };
    const refresh = action('Refresh', 'reset');
    refresh.addEventListener('click', updateDiagnostics);
    const copyReport = action('Copy diagnostics', 'copy');
    copyReport.addEventListener('click', () => { updateDiagnostics(); return copyText(report, diagnosticStatus); });
    const diagnosticActions = element('div', 'ob_help_actions');
    diagnosticActions.append(refresh, copyReport);
    diagnostics.append(report, diagnosticActions, diagnosticStatus);
    selectTab(0);
    return panel;
}
