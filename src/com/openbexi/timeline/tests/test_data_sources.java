package com.openbexi.timeline.tests;

import com.openbexi.timeline.data_browser.data_sources;
import org.junit.After;
import org.junit.Assert;
import org.junit.Before;
import org.junit.Test;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

public class test_data_sources  {

    private data_sources dataSourceManager;
    private static final Path ORIGINAL_FILE_PATH = Path.of("yaml/sources_default.yml");
    private static final Path BACKUP_FILE_PATH = Path.of("yaml/sources_default_backup.yml");

    @Before
    public void setUp() throws IOException {
        dataSourceManager = new data_sources();
        // Backup the original file before tests
        if (Files.exists(ORIGINAL_FILE_PATH)) {
            Files.copy(ORIGINAL_FILE_PATH, BACKUP_FILE_PATH, StandardCopyOption.REPLACE_EXISTING);
        } else {
            Assert.fail("Original YAML file does not exist.");
        }
    }

    @After
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

        Assert.assertEquals("JSON output should be consistent before and after saving YAML", jsonOutput1, jsonOutput2);
    }
}

