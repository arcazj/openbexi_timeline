package com.openbexi.timeline.servlets;

import javax.servlet.http.*;
import java.time.Instant;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.logging.*;

/** Structured and readable diagnostics; private query values require local opt-in. */
public final class TimelineRequestLog {
    private static final Logger LOG=Logger.getLogger(TimelineRequestLog.class.getName());
    private static final String ATTRIBUTE=TimelineRequestLog.class.getName();
    private final HttpServletRequest request;
    private final HttpServletResponse response;
    private final long started=System.nanoTime();
    private final String id=UUID.randomUUID().toString();
    private long lastStreamLog;
    private int snapshots;
    private boolean recorded;
    private final String format=System.getProperty("openbexi.timeline.logFormat","readable");
    private final Level threshold;

    private TimelineRequestLog(HttpServletRequest request,HttpServletResponse response) {
        this.request=request;this.response=response;response.setHeader("X-Request-ID",id);
        // A browser controls only its own request traces, never the shared logger.
        String requested=request.getParameter("traceLevel");
        threshold=requested==null?Level.ALL:switch(requested) {
            case "WARNING" -> Level.WARNING;
            case "ERROR" -> Level.SEVERE;
            default -> Level.INFO;
        };
        if(readable() && enabled(Level.FINE)) LOG.fine(()->"timeline-request ["+id+"] "+request.getMethod()+" "+requestURL());
    }
    private boolean enabled(Level level) {return level.intValue()>=threshold.intValue() && LOG.isLoggable(level);}
    private boolean readable() {return !"json".equalsIgnoreCase(format);}
    private String requestURL() {
        StringBuffer address=request.getRequestURL();
        String base=address==null?Objects.toString(request.getServletPath(),"/sessions"):address.toString();
        List<String> values=new ArrayList<>();
        boolean details=Boolean.getBoolean("openbexi.timeline.logQueryValues");
        Set<String> publicValues=Set.of("ob_request","startDate","endDate","markerDate","scene","matchProtocol","progressive","purpose","cancel");
        for(String key:List.of("ob_request","startDate","endDate","markerDate","scene","namespace","timelineName","title",
                "userName","filterName","filter","search","sortBy","event_id","start","loadId","purpose","cursor","cancel","matchProtocol","progressive")) {
            String value=request.getParameter(key);
            if(value==null || value.equals("undefined") || value.equals("null")) continue;
            if(key.equals("cursor") || !details && !publicValues.contains(key)) value=value.isEmpty()?"":"[redacted]";
            if(value.length()>1024) value=value.substring(0,1024)+"[truncated]";
            values.add(key+"="+URLEncoder.encode(value,StandardCharsets.UTF_8).replace("+","%20"));
        }
        return base.replaceAll("[\\r\\n\\t]"," ")+(values.isEmpty()?"":"?"+String.join("&",values));
    }
    public static TimelineRequestLog begin(HttpServletRequest request,HttpServletResponse response) {
        Object existing=request.getAttribute(ATTRIBUTE);
        if(existing instanceof TimelineRequestLog log) return log;
        TimelineRequestLog log=new TimelineRequestLog(request,response);request.setAttribute(ATTRIBUTE,log);return log;
    }
    public void finish() { if(!recorded) record(null,"unknown",false,null); }
    public void failure(String code) { record(null,"unknown",false,code); }
    public void sent(Object body,String provider,boolean stream) { record(body,provider,stream,null); }

    /** Identity uses ancestry, matching the browser's session/event counting. */
    public static Map<String,Boolean> identities(Object records) {
        return identities(records,false);
    }
    private static Map<String,Boolean> identities(Object records,boolean api) {
        Map<String,Boolean> result=new LinkedHashMap<>();collect(records,"","",result,0,api);return result;
    }
    private static void collect(Object input,String ancestry,String inherited,Map<String,Boolean> result,int depth,boolean api) {
        if(!(input instanceof List<?> records) || depth>32) return;
        int index=0;
        for(Object item:records) {
            int ordinal=index++;
            if(!(item instanceof Map<?,?> record) || Boolean.TRUE.equals(record.get("zone"))) continue;
            Map<?,?> data=record.get("data") instanceof Map<?,?> map?map:Map.of();
            String namespace=Objects.toString(record.get("namespace"),Objects.toString(data.get("namespace"),inherited));
            String identity=Objects.toString(record.get("sourceRecordKey"),Objects.toString(record.get("id"),"#"+ordinal));
            String key=ancestry+new org.json.JSONArray(List.of(namespace,identity)).toString();
            result.put(key,record.get("activities") instanceof List<?> || "session".equals(data.get("kind")) || api && record.get("end")!=null);
            collect(record.get("activities"),key,namespace,result,depth+1,api);
        }
    }
    public static Map<String,Object> counts(Object records) {
        return counts(records,false);
    }
    private static Map<String,Object> counts(Object records,boolean api) {
        Map<String,Boolean> identities=identities(records,api);
        long sessions=identities.values().stream().filter(Boolean::booleanValue).count();
        return Map.of("sessions",sessions,"events",identities.size()-sessions);
    }
    private static Object time(String value) {
        if(value==null) return "unknown";
        try { return Instant.ofEpochMilli(com.openbexi.timeline.data_browser.MatchResults.time(value)).toString(); }
        catch(Exception ignored) { return "invalid"; }
    }
    private static String option(String value,Set<String> allowed) { return value!=null && allowed.contains(value)?value:"unspecified"; }
    private static String loadId(String value) { return value!=null && value.matches("[a-zA-Z0-9-]{1,80}")?value:"unspecified"; }
    private void record(Object body,String provider,boolean stream,String failure) {
        recorded=true;
        long now=System.currentTimeMillis();snapshots++;
        // A live stream can run indefinitely. First snapshot and at most one
        // summary per five seconds; each count is for that snapshot, not a sum.
        if(stream && failure==null && now-lastStreamLog<5000) return;
        lastStreamLog=now;
        Map<?,?> value=body instanceof org.json.JSONObject json?json.toMap():body instanceof Map<?,?> map?map:Map.of();
        Map<?,?> meta=value.get("timelineMatch") instanceof Map<?,?> map?map:Map.of();
        Object records=value.get("events");
        boolean api="api-v1".equals(provider);
        String info=Objects.toString(request.getPathInfo(),"");
        if(api && info.matches("/datasets/[^/]+/(events|sessions)(/[^/]+)?"))
            records=value.get("items") instanceof List<?>?value.get("items"):value.containsKey("start")?List.of(value):null;
        boolean known=records instanceof List<?>;
        Map<String,Object> counts=known?counts(records,api):Map.of("sessions","unknown","events","unknown");
        boolean more=meta.get("nextCursor")!=null;
        String outcome=failure!=null?failure:response.getStatus()>=400 || meta.get("error")!=null || value.get("error")!=null?"failed":
                Boolean.TRUE.equals(meta.get("cancelled"))?"cancelled":
                more?"loading":Boolean.FALSE.equals(meta.get("complete"))?"partial":known && ((List<?>)records).isEmpty()?"empty":"ok";
        String operation=option(request.getParameter("ob_request"),Set.of("readFilters","updateFilter","saveFilter","addFilter","deleteFilter","readDescriptor","addEvent"));
        if(operation.equals("unspecified")) operation=known?"records":"request";
        String path=request.getServletPath();
        if(path==null || path.isEmpty()) path="/api/v1";
        // Resource IDs and arbitrary paths can identify private datasets.
        if(!Set.of("/api/v1","/openbexi_timeline/sessions","/openbexi_timeline_sse/sessions").contains(path)) path="/api/v1/{resource}";
        Map<String,Object> entry=new LinkedHashMap<>();
        entry.put("time",Instant.now().toString());entry.put("requestId",id);entry.put("loadId",loadId(request.getParameter("loadId")));
        entry.put("method",request.getMethod());entry.put("route",path);entry.put("operation",operation);
        String scene=request.getParameter("scene");entry.put("scene",scene!=null && scene.matches("[0-9]{1,5}")?scene:"unspecified");
        entry.put("purpose",option(request.getParameter("purpose"),Set.of("initial","visible","past-prefetch","future-prefetch","overview","retry","refresh")));
        entry.put("from",time(request.getParameter("startDate")));entry.put("to",time(request.getParameter("endDate")));
        entry.put("marker",time(request.getParameter("markerDate")));
        entry.put("provider",option(provider,Set.of("json_file","mongoDb","api-v1")));
        entry.put("filtered",Optional.ofNullable(request.getParameter("filter")).filter(s->!s.isEmpty()).isPresent());
        entry.put("grouped",Optional.ofNullable(request.getParameter("sortBy")).filter(s->!s.isEmpty()&&!s.equals("NONE")).isPresent());
        entry.put("status",response.getStatus());entry.put("outcome",outcome);
        String reason=switch(response.getStatus()) {
            case 400 -> "invalid_request";
            case 401 -> "unauthorized";
            case 403 -> "forbidden";
            case 404 -> "not_found";
            case 409 -> "conflict";
            case 422 -> "validation_failed";
            case 429 -> "rate_limited";
            default -> response.getStatus()>=500?"server_error":response.getStatus()>=400?"http_error":
                    meta.get("error")!=null?"provider_error":value.get("error")!=null?"response_error":
                    failure!=null?"request_failed":"none";
        };
        entry.put("reason",reason);
        entry.put("sessionsReturned",counts.get("sessions"));entry.put("eventsReturned",counts.get("events"));
        for(String key:List.of("batch","recordsExamined","recordsExcluded","recordsReturned","uniqueSessions","uniqueEvents","cache","indexedFilesSkipped"))
            entry.put(key,meta.containsKey(key)?meta.get(key):"unknown");
        entry.put("more",meta.isEmpty()?"unknown":more);entry.put("complete",meta.containsKey("complete")?meta.get("complete"):"unknown");
        entry.put("elapsedMs",(System.nanoTime()-started)/1_000_000);
        int warningCount=meta.get("warnings") instanceof List<?> warnings?warnings.size():0;
        entry.put("warningCount",warningCount);
        if(stream) entry.put("snapshot",snapshots);
        boolean failed=outcome.equals("failed") || failure!=null;
        Level level=failed?(response.getStatus()>=400 && response.getStatus()<500?Level.WARNING:Level.SEVERE):
                warningCount>0?Level.WARNING:Level.INFO;
        if(enabled(level) && !"readable".equalsIgnoreCase(format)) LOG.log(level,"timeline "+new org.json.JSONObject(entry));
        if(readable()) {
            if(enabled(level)) LOG.log(level,"timeline-response ["+id+"] HTTP "+response.getStatus()+" operation="+operation+
                    (!entry.get("purpose").equals("unspecified")?" purpose="+entry.get("purpose"):"")+
                    (meta.containsKey("batch")?" batch="+entry.get("batch"):"")+
                    (known?" sessions="+counts.get("sessions")+" events="+counts.get("events"):"")+
                    " time="+entry.get("elapsedMs")+"ms outcome="+outcome+
                    (!reason.equals("none")?" reason="+reason:"")+
                    (warningCount>0?" warnings="+warningCount:"")+
                    (!entry.get("loadId").equals("unspecified")?" loadId="+entry.get("loadId"):""));
            // Details accumulate across cursor pages. Emit them once the scan ends,
            // instead of repeating the same file diagnostics on every continuation.
            if(enabled(Level.WARNING) && !more && meta.get("warningDetails") instanceof List<?> details) {
                int emitted=0;
                for(Object item:details) if(item instanceof Map<?,?> detail) {
                    if(emitted++>=100) break;
                    LOG.warning("timeline-warning ["+id+"] code="+diagnostic(detail.get("code"))+
                            " source="+diagnostic(detail.get("namespace"))+
                            (detail.containsKey("sourceIndex")?" sourceIndex="+diagnostic(detail.get("sourceIndex")):"")+
                            (detail.containsKey("path")?" file="+diagnostic(detail.get("path")):"")+
                            " reason="+diagnostic(detail.get("reason"))+" action="+diagnostic(detail.get("action")));
                }
            }
        }
        if(enabled(Level.FINE)) LOG.fine("timeline-details "+new org.json.JSONObject(entry));
    }

    private static String diagnostic(Object value) {
        String text=Objects.toString(value,"unknown").replaceAll("[\\r\\n\\t]"," ");
        return text.length()>1024?text.substring(0,1024)+"[truncated]":text;
    }
}
