package com.openbexi.timeline.tests;

import com.openbexi.timeline.data_browser.data_sources;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * Historical serialization check that backs up and overwrites yaml/sources_default.yml.
 * Opt in only with disposable fixtures using -Dopenbexi.legacyTests=true.
 */
@EnabledIfSystemProperty(named = "openbexi.legacyTests", matches = "true")
public class LegacyDataSourcesTest {

    private data_sources dataSourceManager;
    private static final Path ORIGINAL_FILE_PATH = Path.of("yaml/sources_default.yml");
    private static final Path BACKUP_FILE_PATH = Path.of("yaml/sources_default_backup.yml");

    @BeforeEach
    public void setUp() throws IOException {
        dataSourceManager = new data_sources();
        // Backup the original file before tests
        if (Files.exists(ORIGINAL_FILE_PATH)) {
            Files.copy(ORIGINAL_FILE_PATH, BACKUP_FILE_PATH, StandardCopyOption.REPLACE_EXISTING);
        } else {
            Assertions.fail("Original YAML file does not exist.");
        }
    }

    @AfterEach
    public void tearDown() throws IOException {
        // Restore the original file from backup
        if (Files.exists(BACKUP_FILE_PATH)) {
            Files.move(BACKUP_FILE_PATH, ORIGINAL_FILE_PATH, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    @Test
    public void testYamlSerializationConsistency() throws Exception {
        // Read original, convert to JSON, and back to YAML
        dataSourceManager.readYaml(ORIGINAL_FILE_PATH.toString());
        String jsonOutput1 = dataSourceManager.dataSourcesToJson();

        dataSourceManager.jsonToDataSources(jsonOutput1);
        dataSourceManager.saveYaml(ORIGINAL_FILE_PATH.toString());

        // Read the newly saved YAML, convert to JSON and compare
        dataSourceManager.readYaml(ORIGINAL_FILE_PATH.toString());
        String jsonOutput2 = dataSourceManager.dataSourcesToJson();

        Assertions.assertEquals(jsonOutput1, jsonOutput2, "JSON output should be consistent before and after saving YAML");
    }
}

