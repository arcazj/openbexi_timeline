package com.openbexi.timeline.servlets;

import com.openbexi.timeline.data_browser.json_files_manager;
import com.openbexi.timeline.data_browser.json_files_watcher;
import com.openbexi.timeline.tests.test_timeline;

import javax.servlet.ServletContext;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.annotation.WebListener;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.*;
import java.io.IOException;
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
    public void doGet(HttpServletRequest req, HttpServletResponse resp)  {
        Logger logger = Logger.getLogger("");
        HttpSession session = req.getSession();
        resp.setCharacterEncoding("UTF-8");
        // Read parameters
        String startDate = req.getParameter("startDate");
        String endDate = req.getParameter("endDate");
        String ob_filter = req.getParameter("filter");
        String ob_search = req.getParameter("search");
        String data_path = getServletContext().getInitParameter("data_path");
        String filter_include = getServletContext().getInitParameter("filter_include");
        String filter_exclude = getServletContext().getInitParameter("filter_exclude");
        if (ob_filter != null && !ob_filter.equals("*"))
            filter_include = ob_filter;
        if (filter_include.equals(""))
            filter_include = getServletContext().getInitParameter("filter_include");

        logger.info("GET - startDate=" + startDate + " - endDate=" + endDate);

        if (startDate.equals("test")) {
            try {
                tests = new test_timeline("GET", resp, null, id++);
                tests.run();
            } catch (Exception e) {
                logger.severe(e.getMessage());
            }
        } else {
            TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
            SimpleDateFormat simpleDateFormat = new SimpleDateFormat();
            try {
                simpleDateFormat.format(new Date(startDate));
            } catch (Exception e) {
                startDate = simpleDateFormat.format(new Date());
            }
            try {
                simpleDateFormat.format(new Date(endDate));
            } catch (Exception e) {
                endDate = startDate;
            }

            json_files_manager json_files_manager = new json_files_manager(startDate, endDate, data_path, ob_search, filter_include, filter_exclude, "GET", resp,
                    session, getServletContext());

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
        Logger logger = Logger.getLogger("");
        logger.info("POST " + req);
        try {
            tests = new test_timeline("POST", resp, null, id++);
            tests.run();
        } catch (Exception e) {
            logger.severe(e.getMessage());
        }
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
