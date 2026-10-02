import {renderingFor} from './openbexi_timeline_rendering.js';
import {dateAxisHeight} from './openbexi_timeline_paging.js';
import {parseTimelineDate} from './openbexi_timeline_data_parser.js';

const tableFields={title:'Title',start:'Start',end:'End',source:'Source',status:'Status',description:'Description',id:'ID'};
const tableCollator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
const recordSource=record=>[record?.namespace,record?.data?.namespace,record?.data?.source,record?.source]
    .find(value=>value!==undefined && value!==null && (typeof value!=='string' || value.trim()!==''));
const recordValues=({activity,session,source})=>({
    title:activity.data.title,start:activity.start,end:activity.end,
    source:source ?? recordSource(activity) ?? recordSource(session),
    status:activity.data.status,description:activity.data.description,id:activity.id
});
const csvCell=value=>{
    let text=String(value ?? '');
    // Spreadsheet programs evaluate formulas even in quoted CSV cells.
    if(/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
};
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
        const labels=renderingFor(timeline).controls;
        for (const [mode, label] of [["timeline", labels.timelineLabel], ["table", labels.tableLabel], ["split", labels.splitLabel]]) {
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
        const splitWidth = Math.floor(scene.width * renderingFor(this.timeline).layout.splitRatio);
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
        const width = this.frame.clientWidth || (this.mode === "split" ? Math.floor(scene.width * renderingFor(this.timeline).layout.splitRatio) : scene.width);
        const mainBand = scene.bands?.find(band => !band.name.includes('overview_'));
        const referenceOffset = mainBand?.timeScale ?
            timeline.dateToBandPixelOffSet(this.sceneIndex, mainBand, timeline.ob_scene.sync_time) : 0;
        const center = scene.width / 2 + referenceOffset - this.frame.scrollLeft;
        marker.style.left = (center - parseInt(marker.style.width, 10) / 2) + "px";
        const axisHeight=mainBand?.intervalUnitPos==='TOP'?dateAxisHeight(mainBand):0;
        marker.style.top = Math.max(0,(timeline.ob_timeline_header.offsetHeight || parseFloat(this.frame.style.top) || 0)+axisHeight-16)+'px';
        marker.style.zIndex = '35';
        marker.style.visibility = this.mode === "table" || center < 0 || center > width ? "hidden" : "visible";
    }

    tableColumns() {
        const configured=renderingFor(this.timeline).table.columns;
        const columns=[...configured,...Object.entries(tableFields).filter(([field])=>!configured.some(column=>column.field===field))
            .map(([field,label])=>({field,label,visible:false}))];
        return columns.map(column=>({...column,visible:this.columnVisibility?.[column.field] ?? column.visible!==false}));
    }

    capturePresentation() {
        return {sort:this.tableSort?{...this.tableSort}:null,columns:Object.fromEntries(this.tableColumns().map(column=>[column.field,column.visible]))};
    }

    restorePresentation(value) {
        if(!value || typeof value!=='object' || Array.isArray(value) || !('sort' in value || 'columns' in value)) return false;
        if(value.sort!=null && (!Object.hasOwn(tableFields,value.sort.field) || !['ascending','descending'].includes(value.sort.direction))) return false;
        if(value.columns!==undefined && (!value.columns || typeof value.columns!=='object' || Array.isArray(value.columns) ||
            !Object.entries(value.columns).every(([field,visible])=>Object.hasOwn(tableFields,field) && typeof visible==='boolean'))) return false;
        this.tableSort=Object.hasOwn(tableFields,value.sort?.field) && ['ascending','descending'].includes(value.sort?.direction)?
            {field:value.sort.field,direction:value.sort.direction}:undefined;
        this.columnVisibility={};
        for(const [field,visible] of Object.entries(value.columns || {}))
            if(Object.hasOwn(tableFields,field) && typeof visible==='boolean')this.columnVisibility[field]=visible;
        if(!this.tableColumns().some(column=>column.visible))this.columnVisibility={};
        this.tablePage=0;this.tableAnchor=undefined;this.dirty=true;
        return true;
    }

    sortTable(entries) {
        if(!this.tableSort) return;
        const {field,direction}=this.tableSort;
        const value=entry=>{
            const raw=recordValues(entry)[field];
            if(raw===undefined || raw===null || raw==='') return null;
            if(field==='start' || field==='end') {
                const time=parseTimelineDate(raw);
                return Number.isFinite(time)?time:null;
            }
            return String(raw);
        };
        const values=new Map(entries.map(entry=>[entry,value(entry)]));
        entries.sort((first,second)=>{
            const a=values.get(first),b=values.get(second);
            if(a===null || b===null) return a===b?0:a===null?1:-1;
            const result=typeof a==='number'?a-b:tableCollator.compare(a,b);
            return direction==='ascending'?result:-result;
        });
    }

    exportTableCSV(columns,feedback) {
        const axis=this.timeline.staticTimeAxis,numeric=axis?.kind==='numeric';
        const lines=[columns.map(column=>csvCell(column.label+(numeric && axis.unit && ['start','end'].includes(column.field)?' ('+axis.unit+')':''))).join(',')];
        for(const entry of this.tableEntries || []) {
            const values=recordValues(entry);
            if(numeric)for(const field of ['start','end'])if(values[field]!==undefined && values[field]!==null && values[field]!=='') {
                // Display labels round numeric scales. Export the source value,
                // including approximate prefixes and precision, whenever retained.
                const original=entry.activity.data[field+'Value'];
                values[field]=original!==undefined && original!==null && original!==''?original:
                    parseTimelineDate(values[field])/axis.millisecondsPerUnit/(axis.direction || 1);
            }
            lines.push(columns.map(column=>csvCell(values[column.field])).join(','));
        }
        let url;
        try {
            const blob=new Blob(['\uFEFF'+lines.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'});
            url=URL.createObjectURL(blob);
            const link=document.createElement('a');link.href=url;
            link.download=(this.timeline.name || 'timeline').replace(/[^a-z\d_-]/gi,'_')+'-events.csv';
            document.body.append(link);link.click();link.remove();
            feedback.textContent='Exported '+this.tableEntries.length+' records'+(this.tableComplete?' in the current table.':' from loaded data; coverage is incomplete.');
        } catch {feedback.textContent='CSV export is unavailable in this browser.';}
        finally {if(url)setTimeout(()=>URL.revokeObjectURL(url),1000);}
    }

    renderTableTools(columns,count,open) {
        const tools=document.createElement('div');tools.className='ob_table_tools';
        const choices=document.createElement('details');choices.className='ob_table_columns';choices.open=Boolean(open);
        const summary=document.createElement('summary');summary.textContent='Columns';summary.dataset.tableControl='columns';
        const list=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Visible columns';list.append(legend);
        for(const column of this.tableColumns()) {
            const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=column.visible;
            input.dataset.column=column.field;input.disabled=column.visible && !columns.some(other=>other.field!==column.field);
            input.onchange=()=>{this.columnVisibility ??={};this.columnVisibility[column.field]=input.checked;this.renderTable();};
            label.append(input,document.createTextNode(column.label));list.append(label);
        }
        choices.append(summary,list);
        choices.addEventListener('keydown',event=>{if(event.key==='Escape'){choices.open=false;summary.focus();event.stopPropagation();}});
        const exportButton=document.createElement('button');exportButton.type='button';exportButton.dataset.tableControl='export';
        exportButton.textContent=this.tableComplete?'Export CSV':'Export CSV (loaded records)';exportButton.disabled=count===0;
        const feedback=document.createElement('span');feedback.className='ob_table_export_status';feedback.setAttribute('role','status');
        feedback.id=this.timeline.name+'_table_export_status';
        feedback.textContent='All '+count+' records across table pages'+(this.tableComplete?'.':' \u00b7 Coverage incomplete; loaded records only.');
        exportButton.setAttribute('aria-describedby',feedback.id);
        exportButton.onclick=()=>this.exportTableCSV(columns,feedback);
        tools.append(choices,exportButton,feedback);return tools;
    }

    renderTable() {
        const t=this.timeline,scene=t.ob_scene[this.sceneIndex],vp=t.ob_viewport;
        const active=document.activeElement;
        const focused=this.tablePanel.contains(active)?{page:active.dataset.page,key:active.dataset.record,
            sort:active.dataset.sort,column:active.dataset.column,control:active.dataset.tableControl}:null;
        const columnsOpen=this.tablePanel.querySelector('.ob_table_columns')?.open;
        const entries=[];
        const recordBands=new Map();
        for(const band of vp?.fullBands || scene.bands || []) {
            if(band.name.includes('overview_'))continue;
            for(const session of band.sessions || [])for(const record of session.activities || [session])
                recordBands.set(record.matchKey || (record.namespace || '')+':'+record.id,band);
        }
        // densityRecords flattens the normalized tree. Retain its actual parent
        // source context, including structural parents in matches-only views.
        const sources=new Map();
        const collectSources=(records,inherited)=>{
            for(const record of Array.isArray(records)?records:[]) {
                if(!record)continue;
                const source=recordSource(record) ?? inherited;
                sources.set(record.matchKey || record,source);
                collectSources(record.activities,source);
            }
        };
        collectSources(scene.sessions?.events);
        const records=scene.sessions?.densityRecords || scene.sessions?.events;
        for(const session of Array.isArray(records)?records:[]) {
            if(!session || session.zone!==undefined) continue;
            const activities=scene.sessions?.densityRecords?[session]:Array.isArray(session.activities)?session.activities:[session];
            for(const activity of activities) if(activity?.data && activity.zone===undefined)
                entries.push({activity,session,source:sources.get(activity.matchKey || activity),
                    key:activity.matchKey || (activity.namespace || '')+':'+activity.id});
        }
        this.sortTable(entries);this.tableEntries=entries;
        this.tableComplete=Boolean(t.ob_results?.complete ?? t.staticData) && !t.ob_results?.remoteMetadata?.warnings?.length;
        const table=document.createElement('table');table.className='ob_event_table';
        const caption=table.createCaption(),header=table.createTHead().insertRow(),body=table.createTBody();
        const columns=this.tableColumns().filter(column=>column.visible);
        for(const column of columns) {
            const cell=document.createElement('th');cell.scope='col';
            const direction=this.tableSort?.field===column.field?this.tableSort.direction:'none';
            cell.setAttribute('aria-sort',direction);
            const sort=document.createElement('button');sort.type='button';sort.className='ob_table_sort';
            const label=document.createElement('span');label.className='ob_table_sort_label';label.textContent=column.label;
            const indicator=document.createElement('span');indicator.className='ob_table_sort_icon';indicator.setAttribute('aria-hidden','true');
            indicator.textContent=direction==='ascending'?'\u2191':direction==='descending'?'\u2193':'\u2195';
            sort.append(label,indicator);
            sort.setAttribute('aria-label',column.label);
            sort.dataset.sort=column.field;sort.title='Sort '+column.label+' '+(direction==='ascending'?'descending':'ascending');
            sort.onclick=()=>{
                this.tableSort={field:column.field,direction:direction==='ascending'?'descending':'ascending'};
                this.tablePage=0;this.tableAnchor=undefined;this.renderTable();
            };
            cell.append(sort);
            if(column.width)cell.style.width=column.width+'px';header.append(cell);
        }
        const render=entry=>{
            const {activity,session,key}=entry;
            const data=activity.data,row=body.insertRow();
            if ((activity.searchMatch===true && t.ob_results?.state.highlight!==false) ||
                (!t.ob_results?.supported && String(activity.render?.backgroundColor).toUpperCase()==='#F8DF09')) {
                row.className='ob_event_table_match';row.setAttribute('aria-label','Search match: '+data.title);
            }
            row.classList.toggle('ob_event_table_selected',key===t.ob_results?.selectedKey);
            if(key===t.ob_results?.selectedKey)row.setAttribute('aria-selected','true');
            const titleContent=()=>{
                const marker=document.createElement('span');marker.className='ob_table_marker';marker.setAttribute('aria-hidden','true');
                const band=recordBands.get(key) || scene.bands?.find(item=>!item.name.includes('overview_'));
                marker.style.backgroundColor=activity.render?.color ||
                    (activity.end || activity.activities ? band?.SessionColor : band?.eventColor) || '#238448';
                const icon=activity.render?.image ?? band?.image;
                if(icon) {
                    const image=document.createElement('img');image.alt='';image.src=icon;
                    image.onload=()=>marker.classList.add('ob_table_marker_image');
                    image.onerror=()=>{image.remove();marker.classList.remove('ob_table_marker_image');};
                    marker.append(image);
                }
                return marker;
            };
            const values=recordValues(entry);
            for(const field of ['start','end'])if(values[field]!==undefined && values[field]!==null && values[field]!=='' && t.formatEventDate)
                values[field]=t.formatEventDate(values[field]);
            for(const column of columns) {
                const value=values[column.field];
                const cell=row.insertCell();cell.textContent=value===undefined || value===null || value===''?'\u2014':String(value);
                cell.title=cell.textContent;
                if(column.field==='title')cell.prepend(titleContent());
            }
            if(vp) {
                const button=document.createElement('button');button.type='button';button.className='ob_table_record';
                button.textContent=data.title || 'Event details';button.title=button.textContent;button.dataset.record=key;
                button.prepend(titleContent());
                button.setAttribute('aria-label','Details: '+button.textContent);
                button.onclick=()=>t.ob_open_descriptor(this.sceneIndex,activity);
                const titleColumn=columns.findIndex(column=>column.field==='title');
                if(titleColumn>=0)row.cells[titleColumn].replaceChildren(button);
                else {row.tabIndex=0;row.dataset.record=key;row.setAttribute('aria-label','Details: '+button.textContent);
                    row.onclick=button.onclick;row.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();button.onclick();}};}
            }
            return row;
        };
        const count=entries.length;
        caption.textContent=count+(count===1?' event':' events');
        const oldScroll=[this.tablePanel.scrollTop,this.tablePanel.scrollLeft];
        const tools=this.renderTableTools(columns,count,columnsOpen);
        this.tablePanel.replaceChildren(tools,table);
        let from=0,to=count,pages=1;
        if(vp && count) {
            // All rows use one nowrap style; measure a real row before rendering
            // only the current page. Record count does not increase DOM size.
            const sample=render(entries[0]);
            const rowHeight=Math.max(34,sample.getBoundingClientRect().height || 34);
            const headerSpace=(caption.offsetHeight || 32)+(table.tHead.offsetHeight || 34)+(tools.offsetHeight || 64);
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
            const empty=body.insertRow().insertCell();empty.colSpan=columns.length;empty.className='ob_event_table_empty';
            empty.textContent=renderingFor(t).table.emptyText;
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
            status.textContent='Page '+(this.tablePage+1)+' of '+pages+(this.tableComplete?'':' \u00b7 loaded scope');
            pager.append(previous,status,next);this.tablePanel.append(pager);
            caption.textContent='Showing '+(from+1)+'\u2013'+to+' of '+count+' events';
        }
        this.tablePanel.scrollTop=vp?0:oldScroll[0];this.tablePanel.scrollLeft=vp?0:oldScroll[1];
        if(focused) {
            const target=[...this.tablePanel.querySelectorAll('button,input,summary,[data-record]')].find(button=>
                focused.key?button.dataset.record===focused.key:focused.sort?button.dataset.sort===focused.sort:
                    focused.column?button.dataset.column===focused.column:focused.control?button.dataset.tableControl===focused.control:
                        focused.page?button.dataset.page===focused.page:false);
            (target && !target.disabled?target:this.tablePanel).focus({preventScroll:true});
        }
        this.dirty=false;
    }
}
