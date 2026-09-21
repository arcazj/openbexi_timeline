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
class TimelineApiTest {
    @TempDir static Path temporary;
    private final Path root = Paths.get("").toAbsolutePath();
    private final String admin = "test-admin-" + "a".repeat(40), writer = "test-writer-" + "w".repeat(40), reader = "test-reader-" + "r".repeat(40);
    private Tomcat server;
    private URI base;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    @BeforeAll void start() throws Exception {
        server = new Tomcat(); server.setBaseDir(temporary.resolve("tomcat").toString()); server.setPort(0);
        server.getConnector().setProperty("address", "127.0.0.1");
        Context context = server.addContext("", root.toString());
        Tomcat.addServlet(context, "api", new TimelineApiServlet(root, temporary.resolve("data"), admin, writer, reader));
        context.addServletMappingDecoded("/api/v1/*", "api"); server.start();
        base = URI.create("http://127.0.0.1:" + server.getConnector().getLocalPort() + "/api/v1/");
    }
    @AfterAll void stop() throws Exception { if (server != null) { server.stop(); server.destroy(); } }
    private HttpRequest request(String method, String path, String token, String etag, Object body) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(15));
        if (token != null) builder.header("Authorization", "Bearer " + token);
        if (etag != null) builder.header("If-Match", etag);
        if (body != null) builder.header("Content-Type", "application/json");
        return builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body.toString())).build();
    }
    private HttpResponse<String> call(String method, String path, String token, String etag, Object body) throws Exception {
        HttpResponse<String> response = client.send(request(method, path, token, etag, body), HttpResponse.BodyHandlers.ofString());
        ApiContractTest.assertSuccessfulRequest(response, body);
        return response;
    }
    private JSONObject json(HttpResponse<String> response, int status) {
        assertEquals(status, response.statusCode(), response.body());
        JSONObject payload = new JSONObject(response.body());
        ApiContractTest.assertResponse(response, payload);
        return payload;
    }
    private String etag(HttpResponse<?> response) { return response.headers().firstValue("ETag").orElseThrow(); }
    private String cloneDataset(String source) throws Exception {
        String id = "test-" + UUID.randomUUID();
        json(call("POST", "datasets", admin, null, new JSONObject().put("id", id).put("sourceId", source).put("title", "Editable example")), 201);
        return id;
    }
    @Test void readsEveryCatalogThroughRealHttpWithStableIdsAndPagination() throws Exception {
        JSONArray expected = new JSONObject(Files.readString(root.resolve("demos/catalog.json"))).getJSONArray("demos");
        JSONArray datasets = json(call("GET", "datasets", null, null, null), 200).getJSONArray("items");
        assertEquals(7, datasets.length());
        for (Object entry : expected) {
            String id = ((JSONObject) entry).getString("id");
            JSONObject metadata = json(call("GET", "datasets/" + id, null, null, null), 200);
            assertTrue(metadata.getBoolean("readOnly"));
            assertFalse(metadata.getJSONObject("capabilities").getBoolean("update"));
            HttpResponse<String> first = call("GET", "datasets/" + id + "/events?limit=3", null, null, null);
            JSONObject page = json(first, 200);
            assertEquals(3, page.getJSONArray("items").length());
            assertTrue(page.getInt("total") >= ((JSONObject) entry).getInt("recordCount"));
            JSONObject second = json(call("GET", "datasets/" + id + "/events?offset=3&limit=3", null, null, null), 200);
            assertNotEquals(page.getJSONArray("items").getJSONObject(0).getString("id"), second.getJSONArray("items").getJSONObject(0).getString("id"));
            String eventId = page.getJSONArray("items").getJSONObject(0).getString("id");
            json(call("GET", "datasets/" + id + "/events/" + URLEncoder.encode(eventId, java.nio.charset.StandardCharsets.UTF_8).replace("+", "%20"), null, null, null), 200);
            HttpRequest conditional = HttpRequest.newBuilder(base.resolve("datasets/" + id + "/events?limit=3")).header("If-None-Match", etag(first)).build();
            assertEquals(304, client.send(conditional, HttpResponse.BodyHandlers.ofString()).statusCode());
        }
    }
    @Test void numericQueriesRetainMaAndCalendarQueriesSupportBce() throws Exception {
        JSONObject numeric = json(call("GET", "datasets/dinausaurs/events?from=165&to=115&limit=1000", null, null, null), 200);
        assertEquals("Ma", numeric.getJSONObject("timeAxis").getString("unit"));
        assertTrue(numeric.getInt("total") > 0);
        assertTrue(numeric.getJSONArray("items").getJSONObject(0).get("start") instanceof Number);
        json(call("GET", "datasets/dinausaurs/events?from=115&to=165", null, null, null), 422);
        JSONObject ancient = json(call("GET", "datasets/religions/events?from=-000499-01-01T00:00:00Z&to=0001-01-01T00:00:00Z", null, null, null), 200);
        assertTrue(ancient.getInt("total") > 0);
        json(call("GET", "datasets/monet/events?from=2024-02-30", null, null, null), 422);
    }
    @Test void authenticationRolesAndPublicReadOnlyCapabilitiesAreEnforced() throws Exception {
        json(call("POST", "datasets", null, null, new JSONObject()), 401);
        json(call("POST", "datasets", writer, null, new JSONObject()), 403);
        json(call("GET", "datasets", "wrong", null, null), 401);
        String id = cloneDataset("monet");
        json(call("GET", "datasets/" + id, null, null, null), 401);
        HttpResponse<String> current = call("GET", "datasets/" + id, reader, null, null); json(current, 200);
        json(call("DELETE", "datasets/" + id, writer, etag(current), null), 403);
        json(call("PATCH", "datasets/" + id, reader, etag(current), new JSONObject().put("title", "Bad")), 403);
        HttpResponse<String> publicDataset = call("GET", "datasets/monet", null, null, null);
        json(call("DELETE", "datasets/monet", admin, etag(publicDataset), null), 405);
    }
    @Test void eventCrudPersistsAndRejectsLostUpdatesWithoutTouchingOtherRecords() throws Exception {
        String id = cloneDataset("monet"), path = "datasets/" + id + "/events";
        HttpResponse<String> before = call("GET", path, reader, null, null);
        int count = json(before, 200).getInt("total");
        JSONObject event = new JSONObject().put("id", "new-event").put("start", "1900-01-01T00:00:00Z").put("data", new JSONObject().put("title", "Created"));
        json(call("POST", path, writer, null, event), 428);
        HttpResponse<String> created = call("POST", path, writer, etag(before), event); json(created, 201);
        assertTrue(created.headers().firstValue("Location").orElseThrow().endsWith("/new-event"));
        json(call("PATCH", path + "/new-event", writer, etag(before), new JSONObject().put("data", new JSONObject().put("title", "Stale"))), 412);
        HttpResponse<String> changed = call("PATCH", path + "/new-event", writer, etag(created), new JSONObject().put("data", new JSONObject().put("title", "Updated")));
        assertEquals("Updated", json(changed, 200).getJSONObject("data").getString("title"));
        TimelineRepository reloaded = new TimelineRepository(root, temporary.resolve("data"));
        assertEquals(count + 1, reloaded.read(id).getJSONArray("events").length());
        assertEquals(204, call("DELETE", path + "/new-event", writer, etag(changed), null).statusCode());
        assertEquals(count, json(call("GET", path, reader, null, null), 200).getInt("total"));
        json(call("GET", path + "/new-event", reader, null, null), 404);
    }
    @Test void sessionsAndSavedFiltersHaveWorkingCrud() throws Exception {
        String id = cloneDataset("monet"), path = "datasets/" + id;
        HttpResponse<String> before = call("GET", path, reader, null, null);
        JSONObject record = new JSONObject().put("id", "work").put("start", "1900-01-01T00:00:00Z")
                .put("end", "1901-01-01T00:00:00Z").put("data", new JSONObject().put("title", "Test duration"));
        HttpResponse<String> created = call("POST", path + "/sessions", writer, etag(before), record); json(created, 201);
        json(call("GET", path + "/sessions/work", reader, null, null), 200);
        JSONObject filter = new JSONObject().put("id", "selected").put("title", "Selected sessions")
                .put("query", new JSONObject().put("search", "Test duration").put("kind", "session"));
        HttpResponse<String> saved = call("POST", path + "/filters", writer, etag(created), filter); json(saved, 201);
        assertEquals(1, json(call("GET", path + "/events?filterId=selected", reader, null, null), 200).getInt("total"));
        HttpResponse<String> renamed = call("PATCH", path + "/filters/selected", writer, etag(saved), new JSONObject().put("title", "Renamed"));
        assertEquals("Renamed", json(renamed, 200).getString("title"));
        assertEquals(204, call("DELETE", path + "/filters/selected", writer, etag(renamed), null).statusCode());
    }
    @Test void modelUpdatesValidateAndCannotReinterpretExistingData() throws Exception {
        String id = cloneDataset("dinausaurs");
        HttpResponse<String> current = call("GET", "models/" + id, reader, null, null);
        JSONObject model = json(current, 200);
        model.getJSONObject("dataSource").getJSONObject("time").put("unit", "years");
        json(call("PUT", "models/" + id, admin, etag(current), model), 409);
        model = json(call("GET", "models/" + id, reader, null, null), 200);
        model.getJSONArray("bands").getJSONObject(0).put("sourceBands", new JSONArray().put("missing"));
        json(call("PUT", "models/" + id, admin, etag(current), model), 422);
        JSONObject valid = json(call("GET", "models/" + id, reader, null, null), 200);
        valid.getJSONArray("params").getJSONObject(0).put("title", "New model title");
        json(call("PUT", "models/" + id, admin, etag(current), valid), 200);
    }
    @Test void competingEditsAllowOnlyOneWriter() throws Exception {
        String id = cloneDataset("monet"), path = "datasets/" + id;
        String version = etag(call("GET", path, reader, null, null));
        CompletableFuture<HttpResponse<String>> a = client.sendAsync(request("PATCH", path, admin, version, new JSONObject().put("title", "A")), HttpResponse.BodyHandlers.ofString());
        CompletableFuture<HttpResponse<String>> b = client.sendAsync(request("PATCH", path, admin, version, new JSONObject().put("title", "B")), HttpResponse.BodyHandlers.ofString());
        List<Integer> statuses = new ArrayList<>(List.of(a.get().statusCode(), b.get().statusCode())); Collections.sort(statuses);
        assertEquals(List.of(200, 412), statuses);
    }
    @Test void invalidRequestsHaveProblemDetailsAndDoNotMutateData() throws Exception {
        HttpResponse<String> invalid = call("GET", "datasets/monet/events?limit=1001", null, null, null);
        assertEquals(400, json(invalid, 400).getInt("status"));
        assertTrue(invalid.headers().firstValue("Content-Type").orElseThrow().startsWith("application/problem+json"));
        json(call("GET", "datasets/monet/events?limit=1&limit=2", null, null, null), 400);
        json(call("GET", "datasets/monet/events?unknown=yes", null, null, null), 400);
        HttpRequest wrongType = HttpRequest.newBuilder(base.resolve("datasets")).header("Authorization", "Bearer " + admin)
                .header("Content-Type", "text/plain").POST(HttpRequest.BodyPublishers.ofString("{}" )).build();
        json(client.send(wrongType, HttpResponse.BodyHandlers.ofString()), 415);
        json(call("POST", "datasets", admin, null, new JSONObject().put("id", "../escape").put("sourceId", "monet")), 400);
        HttpRequest crossOrigin = HttpRequest.newBuilder(base.resolve("datasets")).header("Origin", "https://unconfigured.example")
                .method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build();
        json(client.send(crossOrigin, HttpResponse.BodyHandlers.ofString()), 403);
        assertThrows(java.io.IOException.class, () -> new TimelineRepository(root, root.resolve("data")));
    }
    @Test void publishedContractAndHealthAreAvailable() throws Exception {
        assertEquals("1", json(call("GET", "health", null, null, null), 200).getString("apiVersion"));
        JSONObject contract = json(call("GET", "openapi.json", null, null, null), 200);
        assertTrue(contract.getString("openapi").startsWith("3."));
        JSONObject paths = contract.getJSONObject("paths");
        assertTrue(paths.getJSONObject("/datasets").has("post"));
        for (String kind : List.of("events", "sessions", "filters")) {
            JSONObject endpoint = paths.getJSONObject("/datasets/{datasetId}/" + kind + "/{recordId}");
            assertTrue(endpoint.has("get") && endpoint.has("put") && endpoint.has("patch") && endpoint.has("delete"));
        }
    }
}
