package com.openbexi.timeline.servlets;

import com.openbexi.timeline.data_browser.SourceRevision;
import com.openbexi.timeline.data_browser.data_configuration;
import org.json.simple.JSONObject;
import javax.servlet.http.*;
import java.io.*;
import java.util.Map;

/** SSE invalidations: each revision is reconciled through bounded data requests. */
final class TimelineLiveUpdates {
    static void stream(HttpServletRequest request,HttpServletResponse response,data_configuration configuration) throws IOException {
        response.setContentType("text/event-stream");response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control","no-cache");response.setHeader("X-Accel-Buffering","no");
        PrintWriter out=response.getWriter();
        String last=request.getHeader("Last-Event-ID");
        out.write("retry: 2000\n\n");out.flush();
        while(!Thread.currentThread().isInterrupted()) {
            try {
                String revision=SourceRevision.current(configuration);
                if(!revision.equals(last)) {
                    out.write("id: "+revision+"\ndata: "+new JSONObject(Map.of("revision",revision))+"\n\n");
                    last=revision;
                } else out.write(": heartbeat\n\n");
                out.flush();if(out.checkError())break;
                Thread.sleep(1000);
            } catch(InterruptedException interrupted) {Thread.currentThread().interrupt();break;}
            catch(IOException error) {
                out.write("event: timeline-error\ndata: {\"error\":\"Live source inventory unavailable. Use Refresh to retry.\"}\n\n");
                out.flush();break;
            }
        }
    }
}
