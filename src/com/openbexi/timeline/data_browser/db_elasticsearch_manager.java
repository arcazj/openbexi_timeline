package com.openbexi.timeline.data_browser;

import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import org.apache.http.HttpHost;
import org.elasticsearch.action.get.GetRequest;
import org.elasticsearch.action.get.GetResponse;
import org.elasticsearch.client.RequestOptions;
import org.elasticsearch.client.RestClient;
import org.elasticsearch.client.RestHighLevelClient;
import org.json.simple.JSONArray;

import java.io.IOException;

public class db_elasticsearch_manager extends data_manager {
    public db_elasticsearch_manager(String currentStartDate, String currentEndDate,
                                    String search, String filter, String action_type, HttpServletResponse response,
                                    HttpSession session, data_configuration configuration) {
        super(currentStartDate, currentEndDate, search, filter, action_type, response,
                session, configuration);
    }

    @Override
    Object login(String url, JSONArray cookies) {
        // Create the RestHighLevelClient
        RestHighLevelClient client = new RestHighLevelClient(
                RestClient.builder(
                        new HttpHost("localhost", 9200)
                )
        );

        // Create the GetRequest
        GetRequest request = new GetRequest("my_index", "my_document");

        // Get the document
        GetResponse response = null;
        try {
            response = client.get(request, RequestOptions.DEFAULT);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }

        // Print the document
        //System.out.println(response.getSourceAsString());

        // Close the client
        try {
            client.close();
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
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
