package openbexi.timeline.browser;

import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;

import java.io.File;
import java.io.FileReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;

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
    private final String pathModel;
    private LinkedHashMap<File, String> files = new LinkedHashMap<>();

    private boolean ob_debug = true;
    final static Charset ENCODING = StandardCharsets.UTF_8;

    public data(String currentStartDate, String currentEndDate, String currentPathModel) {
        startDate = currentStartDate.replaceAll("'", "");
        endDate = currentEndDate.replaceAll("'", "");
        pathModel = currentPathModel;

        SimpleDateFormat year = new SimpleDateFormat("yyyy");
        SimpleDateFormat month = new SimpleDateFormat("MM");
        SimpleDateFormat day = new SimpleDateFormat("dd");
        SimpleDateFormat hour = new SimpleDateFormat("hh");
        SimpleDateFormat simpleDateFormat = new SimpleDateFormat("yyyy_mm_dd_hh");
        simpleDateFormat.setTimeZone(TimeZone.getTimeZone("UTC"));

        try {
            dateS = simpleDateFormat.format(new Date(startDate));
            startDateL = new Date(startDate).getTime();
            yearS = year.format(new Date(startDate));
            monthS = month.format(new Date(startDate));
            dayS = day.format(new Date(startDate));
            hourS = hour.format(new Date(startDate));

            dateE = simpleDateFormat.format(new Date(endDate));
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
        } catch (Exception e) {
            log(e.getMessage(), "err");
        }
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

    private void getFiles(String startDate, String endDate) throws Exception {

        // Build file list according date range
        // Loop on years
        for (int yyyy = Integer.parseInt(this.yearS); yyyy <= Integer.parseInt(this.yearE); yyyy++) {
            // Loop on months
            for (int MM = Integer.parseInt(this.monthS); MM <= Integer.parseInt(this.monthE); MM++) {
                // Loop on days
                for (int dd = Integer.parseInt(this.dayS); dd <= Integer.parseInt(this.dayE); dd++) {
                    String buildFile = pathModel.replace(".json", "");
                    buildFile = buildFile.replace("/yyyy", "/" + yyyy);
                    buildFile = buildFile.replace("/mm", "/" + String.format("%02d", MM));
                    buildFile = buildFile.replace("/dd", "/" + String.format("%02d", dd));
                    fileParentPathS = new File(buildFile + "_" + dateS + ".json").getParent();
                    File[] file_list = new File(fileParentPathS).listFiles();
                    if (file_list != null) {
                        for (int f = 0; f < file_list.length; f++) {
                            if (file_list[f].exists())
                                files.put(file_list[f], yyyy + "-" + MM + "-" + dd);
                        }
                    }
                }
            }
        }
    }

    /**
     * @return json data according a range of time.
     */
    public Object getJson() {
        if (pathModel == null || startDate == null)
            return getJsonNoFoundData("no data found");

        JSONParser parser = new JSONParser();
        Object obj = null;
        JSONObject objPrevious = null;
        String filePath = null;
        JSONObject jsonObject = new JSONObject();


        // Look for for all files in the pathModel directory according startDate and endDate.

        try {
            getFiles(startDate, endDate);
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
                    obj = parser.parse(new FileReader(file));
                    jsonObject = (JSONObject) obj;
                    JSONArray events = (JSONArray) jsonObject.get("events");
                    jsonObjectMerged += events.toJSONString().replaceAll("\\[|\\]", "") + ",";
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

