import {compileFilter, decodeFilter} from './openbexi_timeline_filter_expression.js';
import {markContrastGroups} from './openbexi_timeline_appearance.js';

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
        const r = this.results;
        this.backButton = button('Back to previous view', () => this.back());
        this.backButton.title = 'Restore the date and zoom before search or selection moved the timeline.';
        r.toolbar.prepend(this.backButton);
        this.labels = element('div', undefined, {class:'ob_active_filters', 'aria-label':'Active filters and grouping'});
        r.feedback.insertBefore(this.labels,r.filterButton);
        this.activityControls=element('div',undefined,{class:'ob_activity_controls',role:'group','aria-label':'Activity navigation and scale'});
        const separator=()=>element('span',undefined,{class:'ob_toolbar_separator','aria-hidden':'true'});
        this.activityControls.append(r.availableButton,r.explorer.findPrevious,
            r.explorer.findNext,separator(),r.autoLabel,r.explorer.lockLabel);
        r.activityToolbar.append(r.refreshButton,this.activityControls,r.toolbar,r.statusGroup,r.feedback);
        this.mountMore();
        markContrastGroups(this);
        if(window.ResizeObserver) {
            this.resizeObserver=new ResizeObserver(()=>r.layout());
            this.resizeObserver.observe(r.primaryToolbar);
            this.resizeObserver.observe(this.activityControls);
            this.resizeObserver.observe(r.utilities);
        }
        this.update();
    }
    layout() {
        const r=this.results,header=this.timeline.ob_timeline_header;
        header.dataset.toolbarLayout='two-rows';
        if(!this.activityControls)return;
        if(this.moreSearch)this.moreSearch.hidden=r.toolbar.hidden;
        const rowWidth=r.primaryToolbar.clientWidth;
        if(!rowWidth) {header.dataset.activityRow='secondary';return;}
        // Opening a side panel should not change the toolbar's interaction model.
        const compact=(this.timeline.layoutHost?.clientWidth || window.innerWidth || rowWidth)<=600;
        this.setCompact(compact);
        if(compact) {header.dataset.activityRow='secondary';return;}
        // Reserve a readable date label independently of the current row so
        // moving controls cannot make the placement oscillate.
        const width=element=>element.getBoundingClientRect().width;
        const style=getComputedStyle(r.primaryToolbar);
        const gap=Number.parseFloat(style.columnGap) || 10;
        const titleWidth=Number.parseFloat(getComputedStyle(r.titleSlot).minWidth) || 180;
        const required=[r.primaryNavigation,r.search,r.utilities,this.activityControls].reduce((sum,element)=>sum+width(element),0)+titleWidth+gap*4;
        const available=rowWidth-(Number.parseFloat(style.paddingLeft) || 0)-(Number.parseFloat(style.paddingRight) || 0);
        const fits=available>0 && required<=available;
        const parent=fits?r.primaryToolbar:r.activityToolbar;
        if(this.activityControls.parentElement!==parent) {
            const focused=this.activityControls.contains(document.activeElement)?document.activeElement:null;
            parent.insertBefore(this.activityControls,fits?r.titleSlot:r.toolbar);
            focused?.focus({preventScroll:true});
        }
        header.dataset.activityRow=fits?'main':'secondary';
    }
    mountMore() {
        const r=this.results, t=this.timeline;
        this.moreButton=button('More',()=>this.openMore(this.morePanel.hidden));
        this.moreButton.className='ob_more_button';
        this.moreButton.hidden=true;
        this.moreButton.setAttribute('aria-expanded','false');
        this.morePanel=element('div',undefined,{class:'ob_more_panel',id:t.name+'_more_controls',role:'group','aria-label':'More timeline controls'});
        this.morePanel.hidden=true;
        this.moreButton.setAttribute('aria-controls',this.morePanel.id);
        this.compactNavigation=element('div',undefined,{class:'ob_compact_navigation',role:'group','aria-label':'Activity navigation'});
        this.moreView=element('section');this.moreView.append(element('h3','View and settings'));
        this.moreNavigation=element('section');this.moreNavigation.append(element('h3','Navigation and scale'));
        this.moreSearch=element('section');this.moreSearch.append(element('h3','Search results'));
        this.moreFilters=element('section');this.moreFilters.append(element('h3','Filters and details'));
        const close=button('Close',()=>this.openMore(false,true));
        close.setAttribute('aria-label','Close more controls');
        this.morePanel.append(close,this.moreView,this.moreNavigation,this.moreSearch,this.moreFilters);
        r.primaryToolbar.append(this.moreButton);
        t.ob_timeline_header.append(this.morePanel);
        t.ob_timeline_header.addEventListener('keydown',event=>{
            if(event.key==='Escape' && !this.morePanel.hidden) {
                event.preventDefault();event.stopPropagation();this.openMore(false,true);
            }
        },true);
        t.ob_timeline_panel.addEventListener('pointerdown',event=>{
            if(!this.morePanel.hidden && !this.morePanel.contains(event.target) && !this.moreButton.contains(event.target))this.openMore(false);
        });
        this.morePanel.addEventListener('click',event=>{
            if(event.target.closest('.ob_results_utilities,.ob_results_feedback'))
                // Capture also sees the legacy icon handlers that stop bubbling.
                // Wait until the action has had a chance to focus its side panel.
                Promise.resolve().then(()=>this.openMore(false,true));
        },true);
        this.morePanel.addEventListener('focusout',event=>{
            if(event.relatedTarget && !this.morePanel.contains(event.relatedTarget) && event.relatedTarget!==this.moreButton)this.openMore(false);
        });
    }
    openMore(open,returnFocus=false) {
        const focusInside=this.morePanel.contains(document.activeElement);
        this.morePanel.hidden=!open;
        this.moreButton.setAttribute('aria-expanded',String(open));
        if(open)this.morePanel.querySelector('button')?.focus({preventScroll:true});
        else if(returnFocus && (focusInside || document.activeElement===this.moreButton || document.activeElement===document.body))
            this.moreButton.focus({preventScroll:true});
    }
    setCompact(compact) {
        if(this.compact===compact)return;
        const r=this.results, t=this.timeline, focused=document.activeElement;
        this.compact=compact;
        t.ob_timeline_header.dataset.compact=String(compact);
        this.moreButton.hidden=!compact;
        const moves=[[r.explorer.findPrevious,'Find previous activity','←','Previous'],[r.explorer.findNext,'Find next activity','→','Next']];
        if(compact) {
            this.moreView.append(r.titleSlot,r.utilities);
            this.moreNavigation.append(r.refreshButton,this.activityControls);
            this.moreSearch.append(r.toolbar);
            this.moreFilters.append(r.feedback);
            for(const [control,label,arrow,shortLabel] of moves) {
                control.setAttribute('aria-label',label);control.title=label;
                control.replaceChildren(element('span',arrow,{'aria-hidden':'true'}),element('span',shortLabel,{class:'ob_compact_label','aria-hidden':'true'}));
                this.compactNavigation.append(control);
            }
            r.activityToolbar.prepend(this.compactNavigation);
        } else {
            this.openMore(false);
            r.primaryToolbar.insertBefore(r.titleSlot,this.moreButton);
            r.primaryToolbar.insertBefore(r.utilities,this.moreButton);
            for(const [control,label] of moves)control.textContent=label;
            this.activityControls.insertBefore(r.explorer.findPrevious,this.activityControls.children[1]);
            this.activityControls.insertBefore(r.explorer.findNext,this.activityControls.children[2]);
            r.activityToolbar.replaceChildren(r.refreshButton,this.activityControls,r.toolbar,r.statusGroup,r.feedback);
        }
        if(focused && t.ob_timeline_header.contains(focused)) {
            if(compact && this.morePanel.contains(focused))this.moreButton.focus({preventScroll:true});
            else if(!compact && (focused===this.moreButton || focused===this.morePanel.firstElementChild))t.ob_search_input.focus({preventScroll:true});
            else focused.focus({preventScroll:true});
        }
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
