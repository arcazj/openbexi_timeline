package org.openbexi.volcano;

// USGS HANS recent feed and paginated historical archive:
// https://volcanoes.usgs.gov/hans-public/api/notice/getNewestOrRecent
// https://volcanoes.usgs.gov/hans-public/api/search/

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.text.SimpleDateFormat;
import java.time.Instant;
import java.util.*;

public class VolcanoJsonConverter {
    private static final String API_BASE = System.getProperty("timeline.api", "https://volcanoes.usgs.gov/hans-public/api/");
    private static final Path OUTPUT_DIR = Path.of(System.getProperty("timeline.output", "/data/volcano"));
    private static final String CHECKPOINT_FILE = ".archive-progress.json";

    public static void main(String[] args) {
        try {
            Map<String, String> parsedArgs = parseArgs(args);

            if (parsedArgs.containsKey("jsonFilePath")) {
                saveEventsToFile(processJson(Files.readString(Path.of(parsedArgs.get("jsonFilePath"))), OUTPUT_DIR));
            } else if (parsedArgs.containsKey("NewestOrRecent")) {
                String jsonInput = fetchJsonFromUrl(API_BASE + "notice/getNewestOrRecent");
                Map<String, JSONArray> eventsByFilePath = processJson(jsonInput, OUTPUT_DIR);
                saveEventsToFile(eventsByFilePath);
            } else if (parsedArgs.containsKey("all")) {
                processAllNotices(API_BASE, OUTPUT_DIR);
            } else {
                printUsageAndExit();
            }

            System.out.println("All events processed and saved to respective files.");
        } catch (Exception e) {
            System.err.println("Volcano import failed: " + e.getMessage());
            System.exit(1);
        }
    }

    private static Map<String, String> parseArgs(String[] args) {
        Map<String, String> parsedArgs = new HashMap<>();

        if (args.length == 2 && "-jsonFilePath".equals(args[0])) {
            parsedArgs.put("jsonFilePath", args[1]);
        } else if (args.length == 1 && "-NewestOrRecent".equals(args[0])) {
            parsedArgs.put("NewestOrRecent", "true");
        } else if (args.length == 1 && "-all".equals(args[0])) {
            parsedArgs.put("all", "true");
        } else {
            printUsageAndExit();
        }
        return parsedArgs;
    }

    // API contract: https://volcanoes.usgs.gov/hans-public/api/search/
    static void processAllNotices(String apiBase, Path outputDir) throws IOException {
        // Leave the current second open for notices still being published.
        processAllNotices(apiBase, outputDir, Instant.now().getEpochSecond() - 1);
    }

    static void processAllNotices(String apiBase, Path outputDir, long through) throws IOException {
        Path checkpoint = outputDir.resolve(CHECKPOINT_FILE);
        JSONObject progress = Files.exists(checkpoint)
                ? new JSONObject(Files.readString(checkpoint, StandardCharsets.UTF_8))
                : new JSONObject().put("version", 1).put("apiBase", apiBase).put("completedThrough", -1L);
        if (progress.getInt("version") != 1 || !apiBase.equals(progress.getString("apiBase"))) {
            throw new IOException("Incompatible archive checkpoint: " + checkpoint);
        }
        if (!progress.has("pending") && progress.getLong("completedThrough") >= through) {
            System.out.println("Archive already checked through " + through + "; no queries needed.");
            return;
        }
        while (progress.has("pending") || progress.getLong("completedThrough") < through) {
            JSONObject pending = progress.optJSONObject("pending");
            if (pending == null) {
                long completedThrough = progress.getLong("completedThrough");
                // HANS date bounds are inclusive. Exclude every second already imported.
                JSONObject query = new JSONObject()
                        .put("obsAbbr", "").put("noticeTypeCd", "").put("volcCd", "")
                        .put("startUnixtime", completedThrough < 0 ? "" : completedThrough + 1)
                        .put("endUnixtime", through).put("searchText", "").put("pageIndex", 0);
                long expected = new JSONObject(requestJson(apiBase + "search/preflight", query))
                        .getLong("noticeTotal");
                if (expected < 0) throw new IOException("Invalid archive notice count: " + expected);
                pending = new JSONObject().put("query", query).put("expected", expected)
                        .put("seen", new JSONArray());
                progress.put("pending", pending);
                saveJsonToFile(checkpoint.toString(), progress);
            }
            importPendingPages(apiBase, outputDir, checkpoint, progress, pending);
            progress.put("completedThrough", pending.getJSONObject("query").getLong("endUnixtime"));
            progress.remove("pending");
            saveJsonToFile(checkpoint.toString(), progress);
        }
    }

    private static void importPendingPages(String apiBase, Path outputDir, Path checkpoint,
                                           JSONObject progress, JSONObject pending) throws IOException {
        JSONObject query = pending.getJSONObject("query");
        long expected = pending.getLong("expected");
        if (expected == 0) return; // Preflight already proves this interval is empty.
        Set<String> seen = new HashSet<>();
        JSONArray savedIdentifiers = pending.getJSONArray("seen");
        for (int i = 0; i < savedIdentifiers.length(); i++) seen.add(savedIdentifiers.getString(i));
        for (int page = query.getInt("pageIndex"); ; page++) {
            JSONObject response = new JSONObject(requestJson(apiBase + "search/search", query));
            JSONArray records = response.getJSONArray("noticeData");
            // Search noticeTotal is this page's count, not the archive total.
            if (records.isEmpty()) {
                if (seen.size() < expected) {
                    throw new IOException("Incomplete archive: received " + seen.size()
                            + " of " + expected + " notices");
                }
                break;
            }
            JSONArray notices = new JSONArray();
            for (int i = 0; i < records.length(); i++) {
                JSONObject record = records.getJSONObject(i);
                if (seen.add(record.getString("noticeIdentifier"))) {
                    notices.put(archiveNotice(record));
                }
            }
            if (notices.isEmpty()) {
                throw new IOException("Archive pagination made no progress at page " + page);
            }
            saveEventsToFile(processJson(notices.toString(), outputDir));
            // Advance only after all daily files for this page were saved successfully.
            query.put("pageIndex", page + 1);
            pending.put("seen", new JSONArray(seen));
            saveJsonToFile(checkpoint.toString(), progress);
            System.out.println("Archive page " + page + ": " + seen.size() + " / " + expected + " notices");
        }
    }

    private static JSONObject archiveNotice(JSONObject record) {
        // Search returns the complete notice HTML, but uses different metadata names
        // and does not supply the structured sections of the recent-notices feed.
        return new JSONObject()
                .put("noticeIdentifier", record.getString("noticeIdentifier"))
                .put("sent_unixtime", record.getLong("sentUnixtime"))
                .put("notice_url", record.getString("permLink"))
                .put("noticeType", record.getString("noticeTypeCd"))
                .put("obs", record.getString("obsAbbr"))
                .put("volcCds", record.opt("volcCds"))
                .put("noticeHtml", record.getString("noticeHtml"));
    }

    static Map<String, JSONArray> processJson(String jsonInput, Path outputRoot) {
        JSONArray notices = new JSONArray(jsonInput);

        Map<String, JSONArray> eventsByFilePath = new HashMap<>();

        for (int i = 0; i < notices.length(); i++) {
            JSONObject notice = notices.getJSONObject(i);
            long epochTime = notice.getLong("sent_unixtime");
            String formattedDate = convertEpochToDate(epochTime);

            String[] dateParts = formattedDate.split(" ");
            String year = dateParts[5];
            String month = getMonthNumber(dateParts[1]);
            String day = dateParts[2];

            String outputFilePath = outputRoot.resolve(year).resolve(month).resolve(day)
                    .resolve(String.format("volcano_%s_%s_%s_00.json", year, month, day)).toString();
            JSONObject event = createEvent(notice, formattedDate);

            eventsByFilePath.computeIfAbsent(outputFilePath, k -> new JSONArray()).put(event);
        }

        return eventsByFilePath;
    }

    private static JSONObject createEvent(JSONObject notice, String formattedDate) {
        JSONObject event = new JSONObject();
        event.put("id", UUID.nameUUIDFromBytes(notice.getString("noticeIdentifier")
                .getBytes(StandardCharsets.UTF_8)).toString());
        event.put("start", formattedDate);
        event.put("end", "");
        event.put("namespace", "volcano");

        JSONObject data = new JSONObject();
        addIfNotNull(data, "description",  notice.opt("notice_url"));
        addIfNotNull(data, "noticeIdentifier", notice.opt("noticeIdentifier"));
        addIfNotNull(data, "noticeType", notice.opt("noticeType"));
        addIfNotNull(data, "noticeCategory", notice.opt("noticeCategory"));
        addIfNotNull(data, "obs", notice.opt("obs"));
        addIfNotNull(data, "obsFullname", notice.opt("obsFullname"));
        addIfNotNull(data, "volcanoes", notice.opt("volcanoes"));
        addIfNotNull(data, "notice_data", notice.opt("notice_data"));
        addIfNotNull(data, "noticeHtml", notice.opt("noticeHtml"));
        addIfNotNull(data, "volcCds", notice.opt("volcCds"));
        data.put("type", "volcano");

        JSONArray sections = notice.optJSONArray("sections");
        if (sections != null && !sections.isEmpty()) {
            JSONObject section = sections.getJSONObject(0);
            addIfNotNull(data, "synopsis", section.opt("synopsis"));
            addIfNotNull(data, "colorCode", section.opt("colorCode"));
            addIfNotNull(data, "alertLevel", section.opt("alertLevel"));
            addIfNotNull(data, "volcanoCd", section.opt("volcanoCd"));
            addIfNotNull(data, "volcanoName", section.opt("volcanoName"));
            addIfNotNull(data, "vnum", section.opt("vnum"));

            String colorCode = section.optString("colorCode", "UNKNOWN");
            String volcanoName = section.optString("volcanoName", "Unknown Volcano");
            addIfNotNull(data, "title", colorCode + " - " + volcanoName);
            addIfNotNull(data, "type", "volcano");

            String iconPath = determineIconPath(colorCode);
            JSONObject render = new JSONObject();
            render.put("image", iconPath);
            render.put("color", "#731616");

            event.put("render", render);
        } else {
            data.put("title", notice.optString("obs", "USGS").toUpperCase(Locale.ROOT)
                    + " - " + notice.optString("noticeType", "Volcano notice"));
            event.put("render", new JSONObject().put("image", determineIconPath("UNKNOWN"))
                    .put("color", "#731616"));
        }

        event.put("data", data);

        return event;
    }

    private static String determineIconPath(String colorCode) {
        return switch (colorCode.toUpperCase()) {
            case "RED" -> "icon/ob_volcano_very_active.png";
            case "ORANGE" -> "icon/ob_volcano_active.png";
            case "YELLOW" -> "icon/ob_volcano.png";
            default -> "icon/ob_volcano_no_active.png";
        };
    }

    static void saveEventsToFile(Map<String, JSONArray> eventsByFilePath) throws IOException {
        for (Map.Entry<String, JSONArray> entry : eventsByFilePath.entrySet()) {
            String filePath = entry.getKey();
            JSONArray events = entry.getValue();

            Path path = Path.of(filePath);
            JSONObject outputJson = Files.exists(path)
                    ? new JSONObject(Files.readString(path, StandardCharsets.UTF_8)) : new JSONObject();
            Map<String, JSONObject> merged = new LinkedHashMap<>();
            JSONArray existing = outputJson.optJSONArray("events");
            if (existing != null) {
                for (int i = 0; i < existing.length(); i++) {
                    JSONObject event = existing.getJSONObject(i);
                    merged.put(eventKey(event), event);
                }
            }
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.getJSONObject(i);
                String key = eventKey(event);
                JSONObject previous = merged.get(key);
                if (previous != null) {
                    event.put("id", previous.getString("id"));
                    JSONObject data = event.getJSONObject("data");
                    JSONObject oldData = previous.getJSONObject("data");
                    // Keep structured recent-feed metadata when backfilling search results.
                    if (!data.has("colorCode") && oldData.has("colorCode")) {
                        data.put("title", oldData.get("title"));
                        data.put("noticeType", oldData.opt("noticeType"));
                        event.put("render", previous.get("render"));
                    }
                    for (String field : oldData.keySet()) {
                        if (!data.has(field)) data.put(field, oldData.get(field));
                    }
                }
                merged.put(key, event);
            }
            events = new JSONArray(merged.values());
            outputJson.put("dateTimeFormat", "iso8601");
            outputJson.put("events", events);

            saveJsonToFile(filePath, outputJson);

            System.out.println("Event saved to: " + filePath + " with " + events.length() + " events.");
        }
    }

    private static String eventKey(JSONObject event) {
        JSONObject data = event.optJSONObject("data");
        String identifier = data == null ? "" : data.optString("noticeIdentifier", "");
        return identifier.isEmpty() ? "id:" + event.getString("id") : "notice:" + identifier;
    }

    private static void printUsageAndExit() {
        System.out.println("Usage:");
        System.out.println("  -NewestOrRecent");
        System.out.println("    Fetch the newest or most recent volcano notices.");
        System.out.println("  -all");
        System.out.println("    Import missing USGS HANS history, resume interrupted pages, and fetch newer notices.");
        System.exit(1);
    }

    private static String convertEpochToDate(long epochTime) {
        Date date = new Date(epochTime * 1000);
        SimpleDateFormat sdf = new SimpleDateFormat("EEE MMM dd HH:mm:ss 'UTC' yyyy", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(date);
    }

    private static String fetchJsonFromUrl(String urlString) throws IOException {
        return requestJson(urlString, null);
    }

    private static String requestJson(String urlString, JSONObject body) throws IOException {
        URL url = new URL(urlString);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(60_000);
        connection.setRequestMethod(body == null ? "GET" : "POST");
        connection.setRequestProperty("Accept", "application/json");
        try {
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
            }
            int responseCode = connection.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                throw new IOException("Failed to fetch " + urlString + ". Response code: " + responseCode);
            }
            try (BufferedReader in = new BufferedReader(new InputStreamReader(
                    connection.getInputStream(), StandardCharsets.UTF_8))) {
                StringBuilder content = new StringBuilder();
                String inputLine;
                while ((inputLine = in.readLine()) != null) {
                    content.append(inputLine);
                }
                return content.toString();
            }
        } finally {
            connection.disconnect();
        }
    }

    private static void saveJsonToFile(String filePath, JSONObject jsonObject) throws IOException {
        Path path = Path.of(filePath);
        Files.createDirectories(path.getParent());
        Path temporary = Files.createTempFile(path.getParent(), "volcano-", ".tmp");
        try {
            Files.writeString(temporary, jsonObject.toString(4), StandardCharsets.UTF_8);
            try {
                Files.move(temporary, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static void addIfNotNull(JSONObject jsonObject, String key, Object value) {
        if (value != null) {
            jsonObject.put(key, value);
        }
    }

    private static String getMonthNumber(String monthName) {
        return switch (monthName.toLowerCase()) {
            case "jan" -> "01";
            case "feb" -> "02";
            case "mar" -> "03";
            case "apr" -> "04";
            case "may" -> "05";
            case "jun" -> "06";
            case "jul" -> "07";
            case "aug" -> "08";
            case "sep" -> "09";
            case "oct" -> "10";
            case "nov" -> "11";
            case "dec" -> "12";
            default -> throw new IllegalArgumentException("Invalid month: " + monthName);
        };
    }
}
