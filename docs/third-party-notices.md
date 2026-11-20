# Third-party components and release review

Third-party components retain their own licenses. The first-party
[application license](../LICENSE) cannot replace them. The source release excludes
`node_modules`, downloaded runtimes, build outputs, and local certificates.
The npm and Python lockfiles specify dependencies to install separately.

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

The Python server declares its dependencies in [pyproject.toml](../pyproject.toml)
and pins the validated runtime in [requirements.lock](../requirements.lock).
Their installed distributions include their own license and attribution files;
retain those files when bundling Python, including the native parser/regex wheels.
Python and SQLite also carry their own notices. The benchmark-only `psutil`
dependency is installed separately and is not required to run the service.
The native MongoDB and TLS compatibility dependencies also retain their installed
license files and native-library notices. Inspect resolved distribution metadata before
distributing a bundled runtime. Development dependencies also carry their own
terms if redistributed. Useful inventory commands are:

```sh
npm ls --all
python -m pip list
python -m pip inspect
```

The Windows socket accept compatibility helper in
`python/openbexi_timeline_server/connections.py` adapts the AcceptEx setup from
[CPython 3.13.16](https://github.com/python/cpython/blob/v3.13.16/Lib/asyncio/windows_events.py).
Copyright (c) 2001-2024 Python Software Foundation; All Rights Reserved.
Its [PSF-2.0 license](licenses/PSF-2.0.txt) is included in the source distribution
and server wheel. The adaptation closes pending sockets on failure or cancellation,
retries transient peer disconnects, and scopes the compatibility guard to the
application's running Proactor loop without changing subprocess support.

The existing repository includes example datasets, images, and icons. Their
presence in a public repository does not establish commercial redistribution
rights. The owner must review provenance and permissions for the selected paid
bundle. This document records release-review work still needed; it is not a
claim that every dependency or asset has been cleared for commercial use.

## Python distributions in 2.9.7

The Windows installer also bundles the Python 3.13.16 embeddable runtime,
its PSF license, SQLite/OpenSSL notices, and installed Python distribution
licenses. The pinned dependencies are in
[collector-requirements.txt](../release/windows/collector-requirements.txt).
They include PyYAML (MIT), jsonschema and its supporting libraries (MIT),
and Paho MQTT (EPL-2.0 / EDL-1.0). Optional S3, SFTP and Oracle drivers are
installed separately and retain their upstream terms.

The independently built public plugin wheels run in Python and retain their
distribution notices. The generator, earthquake and volcano implementations use
the Python standard library through the collector; no JAR is included.
Build and runtime manifests record artifact checksums. The Inno Setup compiler and test MQTT
broker are build tools and are not included in the installer.

## Dinosaur visual assets

The local `icon/dinosaurs/manifest.json` records the source, creator, license,
hashes and representation type for each genus. Smithsonian's Triceratops
composite skeleton and matching photograph are marked CC0 by the museum.
The other imported genus illustrations come from 3D Assets and are released
under CC0 1.0; they are stylized AI-generated assets, not validated anatomical
reconstructions. Original schematic fallback symbols are labeled separately.
See [dinosaur asset research and provenance](dinosaur-assets-research.md) for
primary collection pages, license links and the offline Draco decoding step.
Keep this attribution and the manifest when distributing those assets.
