// Pure date and dataset normalization shared by the renderer and local-data worker.
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

export function field(record, paths, fallback) {
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
