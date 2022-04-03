package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;

public class db_oracle_manager extends data_manager {

    @Override
    Object userAccess(String permissions, JSONArray cookies) {
        return null;
    }

    @Override
    Object getData(String filter) {
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
    public boolean addEvents(JSONArray events) {
        return false;
    }

    @Override
    public boolean updateEvents(JSONArray events) {
        return false;
    }

    @Override
    public boolean removeEvents(JSONArray events) {
        return false;
    }

    @Override
    public Object addFilter(String ob_timeline_name, String ob_title, String ob_filter_name,
                     String ob_backgroundColor, String ob_user, String ob_email, String ob_top, String ob_left,
                     String ob_width, String ob_height, String ob_camera, String ob_sort_by, String ob_filter) {
        return false;
    }

    @Override
    public Object updateFilter(String ob_action, String ob_timeline_name, String ob_title, String ob_filter_name,
                        String ob_backgroundColor, String ob_user, String ob_email, String ob_top, String ob_left,
                        String ob_width, String ob_height, String ob_camera, String ob_sort_by, String ob_filter) {
        return false;
    }

    @Override
    public Object removeFilter(String ob_filter_name, String ob_timeline_name, String ob_user) {
        return false;
    }

    @Override
    boolean removeAllFilter(String ob_timeline_name, String ob_user) {
        return false;
    }

    @Override
    boolean onDataChange() {
        return false;
    }
}
