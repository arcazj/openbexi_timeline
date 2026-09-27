package com.openbexi.timeline.servlets;

import com.openbexi.timeline.api.PublicAssetServlet;
import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.json.JSONObject;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;

class TimelineConfigServletTest {
    @TempDir Path temporary;
    private Tomcat server;
    private URI base;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    private void start(String yaml,String contextPath,String dataRoute) throws Exception {
        Path root=Files.createDirectory(temporary.resolve("site")),configuration=root.resolve("yaml/sources.yml");
        Files.createDirectories(configuration.getParent());Files.writeString(configuration,yaml);
        server=new Tomcat();server.setBaseDir(temporary.resolve("tomcat").toString());server.setPort(0);
        server.getConnector().setProperty("address","127.0.0.1");
        Context context=server.addContext(contextPath,root.toString());context.addParameter("data_conf",configuration.toString());
        Tomcat.addServlet(context,"assets",new PublicAssetServlet());context.addServletMappingDecoded("/","assets");
        Tomcat.addServlet(context,"configuration",new TimelineConfigServlet(dataRoute));
        context.addServletMappingDecoded("/openbexi_timeline/config","configuration");
        server.start();base=URI.create("http://127.0.0.1:"+server.getConnector().getLocalPort()+contextPath+"/");
    }
    private HttpResponse<String> get(String path) throws Exception {
        return client.send(HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(5)).GET().build(),HttpResponse.BodyHandlers.ofString());
    }
    @AfterEach void stop() throws Exception {if(server!=null){server.stop();server.destroy();}}

    @Test void exposesOnlyTheModelAndDataRouteFromTheActiveYaml() throws Exception {
        start("model: models/regular_timeline_earthquake.json\ndata_sources:\n  - permission: private-token\n    data_path: /private/archive\n","","/openbexi_timeline/sessions");
        HttpResponse<String> response=get("openbexi_timeline/config");
        assertEquals(200,response.statusCode());assertTrue(response.headers().firstValue("Content-Type").orElse("").startsWith("application/json"));
        assertEquals("no-store",response.headers().firstValue("Cache-Control").orElse(""));
        JSONObject body=new JSONObject(response.body());assertEquals(2,body.length());
        assertEquals("models/regular_timeline_earthquake.json",body.getString("model"));
        assertEquals("/openbexi_timeline/sessions",body.getString("data"));
        assertFalse(response.body().contains("private"));assertEquals(404,get("yaml/sources.yml").statusCode());
    }
    @Test void missingModelRequestsTheClientDefault() throws Exception {
        start("data_sources: []\n","","/openbexi_timeline/sessions");
        JSONObject body=new JSONObject(get("openbexi_timeline/config").body());assertTrue(body.isNull("model"));
    }
    @Test void blankModelRequestsTheClientDefault() throws Exception {
        start("model: '  '\ndata_sources: []\n","","/openbexi_timeline/sessions");
        assertTrue(new JSONObject(get("openbexi_timeline/config").body()).isNull("model"));
    }
    @Test void contextPathAndSseRouteAreRetained() throws Exception {
        start("model: models/custom.json\ndata_sources: []\n","/timeline","/openbexi_timeline_sse/sessions");
        JSONObject body=new JSONObject(get("openbexi_timeline/config").body());
        assertEquals("models/custom.json",body.getString("model"));assertEquals("/timeline/openbexi_timeline_sse/sessions",body.getString("data"));
    }
}
