package org.openbexi.earthquake;

import com.sun.net.httpserver.HttpServer;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public class EarthquakeJsonConverterTest {
    private static final long BASE = Instant.parse("2024-03-01T00:00:00Z").toEpochMilli();

    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("earthquake-regression-");
        TimeZone original = TimeZone.getDefault();
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"));
            arguments();
            boundariesAndMerging(root.resolve("boundaries"));
            skipAndFillGaps(root.resolve("gaps"));
            splitAndResume(root.resolve("resume"));
            failedResponses(root.resolve("failures"));
            httpRetries();
            timeoutSplitting(root.resolve("timeout"));
            adaptiveWindows(root.resolve("adaptive"));
            System.out.println("All earthquake regression tests passed.");
        } finally {
            TimeZone.setDefault(original);
            try (var paths = Files.walk(root)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path);
            }
        }
    }

    private static void arguments() {
        for (String[] args : List.of(new String[0], new String[]{"-url", "default"})) {
            Map<String, String> parsed = EarthquakeJsonConverter.parseArgs(args);
            long start = EarthquakeJsonConverter.parseTime(parsed.get("starttime"), "starttime=");
            long end = EarthquakeJsonConverter.parseTime(parsed.get("endtime"), "endtime=");
            check(end - start == 172_800_000L, "Default range must cover exactly 48 hours");
            check(Math.abs(System.currentTimeMillis() - end) < 5000, "Default must include today");
        }
        check(EarthquakeJsonConverter.parseTime("starttime=2024-03-01", "starttime=") == BASE, "Parse named UTC dates");
        check(EarthquakeJsonConverter.parseTime("2024-03-01T00:00:00", "starttime=") == BASE, "Parse bare UTC timestamps");
        check(EarthquakeJsonConverter.parseTime("2024-02-29T19:00:00-05:00", "starttime=") == BASE, "Parse timezone offsets");
    }

    private static void boundariesAndMerging(Path root) throws Exception {
        JSONObject old = feature("a", BASE);
        var seeded = EarthquakeJsonConverter.processJson(collection(List.of(old)), root);
        JSONObject legacy = seeded.values().iterator().next().getJSONObject(0);
        legacy.put("id", "legacy-id");
        legacy.getJSONObject("data").remove("eventId");
        EarthquakeJsonConverter.saveEventsToFile(seeded);
        try (Catalog server = new Catalog(List.of(feature("leap", BASE - 1), old, feature("b", BASE + 1)))) {
            importer(server, root).importRange(BASE - 1, BASE + 1);
            check(Files.exists(root.resolve("2024/02/29/earthquake_2024_02_29_23.json")), "Keep leap-day records in UTC");
            JSONArray events = readHour(root);
            check(events.length() == 2, "Merge hourly files and deduplicate legacy net/code IDs");
            JSONObject a = find(events, "usa");
            check(a.getString("id").equals("legacy-id"), "Preserve legacy IDs");
            check(a.getString("start").equals("Fri Mar 01 00:00:00 UTC 2024"), "First day of month and UTC hour must be correct");
            check(a.getJSONObject("data").getJSONObject("geometry").getJSONArray("coordinates").length() == 3,
                    "Preserve earthquake coordinates");
            JSONObject updated = feature("a", BASE);
            updated.getJSONObject("properties").put("updated", BASE + 100).put("mag", 5.5);
            EarthquakeJsonConverter.saveEventsToFile(EarthquakeJsonConverter.processJson(collection(List.of(updated)), root));
            EarthquakeJsonConverter.saveEventsToFile(EarthquakeJsonConverter.processJson(collection(List.of(old)), root));
            check(readHour(root).length() == 2, "Repeated local imports must not duplicate events");
            check(find(readHour(root), "usa").getJSONObject("data").getDouble("mag") == 5.5,
                    "An older local file must not replace a newer event revision");
        }
    }

    private static void skipAndFillGaps(Path root) throws Exception {
        try (Catalog server = new Catalog(List.of(feature("first", BASE), feature("gap", BASE + 15)))) {
            long tomorrow = System.currentTimeMillis() + 86_400_000L;
            importer(server, root).importRange(tomorrow, tomorrow + 1000);
            check(server.requests.isEmpty() && !Files.exists(root.resolve(".import-progress.json")),
                    "Future ranges cannot be queried or marked complete");
            importer(server, root).importRange(BASE, BASE + 10);
            int requests = server.requests.size();
            importer(server, root).importRange(BASE, BASE + 10);
            check(server.requests.size() == requests, "Rerun must make zero requests for completed ranges");
            importer(server, root).importRange(BASE + 20, BASE + 30);
            check(server.requests.size() == requests + 1, "Empty interval needs only one count");
            server.requests.clear();
            importer(server, root).importRange(BASE, BASE + 40);
            for (Request request : server.requests) {
                check((request.start >= BASE + 11 && request.end <= BASE + 19)
                                || (request.start >= BASE + 31 && request.end <= BASE + 40),
                        "Queries must exclude every cached interval, including empty intervals");
            }
            check(readHour(root).length() == 2, "Fill missing records between previously imported ranges");
            int after = server.requests.size();
            importer(server, root).importRange(BASE, BASE + 40);
            check(server.requests.size() == after, "Merged coverage must survive reloading the checkpoint");
        }
    }

    private static void splitAndResume(Path root) throws Exception {
        List<JSONObject> features = new ArrayList<>();
        for (int i = 0; i <= EarthquakeArchiveImporter.QUERY_LIMIT; i++) features.add(feature("bulk" + i, BASE + i));
        try (Catalog server = new Catalog(features)) {
            long end = BASE + EarthquakeArchiveImporter.QUERY_LIMIT;
            long midpoint = BASE + EarthquakeArchiveImporter.QUERY_LIMIT / 2;
            server.failQueryThrough = midpoint;
            expectFailure(() -> importer(server, root).importRange(BASE, end), "503");
            check(readHour(root).length() == EarthquakeArchiveImporter.QUERY_LIMIT / 2, "Save the successful newer batch before failure");
            server.failQueryThrough = Long.MIN_VALUE;
            server.requests.clear();
            importer(server, root).importRange(BASE, end);
            for (Request request : server.requests) {
                check(request.end <= midpoint, "Resume must never query the completed newer batch");
            }
            check(readHour(root).length() == features.size(), "Splitting must retain all events at the shared boundary");
        }
    }

    private static void failedResponses(Path root) throws Exception {
        try (Catalog server = new Catalog(List.of(feature("a", BASE)))) {
            server.truncate = true;
            expectFailure(() -> importer(server, root).importRange(BASE, BASE + 1), "incomplete");
            check(!Files.exists(root.resolve(".import-progress.json")), "Truncated responses must not be checkpointed");
            server.truncate = false;
            server.noContent = true;
            expectFailure(() -> importer(server, root).importRange(BASE, BASE + 1), "incomplete");
            server.noContent = false;
            importer(server, root).importRange(BASE, BASE + 1);
            check(readHour(root).length() == 1, "Retry incomplete ranges successfully");
        }
    }

    private static EarthquakeArchiveImporter importer(Catalog server, Path root) throws IOException {
        return new EarthquakeArchiveImporter(server.url(), root,
                url -> EarthquakeJsonConverter.fetchJsonFromUrl(url, 5_000, 0));
    }

    private static void httpRetries() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var executor = Executors.newCachedThreadPool();
        server.setExecutor(executor);
        AtomicInteger transientCalls = new AtomicInteger(), permanentCalls = new AtomicInteger();
        server.createContext("/transient", exchange -> {
            int status = transientCalls.incrementAndGet() <= 2 ? 503 : 200;
            byte[] bytes = "0".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length);
            try (var out = exchange.getResponseBody()) { out.write(bytes); }
        });
        server.createContext("/permanent", exchange -> {
            permanentCalls.incrementAndGet();
            exchange.sendResponseHeaders(400, -1);
            exchange.close();
        });
        server.createContext("/slow", exchange -> {
            try { Thread.sleep(200); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            finally { exchange.close(); }
        });
        server.start();
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        try {
            check(EarthquakeJsonConverter.fetchJsonFromUrl(base + "/transient", 1000, 0).equals("0"),
                    "Recover after temporary server failures");
            check(transientCalls.get() == 3, "Retry transient HTTP failures up to three attempts");
            expectFailure(() -> EarthquakeJsonConverter.fetchJsonFromUrl(base + "/permanent", 1000, 0), "400");
            check(permanentCalls.get() == 1, "Do not retry permanent HTTP errors");
            try {
                EarthquakeJsonConverter.fetchJsonFromUrl(base + "/slow", 25, 0);
                throw new AssertionError("Expected timeout");
            } catch (EarthquakeJsonConverter.RetryableRequestException e) {
                check(e.getMessage().contains("3 attempts") && e.getMessage().contains(base + "/slow"),
                        "Exhausted timeouts must identify the URL and attempt count");
                check(e.getCause() instanceof SocketTimeoutException, "Preserve the timeout cause");
            }
        } finally {
            server.stop(0);
            executor.shutdownNow();
        }
    }

    private static void timeoutSplitting(Path root) throws Exception {
        long day = 86_400_000L;
        try (Catalog server = new Catalog(List.of(feature("a", BASE), feature("b", BASE + day)))) {
            AtomicInteger failures = new AtomicInteger();
            EarthquakeArchiveImporter.Fetcher fetcher = url -> {
                String decoded = URLDecoder.decode(url, StandardCharsets.UTF_8);
                if (decoded.contains("starttime=2024-03-01T00:00:00Z&endtime=2024-03-02T23:59:59.999Z")) {
                    failures.incrementAndGet();
                    throw new EarthquakeJsonConverter.RetryableRequestException("Simulated exhausted timeout", new SocketTimeoutException());
                }
                return EarthquakeJsonConverter.fetchJsonFromUrl(url, 5000, 0);
            };
            new EarthquakeArchiveImporter(server.url(), root, fetcher).importRange(BASE, BASE + 2 * day - 1);
            check(failures.get() == 1, "A failed wide count must be split");
            check(readHour(root).length() == 1, "Save older half after timeout recovery");
            check(Files.exists(root.resolve("2024/03/02/earthquake_2024_03_02_00.json")), "Save newer half after timeout recovery");
            int requests = server.requests.size();
            importer(server, root).importRange(BASE, BASE + 2 * day - 1);
            check(server.requests.size() == requests, "Recovered ranges must be checkpointed");
        }
    }

    private static void adaptiveWindows(Path root) throws Exception {
        long day = 86_400_000L;
        try (Catalog server = new Catalog(List.of())) {
            importer(server, root).importRange(BASE, BASE + 60 * day - 1);
            check(server.requests.get(0).end - server.requests.get(0).start + 1 == 7 * day,
                    "Begin a historical import with seven days, not ten years");
            check(server.requests.get(1).end - server.requests.get(1).start + 1 == 14 * day,
                    "Expand only after a successful sparse range");
        }
    }

    private static JSONArray readHour(Path root) throws IOException {
        return new JSONObject(Files.readString(root.resolve("2024/03/01/earthquake_2024_03_01_00.json"))).getJSONArray("events");
    }

    private static JSONObject find(JSONArray events, String sourceId) {
        for (int i = 0; i < events.length(); i++) {
            JSONObject event = events.getJSONObject(i);
            if (sourceId.equals(event.getJSONObject("data").optString("eventId"))) return event;
        }
        throw new AssertionError("Missing " + sourceId);
    }

    private static JSONObject feature(String code, long time) {
        return new JSONObject().put("id", "us" + code).put("type", "Feature")
                .put("properties", new JSONObject().put("time", time).put("updated", time).put("net", "us")
                        .put("code", code).put("title", "M 2.0 - Test earthquake").put("mag", 2.0))
                .put("geometry", new JSONObject().put("type", "Point").put("coordinates", new JSONArray(List.of(-155, 19, 5))));
    }

    private static String collection(List<JSONObject> features) {
        return new JSONObject().put("type", "FeatureCollection").put("features", new JSONArray(features)).toString();
    }

    private interface Action { void run() throws Exception; }

    private static void expectFailure(Action action, String text) throws Exception {
        try { action.run(); throw new AssertionError("Expected " + text); }
        catch (IOException e) { check(e.getMessage().contains(text), "Unexpected failure: " + e.getMessage()); }
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private record Request(String method, long start, long end) {}

    private static class Catalog implements AutoCloseable {
        final HttpServer server;
        final List<Request> requests = new ArrayList<>();
        long failQueryThrough = Long.MIN_VALUE;
        boolean truncate, noContent;

        Catalog(List<JSONObject> features) throws IOException {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                Map<String, String> parameters = new HashMap<>();
                for (String part : exchange.getRequestURI().getRawQuery().split("&")) {
                    String[] pair = part.split("=", 2);
                    parameters.put(pair[0], URLDecoder.decode(pair[1], StandardCharsets.UTF_8));
                }
                long start = Instant.parse(parameters.get("starttime")).toEpochMilli();
                long end = Instant.parse(parameters.get("endtime")).toEpochMilli();
                String method = exchange.getRequestURI().getPath();
                requests.add(new Request(method, start, end));
                List<JSONObject> matches = features.stream().filter(feature -> {
                    long time = feature.getJSONObject("properties").getLong("time");
                    return time >= start && time <= end;
                }).toList();
                int status = 200;
                String response;
                if (method.equals("/count")) response = Integer.toString(matches.size());
                else if (end <= failQueryThrough) { status = 503; response = "Unavailable"; }
                else if (noContent) { exchange.sendResponseHeaders(204, -1); exchange.close(); return; }
                else if (matches.size() > EarthquakeArchiveImporter.QUERY_LIMIT) { status = 400; response = "Too many events"; }
                else response = collection(truncate ? List.of() : matches);
                byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(status, bytes.length);
                try (var out = exchange.getResponseBody()) { out.write(bytes); }
            });
            server.start();
        }

        String url() { return "http://127.0.0.1:" + server.getAddress().getPort() + "/"; }
        public void close() { server.stop(0); }
    }
}
