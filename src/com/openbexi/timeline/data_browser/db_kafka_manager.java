package com.openbexi.timeline.data_browser;

import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;

import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.AdminClientConfig;
import org.apache.kafka.clients.admin.ListTopicsResult;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.common.KafkaFuture;
import org.json.simple.JSONArray;
import org.json.simple.JSONObject;

import java.time.Duration;
import java.util.Collections;
import java.util.Properties;
import java.util.Set;

public class db_kafka_manager extends data_manager {

    private String _title;
    private String _kafkaBootstrapServer;
    private String _topicName;
    private String _compressionType;
    private Long _retentionMs;
    private int _partitions;
    private String _producerUserName;
    private String _producerGroup;
    private String _producerPassword;
    private String _consumerUserName;
    private String _consumerGroup;
    private String _consumerPassword;
    private String _apacheKafkaVersion;
    private String _securityProtocol;
    private String _saslMechanism;

    private KafkaProducer<String, String> _producer;
    private KafkaConsumer<String, String> _consumer;

    public db_kafka_manager(String currentStartDate, String currentEndDate, String search,
                            String filter, String action_type, HttpServletResponse response, HttpSession session,
                            data_configuration configuration) {
        super(
                response, session, configuration);
    }

    public static void main(String[] args) {
        boolean connected = false;
        String json = null;
        String url = null;

        if (args.length == 4) {
            if (args[0].equals("-json")) {
                json = args[1];
                connected = true;
            }
            if (args[2].equals("-url")) {
                url = args[3];
                connected = true;
            }
        }

        if (!connected) {
            System.err.println("db_kafka_manager: cannot read kafka json file because of bad usage:");
            System.err.println("Argument " + args[0] + " " + "-url <path>");
            System.exit(1);
        }

        db_kafka_manager openbexi_kafka = new db_kafka_manager(null,
                null, null, null, null, null, null, null);
        try {
            openbexi_kafka.readConfiguration(json);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        openbexi_kafka.login(url, null);
    }

    public KafkaProducer<String, String> getProducer() {
        return _producer;
    }

    public KafkaConsumer<String, String> getConsumer() {
        return _consumer;
    }

    // Getters for the variables
    public String get_title() {
        return _title;
    }

    public String getKafkaBootstrapServer() {
        return _kafkaBootstrapServer;
    }

    public String get_topicName() {
        return _topicName;
    }

    public String get_compressionType() {
        return _compressionType;
    }

    public Long get_retentionMs() {
        return _retentionMs;
    }

    public int get_partitions() {
        return _partitions;
    }

    public String get_producerUserName() {
        return _producerUserName;
    }

    public String get_producerGroup() {
        return _producerGroup;
    }

    public String get_producerPassword() {
        return _producerPassword;
    }

    public String get_consumerUserName() {
        return _consumerUserName;
    }

    public String get_consumerGroup() {
        return _consumerGroup;
    }

    public String get_consumerPassword() {
        return _consumerPassword;
    }

    public String get_apacheKafkaVersion() {
        return _apacheKafkaVersion;
    }

    public String get_securityProtocol() {
        return _securityProtocol;
    }

    public String get_saslMechanism() {
        return _saslMechanism;
    }

    @Override
    Object login(String url, JSONArray cookies) {
        // Set Kafka broker properties
        Properties props = new Properties();
        props.put(AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG, url);

        // Create an AdminClient instance
        AdminClient adminClient = AdminClient.create(props);

        // List the available topics in the cluster
        ListTopicsResult listTopics = adminClient.listTopics();
        KafkaFuture<Set<String>> topics = listTopics.names();

        try {
            Set<String> topicNames = topics.get();
            System.out.println("Available topics:");
            for (String topicName : topicNames) {
                System.out.println(topicName);
            }
        } catch (Exception e) {
            System.out.println("Error listing topics: " + e.getMessage());
        }

        // Create the Kafka producer instance
        _producer = new KafkaProducer<>(props);

        // Close the AdminClient instance
        //adminClient.close();
        return null;
    }

    @Override
    public Object getData(String filter, String ob_scene) {
        return null;
    }

    @Override
    boolean sendData(Object data) {
        this.consume();
        return false;
    }

    @Override
    JSONArray filterDates(JSONArray events, long currentEndDate, long currentStartDate) {
        return null;
    }

    @Override
    JSONArray filterEvents(JSONArray events, String filter_include, String filter_exclude) {
        return null;
    }

    @Override
    JSONArray searchEvents(JSONArray events, String search) {
        return null;
    }

    @Override
    boolean onDataChange(String ob_scene) throws InterruptedException {
        return false;
    }

    @Override
    public boolean addEvents(JSONArray events, String ob_scene) {
        return false;
    }

    @Override
    boolean updateEvents(JSONArray events, String ob_scene) {
        return false;
    }

    @Override
    boolean removeEvents(JSONArray events, String ob_scene) {
        return false;
    }

    //  Generated by ChatGPT4 (https://chat.openai.com/) after asking for:
    //  Provide a function readKafkaConf, read the given JSON structure as a JSONObject : {...},
    //  extract each attribute and assign to a private class variable and provide javadoc,
    //  use readJsonFile(filePath) you already provided and catch exception inside the function.

    public Object addFilter(String ob_timeline_name, String ob_title, String ob_scene, String ob_namespace,
                            String ob_filter_name, String ob_backgroundColor, String ob_user, String ob_email,
                            String ob_top, String ob_left, String ob_width, String ob_height, String ob_camera,
                            String ob_sort_by, String ob_filter) {
        return updateFilter("addFilter", ob_timeline_name, ob_scene, ob_namespace, ob_title, ob_filter_name,
                ob_backgroundColor, ob_user, ob_email, ob_top, ob_left, ob_width, ob_height, ob_camera, ob_sort_by,
                ob_filter);
    }

    @Override
    public Object updateFilter(String ob_action, String ob_timeline_name, String ob_scene, String ob_namespace,
                               String ob_title, String ob_filter_name, String ob_backgroundColor, String ob_user,
                               String ob_email, String ob_top, String ob_left, String ob_width, String ob_height,
                               String ob_camera, String ob_sort_by, String ob_filter) {
        return super.updateFilter(ob_action, ob_timeline_name, ob_scene, ob_namespace, ob_title, ob_filter_name,
                ob_backgroundColor, ob_user, ob_email, ob_top, ob_left, ob_width, ob_height, ob_camera, ob_sort_by,
                ob_filter);
    }

    /**
     * Reads a Kafka configuration file and returns a JSONObject.
     *
     * @param filePath the path to the Kafka configuration file
     * @return a JSONObject containing the Kafka configuration
     * @throws Exception if an error occurs while reading the JSON file
     */
    public JSONObject readConfiguration(String filePath) throws Exception {
        JSONObject jsonObject = readJsonFile(filePath);
        if (jsonObject == null) {
            throw new Exception("JSON file is empty or invalid");
        }
        // Extract attributes from the JSONObject
        _title = (String) jsonObject.get("title");

        JSONObject connectionDetails = (JSONObject) jsonObject.get("connectionDetails");
        if (connectionDetails != null) {
            _kafkaBootstrapServer = (String) connectionDetails.get("kafkaBootstrapServer");
        }

        JSONObject topicDetails = (JSONObject) jsonObject.get("topicDetails");
        if (topicDetails != null) {
            _topicName = (String) topicDetails.get("topicName");
            _compressionType = (String) topicDetails.get("compressionType");
            _retentionMs = (Long) topicDetails.get("retentionMs");
            _partitions = ((Long) topicDetails.get("partitions")).intValue();
        }

        JSONObject producerDetails = (JSONObject) jsonObject.get("producerDetails");
        if (producerDetails != null) {
            _producerUserName = (String) producerDetails.get("userName");
            _producerGroup = (String) producerDetails.get("producerGroup");
            _producerPassword = (String) producerDetails.get("password");
        }

        JSONObject consumerDetails = (JSONObject) jsonObject.get("consumerDetails");
        if (consumerDetails != null) {
            _consumerUserName = (String) consumerDetails.get("userName");
            _consumerGroup = (String) consumerDetails.get("consumerGroup");
            _consumerPassword = (String) consumerDetails.get("password");
        }

        JSONObject securityDetails = (JSONObject) jsonObject.get("securityDetails");
        if (securityDetails != null) {
            _apacheKafkaVersion = (String) securityDetails.get("apacheKafkaVersion");
            _securityProtocol = (String) securityDetails.get("securityProtocol");
            _saslMechanism = (String) securityDetails.get("saslMechanism");
        }

        return jsonObject;
    }

    /**
     * Creates a Kafka consumer that subscribes to the specified topic and
     * consumes messages from it.
     */
    public void consume() {

        Properties props = new Properties();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, _kafkaBootstrapServer);
        props.put(ConsumerConfig.GROUP_ID_CONFIG, _consumerGroup);
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, "org.apache.kafka.common.serialization.StringDeserializer");
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, "org.apache.kafka.common.serialization.StringDeserializer");
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "true");
        props.put(ConsumerConfig.AUTO_COMMIT_INTERVAL_MS_CONFIG, "1000");
        props.put("security.protocol", "SASL_SSL");
        props.put("sasl.mechanism", "SCRAM-SHA-512");
        props.put("sasl.jaas.config", "org.apache.kafka.common.security.scram.ScramLoginModule required username=\"" +
                _consumerUserName + "\" password=\"" + _consumerPassword + "\";");

        KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);

        consumer.subscribe(Collections.singleton(get_topicName()));

        while (true) {
            ConsumerRecords<String, String> records = getConsumer().poll(Duration.ofMillis(1000));
            records.forEach(record -> {
                System.out.println("Received message: " + record.value());
            });
        }
    }
}
