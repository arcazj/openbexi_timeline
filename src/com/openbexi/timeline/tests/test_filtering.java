package com.openbexi.timeline.tests;

import com.openbexi.timeline.data_browser.data_configuration;
import com.openbexi.timeline.data_browser.json_files_manager;
import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;
import org.junit.Assert;
import org.junit.Test;

import java.io.*;

public class test_filtering {
    private data_configuration _data_configuration;

    public void set_data_configuration() {
        try {
            this._data_configuration = new data_configuration("yaml/sources_startup.yml");
        } catch (IOException e) {
            throw new RuntimeException(e);
        } catch (ParseException e) {
            throw new RuntimeException(e);
        }
    }

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
        this.set_data_configuration();
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "status:STARTED");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
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
        this.set_data_configuration();
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "|status:SCHEDULE");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 3155;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case1b() {
        this.set_data_configuration();
        // test include events with status:STARTED and exclude type:type2
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "status:STARTED|type:type2");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 2567;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case2() {
        this.set_data_configuration();
        // test include events with system:system1+tolerance:7+priority:0
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:system1+tolerance:7+priority:0");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 73;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case2a() {
        this.set_data_configuration();
        // test include events with system:system1+tolerance:7+priority:0 and exclude status:STARTED
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:system1+tolerance:7+priority:0|status:STARTED");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 53;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case2b() {
        this.set_data_configuration();
        // test include events with system:system1+tolerance:7+priority:0 and exclude status:STARTED;type:type1+type:type2
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:system1+tolerance:7+priority:0|status:STARTED;type:type1;type:type2");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 36;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }


    @Test
    public void test_case3() {
        this.set_data_configuration();
        // test include events with system:system1;system:system7
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:system1;system:system7");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 3189;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case4() {
        this.set_data_configuration();
        // test exclude events with only system:system1;system:system7+type:type1+tolerance:2;tolerance:6
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "|system:system1;system:system7+type:type1+tolerance:2;tolerance:6");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 10056;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case5() {
        this.set_data_configuration();
        // test include events with system:system3;system:system0 and exclude only system:system1;system:system7+type:type1+tolerance:2;tolerance:6
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:system0;system:system1;system:system7|system:system1;system:system7+type:type1+tolerance:2;tolerance:6");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 2855;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }


    @Test
    public void test_case7() {
        this.set_data_configuration();
        // test include events with system:system4+priority:1;system:system5+priority:0 and exclude system:system3+status:SCHEDULE
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:system4+priority:1;system:system5+priority:0;system:system3+priority:0|system:system3+status:SCHEDULE");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 1813;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case7a() {
        this.set_data_configuration();
        // test exclude events with system:system4+priority:1;system:system5+priority:0
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "|system:system4+priority:1;system:system5+priority:0");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 11187;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case7b() {
        this.set_data_configuration();
        // test exclude events with system:system4+priority:1;system:system5+priority:0
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "system:system1;system:system2;system:system3|system:system3+type:type0");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 4486;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case8() {
        this.set_data_configuration();
        // test include events with comments containing "description8 __1__  --0--"
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "description:description8 __1__  --0--");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 30;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case8a() {
        this.set_data_configuration();
        // test exclude events with comments containing "description8 __1__  --0--"
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "|description:description8 __1__  --0--");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 12770;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case8b() {
        this.set_data_configuration();
        // test include events with status:STARTED ou comments containing "description3 __1__  --3--"
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "status:STARTED;description:description3 __1__  --3--");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 3177;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case8c() {
        this.set_data_configuration();
        // test include events with status:STARTED and comments containing "description3 __1__  --3--"
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "status:STARTED+description:description3 __1__  --3--");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 5;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }

    @Test
    public void test_case8d() {
        this.set_data_configuration();
        // test exclude events with status:STARTED and comments containing "description3 __1__  --3--"
        _data_configuration.getConfiguration().put("startDate", null);
        _data_configuration.getConfiguration().put("endDate", null);
        _data_configuration.getConfiguration().put("search", null);
        _data_configuration.getConfiguration().put("filter", "|status:STARTED+description:description3 __1__  --3--");
        _data_configuration.getConfiguration().put("request", "");
        json_files_manager data = new json_files_manager(null, null, _data_configuration);

        JSONObject jsonObject = new JSONObject();
        jsonObject = (JSONObject) read_events(new File("tests/data/events.json"));
        JSONArray events = (JSONArray) jsonObject.get("events");
        events = data.filterEvents(events, data.get_include(), data.get_exclude());

        int filter1 = 12795;
        int filter2 = events.size();
        //print(events);
        Assert.assertEquals(filter1, filter2);
    }
}
