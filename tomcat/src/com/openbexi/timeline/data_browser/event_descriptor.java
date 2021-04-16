package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;

import javax.servlet.http.HttpServletResponse;
import java.io.*;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.TimeZone;
import java.util.UUID;

public class event_descriptor {
    private String _event_id;
    private String _start_time;
    private File _file;
    private String _currentPathModel;
    private Object _data;
    private HttpServletResponse _response;

    event_descriptor(String event_id, String start_time, String currentPathModel, HttpServletResponse response) {
        _event_id = event_id;
        _start_time = start_time;
        _currentPathModel = currentPathModel;
        _file = get_file();
        _response = response;
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
        SimpleDateFormat hour = new SimpleDateFormat("hh");

        String yearS = year.format(new Date(_start_time));
        String monthS = month.format(new Date(_start_time));
        String dayS = day.format(new Date(_start_time));

        String buildFile = _currentPathModel.replace(".json", "");
        buildFile = buildFile.replace("/yyyy", "/" + yearS);
        buildFile = buildFile.replace("/mm", "/" + monthS);
        buildFile = buildFile.replace("/dd", "/" + dayS);

        buildFile = buildFile +
                File.separator + "descriptors" + File.separator + _event_id + ".json";

        return new File(buildFile);
    }

    /**
     * Read descriptor according event id requested by the client
     */
    private void read() {
        JSONParser parser = new JSONParser();

        String jsonObjectMerged = "{\n" +
                "  \"dateTimeFormat\": \"iso8601\",\n" +
                "  \"events\": [\n";

        if (_file.exists()) {
            try {
                Reader reader = new FileReader(_file);
                Object events = parser.parse(reader);
                JSONObject jsonObject = (JSONObject) events;
                JSONArray data = (JSONArray) jsonObject.get("events");
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
    }

    /**
     * Send descriptor to the client
     *
     * @return
     */
    private boolean send() {
        if (_response == null) return false;
        // here we code the action on a change
        try {
            PrintWriter respWriter = _response.getWriter();
            //Important to put a "," not ";" between stream and charset
            _response.setContentType("text/event-stream");
            _response.setCharacterEncoding("UTF-8");
            //Important, otherwise only  test URL  like https://localhost:8443/openbexi_timeline.html works
            _response.addHeader("Access-Control-Allow-Origin", "*");
            // If clients have set Access-Control-Allow-Credentials to true, the server will not permit the use of
            // credentials and access to resource by the client will be blocked by CORS policy.
            _response.addHeader("Access-Control-Allow-Credentials", "true");
            _response.addHeader("Cache-Control", "no-cache");
            _response.addHeader("Connection", "keep-alive");
            respWriter.write("event: ob_timeline\n\n");
            respWriter.write("data:" + _data + "\n\n");
            respWriter.write("retry: 1000000000\n\n");
            respWriter.flush();
            boolean error = respWriter.checkError();
            if (error == true) {
                return false;
            }
        } catch (Exception e) {
            //log(e.getMessage(), "err");
        }
        return false;
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
