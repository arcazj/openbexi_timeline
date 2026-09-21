package com.openbexi.timeline.api;

import org.apache.catalina.startup.Tomcat;
import org.apache.catalina.Context;
import java.nio.file.*;

/** Local development launcher; the production server mounts the same servlet. */
public final class ApiServer {
    public static void main(String[] args) throws Exception {
        int port = Integer.parseInt(System.getProperty("openbexi.api.port", "8781"));
        Path root = Paths.get(System.getProperty("openbexi.api.root", ".")).toRealPath();
        Tomcat server = new Tomcat(); server.setBaseDir(Files.createTempDirectory("openbexi-api-tomcat-").toString());
        server.setPort(port); server.getConnector().setProperty("address", "127.0.0.1");
        Context context = server.addContext("", root.toString());
        Tomcat.addServlet(context, "assets", new PublicAssetServlet()); context.addServletMappingDecoded("/", "assets");
        Tomcat.addServlet(context, "api", new TimelineApiServlet()).setLoadOnStartup(1); context.addServletMappingDecoded("/api/v1/*", "api");
        context.addMimeMapping("js", "text/javascript"); context.addMimeMapping("mjs", "text/javascript"); context.addMimeMapping("json", "application/json");
        Runtime.getRuntime().addShutdownHook(new Thread(() -> { try { server.stop(); server.destroy(); } catch (Exception ignored) {} }));
        server.start(); System.out.println("OpenBEXI API: http://localhost:" + port + "/api/v1/health"); server.getServer().await();
    }
}
