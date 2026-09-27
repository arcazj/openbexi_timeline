/** Timeline presentation controls. The WebGL scene stays intact when switching views. */
export class TimelineViews {
    constructor(timeline) {
        this.timeline = timeline;
        this.mode = "timeline";
        this.sceneIndex = 0;
        this.dirty = true;
        this.scrollPositions = {timeline: 0};
        this.onScroll = () => {
            if (this.mode !== "table") this.scrollPositions[this.mode] = this.frame.scrollLeft;
            this.layoutTimeMarker();
            this.renderOverviewViewport();
        };

        this.controls = document.createElement("div");
        this.controls.className = "ob_view_modes";
        this.controls.setAttribute("role", "group");
        this.controls.setAttribute("aria-label", "Timeline view");
        this.buttons = new Map();
        const iconPaths = {
            timeline: "M3 3v18h18 M6 4h8v3H6z M11 10h9v3h-9z M6 16h6v3H6z",
            table: "M3 4h18v16H3z M3 9h18 M3 14h18 M9 4v16",
            split: "M3 4h18v16H3z M12 4v16 M5.5 8h4 M7 12h3 M5.5 16h3 M14.5 8h4 M14.5 12h4 M14.5 16h4"
        };
        for (const [mode, label] of [["timeline", "Timeline"], ["table", "Table"], ["split", "Split"]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.setAttribute("aria-label", label);
            button.setAttribute("aria-pressed", String(mode === this.mode));
            button.title = mode === "split" ? "Vertical split: timeline and table side by side" : label + " view";
            const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            icon.setAttribute("viewBox", "0 0 24 24");
            icon.setAttribute("aria-hidden", "true");
            icon.setAttribute("focusable", "false");
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", iconPaths[mode]);
            icon.appendChild(path);
            button.appendChild(icon);
            button.addEventListener("click", () => this.setMode(mode));
            this.controls.appendChild(button);
            this.buttons.set(mode, button);
        }
        // The header is also a drag handle. Using a view button must not move the panel.
        for (const type of ["mousedown", "mousemove", "mouseup", "mouseout"]) {
            this.controls.addEventListener(type, event => {
                event.stopPropagation();
                timeline.moving = false;
            });
        }
        timeline.ob_timeline_header.appendChild(this.controls);

        this.tablePanel = document.createElement("div");
        this.tablePanel.id = timeline.name + "_event_table";
        this.tablePanel.className = "ob_event_table_panel";
        this.tablePanel.setAttribute("role", "region");
        this.tablePanel.setAttribute("aria-label", "Timeline event table");
        this.tablePanel.tabIndex = 0;
        this.tablePanel.hidden = true;
        timeline.ob_timeline_panel.appendChild(this.tablePanel);
    }

    setMode(mode) {
        if (!this.buttons.has(mode)) return;
        if (mode === this.mode) return;
        if (this.timeline.ob_viewport) {
            const r=this.timeline.ob_results;
            this.timeline.ob_scene[this.sceneIndex].cancelPan?.();
            r.captureRanges(); this.mode=mode;
            this.timeline.ob_viewport.measure();
            r.pending=true; r.preserveVisible=false; r.visibleRanges.clear();
            r.request(); this.applyLayout(); return;
        }
        if (this.frame && this.mode !== "table") this.scrollPositions[this.mode] = this.frame.scrollLeft;
        this.mode = mode;
        this.applyLayout();
    }

    refresh(sceneIndex) {
        this.sceneIndex = sceneIndex;
        this.dirty = true;
        if (this.frame !== this.timeline.ob_timeline_body_frame) {
            if (this.frame) this.frame.removeEventListener("scroll", this.onScroll);
            this.frame = this.timeline.ob_timeline_body_frame;
            this.frame.addEventListener("scroll", this.onScroll, {passive: true});
        }
        this.applyLayout();
    }

    applyLayout() {
        const timeline = this.timeline;
        const frame = timeline.ob_timeline_body_frame;
        const scene = timeline.ob_scene[this.sceneIndex];
        if (!frame || !scene) return;

        timeline.ob_timeline_panel.dataset.viewMode = this.mode;
        for (const [mode, button] of this.buttons) {
            button.setAttribute("aria-pressed", String(mode === this.mode));
        }
        if (timeline.ob_viewport) {
            frame.hidden=this.mode==='table'; this.tablePanel.hidden=this.mode==='timeline';
            frame.scrollLeft=0; frame.scrollTop=0;
            timeline.ob_viewport.layout();
            if (this.mode!=='timeline' && this.dirty) this.renderTable();
            this.layoutToolbar(); this.renderOverviewViewport(); return;
        }
        const height = scene.ob_height;
        const headerHeight = parseInt(timeline.ob_timeline_header.style.height, 10) || 40;
        const splitWidth = Math.floor(scene.width / 2);
        const split = this.mode === "split";
        frame.hidden = this.mode === "table";
        // A scrollable viewport preserves canvas dimensions, camera, zoom and drag coordinates.
        frame.style.width = split ? splitWidth + "px" : "100%";
        frame.style.height = split ? height + "px" : "";
        this.tablePanel.hidden = this.mode === "timeline";
        this.tablePanel.style.top = headerHeight + "px";
        this.tablePanel.style.left = split ? splitWidth + "px" : "0px";
        this.tablePanel.style.width = split ? (scene.width - splitWidth) + "px" : "100%";
        this.tablePanel.style.height = height + "px";
        if (split && (this.scrollPositions.split === undefined || this.splitSceneWidth !== scene.width)) {
            this.scrollPositions.split = (scene.width - (frame.clientWidth || splitWidth)) / 2;
            this.splitSceneWidth = scene.width;
        }
        if (this.mode !== "table") frame.scrollLeft = this.scrollPositions[this.mode];
        if (this.mode !== "timeline" && this.dirty) this.renderTable();
        this.layoutToolbar();
        this.renderOverviewViewport();
    }

    renderOverviewViewport() {
        const scene = this.timeline.ob_scene[this.sceneIndex];
        if (scene?.ob_camera && scene?.ob_renderer && scene.overviewViewports?.length) {
            this.timeline.ob_render(this.sceneIndex);
        }
    }

    layoutToolbar() {
        const timeline = this.timeline;
        if (timeline.ob_results?.toolbar) { timeline.ob_results.layout(); this.layoutTimeMarker(); return; }
        const search = timeline.ob_search_input;
        const marker = timeline.ob_time_marker;
        if (!search || !marker) return;

        const controlsLeft = this.controls.offsetLeft;
        search.style.maxWidth = Math.max(40, controlsLeft - search.offsetLeft - 12) + "px";
        const left = Math.max(search.offsetLeft + search.offsetWidth + 12,
            timeline.ob_timeline_header.offsetWidth / 2 - 200);
        marker.style.left = left + "px";
        marker.style.width = Math.max(0, Math.min(500, controlsLeft - left - 12)) + "px";
        marker.title = marker.textContent;
        this.layoutTimeMarker();
    }

    layoutTimeMarker() {
        const timeline = this.timeline;
        const scene = timeline.ob_scene[this.sceneIndex];
        const marker = timeline.ob_marker;
        if (!this.frame || !marker || !scene) return;
        const width = this.frame.clientWidth || (this.mode === "split" ? Math.floor(scene.width / 2) : scene.width);
        const mainBand = scene.bands?.find(band => !band.name.includes('overview_'));
        const referenceOffset = mainBand?.timeScale ?
            timeline.dateToBandPixelOffSet(this.sceneIndex, mainBand, timeline.ob_scene.sync_time) : 0;
        const center = scene.width / 2 + referenceOffset - this.frame.scrollLeft;
        marker.style.left = (center - parseInt(marker.style.width, 10) / 2) + "px";
        marker.style.visibility = this.mode === "table" || center < 0 || center > width ? "hidden" : "visible";
    }

    renderTable() {
        const t=this.timeline,scene=t.ob_scene[this.sceneIndex],vp=t.ob_viewport;
        const active=document.activeElement;
        const focused=this.tablePanel.contains(active)?{page:active.dataset.page,key:active.dataset.record}:null;
        const entries=[];
        const records=scene.sessions?.densityRecords || scene.sessions?.events;
        for(const session of Array.isArray(records)?records:[]) {
            if(!session || session.zone!==undefined) continue;
            const activities=scene.sessions?.densityRecords?[session]:Array.isArray(session.activities)?session.activities:[session];
            for(const activity of activities) if(activity?.data && activity.zone===undefined)
                entries.push({activity,session,key:activity.matchKey || (activity.namespace || '')+':'+activity.id});
        }
        const table=document.createElement('table');table.className='ob_event_table';
        const caption=table.createCaption(),header=table.createTHead().insertRow(),body=table.createTBody();
        for(const label of ['Title','Start','End','Source','Status']) {
            const cell=document.createElement('th');cell.scope='col';cell.textContent=label;header.append(cell);
        }
        const render=({activity,session,key})=>{
            const data=activity.data,row=body.insertRow();
            if ((activity.searchMatch===true && t.ob_results?.state.highlight!==false) ||
                (!t.ob_results?.supported && String(activity.render?.backgroundColor).toUpperCase()==='#F8DF09')) {
                row.className='ob_event_table_match';row.setAttribute('aria-label','Search match: '+data.title);
            }
            const date=value=>value && t.formatEventDate?t.formatEventDate(value):value;
            for(const value of [data.title,date(activity.start),date(activity.end),
                activity.namespace ?? data.namespace ?? session.namespace ?? session.data?.namespace,data.status]) {
                const cell=row.insertCell();cell.textContent=value===undefined || value===null || value===''?'\u2014':String(value);
                cell.title=cell.textContent;
            }
            if(vp) {
                const button=document.createElement('button');button.type='button';button.className='ob_table_record';
                button.textContent=data.title || 'Event details';button.title=button.textContent;button.dataset.record=key;
                button.setAttribute('aria-label','Details: '+button.textContent);
                button.onclick=()=>t.ob_open_descriptor(this.sceneIndex,activity);
                row.cells[0].replaceChildren(button);
            }
            return row;
        };
        const count=entries.length;
        caption.textContent=count+(count===1?' event':' events');
        const oldScroll=[this.tablePanel.scrollTop,this.tablePanel.scrollLeft];
        this.tablePanel.replaceChildren(table);
        let from=0,to=count,pages=1;
        if(vp && count) {
            // All rows use one nowrap style; measure a real row before rendering
            // only the current page. Record count does not increase DOM size.
            const sample=render(entries[0]);
            const rowHeight=Math.max(34,sample.getBoundingClientRect().height || 34);
            const headerSpace=(caption.offsetHeight || 32)+(table.tHead.offsetHeight || 34);
            const space=Math.max(1,vp.height-vp.headerHeight-headerSpace);
            let capacity=Math.max(1,Math.floor(space/rowHeight));
            if(count>capacity) capacity=Math.max(1,Math.floor((space-36)/rowHeight));
            pages=Math.max(1,Math.ceil(count/capacity));
            const anchor=this.tableAnchor?entries.findIndex(e=>e.key===this.tableAnchor):-1;
            this.tablePage=Math.min(pages-1,Math.max(0,anchor>=0?Math.floor(anchor/capacity):(this.tablePage || 0)));
            from=this.tablePage*capacity;to=Math.min(count,from+capacity);
            this.tableAnchor=entries[from]?.key;
            body.replaceChildren();
        }
        for(const entry of entries.slice(from,to)) render(entry);
        if(!count) {
            this.tablePage=0;this.tableAnchor=undefined;
            const empty=body.insertRow().insertCell();empty.colSpan=5;empty.className='ob_event_table_empty';
            empty.textContent='No events to display.';
        }
        if(vp && pages>1) {
            const pager=document.createElement('nav');pager.className='ob_pagination ob_table_pagination';
            pager.setAttribute('aria-label','Table pages');
            const move=step=>{this.tablePage+=step;this.tableAnchor=undefined;this.renderTable();
                const button=this.tablePanel.querySelector(step>0?'[data-page="next"]':'[data-page="previous"]');
                (button?.disabled?this.tablePanel:button)?.focus();};
            const previous=document.createElement('button');previous.type='button';previous.textContent='Previous';previous.dataset.page='previous';
            previous.disabled=this.tablePage===0;previous.onclick=()=>move(-1);
            const next=document.createElement('button');next.type='button';next.textContent='Next';next.dataset.page='next';
            next.disabled=this.tablePage===pages-1;next.onclick=()=>move(1);
            const status=document.createElement('span');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
            status.textContent='Page '+(this.tablePage+1)+' of '+pages+(t.ob_results.complete?'':' \u00b7 loaded scope');
            pager.append(previous,status,next);this.tablePanel.append(pager);
            caption.textContent='Showing '+(from+1)+'\u2013'+to+' of '+count+' events';
        }
        this.tablePanel.scrollTop=vp?0:oldScroll[0];this.tablePanel.scrollLeft=vp?0:oldScroll[1];
        if(focused) {
            const target=[...this.tablePanel.querySelectorAll('button')].find(button=>
                focused.key?button.dataset.record===focused.key:button.dataset.page===focused.page);
            (target && !target.disabled?target:this.tablePanel).focus({preventScroll:true});
        }
        this.dirty=false;
    }
}
