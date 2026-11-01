package com.openbexi.timeline.data_browser;

import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class FilterCatalogTest {
    private org.json.simple.JSONObject query(Path root) {
        var sources=new org.json.simple.JSONArray();sources.add(new org.json.simple.JSONObject(Map.of("type","json_file","namespace","DEMO_ALPHA","data_model",root.resolve("data/yyyy/mm/dd").toString(),"enable",true)));
        return new org.json.simple.JSONObject(Map.of("_hbds_root",root.resolve("HBDS").toString(),"namespace","DEMO_ALPHA","userName","guest","timelineName","timeline","startup configuration",sources));
    }
    @Test void historicalValuesArePersistentIncrementalTypedAndBounded(@TempDir Path root) throws Exception {
        Path file=root.resolve("data/2020/01/01/history.json");Files.createDirectories(file.getParent());JSONArray records=new JSONArray();
        for(int i=0;i<220;i++)records.put(new JSONObject().put("id",String.valueOf(i)).put("start","2020-01-01T12:00:00Z")
            .put("data",new JSONObject().put("title","Hidden").put("As_Run","<p>hidden</p>").put("system",i%2==0?"CMD":"RNG").put("serial",String.valueOf(i))));
        Files.writeString(file,new JSONObject().put("events",records).toString());var config=query(root);
        JSONObject catalog=FilterCatalog.scan(config).getJSONArray("namespaces").getJSONObject(0);
        assertEquals("system",catalog.getJSONArray("attributes").getJSONObject(0).getString("field"));
        assertEquals(List.of("CMD","RNG"),catalog.getJSONArray("attributes").getJSONObject(0).getJSONArray("values").toList());
        assertEquals("serial",catalog.getJSONArray("excluded").getJSONObject(0).getString("field"));
        Path saved=root.resolve("HBDS/filters/DEMO_ALPHA/catalog.java.json");String before=Files.readString(saved);FilterCatalog.scan(config);assertEquals(before,Files.readString(saved));
        config.put("_hbds_workspace",root.resolve("HBDS/Other_Workspace.json").toString());FilterCatalog.scan(config);
        assertTrue(Files.isRegularFile(root.resolve("HBDS/filters/DEMO_ALPHA/catalog.java.Other_Workspace.json")));assertEquals(before,Files.readString(saved));config.remove("_hbds_workspace");
        config.put("startDate","2020-01-01T00:00:00Z");config.put("endDate","2020-01-02T00:00:00Z");config.put("matchProtocol","1");config.put("progressive","1");config.put("filter","expr: system = RNG");
        config.put("namespaces","[\"OTHER\"]");assertEquals(0,wire(config).size());
        config.put("namespaces","[\"DEMO_ALPHA\"]");assertEquals(110,wire(config).size());
        Path added=root.resolve("data/2026/09/12/new.json");Files.createDirectories(added.getParent());
        Files.writeString(added,new JSONObject().put("events",new JSONArray().put(new JSONObject().put("id","new").put("start","2026-09-12T12:00:00Z").put("data",new JSONObject().put("system","NEW").put("enabled",false)))).toString());
        var updated=FilterCatalog.scan(config).getJSONArray("namespaces").getJSONObject(0).getJSONArray("attributes");
        assertEquals(false,updated.getJSONObject(0).getJSONArray("values").get(0));
        assertEquals(List.of("CMD","NEW","RNG"),updated.getJSONObject(1).getJSONArray("values").toList());
        Files.delete(added);assertEquals(List.of("CMD","RNG"),FilterCatalog.scan(config).getJSONArray("namespaces").getJSONObject(0).getJSONArray("attributes").getJSONObject(0).getJSONArray("values").toList());
    }
    private java.util.List<Object> wire(org.json.simple.JSONObject config){
        config.remove("cursor");List<Object> records=new ArrayList<>();
        for(int page=0;page<100;page++){
            org.json.simple.JSONObject response=(org.json.simple.JSONObject)new json_files_manager(null,null,new data_configuration(config)).getData(null,"0");
            records.addAll((org.json.simple.JSONArray)response.get("events"));
            var metadata=(org.json.simple.JSONObject)response.get("timelineMatch");assertNull(metadata.get("error"));
            if(metadata.get("nextCursor")==null)return records;config.put("cursor",metadata.get("nextCursor"));
        }
        fail("Unbounded scan");return records;
    }
    @Test void catalogSkipsDescriptorNoiseAndHiddenTreesLikeTheSessionScanner(@TempDir Path root) throws Exception {
        Path data=root.resolve("data/2020/01/01");Files.createDirectories(data);
        Files.writeString(data.resolve("sessions.json"),"{\"events\":[{\"data\":{\"system\":\"RNG\"}}]}");
        for(String folder:List.of("descriptors","noises-data",".private")){
            Path ignored=data.resolve(folder);Files.createDirectories(ignored);
            Files.writeString(ignored.resolve("ignored.json"),"{\"events\":[{\"data\":{\"system\":\"OTHER\"}}]}");
            Files.writeString(ignored.resolve("invalid.json"),"{\"description\": \"invalid historical descriptor\" missing separator}");
        }
        JSONObject response=FilterCatalog.scan(query(root));assertTrue(response.getJSONArray("warnings").isEmpty());
        assertEquals(List.of("RNG"),response.getJSONArray("namespaces").getJSONObject(0).getJSONArray("attributes").getJSONObject(0).getJSONArray("values").toList());
    }
    @Test void guestAppliesOnlyAndNewDefinitionsBelongToTheirCreator(@TempDir Path root) throws Exception {
        var config=query(root);Path profile=root.resolve("HBDS/filters/default_filter_setting.json");Files.createDirectories(profile.getParent());
        JSONArray filters=new JSONArray();for(String name:List.of("ALL","NAMESPACE_Exclude_Nominal_RNG","Existing"))filters.put(new JSONObject().put("name",name).put("filter_value",name.equals("ALL")?"":"|system:RNG").put("sortBy","NONE").put("current",name.equals("ALL")?"yes":"no"));
        Files.writeString(profile,new JSONObject().put("namespace","DEMO_ALPHA").put("openbexi_timeline",new JSONArray().put(new JSONObject().put("filters",filters))).toString());
        config.put("request","readFilters");JSONObject guest=new JSONObject(SavedFilters.update(new data_configuration(config)).toJSONString()).getJSONArray("openbexi_timeline").getJSONObject(0);
        assertEquals(2,guest.getJSONArray("filters").length());assertFalse(guest.getJSONObject("filterAccess").getBoolean("canCreate"));
        assertFalse(guest.getJSONArray("filters").getJSONObject(0).getBoolean("canEdit"));
        for(String operation:List.of("saveFilter","addFilter","deleteFilter")){config.put("request",operation);config.put("filterName","ALL");config.put("filter","");assertThrows(SecurityException.class,()->SavedFilters.update(new data_configuration(config)));}
        config.put("request","updateFilter");config.put("filterName","NAMESPACE_Exclude_Nominal_RNG");config.put("filter","tampered");
        JSONObject applied=new JSONObject(SavedFilters.update(new data_configuration(config)).toJSONString()).getJSONArray("openbexi_timeline").getJSONObject(0);
        assertEquals("|system:RNG",applied.getJSONArray("filters").getJSONObject(1).getString("filter_value"));
        config.put("userName","creator.demo");config.put("request","addFilter");config.put("filterName","Copy");config.put("filter","expr: system = RNG");
        JSONObject created=new JSONObject(SavedFilters.update(new data_configuration(config)).toJSONString()).getJSONArray("openbexi_timeline").getJSONObject(0);
        assertEquals(List.of("creator.demo"),created.getJSONArray("filters").getJSONObject(0).getJSONArray("owners").toList());
        config.put("userName","admin");config.put("request","readFilters");assertEquals(4,new JSONObject(SavedFilters.update(new data_configuration(config)).toJSONString()).getJSONArray("openbexi_timeline").getJSONObject(0).getJSONArray("filters").length());
    }
    @Test void namespaceScopeIsAppliedBeforeExpressionFiltering(@TempDir Path root) throws Exception {
        var config=query(root);config.put("namespaces","[\"DEMO_ALPHA\"]");
        var events=new org.json.simple.JSONArray();events.add(new org.json.simple.JSONObject(Map.of("id","yes","namespace","DEMO_ALPHA")));events.add(new org.json.simple.JSONObject(Map.of("id","no","namespace","OTHER")));
        assertEquals(1,FilterNamespaces.select(events,config).size());config.put("namespaces","[]");assertTrue(FilterNamespaces.select(events,config).isEmpty());
        config.put("namespaces","[1]");assertThrows(IllegalArgumentException.class,()->FilterNamespaces.select(events,config));
    }
    @Test void websocketFiltersAndRetainsScopeBetweenMessages(@TempDir Path root) throws Exception {
        Path file=root.resolve("data/2020/01/01/sessions.json");Files.createDirectories(file.getParent());JSONArray records=new JSONArray();
        for(String id:List.of("running","finished","command"))records.put(new JSONObject().put("id",id).put("start","2020-01-01T12:00:00Z")
            .put("data",new JSONObject().put("system",id.equals("command")?"CMD":"RNG").put("status",id.equals("finished")?"FINISHED":"RUNNING")));
        Files.writeString(file,new JSONObject().put("events",records).toString());Path configuration=root.resolve("source.yml");
        Files.writeString(configuration,new JSONObject().put("data_sources",query(root).get("startup configuration")).toString());
        var responses=new ArrayList<String>();
        var remote=(javax.websocket.RemoteEndpoint.Async)java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{javax.websocket.RemoteEndpoint.Async.class},(proxy,method,args)->{
            if(method.getName().equals("sendText")){responses.add((String)args[0]);return java.util.concurrent.CompletableFuture.completedFuture(null);}return null;
        });
        var session=(javax.websocket.Session)java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{javax.websocket.Session.class},(proxy,method,args)->switch(method.getName()){
            case "getRequestURI"->java.net.URI.create("ws://localhost:43199/openbexi_timeline_ws/sessions");case "getRequestParameterMap"->Map.of();case "getAsyncRemote"->remote;default->null;
        });
        com.openbexi.timeline.websockets.ob_websocket_timeline.configure(43199,configuration.toString());var endpoint=new com.openbexi.timeline.websockets.ob_websocket_timeline();
        endpoint.onMessage(new JSONObject().put("startDate","2020-01-01T00:00:00Z").put("endDate","2020-01-02T00:00:00Z").put("namespaces","[\"DEMO_ALPHA\"]")
            .put("filter","expr: system = RNG | status = FINISHED").put("progressive","0").toString(),session);
        assertEquals("running",new JSONObject(responses.get(0)).getJSONArray("events").getJSONObject(0).getString("id"));assertEquals(1,new JSONObject(responses.get(0)).getJSONArray("events").length());
        endpoint.onMessage("{}",session);assertEquals(1,new JSONObject(responses.get(1)).getJSONArray("events").length());
        endpoint.onMessage(new JSONObject().put("namespaces","[]").toString(),session);assertTrue(new JSONObject(responses.get(2)).getJSONArray("events").isEmpty());
        endpoint.onMessage(new JSONObject().put("namespaces","[\"DEMO_ALPHA\"]").put("filter","").toString(),session);assertEquals(3,new JSONObject(responses.get(3)).getJSONArray("events").length());
    }
}
