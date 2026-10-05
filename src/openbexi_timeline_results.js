import {renderingFor} from './openbexi_timeline_rendering.js';
import {createStaticMatchSnapshot, createProviderMatchSnapshot, projectMatchSnapshot} from './openbexi_timeline_matches.js';
import {ADAPTIVE_LIMITS, finiteRange, fitRange, densityMap, chooseDensityMap, projectMap, zoomMappedRange} from './openbexi_timeline_adaptive.js';
import {measureCandidateLayout} from './openbexi_timeline_data.js';
import {recordKey} from './openbexi_timeline_paging.js';
import {filterLocalData,syncFilterSelection} from './openbexi_timeline_filters.js';
import {projectOverviewSessions} from './openbexi_timeline_overview.js';
import {syncOverviewPanel} from './openbexi_timeline_overview_panel.js';
import {TimelineExplorer} from './openbexi_timeline_explorer.js';
import {TimelineControls} from './openbexi_timeline_controls.js';
import {compileSearch, validateSearchMode} from './openbexi_timeline_search.js';
import {restoreAppearance} from './openbexi_timeline_appearance.js';

const overview = band => band.name.includes('overview_');
const instant = value => typeof value === 'number' ? value : Date.parse(value);
const node = (tag, text, attributes = {}) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
};
const button = (label, action) => { const element = node('button', label, {type: 'button'}); element.onclick = action; return element; };

export class TimelineResults {
    constructor(timeline) {
        this.timeline = timeline;
        const preferences=renderingFor(timeline).interaction;
        this.state = {query: '', searchMode:'text', mode: preferences.searchMode, highlight: preferences.highlight, auto: preferences.autoScale, ratio: preferences.adaptiveRatio};
        this.ranges = new Map();
        this.visibleRanges = new Map();
        this.overviewRanges = new Map();
        this.revision = 0;
        this.requestRevision = 0;
        this.complete = Boolean(timeline.staticData);
        this.supported = Boolean(timeline.staticData);
        this.gesture = false;
        this.scaleEngaged = false;
        this.pending = false;
        this.explorer = new TimelineExplorer(this);
        this.controls = new TimelineControls(this);
        if (timeline.staticData) this.prepare(timeline.staticData);
    }

    prepare(data, metadata) {
        if (!metadata) data = filterLocalData(data, this.timeline.ob_scene?.[0]?.ob_filter_value || '');
        const snapshot = metadata ? createProviderMatchSnapshot(data, metadata, this.state.query,
            {sourceScope: this.timeline.name || ''}) : createStaticMatchSnapshot(data, this.state.query,
            {sourceScope: this.timeline.name || '', searchMode:this.state.searchMode});
        const projection = projectMatchSnapshot(snapshot, this.state.mode);
        let domain = this.domain;
        if (!domain) {
            const axis = this.timeline.staticTimeAxis;
            const modelTime = value => axis?.kind === 'numeric' ? Number(value) * axis.millisecondsPerUnit * (axis.direction || 1) : instant(value);
            const bounds = (this.timeline.bands || []).flatMap(band => {
                const range = band.context || band.range;
                return range ? [modelTime(range.from), modelTime(range.to)] : [];
            }).filter(Number.isFinite);
            if (metadata?.domain) {
                bounds.length = 0;
                bounds.push(instant(metadata.domain.from), instant(metadata.domain.to));
            }
            if (!metadata?.domain) for (const entry of snapshot.entries) bounds.push(instant(entry.record.start), instant(entry.record.end ?? entry.record.start));
            const finite = bounds.filter(Number.isFinite);
            const center = instant(this.timeline.params?.[0]?.date);
            domain = finite.length ? finiteRange(finite.reduce((a,b) => Math.min(a,b)), finite.reduce((a,b) => Math.max(a,b))) :
                finiteRange((Number.isFinite(center) ? center : Date.now()) - 43200000, (Number.isFinite(center) ? center : Date.now()) + 43200000);
        }
        this.snapshot = snapshot;
        if(this.pendingSelection)this.selectRecord(this.pendingSelection);
        this.projection = projection;
        this.domain = domain;
        this.complete = metadata ? metadata.complete === true && instant(metadata.domain.from) <= domain.from &&
            instant(metadata.domain.to) >= domain.to : true;
        this.supported = true;
        this.map ??= densityMap([], domain, 1);
        this.sourceData = data;
        return projection;
    }

    rangeBands() {
        const sceneBands=this.timeline.ob_scene?.[0]?.bands || this.timeline.bands || [];
        // Page fragments omit other valid groups. During a scene rebuild the
        // unpaginated bands are authoritative; the previous fullBands may be stale.
        return sceneBands.some(band=>!overview(band) && band.pageFromRow!==undefined) ?
            this.timeline.ob_viewport?.fullBands || sceneBands : sceneBands;
    }

    selectActivity(key) {
        this.pendingSelection=null;
        this.selectedKey=key;
        this.selectionVersion=(this.selectionVersion || 0)+1;
        this.selectionStarted=window.performance.now();
    }

    selectRecord(record) {
        const entry=this.snapshot?.entries.find(entry=>entry.key===record.matchKey ||
            String(entry.record.id)===String(record.id) && Date.parse(entry.record.start)===Date.parse(record.start) &&
            (entry.record.namespace || '')===(record.namespace || record.data?.namespace || '') &&
            (!record.sourceRecordKey || entry.record.sourceRecordKey===record.sourceRecordKey));
        if(!entry) {this.pendingSelection=record;return;}
        this.selectActivity(entry.key);
        if(this.timeline.ob_viewport)this.timeline.ob_viewport.anchor=entry.key;
    }

    cancelFocus(settle = true) {
        if (!this.focusAnimation) return;
        window.cancelAnimationFrame(this.focusAnimation.frame);
        this.focusAnimation=null;this.gesture=false;
        this.captureRanges();
        if (settle) {this.request();this.timeline.ob_loader?.navigationChanged();}
    }

    focusRecord(record) {
        this.mapRestoration=null;
        this.controls.rememberView();
        this.cancelFocus(false);
        this.explorer.interrupt();this.selectRecord(record);
        const from=instant(record.start),to=instant(record.end || record.start);
        if (!Number.isFinite(from) || !Number.isFinite(to)) return;
        const t=this.timeline,scene=t.ob_scene[0];
        scene.cancelPan?.();
        const animation=this.focusAnimation={};
        animation.frame=window.requestAnimationFrame(()=>{
            if(this.focusAnimation!==animation)return;
            animation.started=true;
            this.captureRanges();
            const band=scene.bands.find(item=>!overview(item));
            const mesh=scene.getObjectByName(band?.name),range=this.visibleRanges.get(band?.name);
            if (!mesh || !range) {this.focusAnimation=null;return;}
            const center=(from+to)/2,span=range.to-range.from;
            const destination={from:center-span/2,to:center+span/2};
            const frame=t.ob_timeline_body_frame,width=frame.clientWidth || scene.width;
            const target=(frame.scrollLeft || 0)+width/2-scene.width/2-t.dateToBandPixelOffSet(0,band,center);
            const startX=mesh.position.x,started=window.performance.now();
            const duration=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 650;
            this.gesture=true;this.overviewDefaultsFrozen=true;
            const step=now=>{
                if (this.focusAnimation!==animation) return;
                const progress=duration?Math.min(1,(now-started)/duration):1;
                const eased=progress*progress*(3-2*progress);
                t.move_band(0,band.name,startX+(target-startX)*eased,mesh.position.y,mesh.position.z,true);
                t.ob_render(0);
                if (progress<1) animation.frame=window.requestAnimationFrame(step);
                else {
                    this.focusAnimation=null;this.gesture=false;
                    this.navigate(destination,true,{immediate:true,automatic:true});
                }
            };
            animation.frame=window.requestAnimationFrame(step);
        });
    }

    pruneRanges() {
        const names=new Set(this.rangeBands().filter(band=>!overview(band)).map(band=>band.name));
        for (const ranges of [this.ranges,this.visibleRanges])
            for (const name of ranges.keys()) if (!names.has(name)) ranges.delete(name);
    }

    captureRanges() {
        const scene = this.timeline.ob_scene?.[0];
        if (!scene?.bands) return;
        this.pruneRanges();
        for (const band of scene.bands.filter(band => !overview(band))) {
            const mesh = scene.getObjectByName(band.name);
            if (!mesh) continue;
            const from = this.timeline.pixelOffSetToBandDate(0, band, -scene.width / 2 - mesh.position.x).getTime();
            const to = this.timeline.pixelOffSetToBandDate(0, band, scene.width / 2 - mesh.position.x).getTime();
            if (Number.isFinite(from) && to > from) this.ranges.set(band.name, {from, to});
            const frame = this.timeline.ob_timeline_body_frame;
            const visibleWidth = this.timeline.ob_viewport ? scene.width :
                frame?.clientWidth || (this.timeline.ob_views?.mode === 'split' ? scene.width / 2 : scene.width);
            const left = (frame?.scrollLeft || 0) - scene.width / 2 - mesh.position.x;
            const visibleFrom = this.timeline.pixelOffSetToBandDate(0, band, left).getTime();
            const visibleTo = this.timeline.pixelOffSetToBandDate(0, band, left + visibleWidth).getTime();
            if (Number.isFinite(visibleFrom) && visibleTo > visibleFrom) this.visibleRanges.set(band.name,
                {from:visibleFrom,to:visibleTo,offset:(frame?.scrollLeft || 0)/scene.width,fraction:visibleWidth/scene.width});
        }
    }

    request(patch = {}, delay = 0) {
        if ('query' in patch || 'searchMode' in patch) {
            try { compileSearch(patch.query ?? this.state.query, patch.searchMode ?? this.state.searchMode); }
            catch(error) { this.searchError=error.message; this.updateUI(); return; }
            this.searchError='';
        }
        this.explorer.changed(patch);
        const keys = Object.keys(patch);
        if (keys.length) this.mapRestoration = null;
        if(keys.length)this.cancelFocus(false);
        this.presentationUpdate = keys.length === 0 && Boolean(this.snapshot) &&
            (Boolean(this.timeline.staticData) || this.remoteMetadata?.query === this.state.query);
        if (keys.length) {
            this.centerBounds=null;
            this.cancelled=false;
            if (this.gesture) { this.captureRanges(); this.preserveVisible = true; }
            this.timeline.ob_scene?.[0]?.cancelPan?.();
        }
        if (!this.pending) { this.captureRanges(); this.preserveVisible = true; }
        this.state = {...this.state, ...patch};
        if (keys.length) this.navigationMap = keys.every(key => key === 'highlight') ? this.map : null;
        if ('auto' in patch) this.scaleEngaged = true;
        this.revision++;
        this.pending = true;
        this.error = '';
        this.updateUI();
        clearTimeout(this.timer);
        if (this.gesture) { this.queued = true; return; }
        this.queued = false;
        if (!this.timeline.staticData && (this.remoteMetadata?.query !== this.state.query || 'searchMode' in patch)) {
            this.timeline.ob_scene[0].ob_search_value = this.state.query;
            this.timeline.load_data(0);
            return;
        }
        const revision = this.revision;
        this.timer = setTimeout(() => { if (revision === this.revision) this.commit(); }, delay);
    }

    commit() {
        if (this.gesture) { this.queued = true; return; }
        const timeline = this.timeline, scene = timeline.ob_scene[0];
        const previous = this.committed;
        try {
            this.prepare(this.remoteData || timeline.staticData, this.remoteMetadata);
            // Apply the search target before drawing so the first result appears
            // centered in the same frame as its matching records.
            this.explorer.centerSearchMatch({render:false});
            scene.ob_search_value = this.state.query;
            scene.sessions = this.projection;
            timeline.update_all_timelines(0, timeline.header, timeline.params, scene.bands, scene.model,
                this.projection, scene.ob_camera_type || 'Orthographic');
            this.centerBounds=null;
            this.remember();
            this.regroupRange = null;
            this.preserveVisible = false;
            this.pending = false;
            this.loading = false;
            this.updateUI();
            this.explorer.schedule();
        } catch (error) {
            this.centerBounds=null;
            if (previous) {
                Object.assign(this, previous);
                this.state = {...previous.state};
                scene.ob_search_value = this.state.query;
                scene.sessions = this.projection;
                try {
                    timeline.update_all_timelines(0, timeline.header, timeline.params, scene.bands, scene.model,
                        this.projection, scene.ob_camera_type || 'Orthographic');
                } catch (restoreError) {
                    error = new Error(`${error.message}; restoring the view failed: ${restoreError.message}`);
                }
            }
            this.fail(error);
        }
    }

    remember() {
        this.committed = {state: {...this.state}, snapshot: this.snapshot, projection: this.projection,
            map: this.map, ranges: new Map(this.ranges), scaleEngaged: this.scaleEngaged,
            domain: this.domain, complete: this.complete, remoteData: this.remoteData, remoteMetadata: this.remoteMetadata};
    }

    fail(error) {
        this.pending = false;
        this.loading = false;
        this.error = error.message || 'The update failed; the last complete view is retained.';
        this.updateUI();
    }

    // Called only for the current request/stream. Unsupported legacy providers
    // retain their existing response; their colors are never guessed as matches.
    acceptRemote(data, metadata) {
        if (!metadata) {
            this.supported = false; this.complete = false; this.pending = false; this.loading = false;
            this.remoteData=null;this.remoteMetadata=null;this.projection=null;
            this.updateUI();
            return false;
        }
        if (metadata.error) { this.fail(new Error(metadata.error)); return true; }
        if (metadata.query !== this.state.query) return true;
        try { validateSearchMode(metadata,this.state.searchMode,this.state.query); }
        catch(error) { this.fail(error); return true; }
        if (!this.gesture && !metadata.progressive) this.beginLoad();
        this.remoteData = data;
        this.remoteMetadata = metadata;
        if (!this.committed && !this.ranges.size) {
            // The legacy shell offsets its clock to display UTC with local Date
            // methods. Protocol records and scales use real instants instead.
            this.timeline.ob_scene.sync_time = this.timeline.get_synced_time();
            this.ranges.clear(); this.visibleRanges.clear();
            this.pending = true;
        }
        if (metadata.progressive) {
            this.domain = finiteRange(instant(metadata.domain.from), instant(metadata.domain.to));
            this.navigationMap = this.state.auto && metadata.complete && !this.gesture && !this.explorer.locked && !this.explorer.reading() ? null : this.map;
        } else this.navigationMap = null;
        this.request();
        return true;
    }

    beginGesture() { this.mapRestoration=null;this.cancelFocus(false);this.explorer.interrupt();this.gesture = true; this.overviewDefaultsFrozen=true; }
    endGesture() {
        this.gesture = false;
        this.captureRanges();
        this.scaleEngaged = true;
        if (this.queued) { this.queued = false; this.request(); }
        if (this.resizeQueued) { this.resizeQueued = false; window.dispatchEvent(new Event('resize')); }
        this.updateUI();
        this.explorer.schedule();
    }

    mapSettings() {
        const t=this.timeline;
        return JSON.stringify([this.state.query,this.state.searchMode,this.state.mode,this.state.auto,this.state.ratio,
            this.explorer.locked,t.ob_scene?.[0]?.ob_filter_value,t.ob_sortBy,t.ob_user_name,t.params?.[0]?.data]);
    }

    beginMapRestoration(requireFresh = false) {
        const map=densityMap([],this.domain);
        this.mapRestoration={settings:this.mapSettings(), requireFresh, previous:this.remoteMetadata, map};
        this.map=map;
        this.navigationMap=null;
    }

    computeMap() {
        const timeline = this.timeline;
        this.pruneRanges();
        const width = timeline.ob_scene?.[0]?.width || timeline.width || 1000;
        if (!(width > 0)) return;
        if (this.lastWidth !== width) this.navigationMap = null;
        this.lastWidth = width;
        if (this.mapRestoration && this.mapRestoration.settings!==this.mapSettings()) this.mapRestoration=null;
        const restoration=this.mapRestoration;
        if (restoration) {
            // Keep a single linear map through partial batches, then reconstruct
            // the saved presentation once authoritative coverage is complete.
            this.map=restoration.map;this.navigationMap=null;
            if (!this.complete || restoration.requireFresh && restoration.previous===this.remoteMetadata) return;
            this.mapRestoration=null;
        }
        if (!restoration && this.map && this.state.auto && (this.explorer.locked || this.explorer.reading())) this.navigationMap=this.map;
        if (this.navigationMap) {
            // Keep the pinned slopes during navigation, but use the current
            // loaded domain for zoom bounds after a distant calendar jump.
            this.map = this.remoteMetadata?.progressive ? {...this.navigationMap, domain:this.domain} : this.navigationMap;
            return;
        }
        if (!this.state.auto || !this.complete) { this.map = densityMap([], this.domain); return; }
        const records = this.projection.densityRecords;
        const bands = (timeline.ob_scene?.[0]?.bands || timeline.bands).filter(band => !overview(band));
        const candidate = chooseDensityMap(records, this.domain, this.state.ratio, candidate => {
            const packing=measureCandidateLayout(timeline, this.projection, bands, candidate,
                new Map(bands.map(band => [band.name, this.mappedRange(band.name, candidate)])), width);
            const quiet=candidate.segments.filter(segment=>!segment.density)
                .reduce((sum,segment)=>sum+candidate.map(segment.to)-candidate.map(segment.from),0);
            return packing+quiet*12;
        });
        // Keep small density changes from moving labels after every refresh.
        const old=this.map;
        const movement=old && candidate.segments.reduce((sum,s)=>sum+Math.abs(candidate.map(s.from)-old.map(s.from)),0)/candidate.segments.length;
        if(restoration || !old || old.domain.from!==this.domain.from || old.domain.to!==this.domain.to || old.ratio>this.state.ratio ||
            old.ratio===1 && candidate.ratio>1 || movement>.015) this.map=candidate;
    }

    belongs(record, band) {
        const field = path => path.split('.').reduce((value,key) => value?.[key], record);
        return (!band.filter || field(band.filter.field) === band.filter.equals) &&
            (!band.groupBy || (band.groupValues?.get(recordKey(record)) ?? field(band.groupBy) ?? 'Other') === band.groupValue) &&
            (!band.eventKind || (band.eventKind === 'duration') === Boolean(record.end));
    }

    mappedRange(name, map = this.map) {
        const range = this.ranges.get(name);
        const visible = this.visibleRanges.get(name);
        if (!visible || !this.preserveVisible || visible.fraction >= 1 && visible.offset === 0) return range;
        const span = (map.map(visible.to)-map.map(visible.from))/visible.fraction;
        const from = map.map(visible.from)-visible.offset*span;
        return {from:map.inverse(from),to:map.inverse(from+span)};
    }

    applyScale(band, width) {
        if (!this.domain || !(width > 0)) return;
        if (overview(band)) {
            const range = this.overviewRange(band, width);
            band.timeScale = projectMap(densityMap([], range), range, width);
            if (band.overviewLabel && /magnified/i.test(band.overviewLabel)) band.overviewLabel = 'Linear overview';
        } else {
            let range = this.mappedRange(band.name);
            if (!range) {
                range = band.timeScale ? {from: band.timeScale.from, to: band.timeScale.to} :
                    {from: this.timeline.ob_scene.sync_time - width * band.gregorianUnitLengths / band.intervalPixels / 2,
                        to: this.timeline.ob_scene.sync_time + width * band.gregorianUnitLengths / band.intervalPixels / 2};
                this.ranges.set(band.name, range);
            }
            // Preserve authored focus until the user explicitly enters data-driven
            // scaling/navigation. The UI labels that initial model focus honestly.
            if (!this.scaleEngaged && band.timeScale) return;
            if(this.centerBounds) {
                const {from,to}=this.centerBounds;
                const center=(this.map.map(from)+this.map.map(to))/2;
                const span=Math.max(this.map.map(range.to)-this.map.map(range.from),(this.map.map(to)-this.map.map(from))*1.2);
                range=finiteRange(this.map.inverse(center-span/2),this.map.inverse(center+span/2));
            }
            this.ranges.set(band.name, range);
            band.timeScale = projectMap(this.map, range, width);
            // A retained navigation map preserves horizontal spacing across
            // progressive pages, but its original domain is not the current
            // record coverage. Clip against the newly loaded interval instead.
            band.timeScale.contextFrom = this.domain.from;
            band.timeScale.contextTo = this.domain.to;
        }
        band.timeScale.axis = this.timeline.staticTimeAxis;
        band.autoTicks = this.state.auto;
        band.intervalPixels = band.gregorianUnitLengths * width / (band.timeScale.to - band.timeScale.from);
        band.minDate = new Date(this.domain.from); band.maxDate = new Date(this.domain.to);
    }

    navigate(range, fitVisible = false, {immediate = false, automatic = false, centerBounds = null, render = true} = {}) {
        if (!Number.isFinite(range?.from) || !Number.isFinite(range?.to) || range.to<=range.from) return;
        this.mapRestoration=null;
        this.cancelFocus(false);
        if(!automatic)this.explorer.interrupt();
        this.centerBounds=centerBounds;
        const scene=this.timeline.ob_scene[0];
        scene.cancelPan?.();
        delete scene.ob_pan_time;
        this.pruneRanges();
        this.overviewDefaultsFrozen=true;
        this.preserveVisible = fitVisible;
        this.scaleEngaged = true;
        this.timeline.ob_scene.sync_time = (range.from + range.to) / 2;
        for (const band of this.rangeBands().filter(band => !overview(band))) {
            this.ranges.set(band.name, range);
            const frame=this.timeline.ob_timeline_body_frame, width=scene.width;
            const offset=(frame.scrollLeft || 0)/width;
            const fraction=this.timeline.ob_viewport ? 1 : (frame.clientWidth || (this.timeline.ob_views?.mode === 'split' ? width/2 : width))/width;
            const mappedFrom=this.map.map(range.from),mappedSpan=this.map.map(range.to)-mappedFrom;
            const visible=fitVisible ? range : {from:this.map.inverse(mappedFrom+offset*mappedSpan),
                to:this.map.inverse(mappedFrom+(offset+fraction)*mappedSpan)};
            this.visibleRanges.set(band.name,{...visible,offset,fraction});
        }
        this.pending = true;
        if(render)this.request();
        if (!this.timeline.staticData && this.remoteMetadata) {
            clearTimeout(this.navigationTimer);
            this.navigationTimer=setTimeout(()=>{this.navigationTimer=null;this.timeline.load_data(0);},immediate ? 0 : 150);
        }
    }

    fit() {
        if (!this.complete || !this.snapshot?.matchingBounds) return;
        this.navigate(fitRange(this.snapshot.matchingBounds, this.domain), true);
    }

    overviewRange(band, width) {
        let saved = this.overviewRanges.get(band.name);
        const axis = this.timeline.staticTimeAxis;
        const time = value => axis?.kind === 'numeric' ? Number(value)*axis.millisecondsPerUnit*(axis.direction || 1) : instant(value);
        const authored = band.range || band.context;
        const bands=this.timeline.ob_scene?.[0]?.bands || this.timeline.bands || [];
        const mainBand=bands.find(item=>item.name===band.sourceBands?.[0]) || bands.find(item=>!overview(item));
        const main = this.ranges.get(mainBand?.name) || (mainBand?.timeScale?
            {from:mainBand.timeScale.from,to:mainBand.timeScale.to}:mainBand?.range?
                finiteRange(time(mainBand.range.from),time(mainBand.range.to)):this.ranges.values().next().value || this.domain);
        const ratio = Math.max(1, Math.min(12, Number(band.overviewContextRatio) || 4));
        const span = Math.max(main.to-main.from, saved?.manual ? saved.to-saved.from : authored ?
            Math.abs(time(authored.to)-time(authored.from)) : saved && this.overviewDefaultsFrozen ? saved.to-saved.from :
                Math.min(this.domain.to-this.domain.from,(main.to-main.from)*ratio));
        const center=(main.from+main.to)/2;
        saved={...saved,...finiteRange(center-span/2,center+span/2),authored:Boolean(authored)};
        this.overviewRanges.set(band.name, saved);
        return saved;
    }

    refreshOverview(name) {
        const t=this.timeline, scene=t.ob_scene[0];
        const band=scene.bands.find(b=>b.name===name);
        if (!band) return;
        this.applyScale(band,scene.width);
        projectOverviewSessions(t,0);
        syncOverviewPanel(t,0);
    }

    fitOverview(name) {
        this.captureRanges();
        const main=this.visibleRanges.values().next().value || this.ranges.values().next().value || this.domain;
        const center=(main.from+main.to)/2;
        const radius=Math.max(center-this.domain.from,this.domain.to-center,(main.to-main.from)/2);
        this.overviewRanges.set(name,{from:center-radius,to:center+radius,manual:true});
        this.refreshOverview(name);
    }

    panOverview(name, fraction) {
        const band=this.timeline.ob_scene[0].bands.find(b=>b.name===name);
        if (!band) return;
        this.captureRanges();
        const range=this.overviewRange(band), shift=(range.to-range.from)*fraction;
        const main=this.ranges.values().next().value;
        if (main) this.navigate({from:main.from+shift,to:main.to+shift});
    }

    zoom(factor, clientX, onOverview = false) {
        if (this.loading) return;
        const timeline = this.timeline, scene = timeline.ob_scene[0];
        if (onOverview) {
            const band=scene.bands.find(b=>typeof onOverview==='string' ? b.name===onOverview : overview(b));
            if (!band) return;
            this.captureRanges();
            const range=this.overviewRange(band,scene.width), map=densityMap([],range);
            const anchor=(range.from+range.to)/2;
            this.overviewRanges.set(band.name,{...zoomMappedRange(map,range,anchor,factor,.5,{constrainToDomain:false}),manual:true});
            this.refreshOverview(band.name);
            return;
        }
        const wasGesture = this.gesture;
        scene.cancelPan?.();
        const band = scene.bands.find(band => !overview(band));
        if (!band) return;
        if (!this.pending || wasGesture) this.captureRanges();
        const range = this.ranges.get(scene.bands.find(band => !overview(band)).name);
        const frame = timeline.ob_timeline_body_frame;
        const rect = frame.getBoundingClientRect();
        const local = clientX === undefined ? (rect.width || scene.width) / 2 : clientX - rect.left;
        const fraction = Math.max(0, Math.min(1, ((frame.scrollLeft || 0) + local) / scene.width));
        const map = this.map;
        const anchor = !this.scaleEngaged && band.timeScale ? band.timeScale.toTime(-scene.width/2 + fraction*scene.width -
                (scene.getObjectByName(band.name)?.position.x || 0)) :
                map.inverse(map.map(range.from) + fraction * (map.map(range.to) - map.map(range.from)));
        this.navigationMap = map;
        // Connected coverage is a cache window, not the archive boundary.
        // Zooming out must be able to request a wider interval immediately.
        this.navigate(zoomMappedRange(map, range, anchor, factor, fraction,
            {constrainToDomain:!this.remoteMetadata?.progressive}));
    }

    mount() {
        const t = this.timeline;
        if (this.toolbar) { this.updateUI(); return; }
        restoreAppearance();
        const header = t.ob_timeline_header;
        header.classList.add('ob_results_header');
        const nav = node('div', undefined, {class: 'ob_results_navigation'});
        this.primaryNavigation = nav;
        const iconGroup = (...icons) => {
            const group=node('span',undefined,{class:'ob_toolbar_group'});
            group.hidden=icons.every(icon=>icon.hidden);
            group.append(node('span',undefined,{class:'ob_toolbar_separator','aria-hidden':'true'}),...icons);
            return group;
        };
        nav.append(t.ob_start, t.ob_stop, t.ob_sync);
        const utilities = node('div', undefined, {class: 'ob_results_utilities'});
        this.utilities = utilities;
        utilities.append(t.ob_views.controls, iconGroup(t.ob_view,t.ob_no_view), t.ob_3d,
            node('span',undefined,{class:'ob_toolbar_separator','aria-hidden':'true'}), t.ob_settings, t.ob_help);
        this.toolbar = node('div', undefined, {class: 'ob_results_controls', role: 'group', 'aria-label': 'Search and results'});
        this.search = node('div', undefined, {class:'ob_results_search'});
        const submitSearch = () => { clearTimeout(this.searchTimer); this.request({query:t.ob_search_input.value,searchMode:this.searchMode.value}); };
        const searchButton = button('', () => { submitSearch(); t.ob_search_input.focus(); });
        searchButton.className = 'ob_results_search_button';
        searchButton.setAttribute('aria-label', 'Search');
        searchButton.title = 'Search events and sessions';
        t.ob_search.alt = '';
        t.ob_search.onclick = null;
        searchButton.append(t.ob_search);
        t.ob_search_input.setAttribute('aria-label', 'Search');
        this.searchMode=node('select',undefined,{'aria-label':'Search mode'});
        for(const [value,label] of [['text','Text'],['pattern','Pattern'],['legacy','Legacy']])this.searchMode.append(node('option',label,{value}));
        this.searchMode.onchange=submitSearch;
        t.ob_search_input.maxLength=500;
        t.ob_search_input.onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); submitSearch(); } };
        t.ob_search_input.oninput = event => {
            clearTimeout(this.searchTimer);
            if(event.isComposing)return;
            // Cancel the old search immediately; defer starting a new network request.
            this.explorer.interrupt();
            this.updateUI();
            this.searchTimer=setTimeout(submitSearch,t.staticData?140:300);
        };
        t.ob_search_input.addEventListener('compositionend',()=>t.ob_search_input.oninput({isComposing:false}));
        t.ob_search_input.addEventListener('search', submitSearch);
        this.searchErrorLabel=node('span','',{class:'ob_search_error',role:'alert',id:t.name+'_search_error'});
        this.searchErrorLabel.hidden=true;
        t.ob_search_input.setAttribute('aria-describedby',this.searchErrorLabel.id);
        this.auto = node('input', undefined, {type: 'checkbox'});
        this.auto.onchange = () => this.request({auto: this.auto.checked});
        const autoLabel = node('label', ' Auto scale'); autoLabel.prepend(this.auto);
        this.autoLabel = autoLabel;
        this.highlight = node('input', undefined, {type:'checkbox'});
        this.highlight.onchange = () => this.request({highlight:this.highlight.checked});
        const highlightLabel = node('label', ' Highlight matches', {title:'Emphasize search matches in the timeline and overview.'});
        highlightLabel.prepend(this.highlight);
        this.mode = node('input', undefined, {type:'checkbox'});
        this.mode.onchange = () => this.request({mode:this.mode.checked ? 'only' : 'highlight'});
        const modeLabel = node('label', ' Show only matches', {title:'Hide nonmatching events and sessions while retaining required session context.'});
        modeLabel.prepend(this.mode);
        this.fitButton = button('Fit matches', () => this.fit());
        this.clearButton = button('Clear search', () => {
            clearTimeout(this.searchTimer);t.ob_search_input.value = ''; t.ob_search_input.focus(); this.request({query: ''});
        });
        this.search.append(searchButton, t.ob_search_input, this.searchErrorLabel);
        this.viewControls = node('span', undefined, {class:'ob_view_controls'});
        this.viewControls.append(this.clearButton);
        this.matchControls = [highlightLabel, modeLabel, this.fitButton, this.clearButton];
        this.toolbar.append(highlightLabel, modeLabel, this.fitButton, this.viewControls);
        this.details = node('details', undefined, {class:'ob_results_details',id:t.name+'_status_details'});
        const detailsSummary=node('summary','Timeline details',{hidden:''});
        const toggleDetails = () => { this.details.open=!this.details.open;syncDetails(); };
        this.detailsToggle = button('Timeline details',toggleDetails);
        this.detailsToggle.setAttribute('aria-controls',this.details.id);
        this.detailsToggle.setAttribute('aria-expanded','false');
        this.statusExplanation = node('p', '', {class:'ob_status_explanation'});
        this.summary = node('div', undefined, {class:'ob_results_summary'});
        this.details.append(detailsSummary, this.statusExplanation, this.summary);
        const syncDetails = () => {
            this.details.hidden=!this.details.open;
            header.classList.toggle('ob_results_expanded', this.details.open);
            for (const control of [this.status,this.detailsToggle]) control?.setAttribute('aria-expanded',String(this.details.open));
            this.layout();
        };
        this.details.hidden=true;
        this.details.addEventListener('toggle',syncDetails);
        const closeDetails=event=>{
            if(event.key==='Escape' && this.details.open){event.preventDefault();this.details.open=false;syncDetails();
                (event.currentTarget===this.status || this.controls.compact?this.status:this.detailsToggle).focus({preventScroll:true});}
        };
        this.details.addEventListener('keydown',closeDetails);
        this.detailsToggle.addEventListener('keydown',closeDetails);
        this.status = button('Status: Loading…',toggleDetails);
        this.status.className='ob_results_status';
        this.status.setAttribute('aria-controls',this.details.id);
        this.status.setAttribute('aria-expanded','false');
        this.status.addEventListener('keydown',closeDetails);
        this.statusMessage=node('span','',{class:'ob_status_message',role:'status','aria-live':'polite','aria-atomic':'true'});
        this.feedback = node('div', undefined, {class:'ob_results_feedback'});
        this.filterButton=button('Filters',()=>t.ob_filter.click());
        this.filterButton.className='ob_toolbar_filter';
        this.filterButton.setAttribute('aria-label','Filters');
        this.filterButton.prepend(t.ob_filter);
        const openFilter=t.ob_filter.onclick;
        t.ob_filter.onclick=event=>{event.stopPropagation();openFilter.call(t.ob_filter,event);};
        this.feedback.append(t.ob_calendar,node('span',undefined,{class:'ob_toolbar_separator ob_calendar_separator','aria-hidden':'true'}),
            this.filterButton,node('span',undefined,{class:'ob_toolbar_separator','aria-hidden':'true'}),this.detailsToggle);
        this.retryButton = button('Retry', () => { this.explorer.interrupt();this.retrying=true;this.timeline.load_data(0); });
        this.refreshButton=button('Refresh',()=>{
            this.explorer.interrupt();
            if(t.staticData && t.localSource)t.loadLocalData();
            else if(t.staticData)this.request();
            else if(t.ob_loader?.input)t.ob_loader.load(t.ob_loader.input,{refresh:true});
            else t.load_data(0);
        });
        this.refreshButton.title='Check for updated data in this view.';
        this.liveStatus=node('span','',{class:'ob_live_status'});
        this.loadingStatus=node('span','Loading items…',{class:'ob_loading_status ob_connection_warning',role:'status','aria-live':'polite'});
        this.loadingStatus.hidden=true;
        this.details.append(this.liveStatus,this.loadingStatus);
        this.statusGroup=node('div',undefined,{class:'ob_status_controls'});
        this.availableButton=button('Go to latest data',()=>{
            const available=this.latestAvailable();
            if (!available) return;
            const main=this.visibleRanges.values().next().value || this.ranges.values().next().value;
            if(!main)return;
            const span=main.to-main.from;
            const center=instant(available.from);
            this.navigate({from:center-span/2,to:center+span/2},true);
        });
        this.availableButton.title='Go to the latest timestamp observed while loading. Coverage may be partial.';
        const titleSlot=node('div',undefined,{class:'ob_results_title_slot'}); titleSlot.append(t.ob_time_marker);
        this.titleSlot=titleSlot;
        this.primaryToolbar=node('div',undefined,{class:'ob_primary_toolbar',role:'group','aria-label':'Main menu bar',tabindex:'0'});
        this.primaryToolbar.append(nav,this.search,titleSlot,utilities);
        this.activityToolbar=node('div',undefined,{class:'ob_activity_toolbar',role:'group','aria-label':'Secondary menu bar',tabindex:'0'});
        header.replaceChildren(this.primaryToolbar,this.activityToolbar,this.details);
        if (t.ob_marker) {
            t.ob_marker.classList.add('ob_results_marker');
            t.ob_marker.style.top = '0px';
            t.ob_timeline_panel.append(t.ob_marker);
        }
        const wheel = event => {
            if (t.ob_perspective?.adjusting && t.ob_timeline_body_frame.contains(event.target)) return;
            if (!this.supported || (this.gesture && !this.focusAnimation && t.ob_scene[0].ob_pan_frame === undefined) ||
                event.target.closest('input,select,button,textarea,summary')) return;
            const footer = event.target.closest('.ob_docked_overview');
            if (!footer && !t.ob_timeline_body_frame.contains(event.target)) return;
            if (!Number.isFinite(event.deltaY) || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
            this.cancelFocus(false);
            event.preventDefault();
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
            this.zoom(Math.exp(Math.max(-0.4, Math.min(0.4, delta * 0.002))), event.clientX, footer?.dataset.overviewBand || false);
        };
        t.ob_timeline_panel.addEventListener('wheel', wheel, {passive: false});
        t.ob_timeline_body_frame.title = 'Scroll up to zoom in; scroll down to zoom out.';
        this.empty = node('div', undefined, {class: 'ob_results_empty', role: 'status'});
        this.empty.hidden = true;
        t.ob_stop.tabIndex = 0;
        t.ob_stop.setAttribute('role', 'button');
        t.ob_stop.addEventListener('keydown', event => {
            if ((event.key === 'Enter' || event.key === ' ') && t.ob_stop.getAttribute('aria-disabled') !== 'true') {
                event.preventDefault(); t.ob_stop.click();
            }
        });
        for (const type of ['pointerdown', 'pointermove']) t.ob_timeline_panel.addEventListener(type, event => {
            t.ob_scene[0].panPointerX = event.clientX;
            t.ob_scene[0].panPointerTime = event.timeStamp;
            t.ob_scene[0].panReleaseTime = undefined;
        }, true);
        t.ob_timeline_panel.addEventListener('pointerup', event => { t.ob_scene[0].panReleaseTime = event.timeStamp; }, true);
        document.addEventListener('pointerdown', () => {
            this.cancelFocus();
            const scene = t.ob_scene[0];
            if (scene.ob_pan_frame !== undefined) {
                scene.cancelPan();
                t.finish_static_pan(0);
            }
        }, true);
        const guard = event => {
            if(event.type==='keydown' && event.key==='Escape' && this.controls.morePanel && !this.controls.morePanel.hidden)return;
            if (event.type==='keydown' && event.key==='Escape' && this.details.open && (this.details.contains(event.target) || event.target===this.detailsToggle || event.target===this.status)) return;
            if (event.type==='keydown' && event.key==='Escape' && t.ob_perspective?.adjusting && t.ob_timeline_body_frame.contains(event.target)) return;
            if ((this.loading || this.fetching) && event.type === 'keydown' && event.key === 'Escape') {
                event.preventDefault(); this.cancelLoad(); return;
            }
            if (!this.loading || event.target === t.ob_stop || event.target === t.ob_help || event.target===this.controls.moreButton || event.target===this.controls.morePanel?.firstElementChild ||
                event.target === this.status || event.target === this.liveStatus || event.target===this.detailsToggle || event.target===this.explorer.stop || this.details.contains(event.target)) return;
            if (event.type === 'keydown' && event.key === 'Tab') return;
            event.preventDefault(); event.stopImmediatePropagation();
        };
        for (const type of ['pointerdown', 'click', 'dblclick', 'keydown', 'wheel'])
            t.ob_timeline_panel.addEventListener(type, guard, {capture:true, passive:false});
        t.ob_timeline_right_panel?.addEventListener('click', guard, true);
        this.selectionNotice = node('div', undefined, {class: 'ob_selection_notice'});
        this.selectionNotice.append(node('span', 'Selection hidden by results filter '), button('Show context', () => this.request({mode: 'highlight'})));
        this.details.append(this.selectionNotice);
        this.explorer.mount(header);
        this.statusGroup.append(this.retryButton,this.status,this.statusMessage);
        this.controls.mount();
        this.updateUI();
    }

    beginLoad() {
        this.loading = true; this.pending = true; this.presentationUpdate = false;
        this.error = ''; this.cancelled = false;
        this.updateUI();
    }

    cancelLoad() {
        this.mapRestoration=null;
        clearTimeout(this.searchTimer);
        this.explorer.interrupt();
        const t = this.timeline;
        t.ob_loader?.cancel();
        t.localDataAbort?.abort(); this.fetching=false; this.localProgress='';
        t.dataAbort?.abort(); t.eventSource?.close();
        this.requestRevision++; this.revision++;
        clearTimeout(this.timer); this.queued = false;
        if (this.committed) {
            this.state = {...this.committed.state};
            this.remoteData = this.committed.remoteData;
            this.remoteMetadata = this.committed.remoteMetadata;
            t.ob_search_input.value = this.state.query;
        }
        this.loading = false; this.pending = false; this.error = ''; this.cancelled = true;
        this.updateUI();
    }

    updateLoadingUI() {
        if (!this.toolbar) return;
        const t = this.timeline, busy = Boolean(this.loading);
        const working = busy || Boolean(this.fetching);
        t.ob_timeline_header.classList.toggle('ob_results_loading', working);
        if (working) {
            t.ob_stop.setAttribute('aria-label', 'Stop loading');
            t.ob_stop.title = 'Stop loading (Esc)';
            t.ob_stop.removeAttribute('aria-disabled');
        } else {
            t.ob_stop.removeAttribute('aria-label');
            t.ob_stop.title = t.staticData ? 'Local dataset — no server connection required' : t.ob_stop.alt;
            if (t.staticData) t.ob_stop.setAttribute('aria-disabled', 'true');
        }
        t.ob_timeline_body_frame.setAttribute('aria-busy', String(busy));
        for (const area of [t.ob_timeline_body_frame, t.ob_views?.tablePanel, t.ob_timeline_right_panel, t.ob_viewport?.pager]) if (area) area.inert = busy;
        this.disabledControls ??= new Map();
        if (busy) {
            for (const control of t.ob_timeline_header.querySelectorAll('button,input,select,img')) {
                if (control === t.ob_stop || control === t.ob_help || control === this.controls.moreButton || control === this.controls.morePanel?.firstElementChild || control === this.status || control === this.liveStatus || control===this.detailsToggle || control===this.explorer.stop) continue;
                if (!this.disabledControls.has(control)) this.disabledControls.set(control, Boolean(control.disabled));
                control.disabled = true; control.setAttribute('aria-disabled', 'true');
            }
        } else {
            for (const [control, disabled] of this.disabledControls) {
                control.disabled = disabled; control.removeAttribute('aria-disabled');
            }
            this.disabledControls.clear();
        }
        if (t.ob_scene[0].dragControls) t.ob_scene[0].dragControls.enabled = !busy;
        t.ob_perspective?.syncInteraction();
        if (busy && !this.wasLoading) {
            this.focusBeforeLoad = document.activeElement;
            if (t.ob_timeline_panel.contains(this.focusBeforeLoad) || t.ob_timeline_right_panel?.contains(this.focusBeforeLoad))
                t.ob_stop.focus({preventScroll:true});
        } else if (!busy && this.wasLoading && document.activeElement === t.ob_stop) {
            (this.focusBeforeLoad?.isConnected ? this.focusBeforeLoad : t.ob_search_input).focus({preventScroll:true});
        }
        this.wasLoading = busy;
        if (!busy && this.resizeQueued && !this.gesture) {
            this.resizeQueued = false;
            t.ob_viewport?.schedule();
        }
    }

    mountSettings(panel) {
        if (panel.querySelector('.ob_scale_settings')) return;
        const fieldset = node('fieldset', undefined, {class: 'ob_scale_settings'});
        fieldset.append(node('legend', 'Timeline display'));
        const input = node('input', undefined, {type: 'number', min: 1, max: ADAPTIVE_LIMITS.maxRatio, step: 1, 'aria-label': 'Maximum adaptive ratio'});
        input.value = this.state.ratio;
        const label = node('label', 'Maximum adaptive ratio (1–16×) '); label.append(input);
        input.onchange = () => {
            const ratio = Number(input.value);
            const valid = Number.isFinite(ratio) && ratio >= 1 && ratio <= ADAPTIVE_LIMITS.maxRatio;
            input.setCustomValidity(valid ? '' : 'Choose a ratio from 1 to 16.');
            if (valid) this.request({ratio}); else input.reportValidity();
        };
        fieldset.append(label, node('p', 'Limits the busiest-to-quietest time slope. It does not change the time range or enable Auto scale.'));
        panel.append(fieldset);
    }

    latestAvailable() {
        const remote=this.remoteMetadata?.latestRange || this.remoteMetadata?.availableRange;
        if(remote && Number.isFinite(instant(remote.from)))return remote;
        let latest=-Infinity;
        for(const entry of this.snapshot?.entries || []) {
            const timestamp=instant(entry.record.end || entry.record.start);
            if(Number.isFinite(timestamp))latest=Math.max(latest,timestamp);
        }
        return Number.isFinite(latest)?{from:new Date(latest).toISOString()}:null;
    }

    visibleCoverage() {
        const metadata=this.remoteMetadata,range=this.visibleRanges.values().next().value || this.ranges.values().next().value;
        const entries=metadata?.coverage;
        if(!Array.isArray(entries) || !entries.length || !Number.isFinite(range?.from) || !(range.to>range.from))
            return {complete:this.complete && metadata?.complete!==false,limited:Boolean(metadata?.loadLimited),warnings:metadata?.warnings || []};
        const visible=entries.map(entry=>({...entry,from:instant(entry.from),to:instant(entry.to)}))
            .filter(entry=>Number.isFinite(entry.from) && Number.isFinite(entry.to) && entry.to>entry.from && entry.from<range.to && entry.to>range.from)
            .sort((a,b)=>a.from-b.from);
        let edge=range.from;
        for(const entry of visible.filter(entry=>entry.complete)) {
            // Date serialization rounds sub-millisecond projection endpoints.
            if(entry.from>edge+1)break;
            edge=Math.max(edge,entry.to);
        }
        const complete=visible.some(entry=>entry.complete) && edge>=range.to-1;
        return {complete,limited:!complete && visible.some(entry=>entry.state==='limited'),
            warnings:visible.flatMap(entry=>entry.warnings || [])};
    }

    statusPresentation(working,coverage=this.visibleCoverage()) {
        const search=this.explorer;
        if(this.error || this.searchError || search.failure)return {state:'error',label:'Error',tone:'error'};
        if(search.seeking || search.searchQuery)return {state:'searching',label:'Searching…',tone:'warning'};
        if(working)return {state:'loading',label:'Loading…',tone:'warning'};
        if(this.cancelled || search.outcome==='stopped')return {state:'cancelled',label:'Cancelled',tone:'neutral'};
        if(coverage.limited)return {state:'limited',label:'Data limit reached',tone:'warning'};
        if(search.outcome==='incomplete')return {state:'incomplete',label:'Search incomplete',tone:'warning'};
        if(!this.supported || !coverage.complete || coverage.warnings.length)
            return {state:'partial',label:'Partial data',tone:'warning'};
        if(this.liveState && this.liveState!=='Live')return {state:'reconnecting',label:'Connection interrupted',tone:'warning'};
        return {state:'ready',label:'Ready',tone:'success'};
    }

    updateUI() {
        if (!this.toolbar) return;
        // Release owned disabled states before applying current availability.
        if (!this.loading) this.updateLoadingUI();
        const t = this.timeline;
        if(!this.searchError)this.searchMode.value=this.state.searchMode;
        syncFilterSelection(t);
        this.searchErrorLabel.textContent=this.searchError || '';
        this.searchErrorLabel.hidden=!this.searchError;
        this.auto.checked = this.state.auto; this.mode.checked = this.state.mode === 'only';
        const sorting=document.getElementById(t.name+'_setting')?.querySelector('#ob_sort_by');
        if (sorting) {
            const selected=sorting.value || t.ob_sortBy || 'NONE';
            const options=t.ob_get_all_sorting_options(0);
            if (sorting.innerHTML!==options) { sorting.innerHTML=options; sorting.value=selected; }
        }
        this.highlight.checked = this.state.highlight !== false;
        this.auto.disabled = this.mode.disabled = this.highlight.disabled = !this.supported;
        const active = Boolean(this.state.query.trim() ||
            (this.snapshot?.hasCondition && this.snapshot.query === this.state.query));
        this.toolbar.hidden = !this.supported && !active && !this.state.auto;
        for (const control of this.matchControls) control.hidden = !active;
        t.ob_search_input.setAttribute('aria-invalid', this.error || this.searchError ? 'true' : 'false');
        const working=Boolean(this.loading || this.fetching || this.pending && !this.presentationUpdate || this.explorer.seeking);
        const coverage=this.visibleCoverage();
        const status = this.error ? (this.snapshot?.entries.length?'Update unavailable — displayed records retained':'Source unavailable — open details') : this.cancelled ? 'Loading cancelled' : working && !coverage.warnings.length && !coverage.limited ? '' :
            !this.supported ? 'Match controls unavailable' : coverage.limited ? 'Data limit reached' : !coverage.complete ? 'Partial data' :
                this.snapshot?.hasCondition && !this.snapshot.matchingKeys.length ? 'No matches' : '';
        this.statusMessage.textContent = status;
        this.loadingStatus.hidden=!working;
        this.loadingStatus.textContent=this.localProgress || 'Loading items…';
        this.retryButton.hidden = !this.error && !this.cancelled;
        this.refreshButton.hidden=false;
        this.refreshButton.disabled=this.fetching || this.loading;
        this.liveStatus.textContent=this.liveState || '';
        this.liveStatus.hidden=!this.liveState;
        this.liveStatus.classList.toggle('ob_connection_warning',Boolean(this.liveState && this.liveState!=='Live'));
        this.toolbar.hidden=this.toolbar.hidden && !status && !working && !this.liveState && t.staticData;
        this.feedback.hidden = false;
        this.fitButton.disabled = this.pending || Boolean(this.error) || !this.supported || !this.complete || !this.snapshot?.matchingBounds || !this.snapshot.hasCondition;
        this.fitButton.title = this.fitButton.disabled ? 'An active query and complete matching bounds are required.' : 'Fit matching real timestamps with padding';
        const counts = this.snapshot?.counts;
        let text = !this.supported ? (this.pending ? 'Loading timeline data' :
            this.error ? 'Timeline data unavailable' : 'This provider does not expose authoritative match coverage.') : '';
        if (counts && this.supported) {
            const count = value => `${value.events} ${value.events === 1 ? 'event' : 'events'}, ${value.sessions} ${value.sessions === 1 ? 'session' : 'sessions'}`;
            text = !this.snapshot.hasCondition ? `${count(counts.eligible)} total in analysis range` :
                this.state.mode === 'only' ? `Showing ${count(counts.matching)} of ${count(counts.eligible)} in analysis range` :
                    `${count(counts.matching)} matching / ${count(counts.eligible)} total in analysis range`;
        }
        if (this.supported && !this.complete) text += ' · Partial coverage; counts describe loaded records';
        if (Array.isArray(this.remoteMetadata?.warnings)) {
            for (const warning of this.remoteMetadata.warnings) if (typeof warning === 'string') text += ' · ' + warning;
        }
        if (this.pending) text += ' · Updating…';
        if (this.error) text += ' · ' + this.error;
        if (!this.scaleEngaged && t.bands.some(band => band.focus)) text += ' · Model focus active';
        this.summary.textContent = text;
        const noRecords=this.supported && this.snapshot?.counts.eligible.events===0 && this.snapshot?.counts.eligible.sessions===0;
        if (!t.staticData && !this.remoteMetadata && !this.error) this.summary.textContent='Loading timeline data';
        const available=this.latestAvailable();
        this.availableButton.hidden=false;
        this.availableButton.disabled=!available || this.pending || this.loading;
        if(available)this.availableButton.title='Latest observed data: '+available.from+'; coverage may be partial.';
        if (noRecords && this.remoteMetadata && !this.error && !this.cancelled && !coverage.limited) {
            this.statusMessage.textContent=working?'':coverage.complete?'No records in this interval':'No records loaded; coverage is partial';
            this.feedback.hidden=false;
        }
        this.empty.hidden = true;
        this.selectionNotice.hidden = !this.selectedKey || this.projection?.displayedKeys.includes(this.selectedKey);
        this.explorer.update();
        if(this.explorer.seeking)this.loadingStatus.hidden=true;
        this.controls.update();
        const presentation=this.statusPresentation(working,coverage);
        this.status.textContent='Status: '+presentation.label;
        this.status.dataset.state=presentation.state;
        this.status.dataset.tone=presentation.tone;
        this.status.classList.toggle('ob_update_failed',presentation.state==='error');
        this.status.classList.toggle('ob_connection_warning',presentation.tone==='warning');
        const loadedItems=counts?counts.eligible.events+counts.eligible.sessions:null;
        const progress=working && Number.isFinite(loadedItems)?`${loadedItems} ${loadedItems===1?'item':'items'} loaded`:'';
        const statusText=[this.statusMessage.textContent,!this.loadingStatus.hidden?this.loadingStatus.textContent:'',progress,this.liveState,
            this.searchError,this.explorer.message].filter(Boolean).join(' · ') || presentation.label;
        this.status.title=statusText;
        this.status.setAttribute('aria-description',statusText);
        this.statusMessage.textContent=statusText;
        this.statusGroup.hidden=false;
        this.viewControls.hidden=this.clearButton.hidden;
        this.toolbar.hidden=[...this.toolbar.children].every(control=>control.hidden);
        const explanation=this.searchError ? this.searchError+' Correct the search expression and try again.' :
            this.explorer.failure ? this.explorer.failure+' Use the activity buttons or submit the search again to retry.' :
            this.error ? this.error+' Use Retry or Refresh to request data again.' : this.cancelled ?
            'Loading was stopped. Displayed records remain available. Use Retry to continue.' : this.explorer.outcome==='stopped' ?
            'The search was stopped. Use the activity buttons or submit the search again to continue.' : coverage.limited ?
            'The loading limit was reached within the visible time span. Coverage is incomplete. Narrow the time window to continue.' : working && !coverage.warnings.length ?
            this.localProgress ? this.localProgress+' Stop loading or press Escape to cancel.' : 'Items are loading in batches. Records already displayed remain available.' :
            !this.supported || !coverage.complete || coverage.warnings.length ?
            'Coverage is incomplete or has warnings within the visible time span. Counts describe loaded records. Review the warnings and ranges below; Refresh checks the sources again.' :
            !this.complete ? 'The visible time span is fully covered and processing has finished. Neighboring ranges may still have gaps or loading limits; counts below describe loaded records.' :
            this.snapshot?.hasCondition && !this.snapshot.matchingKeys.length ? 'No loaded records match the current search and filters.' :
            'The requested data finished loading. The counts and time ranges below describe the current view.';
        const live=this.liveState==='Live' ? ' Live updates are connected; matching changes are loaded automatically.' : this.liveState ?
            ' The live connection is reconnecting. Displayed records remain available; Refresh can check for updates.' : '';
        this.statusExplanation.textContent=(this.explorer.message?this.explorer.message+' ':'')+explanation+live+(progress?' '+progress+'.':'');
        this.updateLoadingUI();
        this.layout();
    }

    layout() {
        if (!this.toolbar) return;
        this.controls.layout();
        const t = this.timeline, header = t.ob_timeline_header;
        const height = header.offsetHeight || (t.width < 700 ? 160 : 108);
        header.style.height = height + 'px';
        t.ob_timeline_body_frame.style.top = height + 'px';
        if (t.ob_views?.tablePanel) t.ob_views.tablePanel.style.top = height + 'px';
        t.ob_timeline_panel.style.setProperty('--demo-toolbar-height', height + 'px');
        if (t.ob_viewport) {
            t.ob_viewport.layout();
        } else if (this.remoteData) {
            // Scene height includes every packed row. Keep the connected panel
            // at its configured size, with rows scrolling above the docked overview.
            const overviewHeight = Number.parseFloat(t.ob_timeline_panel.style.getPropertyValue('--ob-overview-height')) || 0;
            const panelHeight = Math.max(height + overviewHeight + 80, Number(t.height) || 600);
            t.ob_timeline_panel.style.height = panelHeight + 'px';
            t.ob_timeline_body_frame.style.height = (panelHeight - height - overviewHeight) + 'px';
            if (t.ob_views?.tablePanel) t.ob_views.tablePanel.style.height = (panelHeight - height) + 'px';
            if (t.ob_timeline_right_panel) t.ob_timeline_right_panel.style.height = panelHeight + 'px';
            if (t.ob_timeline_panel_resizer) t.ob_timeline_panel_resizer.style.top = (panelHeight - 8) + 'px';
        }
    }
}
