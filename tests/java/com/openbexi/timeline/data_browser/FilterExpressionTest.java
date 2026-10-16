package com.openbexi.timeline.data_browser;

import org.json.simple.*;
import org.json.simple.parser.JSONParser;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class FilterExpressionTest {
    @Test void sharedExpressionsMatchBrowserSemanticsAndRejectInvalidInput() throws Exception {
        JSONObject fixture=(JSONObject)new JSONParser().parse(Files.readString(Path.of("tests/fixtures/filter-expressions.json")));
        JSONArray records=(JSONArray)fixture.get("records");
        for(Object value:(JSONArray)fixture.get("cases")) {
            JSONObject sample=(JSONObject)value;String expression=(String)sample.get("expression");
            var predicate=FilterExpression.compile(expression);List<Object> ids=new ArrayList<>();
            for(Object record:records)if(predicate.test((JSONObject)record))ids.add(((JSONObject)record).get("id"));
            assertEquals(sample.get("ids"),ids,expression);
        }
        for(Object expression:(JSONArray)fixture.get("invalid"))assertThrows(FilterExpression.Invalid.class,()->FilterExpression.compile((String)expression),expression.toString());
        assertThrows(FilterExpression.Invalid.class,()->FilterExpression.compile("expr: "+"NOT ".repeat(35)+"a = b"));
        JSONObject zero=new JSONObject(Map.of("priority",0));
        assertTrue(FilterExpression.compile("expr: priority = -0 AND priority >= -0").test(zero));
        assertFalse(FilterExpression.compile("expr: priority > -0").test(zero));
    }

    @Test void quotedPresetsRoundTripWithSortingAndInvalidSavesKeepPreviousSettings() throws Exception {
        String user="filter_test_"+UUID.randomUUID().toString().replace("-","");
        Path file=Path.of("HBDS/filters",user+"_sample_filter_setting.json");
        JSONObject query=new JSONObject(Map.of("userName",user,"timelineName","sample","request","saveFilter",
                "filterName","Advanced","filter","expr: title CONTAINS \"A+B | ready\"","sortBy","namespace","startup configuration",new JSONArray()));
        try {
            SavedFilters.update(new data_configuration(query));String before=Files.readString(file);
            JSONObject next=new JSONObject(Map.of("userName",user,"timelineName","sample"));SavedFilters.resolve(next);
            assertEquals(query.get("filter"),next.get("filter"));assertEquals("namespace",next.get("sortBy"));
            query.put("filter","expr: priority >");
            assertThrows(FilterExpression.Invalid.class,()->SavedFilters.update(new data_configuration(query)));
            assertEquals(before,Files.readString(file));
            next.put("filterProvided",true);next.put("filter","");SavedFilters.resolve(next);assertEquals("",next.get("filter"));
        } finally {Files.deleteIfExists(file);}
    }
    @Test void workspaceProfilesPreserveTheirLegacyFiltersWithoutSharingNewSelections(@TempDir Path root) throws Exception {
        Path metadata=root.resolve("HBDS"),legacy=metadata.resolve("filters/guest_report_filter_setting.json");
        Files.createDirectories(legacy.getParent());
        JSONObject original=new JSONObject(Map.of("namespace","0","openbexi_timeline",List.of(new JSONObject(Map.of(
                "name","old_name","user","old_user","sources",List.of(Map.of("namespace","operations")),
                "filters",List.of(Map.of("name","Commands","filter_value","system:CMD","current","yes","sortBy","NONE")))))));
        String before=original.toJSONString();Files.writeString(legacy,before);
        Files.writeString(legacy.getParent().resolve("default_filter_setting.json"),before);
        JSONObject first=new JSONObject(Map.of("_hbds_root",metadata.toString(),"_hbds_workspace",metadata.resolve("First_Workspace.json").toString(),
                "userName","guest","timelineName","report","request","readFilters"));
        JSONArray sources=new JSONArray();sources.add(new JSONObject(Map.of("namespace","operations")));first.put("startup configuration",sources);
        JSONObject second=new JSONObject(first);second.put("_hbds_workspace",metadata.resolve("Second_Workspace.json").toString());
        JSONArray otherSources=new JSONArray();otherSources.add(new JSONObject(Map.of("namespace","volcano")));second.put("startup configuration",otherSources);
        SavedFilters.resolve(first);assertEquals("system:CMD",first.get("filter"));
        SavedFilters.resolve(second);assertFalse(second.containsKey("filter"));
        JSONObject loaded=(JSONObject)((JSONArray)SavedFilters.update(new data_configuration(second)).get("openbexi_timeline")).get(0);
        assertEquals("ALL",((JSONObject)((JSONArray)loaded.get("filters")).get(0)).get("name"));
        JSONObject grouped=(JSONObject)((JSONArray)loaded.get("filters")).get(1);
        assertEquals("by_namespace",grouped.get("name"));assertEquals("",grouped.get("filter_value"));
        assertEquals("namespace",grouped.get("sortBy"));assertEquals("no",grouped.get("current"));
        second.put("request","saveFilter");second.put("filterName","Volcano notices");second.put("filter","expr: type = volcano");second.put("sortBy","namespace");
        SavedFilters.update(new data_configuration(second));
        assertTrue(Files.isRegularFile(metadata.resolve("filters/workspaces/Second_Workspace/guest_report_filter_setting.json")));
        assertEquals(before,Files.readString(legacy));
        SavedFilters.resolve(first);assertEquals("system:CMD",first.get("filter"));
        JSONObject restored=(JSONObject)((JSONArray)SavedFilters.update(new data_configuration(first)).get("openbexi_timeline")).get(0);
        assertEquals("report",restored.get("name"));assertEquals("guest",restored.get("user"));
        first.put("request","saveFilter");first.put("filterName","Commands");SavedFilters.update(new data_configuration(first));
        second.remove("filter");SavedFilters.resolve(second);assertEquals("expr: type = volcano",second.get("filter"));
        assertEquals(before,Files.readString(legacy));
        second.put("filterProvided",true);second.put("filter","");SavedFilters.resolve(second);assertEquals("",second.get("filter"));
    }

    @Test void filenameFiltersAcceptEquivalentAbsoluteAndRelativePaths() {
        Path root=Path.of("archive"),file=root.resolve("nested/events.json");
        for(JSONObject source:List.of(new JSONObject(Map.of("filter",new JSONObject())),
                new JSONObject(Map.of("filter",new JSONObject(Map.of("include",List.of("nested/*.json"))))))) {
            assertTrue(SourceFileFilters.compile(source,root.toAbsolutePath()).test(file));
            assertTrue(SourceFileFilters.compile(source,root).test(file.toAbsolutePath()));
            assertTrue(SourceFileFilters.compile(source,root).test(root.resolve("nested/../nested/events.json")));
        }
    }

    @Test void filenameListsFilterInventorySeparatelyFromRecordExpressions() {
        Path root=Path.of("archive");JSONObject source=new JSONObject(Map.of("filter",new JSONObject(Map.of(
                "include",List.of("events-*.json","nested/[ab]?.json"),"exclude",List.of("events-secret*")))));
        var files=SourceFileFilters.compile(source,root);
        assertTrue(files.test(root.resolve("events-public.json")));assertTrue(files.test(root.resolve("nested/a1.json")));
        assertFalse(files.test(root.resolve("events-secret.json")));assertFalse(files.test(root.resolve("unrelated.json")));
        assertTrue(FilterExpression.source(source).test(new JSONObject(Map.of("data",new JSONObject(Map.of("title","Any record"))))));
        ((JSONObject)source.get("filter")).put("include","expr: title = \"Wanted\"");
        assertTrue(FilterExpression.source(source).test(new JSONObject(Map.of("data",new JSONObject(Map.of("title","Wanted"))))));
        assertFalse(FilterExpression.source(source).test(new JSONObject(Map.of("data",new JSONObject(Map.of("title","Other"))))));
    }
}
