package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class CollectorPublicationTest {
    @Test void partitionedCursorKeepsItsGenerationAfterIndexReplacement() throws Exception {
        JSONArray records = new JSONArray();
        Set<String> expected = new HashSet<>();
        for (int i = 0; i < 300; i++) { records.add(event("old-"+i)); expected.add("old-"+i); }
        byte[] raw = new JSONObject(Map.of("version",1,"events",records)).toJSONString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
        String hash = HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(raw));
        Path part = root.resolve(".timeline-collector/parts/"+hash+".json");
        Files.createDirectories(part.getParent()); Files.write(part,raw);
        write(".timeline-collector/publication.json",new JSONObject(Map.of("version",2,"generation","old","record_count",300,
                "event_parts",array(new JSONObject(Map.of("path","parts/"+hash+".json","sha256",hash,"bytes",raw.length,"records",300))))));
        JSONObject config = configuration(true);
        Set<String> found = new HashSet<>();
        int pages = 0;
        do {
            JSONObject page = (JSONObject)new json_files_manager(null,null,new data_configuration(config)).getData("","0");
            for (Object item : (JSONArray)page.get("events")) found.add(((JSONObject)item).get("id").toString());
            JSONObject metadata = (JSONObject)page.get("timelineMatch");
            assertNull(metadata.get("error"),metadata.toJSONString());
            config.put("cursor",metadata.get("nextCursor"));
            if (pages++ == 0) {
                assertNotNull(config.get("cursor"));
                write(".timeline-collector/publication.json",new JSONObject(Map.of("version",1,"generation","new","events",array(event("new")))));
            }
            if (config.get("cursor") == null) assertEquals(true,metadata.get("complete"),metadata.toJSONString());
            assertTrue(pages < 20);
        } while (config.get("cursor") != null);
        assertEquals(expected,found);
        assertEquals(Set.of("new"),read(true));
    }

    @Test void partitionedPublicationReadsCompleteEventsAndRejectsCorruption() throws Exception {
        JSONArray parts = new JSONArray();
        for (String id : List.of("one", "two")) {
            byte[] raw = new JSONObject(Map.of("version", 1, "events", array(event(id)))).toJSONString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
            String hash = HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(raw));
            String name = "parts/"+hash+".json";
            Path path = root.resolve(".timeline-collector/"+name); Files.createDirectories(path.getParent()); Files.write(path,raw);
            parts.add(new JSONObject(Map.of("path",name,"sha256",hash,"bytes",raw.length,"records",1)));
        }
        write(".timeline-collector/publication.json",new JSONObject(Map.of("version",2,"generation","parts","record_count",2,"event_parts",parts)));
        for (boolean progressive : List.of(false,true)) assertEquals(Set.of("one","two"),read(progressive));
        assertEquals("two", CollectorPublication.find((JSONArray)CollectorPublication.read(root).get("events"),"two").get("id"));
        Files.writeString(root.resolve(".timeline-collector/"+((JSONObject)parts.get(0)).get("path")), "broken");
        assertThrows(java.io.IOException.class, () -> CollectorPublication.read(root));
    }

    @TempDir Path root;
    JSONObject event(String id) {
        return new JSONObject(Map.of("id",id,"start","2026-09-12T12:00:00Z","end","","data",new JSONObject(Map.of("title",id))));
    }
    void write(String relative, JSONObject value) throws Exception {
        Path path=root.resolve(relative);Files.createDirectories(path.getParent());Files.writeString(path,value.toJSONString());
    }
    JSONArray array(JSONObject... records) {JSONArray values=new JSONArray();values.addAll(List.of(records));return values;}
    JSONObject configuration(boolean progressive) {
        JSONObject source=new JSONObject(Map.of("type","json_file","enable",true,"namespace","EXAMPLE","data_model",root.resolve("yyyy/mm/dd").toString()));
        return new JSONObject(Map.of("startup configuration",array(source),"matchProtocol","1","progressive",progressive?"1":"0",
                "filter","","search","","scene","0","startDate","Sat, 12 Sep 2026 00:00:00 GMT","endDate","Sun, 13 Sep 2026 00:00:00 GMT"));
    }
    Set<String> read(boolean progressive) {
        JSONObject config=configuration(progressive);Set<String> found=new HashSet<>();int pages=0;
        do {
            JSONObject page=(JSONObject)new json_files_manager(null,null,new data_configuration(config)).getData("","0");
            for(Object item:(JSONArray)page.get("events"))found.add(((JSONObject)item).get("id").toString());
            JSONObject metadata=(JSONObject)page.get("timelineMatch");
            assertNull(metadata.get("error"),metadata.toJSONString());
            if (metadata.get("nextCursor") == null)
                assertEquals(true,metadata.get("complete"),metadata.toJSONString());
            config.put("cursor",metadata.get("nextCursor"));assertTrue(++pages<20);
        } while(config.get("cursor")!=null);
        return found;
    }
    @Test void committedSnapshotIsIndependentOfPartiallyWrittenCompatibilityExports() throws Exception {
        write("2026/09/12/events.json",new JSONObject(Map.of("events",array(event("legacy")))));
        write("2026/09/12/timeline_0123456789ab_report.json",new JSONObject(Map.of("events",array(event("uncommitted")))));
        write("2026/09/12/EXAMPLE_0_1_2026-09-12T12Z.json",new JSONObject(Map.of("events",array(event("hourly-uncommitted")))));
        write(".timeline-collector/pending.json",new JSONObject(Map.of("generation","next","files",new JSONArray())));
        for(boolean progressive:List.of(false,true))assertEquals(Set.of("legacy"),read(progressive));
        JSONArray baseline=new JSONArray();baseline.add("2026/09/12/events.json");
        write(".timeline-collector/publication.json",new JSONObject(Map.of("version",1,"generation","current","events",array(event("legacy"),event("published")),"baseline_reports",baseline)));
        for(boolean progressive:List.of(false,true))assertEquals(Set.of("legacy","published"),read(progressive));
        write("2026/09/12/manual.json",new JSONObject(Map.of("events",array(event("manual")))));
        for(boolean progressive:List.of(false,true))assertEquals(Set.of("legacy","published","manual"),read(progressive));
    }
    @Test void descriptorsUseCommittedSnapshotWithoutCollectorDependencies() throws Exception {
        JSONObject parent=event("session");parent.put("activities",array(event("child")));
        write(".timeline-collector/publication.json",new JSONObject(Map.of("version",1,"generation","current","events",array(parent))));
        var config=new data_configuration(configuration(false));
        for(String identity:List.of("session","child")) {
            var descriptor=new event_descriptor(identity,"","2026-09-12T12:00:00Z","","","EXAMPLE","","","","","","",config);
            JSONObject body=(JSONObject)descriptor.read(identity);
            assertEquals(identity,((JSONObject)((JSONArray)body.get("event_descriptor")).get(0)).get("id"));
        }
    }
    @Test void hourlyFilesAreReadableWithoutCollectorState() throws Exception {
        write("2026/09/12/EXAMPLE_0_1_2026-09-12T12Z.json", new JSONObject(Map.of("events", array(event("hourly")))));
        for (boolean progressive: List.of(false,true)) assertEquals(Set.of("hourly"),read(progressive));
    }
}
