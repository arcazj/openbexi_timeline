package com.openbexi.timeline.api;

import org.json.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class TimelineHbdsTest {
    @TempDir Path temporary;
    private final Path root=Path.of("").toAbsolutePath();
    static JSONObject fixture() throws Exception {
        Path root=Path.of("").toAbsolutePath();
        JSONObject model=new JSONObject(Files.readString(TimelineHbds.resolve(root,"HBDS/templates/models/model_template.json")));
        return new JSONObject().put("schemaVersion",1).put("defaultNamespaceId","namespace-demo")
                .put("namespaces",new JSONArray().put(new JSONObject().put("id","namespace-demo").put("namespace","EXAMPLE").put("modelId","model-demo")
                        .put("render",new JSONObject().put("color","#112233")).put("filter",new JSONObject().put("include","severity=warning"))
                        .put("connectorIds",new JSONArray().put("connector-rest"))))
                .put("models",new JSONArray().put(new JSONObject().put("id","model-demo").put("configuration",model)))
                .put("sources",new JSONArray().put(new JSONObject().put("id","source-demo").put("namespaceId","namespace-demo").put("order",0)
                        .put("configuration",new JSONObject().put("enable",true).put("type","json_file").put("data_model","json/test-data/default-dataset.json")
                                .put("data_path",new JSONArray().put("first").put("second")).put("custom_provider",new JSONObject().put("credential","private-secret"))
                                .put("render",new JSONObject().put("textColor","#ffffff")))))
                .put("connectors",new JSONArray().put(new JSONObject().put("id","connector-rest").put("protocol","no_secure").put("port",8088)))
                .put("tabs",new JSONArray().put(new JSONObject().put("id","tab-demo").put("namespaceId","namespace-demo").put("title","Example").put("order",0).put("enabled",true)))
                .put("users",new JSONArray().put(new JSONObject().put("id","user-admin").put("name","Example admin").put("email","private@example.invalid")
                        .put("admin",true).put("roleId","role-admin").put("groupId","group-admin")))
                .put("groups",new JSONArray().put(new JSONObject().put("id","group-admin").put("name","Administrators")))
                .put("roles",new JSONArray().put(new JSONObject().put("id","role-admin").put("name","Administrator").put("ceiling","admin")))
                .put("grants",new JSONArray().put(new JSONObject().put("id","grant-demo").put("groupId","group-admin").put("namespaceId","namespace-demo").put("permission","admin")))
                .put("deployment",new JSONObject());
    }
    private Path file(JSONObject fixture) throws Exception {Path path=temporary.resolve(UUID.randomUUID()+".hbds.json");Files.writeString(path,fixture.toString());return path;}
    private static JSONObject document(TimelineHbds store) {return store.read().getJSONObject("document");}
    @Test void validatesReferencesGlobalIdentitiesOrdersAndPermissionConsistency() throws Exception {
        TimelineHbds store=TimelineHbds.open(root,file(fixture()));
        List<java.util.function.Consumer<JSONObject>> invalid=List.of(
                d->d.getJSONArray("namespaces").getJSONObject(0).put("modelId","missing"),
                d->d.getJSONArray("namespaces").getJSONObject(0).getJSONObject("filter").put("include","expr: title ="),
                d->d.getJSONArray("models").getJSONObject(0).put("id","namespace-demo"),
                d->d.getJSONArray("sources").put(new JSONObject(d.getJSONArray("sources").getJSONObject(0).toString()).put("id","source-two")),
                d->d.getJSONArray("tabs").getJSONObject(0).put("enabled",false),
                d->d.getJSONArray("tabs").put(new JSONObject(d.getJSONArray("tabs").getJSONObject(0).toString()).put("id","tab-two")),
                d->d.getJSONArray("roles").getJSONObject(0).put("ceiling","r"),
                d->d.getJSONArray("grants").put(new JSONObject(d.getJSONArray("grants").getJSONObject(0).toString()).put("id","grant-two")),
                d->d.getJSONArray("sources").getJSONObject(0).getJSONObject("configuration").put("namespace","duplicate"),
                d->d.getJSONObject("deployment").put("model","duplicate.json"),
                d->d.getJSONObject("deployment").put("__proto__",new JSONObject()));
        for(var edit:invalid) {JSONObject value=document(store);edit.accept(value);assertEquals(422,assertThrows(ApiException.class,()->store.validate(value)).status);}
    }
    @Test void saveIsConditionalAtomicAndPreservesLastValidConfiguration() throws Exception {
        Path path=file(fixture());TimelineHbds store=TimelineHbds.open(root,path);String before=store.etag();JSONObject next=document(store);
        next.getJSONArray("tabs").getJSONObject(0).put("title","Updated title");
        assertEquals(428,assertThrows(ApiException.class,()->store.update(null,next)).status);
        JSONObject result=store.update(before,next);assertFalse(result.getBoolean("restartRequired"));
        assertEquals(List.of(),result.getJSONArray("changedNamespaceIds").toList());assertNotEquals(before,store.etag());
        assertEquals(412,assertThrows(ApiException.class,()->store.update(before,next)).status);
        byte[] bytes=Files.readAllBytes(path);JSONObject invalid=document(store);invalid.getJSONArray("tabs").getJSONObject(0).put("enabled",false);
        assertEquals(422,assertThrows(ApiException.class,()->store.update(store.etag(),invalid)).status);
        assertArrayEquals(bytes,Files.readAllBytes(path));assertEquals("Updated title",store.publicConfiguration(null).getJSONArray("tabs").getJSONObject(0).getString("title"));
    }
    @Test void namespaceDefaultsApplyLiveWhileChangedProviderSettingsWaitForRestart() throws Exception {
        TimelineHbds store=TimelineHbds.open(root,file(fixture()));JSONObject next=document(store);
        next.getJSONArray("namespaces").getJSONObject(0).getJSONObject("render").put("color","#445566");
        assertFalse(store.update(store.etag(),next).getBoolean("restartRequired"));
        JSONObject source=store.legacyConfiguration().getJSONArray("data_sources").getJSONObject(0);
        assertEquals("#445566",source.getJSONObject("render").getString("color"));assertEquals("#ffffff",source.getJSONObject("render").getString("textColor"));
        assertEquals("private-secret",source.getJSONObject("custom_provider").getString("credential"));assertEquals("no_secure:8088",source.getString("connector"));
        assertEquals(1,store.legacyConfiguration().getJSONArray("data_sources").length());assertEquals(2,source.getJSONArray("data_path").length());
        next=document(store);next.getJSONArray("sources").getJSONObject(0).getJSONObject("configuration").put("data_model","replacement.json");
        assertEquals(List.of("sources"),store.update(store.etag(),next).getJSONArray("restartReasons").toList());
        assertEquals("json/test-data/default-dataset.json",store.legacyConfiguration().getJSONArray("data_sources").getJSONObject(0).getString("data_model"));
        next=document(store);next.getJSONArray("tabs").getJSONObject(0).put("title","Another edit");assertTrue(store.update(store.etag(),next).getBoolean("restartRequired"));
    }
    @Test void runtimeProjectionDoesNotExposeProviderCredentialsOrUserDirectory() throws Exception {
        TimelineHbds store=TimelineHbds.open(root,file(fixture()));JSONObject projection=store.publicConfiguration(null);
        assertEquals("EXAMPLE",projection.getString("namespace"));assertTrue(projection.has("modelConfiguration"));
        assertFalse(projection.toString().contains("private-secret"));assertFalse(projection.toString().contains("private@example.invalid"));
        assertEquals(404,assertThrows(ApiException.class,()->store.publicConfiguration("missing")).status);
    }
    @Test void externalEditCannotBeSilentlyOverwritten() throws Exception {
        Path path=file(fixture());TimelineHbds store=TimelineHbds.open(root,path);String tag=store.etag();
        Files.writeString(path,"{}\n");assertEquals(412,assertThrows(ApiException.class,()->store.update(tag,document(store))).status);assertEquals("{}\n",Files.readString(path));
        assertEquals("EXAMPLE",store.publicConfiguration(null).getString("namespace"));
    }
    @Test void missingExplicitConfigurationNeverFallsBackToAnUnrelatedTemplate() {
        assertEquals(503,assertThrows(ApiException.class,()->TimelineHbds.open(root,temporary.resolve("missing.hbds.json"))).status);
    }
    @Test void ingestionFilenamePatternsAreNotParsedAsRecordExpressions() throws Exception {
        JSONObject draft=fixture();draft.getJSONArray("sources").getJSONObject(0).getJSONObject("configuration").put("type","local").put("filter",new JSONObject().put("include","*.csv"));
        draft.getJSONArray("namespaces").getJSONObject(0).put("filter",new JSONObject().put("include","*.csv"));
        assertDoesNotThrow(()->TimelineHbds.open(root,file(draft)));
    }
    @Test void validExternalEditsRefreshAndInvalidEditsRetainTheLastValidSnapshot() throws Exception {
        Path path=file(fixture());TimelineHbds store=TimelineHbds.open(root,path);String first=store.etag();JSONObject next=document(store);
        next.getJSONArray("tabs").getJSONObject(0).put("title","Updated by another server");Files.writeString(path,next.toString(2));
        assertEquals("Updated by another server",store.publicConfiguration(null).getJSONArray("tabs").getJSONObject(0).getString("title"));assertNotEquals(first,store.etag());
        Files.writeString(path,"invalid external JSON");assertEquals("Updated by another server",store.publicConfiguration(null).getJSONArray("tabs").getJSONObject(0).getString("title"));
        next.getJSONArray("sources").getJSONObject(0).getJSONObject("configuration").put("data_model","next-source.json");Files.writeString(path,next.toString(2));
        assertTrue(store.read().getBoolean("restartRequired"));
        assertEquals("json/test-data/default-dataset.json",store.providerSnapshot().getJSONObject("configuration").getJSONArray("data_sources").getJSONObject(0).getString("data_model"));
    }
    @Test void aliasesTakePrecedenceOverExistingLegacyFilesAndRejectEscapes() throws Exception {
        Files.createDirectories(temporary.resolve("HBDS/private"));Files.createDirectories(temporary.resolve("yaml"));Files.writeString(temporary.resolve("yaml/example.yml"),"legacy");
        Path mapping=temporary.resolve("HBDS/private/migration.json");Files.writeString(mapping,new JSONObject().put("version",1)
                .put("aliases",new JSONObject().put("yaml/example.yml","HBDS/private/example.hbds.json")).toString());
        assertEquals(temporary.resolve("HBDS/private/example.hbds.json"),TimelineHbds.resolve(temporary,"yaml/example.yml"));
        assertEquals(temporary.resolve("HBDS/private/example.hbds.json"),TimelineHbds.resolve(temporary,temporary.resolve("yaml/example.yml").toString()));
        Files.writeString(mapping,new JSONObject().put("aliases",new JSONObject().put("yaml/example.yml","../outside.json")).toString());
        assertThrows(IllegalArgumentException.class,()->TimelineHbds.resolve(temporary,"yaml/example.yml"));
    }
    @Test void editingAGenericTemplatePromotesItWithoutChangingThePublicFile() throws Exception {
        for(String relative:List.of("schemas/demo-model.schema.json","schemas/legacy-model.schema.json","HBDS/schema/configuration.schema.json")) {
            Path target=temporary.resolve(relative);Files.createDirectories(target.getParent());Files.copy(root.resolve(relative),target);
        }
        Path template=temporary.resolve("HBDS/templates/default.hbds.json");Files.createDirectories(template.getParent());Files.writeString(template,fixture().toString());
        String original=Files.readString(template);TimelineHbds store=TimelineHbds.open(temporary,template);JSONObject draft=document(store);
        draft.getJSONArray("tabs").getJSONObject(0).put("title","Private customization");store.update(store.etag(),draft);
        assertEquals(original,Files.readString(template));Path privateFile=temporary.resolve("HBDS/private/configurations/default.hbds.json");
        assertEquals("Private customization",new JSONObject(Files.readString(privateFile)).getJSONArray("tabs").getJSONObject(0).getString("title"));
        assertSame(store,TimelineHbds.open(temporary,template));assertSame(store,TimelineHbds.open(temporary,privateFile));
    }
}
