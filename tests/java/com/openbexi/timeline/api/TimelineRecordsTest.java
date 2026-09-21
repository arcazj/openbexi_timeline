package com.openbexi.timeline.api;

import org.json.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class TimelineRecordsTest {
    private final Path root = Path.of("").toAbsolutePath();
    private final JSONObject calendar = new JSONObject();
    private JSONObject numeric() {
        return new JSONObject().put("kind", "numeric").put("unit", "Ma").put("millisecondsPerUnit", 31536000000L)
                .put("direction", -1).put("approximatePrefixes", new JSONArray().put("?"));
    }
    private JSONObject model(JSONObject source) { return new JSONObject().put("dataSource", source); }

    @Test
    void englishSourceDatesHandleOffsetsAbbreviationsAndShortYearsDeterministically() {
        assertEquals("0897-01-01T00:00:00.000Z", TimelineRecords.time("Jan 01 0897", calendar));
        assertEquals("1963-11-25T06:00:00.000Z", TimelineRecords.time("Nov 25 1963 00:00:00 GMT-0600", calendar));
        assertEquals("1963-11-22T18:30:00.000Z", TimelineRecords.time("Fri Nov 22 1963 12:30:00 GMT-0600", calendar));
        assertEquals("2026-09-20T13:30:00.000Z", TimelineRecords.time("Sep 20 2026 09:30 EDT", calendar));
        assertEquals("1925-05-01T05:00:00.000Z", TimelineRecords.time("Fri May 01 00:00:00 EST 1925", calendar));
        assertEquals("1925-05-01T04:00:00.000Z", TimelineRecords.time("Fri May 01 00:00:00 EDT 1925", calendar));
        assertEquals("0201-05-03T05:00:00.000Z", TimelineRecords.time("Sun May 03 00:00:00 EST 201", calendar));
        assertEquals("1963-11-22T18:30:00.000Z", TimelineRecords.time("Fri, 22 Nov 1963 18:30:00 GMT", calendar));
        assertEquals("1963-11-22T18:30:00.123Z", TimelineRecords.time("1963-11-22T12:30:00.123456-06:00", calendar));
    }

    @Test
    void bceAndNumericApproximationRetainTheirUnitsAndBrowserCompatibleOutput() {
        assertEquals("0000-01-01T00:00:00.000Z", TimelineRecords.time("1 BC", calendar));
        assertEquals("0001-01-01T00:00:00.000Z", TimelineRecords.time("1 AD", calendar));
        assertEquals("-000043-01-01T00:00:00.000Z", TimelineRecords.time("44 BCE", calendar));
        assertEquals("0107-01-01T00:00:00.000Z", TimelineRecords.time("107?", calendar));
        assertEquals("0006-01-01T00:00:00.000Z", TimelineRecords.time("6", calendar));
        assertEquals("+010000-01-01T00:00:00.000Z", TimelineRecords.time("10000", calendar));
        JSONObject source = new JSONObject().put("format", "json").put("time", numeric());
        JSONArray records = TimelineRecords.parse("{\"events\":[{\"start\":\"?76\",\"end\":70,\"title\":\"Approximate lifespan\"}]}", model(source));
        JSONObject record = records.getJSONObject(0);
        assertEquals(76, record.getDouble("start"));
        assertEquals(70, record.getDouble("end"));
        assertEquals("?76", record.getJSONObject("data").getString("startValue"));
        assertEquals(70, record.getJSONObject("data").getInt("endValue"));
        assertTrue(TimelineRecords.coordinate(record.get("start"), numeric()) < TimelineRecords.coordinate(record.get("end"), numeric()));
    }

    @Test
    void invalidCalendarDatesAndOutOfRangeValuesRemainWriteErrors() {
        for (String invalid : List.of("2024-02-30", "2024-02-30T00:00:00Z", "Feb 30 2024", "Feb 30 2024 12:00:00 GMT", "999999")) {
            ApiException error = assertThrows(ApiException.class, () -> TimelineRecords.time(invalid, calendar), invalid);
            assertEquals(422, error.status);
        }
        assertThrows(ApiException.class, () -> TimelineRecords.time(1e300, calendar));
        assertThrows(ApiException.class, () -> TimelineRecords.time(1e300, numeric()));
        assertEquals("2024-02-29T00:00:00.000Z", TimelineRecords.time("Feb 29 2024", calendar));
        JSONObject invalidRecord = new JSONObject().put("id", "invalid-date").put("start", "2024-02-30")
                .put("data", new JSONObject().put("title", "Must reject"));
        assertThrows(ApiException.class, () -> TimelineRecords.validate(invalidRecord, calendar, 0));
    }

    @Test
    void generatedAndDuplicateIdsMatchTheBrowserAcrossDeletedRowsActivitiesAndZones() {
        String input = "{\"events\":[null,{\"deletedAt\":\"2026\",\"start\":\"2000\"}," +
                "{\"id\":\"same\",\"start\":\"2000\",\"title\":\"First\"}," +
                "{\"id\":\"same\",\"start\":\"2001\",\"title\":\"Second\"}," +
                "{\"start\":\"2002\",\"title\":\"Parent\",\"activities\":[{\"start\":\"2002\",\"title\":\"Child\"}]}]," +
                "\"zones\":[{\"start\":\"2000\",\"end\":\"2001\",\"title\":\"Highlight\"}]}";
        JSONObject model = model(new JSONObject().put("format", "json"));
        JSONArray first = TimelineRecords.parse(input, model), second = TimelineRecords.parse(input, model);
        assertTrue(first.similar(second), "Reloads preserve IDs and metadata");
        assertEquals("same", first.getJSONObject(0).getString("id"));
        assertEquals("same-1", first.getJSONObject(1).getString("id"));
        assertEquals("record-2", first.getJSONObject(2).getString("id"));
        assertEquals("record-2-0", first.getJSONObject(2).getJSONArray("activities").getJSONObject(0).getString("id"));
        assertEquals("record-zone-0", first.getJSONObject(3).getString("id"));
    }

    @Test
    void allCatalogSourcesNormalizeWithExpectedCountsStableIdsAndValidModelAxes() throws Exception {
        JSONObject catalog = new JSONObject(Files.readString(root.resolve("demos/catalog.json")));
        for (Object entry : catalog.getJSONArray("demos")) {
            JSONObject demo = (JSONObject) entry;
            JSONObject model = new JSONObject(Files.readString(root.resolve(demo.getString("model"))));
            String text = Files.readString(root.resolve(demo.getString("dataset")));
            JSONArray records = TimelineRecords.parse(text, model);
            assertTrue(records.similar(TimelineRecords.parse(text, model)), demo.getString("id"));
            int count = 0;
            Set<String> ids = new HashSet<>();
            JSONObject axis = TimelineRecords.axis(model);
            for (Object value : records) {
                JSONObject record = (JSONObject) value;
                if (!record.optBoolean("zone")) count++;
                assertTrue(ids.add(record.getString("id")), "Unique source record: " + demo.getString("id"));
                assertTrue(Double.isFinite(TimelineRecords.coordinate(record.get("start"), axis)));
                if (record.has("end")) assertTrue(TimelineRecords.coordinate(record.get("end"), axis) >= TimelineRecords.coordinate(record.get("start"), axis));
            }
            assertEquals(demo.getInt("recordCount"), count, demo.getString("id"));
        }
    }
}
