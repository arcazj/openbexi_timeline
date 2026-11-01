package com.openbexi.timeline.data_browser;
import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import java.util.*;

/** Apply visibility scope before expression filtering, response counting and serialization. */
public final class FilterNamespaces {
    private FilterNamespaces(){}
    public static JSONArray select(JSONArray records,JSONObject configuration){
        Object raw=configuration.get("namespaces");
        if(raw==null){String single=Objects.toString(configuration.get("namespace"),"");if(single.isBlank()||single.equals("0"))return records;raw=new org.json.JSONArray(List.of(single)).toString();}
        Set<String> names=new HashSet<>();
        try{for(Object value:new org.json.JSONArray(raw.toString())){if(!(value instanceof String))throw new IllegalArgumentException();names.add(value.toString());}}
        catch(Exception error){throw new IllegalArgumentException("Invalid namespace selection.");}
        JSONArray selected=new JSONArray();
        for(Object value:records){JSONObject record=(JSONObject)value;String namespace=MatchResults.namespace(record,"");
            if(names.contains(namespace)||!names.isEmpty()&&namespace.isBlank()&&Boolean.TRUE.equals(record.get("zone")))selected.add(value);}
        return selected;
    }
}
