package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;

public class db_oracle_manager extends data_manager {

    @Override
    Object getData(String filter) {
        return null;
    }

    @Override
    boolean sendData(Object data) {
        return false;
    }

    @Override
    JSONArray filter(JSONArray events, String filter_include, String filter_exclude) {
        return null;
    }

    @Override
    boolean onDataChange() {
        return false;
    }
}
