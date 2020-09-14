package com.openbexi.timeline.servlets;

import com.openbexi.timeline.browser.data;
import com.openbexi.timeline.tests.test_timeline;

import java.io.IOException;
import java.io.PrintWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Enumeration;
import java.util.TimeZone;
import java.util.logging.Logger;

import javax.servlet.ServletContext;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

@WebServlet("/openbexi_timeline/sessions")
public class
ob_ajax_timeline extends HttpServlet {

    public ob_ajax_timeline() {
        super();
    }

    int id = 0;

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // Read parameters
        String startDate = req.getParameter("startDate");
        String endDate = req.getParameter("endDate");
        String data_path = getServletContext().getInitParameter("data_path");
        String filter_include = getServletContext().getInitParameter("filter_include");
        String filter_exclude = getServletContext().getInitParameter("filter_exclude");
        String stack = getServletContext().getInitParameter("stack");

        Logger logger = Logger.getLogger("");

        PrintWriter out = resp.getWriter();
        resp.setContentType("application/json");
        resp.addHeader("Access-Control-Allow-Origin", "*");
        resp.addHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, HEAD");
        resp.addHeader("Access-Control-Allow-Headers", "X-PINGOTHER, Origin, X-Requested-With, Content-Type, Accept");
        resp.setCharacterEncoding("UTF-8");
        logger.info("GET - startDate=" + startDate + " - endDate=" + endDate);

        // If simple test requested
        if (startDate == null || startDate.equals("test")) {
            try {
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

            data data = new data(startDate, endDate, data_path, filter_include, filter_exclude, null, null, null, 0);
            Object json = data.getJson();
            out.write(json.toString());
            out.flush();
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

        PrintWriter out = resp.getWriter();
        resp.setContentType("application/json");
        resp.addHeader("Access-Control-Allow-Origin", "*");
        resp.addHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, HEAD");
        resp.addHeader("Access-Control-Allow-Headers", "X-PINGOTHER, Origin, X-Requested-With, Content-Type, Accept");

        resp.setCharacterEncoding("UTF-8");
        out.println("{'name': 'test', 'openbexi.timeline.data': 'dataGET'}");
        out.flush();
    }

    @Override
    protected void doPut(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        super.doPut(req, resp);
    }

    @Override
    protected void doDelete(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        super.doDelete(req, resp);
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
