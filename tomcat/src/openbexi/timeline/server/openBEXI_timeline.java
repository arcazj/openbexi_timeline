package openbexi.timeline.server;

import openbexi.timeline.servlets.ob_ajax_timeline;
import org.apache.catalina.Context;
import org.apache.catalina.LifecycleException;
import org.apache.catalina.Service;
import org.apache.catalina.connector.Connector;
import org.apache.catalina.servlets.DefaultServlet;
import org.apache.catalina.startup.Tomcat;
import org.apache.coyote.http2.Http2Protocol;
import openbexi.timeline.servlets.ob_sse_timeline;

import javax.servlet.ServletException;
import java.io.File;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
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

public class openBEXI_timeline implements Runnable {

    private final openbexi.timeline.server.ob_mode _ob_mode;
    private final Logger _logger = Logger.getLogger("");
    private final String _data_path;

    openBEXI_timeline(openbexi.timeline.server.ob_mode mode, String data_path) {
        _ob_mode = mode;
        _data_path = data_path;
    }

    /**
     * Run tomcat server.
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

    private void start(openbexi.timeline.server.ob_mode mode) throws LifecycleException {
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

        Context ctx = null;

        if (mode == openbexi.timeline.server.ob_mode.no_secure) {
            tomcat.setPort(8080);
            tomcat.getConnector();

            //Context ctx = tomcat.addContext("", null);
            ctx = tomcat.addContext("/", new File(".").getAbsolutePath());

            Tomcat.addServlet(ctx, "default", new DefaultServlet());
            ctx.addServletMappingDecoded("/", "default");

            Tomcat.addServlet(ctx, "ob", new ob_ajax_timeline());
            ctx.addServletMappingDecoded("/openbexi_timeline/sessions", "ob");

        }
        if (mode == openbexi.timeline.server.ob_mode.secure) {
            httpsConnector.setPort(8445);
            tomcat.setBaseDir("tomcat");
            tomcat.setPort(8445);

            service.addConnector(httpsConnector);
            tomcat.setConnector(httpsConnector);

            //Context ctx = tomcat.addContext("", null);
            ctx = tomcat.addContext("/", new File(".").getAbsolutePath());

            Tomcat.addServlet(ctx, "default", new DefaultServlet());
            ctx.addServletMappingDecoded("/", "default");

            Tomcat.addServlet(ctx, "ob", new ob_ajax_timeline());
            ctx.addServletMappingDecoded("/openbexi_timeline/sessions", "ob");

        }
        if (mode == openbexi.timeline.server.ob_mode.secure_ws) {
            httpsConnector.setPort(8444);
            tomcat.setPort(8444);
            service.addConnector(httpsConnector);
            tomcat.setConnector(httpsConnector);
            ctx = tomcat.addWebapp("/", ".");
        }
        if (mode == openbexi.timeline.server.ob_mode.secure_sse) {
            // Set Http2 connector
            httpsConnector.addUpgradeProtocol(new Http2Protocol());
            httpsConnector.setPort(8443);
            tomcat.setPort(8443);

            // Enable response compression
            httpsConnector.setAttribute("compression", "on");
            // Defaults are text/html,text/xml,text/plain,text/css
            httpsConnector.setAttribute("compressableMimeType", "text/html,text/xml,text/plain,text/css,text/csv,application/json");

            service.addConnector(httpsConnector);
            tomcat.setConnector(httpsConnector);

            ctx = tomcat.addContext("/", new File(".").getAbsolutePath());

            Tomcat.addServlet(ctx, "default", new DefaultServlet());
            ctx.addServletMappingDecoded("/", "default");

            Tomcat.addServlet(ctx, "ob_sse", new ob_sse_timeline());
            ctx.addServletMappingDecoded("/openbexi_timeline_sse/sessions", "ob_sse");

        }
        if (_data_path != null && ctx != null)
            ctx.addParameter("data_path", _data_path);

        tomcat.start();
        tomcat.getServer().start();
    }

    /**
     * Main method.
     *
     * @param args command line arguments passed to the application. Currently
     *             unused.
     */
    public static void main(String[] args) {
        String data_path = null;
        if (args.length == 2) {
            try {
                data_path = args[1];
                System.out.println("Argument " + args[0] + " " + data_path);
            } catch (NumberFormatException e) {
                System.err.println(e.getMessage());
                System.exit(1);
            }
        }

        openBEXI_timeline webServer_timeline_no_secure = new openBEXI_timeline(openbexi.timeline.server.ob_mode.no_secure, data_path);
        webServer_timeline_no_secure.run();
        openBEXI_timeline webServer_timeline_secure = new openBEXI_timeline(openbexi.timeline.server.ob_mode.secure, data_path);
        webServer_timeline_secure.run();
        openBEXI_timeline webServer_timeline_wss = new openBEXI_timeline(openbexi.timeline.server.ob_mode.secure_ws, data_path);
        webServer_timeline_wss.run();
        openBEXI_timeline webServer_timeline_sse = new openBEXI_timeline(openbexi.timeline.server.ob_mode.secure_sse, data_path);
        webServer_timeline_sse.run();
    }
}