package com.openbexi.timeline.api;

import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PublicAssetServletTest {
    @TempDir static Path temporary;
    private Path root;
    private Tomcat server;
    private URI base;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    private void file(String name, String content) throws Exception {
        Path destination = root.resolve(name); Files.createDirectories(destination.getParent()); Files.writeString(destination, content);
    }

    @BeforeAll void start() throws Exception {
        root = Files.createDirectory(temporary.resolve("site"));
        for (String path : List.of("demos.html", "src/openbexi_demo.js", "css/ob_demo.css", "node_modules/three/build/three.module.js",
                "models/regular_timeline.json", "demos/catalog.json", "json/test-data/example.json", "docs/api.html", "README.md", "LICENSE", "swagger/openapi-v1.json")) file(path, "public");
        for (String path : List.of(".git/config", ".env", "pom.xml", "package-lock.json", "yaml/credentials.yml", "json/sources_default.json",
                "target/classes/Secret.class", "src/com/example/Secret.java", "tests/java/Secret.java", "tools/internal.js", "private.json", "icon/.secret.png")) file(path, "private");
        // Use a real published demo reference image to catch changes to the asset allowlist.
        try (var images = Files.list(Paths.get("json/test-data"))) {
            Path image = images.filter(path -> path.getFileName().toString().endsWith(".png")).sorted().findFirst().orElseThrow();
            Files.copy(image, root.resolve("json/test-data/reference.png"));
        }
        server = new Tomcat(); server.setBaseDir(temporary.resolve("tomcat").toString()); server.setPort(0);
        server.getConnector().setProperty("address", "127.0.0.1");
        Context context = server.addContext("", root.toString());
        Tomcat.addServlet(context, "assets", new PublicAssetServlet()); context.addServletMappingDecoded("/", "assets");
        server.start(); base = URI.create("http://127.0.0.1:" + server.getConnector().getLocalPort() + "/");
    }
    @Test void servesDemoReferencePngWithItsOriginalBytesAndImageMimeType() throws Exception {
        HttpResponse<byte[]> response = client.send(HttpRequest.newBuilder(base.resolve("json/test-data/reference.png"))
                .timeout(Duration.ofSeconds(5)).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200, response.statusCode());
        assertEquals("image/png", response.headers().firstValue("Content-Type").orElseThrow());
        assertArrayEquals(Files.readAllBytes(root.resolve("json/test-data/reference.png")), response.body());
    }
    @AfterAll void stop() throws Exception { if (server != null) { server.stop(); server.destroy(); } }
    private HttpResponse<String> request(String method, String path) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(5))
                .method(method, HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
    }
    @Test void browserAssetsAndDocumentationRemainUsableWithCorrectMimeTypes() throws Exception {
        for (String path : List.of("", "demos.html", "src/openbexi_demo.js", "css/ob_demo.css", "node_modules/three/build/three.module.js",
                "models/regular_timeline.json", "demos/catalog.json", "json/test-data/example.json", "docs/api.html", "README.md", "LICENSE", "swagger/openapi-v1.json")) {
            HttpResponse<String> result = request("GET", path);
            assertEquals(200, result.statusCode(), path); assertEquals("public", result.body());
            assertEquals("nosniff", result.headers().firstValue("X-Content-Type-Options").orElseThrow());
        }
        assertTrue(request("GET", "demos.html").headers().firstValue("Content-Type").orElseThrow().startsWith("text/html"));
        assertTrue(request("GET", "css/ob_demo.css").headers().firstValue("Content-Type").orElseThrow().startsWith("text/css"));
        assertTrue(request("GET", "src/openbexi_demo.js").headers().firstValue("Content-Type").orElseThrow().startsWith("text/javascript"));
        HttpResponse<String> head = request("HEAD", "demos.html");
        assertEquals(200, head.statusCode()); assertEquals("", head.body());
        assertEquals("6", head.headers().firstValue("Content-Length").orElseThrow());
    }
    @Test void blocksPrivateFilesTraversalListingsAndMutatingMethods() throws Exception {
        for (String path : List.of(".git/config", ".env", "pom.xml", "package-lock.json", "yaml/credentials.yml", "json/sources_default.json",
                "target/classes/Secret.class", "src/com/example/Secret.java", "tests/java/Secret.java", "tools/internal.js", "private.json", "icon/.secret.png",
                "icon/%2e%2e/yaml/credentials.yml", "%2e%2e/secret.txt", "src/", "node_modules/")) {
            HttpResponse<String> response = request("GET", path);
            assertNotEquals(200, response.statusCode(), path); assertFalse(response.body().contains("private"), path);
        }
        for (String method : List.of("POST", "PUT", "PATCH", "DELETE", "TRACE")) assertEquals(405, request(method, "demos.html").statusCode(), method);
        assertEquals("public", Files.readString(root.resolve("demos.html")));
    }
    @Test void symlinksCannotExposeFilesOutsideTheRootOrAnUnpublishedFileInsideIt() throws Exception {
        Path external = temporary.resolve("secret.txt"); Files.writeString(external, "private");
        Files.createDirectories(root.resolve("icon"));
        try {
            Files.createSymbolicLink(root.resolve("icon/outside.png"), external);
            Files.createSymbolicLink(root.resolve("icon/inside.png"), root.resolve("yaml/credentials.yml"));
        } catch (UnsupportedOperationException | java.io.IOException e) {
            Assumptions.assumeTrue(false, "This host cannot create symbolic links: " + e.getClass().getSimpleName());
        }
        assertEquals(404, request("GET", "icon/outside.png").statusCode());
        assertEquals(404, request("GET", "icon/inside.png").statusCode());
    }
}
