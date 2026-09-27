// Shared, model-driven import and layout helpers for file-backed timelines.
import {prepareBandScale, bandTimeToPixel} from './openbexi_timeline_scale.js';
import {createStaticSearchMatcher} from './openbexi_timeline_matches.js';
import {activityFootprint, createRowPacker, projectMap} from './openbexi_timeline_adaptive.js';
import {recordKey, rowHeader, dateAxisHeight, configureDateAxes} from './openbexi_timeline_paging.js';
import {clusterEvents} from './openbexi_timeline_exploration.js';
import {activityLabelMetrics} from './openbexi_timeline_activity_focus.js';

export const TIME_UNITS = {
    MILLISECOND: 1, SECOND: 1000, MINUTE: 60000, HOUR: 3600000,
    DAY: 86400000, WEEK: 604800000, MONTH: 2678400000,
    YEAR: 31536000000, DECADE: 315360000000, CENTURY: 3153600000000
};

export function parseTimelineDate(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    if (value === undefined || value === null || value === "") return NaN;
    const year = String(value).trim().match(/^([+-]?\d{1,6})\s*(BC|BCE|AD|CE)?$/i);
    if (year) {
        const date = new Date(0);
        date.setUTCFullYear(/^BC/i.test(year[2] || "") ? 1 - Number(year[1]) : Number(year[1]), 0, 1);
        return date.getTime();
    }
    return Date.parse(value);
}

export function formatTimelineDate(value, format = "yyyy-MM-dd HH:mm", offsetMinutes = 0, origin) {
    const time = parseTimelineDate(value);
    if (!Number.isFinite(time)) return "";
    const date = new Date(time + offsetMinutes * 60000);
    const year = date.getUTCFullYear();
    if (format === "elapsedYears") return String(year - new Date(parseTimelineDate(origin)).getUTCFullYear());
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const values = {
        yyyy: year <= 0 ? (1 - year) + " BCE" : String(year),
        mmm: months[date.getUTCMonth()], MM: String(date.getUTCMonth() + 1).padStart(2, "0"),
        dd: String(date.getUTCDate()).padStart(2, "0"),
        HH: String(date.getUTCHours()).padStart(2, "0"), hh: String(date.getUTCHours()).padStart(2, "0"),
        mm: String(date.getUTCMinutes()).padStart(2, "0"), ss: String(date.getUTCSeconds()).padStart(2, "0"),
        SSS: String(date.getUTCMilliseconds()).padStart(3, "0")
    };
    return format.replace(/yyyy|mmm|MM|dd|HH|hh|mm|ss|SSS/g, token => values[token]);
}

export function timelineValueToTime(value, axis) {
    if (value === undefined || value === null || value === "") return NaN;
    if (axis?.kind === "numeric") {
        let number = String(value).trim();
        for (const prefix of axis.approximatePrefixes || []) if (number.startsWith(prefix)) number = number.slice(prefix.length);
        return Number(number) * axis.millisecondsPerUnit * (axis.direction || 1);
    }
    return parseTimelineDate(value);
}

export function formatTimelineValue(value, axis, format = "yyyy-MM-dd HH:mm", offsetMinutes = 0) {
    if (axis?.kind === "numeric") {
        const number = parseTimelineDate(value) / axis.millisecondsPerUnit / (axis.direction || 1);
        return Number(number.toFixed(2)) + (axis.unit ? " " + axis.unit : "");
    }
    return formatTimelineDate(value, format, offsetMinutes);
}

function field(record, paths, fallback) {
    for (const path of Array.isArray(paths) ? paths : [paths]) {
        if (!path) continue;
        const value = path.split(".").reduce((object, key) =>
            object && Object.hasOwn(object, key) ? object[key] : undefined, record);
        if (value !== undefined && value !== null && value !== "") return value;
    }
    return fallback;
}

export function parseTimelineData(text, source = {}) {
    let payload;
    if (source.format === "simile-xml") {
        // Legacy descriptions contain unbalanced HTML. An inert HTML document tolerates
        // that markup; only event attributes and plain description text are retained.
        const document = new DOMParser().parseFromString(text, "text/html");
        if (!document.querySelector("data")) throw new Error("Expected a Simile <data> document.");
        payload = {events: [...document.querySelectorAll("event")].map(element => ({
            ...Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value])),
            description: element.textContent.trim().replace(/\s+/g, " ")
        }))};
    } else if (!source.format || source.format === "json") {
        payload = JSON.parse(text);
    } else {
        throw new Error("Unsupported dataset format: " + source.format);
    }
    const records = field(payload, source.recordsPath || "events");
    if (!Array.isArray(records)) throw new Error("Dataset records must be an array.");
    const fields = source.fields || {};
    const usedIds = new Set();
    const normalize = (record, index, zone = false) => {
        const data = {...record.data};
        delete data.sourceRecordKey;
        // Legacy grouping fields can be at the top level. Preserve arbitrary
        // metadata, rather than a deployment-specific list of allowed fields.
        for (const [key, value] of Object.entries(record)) {
            if (!['data','activities','render','start','end','id','ID','zone','searchMatch','deletedAt','sourceRecordKey'].includes(key) && data[key] === undefined)
                data[key] = value;
        }
        const title = String(field(record, fields.title || ["data.title", "title"], "Untitled"));
        const start = timelineValueToTime(record.start, source.time);
        const end = timelineValueToTime(record.end, source.time);
        if (!Number.isFinite(start)) throw new Error("Invalid start date for " + title);
        if (record.end && !Number.isFinite(end)) throw new Error("Invalid end date for " + title);
        if (Number.isFinite(end) && end < start) throw new Error("End precedes start for " + title);
        const sourceRecordKey=typeof record.sourceRecordKey==='string' && record.sourceRecordKey ? record.sourceRecordKey : null;
        let id = sourceRecordKey ? (Object.hasOwn(record,'id') ? record.id : record.ID ?? null) :
            String(field(record, fields.id || ["id", "ID"], "record-" + index));
        if (!payload.timelineMatch && !sourceRecordKey && usedIds.has(id)) id += "-" + index;
        usedIds.add(id);
        const render = {...record.render};
        const color = field(record, fields.color || ["render.color", "color"], source.iconColors?.[record.icon]);
        if (color) render.color = color;
        if (record.opacity !== undefined) render.opacity = record.opacity;
        const namespace = field(record, fields.namespace || ["namespace", "data.namespace", "sourceId"], "");
        Object.assign(data, {
            title, description: String(field(record, fields.description || ["data.description", "data.text", "description"], "")),
            namespace
        });
        if (source.time?.kind === "numeric") {
            data.startValue = record.start;
            if (record.end !== undefined) data.endValue = record.end;
        }
        // Retain source metadata for local descriptions without loading remote images.
        for (const key of ["kind", "type", "sessionType", "eventType", "parentSessionId", "link", "image", "lateststart", "earliestend"]) {
            if (record[key] !== undefined) data[key] = record[key];
        }
        const duration = source.format !== "simile-xml" || record.isduration === "true";
        const event = {id, start: new Date(start).toISOString(), data, namespace, render};
        if (sourceRecordKey) event.sourceRecordKey=sourceRecordKey;
        if (typeof record.searchMatch === 'boolean') event.searchMatch = record.searchMatch;
        if (Number.isFinite(end) && (duration || zone)) event.end = new Date(end).toISOString();
        else if (Number.isFinite(end)) data.latestEnd = new Date(end).toISOString();
        if (zone || record.zone !== undefined) {
            event.zone = true;
            data.text = title;
            if (!event.end) throw new Error("A highlight zone needs an end date: " + title);
        }
        if (Array.isArray(record.activities)) event.activities = record.activities.map((activity, i) => normalize(activity, index + "-" + i));
        return event;
    };
    const events = records.filter(record => record && !record.deletedAt).map((record, index) => normalize(record, index));
    const zones = [...(payload.zones || []), ...(source.zones || [])];
    events.push(...zones.map((zone, index) => normalize(zone, "zone-" + index, true)));
    return {dateTimeFormat: "iso8601", events};
}

export function searchTimelineData(dataset, search = "") {
    const matcher = createStaticSearchMatcher(search);
    // Preserve the current UI's filtering and complete child lists until Results
    // controls are integrated. The new snapshot API records direct matches only.
    const events = dataset.events.filter(event => event.zone || !matcher.hasCondition ||
        matcher.matches(event) || event.activities?.some(activity => matcher.matches(activity)));
    return {dateTimeFormat: dataset.dateTimeFormat, events: structuredClone(events)};
}

export function prepareStaticBands(timeline, sceneIndex) {
    const scene = timeline.ob_scene[sceneIndex];
    const bands = [];
    for (const template of timeline.bands) {
        if (template.name.includes("overview_") && !timeline.ob_visible_view) continue;
        const isOverview = template.name.includes('overview_');
        const sortBy = timeline.ob_sortBy ?? template.model?.[0]?.sortBy ?? 'NONE';
        const groupBy = isOverview ? undefined : timeline.ob_sortBy !== undefined ?
            (sortBy === 'NONE' ? undefined : sortBy) : template.groupBy || (sortBy === 'NONE' ? undefined : sortBy);
        const projection = timeline.ob_results?.projection;
        const scope = projection?.densityRecords || timeline.staticData.events;
        // Children use their own category when present and inherit the parent's
        // category otherwise. Keep identities shared with results and Overview.
        const groupValues = new Map();
        const collect = (records, inherited = 'Other') => {
            for (const record of records) {
                const value = field(record, groupBy || '', field(record.data, groupBy || '', inherited));
                const category = value === '' || value == null ? inherited : String(value);
                groupValues.set(recordKey(record), category);
                collect(record.activities || [], category);
            }
        };
        if (groupBy) collect(projection?.events || timeline.staticData.events);
        let values = groupBy ? [...new Set(scope.filter(event => !event.zone)
            .map(event => groupValues.get(recordKey(event)) || 'Other'))].sort() : [null];
        // Retain a finite empty plot/axis when every generated group disappears.
        if (!values.length) values = [null];
        for (const [index, value] of values.entries()) {
            const band = structuredClone(template);
            band.sourceBand = template.name;
            band.groupBy = groupBy;
            band.groupValues = groupValues;
            band.name = template.name + (value === null ? "" : "_" + index);
            band.groupValue = value;
            band.layout_name = value === null ? "NONE" : String(value);
            band.layouts = [];
            band.layouts.max_name_length = value === null ? 0 : String(value).length;
            band.model = [{...template.model?.[0],sortBy}];
            if (value!==null && groupBy==='namespace') {
                for (const property of ['color','textColor','dateColor'])
                    band[property]=timeline.get_source_property?.(sceneIndex,value,property,band[property]) ?? band[property];
            } else if (value!==null && index%2 && template.model?.[0]?.alternateColor) band.color=template.model[0].alternateColor;
            band.height = (String(template.height).endsWith("%") ? timeline.height * parseFloat(template.height) / 100 : Number(template.height)) / values.length;
            band.gregorianUnitLengths = TIME_UNITS[band.intervalUnit];
            if (!band.gregorianUnitLengths || !(Number(band.intervalPixels) > 0)) throw new Error("Invalid band time scale: " + band.name);
            band.trackIncrement = band.trackIncrement || (band.name.includes("overview_") ? 4 : 24);
            band.fontSizeInt = parseInt(band.fontSize) || timeline.fontSizeInt;
            band.fontSize = band.fontSizeInt + "px";
            band.fontFamily = timeline.fontFamily;
            band.fontStyle = "normal";
            band.fontWeight = "normal";
            band.sessionHeight = band.sessionHeight || 7;
            band.defaultEventSize = band.defaultEventSize || (band.name.includes("overview_") ? 1 : 3);
            band.subIntervalPixels = "NONE";
            // A full-width drag plus its bounded coast must stay inside the
            // prepared drawing area until the gesture can be recentered.
            band.multiples = 7;
            band.width = scene.width * band.multiples;
            band.minWidth = scene.width;
            band.minViewOffset = -scene.width / 2;
            band.viewOffset = -band.width / 2;
            band.minDate = new Date(timeline.ob_scene.sync_time + band.viewOffset * band.gregorianUnitLengths / band.intervalPixels);
            band.maxDate = new Date(timeline.ob_scene.sync_time - band.viewOffset * band.gregorianUnitLengths / band.intervalPixels);
            band.x = 0;
            band.z = 0;
            band.depth = 0;
            prepareBandScale(timeline, sceneIndex, band);
            if (!isOverview && timeline.ob_results?.regroupRange) {
                timeline.ob_results.ranges.set(band.name, {...timeline.ob_results.regroupRange});
                timeline.ob_results.visibleRanges.delete(band.name);
            }
            timeline.ob_results?.applyScale(band, scene.width);
            bands.push(band);
        }
    }
    configureDateAxes(bands, timeline.params[0].dateAxisMode);
    for (const band of bands) band.topPadding = rowHeader(band);
    scene.bands = bands;
    scene.minDate = bands[0].minDate;
    scene.maxDate = bands[0].maxDate;
}

export function layoutStaticSessions(timeline, sceneIndex) {
    const scene = timeline.ob_scene[sceneIndex];
    const copyRecord = record => timeline.ob_measureLayout ? {...record, render:{...record.render}} : structuredClone(record);
    for (const band of scene.bands) {
        band.zones = [];
        band.sessions = [];
        if (band.name.includes("overview_")) continue;
        const countActivities = record => 1 + (record.activities || []).reduce((sum, child) => sum + countActivities(child), 0);
        const packer = createRowPacker(scene.sessions.events.reduce((sum, record) => sum + countActivities(record), 0));
        const perspective=scene.ob_camera_type==='Perspective';
        band.activityBaseTrackIncrement ??= band.trackIncrement;
        band.trackIncrement=band.activityBaseTrackIncrement;
        const aboveLabels = band.labelPosition === 'above';
        const anchoredLabels = aboveLabels || band.labelPosition === 'inside';
        let orderedEvents = [...scene.sessions.events].sort((a, b) => {
            const start = parseTimelineDate(a.start) - parseTimelineDate(b.start);
            if (start || !aboveLabels) return start;
            const aEnd = parseTimelineDate(a.end), bEnd = parseTimelineDate(b.end);
            // Shorter durations first leave room for later starts on the same row.
            // Point events follow durations at that instant, with stable id ties.
            if (Number.isFinite(aEnd) !== Number.isFinite(bEnd)) return Number.isFinite(aEnd) ? -1 : 1;
            return (Number.isFinite(aEnd) ? aEnd - bEnd : 0) || String(a.id).localeCompare(String(b.id));
        });
        if(timeline.ob_results?.state?.auto && !timeline.ob_measureLayout) {
            const r=timeline.ob_results,protectedKeys=new Set([...r.explorer.expanded,r.selectedKey]);
            orderedEvents=clusterEvents(orderedEvents.filter(event=>(!band.filter || field(event,band.filter.field)===band.filter.equals) &&
                (!band.groupBy || event.activities || (band.groupValues.get(recordKey(event)) || 'Other')===band.groupValue)),band.timeScale,protectedKeys);
            for(const event of orderedEvents) if(event.cluster && band.groupBy) band.groupValues.set(recordKey(event),band.groupValue);
        }
        for (const event of orderedEvents) {
            if (event.zone) { band.zones.push(event); continue; }
            if (band.filter && field(event, band.filter.field) !== band.filter.equals) continue;
            if (band.eventKind === "duration" && !event.end) continue;
            if (band.eventKind === "event" && event.end) continue;
            const session = copyRecord(event);
            if (timeline.ob_results?.supported) {
                const flatten = record => {
                    const own = copyRecord(record); delete own.activities;
                    const showOwn = !record.structuralContext && (!record.activities?.length || record.searchMatch);
                    return [...(showOwn ? [own] : []), ...(record.activities || []).flatMap(flatten)];
                };
                session.activities = flatten(event);
            } else session.activities = session.activities || [structuredClone(event)];
            const activities = [];
            for (const activity of session.activities) {
                if (band.groupBy && (band.groupValues.get(recordKey(activity)) || 'Other') !== band.groupValue) continue;
                const startTime = parseTimelineDate(activity.start);
                const endTime = parseTimelineDate(activity.end);
                if (band.timeScale && ((Number.isFinite(endTime) ? endTime : startTime) < band.timeScale.contextFrom ||
                    startTime > band.timeScale.contextTo)) continue;
                const box = activityFootprint(activity, band,
                    {toPixel: value => bandTimeToPixel(timeline, sceneIndex, band, value)}, scene.width, timeline.getTextWidth.bind(timeline));
                const {x, end, width, textWidth, labelLeft, occupiedWidth} = box;
                if ((!band.timeScale || timeline.ob_results?.scaleEngaged) &&
                    (x + occupiedWidth < -band.width / 2 || x > band.width / 2)) continue;
                const anchoredDuration = anchoredLabels && Number.isFinite(end);
                const durationLabelAbove = aboveLabels && anchoredDuration;
                if (Number.isFinite(end) && band.uncertaintyOpacity !== undefined &&
                    (activity.data.lateststart || activity.data.earliestend) && activity.render.opacity === undefined)
                    activity.render.opacity = Math.max(0, Math.min(1, Number(band.uncertaintyOpacity)));
                let footprint=occupiedWidth;
                if(perspective) {
                    activity.focusLabel=activityLabelMetrics(activity,band,scene.width,timeline.getTextWidth.bind(timeline));
                    band.trackIncrement=Math.max(band.trackIncrement,activity.focusLabel.height+8);
                    footprint=width+activity.focusLabel.width+12;
                }
                const row = packer.add(x,x+footprint);
                if (timeline.ob_measureLayout) continue;
                Object.assign(activity, {
                    x, original_x: x, x_relative: x + width / 2, width, total_width: occupiedWidth,
                    pixelOffSetStart: x, pixelOffSetEnd: end, height: band.sessionHeight,
                    size: band.defaultEventSize,
                    textX: anchoredDuration ? labelLeft - (x + width / 2) + textWidth / 2 : (width + textWidth) / 2 + 6,
                    textY: durationLabelAbove ? band.fontSizeInt / 2 + band.sessionHeight / 2 + 3 : 0,
                    z: 5, row
                });
                activities.push(activity);
            }
            if (activities.length) {
                session.activities = activities;
                band.sessions.push(session);
            }
        }
        band.occupiedRows = packer.count;
        band.zoneHeaderHeight = band.zones.some(zone => zone.data?.title && zone.render?.labelPosition !== 'bottom') ? 20 : 0;
        band.topPadding = rowHeader(band);
        band.height = Math.max(band.height, packer.count * band.trackIncrement +
            (band.topPadding ?? band.fontSizeInt * 2) + band.fontSizeInt + dateAxisHeight(band));
    }
    if (timeline.ob_measureLayout) return;
    positionPackedBands(scene);
}

export function positionPackedBands(scene) {
    scene.ob_height = scene.bands.reduce((height, band) => height + band.height, 0);
    let top = scene.ob_height;
    for (const band of scene.bands) {
        band.heightMax = band.height;
        band.maxY = band.height / 2;
        band.minY = -band.height / 2;
        band.y = top - band.height / 2;
        band.pos_y = band.y;
        band.pos_x = 0;
        band.pos_z = 0;
        top -= band.height;
        for (const session of band.sessions) {
            for (const activity of session.activities) {
                activity.y = band.height / 2 - (band.topPadding ?? band.fontSizeInt * 2) - activity.row * band.trackIncrement;
            }
            const left = Math.min(...session.activities.map(activity => activity.x));
            const right = Math.max(...session.activities.map(activity => activity.x + activity.width));
            const bottom = Math.min(...session.activities.map(activity => activity.y));
            const top = Math.max(...session.activities.map(activity => activity.y));
            session.render.color ??= band.SessionColor || "#999999";
            Object.assign(session, {x_relative: (left + right) / 2, width: Math.max(right - left, band.defaultEventSize * 2),
                y: (bottom + top) / 2, height: top - bottom + band.trackIncrement});
        }
    }
}

// Candidate evaluation runs the actual grouping, label and duration layout on
// detached bands. It never creates Three.js resources or changes the live scene.
export function measureCandidateLayout(timeline, projection, bands, map, ranges, width) {
    const probe = Object.create(timeline);
    probe.ob_measureLayout = true;
    probe.ob_results = {supported: true, scaleEngaged: true};
    probe.ob_scene = [{width, sessions: projection, bands: bands.map(band => ({...band,
        timeScale: projectMap(map, ranges.get(band.name) || map.domain, width)}))}];
    probe.ob_scene.sync_time = timeline.ob_scene.sync_time;
    layoutStaticSessions(probe, 0);
    return probe.ob_scene[0].bands.reduce((score, band) => score + band.occupiedRows * band.trackIncrement, 0);
}
