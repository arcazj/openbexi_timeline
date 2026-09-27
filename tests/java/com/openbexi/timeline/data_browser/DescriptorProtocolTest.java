package com.openbexi.timeline.data_browser;

import com.openbexi.timeline.servlets.ob_ajax_timeline;
import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;

class DescriptorProtocolTest {
    @TempDir Path temporary;

    @Test void realHttpPreservesFullDescriptorsAndAlwaysReturnsJsonOnFailure() throws Exception {
        Path source=temporary.resolve("data/2026/09/12"),descriptors=source.resolve("descriptors");
        Files.createDirectories(descriptors);
        Files.writeString(source.resolve("events.json"),"""
            {"events":[{"id":"sample","start":"2026-09-12T12:30:00Z","data":{"namespace":"operations","title":"Sample","description":""}}]}
            """);
        Files.writeString(descriptors.resolve("sample.json"),"""
            {"event_descriptor":[{"id":"sample","start":"2026-09-12T12:30:00Z","data":{"namespace":"operations",
              "description":"<b>Started</b><br>Ready [confirmed]","history":["Started","Ready"],"status":"warning"}}]}
            """);
        Files.writeString(descriptors.resolve("broken.json"),"{\"event_descriptor\":[");
        Path yaml=temporary.resolve("sources.yml");
        Files.writeString(yaml,"data_sources:\n  - namespace: operations\n    type: json_file\n    enable: true\n    data_model: "+
                temporary.resolve("data/yyyy/mm/dd").toString().replace('\\','/')+"\n    filter: {include: '', exclude: ''}\n");
        Tomcat server=new Tomcat();server.setBaseDir(temporary.resolve("tomcat").toString());server.setPort(0);
        server.getConnector().setProperty("address","127.0.0.1");
        Context context=server.addContext("",temporary.toString());context.addParameter("data_conf",yaml.toString());
        Tomcat.addServlet(context,"timeline",new ob_ajax_timeline());context.addServletMappingDecoded("/sessions","timeline");
        Tomcat.addServlet(context,"stream",new com.openbexi.timeline.servlets.ob_sse_timeline());context.addServletMappingDecoded("/stream","stream");
        try {
            server.start();
            String base="http://127.0.0.1:"+server.getConnector().getLocalPort()+"/sessions";
            HttpClient client=HttpClient.newHttpClient();
            for(String start:new String[]{"2026-09-12T12:30:00Z","Sat Sep 12 12:30:00 UTC 2026"}) {
                var response=read(client,base,"sample",start);
                assertEquals(200,response.statusCode(),response.body());
                var data=new org.json.JSONObject(response.body()).getJSONArray("event_descriptor").getJSONObject(0).getJSONObject("data");
                assertEquals("<b>Started</b><br>Ready [confirmed]",data.getString("description"));
                assertEquals(2,data.getJSONArray("history").length());assertEquals("warning",data.getString("status"));
            }
            for(var test:new Object[][]{{"sample","invalid",400},{"../sample","2026-09-12T12:30:00Z",400},
                    {"missing","2026-09-12T12:30:00Z",404},{"broken","2026-09-12T12:30:00Z",500}}) {
                var response=read(client,base,(String)test[0],(String)test[1]);
                assertEquals(test[2],response.statusCode(),response.body());
                var body=new org.json.JSONObject(response.body());
                assertEquals(0,body.getJSONArray("event_descriptor").length());
                assertFalse(response.body().contains(temporary.toString()));
                assertTrue(response.headers().firstValue("X-Request-ID").isPresent());
            }
            var response=client.send(HttpRequest.newBuilder(URI.create(base+
                    "?matchProtocol=1&progressive=1&scene=0&startDate=2026-09-12T00:00:00Z&endDate=2026-09-13T00:00:00Z"))
                    .header("Accept","application/json").GET().build(),HttpResponse.BodyHandlers.ofString());
            assertEquals(200,response.statusCode());
            var payload=new org.json.JSONObject(response.body());
            for(int page=0;payload.getJSONArray("events").isEmpty() && !payload.getJSONObject("timelineMatch").isNull("nextCursor") && page<20;page++) {
                String cursor=payload.getJSONObject("timelineMatch").getString("nextCursor");
                response=client.send(HttpRequest.newBuilder(URI.create(base+
                        "?matchProtocol=1&progressive=1&scene=0&startDate=2026-09-12T00:00:00Z&endDate=2026-09-13T00:00:00Z&cursor="+cursor))
                        .header("Accept","application/json").GET().build(),HttpResponse.BodyHandlers.ofString());
                assertEquals(200,response.statusCode());payload=new org.json.JSONObject(response.body());
            }
            assertEquals("sample",payload.getJSONArray("events").getJSONObject(0).getString("id"),payload.toString());
            assertEquals(200,read(client,base.replace("/sessions","/stream"),"sample","2026-09-12T12:30:00Z").statusCode());
        } finally {server.stop();server.destroy();}
    }
    private HttpResponse<String> read(HttpClient client,String base,String id,String start) throws Exception {
        String url=base+"?ob_request=readDescriptor&namespace=operations&event_id="+URLEncoder.encode(id,StandardCharsets.UTF_8)+
                "&start="+URLEncoder.encode(start,StandardCharsets.UTF_8);
        return client.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(10))
                .header("Accept","application/json").POST(HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());
    }
}
