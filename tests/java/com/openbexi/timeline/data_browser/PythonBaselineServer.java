package com.openbexi.timeline.data_browser;

import com.openbexi.timeline.servlets.*;
import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import java.nio.file.*;

/** Isolated HTTP fixture used by the Python/Java contract and performance runner. */
public final class PythonBaselineServer {
    public static void main(String[] args) throws Exception {
        Path root=Path.of(args[0]).toAbsolutePath();
        Path webRoot=args.length>3?Path.of(args[3]).toAbsolutePath():root;
        Tomcat server=new Tomcat();server.setBaseDir(root.resolve("tomcat").toString());server.setPort(0);
        server.getConnector().setProperty("address","127.0.0.1");
        Context context=server.addContext("",webRoot.toString());context.addParameter("data_conf",args[1]);
        Tomcat.addServlet(context,"sessions",new ob_ajax_timeline());context.addServletMappingDecoded("/openbexi_timeline/sessions","sessions");
        Tomcat.addServlet(context,"sse",new ob_sse_timeline());context.addServletMappingDecoded("/openbexi_timeline_sse/sessions","sse");
        Tomcat.addServlet(context,"config",new TimelineConfigServlet());context.addServletMappingDecoded("/openbexi_timeline/config","config");
        if(args.length>3) {
            Tomcat.addServlet(context,"assets",new com.openbexi.timeline.api.PublicAssetServlet());context.addServletMappingDecoded("/","assets");
            Path data=Path.of(System.getenv().getOrDefault("OPENBEXI_API_DATA_DIR",root.resolve("api-data").toString()));
            Tomcat.addServlet(context,"api",new com.openbexi.timeline.api.TimelineApiServlet(webRoot,data,System.getenv("OPENBEXI_API_TOKEN"),
                    System.getenv("OPENBEXI_API_WRITE_TOKEN"),System.getenv("OPENBEXI_API_READ_TOKEN")));context.addServletMappingDecoded("/api/v1/*","api");
        }
        Runtime.getRuntime().addShutdownHook(new Thread(()->{try {server.stop();server.destroy();}catch(Exception ignored){}}));
        server.start();Files.writeString(Path.of(args[2]),Integer.toString(server.getConnector().getLocalPort()));
        server.getServer().await();
    }
}
