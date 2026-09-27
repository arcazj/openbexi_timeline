package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;

import java.io.*;
import java.nio.file.*;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.*;

public class event_descriptor {
    private final String _event_id;
    private final File _file;
    private final String _original_start;
    private final String _start;
    private final String _original_end;
    private final String _end;
    private final String _namespace;
    private final String _title;
    private final String _status;
    private final String _priority;
    private final String _tolerance;
    private final String _type;
    private final String _platform;
    private JSONObject _data_configuration_node;
    private final JSONArray _configurations;

    public event_descriptor(String event_id, String original_start, String start, String original_end, String end,
                            String namespace, String title, String type, String status, String priority, String tolerance,
                            String platform, data_configuration data_configuration) {
        _event_id = String.valueOf(event_id);
        _original_start = original_start;
        _start = start;
        _original_end = original_end;
        _end = end;
        _namespace = namespace;
        _title = title;
        _status = status;
        _priority = priority;
        _tolerance = tolerance;
        _type = type;
        _platform = platform;
        JSONArray configurations = (JSONArray) data_configuration.getConfiguration().get("startup configuration");
        _configurations = configurations;
        _data_configuration_node = (JSONObject) data_configuration.getConfiguration(0);
        for (int d = 1; d < configurations.size(); d++) {
            if (data_configuration.getConfiguration(d).get("namespace").equals(namespace))
                _data_configuration_node = (JSONObject) data_configuration.getConfiguration(d);
        }
        _file = get_file();
    }

    /**
     * Build and retrieve the file descriptor according _event_id and start time of event.
     *
     * @return absolute file descriptor name.
     */
    public File get_file() {
        return descriptorPath(_data_configuration_node).toFile();
    }

    private Path descriptorPath(JSONObject source) {
        if (_event_id.isBlank() || _event_id.equals("null") || _event_id.equals("undefined") ||
                _event_id.equals(".") || _event_id.equals("..") || _event_id.matches(".*[\\\\/:\\x00-\\x1f].*"))
            throw new IllegalArgumentException("Invalid record identity.");
        if (_start == null || _start.isBlank()) throw new IllegalArgumentException("Missing record start date.");
        var date = Instant.ofEpochMilli(MatchResults.time(_start)).atZone(ZoneOffset.UTC);
        String model = Objects.toString(source.get("data_model"), "").replace('\\', '/');
        if (model.isBlank()) throw new IllegalArgumentException("Missing source model.");
        if (model.endsWith(".json")) model = model.substring(0, model.length() - 5);
        model = model.replace("/yyyy", String.format("/%04d", date.getYear()))
                .replace("/mm", String.format("/%02d", date.getMonthValue()))
                .replace("/dd", String.format("/%02d", date.getDayOfMonth()));
        Path directory = Path.of(model).toAbsolutePath().normalize().resolve("descriptors");
        Path file = directory.resolve(_event_id + ".json").normalize();
        if (!file.getParent().equals(directory)) throw new IllegalArgumentException("Invalid descriptor path.");
        return file;
    }

    /**
     * write descriptor according event id requested by the client
     */
    public void write(String description) {
        String jsonObjectMergedHead = "{\n" +
                "  \"dateTimeFormat\": \"iso8601\",\n" +
                "  \"event_descriptor\": [{\n";
        String jsonObjectMerged = "";

        try {
            if (!_file.getParentFile().exists())
                _file.mkdirs();
            if (_file.exists())
                _file.delete();
            Writer writer = new FileWriter(_file);
            jsonObjectMerged += "\"id\":\"" + _event_id + "\",";
            jsonObjectMerged += "\"start\":\"" + _start + "\",";
            jsonObjectMerged += "\"end\":\"" + _end + "\",";
            if (!_original_start.equals(""))
                jsonObjectMerged += "\"original_start\":\"" + _original_start + "\",";
            if (!_original_end.equals(""))
                jsonObjectMerged += "\"original_end\":\"" + _original_end + "\",";
            jsonObjectMerged += "\"data\":{";
            jsonObjectMerged += "\"namespace\":\"" + _namespace + "\",";
            jsonObjectMerged += "\"title\":\"" + _title + "\",";
            if (!_platform.equals(""))
                jsonObjectMerged += "\"platform\":\"" + _platform + "\",";
            if (!_type.equals(""))
                jsonObjectMerged += "\"type\":\"" + _type + "\",";
            if (!_priority.equals(""))
                jsonObjectMerged += "\"priority\":\"" + _priority + "\",";
            if (!_status.equals(""))
                jsonObjectMerged += "\"status\":\"" + _status + "\",";
            if (!_tolerance.equals(""))
                jsonObjectMerged += "\"tolerance\":\"" + _tolerance + "\",";
            jsonObjectMerged += "\"description\":\"" + description + "\"";
            jsonObjectMerged += "}";
            jsonObjectMerged += "}]}";
            writer.write(jsonObjectMergedHead + jsonObjectMerged);
            writer.close();
        } catch (Exception e) {
            System.err.print(e.getMessage());
        }
    }

    /**
     * Read descriptor according event id requested by the client
     */
    public Object read(String event_id) throws IOException {
        List<JSONObject> sources = new ArrayList<>();
        sources.add(_data_configuration_node);
        for (Object value : _configurations) if (value != _data_configuration_node) sources.add((JSONObject)value);
        Set<Path> seen = new HashSet<>();
        for (JSONObject source : sources) {
            if ("false".equals(String.valueOf(source.get("enable"))) ||
                    source.get("type") != null && !"json_file".equals(source.get("type"))) continue;
            Path file = descriptorPath(source);
            if (!seen.add(file) || !Files.exists(file)) continue;
            if (!file.toRealPath().startsWith(file.getParent().toRealPath()))
                throw new IOException("Descriptor path leaves its configured directory.");
            if (Files.size(file) > 8L * 1024 * 1024) throw new IOException("Descriptor exceeds the size limit.");
            try (Reader reader = Files.newBufferedReader(file)) {
                JSONObject body = (JSONObject)new JSONParser().parse(reader);
                if (!(body.get("event_descriptor") instanceof JSONArray entries))
                    throw new IOException("Invalid descriptor response.");
                JSONArray selected = new JSONArray();
                for (Object value : entries) {
                    if (!(value instanceof JSONObject entry)) throw new IOException("Invalid descriptor record.");
                    String identity = Objects.toString(entry.get("id"), Objects.toString(entry.get("ID"), _event_id));
                    String namespace = MatchResults.namespace(entry, Objects.toString(source.get("namespace"), ""));
                    if (identity.equals(_event_id) && (_namespace == null || _namespace.isBlank() || namespace.equals(_namespace)))
                        selected.add(entry);
                }
                if (!selected.isEmpty()) {
                    JSONObject result = new JSONObject(body);
                    result.put("event_descriptor", selected);
                    return result;
                }
            } catch (ParseException | ClassCastException error) { throw new IOException("Cannot parse descriptor data.", error); }
        }
        return new JSONObject(Map.of("event_descriptor", new JSONArray(), "descriptorStatus", "not_found"));
    }

    /**
     * @param message
     * @return a sample descriptor json reporting a error message to the user
     */
    private String getDummyDescriptorJson(String message) {
        String ob_data = "", ob_data_start, ob_data_end = "";
        ob_data_start = "{\"dateTimeFormat\": \"iso8601\",\"events\" : [";
        long ob_time = new Date().getTime();
        Date ob_start_time = new Date(ob_time);
        ob_data += "{\"ID\": \"" + _event_id +
                "\",\"start\": \"" + ob_start_time + "\"," +
                "\"end\": \"" + "\"," +
                "\"data\":{ \"namespace\":\"" + _namespace + "\",\"title\":\"" + "message" + "\",\"description\":\"" + message + "\"}}";
        ob_data_end = "]}\n\n";
        return ob_data_start + ob_data + ob_data_end;
    }
}
