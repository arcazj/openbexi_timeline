package com.openbexi.timeline.websockets;


import com.openbexi.timeline.tests.test_timeline;

import javax.websocket.*;
import javax.websocket.server.ServerEndpoint;
import java.util.List;
import java.util.Map;
import java.util.logging.Logger;


@ServerEndpoint("/openbexi_timeline_ws/sessions")
public class ob_websocket_timeline {
    int id = 0;
    Logger logger = Logger.getLogger("");

    @OnOpen
    public void onOpen() {
        logger.severe("WS - onOpen ...");
    }

    @OnClose
    public void onClose() {
        logger.severe("WS - onClose. ");
    }

    @OnMessage
    public void onMessage(String message, Session session) {
        Logger logger = Logger.getLogger("");
        logger.info("WS - onMessage " + message);

        // Read parameters
        Map<String, List<String>> params = session.getRequestParameterMap();
        List<String> startDate = params.get("startDate");
        List<String> endDate = params.get("endDate");
        logger.info("GET - startDate=" + startDate.get(0));
        logger.info("GET - endDate=" + endDate.get(0));

        test_timeline tests = new test_timeline("message", null, session, id++);
        tests.run();
    }

    @OnError
    public void onError(Throwable e) {
        logger.severe("WS - onError:" + e.getMessage());
    }

}