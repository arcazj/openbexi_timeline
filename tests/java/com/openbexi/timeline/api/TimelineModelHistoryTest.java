package com.openbexi.timeline.api;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class TimelineModelHistoryTest {
    @TempDir Path storage;

    @Test void persistsImmutableModelRevisionsWithoutTimelineItems() throws Exception {
        TimelineModelHistory history = new TimelineModelHistory(storage);
        JSONObject before = model("Before"), after = model("After");
        JSONObject saved = history.record("operations", "user-a", before, after);
        after.getJSONArray("params").getJSONObject(0).put("title", "Changed later");
        TimelineModelHistory reopened = new TimelineModelHistory(storage);
        assertEquals(2, reopened.list("operations").getJSONArray("items").length());
        JSONObject revision = reopened.read("operations", saved.getString("revision"));
        assertEquals("After", revision.getJSONObject("configuration").getJSONArray("params").getJSONObject(0).getString("title"));
        assertEquals("saved", revision.getString("state"));
        assertFalse(reopened.list("operations").getJSONArray("items").getJSONObject(0).has("configuration"));
        assertEquals(0, reopened.list("other-model").getJSONArray("items").length());
        assertThrows(ApiException.class, () -> reopened.read("other-model", saved.getString("revision")));
    }

    @Test void idempotentWritesAndValidationDoNotLeakOrMutateItems() throws Exception {
        TimelineModelHistory history = new TimelineModelHistory(storage);
        JSONObject original = model("Same");
        history.record("m", "admin", null, original);
        history.record("m", "admin", null, new JSONObject(original.toString()));
        assertEquals(1, history.list("m").getJSONArray("items").length());
        assertThrows(IllegalArgumentException.class, () -> history.record("m", "admin", null, new JSONObject().put("events", new JSONArray())));
        assertThrows(ApiException.class, () -> history.list("../secret"));
        assertThrows(ApiException.class, () -> history.read("m", "../secret"));
        assertEquals(1, history.list("m").getJSONArray("items").length());
    }

    private JSONObject model(String title) {
        return new JSONObject().put("params", new JSONArray().put(new JSONObject().put("title", title)))
                .put("bands", new JSONArray()).put("rendering", new JSONObject().put("custom", "preserved"));
    }
}
