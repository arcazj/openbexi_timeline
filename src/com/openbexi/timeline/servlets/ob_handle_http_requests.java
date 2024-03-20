package com.openbexi.timeline.servlets;

import com.openbexi.timeline.data_browser.*;
import com.openbexi.timeline.tests.test_timeline;
import org.json.simple.JSONArray;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.PrintWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Enumeration;
import java.util.TimeZone;
import java.util.logging.Logger;

public class ob_handle_http_requests {
    Logger logger = Logger.getLogger("");

    public ob_handle_http_requests(HttpServletRequest req, HttpServletResponse resp, data_configuration configuration) {
    }

    public HttpServletResponse ob_handle_header(HttpServletRequest req, HttpServletResponse resp) {
        // Set character encoding and common headers first as they are common for all responses
        resp.setCharacterEncoding("UTF-8");
        resp.addHeader("Access-Control-Allow-Origin", "*");
        resp.addHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, HEAD");
        resp.addHeader("Access-Control-Allow-Headers", "X-PINGOTHER, Origin, X-Requested-With, Content-Type, Accept");
        resp.addHeader("Accept-Encoding", "gzip, compress, br");

        // Determine content type based on the "accept" header
        String acceptHeader = req.getHeader("accept");
        if ("text/event-stream".equals(acceptHeader)) {
            resp.setContentType("text/event-stream");
            resp.addHeader("Connection", "keep-alive");
            resp.addHeader("Cache-Control", "no-cache");
        } else {
            resp.setContentType("application/json");
        }

        return resp;
    }

    public void ob_handle_descriptor_request(HttpServletRequest req, HttpServletResponse resp,
                                             data_configuration configuration) {
        String event_id = req.getParameter("event_id");
        String start = req.getParameter("start");
        String namespace = req.getParameter("namespace");
        logger.info("POST readDescriptor - id=" + event_id);

        try {
            event_descriptor descriptor = new event_descriptor(event_id, null, start, null,
                    null, namespace, null, null, null, null,
                    null, null, configuration);
            Object json = descriptor.read(event_id);
            PrintWriter respWriter = resp.getWriter();

            if ("text/event-stream".equals(req.getHeader("accept"))) {
                // Set content type for SSE
                resp.setContentType("text/event-stream;charset=UTF-8");
                respWriter.write("data:" + json + "\n\n");
                respWriter.write("retry: 1000000000\n\n");
            } else {
                // Assume JSON response by default
                resp.setContentType("application/json;charset=UTF-8");
                respWriter.write(json.toString());
            }

            respWriter.flush();

            if (respWriter.checkError()) {
                //logger.info("Client disconnected");
            }
        } catch (Exception e) {
            logger.severe(e.getMessage());
            // Consider a more specific handling strategy for different exception types
        }
    }

    public void ob_handle_addEvent_request(HttpServletRequest req, HttpServletResponse resp,
                                           data_configuration configuration) {
        try {
            Object json = null;
            HttpSession session = req.getSession();
            String connector_type = configuration.getType(0);
            logger.info("POST addEvent - " +
                    "startDate=" + configuration.getConfiguration().get("startDate") +
                    " - endDate=" + configuration.getConfiguration().get("endDate"));
            JSONArray eventJson = new JSONArray();
            eventJson.add("title:" + configuration.getConfiguration().get("title"));
            eventJson.add("startEvent:" + configuration.getConfiguration().get("startEvent"));
            eventJson.add("endEvent:" + configuration.getConfiguration().get("endEvent"));
            eventJson.add("description:" + configuration.getConfiguration().get("description"));
            eventJson.add("icon:" + configuration.getConfiguration().get("icon"));

            db_mongo_manager db_mongo_manager = null;
            json_files_manager json_files_manager = null;
            if (connector_type.equals("json_file")) {
                if (req.getHeader("accept").equals("text/event-stream"))
                    json_files_manager =
                            new json_files_manager(resp, session, configuration);
                else
                    json_files_manager =
                            new json_files_manager(null, null, configuration);
                json_files_manager.addEvents(eventJson,
                        (String) configuration.getConfiguration().get("scene"));
            }
            if (connector_type.equals("mongoDb")) {
                db_mongo_manager =
                        new db_mongo_manager(
                                (String) configuration.getConfiguration().get("startDate"),
                                (String) configuration.getConfiguration().get("endDate"),
                                (String) configuration.getConfiguration().get("search"),
                                (String) configuration.getConfiguration().get("filter"),
                                "GET", resp,
                                session,
                                configuration);
                db_mongo_manager.addEvents(eventJson,
                        (String) configuration.getConfiguration().get("scene"));
            }
            PrintWriter out = resp.getWriter();
            if (!req.getHeader("accept").equals("text/event-stream")) {
                json = ((json_files_manager) json_files_manager).getData(null,
                        (String) configuration.getConfiguration().get("scene"));
                if (json != null) {
                    out.write(json.toString());
                    out.flush();
                }
            }
        } catch (Exception e) {
            logger.severe(e.getMessage());
        }
    }

    public void ob_handle_filter_request(HttpServletRequest req, HttpServletResponse resp,
                                         data_configuration configuration) {
        try {
            String connector_type = configuration.getType(0);
            logger.info("POST " + configuration.getConfiguration().get("request") +
                    " - ob_filter_name=" + configuration.getConfiguration().get("filterName") +
                    " - ob_user=" + configuration.getConfiguration().get("userName"));
            Object json = null;
            if (connector_type.equals("json_file")) {
                json_files_manager json_files_manager;
                if (req.getHeader("accept").equals("text/event-stream"))
                    json_files_manager = new json_files_manager(
                            resp, req.getSession(), configuration);
                else
                    json_files_manager = new json_files_manager(
                            null, null, configuration);
                json = json_files_manager.updateFilter(
                        (String) configuration.getConfiguration().get("request"),
                        (String) configuration.getConfiguration().get("timelineName"),
                        (String) configuration.getConfiguration().get("title"),
                        (String) configuration.getConfiguration().get("scene"),
                        (String) configuration.getConfiguration().get("namespace"),
                        (String) configuration.getConfiguration().get("filterName"),
                        (String) configuration.getConfiguration().get("backgroundColor"),
                        (String) configuration.getConfiguration().get("userName"),
                        (String) configuration.getConfiguration().get("email"),
                        (String) configuration.getConfiguration().get("top"),
                        (String) configuration.getConfiguration().get("left"),
                        (String) configuration.getConfiguration().get("width"),
                        (String) configuration.getConfiguration().get("height"),
                        (String) configuration.getConfiguration().get("camera"),
                        (String) configuration.getConfiguration().get("sortBy"),
                        (String) configuration.getConfiguration().get("filter"));
            }
            if (connector_type.equals("mongoDb")) {
                db_mongo_manager db_mongo_manager;
                if (req.getHeader("accept").equals("text/event-stream"))
                    db_mongo_manager = new db_mongo_manager(
                            (String) configuration.getConfiguration().get("startDate"),
                            (String) configuration.getConfiguration().get("endDate"),
                            (String) configuration.getConfiguration().get("search"),
                            (String) configuration.getConfiguration().get("filter"),
                            "GET", resp, req.getSession(), configuration);
                else
                    db_mongo_manager = new db_mongo_manager(
                            (String) configuration.getConfiguration().get("startDate"),
                            (String) configuration.getConfiguration().get("endDate"),
                            (String) configuration.getConfiguration().get("search"),
                            (String) configuration.getConfiguration().get("filter"),
                            null, null, null, configuration);
                json = db_mongo_manager.updateFilter(
                        (String) configuration.getConfiguration().get("request"),
                        (String) configuration.getConfiguration().get("timelineName"),
                        (String) configuration.getConfiguration().get("title"),
                        (String) configuration.getConfiguration().get("scene"),
                        (String) configuration.getConfiguration().get("namespace"),
                        (String) configuration.getConfiguration().get("filterName"),
                        (String) configuration.getConfiguration().get("backgroundColor"),
                        (String) configuration.getConfiguration().get("userName"),
                        (String) configuration.getConfiguration().get("email"),
                        (String) configuration.getConfiguration().get("top"),
                        (String) configuration.getConfiguration().get("left"),
                        (String) configuration.getConfiguration().get("width"),
                        (String) configuration.getConfiguration().get("height"),
                        (String) configuration.getConfiguration().get("camera"),
                        (String) configuration.getConfiguration().get("sortBy"),
                        (String) configuration.getConfiguration().get("filter"));
            }
            PrintWriter out = resp.getWriter();
            if (req.getHeader("accept").equals("text/event-stream")) {
                out.write("data:" + json + "\n\n");
                out.write("retry: 1000000000\n\n");
                out.flush();
            } else {
                if (json != null)
                    out.write(json.toString());
                out.flush();
            }
        } catch (Exception e) {
            logger.severe(e.getMessage());
        }
    }

    public void ob_handle_autorization_request(HttpServletRequest req, HttpServletResponse resp,
                                               data_configuration configuration) {
        try {
        } catch (Exception e) {
            logger.severe(e.getMessage());
        }
    }

    public void ob_handle_sources_request(HttpServletRequest req, HttpServletResponse resp,
                                          data_configuration configuration) {
        try {
        } catch (Exception e) {
            logger.severe(e.getMessage());
        }
    }

    public void ob_handle_test_requests(HttpServletRequest req, HttpServletResponse resp) {
        try {
            PrintWriter out = resp.getWriter();
            String result = "";
            Enumeration<String> names = req.getHeaderNames();
            while (names.hasMoreElements()) {
                String name = names.nextElement();
                result += name + ":" + req.getHeader(name) + "; ";
            }
            logger.info(result);

            test_timeline tests = new test_timeline();
            String simpleJson = tests.getSimpleJsonData();
            out.write(simpleJson);
            out.flush();

        } catch (Exception e) {
            logger.severe(e.getMessage());
        }
    }

    public void ob_handle_default_request(HttpServletRequest req, HttpServletResponse resp, data_configuration configuration) {
        try {
            HttpSession session = req.getSession();
            SimpleDateFormat simpleDateFormat = new SimpleDateFormat();
            TimeZone.setDefault(TimeZone.getTimeZone("UTC"));

            String startDate = null, endDate = null;
            try {
                startDate = simpleDateFormat.format(new Date(req.getParameter("startDate")));
                endDate = simpleDateFormat.format(new Date(req.getParameter("endDate")));
            } catch (Exception e) {
                startDate = simpleDateFormat.format(new Date());
                endDate = simpleDateFormat.format(new Date(req.getParameter("endDate")));
            }

            Object json = null;
            String connector_type = configuration.getType(0);

            if (connector_type.equals("json_file")) {
                json_files_manager json_files_manager = new json_files_manager(resp, session, configuration);
                if (!req.getHeader("accept").equals("text/event-stream"))
                    json = json_files_manager.getData(json_files_manager.get_filter(),
                            (String) configuration.getConfiguration().get("scene"));
                ob_handle_flush(req, resp, configuration, json, json_files_manager);
            }

            if (connector_type.equals("mongoDb")) {
                db_mongo_manager db_mongo_manager =
                        new db_mongo_manager(startDate, endDate,
                                (String) configuration.getConfiguration().get("search"),
                                (String) configuration.getConfiguration().get("filter"),
                                "GET", resp, session, configuration);
                if (!req.getHeader("accept").equals("text/event-stream"))
                    json = db_mongo_manager.getData(db_mongo_manager.get_filter(),
                            (String) configuration.getConfiguration().get("scene"));
                ob_handle_flush(req, resp, configuration, json, db_mongo_manager);
            }
        } catch (Exception e) {
            // Handle or log the exception
        }
    }

    public void ob_handle_flush(HttpServletRequest req, HttpServletResponse resp, data_configuration configuration,
                                Object json, Object db_manager) {
        try {
            if (req.getHeader("accept").equals("text/event-stream")) {
                if (db_manager instanceof json_files_manager) {
                    json_files_watcher json_files_watcher =
                            new json_files_watcher((json_files_manager) db_manager,
                                    (String) configuration.getConfiguration().get("scene"));
                    json_files_watcher.run();
                }
                if (db_manager instanceof db_mongo_manager) {
                    db_mongo_watcher db_mongo_watcher =
                            new db_mongo_watcher((db_mongo_manager) db_manager,
                                    (String) configuration.getConfiguration().get("scene"));
                    db_mongo_watcher.run();
                }
            } else {
                resp.getWriter().write(json.toString());
                resp.getWriter().flush();
            }
        } catch (Exception e) {
        }
    }
}