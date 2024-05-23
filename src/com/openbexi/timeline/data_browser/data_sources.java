package com.openbexi.timeline.data_browser;

import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.representer.Representer;
import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.*;

class Filter {
    private String include;
    private String exclude;

    public String getInclude() {
        return include;
    }

    public void setInclude(String include) {
        this.include = include;
    }

    public String getExclude() {
        return exclude;
    }

    public void setExclude(String exclude) {
        this.exclude = exclude;
    }

    public JSONObject toJson() {
        JSONObject json = new JSONObject();
        json.put("include", include);
        json.put("exclude", exclude);
        return json;
    }

    public void fromJson(JSONObject jsonObject) {
        this.include = (String) jsonObject.get("include");
        this.exclude = (String) jsonObject.get("exclude");
    }

    public Map<String, Object> toMap() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("include", include);
        map.put("exclude", exclude);
        return map;
    }
}

class Render {
    private String color;
    private String textColor;
    private String dateColor;
    private String alternateColor;

    public String getColor() {
        return color;
    }

    public void setColor(String color) {
        this.color = color;
    }

    public String getTextColor() {
        return textColor;
    }

    public void setTextColor(String textColor) {
        this.textColor = textColor;
    }

    public String getDateColor() {
        return dateColor;
    }

    public void setDateColor(String dateColor) {
        this.dateColor = dateColor;
    }

    public String getAlternateColor() {
        return alternateColor;
    }

    public void setAlternateColor(String alternateColor) {
        this.alternateColor = alternateColor;
    }

    public JSONObject toJson() {
        JSONObject json = new JSONObject();
        json.put("color", color);
        json.put("textColor", textColor);
        json.put("dateColor", dateColor);
        json.put("alternateColor", alternateColor);
        return json;
    }

    public void fromJson(JSONObject jsonObject) {
        this.color = (String) jsonObject.get("color");
        this.textColor = (String) jsonObject.get("textColor");
        this.dateColor = (String) jsonObject.get("dateColor");
        this.alternateColor = (String) jsonObject.get("alternateColor");
    }

    public Map<String, Object> toMap() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("color", color);
        map.put("textColor", textColor);
        map.put("dateColor", dateColor);
        map.put("alternateColor", alternateColor);
        return map;
    }
}

class DataSourceConfig {
    private String namespace;
    private String type;
    private boolean enable;
    private String permission;
    private String converter2events_class;
    private String dataPath;
    private String dataModel;
    private Filter filter;
    private String connector;
    private Render render;

    public String getNamespace() {
        return namespace;
    }

    public void setNamespace(String namespace) {
        this.namespace = namespace;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public boolean isEnable() {
        return enable;
    }

    public void setEnable(boolean enable) {
        this.enable = enable;
    }

    public String getPermission() {
        return permission;
    }

    public void setPermission(String permission) {
        this.permission = permission;
    }

    public String getConverter2events_class() {
        return converter2events_class;
    }

    public void setConverter2events_class(String converter2events_class) {
        this.converter2events_class = converter2events_class;
    }

    public String getDataPath() {
        return dataPath;
    }

    public void setDataPath(String dataPath) {
        this.dataPath = dataPath;
    }

    public String getDataModel() {
        return dataModel;
    }

    public void setDataModel(String dataModel) {
        this.dataModel = dataModel;
    }

    public Filter getFilter() {
        return filter;
    }

    public void setFilter(Filter filter) {
        this.filter = filter;
    }

    public String getConnector() {
        return connector;
    }

    public void setConnector(String connector) {
        this.connector = connector;
    }

    public Render getRender() {
        return render;
    }

    public void setRender(Render render) {
        this.render = render;
    }

    public JSONObject toJson() {
        JSONObject json = new JSONObject();
        json.put("namespace", namespace);
        json.put("type", type);
        json.put("enable", enable);
        json.put("permission", permission);
        json.put("converter2events_class", converter2events_class);
        json.put("data_path", dataPath);
        json.put("data_model", dataModel);
        json.put("filter", filter != null ? filter.toJson() : null);
        json.put("connector", connector);
        json.put("render", render != null ? render.toJson() : null);
        return json;
    }

    public void fromJson(JSONObject jsonObject) {
        this.namespace = (String) jsonObject.get("namespace");
        this.type = (String) jsonObject.get("type");
        this.enable = Boolean.parseBoolean(jsonObject.get("enable").toString());
        this.permission = (String) jsonObject.get("permission");
        this.converter2events_class = (String) jsonObject.get("converter2events_class");
        this.dataPath = (String) jsonObject.get("data_path");
        this.dataModel = (String) jsonObject.get("data_model");
        if (jsonObject.containsKey("filter")) {
            this.filter = new Filter();
            this.filter.fromJson((JSONObject) jsonObject.get("filter"));
        }
        this.connector = (String) jsonObject.get("connector");
        if (jsonObject.containsKey("render")) {
            this.render = new Render();
            this.render.fromJson((JSONObject) jsonObject.get("render"));
        }
    }

    public Map<String, Object> toMap() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("namespace", namespace);
        map.put("type", type);
        map.put("enable", enable);
        map.put("permission", permission);
        map.put("converter2events_class", converter2events_class);
        map.put("data_path", dataPath);
        map.put("data_model", dataModel);
        map.put("filter", filter != null ? filter.toMap() : new LinkedHashMap<>());
        map.put("connector", connector);
        map.put("render", render != null ? render.toMap() : new LinkedHashMap<>());
        return map;
    }
}

public class data_sources {
    private List<DataSourceConfig> data_sources = new ArrayList<>();

    public List<DataSourceConfig> getDataSources() {
        return data_sources;
    }

    public void setDataSources(List<DataSourceConfig> data_sources) {
        this.data_sources = data_sources;
    }

    // Method to convert JSON string back to List<DataSourceConfig>
    public void jsonToDataSources(String json) {
        JSONParser parser = new JSONParser();
        try {
            JSONObject jsonObject = (JSONObject) parser.parse(json);
            JSONArray jsonArray = (JSONArray) jsonObject.get("data_sources");

            // Clear the existing list to avoid duplicates
            data_sources.clear();

            for (Object obj : jsonArray) {
                JSONObject dsJson = (JSONObject) obj;
                DataSourceConfig config = new DataSourceConfig();
                config.fromJson(dsJson);
                data_sources.add(config);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    // Method to convert data_sources to JSON
    public String dataSourcesToJson() {
        JSONArray jsonArray = new JSONArray();
        for (DataSourceConfig config : data_sources) {
            jsonArray.add(config.toJson());
        }
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("data_sources", jsonArray);
        return jsonObject.toJSONString();
    }

    public String dataSourcesToJson(String startup_configuration) {
        JSONArray jsonArray = new JSONArray();
        for (DataSourceConfig config : data_sources) {
            jsonArray.add(config.toJson());
        }
        return "{" + startup_configuration + jsonArray.toJSONString() + "}";
    }

    public void readYaml(String filePath) {
        try {
            String content = new String(Files.readAllBytes(Paths.get(filePath)));
            String jsonContent = yamlToJson(content);
            jsonToDataSources(jsonContent);
        } catch (IOException e) {
            System.err.println("Error reading YAML file: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private static String yamlToJson(String yamlContent) {
        Yaml yaml = new Yaml();
        Map<String, Object> yamlMap = yaml.load(yamlContent);
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("data_sources", processList((List<Map<String, Object>>) yamlMap.get("data_sources")));
        return jsonObject.toJSONString();
    }

    private static JSONArray processList(List<Map<String, Object>> list) {
        JSONArray jsonArray = new JSONArray();
        for (Map<String, Object> item : list) {
            jsonArray.add(processMap(item));
        }
        return jsonArray;
    }

    private static JSONObject processMap(Map<String, Object> map) {
        JSONObject jsonObject = new JSONObject();
        for (Map.Entry<String, Object> entry : map.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();
            if (value instanceof Map) {
                jsonObject.put(key, processMap((Map<String, Object>) value));
            } else if (value instanceof List) {
                jsonObject.put(key, processList((List<Map<String, Object>>) value));
            } else {
                jsonObject.put(key, value != null ? value.toString() : null);
            }
        }
        return jsonObject;
    }

    public void saveYaml(String filePath) {
        List<Map<String, Object>> yamlList = new ArrayList<>();
        for (DataSourceConfig config : data_sources) {
            yamlList.add(config.toMap());
        }

        Map<String, Object> yamlMap = new LinkedHashMap<>();
        yamlMap.put("data_sources", yamlList);

        DumperOptions options = new DumperOptions();
        options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        options.setIndent(2);
        options.setPrettyFlow(true);
        Representer representer = new Representer(options);
        representer.getPropertyUtils().setSkipMissingProperties(true);
        Yaml yaml = new Yaml(representer, options);

        try (FileWriter writer = new FileWriter(new File(filePath))) {
            yaml.dump(yamlMap, writer);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public String getConnectors(String jsonData) {
        Set<String> uniqueConnectors = new HashSet<>();
        try {
            JSONParser parser = new JSONParser();
            JSONObject jsonObject = (JSONObject) parser.parse(jsonData);
            JSONArray jsonArray = (JSONArray) jsonObject.get("data_sources");

            for (Object obj : jsonArray) {
                JSONObject dataSource = (JSONObject) obj;
                String connector = (String) dataSource.get("connector");
                if (connector != null && !connector.isEmpty()) {
                    String[] connectors = connector.split("\\|");
                    for (String conn : connectors) {
                        uniqueConnectors.add(conn.trim());
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
            return "Error processing JSON data";
        }

        StringJoiner joiner = new StringJoiner("|");
        uniqueConnectors.forEach(joiner::add);
        return joiner.toString();
    }

    public static void main(String[] args) {
        data_sources data_sources = new data_sources();
        data_sources.readYaml("tests/yaml/sources_default_test.yml");
        String jsonOutput = data_sources.dataSourcesToJson();
        data_sources.jsonToDataSources(jsonOutput);
        if (data_sources.getDataSources().isEmpty()) System.exit(0);
        data_sources.saveYaml("tests/yaml/sources_default_test.yml");

        // Get all connectors
        String connectors = data_sources.getConnectors(jsonOutput);
        System.out.println("connectors=" + connectors);

        // Get startup configuration json
        jsonOutput = data_sources.dataSourcesToJson("\"startup configuration\":");
        System.out.println(jsonOutput);
    }
}
