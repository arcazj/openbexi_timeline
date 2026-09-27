package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.ContentHandler;
import org.json.simple.parser.JSONParser;

import java.io.*;
import java.nio.file.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.function.UnaryOperator;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/** Opt-in, resumable file scan. A page never requires materializing a source file or archive. */
final class ProgressiveSourceScan implements AutoCloseable {
    private static final Map<String, ProgressiveSourceScan> ACTIVE = new LinkedHashMap<>();
    private static final long TTL = 90_000, MAX_BYTES = 64L * 1024 * 1024;
    static {
        var cleanup = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(task -> {
            Thread thread = new Thread(task, "timeline-cursor-cleanup"); thread.setDaemon(true); return thread;
        });
        cleanup.scheduleWithFixedDelay(() -> {
            synchronized (ProgressiveSourceScan.class) {
                long now = System.currentTimeMillis();
                ACTIVE.values().removeIf(scan -> { if (now - scan.touched <= TTL) return false; scan.close(); return true; });
            }
        }, 90, 90, java.util.concurrent.TimeUnit.SECONDS);
    }
    private record Directory(Path path, String namespace) {}
    private record Walk(DirectoryStream<Path> stream, Iterator<Path> iterator, Directory directory) {}
    private final String identity, id = UUID.randomUUID().toString(), query, scene;
    private final long from, to;
    private final UnaryOperator<JSONArray> filter;
    private final Deque<Directory> directories = new ArrayDeque<>();
    private final Deque<Walk> walks = new ArrayDeque<>();
    private final Set<Path> seen = new HashSet<>();
    private final JSONArray warnings = new JSONArray();
    private long touched = System.currentTimeMillis(), bytes, deadline, pageStart;
    private int sequence, work, examined, totalExamined;
    private boolean done;
    private CountingReader reader;
    private JSONParser parser;
    private Records handler;
    private Directory source;
    private String fileIdentity;
    private JSONObject last;
    private JSONArray page;
    private final Map<String,Boolean> unique=new HashMap<>();
    private long nearestDistance=Long.MAX_VALUE,nearestFrom,nearestTo;

    static synchronized JSONObject read(JSONObject configuration, long from, long to,
                                        UnaryOperator<JSONArray> filter) {
        String query = Objects.toString(configuration.get("search"), ""), scene = Objects.toString(configuration.get("scene"), "0");
        long now = System.currentTimeMillis();
        ACTIVE.values().removeIf(scan -> { if (now - scan.touched <= TTL) return false; scan.close(); return true; });
        String identity = Arrays.asList(configuration.get("startup configuration"), configuration.get("userName"),
                configuration.get("timelineName"), configuration.get("filter"), query, scene, from, to).toString();
        String cursor = Objects.toString(configuration.get("cursor"), "");
        try {
            ProgressiveSourceScan scan;
            int requested = 0;
            if (cursor.isEmpty()) {
                while (ACTIVE.size() >= 8) {
                    // Completed scans retain a replay page, but must not evict
                    // a live continuation merely because it was opened first.
                    String key = ACTIVE.entrySet().stream().min(Comparator
                            .comparing((Map.Entry<String, ProgressiveSourceScan> entry) -> !entry.getValue().done)
                            .thenComparingLong(entry -> entry.getValue().touched)).orElseThrow().getKey();
                    ACTIVE.remove(key).close();
                }
                scan = new ProgressiveSourceScan(identity, configuration, query, scene, from, to, filter);
                ACTIVE.put(scan.id, scan);
            } else {
                String[] parts = cursor.split(":", 2);
                scan = ACTIVE.get(parts[0]);
                requested = parts.length == 2 ? Integer.parseInt(parts[1]) : -1;
                if (scan == null || !scan.identity.equals(identity)) throw new IllegalArgumentException();
            }
            if ("1".equals(configuration.get("cancel"))) {
                scan.close(); ACTIVE.remove(scan.id);
                JSONObject result=MatchResults.envelope(new JSONArray(), query, scene, from, to, false);
                ((JSONObject)result.get("timelineMatch")).put("cancelled",true);return result;
            }
            scan.touched = now;
            if (requested == scan.sequence - 1 && scan.last != null) {
                JSONObject replay=new JSONObject(scan.last), metadata=new JSONObject((JSONObject)scan.last.get("timelineMatch"));
                metadata.put("cache","replay");replay.put("timelineMatch",metadata);return replay;
            }
            if (requested != scan.sequence || scan.done) throw new IllegalArgumentException();
            return scan.next();
        } catch (Exception error) {
            return MatchResults.failure(query, scene, from, to, "Loading cursor expired or unavailable. Retry the visible time window.");
        }
    }

    private ProgressiveSourceScan(String identity, JSONObject configuration, String query, String scene,
                                  long from, long to, UnaryOperator<JSONArray> filter) {
        this.identity = identity; this.query = query; this.scene = scene;
        this.from = from; this.to = to; this.filter = filter;
        List<Directory> archives = new ArrayList<>();
        Set<Directory> preferred = new LinkedHashSet<>();
        List<JSONObject> sources = new ArrayList<>();
        for (Object value : (JSONArray) configuration.get("startup configuration")) sources.add((JSONObject)value);
        // A large unrelated archive must not delay a source named by the search.
        // Keep every source so highlighting and coverage retain their semantics.
        if (!query.isEmpty() && !query.equals("*")) {
            try {
                Pattern pattern = Pattern.compile(query.replace(";", "|").replace(" ", "|"));
                sources.sort(Comparator.comparing(item -> !pattern.matcher(Objects.toString(item.get("namespace"), "")).find()));
            } catch (PatternSyntaxException ignored) { /* MatchResults reports invalid expressions. */ }
        }
        for (JSONObject item : sources) {
            if (!"json_file".equals(item.get("type")) || "false".equals(String.valueOf(item.get("enable")))) continue;
            String model = String.valueOf(item.get("data_model")).replace('\\', '/');
            String namespace = Objects.toString(item.get("namespace"), "");
            try {
                Path root = Paths.get(model.split("/(?:yyyy|mm|dd)(?:/|$)", 2)[0]).toRealPath();
                LocalDate date = Instant.ofEpochMilli(from).atZone(ZoneOffset.UTC).toLocalDate();
                LocalDate end = Instant.ofEpochMilli(to).atZone(ZoneOffset.UTC).toLocalDate();
                for (int count = 0; !date.isAfter(end) && count < 3662; count++, date = date.plusDays(1)) {
                    String partition = model.replace("/yyyy", "/" + date.format(DateTimeFormatter.ofPattern("yyyy")))
                            .replace("/mm", "/" + date.format(DateTimeFormatter.ofPattern("MM")))
                            .replace("/dd", "/" + date.format(DateTimeFormatter.ofPattern("dd")));
                    Path path = Paths.get(partition);
                    if (Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) preferred.add(new Directory(path, namespace));
                }
                archives.add(new Directory(root, namespace));
            } catch (IOException | InvalidPathException error) { warn("A configured source is unavailable."); }
        }
        directories.addAll(preferred);
        // Old partitions can hold sessions that overlap the current window. They
        // are scanned only after current partitions, in bounded background pages.
        directories.addAll(archives);
    }

    private void warn(String message) { if (!warnings.contains(message)) warnings.add(message); }

    private boolean budget() { return examined >= 256 || work >= 512 || bytes - pageStart >= 512 * 1024 || System.nanoTime() >= deadline; }

    private JSONObject next() {
        page = new JSONArray(); examined = work = 0; pageStart = bytes;
        long started = System.nanoTime(); deadline = started + 50_000_000;
        while (!done && !budget()) {
            if (bytes >= MAX_BYTES || seen.size() >= 10000 || totalExamined >= 100000) {
                warn("Scan limit reached; coverage is partial. Narrow the visible time window."); close(); break;
            }
            try {
                if (reader == null && !openNext()) break;
                parser.parse(reader, handler, true);
                if (handler.ended) closeFile();
            } catch (Exception error) { warn("Unreadable or oversized records were skipped; coverage is partial."); closeFile(); }
        }
        JSONObject response = MatchResults.envelope(page, query, scene, from, to, done && warnings.isEmpty());
        JSONObject metadata = (JSONObject) response.get("timelineMatch");
        metadata.put("progressive", true);
        metadata.put("batch", sequence++);
        metadata.put("nextCursor", done ? null : id + ":" + sequence);
        metadata.put("recordsExamined", examined);
        metadata.put("recordsReturned",page.size());
        metadata.put("recordsExcluded",examined-page.size());
        unique.putAll(com.openbexi.timeline.servlets.TimelineRequestLog.identities((JSONArray)response.get("events")));
        long sessions=unique.values().stream().filter(Boolean::booleanValue).count();
        metadata.put("uniqueSessions",sessions);metadata.put("uniqueEvents",unique.size()-sessions);
        metadata.put("cache","miss");
        if(nearestDistance!=Long.MAX_VALUE) metadata.put("availableRange",new JSONObject(Map.of(
                "from",Instant.ofEpochMilli(nearestFrom).toString(),"to",Instant.ofEpochMilli(nearestTo).toString())));
        metadata.put("charactersRead", bytes - pageStart);
        metadata.put("elapsedMillis", (System.nanoTime() - started) / 1_000_000);
        JSONArray messages = new JSONArray(); messages.addAll(warnings);
        metadata.put("warnings", messages);
        last = response;
        return response;
    }

    private boolean openNext() throws IOException {
        while (!budget()) {
            if (walks.isEmpty()) {
                Directory next = directories.poll();
                if (next == null) { done = true; return false; }
                if (Files.isRegularFile(next.path, LinkOption.NOFOLLOW_LINKS)) return openFile(next.path, next);
                push(next);
            }
            Walk walk = walks.peek();
            if (!walk.iterator.hasNext()) { walks.pop().stream.close(); continue; }
            Path file = walk.iterator.next(); work++;
            String name = file.getFileName().toString();
            if (name.startsWith("descriptors") || name.contains("noises") || Files.isSymbolicLink(file)) continue;
            if (Files.isDirectory(file, LinkOption.NOFOLLOW_LINKS)) {
                if (walks.size() >= 32) warn("A source directory exceeds the scan depth limit.");
                else push(new Directory(file, walk.directory.namespace));
            } else if (name.endsWith(".json") && Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) && openFile(file, walk.directory)) return true;
        }
        return false;
    }

    private void push(Directory directory) throws IOException {
        DirectoryStream<Path> stream = Files.newDirectoryStream(directory.path);
        walks.push(new Walk(stream, stream.iterator(), directory));
    }

    private boolean openFile(Path file, Directory directory) throws IOException {
        Path canonical=file.toRealPath();
        if (!seen.add(canonical)) return false;
        source = directory;
        fileIdentity = UUID.nameUUIDFromBytes((canonical + ":" + directory.namespace)
                .getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
        reader = new CountingReader(Files.newBufferedReader(file));
        parser = new JSONParser(); handler = new Records();
        return true;
    }

    private JSONObject select(JSONObject record, int depth, String inheritedNamespace, String fallbackId) {
        try {
            long start = MatchResults.time(record.get("start"));
            Object rawEnd = record.get("end");
            long end = rawEnd == null || rawEnd.toString().isBlank() ? start : MatchResults.time(rawEnd);
            if (end < start || depth > 32) throw new IllegalArgumentException();
            if(depth==0) {
                long distance=start>to?start-to:end<from?from-end:0;
                if(distance<nearestDistance) { nearestDistance=distance;nearestFrom=start;nearestTo=Math.max(start+1,end); }
            }
            // Legacy exclusions inspect the whole session, including activities
            // outside the viewport. The response scopes children after filtering.
            if (depth == 0 && (start > to || end < from)) return null;
            JSONObject copy = new JSONObject(record);
            copy.remove("sourceRecordKey");
            copy.put("namespace", MatchResults.namespace(record, inheritedNamespace));
            if (rawEnd != null && rawEnd.toString().isBlank()) copy.remove("end");
            if (record.get("activities") instanceof JSONArray children) {
                JSONArray scoped = new JSONArray(); int index = 0;
                for (Object child : children) {
                    JSONObject selected = select((JSONObject) child, depth + 1, String.valueOf(copy.get("namespace")), fallbackId + "/" + index++);
                    if (selected != null) scoped.add(selected);
                }
                copy.put("activities", scoped);
            }
            return copy;
        } catch (RuntimeException error) { warn("Invalid records were skipped; coverage is partial."); return null; }
    }

    /** Stable source occurrences distinguish reused external IDs without changing them. */
    private void identify(JSONObject record,String key) {
        record.put("sourceRecordKey",key);
        if(record.get("activities") instanceof JSONArray children) {
            int index=0;
            for(Object child:children) identify((JSONObject)child,key+"/"+index++);
        }
    }

    private final class CountingReader extends FilterReader {
        private long boundary = bytes;
        CountingReader(Reader in) { super(in); }
        @Override public int read(char[] buffer, int offset, int length) throws IOException {
            int count = super.read(buffer, offset, Math.min(length, 4096));
            if (count > 0) bytes += count;
            if (bytes - boundary > 2 * 1024 * 1024) throw new IOException("Record size limit");
            return count;
        }
    }

    private final class Records implements ContentHandler {
        private final class Frame { final Object value; String key; Frame(Object value) { this.value = value; } }
        private final Deque<Frame> stack = new ArrayDeque<>();
        private String rootKey;
        private boolean inEvents, ended;
        private int ordinal, documentDepth;
        private void add(Object value) {
            if (stack.isEmpty()) return;
            Frame frame = stack.peek();
            if (frame.value instanceof JSONObject object) object.put(frame.key, value);
            else ((JSONArray) frame.value).add(value);
        }
        public void startJSON() {}
        public void endJSON() { if (!inEvents) warn("A source file has no events array; coverage is partial."); ended = true; }
        public boolean startObject() {
            documentDepth++;
            if (inEvents) { JSONObject object = new JSONObject(); add(object); stack.push(new Frame(object)); }
            return true;
        }
        public boolean endObject() {
            documentDepth--;
            if (!inEvents || stack.isEmpty()) return true;
            Object record = stack.pop().value;
            if (!stack.isEmpty()) return true;
            examined++; totalExamined++; ordinal++;
            JSONObject selected = select((JSONObject) record, 0, source.namespace,
                    "source-" + fileIdentity + "-" + ordinal);
            if (selected != null) {
                JSONArray eligible = new JSONArray(); eligible.add(selected);
                // Legacy include/exclude patterns inspect source metadata and
                // whole sessions, never the generated occurrence identity.
                JSONArray filtered=filter.apply(eligible);
                identify(selected,"source-"+fileIdentity+"-"+ordinal);
                page.addAll(filtered);
            }
            reader.boundary = bytes;
            return !budget();
        }
        public boolean startObjectEntry(String key) { if (stack.isEmpty()) { if (documentDepth == 1) rootKey = key; } else stack.peek().key = key; return true; }
        public boolean endObjectEntry() { return true; }
        public boolean startArray() {
            documentDepth++;
            if (!inEvents && documentDepth == 2 && "events".equals(rootKey)) inEvents = true;
            else if (!stack.isEmpty()) { JSONArray array = new JSONArray(); add(array); stack.push(new Frame(array)); }
            return true;
        }
        public boolean endArray() {
            documentDepth--;
            if (stack.isEmpty() && inEvents) { ended = true; return false; }
            if (!stack.isEmpty()) stack.pop();
            return true;
        }
        public boolean primitive(Object value) { add(value); return true; }
    }

    private void closeFile() {
        if (reader != null) try { reader.close(); } catch (IOException ignored) {}
        reader = null; parser = null; handler = null;
    }
    public void close() {
        closeFile();
        while (!walks.isEmpty()) try { walks.pop().stream.close(); } catch (IOException ignored) {}
        directories.clear(); done = true;
    }
}
