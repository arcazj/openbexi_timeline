package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;


import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.*;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.TimeZone;
import java.util.TimerTask;
import java.util.concurrent.atomic.AtomicInteger;

abstract class data_manager {
    final static Charset ENCODING = StandardCharsets.UTF_8;
    public final LinkedHashMap<File, String> _files = new LinkedHashMap<>();
    public final String _include;
    public final String _exclude;
    public final String _search;
    public final String _filterExpression;
    protected final java.util.function.Predicate<JSONObject> _eventFilter;
    public final HttpServletResponse _response;
    public final HttpSession _session;
    public final int _context_timer = 0;
    private final boolean ob_debug = true;
    private final String previous_date = "NONE";
    public String next_date = "NONE";
    public String _currentStartDate;
    public String _currentEndDate;
    public long _currentStartDateL;
    public long _currentEndDateL;
    public String _action_type;
    public data_configuration _data_configuration;
    public String _checksum = "*";
    private String _dateE;
    private TimerTask task;

    public data_manager(HttpServletResponse response, HttpSession session, data_configuration configuration) {
        super();

        _data_configuration = configuration;
        String startDate = (String) _data_configuration.getConfiguration().get("startDate");
        String endDate = (String) _data_configuration.getConfiguration().get("endDate");

        if (startDate != null) {
            _currentStartDate = startDate.replaceAll("'", "");
        }
        if (endDate != null) {
            _currentEndDate = endDate.replaceAll("'", "");
        }

        String filter = (String) _data_configuration.getConfiguration().get("filter");
        _filterExpression=FilterExpression.decode(filter);
        _eventFilter=FilterExpression.compile(_filterExpression);
        if (_filterExpression.startsWith("expr:")) {
            _include=_filterExpression;_exclude="";
        } else if (filter != null) {
            String[] filter_items = filter.split("\\|");
            if (filter_items.length == 0) {
                _include = "";
                _exclude = "";
            } else {
                _include = filter_items[0];
                if (filter_items.length > 1)
                    _exclude = filter_items[1];
                else
                    _exclude = "";
            }
        } else {
            _include = "";
            _exclude = "";
        }

        _search = (String) _data_configuration.getConfiguration().get("search");
        _action_type = (String) _data_configuration.getConfiguration().get("request");
        _response = response;
        _session = session;

        // set time zone to default
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));

        // Settings/filter requests have no date range and must not parse null dates.
        if (_currentStartDate != null && _currentEndDate != null) {
            try {
                _currentStartDateL = MatchResults.time(_currentStartDate);
                _currentEndDateL = MatchResults.time(_currentEndDate);
                if (_currentEndDateL<=_currentStartDateL) throw new IllegalArgumentException("Invalid timeline time range.");
            } catch (Exception e) {
                throw new IllegalArgumentException("Invalid timeline time range.",e);
            }
        }
    }

    public String get_include() {
        return _include;
    }

    public String get_exclude() {
        return _exclude;
    }

    public String get_filter() {
        return _filterExpression;
    }

    protected JSONArray filterSelected(JSONArray events) {
        JSONArray selected=new JSONArray();
        for(Object event:events)if(_eventFilter.test((JSONObject)event))selected.add(event);
        return selected;
    }

    abstract Object login(String url, JSONArray cookies);

    abstract Object getData(String filter, String ob_scene);

    abstract boolean sendData(Object data);

    abstract JSONArray filterDates(JSONArray events, long currentEndDate, long currentStartDate);

    abstract JSONArray filterEvents(JSONArray events, String filter_include, String filter_exclude);

    abstract JSONArray searchEvents(JSONArray events, String search);

    abstract boolean onDataChange(String ob_scene) throws InterruptedException;

    abstract boolean addEvents(JSONArray events, String ob_scene);

    abstract boolean updateEvents(JSONArray events, String ob_scene);

    abstract boolean removeEvents(JSONArray events, String ob_scene);

    private JSONArray sortFilter(JSONArray filter_array, String ob_filter_name) {
        JSONObject obj = null;
        for (int f = 0; f < filter_array.size(); f++) {
            String filter_name = ((JSONObject) filter_array.get(f)).get("name").toString();
            if (ob_filter_name.equals(filter_name)) {
                if (f == 0) return filter_array;
                obj = ((JSONObject) filter_array.get(f));
                filter_array.remove(f);
            }
        }
        if (obj != null)
            filter_array.add(0, obj);
        return filter_array;
    }

    public Object updateFilter(String ob_action, String ob_timeline_name, String ob_scene, String ob_namespace,
                               String ob_title, String ob_filter_name, String ob_backgroundColor, String ob_user,
                               String ob_email, String ob_top, String ob_left, String ob_width, String ob_height,
                               String ob_camera, String ob_sort_by, String ob_filter) {
        JSONObject query=new JSONObject(_data_configuration.getConfiguration());
        query.put("request",ob_action);query.put("timelineName",ob_timeline_name);
        query.put("scene",ob_scene);query.put("namespace",ob_namespace);query.put("title",ob_title);
        query.put("filterName",ob_filter_name);query.put("filter",ob_filter);
        query.put("backgroundColor",ob_backgroundColor);query.put("userName",ob_user);query.put("email",ob_email);
        query.put("top",ob_top);query.put("left",ob_left);query.put("width",ob_width);query.put("height",ob_height);
        query.put("camera",ob_camera);query.put("sortBy",ob_sort_by);
        return SavedFilters.update(new data_configuration(query));
    }

    public Object addFilter(String ob_timeline_name, String ob_title, String ob_scene, String ob_namespace,
                            String ob_filter_name, String ob_backgroundColor, String ob_user, String ob_email,
                            String ob_top, String ob_left, String ob_width, String ob_height, String ob_camera,
                            String ob_sort_by, String ob_filter) {
        return updateFilter("addFilter", ob_timeline_name, ob_scene, ob_namespace, ob_title, ob_filter_name,
                ob_backgroundColor, ob_user, ob_email, ob_top, ob_left, ob_width, ob_height, ob_camera, ob_sort_by,
                ob_filter);
    }

    public Object removeFilter(String ob_timeline_name, String ob_filter_name, String ob_scene, String ob_namespace,
                               String ob_user) {
        updateFilter("remove", ob_timeline_name, ob_scene, ob_namespace, null, ob_filter_name, null,
                null, null, null, null, null, null, null,
                null, null);
        return false;
    }

    public boolean removeAllFilter(String ob_timeline_name, String ob_user) {

        for (int d = 0; d <= _data_configuration.getConfiguration().size(); d++) {
            String buildFile = (String) _data_configuration.getConfiguration(d).get("data_path");
            buildFile = buildFile.replace("/yyyy", "");
            buildFile = buildFile.replace("/mm", "");
            buildFile = buildFile.replace("/dd", "");

            File outputs = new File(buildFile + "/" + ob_user + "_filter_setting.json");
            if (outputs.getParentFile().exists()) {
                outputs.delete();
                return true;
            }
        }
        return false;
    }

    protected void log(Object msg, String err) {
        if (ob_debug)
            if (err == null)
                System.out.println(msg);
            else
                System.err.println(msg);
    }

    protected String MD5Hash(String fileDir) {
        MessageDigest md = null;
        StringBuffer sb = new StringBuffer();
        try {
            md = MessageDigest.getInstance("MD5");
            FileInputStream fis = new FileInputStream(fileDir);
            byte[] dataBytes = new byte[1024];

            int nread = 0;
            while ((nread = fis.read(dataBytes)) != -1) {
                md.update(dataBytes, 0, nread);
            }
            byte[] mdbytes = md.digest();
            for (int i = 0; i < mdbytes.length; i++) {
                sb.append(Integer.toString((mdbytes[i] & 0xff) + 0x100, 16).substring(1));
            }
            fis.close();
        } catch (NoSuchAlgorithmException | IOException e) {
            log(e.getMessage(), "err");
        }
        return sb.toString();
    }

    // Generated by ChatGPT4 (https://chat.openai.com/) after asking for:
    // Get java function reading a json file, importing json.simple, returning a JSONObject and providing javadoc
    //

    /**
     * Reads a JSON file and returns a JSONObject.
     *
     * @param filePath the path of the JSON file to read
     * @return a JSONObject containing the contents of the file
     * @throws IOException    if an I/O error occurs while reading the file
     * @throws ParseException if the JSON content of the file is invalid
     */
    public JSONObject readJsonFile(String filePath) throws IOException, ParseException {
        // Create a parser for JSON files
        JSONParser parser = new JSONParser();

        // Read the file contents as a JSONObject
        Object obj = parser.parse(new FileReader(filePath));
        JSONObject jsonObject = (JSONObject) obj;

        // Return the JSONObject
        return jsonObject;
    }

    public void print_events(JSONObject events) {
        try {
            AtomicInteger count = new AtomicInteger();
            events.keySet().forEach(keyStr -> {
                Object keyvalue = events.get(keyStr);
                try {
                    JSONArray a = (JSONArray) keyvalue;
                    for (Object o : a) {
                        try {
                            JSONObject data = (JSONObject) o;
                            data.keySet().forEach(keyStr2 -> {
                                JSONObject keydata = (JSONObject) data.get(keyStr2);
                                System.out.println();
                                System.out.print("Event: " + count.getAndIncrement() + ":" + " start: " + data.get("start") +
                                        " end: " + data.get("end"));
                                keydata.keySet().forEach(keyStr3 -> {
                                    try {
                                        if (keyStr3.equals("description"))
                                            System.out.print(" (" + keyStr3 + " " + keydata.get(keyStr3).toString().length() + ")");
                                        else if (keyStr3.equals("analyze"))
                                            System.out.print(" " + keyStr3 + ":" + keydata.get(keyStr3).toString().length() + ")");
                                        else
                                            System.out.print(" " + keyStr3 + ":" + keydata.get(keyStr3).toString());

                                    } catch (Exception e) {
                                    }
                                });
                            });
                        } catch (Exception e) {
                            System.err.print(e.getMessage());
                        }
                    }
                } catch (Exception e) {
                    System.err.print(e.getMessage());
                }
            });
        } catch (Exception e) {
            System.err.print(e.getMessage());
        }
    }

}

