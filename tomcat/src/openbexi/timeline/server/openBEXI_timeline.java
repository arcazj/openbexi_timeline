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

    private openbexi.timeline.server.ob_mode _ob_mode;
    private Logger _logger = Logger.getLogger("");
    private String _data_path;

    openBEXI_timeline(openbexi.timeline.server.ob_mode mode, String data_path) {
        _ob_mode = mode;
        _data_path = data_path;
    }

    /**
     * When an object implementing interface <code>Runnable</code> is used
     * to create a thread, starting the thread causes the object's
     * <code>run</code> method to be called in that separately executing
     * thread.
     * <p>
     * The general contract of the method <code>run</code> is that it may
     * take any action whatsoever.
     *
     * @see Thread#run()
     */
    @Override
    public void run() {
        try {
            start(this._ob_mode);
        } catch (LifecycleException e) {
            _logger.severe(e.getMessage());
        } catch (InterruptedException e) {
            _logger.severe(e.getMessage());
        } catch (ServletException e) {
            _logger.severe(e.getMessage());
        }
    }

    private void start(openbexi.timeline.server.ob_mode mode) throws LifecycleException, InterruptedException, ServletException {
        // Set log
        Handler fileHandler = null;
        try {
            fileHandler = new FileHandler("tomcat/catalina.out", true);
        } catch (IOException e) {
            _logger.severe(e.getMessage());
        }
        fileHandler.setFormatter(new SimpleFormatter());
        fileHandler.setLevel(Level.FINEST);
        try {
            fileHandler.setEncoding("UTF-8");
        } catch (UnsupportedEncodingException e) {
            _logger.severe(e.getMessage());
        }
        _logger.addHandler(fileHandler);

        Tomcat tomcat = new Tomcat();
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
            Connector httpsConnector = new Connector();
            //  Connector httpsConnector = new Connector(Http11Nio2Protocol.class.getName());
            httpsConnector.setPort(8445);
            httpsConnector.setSecure(true);
            httpsConnector.setScheme("https");
            httpsConnector.setAttribute("keyAlias", "test_rsa_private_key_entry");
            httpsConnector.setAttribute("keystorePass", "keystores");
            httpsConnector.setAttribute("keystoreFile", FileSystems.getDefault().
                    getPath("tomcat", "resources", "keystore2.jks").toFile().getAbsolutePath());
            httpsConnector.setAttribute("clientAuth", "false");
            httpsConnector.setAttribute("sslProtocol", "TLS");
            httpsConnector.setAttribute("SSLEnabled", true);
            tomcat.setBaseDir("tomcat");
            tomcat.setPort(8445);

            Service service = tomcat.getService();
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
            Connector httpsConnector = new Connector();
            httpsConnector.setPort(8444);
            httpsConnector.setSecure(true);
            httpsConnector.setScheme("https");
            httpsConnector.setAttribute("keyAlias", "test_rsa_private_key_entry");
            httpsConnector.setAttribute("keystorePass", "keystores");
            httpsConnector.setAttribute("keystoreFile", FileSystems.getDefault().
                    getPath("tomcat", "resources", "keystore2.jks").toFile().getAbsolutePath());
            httpsConnector.setAttribute("clientAuth", "false");
            httpsConnector.setAttribute("sslProtocol", "TLS");
            httpsConnector.setAttribute("SSLEnabled", true);
            tomcat.setBaseDir("tomcat");
            tomcat.setPort(8444);
            Service service = tomcat.getService();
            service.addConnector(httpsConnector);
            tomcat.setConnector(httpsConnector);
            ctx =tomcat.addWebapp("/", ".");
        }
        if (mode == openbexi.timeline.server.ob_mode.secure_sse) {
            Connector httpsConnector = new Connector();
            // Set Http2 connector
            httpsConnector.addUpgradeProtocol(new Http2Protocol());
            //  Connector httpsConnector = new Connector(Http11Nio2Protocol.class.getName());
            httpsConnector.setPort(8443);
            httpsConnector.setSecure(true);
            httpsConnector.setScheme("https");
            httpsConnector.setAttribute("keyAlias", "test_rsa_private_key_entry");
            httpsConnector.setAttribute("keystorePass", "keystores");
            httpsConnector.setAttribute("keystoreFile", FileSystems.getDefault().
                    getPath("tomcat", "resources", "keystore2.jks").toFile().getAbsolutePath());
            httpsConnector.setAttribute("clientAuth", "false");
            httpsConnector.setAttribute("sslProtocol", "TLS");
            httpsConnector.setAttribute("SSLEnabled", true);
            tomcat.setBaseDir("tomcat");
            tomcat.setPort(8443);

            // Enable response compression
            httpsConnector.setAttribute("compression", "on");
            // Defaults are text/html,text/xml,text/plain,text/css
            httpsConnector.setAttribute("compressableMimeType", "text/html,text/xml,text/plain,text/css,text/csv,application/json");

            Service service = tomcat.getService();
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
     * @throws LifecycleException   If a life cycle exception occurs.
     * @throws InterruptedException If the application is interrupted while
     *                              waiting for requests.
     * @throws ServletException     If the servlet handling the response has an
     *                              exception.
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