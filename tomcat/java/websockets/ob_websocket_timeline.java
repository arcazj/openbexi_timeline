package websockets;


import servlets.ob_sse.test_timeline;

import javax.websocket.*;
import javax.websocket.server.ServerEndpoint;
import java.util.logging.Logger;


@ServerEndpoint("/websocket")
public class ob_websocket_timeline {
    test_timeline tests = null;
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
        tests = new test_timeline("message", null, session, id++);
        tests.run();
    }

    @OnError
    public void onError(Throwable e) {
        logger.severe("WS - onError:" + e.getMessage());
    }

}