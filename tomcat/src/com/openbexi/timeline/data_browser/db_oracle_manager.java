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
    boolean onDataChange() {
        return false;
    }
}
