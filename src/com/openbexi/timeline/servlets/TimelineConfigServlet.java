package com.openbexi.timeline.servlets;

import org.json.JSONObject;
import org.yaml.snakeyaml.*;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import javax.servlet.ServletException;
import javax.servlet.http.*;
import java.io.*;
import java.nio.file.*;
import java.util.Map;

/** Public startup settings only; deployment YAML and source credentials stay on the server. */
public final class TimelineConfigServlet extends HttpServlet {
    private final String dataRoute;
    private String model;

    public TimelineConfigServlet() { this("/openbexi_timeline/sessions"); }
    public TimelineConfigServlet(String dataRoute) { this.dataRoute=dataRoute; }

    @Override public void init() throws ServletException {
        String configuration=getServletContext().getInitParameter("data_conf");
        if(configuration==null || configuration.isBlank())return;
        try(Reader reader=Files.newBufferedReader(Path.of(configuration))) {
            Object document=new Yaml(new SafeConstructor(new LoaderOptions())).load(reader);
            Object value=document instanceof Map<?,?> root?root.get("model"):null;
            if(value!=null && !(value instanceof String))throw new IllegalArgumentException("YAML model must be a path string.");
            model=value==null?null:((String)value).trim();
            if(model!=null && model.isEmpty())model=null;
        } catch(IOException | RuntimeException error) {throw new ServletException("Cannot read the timeline model configuration.",error);}
    }

    @Override protected void doGet(HttpServletRequest request,HttpServletResponse response) throws IOException {
        response.setContentType("application/json");response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control","no-store");response.setHeader("X-Content-Type-Options","nosniff");
        response.getWriter().write(new JSONObject().put("model",model==null?JSONObject.NULL:model)
                .put("data",request.getContextPath()+dataRoute).toString());
    }
}
