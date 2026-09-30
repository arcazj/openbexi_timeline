package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Date;
import java.util.HexFormat;

/** Opt-in match protocol: preserve legacy regex interpretation and source styling. */
public final class MatchResults {
    private MatchResults() {}

    /** A provider supplies only the fallback; legacy records keep their own namespace. */
    static String namespace(JSONObject record, String inherited) {
        Object value = record.get("namespace");
        if (value != null && !value.toString().isBlank()) return value.toString();
        if (record.get("data") instanceof JSONObject data) {
            value = data.get("namespace");
            if (value != null && !value.toString().isBlank()) return value.toString();
        }
        return inherited;
    }

    public static long time(Object value) {
        if (value instanceof Number number) return number.longValue();
        try { return Instant.parse(value.toString()).toEpochMilli(); }
        catch (Exception ignored) { return new Date(value.toString()).getTime(); }
    }

    public static JSONArray inRange(JSONArray records, long from, long to) {
        JSONArray scoped = new JSONArray();
        for (Object value : records) {
            JSONObject record = (JSONObject) value;
            long start = time(record.get("start"));
            // Legacy JSON producers represent point events with an empty end.
            Object endValue = record.get("end");
            long end = endValue == null || (endValue instanceof String text && text.isBlank())
                    ? start : time(endValue);
            if (end < start) throw new IllegalArgumentException("End precedes start.");
            if (start <= to && end >= from) scoped.add(record);
        }
        return scoped;
    }

    public static JSONObject envelope(JSONArray eligible, String query, String scene, long from, long to, boolean complete) {
        return envelope(eligible, query, scene, from, to, complete, null);
    }

    public static JSONObject envelope(JSONArray eligible, String query, String scene, long from, long to, boolean complete, String searchMode) {
        query = query == null ? "" : query;
        JSONObject result = new JSONObject();
        JSONObject metadata = new JSONObject();
        metadata.put("version", 1);
        metadata.put("provider", "json_file");
        metadata.put("query", query);
        metadata.put("searchMode", searchMode == null ? "legacy" : searchMode);
        metadata.put("complete", complete);
        metadata.put("hasCondition", !query.isEmpty() && !query.equals("*"));
        JSONObject domain = new JSONObject();
        domain.put("from", Instant.ofEpochMilli(from).toString());
        domain.put("to", Instant.ofEpochMilli(to).toString());
        metadata.put("domain", domain);
        result.put("dateTimeFormat", "iso8601");
        result.put("scene", scene);
        result.put("timelineMatch", metadata);
        try {
            if (to <= from) throw new IllegalArgumentException("Invalid analysis domain.");
            SearchQuery pattern = new SearchQuery(query, searchMode);
            metadata.put("hasCondition", pattern.active);
            JSONArray records = (JSONArray) new JSONParser().parse(eligible.toJSONString());
            annotate(records, pattern, from, to);
            result.put("events", records);
            metadata.put("revision", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest((pattern.mode + query + records.toJSONString()).getBytes(StandardCharsets.UTF_8))));
        } catch (Exception error) {
            result.put("events", new JSONArray());
            metadata.put("complete", false);
            metadata.put("error", error instanceof java.util.regex.PatternSyntaxException ? "Invalid search expression." : "Cannot build a complete matching response.");
        }
        return result;
    }

    private static void annotate(JSONArray records, SearchQuery pattern, long from, long to) {
        for (Object value : records) {
            JSONObject record = (JSONObject) value;
            record.put("searchMatch", pattern.matches(record));
            // Legacy records may omit a timezone on one endpoint. Send the
            // server's resolved instants so browser locale cannot invert a range.
            // Match first, preserving searches against the original field values.
            record.put("start", Instant.ofEpochMilli(time(record.get("start"))).toString());
            Object end = record.get("end");
            if (end == null || (end instanceof String text && text.isBlank())) record.remove("end");
            else record.put("end", Instant.ofEpochMilli(time(end)).toString());
            if (record.get("activities") instanceof JSONArray activities) {
                JSONArray scoped = inRange(activities, from, to);
                record.put("activities", scoped);
                annotate(scoped, pattern, from, to);
            }
        }
    }

    /** Same search semantics as response annotations, including scoped nested activities. */
    static boolean hasMatch(JSONObject record, SearchQuery pattern, long from, long to) {
        if (!pattern.active || pattern.matches(record)) return true;
        if (record.get("activities") instanceof JSONArray children)
            for (Object child : inRange(children, from, to))
                if (hasMatch((JSONObject) child, pattern, from, to)) return true;
        return false;
    }

    public static JSONObject failure(String query, String scene, long from, long to, String message) {
        JSONObject response = envelope(new JSONArray(), query, scene, from, to, false);
        ((JSONObject) response.get("timelineMatch")).put("error", message);
        return response;
    }
}
