package com.openbexi.timeline.tests;

import com.openbexi.timeline.data_browser.data_configuration;
import com.openbexi.timeline.data_browser.db_mongo_manager;
import org.json.simple.JSONArray;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;
import org.testng.annotations.Test;

import java.io.IOException;
import java.util.Date;
import java.util.TimeZone;
import java.util.UUID;

class db_mongo_managerTest {

    @Test
    void searchEvents() {
    }

    @Test
    void addEvents() {
        db_mongo_manager db = new db_mongo_manager(null, null, null,
                null, null, null, null, null);

        try {
            data_configuration conf = new data_configuration("etc/ob_mongodb_test_conf.json");
            db.login(conf.getUrl(0), conf.getDatabase(0), conf.getCollection(0), null);
        } catch (IOException e) {
            throw new RuntimeException(e);
        } catch (ParseException e) {
            throw new RuntimeException(e);
        }


        // Create a JSON array with the specified structure
        // create time zone object
        TimeZone tzone = TimeZone.getTimeZone("UTC");
        // set time zone to default
        TimeZone.setDefault(tzone);
        int z = 0;
        String ob_data = "", ob_data_start, ob_data_end = "";
        ob_data_start = "{\"dateTimeFormat\": \"iso8601\",\"events\" : [";
        long ob_time = new Date().getTime();
        Date ob_end_time2 = new Date(ob_time + 3000000);
        Date ob_start_time = new Date(ob_time);
        ob_data += "{\"id\": \"" + UUID.randomUUID() + "\",\"start\": \"" + ob_start_time + "\",\"end\": \"\",\"render\": {\"image\": \"/icon/ob_check_warning.png\", \"color\": \"#238448\"},\"data\":{\"title\": \"session_test_" + z++ + "\",\"description\": \"test\"}}," +
                "{\"id\": \"" + UUID.randomUUID() + "\",\"start\": \"" + ob_start_time + "\",\"end\": \"" + ob_end_time2 + "\",\"render\": {\"image\": \"/icon/ob_check_warning.png\", \"color\": \"#0f91f9\"},\"data\":{\"title\": \"session_test_" + z++ + "\",\"description\": \"test\"}}";
        ob_data_end = "]}\n\n";
        String event_list = ob_data_start + ob_data + ob_data_end;

        JSONParser parser = new JSONParser();
        Object obj = null;
        JSONArray events = null;
        boolean result = false;
        Object doc = null;

        try {
            events = db.jsonStringToJsonArray(event_list);
            result = db.addEvents(events, "ob_scene");
            doc = db.getData(null, null);
        } catch (ParseException e) {
            throw new RuntimeException(e);
        }


        // Check the result of the operation
        if (result) {
            System.out.println("Events added successfully.");
        } else {
            System.out.println("Failed to add events.");
        }

    }

    @Test
    void updateEvents() {
    }

    @Test
    void removeEvents() {
        db_mongo_manager db = new db_mongo_manager(null, null, null,
                null, null, null, null, null);

        try {
            data_configuration conf = new data_configuration("etc/ob_mongodb_test_conf.json");
            db.login(conf.getUrl(0), conf.getDatabase(0), conf.getCollection(0), null);
        } catch (IOException e) {
            throw new RuntimeException(e);
        } catch (ParseException e) {
            throw new RuntimeException(e);
        }

        db.removeEvents(null, null);
    }

    @Test
    void getData() {
        db_mongo_manager db = new db_mongo_manager(null, null, null,
                null, null, null, null, null);

        try {
            data_configuration conf = new data_configuration("etc/ob_mongodb_test_conf.json");
            db.login(conf.getUrl(0), conf.getDatabase(0), conf.getCollection(0), null);
        } catch (IOException e) {
            throw new RuntimeException(e);
        } catch (ParseException e) {
            throw new RuntimeException(e);
        }

        JSONArray json_array = (JSONArray) db.getData(null, null);
        System.out.print("Found " + json_array.toJSONString());
    }
}