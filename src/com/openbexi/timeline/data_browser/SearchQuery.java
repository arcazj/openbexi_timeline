package com.openbexi.timeline.data_browser;

import org.json.simple.JSONObject;
import java.util.*;
import java.util.regex.Pattern;

/** Explicit text/pattern search; missing mode preserves the legacy protocol. */
final class SearchQuery {
    final String mode;
    final boolean active;
    private final Pattern pattern;

    SearchQuery(String query, String requestedMode) {
        mode = requestedMode == null || requestedMode.isBlank() ? "legacy" : requestedMode;
        if (!Set.of("text", "pattern", "legacy").contains(mode)) throw new IllegalArgumentException("Unknown search mode.");
        query = Objects.toString(query, "").trim();
        if (query.length() > 500) throw new IllegalArgumentException("Search is limited to 500 characters.");
        active = !query.isEmpty() && !(mode.equals("legacy") && query.equals("*"));
        pattern = !active ? null : mode.equals("legacy") ? Pattern.compile(query.replace(";", "|").replace(" ", "|")) :
                Pattern.compile(mode.equals("text") ? Pattern.quote(query) : query, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    }

    boolean matchesText(String value) { return active && pattern.matcher(value).find(); }

    boolean matches(JSONObject record) {
        if (!active || Boolean.TRUE.equals(record.get("zone"))) return false;
        if (mode.equals("legacy")) {
            JSONObject own = new JSONObject(record);
            own.remove("activities"); own.remove("searchMatch"); own.remove("sourceRecordKey");
            return matchesText(own.toJSONString().replace(" ", "").replace("\"", ""));
        }
        JSONObject data = record.get("data") instanceof JSONObject object ? new JSONObject(object) : new JSONObject();
        for (Object key : record.keySet()) {
            if (!Set.of("data", "activities", "render", "start", "end", "id", "ID", "zone", "searchMatch", "deletedAt", "sourceRecordKey").contains(key))
                data.putIfAbsent(key, record.get(key));
        }
        data.putIfAbsent("title", "Untitled");
        data.putIfAbsent("description", Objects.toString(data.get("text"), ""));
        data.put("namespace", MatchResults.namespace(record, ""));
        return matchesValue(data);
    }

    private boolean matchesValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            for (var entry : map.entrySet()) {
                if ("sourceRecordKey".equals(entry.getKey())) continue;
                if (matchesText(String.valueOf(entry.getKey())) || matchesValue(entry.getValue())) return true;
            }
        } else if (value instanceof Collection<?> values) {
            for (Object item : values) if (matchesValue(item)) return true;
        } else if (value != null) return matchesText(String.valueOf(value));
        return false;
    }
}
