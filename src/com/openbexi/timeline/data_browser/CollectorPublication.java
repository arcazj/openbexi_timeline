package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import java.io.*;
import java.nio.file.*;
import java.util.*;

/** Committed collector data is readable without the collector or any plugin installed. */
public final class CollectorPublication {
    private CollectorPublication() {}
    public static Path root(String model) {
        return Path.of(model.replace('\\','/').split("/(?:yyyy|mm|dd)(?:/|$)",2)[0]).toAbsolutePath().normalize();
    }
    public static Path path(Path root) { return root.resolve(".timeline-collector/publication.json"); }
    public static JSONObject read(Path root) throws IOException {
        return read(root, 64L * 1024 * 1024);
    }
    public static JSONObject read(Path root, long maxBytes) throws IOException {
        Path path = path(root);
        if (!Files.exists(path)) return null;
        if (!path.toRealPath().startsWith(root.toRealPath())) throw new IOException("Publication escapes its source");
        if (Files.size(path) > maxBytes) throw new IOException("Collector publication exceeds its read budget");
        // Close the file before parsing; Windows readers must not hold up the
        // collector's atomic replacement while processing a large snapshot.
        byte[] bytes = Files.readAllBytes(path);
        if (bytes.length > maxBytes) throw new IOException("Collector publication exceeds its read budget");
        try {
            JSONObject value = (JSONObject)new JSONParser().parse(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
            if (!Long.valueOf(1).equals(value.get("version")) || !(value.get("events") instanceof JSONArray))
                throw new IOException("Invalid collector publication");
            return value;
        } catch (org.json.simple.parser.ParseException | ClassCastException error) { throw new IOException("Invalid collector publication", error); }
    }
    public static boolean excluded(Path root, Path file, JSONObject publication) {
        if (publication == null && !Files.exists(root.resolve(".timeline-collector/pending.json"))) return false;
        if (file.getFileName().toString().matches("(?:timeline_[a-f0-9]{12}_report|[^/\\\\]+_\\d+_\\d+_\\d{4}-\\d{2}-\\d{2}T\\d{2}Z)\\.json")) return true;
        if (publication == null) return false;
        String relative = root.relativize(file.toAbsolutePath().normalize()).toString().replace('\\','/');
        Object reports = publication.get("baseline_reports");
        if (reports instanceof JSONArray values) for (Object value : values)
            if (relative.equals(value.toString().replace('\\','/'))) return true;
        return false;
    }
    public static JSONObject find(JSONArray records, String identity) {
        if (records == null) return null;
        for (Object item : records) {
            JSONObject record = (JSONObject)item;
            if (identity.equals(Objects.toString(record.getOrDefault("id", record.get("ID")), ""))) return record;
            JSONObject child = find((JSONArray)record.get("activities"), identity);
            if (child != null) return child;
        }
        return null;
    }
    /** Null means no pending replacement; an empty object means not yet published. */
    public static JSONObject pendingDescriptor(Path root, Path file, JSONObject publication) throws IOException {
        Path pending = root.resolve(".timeline-collector/pending.json");
        if (!Files.exists(pending)) return null;
        try (Reader reader = Files.newBufferedReader(pending)) {
            JSONObject journal = (JSONObject)new JSONParser().parse(reader);
            if (publication != null && Objects.equals(publication.get("generation"), journal.get("generation"))) return null;
            String relative = root.relativize(file).toString().replace('\\','/');
            for (Object item : (JSONArray)journal.get("files")) {
                JSONObject entry = (JSONObject)item;
                if (!relative.equals(entry.get("path").toString().replace('\\','/'))) continue;
                if (entry.get("previous") == null) return new JSONObject();
                return (JSONObject)new JSONParser().parse(new String(Base64.getDecoder().decode(entry.get("previous").toString()), java.nio.charset.StandardCharsets.UTF_8));
            }
            return null;
        } catch (NoSuchFileException error) { return null; }
        catch (org.json.simple.parser.ParseException error) { throw new IOException("Invalid publication journal", error); }
    }
}
