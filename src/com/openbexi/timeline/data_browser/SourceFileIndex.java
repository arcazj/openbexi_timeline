package com.openbexi.timeline.data_browser;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/** Small, query-independent file summaries survive eviction of the much larger record cache. */
final class SourceFileIndex {
    record Span(long from, long to) {}
    record Problem(String code, String message, String reason, String action) {}
    record Entry(SourceRecordCache.Stamp stamp, Span earliest, Span furthestEnd, Span latest, Problem problem) {
        boolean outside(long from, long to) {
            return earliest == null || earliest.from > to || furthestEnd.to < from;
        }
    }

    static final class Builder {
        private Span earliest, furthestEnd, latest;
        private boolean valid = true;

        void add(long from, long to) {
            Span span = new Span(from, to);
            if (earliest == null || from < earliest.from) earliest = span;
            if (furthestEnd == null || to > furthestEnd.to) furthestEnd = span;
            if (latest == null || from > latest.from) latest = span;
        }

        void invalidate() { valid = false; }

        Entry finish(SourceRecordCache.Stamp stamp, Problem problem) {
            return valid ? new Entry(stamp, earliest, furthestEnd, latest, problem) : null;
        }
    }

    private static final int MAX_FILES = 10_000;
    private static final Map<Path, Entry> CACHE = new LinkedHashMap<>(16, .75f, true);

    static synchronized Entry get(Path path, SourceRecordCache.Stamp stamp) {
        Entry entry = CACHE.get(path);
        if (entry != null && !entry.stamp.equals(stamp)) { CACHE.remove(path); return null; }
        return entry;
    }

    static synchronized void put(Path path, Entry entry) {
        if (entry == null) return;
        CACHE.put(path, entry);
        while (CACHE.size() > MAX_FILES) {
            var iterator = CACHE.keySet().iterator(); iterator.next(); iterator.remove();
        }
    }
}
