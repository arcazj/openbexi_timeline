package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;

import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.*;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class json_files_manager extends data_manager {

    public json_files_manager(HttpServletResponse response,
                              HttpSession session, data_configuration configuration) {
        super(response, session, configuration);
    }

    public static JSONArray sortByDate(JSONArray jsonArray) {
        jsonArray.sort(new Comparator<Object>() {
            @Override
            public int compare(Object o1, Object o2) {
                try {
                    String dateString1 = (String) ((JSONObject) o1).get("start");
                    String dateString2 = (String) ((JSONObject) o2).get("start");

                    SimpleDateFormat sdf1 = new SimpleDateFormat("MMM dd HH:mm:ss yyyy");
                    SimpleDateFormat sdf2 = new SimpleDateFormat("EEE MMM dd HH:mm:ss zzz yyyy", Locale.US);
                    sdf2.setTimeZone(TimeZone.getTimeZone("UTC"));

                    Date date1;
                    Date date2;

                    try {
                        date1 = sdf1.parse(dateString1);
                    } catch (Exception e1) {
                        // If parsing using the first format fails, try the second format
                        try {
                            date1 = sdf2.parse(dateString1);
                        } catch (java.text.ParseException e) {
                            throw new RuntimeException(e);
                        }
                    }

                    try {
                        date2 = sdf1.parse(dateString2);
                    } catch (Exception e2) {
                        // If parsing using the first format fails, try the second format
                        try {
                            date2 = sdf2.parse(dateString2);
                        } catch (java.text.ParseException e) {
                            throw new RuntimeException(e);
                        }
                    }

                    return date1.compareTo(date2);
                } catch (Exception e) {
                    // Handle parsing exceptions if needed
                    e.printStackTrace();
                    return 0;
                }
            }
        });

        return jsonArray; // Return the sorted JSONArray
    }

    @Override
    Object login(String url, JSONArray cookies) {
        return null;
    }

    /**
     * @return data according a range of time.
     */
    public Object getData(String filter, String ob_scene) {
        Date t1 = new Date();
        JSONParser parser = new JSONParser();
        Object events;
        JSONObject jsonObject;

        // Look for all files in the pathModel directory according startDate and endDate.
        try {
            this.getFiles(_currentStartDate, _currentEndDate);
        } catch (Exception e) {
            return getDummyJson("no data_manager found - " + e.getMessage());
        }

        if (_files == null)
            return getDummyJson("no data_manager found");

        String jsonObjectMerged_begin = "{\n" +
                "  \"dateTimeFormat\": \"iso8601\",\n" +
                "  \"scene\": \"" + ob_scene + "\",\n" +
                "  \"events\": \n";
        int count = 0;
        JSONArray all_obj = new JSONArray();
        for (Map.Entry<File, String> entry : _files.entrySet()) {
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
        String currentPathModel;

        long startDateS = new Date(_currentStartDate).getTime();
        long startDateE = new Date(_currentEndDate).getTime();
        SimpleDateFormat dateFormat = new SimpleDateFormat("dd/MM/yyyy");

        // Loop on
        JSONArray configurations = (JSONArray) _data_configuration.getConfiguration().get("startup configuration");
        for (int d = 0; d < configurations.size(); d++) {
            currentPathModel = (String) _data_configuration.getConfiguration(d).get("data_model");

            if (currentPathModel.contains("dd"))
                step = 86400000;
            else
                step = 2629746000.0;
            if (currentPathModel.contains("yyyy") && !currentPathModel.contains("mm") && !currentPathModel.contains("dd"))
                step = 31556952000.0;
            for (double t = startDateS; t <= startDateE; t = t + step) {
                String formatedDateS = dateFormat.format(t);
                yyyy = formatedDateS.substring(6, 10);
                MM = formatedDateS.substring(3, 5);
                dd = formatedDateS.substring(0, 2);

                String buildFile = currentPathModel;
                buildFile = buildFile.replace("/yyyy", "/" + yyyy);
                buildFile = buildFile.replace("/mm", "/" + MM);
                buildFile = buildFile.replace("/dd", "/" + dd);

                File[] file_list = new File(buildFile).listFiles();

                if (file_list != null) {
                    for (File file : file_list) {
                        if (file.exists() && file.isFile() && file.getName().contains(".json")) {
                            checksum += this.MD5Hash(file.getCanonicalPath());
                        } else {
                            if (file.exists() && !file.isHidden() &&
                                    !file.getName().contains("descriptors") &&
                                    !file.getName().contains("noises") &&
                                    file.isDirectory()) {
                                this.getFiles(_currentStartDate, _currentEndDate);
                            }
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

    private void getFiles(String startDate, String endDate) {

        // Build file list according date range
        String yyyy;
        String MM;
        String dd;
        double step = 0;
        // set time zone to default
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        String currentPathModel;

        JSONArray configurations = (JSONArray) _data_configuration.getConfiguration().get("startup configuration");
        for (int d = 0; d < configurations.size(); d++) {
            currentPathModel = (String) _data_configuration.getConfiguration(d).get("data_model");

            if (currentPathModel.contains("dd"))
                step = 86400000;
            else
                step = 2629746000.0;
            if (currentPathModel.contains("yyyy") && !currentPathModel.contains("mm") && !currentPathModel.contains("dd"))
                step = 31556952000.0;

            long startDateS = (long) (new Date(startDate).getTime() - step);
            long startDateE = (long) (new Date(endDate).getTime() + step);
            SimpleDateFormat dateFormat = new SimpleDateFormat("dd/MM/yyyy");

            for (double t = startDateS; t <= startDateE; t = t + step) {
                String formatedDateS = dateFormat.format(t);
                yyyy = formatedDateS.substring(6, 10);
                MM = formatedDateS.substring(3, 5);
                dd = formatedDateS.substring(0, 2);

                String buildFile = currentPathModel;
                buildFile = buildFile.replace("/yyyy", "/" + yyyy);
                buildFile = buildFile.replace("/mm", "/" + MM);
                buildFile = buildFile.replace("/dd", "/" + dd);

                FilenameFilter filter = new FilenameFilter() {
                    @Override
                    public boolean accept(File dir, String name) {
                        return !name.startsWith("descriptors") && !name.contains("noises");
                    }
                };
                File[] file_list = new File(buildFile).listFiles(filter);

                if (file_list != null) {
                    for (File file : file_list) {
                        if (file.exists() && file.isFile() && file.getName().contains(".json")) {
                            _files.put(file, MD5Hash(file.toString()));
                            //log(file_list[f], "info");
                        } else {
                            if (file.exists() && !file.isHidden() &&
                                    !file.getName().contains("descriptors") &&
                                    !file.getName().contains("noises") &&
                                    file.isDirectory()) {
                                this.getFiles(startDate, endDate);
                            }
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
        String currentPathModel;

        JSONArray configurations = (JSONArray) _data_configuration.getConfiguration().get("startup configuration");
        for (int d = 0; d < configurations.size(); d++) {
            currentPathModel = (String) _data_configuration.getConfiguration(d).get("data_model");

            String buildFile = currentPathModel;
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
                file.write("\"namespace\":\"" + ((String) events.get(0)).replaceAll("namespace:", "") + "\",");
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
    public Object addFilter(String ob_timeline_name, String ob_title, String ob_scene, String ob_namespace,
                            String ob_filter_name, String ob_backgroundColor, String ob_user, String ob_email,
                            String ob_top, String ob_left, String ob_width, String ob_height, String ob_camera,
                            String ob_sort_by, String ob_filter) {
        return updateFilter("addFilter", ob_timeline_name, ob_scene, ob_namespace, ob_title, ob_filter_name,
                ob_backgroundColor, ob_user, ob_email, ob_top, ob_left, ob_width, ob_height, ob_camera, ob_sort_by,
                ob_filter);
    }

    @Override
    public Object removeFilter(String ob_timeline_name, String ob_filter_name, String ob_scene, String ob_namespace,
                               String ob_user) {
        updateFilter("remove", ob_timeline_name, ob_scene, ob_namespace, null, ob_filter_name,
                null, null, null, null, null, null, null,
                null, null, null);
        return false;
    }

    @Override
    public Object updateFilter(String ob_action, String ob_timeline_name, String ob_scene, String ob_namespace,
                               String ob_title, String ob_filter_name, String ob_backgroundColor, String ob_user,
                               String ob_email, String ob_top, String ob_left, String ob_width, String ob_height,
                               String ob_camera,
                               String ob_sort_by, String ob_filter) {
        return super.updateFilter(ob_action, ob_timeline_name, ob_scene, ob_namespace, ob_title, ob_filter_name,
                ob_backgroundColor, ob_user, ob_email, ob_top, ob_left, ob_width, ob_height, ob_camera, ob_sort_by,
                ob_filter);
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
