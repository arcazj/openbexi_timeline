package com.openbexi.timeline.data_browser;

import com.fasterxml.jackson.annotation.*;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.fasterxml.jackson.dataformat.yaml.YAMLGenerator;

import java.io.File;
import java.util.List;
import java.util.Map;

import java.util.HashMap;

@JsonIgnoreProperties(ignoreUnknown = true)

class DataSourceConfig {
    private List<DataSourceConfig> data_sources;
    private String namespace;
    private String type;
    private boolean enable;
    private String permission;
    private String converter2events_class;

    // Specific attributes for data sources that might not fit into the dynamic properties map.
    @JsonProperty("data_path")
    private String dataPath;
    @JsonProperty("data_model")
    private String dataModel;
    private String url;
    private String database;
    private String user;
    private String password;

    // A map to hold any additional, dynamic properties that vary between data source types.
    private Map<String, Object> additionalProperties = new HashMap<>();

    public DataSourceConfig() {
    }

    // Standard getters and setters

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

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }

    public String getDatabase() {
        return database;
    }

    public void setDatabase(String database) {
        this.database = database;
    }

    public String getUser() {
        return user;
    }

    public void setUser(String user) {
        this.user = user;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    @JsonAnyGetter
    public Map<String, Object> getAdditionalProperties() {
        return this.additionalProperties;
    }

    @JsonAnySetter
    public void setAdditionalProperty(String name, Object value) {
        this.additionalProperties.put(name, value);
    }

    // Getter
    public List<DataSourceConfig> getDataSources() {
        return data_sources;
    }

    // Constructor
    public void DataSourceManager(List<DataSourceConfig> data_sources) {
        this.data_sources = data_sources;
    }

    // Setter
    public void setDataSources(List<DataSourceConfig> data_sources) {
        this.data_sources = data_sources;
    }
}

public class data_sources {
    private List<DataSourceConfig> data_sources;

    // Method to convert JSON string back to List<DataSourceConfig>
    public void jsonToDataSources(String json) {
        ObjectMapper mapper = new ObjectMapper();
        try {
            // Convert the JSON string back to List<DataSourceConfig>
            data_sources = mapper.readValue(json, new TypeReference<List<DataSourceConfig>>(){});
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
    // Method to convert data_sources to JSON
    public String dataSourcesToJson() {
        ObjectMapper mapper = new ObjectMapper();
        try {
            // Convert the data sources list to JSON string
            return mapper.writeValueAsString(data_sources);
        } catch (JsonProcessingException e) {
            e.printStackTrace();
            return null;
        }
    }
    public void readYaml(String filePath) {
        ObjectMapper mapper = new ObjectMapper(new YAMLFactory());
        try {
            data_sources data_sources = mapper.readValue(new File(filePath), data_sources.class);
            this.data_sources = data_sources.data_sources;
        } catch (Exception e) {
            System.err.println("Error reading YAML file: " + e.getMessage());
            e.printStackTrace();
        }
    }

    public void saveYaml(String filePath) {
        ObjectMapper mapper = new ObjectMapper(new YAMLFactory().disable(YAMLGenerator.Feature.WRITE_DOC_START_MARKER));
        mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL); // Exclude null values
        mapper.enable(SerializationFeature.INDENT_OUTPUT); // For pretty printing

        // Wrapping the list in a Map to include the 'data_sources:' key
        Map<String, List<DataSourceConfig>> wrapper = new HashMap<>();
        wrapper.put("data_sources", data_sources);

        try {
            mapper.writeValue(new File(filePath), wrapper);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    // Getter for data_sources
    public List<DataSourceConfig> getdata_sources() {
        return data_sources;
    }

    public static void main(String[] args) {
        data_sources data_sources = new data_sources();
        data_sources.readYaml("yaml/sources_default.yml");
        String jsonOutput = data_sources.dataSourcesToJson();
        data_sources.jsonToDataSources(jsonOutput);
        data_sources.saveYaml("yaml/sources_default.yml");
        System.out.println(jsonOutput.toString());
    }
}