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
    private record Directory(Path path, String namespace, java.util.function.Predicate<JSONObject> filter, Partition partition, int depth) {
        Directory(Path path, String namespace, java.util.function.Predicate<JSONObject> filter) { this(path, namespace, filter, null, 0); }
        Directory(Path path, String namespace, java.util.function.Predicate<JSONObject> filter, Partition partition) { this(path, namespace, filter, partition, 0); }
        long priority() { return partition == null ? Long.MAX_VALUE : partition.latest(); }
    }
    // All partitions of one configured source share a predicate instance. A
    // different source must still evaluate this file with its own namespace/rules.
    private record FileVisit(Path path, String namespace, java.util.function.Predicate<JSONObject> filter) {}
    /** Date components come from data_model, never from private file names sent to the client. */
    private record Partition(List<String> parts, int depth, Integer year, Integer month, Integer day) {
        Partition child(String name) {
            if (depth >= parts.size()) return this;
            String token = parts.get(depth);
            try {
                if (List.of("yyyy", "mm", "dd").contains(token)) {
                    if (!name.matches(token.equals("yyyy") ? "[0-9]{4}" : "[0-9]{1,2}")) return null;
                    Integer value = Integer.valueOf(name);
                    Partition next = new Partition(parts, depth + 1, token.equals("yyyy") ? value : year,
                            token.equals("mm") ? value : month, token.equals("dd") ? value : day);
                    next.range(); // Reject impossible dates without mislabelling their contents.
                    return next;
                }
                return token.equals(name) ? new Partition(parts, depth + 1, year, month, day) : null;
            } catch (DateTimeException error) { return null; }
        }
        long[] range() {
            if (year == null) return null;
            LocalDate date = LocalDate.of(year, month == null ? 1 : month, day == null ? 1 : day);
            LocalDate end = month == null ? date.plusYears(1) : day == null ? date.plusMonths(1) : date.plusDays(1);
            return new long[]{date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
                    end.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() - 1};
        }
        long latest() { long[] range = range(); return range == null ? Long.MAX_VALUE : range[1]; }
    }
    private record Walk(DirectoryStream<Path> stream, Iterator<Path> iterator, Directory directory) {}
    private final String identity, id = UUID.randomUUID().toString(), query, scene;
    private final long from, to;
    private final boolean history;
    private final SearchQuery historyPattern;
    private final String searchMode;
    private final UnaryOperator<JSONArray> filter;
    private final Deque<Directory> directories = new ArrayDeque<>();
    private final PriorityQueue<Directory> historyDirectories = new PriorityQueue<>(Comparator.comparingLong(Directory::priority).reversed()
            .thenComparing(directory -> directory.path.toString()));
    private final Deque<Walk> walks = new ArrayDeque<>();
    private final Set<FileVisit> seen = new HashSet<>();
    private final JSONArray warnings = new JSONArray();
    private long touched = System.currentTimeMillis(), bytes, deadline, pageStart;
    private int sequence, work, examined, totalExamined;
    private boolean done;
    private boolean historySupported = true;
    private long[] checkingRange;
    private CountingReader reader;
    private JSONParser parser;
    private Records handler;
    private Directory source;
    private String fileIdentity;
    private Path currentFile;
    private SourceRecordCache.Stamp fileStamp;
    private List<JSONObject> collected;
    private List<SourceRecordCache.Record> cached;
    private int cachedIndex;
    private long fileStart;
    private JSONObject last;
    private JSONArray page;
    private final Map<String,Boolean> unique=new HashMap<>();
    private long nearestDistance=Long.MAX_VALUE,nearestFrom,nearestTo;
    private long latestFrom=Long.MIN_VALUE,latestTo;

    static synchronized JSONObject read(JSONObject configuration, long from, long to,
                                        UnaryOperator<JSONArray> filter) {
        String query = Objects.toString(configuration.get("search"), ""), scene = Objects.toString(configuration.get("scene"), "0");
        String searchMode = Objects.toString(configuration.get("searchMode"), "legacy");
        try { new SearchQuery(query, searchMode); }
        catch (IllegalArgumentException error) { return MatchResults.failure(query, scene, from, to, "Invalid search expression or mode."); }
        long now = System.currentTimeMillis();
        ACTIVE.values().removeIf(scan -> { if (now - scan.touched <= TTL) return false; scan.close(); return true; });
        String identity = Arrays.asList(configuration.get("startup configuration"), configuration.get("userName"),
                configuration.get("timelineName"), configuration.get("filter"), configuration.get("sortBy"),
                configuration.get("history"), searchMode, query, scene, from, to).toString();
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
                JSONObject result=MatchResults.envelope(new JSONArray(), query, scene, from, to, false, searchMode);
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
        this.history = "backward".equals(configuration.get("history"));
        this.searchMode = Objects.toString(configuration.get("searchMode"), "legacy");
        this.historyPattern = new SearchQuery(query, searchMode);
        // This is the browser Date lower bound, also representable by java.time.
        // Request coordinates still bind the cursor; only the history response domain expands.
        this.from = history ? -8_640_000_000_000_000L : from; this.to = to; this.filter = filter;
        List<Directory> archives = new ArrayList<>();
        Set<Directory> preferred = new LinkedHashSet<>();
        List<JSONObject> sources = new ArrayList<>();
        for (Object value : (JSONArray) configuration.get("startup configuration")) sources.add((JSONObject)value);
        // A large unrelated archive must not delay a source named by the search.
        // Keep every source so highlighting and coverage retain their semantics.
        if (!query.isEmpty() && !query.equals("*")) {
            try {
                sources.sort(Comparator.comparing(item -> !historyPattern.matchesText(Objects.toString(item.get("namespace"), ""))));
            } catch (PatternSyntaxException ignored) { /* MatchResults reports invalid expressions. */ }
        }
        for (JSONObject item : sources) {
            if ("false".equals(String.valueOf(item.get("enable")))) continue;
            if (!"json_file".equals(item.get("type"))) {
                if (history) { historySupported = false; warn("Historical search is unavailable for a configured source."); }
                continue;
            }
            String model = String.valueOf(item.get("data_model")).replace('\\', '/');
            String namespace = Objects.toString(item.get("namespace"), "");
            var sourceFilter=FilterExpression.source(item);
            try {
                Path root = Paths.get(model.split("/(?:yyyy|mm|dd)(?:/|$)", 2)[0]).toRealPath();
                if (history) {
                    String prefix = model.split("/(?:yyyy|mm|dd)(?:/|$)", 2)[0];
                    String suffix = model.substring(prefix.length()).replaceAll("^/+|/+$", "");
                    List<String> parts = suffix.isEmpty() ? List.of() : List.of(suffix.split("/"));
                    historyDirectories.add(new Directory(root, namespace, sourceFilter, new Partition(parts, 0, null, null, null)));
                    continue;
                }
                LocalDate date = Instant.ofEpochMilli(from).atZone(ZoneOffset.UTC).toLocalDate();
                LocalDate end = Instant.ofEpochMilli(to).atZone(ZoneOffset.UTC).toLocalDate();
                for (int count = 0; !date.isAfter(end) && count < 3662; count++, date = date.plusDays(1)) {
                    String partition = model.replace("/yyyy", "/" + date.format(DateTimeFormatter.ofPattern("yyyy")))
                            .replace("/mm", "/" + date.format(DateTimeFormatter.ofPattern("MM")))
                            .replace("/dd", "/" + date.format(DateTimeFormatter.ofPattern("dd")));
                    Path path = Paths.get(partition);
                    if (Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) preferred.add(new Directory(path, namespace,sourceFilter));
                }
                archives.add(new Directory(root, namespace,sourceFilter));
            } catch (IOException | InvalidPathException error) { warn("A configured source is unavailable."); }
        }
        directories.addAll(preferred);
        // Old partitions can hold sessions that overlap the current window. They
        // are scanned only after current partitions, in bounded background pages.
        directories.addAll(archives);
        if (history && historyDirectories.isEmpty()) warn("No configured history source could be read.");
    }

    private void warn(String message) { if (!warnings.contains(message)) warnings.add(message); }

    private boolean budget() { return page.size() >= 256 || examined >= 4096 || work >= 512 || bytes - pageStart >= 512 * 1024 || System.nanoTime() >= deadline; }

    private JSONObject next() {
        page = new JSONArray(); examined = work = 0; pageStart = bytes;
        long started = System.nanoTime(); deadline = started + 50_000_000;
        while (!done && !budget()) {
            if (!history && (bytes >= MAX_BYTES || seen.size() >= 10000 || totalExamined >= 100000)) {
                warn("Scan limit reached; coverage is partial. Narrow the visible time window."); close(); break;
            }
            try {
                if (reader == null && cached == null && !openNext()) break;
                if(cached!=null) {
                    while(cachedIndex<cached.size() && !budget()) {
                        var record=cached.get(cachedIndex++);accept(record.value(),record.ordinal());
                    }
                    if(cachedIndex==cached.size())closeFile();
                } else {
                    parser.parse(reader, handler, true);
                    if (handler.ended) {
                        if(collected!=null && fileStamp.equals(SourceRecordCache.Stamp.of(Files.readAttributes(currentFile,java.nio.file.attribute.BasicFileAttributes.class))))
                            SourceRecordCache.put(currentFile,fileStamp,collected,bytes-fileStart);
                        closeFile();
                    }
                }
            } catch (Exception error) { warn("Unreadable or oversized records were skipped; coverage is partial."); closeFile(); }
        }
        JSONObject response = MatchResults.envelope(page, query, scene, from, to, done && warnings.isEmpty(), searchMode);
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
        if (history) {
            JSONObject progress = new JSONObject();
            progress.put("direction", "backward");
            progress.put("supported", historySupported);
            progress.put("exhausted", done && historySupported);
            progress.put("incomplete", !warnings.isEmpty());
            progress.put("filesExamined", seen.size());
            if (checkingRange != null) progress.put("checkingRange", new JSONObject(Map.of(
                    "from", Instant.ofEpochMilli(checkingRange[0]).toString(), "to", Instant.ofEpochMilli(checkingRange[1]).toString())));
            metadata.put("history", progress);
        }
        if(nearestDistance!=Long.MAX_VALUE) metadata.put("availableRange",new JSONObject(Map.of(
                "from",Instant.ofEpochMilli(nearestFrom).toString(),"to",Instant.ofEpochMilli(nearestTo).toString())));
        if(latestFrom!=Long.MIN_VALUE)metadata.put("latestRange",new JSONObject(Map.of(
                "from",Instant.ofEpochMilli(latestFrom).toString(),"to",Instant.ofEpochMilli(latestTo).toString())));
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
                Directory next = history ? historyDirectories.poll() : directories.poll();
                if (next == null) { done = true; return false; }
                if (Files.isRegularFile(next.path, LinkOption.NOFOLLOW_LINKS)) {if(openFile(next.path, next))return true;else continue;}
                push(next);
            }
            Walk walk = walks.peek();
            try {
                if (!walk.iterator.hasNext()) { walks.pop().stream.close(); continue; }
            } catch (DirectoryIteratorException error) {
                walks.pop().stream.close(); throw error.getCause();
            }
            Path file = walk.iterator.next(); work++;
            String name = file.getFileName().toString();
            if (name.startsWith("descriptors") || name.contains("noises") || Files.isSymbolicLink(file)) continue;
            if (Files.isDirectory(file, LinkOption.NOFOLLOW_LINKS)) {
                if (walk.directory.depth >= 31) warn("A source directory exceeds the scan depth limit.");
                else if (history) {
                    Partition partition = walk.directory.partition == null ? null : walk.directory.partition.child(name);
                    historyDirectories.add(new Directory(file, walk.directory.namespace, walk.directory.filter, partition, walk.directory.depth + 1));
                } else push(new Directory(file, walk.directory.namespace, walk.directory.filter, null, walk.directory.depth + 1));
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
        if (!seen.add(new FileVisit(canonical, directory.namespace, directory.filter))) return false;
        source = directory;
        if (history && directory.partition != null) checkingRange = directory.partition.range();
        currentFile=canonical;fileStamp=SourceRecordCache.Stamp.of(Files.readAttributes(canonical,java.nio.file.attribute.BasicFileAttributes.class));
        fileStart=bytes;
        fileIdentity = UUID.nameUUIDFromBytes((canonical + ":" + directory.namespace)
                .getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
        var entry=SourceRecordCache.get(canonical,fileStamp);
        if(entry!=null){
            if(entry.from()>to || entry.to()<from) {
                if(entry.latest()>latestFrom){latestFrom=entry.latest();latestTo=entry.latest()+1;}
                return false;
            }
            cached=entry.select(from,to);cachedIndex=0;return true;
        }
        collected=fileStamp.size()<=4*1024*1024L?new ArrayList<>():null;
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
                if (history) checkingRange = new long[]{start, Math.max(start + 1, end)};
                if(start>latestFrom) {latestFrom=start;latestTo=Math.max(start+1,end);}
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

    private void accept(JSONObject record,int ordinal) {
        examined++;totalExamined++;
        JSONObject selected=select(record,0,source.namespace,"source-"+fileIdentity+"-"+ordinal);
        if(selected!=null && source.filter.test(selected)) {
            JSONArray eligible=new JSONArray();eligible.add(selected);
            JSONArray filtered=filter.apply(eligible);
            identify(selected,"source-"+fileIdentity+"-"+ordinal);
            if (history) {
                // Apply the active source and user filters to the full session first.
                // Match only children in the historical domain; annotate once in next().
                for (Object value : filtered) {
                    JSONObject candidate = (JSONObject) value;
                    if (MatchResults.hasMatch(candidate, historyPattern, from, to)) page.add(candidate);
                }
            } else page.addAll(filtered);
        }
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
            if(collected!=null) {
                if(bytes-fileStart<=4*1024*1024L)collected.add((JSONObject)record);else collected=null;
            }
            accept((JSONObject)record,++ordinal);
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
        cached=null;collected=null;
    }
    public void close() {
        closeFile();
        while (!walks.isEmpty()) try { walks.pop().stream.close(); } catch (IOException ignored) {}
        directories.clear(); historyDirectories.clear(); done = true;
    }
}
