package com.openbexi.timeline.server;

import com.openbexi.timeline.data_browser.data_sources;
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
import java.util.logging.FileHandler;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.logging.SimpleFormatter;

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
    private final String _data_conf;
    private final String _port;

    openbexi_timeline(ob_mode mode, String data_conf, String port) {
        _ob_mode = mode;
        _data_conf = data_conf;
        _port = port;
    }

    /**
     * Main method.
     *
     * @param args command line arguments passed to the application. Currently
     *             unused.
     */
    public static void main(String[] args) {
        String[] connectors = new String[0];
        String data_conf = "";

        if (args.length != 2) {
            System.err.println("openBEXI Timeline not started because of bad usage:");
            System.err.println("Argument " + args[0] + " " + "-data_conf <file> ");
            System.exit(1);
        }
        if (args[0].equals("-data_conf")) {
            data_conf = args[1];
            try {
                File file_configuration = new File(data_conf);
                if (!file_configuration.exists()) {
                    System.err.println("openBEXI Timeline not started because the configuration file does not exist:");
                    System.err.println("Argument " + args[0] + " " + "-data_conf <file does not exist> ");
                    System.exit(1);
                }
                data_sources source = new data_sources();
                System.out.println("reading "+file_configuration.getAbsolutePath());
                source.readYaml(file_configuration.getAbsolutePath());
                String jsonOutput = source.dataSourcesToJson();
                connectors = source.getConnectors(jsonOutput).split("\\|");
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
        System.out.println("Argument : " + args[0] + " " + args[1]);

        // use http://localhost:9010/ to get metrics
        // add VM options: -javaagent:lib/jmx_prometheus_javaagent-0.19.0.jar=9010:yaml/tomcat.yml
        // Include the JMX Exporter for Grafana
        System.setProperty("com.sun.management.jmxremote", "true");
        System.setProperty("com.sun.management.jmxremote.port", "9010"); // Choose an appropriate port
        System.setProperty("com.sun.management.jmxremote.authenticate", "false");
        System.setProperty("com.sun.management.jmxremote.ssl", "false");
        // Path to the JMX Exporter jar and its config file
        String jmxExporterJarPath = "lib/jmx_prometheus_javaagent-0.19.0.jar";
        String jmxConfigPath = "yaml/tomcat.yml";
        System.setProperty("javaagent", jmxExporterJarPath + "=" + jmxConfigPath);


        for (int i = 0; i < connectors.length; i++) {
            String port = connectors[i].split(":")[1];
            if (connectors[i].split(":")[0].equals("secure_ws")) {
                openbexi_timeline webServer_timeline_wss = new openbexi_timeline(ob_mode.secure_ws, data_conf, port);
                webServer_timeline_wss.run();
            }
            if (connectors[i].split(":")[0].equals("no_secure")) {
                openbexi_timeline webServer_timeline_no_secure = new openbexi_timeline(ob_mode.no_secure, data_conf, port);
                webServer_timeline_no_secure.run();
            }
            if (connectors[i].split(":")[0].equals("secure")) {
                openbexi_timeline webServer_timeline_secure = new openbexi_timeline(ob_mode.secure, data_conf, port);
                webServer_timeline_secure.run();
            }
            if (connectors[i].split(":")[0].equals("secure_sse")) {
                openbexi_timeline webServer_timeline_sse = new openbexi_timeline(ob_mode.secure_sse, data_conf, port);
                webServer_timeline_sse.run();
            }
        }
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
        FileHandler fileHandler = null;
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
        httpsConnector.setProperty("keyAlias", "test_rsa_private_key_entry");
        httpsConnector.setProperty("keystorePass", "keystores");
        httpsConnector.setProperty("keystoreFile", FileSystems.getDefault().getPath("tomcat", "resources", "keystore2.jks").toFile().getAbsolutePath());
        httpsConnector.setProperty("clientAuth", "false");
        httpsConnector.setProperty("sslProtocol", "TLS");
        httpsConnector.setProperty("SSLEnabled", "true");

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
            httpsConnector.setProperty("compression", "on");
            // Defaults are text/html,text/xml,text/plain,text/css
            httpsConnector.setProperty("compressableMimeType", "text/html,text/xml,text/plain,text/css,text/csv,application/json_files_manager");

            service.addConnector(httpsConnector);
            tomcat.setConnector(httpsConnector);

            ob_timeline_context = tomcat.addContext("/", new File(".").getAbsolutePath());

            Tomcat.addServlet(ob_timeline_context, "default", new DefaultServlet());
            ob_timeline_context.addServletMappingDecoded("/", "default");

            Tomcat.addServlet(ob_timeline_context, "ob_sse", new ob_sse_timeline());
            ob_timeline_context.addServletMappingDecoded("/openbexi_timeline_sse/sessions", "ob_sse");

        }
        if (_data_conf != null && ob_timeline_context != null)
            ob_timeline_context.addParameter("data_conf", _data_conf);

        // Add MIME type mapping for JavaScript files
        ob_timeline_context.addMimeMapping("js", "application/javascript");
        // Add MIME type mapping for JSON files
        ob_timeline_context.addMimeMapping("json", "application/json");
        // Add MIME type mapping for MJS files
        ob_timeline_context.addMimeMapping("mjs", "application/javascript");

        tomcat.start();

    }
}