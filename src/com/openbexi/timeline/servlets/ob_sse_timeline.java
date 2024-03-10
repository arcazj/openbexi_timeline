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
import java.util.HashSet;
import java.util.Set;
import java.util.logging.Logger;

@WebServlet(asyncSupported = true)
@WebListener
public class ob_sse_timeline extends HttpServlet implements HttpSessionListener {

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
        resp.setCharacterEncoding("UTF-8");
        // Read parameters
        _data_configuration.setConfiguration(req);
        String ob_request = req.getParameter("ob_request");
        String startDate = req.getParameter("startDate");
        String endDate = req.getParameter("endDate");

        Logger logger = Logger.getLogger("");
        logger.info("GET - startDate=" + startDate + " - endDate=" + endDate);

        // Common handler instantiation
        ob_handle_http_requests handler = new ob_handle_http_requests(req, resp, _data_configuration);

        // Assuming ob_handle_header should be called for any valid ob_request
        handler.ob_handle_header(req, resp);

        if (ob_request != null) {
            switch (ob_request) {
                case "addEvent":
                    handler.ob_handle_addEvent_request(req, resp, _data_configuration);
                    return;
                case "readDescriptor":
                    handler.ob_handle_descriptor_request(req, resp, _data_configuration);
                    return;
                case "updateFilter":
                case "readFilters":
                case "addFilter":
                case "deleteFilter":
                case "saveFilter":
                    handler.ob_handle_filter_request(req, resp, _data_configuration);
                    return;
                default:
                    break;
            }
        }

        handler.ob_handle_default_request(req, resp, _data_configuration);
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
