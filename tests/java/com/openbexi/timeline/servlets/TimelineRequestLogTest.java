package com.openbexi.timeline.servlets;

import org.junit.jupiter.api.Test;
import javax.servlet.http.*;
import java.lang.reflect.Proxy;
import java.util.*;
import java.util.logging.*;
import static org.junit.jupiter.api.Assertions.*;

class TimelineRequestLogTest {
    @Test void browserThresholdAppliesOnlyToItsOwnRequestIncludingWarningDetails() {
        Logger logger=Logger.getLogger(TimelineRequestLog.class.getName());Level previousLevel=logger.getLevel();
        String previousFormat=System.getProperty("openbexi.timeline.logFormat");
        List<LogRecord> lines=new ArrayList<>();
        Handler capture=new Handler(){public void publish(LogRecord record){lines.add(record);}public void flush(){}public void close(){}};
        Map<String,Object> attrs=new HashMap<>();Map<String,String> params=new HashMap<>();
        HttpServletRequest request=(HttpServletRequest)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{HttpServletRequest.class},(p,m,a)->switch(m.getName()) {
            case "getAttribute"->attrs.get(a[0]);case "setAttribute"->{attrs.put((String)a[0],a[1]);yield null;}
            case "getParameter"->params.get(a[0]);case "getMethod"->"GET";case "getServletPath"->"/openbexi_timeline/sessions";default->null;
        });
        HttpServletResponse response=(HttpServletResponse)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{HttpServletResponse.class},
                (p,m,a)->m.getName().equals("getStatus")?200:null);
        Map<String,Object> warning=Map.of("complete",false,"warnings",List.of("Missing source"),
                "warningDetails",List.of(Map.of("code","missing_source","namespace","sample","reason","Missing","action","Check path")));
        try {
            System.setProperty("openbexi.timeline.logFormat","readable");logger.setLevel(Level.FINE);logger.addHandler(capture);
            for(String choice:List.of("INFO","WARNING","ERROR","invalid")) {
                params.put("traceLevel",choice);attrs.clear();lines.clear();
                TimelineRequestLog.begin(request,response).sent(Map.of("events",List.of(),"timelineMatch",Map.of("complete",true)),"json_file",false);
                assertEquals(choice.equals("INFO") || choice.equals("invalid")?1:0,lines.size(),choice);
                attrs.clear();lines.clear();
                TimelineRequestLog.begin(request,response).sent(Map.of("events",List.of(),"timelineMatch",warning),"json_file",false);
                assertEquals(choice.equals("ERROR")?0:2,lines.size(),choice);
                for(LogRecord line:lines)assertEquals(Level.WARNING,line.getLevel());
                attrs.clear();lines.clear();
                TimelineRequestLog.begin(request,response).sent(Map.of("events",List.of(),"timelineMatch",Map.of("error","Provider failed")),"json_file",false);
                assertEquals(1,lines.size(),choice);assertEquals(Level.SEVERE,lines.get(0).getLevel());
                assertEquals(Level.FINE,logger.getLevel(),"A browser must not change the global logger");
            }
            params.clear();attrs.clear();lines.clear();
            TimelineRequestLog.begin(request,response).sent(Map.of("events",List.of()),"json_file",false);
            assertEquals(List.of(Level.FINE,Level.INFO,Level.FINE),lines.stream().map(LogRecord::getLevel).toList());
        } finally {
            logger.removeHandler(capture);logger.setLevel(previousLevel);
            if(previousFormat==null)System.clearProperty("openbexi.timeline.logFormat");else System.setProperty("openbexi.timeline.logFormat",previousFormat);
        }
    }

    @Test void debugRequestDetailsAreOptInAndNeverExposeCredentialsOrExtraLogLines() {
        String previousFormat=System.getProperty("openbexi.timeline.logFormat"),previousValues=System.getProperty("openbexi.timeline.logQueryValues");
        List<String> lines=new ArrayList<>();Logger logger=Logger.getLogger(TimelineRequestLog.class.getName());
        List<LogRecord> records=new ArrayList<>();Level previousLevel=logger.getLevel();
        Handler capture=new Handler(){public void publish(LogRecord r){lines.add(r.getMessage());records.add(r);}public void flush(){}public void close(){}};
        Map<String,Object> attrs=new HashMap<>();
        Map<String,String> params=Map.of("ob_request","readDescriptor","event_id","sample-record","filter","status:warning\nextra",
                "password","hidden-password","token","hidden-token","cursor","hidden-cursor");
        HttpServletRequest req=(HttpServletRequest)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{HttpServletRequest.class},(p,m,a)->switch(m.getName()) {
            case "getAttribute"->attrs.get(a[0]);case "setAttribute"->{attrs.put((String)a[0],a[1]);yield null;}
            case "getParameter"->params.get(a[0]);case "getMethod"->"POST";
            case "getRequestURL"->new StringBuffer("http://localhost:8123/openbexi_timeline/sessions");
            case "getServletPath"->"/openbexi_timeline/sessions";default->null;
        });
        int[] status={200};
        HttpServletResponse res=(HttpServletResponse)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{HttpServletResponse.class},
                (p,m,a)->m.getName().equals("getStatus")?status[0]:null);
        try {
            System.setProperty("openbexi.timeline.logFormat","readable");System.setProperty("openbexi.timeline.logQueryValues","true");logger.addHandler(capture);
            logger.setLevel(Level.FINE);
            TimelineRequestLog log=TimelineRequestLog.begin(req,res);log.sent(Map.of("event_descriptor",List.of()),"json_file",false);log.finish();
            assertEquals(3,lines.size());assertTrue(lines.get(0).contains("event_id=sample-record"));assertTrue(lines.get(0).contains("filter=status%3Awarning%0Aextra"));
            assertEquals(Level.FINE,records.get(0).getLevel());
            assertTrue(lines.get(1).contains("HTTP 200 operation=readDescriptor"));assertEquals(Level.INFO,records.get(1).getLevel());
            assertTrue(lines.get(2).startsWith("timeline-details "));assertEquals(Level.FINE,records.get(2).getLevel());
            for(String line:lines){assertFalse(line.contains("hidden-"));assertFalse(line.contains("\n"));}
            logger.setLevel(Level.INFO);
            for(var error:Map.of(403,"forbidden",422,"validation_failed",500,"server_error").entrySet()) {
                status[0]=error.getKey();attrs.clear();lines.clear();records.clear();
                TimelineRequestLog rejected=TimelineRequestLog.begin(req,res);
                rejected.sent(Map.of("message","synthetic rejection"),"api-v1",false);rejected.finish();
                assertEquals(1,lines.size());
                assertTrue(lines.get(0).contains("HTTP "+status[0]));assertTrue(lines.get(0).contains("outcome=failed"));
                assertTrue(lines.get(0).contains("reason="+error.getValue()));
                assertEquals(status[0]>=500?Level.SEVERE:Level.WARNING,records.get(0).getLevel());
            }
        } finally {
            logger.removeHandler(capture);logger.setLevel(previousLevel);
            if(previousFormat==null) System.clearProperty("openbexi.timeline.logFormat");else System.setProperty("openbexi.timeline.logFormat",previousFormat);
            if(previousValues==null) System.clearProperty("openbexi.timeline.logQueryValues");else System.setProperty("openbexi.timeline.logQueryValues",previousValues);
        }
    }

    @Test void separatesNestedCountsReportsLogicalFailureAndRedactsUserContent() {
        String previousFormat=System.getProperty("openbexi.timeline.logFormat");
        List<String> lines=new ArrayList<>();Logger logger=Logger.getLogger(TimelineRequestLog.class.getName());
        Level previousLevel=logger.getLevel();
        Handler capture=new Handler() {public void publish(LogRecord r){lines.add(r.getMessage());}public void flush(){}public void close(){}};
        logger.addHandler(capture);
        Map<String,Object> attrs=new HashMap<>(),headers=new HashMap<>();
        Map<String,String> params=Map.of("filter","private-token-and-query","sortBy","private-field","loadId","synthetic-load", "purpose","initial");
        HttpServletRequest req=(HttpServletRequest)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{HttpServletRequest.class},(p,m,a)->switch(m.getName()) {
            case "getAttribute"->attrs.get(a[0]);case "setAttribute"->{attrs.put((String)a[0],a[1]);yield null;}
            case "getParameter"->params.get(a[0]);case "getMethod"->"GET";case "getServletPath"->"/openbexi_timeline/sessions";default->null;
        });
        HttpServletResponse res=(HttpServletResponse)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{HttpServletResponse.class},(p,m,a)->switch(m.getName()) {
            case "setHeader"->{headers.put((String)a[0],a[1]);yield null;}case "getStatus"->200;default->null;
        });
        var child=Map.of("id","point","data",Map.of("title","private record"));
        var nested=Map.of("id","nested","activities",List.of(child));
        var parent=Map.of("id","parent","activities",List.of(nested,child));
        var records=List.of(parent,parent,Map.of("id","zone","zone",true));
        try {
            System.clearProperty("openbexi.timeline.logFormat");logger.setLevel(Level.INFO);
            assertEquals(Map.of("sessions",2L,"events",2L),TimelineRequestLog.counts(records));
            TimelineRequestLog log=TimelineRequestLog.begin(req,res);
            log.sent(Map.of("events",records,"timelineMatch",Map.of("complete",false,"error","private error")),"json_file",false);log.finish();
            assertEquals(1,lines.size());String line=lines.get(0);
            assertTrue(line.startsWith("timeline-response ["));assertTrue(line.contains("HTTP 200"));
            assertTrue(line.contains("outcome=failed"));assertTrue(line.contains("reason=provider_error"));
            assertTrue(line.contains("sessions=2 events=2"));
            assertTrue(line.contains("synthetic-load"));assertFalse(line.contains("private"));assertNotNull(headers.get("X-Request-ID"));
            assertFalse(String.join("\n",lines).contains("private"));
            assertFalse(line.contains("unknown"));assertFalse(line.contains(" GET "));assertFalse(line.contains("{\""));
        } finally {
            logger.removeHandler(capture);logger.setLevel(previousLevel);
            if(previousFormat==null)System.clearProperty("openbexi.timeline.logFormat");else System.setProperty("openbexi.timeline.logFormat",previousFormat);
        }
    }

    @Test void defaultInfoOutputReportsCoverageWarningsWithDetailsOnlyOnTheFinalPage() {
        String previousFormat=System.getProperty("openbexi.timeline.logFormat");
        Logger logger=Logger.getLogger(TimelineRequestLog.class.getName());Level previousLevel=logger.getLevel();
        List<LogRecord> lines=new ArrayList<>();
        Handler capture=new Handler(){public void publish(LogRecord record){lines.add(record);}public void flush(){}public void close(){}};
        Map<String,Object> attrs=new HashMap<>();
        HttpServletRequest request=(HttpServletRequest)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{HttpServletRequest.class},(p,m,a)->switch(m.getName()) {
            case "getAttribute"->attrs.get(a[0]);case "setAttribute"->{attrs.put((String)a[0],a[1]);yield null;}
            case "getMethod"->"GET";case "getServletPath"->"/openbexi_timeline/sessions";default->null;
        });
        HttpServletResponse response=(HttpServletResponse)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{HttpServletResponse.class},
                (p,m,a)->m.getName().equals("getStatus")?200:null);
        try {
            System.clearProperty("openbexi.timeline.logFormat");logger.setLevel(Level.INFO);logger.addHandler(capture);
            TimelineRequestLog.begin(request,response).sent(Map.of("events",List.of(),"timelineMatch",Map.of("complete",true)),"json_file",false);
            assertEquals(1,lines.size());assertEquals(Level.INFO,lines.get(0).getLevel());
            assertTrue(lines.get(0).getMessage().contains("outcome=empty"));
            Map<String,Object> meta=new HashMap<>(Map.of("complete",false,"nextCursor","continuation","warnings",List.of("Unreadable records"),
                    "warningDetails",List.of(Map.of("code","record_too_large","namespace","ESOC","sourceIndex",1,"path","events.json",
                            "reason","Oversized record\nextra","action","Split the record, then Refresh."))));
            attrs.clear();lines.clear();
            TimelineRequestLog.begin(request,response).sent(Map.of("events",List.of(),"timelineMatch",meta),"json_file",false);
            assertEquals(1,lines.size());assertEquals(Level.WARNING,lines.get(0).getLevel());
            assertTrue(lines.get(0).getMessage().contains("outcome=loading warnings=1"));
            attrs.clear();lines.clear();meta.remove("nextCursor");
            TimelineRequestLog finalPage=TimelineRequestLog.begin(request,response);
            finalPage.sent(Map.of("events",List.of(),"timelineMatch",meta),"json_file",false);finalPage.finish();
            assertEquals(2,lines.size());
            assertTrue(lines.get(0).getMessage().contains("outcome=partial warnings=1"));
            String detail=lines.get(1).getMessage();assertTrue(detail.contains("code=record_too_large source=ESOC sourceIndex=1 file=events.json"));
            assertTrue(detail.contains("action=Split the record, then Refresh."));
            for(LogRecord line:lines){assertEquals(Level.WARNING,line.getLevel());assertFalse(line.getMessage().contains("\n"));}
        } finally {
            logger.removeHandler(capture);logger.setLevel(previousLevel);
            if(previousFormat==null)System.clearProperty("openbexi.timeline.logFormat");else System.setProperty("openbexi.timeline.logFormat",previousFormat);
        }
    }
}
