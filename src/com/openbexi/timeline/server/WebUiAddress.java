package com.openbexi.timeline.server;

import org.yaml.snakeyaml.*;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import java.io.*;
import java.net.URI;
import java.nio.file.*;
import java.util.*;
import com.openbexi.timeline.api.TimelineHbds;

/** Browser address for a ready listener, with optional deployment overrides. */
public record WebUiAddress(String host,Integer port,String contextPath,String entryPage,String externalBaseUrl) {
    public static WebUiAddress read(String configuration) throws IOException {
        return read(configuration,"localhost");
    }
    public static WebUiAddress read(String configuration,String listenerHost) throws IOException {
        String defaultHost=switch(listenerHost) {
            case "", "0.0.0.0" -> "127.0.0.1";
            case "::", "[::]", "0:0:0:0:0:0:0:0" -> "::1";
            default -> listenerHost;
        };
        Path selected=TimelineHbds.resolve(Path.of(""),configuration);
        var workspace=com.openbexi.timeline.api.NamespaceConfiguration.find(selected);
        if(workspace!=null) {
            var ui=workspace.service().optJSONObject("web_ui",new org.json.JSONObject());
            return from(ui.toMap(),defaultHost);
        }
        try(Reader reader=Files.newBufferedReader(selected)) {
            Object document=TimelineHbds.canonical(selected)?TimelineHbds.open(TimelineHbds.projectRoot(selected),selected).legacyConfiguration().toMap():
                    new Yaml(new SafeConstructor(new LoaderOptions())).load(reader);
            Map<?,?> values=document instanceof Map<?,?> root && root.get("web_ui") instanceof Map<?,?> ui?ui:Map.of();
            return from(values,defaultHost);
        }
    }
    private static WebUiAddress from(Map<?,?> values,String defaultHost) {
        String context=Objects.toString(values.get("context_path"),"").replaceAll("/+$","");
        if(!context.isEmpty() && !context.startsWith("/")) context="/"+context;
        return new WebUiAddress(Objects.toString(values.get("host"),defaultHost),
                values.get("port")==null?null:Integer.valueOf(values.get("port").toString()),context,
                Objects.toString(values.get("entry_page"),"openbexi_timeline.html"),Objects.toString(values.get("external_base_url"),""));
    }
    public Optional<String> readyUrl(String scheme,int configuredPort,int effectivePort) {
        if(entryPage.isBlank() || port!=null && port!=configuredPort && port!=effectivePort) return Optional.empty();
        if(entryPage.startsWith("/") || entryPage.contains("..") || entryPage.contains("\\") || entryPage.contains("?") || entryPage.contains("#"))
            throw new IllegalArgumentException("web_ui.entry_page must be a relative page path.");
        try {
            URI base=externalBaseUrl.isBlank()?new URI(scheme,null,host,effectivePort,contextPath+"/",null,null):URI.create(externalBaseUrl.replaceAll("/+$","")+"/");
            if(!Set.of("http","https").contains(base.getScheme()) || base.getHost()==null || base.getUserInfo()!=null || base.getQuery()!=null || base.getFragment()!=null)
                throw new IllegalArgumentException("Invalid web_ui browser address.");
            return Optional.of(base.resolve(new URI(null,null,entryPage,null)).toASCIIString());
        } catch(java.net.URISyntaxException error) { throw new IllegalArgumentException("Invalid web_ui browser address.",error); }
    }
}
