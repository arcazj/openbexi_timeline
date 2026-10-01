package com.openbexi.timeline.api;

import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.json.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Real HTTP checks for model isolation without changing record metadata. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class TimelineAccessTest {
    @TempDir static Path temporary;
    private final Path root=Paths.get("").toAbsolutePath();
    private final String system="access-admin-"+"a".repeat(40),legacyWriter="access-writer-"+"w".repeat(40),legacyReader="access-reader-"+"r".repeat(40);
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private Tomcat server;private URI base;
    @BeforeAll void start() throws Exception {
        server=new Tomcat();server.setBaseDir(temporary.resolve("tomcat").toString());server.setPort(0);server.getConnector().setProperty("address","127.0.0.1");
        Context context=server.addContext("",root.toString());Tomcat.addServlet(context,"api",new TimelineApiServlet(root,temporary.resolve("data"),system,legacyWriter,legacyReader));
        context.addServletMappingDecoded("/api/v1/*","api");server.start();base=URI.create("http://127.0.0.1:"+server.getConnector().getLocalPort()+"/api/v1/");
    }
    @AfterAll void stop() throws Exception {if(server!=null){server.stop();server.destroy();}}
    private HttpResponse<String> call(String method,String path,String token,String etag,JSONObject body) throws Exception {
        HttpRequest.Builder request=HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(20));
        if(token!=null)request.header("Authorization","Bearer "+token);if(etag!=null)request.header("If-Match",etag);if(body!=null)request.header("Content-Type","application/json");
        return client.send(request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body.toString())).build(),HttpResponse.BodyHandlers.ofString());
    }
    private JSONObject json(HttpResponse<String> response,int status){assertEquals(status,response.statusCode(),response.body());return new JSONObject(response.body());}
    private String tag(HttpResponse<?> response){return response.headers().firstValue("ETag").orElseThrow();}
    private String newId(){return "test-"+UUID.randomUUID();}
    private record User(String id,String token){}
    private User user(String workspace) throws Exception {
        String id=newId();JSONObject created=json(call("POST","access/users",system,null,new JSONObject().put("id",id).put("workspaceIds",new JSONArray().put(workspace))),201);
        return new User(id,created.getString("token"));
    }
    private JSONObject grant(User user,String role){return new JSONObject().put("userId",user.id).put("role",role);}
    private String dataset() throws Exception {String id=newId();json(call("POST","datasets",system,null,new JSONObject().put("id",id).put("sourceId","monet")),201);return id;}
    private HttpResponse<String> scope(String id,JSONArray grants) throws Exception {
        HttpResponse<String> current=call("GET","models/"+id+"/access",system,null,null);
        return call("PUT","models/"+id+"/access",system,tag(current),new JSONObject().put("workspaceId","default").put("grants",grants));
    }
    @Test void scopedModelsDenyOtherUsersAndLegacyGlobalTokensAcrossEveryResource() throws Exception {
        User admin=user("default"),writer=user("default"),reader=user("default"),outsider=user("default");String id=dataset();
        JSONArray before=new TimelineRepository(root,temporary.resolve("data")).read(id).getJSONArray("events");
        json(scope(id,new JSONArray().put(grant(admin,"admin")).put(grant(writer,"readWrite")).put(grant(reader,"readOnly"))),200);
        for(String token:List.of(outsider.token,legacyWriter,legacyReader)) {
            for(String suffix:List.of("","/events","/sessions","/filters"))assertEquals(403,call("GET","datasets/"+id+suffix,token,null,null).statusCode());
            for(String suffix:List.of("","/filters","/config-files","/ai/providers","/versions","/preview"))assertEquals(403,call("GET","models/"+id+suffix,token,null,null).statusCode());
            assertEquals(403,call("POST","models/"+id+"/ai/generate",token,null,new JSONObject()).statusCode());
            assertEquals(403,call("POST","datasets/"+id+"/events",token,"stale",new JSONObject()).statusCode());
        }
        JSONObject catalog=json(call("GET","models",reader.token,null,null),200);assertTrue(catalog.getJSONArray("items").toList().stream().anyMatch(value -> ((Map<?,?>)value).get("id").equals(id)));
        JSONObject hidden=json(call("GET","models",outsider.token,null,null),200);assertFalse(hidden.getJSONArray("items").toList().stream().anyMatch(value -> ((Map<?,?>)value).get("id").equals(id)));
        json(call("GET","datasets/"+id+"/events",reader.token,null,null),200);
        assertEquals(403,call("POST","datasets/"+id+"/events",reader.token,"stale",new JSONObject()).statusCode());
        assertEquals(403,call("GET","models/"+id+"/config-files",writer.token,null,null).statusCode());
        assertEquals(403,call("GET","models/"+id+"/preview",writer.token,null,null).statusCode());
        assertTrue(before.similar(json(call("GET","models/"+id+"/preview",admin.token,null,null),200).getJSONArray("events")));
        assertEquals(403,call("GET","config-files",admin.token,null,null).statusCode());
        assertTrue(before.similar(new TimelineRepository(root,temporary.resolve("data")).read(id).getJSONArray("events")),"Access changes must never modify event metadata");
        TimelineAccessStore reloaded=new TimelineAccessStore(temporary.resolve("data"));assertEquals(admin.id,reloaded.authenticate(admin.token).id());
        assertFalse(Files.readString(temporary.resolve("data/.access/state.json")).contains(admin.token));
    }
    @Test void lastAdministratorWorkspaceBoundariesAndEtagsAreEnforced() throws Exception {
        User admin=user("default"),reader=user("default");String id=dataset();json(scope(id,new JSONArray().put(grant(admin,"admin")).put(grant(reader,"readOnly"))),200);
        String path="models/"+id+"/access";HttpResponse<String> current=call("GET",path,admin.token,null,null);
        JSONObject noAdmin=new JSONObject().put("grants",new JSONArray().put(grant(reader,"readOnly")));
        assertEquals(409,call("PUT",path,admin.token,tag(current),noAdmin).statusCode());
        assertEquals(428,call("PUT",path,admin.token,null,new JSONObject().put("grants",new JSONArray().put(grant(admin,"admin")))).statusCode());
        assertEquals(403,call("PUT",path,reader.token,tag(current),noAdmin).statusCode());
        String workspace=newId();json(call("POST","workspaces",system,null,new JSONObject().put("id",workspace)),201);User foreign=user(workspace);
        assertEquals(422,call("PUT",path,admin.token,tag(current),new JSONObject().put("grants",new JSONArray().put(grant(admin,"admin")).put(grant(foreign,"readOnly")))).statusCode());
        HttpResponse<String> changed=call("PUT",path,admin.token,tag(current),new JSONObject().put("grants",new JSONArray().put(grant(admin,"admin"))));json(changed,200);
        assertEquals(412,call("PUT",path,admin.token,tag(current),new JSONObject().put("grants",new JSONArray().put(grant(admin,"admin")))).statusCode());
    }
    @Test void scopedDocumentsAndPersonalFiltersCannotLeakBetweenModelsOrUsers() throws Exception {
        User admin=user("default"),writer=user("default"),other=user("default");String a=dataset(),b=dataset();
        json(scope(a,new JSONArray().put(grant(admin,"admin")).put(grant(writer,"readWrite")).put(grant(other,"readWrite"))),200);
        json(scope(b,new JSONArray().put(grant(other,"admin"))),200);
        JSONArray originalRecords=new TimelineRepository(root,temporary.resolve("data")).read(a).getJSONArray("events");
        JSONObject document=new JSONObject().put("name","sources.yaml").put("kind","yaml").put("text","data_sources: []\n");
        JSONObject saved=json(call("POST","models/"+a+"/config-files",admin.token,null,document),201);
        assertEquals(404,call("GET","models/"+b+"/config-files/"+saved.getString("id"),other.token,null,null).statusCode());
        assertEquals(403,call("GET","config-files/"+saved.getString("id"),admin.token,null,null).statusCode());
        String filterPath="models/"+a+"/filters";HttpResponse<String> before=call("GET",filterPath,writer.token,null,null);
        JSONObject filter=new JSONObject().put("id","mine").put("title","Private selection").put("visibility","personal").put("query",new JSONObject().put("search","Monet"))
                .put("sortBy",new JSONObject().put("field","start").put("direction","desc"));
        HttpResponse<String> created=call("POST",filterPath,writer.token,tag(before),filter);JSONObject value=json(created,201);assertEquals(a,value.getString("modelId"));assertEquals(writer.id,value.getString("createdBy"));
        assertEquals(0,json(call("GET",filterPath,other.token,null,null),200).getInt("total"));
        assertEquals(404,call("GET",filterPath+"/mine",other.token,null,null).statusCode());
        assertEquals(404,call("GET","datasets/"+a+"/events?filterId=mine",other.token,null,null).statusCode());
        assertEquals(404,call("DELETE",filterPath+"/mine",other.token,tag(created),null).statusCode());
        json(call("GET",filterPath+"/mine",admin.token,null,null),200);
        assertEquals(422,call("PATCH",filterPath+"/mine",writer.token,tag(created),new JSONObject().put("modelId",b)).statusCode());
        assertTrue(originalRecords.similar(new TimelineRepository(root,temporary.resolve("data")).read(a).getJSONArray("events")),"Filters and documents must leave every item field unchanged");
    }
    @Test void customPermissionsAreBoundedAndEntitlementNeverGrantsModelAccess() throws Exception {
        User admin=user("default"),limited=user("default"),outside=user("default");String id=dataset();
        HttpResponse<String> current=call("GET","models/"+id+"/access",system,null,null);
        JSONObject input=new JSONObject().put("grants",new JSONArray().put(grant(admin,"admin")).put(grant(limited,"filterEditor")))
                .put("roles",new JSONArray().put(new JSONObject().put("name","filterEditor").put("permissions",new JSONArray().put("read").put("writeFilters"))));
        json(call("PUT","models/"+id+"/access",system,tag(current),input),200);
        HttpResponse<String> records=call("GET","datasets/"+id,limited.token,null,null);
        assertEquals(403,call("POST","datasets/"+id+"/events",limited.token,tag(records),new JSONObject()).statusCode());
        assertEquals(403,call("GET","models/"+id+"/ai/providers",limited.token,null,null).statusCode());
        JSONObject me=json(call("GET","me",admin.token,null,null),200);assertFalse(me.getBoolean("systemAdmin"));
        JSONArray originalRecords=new TimelineRepository(root,temporary.resolve("data")).read(id).getJSONArray("events");
        HttpResponse<String> entitlement=call("GET","workspaces/default/entitlement",system,null,null);
        JSONObject license=new JSONObject().put("mode","exempt").put("status","active").put("eligibilityCategory","researcher").put("verificationStatus","verified")
                .put("features",new JSONObject().put("ai",false));
        // Superseded preview categories must be rejected without changing the
        // entitlement or its concurrency tag; nonprofit is the actual category.
        for(String obsolete:List.of("ngo","omg")) {
            license.put("eligibilityCategory",obsolete);
            assertEquals(422,call("PUT","workspaces/default/entitlement",system,tag(entitlement),license).statusCode());
        }
        license.put("eligibilityCategory","nonprofit");
        HttpResponse<String> saved=call("PUT","workspaces/default/entitlement",system,tag(entitlement),license);
        assertEquals("nonprofit",json(saved,200).getString("eligibilityCategory"));
        assertEquals(403,call("GET","models/"+id+"/ai/providers",admin.token,null,null).statusCode());
        assertEquals(403,call("GET","datasets/"+id,outside.token,null,null).statusCode());
        license.put("mode","community").put("features",new JSONObject().put("ai",true));json(call("PUT","workspaces/default/entitlement",system,tag(saved),license),200);
        assertTrue(originalRecords.similar(new TimelineRepository(root,temporary.resolve("data")).read(id).getJSONArray("events")),"Entitlements must not alter any record metadata");
    }
    @Test void configurationSaveHistoryAndExistingItemStructureStayIndependent() throws Exception {
        User admin=user("default");String id=dataset();json(scope(id,new JSONArray().put(grant(admin,"admin"))),200);
        JSONArray recordsBefore=new TimelineRepository(root,temporary.resolve("data")).read(id).getJSONArray("events");
        HttpResponse<String> current=call("GET","models/"+id,admin.token,null,null);JSONObject model=json(current,200);model.getJSONArray("params").getJSONObject(0).put("title","Updated view");
        json(call("PUT","models/"+id,admin.token,tag(current),model),200);
        JSONArray versions=json(call("GET","models/"+id+"/versions",admin.token,null,null),200).getJSONArray("items");assertEquals(2,versions.length());
        String revision=versions.getJSONObject(0).getString("revision");JSONObject history=json(call("GET","models/"+id+"/versions/"+revision,admin.token,null,null),200);assertTrue(history.has("configuration"));
        assertTrue(recordsBefore.similar(new TimelineRepository(root,temporary.resolve("data")).read(id).getJSONArray("events")));
    }
    @Test void deletedIdentitiesCannotAttachOldGrantsOrDocumentsToNewData() throws Exception {
        User admin=user("default");String id=dataset();json(scope(id,new JSONArray().put(grant(admin,"admin"))),200);
        HttpResponse<String> current=call("GET","datasets/"+id,admin.token,null,null);
        assertEquals(204,call("DELETE","datasets/"+id,admin.token,tag(current),null).statusCode());
        assertEquals(409,call("POST","datasets",system,null,new JSONObject().put("id",id).put("sourceId","monet")).statusCode());
        assertEquals(404,call("GET","models/"+id+"/versions",admin.token,null,null).statusCode());
    }
    @Test void privateClonesInheritAccessBeforePublicationAndKeepRecordPayloads() throws Exception {
        User admin=user("default");String source=dataset();json(scope(source,new JSONArray().put(grant(admin,"admin"))),200);
        HttpResponse<String> before=call("GET","models/"+source+"/filters",admin.token,null,null);
        JSONObject filter=new JSONObject().put("id","selection").put("title","Selection").put("query",new JSONObject());
        json(call("POST","models/"+source+"/filters",admin.token,tag(before),filter),201);
        JSONObject original=new TimelineRepository(root,temporary.resolve("data")).read(source);
        String clone=newId();json(call("POST","datasets",system,null,new JSONObject().put("id",clone).put("sourceId",source)),201);
        assertEquals(403,call("GET","datasets/"+clone,legacyReader,null,null).statusCode());
        assertEquals(403,call("POST","datasets/"+clone+"/events",legacyWriter,"stale",new JSONObject()).statusCode());
        JSONObject access=json(call("GET","models/"+clone+"/access",admin.token,null,null),200);
        assertTrue(access.getBoolean("scoped"));assertEquals("admin",access.getString("role"));assertEquals(clone,access.getString("datasetId"));
        JSONObject copied=new TimelineRepository(root,temporary.resolve("data")).read(clone);
        assertEquals(clone,copied.getJSONArray("filters").getJSONObject(0).getString("modelId"));
        assertEquals(source,original.getJSONArray("filters").getJSONObject(0).getString("modelId"));
        assertTrue(original.getJSONArray("events").similar(copied.getJSONArray("events")),"Cloning may change envelopes and filter ownership, never item metadata");
    }
}
