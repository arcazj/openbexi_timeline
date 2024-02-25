package com.openbexi.timeline.servlets;

import com.openbexi.timeline.data_browser.*;
import com.openbexi.timeline.tests.test_timeline;
import org.json.simple.JSONArray;
import org.json.simple.parser.ParseException;

import javax.servlet.ServletContext;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.annotation.WebListener;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.*;
import java.io.IOException;
import java.io.PrintWriter;
import java.util.logging.Logger;

@WebServlet(asyncSupported = true)
@WebListener
public class ob_sse_timeline extends HttpServlet implements HttpSessionListener {

    test_timeline tests = null;
    int id = 0;
    private data_configuration _data_configuration;

    public ob_sse_timeline() {
        super();
    }

    @Override
    public void init() throws ServletException {
        super.init();
        String data_conf = getServletContext().getInitParameter("data_conf");
        try {
            _data_configuration = new data_configuration(data_conf);
        } catch (IOException e) {
            throw new RuntimeException(e);
        } catch (ParseException e) {
            throw new RuntimeException(e);
        }
    }

    @Override
    public void doGet(HttpServletRequest req, HttpServletResponse resp) {
        HttpSession session = req.getSession();
        resp.setCharacterEncoding("UTF-8");

        // Read parameters
        String ob_request = req.getParameter("ob_request");
        String ob_scene = req.getParameter("scene");
        String startEvent = req.getParameter("startEvent");
        String endEvent = req.getParameter("endEvent");
        String description = req.getParameter("description");
        String icon = req.getParameter("icon");
        String startDate = req.getParameter("startDate");
        String endDate = req.getParameter("endDate");
        String data_path = _data_configuration.getDataPath(0);

        String ob_filter_name = req.getParameter("filterName");
        String ob_timeline_name = req.getParameter("timelineName");
        String ob_title = req.getParameter("title");
        String ob_top = req.getParameter("top");
        String ob_left = req.getParameter("left");
        String ob_width = req.getParameter("width");
        String ob_height = req.getParameter("height");
        String ob_camera = req.getParameter("camera");
        String ob_sort_by = req.getParameter("sortBy");
        String ob_user = req.getParameter("userName");
        String ob_backgroundColor = req.getParameter("backgroundColor");
        if (ob_backgroundColor != null)
            ob_backgroundColor = ob_backgroundColor.replace("@", "#");
        String ob_email = req.getParameter("email");
        String ob_filter = req.getParameter("filter");
        if (ob_filter != null)
            ob_filter = ob_filter.replaceAll("_PIPE_", "|")
                    .replaceAll("_PARR_", ")")
                    .replaceAll("_PARL_", "(")
                    .replaceAll("_PERC_", "%")
                    .replaceAll("_PLUS_", "+");
        String ob_search = req.getParameter("search");
        String connector_type = _data_configuration.getType(0);

        Logger logger = Logger.getLogger("");
        logger.info("GET - startDate=" + startDate + " - endDate=" + endDate);

        logger.info("GET - startDate=" + startDate + " - endDate=" + endDate);

        if (startDate != null && startDate.equals("test")) {
            try {
                tests = new test_timeline("GET", resp, null, id++);
                tests.run();
            } catch (Exception e) {
                logger.severe(e.getMessage());
            }
        } else {

            // Add event in timeline
            if (ob_request != null && ob_request.equals("addEvent")) {
                logger.info("GET addEvent - startDate=" + startDate + " - endDate=" + endDate);
                JSONArray eventJson = new JSONArray();
                eventJson.add("title:" + ob_title);
                eventJson.add("startEvent:" + startEvent);
                eventJson.add("endEvent:" + endEvent);
                eventJson.add("description:" + description);
                eventJson.add("icon:" + icon);
                if (_data_configuration.getType(0).equals("json_file")) {
                    json_files_manager json_files_manager = new json_files_manager(startDate, endDate, ob_search,
                            ob_filter, "GET", resp,
                            session, _data_configuration);
                    json_files_manager.addEvents(eventJson, ob_scene);
                }
                if (_data_configuration.getType(0).equals("mongoDb")) {
                    db_mongo_manager db_mongo_manager = new db_mongo_manager(startDate, endDate, ob_search,
                            ob_filter, "GET", resp,
                            session, _data_configuration);
                    db_mongo_manager.addEvents(eventJson, ob_scene);
                }
            }

            // Read descriptor for a given event or sesson/activity.
            if (ob_request != null && ob_request.equals("readDescriptor")) {
                String event_id = req.getParameter("event_id");
                String start = req.getParameter("start");
                logger.info("POST readDescriptor - id=" + event_id);
                if (resp != null) {
                    try {
                        event_descriptor descriptor = new event_descriptor(event_id, null, start, null, null, null, null,
                                null, null, null, null, _data_configuration.getConfiguration(0));
                        Object json = descriptor.read(event_id);

                        PrintWriter respWriter = resp.getWriter();
                        //Important to put a "," not ";" between stream and charset
                        resp.setContentType("text/event-stream");
                        resp.setCharacterEncoding("UTF-8");
                        //Important, otherwise only  test URL  like https://localhost:8443/openbexi_timeline.html works
                        resp.addHeader("Access-Control-Allow-Origin", "*");
                        // If clients have set Access-Control-Allow-Credentials to true, the server will not permit the use of
                        // credentials and access to resource by the client will be blocked by CORS policy.
                        resp.addHeader("Access-Control-Allow-Credentials", "true");
                        resp.addHeader("Cache-Control", "no-cache");
                        resp.addHeader("Connection", "keep-alive");
                        respWriter.write("data:" + json + "\n\n");
                        respWriter.write("retry: 1000000000\n\n");
                        respWriter.flush();
                        boolean error = respWriter.checkError();
                        if (error == true) {
                            logger.info("Client disconnected");
                        }
                    } catch (IOException e) {
                        logger.severe(e.getMessage());
                    }
                    return;
                }
            }

            if (ob_request != null && (ob_request.equals("updateFilter") || ob_request.equals("readFilters") ||
                    ob_request.equals("addFilter") || ob_request.equals("deleteFilter") ||
                    ob_request.equals("saveFilter"))) {
                if (resp != null) {
                    try {
                        logger.info("POST " + ob_request + " - ob_filter_name=" + ob_filter_name + " - ob_user=" + ob_user);
                        Object json = null;
                        if (_data_configuration.getType(0).equals("json_file")) {
                            json_files_manager json_files_manager = new json_files_manager(startDate, endDate, ob_search,
                                    ob_filter, "GET", resp,
                                    session, _data_configuration);
                            json = json_files_manager.updateFilter(ob_request, ob_timeline_name, ob_scene, ob_title,
                                    ob_filter_name, ob_backgroundColor, ob_user, ob_email, ob_top, ob_left, ob_width,
                                    ob_height, ob_camera, ob_sort_by, ob_filter);
                        }
                        if (_data_configuration.getType(0).equals("mongoDb")) {
                            db_mongo_manager db_mongo_manager = new db_mongo_manager(startDate, endDate, ob_search,
                                    ob_filter, "GET", resp,
                                    session, _data_configuration);
                            json = db_mongo_manager.updateFilter(ob_request, ob_timeline_name, ob_scene, ob_title,
                                    ob_filter_name, ob_backgroundColor, ob_user, ob_email, ob_top, ob_left, ob_width,
                                    ob_height, ob_camera, ob_sort_by, ob_filter);
                        }

                        PrintWriter respWriter = resp.getWriter();
                        //Important to put a "," not ";" between stream and charset
                        resp.setContentType("text/event-stream");
                        resp.setCharacterEncoding("UTF-8");
                        //Important, otherwise only  test URL  like https://localhost:8443/openbexi_timeline.html works
                        resp.addHeader("Access-Control-Allow-Origin", "*");
                        // If clients have set Access-Control-Allow-Credentials to true, the server will not permit the use of
                        // credentials and access to resource by the client will be blocked by CORS policy.
                        resp.addHeader("Access-Control-Allow-Credentials", "true");
                        resp.addHeader("Cache-Control", "no-cache");
                        resp.addHeader("Connection", "keep-alive");
                        respWriter.write("data:" + json + "\n\n");
                        respWriter.write("retry: 1000000000\n\n");
                        respWriter.flush();
                        boolean error = respWriter.checkError();
                        if (error) {
                            logger.info("Client disconnected");
                        }
                    } catch (IOException e) {
                        logger.severe(e.getMessage());
                    }
                    return;
                }
            }

            // Start a json_files_watcher loop to check if any new events are coming.
            // If any the json_files_watcher will update the openBexi Timeline client again.
            if (_data_configuration.getType(0).equals("json_file")) {
                json_files_manager json_files_manager = new json_files_manager(startDate, endDate, ob_search,
                        ob_filter, "GET", resp,
                        session, _data_configuration);
                json_files_watcher json_files_watcher = new json_files_watcher(json_files_manager, ob_scene);
                json_files_watcher.run();
            }
            if (_data_configuration.getType(0).equals("mongoDb")) {
                db_mongo_manager db_mongo_manager = new db_mongo_manager(startDate, endDate, ob_search,
                        ob_filter, "GET", resp,
                        session, _data_configuration);
                db_mongo_watcher db_mongo_watcher = new db_mongo_watcher(db_mongo_manager, ob_scene);
                db_mongo_watcher.run();
            }
        }
    }


    @Override
    protected long getLastModified(HttpServletRequest req) {
        return super.getLastModified(req);
    }

    @Override
    protected void doHead(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        super.doHead(req, resp);
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
    }

    @Override
    protected void doPut(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
    }

    @Override
    protected void doDelete(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
    }

    @Override
    protected void doOptions(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        super.doOptions(req, resp);
    }

    @Override
    protected void doTrace(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        super.doTrace(req, resp);
    }

    @Override
    public void destroy() {
        super.destroy();
    }

    @Override
    public ServletContext getServletContext() {
        return super.getServletContext();
    }

    @Override
    protected void service(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        super.service(req, resp);
    }

    @Override
    public void service(ServletRequest req, ServletResponse res) throws ServletException, IOException {
        super.service(req, res);
    }


    @Override
    public void sessionCreated(HttpSessionEvent se) {
        System.out.println("Session created : " + se.getSession());
    }

    @Override
    public void sessionDestroyed(HttpSessionEvent se) {
        System.out.println("Session destroy : " + se.getSession());
    }

}
