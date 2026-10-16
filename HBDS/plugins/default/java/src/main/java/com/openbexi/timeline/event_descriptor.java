package com.openbexi.timeline;
import java.nio.file.*;
import java.util.*;
import org.json.*;
/** Generator-owned descriptors; the timeline server has no build dependency here. */
final class event_descriptor {
    private final Path root;
    private final JSONObject record;
    event_descriptor(String id, String originalStart, String start, String originalEnd, String end,
                     String namespace, String title, String type, String status, String priority,
                     String tolerance, String platform, Path root) {
        this.root = root;
        JSONObject data = new JSONObject().put("namespace", namespace).put("title", title);
        String[] keys = {"type", "status", "priority", "tolerance", "platform"};
        String[] values = {type, status, priority, tolerance, platform};
        for (int i = 0; i < keys.length; i++) if (!values[i].isEmpty()) data.put(keys[i], values[i]);
        record = new JSONObject().put("id", id).put("start", start).put("end", end).put("data", data);
        if (!originalStart.isEmpty()) record.put("original_start", originalStart);
        if (!originalEnd.isEmpty()) record.put("original_end", originalEnd);
    }
    void write(String description) {
        try {
            record.getJSONObject("data").put("description", description);
            Files.createDirectories(root.resolve("descriptors"));
            Files.writeString(root.resolve("descriptors").resolve(record.getString("id") + ".json"),
                new JSONObject().put("dateTimeFormat", "iso8601").put("event_descriptor", new JSONArray().put(record)).toString());
        } catch (Exception error) { throw new IllegalStateException("Cannot stage descriptor", error); }
    }
}
