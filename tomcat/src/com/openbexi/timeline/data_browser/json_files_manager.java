package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;

import javax.servlet.ServletContext;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.*;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class json_files_manager extends data_manager {
    private String _dateE;
    private String previous_date = "NONE";
    private String next_date = "NONE";
    private final LinkedHashMap<File, String> files = new LinkedHashMap<>();

    final static Charset ENCODING = StandardCharsets.UTF_8;
    private TimerTask task;
    private String _currentStartDate;
    private String _currentEndDate;
    private long _currentStartDateL;
    private long _currentEndDateL;
    private String _currentPathModel;
    private final String _include;
    private final String _exclude;
    private final String _search;
    private String _user_setting;
    private final HttpServletResponse _response;
    private final HttpSession _session;
    private final int _context_timer = 0;
    private String _checksum = "*";

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

    public json_files_manager(String currentStartDate, String currentEndDate, String currentPathModel, String search,
                              String filter, String action_type,
                              HttpServletResponse response, HttpSession session, ServletContext servletContext) {
        super();

        if (currentStartDate != null) {
            _currentStartDate = currentStartDate.replaceAll("'", "");
            _currentEndDate = currentEndDate.replaceAll("'", "");
        }
        if (currentPathModel != null)
            _currentPathModel = currentPathModel.replaceAll("\\\\", "/");
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
        String _filter_value = get_filter();
        _search = search;
        String _action_type = action_type;
        _response = response;
        _session = session;
        _action_type = action_type;

        // set time zone to default
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        SimpleDateFormat year = new SimpleDateFormat("yyyy");
        SimpleDateFormat month = new SimpleDateFormat("MM");
        SimpleDateFormat day = new SimpleDateFormat("dd");
        SimpleDateFormat hour = new SimpleDateFormat("hh");

        try {
            _currentStartDateL = new Date(_currentStartDate).getTime();
            String yearS = year.format(new Date(_currentStartDate));
            String monthS = month.format(new Date(_currentStartDate));
            String dayS = day.format(new Date(_currentStartDate));
            String hourS = hour.format(new Date(_currentStartDate));

            _currentEndDateL = new Date(_currentEndDate).getTime();
            String yearE = year.format(new Date(_currentEndDate));
            String monthE = month.format(new Date(_currentEndDate));
            String dayE = day.format(new Date(_currentEndDate));
            String hourE = hour.format(new Date(_currentEndDate));

            String buildFile = _currentPathModel.replace(".json", "");
            buildFile = buildFile.replace("/yyyy", "/" + yearS);
            buildFile = buildFile.replace("/mm", "/" + monthS);
            buildFile = buildFile.replace("/dd", "/" + dayS);
            String dateS = null;
            String fileParentPathS = new File(buildFile + "_" + dateS + ".json").getParent();

            buildFile = buildFile.replace("/yyyy", "/" + yearE);
            buildFile = buildFile.replace("/mm", "/" + monthE);
            buildFile = buildFile.replace("/dd", "/" + dayE);
            String fileParentPathE = new File(buildFile + "_" + _dateE + ".json").getParent();

            //if (resp != null) start_watching();

        } catch (Exception e) {
            log(e.getMessage(), "err");
        }
    }

    @Override
    Object userAccess(String permissions, JSONArray cookies) {
        return null;
    }

    /**
     * @return data according a range of time.
     */
    public Object getData(String filter, String ob_scene) {
        Date t1 = new Date();
        if (_currentPathModel == null || _currentStartDate == null)
            return getDummyJson("no data_manager found");

        JSONParser parser = new JSONParser();
        Object events = null;
        JSONObject objPrevious = null;
        String filePath = null;
        JSONObject jsonObject = new JSONObject();


        // Look for all files in the pathModel directory according startDate and endDate.
        try {
            getFiles(_currentStartDate, _currentEndDate, new File(_currentPathModel));
        } catch (Exception e) {
            return getDummyJson("no data_manager found - " + e.getMessage());
        }

        if (files == null)
            return getDummyJson("no data_manager found");

        String jsonObjectMerged_begin = "{\n" +
                "  \"dateTimeFormat\": \"iso8601\",\n" +
                "  \"scene\": \"" + ob_scene + "\",\n" +
                "  \"events\": \n";
        int count = 0;
        JSONArray all_obj = new JSONArray();
        for (Map.Entry<File, String> entry : files.entrySet()) {
            try {
                File file = new File(entry.getKey().toString());
                if (file.exists()) {
                    Reader reader = new FileReader(file);
                    events = parser.parse(reader);
                    jsonObject = (JSONObject) events;
                    JSONArray obj = (JSONArray) jsonObject.get("events");
                    obj = filterDates(obj, _currentStartDateL, _currentEndDateL);
                    if (!_include.equals("") || !_exclude.equals(""))
                        obj = filterEvents(obj, _include, _exclude);
                    if (!_search.equals(""))
                        obj = searchEvents(obj, _search);
                    count += obj.size();
                    //jsonObjectMerged += all_obj.toJSONString().replaceAll("\\[|\\]", "").replaceAll("\\\\/", "/") + ",";
                    if (obj.size() != 0)
                        all_obj.addAll(obj);
                    reader.close();
                }
            } catch (Exception e) {
                return getDummyJson("no data_manager found");
            }
        }
        String jsonObjectMerged_end = "}";

        try {
            log("Return " + String.format("% 5d", count) + " events/sessions -  " +
                    String.format("% 4d", (new Date().getTime() - t1.getTime())) + " millis", "info");
            return parser.parse(jsonObjectMerged_begin + all_obj.toJSONString().replaceAll("\\\\/", "/") + jsonObjectMerged_end);
        } catch (ParseException e) {
            return getDummyJson("no data_manager found");
        }
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

    @Override
    boolean sendData(Object data) {
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
            respWriter.write("data:" + data + "\n\n");
            respWriter.write("retry: 1000000000\n\n");
            respWriter.flush();
            boolean error = respWriter.checkError();
            if (error) {
                return false;
            }
        } catch (Exception e) {
            log(e.getMessage(), "err");
        }
        //print_events((JSONObject) data);
        return true;
    }

    @Override
    public boolean onDataChange(String ob_scene) throws InterruptedException {
        Logger logger = Logger.getLogger("");

        //Update client regarding  HTTP service
        boolean able_to_send_data = sendData(getData(_include + "|" + _exclude, ob_scene));
        if (!able_to_send_data) {
            logger.info("Client disconnected");
            _session.invalidate();
            return false;
        }
        //System.out.println("session id=" + _session.getId() + " - data_manager changed");
        return true;
    }

    /**
     * @return a sample json data with one event reporting there is no data found
     */
    public String getDummyJson(String title) {

        // set time zone to default
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        String ob_data = "", ob_data_start, ob_data_end = "";
        ob_data_start = "{\"dateTimeFormat\": \"iso8601\",\"scene\": \"0\",\"events\" : [";
        long ob_time = new Date().getTime();
        Date ob_start_time = new Date(ob_time);
        ob_data += "{\"ID\": \"" + UUID.randomUUID() +
                "\",\"start\": \"" + ob_start_time + "\"," +
                "\"end\": \"" + "\"," +
                "\"data\":{ \"title\":\"" + title + "\",\"description\":\"NONE\"}}";
        ob_data_end = "]}\n\n";
        return ob_data_start + ob_data + ob_data_end;
    }

    public boolean checkIfJsonFilesChanged() throws Exception {

        String checksum = "";
        // Build file list according date range
        String yyyy;
        String MM;
        String dd;
        double step;

        // set time zone to default
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        long startDateS = new Date(_currentStartDate).getTime();
        long startDateE = new Date(_currentEndDate).getTime();
        SimpleDateFormat dateFormat = new SimpleDateFormat("dd/MM/yyyy");

        // Loop on
        if (_currentPathModel.contains("dd"))
            step = 86400000;
        else
            step = 2629746000.0;
        if (_currentPathModel.contains("yyyy") && !_currentPathModel.contains("mm") && !_currentPathModel.contains("dd"))
            step = 31556952000.0;
        for (double d = startDateS; d <= startDateE; d = d + step) {
            String formatedDateS = dateFormat.format(d);
            yyyy = formatedDateS.substring(6, 10);
            MM = formatedDateS.substring(3, 5);
            dd = formatedDateS.substring(0, 2);

            String buildFile = _currentPathModel;
            buildFile = buildFile.replace("/yyyy", "/" + yyyy);
            buildFile = buildFile.replace("/mm", "/" + MM);
            buildFile = buildFile.replace("/dd", "/" + dd);

            File[] file_list = new File(buildFile).listFiles();

            if (file_list != null) {
                for (File file : file_list) {
                    if (file.exists() && file.isFile() && file.getName().contains(".json")) {
                        checksum += this.MD5Hash(file.getCanonicalPath());
                    } else {
                        if (file.exists() && !file.isHidden() && !file.getName().contains("descriptors") && file.isDirectory()) {
                            this.getFiles(_currentStartDate, _currentEndDate, file);
                        }
                    }
                }
            }
        }
        if (!checksum.equals(_checksum)) {
            _checksum = checksum;
            return true;
        }
        return false;
    }

    private void getFiles(String startDate, String endDate, File dir) {

        // Build file list according date range
        String yyyy;
        String MM;
        String dd;
        double step = 0;
        // set time zone to default
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        if (_currentPathModel.contains("dd"))
            step = 86400000;
        else
            step = 2629746000.0;
        if (_currentPathModel.contains("yyyy") && !_currentPathModel.contains("mm") && !_currentPathModel.contains("dd"))
            step = 31556952000.0;

        long startDateS = (long) (new Date(startDate).getTime() - step);
        long startDateE = (long) (new Date(endDate).getTime() + step);
        SimpleDateFormat dateFormat = new SimpleDateFormat("dd/MM/yyyy");

        for (double d = startDateS; d <= startDateE; d = d + step) {
            String formatedDateS = dateFormat.format(d);
            yyyy = formatedDateS.substring(6, 10);
            MM = formatedDateS.substring(3, 5);
            dd = formatedDateS.substring(0, 2);

            String buildFile = _currentPathModel;
            buildFile = buildFile.replace("/yyyy", "/" + yyyy);
            buildFile = buildFile.replace("/mm", "/" + MM);
            buildFile = buildFile.replace("/dd", "/" + dd);

            FilenameFilter filter = new FilenameFilter() {
                @Override
                public boolean accept(File dir, String name) {
                    boolean result;
                    if (name.startsWith("descriptors")) {
                        result = false;
                    } else {
                        result = true;
                    }
                    return result;
                }
            };
            File[] file_list = new File(buildFile).listFiles(filter);

            if (file_list != null) {
                for (File file : file_list) {
                    if (file.exists() && file.isFile() && file.getName().contains(".json")) {
                        files.put(file, MD5Hash(file.toString()));
                        //log(file_list[f], "info");
                    } else {
                        if (file.exists() && !file.isHidden() && !file.getName().contains("descriptors") && file.isDirectory()) {
                            this.getFiles(startDate, endDate, file);
                        }
                    }
                }
            }
        }
    }

    @Override
    JSONArray filterDates(JSONArray events, long currentStartDateL, long currentEndDateL) {
        if (currentEndDateL == currentStartDateL)
            return events;

        long startDateL;
        long endDateL;
        JSONArray new_events = new JSONArray();
        for (Object event : events) {
            JSONObject obj1 = (JSONObject) event;
            try {
                startDateL = new Date(obj1.get("start").toString()).getTime();
            } catch (Exception e) {
                startDateL = 0;
            }
            try {
                endDateL = new Date(obj1.get("end").toString()).getTime();
            } catch (Exception e) {
                endDateL = startDateL;
            }
            if (currentStartDateL < startDateL && startDateL < currentEndDateL) {
                new_events.add(event);
            } else if (currentStartDateL < endDateL && endDateL < currentEndDateL) {
                new_events.add(event);
            }
        }
        return new_events;
    }

    @Override
    JSONArray searchEvents(JSONArray events, String search) {
        Pattern pattern;
        Matcher matcher;
        search = search.replaceAll(";", "|");
        JSONArray new_events = new JSONArray();
        JSONArray new_events2 = new JSONArray();
        if (!search.equals("*") && !search.equals("")) {
            pattern = Pattern.compile(search.replaceAll(" ", "|"));
            for (Object event : events) {
                JSONObject obj1 = (JSONObject) event;
                JSONArray activities = (JSONArray) obj1.get("activities");
                if (activities != null) {
                    for (Object activity : activities) {
                        JSONObject obja = (JSONObject) activity;
                        matcher = pattern.matcher(obja.toString().replaceAll(" ", "").replaceAll("\"", ""));
                        if (matcher.find()) {
                            JSONObject obj2 = (JSONObject) obja.get("render");
                            obj2.put("backgroundColor", "#F8DF09");
                            //obj2.put("next_date", next_date);
                            //next_date = obja.get("start").toString();
                            new_events.add(activity);
                        } else
                            new_events.add(activity);
                    }
                } else {
                    matcher = pattern.matcher(event.toString().replaceAll(" ", "").replaceAll("\"", ""));
                    if (matcher.find()) {
                        JSONObject obj2 = (JSONObject) obj1.get("render");
                        obj2.put("backgroundColor", "#F8DF09");
                        obj2.put("next_date", next_date);
                        next_date = obj1.get("start").toString();
                        new_events.add(event);
                    } else
                        new_events.add(event);
                }
            }
            /*for (int i = new_events.size() - 1; i >= 0; i--) {
                matcher = pattern.matcher(new_events.get(i).toString().replaceAll(" ", "").replaceAll("\"", ""));
                if (matcher.find()) {
                    JSONObject obj1 = (JSONObject) new_events.get(i);
                    JSONObject obj2 = (JSONObject) obj1.get("render");
                    obj2.put("previous_date", previous_date);
                    previous_date = obj1.get("start").toString();
                    new_events2.add(new_events.get(i));
                    //System.out.println(search+":"+((JSONObject) new_events.get(i)).get("start")+"  ---previous_date = "+
                    //(obj2.get("previous_date")+"  ---next_date = "+next_date));
                } else
                    new_events2.add(new_events.get(i));
            }*/
        }

        if (new_events2.size() == 0)
            new_events2 = events;

        return new_events2;
    }

    private String lookForIcon(String myIcon) {
        String[] icon = {"icon\\/ob_info.png", "icon\\/ob_start.png", "icon\\/ob_yellow_flag.png", "icon\\/ob_check.png",
                "icon\\/ob_red_flag.png", "icon\\/ob_green_flag.png", "icon\\/ob_stop.png", "icon\\/ob_error.png",
                "icon\\/ob_check_failed.png", "icon\\/ob_warning.png", "icon\\/ob_connect.png", "icon\\/ob_phone.png",
                "icon\\/ob_conflict.png", "icon\\/ob_bug.png", "icon\\/ob_lost_connection.png", "icon\\/ob_swap.png",
                "icon\\/ob_blue_square.png", "icon\\/ob_orange_square.png", "icon\\/ob_green_square.png",
                "icon\\/ob_purple_square.png", "icon\\/ob_yellow_square.png", "icon\\/ob_close.png",
                "icon\\/ob_no_satellite.png", "icon\\/ob_red_square.png", "icon\\/ob_tlm_red.png",
                "icon\\/ob_tlm_orange.png", "icon\\/ob_gate_open.png", "icon\\/ob_gate_close.png",
                "icon\\/ob_clock.png", "icon\\/ob_script.png", "icon\\/ob_crontab.png",
        };
        if (myIcon.equals("")) return "";
        for (String s : icon) {
            if (s.contains(myIcon))
                return s;
        }
        return "";
    }

    @Override
    public boolean addEvents(JSONArray events, String ob_scene) {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        Date date = new Date(((String) events.get(1)).replaceAll("startEvent:", ""));
        String yyyy = new SimpleDateFormat("yyyy").format(date);
        String MM = new SimpleDateFormat("MM").format(date);
        String dd = new SimpleDateFormat("dd").format(date);

        String buildFile = _currentPathModel;
        buildFile = buildFile.replace("/yyyy", "/" + yyyy);
        buildFile = buildFile.replace("/mm", "/" + MM);
        buildFile = buildFile.replace("/dd", "/" + dd);

        String id = UUID.randomUUID().toString();

        File outputs = new File(buildFile + "/" + id + ".json");

        String icon = lookForIcon(((String) events.get(4)).replaceAll("icon:", ""));
        String color = "#050100";
        String line_start = "{\n" +
                "  \"dateTimeFormat\": \"iso8601\",\n" +
                "  \"scene\": \"" + ob_scene + "\",\n" +
                "  \"events\": [\n";

        if (!outputs.getParentFile().exists())
            outputs.getParentFile().mkdirs();

        try (FileWriter file = new FileWriter(outputs)) {
            file.write(line_start);
            file.write("  {\"id\":\"" + id + "\",");
            file.write("  \"start\":\"" + ((String) events.get(1)).replaceAll("startEvent:", "") + "\",");
            file.write("  \"end\":\"" + ((String) events.get(2)).replaceAll("endEvent:", "") + "\",");
            file.write("\"data\":{");
            file.write("\"title\":\"" + ((String) events.get(0)).replaceAll("title:", "") + "\",");
            file.write("\"description\":\"" + ((String) events.get(3)).replaceAll("description:", "") + "\",");
            file.write("},");
            file.write("\"render\":{");
            file.write("\"color\":\"" + color + "\",");
            if (!icon.equals("") && !icon.contains("#"))
                file.write("\"image\":\"" + icon + "\",");
            file.write("}");
            file.write("},");

            file.write("]}");
        } catch (IOException e) {
            log(e, "Exception");
        }
        return true;
    }

    @Override
    public boolean updateEvents(JSONArray events, String ob_scene) {
        return false;
    }

    @Override
    public boolean removeEvents(JSONArray events, String ob_scene) {
        return false;
    }

    @Override
    public Object addFilter(String ob_timeline_name, String ob_title, String ob_scene, String ob_filter_name,
                            String ob_backgroundColor, String ob_user, String ob_email, String ob_top, String ob_left,
                            String ob_width, String ob_height, String ob_camera, String ob_sort_by, String ob_filter) {
        return updateFilter("addFilter", ob_timeline_name, ob_scene, ob_title, ob_filter_name,
                ob_backgroundColor, ob_user, ob_email, ob_top, ob_left, ob_width, ob_height, ob_camera, ob_sort_by,
                ob_filter);
    }

    @Override
    public Object removeFilter(String ob_timeline_name, String ob_filter_name, String ob_scene, String ob_user) {
        updateFilter("remove", ob_timeline_name, ob_scene, null, ob_filter_name, null,
                null, null, null, null, null, null, null,
                null, null);
        return false;
    }

    @Override
    public boolean removeAllFilter(String ob_timeline_name, String ob_user) {

        String buildFile = _currentPathModel;
        buildFile = buildFile.replace("/yyyy", "");
        buildFile = buildFile.replace("/mm", "");
        buildFile = buildFile.replace("/dd", "");

        File outputs = new File(buildFile + "/" + ob_user + "_filter_setting.json");
        if (outputs.getParentFile().exists()) {
            outputs.delete();
            return true;
        }
        return false;
    }

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

    @Override
    public Object updateFilter(String ob_action, String ob_timeline_name, String ob_scene, String ob_title,
                               String ob_filter_name, String ob_backgroundColor, String ob_user, String ob_email,
                               String ob_top, String ob_left, String ob_width, String ob_height, String ob_camera,
                               String ob_sort_by, String ob_filter) {
        JSONParser parser = new JSONParser();
        Object filters;
        StringBuilder jsonObjectMerged = null;
        JSONObject jsonObject;
        String buildFile = _currentPathModel;
        JSONArray openbexi_timeline;
        JSONArray filter_array = null;
        JSONArray filter_array2;
        boolean no_filter_found = true;
        boolean ob_first_filter_deleted = false;
        boolean change_current = true;

        buildFile = buildFile.replace("/yyyy", "");
        buildFile = buildFile.replace("/mm", "");
        buildFile = buildFile.replace("/dd", "");

        File outputs = new File(buildFile + "/" + ob_user + "_" + ob_timeline_name + "_filter_setting.json");
        if (!outputs.getParentFile().exists())
            outputs.getParentFile().mkdirs();

        try {
            if (outputs.exists()) {
                Reader reader = new FileReader(outputs);
                try {
                    filters = parser.parse(reader);
                    if (ob_action.equals("readFilters")) {
                        reader.close();
                        return filters;
                    }
                    jsonObject = (JSONObject) filters;
                    openbexi_timeline = (JSONArray) jsonObject.get("openbexi_timeline");
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
                            jsonObjectMerged.append("  \"backgroundColor\":\"" + ob_backgroundColor + "\",");
                            jsonObjectMerged.append("  \"filter_value\":\"" + get_filter() + "\",");
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
            return addFilter(ob_timeline_name, ob_title, ob_scene, ob_filter_name, ob_backgroundColor, ob_user,
                    ob_email, ob_top, ob_left, ob_width, ob_height, ob_camera, ob_sort_by, ob_filter);
        }

        try (FileWriter file = new FileWriter(outputs)) {
            file.write(jsonObjectMerged.toString());
            file.flush();
        } catch (IOException e) {
            log(e, "Exception");
        }

        try {
            return parser.parse(jsonObjectMerged.toString());
        } catch (ParseException e) {
            return null;
        }
    }

    @Override
    public JSONArray filterEvents(JSONArray events, String filter_include, String filter_exclude) {
        if (filter_include.equals("") && filter_exclude.equals(""))
            return events;

        Pattern pattern;
        Matcher matcher;
        boolean found;
        JSONArray new_events = new JSONArray();
        if (filter_exclude != null && !filter_exclude.equals("")) {
            String[] items = filter_exclude.split(";");
            List<Boolean> list = new LinkedList<>();
            if (items.length > 0) {
                for (Object o : events) {
                    found = false;
                    String event = o.toString().replaceAll("\"", "");
                    for (String item : items) {
                        if (item.contains("+")) {
                            String[] sub_items = item.split("\\+");
                            for (String sub_item : sub_items) {
                                pattern = Pattern.compile(sub_item);
                                matcher = pattern.matcher(event);
                                if (matcher.find() || (item.contains("description:") && (o.toString().replaceAll("\"", "").contains(item.replace("description:", ""))))) {
                                    found = true;
                                } else {
                                    found = false;
                                    break;
                                }
                            }
                            if (found) {
                                list.add(true);
                                break;
                            } else
                                list.add(false);
                        } else {
                            list = new LinkedList<>();
                            if (item.contains("description:") && (o.toString().replaceAll("\"", "").contains(item.replace("description:", "")))) {
                                found = true;
                                break;
                            }
                            pattern = Pattern.compile(item);
                            matcher = pattern.matcher(event);
                            if (matcher.find()) {
                                found = true;
                                break;
                            }
                        }
                    }
                    if (list.size() > 0)
                        for (Boolean aBoolean : list) found = aBoolean;
                    if (!found) {
                        new_events.add(o);
                        //System.out.println(i + "exclude:" + (events.get(i)).toString());
                    }
                    list = new LinkedList<>();
                }
                events = new_events;
            } else
                events = new_events;
        }

        new_events = new JSONArray();
        if (!filter_include.equals("")) {
            String[] items = filter_include.split(";");
            if (items.length > 0) {
                for (Object o : events) {
                    found = false;
                    String event = o.toString().replaceAll("\"", "");
                    for (String item : items) {
                        if (item.contains("+")) {
                            String[] sub_items = item.split("\\+");
                            for (String sub_item : sub_items) {
                                pattern = Pattern.compile(sub_item);
                                matcher = pattern.matcher(event);
                                if (matcher.find() || (item.contains("description:") && (o.toString().replaceAll("\"", "").contains(item.replace("description:", ""))))) {
                                    found = true;
                                } else {
                                    found = false;
                                    break;
                                }
                            }
                            if (found) {
                                new_events.add(o);
                                found = false;
                            }
                        } else {
                            if (item.contains("description:") && (o.toString().replaceAll("\"", "").contains(item.replace("description:", "")))) {
                                found = true;
                                break;
                            }
                            pattern = Pattern.compile(item);
                            matcher = pattern.matcher(o.toString().replaceAll("\"", ""));
                            if (matcher.find()) {
                                found = true;
                                break;
                            }
                        }
                    }
                    if (found) {
                        new_events.add(o);
                        //System.out.println(i + "exclude:" + (events.get(i)).toString());
                    }
                }
            }
        } else
            new_events = events;

        return new_events;
    }
}
