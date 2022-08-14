package com.openbexi.timeline.servlets;

import com.openbexi.timeline.data_browser.json_files_manager;
import com.openbexi.timeline.data_browser.json_files_watcher;
import com.openbexi.timeline.tests.test_timeline;
import org.json.simple.JSONArray;

import javax.servlet.ServletContext;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.annotation.WebListener;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.*;
import java.io.IOException;
import java.io.PrintWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.TimeZone;
import java.util.logging.Logger;


//@WebServlet("/openbexi_timeline_sse/sessions")
@WebServlet(asyncSupported = true)
@WebListener
public class ob_sse_timeline extends HttpServlet implements HttpSessionListener {

    public ob_sse_timeline() {
        super();
    }

    test_timeline tests = null;
    int id = 0;

    @Override
    public void init() throws ServletException {
        super.init();
    }

    @Override
    public void doGet(HttpServletRequest req, HttpServletResponse resp) {
        HttpSession session = req.getSession();
        resp.setCharacterEncoding("UTF-8");

        // Read parameters
        String ob_request = req.getParameter("ob_request");
        String startEvent = req.getParameter("startEvent");
        String endEvent = req.getParameter("endEvent");
        String description = req.getParameter("description");
        String icon = req.getParameter("icon");
        String startDate = req.getParameter("startDate");
        String endDate = req.getParameter("endDate");
        String data_path = getServletContext().getInitParameter("data_path");

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
            json_files_manager json_files_manager = new json_files_manager(startDate, endDate, data_path, ob_search,
                    ob_filter, "GET", resp,
                    session, getServletContext());

            if (ob_request != null && ob_request.equals("addEvent")) {
                logger.info("GET addEvent - startDate=" + startDate + " - endDate=" + endDate);
                JSONArray eventJson = new JSONArray();
                eventJson.add("title:" + ob_title);
                eventJson.add("startEvent:" + startEvent);
                eventJson.add("endEvent:" + endEvent);
                eventJson.add("description:" + description);
                eventJson.add("icon:" + icon);
                json_files_manager.addEvents(eventJson);
            }
            if (ob_request != null && (ob_request.equals("updateFilter") || ob_request.equals("readFilters") ||
                    ob_request.equals("addFilter") || ob_request.equals("deleteFilter") ||
                    ob_request.equals("saveFilter"))) {
                if (resp != null && json_files_manager != null) {
                    try {
                        logger.info("POST " + ob_request + " - ob_filter_name=" + ob_filter_name + " - ob_user=" + ob_user);
                        Object json = json_files_manager.updateFilter(ob_request, ob_timeline_name, ob_title, ob_filter_name,
                                ob_backgroundColor, ob_user, ob_email, ob_top, ob_left, ob_width, ob_height,
                                ob_camera, ob_sort_by, ob_filter);

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

            // Start a json_files_watcher loop to check if any new events are coming.
            // If any the json_files_watcher will update the openBexi Timeline client again.
            json_files_watcher json_files_watcher = new json_files_watcher(json_files_manager);
            json_files_watcher.run();
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
