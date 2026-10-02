export const APPEARANCE_KEY = 'openbexi-timeline:appearance:v1';
export const CONTRAST_KEY = 'openbexi-timeline:contrast-colors:v1';
export const CONTRAST_COLORS = [
    ['background', 'Overall background', '#111111'],
    ['navigation', 'Playback and synchronization', '#ffffff'],
    ['search', 'Search', '#ffffff'],
    ['views', 'Timeline and table views', '#ffffff'],
    ['perspective', 'Overview and 3D', '#ffffff'],
    ['settings', 'Settings and help', '#ffffff'],
    ['activity', 'Activity navigation and refresh', '#ffffff'],
    ['scale', 'Auto scale and view lock', '#ffffff'],
    ['results', 'Search result actions', '#ffffff'],
    ['filters', 'Calendar and filters', '#ffffff'],
    ['details', 'Timeline details', '#ffffff'],
    ['status', 'Loading and status group', '#111111'],
    ['date', 'Current date', '#ffffff']
];
export const APPEARANCES = [
    ['default', 'Default'], ['apple', 'Apple style'], ['windows', 'Windows style'],
    ['minimal', 'Minimal'], ['contrast', 'High contrast']
];
const valid = value => APPEARANCES.some(([id]) => id === value);
const defaults = () => Object.fromEntries(CONTRAST_COLORS.map(([id,,color]) => [id,color]));
let colors = defaults();
let backgroundApplied = false;
const timelines = new Set(), sceneBackgrounds = new WeakMap();

/** Change the workspace/clear canvas, preserving model-defined bands and event colors. */
export function applyAppearanceBackground(timeline) {
    if (typeof document === 'undefined') return;
    const active = document.documentElement.dataset.obTheme === 'contrast' && backgroundApplied;
    for (const scene of timeline.ob_scene || []) if (scene?.background?.isColor) {
        if (active) {
            if (!sceneBackgrounds.has(scene)) sceneBackgrounds.set(scene,scene.background.clone());
            scene.background.set(colors.background);
        } else if (sceneBackgrounds.has(scene)) {
            scene.background.copy(sceneBackgrounds.get(scene));sceneBackgrounds.delete(scene);
        }
    }
}

function repaintBackgrounds() {
    for (const reference of timelines) {
        const timeline = reference.deref();
        if (!timeline || !timeline.ob_timeline_panel?.isConnected) { timelines.delete(reference);continue; }
        applyAppearanceBackground(timeline);
        timeline.ob_render?.(0);
    }
}

export function normalizeContrastColors(value) {
    return Object.fromEntries(CONTRAST_COLORS.map(([id,,fallback]) =>
        [id, typeof value?.[id] === 'string' && /^#[0-9a-f]{6}$/i.test(value[id]) ? value[id].toLowerCase() : fallback]));
}

/** Black or white always provides at least 4.5:1 text contrast against a solid sRGB color. */
export function contrastText(color) {
    const channels = color.slice(1).match(/../g).map(value => parseInt(value,16)/255)
        .map(value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4);
    const luminance = channels.reduce((sum,value,index) => sum+value*[.2126,.7152,.0722][index],0);
    return (luminance+.05)/.05 >= 1.05/(luminance+.05) ? '#000000' : '#ffffff';
}

export function applyContrastColors(value) {
    colors = normalizeContrastColors(value);
    backgroundApplied = typeof value?.backgroundApplied === 'boolean' ? value.backgroundApplied : colors.background !== defaults().background;
    const root = document.documentElement;
    root.dataset.obContrastCustom = String(backgroundApplied || CONTRAST_COLORS.some(([id,,color]) => colors[id] !== color));
    root.dataset.obContrastBackground = String(backgroundApplied);
    for (const [id] of CONTRAST_COLORS) {
        root.style.setProperty('--ob-contrast-'+id,colors[id]);
        root.style.setProperty('--ob-contrast-'+id+'-text',contrastText(colors[id]));
    }
    for (const input of document.querySelectorAll('[data-contrast-color]')) input.value = colors[input.dataset.contrastColor];
    repaintBackgrounds();
    return {...colors};
}

/** Annotate the real controls so their color follows them into the compact More menu. */
export function markContrastGroups(controls) {
    const r = controls.results, t = controls.timeline;
    timelines.add(new WeakRef(t));applyAppearanceBackground(t);
    const groups = {
        navigation:[r.primaryNavigation], search:[r.search], views:[t.ob_views.controls],
        perspective:[t.ob_view,t.ob_no_view,t.ob_3d], settings:[t.ob_settings,t.ob_help,controls.moreButton,controls.morePanel.firstElementChild],
        activity:[r.availableButton,r.explorer.findPrevious,r.explorer.findNext,r.refreshButton],
        scale:[r.autoLabel,r.explorer.lockLabel], results:[r.toolbar], filters:[t.ob_calendar,r.filterButton,controls.labels],
        details:[r.detailsToggle], status:[r.statusGroup], date:[t.ob_time_marker]
    };
    for (const [id,nodes] of Object.entries(groups)) for (const node of nodes) if (node) {
        node.dataset.obContrastGroup = id;
        node.style.setProperty('--ob-group-background',`var(--ob-contrast-${id})`);
        node.style.setProperty('--ob-group-text',`var(--ob-contrast-${id}-text)`);
    }
}

export function applyAppearance(value) {
    const theme = valid(value) ? value : 'default';
    document.documentElement.dataset.obTheme = theme;
    for (const input of document.querySelectorAll('.ob_appearance_choices input[type=radio]')) input.checked = input.value === theme;
    for (const panel of document.querySelectorAll('.ob_contrast_colors')) panel.hidden = theme !== 'contrast';
    repaintBackgrounds();
    return theme;
}

export function restoreAppearance() {
    let theme;
    try { theme = window.localStorage.getItem(APPEARANCE_KEY); } catch { /* Browser storage can be unavailable. */ }
    let saved;
    try { saved = JSON.parse(window.localStorage.getItem(CONTRAST_KEY)); } catch { /* Ignore invalid or unavailable storage. */ }
    applyContrastColors(saved);
    return applyAppearance(theme);
}

export function mountAppearance(panel, timeline) {
    const choices = document.createElement('fieldset');
    choices.className = 'ob_appearance_choices';
    const legend = document.createElement('legend'); legend.textContent = 'Theme'; choices.append(legend);
    const notice = document.createElement('p'); notice.setAttribute('role', 'status');
    const selected = document.documentElement.dataset.obTheme || restoreAppearance();
    for (const [id, name] of APPEARANCES) {
        const label = document.createElement('label'), input = document.createElement('input');
        input.type = 'radio'; input.name = timeline.name + '_appearance'; input.value = id; input.checked = selected === id;
        input.onchange = () => {
            if (!input.checked) return;
            applyAppearance(id);
            try { window.localStorage.setItem(APPEARANCE_KEY, id); notice.textContent = name + ' saved for this browser.'; }
            catch { notice.textContent = name + ' applied. Browser storage is unavailable, so this choice cannot be saved.'; }
            timeline.ob_results?.layout(); timeline.ob_viewport?.schedule();
        };
        label.append(input, document.createTextNode(name)); choices.append(label);
    }
    const palette = document.createElement('fieldset');
    palette.className = 'ob_contrast_colors'; palette.hidden = selected !== 'contrast';
    const paletteLegend = document.createElement('legend'); paletteLegend.textContent = 'High contrast colors';
    const explanation = document.createElement('p');
    explanation.textContent = 'Customize the workspace background and each menu group. Text adjusts for readability. Timeline bands, event colors and status indicators keep their meaning.';
    palette.append(paletteLegend,explanation);
    const saveColors = value => {
        applyContrastColors(value);
        try { window.localStorage.setItem(CONTRAST_KEY,JSON.stringify({...colors,backgroundApplied})); notice.textContent = 'High contrast colors saved for this browser.'; }
        catch { notice.textContent = 'High contrast colors applied. Browser storage is unavailable, so these colors cannot be saved.'; }
    };
    for (const [id,name] of CONTRAST_COLORS) {
        const label = document.createElement('label'), input = document.createElement('input');
        label.append(document.createTextNode(name)); input.type = 'color'; input.value = colors[id];
        input.dataset.contrastColor = id; input.setAttribute('aria-label',name+' color');
        input.oninput = () => saveColors({...colors,[id]:input.value,backgroundApplied:id === 'background' || backgroundApplied});
        input.onchange = input.oninput;
        label.append(input); palette.append(label);
    }
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Reset high contrast colors';
    reset.onclick = () => saveColors({...defaults(),backgroundApplied:false}); palette.append(reset); choices.append(palette);
    panel.append(choices, notice);
}
