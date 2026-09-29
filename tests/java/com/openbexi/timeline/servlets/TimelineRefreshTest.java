package com.openbexi.timeline.servlets;

import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.json.JSONObject;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;

@Timeout(30)
class TimelineRefreshTest {
    @TempDir Path temporary;
    private Tomcat server;
    private URI base;
    private Path data;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private static final String RANGE="?matchProtocol=1&progressive=1&scene=0&startDate=2026-09-12T00:00:00Z&endDate=2026-09-13T00:00:00Z";

    @BeforeEach void start() throws Exception {
        data=temporary.resolve("data/2026/09/12/events.json");Files.createDirectories(data.getParent());
        write("Initial activity");
        Path yaml=temporary.resolve("sources.yml");
        Files.writeString(yaml,"data_sources:\n  - namespace: sample\n    type: json_file\n    enable: true\n    data_model: "+
                temporary.resolve("data/yyyy/mm/dd").toString().replace('\\','/')+"\n    filter: {include: '', exclude: 'title:Blocked'}\n");
        server=new Tomcat();server.setBaseDir(temporary.resolve("tomcat").toString());server.setPort(0);
        server.getConnector().setProperty("address","127.0.0.1");
        Context context=server.addContext("",temporary.toString());context.addParameter("data_conf",yaml.toString());
        Tomcat.addServlet(context,"rest",new ob_ajax_timeline());context.addServletMappingDecoded("/sessions","rest");
        Tomcat.addServlet(context,"live",new ob_sse_timeline());context.addServletMappingDecoded("/stream","live");
        server.start();base=URI.create("http://127.0.0.1:"+server.getConnector().getLocalPort()+"/");
    }
    @AfterEach void stop() throws Exception {if(server!=null){server.stop();server.destroy();}}
    private void write(String title) throws IOException {
        Files.writeString(data,new JSONObject().put("events",new org.json.JSONArray().put(new JSONObject()
                .put("id","sample").put("start","2026-09-12T12:00:00Z")
                .put("data",new JSONObject().put("title",title)))).toString());
    }
    private HttpResponse<String> read(String etag) throws Exception {
        var builder=HttpRequest.newBuilder(base.resolve("sessions"+RANGE)).timeout(Duration.ofSeconds(5)).header("Accept","application/json");
        if(etag!=null)builder.header("If-None-Match",etag);
        return client.send(builder.GET().build(),HttpResponse.BodyHandlers.ofString());
    }
    private HttpURLConnection connect(String previous) throws Exception {
        var connection=(HttpURLConnection)base.resolve("stream?live=1").toURL().openConnection();
        connection.setConnectTimeout(3000);connection.setReadTimeout(4000);
        connection.setRequestProperty("Accept","text/event-stream");
        if(previous!=null)connection.setRequestProperty("Last-Event-ID",previous);
        assertEquals(200,connection.getResponseCode());
        assertEquals("*",connection.getHeaderField("Access-Control-Allow-Origin"));
        assertTrue(connection.getContentType().startsWith("text/event-stream"));
        return connection;
    }
    private String revision(BufferedReader reader) throws IOException {
        String id=null;
        for(String line;(line=reader.readLine())!=null;) {
            if(line.startsWith("id: "))id=line.substring(4);
            if(line.startsWith("data: ")) {
                assertEquals(id,new JSONObject(line.substring(6)).getString("revision"));return id;
            }
        }
        throw new EOFException("Missing source revision");
    }

    @Test void historicalHttpSearchReachesMayAndDoesNotReuseAVisibleWindowEtag() throws Exception {
        Path earlier = temporary.resolve("data/2026/05/21/events.json"); Files.createDirectories(earlier.getParent());
        Files.writeString(earlier, new JSONObject().put("events", new org.json.JSONArray()
                .put(new JSONObject().put("id", "earlier").put("start", "2026-05-21T12:00:00Z")
                        .put("data", new JSONObject().put("title", "locked signal")))
                .put(new JSONObject().put("id", "excluded").put("start", "2026-05-21T12:00:00Z")
                        .put("data", new JSONObject().put("title", "Blocked locked signal")))) .toString());
        String url = "sessions" + RANGE + "&search=locked&filter=namespace%3Asample&sortBy=namespace";
        var visible = client.send(HttpRequest.newBuilder(base.resolve(url)).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, visible.statusCode());
        String tag = visible.headers().firstValue("ETag").orElseThrow();
        var initial = client.send(HttpRequest.newBuilder(base.resolve(url + "&history=backward"))
                .header("If-None-Match", tag).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, initial.statusCode(), "Visible-window ETag cannot suppress a historical search");
        assertTrue(initial.headers().firstValue("ETag").isEmpty(), "History begins without an up-front full archive inventory");
        JSONObject payload = new JSONObject(initial.body()), metadata; org.json.JSONArray found = new org.json.JSONArray();
        int pages = 0;
        while (true) {
            metadata = payload.getJSONObject("timelineMatch"); assertFalse(metadata.has("error"));
            assertEquals("backward", metadata.getJSONObject("history").getString("direction"));
            for (Object value : payload.getJSONArray("events")) found.put(value);
            if (metadata.isNull("nextCursor")) break;
            String cursor = URLEncoder.encode(metadata.getString("nextCursor"), StandardCharsets.UTF_8);
            var response = client.send(HttpRequest.newBuilder(base.resolve(url + "&history=backward&cursor=" + cursor))
                    .GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, response.statusCode()); payload = new JSONObject(response.body()); assertTrue(++pages < 40);
        }
        assertEquals(1, found.length()); assertEquals("earlier", found.getJSONObject(0).getString("id"));
        assertTrue(found.getJSONObject(0).getBoolean("searchMatch"));
        assertTrue(metadata.getJSONObject("history").getBoolean("exhausted"));
        assertFalse(metadata.getJSONObject("history").getBoolean("incomplete"));
    }

    @Test void conditionalRestReadsAndResumedLiveUpdatesTrackEditsAndDeletes() throws Exception {
        var preflight=client.send(HttpRequest.newBuilder(base.resolve("sessions"))
                .header("Origin","https://example.test").header("Access-Control-Request-Headers","if-none-match")
                .method("OPTIONS",HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(204,preflight.statusCode());
        assertTrue(preflight.headers().firstValue("Access-Control-Allow-Headers").orElseThrow().contains("If-None-Match"));
        var first=read(null);assertEquals(200,first.statusCode());
        String etag=first.headers().firstValue("ETag").orElseThrow();
        String original=first.headers().firstValue("X-Timeline-Revision").orElseThrow();
        assertTrue(first.headers().firstValue("Access-Control-Expose-Headers").orElseThrow().contains("ETag"));
        var unchanged=read(etag);assertEquals(304,unchanged.statusCode());assertEquals("",unchanged.body());
        var connection=connect(null);
        try(var reader=new BufferedReader(new InputStreamReader(connection.getInputStream(),StandardCharsets.UTF_8))) {
            assertEquals(original,revision(reader));
        } finally {connection.disconnect();}
        connection=connect(original);
        try(var reader=new BufferedReader(new InputStreamReader(connection.getInputStream(),StandardCharsets.UTF_8))) {
            String line;
            do {line=reader.readLine();assertNotNull(line);assertFalse(line.startsWith("id:"),"Reconnect must not repeat an unchanged revision");}
            while(!line.startsWith(": heartbeat"));
            write("Edited activity with a new title");
            String updated=revision(reader);assertNotEquals(original,updated);
            var edited=read(etag);assertEquals(200,edited.statusCode());assertTrue(edited.body().contains("Edited activity"));
            var metadata=new JSONObject(edited.body()).getJSONObject("timelineMatch");
            assertEquals("2026-09-12T12:00:00Z",metadata.getJSONObject("latestRange").getString("from"));
            String editedTag=edited.headers().firstValue("ETag").orElseThrow();assertNotEquals(etag,editedTag);
            Files.delete(data);
            assertNotEquals(updated,revision(reader));
            var removed=read(editedTag);assertEquals(200,removed.statusCode());
            assertEquals(0,new JSONObject(removed.body()).getJSONArray("events").length());
        } finally {connection.disconnect();}
    }

    @Test void restAndSseApplySavedAndExplicitFiltersBeforeReturningRecords() throws Exception {
        var events=new org.json.JSONArray();
        for(String title:new String[]{"Wanted A+B | ready","Other","Blocked"})events.put(new JSONObject()
                .put("id",title).put("start","2026-09-12T12:00:00Z").put("data",new JSONObject().put("title",title)));
        Files.writeString(data,new JSONObject().put("events",events).toString());
        String user="http_filter_"+java.util.UUID.randomUUID().toString().replace("-","");
        Path profile=Path.of("filters",user+"_sample_filter_setting.json");
        String identity="&userName="+user+"&timelineName=sample";
        String expression="expr: title CONTAINS \"A+B | ready\"";
        String encoded=URLEncoder.encode(expression,StandardCharsets.UTF_8);
        try {
            var saved=client.send(HttpRequest.newBuilder(base.resolve("stream?ob_request=saveFilter"+identity+
                    "&scene=0&filterName=Advanced&sortBy=namespace&filter="+encoded))
                    .header("Accept","application/json").POST(HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());
            assertEquals(200,saved.statusCode());assertEquals("0",new JSONObject(saved.body()).getString("scene"));
            assertEquals("namespace",new JSONObject(saved.body()).getJSONArray("openbexi_timeline").getJSONObject(0).getJSONArray("filters").getJSONObject(0).getString("sortBy"));
            for(String route:new String[]{"sessions","stream"}) {
                var filtered=client.send(HttpRequest.newBuilder(base.resolve(route+RANGE+identity)).header("Accept","application/json").GET().build(),HttpResponse.BodyHandlers.ofString());
                assertEquals(200,filtered.statusCode());var records=new JSONObject(filtered.body()).getJSONArray("events");
                assertEquals(1,records.length());assertEquals("Wanted A+B | ready",records.getJSONObject(0).getString("id"));
                var explicit=client.send(HttpRequest.newBuilder(base.resolve(route+RANGE+identity+"&filter="))
                        .header("Accept","application/json").GET().build(),HttpResponse.BodyHandlers.ofString());
                assertEquals(2,new JSONObject(explicit.body()).getJSONArray("events").length(),"Configured exclusions still apply when the user clears a filter");
            }
            String before=Files.readString(profile);
            var invalid=client.send(HttpRequest.newBuilder(base.resolve("sessions?ob_request=saveFilter"+identity+
                    "&filterName=Advanced&filter="+URLEncoder.encode("expr: title =",StandardCharsets.UTF_8)))
                    .header("Accept","application/json").POST(HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());
            assertEquals(400,invalid.statusCode());assertTrue(invalid.body().contains("character"));assertEquals(before,Files.readString(profile));
        } finally {Files.deleteIfExists(profile);}
    }
}
