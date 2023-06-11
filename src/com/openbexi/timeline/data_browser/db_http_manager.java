package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;

import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;

public class db_http_manager extends data_manager {
    public db_http_manager(String currentStartDate, String currentEndDate, String search,
                           String filter, String action_type, HttpServletResponse response, HttpSession session,
                           data_configuration configuration) {
        super(currentStartDate, currentEndDate, search, filter, action_type, response, session,
                configuration);
    }

    public static void main(String[] args) {
        boolean connected = false;
        String url = null;

        if (args.length == 2) {
            if (args[0].equals("-url")) {
                url = args[1];
                connected = true;
            }
        }

        if (!connected) {
            System.err.println("db_http_manager: Not connected to a Restful interface because of bad usage:");
            System.err.println("Argument " + args[0] + " " + "-url <path>");
            System.exit(1);
        }

        db_http_manager db_http_manager = new db_http_manager(null, null,
                null, null, null, null, null, null);

    }

    @Override
    Object login(String url, JSONArray cookies) {
        return null;
    }

    @Override
    Object getData(String filter, String ob_scene) {
        return null;
    }

    @Override
    boolean sendData(Object data) {
        return false;
    }

    @Override
    JSONArray filterDates(JSONArray events, long currentEndDate, long currentStartDate) {
        return null;
    }

    @Override
    JSONArray filterEvents(JSONArray events, String filter_include, String filter_exclude) {
        return null;
    }

    @Override
    JSONArray searchEvents(JSONArray events, String search) {
        return null;
    }

    @Override
    boolean onDataChange(String ob_scene) throws InterruptedException {
        return false;
    }

    @Override
    boolean addEvents(JSONArray events, String ob_scene) {
        return false;
    }

    @Override
    boolean updateEvents(JSONArray events, String ob_scene) {
        return false;
    }

    @Override
    boolean removeEvents(JSONArray events, String ob_scene) {
        return false;
    }

    @Override
    public Object updateFilter(String ob_action, String ob_timeline_name, String ob_scene, String ob_title,
                               String ob_filter_name, String ob_backgroundColor, String ob_user, String ob_email,
                               String ob_top, String ob_left, String ob_width, String ob_height, String ob_camera,
                               String ob_sort_by, String ob_filter) {
        return super.updateFilter(ob_action, ob_timeline_name, ob_scene, ob_title, ob_filter_name, ob_backgroundColor,
                ob_user, ob_email, ob_top, ob_left, ob_width, ob_height, ob_camera, ob_sort_by, ob_filter);
    }
}
