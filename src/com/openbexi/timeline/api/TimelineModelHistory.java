package com.openbexi.timeline.api;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/** Private history of model configurations. Event/session payloads never enter this store. */
public final class TimelineModelHistory {
    private static final ConcurrentMap<Path, Object> LOCKS = new ConcurrentHashMap<>();
    private final Path directory;

    public TimelineModelHistory(Path storage) {
        directory = storage.toAbsolutePath().normalize().resolve("model-history");
    }

    public JSONObject record(String modelId, String principalId, JSONObject previous, JSONObject current) throws IOException {
        TimelineRepository.validId(modelId);
        if (current == null) throw new IllegalArgumentException("A model configuration is required.");
        // A dataset envelope is not a model. Refuse accidental storage of timeline items.
        for (JSONObject value : new JSONObject[]{previous, current}) {
            if (value != null && (value.has("events") || value.has("records") || value.has("activities")))
                throw new IllegalArgumentException("History accepts model configurations only.");
        }
        synchronized (LOCKS.computeIfAbsent(directory, ignored -> new Object())) {
            ensureDirectory();
            Path lockPath = directory.resolve(".lock");
            rejectLink(lockPath);
            try (FileChannel channel = FileChannel.open(lockPath, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
                 var ignored = channel.lock()) {
                JSONObject history = load(modelId);
                JSONArray items = history.getJSONArray("items");
                if (items.isEmpty() && previous != null)
                    items.put(entry(previous, "existing-configuration", "baseline"));
                String hash = revision(current);
                if (!items.isEmpty() && items.getJSONObject(items.length() - 1).getString("revision").equals(hash))
                    return summary(items.getJSONObject(items.length() - 1));
                JSONObject next = entry(current, principalId, "saved");
                items.put(next);
                Path target = file(modelId), temporary = Files.createTempFile(directory, "history-", ".tmp");
                try {
                    Files.writeString(temporary, history.toString(2), StandardCharsets.UTF_8);
                    rejectLink(target);
                    Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                } finally { Files.deleteIfExists(temporary); }
                return summary(next);
            }
        }
    }

    public JSONObject list(String modelId) throws IOException {
        TimelineRepository.validId(modelId);
        JSONArray result = new JSONArray();
        synchronized (LOCKS.computeIfAbsent(directory, ignored -> new Object())) {
            for (Object value : load(modelId).getJSONArray("items")) result.put(summary((JSONObject) value));
        }
        return new JSONObject().put("modelId", modelId).put("items", result);
    }

    public JSONObject read(String modelId, String revision) throws IOException {
        TimelineRepository.validId(modelId);
        if (revision == null || !revision.matches("[a-f0-9]{64}")) throw new ApiException(400, "Invalid model revision.");
        synchronized (LOCKS.computeIfAbsent(directory, ignored -> new Object())) {
            for (Object value : load(modelId).getJSONArray("items")) {
                JSONObject item = (JSONObject) value;
                if (item.getString("revision").equals(revision)) return new JSONObject(item.toString());
            }
        }
        throw new ApiException(404, "Model revision not found.");
    }

    private JSONObject load(String modelId) throws IOException {
        Path target = file(modelId);
        rejectLink(directory); rejectLink(target);
        if (!Files.exists(target)) return new JSONObject().put("modelId", modelId).put("items", new JSONArray());
        JSONObject result = new JSONObject(Files.readString(target));
        if (!modelId.equals(result.optString("modelId")) || result.optJSONArray("items") == null)
            throw new IOException("Invalid model history.");
        return result;
    }
    private void ensureDirectory() throws IOException {
        rejectLink(directory);
        Path parent = directory.getParent();
        if (Files.exists(parent) && !parent.toRealPath().equals(parent)) throw new IOException("History storage must not traverse symlinks.");
        Files.createDirectories(directory);
    }
    private Path file(String modelId) { return directory.resolve(modelId + ".json"); }
    private static void rejectLink(Path path) throws IOException {
        if (Files.isSymbolicLink(path)) throw new IOException("History storage must not use symlinks.");
    }
    private static JSONObject entry(JSONObject model, String actor, String state) {
        return new JSONObject().put("revision", revision(model)).put("savedAt", Instant.now().toString())
                .put("savedBy", actor == null ? "system" : actor).put("state", state)
                .put("configuration", new JSONObject(model.toString()));
    }
    private static JSONObject summary(JSONObject item) {
        JSONObject result = new JSONObject(item.toString()); result.remove("configuration"); return result;
    }
    private static String revision(JSONObject value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical(value).getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private static String canonical(Object value) {
        if (value instanceof JSONObject object) {
            StringBuilder text = new StringBuilder("{");
            for (String key : object.keySet().stream().sorted().toList()) {
                if (text.length() > 1) text.append(',');
                text.append(JSONObject.quote(key)).append(':').append(canonical(object.get(key)));
            }
            return text.append('}').toString();
        }
        if (value instanceof JSONArray array) {
            StringBuilder text = new StringBuilder("[");
            for (Object item : array) { if (text.length() > 1) text.append(','); text.append(canonical(item)); }
            return text.append(']').toString();
        }
        return JSONObject.valueToString(value);
    }
}
