package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;

import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.util.*;
import java.util.regex.Pattern;

public class JsonDecoder {
    private static final Map<String, String> keyMapping = new HashMap<>();

    static {
        // Mapping various synonyms to "start", "end", "original_start", and "original_end"
        Arrays.asList(
                        "start time", "startime", "Begin", "Commence", "Initiate", "Kick off", "Launch", "Inaugurate", "Open",
                        "Embark", "Set in motion", "Activate", "Get underway", "Get going", "Set off", "Instigate", "Trigger",
                        "Initialize", "Jumpstart", "Set the ball rolling", "Roll out", "Usher in", "Get started", "Get the show on the road",
                        "Get off the ground", "Get the wheels turning", "Set sail", "Break ground", "Commencement", "Outset", "Onset",
                        "Inception", "Genesis", "Originate", "Kickstart", "Fire up", "Boot up", "Rise", "Dawn", "Go live", "Get into gear",
                        "Take the first step", "Liftoff", "Blast off", "Get cracking", "Get moving", "Start off", "Start out", "Spring into action"
                )
                .forEach(s -> keyMapping.put(s.toLowerCase(), "start"));

        // Mapping various synonyms to "end"
        Arrays.asList(
                        "end time", "endtime", "Terminate", "Conclude", "Finish", "Cease", "Close", "Wrap up", "Finalize",
                        "Complete", "Halt", "Stop", "Wind up", "Shut down", "Culminate", "Conclude", "Expiration", "Expiry",
                        "Closure", "Finale", "Adjourn", "Discontinue", "Dissolve", "Draw to a close", "Bring to a close",
                        "Bring to an end", "Round off", "Round out", "Sign off", "Fade out", "Curtains", "Climax", "Shutdown",
                        "Log off", "Power down", "Switch off", "Turn off", "Seal", "Cap", "Close out", "Wind down", "Wrap",
                        "Final curtain", "Last call", "Last lap", "Last leg", "Last round", "Last chapter", "Final act", "Swan song"
                )
                .forEach(s -> keyMapping.put(s.toLowerCase(), "end"));

        // Mapping various synonyms to "original_start"
        Arrays.asList(
                        "Original-Start", "Original Start", "Initial Start", "First Kickoff", "Primary Commencement", "Original Onset", "Initial Onset",
                        "First Commencement", "Primary Inception", "Original Inception", "Initial Activation", "First Activation",
                        "Primary Activation", "Original Kickoff", "Initial Embarkation", "First Embarkation", "Primary Embarkation",
                        "Original Launch", "Initial Launch", "First Launch", "Primary Launch", "Original Opening", "Initial Opening",
                        "First Opening", "Primary Opening", "Original Initiation", "Initial Initiation", "First Initiation",
                        "Primary Initiation", "Original Trigger", "Initial Trigger", "First Trigger", "Primary Trigger"
                )
                .forEach(s -> keyMapping.put(s.toLowerCase(), "original_start"));

        // Mapping various synonyms to "original_end"
        Arrays.asList(
                        "original-end", "original end", "Initial Termination", "First Conclusion", "Primary Cessation", "Original Wrap-up", "Initial Wrap-up",
                        "First Wrap-up", "Primary Completion", "Original Completion", "Initial Shutdown", "First Shutdown",
                        "Primary Shutdown", "Original Closure", "Initial Closure", "First Closure", "Primary Closure",
                        "Original Finale", "Initial Finale", "First Finale", "Primary Finale", "Original Culmination",
                        "Initial Culmination", "First Culmination", "Primary Culmination", "Original Cease", "Initial Cease",
                        "First Cease", "Primary Cease", "Original Finalization", "Initial Finalization", "First Finalization",
                        "Primary Finalization"
                )
                .forEach(s -> keyMapping.put(s.toLowerCase(), "original_end"));

        // Add similar lists for "end", "original_start", and "original_end" if needed
    }

    public static void decodeJson(JSONObject source, JSONObject target, String parentKey) {
        LinkedHashMap<String, Object> orderedMap = new LinkedHashMap<>();

        // Define a preferred order for keys in an event object
        List<String> preferredOrder = new ArrayList<>();
        if ("events".equals(parentKey) || "sessions".equals(parentKey)) {
            preferredOrder = Arrays.asList("id", "start", "end", "original_start", "original_end",
                    "render", "data", "activities");
        }

        // First, add keys in the preferred order if they exist
        for (String key : preferredOrder) {
            if (source.containsKey(key)) {
                Object value = source.get(key);
                orderedMap.put(mapKey(key), value);
            }
        }

        // Then, add any remaining keys that were not in the preferred order
        for (Object key : source.keySet()) {
            if (!preferredOrder.contains(key)) {
                Object value = source.get(key);
                orderedMap.put(mapKey(key.toString()), value);
            }
        }

        // Finally, populate the target JSONObject with the ordered keys and values
        for (Map.Entry<String, Object> entry : orderedMap.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();

            if (value instanceof JSONObject) {
                JSONObject newTarget = new JSONObject();
                decodeJson((JSONObject) value, newTarget, key);
                orderedMap.put(key, newTarget);
            } else if (value instanceof JSONArray array) {
                JSONArray newArray = new JSONArray();
                for (int i = 0; i < array.size(); i++) {
                    if (array.get(i) instanceof JSONObject) {
                        JSONObject newTarget = new JSONObject();
                        decodeJson((JSONObject) array.get(i), newTarget, key);
                        newArray.add(newTarget);
                    } else {
                        newArray.add(array.get(i));
                    }
                }
                orderedMap.put(key, newArray);
            }
        }

        target.putAll(orderedMap);
    }


    public static String mapKey(String originalKey) {
        // Convert the original key to lowercase for case-insensitive matching
        String lowerCaseKey = originalKey.toLowerCase();

        // Use regex to match keys based on specific patterns
        if (keyMapping.containsKey(lowerCaseKey)) {
            return keyMapping.get(lowerCaseKey);
        } else if (Pattern.compile("^start$").matcher(lowerCaseKey).matches()) {
            return "start";
        } else if (Pattern.compile("^end$").matcher(lowerCaseKey).matches()) {
            return "end";
        } else if (Pattern.compile("^original[_\\s-]*start$").matcher(lowerCaseKey).matches()) {
            return "original_start";
        } else if (Pattern.compile("^original[_\\s-]*end$").matcher(lowerCaseKey).matches()) {
            return "original_end";
        }

        return originalKey;
    }


    public static void main(String[] args) {
        JSONParser parser = new JSONParser();

        try (FileReader reader = new FileReader("json/source_example.json")) {
            JSONObject jsonObject = (JSONObject) parser.parse(reader);
            JSONObject targetJsonObject = new JSONObject();  // To maintain order

            decodeJson(jsonObject, targetJsonObject, "");

            // Add "dateTimeFormat" and "events" to target if they are not in the source
            if (!jsonObject.containsKey("dateTimeFormat")) {
                targetJsonObject.put("dateTimeFormat", "iso8601");
            }
            if (!jsonObject.containsKey("events") && !jsonObject.containsKey("sessions")) {
                targetJsonObject.put("events", new JSONArray());
            }

            System.out.println(targetJsonObject.toJSONString());

            // Write to target_example.json
            try (FileWriter file = new FileWriter("json/target_example.json")) {
                file.write(targetJsonObject.toJSONString());
                file.flush();
            } catch (IOException e) {
                e.printStackTrace();
            }

        } catch (IOException | ParseException e) {
            e.printStackTrace();
        }
    }
}

