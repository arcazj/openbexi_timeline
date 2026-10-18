# HBDS configuration

Each namespace has one YAML file, named `<namespace>_<model_name>.yml`. Its
`namespace` and `model` fields define its identity; underscores in either name are
allowed. Java, Python, the collector and HBDS Editor use the same files.

```text
openbexi_timeline/
  HBDS/
    yaml/                   Namespace configuration
    models/                 Display model JSON
    filters/                Saved filter profiles
    users/                  User metadata
    groups/                 Group metadata
    roles/                  Role metadata
    grants/                 Namespace grants
    schema/                 Shared validation schemas
    service.yml             Generic listeners and service settings
    service.local.yml       Optional private service settings
    workspace.json          Committed earthquake and volcano demo samples
    GEO_Workspace.json      Live earthquake and volcano data under /data
    *_Workspace.json        Other local timeline workspaces
    templates/              Reviewed demos and legacy compatibility examples
  GCS_data_collector/        Local collector module with its own dependencies
```

Metadata belongs in HBDS. Raw input and generated events remain at the configured
data paths. Backups belong outside HBDS and outside published source trees.
The collector module remains a separate private repository and is excluded from
the parent repository and source releases.

## Namespace files

[`yaml/DEMO_default.yml`](yaml/DEMO_default.yml) and
[`models/default.json`](models/default.json) provide a working generic example.

```yaml
config_version: 2
namespace: DEMO
model: models/default.json
enable: true
target_path: ../../.local-private/events/DEMO/yyyy/mm/dd
connectors: [java_api, python_api]
sources:
  - id: incoming
    source_path: ../../examples/DEMO/input
    source_plugin: local
    converter_plugin: timeline_json
```

Models resolve relative to the HBDS root and must be inside `HBDS/models`.
Relative input/output paths resolve relative to their namespace YAML file.
`target_path` is the materialized event directory. By default it must include the
exact namespace as a complete path component. For existing local datasets with
another directory layout, set `allow_external_namespace_path: true` beside
`target_path` in that namespace YAML. This preserves the existing data location;
output paths must still be unique and non-overlapping across namespaces. A
display model is a separate JSON file.

An input can be local, `s3://bucket/DEMO/logs/`, or `sftp://host/DEMO/logs/`.
Retrieval and conversion are independent: `source_plugin` selects the reader;
`converter_plugin` selects the JSON translator. Collector readers currently
support local files, SFTP, S3 and Oracle; converters support legacy logs and
timeline JSON. Provider settings belong in `options`. S3 uses the SDK credential
chain; do not embed credentials in URLs. When an existing input location cannot
contain its namespace, explicitly set `allow_external_namespace_path: true` on
that source. The namespace-level exception applies only to `target_path`.

Serving processes read materialized JSON and do not need the collector's plugins.
Unknown plugin IDs fail validation when ingestion is started. Disabled sources
remain in configuration. Duplicate namespaces, duplicate YAML keys, conflicting
field aliases, overlapping output paths, missing models and invalid connector
references fail before startup.

Legacy combined configurations still load through compatibility adapters.
`data_path` maps to `source_path`; `data_model` maps to `target_path`.
Supplying both names with different values is an error. Write new configuration
using the canonical fields and namespace files.

## Listeners and startup

[`service.yml`](service.yml) defines listeners by ID, owner, protocol, host and
port. Namespace files reference their IDs. A process starts each enabled,
referenced listener owned by that backend once, even when namespaces share it.
Java and Python may run together on different ports. Conflicting bindings fail.
`enable: false` retains a listener without binding it.

From the timeline project root:

```powershell
# Validate without opening a listener.
.venv/Scripts/python.exe -m openbexi_timeline_server -dataconf HBDS/yaml/DEMO_default.yml -serverconf HBDS/service.yml --hbds-root HBDS --check

# Python: default listener http://127.0.0.1:8783
.venv/Scripts/python.exe -m openbexi_timeline_server -dataconf HBDS/yaml/DEMO_default.yml -serverconf HBDS/service.yml --hbds-root HBDS

# Java: after Maven compilation and runtime dependency copying; default port 8080
java -cp "target/classes;target/runtime/*" com.openbexi.timeline.server.openbexi_timeline -dataconf HBDS/yaml/DEMO_default.yml -serverconf HBDS/service.yml --hbds-root HBDS

# Collector: generate the supplied synthetic event.
GCS_data_collector/.venv/Scripts/python.exe -m gcs_collector.data2json -dataconf HBDS/yaml/DEMO_default.yml -serverconf HBDS/service.yml --hbds-root HBDS --date 2026-09-12 --end-date 2026-09-12 --offline
```

Pass additional namespace filenames after `-dataconf`, before the next option.
`-data_conf` and `--data-conf` remain accepted aliases. Use `-serverconf
HBDS/service.local.yml` for private deployment settings. The PowerShell launcher
accepts an array of filenames; IntelliJ configurations include default examples.
Install both Python packages in their own environments before module commands.

Each timeline has its own workspace file in HBDS. A workspace selects namespace
files and a service file, and owns its tab state, default namespace and filename
aliases. The included public workspaces are:

| Workspace | Namespace configuration | Service |
| --- | --- | --- |
| `workspace.json` (demo default) | `yaml/volcano_geoscience_demo.yml`, `yaml/earthquake_geoscience_demo.yml` | `service.yml` |
| `GEO_Workspace.json` | `yaml/volcano_geoscience.yml`, `yaml/earthquake_geoscience.yml` | `service.yml` |
| `Generator_Workspace.json` | `yaml/DEMO_GENERATOR_default.yml` | `service.yml` |

Use `<timeline>_Workspace.json` for additional local timelines. For example:

```json
{"schemaVersion": 1, "name": "Example_Workspace", "service": "service.yml", "namespace_files": ["yaml/DEMO_default.yml"]}
```

Namespace and service references resolve relative to the workspace file. Both
servers accept `--workspace HBDS/<timeline>_Workspace.json`; `-serverconf` overrides
its `service` field. Older workspace files without `service` select
`service.local.yml` when present, otherwise `service.yml`. Public workspaces
explicitly select `service.yml` to remain independent of private deployments.
Use either `--workspace` or `-dataconf`.

In IntelliJ, use the shared configurations in [`.run`](../.run/README.md):
**Timeline Java - Default** serves the committed samples; **Timeline Java - GEO**
serves collected earthquake and volcano data. Both use `service.yml` and the
default browser address `http://127.0.0.1:8080/openbexi_timeline.html`.
The obsolete `openbexi_timeline*` launches using `-data_conf yaml/sources_*.yml`
can be removed. Those legacy templates request TLS listeners and require
`TIMELINE_KEYSTORE` and `TIMELINE_KEYSTORE_PASSWORD`.

**Generator - Demo** replaces the old `event_generator` and
`event_generator_zone` launches. It runs the `default` collector plugin once,
offline, with a fixed seed, and writes sessions and zones under
`.local-private/events/DEMO_GENERATOR`. To view them, launch either server with
`--workspace HBDS/Generator_Workspace.json`. The collector dashboard also offers
this workspace alongside the demo and GEO workspaces.

The namespace YAML remains authoritative for data paths, models, connectors and
enable flags. Editor saves update the selected workspace, leaving other workspace
files intact. Shared namespace or model edits affect all workspaces referencing
those same files. Python indexes use a separate default state directory for each
workspace. Listener and namespace-list changes take effect after restart.

```powershell
# Build Java classes, the JAR and runtime dependencies using JDK 17 or newer.
mvn --batch-mode --no-transfer-progress verify

# Both launchers default to the committed demo samples.
./tools/start-java-server.ps1 -Check
./tools/start-python-server.ps1 -Check
./tools/start-java-server.ps1
./tools/start-python-server.ps1

# Select live openbexi_quake data under /data with either backend.
./tools/start-java-server.ps1 -Workspace HBDS/GEO_Workspace.json -Check
./tools/start-python-server.ps1 -Workspace HBDS/GEO_Workspace.json -Check

# Build the distributable Python server package.
.venv/Scripts/python.exe -m pip wheel --no-deps --wheel-dir dist/python .
```

Run the two launch commands in separate terminals. Java's shell/batch launcher
also selects the workspace by default. Set `JAVA_HOME` to the installed JDK if
the system `java` command points to an older runtime. `groups/index.json` contains
group metadata; it is not the server's namespace startup list.
After startup, each active workspace listener logs `Web UI ready: <URL>`. Open
that link to load its workspace in `openbexi_timeline.html`; no HTML setting is
needed in `workspace.json`. The default/GEO links are
`http://127.0.0.1:8080/openbexi_timeline.html` for Java and
`http://127.0.0.1:8783/openbexi_timeline.html` for Python. URLs use the listener's
HTTP/HTTPS scheme, actual port and configured context path. Wildcard bind
addresses use loopback in the browser link. Explicit Java `web_ui` overrides
remain supported, including the optional listener-port filter.

The default workspace reads the reviewed samples in `examples/geoscience/`
directly. These originated in the committed `openbexi_quake/json/` examples;
their provenance is recorded in `examples/geoscience/README.md`. The demo model
`models/geoscience_demo.json` opens August 21 through September 20, 2024, so
earthquakes and volcano notices appear together. No collector or `/data` mount
is needed for the demo.

Each server process serves one workspace. To run several workspaces concurrently,
give them service files with distinct listener ports. Merely selecting another
workspace does not override namespace `enable` flags. The public GEO example
expects materialized JSON under `/data/volcano/yyyy/mm/dd` and
`/data/earthquake/yyyy/mm/dd`; provide that data or
change its namespace paths for your deployment.

The live GEO model `models/geoscience.json` opens **All** namespaces in a daily
view centered on the current time with a monthly overview so recent
volcano notices and earthquakes remain visible between updates. **All**,
**volcano**, and **earthquake** buttons appear above Sorting & Filtering.
Use **Find previous activity** to locate older events.
An empty date interval does not imply that the source directory is empty.

Saved filters for named workspaces live privately in
`HBDS/filters/workspaces/<workspace filename without extension>/` on both servers.
Thus models with the same timeline name keep separate selections in SOC and GEO.
Existing flat profiles are read only when their recorded source namespaces match
the selected workspace; subsequent saves use the workspace directory and preserve
the original files. A workspace without a matching profile starts with **ALL**
and includes **by_namespace**, which groups all events by namespace without
excluding either source.

Both configurations and the reviewed demo samples may be committed. Generated
`/data` content is excluded from Git, Docker build input and source releases.
The live paths are read at runtime; their contents are never copied into the demo.

HTTPS uses `tls.certfile`/`tls.keyfile` for Python, or `tls.keystore` and
`tls.password_env` for Java. Keystore passwords come from the named environment
variable. TLS files resolve relative to the service YAML. Native Python listener
sets currently run with one worker; legacy single-listener worker launches remain
supported. Listener and ingestion changes require a restart.

## HBDS Editor

Open **Settings → HBDS Editor** on either running backend. The editor projects the
loaded YAML files and models into one workspace. Selecting a namespace selects
its model and tabs. Model changes refresh affected tabs; unrelated tabs and
event identities stay intact. Models can be shared between namespaces.

Saving checks the revision and validates the candidate, preserves unknown
configuration fields, and leaves unedited namespace files byte-for-byte intact.
A model selection creates the matching filename and records an alias so the
original launch arguments still work after restart. The selected workspace stores
those filename references and tab state, not another copy of namespace data.
Failed saves restore the original files. Individual file replacements are atomic;
multi-file saves use a shared process lock and rollback on errors, rather than a
filesystem-wide transaction. Keep backups for recovery from a machine failure.

Add/remove namespace files through the startup list and restart. Import new
models into `HBDS/models` and reload the editor. Edit inputs inside each
namespace's `sources` list. Edit service definitions in the service YAML.
Invalid external edits retain the last valid active configuration; saves still
check the current disk revision.

Same-origin loopback editor requests can administer HBDS without a token. Remote
administration requires the existing administrator credential. User/group/grant
metadata does not itself implement a new login or event authorization system.
Metadata and credentials are never served as static files; the public timeline
receives the selected display model and namespace/tab information.

The shared default users are `admin` and `guest`, defined in
[`users/defaults.json`](users/defaults.json), with matching
[`roles/defaults.json`](roles/defaults.json) and
[`groups/defaults.json`](groups/defaults.json). The admin role has the `admin`
ceiling; the guest role has the read-only `r` ceiling. Namespace grants remain
explicit: these defaults add neither grants nor login passwords.

Both servers merge those defaults with local `users/index.json`,
`roles/index.json` and `groups/index.json` entries by ID. Existing empty indexes
still receive the defaults. When using a separate HBDS directory without default
files, the servers read the shipped defaults from the project HBDS directory.
The default identities remain present. The editor saves additional users and
changes to default records only in the private indexes; resetting a record to
its default removes its local override. New users start with the guest role and
group. All indexes, grants and additional user files are ignored by Git and
excluded from source releases and Docker builds, including for GEO and demo.

## Migration and verification

`python -m openbexi_timeline_server.namespace_migrate old.yml --model path/to/model.json
--hbds-root HBDS` plans a migration without writing. Supply `--apply --backup-dir
<directory-outside-HBDS>` to write validated files. Existing output data is never
moved. An output missing its namespace requires an explicit `--target
NAMESPACE=PATH`; keep the source disabled until its data migration is reviewed.
Repeating an unchanged migration is safe; conflicting destinations are rejected.
The backup records original input and created-file hashes.

Only reviewed assets listed in `release/public-files.json` are public, including
the demo and GEO workspaces, their namespace YAML and display models.
Other HBDS files are ignored by Git and excluded from releases and static serving.
The publication checker validates generic namespace examples and rejects literal
credentials, private endpoints and user records other than the unchanged
`admin` and `guest` defaults, including records embedded in public templates.
Do not add operational names, paths or data to
commits, change logs, release notes or public test fixtures.

Run Java, Python, browser/editor, migration, connector and isolated HTTP parity
tests after changes. Test duplicate listeners, missing files, failed saves,
namespace isolation, restart recovery and cache invalidation. Benchmark startup,
first results and complete warm queries on a fixed synthetic dataset and report
measurements and limits.

## HBDS design model

The existing [HBDS JSON model](schema/openbexi_timeline.json) and
[PNG diagram](schema/openbexi_timeline.png) live together under `HBDS/schema`.
They preserve the 2.8 class design and are separate from the display models in
`HBDS/models`. Their public user examples now use the shared `admin` and `guest`
defaults, and the PNG has been regenerated from the matching JSON. Rendering
and validation tools remain in `docs/design/2.8`.

The conceptual model should be updated before it is treated as documentation of
the current configuration. Recommended changes are:

1. Add `Workspace`, owning the ordered namespace-file selection, tabs, default
   namespace, service reference and filename aliases. A workspace references
   namespaces and display models; it does not duplicate their configurations.
2. Represent each namespace YAML explicitly: `config_version`, `namespace`,
   `model`, `enable`, `target_path`, connector references and its `sources` list.
   Mark `data_path` and `data_model` as migration aliases for `source_path` and
   `target_path`.
3. Separate source retrieval (`source_plugin`, `source_path`, `options`) from
   conversion (`converter_plugin`) and the materialized output read by servers.
4. Model service-owned listeners with an ID, backend owner, protocol, host, port,
   enable flag and TLS references. Namespaces reference those listeners, while
   each backend binds only the enabled listeners it owns.
5. Record the publication boundary independently of authorization: demo/GEO
   configurations are reviewed public assets; other workspaces remain local by
   default. Only the generic `admin` and `guest` user records are public; local
   user, group and role overrides remain private. Group/grant metadata does not
   itself implement runtime login or data authorization.

Use `workspace.schema.json`, `namespace.schema.json` and `service.schema.json` as
the configuration contracts for the next model revision. Keep the existing user,
group, model, band and rendering relationships that still apply, update the
generator and examples, validate the JSON, then regenerate the PNG from that same
revision. The current pair includes the default-user update; the workspace and
service changes above remain recommendations for the next model revision.
