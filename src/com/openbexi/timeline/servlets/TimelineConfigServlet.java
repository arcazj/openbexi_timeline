package com.openbexi.timeline.servlets;

import org.json.JSONObject;
import org.yaml.snakeyaml.*;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import javax.servlet.ServletException;
import javax.servlet.http.*;
import java.io.*;
import java.nio.file.*;
import java.util.Map;
import com.openbexi.timeline.api.TimelineHbds;
import com.openbexi.timeline.api.ApiException;

/** Public startup settings only; deployment YAML and source credentials stay on the server. */
public final class TimelineConfigServlet extends HttpServlet {
    private final String dataRoute;
    private String model;
    private TimelineHbds hbds;

    public TimelineConfigServlet() { this("/openbexi_timeline/sessions"); }
    public TimelineConfigServlet(String dataRoute) { this.dataRoute=dataRoute; }

    @Override public void init() throws ServletException {
        String configuration=getServletContext().getInitParameter("data_conf");
        if(configuration==null || configuration.isBlank())return;
        Path root=Path.of(getServletContext().getRealPath("/")).toAbsolutePath();
        Path selected=TimelineHbds.resolve(root,configuration);
        if(System.getProperty("openbexi.hbds.config",System.getenv("OPENBEXI_HBDS_CONFIG"))!=null)selected=TimelineHbds.selected(root,configuration);
        if(TimelineHbds.canonical(selected)) {
            try {hbds=TimelineHbds.open(root,selected);return;}
            catch(IOException|RuntimeException error){throw new ServletException("Cannot read the HBDS configuration.",error);}
        }
        try(Reader reader=Files.newBufferedReader(selected)) {
            Object document=new Yaml(new SafeConstructor(new LoaderOptions())).load(reader);
            Object value=document instanceof Map<?,?> mapping?mapping.get("model"):null;
            if(value!=null && !(value instanceof String))throw new IllegalArgumentException("YAML model must be a path string.");
            model=value==null?null:((String)value).trim();
            if(model!=null && model.isEmpty())model=null;
        } catch(IOException | RuntimeException error) {throw new ServletException("Cannot read the timeline model configuration.",error);}
    }

    @Override protected void doGet(HttpServletRequest request,HttpServletResponse response) throws IOException {
        response.setContentType("application/json");response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control","no-store");response.setHeader("X-Content-Type-Options","nosniff");
        JSONObject result=new JSONObject().put("model",model==null?JSONObject.NULL:model)
                .put("data",request.getContextPath()+dataRoute)
                .put("server",new JSONObject().put("implementation","Java").put("version","2.9.1"));
        if(hbds!=null) {
            try {result.put("hbds",hbds.publicConfiguration(request.getParameter("namespaceId")));}
            catch(ApiException error){response.setStatus(error.status);response.getWriter().write(new JSONObject().put("detail",error.getMessage()).toString());return;}
        }
        response.getWriter().write(result.toString());
    }
}
