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
        _data_configuration.setConfiguration(req);
        String ob_request = req.getParameter("ob_request");
        String ob_scene = req.getParameter("scene");
        String startDate = req.getParameter("startDate");
        String endDate = req.getParameter("endDate");
        String ob_filter_name = req.getParameter("filterName");
        String ob_user = req.getParameter("userName");
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

        // Start a json_files_watcher loop to check if any new events are coming.
        // If any the json_files_watcher will update the openBexi Timeline client again.
        if (_data_configuration.getType(0).equals("json_file")) {
            json_files_manager json_files_manager = new json_files_manager(resp,
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
