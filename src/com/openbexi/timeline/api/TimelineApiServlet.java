package com.openbexi.timeline.api;

import org.json.*;
import javax.servlet.ServletException;
import javax.servlet.http.*;
import java.io.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Versioned resource API, deliberately independent of the legacy mutable request configuration. */
public final class TimelineApiServlet extends HttpServlet {
    private TimelineRepository repository;
    private Path root;
    private String adminToken, writeToken, readToken;
    private Set<String> corsOrigins;
    public TimelineApiServlet() {}
    public TimelineApiServlet(Path root, Path data, String admin, String writer, String reader) throws IOException {
        configure(root, data, admin, writer, reader, "");
    }
    @Override public void init() throws ServletException {
        if (repository != null) return;
        try {
            Path root = Paths.get(System.getProperty("openbexi.api.root", "."));
            String data = setting("openbexi.api.dataDir", "OPENBEXI_API_DATA_DIR", Paths.get(System.getProperty("user.home"), ".openbexi-timeline", "api").toString());
            configure(root, Paths.get(data), System.getenv("OPENBEXI_API_TOKEN"), System.getenv("OPENBEXI_API_WRITE_TOKEN"),
                    System.getenv("OPENBEXI_API_READ_TOKEN"), System.getenv("OPENBEXI_API_CORS_ORIGINS"));
        } catch (IOException | RuntimeException e) { throw new ServletException("Unable to initialize Timeline REST API", e); }
    }
    private static String setting(String property, String env, String fallback) {
        return System.getProperty(property, System.getenv(env) == null ? fallback : System.getenv(env));
    }
    private void configure(Path root, Path data, String admin, String writer, String reader, String origins) throws IOException {
        this.root = root.toRealPath(); repository = new TimelineRepository(root, data);
        adminToken = token(admin); writeToken = token(writer); readToken = token(reader);
        corsOrigins = origins == null || origins.isBlank() ? Set.of() : Set.copyOf(Arrays.asList(origins.trim().split("\\s*,\\s*")));
    }
    private static String token(String value) {
        if (value == null || value.isBlank()) return null;
        if (value.length() < 32) throw new IllegalArgumentException("API tokens must contain at least 32 characters.");
        return value;
    }
    private static boolean matches(String actual, String expected) {
        return expected != null && MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
    }
    private int role(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null) return 0;
        if (!header.startsWith("Bearer ")) throw new ApiException(401, "Use Bearer authentication.");
        String token = header.substring(7);
        if (matches(token, adminToken)) return 3;
        if (matches(token, writeToken)) return 2;
        if (matches(token, readToken)) return 1;
        throw new ApiException(401, "Invalid API credentials.");
    }
    private static void require(int role, int needed) {
        if (role < needed) throw new ApiException(role == 0 ? 401 : 403, "This operation requires " + (needed == 3 ? "administrator" : needed == 2 ? "writer" : "reader") + " access.");
    }
    @Override protected void service(HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setCharacterEncoding("UTF-8");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Vary", "Origin, Authorization");
        try {
            String origin = request.getHeader("Origin");
            if (origin != null && corsOrigins.contains(origin)) {
                response.setHeader("Access-Control-Allow-Origin", origin);
                response.setHeader("Access-Control-Expose-Headers", "ETag, Location");
            }
            if (request.getMethod().equals("OPTIONS")) {
                if (origin != null && !corsOrigins.contains(origin)) throw new ApiException(403, "Cross-origin API access is not configured for this origin.");
                response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
                response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match, If-None-Match");
                response.setStatus(204); return;
            }
            route(request, response, role(request));
        } catch (ApiException e) { problem(request, response, e.status, e.getMessage()); }
        catch (JSONException | IllegalArgumentException e) { problem(request, response, 400, "Malformed JSON, parameter, or resource path."); }
        catch (Exception e) {
            log("Timeline API request failed", e);
            problem(request, response, 500, "The request could not be completed. No partial edit was saved.");
        }
    }
    private static void problem(HttpServletRequest request, HttpServletResponse response, int status, String detail) throws IOException {
        response.setStatus(status); response.setContentType("application/problem+json");
        if (status == 405 && !response.containsHeader("Allow")) response.setHeader("Allow", "GET, HEAD, OPTIONS");
        if (status == 401) response.setHeader("WWW-Authenticate", "Bearer realm=\"OpenBEXI API\"");
        JSONObject body = new JSONObject().put("type", "about:blank").put("title", switch (status) {
            case 400 -> "Bad Request"; case 401 -> "Unauthorized"; case 403 -> "Forbidden"; case 404 -> "Not Found";
            case 405 -> "Method Not Allowed"; case 409 -> "Conflict"; case 412 -> "Precondition Failed";
            case 413 -> "Content Too Large"; case 415 -> "Unsupported Media Type"; case 422 -> "Unprocessable Content";
            case 428 -> "Precondition Required"; default -> "Internal Server Error";
        }).put("status", status).put("detail", detail).put("instance", request.getRequestURI());
        if (!request.getMethod().equals("HEAD")) response.getWriter().write(body.toString());
    }
    private void route(HttpServletRequest req, HttpServletResponse res, int role) throws IOException {
        String path = Optional.ofNullable(req.getPathInfo()).orElse("");
        String[] parts = path.replaceFirst("^/", "").split("/", -1);
        String method = req.getMethod(); boolean get = method.equals("GET") || method.equals("HEAD");
        if (parts.length == 1 && (parts[0].isEmpty() || parts[0].equals("health"))) {
            readOnly(get, res);
            send(req, res, 200, new JSONObject().put("status", "ok").put("apiVersion", "1")
                    .put("applicationVersion", "1.1").put("openapi", "/api/v1/openapi.json")
                    .put("datasets", "/api/v1/datasets").put("models", "/api/v1/models")
                    .put("writesConfigured", adminToken != null || writeToken != null), null); return;
        }
        if (parts.length == 1 && parts[0].equals("openapi.json")) {
            readOnly(get, res); send(req, res, 200, new JSONObject(Files.readString(root.resolve("swagger/openapi-v1.json"))), null); return;
        }
        if (parts.length == 1 && (parts[0].equals("datasets") || parts[0].equals("models"))) {
            if (get) { send(req, res, 200, new JSONObject().put("items", repository.list(role > 0)), null); return; }
            if (parts[0].equals("datasets") && method.equals("POST")) {
                require(role, 3); JSONObject created = repository.create(body(req));
                res.setHeader("Location", "/api/v1/datasets/" + created.getString("id"));
                send(req, res, 201, repository.metadata(created), TimelineRepository.etag(created)); return;
            }
            methodNotAllowed(res, parts[0].equals("datasets") ? "GET, HEAD, POST" : "GET, HEAD");
        }
        if (parts.length < 2 || !(parts[0].equals("datasets") || parts[0].equals("models"))) throw new ApiException(404, "Resource not found.");
        String id = TimelineRepository.validId(parts[1]);
        if (!repository.isPublic(id)) require(role, 1);
        JSONObject dataset = repository.read(id);
        if (parts[0].equals("models")) {
            if (parts.length != 2) throw new ApiException(404, "Resource not found.");
            if (get) { send(req, res, 200, dataset.getJSONObject("model"), TimelineRepository.etag(dataset)); return; }
            if (!method.equals("PUT")) methodNotAllowed(res, "GET, HEAD, PUT");
            require(role, 3); JSONObject model = repository.models.validate(body(req));
            JSONObject updated = repository.mutate(id, req.getHeader("If-Match"), value -> {
                if (value.getJSONArray("events").length() > 0 && !TimelineRecords.axis(value.getJSONObject("model")).similar(TimelineRecords.axis(model)))
                    throw new ApiException(409, "A populated dataset's time axis cannot be reinterpreted. Create another dataset for a different axis.");
                return value.put("model", repository.models.canonical(model));
            });
            send(req, res, 200, updated.getJSONObject("model"), TimelineRepository.etag(updated)); return;
        }
        if (parts.length == 2) {
            if (get) { send(req, res, 200, repository.metadata(dataset), TimelineRepository.etag(dataset)); return; }
            if (!Set.of("PATCH", "DELETE").contains(method)) methodNotAllowed(res, "GET, HEAD, PATCH, DELETE");
            require(role, 3); JSONObject patch = method.equals("PATCH") ? body(req) : null;
            if (patch != null && !Set.of("title", "description").containsAll(patch.keySet())) throw new ApiException(422, "Only title and description can be changed here.");
            JSONObject updated = repository.mutate(id, req.getHeader("If-Match"), value -> {
                if (patch == null) return null;
                for (String key : patch.keySet()) {
                    if (!(patch.get(key) instanceof String)) throw new ApiException(422, key + " must be a string.");
                    value.put(key, patch.get(key));
                }
                return value;
            });
            send(req, res, patch == null ? 204 : 200, updated == null ? null : repository.metadata(updated), updated == null ? null : TimelineRepository.etag(updated)); return;
        }
        String collection = parts[2];
        if (!Set.of("events", "sessions", "filters").contains(collection) || parts.length > 4 || (parts.length == 4 && parts[3].isEmpty())) throw new ApiException(404, "Resource not found.");
        boolean filters = collection.equals("filters"), sessions = collection.equals("sessions");
        String itemId = parts.length == 4 ? parts[3] : null;
        JSONArray items = dataset.getJSONArray(filters ? "filters" : "events");
        if (get) {
            Object result;
            if (itemId != null) result = item(items, itemId, sessions);
            else if (filters) result = new JSONObject().put("items", items).put("total", items.length());
            else result = query(dataset, req, sessions);
            send(req, res, 200, result, TimelineRepository.etag(dataset)); return;
        }
        if (itemId == null && !method.equals("POST")) methodNotAllowed(res, "GET, HEAD, POST");
        if (itemId != null && !Set.of("PUT", "PATCH", "DELETE").contains(method)) methodNotAllowed(res, "GET, HEAD, PUT, PATCH, DELETE");
        require(role, 2);
        JSONObject input = method.equals("DELETE") ? null : body(req);
        if (itemId == null && !input.has("id")) input.put("id", UUID.randomUUID().toString());
        final String target = itemId == null ? input.optString("id") : itemId;
        JSONObject updated = repository.mutate(id, req.getHeader("If-Match"), value -> {
            JSONArray records = value.getJSONArray(filters ? "filters" : "events");
            int index = index(records, target);
            if (itemId == null && index >= 0) throw new ApiException(409, "Record id already exists.");
            if (itemId != null) item(records, target, sessions);
            if (input == null) { records.remove(index); return value; }
            JSONObject replacement = method.equals("PATCH") ? TimelineRecords.merge(records.getJSONObject(index), input) : TimelineRecords.copy(input);
            if (replacement.has("id") && !target.equals(replacement.optString("id"))) throw new ApiException(422, "Record id is immutable.");
            replacement.put("id", target);
            if (filters) validateFilter(replacement, TimelineRecords.axis(value.getJSONObject("model")));
            else {
                TimelineRecords.validate(replacement, TimelineRecords.axis(value.getJSONObject("model")), 0);
                if (sessions && !TimelineRecords.session(replacement)) throw new ApiException(422, "A session needs an end, activities, or data.kind=session.");
            }
            if (index < 0) records.put(replacement); else records.put(index, replacement);
            return value;
        });
        if (itemId == null) res.setHeader("Location", "/api/v1/datasets/" + id + "/" + collection + "/" + URLEncoder.encode(target, StandardCharsets.UTF_8).replace("+", "%20"));
        send(req, res, input == null ? 204 : itemId == null ? 201 : 200,
                input == null ? null : item(updated.getJSONArray(filters ? "filters" : "events"), target, sessions), TimelineRepository.etag(updated));
    }
    private static int index(JSONArray items, String id) {
        for (int i = 0; i < items.length(); i++) if (id.equals(items.getJSONObject(i).optString("id"))) return i;
        return -1;
    }
    private static JSONObject item(JSONArray items, String id, boolean session) {
        int index = index(items, id);
        if (index < 0 || (session && !TimelineRecords.session(items.getJSONObject(index)))) throw new ApiException(404, "Record not found.");
        return items.getJSONObject(index);
    }
    private static JSONObject body(HttpServletRequest req) throws IOException {
        String type = Optional.ofNullable(req.getContentType()).orElse("").split(";", 2)[0].trim();
        if (!type.equals("application/json") && !(req.getMethod().equals("PATCH") && type.equals("application/merge-patch+json")))
            throw new ApiException(415, "Send application/json (or application/merge-patch+json for PATCH).");
        byte[] content = req.getInputStream().readNBytes(2 * 1024 * 1024 + 1);
        if (content.length > 2 * 1024 * 1024) throw new ApiException(413, "JSON request exceeds 2 MiB.");
        JSONTokener parser = new JSONTokener(new String(content, StandardCharsets.UTF_8));
        JSONObject result = new JSONObject(parser);
        if (parser.nextClean() != 0) throw new ApiException(400, "Unexpected content after JSON object.");
        return result;
    }
    private static final Set<String> QUERY = Set.of("from", "to", "search", "namespace", "kind");
    private static void validateFilter(JSONObject filter, JSONObject axis) {
        String id = filter.optString("id");
        if (!id.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,159}")) throw new ApiException(422, "Filter id must be path-safe.");
        if (!(filter.opt("title") instanceof String) || filter.optString("title").isBlank()) throw new ApiException(422, "Filter title must be a nonempty string.");
        JSONObject query = filter.optJSONObject("query");
        if (query == null || !QUERY.containsAll(query.keySet())) throw new ApiException(422, "Filter query accepts from, to, search, namespace, and kind.");
        queryValues(query, axis);
    }
    private static double[] queryValues(JSONObject params, JSONObject axis) {
        double from = params.has("from") ? TimelineRecords.coordinate(params.get("from"), axis) : Double.NEGATIVE_INFINITY;
        double to = params.has("to") ? TimelineRecords.coordinate(params.get("to"), axis) : Double.POSITIVE_INFINITY;
        if (from > to) throw new ApiException(422, "from must precede to along the dataset's time axis.");
        for (String key : List.of("search", "namespace", "kind")) if (params.has(key) && (!(params.get(key) instanceof String) || params.getString(key).length() > 500))
            throw new ApiException(422, key + " must be text of at most 500 characters.");
        if (params.has("kind") && !Set.of("event", "session", "zone").contains(params.getString("kind"))) throw new ApiException(422, "kind must be event, session, or zone.");
        return new double[]{from, to};
    }
    private static JSONObject query(JSONObject dataset, HttpServletRequest req, boolean sessions) {
        Set<String> allowed = new HashSet<>(QUERY); allowed.addAll(List.of("offset", "limit", "filterId"));
        for (String key : req.getParameterMap().keySet()) if (!allowed.contains(key) || req.getParameterValues(key).length != 1)
            throw new ApiException(400, "Unknown or repeated query parameter: " + key);
        JSONObject params = req.getParameter("filterId") == null ? new JSONObject() :
                TimelineRecords.copy(item(dataset.getJSONArray("filters"), req.getParameter("filterId"), false).getJSONObject("query"));
        for (String key : QUERY) if (req.getParameter(key) != null) params.put(key, req.getParameter(key));
        JSONObject axis = TimelineRecords.axis(dataset.getJSONObject("model"));
        double[] bounds = queryValues(params, axis);
        String search = params.optString("search").toLowerCase(Locale.ROOT), namespace = params.optString("namespace"), kind = params.optString("kind");
        int offset = integer(req.getParameter("offset"), 0, 0, Integer.MAX_VALUE), limit = integer(req.getParameter("limit"), 100, 1, 1000);
        List<JSONObject> result = new ArrayList<>();
        for (Object value : dataset.getJSONArray("events")) {
            JSONObject event = (JSONObject) value;
            String eventKind = event.optBoolean("zone") ? "zone" : TimelineRecords.session(event) ? "session" : "event";
            if (sessions && !eventKind.equals("session") || !kind.isEmpty() && !kind.equals(eventKind)) continue;
            if (!namespace.isEmpty() && !namespace.equals(event.optString("namespace"))) continue;
            if (!search.isEmpty() && !event.toString().toLowerCase(Locale.ROOT).contains(search)) continue;
            double start = TimelineRecords.coordinate(event.get("start"), axis), end = TimelineRecords.coordinate(event.opt("end") == null ? event.get("start") : event.get("end"), axis);
            if (start > bounds[1] || end < bounds[0]) continue;
            result.add(event);
        }
        result.sort(Comparator.comparingDouble((JSONObject event) -> TimelineRecords.coordinate(event.get("start"), axis)).thenComparing(event -> event.getString("id")));
        JSONArray page = new JSONArray();
        for (long i = offset; i < Math.min(result.size(), (long) offset + limit); i++) page.put(result.get((int) i));
        return new JSONObject().put("items", page).put("total", result.size()).put("offset", offset).put("limit", limit)
                .put("nextOffset", (long) offset + limit < result.size() ? offset + limit : JSONObject.NULL).put("timeAxis", axis);
    }
    private static int integer(String value, int fallback, int min, int max) {
        if (value == null) return fallback;
        try { int result = Integer.parseInt(value); if (result >= min && result <= max) return result; }
        catch (NumberFormatException ignored) {}
        throw new ApiException(400, "Invalid pagination: limit must be 1..1000 and offset must be nonnegative.");
    }
    private static void readOnly(boolean get, HttpServletResponse res) { if (!get) methodNotAllowed(res, "GET, HEAD"); }
    private static void methodNotAllowed(HttpServletResponse res, String allow) { res.setHeader("Allow", allow + ", OPTIONS"); throw new ApiException(405, "Method is not supported for this resource."); }
    private static void send(HttpServletRequest req, HttpServletResponse res, int status, Object body, String etag) throws IOException {
        if (etag != null) {
            res.setHeader("ETag", etag);
            if ((req.getMethod().equals("GET") || req.getMethod().equals("HEAD")) && etag.equals(req.getHeader("If-None-Match"))) { res.setStatus(304); return; }
        }
        res.setStatus(status); res.setContentType("application/json");
        if (status != 204 && !req.getMethod().equals("HEAD") && body != null) res.getWriter().write(body.toString());
    }
}
