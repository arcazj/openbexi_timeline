package servlets.ob_sse;

import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.logging.Logger;

@WebServlet("/push")
public class sse_timeline extends HttpServlet {

    public sse_timeline() {
        super();
    }

    test_timeline tests = null;
    int id = 0;

    @Override
    public void init() throws ServletException {
        super.init();
    }

    @Override
    public void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        Logger logger = Logger.getLogger("");
        logger.info("GET " + req);
        try {
            tests = new test_timeline("GET", resp, null, id++);
            tests.run();
        } catch (Exception e) {
            logger.severe(e.getMessage());
        }
    }

    @Override
    protected long getLastModified(HttpServletRequest req) {
        return super.getLastModified(req);
    }

    @Override
    protected void doHead(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        super.doHead(req, resp);
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        Logger logger = Logger.getLogger("");
        logger.info("POST " + req);
        try {
            tests = new test_timeline("POST", resp, null, id++);
            tests.run();
        } catch (Exception e) {
            logger.severe(e.getMessage());
        }
    }

    @Override
    protected void doPut(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
    }

    @Override
    protected void doDelete(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
    }

    @Override
    protected void doOptions(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        super.doOptions(req, resp);
    }

    @Override
    protected void doTrace(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        super.doTrace(req, resp);
    }

    @Override
    protected void service(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        super.service(req, resp);
    }

    @Override
    public void service(ServletRequest req, ServletResponse res) throws ServletException, IOException {
        super.service(req, res);
    }

}
