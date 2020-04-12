package server;

import org.apache.catalina.Context;
import org.apache.catalina.LifecycleException;
import org.apache.catalina.Service;
import org.apache.catalina.connector.Connector;
import org.apache.catalina.servlets.DefaultServlet;
import org.apache.catalina.startup.Tomcat;
import org.apache.coyote.http2.Http2Protocol;
import servlets.ob_sse_timeline;

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
    no_secure_sse, secure_sse, no_secure_ws, secure_ws
}

public class openBEXI_timeline implements Runnable {

    private server.ob_mode ob_mode;
    private Logger logger = Logger.getLogger("");

    openBEXI_timeline(server.ob_mode mode) {
        ob_mode = mode;
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
            start(this.ob_mode);
        } catch (LifecycleException e) {
            logger.severe(e.getMessage());
        } catch (InterruptedException e) {
            logger.severe(e.getMessage());
        } catch (ServletException e) {
            logger.severe(e.getMessage());
        }
    }

    private void start(server.ob_mode mode) throws LifecycleException, InterruptedException, ServletException {
        // Set log
        Handler fileHandler = null;
        try {
            fileHandler = new FileHandler("tomcat/catalina.out", true);
        } catch (IOException e) {
            logger.severe(e.getMessage());
        }
        fileHandler.setFormatter(new SimpleFormatter());
        fileHandler.setLevel(Level.FINEST);
        try {
            fileHandler.setEncoding("UTF-8");
        } catch (UnsupportedEncodingException e) {
            logger.severe(e.getMessage());
        }
        logger.addHandler(fileHandler);

        Tomcat tomcat = new Tomcat();
        if (mode == server.ob_mode.no_secure_sse) {
            tomcat.setPort(8080);
            tomcat.getConnector();
        }
        if (mode == server.ob_mode.secure_ws) {
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
            //tomcat.addWebapp("/", "C:/projects/openbexi_timeline-git/tomcat/webapps");
            tomcat.addWebapp("/", ".");
        }
        if (mode == server.ob_mode.secure_sse) {
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


            //Context ctx = tomcat.addContext("", null);
            Context ctx = tomcat.addContext("/", new File(".").getAbsolutePath());

            Tomcat.addServlet(ctx, "default", new DefaultServlet());
            ctx.addServletMappingDecoded("/", "default");

            Tomcat.addServlet(ctx, "OpenBEXITimeline", new ob_sse_timeline());
            ctx.addServletMappingDecoded("/OpenBEXI_Timeline", "OpenBEXITimeline");

            Tomcat.addServlet(ctx, "sse", new servlets.ob_sse.sse_timeline());
            ctx.addServletMappingDecoded("/ob_server_sent_events", "sse");

        }


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
        openBEXI_timeline webServer_timeline_wss = new openBEXI_timeline(server.ob_mode.secure_ws);
        webServer_timeline_wss.run();
        openBEXI_timeline webServer_timeline_sse = new openBEXI_timeline(server.ob_mode.secure_sse);
        webServer_timeline_sse.run();
    }
}