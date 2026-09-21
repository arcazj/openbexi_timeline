package com.openbexi.timeline.api;

import javax.servlet.ServletException;
import javax.servlet.http.*;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;

/** Serves published browser assets without exposing the repository or deployment configuration. */
public final class PublicAssetServlet extends HttpServlet {
    private static final Set<String> BROWSER_EXTENSIONS = Set.of("js", "mjs", "css", "json", "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "woff", "woff2", "ttf", "otf", "wasm");
    private static final Set<String> ROOT_DOCUMENTS = Set.of("README.md", "LICENSE");
    private static final Map<String, String> CONTENT_TYPES = Map.ofEntries(
            Map.entry("html", "text/html"), Map.entry("css", "text/css"), Map.entry("txt", "text/plain"),
            Map.entry("xml", "application/xml"), Map.entry("svg", "image/svg+xml"), Map.entry("png", "image/png"),
            Map.entry("jpg", "image/jpeg"), Map.entry("jpeg", "image/jpeg"), Map.entry("gif", "image/gif"),
            Map.entry("webp", "image/webp"), Map.entry("avif", "image/avif"), Map.entry("ico", "image/x-icon"),
            Map.entry("woff", "font/woff"), Map.entry("woff2", "font/woff2"), Map.entry("ttf", "font/ttf"),
            Map.entry("otf", "font/otf"), Map.entry("wasm", "application/wasm"), Map.entry("pdf", "application/pdf"));
    private Path root;

    @Override public void init() throws ServletException {
        try {
            String base = getServletContext().getRealPath("/");
            if (base == null) throw new IOException("Exploded static document root is required.");
            root = Paths.get(base).toRealPath();
        } catch (IOException e) { throw new ServletException("Cannot initialize public assets.", e); }
    }

    private static boolean published(Path relative) {
        String filename = relative.getFileName().toString();
        String lower = filename.toLowerCase(Locale.ROOT);
        int dot = lower.lastIndexOf('.');
        String extension = dot < 0 ? "" : lower.substring(dot + 1);
        for (Path part : relative) {
            String segment = part.toString();
            if (segment.startsWith(".") || segment.contains(":") || segment.chars().anyMatch(c -> c < 32)) return false;
        }
        if (relative.getNameCount() == 1)
            return ROOT_DOCUMENTS.contains(filename) || Set.of("html", "png", "jpg", "jpeg", "svg", "ico").contains(extension);
        String folder = relative.getName(0).toString();
        return switch (folder) {
            case "src" -> relative.getNameCount() == 2 && Set.of("js", "mjs").contains(extension);
            case "node_modules", "icon", "css" -> BROWSER_EXTENSIONS.contains(extension);
            case "models", "demos", "help", "schemas" -> extension.equals("json");
            case "json" -> relative.getNameCount() > 2 && relative.getName(1).toString().equals("test-data")
                    && Set.of("json", "xml", "txt", "png").contains(extension);
            case "docs", "doc" -> Set.of("html", "md", "txt", "png", "jpg", "jpeg", "svg", "pdf", "css", "js").contains(extension);
            case "swagger" -> Set.of("json", "yaml", "yml", "html", "css", "js").contains(extension);
            case "tests" -> relative.getNameCount() == 2 && Set.of("timeline_views.html", "timeline_views.test.js").contains(filename);
            default -> false;
        };
    }

    private void serve(HttpServletRequest request, HttpServletResponse response, boolean head) throws IOException {
        response.setHeader("X-Content-Type-Options", "nosniff");
        String path = request.getServletPath();
        if (request.getPathInfo() != null) path += request.getPathInfo();
        if (path == null || path.equals("/") || path.isEmpty()) path = "/demos.html";
        try {
            if (path.contains("\\")) { response.sendError(404); return; }
            Path relative = Paths.get(path.startsWith("/") ? path.substring(1) : path);
            if (relative.isAbsolute() || !published(relative)) { response.sendError(404); return; }
            Path candidate = root.resolve(relative).normalize();
            if (!candidate.startsWith(root) || !Files.isRegularFile(candidate)) { response.sendError(404); return; }
            Path actual = candidate.toRealPath();
            // A symlink must resolve to another published file inside the same static root.
            if (!actual.startsWith(root) || !published(root.relativize(actual))) { response.sendError(404); return; }
            String name = actual.getFileName().toString();
            String mime = getServletContext().getMimeType(name);
            if (mime == null) mime = CONTENT_TYPES.get(name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT));
            if (name.endsWith(".js") || name.endsWith(".mjs")) mime = "text/javascript";
            else if (name.endsWith(".json")) mime = "application/json";
            else if (name.endsWith(".md") || name.endsWith(".yaml") || name.endsWith(".yml") || name.equals("LICENSE")) mime = "text/plain";
            response.setContentType(mime == null ? "application/octet-stream" : mime);
            if (mime != null && (mime.startsWith("text/") || mime.equals("application/json"))) response.setCharacterEncoding("UTF-8");
            response.setContentLengthLong(Files.size(actual));
            if (!head) try (var input = Files.newInputStream(actual, LinkOption.NOFOLLOW_LINKS)) { input.transferTo(response.getOutputStream()); }
        } catch (InvalidPathException | NoSuchFileException | AccessDeniedException e) { response.sendError(404); }
    }

    @Override protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException { serve(request, response, false); }
    @Override protected void doHead(HttpServletRequest request, HttpServletResponse response) throws IOException { serve(request, response, true); }
    @Override protected void doOptions(HttpServletRequest request, HttpServletResponse response) { response.setHeader("Allow", "GET, HEAD, OPTIONS"); }
    @Override protected void service(HttpServletRequest request, HttpServletResponse response) throws javax.servlet.ServletException, IOException {
        if (!Set.of("GET", "HEAD", "OPTIONS").contains(request.getMethod())) {
            response.setHeader("Allow", "GET, HEAD, OPTIONS"); response.sendError(405); return;
        }
        super.service(request, response);
    }
}
