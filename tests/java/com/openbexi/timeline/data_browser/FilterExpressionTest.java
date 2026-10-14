package com.openbexi.timeline.data_browser;

import org.json.simple.*;
import org.json.simple.parser.JSONParser;
import org.junit.jupiter.api.Test;
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
        Path file=Path.of("HBDS/private/filters",user+"_sample_filter_setting.json");
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
