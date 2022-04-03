package com.openbexi.timeline.data_browser;

import org.json.simple.JSONArray;

import java.io.FileInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;


abstract class data_manager {
    private boolean ob_debug = true;


    public data_manager() {

    }

    abstract Object userAccess(String permissions, JSONArray cookies);

    abstract Object getData(String filter);

    abstract boolean sendData(Object data);

    abstract JSONArray filterDates(JSONArray events, long currentEndDate, long currentStartDate);

    abstract JSONArray filterEvents(JSONArray events, String filter_include, String filter_exclude);

    abstract JSONArray searchEvents(JSONArray events, String search);

    abstract boolean addEvents(JSONArray events);

    abstract boolean updateEvents(JSONArray events);

    abstract boolean removeEvents(JSONArray events);

    abstract Object addFilter(String ob_timeline_name, String ob_title, String ob_filter_name,
                              String ob_backgroundColor, String ob_user, String ob_email, String ob_top, String ob_left,
                              String ob_width, String ob_height, String ob_camera, String ob_sort_by, String ob_filter);

    abstract Object updateFilter(String ob_action, String ob_timeline_name, String ob_title, String ob_filter_name,
                                 String ob_backgroundColor, String ob_user, String ob_email, String ob_top,
                                 String ob_left, String ob_width, String ob_height, String ob_camera,
                                 String ob_sort_by, String ob_filter);

    abstract Object removeFilter(String ob_filter_name, String ob_timeline_name, String ob_user);

    abstract boolean removeAllFilter(String ob_timeline_name, String ob_user);

    abstract boolean onDataChange() throws InterruptedException;

    protected void log(Object msg, String err) {
        if (ob_debug)
            if (err == null)
                System.out.println(String.valueOf(msg));
            else
                System.err.println(String.valueOf(msg));
    }

    protected String MD5Hash(String fileDir) {
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

}

