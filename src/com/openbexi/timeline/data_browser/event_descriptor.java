package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;

import java.io.*;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.TimeZone;

public class event_descriptor {
    private final String _event_id;
    private final File _file;
    private final String _original_start;
    private final String _start;
    private final String _original_end;
    private final String _end;
    private final String _title;
    private final String _status;
    private final String _priority;
    private final String _tolerance;
    private final String _type;
    private final String _platform;
    private JSONObject _data_configuration_node;
    private Object _data;

    public event_descriptor(String event_id, String original_start, String start, String original_end, String end,
                            String title, String type, String status, String priority, String tolerance,
                            String platform, JSONObject data_configuration) {
        _event_id = String.valueOf(event_id);
        _original_start = original_start;
        _start = start;
        _original_end = original_end;
        _end = end;
        _title = title;
        _status = status;
        _priority = priority;
        _tolerance = tolerance;
        _type = type;
        _platform = platform;
        if (data_configuration != null)
            _data_configuration_node = data_configuration;
        _file = get_file();
    }

    /**
     * Build and retrieve the file descriptor according _event_id and start time of event.
     *
     * @return absolute file descriptor name.
     */
    public File get_file() {
        // set time zone to default
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        SimpleDateFormat year = new SimpleDateFormat("yyyy");
        SimpleDateFormat month = new SimpleDateFormat("MM");
        SimpleDateFormat day = new SimpleDateFormat("dd");

        String yearS = year.format(new Date(_start));
        String monthS = month.format(new Date(_start));
        String dayS = day.format(new Date(_start));

        String buildFile = (String) _data_configuration_node.get("data_model");
        buildFile=buildFile.replace(".json", "");
        buildFile = buildFile.replace("/yyyy", "/" + yearS);
        buildFile = buildFile.replace("/mm", "/" + monthS);
        buildFile = buildFile.replace("/dd", "/" + dayS);

        buildFile = buildFile +
                File.separator + "descriptors" + File.separator + _event_id + ".json";

        return new File(buildFile);
    }

    /**
     * if descriptor exist return true.
     */
    private boolean exist() {
        return _file.exists();
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
            jsonObjectMerged += "\"title\":\"" + _title + "\",";
            if (!_platform.equals(""))
                jsonObjectMerged += "\"type\":\"" + _platform + "\",";
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
    public Object read(String event_id) {
        JSONParser parser = new JSONParser();

        String jsonObjectMerged = "{\n" +
                "  \"dateTimeFormat\": \"iso8601\",\n" +
                "  \"event_descriptor\": [\n";

        if (_file.exists()) {
            try {
                Reader reader = new FileReader(_file);
                Object events = parser.parse(reader);
                JSONObject jsonObject = (JSONObject) events;
                JSONArray data = (JSONArray) jsonObject.get("event_descriptor");
                jsonObjectMerged += data.toJSONString().replaceAll("\\[|\\]", "").replaceAll("\\\\/", "/") + ",";
                reader.close();
            } catch (IOException e) {
                _data = getDummyDescriptorJson("no event descriptor found for " + _event_id);
            } catch (ParseException e) {
                _data = getDummyDescriptorJson("Cannot parse event descriptor for " + _event_id);
            }
        }

        jsonObjectMerged += "]}";
        try {
            _data = parser.parse(jsonObjectMerged);
        } catch (ParseException e) {
            _data = getDummyDescriptorJson("Cannot parse event descriptor for " + _event_id);
        }
        return _data;
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
                "\"data\":{ \"title\":\"" + "message" + "\",\"description\":\"" + message + "\"}}";
        ob_data_end = "]}\n\n";
        return ob_data_start + ob_data + ob_data_end;
    }
}
