package com.openbexi.timeline.data_browser;

import org.json.simple.*;
import org.json.simple.parser.JSONParser;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Saved presets retain their legacy file format and their independent Sort by. */
public final class SavedFilters {
    private SavedFilters() {}
    private static String identity(String value,String fallback) {
        String result=value==null || value.isBlank()?fallback:value;
        if(!result.matches("[A-Za-z0-9_-]{1,128}"))throw new IllegalArgumentException("Invalid filter profile identity.");
        return result;
    }
    private static Path directory(JSONObject configuration) {
        Path base=Path.of(Objects.toString(configuration.get("_hbds_root"),"HBDS"),"filters");
        Object workspace=configuration.get("_hbds_workspace");
        if(workspace==null)return base;
        String scope=Path.of(workspace.toString()).getFileName().toString().replaceFirst("\\.[^.]+$","");
        if(scope.isBlank()||scope.equals(".")||scope.equals(".."))throw new IllegalArgumentException("Invalid filter workspace identity.");
        return base.resolve("workspaces").resolve(scope);
    }
    private static Path path(JSONObject configuration) {
        return directory(configuration).resolve(identity((String)configuration.get("userName"),"guest")+"_"+
                identity((String)configuration.get("timelineName"),"timeline")+"_filter_setting.json");
    }
    private static boolean belongs(JSONObject document,JSONObject configuration) {
        Set<Object> names=new HashSet<>();
        Object configured=configuration.get("_hbds_filter_namespaces");
        if(configured instanceof JSONArray values)names.addAll(values);
        else if(configuration.get("startup configuration") instanceof JSONArray sources)
            for(Object value:sources)if(value instanceof JSONObject source)names.add(source.get("namespace"));
        names.remove(null);names.remove("");
        if(names.contains(document.get("namespace")))return true;
        JSONObject timeline=(JSONObject)((JSONArray)document.get("openbexi_timeline")).get(0);
        if(timeline.get("sources") instanceof JSONArray sources)
            for(Object value:sources)if(value instanceof JSONObject source&&names.contains(source.get("namespace")))return true;
        return false;
    }
    private static JSONObject read(JSONObject configuration) throws IOException {
        Path target=path(configuration),folder=target.getParent(),base=Path.of(Objects.toString(configuration.get("_hbds_root"),"HBDS"),"filters");
        List<Path> candidates=new ArrayList<>();candidates.add(target);
        if(!folder.equals(base))candidates.add(base.resolve(target.getFileName()));
        candidates.add(Path.of("HBDS/private/filters").resolve(target.getFileName()));
        candidates.add(Path.of("filters").resolve(target.getFileName()));
        if("guest".equals(identity((String)configuration.get("userName"),"guest"))) {
            candidates.add(folder.resolve("default_filter_setting.json"));
            if(!folder.equals(base))candidates.add(base.resolve("default_filter_setting.json"));
            candidates.add(com.openbexi.timeline.api.TimelineHbds.resolve(Path.of(""),"filters/default_filter_setting.json"));
        }
        for(Path candidate:candidates) {
            if(!Files.isRegularFile(candidate))continue;
            try(Reader reader=Files.newBufferedReader(candidate)) {
                JSONObject document=(JSONObject)new JSONParser().parse(reader);
                // Preserve legacy presets only when their sources belong to this workspace.
                if(configuration.get("_hbds_workspace")!=null&&!candidate.getParent().equals(folder)&&!belongs(document,configuration))continue;
                return document;
            } catch(org.json.simple.parser.ParseException | ClassCastException error) {throw new IOException("Saved filter settings are invalid.",error);}
        }
        return null;
    }
    public static void resolve(JSONObject configuration) {
        // An explicit expression (including empty) overrides the saved active preset.
        if(Boolean.TRUE.equals(configuration.get("filterProvided")))return;
        if(configuration.get("timelineName")==null || configuration.get("userName")==null)return;
        try {
            JSONObject document=read(configuration);if(document==null)return;
            JSONObject timeline=(JSONObject)((JSONArray)document.get("openbexi_timeline")).get(0);
            for(Object value:(JSONArray)timeline.get("filters")) {
                JSONObject filter=(JSONObject)value;
                if("yes".equals(filter.get("current"))) {
                    configuration.put("filter",FilterExpression.decode((String)filter.get("filter_value")));
                    configuration.put("filterName",filter.get("name"));
                    if(configuration.get("sortBy")==null)configuration.put("sortBy",filter.get("sortBy"));
                    break;
                }
            }
        } catch(IOException | ClassCastException | NullPointerException error) {throw new IllegalArgumentException("Cannot read the active saved filter.",error);}
    }
    public static synchronized JSONObject update(data_configuration configuration) {
        JSONObject query=configuration.getConfiguration();
        String operation=Objects.toString(query.get("request"),"readFilters");
        String expression=FilterExpression.decode((String)query.get("filter"));
        if(!operation.equals("readFilters") && !operation.equals("deleteFilter"))FilterExpression.compile(expression);
        try {
            JSONObject document=read(query),timeline;
            if(document==null) {
                timeline=new JSONObject();JSONArray timelines=new JSONArray();timelines.add(timeline);
                document=new JSONObject(Map.of("dateTimeFormat","iso8601","scene",Objects.toString(query.get("scene"),"0"),"namespace",Objects.toString(query.get("namespace"),""),"openbexi_timeline",timelines));
                for(String key:List.of("top","left","width","height","camera","backgroundColor","sortBy","email"))timeline.put(key,Objects.toString(query.get(key),""));
                timeline.put("name",identity((String)query.get("timelineName"),"timeline"));
                timeline.put("user",identity((String)query.get("userName"),"guest"));
                timeline.put("start","current_time");timeline.put("title1",Objects.toString(query.get("title"),"Timeline"));
                JSONArray initial=new JSONArray();initial.add(new JSONObject(Map.of("name","ALL","filter_value","","sortBy","NONE","current","yes")));
                initial.add(new JSONObject(Map.of("name","by_namespace","filter_value","","sortBy","namespace","current","no")));
                timeline.put("filters",initial);
            } else timeline=(JSONObject)((JSONArray)document.get("openbexi_timeline")).get(0);
            timeline.put("name",identity((String)query.get("timelineName"),"timeline"));
            timeline.put("user",identity((String)query.get("userName"),"guest"));
            timeline.put("sources",query.get("startup configuration"));timeline.put("multiples","45");
            if(operation.equals("readFilters"))return document;
            JSONArray filters=(JSONArray)timeline.get("filters");
            String name=Objects.toString(query.get("filterName"),"");
            if(name.isBlank())throw new IllegalArgumentException("Enter a filter name.");
            JSONObject selected=null;
            for(Object value:filters)if(name.equals(((JSONObject)value).get("name")))selected=(JSONObject)value;
            if(operation.equals("deleteFilter")) {
                filters.remove(selected);selected=filters.isEmpty()?null:(JSONObject)filters.get(0);
            } else {
                if(selected==null){selected=new JSONObject();filters.add(selected);}
                selected.put("name",name);selected.put("filter_value",expression);
                selected.put("sortBy",Objects.toString(query.get("sortBy"),"NONE"));
                selected.put("backgroundColor",Objects.toString(query.get("backgroundColor"),"#eef1f2"));
                filters.remove(selected);filters.add(0,selected);
            }
            for(Object value:filters)((JSONObject)value).put("current",value==selected?"yes":"no");
            timeline.put("sortBy",selected==null?"NONE":selected.get("sortBy"));
            Path target=path(query);Files.createDirectories(target.toAbsolutePath().getParent());
            Path temporary=Files.createTempFile(target.toAbsolutePath().getParent(),".filter-",".tmp");
            try {
                Files.writeString(temporary,document.toJSONString(),StandardCharsets.UTF_8);
                try {Files.move(temporary,target.toAbsolutePath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}
                catch(AtomicMoveNotSupportedException error){Files.move(temporary,target.toAbsolutePath(),StandardCopyOption.REPLACE_EXISTING);}
            } finally {Files.deleteIfExists(temporary);}
            return document;
        } catch(IOException error) {throw new IllegalStateException("Cannot read or save filter settings.",error);}
    }
}
