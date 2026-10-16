# Third-party components and release review

Third-party components retain their own licenses. The first-party
[application license](../LICENSE) cannot replace them. The source release excludes
`node_modules`, downloaded JARs, build outputs, and local certificates; the
package lock and Maven descriptor specify dependencies to install separately.

The installed browser packages and copied helpers were checked against their
package metadata and license notices on October 1, 2026:

| Component | Version | License and notice location |
| --- | --- | --- |
| Three.js | 0.168.0 | MIT; `node_modules/three/LICENSE`. |
| three-spritetext | 1.8.2 | MIT; `node_modules/three-spritetext/LICENSE`. |
| simple-jscalendar | 1.4.5 | MIT; `node_modules/simple-jscalendar/LICENSE`; the copied calendar stylesheet also retains its MIT header. |
| yaml | 2.8.3 | ISC; `src/vendor/yaml/LICENSE`. |
| Ajv validation and runtime helpers | 8.20.0 | MIT; complete notice embedded in `src/openbexi_timeline_schema_validators.js` by its generator. |

Retain these complete notices when distributing a build that bundles the
components. A build also needs the notices for transitive and copied
dependencies, not just these package names. Preserve source headers and asset
attribution. The Pages builder includes the installed browser package licenses.

The editor vendors the browser modules from `yaml` 2.8.3 under
`src/vendor/yaml/`, including its complete ISC `LICENSE`. The lockfile pins the
source package. Pages and source packaging include these modules and that notice.

The Java dependencies and overrides are listed in [pom.xml](../pom.xml).

The optional Python server declares its dependencies in [pyproject.toml](../pyproject.toml)
and pins the validated runtime in [requirements.lock](../requirements.lock).
Their installed distributions include their own license and attribution files;
retain those files when bundling Python, including the native parser/regex wheels.
Python and SQLite also carry their own notices. The benchmark-only `psutil`
dependency is installed separately and is not required to run the service.
The installed `javax.websocket-api` 1.1 parent POM declares CDDL 1.1 / GPL 2
dual licensing; do not replace those terms with the application's license.
The JSON-java 20260814 POM declares public-domain status; jsoup and SLF4J
declare MIT, zstd-jni declares BSD 2-Clause, and re2j declares the Go license.
Other resolved artifacts also carry their own notices and, where applicable,
native-library attribution. This metadata inventory is not a clearance of the
complete runtime bundle.
Inspect resolved dependencies and each artifact's POM/license files before
distributing a bundled runtime. Development dependencies also carry their own
terms if redistributed. Useful inventory commands are:

```sh
npm ls --all
mvn dependency:tree
```

The existing repository includes example datasets, images, and icons. Their
presence in a public repository does not establish commercial redistribution
rights. The owner must review provenance and permissions for the selected paid
bundle. This document records release-review work still needed; it is not a
claim that every dependency or asset has been cleared for commercial use.

## Collector distributions in 2.9

The Windows installer also bundles the Python 3.13.16 embeddable runtime,
its PSF license, SQLite/OpenSSL notices, and installed Python distribution
licenses. The pinned dependencies are in
[collector-requirements.txt](../release/windows/collector-requirements.txt).
They include PyYAML (MIT), jsonschema and its supporting libraries (MIT),
and Paho MQTT (EPL-2.0 / EDL-1.0). Optional S3, SFTP and Oracle drivers are
installed separately and retain their upstream terms.

The independently built Java plugin JARs retain their dependency license
and notice resources. Earthquake acquisition additionally bundles Apache
Commons Compress (Apache-2.0) and XZ for Java (public domain). Build and runtime
manifests record artifact checksums. The Inno Setup compiler and test MQTT
broker are build tools and are not included in the installer.
