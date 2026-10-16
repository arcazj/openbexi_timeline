package org.openbexi.earthquake;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Imports only unchecked UTC intervals, splitting large queries below the USGS result limit. */
final class EarthquakeArchiveImporter {
    static final long HISTORY_START = Instant.parse("0001-01-01T00:00:00Z").toEpochMilli();
    static final int QUERY_LIMIT = 10_000;
    private static final long MAX_RANGE_MILLIS = Duration.ofDays(3660).toMillis();
    private static final long INITIAL_RANGE_MILLIS = Duration.ofDays(7).toMillis();
    private static final long MIN_RETRY_RANGE_MILLIS = Duration.ofDays(1).toMillis();
    private final String apiBase;
    private final Path outputRoot;
    private final Path checkpoint;
    private final Fetcher fetcher;
    private long maxRequestWindow = MAX_RANGE_MILLIS;
    private List<Interval> completed = new ArrayList<>();

    private record Interval(long start, long end) {}

    @FunctionalInterface
    interface Fetcher { String fetch(String url) throws IOException; }

    EarthquakeArchiveImporter(String apiBase, Path outputRoot) throws IOException {
        this(apiBase, outputRoot, EarthquakeJsonConverter::fetchJsonFromUrl);
    }

    EarthquakeArchiveImporter(String apiBase, Path outputRoot, Fetcher fetcher) throws IOException {
        this.apiBase = apiBase;
        this.outputRoot = outputRoot;
        this.fetcher = fetcher;
        checkpoint = outputRoot.resolve(".import-progress.json");
        if (Files.exists(checkpoint)) {
            JSONObject state = new JSONObject(Files.readString(checkpoint, StandardCharsets.UTF_8));
            if (state.getInt("version") != 1 || !apiBase.equals(state.getString("apiBase"))) {
                throw new IOException("Incompatible earthquake checkpoint: " + checkpoint);
            }
            JSONArray ranges = state.getJSONArray("completed");
            for (int i = 0; i < ranges.length(); i++) {
                JSONObject range = ranges.getJSONObject(i);
                long start = range.getLong("start"), end = range.getLong("end");
                if (start > end) throw new IOException("Invalid earthquake checkpoint interval");
                completed.add(new Interval(start, end));
            }
            completed = merge(completed);
        }
    }

    void importRange(long start, long end) throws IOException {
        if (start > end) throw new IllegalArgumentException("starttime must be on or before endtime");
        // Future intervals cannot be complete: events may still occur in them.
        end = Math.min(end, Instant.now().toEpochMilli() - 1);
        if (start > end) return;
        List<Interval> missing = new ArrayList<>();
        long cursor = start;
        for (Interval range : completed) {
            if (range.end < cursor) continue;
            if (range.start > end) break;
            if (range.start > cursor) missing.add(new Interval(cursor, range.start - 1));
            if (range.end >= end) {
                // This endpoint is covered, so do not add an extra one-millisecond query.
                importMissing(missing);
                return;
            }
            cursor = range.end + 1;
        }
        missing.add(new Interval(cursor, end));
        importMissing(missing);
    }

    private void importMissing(List<Interval> missing) throws IOException {
        if (missing.isEmpty()) System.out.println("Earthquake range already imported; no queries needed.");
        // Most recent data is available first, including on the first historical import.
        long window = INITIAL_RANGE_MILLIS;
        for (int i = missing.size() - 1; i >= 0; i--) {
            Interval range = missing.get(i);
            long end = range.end;
            while (end >= range.start) {
                // Start small; only expand after successful, sparse responses.
                long start = Math.max(range.start, end - window + 1);
                long imported = importUnchecked(new Interval(start, end));
                if (imported <= QUERY_LIMIT / 4) window = Math.min(maxRequestWindow, window * 2);
                else if (imported > QUERY_LIMIT) window = Math.max(MIN_RETRY_RANGE_MILLIS, window / 2);
                window = Math.min(window, maxRequestWindow);
                end = start - 1;
            }
        }
    }

    private long importUnchecked(Interval range) throws IOException {
        System.out.println("Checking earthquakes " + Instant.ofEpochMilli(range.start)
                + " through " + Instant.ofEpochMilli(range.end));
        long imported;
        try {
            imported = importBatch(range);
        } catch (EarthquakeJsonConverter.RetryableRequestException e) {
            if (range.end - range.start < MIN_RETRY_RANGE_MILLIS) throw e;
            maxRequestWindow = Math.min(maxRequestWindow, (range.end - range.start + 1) / 2);
            System.err.println("USGS could not complete this range after retries; splitting it into smaller requests.");
            return split(range);
        }
        // Keep recursion outside the catch: a child failure must not retry completed siblings.
        return imported < 0 ? split(range) : imported;
    }

    private long split(Interval range) throws IOException {
        if (range.start == range.end) throw new IOException("Too many earthquakes at " + encode(range.start));
        long middle = range.start + (range.end - range.start) / 2;
        return importUnchecked(new Interval(middle + 1, range.end))
                + importUnchecked(new Interval(range.start, middle));
    }

    private long importBatch(Interval range) throws IOException {
        String parameters = "starttime=" + encode(range.start) + "&endtime=" + encode(range.end);
        String countText = fetcher.fetch(apiBase + "count?" + parameters);
        long expected;
        try {
            expected = Long.parseLong(countText.trim());
        } catch (NumberFormatException e) {
            throw new IOException("Invalid earthquake count response", e);
        }
        if (expected < 0) throw new IOException("Invalid earthquake count: " + expected);
        if (expected > QUERY_LIMIT) {
            return -1;
        }
        if (expected > 0) {
            String json = fetcher.fetch(apiBase + "query?format=geojson&"
                    + parameters + "&orderby=time&limit=" + QUERY_LIMIT);
            JSONArray features = new JSONObject(json).getJSONArray("features");
            Set<String> ids = new HashSet<>();
            for (int i = 0; i < features.length(); i++) {
                JSONObject feature = features.getJSONObject(i);
                long time = feature.getJSONObject("properties").getLong("time");
                if (time < range.start || time > range.end) throw new IOException("Earthquake outside requested range");
                ids.add(feature.getString("id"));
            }
            if (ids.size() != expected || features.length() != expected) {
                throw new IOException("Earthquake count changed or response incomplete: expected "
                        + expected + ", received " + ids.size() + ". Retry the import.");
            }
            EarthquakeJsonConverter.saveEventsToFile(EarthquakeJsonConverter.processJson(json, outputRoot));
        }
        // Empty ranges are complete too. Never infer completeness from the number of hourly files.
        List<Interval> next = new ArrayList<>(completed);
        next.add(range);
        next = merge(next);
        JSONArray ranges = new JSONArray();
        for (Interval interval : next) {
            ranges.put(new JSONObject().put("start", interval.start).put("end", interval.end));
        }
        EarthquakeJsonConverter.saveJsonToFile(checkpoint.toString(), new JSONObject()
                .put("version", 1).put("apiBase", apiBase).put("completed", ranges));
        completed = next;
        System.out.println("Imported " + Instant.ofEpochMilli(range.start) + " through "
                + Instant.ofEpochMilli(range.end) + ": " + expected + " earthquakes.");
        return expected;
    }

    private static List<Interval> merge(List<Interval> ranges) {
        ranges.sort(Comparator.comparingLong(Interval::start));
        List<Interval> merged = new ArrayList<>();
        for (Interval range : ranges) {
            if (merged.isEmpty() || range.start > merged.get(merged.size() - 1).end + 1) {
                merged.add(range);
            } else {
                Interval previous = merged.remove(merged.size() - 1);
                merged.add(new Interval(previous.start, Math.max(previous.end, range.end)));
            }
        }
        return merged;
    }

    private static String encode(long time) {
        return URLEncoder.encode(Instant.ofEpochMilli(time).toString(), StandardCharsets.UTF_8);
    }
}
