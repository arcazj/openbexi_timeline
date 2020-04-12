package servlets.ob_sse;

import javax.servlet.http.HttpServletResponse;
import javax.websocket.Session;
import java.io.IOException;
import java.io.PrintWriter;
import java.util.Date;
import java.util.Random;
import java.util.logging.Logger;

public class test_timeline implements Runnable {
    private HttpServletResponse resp;
    private Session sess;
    private String action;
    private int ob_id = 0;

    public test_timeline(String action_type, HttpServletResponse response, Session session, int id) {
        resp = response;
        sess = session;
        action = action_type;
        ob_id = id;
    }

    public HttpServletResponse getResp() {
        return resp;
    }

    public void setResp(HttpServletResponse resp) {
        this.resp = resp;
    }

    public String getAction() {
        return action;
    }

    public void setAction(String action) {
        this.action = action;
    }

    public String getData() {
        Logger logger = Logger.getLogger("");
        Random rand = new Random();
        long z = 0;
        String ob_data = "", ob_data_start, ob_data_end;
        ob_data_start = "{'dateTimeFormat': 'iso8601','events' : [";
        long ob_time = new Date().getTime();
        for (int i = 0; i < rand.nextInt(50) + rand.nextInt(50); i++) {
            Date ob_start_time = new Date(ob_time);
            Date ob_end_time1 = new Date(ob_time + 200000);
            Date ob_end_time2 = new Date(ob_time + 3000000);
            Date ob_end_time3 = new Date(ob_time + 4000000);
            Date ob_end_time4 = new Date(ob_time + 5000000);
            Date ob_end_time5 = new Date(ob_time + 6000000);
            ob_time += 2500000 + rand.nextInt(100000);
            ob_data += "{'start': '" + ob_start_time + "','end': '" + ob_end_time1 + "','title': 'session_test_" + z++ + "','durationEvent': true}," +
                    "{'start': '" + ob_start_time + "','end': '" + ob_end_time2 + "','title': 'session_test_" + z++ + "','durationEvent': true}," +
                    "{'start': '" + ob_end_time2 + "','end': '" + ob_end_time3 + "','title': 'session_test_" + z++ + "','durationEvent': true}," +
                    "{'start': '" + ob_start_time + "','end': '','title': 'event_" + rand.nextInt(100000) + "','durationEvent': true}," +
                    "{'start': '" + ob_end_time2 + "','end': '','title': 'event_" + rand.nextInt(100000) + "','durationEvent': true}," +
                    "{'start': '" + ob_start_time + "','end': '" + ob_end_time5 + "','title': 'session_test_" + z++ + "','durationEvent': true}," +
                    "{'start': '" + ob_end_time3 + "','end': '','title': 'event_" + rand.nextInt(100000) + "','durationEvent': true}," +
                    "{'start': '" + ob_end_time1 + "','end': '','title': 'event_" + rand.nextInt(100000) + "','durationEvent': true}," +
                    "{'start': '" + ob_end_time3 + "','end': '" + ob_end_time4 + "','title': 'session_test_" + z++ + "','durationEvent': true}," +
                    "{'start': '" + ob_end_time4 + "','end': '" + ob_end_time5 + "','title': 'session_test_" + z++ + "','durationEvent': true}," +
                    "{'start': '" + ob_end_time4 + "','end': '','title': 'event_" + rand.nextInt(100000) + "','durationEvent': true}," +
                    "{'start': '" + ob_start_time + "','end': '','title': 'event_" + rand.nextInt(100000) + "','durationEvent': true}," +
                    "{'start': '" + ob_start_time + "','end': '" + ob_end_time3 + "','title': 'session_test_" + z++ + "','durationEvent': true}," +
                    "{'start': '" + ob_end_time3 + "','end': '','title': 'event_" + rand.nextInt(100000) + "','durationEvent': true},";
        }
        ob_data_end = "]}\n\n";
        logger.info("SEND ( client " + ob_id + ") - " + z * 2 + " sessions/events");
        return ob_data_start + ob_data + ob_data_end;
    }

    ;

    @Override
    public void run() {
        Logger logger = Logger.getLogger("");
        Random rand = new Random();
        int x = 1;

        while (x == 1) {
            long z = 0;
            //=======================
            // Websocket
            //=======================
            if (sess != null) {
                try {
                    sess.getBasicRemote().sendText(getData());
                } catch (IOException e) {
                    logger.severe(e.getMessage());
                }
            }

            //=======================
            // SSE
            //=======================
            if (resp != null) {
                try {
                    PrintWriter respWriter = resp.getWriter();
                    //Important to put a "," not ";" between stream and charset
                    resp.setContentType("text/event-stream, charset=UTF-8");
                    //Important, otherwise only  test URL  like https://localhost:8443/openbexi_timeline.html works
                    resp.addHeader("Access-Control-Allow-Origin", "*");
                    // If clients have set Access-Control-Allow-Credentials to true, the server will not permit the use of
                    // credentials and access to resource by the client will be blocked by CORS policy.
                    resp.addHeader("Access-Control-Allow-Credentials", "true");
                    resp.addHeader("Cache-Control", "no-cache");
                    resp.addHeader("Connection", "keep-alive");
                    respWriter.write("event: ob_timeline\n\n");
                    respWriter.write("data:" + getData());
                    respWriter.write("retry: 10000\n\n");
                    respWriter.flush();
                    boolean error = respWriter.checkError();
                    if (error == true) {
                        logger.info("Client disconnected");
                        break;
                    }
                } catch (IOException e) {
                    logger.severe(e.getMessage());
                }
            }
            try {
                Thread.currentThread().sleep(rand.nextInt(30000));
            } catch (InterruptedException e) {
                logger.severe(e.getMessage());
            }
        }
    }
}
