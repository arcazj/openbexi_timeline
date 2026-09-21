package com.openbexi.timeline.api;

import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.everit.json.schema.Schema;
import org.everit.json.schema.ValidationException;
import org.everit.json.schema.loader.SchemaLoader;
import org.json.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Exercises the published contract against real servlet exchanges, not example payloads. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ApiContractTest {
    private static final Path ROOT = Path.of("").toAbsolutePath();
    private static final JSONObject SPEC = readSpec();
    @TempDir static Path temporary;
    private final String admin = "contract-admin-" + "a".repeat(40);
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private Tomcat server;
    private URI base;
    private String currentTag;

    private static JSONObject readSpec() {
        try { return new JSONObject(Files.readString(ROOT.resolve("swagger/openapi-v1.json"))); }
        catch (Exception e) { throw new ExceptionInInitializerError(e); }
    }

    private static JSONObject operation(HttpResponse<?> response) {
        String path = response.request().uri().getPath().replaceFirst("^/api/v1", "");
        String method = response.request().method().toLowerCase(Locale.ROOT);
        String[] actual = path.split("/", -1);
        JSONObject paths = SPEC.getJSONObject("paths");
        for (String template : paths.keySet()) {
            String[] expected = template.split("/", -1);
            if (actual.length != expected.length) continue;
            boolean matches = true;
            for (int i = 0; i < actual.length; i++) if (!(expected[i].startsWith("{") && !actual[i].isEmpty()) && !actual[i].equals(expected[i])) matches = false;
            if (matches) {
                assertTrue(paths.getJSONObject(template).has(method), "Undocumented method: " + method + " " + template);
                return paths.getJSONObject(template).getJSONObject(method);
            }
        }
        fail("Undocumented API resource: " + response.request().method() + " " + path);
        return null;
    }

    private static Schema schema(JSONObject definition) {
        // OpenAPI component references remain local when attached to this
        // draft-07-compatible fragment; no network schema resolver is involved.
        JSONObject document = new JSONObject(definition.toString()).put("components", SPEC.getJSONObject("components"));
        return SchemaLoader.builder().schemaJson(document).draftV7Support().build().load().build();
    }

    static void assertResponse(HttpResponse<String> response, JSONObject payload) {
        JSONObject responses = operation(response).getJSONObject("responses");
        String status = Integer.toString(response.statusCode());
        assertTrue(responses.has(status), "Undocumented response " + status + " for " + response.request().uri());
        JSONObject declared = responses.getJSONObject(status);
        if (!declared.has("content")) {
            assertTrue(response.body().isEmpty(), "A bodyless response must not contain JSON");
            return;
        }
        String media = response.headers().firstValue("Content-Type").orElse("").split(";", 2)[0].trim();
        JSONObject content = declared.getJSONObject("content");
        assertTrue(content.has(media), "Undocumented response media type " + media);
        try { schema(content.getJSONObject(media).getJSONObject("schema")).validate(payload); }
        catch (ValidationException e) { fail(response.request().method() + " " + response.request().uri() + " returned " + status + ": " + e.getAllMessages()); }
    }

    static void assertSuccessfulRequest(HttpResponse<?> response, Object input) {
        if (response.statusCode() < 200 || response.statusCode() >= 300) return;
        JSONObject body = operation(response).optJSONObject("requestBody");
        if (body == null) {
            assertNull(input, "A successful request must not send an undocumented body");
            return;
        }
        if (body.optBoolean("required")) assertNotNull(input, "A successful request must include its required body");
        if (input == null) return;
        String media = response.request().headers().firstValue("Content-Type").orElse("").split(";", 2)[0].trim();
        JSONObject content = body.getJSONObject("content");
        assertTrue(content.has(media), "Undocumented request media type " + media);
        try { schema(content.getJSONObject(media).getJSONObject("schema")).validate(input); }
        catch (ValidationException e) { fail("Server accepted a request outside the contract: " + e.getAllMessages()); }
    }

    @BeforeAll void start() throws Exception {
        server = new Tomcat(); server.setBaseDir(temporary.resolve("tomcat").toString()); server.setPort(0);
        server.getConnector().setProperty("address", "127.0.0.1");
        Context context = server.addContext("", ROOT.toString());
        Tomcat.addServlet(context, "contract", new TimelineApiServlet(ROOT, temporary.resolve("data"), admin, null, null));
        context.addServletMappingDecoded("/api/v1/*", "contract");
        server.start();
        base = URI.create("http://127.0.0.1:" + server.getConnector().getLocalPort() + "/api/v1/");
    }

    @AfterAll void stop() throws Exception { if (server != null) { server.stop(); server.destroy(); } }

    private JSONObject exchange(String method, String path, Object input, int expected) throws Exception {
        return exchange(method, path, input, expected, "application/json");
    }

    private JSONObject exchange(String method, String path, Object input, int expected, String media) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(15))
                .header("Authorization", "Bearer " + admin);
        if (input != null) request.header("Content-Type", media);
        if (currentTag != null && !method.equals("GET")) request.header("If-Match", currentTag);
        HttpResponse<String> response = client.send(request.method(method, input == null ? HttpRequest.BodyPublishers.noBody() :
                HttpRequest.BodyPublishers.ofString(input.toString())).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(expected, response.statusCode(), response.body());
        assertSuccessfulRequest(response, input);
        JSONObject payload = response.body().isBlank() ? null : new JSONObject(response.body());
        assertResponse(response, payload);
        currentTag = response.headers().firstValue("ETag").orElse(currentTag);
        return payload;
    }

    @Test void publishedSchemasRejectBrokenPayloadsAndIncompatibleCreationShapes() {
        JSONObject schemas = SPEC.getJSONObject("components").getJSONObject("schemas");
        assertThrows(ValidationException.class, () -> schema(schemas.getJSONObject("Event"))
                .validate(new JSONObject().put("start", "2026-01-01")), "Required event data must be enforced");
        assertThrows(ValidationException.class, () -> schema(schemas.getJSONObject("Problem"))
                .validate(new JSONObject().put("status", "422")), "An invalid error envelope must fail validation");
        assertThrows(ValidationException.class, () -> schema(schemas.getJSONObject("CreateDataset"))
                .validate(new JSONObject().put("id", "bad").put("sourceId", "monet").put("events", new JSONArray())),
                "A clone must not silently override supplied events");
    }

    @Test void realReadWriteResponsesAndSuccessfulRequestsConformAcrossResourceTypes() throws Exception {
        exchange("GET", "health", null, 200);
        exchange("HEAD", "health", null, 200);
        exchange("OPTIONS", "datasets", null, 204);
        exchange("GET", "datasets", null, 200);
        exchange("GET", "models", null, 200);
        String id = "contract-" + UUID.randomUUID(), dataset = "datasets/" + id;
        exchange("POST", "datasets", new JSONObject().put("id", id).put("sourceId", "monet"), 201);
        JSONObject model = exchange("GET", "models/" + id, null, 200);
        model.getJSONArray("params").getJSONObject(0).put("title", "Contract model");
        exchange("PUT", "models/" + id, model, 200);
        exchange("PATCH", dataset, new JSONObject().put("title", "Contract dataset"), 200);
        for (String collection : List.of("events", "sessions")) {
            JSONObject event = new JSONObject().put("start", "1900").put("end", "1901")
                    .put("data", new JSONObject().put("title", "Contract duration"));
            JSONObject created = exchange("POST", dataset + "/" + collection, event, 201);
            String item = dataset + "/" + collection + "/" + created.getString("id");
            exchange("GET", dataset + "/" + collection + "?limit=2", null, 200);
            exchange("GET", item, null, 200);
            exchange("PUT", item, event.put("end", "1902"), 200);
            exchange("PATCH", item, new JSONObject().put("data", new JSONObject().put("description", "Contract update")), 200,
                    "application/merge-patch+json");
            exchange("DELETE", item, null, 204);
        }
        JSONObject filter = new JSONObject().put("title", "Chosen durations").put("query", new JSONObject().put("kind", "session"));
        JSONObject saved = exchange("POST", dataset + "/filters", filter, 201);
        String item = dataset + "/filters/" + saved.getString("id");
        exchange("GET", dataset + "/filters", null, 200);
        exchange("GET", item, null, 200);
        exchange("PUT", item, filter.put("title", "Replaced filter"), 200);
        exchange("PATCH", item, new JSONObject().put("title", "Patched filter"), 200);
        exchange("DELETE", item, null, 204);
        exchange("GET", dataset + "/events?limit=0", null, 400);
        exchange("GET", dataset + "/events/missing", null, 404);
        exchange("DELETE", dataset, null, 204);
    }

    @Test void requestsOutsideDeclaredFieldTypesAreRejectedWithoutMutatingTheDataset() throws Exception {
        String id = "contract-invalid-" + UUID.randomUUID(), dataset = "datasets/" + id;
        exchange("POST", "datasets", new JSONObject().put("id", id).put("sourceId", "monet"), 201);
        JSONObject before = exchange("GET", dataset, null, 200);
        String originalTag = currentTag;
        for (String key : List.of("namespace", "zone", "render")) {
            JSONObject invalid = new JSONObject().put("start", "1900").put("data", new JSONObject().put("title", "Invalid optional field"))
                    .put(key, 123);
            exchange("POST", dataset + "/events", invalid, 422);
        }
        for (String key : List.of("description", "kind")) exchange("POST", dataset + "/events",
                new JSONObject().put("start", "1900").put("data", new JSONObject().put("title", "Invalid metadata").put(key, 123)), 422);
        exchange("POST", dataset + "/filters", new JSONObject().put("title", 123).put("query", new JSONObject()), 422);
        for (String key : List.of("id", "title", "description", "sourceId")) exchange("POST", "datasets",
                new JSONObject().put("id", "invalid-" + UUID.randomUUID()).put("sourceId", "monet").put(key, 123), 422);
        JSONObject model = exchange("GET", "models/monet", null, 200);
        exchange("POST", "datasets", new JSONObject().put("id", "invalid-" + UUID.randomUUID()).put("model", model).put("events", new JSONObject()), 422);
        exchange("POST", "datasets", new JSONObject().put("id", "invalid-" + UUID.randomUUID()).put("sourceId", "monet").put("events", new JSONArray()), 422);
        JSONObject after = exchange("GET", dataset, null, 200);
        assertEquals(before.getInt("recordCount"), after.getInt("recordCount"));
        assertEquals(originalTag, currentTag, "Rejected inputs must leave the dataset revision unchanged");
        exchange("DELETE", dataset, null, 204);
    }
}
