import {compileFilter, decodeFilter} from './openbexi_timeline_filter_expression.js';

const element = (tag, text, attributes = {}) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
};
const button = (text, action) => { const node = element('button', text, {type:'button'}); node.onclick = action; return node; };
const validRange = range => Number.isFinite(range?.from) && Number.isFinite(range?.to) && range.to > range.from &&
    Math.abs(range.from) <= 8640000000000000 && Math.abs(range.to) <= 8640000000000000;

/** Presentation actions share the existing results/navigation controller. */
export class TimelineControls {
    constructor(results) { this.results = results; this.history = []; }
    get timeline() { return this.results.timeline; }
    currentRange() {
        const r = this.results;
        if (!r.pending) r.captureRanges();
        return r.visibleRanges.values().next().value || r.ranges.values().next().value;
    }
    rememberView() {
        const r = this.results, range = this.currentRange();
        if (!validRange(range)) return;
        const previous = this.history.at(-1);
        if (previous && Math.abs(previous.range.from-range.from)<1 && Math.abs(previous.range.to-range.to)<1) return;
        this.history.push({range:{from:range.from,to:range.to}, map:r.map});
        if (this.history.length>20) this.history.shift();
        this.update();
    }
    back() {
        const current = this.currentRange();
        let previous = this.history.pop();
        // Enter can repeat a search that already ran after the typing delay.
        // Skip unchanged views so one Back action returns to a different range.
        while (this.history.length && previous && current && Math.abs(previous.range.from-current.from)<1 && Math.abs(previous.range.to-current.to)<1)
            previous = this.history.pop();
        if (!previous) { this.update(); return; }
        const r = this.results;
        r.explorer.interrupt(); r.explorer.suppressed = true; r.explorer.retainRange = true;
        r.navigationMap = previous.map;
        r.navigate(previous.range, true, {immediate:true});
        this.update();
    }
    changeFilter(value, name = 'Custom', sortBy = this.timeline.ob_sortBy || 'NONE') {
        compileFilter(value);
        const t = this.timeline, r = this.results, range = this.currentRange();
        r.explorer.interrupt(); r.explorer.suppressed = true;
        t.ob_scene[0].ob_filter_value = value; t.ob_scene[0].ob_filter_name = value ? name : '';
        t.ob_sortBy = sortBy;
        r.regroupRange = range; r.navigationMap = r.map;
        if (t.staticData) r.request(); else t.load_data(0);
        this.update();
    }
    mount() {
        const r = this.results, t = this.timeline;
        this.backButton = button('Back to previous view', () => this.back());
        this.backButton.title = 'Restore the date and zoom before search or selection moved the timeline.';
        r.toolbar.prepend(this.backButton);
        this.labels = element('div', undefined, {class:'ob_active_filters', 'aria-label':'Active filters and grouping'});
        t.ob_timeline_header.append(this.labels);
        this.activityControls=element('div',undefined,{class:'ob_activity_controls',role:'group','aria-label':'Activity navigation and scale'});
        const separator=()=>element('span',undefined,{class:'ob_toolbar_separator','aria-hidden':'true'});
        this.activityControls.append(r.refreshButton,separator(),r.availableButton,r.explorer.findPrevious,
            r.explorer.findNext,separator(),r.explorer.lockLabel,r.autoLabel);
        r.activityToolbar.append(this.activityControls,r.statusGroup,r.feedback);
        if(window.ResizeObserver) {
            this.resizeObserver=new ResizeObserver(()=>r.layout());
            this.resizeObserver.observe(r.primaryToolbar);
        }
        this.update();
    }
    layout() {
        this.timeline.ob_timeline_header.dataset.toolbarLayout='two-rows';
    }
    update() {
        if (!this.labels) return;
        const t = this.timeline, scene = t.ob_scene[0], r = this.results;
        this.backButton.disabled = !this.history.length || r.loading;
        this.backButton.hidden = !this.history.length;
        const value = scene.ob_filter_value || '', group = t.ob_sortBy || 'NONE';
        const key = JSON.stringify([value, scene.ob_filter_name, group, r.state.mode, r.state.query]);
        if (key === this.labelsKey) return;
        this.labelsKey = key;
        this.labels.replaceChildren();
        const chip = (text, title, action) => {
            const control = button(text+' ×', action);
            control.className='ob_filter_chip'; control.title=title;
            control.setAttribute('aria-label','Remove '+text);
            this.labels.append(control);
        };
        if (value) chip(scene.ob_filter_name?.startsWith('Source: ')?scene.ob_filter_name:'Filter: '+(scene.ob_filter_name || 'Custom'), decodeFilter(value), () => this.changeFilter(''));
        if (group !== 'NONE') chip('Group: '+group, 'Show records without grouping', () => this.changeFilter(value, scene.ob_filter_name, 'NONE'));
        if (r.state.mode==='only' && r.state.query.trim()) chip('Only matches', 'Show all records with matches highlighted', () => r.request({mode:'highlight'}));
        this.labels.hidden = !this.labels.childElementCount;
    }
}
