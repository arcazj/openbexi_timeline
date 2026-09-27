package com.openbexi.timeline.api;

import org.everit.json.schema.Schema;
import org.everit.json.schema.ValidationException;
import org.everit.json.schema.loader.SchemaLoader;
import org.json.*;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.channels.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.net.URLDecoder;
import java.security.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Administrator-only document storage. Files retain their original JSON/YAML text. */
public final class TimelineConfigFiles {
    private static final int MAX_BYTES = 2 * 1024 * 1024;
    private static final Map<Path,Object> LOCKS = new ConcurrentHashMap<>();
    private final Path webRoot, storage;
    private final List<Path> roots = new ArrayList<>();
    private final TimelineModels models;
    private final Schema legacySchema;

    public TimelineConfigFiles(Path root, Path storage, List<Path> configuredRoots) throws IOException {
        this.webRoot = root.toRealPath();
        this.storage = storage.toAbsolutePath().normalize();
        Path ancestor = this.storage;
        while (ancestor != null && !Files.exists(ancestor)) ancestor = ancestor.getParent();
        if (ancestor == null || this.storage.startsWith(webRoot) ||
                ancestor.toRealPath().resolve(ancestor.relativize(this.storage)).normalize().startsWith(webRoot))
            throw new IOException("Managed configuration storage must be outside the public web root.");
        if (Files.isSymbolicLink(this.storage)) throw new IOException("Configuration storage cannot be a symlink.");
        roots.add(this.storage);
        for (Path directory : configuredRoots) {
            Path approved = directory.toRealPath();
            if (!Files.isDirectory(approved)) throw new IOException("Configured document root must be a directory.");
            if (roots.stream().anyMatch(p -> p.startsWith(approved) || approved.startsWith(p)))
                throw new IOException("Configuration roots must not overlap.");
            roots.add(approved);
        }
        models = new TimelineModels(root);
        Path legacy = root.resolve("schemas/legacy-model.schema.json");
        legacySchema = SchemaLoader.builder()
                .schemaJson(new JSONObject(Files.readString(legacy))).draftV7Support().build().load().build();
    }

    private record Document(int rootIndex, Path file) {}
    private static String digest(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private String id(Document document) {
        return digest(document.rootIndex + ":" + roots.get(document.rootIndex).relativize(document.file).toString()).substring(0, 32);
    }
    private static String kind(Path file) { return file.toString().toLowerCase(Locale.ROOT).endsWith(".json") ? "model" : "yaml"; }
    private static boolean supported(Path file) { return file.getFileName().toString().matches("(?i)[^.].*\\.(json|yaml|yml)"); }
    private List<Document> documents() throws IOException {
        List<Document> result = new ArrayList<>();
        for (int i = 0; i < roots.size(); i++) {
            Path directory = roots.get(i);
            if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) continue;
            final int index = i;
            try (var files = Files.walk(directory, 10)) {
                for (Path path : files.filter(TimelineConfigFiles::supported)
                        .filter(p -> Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS)).sorted().toList()) {
                    if (path.toRealPath().startsWith(directory.toRealPath())) result.add(new Document(index, path));
                }
            }
        }
        return result;
    }
    private Document find(String id) throws IOException {
        if (id == null || !id.matches("[a-f0-9]{32}")) throw new ApiException(400, "Invalid configuration document ID.");
        for (Document document : documents()) if (id(document).equals(id)) return document;
        throw new ApiException(404, "Configuration document not found.");
    }
    private String readText(Document document) throws IOException {
        if (Files.size(document.file) > MAX_BYTES) throw new ApiException(413, "Configuration document exceeds 2 MiB.");
        try (InputStream stream = Files.newInputStream(document.file, LinkOption.NOFOLLOW_LINKS)) {
            byte[] bytes = stream.readNBytes(MAX_BYTES + 1);
            if (bytes.length > MAX_BYTES) throw new ApiException(413, "Configuration document exceeds 2 MiB.");
            return new String(bytes, StandardCharsets.UTF_8);
        }
    }
    private JSONObject metadata(Document document) {
        return new JSONObject().put("id", id(document)).put("name", document.file.getFileName().toString())
                .put("kind", kind(document.file)).put("writable", true).put("restartRequired", kind(document.file).equals("yaml"))
                .put("location", (document.rootIndex == 0 ? "managed/" : "configured-" + document.rootIndex + "/") +
                        roots.get(document.rootIndex).relativize(document.file).toString().replace('\\', '/'));
    }
    public JSONArray list() throws IOException {
        JSONArray result = new JSONArray();
        for (Document document : documents()) result.put(metadata(document));
        return result;
    }
    public JSONObject read(String id) throws IOException {
        Document document = find(id);
        return metadata(document).put("text", readText(document));
    }
    public static String etag(JSONObject document) {
        return "\"" + digest(document.getString("id") + "\n" + document.getString("name") + "\n" + document.getString("text")) + "\"";
    }
    private static void requireMatch(String expected, JSONObject current) {
        if (expected == null || expected.isBlank()) throw new ApiException(428, "Send the document ETag in If-Match before editing.");
        if (!etag(current).equals(expected)) throw new ApiException(412, "Document changed. Reload it and reconcile your draft before saving.");
    }
    private static String filename(JSONObject input) {
        if (!Set.of("name", "kind", "text").containsAll(input.keySet()) ||
                !(input.opt("name") instanceof String) || !(input.opt("kind") instanceof String) || !(input.opt("text") instanceof String))
            throw new ApiException(422, "Provide name, kind and text only.");
        String name = input.getString("name"), kind = input.getString("kind");
        if (!name.matches("[A-Za-z0-9][A-Za-z0-9_. -]{0,119}\\.(json|yaml|yml)") || name.contains("..") ||
                name.matches("(?i)(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])\\..*"))
            throw new ApiException(422, "Use a simple JSON or YAML filename without directories or reserved names.");
        if (!Set.of("model", "yaml").contains(kind) || kind.equals("model") != name.endsWith(".json"))
            throw new ApiException(422, "Model files use .json; YAML files use .yaml or .yml.");
        return name;
    }
    private Object validate(JSONObject input) {
        filename(input);
        String text = input.getString("text");
        if (text.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new ApiException(413, "Configuration document exceeds 2 MiB.");
        try {
            if (input.getString("kind").equals("yaml")) return yaml(text);
            JSONTokener parser = new JSONTokener(text, new JSONParserConfiguration().withStrictMode().withMaxNestingDepth(100));
            JSONObject model = new JSONObject(parser);
            if (parser.nextClean() != 0) throw new ApiException(422, "Unexpected content after the model JSON.");
            if (model.has("dataSource")) models.validate(model);
            else {
                legacySchema.validate(model);
                TimelineModels.validateRendering(model);
                Set<String> names = new HashSet<>();
                for (Object item : model.getJSONArray("bands")) if (!names.add(((JSONObject)item).getString("name")))
                    throw new ApiException(422, "Band names must be unique.");
            }
            return model.toMap();
        } catch (ApiException e) { throw e; }
        catch (ValidationException e) { throw new ApiException(422, String.join("; ", e.getAllMessages())); }
        catch (RuntimeException e) { throw new ApiException(422, "Invalid " + input.getString("kind") + " document: " + e.getMessage()); }
    }
    private static Object yaml(String text) {
        LoaderOptions options = new LoaderOptions();
        options.setAllowDuplicateKeys(false); options.setMaxAliasesForCollections(50);
        options.setNestingDepthLimit(40); options.setCodePointLimit(MAX_BYTES);
        Object value = new Yaml(new SafeConstructor(options)).load(text);
        if (!(value instanceof Map<?,?> map)) throw new ApiException(422, "YAML configuration must contain one mapping document.");
        if (map.get("model") != null && !(map.get("model") instanceof String)) throw new ApiException(422, "YAML model must be a path string or null.");
        if (map.containsKey("data_sources")) {
            if (!(map.get("data_sources") instanceof List<?> sources)) throw new ApiException(422, "data_sources must be a list.");
            Set<String> names = new HashSet<>();
            for (Object item : sources) {
                if (!(item instanceof Map<?,?> source) || !(source.get("namespace") instanceof String name) || name.isBlank())
                    throw new ApiException(422, "Every data source needs a namespace.");
                if (!names.add(name)) throw new ApiException(422, "Data source namespaces must be unique.");
                if (source.containsKey("enable") && !(source.get("enable") instanceof Boolean)) throw new ApiException(422, "Source enable must be Boolean.");
                strings(source, "data_sources", "type", "permission", "converter2events_class", "data_path", "data_model", "connector", "url", "database", "collection");
                for (String field : List.of("filter", "render")) if (source.containsKey(field) && !(source.get(field) instanceof Map))
                    throw new ApiException(422, "Source " + field + " must be a mapping.");
                if (source.get("filter") instanceof Map<?,?> filter) strings(filter, "source.filter", "include", "exclude");
                if (source.get("render") instanceof Map<?,?> render) strings(render, "source.render", "color", "textColor", "dateColor", "alternateColor");
            }
        } else if (!(map.containsKey("model") || map.containsKey("server") || map.containsKey("snapshot") || map.containsKey("apiVersion") || map.containsKey("rules"))) {
            throw new ApiException(422, "Unsupported YAML type. Use a source, snapshot/server, deployment, or metrics configuration.");
        }
        if (map.containsKey("server")) {
            if (!(map.get("server") instanceof Map<?,?> server)) throw new ApiException(422, "server must be a mapping.");
            strings(server, "server", "host", "state_root");
            if (server.containsKey("local_browser") && !(server.get("local_browser") instanceof Boolean)) throw new ApiException(422, "server.local_browser must be Boolean.");
            if (server.containsKey("port") && (!(server.get("port") instanceof Number port) || port.doubleValue() != port.intValue() || port.intValue() < 1 || port.intValue() > 65535))
                throw new ApiException(422, "server.port must be an integer from 1 to 65535.");
        }
        if (map.containsKey("snapshot")) {
            if (!(map.get("snapshot") instanceof Map<?,?> snapshot)) throw new ApiException(422, "snapshot must be a mapping.");
            strings(snapshot, "snapshot", "file");
        }
        strings(map, "YAML", "apiVersion", "kind");
        if (map.containsKey("rules") && !(map.get("rules") instanceof List)) throw new ApiException(422, "rules must be a list.");
        return value;
    }
    private static void strings(Map<?,?> map, String path, String... keys) {
        for (String key : keys) if (map.containsKey(key) && !(map.get(key) instanceof String))
            throw new ApiException(422, path + "." + key + " must be a string.");
    }
    private void unreferenced(Document target) throws IOException {
        String name = target.file.getFileName().toString();
        List<String> references = new ArrayList<>();
        for (Document document : documents()) {
            if (document.file.equals(target.file)) continue;
            Object value;
            try { String text = readText(document); value = kind(document.file).equals("yaml") ? yaml(text) : new JSONObject(text).toMap(); }
            catch (RuntimeException error) { throw new ApiException(409, "Cannot check references until invalid document " + document.file.getFileName() + " is corrected."); }
            if (referencesName(value, name, Collections.newSetFromMap(new IdentityHashMap<>()))) references.add(document.file.getFileName().toString());
        }
        // Public launch pages and the catalog can also reference an explicitly registered model.
        if (target.file.startsWith(webRoot)) {
            String relative = webRoot.relativize(target.file).toString().replace('\\', '/');
            try (var files = Files.list(webRoot)) {
                for (Path page : files.filter(p -> p.toString().endsWith(".html")).toList())
                    if (Files.readString(page).contains(relative)) references.add(page.getFileName().toString());
            }
            if (Files.readString(webRoot.resolve("demos/catalog.json")).contains(relative)) references.add("demos/catalog.json");
        }
        if (!references.isEmpty()) throw new ApiException(409, "Update references before renaming or deleting: " + String.join(", ", references));
    }
    private static boolean referencesName(Object value, String name, Set<Object> visited) {
        if (value instanceof String text) {
            String path = text.replace('\\', '/').split("[?#]", 2)[0];
            try { path = URLDecoder.decode(path.replace("+", "%2B"), StandardCharsets.UTF_8); }
            catch (IllegalArgumentException ignored) { /* Literal strings need not be URLs. */ }
            String comparedName = name;
            if (File.separatorChar == '\\') { path = path.toLowerCase(Locale.ROOT); comparedName = name.toLowerCase(Locale.ROOT); }
            return path.equals(comparedName) || path.endsWith("/" + comparedName);
        }
        if (value == null || !visited.add(value)) return false;
        if (value instanceof Map<?,?> map) return map.values().stream().anyMatch(item -> referencesName(item, name, visited));
        if (value instanceof List<?> list) return list.stream().anyMatch(item -> referencesName(item, name, visited));
        return false;
    }
    public JSONObject create(JSONObject input) throws IOException {
        String name = filename(input); validate(input);
        return locked(() -> {
            Path file = storage.resolve(name);
            if (Files.exists(file, LinkOption.NOFOLLOW_LINKS)) throw new ApiException(409, "A document with that name already exists.");
            save(file, input.getString("text")); return read(id(new Document(0, file)));
        });
    }
    public JSONObject update(String id, String expected, JSONObject input) throws IOException {
        String name = filename(input); validate(input);
        return locked(() -> {
            Document current = find(id); requireMatch(expected, read(id));
            if (!kind(current.file).equals(input.getString("kind"))) throw new ApiException(422, "Changing document type requires Save As.");
            Path destination = current.file.resolveSibling(name);
            if (!destination.equals(current.file)) {
                if (Files.exists(destination, LinkOption.NOFOLLOW_LINKS)) throw new ApiException(409, "A document with that name already exists.");
                unreferenced(current);
                // Rename is an independent operation so a failed rename cannot leave a duplicate or partial edit.
                if (!input.getString("text").equals(readText(current))) throw new ApiException(409, "Save content changes before renaming the file.");
                Files.move(current.file, destination, StandardCopyOption.ATOMIC_MOVE);
            } else save(destination, input.getString("text"));
            return read(id(new Document(current.rootIndex, destination)));
        });
    }
    public void delete(String id, String expected) throws IOException {
        locked(() -> { Document document = find(id); requireMatch(expected, read(id)); unreferenced(document); Files.delete(document.file); return null; });
    }
    private static void save(Path file, String text) throws IOException {
        Path temporary = Files.createTempFile(file.getParent(), ".ob-config-", ".tmp");
        try {
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = StandardCharsets.UTF_8.encode(text);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temporary); }
    }
    private interface Operation { JSONObject run() throws IOException; }
    private JSONObject locked(Operation operation) throws IOException {
        Files.createDirectories(storage);
        Path lock = storage.resolve(".config.lock");
        synchronized (LOCKS.computeIfAbsent(lock, ignored -> new Object())) {
            if (Files.isSymbolicLink(lock)) throw new IOException("Configuration lock cannot be a symlink.");
            try (FileChannel channel = FileChannel.open(lock, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
                 FileLock ignored = channel.lock()) { return operation.run(); }
        }
    }
}
