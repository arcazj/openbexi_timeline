// Shared, model-driven import and layout helpers for file-backed timelines.
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
        mm: String(date.getUTCMinutes()).padStart(2, "0")
    };
    return format.replace(/yyyy|mmm|MM|dd|HH|hh|mm/g, token => values[token]);
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
        const title = String(field(record, fields.title || ["data.title", "title"], "Untitled"));
        const start = timelineValueToTime(record.start, source.time);
        const end = timelineValueToTime(record.end, source.time);
        if (!Number.isFinite(start)) throw new Error("Invalid start date for " + title);
        if (record.end && !Number.isFinite(end)) throw new Error("Invalid end date for " + title);
        if (Number.isFinite(end) && end < start) throw new Error("End precedes start for " + title);
        let id = String(field(record, fields.id || ["id", "ID"], "record-" + index));
        if (usedIds.has(id)) id += "-" + index;
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
        for (const key of ["kind", "parentSessionId", "link", "image", "lateststart", "earliestend"]) {
            if (record[key] !== undefined) data[key] = record[key];
        }
        const duration = source.format !== "simile-xml" || record.isduration === "true";
        const event = {id, start: new Date(start).toISOString(), data, namespace, render};
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
    const query = search.trim().toLocaleLowerCase();
    const events = dataset.events.filter(event => event.zone || !query ||
        JSON.stringify(event.data).toLocaleLowerCase().includes(query) ||
        event.activities?.some(activity => JSON.stringify(activity.data).toLocaleLowerCase().includes(query)));
    return {dateTimeFormat: dataset.dateTimeFormat, events: structuredClone(events)};
}

export function prepareStaticBands(timeline, sceneIndex) {
    const scene = timeline.ob_scene[sceneIndex];
    const bands = [];
    for (const template of timeline.bands) {
        if (template.name.includes("overview_") && !timeline.ob_visible_view) continue;
        const values = template.groupBy ? [...new Set(timeline.staticData.events.filter(event => !event.zone)
            .map(event => field(event, template.groupBy, "Other")))].sort() : [null];
        for (const [index, value] of values.entries()) {
            const band = structuredClone(template);
            band.name = template.name + (value === null ? "" : "_" + index);
            band.groupValue = value;
            band.layout_name = value === null ? "NONE" : String(value);
            band.layouts = [];
            band.layouts.max_name_length = value === null ? 0 : String(value).length;
            band.model = [{sortBy: "NONE"}];
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
            band.multiples = 3;
            band.width = scene.width * band.multiples;
            band.minWidth = scene.width;
            band.minViewOffset = -scene.width / 2;
            band.viewOffset = -band.width / 2;
            band.minDate = new Date(timeline.ob_scene.sync_time + band.viewOffset * band.gregorianUnitLengths / band.intervalPixels);
            band.maxDate = new Date(timeline.ob_scene.sync_time - band.viewOffset * band.gregorianUnitLengths / band.intervalPixels);
            band.x = 0;
            band.z = 0;
            band.depth = 0;
            bands.push(band);
        }
    }
    scene.bands = bands;
    scene.minDate = bands[0].minDate;
    scene.maxDate = bands[0].maxDate;
}

export function layoutStaticSessions(timeline, sceneIndex) {
    const scene = timeline.ob_scene[sceneIndex];
    for (const band of scene.bands) {
        const overview = band.name.includes("overview_");
        band.zones = [];
        band.sessions = [];
        const rowEnds = [];
        const orderedEvents = [...scene.sessions.events].sort((a, b) => parseTimelineDate(a.start) - parseTimelineDate(b.start));
        for (const event of orderedEvents) {
            if (event.zone) { band.zones.push(event); continue; }
            if (band.groupBy && field(event, band.groupBy, "Other") !== band.groupValue) continue;
            if (band.eventKind === "duration" && !event.end) continue;
            if (band.eventKind === "event" && event.end) continue;
            const session = structuredClone(event);
            session.activities = session.activities || [structuredClone(event)];
            const activities = [];
            for (const activity of session.activities) {
                const x = timeline.dateToPixelOffSet(sceneIndex, activity.start, band.gregorianUnitLengths, band.intervalPixels);
                const end = timeline.dateToPixelOffSet(sceneIndex, activity.end, band.gregorianUnitLengths, band.intervalPixels);
                const width = Number.isFinite(end) ? end - x : 0;
                if (x + width < -scene.width * 1.5 || x > scene.width * 1.5) continue;
                const textWidth = overview ? 0 : timeline.getTextWidth(activity.data.title, band.fontSize + " " + band.fontFamily, 6);
                let row = rowEnds.findIndex(right => right + 12 < x);
                if (row < 0) row = rowEnds.length;
                rowEnds[row] = x + width + textWidth + 12;
                Object.assign(activity, {
                    x, original_x: x, x_relative: x + width / 2, width, total_width: width + textWidth + 12,
                    pixelOffSetStart: x, pixelOffSetEnd: end, height: band.sessionHeight,
                    size: band.defaultEventSize, textX: (width + textWidth) / 2 + 6,
                    z: 5, row
                });
                activities.push(activity);
            }
            if (activities.length) {
                session.activities = activities;
                band.sessions.push(session);
            }
        }
        band.height = Math.max(band.height, rowEnds.length * band.trackIncrement + band.fontSizeInt * 3);
    }
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
                activity.y = band.height / 2 - band.fontSizeInt * 2 - activity.row * band.trackIncrement;
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
