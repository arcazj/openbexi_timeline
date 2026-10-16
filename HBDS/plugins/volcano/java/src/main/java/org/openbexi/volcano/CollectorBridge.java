package org.openbexi.volcano;
import java.nio.file.*;
import org.json.*;
public final class CollectorBridge {
    public static void main(String[] arguments) throws Exception {
        JSONObject request = new JSONObject(Files.readString(Path.of(arguments[0])));
        Path output = Path.of(request.getString("output_root"));
        Files.createDirectories(output);
        System.setProperty("timeline.output", output.toString());
        if (request.has("api_base")) System.setProperty("timeline.api", request.getString("api_base"));
        String[] args;
        if (request.has("input_file")) args = new String[]{"-jsonFilePath", request.getString("input_file")};
        else if (request.optBoolean("archive")) args = new String[]{"-all"};
        else args = new String[]{"-NewestOrRecent"};
        VolcanoJsonConverter.main(args);
        JSONArray reports = new JSONArray();
        try (var paths = Files.walk(output)) {
            for (Path path : paths.filter(Files::isRegularFile).sorted().toList()) {
                if (path.getFileName().toString().startsWith("volcano_") && path.toString().endsWith(".json"))
                    reports.put(output.relativize(path).toString());
            }
        }
        Files.writeString(Path.of(arguments[1]), new JSONObject().put("api_version", 1).put("reports", reports).toString());
    }
}
