import {packPages, pageBands, pageForAnchor, recordKey} from './openbexi_timeline_paging.js';

const styles = (element, values) => {
    if (!element) return;
    for (const [key,value] of Object.entries(values)) if (element.style[key] !== value) element.style[key] = value;
};
const control = (label, action) => {
    const button = document.createElement('button'); button.type='button'; button.textContent=label;
    button.addEventListener('click',action); return button;
};

/** Owns available space; model dimensions remain the requested custom geometry. */
export class TimelineViewport {
    constructor(timeline) {
        this.timeline=timeline; this.pageIndex=0; this.pages=[[]];
        const params=timeline.params[0];
        this.preference={fullWindow:params.fullWindow !== false, top:Number(params.top)||0, left:Number(params.left)||0,
            width:Number(params.width)||1000, height:Number(params.height)||700};
        this.storageKey=`openbexi:layout:${window.location.pathname}:${params.name}`;
        try {
            const saved=JSON.parse(window.localStorage.getItem(this.storageKey));
            if (saved && typeof saved.fullWindow==='boolean' && ['top','left','width','height'].every(k=>Number.isFinite(saved[k])) &&
                saved.width>0 && saved.height>0 && saved.top>=0 && saved.left>=0) this.preference=saved;
        } catch { /* Storage is optional for embedded/private browser contexts. */ }
        this.resize=()=>this.schedule();
        window.addEventListener('resize',this.resize);
    }

    measure() {
        const t=this.timeline, host=t.layoutHost;
        const width=Math.max(1,host?.clientWidth || window.innerWidth || 1000);
        const height=Math.max(1,host?.clientHeight || window.innerHeight || 700);
        this.panelOpen=Boolean(t.ob_timeline_right_panel?.children.length && t.ob_timeline_right_panel.style.visibility !== 'hidden');
        this.overlay=this.panelOpen && width<900;
        this.descriptorOpen=this.panelOpen && Boolean(t.ob_timeline_right_panel.querySelector('.ob_descriptor, .ob_record_details, .ob_static_description'));
        this.sideLimits=this.overlay ? {min:Math.min(260,Math.max(1,width-48)),max:Math.max(1,width-48)} :
            {min:320,max:Math.max(320,Math.min(Math.round(width*0.6),width-420))};
        const defaultWidth=Math.min(width,480,Math.max(320,Math.round(width*0.22)));
        const requestedWidth=this.descriptorOpen && Number.isFinite(this.preference.descriptorWidth) ? this.preference.descriptorWidth : defaultWidth;
        this.sideWidth=this.panelOpen ? this.descriptorOpen ? this.clampSideWidth(requestedWidth) : defaultWidth : 0;
        const usableWidth=width-(this.overlay?0:this.sideWidth);
        const p=this.preference;
        this.left=p.fullWindow?0:Math.min(p.left,Math.max(0,usableWidth-80));
        this.top=p.fullWindow?0:Math.min(p.top,Math.max(0,height-80));
        this.width=Math.max(1,p.fullWindow?usableWidth:Math.min(p.width,usableWidth-this.left));
        this.height=Math.max(1,p.fullWindow?height:Math.min(p.height,height-this.top));
        this.headerHeight=t.ob_timeline_header?.offsetHeight || (this.width<700?200:108);
        const ratio=Number(t.params[0].overviewHeightRatio)||0.2;
        const overviews=t.ob_visible_view ? t.bands.filter(b=>b.name.includes('overview_')).length : 0;
        this.overviewHeight=overviews ? Math.max(0,Math.min(180*overviews,
            Math.floor(this.height*ratio)*overviews,this.height-this.headerHeight-100)):0;
        this.plotWidth=t.ob_views?.mode==='split'?Math.max(1,Math.floor(this.width/2)):this.width;
        this.availableHeight=Math.max(1,this.height-this.headerHeight-this.overviewHeight);
        Object.assign(t,{width:this.width,height:this.height,top:this.top,left:this.left});
        return this.layoutSignature();
    }

    layoutSignature() {
        return [this.width,this.height,this.headerHeight,this.overviewHeight,this.plotWidth,this.panelOpen,this.descriptorOpen,this.sideWidth].join(':');
    }

    clampSideWidth(value) { return Math.round(Math.max(this.sideLimits.min,Math.min(this.sideLimits.max,value))); }

    savePreference() {
        try { window.localStorage.setItem(this.storageKey,JSON.stringify(this.preference)); } catch { /* Optional persistence. */ }
    }

    setDescriptorWidth(value,finish=false) {
        if (!Number.isFinite(value)) return;
        this.preference.descriptorWidth=this.clampSideWidth(value);
        if (finish) {
            clearTimeout(this.sideResizeTimer);this.sideResizeTimer=null;
            this.savePreference();this.refresh();
        } else if (!this.sideResizeTimer) {
            // Bound expensive scene rebuilds while the divider follows a drag.
            this.sideResizeTimer=setTimeout(()=>{this.sideResizeTimer=null;this.refresh();},32);
        }
    }

    mountSideResizer() {
        const t=this.timeline,panel=t.ob_timeline_right_panel;
        const divider=document.createElement('div');this.sideResizer=divider;
        divider.className='ob_descriptor_resizer';divider.tabIndex=0;divider.hidden=true;
        divider.setAttribute('role','separator');divider.setAttribute('aria-orientation','vertical');
        divider.setAttribute('aria-label','Resize Data panel');
        if (panel.id) divider.setAttribute('aria-controls',panel.id);
        divider.title='Drag to resize Data. Left/Right arrows adjust width; Home/End set the limits. Double-click to reset.';
        panel.after(divider);
        const prepare=()=>{t.ob_scene[0]?.cancelPan?.();t.ob_results?.captureRanges();this.measure();};
        divider.addEventListener('keydown',event=>{
            const step=event.shiftKey?50:20;
            const values={ArrowLeft:this.sideWidth+step,ArrowRight:this.sideWidth-step,Home:this.sideLimits?.min,End:this.sideLimits?.max};
            if (!(event.key in values)) return;
            event.preventDefault();event.stopPropagation();prepare();this.setDescriptorWidth(values[event.key],true);
        });
        divider.addEventListener('dblclick',event=>{
            event.preventDefault();prepare();delete this.preference.descriptorWidth;this.savePreference();this.refresh();
        });
        divider.addEventListener('pointerdown',event=>{
            if (event.button!==0 || this.sideDrag) return;
            event.preventDefault();event.stopPropagation();prepare();divider.focus({preventScroll:true});
            const drag={pointerId:event.pointerId,startX:event.clientX,width:this.sideWidth,previous:this.preference.descriptorWidth};
            this.sideDrag=drag;document.body.classList.add('ob_resizing_descriptor');
            try {divider.setPointerCapture(event.pointerId);} catch { /* Synthetic/older pointer implementations. */ }
            const move=e=>{if(e.pointerId===drag.pointerId) {e.preventDefault();this.setDescriptorWidth(drag.width+drag.startX-e.clientX);}};
            const finish=(e,cancel=false)=>{
                if (e.pointerId!==undefined && e.pointerId!==drag.pointerId) return;
                window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);
                window.removeEventListener('pointercancel',cancelled);window.removeEventListener('keydown',key);window.removeEventListener('blur',cancelled);
                this.sideDrag=null;document.body.classList.remove('ob_resizing_descriptor');
                try {divider.releasePointerCapture(drag.pointerId);} catch {}
                clearTimeout(this.sideResizeTimer);this.sideResizeTimer=null;
                if (cancel) {
                    if (drag.previous===undefined) delete this.preference.descriptorWidth;
                    else this.preference.descriptorWidth=drag.previous;
                } else this.savePreference();
                this.refresh();
            };
            const up=e=>{if(e.pointerId===drag.pointerId) {move(e);finish(e);}};
            const cancelled=e=>finish(e,true);
            const key=e=>{if(e.key==='Escape') {e.preventDefault();e.stopPropagation();finish(e,true);}};
            window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up);
            window.addEventListener('pointercancel',cancelled);window.addEventListener('keydown',key);window.addEventListener('blur',cancelled);
        });
    }

    mount() {
        if (this.pager) return;
        const t=this.timeline;
        if (!t.layoutHost) document.body.classList.add('ob_timeline_app');
        t.ob_timeline_panel.classList.add('ob_viewport_panel');
        t.ob_timeline_right_panel.classList.add('ob_viewport_side');
        t.ob_timeline_body_frame.classList.add('ob_paged_frame');
        t.ob_timeline_body_frame.setAttribute('role','region');
        t.ob_timeline_body_frame.setAttribute('aria-label','Timeline events');
        t.ob_timeline_body_frame.tabIndex=0;
        t.ob_timeline_panel_resizer.hidden=true;
        for (const event of ['onmousedown','onmousemove','onmouseup','onmouseout']) t.ob_timeline_header[event]=null;
        this.pager=document.createElement('nav'); this.pager.className='ob_pagination';
        this.pager.setAttribute('aria-label','Timeline pages');
        this.previous=control('Previous',()=>this.go(this.pageIndex-1));
        this.next=control('Next',()=>this.go(this.pageIndex+1));
        this.label=document.createElement('span'); this.label.setAttribute('role','status'); this.label.setAttribute('aria-live','polite');
        this.pager.append(this.previous,this.label,this.next); t.ob_timeline_panel.append(this.pager);
        this.mountSideResizer();
        this.sideObserver=new MutationObserver(()=>this.schedule());
        this.sideObserver.observe(t.ob_timeline_right_panel,{attributes:true,attributeFilter:['style'],childList:true});
        if (typeof ResizeObserver!=='undefined') {
            this.observer=new ResizeObserver(()=>this.schedule());
            this.observer.observe(t.ob_timeline_header);
            if (t.layoutHost) this.observer.observe(t.layoutHost);
        }
        this.schedule();
    }

    schedule() { clearTimeout(this.timer); this.timer=setTimeout(()=>this.refresh(),80); }

    refresh() {
        const t=this.timeline,r=t.ob_results;
        if (r?.gesture || r?.loading) { r.resizeQueued=true; return; }
        const signature=this.measure();
        // Legacy panels can rewrite their own position without changing the
        // available viewport. Reapply the measured frame without rebuilding.
        if (signature===this.signature) { this.layout(); return; }
        this.signature=signature;
        if (r?.supported && !r.error && !r.cancelled) r.request();
        else if (t.ob_timeline_panel) {
            const scene=t.ob_scene[0];
            t.update_all_timelines(0,t.header,t.params,scene.bands,scene.model,scene.sessions,scene.ob_camera_type);
        }
    }

    paginate(bands) {
        this.fullBands=bands;
        this.pages=packPages(bands,this.availableHeight);
        this.pagerHeight=this.pages.length>1 && this.timeline.ob_views?.mode!=='table'?36:0;
        this.detailHeight=Math.max(1,this.availableHeight-this.pagerHeight);
        if (this.pagerHeight) this.pages=packPages(bands,this.detailHeight);
        this.pageIndex=pageForAnchor(this.pages,bands,this.anchor,this.pageIndex);
        const detail=pageBands(bands,this.pages[this.pageIndex],this.detailHeight);
        this.continued=detail.flatMap(b=>b.sessions.filter(s=>s.pageContinued).map(s=>s.data?.title || s.id));
        const activities=detail.flatMap(band=>band.sessions.flatMap(session=>session.activities));
        const selected=activities.find(activity=>recordKey(activity)===this.timeline.ob_results?.selectedKey);
        const first=selected || detail[0]?.sessions.flatMap(s=>s.activities).sort((a,b)=>a.row-b.row)[0];
        // Keep the selected activity on screen when 3D titles or a resize
        // change the number of rows that fit on each page.
        this.anchor=first?recordKey(first):undefined;
        const overview=bands.filter(b=>b.name.includes('overview_'));
        const overviewHeight=this.overviewHeight || Math.min(80,this.detailHeight/4);
        return [...detail,...overview.map(b=>({...b,height:overviewHeight/Math.max(1,overview.length)}))];
    }

    go(index) {
        if (this.timeline.ob_results?.loading) return;
        const next=Math.max(0,Math.min(this.pages.length-1,index));
        if (next===this.pageIndex) return;
        const r=this.timeline.ob_results;
        this.timeline.ob_scene[0].cancelPan?.(); r.captureRanges();
        this.pageIndex=next; this.anchor=undefined;
        if (r.supported) { r.navigationMap=r.map; r.request(); }
        else { this.signature=''; this.refresh(); }
    }

    layout() {
        const t=this.timeline;
        if (!this.pager) return;
        const height=this.detailHeight || this.availableHeight;
        styles(t.ob_timeline_panel,{top:this.top+'px',left:this.left+'px',width:this.width+'px',height:this.height+'px'});
        styles(t.ob_timeline_header,{width:this.width+'px'});
        styles(t.ob_timeline_body_frame,{top:this.headerHeight+'px',width:this.plotWidth+'px',height:height+'px',overflow:'hidden'});
        t.ob_timeline_body_frame.scrollTop=0; t.ob_timeline_body_frame.scrollLeft=0;
        styles(t.ob_timeline_body,{width:this.plotWidth+'px',height:height+'px',overflow:'hidden'});
        const table=t.ob_views?.tablePanel;
        const split=t.ob_views?.mode==='split';
        styles(table,{top:this.headerHeight+'px',left:(split?this.plotWidth:0)+'px',width:(split?this.width-this.plotWidth:this.width)+'px',
            height:(this.height-this.headerHeight)+'px',overflow:'hidden'});
        styles(t.ob_timeline_right_panel,{position:'absolute',top:(this.top+(this.overlay?this.headerHeight:0))+'px',
            left:(this.overlay?this.left+Math.max(0,this.width-Math.min(this.sideWidth,this.width)):this.left+this.width)+'px',
            width:Math.min(this.sideWidth || 320,window.innerWidth)+'px',
            height:Math.max(1,this.height-(this.overlay?this.headerHeight+(t.ob_views?.mode==='table'?0:this.overviewHeight):0))+'px',
            overflowY:'auto',overflowX:'hidden',zIndex:'100000'});
        this.sideResizer.hidden=!this.descriptorOpen;
        const panelStyle=t.ob_timeline_right_panel.style;
        styles(this.sideResizer,{top:panelStyle.top,left:(parseFloat(panelStyle.left)-5)+'px',height:panelStyle.height});
        if (this.descriptorOpen) {
            this.sideResizer.setAttribute('aria-valuemin',String(this.sideLimits.min));
            this.sideResizer.setAttribute('aria-valuemax',String(this.sideLimits.max));
            this.sideResizer.setAttribute('aria-valuenow',String(this.sideWidth));
            this.sideResizer.setAttribute('aria-valuetext',`${this.sideWidth} pixels wide`);
        }
        this.pager.hidden=!this.pagerHeight;
        styles(this.pager,{bottom:this.overviewHeight+'px',width:this.plotWidth+'px',height:'36px'});
        const active=document.activeElement;
        this.previous.disabled=this.pageIndex===0; this.next.disabled=this.pageIndex===this.pages.length-1;
        if ((active===this.previous || active===this.next) && active.disabled) t.ob_timeline_body_frame.focus({preventScroll:true});
        this.label.textContent=`Page ${this.pageIndex+1} of ${this.pages.length}`+(t.ob_results?.complete?'':' · loaded scope');
        if (this.continued?.length) this.label.textContent+=' · Session continues';
        this.label.title=this.continued?.length?'Continued sessions: '+this.continued.join(', '):'';
        t.ob_timeline_panel.style.setProperty('--ob-overview-height',this.overviewHeight+'px');
        t.ob_timeline_panel.style.setProperty('--demo-toolbar-height',this.headerHeight+'px');
        this.signature=this.layoutSignature();
        this.updateSettingsNotice();
    }

    mountSettings(panel) {
        const t=this.timeline,fieldset=panel.querySelector('fieldset');
        if (!fieldset || panel.querySelector('.ob_full_window')) return;
        const label=document.createElement('label'); label.className='ob_full_window';
        const input=document.createElement('input'); input.type='checkbox'; input.checked=this.preference.fullWindow;
        label.append(input,document.createTextNode(' Use full browser window'));
        fieldset.querySelector('legend').after(label);
        for (const key of ['top','left','width','height']) {
            const field=panel.querySelector(`[id="${t.name}_${key}"]`);
            field.value=this.preference[key]; field.min=(key==='width'||key==='height')?'1':'0';
            field.setAttribute('aria-label',key[0].toUpperCase()+key.slice(1));
        }
        const toggle=()=>{ for (const key of ['top','left','width','height']) panel.querySelector(`[id="${t.name}_${key}"]`).disabled=input.checked; };
        input.addEventListener('change',toggle); toggle();
        this.settingsNotice=document.createElement('p'); this.settingsNotice.className='ob_geometry_notice';
        this.settingsNotice.setAttribute('role','status'); fieldset.append(this.settingsNotice); this.updateSettingsNotice();
    }

    updateSettingsNotice() {
        if (this.settingsNotice?.isConnected) this.settingsNotice.textContent=`Available frame: ${this.width} × ${this.height} px.`+
            (!this.preference.fullWindow && (this.width<this.preference.width || this.height<this.preference.height)?' Requested size is retained until more space is available.':'');
    }

    applySettings() {
        const t=this.timeline,panel=document.getElementById(t.name+'_setting');
        const fullWindow=panel.querySelector('.ob_full_window input').checked;
        const next={...this.preference,fullWindow};
        if (!fullWindow) for (const key of ['top','left','width','height']) {
            const field=panel.querySelector(`[id="${t.name}_${key}"]`),value=Number(field.value);
            const valid=field.value!=='' && Number.isFinite(value) && value>=((key==='width'||key==='height')?1:0);
            field.setCustomValidity(valid?'':'Enter a valid size or position.');
            if (!valid) { field.reportValidity(); return; } next[key]=value;
        }
        this.preference=next;
        this.savePreference();
        this.signature=''; this.refresh();
    }
}
