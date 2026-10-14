import {openModelEditor} from './openbexi_timeline_model_link.js';
import {mountAppearance} from './openbexi_timeline_appearance.js';
import {mountTraceSettings} from './openbexi_timeline_trace.js';

let releaseMetadata;
function showVersion(container) {
    const version = node('p', 'OpenBEXI Timeline · Version loading…', 'ob_application_version');
    container.append(version);
    // Use the same release metadata as Help; no extra request during timeline loading.
    releaseMetadata ||= fetch(new URL('../help/resources.json', import.meta.url)).then(async response => {
        if (!response.ok) throw new Error('Version unavailable');
        const resources = await response.json();
        if (typeof resources.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(resources.version))
            throw new Error('Invalid version');
        return resources.version;
    }).catch(error => { releaseMetadata = null; throw error; });
    releaseMetadata.then(value => { version.textContent = 'OpenBEXI Timeline · Version ' + value; })
        .catch(() => { version.textContent = 'OpenBEXI Timeline · Version unavailable'; });
}

const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
};
const button = (text, action) => {
    const element = node('button', text); element.type = 'button'; element.onclick = action; return element;
};

export function createTimelineSettings(timeline, index) {
    for (const close of ['ob_remove_descriptor', 'ob_remove_calendar', 'ob_remove_help', 'ob_remove_sorting', 'ob_remove_login']) timeline[close]();
    if (document.getElementById(timeline.name + '_setting')) { timeline.ob_remove_setting(); return; }
    const panel = node('section', undefined, 'ob_side_content ob_settings_panel');
    panel.id = timeline.name + '_setting';
    const heading = node('div', 'Settings', 'ob_panel_heading');
    const close = button('Close', () => timeline.ob_remove_setting()); close.setAttribute('aria-label', 'Close settings');
    heading.append(close); panel.append(heading);
    showVersion(panel);
    const section = (id, title, open = false) => {
        const details = node('details', undefined, 'ob_settings_section');
        details.dataset.settingsSection = id; details.open = open;
        const summary = node('summary', title), body = node('div', undefined, 'ob_settings_section_body');
        details.append(summary, body); panel.append(details); return body;
    };
    const models = section('models', '1. Edit models', true);
    models.append(node('p', 'Edit the active model and YAML configuration with a live preview.'));
    const editor = button('Model and YAML editor', () => openModelEditor(timeline)); editor.className = 'ob_model_editor_launch';
    if (timeline.modelAccess?.permissions?.admin === false) {
        editor.disabled = true;
        editor.title = 'Only this model’s administrators can edit its configuration.';
    }
    models.append(editor);

    const info = section('info', '2. Timeline info');
    const form = node('form', undefined, 'ob_panel_form'), fields = node('fieldset');
    fields.append(node('legend', 'Timeline Info'));
    for (const key of ['top', 'left', 'width', 'height']) {
        const label = node('label', key[0].toUpperCase() + key.slice(1)), input = node('input');
        input.type = 'number'; input.id = timeline.name + '_' + key;
        input.value = timeline.ob_scene[index][key === 'height' ? 'ob_height' : key];
        input.setAttribute('aria-label', label.textContent); label.append(input); fields.append(label);
    }
    form.onsubmit = event => { event.preventDefault(); timeline.ob_apply_timeline_info(index); };
    form.append(fields, button('Apply Timeline Info', () => timeline.ob_apply_timeline_info(index))); info.append(form);
    timeline.ob_viewport?.mountSettings(info); timeline.ob_results?.mountSettings(info);
    timeline.ob_perspective?.mount(section('perspective', '3. Update perspective'));
    mountAppearance(section('appearance', '4. Change look and feel', true), timeline);
    mountTraceSettings(section('trace', '5. Trace level', true));
    timeline.ob_timeline_right_panel.append(panel);
    timeline.ob_timeline_right_panel.style.visibility = 'visible';
    timeline.ob_perspective?.syncFields(); timeline.ob_viewport?.schedule();
}
