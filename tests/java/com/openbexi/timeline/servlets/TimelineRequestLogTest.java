package com.openbexi.timeline.servlets;

import org.junit.jupiter.api.Test;
import javax.servlet.http.*;
import java.lang.reflect.Proxy;
import java.util.*;
import java.util.logging.*;
import static org.junit.jupiter.api.Assertions.*;

class TimelineRequestLogTest {
    @Test void localReadableModeShowsAllowlistedValuesButNeverCredentialsOrExtraLogLines() {
        String previousFormat=System.getProperty("openbexi.timeline.logFormat"),previousValues=System.getProperty("openbexi.timeline.logQueryValues");
        List<String> lines=new ArrayList<>();Logger logger=Logger.getLogger(TimelineRequestLog.class.getName());
        Handler capture=new Handler(){public void publish(LogRecord r){lines.add(r.getMessage());}public void flush(){}public void close(){}};
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
            TimelineRequestLog log=TimelineRequestLog.begin(req,res);log.sent(Map.of("event_descriptor",List.of()),"json_file",false);log.finish();
            assertEquals(2,lines.size());assertTrue(lines.get(0).contains("event_id=sample-record"));assertTrue(lines.get(0).contains("filter=status%3Awarning%0Aextra"));
            assertTrue(lines.get(1).contains("Response OK! HTTP 200 operation=readDescriptor"));
            for(String line:lines){assertFalse(line.contains("hidden-"));assertFalse(line.contains("\n"));}
            for(var error:Map.of(403,"forbidden",422,"validation_failed").entrySet()) {
                status[0]=error.getKey();attrs.clear();lines.clear();
                TimelineRequestLog rejected=TimelineRequestLog.begin(req,res);
                rejected.sent(Map.of("message","synthetic rejection"),"api-v1",false);rejected.finish();
                assertEquals(2,lines.size());
                assertTrue(lines.get(1).contains("Response failed! HTTP "+status[0]));
                assertTrue(lines.get(1).contains("reason="+error.getValue()));
            }
        } finally {
            logger.removeHandler(capture);
            if(previousFormat==null) System.clearProperty("openbexi.timeline.logFormat");else System.setProperty("openbexi.timeline.logFormat",previousFormat);
            if(previousValues==null) System.clearProperty("openbexi.timeline.logQueryValues");else System.setProperty("openbexi.timeline.logQueryValues",previousValues);
        }
    }

    @Test void separatesNestedCountsReportsLogicalFailureAndRedactsUserContent() {
        List<String> lines=new ArrayList<>();Logger logger=Logger.getLogger(TimelineRequestLog.class.getName());
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
            assertEquals(Map.of("sessions",2L,"events",2L),TimelineRequestLog.counts(records));
            TimelineRequestLog log=TimelineRequestLog.begin(req,res);
            log.sent(Map.of("events",records,"timelineMatch",Map.of("complete",false,"error","private error")),"json_file",false);log.finish();
            assertEquals(3,lines.size());String line=lines.stream().filter(s->s.startsWith("timeline {")).findFirst().orElseThrow();
            assertTrue(line.contains("\"outcome\":\"failed\""));assertTrue(line.contains("\"eventsReturned\":2"));
            assertTrue(line.contains("\"sessionsReturned\":2"));assertTrue(line.contains("\"recordsExamined\":\"unknown\""));
            assertTrue(line.contains("synthetic-load"));assertFalse(line.contains("private"));assertNotNull(headers.get("X-Request-ID"));
            assertFalse(String.join("\n",lines).contains("private"));
            assertTrue(lines.get(0).contains("filter=%5Bredacted%5D"));
            assertTrue(lines.get(2).contains("Response failed! HTTP 200"));
        } finally {logger.removeHandler(capture);}
    }
}
