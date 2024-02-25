package com.openbexi.timeline.data_browser;

import org.json.JSONString;
import org.json.JSONTokener;
import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;

import java.io.FileReader;
import java.io.IOException;
import java.util.*;

/**
 * A class that provides a framework for reading a data configuration file in JSON format and accessing its properties.
 */
public class data_configuration {
    private JSONObject configuration;

    public data_configuration(JSONObject configuration) {
        this.configuration = configuration;
    }

    /**
     * Constructs a new DataConfiguration object by reading the JSON configuration file at the specified path.
     *
     * @param configFilePath the path to the JSON configuration file
     * @throws IOException    if there is an error reading the configuration file
     * @throws ParseException if there is an error parsing the configuration file
     */
    public data_configuration(String configFilePath) throws IOException, ParseException {
        data_sources sources = new data_sources();
        sources.readYaml(configFilePath);
        String json_sources = sources.dataSourcesToJson("\"startup configuration\":");
        JSONParser parser = new JSONParser();
        try {
            this.configuration = (JSONObject) parser.parse(json_sources);
        } catch (ParseException e) {
            e.printStackTrace();
        }
    }

    public JSONObject getConfiguration() {
        return configuration;
    }

    public void setConfiguration(JSONObject configuration) {
        this.configuration = configuration;
    }

    public JSONObject getConfiguration(int index) {
        for (int i = 0; i <= configuration.size(); i++) {
            JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(i);
            if (i == index)
                return configNode;
        }
        return null;
    }

    public String getType(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("type");
    }

    public String getFilter(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        JSONObject filter = (JSONObject) configNode.get("filter");
        if (filter == null) return "";
        String include = (String) filter.get("include");
        String exclude = (String) filter.get("exclude");
        if (include.equals("") && exclude.equals("")) return "";
        if (!include.equals("") && exclude.equals("")) return include;
        if (include.equals("") && !exclude.equals("")) return exclude;
        return include + "|" + exclude;
    }

    public String getDataPath(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("data_path");
    }

    public String getDataModel(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("data_model");
    }

    public List<String> getDataModels() {
        List<String> list = new LinkedList<>();
        for (int i = 0; i <= configuration.size(); i++) {
            JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(i);
            list.add((String) configNode.get("data_model"));
        }
        return list;
    }

    public String getUrl(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("url");
    }

    public String getFilterInclude(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        JSONObject filter = (JSONObject) configNode.get("filter");
        return (String) filter.get("include");
    }

    public String getFilterExclude(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        JSONObject filter = (JSONObject) configNode.get("filter");
        return (String) filter.get("exclude");
    }

    public String getConnector(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return configNode.get("connector").toString().replaceAll(" ", "");
    }

    public String getDatabase(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("database");
    }

    /**
     * Returns the value of the collection property from the configuration data.
     *
     * @return the value of the collection property as a string
     */
    public String getCollection(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("collection");
    }

    public String getTopicName(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("topicName");
    }

    public String getCompressionType(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("compression.type");
    }

    public String getRetentionMs(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("retention.ms");
    }

    public String getPartitionsMs(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("Partitions.ms");
    }

    public String getConsumerName(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("consumerName");
    }

    public String getConsumerGroup(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("consumerGroup");
    }

    public String getProducerName(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("producerName");
    }

    public String getProducerGroup(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("producerGroup");
    }

    public String getVersion(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("version");
    }

    public String getSecurityProtocol(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("security.protocol");
    }

    public String getSaslMechanism(int index) {
        JSONObject configNode = (JSONObject) ((JSONArray) configuration.get("startup configuration")).get(index);
        return (String) configNode.get("sasl.mechanism");
    }

    public void testGetters(int index) {
        // call all the getters and print the results
        System.out.println("Type: " + getType(index));
        System.out.println("data_path: " + getDataPath(index));
        System.out.println("data_model: " + getDataModel(index));
        System.out.println("Url: " + getUrl(index));
        System.out.println("Database: " + getDatabase(index));
        System.out.println("Collection: " + getCollection(index));
        System.out.println("Filter Include: " + getFilterInclude(index));
        System.out.println("Filter Exclude: " + getFilterExclude(index));
        System.out.println("Connector: " + getConnector(index));
        System.out.println("Kafka Topic Name: " + getTopicName(index));
        System.out.println("Kafka Compression Type: " + getCompressionType(index));
        System.out.println("Kafka Retention MS: " + getRetentionMs(index));
        System.out.println("Kafka Partitions MS: " + getPartitionsMs(index));
        System.out.println("Kafka Consumer Name: " + getConsumerName(index));
        System.out.println("Kafka Consumer Group: " + getConsumerGroup(index));
        System.out.println("Kafka Producer Name: " + getProducerName(index));
        System.out.println("Kafka Producer Group: " + getProducerGroup(index));
        System.out.println("Kafka Version: " + getVersion(index));
        System.out.println("Kafka Security Protocol: " + getSecurityProtocol(index));
        System.out.println("Kafka SASL Mechanism: " + getSaslMechanism(index));
    }

    public static void main(String[] args) {
        // create a new instance of DataConfig
        data_configuration configuration = null;
        try {
            configuration = new data_configuration("yaml\\sources_default_test.yml");
        } catch (IOException e) {
            throw new RuntimeException(e);
        } catch (ParseException e) {
            throw new RuntimeException(e);
        }

        // call the testGetters() method to test all the getters
        try {
            configuration.testGetters(0);
        } catch (Exception e) {
            System.err.println("testGetters(0): " + e.getMessage());
            System.out.println("--------------------------------");
        }
        try {
            configuration.testGetters(1);
        } catch (Exception e) {
            System.err.println("testGetters(1): " + e.getMessage());
            System.out.println("--------------------------------");
        }
        try {
            configuration.testGetters(2);
        } catch (Exception e) {
            System.err.println("testGetters(2): " + e.getMessage());
            System.out.println("--------------------------------");
        }
        try {
            configuration.testGetters(3);
        } catch (Exception e) {
            System.err.println("testGetters(3): " + e.getMessage());
            System.out.println("--------------------------------");
        }
    }
}