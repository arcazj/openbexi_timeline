package com.openbexi.timeline.server;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class LegacyStartupTest {
    @TempDir Path temporary;

    @Test void missingLegacyTlsCredentialsExitWithFailure() throws Exception {
        Path configuration = temporary.resolve("sources.yml");
        Files.writeString(configuration, """
                data_sources:
                  - namespace: earthquake
                    type: json_file
                    enable: true
                    connector: secure_sse:0|secure:0
                """);
        Path output = temporary.resolve("startup.log");
        String executable = System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java";
        ProcessBuilder builder = new ProcessBuilder(
                Path.of(System.getProperty("java.home"), "bin", executable).toString(),
                "-cp", System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")),
                openbexi_timeline.class.getName(), "-data_conf", configuration.toString())
                .redirectErrorStream(true).redirectOutput(output.toFile());
        builder.environment().remove("TIMELINE_KEYSTORE");
        builder.environment().remove("TIMELINE_KEYSTORE_PASSWORD");
        builder.environment().remove("OPENBEXI_HBDS_CONFIG");
        Process process = builder.start();
        try {
            assertTrue(process.waitFor(30, TimeUnit.SECONDS), "Failed startup must terminate");
            String log = Files.readString(output);
            assertTrue(log.contains("Legacy TLS requires TIMELINE_KEYSTORE and TIMELINE_KEYSTORE_PASSWORD"), log);
            assertNotEquals(0, process.exitValue(), log);
            assertFalse(log.contains("Timeline service ready"), log);
        } finally {
            if (process.isAlive()) {
                process.destroyForcibly();
                process.waitFor(10, TimeUnit.SECONDS);
            }
        }
    }
}
