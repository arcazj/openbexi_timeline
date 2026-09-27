package com.openbexi.timeline.server;

import org.yaml.snakeyaml.*;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import java.io.*;
import java.net.URI;
import java.nio.file.*;
import java.util.*;

/** Optional deployment address; independent of any site's filenames or ports. */
public record WebUiAddress(String host,Integer port,String contextPath,String entryPage,String externalBaseUrl) {
    public static WebUiAddress read(String configuration) throws IOException {
        try(Reader reader=Files.newBufferedReader(Path.of(configuration))) {
            Object document=new Yaml(new SafeConstructor(new LoaderOptions())).load(reader);
            Map<?,?> values=document instanceof Map<?,?> root && root.get("web_ui") instanceof Map<?,?> ui?ui:Map.of();
            String context=Objects.toString(values.get("context_path"),"").replaceAll("/+$","");
            if(!context.isEmpty() && !context.startsWith("/")) context="/"+context;
            return new WebUiAddress(Objects.toString(values.get("host"),"localhost"),
                    values.get("port")==null?null:Integer.valueOf(values.get("port").toString()),context,
                    Objects.toString(values.get("entry_page"),""),Objects.toString(values.get("external_base_url"),""));
        }
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
