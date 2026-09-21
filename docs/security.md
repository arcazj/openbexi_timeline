# Dependency and deployment security

The September 2026 maintenance replaces the old Java dependency set while preserving Java 17 and the `javax.servlet` interface. Run builds with a currently patched Java 17 distribution; an old local JDK that compiles successfully is not a secure production runtime.

| Component | Previous | Updated | Reason |
| --- | --- | --- | --- |
| Embedded Tomcat | 9.0.85 | 9.0.122 | Current Tomcat 9 maintenance release; incorporates the published HTTP/2 and authentication fixes while retaining Servlet 4 compatibility. See [Tomcat advisories](https://tomcat.apache.org/security-9.html). |
| Kafka client | 3.7.0 | 3.9.2 | Preserves the 3.x client API and incorporates fixes for configuration access, OAuth URL handling, logging disclosure, and producer buffer handling. See [Kafka advisories](https://kafka.apache.org/community/cve-list/). |
| Kafka's LZ4 dependency | 1.10.1 in Kafka 3.9.2 | 1.11.3 | Explicit dependency management avoids the native XXHash bounds issue fixed in 1.11.1. See the [maintainer advisory](https://github.com/yawkat/lz4-java/security/advisories/GHSA-xx22-p4ch-683r). |
| MongoDB driver | 5.1.0 | 5.12.0 | Updates the driver and keeps its core/BSON modules aligned through the sync driver dependency. |
| JSON / SnakeYAML / jsoup | 20240303 / 2.2 / 1.17.2 | 20260814 / 2.7 / 1.23.2 | Updates the existing parsing libraries. |
| JUnit | Mixed 4.x and 5.x milestones in production | Jupiter 5.14.4, tests only | Removes test libraries from production and runs the isolated Java tests under `tests/java`. |

Unused direct Jackson annotations and JMX agent dependencies were removed. `json-simple` remains for compatibility with the legacy adapters; its accidental JUnit runtime dependency is excluded. The old checked-in JMX exporter binary is retired. Exporter configuration, when needed, is an explicit deployment choice: use a current [Prometheus JMX Exporter](https://prometheus.github.io/jmx_exporter/) release on a restricted monitoring interface. The application does not enable unauthenticated remote JMX.

## Java test sources

The repository's JUnit classes live under `tests/java` and use JUnit Jupiter with test-only dependencies. The application source tree `src` compiles without JUnit or Maven file exclusions, including in IntelliJ. After updating an existing checkout, reload the Maven project and rebuild to refresh the source roots and remove stale classes. The historical `test_timeline` class stays in `src` because the legacy server uses it at runtime; it does not use JUnit.

Optional local converter tests belong in `tests/local-java`, marked as a test source folder in IntelliJ. That folder stays ignored with the private converter sources and is separate from the Maven test suite.

The four `Legacy*Test` classes preserve historical manual checks. They compile with the regular tests but run only when `-Dopenbexi.legacyTests=true` is explicitly set. They depend on developer configuration and fixtures, and some write YAML/filter files or access MongoDB; prepare an isolated test environment before opting in. The regular suite uses temporary storage or isolated database doubles and does not enable these checks.

## Repeatable audit

With Java 17, Maven, and Node 24 installed:

```sh
mvn --batch-mode --no-transfer-progress verify
mvn --batch-mode --no-transfer-progress dependency:list -DincludeScope=runtime -DoutputFile=target/runtime-dependencies.txt
node tools/audit-java-dependencies.mjs
npm audit
```

The audit sends only public Maven package coordinates and versions to the [OSV API](https://google.github.io/osv.dev/api/). It fails on advisories, network errors, or an incomplete response. It writes a dated report to `target/dependency-audit-osv.json`. The first scan of the updated set returned **zero known advisories across 24 resolved runtime packages**. This is a point-in-time dependency scan, not a claim that the application, host OS, container, or deployment has no vulnerabilities. GitHub recalculates its own alerts after the manifests are pushed.

Automated dependency updates and CI repeat the checks. Review advisories against the deployed configuration and rerun tests when updating a version. Kafka OAuth deployments should explicitly allow only trusted token/JWKS endpoints using `org.apache.kafka.sasl.oauthbearer.allowed.urls`; upgrading the 3.x client alone does not restrict its backward-compatible default.

## Database safety

The legacy MongoDB adapter no longer drops a collection when adding or removing events. It validates an entire incoming batch before any mutation, requires scalar stable `id`/`_id` values, inserts individual records, and updates/deletes through exact single-record selectors. Invalid or missing identifiers never become broad MongoDB queries. Empty batches do nothing. Updates do not upsert missing records.

Historical aggregate documents remain readable; no automatic database rewrite occurs. New inserts use one document per event and MongoDB's unique `_id` constraint. Adapter batches are not transactions: a database error during a valid batch can leave earlier operations applied. These legacy methods are not the authenticated REST write implementation. The isolated regression tests verify that unrelated records survive additions, updates, and deletions without requiring a live database.

## Deployment

The container builds the Java classes and copies the runtime dependency set directly from Maven. It installs browser dependencies from the npm lockfile and runs on a maintained Java 17 image as an unprivileged user. Do not reuse an old manually assembled application JAR after updating `pom.xml`.

The native launchers use the same compiled classes and runtime JARs. Build with `mvn --batch-mode --no-transfer-progress verify`, then run `bash openbexi_timeline.sh -data_conf "path/to/config.yml"` or `openbexi_timeline.bat -data_conf "C:\path\to\config.yml"`. Maven's package phase removes obsolete JARs from **only** `target/runtime` and copies the current resolved runtime set there; this prevents an older dependency from remaining on the wildcard classpath after an upgrade. Stop a native server before rebuilding its runtime, especially on Windows where running JARs can be locked.

The launchers preserve existing environment variables. `JDK_HOME`, then `JAVA_HOME`, select Java (otherwise the PATH Java is used). `OPENBEXI_TIMELINE_HOME` optionally selects the installation; otherwise the script's directory is used. Explicit configuration arguments take priority, followed by `OPENBEXI_TIMELINE_CONFIG`, the legacy `OPENBEXI_TIMELINE_DATA_PATH` configuration-file variable, and `yaml/sources_startup.yml`. Relative explicitly supplied paths are resolved from the caller's directory. JVM settings such as `JAVA_TOOL_OPTIONS` and the REST token variables pass through unchanged.

Both Java launchers serve static files through an explicit public-asset allowlist. Browser modules, dependency assets, models, the catalog, `json/test-data`, documentation, schemas, and icons remain public. Repository internals, deployment YAML, arbitrary JSON files, Java sources, build output, dotfiles, and directory listings are unavailable. Symlinks cannot expose an unpublished file or escape the document root. The two existing browser view-test files remain available; other tests and developer tools are linked through GitHub. Add new public asset locations to `PublicAssetServlet` deliberately.

Keep writable API data outside the static document root, provide tokens through environment variables or the deployment's secret manager, and terminate TLS at a trusted reverse proxy. Never place credentials in shared URLs or checked-in configuration. See [REST API deployment](rest-api.md) for role tokens and storage settings.
