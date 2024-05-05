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
            _currentEndDate = endDate.replaceAll("'", "");
        }

        String filter = (String) _data_configuration.getConfiguration().get("filter");
        if (filter != null) {
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

        try {
            _currentStartDateL = new Date(_currentStartDate).getTime();
            _currentEndDateL = new Date(_currentEndDate).getTime();
        } catch (Exception e) {
            log(e.getMessage(), "err");
        }
    }

    public String get_include() {
        return _include;
    }

    public String get_exclude() {
        return _exclude;
    }

    public String get_filter() {
        if (!_include.equals("") && !_exclude.equals(""))
            return _include + "|" + _exclude;
        if (_include.equals("") && !_exclude.equals(""))
            return "|" + _exclude;
        if (!_include.equals("") && _exclude.equals(""))
            return _include;
        return "";
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
        JSONParser parser = new JSONParser();
        Object filters;
        StringBuilder jsonObjectMerged = null;
        JSONObject jsonObject;
        File buildFile = new File("filters");
        if (!buildFile.exists())
            buildFile.getParentFile().mkdirs();

        JSONArray openbexi_timeline = null;
        JSONArray filter_array = null;
        JSONArray filter_array2;
        boolean no_filter_found = true;
        boolean ob_first_filter_deleted = false;
        boolean change_current = true;

        File outputs = new File(buildFile + "/" + ob_user + "_" + ob_timeline_name + "_filter_setting.json");
        if (!outputs.getParentFile().exists())
            outputs.getParentFile().mkdirs();

        try {
            if (outputs.exists()) {
                Reader reader = new FileReader(outputs);
                try {
                    filters = parser.parse(reader);
                    jsonObject = (JSONObject) filters;
                    openbexi_timeline = (JSONArray) jsonObject.get("openbexi_timeline");
                    ((JSONObject) openbexi_timeline.get(0)).put("sources", _data_configuration.getConfiguration().get("startup configuration"));
                    ((JSONObject) openbexi_timeline.get(0)).put("multiples", "45");

                    if (ob_action.equals("readFilters")) {
                        reader.close();
                        return filters;
                    }

                    filter_array2 = (JSONArray) ((JSONObject) openbexi_timeline.get(0)).get("filters");
                    filter_array = sortFilter(filter_array2, ob_filter_name);
                } catch (Exception e) {
                    System.err.print("updateFilter:" + e.getMessage());
                }
            }
            if (filter_array == null || filter_array.size() == 0) {
                filter_array = new JSONArray();
                filter_array.add(0, ob_filter_name);
                if (ob_filter_name.equals("")) ob_filter_name = "ALL";
            }

            jsonObjectMerged = new StringBuilder("{\n" +
                    "  \"dateTimeFormat\": \"iso8601\",\n" +
                    "  \"scene\": \"" + ob_scene + "\",\n" +
                    "  \"namespace\": \"" + ob_namespace + "\",\n" +
                    "  \"openbexi_timeline\": [{\n" +
                    "  \"name\": \"" + ob_timeline_name + "\"," +
                    "  \"title1\": \"" + ob_title + "\"," +
                    "  \"user\": \"" + ob_user + "\"," +
                    "  \"email\": \"" + ob_email + "\"," +
                    "  \"start\": \"current_time\"," +
                    "  \"top\": \"" + ob_top + "\"," +
                    "  \"left\": \"" + ob_left + "\"," +
                    "  \"width\": \"" + ob_width + "\"," +
                    "  \"height\": \"" + ob_height + "\"," +
                    "  \"camera\": \"" + ob_camera + "\"," +
                    "  \"backgroundColor\": \"" + ob_backgroundColor + "\"," +
                    "  \"sortBy\": \"" + ob_sort_by + "\",");

            jsonObjectMerged.append("  \"sources\":");
            jsonObjectMerged.append(_data_configuration.getConfiguration().get("startup configuration"));
            jsonObjectMerged.append("  ,");

            jsonObjectMerged.append("  \"filters\":[");

            String filter_name;
            if (ob_action.equals("addFilter")) {
                JSONObject obj = new JSONObject();
                obj.put("name", ob_filter_name);
                obj.put("backgroundColor", ob_backgroundColor);
                obj.put("filter_value", ob_filter);
                obj.put("sortBy", ob_sort_by);
                obj.put("current", "yes");
                filter_array.add(obj);
                filter_array = sortFilter(filter_array, ob_filter_name);
            }
            int filter_size = filter_array.size();
            for (int f = 0; f < filter_size; f++) {
                try {
                    filter_name = String.valueOf(((JSONObject) filter_array.get(f)).get("name"));
                } catch (Exception e) {
                    filter_name = ob_filter_name;
                }
                if (ob_filter_name.equals(filter_name)) {
                    no_filter_found = false;
                    if (!ob_action.equals("deleteFilter")) {
                        if (f > 0)
                            jsonObjectMerged.append(",{");
                        else
                            jsonObjectMerged.append("{");
                        String[] filter_attributs = ob_filter.split(":| ");
                        jsonObjectMerged.append("  \"name\":\"").append(ob_filter_name).append("\",");
                        if (filter_attributs.length > 0) {
                            jsonObjectMerged.append("  \"backgroundColor\":\"").append(ob_backgroundColor).append("\",");
                            jsonObjectMerged.append("  \"filter_value\":\"").append(get_filter()).append("\",");
                            jsonObjectMerged.append("  \"sortBy\":\"" + ob_sort_by + "\",");
                            jsonObjectMerged.append("  \"current\":\"" + "yes");
                            if (f == filter_size - 1)
                                jsonObjectMerged.append("\"}]}");
                            else
                                jsonObjectMerged.append("\"}");
                        } else {
                            if (f == filter_size - 1)
                                jsonObjectMerged.append("  \"current\":\"" + "yes" + "\"}]}");
                            else
                                jsonObjectMerged.append("  \"current\":\"" + "yes" + "\"}");
                        }
                    } else {
                        if (f == filter_size - 1 && filter_size != 1)
                            jsonObjectMerged.append("]}");
                        if (filter_size == 1)
                            jsonObjectMerged.append("]}");
                        if (f == 0) ob_first_filter_deleted = true;
                    }
                } else {
                    if (ob_first_filter_deleted && f == 1) {
                    } else if (f > 0)
                        jsonObjectMerged.append(",");
                    if (ob_action.equals("deleteFilter") && change_current) {
                        ((JSONObject) filter_array.get(f)).put("current", "yes");
                        change_current = false;
                    } else
                        ((JSONObject) filter_array.get(f)).put("current", "no");
                    jsonObjectMerged.append(filter_array.get(f));
                    if (f == filter_size - 1)
                        jsonObjectMerged.append("]}");
                }
            }
            jsonObjectMerged.append("]}");
        } catch (Exception e) {
            System.err.print("updateFilter:" + e.getMessage());
        }

        if (no_filter_found && !ob_action.equals("deleteFilter")) {
            return addFilter(ob_timeline_name, ob_title, ob_scene, ob_namespace, ob_filter_name, ob_backgroundColor,
                    ob_user, ob_email, ob_top, ob_left, ob_width, ob_height, ob_camera, ob_sort_by, ob_filter);
        }

        try (FileWriter file = new FileWriter(outputs)) {
            if (ob_user.equals("guest")) {
                File source = new File("filters/default_filter_setting.json");
                if (Files.exists(Path.of(source.getAbsolutePath())))
                    Files.copy(source.toPath(), outputs.toPath());
            } else {
                file.write(jsonObjectMerged.toString());
                file.flush();
            }
        } catch (IOException e) {
            log(e, "Exception");
        }

        try {
            return parser.parse(jsonObjectMerged.toString());
        } catch (ParseException e) {
            return null;
        }
    }

    public Object addFilter(String ob_timeline_name, String ob_title, String ob_scene,String ob_namespace,
                            String ob_filter_name, String ob_backgroundColor, String ob_user, String ob_email,
                            String ob_top, String ob_left, String ob_width, String ob_height, String ob_camera,
                            String ob_sort_by, String ob_filter) {
        return updateFilter("addFilter", ob_timeline_name, ob_scene,ob_namespace, ob_title, ob_filter_name,
                ob_backgroundColor, ob_user, ob_email, ob_top, ob_left, ob_width, ob_height, ob_camera, ob_sort_by,
                ob_filter);
    }

    public Object removeFilter(String ob_timeline_name, String ob_filter_name, String ob_scene, String ob_namespace,
                               String ob_user) {
        updateFilter("remove", ob_timeline_name, ob_scene,ob_namespace, null, ob_filter_name, null,
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

