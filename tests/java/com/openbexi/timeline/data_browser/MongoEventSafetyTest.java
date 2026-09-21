package com.openbexi.timeline.data_browser;

import com.mongodb.client.MongoCollection;
import com.mongodb.client.result.DeleteResult;
import com.mongodb.client.result.UpdateResult;
import org.bson.Document;
import org.bson.conversions.Bson;
import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** Exercises adapter operations against a recording collection: no Mongo service or real data. */
class MongoEventSafetyTest {
    private final Map<Object, Document> stored = new LinkedHashMap<>();
    private int mutations;

    @SuppressWarnings("unchecked")
    private db_mongo_manager manager() {
        MongoCollection<Document> collection = (MongoCollection<Document>) Proxy.newProxyInstance(
                MongoCollection.class.getClassLoader(), new Class<?>[]{MongoCollection.class}, (proxy, method, args) -> {
                    switch (method.getName()) {
                        case "insertMany":
                            mutations++;
                            for (Document event : (Iterable<Document>) args[0]) {
                                if (stored.containsKey(event.get("_id"))) throw new IllegalStateException("duplicate key");
                                stored.put(event.get("_id"), new Document(event));
                            }
                            return null;
                        case "deleteOne":
                        case "replaceOne":
                            Document selector = (Document) (Bson) args[0];
                            assertEquals(1, selector.size(), "A write must target one scalar ID");
                            String key = selector.keySet().iterator().next();
                            Document equality = (Document) selector.get(key);
                            assertEquals(1, equality.size());
                            assertTrue(equality.containsKey("$eq"));
                            Object target = equality.get("$eq");
                            Object matched = stored.entrySet().stream()
                                    .filter(entry -> target.equals(entry.getValue().get(key)))
                                    .map(Map.Entry::getKey).findFirst().orElse(null);
                            mutations++;
                            if (method.getName().equals("deleteOne")) {
                                if (matched != null) stored.remove(matched);
                                return DeleteResult.acknowledged(matched == null ? 0 : 1);
                            }
                            if (matched != null) {
                                Document replacement = new Document((Document) args[1]);
                                replacement.putIfAbsent("_id", matched);
                                stored.put(matched, replacement);
                            }
                            return UpdateResult.acknowledged(matched == null ? 0 : 1, matched == null ? 0L : 1L, null);
                        default:
                            throw new AssertionError("Unexpected collection operation: " + method.getName());
                    }
                });
        JSONObject configuration = new JSONObject();
        configuration.put("startDate", "Thu Jan 01 00:00:00 UTC 2026");
        configuration.put("endDate", "Fri Jan 02 00:00:00 UTC 2026");
        return new db_mongo_manager(collection, new data_configuration(configuration));
    }

    private JSONArray records(String json) throws Exception {
        return (JSONArray) new JSONParser().parse(json);
    }

    @Test
    void addingAnEventPreservesExistingRecordsAndNestedArrays() throws Exception {
        stored.put("existing", new Document("_id", "existing").append("id", "existing"));
        assertTrue(manager().addEvents(records("[{\"id\":\"new\",\"activities\":[{\"id\":\"child\"}]}]"), null));
        assertEquals(2, stored.size());
        assertTrue(stored.containsKey("existing"));
        assertTrue(stored.get("new").get("activities") instanceof java.util.List);
    }

    @Test
    void deletingOneEventPreservesEveryOtherRecord() throws Exception {
        stored.put("first", new Document("_id", "first").append("id", "first"));
        stored.put("second", new Document("_id", "second").append("id", "second"));
        assertTrue(manager().removeEvents(records("[{\"id\":\"first\"}]"), null));
        assertEquals(java.util.Set.of("second"), stored.keySet());
    }

    @Test
    void missingIdOperatorIdAndNullDeleteNeverMutateAnything() throws Exception {
        db_mongo_manager adapter = manager();
        assertFalse(adapter.removeEvents(null, null));
        assertFalse(adapter.removeEvents(records("[{}]"), null));
        assertFalse(adapter.removeEvents(records("[{\"id\":{\"$ne\":null}}]"), null));
        assertFalse(adapter.addEvents(records("[{\"id\":\"valid\"},{}]"), null));
        assertFalse(adapter.updateEvents(records("[{\"id\":\"valid\"},{}]"), null));
        assertEquals(0, mutations);
    }

    @Test
    void emptyBatchIsSafeAndDuplicateBatchIsRejectedBeforeWriting() throws Exception {
        db_mongo_manager adapter = manager();
        assertTrue(adapter.addEvents(new JSONArray(), null));
        assertTrue(adapter.removeEvents(new JSONArray(), null));
        assertFalse(adapter.addEvents(records("[{\"id\":\"same\"},{\"id\":\"same\"}]"), null));
        assertEquals(0, mutations);
    }

    @Test
    void updateReplacesOnlyTheSelectedRecordAndDoesNotUpsertMissingRecords() throws Exception {
        stored.put("first", new Document("_id", "first").append("id", "first"));
        stored.put("second", new Document("_id", "second").append("id", "second"));
        db_mongo_manager adapter = manager();
        assertTrue(adapter.updateEvents(records("[{\"id\":\"first\",\"title\":\"Updated\"}]"), null));
        assertEquals("Updated", stored.get("first").get("title"));
        assertEquals(2, stored.size());
        assertFalse(adapter.updateEvents(records("[{\"id\":\"missing\"}]"), null));
        assertEquals(2, stored.size());
    }

    @Test
    void acceptsHistoricalEventEnvelopeWithoutStoringItAsOneAggregate() throws Exception {
        assertTrue(manager().addEvents(records("[{\"dateTimeFormat\":\"iso8601\",\"events\":[{\"id\":\"a\"},{\"id\":\"b\"}]}]"), null));
        assertEquals(java.util.Set.of("a", "b"), stored.keySet());
    }
}
