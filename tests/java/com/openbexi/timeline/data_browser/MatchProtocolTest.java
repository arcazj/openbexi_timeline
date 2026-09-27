package com.openbexi.timeline.data_browser;

import com.openbexi.timeline.servlets.ob_ajax_timeline;
import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import javax.servlet.http.HttpServletRequest;
import java.lang.reflect.Proxy;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class MatchProtocolTest {
    @TempDir Path temporary;
    private static final long FROM = MatchResults.time("2026-09-12T00:00:00Z");
    private static final long TO = FROM + 86400000;
    private JSONObject json(String text) throws Exception { return (JSONObject) new JSONParser().parse(text); }
    private JSONObject metadata(JSONObject response) { return (JSONObject) response.get("timelineMatch"); }
    private JSONObject record(String id, String title, String from, String to) {
        JSONObject event = new JSONObject(); event.put("id", id); event.put("start", from);
        if (to != null) event.put("end", to);
        event.put("data", new JSONObject(Map.of("title", title)));
        event.put("render", new JSONObject(Map.of("color", "#ffe400")));
        return event;
    }
    private JSONObject config(String query) {
        JSONObject config = new JSONObject();
        config.put("matchProtocol", "1"); config.put("search", query); config.put("filter", ""); config.put("scene", "0");
        config.put("startDate", "Sat, 12 Sep 2026 00:00:00 GMT"); config.put("endDate", "Sun, 13 Sep 2026 00:00:00 GMT");
        JSONArray sources = new JSONArray();
        sources.add(new JSONObject(Map.of("type", "json_file", "enable", true, "namespace", "hazards", "data_model", temporary.resolve("data/yyyy/mm/dd").toString())));
        config.put("startup configuration", sources); return config;
    }
    private Path write(String path, JSONObject record) throws Exception {
        Path file = temporary.resolve("data/"+path); Files.createDirectories(file.getParent());
        JSONArray records = new JSONArray(); records.add(record);
        Files.writeString(file, new JSONObject(Map.of("events", records)).toJSONString()); return file;
    }

    @Test void directMatchingKeepsLegacyRegexMeaningAndDoesNotPromoteChildrenOrChangeSourceColors() {
        JSONObject parent = record("session", "ordinary", "2026-09-12T01:00:00Z", "2026-09-12T22:00:00Z");
        JSONArray children = new JSONArray(); children.add(record("child", "volcano", "2026-09-12T12:00:00Z", null)); parent.put("activities", children);
        JSONArray events = new JSONArray(); events.add(parent);
        String before = events.toJSONString();
        JSONObject response = MatchResults.envelope(events, "volcano;eruption", "0", FROM, TO, true);
        JSONObject copy = (JSONObject) ((JSONArray) response.get("events")).get(0);
        assertEquals(false, copy.get("searchMatch"));
        assertEquals(true, ((JSONObject) ((JSONArray) copy.get("activities")).get(0)).get("searchMatch"));
        assertEquals(before, events.toJSONString());
        assertEquals("#ffe400", ((JSONObject) copy.get("render")).get("color"));
        assertEquals(false, metadata(MatchResults.envelope(events, "*", "0", FROM, TO, true)).get("hasCondition"));
        assertEquals("Invalid search expression.", metadata(MatchResults.envelope(events, "[", "0", FROM, TO, true)).get("error"));
    }

    @Test void fullInventoryFindsLongSessionsInEarlierPartitionsAndWatcherDetectsTheirUpdates() throws Exception {
        Path file = write("2025/01/01/long.json", record("long", "volcano", "2025-01-01T00:00:00Z", "2027-01-01T00:00:00Z"));
        write("2026/09/12/descriptors/hidden.json", record("descriptor", "volcano", "2026-09-12T12:00:00Z", null));
        write("2026/09/12/descriptors.json", record("descriptor-file", "volcano", "2026-09-12T12:00:00Z", null));
        write("2026/09/12/monitor_noises.json", record("noise-file", "volcano", "2026-09-12T12:00:00Z", null));
        write("2026/09/12/point.json", record("point", "earthquake", "2026-09-12T12:00:00Z", null));
        String original = Files.readString(file);
        json_files_manager manager = new json_files_manager(null,null,new data_configuration(config("volcano")));
        JSONObject response = (JSONObject) manager.getData("", "0");
        assertEquals(true, metadata(response).get("complete"));
        assertEquals(2, ((JSONArray)response.get("events")).size());
        assertEquals(original, Files.readString(file));
        assertTrue(manager.checkIfJsonFilesChanged()); manager.getData("", "0");
        assertFalse(manager.checkIfJsonFilesChanged());
        Files.writeString(file, original.replace("volcano", "eruption"));
        assertTrue(manager.checkIfJsonFilesChanged());
        JSONObject changed = (JSONObject) manager.getData("", "0");
        assertNotEquals(metadata(response).get("revision"), metadata(changed).get("revision"));
    }

    @Test void inaccessibleSourcesAndPartialScansNeverClaimCompleteCoverage() throws Exception {
        json_files_manager missing = new json_files_manager(null,null,new data_configuration(config("")));
        assertNotNull(metadata((JSONObject)missing.getData("", "0")).get("error"));
        String deep = "nested/".repeat(32);
        write(deep+"point.json", record("point", "volcano", "2026-09-12T12:00:00Z", null));
        assertEquals(false, metadata((JSONObject)missing.getData("", "0")).get("complete"));
    }

    @Test void legacyEmptyEndsRemainPointEventsAcrossInventoryAndNestedActivities() throws Exception {
        // Real hazard files have a legacy date string and end:"", including old partitions.
        write("2024/07/30/old.json", record("old", "earthquake", "Tue Jul 30 20:50:03 UTC 2024", ""));
        write("2026/09/12/point.json", record("point", "earthquake", "Sat Sep 12 12:00:00 UTC 2026", ""));
        JSONObject parent = record("parent", "session", "2026-09-12T01:00:00Z", "2026-09-12T23:00:00Z");
        JSONArray children = new JSONArray();
        children.add(record("child", "volcano", "2026-09-12T12:00:00Z", ""));
        children.add(record("blank", "volcano", "2026-09-12T13:00:00Z", " "));
        parent.put("activities", children);
        Path file = write("2026/09/12/session.json", parent);
        String original = Files.readString(file);
        JSONObject response = (JSONObject) new json_files_manager(null, null, new data_configuration(config("volcano"))).getData("", "0");
        assertEquals(true, metadata(response).get("complete"));
        assertNull(metadata(response).get("error"));
        JSONArray events = (JSONArray) response.get("events");
        assertEquals(2, events.size());
        JSONObject session = (JSONObject) events.stream().filter(e -> "parent".equals(((JSONObject)e).get("id"))).findFirst().orElseThrow();
        assertEquals(2, ((JSONArray)session.get("activities")).size());
        assertEquals(true, ((JSONObject)((JSONArray)session.get("activities")).get(0)).get("searchMatch"));
        assertEquals(original, Files.readString(file));
        JSONArray invalid = new JSONArray();
        invalid.add(record("invalid", "event", "2026-09-12T12:00:00Z", "not-a-date"));
        assertThrows(IllegalArgumentException.class, () -> MatchResults.inRange(invalid, FROM, TO));
    }

    @Test void filterStartupDoesNotParseMissingDatesOrPrintNullErrors() {
        JSONObject configuration = config("");
        configuration.remove("startDate"); configuration.remove("endDate");
        configuration.put("request", "readFilters");
        var output = new java.io.ByteArrayOutputStream();
        var previous = System.err;
        try {
            System.setErr(new java.io.PrintStream(output));
            json_files_manager manager = new json_files_manager(null,null,new data_configuration(configuration));
            assertNull(manager._currentStartDate);
            assertNull(manager._currentEndDate);
        } finally { System.setErr(previous); }
        assertEquals("", output.toString());
    }

    @Test void badArchiveRecordsFilesAndMissingSourcesDoNotDiscardValidCurrentData() throws Exception {
        Path bad = write("2023/05/30/invalid.json", record("bad", "old", "Tue May 30 03:37:21 UTC 2023", "Tue May 30 03:36:21 UTC 2023"));
        String original = Files.readString(bad);
        JSONObject parent = record("session", "current", "2026-09-12T00:00:00Z", "2026-09-12T23:00:00Z");
        JSONArray children = new JSONArray();
        children.add(record("valid", "volcano", "2026-09-12T12:00:00Z", ""));
        children.add(record("invalid", "bad child", "2026-09-12T13:00:00Z", "2026-09-12T12:00:00Z"));
        parent.put("activities", children);
        write("2026/09/12/current.json", parent);
        Files.writeString(temporary.resolve("data/2026/09/12/broken.json"), "{invalid");
        JSONObject configuration = config("volcano");
        JSONArray sources = (JSONArray)configuration.get("startup configuration");
        sources.add(new JSONObject(Map.of("type","json_file","namespace","missing-source","data_model",temporary.resolve("missing/yyyy/mm/dd").toString())));
        JSONObject response = (JSONObject)new json_files_manager(null,null,new data_configuration(configuration)).getData("", "0");
        assertNull(metadata(response).get("error"));
        assertEquals(false, metadata(response).get("complete"));
        JSONArray events = (JSONArray)response.get("events");
        assertEquals(1, events.size());
        JSONArray activities = (JSONArray)((JSONObject)events.get(0)).get("activities");
        assertEquals(1, activities.size());
        assertEquals("valid", ((JSONObject)activities.get(0)).get("id"));
        assertEquals(true, ((JSONObject)activities.get(0)).get("searchMatch"));
        String warnings = metadata(response).get("warnings").toString();
        assertTrue(warnings.contains("Invalid records skipped: 2"));
        assertTrue(warnings.contains("Unreadable data files skipped: 1"));
        assertTrue(warnings.contains("missing-source"));
        assertEquals(original, Files.readString(bad));
    }

    @Test void boundedArchiveScanLoadsRequestedPartitionsBeforeOldFiles() throws Exception {
        for (int i=0; i<4; i++) write("2023/05/30/old"+i+".json", record("old"+i,"old","2023-05-30T00:00:00Z",null));
        write("2026/09/12/current.json", record("current","volcano","2026-09-12T12:00:00Z",null));
        JSONArray sources = (JSONArray)config("volcano").get("startup configuration");
        JSONObject response = new MatchSourceScan(FROM,TO,events->events,2,1024*1024).read(sources,"volcano","0");
        assertNull(metadata(response).get("error"));
        assertEquals(false,metadata(response).get("complete"));
        assertTrue(metadata(response).get("warnings").toString().contains("Archive scan limit"));
        JSONArray events = (JSONArray)response.get("events");
        assertEquals(1, events.size());
        assertEquals("current",((JSONObject)events.get(0)).get("id"));
    }

    @Test void mixedLegacyTimezoneDatesUseServerInstantsWithoutChangingSearchMeaning() throws Exception {
        write("2026/09/12/current.json", record("mixed", "mixed dates", "Sat Sep 12 16:43:35 2026", "Sat Sep 12 17:56:56 UTC 2026"));
        JSONObject response = (JSONObject)new json_files_manager(null,null,new data_configuration(config("Sat"))).getData("", "0");
        JSONObject event = (JSONObject)((JSONArray)response.get("events")).get(0);
        assertEquals("2026-09-12T16:43:35Z",event.get("start"));
        assertEquals("2026-09-12T17:56:56Z",event.get("end"));
        assertEquals(true,event.get("searchMatch"));
    }

    @Test void eachRequestOwnsItsQueryFiltersAndSourceConfiguration() {
        data_configuration original = new data_configuration(config(""));
        java.util.function.Function<String,HttpServletRequest> request = query -> (HttpServletRequest) Proxy.newProxyInstance(
            HttpServletRequest.class.getClassLoader(), new Class[]{HttpServletRequest.class}, (proxy, method, args) ->
                method.getName().equals("getParameter") ? (args[0].equals("search") ? query : null) :
                    method.getName().equals("getMethod") ? "GET" : null);
        data_configuration first = original.forRequest(request.apply("volcano"));
        data_configuration second = original.forRequest(request.apply("earthquake"));
        assertEquals("volcano", first.getConfiguration().get("search"));
        assertEquals("earthquake", second.getConfiguration().get("search"));
        assertEquals("", original.getConfiguration().get("search"));
        first.getConfiguration(0).put("namespace", "changed");
        assertEquals("hazards", second.getConfiguration(0).get("namespace"));
    }

    @Test void actualHttpServletReturnsCompleteMatchProtocolAndEmptyResultsWithoutDummyEvents() throws Exception {
        var logged=new java.util.concurrent.ConcurrentHashMap<String,org.json.JSONObject>();
        var log=java.util.logging.Logger.getLogger(com.openbexi.timeline.servlets.TimelineRequestLog.class.getName());
        var capture=new java.util.logging.Handler() {
            public void publish(java.util.logging.LogRecord record) {
                if(record.getMessage().startsWith("timeline ")) { var item=new org.json.JSONObject(record.getMessage().substring(9));logged.put(item.getString("requestId"),item); }
            }
            public void flush() {} public void close() {}
        };
        log.addHandler(capture);
        write("2025/01/01/long.json", record("long", "volcano", "2025-01-01T00:00:00Z", "2027-01-01T00:00:00Z"));
        Path yaml = temporary.resolve("sources.yml");
        String template = Files.readString(Path.of("yaml/sources_default.yml"));
        Files.writeString(yaml, template.replace("/data/", temporary.resolve("data").toString().replace('\\','/')+"/"));
        Tomcat server = new Tomcat(); server.setBaseDir(temporary.resolve("tomcat").toString()); server.setPort(0);
        server.getConnector().setProperty("address","127.0.0.1");
        Context context = server.addContext("",temporary.toString()); context.addParameter("data_conf",yaml.toString());
        Tomcat.addServlet(context,"timeline",new ob_ajax_timeline()); context.addServletMappingDecoded("/sessions","timeline");
        try {
            server.start();
            String base = "http://127.0.0.1:"+server.getConnector().getLocalPort()+"/sessions?matchProtocol=1&scene=0&search=volcano&startDate="+
                URLEncoder.encode("Sat, 12 Sep 2026 00:00:00 GMT",StandardCharsets.UTF_8)+"&endDate="+
                URLEncoder.encode("Sun, 13 Sep 2026 00:00:00 GMT",StandardCharsets.UTF_8);
            HttpClient client = HttpClient.newHttpClient();
            HttpResponse<String> result = client.send(HttpRequest.newBuilder(URI.create(base)).header("Accept","application/json")
                .timeout(Duration.ofSeconds(10)).GET().build(),HttpResponse.BodyHandlers.ofString());
            assertEquals(200,result.statusCode()); JSONObject response=json(result.body());
            assertTrue(result.headers().firstValue("X-Request-ID").isPresent());
            assertEquals(true,metadata(response).get("complete"));
            assertEquals(true,((JSONObject)((JSONArray)response.get("events")).get(0)).get("searchMatch"));
            String empty = base.replace("12+Sep", "14+Sep").replace("2026+00", "2028+00").replace("13+Sep", "15+Sep");
            HttpResponse<String> none = client.send(HttpRequest.newBuilder(URI.create(empty)).header("Accept","application/json")
                .GET().build(),HttpResponse.BodyHandlers.ofString());
            assertEquals(0,((JSONArray)json(none.body()).get("events")).size());
            JSONArray dense=new JSONArray();
            for (int i=0;i<600;i++) dense.add(record("current-"+i,"volcano","2026-09-12T12:00:00Z",null));
            Path denseFile=temporary.resolve("data/2026/09/12/dense.json"); Files.createDirectories(denseFile.getParent());
            Files.writeString(denseFile,new JSONObject(Map.of("events",dense)).toJSONString());
            long before=System.nanoTime();
            HttpResponse<String> legacy=client.send(HttpRequest.newBuilder(URI.create(base)).header("Accept","application/json")
                    .GET().build(),HttpResponse.BodyHandlers.ofString());
            long legacyMillis=(System.nanoTime()-before)/1_000_000;
            String cursor=null; int pages=0; java.util.Set<String> ids=new java.util.HashSet<>();
            var expectedCounts=new java.util.HashMap<String,Map<String,Object>>();
            do {
                String request=base+"&progressive=1&loadId=synthetic-http-load&purpose=initial"+(cursor==null?"":"&cursor="+URLEncoder.encode(cursor,StandardCharsets.UTF_8));
                before=System.nanoTime();
                HttpResponse<String> chunk=client.send(HttpRequest.newBuilder(URI.create(request)).header("Accept","application/json")
                        .GET().build(),HttpResponse.BodyHandlers.ofString());
                JSONObject payload=json(chunk.body()), meta=metadata(payload);
                assertEquals(true,meta.get("progressive")); assertNull(meta.get("error"));
                JSONArray entries=(JSONArray)payload.get("events"); assertTrue(entries.size()<=256);
                expectedCounts.put(chunk.headers().firstValue("X-Request-ID").orElseThrow(),
                        com.openbexi.timeline.servlets.TimelineRequestLog.counts(entries));
                for(Object value:entries) assertTrue(ids.add((String)((JSONObject)value).get("id")));
                if(pages==0) {
                    assertEquals(false,meta.get("complete"));
                    assertTrue(chunk.body().length()<legacy.body().length());
                    System.out.println("HTTP startup fixture: legacy "+legacyMillis+" ms / "+legacy.body().length()+
                            " characters; first batch "+((System.nanoTime()-before)/1_000_000)+" ms / "+chunk.body().length()+" characters.");
                }
                cursor=(String)meta.get("nextCursor");assertTrue(++pages<12);
            } while(cursor!=null);
            assertEquals(601,ids.size());
            long deadline=System.nanoTime()+2_000_000_000L;
            while(!logged.keySet().containsAll(expectedCounts.keySet()) && System.nanoTime()<deadline) Thread.sleep(10);
            for(var expected:expectedCounts.entrySet()) {
                var summary=logged.get(expected.getKey());assertNotNull(summary);
                assertEquals(((Number)expected.getValue().get("sessions")).longValue(),summary.getLong("sessionsReturned"));
                assertEquals(((Number)expected.getValue().get("events")).longValue(),summary.getLong("eventsReturned"));
                assertEquals("synthetic-http-load",summary.getString("loadId"));
            }
        } finally {log.removeHandler(capture);server.stop(); server.destroy();}
    }
}
