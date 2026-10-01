package com.openbexi.timeline.api;

import org.json.*;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.Flow;

/** Wire adapters only. Provider errors, credentials and raw response bodies never reach clients. */
final class TimelineAiTransport {
    static final int MAX_RESPONSE_BYTES = 1024 * 1024;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER).build();

    static final class Pending {
        private CompletableFuture<?> future;
        private boolean cancelled;
        synchronized void attach(CompletableFuture<?> value) {
            future = value;
            if (cancelled) value.cancel(true);
        }
        synchronized boolean cancel() {
            cancelled = true;
            if (future != null) future.cancel(true);
            return true;
        }
        synchronized boolean cancelled() { return cancelled; }
    }

    JSONObject invoke(JSONObject provider, JSONObject model, String credential, String system, String prompt,
                      JSONObject image, int timeoutSeconds, Pending pending) {
        String adapter = provider.getString("adapter");
        JSONObject body = body(adapter, model, system, prompt, image);
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(provider.getString("endpoint")))
                .timeout(Duration.ofSeconds(timeoutSeconds)).header("Content-Type", "application/json")
                .header("Accept", "application/json");
        if (adapter.equals("anthropic")) {
            builder.header("anthropic-version", "2023-06-01");
            if (!credential.isEmpty()) builder.header("x-api-key", credential);
        } else if (!credential.isEmpty()) builder.header("Authorization", "Bearer " + credential);
        CompletableFuture<HttpResponse<byte[]>> future = client.sendAsync(builder
                .POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8)).build(),
                info -> new LimitedBodySubscriber());
        pending.attach(future);
        try {
            HttpResponse<byte[]> response = future.get(timeoutSeconds + 1L, TimeUnit.SECONDS);
            if (pending.cancelled()) throw new ApiException(409, "AI request cancelled.");
            int status = response.statusCode();
            if (status == 429) throw new ApiException(429, "The AI provider rate limit was reached. Try again later.");
            if (status == 401 || status == 403) throw new ApiException(502, "AI provider authentication failed. Contact the administrator.");
            if (status < 200 || status >= 300) throw new ApiException(502, "The AI provider could not complete this request.");
            String text = new String(response.body(), StandardCharsets.UTF_8);
            // A provider must never reflect its credential into a user-visible candidate or explanation.
            if (!credential.isEmpty() && text.contains(credential)) throw new ApiException(502, "The AI provider returned an unsafe response.");
            JSONObject envelope = strictObject(text);
            String output = output(adapter, envelope);
            JSONObject result = strictObject(output);
            if (!credential.isEmpty() && result.toString().contains(credential)) throw new ApiException(502, "The AI provider returned an unsafe response.");
            JSONObject usage = envelope.optJSONObject("usage");
            if (usage != null) {
                JSONObject safeUsage = new JSONObject();
                for (String key : List.of("input_tokens", "output_tokens", "total_tokens", "prompt_tokens", "completion_tokens"))
                    if (usage.opt(key) instanceof Number number && number.longValue() >= 0) safeUsage.put(key, number.longValue());
                result.put("usage", safeUsage);
            }
            return result;
        } catch (ApiException error) { throw error; }
        catch (CancellationException error) { throw new ApiException(409, "AI request cancelled."); }
        catch (InterruptedException error) {
            Thread.currentThread().interrupt(); future.cancel(true);
            throw new ApiException(409, "AI request cancelled.");
        } catch (TimeoutException error) {
            future.cancel(true); throw new ApiException(504, "The AI provider timed out. Try again or choose another provider.");
        } catch (ExecutionException error) {
            if (pending.cancelled()) throw new ApiException(409, "AI request cancelled.");
            if (error.getCause() instanceof HttpTimeoutException) throw new ApiException(504, "The AI provider timed out.");
            throw new ApiException(502, "AI provider connection failed or its response exceeded the allowed size.");
        } catch (RuntimeException error) {
            throw new ApiException(502, "The AI provider did not return the required JSON response.");
        }
    }

    static JSONObject body(String adapter, JSONObject model, String system, String prompt, JSONObject image) {
        String modelId = model.getString("id");
        int tokens = model.getInt("maxOutputTokens");
        boolean structured = model.getJSONObject("capabilities").optBoolean("structuredOutput");
        JSONObject schema = responseSchema();
        if (adapter.equals("openai")) {
            JSONArray content = new JSONArray().put(new JSONObject().put("type", "input_text").put("text", prompt));
            if (image != null) content.put(new JSONObject().put("type", "input_image").put("image_url", imageUrl(image)));
            JSONObject body = new JSONObject().put("model", modelId).put("store", false).put("instructions", system)
                    .put("max_output_tokens", tokens).put("input", new JSONArray().put(new JSONObject().put("role", "user").put("content", content)));
            if (structured) body.put("text", new JSONObject().put("format", new JSONObject().put("type", "json_schema")
                    .put("name", "timeline_configuration_proposal").put("strict", true).put("schema", schema)));
            return body;
        }
        JSONArray content = new JSONArray();
        if (adapter.equals("anthropic")) {
            if (image != null) content.put(new JSONObject().put("type", "image").put("source", new JSONObject()
                    .put("type", "base64").put("media_type", image.getString("mimeType")).put("data", image.getString("dataBase64"))));
            content.put(new JSONObject().put("type", "text").put("text", prompt));
            JSONObject body = new JSONObject().put("model", modelId).put("system", system).put("max_tokens", tokens)
                    .put("messages", new JSONArray().put(new JSONObject().put("role", "user").put("content", content)));
            if (structured) body.put("output_config", new JSONObject().put("format", new JSONObject().put("type", "json_schema").put("schema", schema)));
            return body;
        }
        content.put(new JSONObject().put("type", "text").put("text", prompt));
        if (image != null) content.put(new JSONObject().put("type", "image_url").put("image_url", new JSONObject().put("url", imageUrl(image))));
        JSONObject body = new JSONObject().put("model", modelId).put("stream", false).put("max_tokens", tokens)
                .put("messages", new JSONArray().put(new JSONObject().put("role", "system").put("content", system))
                        .put(new JSONObject().put("role", "user").put("content", content)));
        if (structured) body.put("response_format", new JSONObject().put("type", "json_schema").put("json_schema",
                new JSONObject().put("name", "timeline_configuration_proposal").put("strict", true).put("schema", schema)));
        return body;
    }

    private static String imageUrl(JSONObject image) { return "data:" + image.getString("mimeType") + ";base64," + image.getString("dataBase64"); }
    static JSONObject strictObject(String text) {
        JSONTokener tokener = new JSONTokener(text, new JSONParserConfiguration().withStrictMode().withMaxNestingDepth(80));
        JSONObject value = new JSONObject(tokener);
        if (tokener.nextClean() != 0) throw new IllegalArgumentException("Trailing JSON content");
        return value;
    }

    private static String output(String adapter, JSONObject response) {
        if (adapter.equals("openai")) {
            if (!"completed".equals(response.optString("status", "completed"))) throw new ApiException(502, "The AI provider returned an incomplete response.");
            StringBuilder text = new StringBuilder();
            for (Object value : response.getJSONArray("output")) {
                JSONObject item = (JSONObject) value;
                if (!"message".equals(item.optString("type"))) continue;
                for (Object part : item.optJSONArray("content", new JSONArray())) {
                    JSONObject block = (JSONObject) part;
                    if ("output_text".equals(block.optString("type"))) text.append(block.getString("text"));
                }
            }
            return text.toString();
        }
        if (adapter.equals("anthropic")) {
            if (!"end_turn".equals(response.optString("stop_reason", "end_turn"))) throw new ApiException(502, "The AI provider returned an incomplete response.");
            StringBuilder text = new StringBuilder();
            for (Object value : response.getJSONArray("content")) {
                JSONObject block = (JSONObject) value;
                if ("text".equals(block.optString("type"))) text.append(block.getString("text"));
            }
            return text.toString();
        }
        JSONObject choice = response.getJSONArray("choices").getJSONObject(0);
        if (!"stop".equals(choice.optString("finish_reason", "stop"))) throw new ApiException(502, "The AI provider returned an incomplete response.");
        return choice.getJSONObject("message").getString("content");
    }

    static JSONObject responseSchema() {
        JSONObject string = new JSONObject().put("type", "string");
        JSONObject strings = new JSONObject().put("type", "array").put("items", string);
        JSONObject proposal = new JSONObject().put("type", "object").put("additionalProperties", false)
                .put("properties", new JSONObject().put("kind", new JSONObject().put("type", "string").put("enum", new JSONArray().put("model")))
                        .put("format", new JSONObject().put("type", "string").put("enum", new JSONArray().put("json").put("yaml"))).put("text", string))
                .put("required", new JSONArray(List.of("kind", "format", "text")));
        return new JSONObject().put("type", "object").put("additionalProperties", false)
                .put("properties", new JSONObject().put("explanation", string).put("assumptions", strings).put("warnings", strings)
                        .put("proposal", new JSONObject().put("anyOf", new JSONArray().put(proposal).put(new JSONObject().put("type", "null")))))
                .put("required", new JSONArray(List.of("explanation", "proposal", "assumptions", "warnings")));
    }

    /** Enforces the cap while receiving, rather than allocating an unbounded provider response. */
    private static final class LimitedBodySubscriber implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private Flow.Subscription subscription;
        public CompletionStage<byte[]> getBody() { return result; }
        public void onSubscribe(Flow.Subscription value) { subscription = value; value.request(1); }
        public void onNext(List<ByteBuffer> buffers) {
            for (ByteBuffer buffer : buffers) {
                if (buffer.remaining() > MAX_RESPONSE_BYTES - bytes.size()) {
                    subscription.cancel(); result.completeExceptionally(new IllegalStateException("Response too large")); return;
                }
                byte[] chunk = new byte[buffer.remaining()]; buffer.get(chunk); bytes.writeBytes(chunk);
            }
            subscription.request(1);
        }
        public void onError(Throwable error) { result.completeExceptionally(error); }
        public void onComplete() { result.complete(bytes.toByteArray()); }
    }
}
