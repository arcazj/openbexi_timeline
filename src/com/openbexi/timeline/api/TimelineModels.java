package com.openbexi.timeline.api;

import org.everit.json.schema.Schema;
import org.everit.json.schema.ValidationException;
import org.everit.json.schema.loader.SchemaLoader;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;

/** The browser and Java API use the same checked-in model schema. */
public final class TimelineModels {
    private static final double MAX_BROWSER_TIME = 8.64e15;
    private static final Pattern NUMERIC_VALUE = Pattern.compile("^[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[-+]?\\d+)?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern SCHEMA_KEY = Pattern.compile("^(?:required|extraneous) key \\[(.*)]");
    private final Schema schema;
    public TimelineModels(Path root) throws IOException {
        JSONObject definition = new JSONObject(Files.readString(root.resolve("schemas/demo-model.schema.json")));
        schema = SchemaLoader.builder().schemaJson(definition).draftV7Support().build().load().build();
    }
    public JSONObject validate(JSONObject model) {
        try { schema.validate(model); }
        catch (ValidationException e) {
            List<String> errors = new ArrayList<>();
            schemaErrors(e, errors);
            throw new ApiException(422, String.join("; ", errors));
        }
        JSONObject axis = TimelineRecords.axis(model);
        boolean numeric = TimelineRecords.numeric(axis);
        List<String> errors = new ArrayList<>();
        Set<String> names = new HashSet<>();
        JSONArray bands = model.getJSONArray("bands");
        Map<String, JSONObject> normalBands = new HashMap<>();
        for (Object value : bands) {
            JSONObject band = (JSONObject) value;
            if (!overview(band)) normalBands.put(band.getString("name"), band);
        }
        if (normalBands.isEmpty()) errors.add("$.bands must include a normal band");
        JSONObject params = model.getJSONArray("params").getJSONObject(0);
        time(params.get("date"), axis, "$.params[0].date", errors);
        for (int i = 0; i < bands.length(); i++) {
            JSONObject band = bands.getJSONObject(i);
            String path = "$.bands[" + i + "]";
            if (!names.add(band.getString("name"))) errors.add(path + ".name must be unique");
            if (band.get("height") instanceof String && Double.parseDouble(band.getString("height").replace("%", "")) > 100)
                errors.add(path + ".height must not exceed 100%");
            for (String key : List.of("range", "context")) if (band.has(key)) checkRange(band.getJSONObject(key), axis, path + "." + key, errors);
            checkTickOptions(band, numeric, path, errors);
            Object focus = band.opt("focus");
            if (focus instanceof JSONObject) {
                checkRange((JSONObject) focus, axis, path + ".focus", errors);
                checkTickOptions((JSONObject) focus, numeric, path + ".focus", errors);
            } else if (focus instanceof JSONArray) {
                JSONArray intervals = (JSONArray) focus;
                for (int j = 0; j < intervals.length(); j++) {
                    String focusPath = path + ".focus[" + j + "]";
                    checkRange(intervals.getJSONObject(j), axis, focusPath, errors);
                    checkTickOptions(intervals.getJSONObject(j), numeric, focusPath, errors);
                }
            }
            JSONArray sources = band.optJSONArray("sourceBands");
            if (sources != null) {
                if (!overview(band)) errors.add(path + ".sourceBands is only supported on Overview bands");
                for (int j = 0; j < sources.length(); j++) {
                    JSONObject source = normalBands.get(sources.getString(j));
                    String sourcePath = path + ".sourceBands[" + j + "]";
                    if (source == null) errors.add(sourcePath + " must reference an existing normal band");
                    else if (source.has("groupBy")) errors.add(sourcePath + " cannot select a generated group band; omit sourceBands to project all groups");
                }
            }
            JSONObject secondary = band.optJSONObject("secondaryScale");
            if (secondary != null) {
                if (numeric) errors.add(path + ".secondaryScale elapsedYears requires a calendar axis");
                time(secondary.get("origin"), new JSONObject(), path + ".secondaryScale.origin", errors);
            }
        }
        if (params.optBoolean("dockOverview") && !overview(bands.getJSONObject(bands.length() - 1)))
            errors.add("$.params[0].dockOverview requires a trailing Overview band");
        JSONArray zones = model.getJSONObject("dataSource").optJSONArray("zones", new JSONArray());
        for (int i = 0; i < zones.length(); i++) {
            JSONObject zone = zones.getJSONObject(i);
            String path = "$.dataSource.zones[" + i + "]";
            double start = time(zone.get("start"), axis, path + ".start", errors);
            double end = time(zone.get("end"), axis, path + ".end", errors);
            if (Double.isFinite(start) && Double.isFinite(end) && end <= start)
                errors.add(path + ".end must follow start in the declared axis direction");
        }
        if (!errors.isEmpty()) throw new ApiException(422, String.join("; ", errors));
        return model;
    }

    private static boolean overview(JSONObject band) { return band.getString("name").contains("overview_"); }

    private static void checkTickOptions(JSONObject value, boolean numeric, String path, List<String> errors) {
        JSONObject ticks = value.optJSONObject("ticks");
        if (ticks != null) {
            String unit = ticks.getString("unit");
            if (numeric != "NUMERIC".equals(unit)) errors.add(path + ".ticks.unit " + (numeric ?
                    "must be NUMERIC for a numeric axis" : "NUMERIC requires dataSource.time.kind = \"numeric\""));
            double step = ticks.getDouble("step");
            if (Set.of("MONTH", "YEAR", "DECADE", "CENTURY").contains(unit) && step != Math.rint(step))
                errors.add(path + ".ticks.step must be an integer for a calendar month or year unit");
        }
        if (value.has("tickMinutes")) {
            if (numeric) errors.add(path + ".tickMinutes is only supported on calendar axes; use ticks.unit = \"NUMERIC\"");
            if (ticks != null) errors.add(path + ".tickMinutes cannot be combined with ticks");
        }
    }

    private static void checkRange(JSONObject range, JSONObject axis, String path, List<String> errors) {
        double from = time(range.get("from"), axis, path + ".from", errors);
        double to = time(range.get("to"), axis, path + ".to", errors);
        if (Double.isFinite(from) && Double.isFinite(to) && to <= from)
            errors.add(path + ".to must follow from in the declared axis direction");
    }

    private static double time(Object value, JSONObject axis, String path, List<String> errors) {
        boolean numeric = TimelineRecords.numeric(axis);
        try {
            if (!numeric && value instanceof Number && (!Double.isFinite(((Number) value).doubleValue()) ||
                    Math.abs(((Number) value).doubleValue()) > MAX_BROWSER_TIME)) throw new IllegalArgumentException();
            // Dataset approximation prefixes are metadata, not model range values.
            if (numeric && !(value instanceof Number) && !NUMERIC_VALUE.matcher(value.toString().trim()).matches())
                throw new IllegalArgumentException();
            double coordinate = TimelineRecords.coordinate(value, axis);
            double milliseconds = numeric ? coordinate * axis.getDouble("millisecondsPerUnit") : coordinate;
            if (!Double.isFinite(milliseconds) || Math.abs(milliseconds) > MAX_BROWSER_TIME) throw new IllegalArgumentException();
            return coordinate;
        } catch (ApiException | IllegalArgumentException | ArithmeticException e) {
            errors.add(path + (numeric ? " must be a finite value in the declared numeric axis unit" : " must be a valid calendar date"));
            return Double.NaN;
        }
    }

    private static void schemaErrors(ValidationException error, List<String> errors) {
        if (!error.getCausingExceptions().isEmpty()) {
            for (ValidationException cause : error.getCausingExceptions()) schemaErrors(cause, errors);
            return;
        }
        String path = jsonPath(error.getPointerToViolation());
        Matcher property = SCHEMA_KEY.matcher(error.getErrorMessage());
        if (property.find()) path = appendProperty(path, property.group(1));
        errors.add(path + " " + error.getErrorMessage());
    }

    private static String jsonPath(String pointer) {
        StringBuilder path = new StringBuilder("$");
        String normalized = pointer == null ? "" : pointer.startsWith("#") ? pointer.substring(1) : pointer;
        for (String part : normalized.split("/", -1)) {
            if (part.isEmpty()) continue;
            String key = part.replace("~1", "/").replace("~0", "~");
            if (key.matches("\\d+")) path.append('[').append(key).append(']');
            else path = new StringBuilder(appendProperty(path.toString(), key));
        }
        return path.toString();
    }

    private static String appendProperty(String path, String key) {
        return path + (key.matches("[A-Za-z_$][\\w$]*") ? "." + key : "[" + JSONObject.quote(key) + "]");
    }
    public JSONObject canonical(JSONObject source) {
        JSONObject model = TimelineRecords.copy(source);
        JSONObject dataSource = new JSONObject().put("format", "json").put("recordsPath", "events");
        if (source.optJSONObject("dataSource", new JSONObject()).has("time")) dataSource.put("time", TimelineRecords.axis(source));
        model.put("dataSource", dataSource);
        // Connections and credentials are never copied into a public API model.
        for (Object item : model.getJSONArray("params")) ((JSONObject) item).put("data", "");
        return model;
    }
}
