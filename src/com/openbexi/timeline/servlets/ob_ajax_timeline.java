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
import java.io.IOException;
import java.io.PrintWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Enumeration;
import java.util.TimeZone;
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

        // Read parameters
        String ob_user = req.getParameter("userName");
        String ob_scene = req.getParameter("scene");
        String ob_timeline_name = req.getParameter("timelineName");
        String startDate = req.getParameter("startDate");
        String endDate = req.getParameter("endDate");
        String ob_filter = _data_configuration.getFilter(0);
        if (ob_filter != null)
            ob_filter = ob_filter.replaceAll("_PIPE_", "|")
                    .replaceAll("_PARR_", "\\)")
                    .replaceAll("_PARL_", "\\(")
                    .replaceAll("_PERC_", "\\%")
                    .replaceAll("_PLUS_", "+");
        else
            ob_filter = "";
        String filter_include = _data_configuration.getFilterInclude(0);
        String filter_exclude = _data_configuration.getFilterExclude(0);
        String ob_search = req.getParameter("search");

        Logger logger = Logger.getLogger("");

        PrintWriter out = resp.getWriter();
        resp.setContentType("application/json");
        resp.setCharacterEncoding("UTF-8");
        resp.addHeader("Access-Control-Allow-Origin", "*");
        resp.addHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, HEAD");
        resp.addHeader("Access-Control-Allow-Headers", "X-PINGOTHER, Origin, X-Requested-With, Content-Type, Accept");
        resp.addHeader("Accept-Encoding", "gzip, compress, br");
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

            Object json = null;
            String connector_type = _data_configuration.getType(0);
            if (connector_type.equals("json file")) {
                json_files_manager data = new json_files_manager(startDate, endDate, ob_search,
                        ob_filter, null, null, null, _data_configuration);
                json = data.getData(data.get_filter(), ob_scene);
            }
            if (connector_type.equals("mongoDb")) {
                db_mongo_manager data = new db_mongo_manager(startDate, endDate, ob_search,
                        ob_filter, null, null, null, _data_configuration);
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
        String ob_request = req.getParameter("ob_request");
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
        String ob_scene = req.getParameter("scene");
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

        PrintWriter out = resp.getWriter();
        resp.setContentType("application/json");
        resp.setCharacterEncoding("UTF-8");
        resp.addHeader("Access-Control-Allow-Origin", "*");
        resp.addHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, HEAD");
        resp.addHeader("Access-Control-Allow-Headers", "X-PINGOTHER, Origin, X-Requested-With, Content-Type, Accept");
        resp.addHeader("Accept-Encoding", "gzip, compress, br");

        // Read descriptor for a given event or sesson/activity.
        if (ob_request != null && ob_request.equals("readDescriptor")) {
            String event_id = req.getParameter("event_id");
            String start = req.getParameter("start");
            logger.info("POST readDescriptor - id=" + event_id);
            event_descriptor descriptor =
                    new event_descriptor(event_id, null, start, null, null, null, null,
                            null, null, null, null, _data_configuration);
            Object json = descriptor.read(event_id);
            out.write(json.toString());
            out.flush();
        }

        // Add event in timeline
        if (ob_request != null && ob_request.equals("addEvent")) {
            logger.info("POST addEvent - startDate=" + startDate + " - endDate=" + endDate);
            Object json = null;
            JSONArray eventJson = new JSONArray();
            eventJson.add("title:" + ob_title);
            eventJson.add("startEvent:" + startEvent);
            eventJson.add("endEvent:" + endEvent);
            eventJson.add("description:" + description);
            eventJson.add("icon:" + icon);
            if (connector_type.equals("json file")) {
                json_files_manager data = new json_files_manager(startDate, endDate, ob_search,
                        ob_filter, null, null, null, _data_configuration);
                data.addEvents(eventJson, ob_scene);
                json = ((json_files_manager) data).getData(null, ob_scene);
            }
            if (connector_type.equals("mongoDb")) {
                db_mongo_manager data = new db_mongo_manager(startDate, endDate, ob_search,
                        ob_filter, null, null, null, _data_configuration);
                data.addEvents(eventJson, ob_scene);
                json = data.getData(null, ob_scene);
            }
            out.write(json.toString());
            out.flush();
        }

        // update filter in timeline
        if (ob_request != null && (ob_request.equals("updateFilter") || ob_request.equals("readFilters") ||
                ob_request.equals("addFilter") || ob_request.equals("deleteFilter") ||
                ob_request.equals("saveFilter"))) {
            logger.info("POST " + ob_request + " - ob_filter_name=" + ob_filter_name + " - ob_user=" + ob_user);
            Object json = null;
            if (connector_type.equals("json file")) {
                json_files_manager data = new json_files_manager(startDate, endDate, ob_search,
                        ob_filter, null, null, null, _data_configuration);
                json = data.updateFilter(ob_request, ob_timeline_name, ob_scene, ob_title, ob_filter_name,
                        ob_backgroundColor, ob_user, ob_email, ob_top, ob_left, ob_width, ob_height,
                        ob_camera, ob_sort_by, ob_filter);
            }
            if (connector_type.equals("mongoDb")) {
                db_mongo_manager data = new db_mongo_manager(startDate, endDate, ob_search,
                        ob_filter, null, null, null, _data_configuration);
                json = data.updateFilter(ob_request, ob_timeline_name, ob_scene, ob_title, ob_filter_name,
                        ob_backgroundColor, ob_user, ob_email, ob_top, ob_left, ob_width, ob_height,
                        ob_camera, ob_sort_by, ob_filter);
            }
            if (json != null) out.write(json.toString());
            out.flush();
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