package com.openbexi.timeline.server;

import com.openbexi.timeline.servlets.ob_ajax_timeline;
import com.openbexi.timeline.servlets.ob_sse_timeline;
import org.apache.catalina.Context;
import org.apache.catalina.LifecycleException;
import org.apache.catalina.Service;
import org.apache.catalina.connector.Connector;
import org.apache.catalina.servlets.DefaultServlet;
import org.apache.catalina.startup.Tomcat;
import org.apache.coyote.http2.Http2Protocol;

import java.io.File;
import java.io.IOException;
import java.nio.file.FileSystems;
import java.util.logging.*;

/**
 * Embedded Apache Tomcat- http/2 for OpenBEXI Timeline
 *
 * @version 1.0.0
 */

enum ob_mode {
    no_secure, secure, secure_sse, no_secure_ws, secure_ws
}

public class openbexi_timeline implements Runnable {

    private final ob_mode _ob_mode;
    private final Logger _logger = Logger.getLogger("");
    private final String _data_path;
    private final String _filter_include;
    private final String _filter_exclude;
    private final String _port;

    openbexi_timeline(ob_mode mode, String data_path, String filter_include, String filter_exclude, String port) {
        _ob_mode = mode;
        _data_path = data_path;
        _filter_include = filter_include;
        _filter_exclude = filter_exclude;
        _port = port;
    }

    /**
     * Run tomcat server.
     *
     * @see Thread#run()
     */
    @Override
    public void run() {
        try {
            start(this._ob_mode);
        } catch (LifecycleException e) {
            _logger.severe(e.getMessage());
        }

    }

    private void start(ob_mode mode) throws LifecycleException {
        // Set log
        Handler fileHandler = null;
        try {
            fileHandler = new FileHandler("tomcat/catalina.out", true);
            fileHandler.setFormatter(new SimpleFormatter());
            fileHandler.setLevel(Level.FINEST);
            fileHandler.setEncoding("UTF-8");
        } catch (IOException e) {
            _logger.severe(e.getMessage());
        }
        _logger.addHandler(fileHandler);

        Tomcat tomcat = new Tomcat();
        Service service = tomcat.getService();

        Connector httpsConnector = new Connector();
        //  Connector httpsConnector = new Connector(Http11Nio2Protocol.class.getName());
        httpsConnector.setSecure(true);
        httpsConnector.setScheme("https");
        httpsConnector.setAttribute("keyAlias", "test_rsa_private_key_entry");
        httpsConnector.setAttribute("keystorePass", "keystores");
        httpsConnector.setAttribute("keystoreFile", FileSystems.getDefault().
                getPath("tomcat", "resources", "keystore2.jks").toFile().getAbsolutePath());
        httpsConnector.setAttribute("clientAuth", "false");
        httpsConnector.setAttribute("sslProtocol", "TLS");
        httpsConnector.setAttribute("SSLEnabled", true);

        Context ob_timeline_context = null;

        if (mode == ob_mode.no_secure) {
            tomcat.setPort(Integer.parseInt(_port));
            tomcat.getConnector();

            //Context ctx = tomcat.addContext("", null);
            ob_timeline_context = tomcat.addContext("/", new File(".").getAbsolutePath());

            Tomcat.addServlet(ob_timeline_context, "default", new DefaultServlet());
            ob_timeline_context.addServletMappingDecoded("/", "default");

            Tomcat.addServlet(ob_timeline_context, "ob", new ob_ajax_timeline());
            ob_timeline_context.addServletMappingDecoded("/openbexi_timeline/sessions", "ob");

        }
        if (mode == ob_mode.secure) {
            httpsConnector.setPort(Integer.parseInt(_port));
            tomcat.setBaseDir("tomcat");
            tomcat.setPort(Integer.parseInt(_port));

            service.addConnector(httpsConnector);
            tomcat.setConnector(httpsConnector);

            //Context ctx = tomcat.addContext("", null);
            ob_timeline_context = tomcat.addContext("/", new File(".").getAbsolutePath());

            Tomcat.addServlet(ob_timeline_context, "default", new DefaultServlet());
            ob_timeline_context.addServletMappingDecoded("/", "default");

            Tomcat.addServlet(ob_timeline_context, "ob", new ob_ajax_timeline());
            ob_timeline_context.addServletMappingDecoded("/openbexi_timeline/sessions", "ob");

        }
        if (mode == ob_mode.secure_ws) {
            httpsConnector.setPort(Integer.parseInt(_port));
            tomcat.setPort(Integer.parseInt(_port));
            service.addConnector(httpsConnector);
            tomcat.setConnector(httpsConnector);
            ob_timeline_context = tomcat.addWebapp("/", ".");
        }
        if (mode == ob_mode.secure_sse) {
            // Set Http2 connector
            httpsConnector.addUpgradeProtocol(new Http2Protocol());
            httpsConnector.setPort(Integer.parseInt(_port));
            tomcat.setPort(Integer.parseInt(_port));

            // Enable response compression
            httpsConnector.setAttribute("compression", "on");
            // Defaults are text/html,text/xml,text/plain,text/css
            httpsConnector.setAttribute("compressableMimeType", "text/html,text/xml,text/plain,text/css,text/csv,application/json_files_manager");

            service.addConnector(httpsConnector);
            tomcat.setConnector(httpsConnector);

            ob_timeline_context = tomcat.addContext("/", new File(".").getAbsolutePath());

            Tomcat.addServlet(ob_timeline_context, "default", new DefaultServlet());
            ob_timeline_context.addServletMappingDecoded("/", "default");

            Tomcat.addServlet(ob_timeline_context, "ob_sse", new ob_sse_timeline());
            ob_timeline_context.addServletMappingDecoded("/openbexi_timeline_sse/sessions", "ob_sse");

        }
        if (_data_path != null && ob_timeline_context != null)
            ob_timeline_context.addParameter("data_path", _data_path);
        if (_filter_exclude != null && ob_timeline_context != null)
            ob_timeline_context.addParameter("filter_exclude", _filter_exclude);
        if (_filter_include != null && ob_timeline_context != null)
            ob_timeline_context.addParameter("filter_include", _filter_include);

        tomcat.start();

    }

    /**
     * Main method.
     *
     * @param args command line arguments passed to the application. Currently
     *             unused.
     */
    public static void main(String[] args) {
        String connector = "";
        String[] connectors = new String[0];
        String data_path = "";
        String filter_include = "";
        String filter_exclude = "";
        String current_args = "";

        if (args.length == 1 || args.length == 3 || args.length == 5 || args.length > 8) {
            System.err.println("openBEXI Timeline not started because of bad usage:");
            System.err.println("Argument " + args[0] + " " + "-data_path <path> -connector <secure_ws:port|no_secure:8080|secure:port|secure_sse:port>");
            System.err.println("Argument " + args[0] + " " + "-data_path <path> -connector <secure_ws:port|no_secure:8080|secure:port|secure_sse:port> -filter_exclude <regex> -filter_include <regex>");
            System.err.println("Argument " + args[0] + " " + "-data_path <path> -connector <secure_ws:port|no_secure:8080|secure:port|secure_sse:port> -filter_include <regex> -filter_exclude <regex>");
            System.exit(1);
        }
        for (int i = 0; i < args.length; i++) {
            if (args[i].equals("-data_path")) {
                data_path = args[i + 1];
                current_args += " " + args[i];
            } else if (args[i].equals("-filter_exclude")) {
                filter_exclude = args[i + 1];
                current_args += " " + args[i];
            } else if (args[i].equals("-filter_include")) {
                filter_include = args[i + 1];
            } else if (args[i].equals("-connector")) {
                current_args += " " + args[i];
                connectors = args[i + 1].split("\\|");
            } else
                current_args += " " + args[i];
        }
        System.out.println("Argument : " + current_args);


        for (int i = 0; i < connectors.length; i++) {
            String port = connectors[i].split(":")[1];
            if (connectors[i].split(":")[0].equals("secure_ws")) {
                openbexi_timeline webServer_timeline_wss = new openbexi_timeline(ob_mode.secure_ws, data_path, filter_include, filter_exclude, port);
                webServer_timeline_wss.run();
            }
            if (connectors[i].split(":")[0].equals("no_secure")) {
                openbexi_timeline webServer_timeline_no_secure = new openbexi_timeline(ob_mode.no_secure, data_path, filter_include, filter_exclude, port);
                webServer_timeline_no_secure.run();
            }
            if (connectors[i].split(":")[0].equals("secure")) {
                openbexi_timeline webServer_timeline_secure = new openbexi_timeline(ob_mode.secure, data_path, filter_include, filter_exclude, port);
                webServer_timeline_secure.run();
            }
            if (connectors[i].split(":")[0].equals("secure_sse")) {
                openbexi_timeline webServer_timeline_sse = new openbexi_timeline(ob_mode.secure_sse, data_path, filter_include, filter_exclude, port);
                webServer_timeline_sse.run();
            }
        }
    }
}