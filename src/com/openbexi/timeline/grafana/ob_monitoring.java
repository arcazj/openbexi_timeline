package com.openbexi.timeline.grafana;

import java.net.HttpURLConnection;
import java.net.URL;
import java.io.OutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;

public class ob_monitoring {
    public static void main(String[] args) {
        try {
            int userId = 1372253; // your userId
            String apiKey = "glc_eyJvIjoiMTAyOTQxNSIsIm4iOiJzdGFjay04MzEyMTctaW50ZWdyYXRpb24tb3BlbmJleGlfdGltZWxpbmUiLCJrIjoidGJXazEzalc1eThXa0g5OFJLMXd5NTI4IiwibSI6eyJyIjoicHJvZC11cy1lYXN0LTAifX0=";
            URL url = new URL("https://influx-prod-13-prod-us-east-0.grafana.net/api/v1/push/influx/write");
            HttpURLConnection con = (HttpURLConnection) url.openConnection();
            con.setRequestMethod("POST");
            con.setRequestProperty("Content-Type", "text/plain");
            con.setRequestProperty("Authorization", "Bearer " + userId + ":" + apiKey);
            String plainText = "test,bar_label=abc,source=grafana_cloud_docs metric=35.2";
            con.setDoOutput(true);
            OutputStream os = con.getOutputStream();
            os.write(plainText.getBytes());
            os.flush();
            os.close();

            int responseCode = con.getResponseCode();
            BufferedReader in = new BufferedReader(
                    new InputStreamReader(con.getInputStream()));
            in.close();
            System.out.println(responseCode);
        } catch (Exception e) {
            System.out.println("Exception: " + e);
        }
    }
}