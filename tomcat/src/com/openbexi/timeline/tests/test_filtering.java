package com.openbexi.timeline.tests;

import com.openbexi.timeline.data_browser.json_files_manager;
import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;
import org.junit.Assert;
import org.junit.Test;

import java.io.*;

public class test_filtering {
    private Object read_events(File file) {
        Object events = null;
        JSONParser parser = new JSONParser();
        Reader reader = null;
        try {
            reader = new FileReader(file);
            events = parser.parse(reader);
        } catch (FileNotFoundException e) {
            e.printStackTrace();
        } catch (IOException e) {
            e.printStackTrace();
        } catch (ParseException e) {
            e.printStackTrace();
        }
        return events;
    }

    private void print(JSONArray events) {
        for (int e = 0; e < events.size(); e++) {
            System.out.println(events.get(e).toString());
        }
    }

    @Test
    public void test_case1() {
        // test include events with only status:STARTED
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "status:STARTED", "",
                null, null, null);

        JSONObject jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 3155;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case1a() {
        // test exclude events with only status:SCHEDULE
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "|status:SCHEDULE", "",
                null, null, null);

        JSONObject jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 3155;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case1b() {
        // test include events with status:STARTED and exclude type:type2
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "status:STARTED|type:type2", "",
                null, null, null);

        JSONObject jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 2567;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case2() {
        // test include events with system:system1+tolerance:7+priority:0
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:system1+tolerance:7+priority:0", "",
                null, null, null);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 73;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case2a() {
        // test include events with system:system1+tolerance:7+priority:0 and exclude status:STARTED
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:system1+tolerance:7+priority:0|status:STARTED", "",
                null, null, null);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 53;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case2b() {
        // test include events with system:system1+tolerance:7+priority:0 and exclude status:STARTED;type:type1+type:type2
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:system1+tolerance:7+priority:0|status:STARTED;type:type1;type:type2", "",
                null, null, null);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 36;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }


    @Test
    public void test_case3() {
        // test include events with system:system1;system:system7
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:system1;system:system7", "",
                null, null, null);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 3189;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case4() {
        // test exclude events with only system:system1;system:system7+type:type1+tolerance:2;tolerance:6
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "|system:system1;system:system7+type:type1+tolerance:2;tolerance:6", "",
                null, null, null);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 10056;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case5() {
        // test include events with system:system3;system:system0 and exclude only system:system1;system:system7+type:type1+tolerance:2;tolerance:6
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:system0;system:system1;system:system7|system:system1;system:system7+type:type1+tolerance:2;tolerance:6", "",
                null, null, null);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 2855;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }


    @Test
    public void test_case7() {
        // test include events with system:system4+priority:1;system:system5+priority:0 and exclude system:system3+status:SCHEDULE
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:system4+priority:1;system:system5+priority:0;system:system3+priority:0|system:system3+status:SCHEDULE", "",
                null, null, null);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 1813;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case7a() {
        // test exclude events with system:system4+priority:1;system:system5+priority:0
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "|system:system4+priority:1;system:system5+priority:0", "",
                null, null, null);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 11187;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case7b() {
        // test exclude events with system:system4+priority:1;system:system5+priority:0
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "system:system1;system:system2;system:system3|system:system3+type:type0", "", null, null, null);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 4486;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case8() {
        // test include events with comments containing "description8 __1__  --0--"
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "description:description8 __1__  --0--", "", null, null, null);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 30;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case8a() {
        // test exclude events with comments containing "description8 __1__  --0--"
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "|description:description8 __1__  --0--", "", null, null, null);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 12770;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case8b() {
        // test include events with status:STARTED ou comments containing "description3 __1__  --3--"
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "status:STARTED;description:description3 __1__  --3--", "", null, null, null);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 3177;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case8c() {
        // test include events with status:STARTED and comments containing "description3 __1__  --3--"
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "status:STARTED+description:description3 __1__  --3--", "", null, null, null);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 5;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case8d() {
        // test exclude events with status:STARTED and comments containing "description3 __1__  --3--"
        json_files_manager data = new json_files_manager(null, null, "/data/yyyy/mm/dd", null,
                "|status:STARTED+description:description3 __1__  --3--", "", null, null, null);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 12795;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }
}
