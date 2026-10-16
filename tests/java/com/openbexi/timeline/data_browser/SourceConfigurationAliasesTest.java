package com.openbexi.timeline.data_browser;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;

class SourceConfigurationAliasesTest {
    @TempDir Path root;
    @Test void canonicalFieldsAndConnectorListsRemainReadableByLegacyProviders() throws Exception {
        Path file=root.resolve("sources.yml");
        Files.writeString(file,"data_sources:\n  - namespace: DEMO\n    type: json_file\n    source_path: /input/DEMO\n    target_path: /output/DEMO/yyyy/mm/dd\n    connector: [http:18080, http:18081]\n");
        data_configuration config=new data_configuration(file.toString());
        assertEquals("/input/DEMO",config.getDataPath(0));assertEquals("/output/DEMO/yyyy/mm/dd",config.getDataModel(0));
        data_sources sources=new data_sources();sources.readYaml(file.toString());
        assertTrue(sources.getConnectors(sources.dataSourcesToJson()).contains("http:18080"));
        Path exported=root.resolve("export.yml");sources.saveYaml(exported.toString());assertTrue(Files.readString(exported).contains("target_path:"));
    }
    @Test void conflictingPathAliasesFailBeforeLoading() throws Exception {
        Path file=root.resolve("sources.yml");Files.writeString(file,"data_sources:\n  - namespace: DEMO\n    source_path: input\n    data_path: other\n");
        assertThrows(IllegalArgumentException.class,()->new data_sources().readYaml(file.toString()));
    }
}
