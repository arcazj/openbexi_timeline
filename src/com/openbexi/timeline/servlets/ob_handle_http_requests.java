package com.openbexi.timeline.servlets;

import com.openbexi.timeline.data_browser.*;
import com.openbexi.timeline.tests.test_timeline;
import org.json.simple.JSONObject;

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
        configuration.getConfiguration().put("userName", req.getParameter("userName"));
        configuration.getConfiguration().put("timelineName", req.getParameter("timelineName"));
        configuration.getConfiguration().put("scene", req.getParameter("scene"));
        configuration.getConfiguration().put("timelineName", req.getParameter("timelineName"));
        configuration.getConfiguration().put("startDate", req.getParameter("startDate"));
        configuration.getConfiguration().put("endDate", req.getParameter("endDate"));
        configuration.getConfiguration().put("timelineName", req.getParameter("timelineName"));
        configuration.getConfiguration().put("search", req.getParameter("search"));
        String ob_filter = configuration.getFilter(0);
        if (ob_filter != null)
            ob_filter = ob_filter.replaceAll("_PIPE_", "|")
                    .replaceAll("_PARR_", "\\)")
                    .replaceAll("_PARL_", "\\(")
                    .replaceAll("_PERC_", "\\%")
                    .replaceAll("_PLUS_", "+");
        else
            ob_filter = "";
        configuration.getConfiguration().put("filter", ob_filter);
        configuration.getConfiguration().put("timelineName", req.getParameter("timelineName"));
        configuration.getConfiguration().put("startEvent", req.getParameter("startEvent"));
        configuration.getConfiguration().put("endEvent", req.getParameter("endEvent"));
        configuration.getConfiguration().put("description", req.getParameter("description"));
        configuration.getConfiguration().put("icon", req.getParameter("icon"));
        configuration.getConfiguration().put("filterName", req.getParameter("filterName"));
        configuration.getConfiguration().put("title", req.getParameter("title"));
        configuration.getConfiguration().put("top", req.getParameter("top"));
        configuration.getConfiguration().put("left", req.getParameter("left"));
        configuration.getConfiguration().put("width", req.getParameter("width"));
        configuration.getConfiguration().put("height", req.getParameter("height"));
        configuration.getConfiguration().put("camera", req.getParameter("camera"));
        configuration.getConfiguration().put("sortBy", req.getParameter("sortBy"));
        configuration.getConfiguration().put("userName", req.getParameter("userName"));
        String ob_backgroundColor = req.getParameter("backgroundColor");
        if (ob_backgroundColor != null)
            ob_backgroundColor = ob_backgroundColor.replace("@", "#");
        configuration.getConfiguration().put("backgroundColor", ob_backgroundColor);
        configuration.getConfiguration().put("email", req.getParameter("email"));
        configuration.getConfiguration().put("Accept", req.getHeader("Accept"));
        configuration.getConfiguration().put("method", req.getMethod());

        ob_handle_header(resp, configuration);
        ob_handle_request(req, resp, configuration);
    }

    public void ob_handle_header(HttpServletResponse resp, data_configuration configuration) {
        if (configuration.getConfiguration().get("accept").equals("text/event-stream")) {
            resp.setContentType("text/event-stream");
            resp.addHeader("Connection", "keep-alive");
            resp.addHeader("Cache-Control", "no-cache");
        } else
            resp.setContentType("application/json");

        resp.setCharacterEncoding("UTF-8");
        resp.addHeader("Access-Control-Allow-Origin", "*");
        resp.addHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, HEAD");
        resp.addHeader("Access-Control-Allow-Headers", "X-PINGOTHER, Origin, X-Requested-With, Content-Type, Accept");
        resp.addHeader("Accept-Encoding", "gzip, compress, br");
    }

    public void ob_handle_request(HttpServletRequest req, HttpServletResponse resp,
                                  data_configuration configuration) {
        String ob_request = req.getParameter("ob_request");
        try {
            if (req.getParameter("startDate") == null || req.getParameter("startDate").equals("test"))
                ob_handle_test_requests(req, resp);
            else if (ob_request != null && ob_request.equals("readDescriptor"))
                ob_handle_descriptor_request(req, resp, configuration);
            else if (ob_request != null && ob_request.equals("addEvent"))
                ob_handle_addEvent_request(req, resp, configuration);
            if (ob_request != null && (ob_request.equals("updateFilter") || ob_request.equals("readFilters") ||
                    ob_request.equals("addFilter") || ob_request.equals("deleteFilter") ||
                    ob_request.equals("saveFilter")))
                ob_handle_filter_request(req, resp, configuration);
            else
                ob_handle_GET_request(req, resp, configuration);
        } catch (Exception e) {
        }
    }

    public void ob_handle_descriptor_request(HttpServletRequest req, HttpServletResponse resp,
                                             data_configuration configuration) {
        try {
        } catch (Exception e) {
            logger.severe(e.getMessage());
        }
    }

    public void ob_handle_addEvent_request(HttpServletRequest req, HttpServletResponse resp,
                                           data_configuration configuration) {
        try {
        } catch (Exception e) {
            logger.severe(e.getMessage());
        }
    }

    public void ob_handle_filter_request(HttpServletRequest req, HttpServletResponse resp,
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

    public void ob_handle_GET_request(HttpServletRequest req, HttpServletResponse resp, data_configuration configuration) {
        try {
            HttpSession session = req.getSession();
            PrintWriter out = resp.getWriter();
            SimpleDateFormat simpleDateFormat = new SimpleDateFormat();
            TimeZone.setDefault(TimeZone.getTimeZone("UTC"));

            String startDate = null, endDate = null;
            try {
                startDate = simpleDateFormat.format(new Date(req.getParameter("startDate")));
            } catch (Exception e) {
                startDate = simpleDateFormat.format(new Date());
            }
            try {
                endDate = simpleDateFormat.format(new Date(req.getParameter("endDate")));
            } catch (Exception e) {
                endDate = startDate;
            }

            Object json;
            String connector_type = configuration.getType(0);

            if (connector_type.equals("json_file")) {
                json_files_manager json_files_manager = new json_files_manager(startDate, endDate,
                        (String) configuration.getConfiguration().get("search"),
                        (String) configuration.getConfiguration().get("filter"),
                        "GET", resp,
                        session, configuration);
                json = json_files_manager.getData(json_files_manager.get_filter(),
                        (String) configuration.getConfiguration().get("scene"));
                ob_handle_flush(resp, configuration, json, json_files_manager);
            }

            if (connector_type.equals("mongoDb")) {
                db_mongo_manager db_mongo_manager =
                        new db_mongo_manager(startDate, endDate,
                                (String) configuration.getConfiguration().get("search"),
                                (String) configuration.getConfiguration().get("filter"),
                                "GET", resp, session, configuration);
                json = db_mongo_manager.getData(db_mongo_manager.get_filter(),
                        (String) configuration.getConfiguration().get("scene"));
                ob_handle_flush(resp, configuration, json, db_mongo_manager);
            }
        } catch (Exception e) {
            // Handle or log the exception
        }
    }

    public void ob_handle_flush(HttpServletResponse resp, data_configuration configuration,
                                Object json, Object db_manager) {
        try {
            if (configuration.getConfiguration().get("accept").equals("text/event-stream")) {
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