package com.openbexi.timeline.data_browser;

import org.json.simple.JSONObject;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;

/** Immutable source records, shared across ranges/clients; never caches filtered output. */
final class SourceRecordCache {
    record Stamp(long size,java.nio.file.attribute.FileTime modified,Object key) {
        static Stamp of(BasicFileAttributes a){return new Stamp(a.size(),a.lastModifiedTime(),a.fileKey());}
    }
    record Record(JSONObject value,int ordinal,long from,long to) {}
    record Entry(Stamp stamp,List<Record> records,long[] ends,long characters,long from,long to,long latest) {
        List<Record> select(long from,long to) {
            int low=0,high=ends.length;
            while(low<high){int middle=(low+high)>>>1;if(ends[middle]<from)low=middle+1;else high=middle;}
            List<Record> result=new ArrayList<>();
            for(int index=low;index<records.size() && records.get(index).from<=to;index++)
                if(records.get(index).to>=from)result.add(records.get(index));
            result.sort(Comparator.comparingInt(Record::ordinal));return result;
        }
    }
    private static final Map<Path,Entry> CACHE=new LinkedHashMap<>(16,.75f,true);
    private static long characters;
    static synchronized Entry get(Path path,Stamp stamp) {
        Entry entry=CACHE.get(path);
        if(entry!=null && !entry.stamp.equals(stamp)){CACHE.remove(path);characters-=entry.characters;return null;}
        return entry;
    }
    static synchronized void put(Path path,Stamp stamp,List<JSONObject> records,long size) {
        if(size>4*1024*1024L)return;
        Entry previous=CACHE.remove(path);if(previous!=null)characters-=previous.characters;
        while(!CACHE.isEmpty() && (characters+size>16*1024*1024L || CACHE.size()>=256)) {
            var iterator=CACHE.values().iterator();characters-=iterator.next().characters;iterator.remove();
        }
        long from=Long.MAX_VALUE,to=Long.MIN_VALUE,latest=Long.MIN_VALUE;List<Record> indexed=new ArrayList<>();
        try {
            int ordinal=0;
            for(JSONObject record:records) {
                long start=MatchResults.time(record.get("start"));Object end=record.get("end");
                from=Math.min(from,start);latest=Math.max(latest,start);
                long finish=end==null || end.toString().isBlank()?start:MatchResults.time(end);
                if(finish<start)return;
                to=Math.max(to,finish);indexed.add(new Record(record,++ordinal,start,finish));
            }
        } catch(RuntimeException error){return;}
        indexed.sort(Comparator.comparingLong(Record::from));long[] ends=new long[indexed.size()];long end=Long.MIN_VALUE;
        for(int i=0;i<ends.length;i++){end=Math.max(end,indexed.get(i).to);ends[i]=end;}
        CACHE.put(path,new Entry(stamp,List.copyOf(indexed),ends,size,from,to,latest));characters+=size;
    }
}
