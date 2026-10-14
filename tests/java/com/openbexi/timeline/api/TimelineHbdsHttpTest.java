package com.openbexi.timeline.api;

import com.openbexi.timeline.servlets.TimelineConfigServlet;
import com.openbexi.timeline.servlets.ob_ajax_timeline;
import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.json.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;

class TimelineHbdsHttpTest {
    @TempDir Path temporary;
    private Tomcat server;
    private URI base;
    private Path configuration;
    private final String admin="hbds-admin-"+"a".repeat(40),writer="hbds-writer-"+"w".repeat(40);
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private void start(boolean canonical) throws Exception {
        start(canonical,false);
    }
    private void start(boolean canonical,boolean apiLauncher) throws Exception {
        Path root=Path.of("").toAbsolutePath();configuration=temporary.resolve(canonical?"startup.hbds.json":"unmigrated.yml");
        JSONObject fixture=TimelineHbdsTest.fixture();
        Path events=Files.createDirectory(temporary.resolve("events"));
        for(String title:new String[]{"Wanted","Other"})Files.writeString(events.resolve(title+".json"),new JSONObject().put("events",new JSONArray().put(
                new JSONObject().put("id",title).put("start","2026-09-12T12:00:00Z").put("data",new JSONObject().put("title",title)))).toString());
        fixture.getJSONArray("sources").getJSONObject(0).getJSONObject("configuration").put("data_model",events.toString());
        fixture.getJSONArray("namespaces").getJSONObject(0).put("filter",new JSONObject().put("include","").put("exclude",""));
        Files.writeString(configuration,canonical?fixture.toString():"data_sources: []\n");
        server=new Tomcat();server.setBaseDir(temporary.resolve("tomcat").toString());server.setPort(0);server.getConnector().setProperty("address","127.0.0.1");
        Context context=server.addContext("",root.toString());
        Tomcat.addServlet(context,"api",new TimelineApiServlet(root,temporary.resolve("data"),admin,writer,null));context.addServletMappingDecoded("/api/v1/*","api");
        if(apiLauncher) {
            String previous=System.getProperty("openbexi.hbds.config");System.setProperty("openbexi.hbds.config",configuration.toString());
            try {ApiServer.mountTimeline(context,root);}
            finally {if(previous==null)System.clearProperty("openbexi.hbds.config");else System.setProperty("openbexi.hbds.config",previous);}
            Tomcat.addServlet(context,"assets",new PublicAssetServlet());context.addServletMappingDecoded("/","assets");
        } else {
            context.addParameter("data_conf",configuration.toString());
            Tomcat.addServlet(context,"config",new TimelineConfigServlet());context.addServletMappingDecoded("/openbexi_timeline/config","config");
            Tomcat.addServlet(context,"sessions",new ob_ajax_timeline());context.addServletMappingDecoded("/openbexi_timeline/sessions","sessions");
        }
        server.start();base=URI.create("http://127.0.0.1:"+server.getConnector().getLocalPort()+"/");
    }
    @AfterEach void stop() throws Exception {if(server!=null){server.stop();server.destroy();}}
    private HttpResponse<String> call(String method,String path,String token,String etag,JSONObject document) throws Exception {
        HttpRequest.Builder request=HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(15));
        if(token!=null)request.header("Authorization","Bearer "+token);if(etag!=null)request.header("If-Match",etag);
        if(document!=null)request.header("Content-Type","application/json");
        return client.send(request.method(method,document==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(document.toString())).build(),HttpResponse.BodyHandlers.ofString());
    }
    @Test void administratorOnlyAtomicUpdateImmediatelyChangesPublicRuntimeProjection() throws Exception {
        start(true);
        assertEquals(401,call("GET","api/v1/hbds",null,null,null).statusCode());
        assertEquals(403,call("GET","api/v1/hbds",writer,null,null).statusCode());
        assertEquals(401,call("GET","api/v1/hbds/schema",null,null,null).statusCode());
        assertEquals(200,call("GET","api/v1/hbds/schema",admin,null,null).statusCode());
        HttpResponse<String> read=call("GET","api/v1/hbds",admin,null,null);assertEquals(200,read.statusCode(),read.body());
        String tag=read.headers().firstValue("ETag").orElseThrow();JSONObject document=new JSONObject(read.body()).getJSONObject("document");
        document.getJSONArray("tabs").getJSONObject(0).put("title","Updated live");
        assertEquals(403,call("PUT","api/v1/hbds",writer,tag,document).statusCode());
        assertEquals(428,call("PUT","api/v1/hbds",admin,null,document).statusCode());
        HttpResponse<String> saved=call("PUT","api/v1/hbds",admin,tag,document);assertEquals(200,saved.statusCode(),saved.body());
        assertFalse(new JSONObject(saved.body()).getBoolean("restartRequired"));assertEquals(412,call("PUT","api/v1/hbds",admin,tag,document).statusCode());
        HttpResponse<String> runtime=call("GET","openbexi_timeline/config?namespaceId=namespace-demo",null,null,null);
        assertEquals(200,runtime.statusCode(),runtime.body());JSONObject projected=new JSONObject(runtime.body()).getJSONObject("hbds");
        assertEquals("Updated live",projected.getJSONArray("tabs").getJSONObject(0).getString("title"));assertEquals("EXAMPLE",projected.getString("namespace"));
        assertFalse(runtime.body().contains("private-secret"));assertFalse(runtime.body().contains("private@example.invalid"));
        assertEquals(404,call("GET","openbexi_timeline/config?namespaceId=missing",null,null,null).statusCode());
        assertEquals("no-store",runtime.headers().firstValue("Cache-Control").orElseThrow());
    }
    @Test void unmigratedActiveConfigurationDoesNotEditAnUnrelatedDefault() throws Exception {
        start(false);assertEquals(503,call("GET","api/v1/hbds",admin,null,null).statusCode());
        assertEquals("data_sources: []\n",Files.readString(configuration));
    }
    @Test void liveNamespaceFiltersChangeRecordsAndTabNamespaceRequestsStayScoped() throws Exception {
        start(true);String range="openbexi_timeline/sessions?startDate=2026-09-12T11:00:00Z&endDate=2026-09-12T13:00:00Z&scene=0&namespace=EXAMPLE&matchProtocol=1&progressive=1";
        assertEquals(2,records(range).length());
        HttpResponse<String> read=call("GET","api/v1/hbds",admin,null,null);JSONObject document=new JSONObject(read.body()).getJSONObject("document");
        document.getJSONArray("namespaces").getJSONObject(0).getJSONObject("filter").put("include","expr: title = \"Wanted\"");
        HttpResponse<String> saved=call("PUT","api/v1/hbds",admin,read.headers().firstValue("ETag").orElseThrow(),document);
        assertEquals(200,saved.statusCode(),saved.body());assertFalse(new JSONObject(saved.body()).getBoolean("restartRequired"));
        JSONArray records=records(range);assertEquals(1,records.length());assertEquals("Wanted",records.getJSONObject(0).getString("id"));
        HttpResponse<String> unknown=call("GET",range.replace("namespace=EXAMPLE","namespace=unknown"),null,null,null);
        assertEquals(200,unknown.statusCode(),unknown.body());assertTrue(new JSONObject(unknown.body()).getJSONArray("events").isEmpty());
    }
    private JSONArray records(String range) throws Exception {
        JSONArray result=new JSONArray();String cursor="";
        for(int page=0;page<20;page++) {
            HttpResponse<String> response=call("GET",range+cursor,null,null,null);assertEquals(200,response.statusCode(),response.body());
            JSONObject body=new JSONObject(response.body());for(Object record:body.getJSONArray("events"))result.put(record);
            JSONObject match=body.getJSONObject("timelineMatch");
            if(match.isNull("nextCursor")||!match.has("nextCursor"))return result;
            cursor="&cursor="+URLEncoder.encode(match.getString("nextCursor"),java.nio.charset.StandardCharsets.UTF_8);
        }
        fail("Fixture loading did not finish within 20 continuation pages.");return result;
    }
    @Test void installedApiServerMountsHbdsAndSessionsWithConfigurationOutsideItsPublicRoot() throws Exception {
        start(true,true);
        assertEquals(200,call("GET","openbexi_timeline/config",null,null,null).statusCode());
        assertEquals(200,call("GET","api/v1/hbds",admin,null,null).statusCode());
        assertEquals(2,records("openbexi_timeline/sessions?startDate=2026-09-12T11:00:00Z&endDate=2026-09-12T13:00:00Z&scene=0&namespace=EXAMPLE&matchProtocol=1&progressive=1").length());
        assertEquals(404,call("GET",configuration.getFileName().toString(),null,null,null).statusCode());
    }
}
