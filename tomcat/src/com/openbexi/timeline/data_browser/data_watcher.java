package com.openbexi.timeline.data_browser;

import java.io.FileInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.TimerTask;

abstract class data_watcher extends TimerTask {

    private Object data;

    /**
     * Check periodically if the data has changed, If changed refresh the openBEXI timeline with new events
     *
     * @param data
     */
    public data_watcher(Object data) {

    }

    public data_watcher() {

    }

    @Override
    public void run() {};

}