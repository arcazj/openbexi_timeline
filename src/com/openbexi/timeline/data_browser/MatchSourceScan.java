package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;

import java.io.IOException;
import java.io.Reader;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.function.UnaryOperator;

/** Request-local, bounded inventory. Prefer requested date partitions before archives. */
final class MatchSourceScan {
    private record Source(String namespace, String model, Path root, java.util.function.Predicate<JSONObject> filter) {}
    private final long from, to, maxBytes;
    private final int maxFiles;
    private final UnaryOperator<JSONArray> filter;
    private final JSONArray records = new JSONArray(), warnings = new JSONArray();
    private final Set<Path> seen = new HashSet<>();
    private long bytes;
    private int visited, invalidRecords, unreadableFiles;
    private boolean limited;

    MatchSourceScan(long from, long to, UnaryOperator<JSONArray> filter) {
        this(from, to, filter, 10000, 64L * 1024 * 1024);
    }

    MatchSourceScan(long from, long to, UnaryOperator<JSONArray> filter, int maxFiles, long maxBytes) {
        this.from = from; this.to = to; this.filter = filter;
        this.maxFiles = maxFiles; this.maxBytes = maxBytes;
    }

    JSONObject read(JSONArray configurations, String query, String scene) {
        return read(configurations, query, scene, null);
    }

    JSONObject read(JSONArray configurations, String query, String scene, String searchMode) {
        List<Source> sources = new ArrayList<>();
        for (Object value : configurations) {
            JSONObject source = (JSONObject) value;
            if (Boolean.FALSE.equals(source.get("enable")) || "false".equals(source.get("enable")) ||
                    (source.get("type") != null && !"json_file".equals(source.get("type")))) continue;
            String namespace = String.valueOf(source.get("namespace"));
            String model = String.valueOf(source.get("data_model")).replace('\\', '/');
            try {
                Path root = Paths.get(model.split("/(?:yyyy|mm|dd)(?:/|$)", 2)[0]).toRealPath();
                sources.add(new Source(namespace, model, root,FilterExpression.source(source)));
            } catch (IOException | InvalidPathException error) {
                warnings.add("Source unavailable: " + namespace + ".");
            }
        }
        // Scan each source's requested partitions first. Otherwise a large old
        // archive can exhaust the budget before any current events are read.
        for (Source source : sources) {
            LocalDate date = Instant.ofEpochMilli(from).atZone(ZoneOffset.UTC).toLocalDate().minusDays(1);
            LocalDate last = Instant.ofEpochMilli(to).atZone(ZoneOffset.UTC).toLocalDate().plusDays(1);
            Set<Path> partitions = new HashSet<>();
            for (int days = 0; !date.isAfter(last) && days < 3662 && !limited; days++, date = date.plusDays(1)) {
                String path = source.model.replace("/yyyy", "/" + date.format(DateTimeFormatter.ofPattern("yyyy")))
                        .replace("/mm", "/" + date.format(DateTimeFormatter.ofPattern("MM")))
                        .replace("/dd", "/" + date.format(DateTimeFormatter.ofPattern("dd")));
                Path partition = Paths.get(path);
                if (partitions.add(partition) && Files.isDirectory(partition, LinkOption.NOFOLLOW_LINKS)) walk(partition, source);
            }
        }
        // Earlier partitions may contain sessions spanning the requested range.
        for (Source source : sources) if (!limited) walk(source.root, source);
        if (invalidRecords > 0) warnings.add("Invalid records skipped: " + invalidRecords + ".");
        if (unreadableFiles > 0) warnings.add("Unreadable data files skipped: " + unreadableFiles + ".");
        if (limited) warnings.add("Archive scan limit reached; requested date partitions were read first.");
        JSONObject result = sources.isEmpty() ? MatchResults.failure(query, scene, from, to, "No configured data source could be read.") :
                MatchResults.envelope(records, query, scene, from, to, warnings.isEmpty(), searchMode);
        if (!warnings.isEmpty()) ((JSONObject)result.get("timelineMatch")).put("warnings", warnings);
        return result;
    }

    private void walk(Path directory, Source source) {
        try {
            Files.walkFileTree(directory, EnumSet.noneOf(FileVisitOption.class), 32, new SimpleFileVisitor<>() {
                @Override public FileVisitResult preVisitDirectory(Path path, BasicFileAttributes attributes) {
                    if (++visited > 100000) { limited = true; return FileVisitResult.TERMINATE; }
                    String name = path.getFileName().toString();
                    return name.startsWith("descriptors") || name.contains("noises") ? FileVisitResult.SKIP_SUBTREE : FileVisitResult.CONTINUE;
                }
                @Override public FileVisitResult visitFile(Path file, BasicFileAttributes attributes) {
                    if (++visited > 100000) { limited = true; return FileVisitResult.TERMINATE; }
                    if (attributes.isDirectory()) { warnings.add("A source directory exceeds the scan depth limit."); return FileVisitResult.CONTINUE; }
                    String name = file.getFileName().toString();
                    if (!attributes.isRegularFile() || !name.endsWith(".json") || name.startsWith("descriptors") || name.contains("noises"))
                        return FileVisitResult.CONTINUE;
                    try {
                        if (!seen.add(file.toRealPath())) return FileVisitResult.CONTINUE;
                        if (seen.size() > maxFiles || attributes.size() > maxBytes - bytes) {
                            limited = true; return FileVisitResult.TERMINATE;
                        }
                        bytes += attributes.size();
                        JSONObject payload;
                        try (Reader reader = Files.newBufferedReader(file)) { payload = (JSONObject)new JSONParser().parse(reader); }
                        JSONArray selected = select((JSONArray)payload.get("events"), 0, source.namespace);
                        selected.removeIf(value->!source.filter.test((JSONObject)value));
                        JSONArray events = filter.apply(selected);
                        for (Object value : events) {
                            if (records.size() >= 100000) { limited = true; return FileVisitResult.TERMINATE; }
                            JSONObject event = (JSONObject)value;
                            records.add(event);
                        }
                    } catch (Exception error) { unreadableFiles++; }
                    return FileVisitResult.CONTINUE;
                }
                @Override public FileVisitResult visitFileFailed(Path file, IOException error) {
                    unreadableFiles++; return FileVisitResult.CONTINUE;
                }
                @Override public FileVisitResult postVisitDirectory(Path path, IOException error) {
                    if (error != null) unreadableFiles++;
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException | SecurityException error) { unreadableFiles++; }
    }

    private JSONArray select(JSONArray events, int depth, String inheritedNamespace) {
        if (events == null) throw new IllegalArgumentException("Missing events array.");
        JSONArray selected = new JSONArray();
        for (Object value : events) {
            try {
                JSONObject record = (JSONObject)value;
                long start = MatchResults.time(record.get("start"));
                Object endValue = record.get("end");
                boolean point = endValue == null || (endValue instanceof String text && text.isBlank());
                long end = point ? start : MatchResults.time(endValue);
                if (end < start || depth >= 32) throw new IllegalArgumentException("Invalid record range or nesting.");
                // Keep full nested context for legacy filters; the envelope
                // limits returned activities to the requested window afterward.
                if (depth == 0 && (start > to || end < from)) continue;
                JSONObject copy = new JSONObject(record);
                String namespace = MatchResults.namespace(record, inheritedNamespace);
                copy.put("namespace", namespace);
                if (point) copy.remove("end");
                if (record.get("activities") != null) copy.put("activities", select((JSONArray)record.get("activities"), depth + 1, namespace));
                selected.add(copy);
            } catch (RuntimeException error) { invalidRecords++; }
        }
        return selected;
    }
}
