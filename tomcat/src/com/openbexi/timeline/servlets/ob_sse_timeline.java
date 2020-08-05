package com.openbexi.timeline.servlets;

import com.openbexi.timeline.browser.data;
import com.openbexi.timeline.tests.test_timeline;

import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.PrintWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.TimeZone;
import java.util.logging.Logger;


//@WebServlet("/openbexi_timeline_sse/sessions")
@WebServlet(asyncSupported = true)
public class ob_sse_timeline extends HttpServlet {

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
    public void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        Logger logger = Logger.getLogger("");

        // Read parameters
        String startDate = req.getParameter("startDate");
        String endDate = req.getParameter("endDate");
        String data_path = getServletContext().getInitParameter("data_path");
        String filter_include = getServletContext().getInitParameter("filter_include");
        String filter_exclude = getServletContext().getInitParameter("filter_exclude");
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

            data data = new data(startDate, endDate, data_path, filter_include, filter_exclude, "GET", resp, null, id++);
            PrintWriter respWriter = resp.getWriter();
            //Important to put a "," not ";" between stream and charset
            resp.setContentType("text/event-stream, charset=UTF-8");
            //Important, otherwise only  test URL  like https://localhost:8443/openbexi_timeline.html works
            resp.addHeader("Access-Control-Allow-Origin", "*");
            // If clients have set Access-Control-Allow-Credentials to true, the server will not permit the use of
            // credentials and access to resource by the client will be blocked by CORS policy.
            resp.addHeader("Access-Control-Allow-Credentials", "true");
            resp.addHeader("Cache-Control", "no-cache");
            resp.addHeader("Connection", "keep-alive");
            respWriter.write("event: ob_timeline\n\n");
            respWriter.write("data:" + data.getJson() + "\n\n");
            respWriter.write("retry: 1000000000\n\n");
            respWriter.flush();
            boolean error = respWriter.checkError();
            if (error == true) {
                logger.info("Client disconnected");
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
    protected void service(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        super.service(req, resp);
    }

    @Override
    public void service(ServletRequest req, ServletResponse res) throws ServletException, IOException {
        super.service(req, res);
    }

}
