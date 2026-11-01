package com.openbexi.timeline.websockets;

import com.openbexi.timeline.data_browser.*;
import javax.websocket.*;
import javax.websocket.server.ServerEndpoint;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** WebSocket queries share the same namespace/expression filtering as REST and SSE. */
@ServerEndpoint("/openbexi_timeline_ws/sessions")
public class ob_websocket_timeline {
    private static final Map<Integer,String> CONFIGURATIONS=new ConcurrentHashMap<>();
    private static final Set<String> ALLOWED=Set.of("startDate","endDate","scene","namespace","namespaces","userName","timelineName","filter","search","searchMode","sortBy","progressive","cursor","cancel","history");
    private Map<String,String> parameters;
    public static void configure(int port,String path){if(path!=null)CONFIGURATIONS.put(port,path);}
    public static Object query(String path,Map<String,String> parameters) throws Exception {
        data_configuration configuration=new data_configuration(path);
        for(var entry:parameters.entrySet())if(ALLOWED.contains(entry.getKey()))configuration.getConfiguration().put(entry.getKey(),entry.getValue());
        configuration.getConfiguration().put("filterProvided",parameters.containsKey("filter"));
        configuration.getConfiguration().put("matchProtocol","1");
        SavedFilters.resolve(configuration.getConfiguration());
        FilterExpression.compile((String)configuration.getConfiguration().get("filter"));
        return new json_files_manager(null,null,configuration).getData(null,parameters.getOrDefault("scene","0"));
    }
    @OnMessage public void onMessage(String message,Session session) {
        try {
            int port=session.getRequestURI().getPort();if(port<0)port=session.isSecure()?443:80;
            String path=CONFIGURATIONS.get(port);if(path==null)throw new IllegalStateException("WebSocket source configuration is unavailable.");
            Map<String,String> next=parameters==null?new HashMap<>():new HashMap<>(parameters);
            if(parameters==null)session.getRequestParameterMap().forEach((key,values)->{if(ALLOWED.contains(key)&&!values.isEmpty())next.put(key,values.get(0));});
            org.json.JSONObject body=message.trim().startsWith("{")?new org.json.JSONObject(message):new org.json.JSONObject();
            for(String key:body.keySet()){
                if(!ALLOWED.contains(key)||!(body.get(key) instanceof String))throw new IllegalArgumentException("Invalid query.");
            }
            if(!body.has("cursor")&&body.keySet().stream().anyMatch(key->!key.equals("cancel")&&!Objects.equals(next.get(key),body.getString(key))))next.remove("cursor");
            for(String key:body.keySet())next.put(key,body.getString(key));
            parameters=next;
            session.getAsyncRemote().sendText(query(path,parameters).toString());
        }catch(Exception error){session.getAsyncRemote().sendText("{\"error\":\"Invalid or unavailable timeline query.\"}");}
    }
}
