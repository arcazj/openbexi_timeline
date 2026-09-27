package com.openbexi.timeline.server;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;

class WebUiAddressTest {
    @TempDir Path temporary;
    @Test void resolvesConfiguredPageOnlyOnItsReadyListenerAndPreservesContextAndExtension() throws Exception {
        Path config=temporary.resolve("sources.yml");
        Files.writeString(config,"web_ui:\n  entry_page: timeline.htm\n  port: 8123\n  host: localhost\n  context_path: /viewer/\ndata_sources: []\n");
        WebUiAddress address=WebUiAddress.read(config.toString());
        assertTrue(address.readyUrl("https",8122,8122).isEmpty());
        assertEquals("https://localhost:8123/viewer/timeline.htm",address.readyUrl("https",8123,8123).orElseThrow());
        assertEquals("http://localhost:8123/viewer/timeline.htm",address.readyUrl("http",8123,8123).orElseThrow());
        assertEquals("https://example.test/public/timeline.html",new WebUiAddress("localhost",0,"/viewer","timeline.html",
                "https://example.test/public").readyUrl("http",0,43210).orElseThrow());
        assertTrue(new WebUiAddress("localhost",null,"","","").readyUrl("http",0,43210).isEmpty());
        assertThrows(IllegalArgumentException.class,()->new WebUiAddress("localhost",null,"","../secret","").readyUrl("http",0,43210));
        assertThrows(IllegalArgumentException.class,()->new WebUiAddress("localhost",null,"","timeline.html","https://user:token@example.test").readyUrl("http",0,43210));
    }
}
