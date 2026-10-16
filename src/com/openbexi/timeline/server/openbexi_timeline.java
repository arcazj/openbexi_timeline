package com.openbexi.timeline.server;

import com.openbexi.timeline.data_browser.data_sources;
import com.openbexi.timeline.servlets.ob_ajax_timeline;
import com.openbexi.timeline.servlets.ob_sse_timeline;
import com.openbexi.timeline.servlets.TimelineConfigServlet;
import com.openbexi.timeline.api.TimelineApiServlet;
import org.apache.catalina.Context;
import org.apache.catalina.LifecycleException;
import org.apache.catalina.Service;
import org.apache.catalina.connector.Connector;
import com.openbexi.timeline.api.PublicAssetServlet;
import com.openbexi.timeline.api.TimelineHbds;
import java.nio.file.Path;
import java.nio.file.Files;
import java.util.*;
import org.json.*;
import com.openbexi.timeline.api.NamespaceConfiguration;
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
    private static boolean logConfigured;
    private JSONObject listenerSettings;
    private Path documentRoot=Path.of("").toAbsolutePath();
    private Tomcat running;

    private static synchronized void configureLog(Logger logger) {
        if(logConfigured) return;
        try {
            FileHandler handler=new FileHandler("tomcat/catalina.out",true);
            handler.setFormatter(new SimpleFormatter());handler.setLevel(Level.FINEST);handler.setEncoding("UTF-8");
            logger.addHandler(handler);logConfigured=true;
        } catch(IOException error) { logger.warning("Cannot open timeline log file; console logging remains active."); }
    }

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
        boolean nativeFile=false;
        if(args.length==2&&Set.of("-data_conf","--data-conf").contains(args[0]))try{
            nativeFile=Files.isRegularFile(Path.of(args[1]))&&NamespaceConfiguration.yaml(Path.of(args[1])).has("namespace");
        }catch(IOException ignored){}
        if(nativeFile || Arrays.stream(args).anyMatch(arg->Set.of("-dataconf","-serverconf","--server-conf","--workspace","--hbds-root","--check","--root").contains(arg)) || args.length>2) {
            try {if(startConfigured(args))return;}
            catch(Exception error){throw new IllegalArgumentException("Cannot start namespace configuration: "+error.getMessage(),error);}
        }
        String[] connectors = new String[0];
        String data_conf = "";

        if (args.length != 2) {
            System.err.println("openBEXI Timeline not started because of bad usage:");
            System.err.println("Argument -data_conf <file> ");
            System.exit(1);
        }
        if (args[0].equals("-data_conf") || args[0].equals("-data_path")) {
            data_conf = args[1];
            try {
                data_conf=TimelineHbds.resolve(Path.of(""),data_conf).toString();
                if(System.getProperty("openbexi.hbds.config",System.getenv("OPENBEXI_HBDS_CONFIG"))!=null)data_conf=TimelineHbds.selected(Path.of(""),data_conf).toString();
                File file_configuration = new File(data_conf);
                if (!file_configuration.exists()) {
                    System.err.println("openBEXI Timeline not started because the configuration file does not exist:");
                    System.err.println("Argument " + args[0] + " " + "-data_conf <file does not exist> ");
                    System.exit(1);
                }
                data_sources source = new data_sources();
                System.out.println("reading " + file_configuration.getAbsolutePath());
                String jsonOutput;
                if(TimelineHbds.canonical(file_configuration.toPath()))jsonOutput=TimelineHbds.open(Path.of(""),file_configuration.toPath()).legacyConfiguration().toString();
                else {source.readYaml(file_configuration.getAbsolutePath());jsonOutput=source.dataSourcesToJson();}
                connectors = source.getConnectors(jsonOutput).split("\\|");
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
        System.out.println("Argument : " + args[0] + " " + args[1]);

        // Monitoring is opt-in through JVM launch options; no unauthenticated JMX port is opened here.


        for (String connector : connectors) {
            if(connector.isBlank())continue;
            String[] parts=connector.split(":",2);
            if(parts.length!=2)throw new IllegalArgumentException("Connector requires a protocol and port.");
            new openbexi_timeline(connectorMode(parts[0]),data_conf,parts[1]).run();
        }
    }
    private static boolean startConfigured(String[] args) throws Exception {
        List<Path> files=new ArrayList<>();Path service=null,metadata=null,root=null,selection=null;boolean check=false;
        for(int i=0;i<args.length;i++) {
            switch(args[i]) {
                case "-dataconf","-data_conf","--data-conf" -> {while(i+1<args.length&&!args[i+1].startsWith("-"))files.add(Path.of(args[++i]));}
                case "-serverconf","--server-conf" -> service=Path.of(args[++i]);
                case "--workspace" -> selection=Path.of(args[++i]).toAbsolutePath().normalize();
                case "--hbds-root" -> metadata=Path.of(args[++i]);
                case "--root" -> root=Path.of(args[++i]);
                case "--check" -> check=true;
                default -> throw new IllegalArgumentException("Unknown startup option");
            }
        }
        if(selection!=null) {
            if(!files.isEmpty())throw new IllegalArgumentException("Choose --workspace or -dataconf, not both");
            files.addAll(NamespaceConfiguration.workspaceFiles(selection));
            if(metadata==null)metadata=selection.getParent();
            if(service==null)service=NamespaceConfiguration.workspaceService(selection);
        }
        if(files.isEmpty())throw new IllegalArgumentException("Specify --workspace or -dataconf with namespace files");
        if(root==null)root=TimelineHbds.projectRoot(files.get(0));
        NamespaceConfiguration workspace=new NamespaceConfiguration(root,files,service,metadata,selection);
        Path selected=workspace.register();TimelineHbds.open(root,selected); // Validate all models before binding.
        Set<String> referenced=new HashSet<>();JSONObject projection=workspace.read();
        Set<String> enabled=new HashSet<>();for(Object item:projection.getJSONArray("sources"))if(((JSONObject)item).getJSONObject("configuration").optBoolean("enable",true))enabled.add(((JSONObject)item).getString("namespaceId"));
        for(Object item:projection.getJSONArray("namespaces")) {JSONObject ns=(JSONObject)item;if(enabled.contains(ns.getString("id")))for(Object id:ns.getJSONArray("connectorIds"))referenced.add(id.toString());}
        List<JSONObject> listeners=new ArrayList<>();for(Object item:workspace.service().optJSONArray("connectors",new JSONArray())) {JSONObject listener=(JSONObject)item;if(listener.getString("owner").equals("java")&&listener.optBoolean("enable",true)&&referenced.contains(listener.getString("id")))listeners.add(listener);}
        if(check){System.out.println("Namespace configuration valid");return true;}
        if(listeners.isEmpty())throw new IllegalArgumentException("No Java listener is referenced by an enabled namespace");
        List<openbexi_timeline> started=new ArrayList<>();
        try {
            for(JSONObject listener:listeners) {
                openbexi_timeline server=new openbexi_timeline(connectorMode(listener.getString("type")),selected.toString(),String.valueOf(listener.getInt("port")));
                server.listenerSettings=listener;server.documentRoot=root.toAbsolutePath().normalize();started.add(server);server.start(server._ob_mode);
            }
        } catch(Exception error){for(openbexi_timeline server:started)server.stop();throw error;}
        Runtime.getRuntime().addShutdownHook(new Thread(()->{for(openbexi_timeline server:started)server.stop();}));
        return true;
    }
    private void stop(){if(running!=null)try{running.stop();running.destroy();}catch(LifecycleException ignored){}}
    static ob_mode connectorMode(String protocol) {
        return switch(protocol) {
            case "http","no_secure" -> ob_mode.no_secure;
            case "https","secure" -> ob_mode.secure;
            case "wss","secure_ws" -> ob_mode.secure_ws;
            case "secure_sse" -> ob_mode.secure_sse;
            default -> throw new IllegalArgumentException("Unsupported Java connector protocol: "+protocol);
        };
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
        final WebUiAddress ui;
        try { ui=WebUiAddress.read(_data_conf,listenerSettings==null?"localhost":listenerSettings.getString("host")); }
        catch(IOException | RuntimeException error) { throw new LifecycleException("Cannot read web_ui configuration.",error); }
        configureLog(_logger);

        Tomcat tomcat = new Tomcat();
        running=tomcat;
        if(listenerSettings!=null)tomcat.setBaseDir(documentRoot.resolve(".local-private/tomcat-"+_port).toString());
        Service service = tomcat.getService();

        Connector httpsConnector = new Connector();
        //  Connector httpsConnector = new Connector(Http11Nio2Protocol.class.getName());
        httpsConnector.setSecure(true);
        httpsConnector.setScheme("https");
        httpsConnector.setProperty("clientAuth", "false");
        httpsConnector.setProperty("sslProtocol", "TLS");
        httpsConnector.setProperty("SSLEnabled", "true");
        if(listenerSettings!=null&&mode!=ob_mode.no_secure) {
            JSONObject tls=listenerSettings.getJSONObject("tls");String password=System.getenv(tls.getString("password_env"));
            if(password==null||!Files.isRegularFile(Path.of(tls.getString("keystore"))))throw new LifecycleException("TLS keystore or password environment variable is unavailable");
            httpsConnector.setProperty("keystoreFile",tls.getString("keystore"));httpsConnector.setProperty("keystorePass",password);
            httpsConnector.setProperty("keyAlias",tls.optString("key_alias",null));
            httpsConnector.setProperty("address",listenerSettings.getString("host"));
        } else if(mode!=ob_mode.no_secure) {
            String keystore=System.getenv("TIMELINE_KEYSTORE"),password=System.getenv("TIMELINE_KEYSTORE_PASSWORD");
            if(keystore==null||password==null||!Files.isRegularFile(Path.of(keystore)))throw new LifecycleException("Legacy TLS requires TIMELINE_KEYSTORE and TIMELINE_KEYSTORE_PASSWORD; migrate listeners to HBDS/service.yml");
            httpsConnector.setProperty("keystoreFile",keystore);httpsConnector.setProperty("keystorePass",password);
            httpsConnector.setProperty("keyAlias",System.getenv("TIMELINE_KEY_ALIAS"));
        }

        Context ob_timeline_context = null;

        if (mode == ob_mode.no_secure) {
            tomcat.setPort(Integer.parseInt(_port));
            tomcat.getConnector();
            if(listenerSettings!=null)tomcat.getConnector().setProperty("address",listenerSettings.getString("host"));

            //Context ctx = tomcat.addContext("", null);
            ob_timeline_context = tomcat.addContext(ui.contextPath(), documentRoot.toString());

            Tomcat.addServlet(ob_timeline_context, "default", new PublicAssetServlet());
            ob_timeline_context.addServletMappingDecoded("/", "default");

            Tomcat.addServlet(ob_timeline_context, "ob", new ob_ajax_timeline());
            ob_timeline_context.addServletMappingDecoded("/openbexi_timeline/sessions", "ob");

        }
        if (mode == ob_mode.secure) {
            httpsConnector.setPort(Integer.parseInt(_port));
            if(listenerSettings==null)tomcat.setBaseDir("tomcat");
            tomcat.setPort(Integer.parseInt(_port));

            service.addConnector(httpsConnector);
            tomcat.setConnector(httpsConnector);

            //Context ctx = tomcat.addContext("", null);
            ob_timeline_context = tomcat.addContext(ui.contextPath(), documentRoot.toString());

            Tomcat.addServlet(ob_timeline_context, "default", new PublicAssetServlet());
            ob_timeline_context.addServletMappingDecoded("/", "default");

            Tomcat.addServlet(ob_timeline_context, "ob", new ob_ajax_timeline());
            ob_timeline_context.addServletMappingDecoded("/openbexi_timeline/sessions", "ob");

        }
        if (mode == ob_mode.secure_ws) {
            httpsConnector.setPort(Integer.parseInt(_port));
            tomcat.setPort(Integer.parseInt(_port));
            service.addConnector(httpsConnector);
            tomcat.setConnector(httpsConnector);
            ob_timeline_context = tomcat.addWebapp(ui.contextPath(), documentRoot.toString());
            Tomcat.addServlet(ob_timeline_context, "publicAssets", new PublicAssetServlet());
            ob_timeline_context.addServletMappingDecoded("/", "publicAssets");
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

            ob_timeline_context = tomcat.addContext(ui.contextPath(), documentRoot.toString());

            Tomcat.addServlet(ob_timeline_context, "default", new PublicAssetServlet());
            ob_timeline_context.addServletMappingDecoded("/", "default");

            Tomcat.addServlet(ob_timeline_context, "ob_sse", new ob_sse_timeline());
            ob_timeline_context.addServletMappingDecoded("/openbexi_timeline_sse/sessions", "ob_sse");

        }
        if (_data_conf != null && ob_timeline_context != null)
            ob_timeline_context.addParameter("data_conf", _data_conf);

        Tomcat.addServlet(ob_timeline_context, "timeline_config", new TimelineConfigServlet(
                mode==ob_mode.secure_sse?"/openbexi_timeline_sse/sessions":"/openbexi_timeline/sessions"));
        ob_timeline_context.addServletMappingDecoded("/openbexi_timeline/config", "timeline_config");

        Tomcat.addServlet(ob_timeline_context, "api_v1", new TimelineApiServlet()).setLoadOnStartup(1);
        ob_timeline_context.addServletMappingDecoded("/api/v1/*", "api_v1");

        // Add MIME type mapping for JavaScript files
        ob_timeline_context.addMimeMapping("js", "application/javascript");
        // Add MIME type mapping for JSON files
        ob_timeline_context.addMimeMapping("json", "application/json");
        // Add MIME type mapping for MJS files
        ob_timeline_context.addMimeMapping("mjs", "application/javascript");

        tomcat.start();
        Connector listener=tomcat.getConnector();
        if(!listener.getState().isAvailable()||!ob_timeline_context.getState().isAvailable())throw new LifecycleException("Configured listener failed to start");
        if(listener.getState().isAvailable() && ob_timeline_context.getState().isAvailable()) {
            _logger.info("Timeline service ready: scheme="+listener.getScheme()+" port="+listener.getLocalPort()+
                    " context="+ui.contextPath()+" route="+(mode==ob_mode.secure_sse?"/openbexi_timeline_sse/sessions":"/openbexi_timeline/sessions"));
            try {
                ui.readyUrl(listener.getScheme(),Integer.parseInt(_port),listener.getLocalPort())
                        .ifPresent(address->_logger.info("Web UI ready: "+address));
            } catch(IllegalArgumentException error) { _logger.warning("Web UI address is invalid; review web_ui configuration."); }
        }

    }
}
