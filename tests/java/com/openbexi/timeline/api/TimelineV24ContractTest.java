package com.openbexi.timeline.api;

import com.sun.net.httpserver.HttpServer;
import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.json.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.jupiter.api.Assertions.*;

/** The 2.4 resource contract is checked against actual HTTP responses, including a local mock AI provider. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class TimelineV24ContractTest {
    @TempDir static Path temporary;
    private final Path root = Path.of("").toAbsolutePath();
    private final String system = "v24-system-" + "a".repeat(40);
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private Tomcat server;
    private HttpServer provider;
    private ExecutorService providerThreads;
    private URI base;
    private final AtomicLong providerDelay = new AtomicLong();
    private volatile CountDownLatch arrived;

    @BeforeAll void start() throws Exception {
        provider = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        providerThreads = Executors.newCachedThreadPool(); provider.setExecutor(providerThreads);
        provider.createContext("/chat/completions", exchange -> {
            exchange.getRequestBody().readAllBytes();
            if (arrived != null) arrived.countDown();
            try { Thread.sleep(providerDelay.get()); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            JSONObject result = new JSONObject().put("explanation", "Candidate appearance change only.").put("assumptions", new JSONArray()).put("warnings", new JSONArray())
                    .put("proposal", new JSONObject().put("kind", "model").put("format", "json")
                            .put("text", Files.readString(root.resolve("models/demos/monet.json"))));
            byte[] body = new JSONObject().put("choices", new JSONArray().put(new JSONObject().put("finish_reason", "stop")
                    .put("message", new JSONObject().put("content", result.toString())))).toString().getBytes(StandardCharsets.UTF_8);
            try { exchange.sendResponseHeaders(200, body.length); exchange.getResponseBody().write(body); }
            catch (java.io.IOException ignored) { /* Expected when a request is cancelled. */ }
            finally { exchange.close(); }
        });
        provider.start();
        Path config = temporary.resolve("data/.ai/providers.json"); Files.createDirectories(config.getParent());
        Files.writeString(config, new JSONObject().put("enabled", true).put("maxRequestsPerHour", 100).put("providers", new JSONArray().put(new JSONObject()
                .put("id", "local-test").put("adapter", "local").put("endpoint", "http://127.0.0.1:" + provider.getAddress().getPort() + "/chat/completions")
                .put("models", new JSONArray().put(new JSONObject().put("id", "mock-model").put("capabilities", new JSONObject()))))).toString());
        server = new Tomcat(); server.setBaseDir(temporary.resolve("tomcat").toString()); server.setPort(0);
        server.getConnector().setProperty("address", "127.0.0.1");
        Context context = server.addContext("", root.toString());
        Tomcat.addServlet(context, "v24-contract", new TimelineApiServlet(root, temporary.resolve("data"), system, null, null));
        context.addServletMappingDecoded("/api/v1/*", "v24-contract"); server.start();
        base = URI.create("http://127.0.0.1:" + server.getConnector().getLocalPort() + "/api/v1/");
    }
    @AfterAll void stop() throws Exception {
        if (server != null) { server.stop(); server.destroy(); }
        if (provider != null) provider.stop(0);
        if (providerThreads != null) providerThreads.shutdownNow();
    }

    private HttpResponse<String> call(String method, String path, String token, String tag, JSONObject body) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(15));
        if (token != null) request.header("Authorization", "Bearer " + token);
        if (tag != null) request.header("If-Match", tag);
        if (body != null) request.header("Content-Type", "application/json");
        return client.send(request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body.toString())).build(), HttpResponse.BodyHandlers.ofString());
    }
    private HttpResponse<String> exchange(String method, String path, String token, String tag, JSONObject body, int expected) throws Exception {
        HttpResponse<String> response = call(method, path, token, tag, body);
        assertEquals(expected, response.statusCode(), response.body());
        ApiContractTest.assertSuccessfulRequest(response, body);
        ApiContractTest.assertResponse(response, response.body().isBlank() ? null : new JSONObject(response.body()));
        return response;
    }
    private JSONObject json(HttpResponse<String> response) { return new JSONObject(response.body()); }
    private String tag(HttpResponse<?> response) { return response.headers().firstValue("ETag").orElseThrow(); }
    private String id() { return "v24-" + UUID.randomUUID(); }
    private JSONObject user() throws Exception {
        return json(exchange("POST", "access/users", system, null,
                new JSONObject().put("id", id()).put("displayName", "Test member").put("workspaceIds", new JSONArray().put("default")), 201));
    }
    private String dataset() throws Exception {
        String id = id(); exchange("POST", "datasets", system, null, new JSONObject().put("id", id).put("sourceId", "monet"), 201); return id;
    }
    private JSONObject grant(JSONObject user, String role) { return new JSONObject().put("userId", user.getString("id")).put("role", role); }
    private void scope(String model, JSONArray grants, JSONArray roles) throws Exception {
        String route = "models/" + model + "/access";
        String tag = tag(exchange("GET", route, system, null, null, 200));
        JSONObject body = new JSONObject().put("grants", grants); if (roles != null) body.put("roles", roles);
        exchange("PUT", route, system, tag, body, 200);
    }
    private JSONObject aiInput() throws Exception {
        return new JSONObject().put("requestId", UUID.randomUUID().toString()).put("providerId", "local-test").put("providerModelId", "mock-model")
                .put("operation", "generate").put("prompt", "Review the existing appearance.")
                .put("document", new JSONObject().put("kind", "model").put("format", "json").put("text", Files.readString(root.resolve("models/demos/monet.json"))));
    }

    @Test void newPublishedResourcesConformAndConfigurationOperationsPreserveEveryItemField() throws Exception {
        JSONObject admin = user(), reader = user(); String token = admin.getString("token"), model = dataset();
        scope(model, new JSONArray().put(grant(admin, "admin")).put(grant(reader, "readOnly")), null);
        TimelineRepository repository = new TimelineRepository(root, temporary.resolve("data"));
        JSONArray records = repository.read(model).getJSONArray("events");
        exchange("GET", "me", token, null, null, 200);
        JSONObject userList = json(exchange("GET", "access/users", system, null, null, 200));
        assertFalse(userList.toString().contains(token)); assertFalse(userList.toString().contains("tokenHash"));
        exchange("GET", "workspaces", system, null, null, 200);
        exchange("POST", "workspaces", system, null, new JSONObject().put("id", id()).put("organizationId", "test-org"), 201);
        exchange("GET", "workspaces/default/entitlement", system, null, null, 200);
        exchange("GET", "models/" + model + "/access", reader.getString("token"), null, null, 200);
        String docRoute = "models/" + model + "/config-files";
        exchange("GET", docRoute, token, null, null, 200);
        HttpResponse<String> doc = exchange("POST", docRoute, token, null,
                new JSONObject().put("name", "document.yaml").put("kind", "yaml").put("text", "# kept\ndata_sources: []\n"), 201);
        String documentPath = docRoute + "/" + json(doc).getString("id");
        exchange("GET", documentPath, token, null, null, 200);
        exchange("DELETE", documentPath, token, tag(doc), null, 204);
        String route = "models/" + model;
        HttpResponse<String> current = exchange("GET", route, token, null, null, 200);
        JSONObject changed = json(current); changed.getJSONArray("params").getJSONObject(0).put("title", "Configuration revision");
        exchange("PUT", route, token, tag(current), changed, 200);
        JSONObject history = json(exchange("GET", route + "/versions", token, null, null, 200));
        exchange("GET", route + "/versions/" + history.getJSONArray("items").getJSONObject(0).getString("revision"), token, null, null, 200);
        exchange("GET", route + "/versions", reader.getString("token"), null, null, 403);
        assertTrue(records.similar(repository.read(model).getJSONArray("events")), "2.4 sidecars must not add or change a timeline item field");
    }

    @Test void aiProvidersCandidatesAndPermissionErrorsMatchThePublishedContract() throws Exception {
        JSONObject admin = user(), outsider = user(); String model = dataset(), token = admin.getString("token");
        scope(model, new JSONArray().put(grant(admin, "admin")), null);
        JSONArray records = new TimelineRepository(root, temporary.resolve("data")).read(model).getJSONArray("events");
        JSONObject providers = json(exchange("GET", "models/" + model + "/ai/providers", token, null, null, 200));
        assertTrue(providers.getBoolean("enabled"));
        JSONObject answer = json(exchange("POST", "models/" + model + "/ai/generate", token, null, aiInput(), 200));
        assertTrue(answer.getJSONObject("validation").getBoolean("valid"));
        exchange("POST", "models/" + model + "/ai/generate", outsider.getString("token"), null, aiInput(), 403);
        exchange("POST", "models/" + model + "/ai/cancel", token, null,
                new JSONObject().put("requestId", answer.getString("requestId")), 200);
        assertTrue(records.similar(new TimelineRepository(root, temporary.resolve("data")).read(model).getJSONArray("events")));
    }

    @Test void cancellationStillWorksForItsOwnerAfterEntitlementAndGrantRevocation() throws Exception {
        JSONObject admin = user(), backup = user(); String model = dataset(), token = admin.getString("token");
        scope(model, new JSONArray().put(grant(admin, "admin")).put(grant(backup, "admin")), null);
        JSONObject input = aiInput(); String cancelPath = "models/" + model + "/ai/cancel";
        providerDelay.set(5000); arrived = new CountDownLatch(1);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        HttpResponse<String> entitlement = exchange("GET", "workspaces/default/entitlement", system, null, null, 200);
        HttpResponse<String> disabled = null;
        try {
            Future<HttpResponse<String>> generation = executor.submit(() -> call("POST", "models/" + model + "/ai/generate", token, null, input));
            assertTrue(arrived.await(5, TimeUnit.SECONDS));
            scope(model, new JSONArray().put(grant(backup, "admin")), null);
            disabled = exchange("PUT", "workspaces/default/entitlement", system, tag(entitlement), new JSONObject()
                    .put("mode", "community").put("status", "active").put("features", new JSONObject().put("ai", false)), 200);
            JSONObject request = new JSONObject().put("requestId", input.getString("requestId"));
            JSONObject other = json(exchange("POST", cancelPath, backup.getString("token"), null, request, 200));
            assertFalse(other.getBoolean("cancelled"), "Another administrator cannot cancel somebody else's request");
            JSONObject own = json(exchange("POST", cancelPath, token, null, request, 200));
            assertTrue(own.getBoolean("cancelled"));
            HttpResponse<String> stopped = generation.get(3, TimeUnit.SECONDS);
            assertEquals(409, stopped.statusCode(), stopped.body()); ApiContractTest.assertResponse(stopped, json(stopped));
        } finally {
            if (disabled != null) exchange("PUT", "workspaces/default/entitlement", system, tag(disabled), new JSONObject()
                    .put("mode", "community").put("status", "active").put("features", new JSONObject().put("ai", true)), 200);
            providerDelay.set(0); arrived = null; executor.shutdownNow();
        }
    }

    @Test void accessInputsCannotCoerceNumbersIntoDocumentedStringsOrServiceIdentities() throws Exception {
        for (String reserved : List.of("anonymous", "service-admin", "service-writer", "service-reader"))
            exchange("POST", "access/users", system, null, new JSONObject().put("id", reserved).put("workspaceIds", new JSONArray().put("default")), 422);
        for (String field : List.of("id", "displayName", "token")) {
            JSONObject input = new JSONObject().put("id", id()).put("workspaceIds", new JSONArray().put("default")).put(field, 12345);
            HttpResponse<String> result = call("POST", "access/users", system, null, input);
            assertTrue(result.statusCode() >= 400, "Numeric " + field + " must not be coerced to a user string: " + result.body());
            ApiContractTest.assertResponse(result, json(result));
        }
        for (String field : List.of("id", "name", "organizationId")) {
            JSONObject input = new JSONObject().put("id", id()).put(field, 12345);
            HttpResponse<String> result = call("POST", "workspaces", system, null, input);
            assertTrue(result.statusCode() >= 400, "Numeric " + field + " must not be coerced to a workspace string: " + result.body());
            ApiContractTest.assertResponse(result, json(result));
        }
    }

    @Test void boundedCustomRolesAndPersonalFiltersConformWithoutChangingRecords() throws Exception {
        JSONObject admin = user(), editor = user(), other = user(); String model = dataset();
        JSONArray roles = new JSONArray().put(new JSONObject().put("name", "filterEditor").put("permissions", new JSONArray().put("read").put("writeFilters")));
        scope(model, new JSONArray().put(grant(admin, "admin")).put(grant(editor, "filterEditor")).put(grant(other, "filterEditor")), roles);
        String token = editor.getString("token"), route = "models/" + model + "/filters";
        HttpResponse<String> list = exchange("GET", route, token, null, null, 200);
        JSONArray records = new TimelineRepository(root, temporary.resolve("data")).read(model).getJSONArray("events");
        HttpResponse<String> created = exchange("POST", route, token, tag(list), new JSONObject().put("title", "Personal selection")
                .put("visibility", "personal").put("query", new JSONObject()).put("sortBy", new JSONObject().put("field", "start").put("direction", "asc")), 201);
        String item = route + "/" + json(created).getString("id");
        exchange("PATCH", item, other.getString("token"), tag(created), new JSONObject().put("title", "Should fail"), 404);
        exchange("POST", "datasets/" + model + "/events", token, tag(created), new JSONObject().put("start", "2026"), 403);
        exchange("DELETE", item, token, tag(created), null, 204);
        assertTrue(records.similar(new TimelineRepository(root, temporary.resolve("data")).read(model).getJSONArray("events")));
    }
}
