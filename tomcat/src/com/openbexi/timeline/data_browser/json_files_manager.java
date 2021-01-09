package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;

import javax.servlet.ServletContext;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.File;
import java.io.FileReader;
import java.io.PrintWriter;
import java.io.Reader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class json_files_manager extends data_manager {

    private long startDateL = 0;
    private String dateS;
    private String yearS;
    private String monthS;
    private String dayS;
    private String hourS;
    private String fileParentPathS;

    private long endDateL;
    private String dateE;
    private String yearE;
    private String monthE;
    private String dayE;
    private String hourE;
    private String previous_date = "NONE";
    private String next_date = "NONE";

    public String get_currentStartDate() {
        return _currentStartDate;
    }

    public String get_currentEndDate() {
        return _currentEndDate;
    }

    public String get_currentPathModel() {
        return _currentPathModel;
    }

    private String fileParentPathE;
    private LinkedHashMap<File, String> files = new LinkedHashMap<>();

    final static Charset ENCODING = StandardCharsets.UTF_8;
    private TimerTask task;
    private String _currentStartDate;
    private String _currentEndDate;
    private String _currentPathModel;
    private String _include;
    private String _exclude;
    private String _search;
    private String _action_type;
    private HttpServletResponse _response;
    private HttpSession _session;
    private ServletContext _servletContext;
    private int _context_timer = 0;
    private String _checksum = "*";

    public json_files_manager(String currentStartDate, String currentEndDate, String currentPathModel, String search, String include, String exclude, String action_type,
                              HttpServletResponse response, HttpSession session, ServletContext servletContext) {
        super();

        String[] items = null;
        _currentStartDate = currentStartDate.replaceAll("'", "");
        _currentEndDate = currentEndDate.replaceAll("'", "");
        if (currentPathModel != null)
            _currentPathModel = currentPathModel.replaceAll("\\\\", "/");
        _include = include;
        _exclude = exclude;
        _search = search;
        _action_type = action_type;
        _response = response;
        _session = session;
        _action_type = action_type;
        _servletContext = servletContext;

        // set time zone to default
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        SimpleDateFormat year = new SimpleDateFormat("yyyy");
        SimpleDateFormat month = new SimpleDateFormat("MM");
        SimpleDateFormat day = new SimpleDateFormat("dd");
        SimpleDateFormat hour = new SimpleDateFormat("hh");

        try {
            startDateL = new Date(_currentStartDate).getTime();
            yearS = year.format(new Date(_currentStartDate));
            monthS = month.format(new Date(_currentStartDate));
            dayS = day.format(new Date(_currentStartDate));
            hourS = hour.format(new Date(_currentStartDate));

            endDateL = new Date(_currentEndDate).getTime();
            yearE = year.format(new Date(_currentEndDate));
            monthE = month.format(new Date(_currentEndDate));
            dayE = day.format(new Date(_currentEndDate));
            hourE = hour.format(new Date(_currentEndDate));

            String buildFile = _currentPathModel.replace(".json", "");
            buildFile = buildFile.replace("/yyyy", "/" + yearS);
            buildFile = buildFile.replace("/mm", "/" + monthS);
            buildFile = buildFile.replace("/dd", "/" + dayS);
            fileParentPathS = new File(buildFile + "_" + dateS + ".json").getParent();

            buildFile = buildFile.replace("/yyyy", "/" + yearE);
            buildFile = buildFile.replace("/mm", "/" + monthE);
            buildFile = buildFile.replace("/dd", "/" + dayE);
            fileParentPathE = new File(buildFile + "_" + dateE + ".json").getParent();

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
    public Object getData(String filter) {
        Date t1 = new Date();
        if (_currentPathModel == null || _currentStartDate == null)
            return getDummyJson("no data_manager found");

        JSONParser parser = new JSONParser();
        Object events = null;
        JSONObject objPrevious = null;
        String filePath = null;
        JSONObject jsonObject = new JSONObject();


        // Look for for all files in the pathModel directory according startDate and endDate.

        try {
            getFiles(_currentStartDate, _currentEndDate, new File(_currentPathModel));
        } catch (Exception e) {
            return getDummyJson("no data_manager found - " + e.getMessage());
        }

        if (files == null)
            return getDummyJson("no data_manager found");

        String jsonObjectMerged = "{\n" +
                "  \"dateTimeFormat\": \"iso8601\",\n" +
                "  \"events\": [\n";
        int count = 0;
        for (Map.Entry<File, String> entry : files.entrySet()) {
            try {
                File file = new File(entry.getKey().toString());
                if (file.exists()) {
                    Reader reader = new FileReader(file);
                    events = parser.parse(reader);
                    jsonObject = (JSONObject) events;
                    JSONArray obj = (JSONArray) jsonObject.get("events");
                    obj = filterEvents(obj, _include, _exclude);
                    obj = searchEvents(obj, _search);
                    count += obj.size();
                    jsonObjectMerged += obj.toJSONString().replaceAll("\\[|\\]", "").replaceAll("\\\\/", "/") + ",";
                    reader.close();
                }
            } catch (Exception e) {
                return getDummyJson("no data_manager found");
            }
        }
        jsonObjectMerged += "]}";

        try {
            log("Return " + String.format("% 5d", count) + " events/sessions -  " +
                    String.format("% 4d", (new Date().getTime() - t1.getTime()) ) + " millis", "info");
            return parser.parse(jsonObjectMerged);
        } catch (ParseException e) {
            return getDummyJson("no data_manager found");
        }

    }

    private void print_events(JSONObject events) {
        try {
            AtomicInteger count = new AtomicInteger();
            events.keySet().forEach(keyStr -> {
                Object keyvalue = events.get(keyStr);
                try {
                    JSONArray a = (JSONArray) keyvalue;
                    for (int i = 0; i < a.size(); i++) {
                        try {
                            JSONObject data = (JSONObject) a.get(i);
                            data.keySet().forEach(keyStr2 -> {
                                JSONObject keydata = (JSONObject) data.get(keyStr2);
                                System.out.println("");
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
                        }
                    }
                } catch (Exception e) {
                }
            });
        } catch (Exception e) {

        }
    }

    @Override
    boolean sendData(Object data) {
        if (_response == null) return false;
        // here we code the action on a change
        try {
            PrintWriter respWriter = _response.getWriter();
            //Important to put a "," not ";" between stream and charset
            _response.setContentType("text/event-stream, charset=UTF-8");
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
            if (error == true) {
                return false;
            }
        } catch (Exception e) {
            log(e.getMessage(), "err");
        }
        //print_events((JSONObject) data);
        return true;
    }

    @Override
    public boolean onDataChange() throws InterruptedException {
        Logger logger = Logger.getLogger("");

        //Update client regarding  HTTP service
        boolean able_to_send_data = sendData(getData(_include + "|" + _exclude));
        if (able_to_send_data == false) {
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
        ob_data_start = "{\"dateTimeFormat\": \"iso8601\",\"events\" : [";
        long ob_time = new Date().getTime();
        Date ob_start_time = new Date(ob_time);
        ob_data += "{\"ID\": \"" + UUID.randomUUID().toString() +
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
        double step = 0;

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
                for (int f = 0; f < file_list.length; f++) {
                    if (file_list[f].exists() && file_list[f].isFile() && file_list[f].getName().contains(".json")) {
                        checksum += this.MD5Hash(file_list[f].getCanonicalPath());
                    }
                    if (file_list[f].exists() && file_list[f].isDirectory()) {
                        this.getFiles(_currentStartDate, _currentEndDate, file_list[f]);
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

    private void getFiles(String startDate, String endDate, File dir) throws Exception {

        // Build file list according date range
        String yyyy;
        String MM;
        String dd;
        double step = 0;
        // set time zone to default
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        long startDateS = new Date(startDate).getTime();
        long startDateE = new Date(endDate).getTime();
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
                for (int f = 0; f < file_list.length; f++) {
                    if (file_list[f].exists() && file_list[f].isFile() && file_list[f].getName().contains(".json")) {
                        files.put(file_list[f], MD5Hash(file_list[f].toString()));
                        //log(file_list[f], "info");
                    }
                    if (file_list[f].exists() && file_list[f].isDirectory()) {
                        this.getFiles(startDate, endDate, file_list[f]);
                    }
                }
            }
        }
    }

    @Override
    JSONArray searchEvents(JSONArray events, String search) {
        Pattern pattern;
        Matcher matcher;
        JSONArray new_events = new JSONArray();
        JSONArray new_events2 = new JSONArray();
        if (search != null && !search.equals("*") && !search.equals("")) {
            pattern = Pattern.compile(search.replaceAll(" ", "|"));
            for (Object event : events) {
                matcher = pattern.matcher(event.toString().replaceAll(" ", "").replaceAll("\"", ""));
                if (matcher.find()) {
                    JSONObject obj1 = (JSONObject) event;
                    JSONObject obj2 = (JSONObject) obj1.get("render");
                    obj2.put("backgroundColor", "#F8DF09");
                    obj2.put("next_date", next_date);
                    next_date = obj1.get("start").toString();
                    new_events.add(event);
                } else
                    new_events.add(event);
            }
            for (int i = new_events.size() - 1; i >= 0; i--) {
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
            }
        }

        if (new_events2.size() == 0)
            new_events2 = events;

        return new_events2;
    }

    @Override
    boolean addEvents(JSONArray events) {
        return false;
    }

    @Override
    boolean updateEvents(JSONArray events) {
        return false;
    }

    @Override
    boolean removeEvents(JSONArray events) {
        return false;
    }

    @Override
    JSONArray filterEvents(JSONArray events, String filter_include, String filter_exclude) {

        if (filter_include.equals("") && filter_exclude.equals(""))
            return events;

        Pattern pattern;
        Matcher matcher;
        boolean found;
        JSONArray new_events = new JSONArray();
        if (filter_exclude != null && !filter_exclude.equals("")) {
            String[] items = filter_exclude.split("\\+");
            if (items.length > 1) {
                for (int i = 0; i < events.size(); i++) {
                    found = false;
                    for (int j = 0; j < items.length; j++) {
                        if (events.get(i).toString().toString().replaceAll("\"", "").contains(items[j]))
                            found = true;
                        else {
                            found = false;
                            break;
                        }
                    }
                    if (found == false) {
                        new_events.add(events.get(i));
                        //System.out.println(i + "exclude:" + (events.get(i)).toString());
                    }
                }
            } else {
                pattern = Pattern.compile(filter_exclude.strip().replaceAll(" ", "|"));
                for (int i = 0; i < events.size(); i++) {
                    matcher = pattern.matcher(events.get(i).toString().replaceAll("\"", ""));
                    if (!matcher.find()) {
                        new_events.add(events.get(i));
                        //System.out.println(i + "exclude:" + (events.get(i)).toString());
                    }
                }
            }
        }
        if (filter_include != null && !filter_include.equals("")) {
            String[] items = filter_include.split("\\+");
            if (items.length > 1) {
                for (int i = 0; i < events.size(); i++) {
                    found = false;
                    for (int j = 0; j < items.length; j++) {
                        if (events.get(i).toString().toString().replaceAll("\"", "").contains(items[j]))
                            found = true;
                        else {
                            found = false;
                            break;
                        }
                    }
                    if (found == true) {
                        new_events.add(events.get(i));
                        //System.out.println(i + "include:" + (events.get(i)).toString());
                    }
                }
            } else {
                pattern = Pattern.compile(filter_include.strip().replaceAll(" ", "|"));
                for (int i = 0; i < events.size(); i++) {
                    matcher = pattern.matcher(events.get(i).toString().replaceAll("\"", ""));
                    if (matcher.find()) {
                        new_events.add(events.get(i));
                        System.out.println(i + "include:" + (events.get(i)).toString());
                    }
                }
            }
        }

        return new_events;
    }


}
