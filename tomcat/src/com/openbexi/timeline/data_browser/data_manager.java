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

    abstract Object getData(String filter);
    abstract boolean sendData(Object data);
    abstract JSONArray filter(JSONArray events, String filter_include, String filter_exclude);

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

