export const APPEARANCE_KEY = 'openbexi-timeline:appearance:v1';
export const APPEARANCES = [
    ['default', 'Default'], ['apple', 'Apple style'], ['windows', 'Windows style'],
    ['minimal', 'Minimal'], ['contrast', 'High contrast']
];
const valid = value => APPEARANCES.some(([id]) => id === value);

export function applyAppearance(value) {
    const theme = valid(value) ? value : 'default';
    document.documentElement.dataset.obTheme = theme;
    for (const input of document.querySelectorAll('.ob_appearance_choices input')) input.checked = input.value === theme;
    return theme;
}

export function restoreAppearance() {
    let theme;
    try { theme = window.localStorage.getItem(APPEARANCE_KEY); } catch { /* Browser storage can be unavailable. */ }
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
    panel.append(choices, notice);
}
