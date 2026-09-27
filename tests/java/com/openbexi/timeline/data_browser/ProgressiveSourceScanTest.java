package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ProgressiveSourceScanTest {
    @TempDir Path temporary;
    private JSONObject record(String id, String start, String end) {
        JSONObject record=new JSONObject(); record.put("id",id); record.put("start",start);
        if(end!=null) record.put("end",end);
        String label=Objects.toString(id,"No external ID");
        record.put("series","series_"+(label.hashCode()%5));
        record.put("data",new JSONObject(Map.of("title",label,"status",label.startsWith("normal")?"nominal":"warning")));
        return record;
    }
    private void write(String path, JSONArray records) throws Exception {
        Path file=temporary.resolve(path); Files.createDirectories(file.getParent());
        Files.writeString(file,new JSONObject(Map.of("events",records)).toJSONString());
    }
    private JSONObject configuration() {
        JSONArray sources=new JSONArray(); sources.add(new JSONObject(Map.of("type","json_file","enable",true,
                "namespace","operations","data_model",temporary.resolve("yyyy/mm/dd").toString())));
        return new JSONObject(Map.of("startup configuration",sources,"matchProtocol","1","progressive","1",
                "filter","","search","","scene","0","userName","test","timelineName","sample",
                "startDate","Sat, 12 Sep 2026 00:00:00 GMT","endDate","Sun, 13 Sep 2026 00:00:00 GMT"));
    }
    private JSONObject request(JSONObject config) { return (JSONObject)new json_files_manager(null,null,new data_configuration(config)).getData("","0"); }
    private JSONObject meta(JSONObject page) { return (JSONObject)page.get("timelineMatch"); }

    @Test void streamsDenseFilesBeforeReadingTheArchiveAndResumesWithoutGapsOrDuplicates() throws Exception {
        JSONArray records=new JSONArray();
        for(int i=0;i<1800;i++) records.add(record("current-"+i,"2026-09-12T12:00:00Z",null));
        write("2026/09/12/current.json",records);
        JSONArray old=new JSONArray(); old.add(record("long","2025-01-01T00:00:00Z","2027-01-01T00:00:00Z"));
        write("2025/01/01/long.json",old);
        JSONObject config=configuration(); Set<String> ids=new HashSet<>(); int pages=0; JSONObject page;
        do {
            page=request(config); assertNull(meta(page).get("error"));
            JSONArray batch=(JSONArray)page.get("events");
            assertTrue(batch.size()<=256); assertTrue(((Number)meta(page).get("recordsExamined")).intValue()<=256);
            for(Object value:batch) assertTrue(ids.add((String)((JSONObject)value).get("id")),"No duplicate IDs across pages");
            if(pages==0 && !batch.isEmpty()) {
                assertTrue(((String)((JSONObject)batch.get(0)).get("id")).startsWith("current-"));
                assertEquals(false,meta(page).get("complete"));
                assertTrue(((Number)meta(page).get("charactersRead")).longValue()<Files.size(temporary.resolve("2026/09/12/current.json")));
            }
            config.put("cursor",meta(page).get("nextCursor")); assertTrue(++pages<40);
        } while(config.get("cursor")!=null);
        assertEquals(1801,ids.size()); assertTrue(ids.contains("long")); assertEquals(true,meta(page).get("complete"));
        System.out.println("Progressive fixture: 1801 records, "+pages+" bounded pages; first page precedes full file/archive scan.");
    }

    @Test void preservesNestedSessionContextAndLegacyNamespaceExclusionRules() throws Exception {
        JSONArray records=new JSONArray();
        JSONObject parent=record("session","2025-01-01T00:00:00Z","2027-01-01T00:00:00Z");
        JSONArray children=new JSONArray(); children.add(record("child","2026-09-12T12:00:00Z",null));
        children.add(record("outside","2026-01-01T12:00:00Z",null)); parent.put("activities",children); records.add(parent);
        records.add(record("normal-point","2026-09-12T13:00:00Z",null));
        write("2025/01/01/data.json",records);
        JSONObject config=configuration(); config.put("filter","namespace:operations|status:nominal");
        JSONArray found=new JSONArray(); JSONObject page;
        do { page=request(config); assertNull(meta(page).get("error")); found.addAll((JSONArray)page.get("events")); config.put("cursor",meta(page).get("nextCursor")); }
        while(config.get("cursor")!=null);
        assertEquals(1,found.size()); JSONObject selected=(JSONObject)found.get(0);
        assertEquals("session",selected.get("id")); assertNotNull(selected.get("series"));
        JSONArray selectedChildren=(JSONArray)selected.get("activities"); assertEquals(1,selectedChildren.size());
        assertEquals("operations",((JSONObject)selectedChildren.get(0)).get("namespace"));
        JSONObject legacy=new JSONObject(config); legacy.remove("progressive"); legacy.remove("cursor");
        assertEquals(((JSONArray)request(legacy).get("events")).size(),found.size());
    }

    @Test void mixedNamespacesKeepRecordIdentityStylingAndExclusionsInBothLoaders() throws Exception {
        JSONObject mixed = record("mixed", "2026-09-12T12:00:00Z", "2026-09-12T13:00:00Z");
        ((JSONObject)mixed.get("data")).put("namespace", "planning");
        JSONObject render = new JSONObject(Map.of("image", "images/satellite.png", "color", "#e0bb73"));
        mixed.put("render", render);
        JSONObject explicit = record("explicit", "2026-09-12T12:10:00Z", null);
        explicit.put("namespace", "telemetry");
        ((JSONObject)explicit.get("data")).put("namespace", "ignored-alias");
        JSONObject child = record("child", "2026-09-12T12:15:00Z", null);
        child.put("namespace", " ");
        ((JSONObject)child.get("data")).put("namespace", "science");
        JSONObject inherited = record("inherited", "2026-09-12T12:20:00Z", null);
        JSONArray children = new JSONArray(); children.addAll(java.util.List.of(child, inherited));
        mixed.put("activities", children);
        JSONObject fallback = record("fallback", "2026-09-12T12:30:00Z", null);
        JSONObject excluded = record("normal-hidden", "2026-09-12T12:40:00Z", null);
        JSONArray records = new JSONArray(); records.addAll(java.util.List.of(mixed, explicit, fallback, excluded));
        write("2026/09/12/mixed.json", records);

        for (boolean progressive : new boolean[]{false, true}) {
            JSONObject config = configuration();
            if (!progressive) config.remove("progressive");
            config.put("filter", "|status:nominal");
            JSONArray found = new JSONArray();
            do {
                JSONObject page = request(config);
                assertNull(meta(page).get("error"));
                found.addAll((JSONArray)page.get("events"));
                config.put("cursor", meta(page).get("nextCursor"));
            } while (config.get("cursor") != null);
            assertEquals(3, found.size());
            Map<String, JSONObject> byId = new java.util.HashMap<>();
            for (Object value : found) byId.put((String)((JSONObject)value).get("id"), (JSONObject)value);
            JSONObject session = byId.get("mixed");
            assertEquals("planning", session.get("namespace"));
            assertEquals(render, session.get("render"));
            assertEquals(mixed.get("series"), session.get("series"));
            assertEquals(mixed.get("end"), session.get("end"));
            JSONArray activities = (JSONArray)session.get("activities");
            assertEquals("science", ((JSONObject)activities.get(0)).get("namespace"));
            assertEquals("planning", ((JSONObject)activities.get(1)).get("namespace"));
            assertEquals("telemetry", byId.get("explicit").get("namespace"));
            assertEquals("operations", byId.get("fallback").get("namespace"));
            assertFalse(((JSONObject)mixed.get("data")).containsKey("searchMatch"));

            // Filtering must see the record's namespace, not the provider fallback.
            config.remove("cursor");
            config.put("filter", "namespace:planning|status:nominal");
            found.clear();
            do {
                JSONObject page = request(config);
                assertNull(meta(page).get("error"));
                found.addAll((JSONArray)page.get("events"));
                config.put("cursor", meta(page).get("nextCursor"));
            } while (config.get("cursor") != null);
            assertEquals(1, found.size());
            assertEquals("mixed", ((JSONObject)found.get(0)).get("id"));
        }
    }

    @Test void exclusionsInspectWholeSessionsBeforeChildrenAreScopedToTheViewport() throws Exception {
        JSONObject excluded = record("excluded-parent", "2026-09-12T12:00:00Z", "2026-09-12T13:00:00Z");
        JSONArray children = new JSONArray();
        children.add(record("visible-child", "2026-09-12T12:30:00Z", null));
        children.add(record("normal-outside", "2026-09-11T12:00:00Z", null));
        excluded.put("activities", children);
        JSONObject kept = record("kept", "2026-09-12T12:00:00Z", "2026-09-12T13:00:00Z");
        JSONArray keptChildren = new JSONArray();
        keptChildren.add(record("visible-warning", "2026-09-12T12:30:00Z", null));
        keptChildren.add(record("outside-warning", "2026-09-11T12:00:00Z", null));
        kept.put("activities", keptChildren);
        JSONArray records = new JSONArray(); records.add(excluded); records.add(kept);
        write("2026/09/12/sessions.json", records);
        JSONObject config = configuration();
        json_files_manager legacy = new json_files_manager(null, null, new data_configuration(config));
        assertEquals(1, legacy.filterEvents(records, "", "status:nominal").size());
        for (boolean progressive : new boolean[]{false, true}) {
            config = configuration(); config.put("filter", "|status:nominal");
            if (!progressive) config.remove("progressive");
            JSONArray found = new JSONArray();
            do {
                JSONObject page = request(config);
                assertNull(meta(page).get("error"));
                found.addAll((JSONArray)page.get("events"));
                config.put("cursor", meta(page).get("nextCursor"));
            } while (config.get("cursor") != null);
            assertEquals(1, found.size());
            JSONObject session = (JSONObject)found.get(0);
            assertEquals("kept", session.get("id"));
            assertEquals(1, ((JSONArray)session.get("activities")).size());
            assertEquals("visible-warning", ((JSONObject)((JSONArray)session.get("activities")).get(0)).get("id"));
        }
    }

    @Test void cursorsAreBoundToTheQueryReplaySafelyAndCanBeCancelled() throws Exception {
        JSONArray records=new JSONArray(); for(int i=0;i<800;i++) records.add(record("record-"+i,"2026-09-12T12:00:00Z",null));
        write("2026/09/12/current.json",records); JSONObject config=configuration();
        JSONObject first=request(config); config.put("cursor",meta(first).get("nextCursor"));
        JSONObject second=request(config),replay=request(config);
        assertEquals(second.get("events"),replay.get("events"));
        assertEquals(meta(second).get("uniqueEvents"),meta(replay).get("uniqueEvents"));
        assertEquals("replay",meta(replay).get("cache"));
        JSONObject other=new JSONObject(config); other.put("search","different");
        assertNotNull(meta(request(other)).get("error"));
        config.put("cursor",meta(second).get("nextCursor")); config.put("cancel","1"); request(config);
        config.remove("cancel"); assertNotNull(meta(request(config)).get("error"));
    }

    @Test void brokenFilesProduceExplicitPartialCoverageWithoutDiscardingGoodRecords() throws Exception {
        JSONArray records=new JSONArray(); records.add(record("valid","2026-09-12T12:00:00Z",null));
        write("2026/09/12/current.json",records); Files.writeString(temporary.resolve("bad.json"),"{bad");
        JSONObject config=configuration(), page; JSONArray found=new JSONArray();
        do { page=request(config); found.addAll((JSONArray)page.get("events")); config.put("cursor",meta(page).get("nextCursor")); }
        while(config.get("cursor")!=null);
        assertEquals(1,found.size()); assertEquals(false,meta(page).get("complete")); assertFalse(((JSONArray)meta(page).get("warnings")).isEmpty());
    }

    @Test void completedScansDoNotEvictAnActiveContinuation() throws Exception {
        JSONArray records=new JSONArray();
        for(int i=0;i<800;i++) records.add(record("active-"+i,"2026-09-12T12:00:00Z",null));
        write("active/2026/09/12/current.json",records);
        JSONArray small=new JSONArray(); small.add(record("small","2026-09-12T12:00:00Z",null));
        write("completed.json",small);
        JSONObject active=configuration();
        ((JSONObject)((JSONArray)active.get("startup configuration")).get(0))
                .put("data_model",temporary.resolve("active/yyyy/mm/dd").toString());
        JSONObject page=request(active); assertNull(meta(page).get("error"));
        Set<String> found=new HashSet<>();
        for(Object value:(JSONArray)page.get("events")) found.add((String)((JSONObject)value).get("id"));
        active.put("cursor",meta(page).get("nextCursor"));
        assertNotNull(active.get("cursor"),"Dense scan must retain a continuation");

        // Fill and exceed the shared cache with finished scans, as happens
        // while browsing small intervals or opening several timeline views.
        for(int index=0;index<8;index++) {
            JSONObject complete=configuration(); complete.put("timelineName","completed-"+index);
            ((JSONObject)((JSONArray)complete.get("startup configuration")).get(0))
                    .put("data_model",temporary.resolve("completed.json").toString());
            int pages=0;
            do {
                JSONObject response=request(complete); assertNull(meta(response).get("error"));
                complete.put("cursor",meta(response).get("nextCursor")); assertTrue(++pages<20);
            } while(complete.get("cursor")!=null);
        }

        int pages=0;
        do {
            page=request(active); assertNull(meta(page).get("error"),"Finished replay pages must be evicted before a live scan");
            for(Object value:(JSONArray)page.get("events"))
                assertTrue(found.add((String)((JSONObject)value).get("id")),"No repeated records after cache pressure");
            active.put("cursor",meta(page).get("nextCursor")); assertTrue(++pages<40);
        } while(active.get("cursor")!=null);
        assertEquals(800,found.size()); assertEquals(true,meta(page).get("complete"));
    }

    @Test void occurrenceKeysPreserveReusedEmptyAndNullIdsAcrossPagesAndOverlappingWindows() throws Exception {
        JSONArray records=new JSONArray();
        for(int index=0;index<600;index++) {
            JSONObject value=record(index%3==0?"reused":index%3==1?"":null,"2026-09-12T12:00:00Z",null);
            records.add(value);
        }
        JSONObject session=record("reused","2026-09-12T11:00:00Z","2026-09-12T14:00:00Z");
        JSONArray children=new JSONArray();
        children.add(record("reused","2026-09-12T11:30:00Z",null));
        children.add(record("reused","2026-09-12T12:30:00Z",null));
        session.put("activities",children);records.add(session);
        write("2026/09/12/current.json",records);
        JSONArray separate=new JSONArray();separate.add(record("reused","2026-09-12T12:00:00Z",null));
        write("2026/09/12/separate.json",separate);
        Set<String> originalKeys=null;String laterChildKey=null;
        for(int overlap=0;overlap<2;overlap++) {
            JSONObject config=configuration();
            if(overlap==1) config.put("startDate","2026-09-12T12:00:00Z");
            Set<String> keys=new HashSet<>(); JSONArray found=new JSONArray();JSONObject page;int pages=0;
            do {
                page=request(config);assertNull(meta(page).get("error"));
                JSONArray values=(JSONArray)page.get("events");found.addAll(values);
                for(Object value:values) {
                    JSONObject row=(JSONObject)value;
                    String key=(String)row.get("sourceRecordKey");assertNotNull(key);assertTrue(keys.add(key));
                    assertFalse(key.contains(temporary.toString()),"Occurrence keys never expose paths");
                    if(row.get("activities") instanceof JSONArray activities) {
                        assertEquals(overlap==0?2:1,activities.size());
                        String keyOfLater=(String)((JSONObject)activities.get(activities.size()-1)).get("sourceRecordKey");
                        if(overlap==0) {
                            assertNotEquals(((JSONObject)activities.get(0)).get("sourceRecordKey"),keyOfLater);
                            laterChildKey=keyOfLater;
                        } else assertEquals(laterChildKey,keyOfLater,"Scoping out an earlier child must not renumber a surviving occurrence");
                        assertEquals("reused",((JSONObject)activities.get(0)).get("id"));
                    }
                }
                config.put("cursor",meta(page).get("nextCursor"));assertTrue(++pages<30);
            } while(config.get("cursor")!=null);
            assertEquals(602,found.size());assertEquals(602,keys.size());
            assertEquals(200,found.stream().filter(value->"".equals(((JSONObject)value).get("id"))).count());
            assertEquals(200,found.stream().filter(value->((JSONObject)value).get("id")==null).count());
            assertEquals(1L,meta(page).get("uniqueSessions"));assertEquals(overlap==0?603L:602L,meta(page).get("uniqueEvents"));
            if(originalKeys==null) originalKeys=keys;else assertEquals(originalKeys,keys,"Overlap rereads reuse occurrence identities");
        }
        for(String filter:List.of("", "|sourceRecordKey")) {
            JSONObject config=configuration();config.put("filter",filter);config.put("search","sourceRecordKey");
            int count=0,pages=0;
            do {
                JSONObject page=request(config);assertNull(meta(page).get("error"));
                for(Object value:(JSONArray)page.get("events")) {assertEquals(false,((JSONObject)value).get("searchMatch"));count++;}
                config.put("cursor",meta(page).get("nextCursor"));assertTrue(++pages<30);
            } while(config.get("cursor")!=null);
            assertEquals(602,count,"Internal keys cannot trigger legacy exclusions or search matches");
        }
    }
}
