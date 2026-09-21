package com.openbexi.timeline.api;

import org.json.*;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Element;
import java.time.*;
import java.time.format.*;
import java.time.temporal.TemporalAccessor;
import java.util.*;
import java.util.regex.*;

/** Model-driven source normalization shared by every API dataset. Numeric values retain their units. */
public final class TimelineRecords {
    private static final double MAX_BROWSER_TIME = 8.64e15;
    private static final DateTimeFormatter ISO_TAIL = DateTimeFormatter.ofPattern("'-'MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT).withZone(ZoneOffset.UTC);
    private static final Map<String, String> FIXED_ZONES = Map.ofEntries(
            Map.entry("GMT", "+00:00"), Map.entry("UTC", "+00:00"), Map.entry("UT", "+00:00"),
            Map.entry("EST", "-05:00"), Map.entry("EDT", "-04:00"), Map.entry("CST", "-06:00"),
            Map.entry("CDT", "-05:00"), Map.entry("MST", "-07:00"), Map.entry("MDT", "-06:00"),
            Map.entry("PST", "-08:00"), Map.entry("PDT", "-07:00"));
    private static final List<DateTimeFormatter> LEGACY_DATES = List.of(
            "MMM d u HH:mm:ss XXX", "MMM d u HH:mm XXX", "MMM d HH:mm:ss XXX u",
            "d MMM u HH:mm:ss XXX", "MMM d u HH:mm:ss", "MMM d u HH:mm", "MMM d u")
            .stream().map(pattern -> new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern(pattern)
                    .toFormatter(Locale.ENGLISH).withResolverStyle(ResolverStyle.STRICT)).toList();
    private TimelineRecords() {}
    public static JSONObject copy(JSONObject value) { return new JSONObject(value.toString()); }
    public static JSONObject axis(JSONObject model) {
        JSONObject source = model.optJSONObject("dataSource");
        JSONObject time = source == null ? null : source.optJSONObject("time");
        return time == null ? new JSONObject().put("kind", "calendar") : copy(time);
    }
    public static boolean numeric(JSONObject axis) { return "numeric".equals(axis.optString("kind")); }
    public static double coordinate(Object value, JSONObject axis) {
        if (value == null || value == JSONObject.NULL || value.toString().isBlank())
            throw new ApiException(422, "A time value is required.");
        if (!numeric(axis)) return instant(value).toEpochMilli();
        String text = value.toString().trim();
        for (Object prefix : axis.optJSONArray("approximatePrefixes", new JSONArray()))
            if (text.startsWith(prefix.toString())) text = text.substring(prefix.toString().length());
        try {
            double number = Double.parseDouble(text);
            double milliseconds = number * axis.optDouble("millisecondsPerUnit", 1);
            if (!Double.isFinite(number) || !Double.isFinite(milliseconds) || Math.abs(milliseconds) > MAX_BROWSER_TIME)
                throw new NumberFormatException();
            return number * axis.optDouble("direction", 1);
        } catch (NumberFormatException e) { throw new ApiException(422, "Invalid numeric time: " + text); }
    }
    public static Object time(Object value, JSONObject axis) {
        if (value == null || value == JSONObject.NULL || value.toString().isBlank()) throw new ApiException(422, "A time value is required.");
        if (numeric(axis)) return coordinate(value, axis) / axis.optDouble("direction", 1);
        Instant instant = instant(value);
        int year = instant.atOffset(ZoneOffset.UTC).getYear();
        String prefix = String.format(Locale.ROOT, year >= 0 && year <= 9999 ? "%04d" : year < 0 ? "-%06d" : "+%06d", Math.abs(year));
        return prefix + ISO_TAIL.format(instant);
    }
    private static Instant instant(Object value) {
        if (value instanceof Number) {
            double milliseconds = ((Number) value).doubleValue();
            if (!Double.isFinite(milliseconds) || Math.abs(milliseconds) > MAX_BROWSER_TIME)
                throw new ApiException(422, "Calendar time is outside the supported date range.");
            return Instant.ofEpochMilli(((Number) value).longValue());
        }
        String text = value.toString().trim();
        Matcher year = Pattern.compile("^([+-]?\\d{1,6})\\??\\s*(BC|BCE|AD|CE)?$", Pattern.CASE_INSENSITIVE).matcher(text);
        try {
            if (year.matches()) {
                int number = Integer.parseInt(year.group(1));
                if (year.group(2) != null && year.group(2).toUpperCase(Locale.ROOT).startsWith("BC")) number = 1 - number;
                return supported(LocalDate.of(number, 1, 1).atStartOfDay().toInstant(ZoneOffset.UTC));
            }
            // OffsetDateTime is strict about real calendar dates; Instant.parse
            // alone accepts ISO's 24:00 rollover, which is unsuitable for writes.
            try { return supported(OffsetDateTime.parse(text).toInstant()); } catch (DateTimeException ignored) {}
            try { return supported(LocalDate.parse(text).atStartOfDay().toInstant(ZoneOffset.UTC)); } catch (DateTimeException ignored) {}
            String legacy = text.replaceFirst("(?i)^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\\s+", "")
                    .replaceAll("(?i)\\b(?:GMT|UTC)([+-]\\d{2}):?(\\d{2})\\b", "$1:$2");
            // Java resolves EST through a region and its DST rules. Legacy source
            // labels and browser Date.parse use these abbreviations as fixed offsets.
            for (Map.Entry<String, String> zone : FIXED_ZONES.entrySet())
                legacy = legacy.replaceAll("(?i)\\b" + zone.getKey() + "\\b", zone.getValue());
            for (DateTimeFormatter format : LEGACY_DATES) {
                try {
                    TemporalAccessor date = format.parseBest(legacy, OffsetDateTime::from, LocalDateTime::from, LocalDate::from);
                    if (date instanceof OffsetDateTime) return supported(((OffsetDateTime) date).toInstant());
                    if (date instanceof LocalDateTime) return supported(((LocalDateTime) date).toInstant(ZoneOffset.UTC));
                    return supported(((LocalDate) date).atStartOfDay().toInstant(ZoneOffset.UTC));
                }
                catch (DateTimeException ignored) {}
            }
        } catch (DateTimeException | NumberFormatException ignored) {}
        throw new ApiException(422, "Invalid calendar time: " + text);
    }
    private static Instant supported(Instant value) {
        if (Math.abs((double) value.toEpochMilli()) > MAX_BROWSER_TIME)
            throw new ApiException(422, "Calendar time is outside the supported date range.");
        return value;
    }
    static Object field(JSONObject record, Object paths, Object fallback) {
        JSONArray options = paths instanceof JSONArray ? (JSONArray) paths : new JSONArray().put(paths);
        for (Object option : options) {
            Object value = record;
            for (String key : option.toString().split("\\.")) value = value instanceof JSONObject ? ((JSONObject) value).opt(key) : null;
            if (value != null && value != JSONObject.NULL && !value.toString().isEmpty()) return value;
        }
        return fallback;
    }
    public static JSONArray parse(String text, JSONObject model) {
        JSONObject source = model.optJSONObject("dataSource", new JSONObject());
        JSONObject payload;
        if ("simile-xml".equals(source.optString("format"))) {
            org.jsoup.nodes.Document document = Jsoup.parse(text);
            if (document.selectFirst("data") == null) throw new ApiException(422, "Expected a Simile data document.");
            JSONArray records = new JSONArray();
            for (Element element : document.select("event")) {
                JSONObject record = new JSONObject();
                element.attributes().forEach(attribute -> record.put(attribute.getKey(), attribute.getValue()));
                record.put("description", element.text()); records.put(record);
            }
            payload = new JSONObject().put("events", records);
        } else payload = new JSONObject(text);
        Object raw = field(payload, source.optString("recordsPath", "events"), null);
        if (!(raw instanceof JSONArray)) throw new ApiException(422, "Dataset records must be an array.");
        JSONArray records = (JSONArray) raw;
        JSONArray result = new JSONArray(); Set<String> ids = new HashSet<>();
        int visibleIndex = 0;
        for (int i = 0; i < records.length(); i++) {
            if (records.isNull(i)) continue;
            JSONObject record = records.getJSONObject(i);
            Object deleted = record.opt("deletedAt");
            if (deleted != null && deleted != JSONObject.NULL && !Boolean.FALSE.equals(deleted) && !"".equals(deleted) && !(deleted instanceof Number && ((Number) deleted).doubleValue() == 0)) continue;
            result.put(normalize(record, source, "record-" + visibleIndex++, false, ids));
        }
        int index = 0;
        for (JSONArray zones : List.of(payload.optJSONArray("zones", new JSONArray()), source.optJSONArray("zones", new JSONArray())))
            for (Object zone : zones) result.put(normalize((JSONObject) zone, source, "record-zone-" + index++, true, ids));
        return result;
    }
    private static JSONObject normalize(JSONObject raw, JSONObject source, String fallbackId, boolean zone, Set<String> ids) {
        JSONObject fields = source.optJSONObject("fields", new JSONObject());
        JSONObject timeAxis = source.optJSONObject("time", new JSONObject());
        String id = field(raw, fields.opt("id") == null ? new JSONArray(List.of("id", "ID")) : fields.get("id"), fallbackId).toString();
        if (ids.contains(id)) id += "-" + fallbackId.replaceFirst("^record-", "");
        ids.add(id);
        JSONObject data = copy(raw.optJSONObject("data", new JSONObject()));
        data.put("title", field(raw, fields.opt("title") == null ? new JSONArray(List.of("data.title", "title")) : fields.get("title"), "Untitled").toString());
        data.put("description", field(raw, fields.opt("description") == null ? new JSONArray(List.of("data.description", "data.text", "description")) : fields.get("description"), "").toString());
        Object namespace = field(raw, fields.opt("namespace") == null ? new JSONArray(List.of("namespace", "data.namespace", "sourceId")) : fields.get("namespace"), "");
        data.put("namespace", namespace);
        if (numeric(timeAxis)) {
            data.put("startValue", raw.get("start"));
            if (raw.has("end")) data.put("endValue", raw.get("end"));
        }
        for (String key : List.of("kind", "parentSessionId", "link", "image", "lateststart", "earliestend"))
            if (raw.has(key)) data.put(key, raw.get(key));
        JSONObject render = copy(raw.optJSONObject("render", new JSONObject()));
        Object color = field(raw, fields.opt("color") == null ? new JSONArray(List.of("render.color", "color")) : fields.get("color"),
                source.optJSONObject("iconColors", new JSONObject()).opt(raw.optString("icon")));
        if (color != null) render.put("color", color);
        if (raw.has("opacity")) render.put("opacity", raw.get("opacity"));
        JSONObject record = new JSONObject().put("id", id).put("start", time(raw.get("start"), timeAxis))
                .put("data", data).put("namespace", namespace).put("render", render);
        if (raw.has("end") && !raw.optString("end").isBlank()) {
            Object end = time(raw.get("end"), timeAxis);
            if (!"simile-xml".equals(source.optString("format")) || raw.optBoolean("isduration") || zone) record.put("end", end);
            else data.put("latestEnd", end);
        }
        if (zone || raw.has("zone")) { record.put("zone", true); data.put("text", data.get("title")); }
        if (raw.has("activities")) {
            JSONArray children = new JSONArray(); int index = 0;
            for (Object child : raw.getJSONArray("activities")) children.put(normalize((JSONObject) child, source, fallbackId + "-" + index++, false, ids));
            record.put("activities", children);
        }
        return validate(record, timeAxis, 0);
    }
    public static boolean session(JSONObject record) {
        return !record.optBoolean("zone") && (record.has("end") || record.optJSONArray("activities") != null ||
                "session".equals(record.optJSONObject("data", new JSONObject()).optString("kind")));
    }
    public static JSONObject validate(JSONObject record, JSONObject axis, int depth) {
        if (depth > 8) throw new ApiException(422, "Activities may be nested at most eight levels.");
        String id = record.optString("id");
        if (!(record.opt("id") instanceof String) || id.equals(".") || id.equals("..") || id.isBlank() || id.length() > 160 || id.contains("/") || id.contains("\\") || id.chars().anyMatch(c -> c < 32))
            throw new ApiException(422, "Event id must be a nonempty path-safe string of at most 160 characters.");
        JSONObject data = record.optJSONObject("data");
        if (data == null || !(data.opt("title") instanceof String) || data.getString("title").isBlank())
            throw new ApiException(422, "Event data.title must be a nonempty string.");
        for (String key : List.of("description", "kind")) if (data.has(key) && !(data.get(key) instanceof String))
            throw new ApiException(422, "Event data." + key + " must be a string.");
        if (record.has("namespace") && !(record.get("namespace") instanceof String)) throw new ApiException(422, "Event namespace must be a string.");
        if (record.has("zone") && !(record.get("zone") instanceof Boolean)) throw new ApiException(422, "Event zone must be a boolean.");
        if (record.has("render") && !(record.get("render") instanceof JSONObject)) throw new ApiException(422, "Event render must be an object.");
        record.put("start", time(record.opt("start"), axis));
        if (record.has("end")) {
            record.put("end", time(record.get("end"), axis));
            if (coordinate(record.get("end"), axis) < coordinate(record.get("start"), axis)) throw new ApiException(422, "Event end precedes start.");
        }
        if (record.optBoolean("zone") && !record.has("end")) throw new ApiException(422, "A zone requires an end.");
        if (record.has("activities")) {
            JSONArray activities = record.optJSONArray("activities");
            if (activities == null) throw new ApiException(422, "Event activities must be an array.");
            for (Object activity : activities) {
                if (!(activity instanceof JSONObject)) throw new ApiException(422, "Each activity must be an object.");
                validate((JSONObject) activity, axis, depth + 1);
            }
        }
        return record;
    }
    public static JSONObject merge(JSONObject current, JSONObject patch) {
        JSONObject result = copy(current);
        for (String key : patch.keySet()) {
            Object value = patch.get(key);
            if (value == JSONObject.NULL) result.remove(key);
            else if (value instanceof JSONObject) result.put(key, merge(result.optJSONObject(key, new JSONObject()), (JSONObject) value));
            else result.put(key, value);
        }
        return result;
    }
}
