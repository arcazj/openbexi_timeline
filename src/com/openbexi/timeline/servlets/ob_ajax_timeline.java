package com.openbexi.timeline.servlets;

import com.openbexi.timeline.data_browser.data_configuration;
import com.openbexi.timeline.data_browser.db_mongo_manager;
import com.openbexi.timeline.data_browser.event_descriptor;
import com.openbexi.timeline.data_browser.json_files_manager;
import com.openbexi.timeline.tests.test_timeline;
import org.json.simple.JSONArray;
import org.json.simple.parser.ParseException;

import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.IOException;
import java.io.PrintWriter;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.logging.Logger;

@WebServlet("/openbexi_timeline/sessions")
public class
ob_ajax_timeline extends HttpServlet {

    int id = 0;
    private data_configuration _data_configuration;

    public ob_ajax_timeline() {
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
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        _data_configuration.setConfiguration(req);
        HttpSession session = req.getSession();
        resp.setCharacterEncoding("UTF-8");
        String ob_scene = req.getParameter("scene");
        String startDate = req.getParameter("startDate");
        String endDate = req.getParameter("endDate");
        String ob_filter = _data_configuration.getFilter(0);
        String ob_search = req.getParameter("search");
        if (ob_filter != null)
            ob_filter = ob_filter.replaceAll("_PIPE_", "|")
                    .replaceAll("_PARR_", "\\)")
                    .replaceAll("_PARL_", "\\(")
                    .replaceAll("_PERC_", "\\%")
                    .replaceAll("_PLUS_", "+");
        else
            ob_filter = "";

        // Common handler instantiation
        ob_handle_http_requests handler = new ob_handle_http_requests(req, resp, _data_configuration);

        // Assuming ob_handle_header should be called for any valid ob_request
        handler.ob_handle_header(req, resp);

        if (startDate == null || startDate.equals("test")) {
            handler.ob_handle_test_requests(req,resp);
        }else {
            PrintWriter out = resp.getWriter();
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

            Object json = null;
            String connector_type = _data_configuration.getType(0);
            if (connector_type.equals("json_file")) {
                json_files_manager data = new json_files_manager(null, session, _data_configuration);
                json = data.getData(data.get_filter(), ob_scene);
            }
            if (connector_type.equals("mongoDb")) {
                db_mongo_manager data = new db_mongo_manager(startDate, endDate, ob_search,
                        ob_filter, null, null, session, _data_configuration);
                json = data.getData(data.get_filter(), ob_scene);
            }
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
        // Read parameters
        _data_configuration.setConfiguration(req);
        String ob_request = req.getParameter("ob_request");
        Logger logger = Logger.getLogger("");

        // Common handler instantiation
        ob_handle_http_requests handler = new ob_handle_http_requests(req, resp, _data_configuration);

        // Assuming ob_handle_header should be called for any valid ob_request
        handler.ob_handle_header(req, resp);

        switch (ob_request) {
            case "readDescriptor":
                handler.ob_handle_descriptor_request(req, resp, _data_configuration);
                break;
            case "addEvent":
                handler.ob_handle_addEvent_request(req, resp, _data_configuration);
                break;
            case "updateFilter":
            case "readFilters":
            case "addFilter":
            case "deleteFilter":
            case "saveFilter":
                handler.ob_handle_filter_request(req, resp, _data_configuration);
                break;
            default:
                // Handle unknown or null ob_request
                if (ob_request != null) {
                    logger.warning("Unhandled request type: " + ob_request);
                }
                break;
        }

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
