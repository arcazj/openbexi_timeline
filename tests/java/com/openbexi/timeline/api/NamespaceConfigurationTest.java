package com.openbexi.timeline.api;

import org.json.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.yaml.snakeyaml.Yaml;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class NamespaceConfigurationTest {
    @TempDir Path temp;
    Path metadata,first,second;
    JSONObject namespace(String name) {
        return new JSONObject().put("config_version",2).put("namespace",name).put("model","models/default.json")
            .put("target_path",temp.resolve(name+"/output/yyyy/mm/dd").toString())
            .put("sources",new JSONArray().put(new JSONObject().put("id","input").put("source_plugin","custom_reader")
                .put("converter_plugin","custom_converter").put("source_path",temp.resolve(name+"/input").toString())));
    }
    void write(Path path,JSONObject value) throws Exception {Files.writeString(path,new Yaml().dump(value.toMap()));}
    @BeforeEach void setup() throws Exception {
        metadata=temp.resolve("HBDS");Files.createDirectories(metadata.resolve("yaml"));Files.createDirectories(metadata.resolve("models"));
        Files.copy(Path.of("HBDS/models/default.json"),metadata.resolve("models/default.json"));
        first=metadata.resolve("yaml/ALPHA_default.yml");second=metadata.resolve("yaml/BETA_default.yml");
        write(first,namespace("ALPHA"));write(second,namespace("BETA"));
    }
    @Test void nativeWorkspaceServesMultipleNamespacesWithoutCollectorPlugins() throws Exception {
        var workspace=new NamespaceConfiguration(Path.of(""),List.of(first,second),null,metadata);
        var store=TimelineHbds.open(Path.of(""),workspace.register());
        assertEquals(2,store.read().getJSONObject("document").getJSONArray("namespaces").length());
        assertEquals("BETA",store.publicConfiguration("BETA").getString("namespace"));
        assertTrue(store.legacyConfiguration().getJSONArray("data_sources").getJSONObject(0).has("data_model"));
        for(String key:List.of("users","roles","groups","grants"))assertFalse(store.publicConfiguration("ALPHA").has(key));
    }
    @Test void defaultUsersAndPrivateEditsSurviveRestartWithoutChangingPublicFiles() throws Exception {
        Map<Path,byte[]> originals=new LinkedHashMap<>();
        for(String key:List.of("users","groups","roles")) {
            Path directory=metadata.resolve(key);Files.createDirectories(directory);Path defaults=directory.resolve("defaults.json");
            Files.copy(Path.of("HBDS",key,"defaults.json"),defaults);originals.put(defaults,Files.readAllBytes(defaults));
            Files.writeString(directory.resolve("index.json"),"[]");
        }
        originals.put(first,Files.readAllBytes(first));
        var workspace=new NamespaceConfiguration(Path.of(""),List.of(first,second),null,metadata);
        var store=TimelineHbds.open(Path.of(""),workspace.register());
        JSONObject document=store.read().getJSONObject("document");JSONArray defaults=new JSONArray(document.getJSONArray("users").toString());
        assertEquals(List.of("admin","guest"),defaults.toList().stream().map(item->((Map<?,?>)item).get("id")).toList());
        assertTrue(defaults.getJSONObject(0).getBoolean("admin"));assertFalse(defaults.getJSONObject(1).getBoolean("admin"));
        document.getJSONArray("users").put(new JSONObject(defaults.getJSONObject(1).toString()).put("id","local_user").put("name","Local user").put("email","local@example.invalid"));
        document.getJSONArray("users").getJSONObject(0).put("name","Local administrator");
        store.update(store.etag(),document);
        Path privateFile=metadata.resolve("users/index.json");JSONArray saved=new JSONArray(Files.readString(privateFile));
        assertEquals(List.of("admin","local_user"),saved.toList().stream().map(item->((Map<?,?>)item).get("id")).toList());
        var restarted=new NamespaceConfiguration(Path.of(""),List.of(first,second),null,metadata);
        JSONObject actual=restarted.read();assertTrue(actual.getJSONArray("users").similar(document.getJSONArray("users")));
        for(var entry:originals.entrySet())assertArrayEquals(entry.getValue(),Files.readAllBytes(entry.getKey()));
        actual.put("users",defaults);restarted.save(actual);
        assertTrue(new JSONArray(Files.readString(privateFile)).isEmpty());
        assertTrue(new NamespaceConfiguration(Path.of(""),List.of(first,second),null,metadata).read().getJSONArray("users").similar(defaults));
    }
    @Test void userRegistryRejectsDuplicateLocalIdsAndMissingDefaults() throws Exception {
        var workspace=new NamespaceConfiguration(Path.of(""),List.of(first,second),null,metadata);
        JSONObject document=workspace.read();assertEquals(2,document.getJSONArray("users").length());
        document.getJSONArray("users").remove(1);
        assertTrue(assertThrows(ApiException.class,()->workspace.save(document)).getMessage().contains("Default users must remain present"));
        Path privateFile=metadata.resolve("users/index.json");assertFalse(Files.exists(privateFile));Files.createDirectories(privateFile.getParent());
        JSONObject user=new JSONObject(document.getJSONArray("users").getJSONObject(0).toString()).put("id","local_user").put("name","Local user");
        Files.writeString(privateFile,new JSONArray().put(user).put(user).toString());
        assertTrue(assertThrows(IllegalArgumentException.class,()->new NamespaceConfiguration(Path.of(""),List.of(first,second),null,metadata)).getMessage().contains("Duplicate users identity"));
    }
    @Test void workspaceStartupResolvesRelativeAndAbsoluteFiles() throws Exception {
        Path selection=metadata.resolve("workspace.json");
        Files.writeString(selection,new JSONObject().put("namespace_files",new JSONArray()
            .put("yaml/ALPHA_default.yml").put(second.toString())).toString());
        var workspace=new NamespaceConfiguration(Path.of(""),NamespaceConfiguration.workspaceFiles(selection),null,metadata);
        var store=TimelineHbds.open(Path.of(""),workspace.register());
        assertEquals(2,store.read().getJSONObject("document").getJSONArray("namespaces").length());
        assertEquals("BETA",store.publicConfiguration("BETA").getString("namespace"));
        write(metadata.resolve("service.yml"),new JSONObject().put("config_version",2));
        assertDoesNotThrow(()->com.openbexi.timeline.server.openbexi_timeline.main(new String[]{"--workspace",selection.toString(),"--check"}));
        Files.writeString(metadata.resolve("service.local.yml"),"config_version: 1\n");
        assertThrows(IllegalArgumentException.class,()->com.openbexi.timeline.server.openbexi_timeline.main(new String[]{"--workspace",selection.toString(),"--check"}));
        assertDoesNotThrow(()->com.openbexi.timeline.server.openbexi_timeline.main(new String[]{"--workspace",selection.toString(),"-serverconf",metadata.resolve("service.yml").toString(),"--check"}));
    }
    @Test void workspaceRejectsInvalidSelection() throws Exception {
        Path selection=metadata.resolve("workspace.json");
        for(Object files:List.of(JSONObject.NULL,new JSONArray(),"yaml/ALPHA_default.yml",new JSONArray().put(""),new JSONArray().put(7))) {
            Files.writeString(selection,new JSONObject().put("namespace_files",files).toString());
            assertThrows(IllegalArgumentException.class,()->NamespaceConfiguration.workspaceFiles(selection));
        }
        assertThrows(IllegalArgumentException.class,()->com.openbexi.timeline.server.openbexi_timeline.main(new String[]{"--workspace",selection.toString(),"-dataconf",first.toString(),"--check"}));
    }
    @Test void namedWorkspacesIsolateTabsAliasesAndRegistration() throws Exception {
        Files.copy(metadata.resolve("models/default.json"),metadata.resolve("models/alternate.json"));
        Path defaults=metadata.resolve("workspace.json"),selected=metadata.resolve("First_Workspace.json"),other=metadata.resolve("Second_Workspace.json");
        Files.writeString(defaults,new JSONObject().put("aliases",new JSONObject().put(first.getFileName().toString(),"missing.yml")).toString());
        for(Path file:List.of(selected,other))Files.writeString(file,new JSONObject().put("name",file.getFileName().toString()).put("service","service.yml")
            .put("namespace_files",new JSONArray().put("yaml/ALPHA_default.yml").put("yaml/BETA_default.yml")).toString());
        byte[] defaultBefore=Files.readAllBytes(defaults),otherBefore=Files.readAllBytes(other);
        var workspace=new NamespaceConfiguration(Path.of(""),NamespaceConfiguration.workspaceFiles(selected),null,metadata,selected);
        var secondWorkspace=new NamespaceConfiguration(Path.of(""),NamespaceConfiguration.workspaceFiles(other),null,metadata,other);
        assertNotEquals(workspace.register(),secondWorkspace.register());
        var configuration=new com.openbexi.timeline.data_browser.data_configuration(workspace.register().toString()).getConfiguration();
        assertEquals(selected.toAbsolutePath().normalize().toString(),configuration.get("_hbds_workspace"));
        assertEquals(List.of("ALPHA","BETA"),configuration.get("_hbds_filter_namespaces"));
        JSONObject document=workspace.read();document.getJSONArray("tabs").getJSONObject(0).put("title","First workspace title");
        document.getJSONArray("namespaces").getJSONObject(0).put("modelId","model_alternate");workspace.save(document);
        assertArrayEquals(defaultBefore,Files.readAllBytes(defaults));assertArrayEquals(otherBefore,Files.readAllBytes(other));
        JSONObject saved=new JSONObject(Files.readString(selected));assertEquals("service.yml",saved.getString("service"));
        assertEquals("yaml/ALPHA_alternate.yml",saved.getJSONArray("namespace_files").getString(0));
        var restarted=new NamespaceConfiguration(Path.of(""),NamespaceConfiguration.workspaceFiles(selected),null,metadata,selected);
        assertEquals("First workspace title",restarted.read().getJSONArray("tabs").getJSONObject(0).getString("title"));
        assertEquals("ALPHA",secondWorkspace.read().getJSONArray("tabs").getJSONObject(0).getString("title"));
        write(metadata.resolve("service.yml"),new JSONObject().put("config_version",2));
        Files.writeString(metadata.resolve("service.local.yml"),"config_version: 1\n");
        assertEquals(metadata.resolve("service.yml"),NamespaceConfiguration.workspaceService(selected));
        assertDoesNotThrow(()->com.openbexi.timeline.server.openbexi_timeline.main(new String[]{"--workspace",selected.toString(),"--check"}));
    }
    @Test void duplicateAndIncorrectFilenamesFail() throws Exception {
        assertThrows(IllegalArgumentException.class,()->new NamespaceConfiguration(Path.of(""),List.of(first,first),null,metadata));
        Path wrong=metadata.resolve("yaml/wrong.yml");Files.copy(first,wrong);
        assertThrows(IllegalArgumentException.class,()->new NamespaceConfiguration(Path.of(""),List.of(wrong),null,metadata));
    }
    @Test void existingMaterializedDirectoryRequiresExplicitBooleanAndRemainsLocal() throws Exception {
        JSONObject value=namespace("ALPHA").put("target_path",temp.resolve("existing_events/yyyy/mm/dd").toString());
        write(first,value);
        assertThrows(IllegalArgumentException.class,()->new NamespaceConfiguration(Path.of(""),List.of(first),null,metadata));
        for(Object flag:List.of(false,"true",1,JSONObject.NULL)) {
            value.put("allow_external_namespace_path",flag);write(first,value);
            assertThrows(IllegalArgumentException.class,()->new NamespaceConfiguration(Path.of(""),List.of(first),null,metadata));
        }
        value.put("allow_external_namespace_path",true);write(first,value);
        var workspace=new NamespaceConfiguration(Path.of(""),List.of(first),null,metadata);
        JSONObject document=workspace.read();
        document.getJSONArray("sources").getJSONObject(0).getJSONObject("configuration").put("extension","saved");
        workspace.save(document);
        assertTrue(NamespaceConfiguration.yaml(first).getBoolean("allow_external_namespace_path"));
        assertEquals(Path.of(value.getString("target_path")),Path.of(NamespaceConfiguration.yaml(first).getString("target_path")));
        value.put("target_path","s3://example/existing_events");write(first,value);
        assertThrows(IllegalArgumentException.class,()->new NamespaceConfiguration(Path.of(""),List.of(first),null,metadata));
    }
    @Test void targetExceptionDoesNotRelaxInputOrOutputOverlapChecks() throws Exception {
        JSONObject value=namespace("ALPHA").put("target_path",temp.resolve("existing_events/yyyy/mm/dd").toString()).put("allow_external_namespace_path",true);
        value.getJSONArray("sources").getJSONObject(0).put("source_path",temp.resolve("unrelated_input").toString());write(first,value);
        assertThrows(IllegalArgumentException.class,()->new NamespaceConfiguration(Path.of(""),List.of(first),null,metadata));
        value.put("sources",namespace("ALPHA").getJSONArray("sources"));write(first,value);
        write(second,namespace("BETA").put("target_path",value.getString("target_path")).put("allow_external_namespace_path",true));
        assertThrows(IllegalArgumentException.class,()->new NamespaceConfiguration(Path.of(""),List.of(first,second),null,metadata));
    }
    @Test void editorSavePreservesUneditedNamespaceBytesAndChecksRevision() throws Exception {
        var workspace=new NamespaceConfiguration(Path.of(""),List.of(first,second),null,metadata);
        var store=TimelineHbds.open(Path.of(""),workspace.register());byte[] before=Files.readAllBytes(second);
        String revision=store.etag();JSONObject document=store.read().getJSONObject("document");
        document.getJSONArray("sources").getJSONObject(0).getJSONObject("configuration").put("extension",new JSONObject().put("keep",true));
        store.update(revision,document);
        assertArrayEquals(before,Files.readAllBytes(second));
        assertTrue(NamespaceConfiguration.yaml(first).getJSONObject("extension").getBoolean("keep"));
        assertThrows(ApiException.class,()->store.update(revision,document));
    }
    @Test void conflictingServiceBindingsFail() throws Exception {
        Path service=metadata.resolve("service.yml");write(service,new JSONObject().put("config_version",2).put("connectors",new JSONArray()
            .put(new JSONObject().put("id","one").put("owner","java").put("type","http").put("port",18088))
            .put(new JSONObject().put("id","two").put("owner","python").put("type","http").put("port",18088))));
        assertThrows(IllegalArgumentException.class,()->new NamespaceConfiguration(Path.of(""),List.of(first),service,metadata));
    }

    @Test void modelSelectionAndTabsSurviveRestartUsingOriginalLaunchFiles() throws Exception {
        Files.copy(metadata.resolve("models/default.json"),metadata.resolve("models/alternate.json"));
        var workspace=new NamespaceConfiguration(Path.of(""),List.of(first,second),null,metadata);
        JSONObject document=workspace.read();byte[] before=Files.readAllBytes(second);
        document.getJSONArray("namespaces").getJSONObject(0).put("modelId","model_alternate");
        document.getJSONArray("tabs").getJSONObject(0).put("title","Updated label");
        workspace.save(document);
        var restarted=new NamespaceConfiguration(Path.of(""),List.of(first,second),null,metadata);
        assertEquals("model_alternate",restarted.read().getJSONArray("namespaces").getJSONObject(0).getString("modelId"));
        assertEquals("Updated label",restarted.read().getJSONArray("tabs").getJSONObject(0).getString("title"));
        assertArrayEquals(before,Files.readAllBytes(second));
        Path renamed=metadata.resolve("yaml/ALPHA_alternate.yml");JSONObject value=NamespaceConfiguration.yaml(renamed);value.put("extension","external");write(renamed,value);
        assertEquals("external",restarted.read().getJSONArray("sources").getJSONObject(0).getJSONObject("configuration").getString("extension"));
    }

    @Test void invalidSaveRollsBackAndRemainsEditable() throws Exception {
        var workspace=new NamespaceConfiguration(Path.of(""),List.of(first,second),null,metadata);
        JSONObject document=workspace.read();byte[] before=Files.readAllBytes(first);
        document.getJSONArray("sources").getJSONObject(0).getJSONObject("configuration").put("target_path",temp.resolve("wrong").toString());
        assertThrows(IllegalArgumentException.class,()->workspace.save(document));
        assertArrayEquals(before,Files.readAllBytes(first));assertEquals(2,workspace.read().getJSONArray("namespaces").length());
    }
}
