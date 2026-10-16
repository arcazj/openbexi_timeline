# Timeline data collector

The public ingestion core for OpenBEXI Timeline 2.9. It discovers independently
built packages in `HBDS/plugins/<name>` or installed Python entry points. The
timeline servers read existing JSON without running the collector or installing
converters.

Install Python 3.12+ and Java 17+ for the Java plugins. From the repository root:

```powershell
python -m venv timeline_data_collector/.venv
timeline_data_collector/.venv/Scripts/python -m pip install -e timeline_data_collector
# Build Java packages independently before installing their wheels.
mvn -f HBDS/plugins/earthquake/pom.xml verify
mvn -f HBDS/plugins/volcano/pom.xml verify
mvn -f HBDS/plugins/default/pom.xml verify
timeline_data_collector/.venv/Scripts/python -m pip install -e HBDS/plugins/mqtt
timeline_data_collector/.venv/Scripts/timeline-data-collector validate --workspace HBDS/GEO_Workspace.json
timeline_data_collector/.venv/Scripts/timeline-data-collector serve --workspace HBDS/GEO_Workspace.json --allow-workspace HBDS/workspace.json
```

On Unix, use `bin/python` and `bin/timeline-data-collector` in the environment.
The dashboard defaults to `http://127.0.0.1:8765`. The HBDS editor has a **Data
collector** link. Opening either page does not start ingestion. Select an
enabled namespace/source and choose Run conversion, Run again, or Start repeat.
The dashboard only accepts local origins and requires a CSRF token and current
configuration revision for job creation. Configuration edits remain in HBDS.

Standalone conversion uses exactly the same runner as dashboard jobs:

```powershell
timeline-data-collector run --workspace HBDS/GEO_Workspace.json --namespace earthquake --source input --date 2026-10-01 --end-date 2026-10-15 --once
timeline-convert-earthquake --workspace HBDS/GEO_Workspace.json --namespace earthquake --once
timeline-data-collector run --workspace HBDS/GEO_Workspace.json --plugin volcano --mode interval --interval-seconds 300
```

The plugin-specific command is installed with its wheel or editable package.
`--date` accepts `today`, `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`; ranges are inclusive
UTC calendar dates. `--offline` forbids remote acquisition. `--validate-only`
checks the selected configuration and plugin capabilities. `--force` reprocesses
input and preserves other source contributions. A repeated `--request-id`
returns the existing job; changing its parameters is an error.

## Configuration

`HBDS/workspace.json` serves committed earthquake/volcano samples using **NONE**.
`HBDS/GEO_Workspace.json` acquires live data into separate `/data/earthquake` and
`/data/volcano` targets. Both preserve the separate namespaces, All view,
namespace buttons, and `by_namespace` grouping. The seven catalog demos remain
independent of ingestion.

A version 3 namespace owns a list of source instances. For example, a local
JSON feed and an MQTT feed can share a namespace:

```yaml
config_version: 3
namespace: EXAMPLE
model: models/example.json
target_path: ../../.local-private/events/EXAMPLE/yyyy/mm/dd
sources:
  - id: files
    source_plugin: local
    converter_plugin: timeline_json
    source_path: ../../examples/EXAMPLE/input
  - id: subscription
    source_plugin: mqtt
    converter_plugin: mqtt
    options:
      host: localhost
      topic: example/events
      qos: 1
    execution:
      mode: stream
      resume_on_restart: false
```

Workspace references resolve relative to the workspace file; source/target
paths resolve relative to the namespace YAML. Models resolve against the HBDS
root. Plugin roots and state storage are service settings relative to that root:

```yaml
config_version: 3
plugins:
  roots: [plugins]
state_root: ../.local-private/timeline-collector
collector_ui:
  host: 127.0.0.1
  port: 8765
```

Version 2 documents remain readable. `tools/migrate-collector.py --workspace
<file>` previews migration; `--apply` creates exact `.pre-v3.bak` rollback copies.
An optional local mapping translates old plugin IDs. `--static` explicitly
chooses NONE; disabled operational sources otherwise retain their converter.
Running the migration again produces no changes. Restore the backup bytes to
roll back; output datasets are never relocated by this tool.

## Plugins and delivery

| Package | Capabilities | Modes |
| --- | --- | --- |
| `filesources` | Local files, SFTP, S3 and Oracle readers | once, interval, watch |
| `timeline_json` | Validate compatible JSON, JSONL and gzip input | once, interval, watch |
| `earthquake` | USGS acquisition and Java conversion, including archives | once, interval |
| `volcano` | USGS notices and Java conversion, including archives | once, interval |
| `default` | Seeded Java sessions, events, activities and zones | once, interval |
| `mqtt` | MQTT 3.1.1 QoS 1 acquisition and compatible JSON conversion | once, stream |

MySQL, Kafka and other feeds can be added through the same plugin API; those
drivers are not included. S3, SFTP and Oracle use optional dependencies in
`HBDS/plugins/filesources/pyproject.toml`. Their adapter regressions use controlled
driver fixtures; deployment credentials/services are needed for a live connection.
The `filesources` package supplies `local`, `json_file`, `s3`, `sftp` and `oracle`
aliases. Java packages use a small Python adapter and separate shaded JARs.

See [the plugin contract](../HBDS/plugins/README.md) and each package README.
Private packages are optional and live under ignored plugin directories. The
public core imports no private parser or private fixture.

## Runs, repeats and recovery

Jobs snapshot validated configuration and store durable status in SQLite. Each
source holds an OS lease keyed by its canonical target, namespace and source ID;
workspace aliases cannot bypass it. A crashed process releases its lease.
Interrupted jobs are marked failed on restart, with their last committed output
retained. Run again starts a new job and reuses durable checkpoints.

Interval runs wait the configured delay **after** completion. Watch mode polls
and skips unchanged input. Stream mode maintains one subscription. Repeats are
persisted but restart automatically only with `resume_on_restart: true`.
Overlapping work is skipped, not queued indefinitely. Cancelling a job retains
already committed batches. A running job keeps its original configuration;
subsequent submissions reload configuration and reject stale UI revisions.

Plugins return source-owned upserts, explicit deletions, or an explicit complete
snapshot. Absence from a partial feed never implies deletion. Conflicting IDs
from different sources fail publication. Existing stable IDs are preserved;
missing IDs derive from the source key and normalized content. Plugin versions
and job IDs are provenance, not event identity.

The publisher stages and validates reports and descriptors, then atomically
replaces `.timeline-collector/publication.json` with the new namespace snapshot
and checkpoints. Both timeline backends read that committed snapshot. Dated JSON
exports remain available for existing consumers; a pending journal restores
their previous bytes after a failed or interrupted write. On first adoption,
existing materialized records and descriptors are retained in the snapshot;
legacy report files are kept. New independently written files remain readable.
The snapshot and acquisition cache are local operational data and never ship.

Publication currently materializes a namespace snapshot in memory, with a
64 MiB serialized snapshot limit matching the timeline backends' default read
budget. Ownership/checkpoint metadata counts toward that limit. Oversized
adoption or output fails before replacing reports or advancing checkpoints;
existing materialized data remains readable. Large archives need capacity
planning before migration. This release does not claim unbounded streaming
history. The regression report records publication timings and HTTP behavior.

MQTT acknowledges QoS 1 messages only after durable publication (or durable
quarantine for malformed payloads). Replays upsert stable IDs. Persistent client
IDs and broker persistence provide at-least-once delivery across reconnection;
broker loss/retention policy still determines availability. QoS 0 and QoS 2 are
not supported by this adapter. Buffer and payload limits stop ingestion safely
with messages unacknowledged when capacity is exhausted. See its README for
limits, credentials, TLS, malformed-message policy and test setup.

## Verification and distribution

```powershell
python -m pip install -r timeline_data_collector/requirements-test.txt
# Install Mosquitto separately, or set TIMELINE_TEST_MOSQUITTO to its executable.
python tools/test-collector.py
python tools/build-collector.py
```

Public package builds use an explicit allowlist and produce independent wheels
and Java JARs. Tests cover recovery before/after commit, cross-process leases,
idempotency, UI request checks, fan-in, unchanged input, forced reruns, legacy
Java converter behavior and actual MQTT replay. The full release also runs the
existing Java, Python, JavaScript, browser and installer suites.
