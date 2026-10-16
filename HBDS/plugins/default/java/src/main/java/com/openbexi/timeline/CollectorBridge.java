package com.openbexi.timeline;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.json.*;
/** File request/result protocol, version 1. Logs never contain the result stream. */
public final class CollectorBridge {
    public static void main(String[] arguments) throws Exception {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        JSONObject request = new JSONObject(Files.readString(Path.of(arguments[0])));
        Path root = Path.of(request.getString("output_root"));
        String namespace = request.getString("namespace");
        LocalDate first = LocalDate.parse(request.getString("start"));
        LocalDate last = LocalDate.parse(request.getString("end"));
        long seed = request.getLong("seed");
        int count = request.getInt("count");
        if (count < 1 || count > 100000 || last.isBefore(first) || last.toEpochDay() - first.toEpochDay() > 366)
            throw new IllegalArgumentException("Generation bounds exceeded");
        JSONArray reports = new JSONArray();
        for (LocalDate day = first; !day.isAfter(last); day = day.plusDays(1)) {
            Path output = root.resolve(day.toString().replace('-', '/'));
            Files.createDirectories(output);
            Date date = Date.from(day.atStartOfDay(ZoneOffset.UTC).toInstant());
            new event_generator(namespace, date, output, seed ^ day.toEpochDay()).generate_simple(output.resolve("events.json").toFile(), count);
            // The legacy writer allows trailing commas. Publish strict JSON at the protocol boundary.
            Files.writeString(output.resolve("events.json"), new JSONObject(Files.readString(output.resolve("events.json"))).toString());
            reports.put(root.relativize(output.resolve("events.json")).toString());
            if (request.optBoolean("zones")) {
                // Separate random streams prevent zone IDs colliding with session/activity IDs.
                new event_generator_zone(namespace, date, seed ^ day.toEpochDay() ^ 0x5deece66dL).generate_zones(output.resolve("zones.json").toFile());
                Files.writeString(output.resolve("zones.json"), new JSONObject(Files.readString(output.resolve("zones.json"))).toString());
                reports.put(root.relativize(output.resolve("zones.json")).toString());
            }
        }
        Files.writeString(Path.of(arguments[1]), new JSONObject().put("api_version", 1).put("reports", reports).toString());
    }
}
