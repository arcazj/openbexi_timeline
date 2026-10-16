package org.openbexi.volcano;

import com.sun.net.httpserver.HttpServer;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.TimeZone;

/** Standalone regression tests; uses only the application's JSON dependency and JDK 17. */
public class VolcanoJsonConverterTest {
    private static final long MIDNIGHT = Instant.parse("2006-11-21T00:01:00Z").getEpochSecond();

    public static void main(String[] args) throws Exception {
        TimeZone original = TimeZone.getDefault();
        Path root = Files.createTempDirectory("volcano-regression-");
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"));
            paginationAndMerging(root.resolve("archive"));
            incrementalQueries(root.resolve("incremental"));
            resumeAfterFailure(root.resolve("resume"));
            failures(root.resolve("failures"));
            System.out.println("All volcano regression tests passed.");
        } finally {
            TimeZone.setDefault(original);
            try (var paths = Files.walk(root)) {
                for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) {
                    Files.delete(path);
                }
            }
        }
    }

    private static void paginationAndMerging(Path root) throws Exception {
        JSONArray first = new JSONArray().put(record("a", MIDNIGHT)).put(record("b", MIDNIGHT + 1));
        JSONArray second = new JSONArray().put(record("b", MIDNIGHT + 1)).put(record("c", MIDNIGHT + 2));
        JSONArray third = new JSONArray().put(record("old", Instant.parse("2006-01-01T00:00:00Z").getEpochSecond()));
        try (ArchiveServer server = new ArchiveServer(4, List.of(first, second, third), false, false)) {
            // Seed an older converter's random ID and rich recent-feed metadata.
            JSONObject recent = recentNotice("a", MIDNIGHT);
            var files = VolcanoJsonConverter.processJson(new JSONArray().put(recent).toString(), root);
            files.values().iterator().next().getJSONObject(0).put("id", "legacy-id");
            VolcanoJsonConverter.saveEventsToFile(files);
            VolcanoJsonConverter.processAllNotices(server.url(), root, MIDNIGHT + 10);
            check(server.pages.equals(List.of(0, 1, 2, 3)), "Must fetch every page through empty page");
            JSONArray events = readDay(root);
            check(events.length() == 3, "Notices across pages/volcanoes must share the daily file");
            JSONObject a = find(events, "a");
            check(a.getString("id").equals("legacy-id"), "Preserve existing IDs");
            check(a.getString("start").equals("Tue Nov 21 00:01:00 UTC 2006"), "Use UTC, regardless of host timezone");
            check(a.getJSONObject("data").getString("title").equals("ORANGE - Kīlauea"), "Keep rich metadata");
            check(a.getJSONObject("data").getString("noticeHtml").contains("Kīlauea"), "Keep archive text in UTF-8");
            check(Files.exists(root.resolve("2006/01/01/volcano_2006_01_01_00.json")), "Import old dates");
            String bId = find(events, "b").getString("id");
            VolcanoJsonConverter.processAllNotices(server.url(), root, MIDNIGHT + 10);
            check(server.preflights == 1 && server.pages.equals(List.of(0, 1, 2, 3)),
                    "Completed interval must make no further HTTP requests");
            check(readDay(root).length() == 3, "Reruns must not duplicate notices");
            check(find(readDay(root), "b").getString("id").equals(bId), "IDs must remain stable");

            VolcanoJsonConverter.saveEventsToFile(VolcanoJsonConverter.processJson(
                    new JSONArray().put(recentNotice("c", MIDNIGHT + 2))
                            .put(recentNotice("new", MIDNIGHT + 3)).toString(), root));
            check(readDay(root).length() == 4, "Recent imports must preserve history");
            JSONObject c = find(readDay(root), "c").getJSONObject("data");
            check(c.has("noticeHtml") && c.has("colorCode"), "Recent metadata must enrich archived notices");
        }
    }

    private static void incrementalQueries(Path root) throws Exception {
        try (ArchiveServer server = new ArchiveServer(1,
                List.of(new JSONArray().put(record("initial", MIDNIGHT))), false, false)) {
            VolcanoJsonConverter.processAllNotices(server.url(), root, MIDNIGHT);
            server.expectedStart = MIDNIGHT + 1;
            // Include two notices in the very first second after the checkpoint.
            server.total = 2;
            server.responses = List.of(new JSONArray().put(record("next-a", MIDNIGHT + 1))
                    .put(record("next-b", MIDNIGHT + 1)));
            VolcanoJsonConverter.processAllNotices(server.url(), root, MIDNIGHT + 5);
            check(readDay(root).length() == 3, "New windows must include all notices at their lower bound");
            check(server.preflights == 2, "Only one preflight for each new interval");
            check(checkpoint(root).getLong("completedThrough") == MIDNIGHT + 5, "Advance completed interval");

            int pagesBefore = server.pages.size();
            server.expectedStart = MIDNIGHT + 6;
            server.total = 0;
            server.responses = List.of();
            VolcanoJsonConverter.processAllNotices(server.url(), root, MIDNIGHT + 10);
            check(server.pages.size() == pagesBefore, "No page query when preflight reports no new records");
            VolcanoJsonConverter.processAllNotices(server.url(), root, MIDNIGHT + 10);
            check(server.preflights == 3, "Empty completed intervals must also be cached");
            check(checkpoint(root).getLong("completedThrough") == MIDNIGHT + 10, "Remember empty intervals");
        }
    }

    private static void resumeAfterFailure(Path root) throws Exception {
        try (ArchiveServer server = new ArchiveServer(2, List.of(
                new JSONArray().put(record("a", MIDNIGHT)),
                new JSONArray().put(record("b", MIDNIGHT + 1))), false, false)) {
            server.failPage = 1;
            try {
                VolcanoJsonConverter.processAllNotices(server.url(), root, MIDNIGHT + 10);
                throw new AssertionError("Expected second-page failure");
            } catch (IOException e) {
                check(e.getMessage().contains("503"), "Expected HTTP failure");
            }
            JSONObject saved = checkpoint(root);
            check(saved.getLong("completedThrough") == -1, "Failed interval must not be marked complete");
            check(saved.getJSONObject("pending").getJSONObject("query").getInt("pageIndex") == 1,
                    "Checkpoint must point to first unsaved page");
            check(readDay(root).length() == 1, "Saved page must remain on disk");
            server.failPage = -1;
            VolcanoJsonConverter.processAllNotices(server.url(), root, MIDNIGHT + 10);
            check(server.preflights == 1, "Resume must reuse the saved preflight and cutoff");
            check(server.pages.equals(List.of(0, 1, 1, 2)), "Resume must not request saved page zero");
            check(readDay(root).length() == 2, "Resume must save remaining records");
            check(!checkpoint(root).has("pending"), "Clear pending state only on completion");
        }
    }

    private static JSONObject checkpoint(Path root) throws IOException {
        return new JSONObject(Files.readString(root.resolve(".archive-progress.json")));
    }

    private static void failures(Path root) throws Exception {
        JSONArray one = new JSONArray().put(record("a", MIDNIGHT));
        try (ArchiveServer server = new ArchiveServer(2, List.of(one), false, false)) {
            expectFailure(server, root.resolve("truncated"), "Incomplete archive");
        }
        try (ArchiveServer server = new ArchiveServer(2, List.of(one), true, false)) {
            expectFailure(server, root.resolve("repeat"), "no progress");
        }
        try (ArchiveServer server = new ArchiveServer(2, List.of(one), false, true)) {
            expectFailure(server, root.resolve("http"), "503");
        }
        try (ArchiveServer server = new ArchiveServer(0, List.of(), false, false)) {
            VolcanoJsonConverter.processAllNotices(server.url(), root.resolve("empty"));
            check(server.pages.isEmpty(), "Empty archives must not query pages");
            check(!Files.exists(root.resolve("empty/2006")), "Empty archives must not create events");
        }
    }

    private static void expectFailure(ArchiveServer server, Path root, String message) throws Exception {
        try {
            VolcanoJsonConverter.processAllNotices(server.url(), root);
            throw new AssertionError("Expected failure: " + message);
        } catch (IOException e) {
            check(e.getMessage().contains(message), "Unexpected failure: " + e.getMessage());
        }
    }

    private static JSONArray readDay(Path root) throws IOException {
        return new JSONObject(Files.readString(root.resolve("2006/11/21/volcano_2006_11_21_00.json")))
                .getJSONArray("events");
    }

    private static JSONObject find(JSONArray events, String id) {
        for (int i = 0; i < events.length(); i++) {
            JSONObject event = events.getJSONObject(i);
            if (event.getJSONObject("data").getString("noticeIdentifier").equals(id)) return event;
        }
        throw new AssertionError("Missing notice " + id);
    }

    private static JSONObject record(String id, long time) {
        return new JSONObject().put("noticeIdentifier", id).put("sentUnixtime", time)
                .put("noticeTypeCd", "DU").put("obsAbbr", "hvo").put("volcCds", "hi3")
                .put("permLink", "https://example.test/notice/" + id).put("noticeHtml", "<p>Kīlauea</p>");
    }

    private static JSONObject recentNotice(String id, long time) {
        return new JSONObject().put("noticeIdentifier", id).put("sent_unixtime", time)
                .put("noticeType", "Daily Update").put("obs", "hvo")
                .put("sections", new JSONArray().put(new JSONObject()
                        .put("colorCode", "ORANGE").put("volcanoName", "Kīlauea")));
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static class ArchiveServer implements AutoCloseable {
        final HttpServer server;
        final List<Integer> pages = new ArrayList<>();
        List<JSONArray> responses;
        int total;
        int preflights;
        int failPage = -1;
        Object expectedStart = "";
        long cutoff;

        ArchiveServer(int total, List<JSONArray> responses, boolean repeat, boolean fail) throws IOException {
            this.total = total;
            this.responses = responses;
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/search/", exchange -> {
                JSONObject query = new JSONObject(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                JSONObject response = new JSONObject();
                int status = 200;
                try {
                    check(exchange.getRequestMethod().equals("POST"), "Archive queries require POST");
                    check(query.get("startUnixtime").toString().equals(expectedStart.toString()),
                            "Query must skip completed date ranges");
                    for (String filter : List.of("obsAbbr", "noticeTypeCd", "volcCd", "searchText")) {
                        check(query.getString(filter).isEmpty(), "No archive filter: " + filter);
                    }
                    if (exchange.getRequestURI().getPath().endsWith("preflight")) {
                        cutoff = query.getLong("endUnixtime");
                        preflights++;
                        response.put("noticeTotal", this.total);
                    } else {
                        check(query.getLong("endUnixtime") == cutoff, "Freeze upper date for pagination");
                        int page = query.getInt("pageIndex");
                        pages.add(page);
                        JSONArray records = repeat ? this.responses.get(0)
                                : page < this.responses.size() ? this.responses.get(page) : new JSONArray();
                        response.put("noticeTotal", records.length()).put("noticeData", records);
                        if (fail || page == failPage) status = 503;
                    }
                } catch (AssertionError e) {
                    status = 400;
                    response.put("error", e.getMessage());
                }
                byte[] bytes = response.toString().getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(status, bytes.length);
                try (var out = exchange.getResponseBody()) { out.write(bytes); }
            });
            server.start();
        }

        String url() { return "http://127.0.0.1:" + server.getAddress().getPort() + "/"; }

        public void close() { server.stop(0); }
    }
}
