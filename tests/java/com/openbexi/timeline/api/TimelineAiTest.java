package com.openbexi.timeline.api;

import com.sun.net.httpserver.HttpServer;
import org.json.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

/** All integrations use a local mock HTTP provider; no live credentials or provider calls. */
class TimelineAiTest {
    private final Path root = Path.of("").toAbsolutePath();
    @TempDir Path storage;
    private HttpServer server;
    private ExecutorService serverThreads;
    private final AtomicReference<JSONObject> outbound = new AtomicReference<>();
    private final AtomicReference<String> auth = new AtomicReference<>();
    private final AtomicReference<String> version = new AtomicReference<>();
    private final AtomicInteger calls = new AtomicInteger();
    private final AtomicInteger status = new AtomicInteger(200);
    private final AtomicLong delay = new AtomicLong();
    private final AtomicReference<String> response = new AtomicReference<>();
    private volatile CountDownLatch arrived;
    private static final String SECRET = "synthetic-provider-key-for-tests";
    private static final String PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

    @BeforeEach void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        serverThreads = Executors.newCachedThreadPool(); server.setExecutor(serverThreads);
        server.createContext("/provider", exchange -> {
            calls.incrementAndGet();
            outbound.set(new JSONObject(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            auth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            if (auth.get() == null) auth.set(exchange.getRequestHeaders().getFirst("x-api-key"));
            version.set(exchange.getRequestHeaders().getFirst("anthropic-version"));
            if (arrived != null) arrived.countDown();
            try { Thread.sleep(delay.get()); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            byte[] bytes = Objects.toString(response.get(), "{}").getBytes(StandardCharsets.UTF_8);
            try { exchange.sendResponseHeaders(status.get(), bytes.length); exchange.getResponseBody().write(bytes); }
            catch (IOException ignored) { /* Cancellation closes the client connection. */ }
            finally { exchange.close(); }
        });
        server.start();
    }
    @AfterEach void stop() { server.stop(0); serverThreads.shutdownNow(); }

    private String endpoint() { return "http://127.0.0.1:" + server.getAddress().getPort() + "/provider"; }
    private JSONObject configuration(String adapter, boolean vision, boolean structured) {
        JSONObject model = new JSONObject().put("id", "configured-model").put("capabilities", new JSONObject().put("vision", vision).put("structuredOutput", structured))
                .put("maxOutputTokens", 3000);
        JSONObject provider = new JSONObject().put("id", "provider").put("name", "Test provider").put("adapter", adapter)
                .put("endpoint", endpoint()).put("credentialEnv", "SYNTHETIC_TEST_KEY").put("models", new JSONArray().put(model));
        return new JSONObject().put("enabled", true).put("providers", new JSONArray().put(provider));
    }
    private TimelineAiService service(String adapter, boolean vision, boolean structured) throws IOException {
        return new TimelineAiService(root, configuration(adapter, vision, structured), key -> SECRET);
    }
    private JSONObject model() throws IOException { return new JSONObject(Files.readString(root.resolve("models/demos/default-dataset.json"))); }
    private JSONObject input() throws IOException {
        return new JSONObject().put("requestId", UUID.randomUUID().toString()).put("providerId", "provider").put("providerModelId", "configured-model")
                .put("operation", "generate").put("prompt", "Improve the title.")
                .put("document", new JSONObject().put("kind", "model").put("format", "json").put("text", model().toString()));
    }
    private JSONObject proposal(String text) {
        return new JSONObject().put("explanation", "Review this candidate.").put("assumptions", new JSONArray().put("Image labels may be approximate."))
                .put("warnings", new JSONArray()).put("proposal", new JSONObject().put("kind", "model").put("format", "json").put("text", text));
    }
    private void reply(String adapter, JSONObject candidate) {
        if (adapter.equals("openai")) response.set(new JSONObject().put("status", "completed").put("output", new JSONArray().put(new JSONObject()
                .put("type", "message").put("content", new JSONArray().put(new JSONObject().put("type", "output_text").put("text", candidate.toString())))))
                .put("usage", new JSONObject().put("input_tokens", 10).put("output_tokens", 20).put("secret_detail", "not exposed")).toString());
        else if (adapter.equals("anthropic")) response.set(new JSONObject().put("stop_reason", "end_turn").put("content", new JSONArray().put(new JSONObject()
                .put("type", "text").put("text", candidate.toString()))).toString());
        else response.set(new JSONObject().put("choices", new JSONArray().put(new JSONObject().put("finish_reason", "stop")
                .put("message", new JSONObject().put("content", candidate.toString())))).toString());
    }
    private ApiException failure(int status, org.junit.jupiter.api.function.Executable run) {
        ApiException error = assertThrows(ApiException.class, run); assertEquals(status, error.status, error.getMessage());
        assertFalse(error.getMessage().contains(SECRET)); return error;
    }

    @Test void disabledServiceLeavesManualEditingAndStorageUntouched() throws Exception {
        TimelineAiService service = new TimelineAiService(root, storage);
        assertFalse(service.providers().getBoolean("enabled"));
        failure(503, () -> service.generate("timeline", "admin", input()));
        assertEquals(0, calls.get());
        try (var files = Files.list(storage)) { assertEquals(0, files.count()); }
    }

    @Test void openAiVisionReturnsSchemaCheckedDraftWithoutMutatingInputOrPublishing() throws Exception {
        TimelineAiService service = service("openai", true, true);
        JSONObject input = input().put("baseRevision", "revision-7").put("image", new JSONObject().put("mimeType", "image/png").put("dataBase64", PNG));
        String before = input.toString();
        JSONObject candidate = model(); candidate.getJSONArray("params").getJSONObject(0).put("title", "Updated title");
        reply("openai", proposal(candidate.toString()));
        JSONObject result = service.generate("timeline", "admin", input);
        assertTrue(result.getJSONObject("validation").getBoolean("valid"));
        assertEquals(candidate.toString(), result.getJSONObject("proposal").getString("text"));
        assertEquals(before, input.toString()); assertEquals("revision-7", result.getString("baseRevision"));
        assertEquals("Bearer " + SECRET, auth.get());
        JSONObject sent = outbound.get(); assertFalse(sent.getBoolean("store"));
        assertEquals("json_schema", sent.getJSONObject("text").getJSONObject("format").getString("type"));
        assertEquals(3000, sent.getInt("max_output_tokens"));
        JSONArray content = sent.getJSONArray("input").getJSONObject(0).getJSONArray("content");
        assertTrue(content.getJSONObject(1).getString("image_url").startsWith("data:image/png;base64,"));
        assertTrue(sent.getString("instructions").contains("Never output event/session records"));
        assertFalse(sent.toString().contains(SECRET)); assertFalse(result.toString().contains(SECRET));
        assertFalse(result.getJSONObject("usage").has("secret_detail"));
    }

    @Test void providerCatalogContainsCapabilitiesWithoutCredentialNamesEndpointsOrSecrets() throws Exception {
        JSONObject result = service("huggingface", false, false).providers();
        assertTrue(result.getBoolean("enabled"));
        JSONObject provider = result.getJSONArray("providers").getJSONObject(0);
        assertTrue(provider.getBoolean("available"));
        assertFalse(provider.getJSONArray("models").getJSONObject(0).getJSONObject("capabilities").getBoolean("streaming"));
        assertFalse(result.toString().contains(SECRET)); assertFalse(result.toString().contains("SYNTHETIC_TEST_KEY"));
        assertFalse(result.toString().contains(endpoint()));
    }

    @Test void anthropicAndCompatibleAdaptersUseTheirDocumentedWireFormats() throws Exception {
        for (String adapter : List.of("anthropic", "huggingface", "openai-compatible", "local")) {
            TimelineAiService service = service(adapter, true, true);
            JSONObject request = input().put("image", new JSONObject().put("mimeType", "image/png").put("dataBase64", PNG));
            reply(adapter, proposal(model().toString()));
            assertTrue(service.generate("timeline", "admin", request).getJSONObject("validation").getBoolean("valid"));
            JSONObject sent = outbound.get();
            if (adapter.equals("anthropic")) {
                assertEquals("2023-06-01", version.get()); assertEquals(SECRET, auth.get());
                assertTrue(sent.has("output_config"));
                assertEquals(PNG, sent.getJSONArray("messages").getJSONObject(0).getJSONArray("content").getJSONObject(0).getJSONObject("source").getString("data"));
            } else {
                assertEquals("Bearer " + SECRET, auth.get()); assertFalse(sent.getBoolean("stream"));
                assertEquals("json_schema", sent.getJSONObject("response_format").getString("type"));
                assertTrue(sent.getJSONArray("messages").getJSONObject(1).getJSONArray("content").getJSONObject(1).getJSONObject("image_url").getString("url").contains(PNG));
            }
        }
    }

    @Test void plainOutputCapabilityWorksAndExplainCannotReturnAnApplyableCandidate() throws Exception {
        TimelineAiService service = service("openai-compatible", false, false);
        reply("openai-compatible", proposal(model().toString()));
        JSONObject result = service.generate("timeline", "admin", input().put("operation", "explain"));
        assertFalse(result.has("proposal")); assertFalse(outbound.get().has("response_format"));
        assertTrue(result.getJSONObject("validation").getBoolean("valid"));
    }

    @Test void blankInstructionSupportsExplainRepairAndImageOnlyProposals() throws Exception {
        TimelineAiService service = service("openai", true, true);
        reply("openai", proposal(model().toString()));
        for (String operation : List.of("explain", "repair", "generate")) {
            JSONObject request = input().put("operation", operation).put("prompt", "");
            if (operation.equals("generate")) request.put("image", new JSONObject().put("mimeType", "image/png").put("dataBase64", PNG));
            JSONObject result = service.generate("timeline", "admin", request);
            assertTrue(result.getJSONObject("validation").getBoolean("valid"));
            assertEquals(!operation.equals("explain"), result.has("proposal"));
            assertTrue(outbound.get().getJSONArray("input").getJSONObject(0).getJSONArray("content").getJSONObject(0).getString("text").contains("Operation: " + operation));
        }
        assertEquals(3, calls.get());
    }

    @Test void yamlAndRepairUseTheSameConfigurationSchemaAndNeverChangeItemFields() throws Exception {
        TimelineAiService service = service("openai", false, false);
        String yaml = new org.yaml.snakeyaml.Yaml().dump(model().toMap());
        JSONObject request = input().put("operation", "repair");
        request.getJSONObject("document").put("format", "yaml").put("text", "params: [broken syntax");
        JSONObject answer = proposal(yaml); answer.getJSONObject("proposal").put("format", "yaml");
        reply("openai", answer);
        JSONObject result = service.generate("timeline", "admin", request);
        assertTrue(result.getJSONObject("validation").getBoolean("valid"));
        assertEquals(yaml, result.getJSONObject("proposal").getString("text"));
        assertFalse(result.has("records"));
    }

    @Test void rejectsUnsupportedImagesUnknownModelsAndOutboundRecordOrSecretData() throws Exception {
        TimelineAiService service = service("openai", false, false);
        failure(422, () -> service.generate("timeline", "admin", input().put("image", new JSONObject().put("mimeType", "image/png").put("dataBase64", PNG))));
        failure(422, () -> service.generate("timeline", "admin", input().put("providerModelId", "unconfigured")));
        failure(422, () -> service.generate("timeline", "admin", input().put("endpoint", "http://localhost/internal")));
        JSONObject records = input(); records.getJSONObject("document").put("text", "{\"events\":[],\"params\":[]}");
        failure(422, () -> service.generate("timeline", "admin", records));
        JSONObject secrets = input(); secrets.getJSONObject("document").put("text", "{\"params\":[],\"password\":\"abc\"}");
        failure(422, () -> service.generate("timeline", "admin", secrets));
        failure(422, () -> service.generate("timeline", "admin", input().put("prompt", "use https://host.test/?token=sensitive")));
        JSONObject escaped = input(); escaped.getJSONObject("document").put("text", "{\"params\":[],\"pass" + "\\u0077ord\":\"encoded-secret\"}");
        failure(422, () -> service.generate("timeline", "admin", escaped));
        JSONObject cyclic = input(); cyclic.getJSONObject("document").put("format", "yaml").put("text", "params: &self {again: *self}\n");
        failure(422, () -> service.generate("timeline", "admin", cyclic));
        failure(403, () -> service.generate("timeline", "", input()));
        assertEquals(0, calls.get());
    }

    @Test void invalidCandidatesAndProviderFailuresRemainUnapplied() throws Exception {
        TimelineAiService service = service("openai", false, false);
        reply("openai", proposal("{\"params\":[],\"bands\":[]}"));
        JSONObject result = service.generate("timeline", "admin", input());
        assertFalse(result.getJSONObject("validation").getBoolean("valid"));
        reply("openai", proposal("{\"password\":\"provider-invented-secret\",\"params\":[]}"));
        failure(502, () -> service.generate("timeline", "admin", input()));
        reply("openai", proposal(model().toString()).put("explanation", SECRET));
        failure(502, () -> service.generate("timeline", "admin", input()));
        status.set(401); response.set(SECRET);
        failure(502, () -> service.generate("timeline", "admin", input()));
        status.set(429); failure(429, () -> service.generate("timeline", "admin", input()));
        status.set(200); response.set("not JSON " + SECRET);
        failure(502, () -> service.generate("timeline", "admin", input()));
    }

    @Test void malformedRequestFieldsAreRejectedBeforeAnyProviderCall() throws Exception {
        TimelineAiService service = service("openai", false, false);
        reply("openai", proposal(model().toString()));
        for (String field : List.of("requestId", "providerId", "providerModelId", "operation", "baseRevision"))
            failure(422, () -> service.generate("timeline", "admin", input().put(field, 12345678)));
        JSONObject missingFormat = input(); missingFormat.getJSONObject("document").remove("format");
        failure(422, () -> service.generate("timeline", "admin", missingFormat));
        JSONObject numericFormat = input(); numericFormat.getJSONObject("document").put("format", 123);
        failure(422, () -> service.generate("timeline", "admin", numericFormat));
        failure(413, () -> service.generate("timeline", "admin", input().put("baseRevision", "x".repeat(201))));
        assertEquals(0, calls.get(), "Invalid client fields must not consume a provider request or quota");
    }

    @Test void quotasAndSizeLimitsApplyBeforeAnotherProviderRequest() throws Exception {
        JSONObject config = configuration("openai", false, false).put("maxRequestsPerHour", 1);
        TimelineAiService service = new TimelineAiService(root, config, key -> SECRET);
        reply("openai", proposal(model().toString()));
        service.generate("timeline", "admin", input());
        failure(429, () -> service.generate("another-model", "admin", input()));
        assertEquals(1, calls.get());
        failure(413, () -> service.generate("timeline", "other-admin", input().put("prompt", "x".repeat(16001))));
        TimelineAiService vision = service("openai", true, false);
        failure(422, () -> vision.generate("timeline", "admin", input().put("image", new JSONObject().put("mimeType", "image/png").put("dataBase64", "!invalid!"))));
        failure(413, () -> vision.generate("timeline", "admin", input().put("image", new JSONObject().put("mimeType", "image/png").put("dataBase64", "A".repeat(1500000)))));
    }

    @Test void cancellationIsBoundToTheRequestModelAndPrincipal() throws Exception {
        TimelineAiService service = service("openai", false, false);
        JSONObject input = input(); reply("openai", proposal(model().toString())); delay.set(5000);
        arrived = new CountDownLatch(1);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<JSONObject> result = executor.submit(() -> service.generate("timeline", "admin", input));
            assertTrue(arrived.await(5, TimeUnit.SECONDS));
            String id = input.getString("requestId");
            assertFalse(service.cancel("other-model", "admin", id).getBoolean("cancelled"));
            assertFalse(service.cancel("timeline", "another-admin", id).getBoolean("cancelled"));
            assertTrue(service.cancel("timeline", "admin", id).getBoolean("cancelled"));
            ExecutionException error = assertThrows(ExecutionException.class, () -> result.get(3, TimeUnit.SECONDS));
            assertInstanceOf(ApiException.class, error.getCause()); assertEquals(409, ((ApiException)error.getCause()).status);
        } finally { executor.shutdownNow(); }
    }

    @Test void timeoutOversizeAndTruncatedResponsesHaveSafeFailures() throws Exception {
        TimelineAiService service = new TimelineAiService(root, configuration("openai", false, false).put("requestTimeoutSeconds", 1), key -> SECRET);
        reply("openai", proposal(model().toString())); delay.set(2000);
        failure(504, () -> service.generate("timeline", "admin", input()));
        delay.set(0); response.set("x".repeat(TimelineAiTransport.MAX_RESPONSE_BYTES + 1));
        failure(502, () -> service.generate("timeline", "admin", input()));
        response.set("{\"status\":\"incomplete\",\"output\":[]}");
        failure(502, () -> service.generate("timeline", "admin", input()));
    }

    @Test void privateProviderConfigurationRejectsCredentialsAndUnsafeTransport() {
        JSONObject config = configuration("openai", false, false);
        config.getJSONArray("providers").getJSONObject(0).put("apiKey", SECRET);
        assertThrows(IOException.class, () -> new TimelineAiService(root, config, key -> SECRET));
        config.getJSONArray("providers").getJSONObject(0).remove("apiKey");
        config.getJSONArray("providers").getJSONObject(0).put("endpoint", "http://example.test/provider");
        assertThrows(IOException.class, () -> new TimelineAiService(root, config, key -> SECRET));
    }
}
