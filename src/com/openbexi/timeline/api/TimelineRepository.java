package com.openbexi.timeline.api;

import org.json.*;
import java.io.*;
import java.nio.channels.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.UnaryOperator;

/** Public catalog reader and durable JSON repository. No client-supplied filesystem paths. */
public final class TimelineRepository {
    private final Path root, storage;
    private final Map<String, JSONObject> catalog = new LinkedHashMap<>();
    private final Map<String, JSONObject> publicCache = new ConcurrentHashMap<>();
    private static final ConcurrentMap<Path, Object> locks = new ConcurrentHashMap<>();
    public final TimelineModels models;
    public TimelineRepository(Path root, Path storage) throws IOException {
        this.root = root.toRealPath();
        this.storage = storage.toAbsolutePath().normalize();
        Path ancestor = this.storage;
        while (ancestor != null && !Files.exists(ancestor)) ancestor = ancestor.getParent();
        if (this.storage.startsWith(this.root) || ancestor == null || ancestor.toRealPath().resolve(ancestor.relativize(this.storage)).normalize().startsWith(this.root))
            throw new IOException("API data directory must be outside the web root.");
        if (Files.isSymbolicLink(this.storage)) throw new IOException("API data directory must not be a symlink.");
        JSONObject manifest = new JSONObject(Files.readString(this.root.resolve("demos/catalog.json")));
        for (Object item : manifest.getJSONArray("demos")) {
            JSONObject demo = (JSONObject) item;
            catalog.put(validId(demo.getString("id")), demo);
        }
        models = new TimelineModels(this.root);
    }
    public static String validId(String id) {
        if (id == null || !id.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,79}")) throw new ApiException(400, "Invalid dataset id.");
        return id;
    }
    public boolean isPublic(String id) { return catalog.containsKey(id); }
    private Path source(String relative) throws IOException {
        Path path = root.resolve(relative).normalize();
        if (!path.startsWith(root) || !path.toRealPath().startsWith(root)) throw new IOException("Catalog path escapes root.");
        return path;
    }
    public JSONObject read(String id) throws IOException {
        validId(id);
        if (catalog.containsKey(id)) {
            JSONObject cached = publicCache.get(id);
            if (cached == null) {
                JSONObject entry = catalog.get(id);
                JSONObject model = models.validate(new JSONObject(Files.readString(source(entry.getString("model")))));
                JSONArray events = TimelineRecords.parse(Files.readString(source(entry.getString("dataset"))), model);
                cached = new JSONObject().put("id", id).put("title", entry.getString("title"))
                        .put("description", entry.optString("description")).put("model", models.canonical(model))
                        .put("events", events).put("filters", new JSONArray()).put("readOnly", true);
                publicCache.put(id, cached);
            }
            return TimelineRecords.copy(cached);
        }
        Path file = storage.resolve(id + ".json");
        if (Files.isSymbolicLink(file)) throw new ApiException(403, "Dataset file is not a regular repository file.");
        if (!Files.isRegularFile(file)) throw new ApiException(404, "Dataset not found.");
        return new JSONObject(Files.readString(file));
    }
    public JSONArray list(boolean includeManaged) throws IOException {
        JSONArray result = new JSONArray();
        for (String id : catalog.keySet()) result.put(metadata(read(id)));
        if (includeManaged && Files.isDirectory(storage)) {
            try (var files = Files.list(storage)) {
                for (Path file : files.filter(path -> path.getFileName().toString().matches("[A-Za-z0-9][A-Za-z0-9_-]{0,79}\\.json")).sorted().toList()) {
                    String name = file.getFileName().toString();
                    String id = name.substring(0, name.length() - 5);
                    if (!catalog.containsKey(id)) result.put(metadata(read(id)));
                }
            }
        }
        return result;
    }
    public JSONObject metadata(JSONObject dataset) {
        String id = dataset.getString("id");
        boolean writable = !dataset.optBoolean("readOnly");
        return new JSONObject().put("id", id).put("title", dataset.getString("title"))
                .put("description", dataset.optString("description")).put("timeAxis", TimelineRecords.axis(dataset.getJSONObject("model")))
                .put("recordCount", dataset.getJSONArray("events").length()).put("readOnly", !writable)
                .put("capabilities", new JSONObject().put("read", true).put("create", writable).put("update", writable).put("delete", writable))
                .put("links", new JSONObject().put("self", "/api/v1/datasets/" + id).put("model", "/api/v1/models/" + id)
                        .put("events", "/api/v1/datasets/" + id + "/events").put("sessions", "/api/v1/datasets/" + id + "/sessions")
                        .put("filters", "/api/v1/datasets/" + id + "/filters"));
    }
    public static String etag(JSONObject dataset) {
        try {
            return "\"" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(dataset.toString().getBytes(StandardCharsets.UTF_8))) + "\"";
        } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    public static void requireMatch(String expected, JSONObject current) {
        if (expected == null || expected.isBlank()) throw new ApiException(428, "Send the dataset ETag in If-Match before modifying existing data.");
        if (!etag(current).equals(expected)) throw new ApiException(412, "Dataset changed. Fetch its current ETag and retry your edit.");
    }
    public JSONObject create(JSONObject request) throws IOException {
        if (!Set.of("id", "title", "description", "sourceId", "model", "events").containsAll(request.keySet())) throw new ApiException(422, "Unknown dataset property.");
        if (request.has("sourceId") && (request.has("model") || request.has("events"))) throw new ApiException(422, "Choose a sourceId clone or a model and events, not both.");
        for (String key : List.of("id", "title", "description", "sourceId")) if (request.has(key) && !(request.get(key) instanceof String)) throw new ApiException(422, key + " must be a string.");
        if (request.has("events") && !(request.get("events") instanceof JSONArray)) throw new ApiException(422, "events must be an array.");
        String id = validId(request.optString("id"));
        return locked(id, () -> {
            if (catalog.containsKey(id) || Files.exists(storage.resolve(id + ".json"))) throw new ApiException(409, "Dataset id already exists.");
            JSONObject value;
            if (request.has("sourceId")) value = read(request.getString("sourceId"));
            else {
                if (request.optJSONObject("model") == null) throw new ApiException(422, "Provide sourceId or a valid model.");
                JSONObject model = models.validate(TimelineRecords.copy(request.getJSONObject("model")));
                value = new JSONObject().put("model", models.canonical(model)).put("events", request.optJSONArray("events", new JSONArray())).put("filters", new JSONArray());
            }
            value.put("id", id).put("title", request.optString("title", value.optString("title", id)))
                    .put("description", request.optString("description", value.optString("description"))).put("readOnly", false);
            validate(value); save(id, value); return value;
        });
    }
    public JSONObject mutate(String id, String expected, UnaryOperator<JSONObject> edit) throws IOException {
        validId(id);
        if (isPublic(id)) throw new ApiException(405, "Bundled datasets are read-only. Clone one with POST /api/v1/datasets to edit it.");
        return locked(id, () -> {
            JSONObject current = read(id); requireMatch(expected, current);
            JSONObject next = edit.apply(current);
            if (next == null) Files.delete(storage.resolve(id + ".json"));
            else { validate(next); save(id, next); }
            return next;
        });
    }
    private void validate(JSONObject value) {
        if (value.optString("title").isBlank() || value.optString("title").length() > 300) throw new ApiException(422, "Dataset title must contain 1 to 300 characters.");
        JSONObject model = models.validate(value.getJSONObject("model"));
        JSONObject axis = TimelineRecords.axis(model);
        Set<String> ids = new HashSet<>();
        for (Object event : value.getJSONArray("events")) {
            if (!(event instanceof JSONObject)) throw new ApiException(422, "Each event must be an object.");
            JSONObject record = TimelineRecords.validate((JSONObject) event, axis, 0);
            if (!ids.add(record.getString("id"))) throw new ApiException(409, "Duplicate event id.");
        }
    }
    private void save(String id, JSONObject value) throws IOException {
        value.put("revision", UUID.randomUUID().toString());
        Path temporary = Files.createTempFile(storage, id + "-", ".tmp");
        try {
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
                java.nio.ByteBuffer buffer = java.nio.ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            Files.move(temporary, storage.resolve(id + ".json"), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temporary); }
    }
    private interface IOOperation { JSONObject run() throws IOException; }
    private JSONObject locked(String id, IOOperation action) throws IOException {
        Files.createDirectories(storage);
        Path lockPath = storage.resolve(id + ".lock");
        synchronized (locks.computeIfAbsent(lockPath, key -> new Object())) {
            if (Files.isSymbolicLink(lockPath)) throw new IOException("Invalid repository lock.");
            try (FileChannel channel = FileChannel.open(lockPath, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
                 FileLock ignored = channel.lock()) { return action.run(); }
        }
    }
}
