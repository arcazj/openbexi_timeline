package com.openbexi.timeline.api;

import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.json.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class TimelineConfigFilesTest {
    @TempDir static Path temporary;
    private final Path root = Path.of("").toAbsolutePath();
    private final String admin = "config-admin-" + "a".repeat(40), writer = "config-writer-" + "w".repeat(40);
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private Tomcat server;
    private URI base;
    @BeforeAll void start() throws Exception {
        server = new Tomcat(); server.setBaseDir(temporary.resolve("tomcat").toString()); server.setPort(0);
        server.getConnector().setProperty("address", "127.0.0.1");
        Context context = server.addContext("", root.toString());
        Tomcat.addServlet(context, "config-api", new TimelineApiServlet(root, temporary.resolve("data"), admin, writer, null));
        context.addServletMappingDecoded("/api/v1/*", "config-api"); server.start();
        base = URI.create("http://127.0.0.1:" + server.getConnector().getLocalPort() + "/api/v1/config-files");
    }
    @AfterAll void stop() throws Exception { if (server != null) { server.stop(); server.destroy(); } }
    private HttpResponse<String> call(String method, String id, String token, String etag, JSONObject body) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(base + (id == null ? "" : "/" + id))).timeout(Duration.ofSeconds(10));
        if (token != null) builder.header("Authorization", "Bearer " + token);
        if (etag != null) builder.header("If-Match", etag);
        if (body != null) builder.header("Content-Type", "application/json");
        HttpResponse<String> response = client.send(builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() :
                HttpRequest.BodyPublishers.ofString(body.toString())).build(), HttpResponse.BodyHandlers.ofString());
        ApiContractTest.assertSuccessfulRequest(response, body);
        if (!response.body().isEmpty()) ApiContractTest.assertResponse(response, new JSONObject(response.body()));
        return response;
    }
    private JSONObject document(String name, String kind, String text) { return new JSONObject().put("name", name).put("kind", kind).put("text", text); }
    private JSONObject json(HttpResponse<String> response, int expected) {
        assertEquals(expected, response.statusCode(), response.body()); return new JSONObject(response.body());
    }
    private String tag(HttpResponse<String> response) { return response.headers().firstValue("ETag").orElseThrow(); }
    @Test void allConfigurationReadsAndWritesRequireAdministrator() throws Exception {
        json(call("GET", null, null, null, null), 401);
        json(call("GET", null, writer, null, null), 403);
        json(call("POST", null, writer, null, document("private.yml", "yaml", "model: models/demo.json\n")), 403);
        json(call("GET", "a".repeat(32), null, null, null), 401);
        json(call("GET", null, admin, null, null), 200);
    }
    @Test void yamlRoundTripRetainsCommentsAnchorsUnknownKeysAndRootModel() throws Exception {
        String text = "# keep this comment\nmodel: models/example.json\ncustom: &style {color: '#abcdef'}\ncopy: *style\ndata_sources:\n  - namespace: earthquake\n    enable: true\n    render: *style\n";
        HttpResponse<String> created = call("POST", null, admin, null, document("earthquake.yml", "yaml", text));
        JSONObject value = json(created, 201); String id = value.getString("id");
        assertTrue(value.getBoolean("restartRequired"));
        assertEquals(text, Files.readString(temporary.resolve("data/config-files/earthquake.yml")));
        assertEquals(text, json(call("GET", id, admin, null, null), 200).getString("text"));
        String changed = text.replace("#abcdef", "#123456");
        JSONObject input = document("earthquake.yml", "yaml", changed);
        json(call("PUT", id, admin, null, input), 428);
        HttpResponse<String> saved = call("PUT", id, admin, tag(created), input); json(saved, 200);
        json(call("PUT", id, admin, tag(created), document("earthquake.yml", "yaml", text)), 412);
        assertEquals(changed, Files.readString(temporary.resolve("data/config-files/earthquake.yml")));
        HttpResponse<String> renamed = call("PUT", id, admin, tag(saved), document("earthquake-renamed.yml", "yaml", changed));
        JSONObject next = json(renamed, 200); assertNotEquals(id, next.getString("id"));
        assertFalse(Files.exists(temporary.resolve("data/config-files/earthquake.yml")));
        assertEquals(204, call("DELETE", next.getString("id"), admin, tag(renamed), null).statusCode());
        json(call("GET", next.getString("id"), admin, null, null), 404);
    }
    @Test void modelCrudPersistsAndReferencesPreventRenameOrDelete() throws Exception {
        String model = Files.readString(root.resolve("models/demos/monet.json"));
        HttpResponse<String> created = call("POST", null, admin, null, document("linked.json", "model", model));
        JSONObject value = json(created, 201); String id = value.getString("id");
        HttpResponse<String> config = call("POST", null, admin, null, document("linked-source.yml", "yaml", "model: models/linked.json\ndata_sources: []\n"));
        String yamlId = json(config, 201).getString("id");
        json(call("DELETE", id, admin, tag(created), null), 409);
        json(call("PUT", id, admin, tag(created), document("renamed.json", "model", model)), 409);
        assertEquals(model, Files.readString(temporary.resolve("data/config-files/linked.json")));
        assertEquals(204, call("DELETE", yamlId, admin, tag(config), null).statusCode());
        assertEquals(204, call("DELETE", id, admin, tag(created), null).statusCode());
    }
    @Test void invalidModelsYamlTagsDuplicateKeysAndTraversalCannotBeSaved() throws Exception {
        for (JSONObject input : List.of(
                document("../escape.yml", "yaml", "model: demo.json"),
                document("bad.yml", "yaml", "model: a\nmodel: b\n"),
                document("bad.yml", "yaml", "model: !!java.net.URL https://example.com\n"),
                document("bad.yml", "yaml", "data_sources: nope\n"),
                document("bad.yml", "yaml", "server: invalid\n"),
                document("bad.yml", "yaml", "server: {port: -1}\n"),
                document("bad.yml", "yaml", "server: {local_browser: maybe}\n"),
                document("bad.yml", "yaml", "server: {port: 8781}\nsnapshot: {file: 42}\n"),
                document("bad.yml", "yaml", "apiVersion: 3\nkind: Deployment\n"),
                document("bad.yml", "yaml", "rules: invalid\n"),
                document("bad.yml", "yaml", "model: 42\n"),
                document("bad.json", "model", "{}"),
                document("bad.json", "model", Files.readString(root.resolve("models/demos/monet.json")).replace("\"bands\"", "\"invalidBands\""))))
            json(call("POST", null, admin, null, input), 422);
        assertFalse(Files.exists(temporary.resolve("data/config-files/bad.yml")));
        assertFalse(Files.exists(temporary.resolve("data/escape.yml")));
    }
    @Test void legacyEarthquakeModelIsAcceptedAndRetainsAllProperties() throws Exception {
        String model = Files.readString(root.resolve("models/regular_timeline_earthquake.json"));
        HttpResponse<String> created = call("POST", null, admin, null, document("legacy.json", "model", model));
        assertEquals(model, json(created, 201).getString("text"));
        assertEquals(model, Files.readString(temporary.resolve("data/config-files/legacy.json")));
    }
    @Test void nonstandardJsonAndInvalidRenderingCombinationsAreRejectedBeforeSaving() throws Exception {
        String model = Files.readString(root.resolve("models/demos/monet.json"));
        for (String text : List.of(model.replace("\"params\"", "'params'"), model.replace("\"params\"", "params"),
                model.stripTrailing().replaceFirst("}\\s*$", ",}"),
                new JSONObject(model).put("rendering", new JSONObject().put("activity", new JSONObject().put("labelMaxWidth", 40))).toString(),
                new JSONObject(model).put("rendering", new JSONObject().put("table", new JSONObject().put("columns", new JSONArray()
                        .put(new JSONObject().put("field", "title").put("label", "Title").put("visible", false))))).toString()))
            json(call("POST", null, admin, null, document("invalid-rendering.json", "model", text)), 422);
        assertFalse(Files.exists(temporary.resolve("data/config-files/invalid-rendering.json")));
    }
    @Test void simultaneousUpdatesCannotOverwriteEachOther() throws Exception {
        HttpResponse<String> created = call("POST", null, admin, null, document("concurrent.yml", "yaml", "model: original.json\n"));
        String id = json(created, 201).getString("id"), etag = tag(created);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch latch = new CountDownLatch(1);
            List<Future<Integer>> futures = new ArrayList<>();
            for (String name : List.of("one", "two")) futures.add(pool.submit(() -> {
                latch.await(); return call("PUT", id, admin, etag, document("concurrent.yml", "yaml", "model: " + name + ".json\n")).statusCode();
            }));
            latch.countDown(); Set<Integer> statuses = new HashSet<>();
            for (Future<Integer> future : futures) statuses.add(future.get(15, TimeUnit.SECONDS));
            assertEquals(Set.of(200, 412), statuses);
        } finally { pool.shutdownNow(); }
    }
    @Test void nullYamlModelUsesDefaultAndEncodedReferencesStillProtectDocuments() throws Exception {
        HttpResponse<String> empty = call("POST", null, admin, null, document("default-model.yml", "yaml", "model: null\ndata_sources: []\n"));
        json(empty, 201);
        String text = Files.readString(root.resolve("models/demos/monet.json"));
        HttpResponse<String> model = call("POST", null, admin, null, document("encoded model.json", "model", text));
        String id = json(model, 201).getString("id");
        HttpResponse<String> source = call("POST", null, admin, null, document("encoded-source.yml", "yaml", "model: models/encoded%20model.json?v=2#preview\n"));
        String sourceId = json(source, 201).getString("id");
        json(call("DELETE", id, admin, tag(model), null), 409);
        assertEquals(204, call("DELETE", sourceId, admin, tag(source), null).statusCode());
        assertEquals(204, call("DELETE", id, admin, tag(model), null).statusCode());
    }
    @Test void configuredRootsUseServerIdsAndPreserveFilesOutsideTheirBoundaries() throws Exception {
        Path configured = Files.createDirectories(temporary.resolve("registered"));
        Files.writeString(configured.resolve("existing.yml"), "# existing\nmodel: regular.json\n");
        TimelineConfigFiles files = new TimelineConfigFiles(root, temporary.resolve("private-config"), List.of(configured));
        JSONObject entry = files.list().getJSONObject(0), current = files.read(entry.getString("id"));
        assertEquals("configured-1/existing.yml", entry.getString("location"));
        files.update(entry.getString("id"), TimelineConfigFiles.etag(current), document("existing.yml", "yaml", "# preserved\nmodel: revised.json\n"));
        assertEquals("# preserved\nmodel: revised.json\n", Files.readString(configured.resolve("existing.yml")));
        assertThrows(ApiException.class, () -> files.read("../outside.yml"));
    }
}
