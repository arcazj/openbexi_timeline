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
    const fold = (section, key, open = false) => {
        const details = element('details', section.className);
        const summary = element('summary', 'ob_help_section_heading');
        const heading = section.querySelector('h3');
        if (heading) summary.append(heading);
        details.append(summary, ...section.childNodes);
        timeline.helpSections ??= {};
        details.open = timeline.helpSections[key] ?? open;
        details.addEventListener('toggle', () => { timeline.helpSections[key] = details.open; });
        return details;
    };
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
    const resultsHelp = element('section', 'ob_help_resource_group');
    resultsHelp.append(element('h3', '', 'Search, Results and Auto scale'),
        element('p', '', 'Choose a search mode under Filters > Search options. Text search finds literal words and phrases without case sensitivity. Pattern uses a case-insensitive regular expression; Legacy preserves the older case-sensitive expressions, including spaces and semicolons as OR. Typing pauses briefly before searching; Enter searches immediately. Invalid patterns retain the current results. Connected Text and Pattern modes require an updated server.'),
        element('p', '', 'Entering a search centers the first matching event or session as results arrive, while keeping the current zoom. When no match is loaded, connected searches scan earlier configured history until a match is found or eligible history is exhausted. Stop search retains the current view. No matching records is final only after complete coverage; unreadable sources, failed requests and older limited servers report an incomplete search. Open Status for file counts and details; its tooltip also shows the current state.'),
        element('p', '', 'Settings is organized into Edit models, Timeline info, Update perspective, and Change look and feel. Timeline info and Update perspective start collapsed. The theme radio buttons offer Default, Apple style, Windows style, Minimal and High contrast. Themes apply immediately, support arrow keys, and persist in this browser. High contrast strengthens icons, buttons and group separators in both menu bars, with clear hover, focus, selected and disabled states. A separator divides 3D and Settings.'),
        element('p', '', 'The interface has exactly two menu bars: main and secondary. When space permits, Go to latest data, Find previous activity and Find next activity follow the search field, then a separator, Auto scale and Lock current view. They move to the secondary bar when needed; horizontal scrolling keeps each bar to a single row. The secondary filter group contains Calendar, Filter: <filter name>, Filters, a separator and Timeline details. Refresh, search results and removable filter labels share these two bars. Use the mouse wheel or plus/minus keys to zoom. Back to previous view restores the date and zoom before search or selection moved the timeline, keeping the current query and filters.'),
        element('p', '', 'Active filters and grouping appear as removable labels. Sorting & Filtering offers a Field → Operator → Value builder; select a text, number or boolean value type. Advanced expression retains the existing filter syntax. Apply filter changes the current view; Add a new filter saves it as a preset.'),
        element('p', '', 'Fit matches includes all matching timestamps when coverage is complete. Auto scale expands busy periods, compresses quiet ones and adapts time labels. Overview keeps uniform time spacing.'),
        element('p', '', 'Find previous activity and Find next activity respect active search and filters and center the result they find. Status: Loading… and Status: Searching… are orange; Status: Ready is green after successful completion. Partial data, limits and interrupted connections stay orange; errors are red and cancelled work is gray. Click Status to open its report, then click again to close it, matching Timeline details. The tooltip and report include progress and recovery details. Stop remains available while work is running; Escape cancels loading or closes an open status report. The no-results panel stays hidden during startup and unfinished searches.'),
        element('p', '', 'With Auto scale enabled, a confirmed empty view can move to earlier activity. Lock current view stops that automatic movement and scale changes. Reading details and dragging pause automatic navigation. Previous and next activity searches retain the view until a result arrives, with Cancel search available. Resync centers the current date and time and keeps the view there even when only historical records are available.'),
        element('p', '', 'Overview emphasizes search matches with larger yellow markers, dark outlines and a match count. Other records fade while Highlight matches is enabled. Clearing the search restores the ordinary markers.'),
        element('p', '', 'Previous and next activity center the result while keeping the current time span, widening only for a longer activity. A gold glow highlights the result without enlarging its bar, icon or text, changing its depth, or adding rows. In 3D, an angled grid and shaded bars provide depth; full titles keep the model font size. Activities share compact rows and use extra pages only when the records and readable titles cannot fit. Hold Shift while dragging to rotate; regular dragging moves through time. Reduced-motion settings disable the brief brightness pulse.'),
        element('p', '', 'Dense event groups expand when clicked; their original records remain in Table. Selected events and records marked high or critical priority stay individual.'),
        element('p', '', 'Focus the timeline and use Left/Right to move, Plus/Minus to zoom, or Alt+Left/Right to move between matches. Timeline details lists completed, loading, partial and limited intervals. Automatic moves do not animate; reduced-motion preferences also disable coasting.'),
        element('p', '', 'Scroll up to zoom in and down to zoom out in the plot under the pointer. Main zoom preserves the time under the pointer. Overview zoom keeps the visible-window indicator centered and changes only its context span. Its arrows, clicks and drags navigate the main view; Fit context includes the loaded range around the centered indicator. Settings > Timeline info contains the maximum adaptive ratio.'),
        element('p', '', 'Dragging continues briefly after release and slows to a stop. New navigation cancels that movement, and reduced-motion preferences disable it.'),
        element('p', '', 'Use Previous and Next below the plot or table to browse packed records. Resizing recalculates pages while keeping the time range. Expand Settings > Timeline info to switch between the full browser window and a saved custom frame; these display preferences do not modify connected configuration files.'),
        element('p', '', 'Partial provider coverage uses uniform spacing and disables exact Fit matches. Providers without matching metadata keep their existing search behavior.'));
    help.append(fold(resultsHelp, 'results'));
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
            group.append(links); help.append(fold(group, section.title));
        }
        const datasetGroup = element('section', 'ob_help_resource_group ob_help_datasets');
        datasetGroup.append(element('h3', '', 'Test local data'));
        const selector = element('select');
        selector.setAttribute('aria-label', 'Local dataset');
        const currentDataset = catalog.demos.find(demo => demo.id === timeline.demoContext?.id)?.id || '';
        if (!currentDataset) {
            const placeholder = element('option', '', 'Choose a dataset');
            placeholder.value = ''; placeholder.disabled = true; selector.append(placeholder);
        }
        for (const demo of catalog.demos) {
            const option = element('option', '', demo.title);
            option.value = demo.id;
            selector.append(option);
        }
        selector.value = currentDataset;
        let selected = selector.value;
        const datasetStatus = element('p', 'ob_help_note');
        datasetStatus.setAttribute('role', 'status');
        const updateDataset = () => {
            if (!selector.value || selector.value === selected) return;
            const url = new URL('demos.html', rootURL);
            url.searchParams.set('demo', selector.value);
            try {
                datasetStatus.textContent = 'Opening selected dataset…';
                (timeline.openDataset || (address => window.location.assign(address)))(url.href);
                selected = selector.value;
            } catch (error) {
                selector.value = selected;
                datasetStatus.textContent = 'Unable to open dataset: ' + error.message;
            }
        };
        selector.addEventListener('change', updateDataset);
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
        controls.append(selector, reset);
        datasetGroup.append(controls, datasetStatus, resetStatus); help.append(fold(datasetGroup, 'datasets', true));
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
    for (const [section, key] of [[share,'share'],[diagnostics,'diagnostics']]) {
        const content = element('section','ob_help_resource_group');
        content.append(...section.childNodes);
        section.append(fold(content,key,true));
    }
    selectTab(0);
    return panel;
}
