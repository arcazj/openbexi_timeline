package com.openbexi.timeline.browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;

import javax.servlet.http.HttpServletResponse;
import javax.websocket.Session;
import java.io.*;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

abstract class FileWatcher extends TimerTask {
    private long fileListSize;
    private LinkedHashMap<File, String> fileList;

    private String MD5Hash(String fileDir) {
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
        }
        return sb.toString();
    }

    public FileWatcher(LinkedHashMap<File, String> fileList) {
        this.fileList = fileList;
    }

    public final void run() {
        for (Map.Entry<File, String> entry : fileList.entrySet()) {
            try {
                File file = new File(entry.getKey().toString());
                if (file.exists()) {
                    if (!entry.getValue().equals(MD5Hash(file.toString()))) {
                        onChange(fileList);
                    }
                } else {
                    //fileList.remove(file.toString());
                    //onChange(fileList);
                }
            } catch (Exception e) {
            }
        }

    }

    protected abstract void onChange(LinkedHashMap<File, String> fileList);
}

public class data {

    private String startDate;
    private long startDateL = 0;
    private String dateS;
    private String yearS;
    private String monthS;
    private String dayS;
    private String hourS;
    private String fileParentPathS;

    private String endDate;
    private long endDateL;
    private String dateE;
    private String yearE;
    private String monthE;
    private String dayE;
    private String hourE;

    private String fileParentPathE;
    private String pathModel = null;
    private String filter_exclude = null;
    private String filter_include = null;
    private LinkedHashMap<File, String> files = new LinkedHashMap<>();

    private boolean ob_debug = true;
    final static Charset ENCODING = StandardCharsets.UTF_8;

    private HttpServletResponse resp;
    private Session sess;
    private String action;
    private int ob_id = 0;
    private TimerTask task;


    protected void start_watching() {

        // monitor fileParentPathE change
        task = new FileWatcher(this.files) {
            @Override
            protected void onChange(LinkedHashMap<File, String> fileList) {
                this.cancel();
                if (resp == null) return;
                files = fileList;
                // here we code the action on a change
                PrintWriter respWriter = null;
                try {
                    respWriter = resp.getWriter();
                    //Important to put a "," not ";" between stream and charset
                    resp.setContentType("text/event-stream, charset=UTF-8");
                    //Important, otherwise only  test URL  like https://localhost:8443/openbexi_timeline.html works
                    resp.addHeader("Access-Control-Allow-Origin", "*");
                    // If clients have set Access-Control-Allow-Credentials to true, the server will not permit the use of
                    // credentials and access to resource by the client will be blocked by CORS policy.
                    resp.addHeader("Access-Control-Allow-Credentials", "true");
                    resp.addHeader("Cache-Control", "no-cache");
                    resp.addHeader("Connection", "keep-alive");
                    respWriter.write("event: ob_timeline\n\n");
                    respWriter.write("data:" + getJson() + "\n\n");
                    respWriter.write("retry: 1000000000\n\n");
                    respWriter.flush();
                    boolean error = respWriter.checkError();
                    task.cancel();
                    if (error == true) {
                        //if (timer != null) timer.cancel();
                        log("Client disconnected", "info");
                    }
                } catch (Exception e) {
                    log(e.getMessage(), "err");
                }
                System.out.println("File size " + fileList.size() + " has change !");
            }

        };
        // repeat the check every second
        new Timer().schedule(task, new Date(), 10000);
    }

    public data(String currentStartDate, String currentEndDate, String currentPathModel, String include, String exclude, String action_type,
                HttpServletResponse response, Session session, int id) {
        String[] items = null;
        startDate = currentStartDate.replaceAll("'", "");
        endDate = currentEndDate.replaceAll("'", "");
        pathModel = currentPathModel;
        filter_include = include;
        filter_exclude = exclude;
        resp = response;
        sess = session;
        action = action_type;
        ob_id = id;

        SimpleDateFormat year = new SimpleDateFormat("yyyy");
        SimpleDateFormat month = new SimpleDateFormat("MM");
        SimpleDateFormat day = new SimpleDateFormat("dd");
        SimpleDateFormat hour = new SimpleDateFormat("hh");

        try {
            startDateL = new Date(startDate).getTime();
            yearS = year.format(new Date(startDate));
            monthS = month.format(new Date(startDate));
            dayS = day.format(new Date(startDate));
            hourS = hour.format(new Date(startDate));

            endDateL = new Date(endDate).getTime();
            yearE = year.format(new Date(endDate));
            monthE = month.format(new Date(endDate));
            dayE = day.format(new Date(endDate));
            hourE = hour.format(new Date(endDate));

            String buildFile = pathModel.replace(".json", "");
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

    private String MD5Hash(String fileDir) {
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

    private void log(Object msg, String err) {
        if (ob_debug)
            if (err == null)
                System.out.println(String.valueOf(msg));
            else
                System.err.println(String.valueOf(msg));
    }

    /**
     * @return a simple json data with one event reporting there is no data
     */
    public String getJsonNoFoundData(String title) {

        // create time zone object
        TimeZone tzone = TimeZone.getTimeZone("UTC");
        // set time zone to default
        tzone.setDefault(tzone);
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

    private void getFiles(String startDate, String endDate, File dir) throws Exception {

        // Build file list according date range
        String yyyy;
        String MM;
        String dd;
        double step = 0;

        long startDateS = new Date(startDate).getTime();
        long startDateE = new Date(endDate).getTime();
        SimpleDateFormat dateFormat = new SimpleDateFormat("dd/MM/yyyy");

        // Loop on
        if (pathModel.contains("dd"))
            step = 86400000;
        else
            step = 2629746000.0;
        if (pathModel.contains("yyyy") && !pathModel.contains("mm") && !pathModel.contains("dd"))
            step = 31556952000.0;
        for (double d = startDateS; d <= startDateE; d = d + step) {
            String formatedDateS = dateFormat.format(d);
            yyyy = formatedDateS.substring(6, 10);
            MM = formatedDateS.substring(3, 5);
            dd = formatedDateS.substring(0, 2);

            String buildFile = pathModel;
            if (dir != null)
                buildFile = dir.getAbsolutePath();
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

    public JSONArray filterJson(JSONArray events) {
        Pattern pattern;
        Matcher matcher;
        JSONArray new_events = new JSONArray();
        if (filter_exclude != null && !filter_exclude.equals("")) {
            for (int i = 0; i < events.size(); i++) {
                pattern = Pattern.compile(filter_exclude);
                matcher = pattern.matcher(events.get(i).toString().replaceAll(" ", "").replaceAll("\"", ""));
                if (!matcher.find())
                    new_events.add(events.get(i));
            }
        }
        if (filter_include != null && !filter_include.equals("")) {
            for (int i = 0; i < events.size(); i++) {
                pattern = Pattern.compile(filter_include);
                matcher = pattern.matcher(events.get(i).toString().replaceAll("\"", ""));
                if (matcher.find())
                    new_events.add(events.get(i));
            }
        }
        return new_events;
    }

    /**
     * @return json data according a range of time.
     */
    public Object getJson() {
        if (pathModel == null || startDate == null)
            return getJsonNoFoundData("no data found");

        JSONParser parser = new JSONParser();
        Object events = null;
        JSONObject objPrevious = null;
        String filePath = null;
        JSONObject jsonObject = new JSONObject();


        // Look for for all files in the pathModel directory according startDate and endDate.

        try {
            getFiles(startDate, endDate, null);
        } catch (Exception e) {
            return getJsonNoFoundData("no data found - " + e.getMessage());
        }

        if (files == null)
            return getJsonNoFoundData("no data found");

        String jsonObjectMerged = "{\n" +
                "  \"dateTimeFormat\": \"iso8601\",\n" +
                "  \"events\": [\n";

        for (Map.Entry<File, String> entry : files.entrySet()) {
            try {
                File file = new File(entry.getKey().toString());
                if (file.exists()) {
                    Reader reader = new FileReader(file);
                    events = parser.parse(reader);
                    jsonObject = (JSONObject) events;
                    JSONArray obj = (JSONArray) jsonObject.get("events");
                    if (filter_exclude != null && !filter_exclude.equals("")) obj = filterJson(obj);
                    jsonObjectMerged += obj.toJSONString().replaceAll("\\[|\\]", "").replaceAll("\\\\/", "/") + ",";
                    reader.close();
                }
            } catch (Exception e) {
                return getJsonNoFoundData("no data found");
            }
        }
        jsonObjectMerged += "]}";

        try {
            return parser.parse(jsonObjectMerged);
        } catch (ParseException e) {
            return getJsonNoFoundData("no data found");
        }

    }
}

