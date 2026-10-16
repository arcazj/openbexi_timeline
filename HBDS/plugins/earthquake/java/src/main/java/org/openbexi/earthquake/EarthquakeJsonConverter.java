package org.openbexi.earthquake;

import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry;
import org.apache.commons.compress.archivers.sevenz.SevenZFile;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

class EarthquakeJsonConverter {
    private static final String API_BASE = System.getProperty("timeline.api", "https://earthquake.usgs.gov/fdsnws/event/1/");
    private static final Path OUTPUT_DIR = Path.of(System.getProperty("timeline.output", "/data/earthquake"));

    public static void main(String[] args) {
        try {
            Map<String, String> parsedArgs = parseArgs(args);

            if (parsedArgs.containsKey("all")) {
                new EarthquakeArchiveImporter(API_BASE, OUTPUT_DIR).importRange(
                        EarthquakeArchiveImporter.HISTORY_START, Instant.now().toEpochMilli() - 1);
            } else if (parsedArgs.containsKey("jsonFilePath")) {
                String jsonInput = getJsonInput(parsedArgs);
                Map<String, JSONArray> eventsByFilePath = processJson(jsonInput, OUTPUT_DIR);
                saveEventsToFile(eventsByFilePath);
            } else {
                new EarthquakeArchiveImporter(API_BASE, OUTPUT_DIR).importRange(
                        parseTime(parsedArgs.get("starttime"), "starttime="),
                        parseTime(parsedArgs.get("endtime"), "endtime="));
            }

            System.out.println("All events processed and saved to respective files.");
        } catch (Exception e) {
            System.err.println("Earthquake import failed: " + e.getMessage());
            System.exit(1);
        }
    }

    static Map<String, String> parseArgs(String[] args) {
        Map<String, String> parsedArgs = new HashMap<>();

        if (args.length == 0 || (args.length == 2 && "-url".equals(args[0]) && "default".equals(args[1]))) {
            // Default case: no arguments, use URL with current date range
            Instant end = Instant.ofEpochMilli(Instant.now().toEpochMilli() - 1);
            parsedArgs.put("starttime", end.minus(Duration.ofDays(2)).toString());
            parsedArgs.put("endtime", end.toString());
        } else if (args.length == 2 && "-jsonFilePath".equals(args[0])) {
            parsedArgs.put("jsonFilePath", args[1]);
        } else if (args.length == 3 && "-url".equals(args[0])) {
            parsedArgs.put("starttime", args[1]);
            parsedArgs.put("endtime", args[2]);
        } else if (args.length == 1 && "-all".equals(args[0])) {
            parsedArgs.put("all", "true");
        } else {
            printUsageAndExit();
        }

        return parsedArgs;
    }

    private static String getJsonInput(Map<String, String> parsedArgs) throws IOException {
        if (parsedArgs.containsKey("jsonFilePath")) {
            // Use existing code to read from jsonFilePath
            String jsonFilePath = parsedArgs.get("jsonFilePath");
            File jsonFile = new File(jsonFilePath);
            if (!jsonFile.exists()) {
                throw new FileNotFoundException("The file " + jsonFilePath + " does not exist.");
            }
            return readJsonFromFile(jsonFilePath);
        } else {
            throw new IllegalArgumentException("A JSON file path is required");
        }
    }

    static long parseTime(String value, String prefix) {
        String time = value.startsWith(prefix) ? value.substring(prefix.length()) : value;
        if (time.length() == 10) return LocalDate.parse(time).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
        try {
            return OffsetDateTime.parse(time).toInstant().toEpochMilli();
        } catch (java.time.format.DateTimeParseException e) {
            return LocalDateTime.parse(time).toInstant(ZoneOffset.UTC).toEpochMilli();
        }
    }

    static Map<String, JSONArray> processJson(String jsonInput, Path outputRoot) {
        JSONObject inputJson = new JSONObject(jsonInput);
        JSONArray features = inputJson.getJSONArray("features");

        Map<String, JSONArray> eventsByFilePath = new HashMap<>();

        // Loop through all items under features
        for (int i = 0; i < features.length(); i++) {
            JSONObject feature = features.getJSONObject(i);
            JSONObject properties = feature.getJSONObject("properties");

            // Convert epoch time to formatted date
            long epochTime = properties.getLong("time");
            String formattedDate = convertEpochToDate(epochTime);

            // Extract the year, month, day, and hour for file naming
            String[] dateParts = formattedDate.split(" ");
            String year = dateParts[5];
            String month = getMonthNumber(dateParts[1]);
            String day = dateParts[2];
            String hour = dateParts[3].split(":")[0];

            // Create the directory path dynamically
            String outputFilePath = outputRoot.resolve(year).resolve(month).resolve(day)
                    .resolve(String.format("earthquake_%s_%s_%s_%s.json", year, month, day, hour)).toString();

            // Create the event object
            JSONObject event = createEvent(properties, epochTime, formattedDate, feature.getString("id"));
            addIfNotNull(event.getJSONObject("data"), "geometry", feature.opt("geometry"));

            // Add the event to the appropriate file's event list
            eventsByFilePath.computeIfAbsent(outputFilePath, k -> new JSONArray()).put(event);
        }

        return eventsByFilePath;
    }

    private static JSONObject createEvent(JSONObject properties, long epochTime, String formattedDate, String sourceId) {
        JSONObject event = new JSONObject();
        event.put("id", UUID.nameUUIDFromBytes(sourceId.getBytes(StandardCharsets.UTF_8)).toString());
        event.put("start", formattedDate);
        event.put("end", "");
        event.put("namespace", "earthquake");

        // Create the data object, supporting any data type and null values
        JSONObject data = new JSONObject();
        data.put("eventId", sourceId);
        addIfNotNull(data, "description", "description_" + epochTime + " Session_" + epochTime);
        addIfNotNull(data, "title", properties.opt("title"));  // Can be String or null
        addIfNotNull(data, "mag", handleNonFiniteNumber(properties.optDouble("mag")));
        addIfNotNull(data, "place", properties.opt("place"));  // Can be String or null
        addIfNotNull(data, "time", epochTime);
        addIfNotNull(data, "updated", properties.opt("updated"));
        addIfNotNull(data, "tz", properties.opt("tz"));
        addIfNotNull(data, "url", properties.opt("url"));
        addIfNotNull(data, "detail", properties.opt("detail"));
        addIfNotNull(data, "felt", properties.opt("felt"));
        addIfNotNull(data, "cdi", properties.opt("cdi"));
        addIfNotNull(data, "mmi", properties.opt("mmi"));
        addIfNotNull(data, "alert", properties.opt("alert"));
        addIfNotNull(data, "status", properties.opt("status"));
        addIfNotNull(data, "tsunami", properties.opt("tsunami"));
        addIfNotNull(data, "sig", properties.opt("sig"));
        addIfNotNull(data, "net", properties.opt("net"));
        addIfNotNull(data, "code", properties.opt("code"));
        addIfNotNull(data, "ids", properties.opt("ids"));
        addIfNotNull(data, "sources", properties.opt("sources"));
        addIfNotNull(data, "types", properties.opt("types"));
        addIfNotNull(data, "nst", properties.opt("nst"));
        addIfNotNull(data, "dmin", handleNonFiniteNumber(properties.optDouble("dmin")));
        addIfNotNull(data, "rms", handleNonFiniteNumber(properties.optDouble("rms")));
        addIfNotNull(data, "gap", properties.opt("gap"));
        addIfNotNull(data, "magType", properties.opt("magType"));
        addIfNotNull(data, "type", properties.opt("type"));

        event.put("data", data);

        // Determine the icon based on the magnitude, handle nulls safely
        String iconPath = determineIconPath(data.optDouble("mag"));
        JSONObject render = new JSONObject();
        render.put("image", iconPath);
        render.put("color", "#731616");

        event.put("render", render);

        return event;
    }

    static void saveEventsToFile(Map<String, JSONArray> eventsByFilePath) throws IOException {
        for (Map.Entry<String, JSONArray> entry : eventsByFilePath.entrySet()) {
            String filePath = entry.getKey();
            JSONArray events = entry.getValue();

            // Create the final JSON structure
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
                    if (previous.getJSONObject("data").optLong("updated", Long.MIN_VALUE)
                            > event.getJSONObject("data").optLong("updated", Long.MIN_VALUE)) continue;
                    event.put("id", previous.getString("id"));
                }
                merged.put(key, event);
            }
            events = new JSONArray(merged.values());
            outputJson.put("dateTimeFormat", "iso8601");
            outputJson.put("events", events);

            // Save the JSON to the appropriate file
            saveJsonToFile(filePath, outputJson);

            // Print the number of events saved
            System.out.println("Event saved to: " + filePath + " with " + events.length() + " events.");
        }
    }

    private static String eventKey(JSONObject event) {
        JSONObject data = event.getJSONObject("data");
        String sourceId = data.optString("eventId", "");
        if (sourceId.isEmpty() && !data.optString("net", "").isEmpty() && !data.optString("code", "").isEmpty()) {
            sourceId = data.getString("net") + data.getString("code");
        }
        return sourceId.isEmpty() ? "id:" + event.getString("id") : "event:" + sourceId;
    }

    // Function to print usage instructions and exit
    private static void printUsageAndExit() {
        System.out.println("Usage:");
        System.out.println("  -jsonFilePath <jsonFilePath>");
        System.out.println("    Use an existing JSON file to process earthquake data.");
        System.out.println("  -url starttime=<yyyy-mm-dd> endtime=<yyyy-mm-dd>");
        System.out.println("    Fetch earthquake data from the USGS website for the specified date range.");
        System.out.println("  -url default");
        System.out.println("    Fetch earthquake data from the USGS website for the last 2 days.");
        System.out.println("  -all");
        System.out.println("    Import USGS history through now, skipping previously completed ranges.");
        System.out.println("If no arguments are provided, the default URL mode will be used to fetch data for the last 2 days.");
        System.exit(1);
    }

    // Function to convert epoch time to formatted date string
    private static String convertEpochToDate(long epochTime) {
        return DateTimeFormatter.ofPattern("EEE MMM dd HH:mm:ss 'UTC' uuuu", Locale.US)
                .withZone(ZoneOffset.UTC).format(Instant.ofEpochMilli(epochTime));
    }

    // Function to read JSON content from a file
    private static String readJsonFromFile(String filePath) throws IOException {
        return Files.readString(Path.of(filePath), StandardCharsets.UTF_8);
    }

    // Function to extract JSON content from a .7z file
    private static String extractJsonFrom7z(String filePath) throws IOException {
        File file = new File(filePath);
        SevenZFile sevenZFile = new SevenZFile(file);
        SevenZArchiveEntry entry = sevenZFile.getNextEntry();

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buffer = new byte[1024];
        int len;

        while ((len = sevenZFile.read(buffer)) > 0) {
            baos.write(buffer, 0, len);
        }

        sevenZFile.close();

        return baos.toString(StandardCharsets.UTF_8);
    }

    // Function to fetch JSON content from a URL
    static String fetchJsonFromUrl(String urlString) throws IOException {
        return fetchJsonFromUrl(urlString, 60_000, 1_000);
    }

    static String fetchJsonFromUrl(String urlString, int readTimeoutMs, long retryDelayMs) throws IOException {
        for (int attempt = 1; ; attempt++) {
            try {
                return requestOnce(urlString, readTimeoutMs);
            } catch (SocketTimeoutException | RetryableRequestException e) {
                if (attempt == 3) {
                    throw new RetryableRequestException("USGS request failed after " + attempt
                            + " attempts: " + urlString + " (" + e.getMessage() + ")", e);
                }
                long delay = retryDelayMs * attempt;
                System.err.println("USGS request failed (attempt " + attempt + "/3): " + urlString
                        + " (" + e.getMessage() + "). Retrying in " + delay + " ms.");
                try {
                    Thread.sleep(delay);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Earthquake request interrupted: " + urlString, interrupted);
                }
            }
        }
    }

    static final class RetryableRequestException extends IOException {
        RetryableRequestException(String message, Throwable cause) { super(message, cause); }
    }

    private static String requestOnce(String urlString, int readTimeoutMs) throws IOException {
        URL url = new URL(urlString);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", "application/json");
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(readTimeoutMs);
        try {
            int responseCode = connection.getResponseCode();
            if (responseCode == HttpURLConnection.HTTP_NO_CONTENT) {
                return new JSONObject().put("features", new JSONArray()).toString();
            }
            if (responseCode != HttpURLConnection.HTTP_OK) {
                String message = "Failed to fetch " + urlString + ". Response code: " + responseCode;
                if (responseCode == 408 || responseCode == 429 || responseCode == 500
                        || responseCode == 502 || responseCode == 503 || responseCode == 504) {
                    throw new RetryableRequestException(message, null);
                }
                throw new IOException(message);
            }
            try (InputStream in = connection.getInputStream()) {
                return new String(in.readAllBytes(), StandardCharsets.UTF_8);
            }
        } finally {
            connection.disconnect();
        }
    }

    // Function to save JSON content to a file
    static void saveJsonToFile(String filePath, JSONObject jsonObject) throws IOException {
        Path path = Path.of(filePath);
        Files.createDirectories(path.getParent());
        Path temporary = Files.createTempFile(path.getParent(), "earthquake-", ".tmp");
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

    // Function to handle non-finite numbers
    private static Double handleNonFiniteNumber(double value) {
        if (Double.isNaN(value) || Double.isInfinite(value)) {
            return null;  // Return null if the number is non-finite
        }
        return value;
    }

    // Function to add a value to a JSONObject if the value is not null
    private static void addIfNotNull(JSONObject jsonObject, String key, Object value) {
        if (value != null) {
            jsonObject.put(key, value);
        }
    }

    // Function to determine the icon path based on the magnitude value
    private static String determineIconPath(Double mag) {
        if (mag == null) return "icon/ob_earthquake_mag_1_black.png"; // Default if mag is null

        if (mag > 9) {
            return "icon/ob_red_flag.png";
        } else if (mag > 8) {
            return "icon/ob_red_flag.png";
        } else if (mag > 7) {
            return "icon/ob_red_flag.png";
        } else if (mag > 6) {
            return "icon/ob_red_flag.png";
        } else if (mag > 5) {
            return "icon/ob_yellow_flag.png";
        } else if (mag > 4) {
            return "icon/ob_yellow_flag.png";
        } else if (mag > 3) {
            return "icon/ob_yellow_flag.png";
        } else if (mag > 2) {
            return "icon/ob_green_flag.png";
        } else if (mag > 0) {
            return "icon/ob_green_flag.png";
        } else {
            return "icon/ob_green_flag.png"; // Default icon for very low or negative magnitudes
        }
    }

    // Function to get the numeric month from the month abbreviation
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
