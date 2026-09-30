package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class SearchQueryTest {
    @Test void browserAndServerShareTextPatternAndLegacySemantics() throws Exception {
        JSONObject fixture=(JSONObject)new JSONParser().parse(Files.readString(Path.of("tests/fixtures/search-modes.json")));
        JSONArray events=(JSONArray)fixture.get("events");
        for(Object value:(JSONArray)fixture.get("cases")) {
            JSONObject item=(JSONObject)value;
            SearchQuery query=new SearchQuery((String)item.get("query"),(String)item.get("mode"));
            List<String> ids=new ArrayList<>();
            for(Object record:events)if(query.matches((JSONObject)record))ids.add((String)((JSONObject)record).get("id"));
            assertEquals(item.get("ids"),ids,item.toJSONString());
            JSONObject response=MatchResults.envelope(events,(String)item.get("query"),"0",
                    MatchResults.time("2026-09-12T00:00:00Z"),MatchResults.time("2026-09-13T00:00:00Z"),true,(String)item.get("mode"));
            JSONObject meta=(JSONObject)response.get("timelineMatch");
            assertNull(meta.get("error"));assertEquals(item.get("mode"),meta.get("searchMode"));
        }
    }
    @Test void invalidPatternsFailAndMissingModeKeepsLegacyBehavior() {
        assertThrows(IllegalArgumentException.class,()->new SearchQuery("[","pattern"));
        assertThrows(IllegalArgumentException.class,()->new SearchQuery("x","unsupported"));
        assertFalse(new SearchQuery("*",null).active);
        assertTrue(new SearchQuery("*","text").matchesText("literal *"));
        assertTrue(new SearchQuery("Ground;Radio",null).matchesText("Radio"));
    }
}
