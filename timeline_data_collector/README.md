# Timeline data collector

The public ingestion core for OpenBEXI Timeline 2.9. It discovers independently
built packages in `HBDS/plugins/<name>` or installed Python entry points. The
timeline servers read existing JSON without running the collector or installing
converters.

Install Python 3.12+ and Java 17+ for the Java plugins. The collector and timeline
server share the repository-root `.venv`. Reuse it if it already exists.
From the repository root:

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -e timeline_data_collector
# Build Java packages independently before installing their wheels.
mvn -f HBDS/plugins/earthquake/pom.xml verify
mvn -f HBDS/plugins/volcano/pom.xml verify
mvn -f HBDS/plugins/default/pom.xml verify
.venv/Scripts/python -m pip install -e HBDS/plugins/mqtt
.venv/Scripts/python -m timeline_data_collector validate --workspace HBDS/GEO_Workspace.json
.venv/Scripts/python -m timeline_data_collector serve --workspace HBDS/GEO_Workspace.json --allow-workspace HBDS/workspace.json
```

On Unix, use `.venv/bin/python`. Activate the environment before using the
standalone commands below. See [IntelliJ setup](../.run/README.md) for shared
run configurations and Java settings.
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
`--once` finishes one conversion pass and exits; it does not restrict the input
dates or keep watching for new files. Omitting date options leaves date selection
to the converter. A single `--date YYYY-MM-DD` selects only that day; add
`--end-date YYYY-MM-DD` to process through a later day.
The console lists selected sources before starting, reports disabled or missing
inputs, and shows scanning, checksum, input-copy, conversion and publication
progress. Long conversion/publication calls report that they are still working
every 10 seconds. Progress goes to stderr; the final JSON result stays on stdout.
Only namespaces included in the selected workspace are considered.
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

For a moving UTC day, use `run --workspace HBDS/workspace.json --date today
--mode watch --interval-seconds 2 --lookback-hours 48`. The day is resolved at
each pass, including after midnight. The lookback includes calendar days covering
the preceding 48 hours so late data can update earlier reports. Use zero for a
strict current-day window. Fixed dates and ranges also work with repeats. The
dashboard's date fields apply to repeats as well as one-shot conversions.
`--once` retains its one-pass behavior. INFO contains a measured summary for
active work and availability changes; polling and parser details use
`--log-level DEBUG`. Use `--json` for machine-readable one-shot job results.

For automatic server startup, put the window and quiet period on each source:
```yaml
execution:
  mode: watch
  date: today
  lookback_hours: 24
  interval_seconds: 2
  settle_seconds: 10
  overlap: skip
  resume_on_restart: true
```
Start `serve --workspace <workspace.json> --log-level INFO --log-file <local-log>`.
This watches today and yesterday UTC. Saved UI schedules retain their own date
selection and an explicitly stopped schedule stays stopped after restart.
The file readers persist metadata observations and wait for the configured quiet
period before reading a new revision. Writes reset only that file's timer.
Snapshot sources wait for the complete input group to settle to avoid deleting
records from a file still being uploaded. A one-shot run retains its immediate
processing behavior. Content checksums are cached by verified file revision and
periodically audited; unchanged polling does not reread the entire archive.

`GET /api/health` reports active sources, settling/missing inputs, failures,
stalled publication and snapshot capacity. Run the independent watchdog with
`python tools/monitor-collector.py --url http://127.0.0.1:8765`. It samples every
60 seconds, writes `latest.json` and daily JSONL history under
`.local-private/timeline-collector/monitor`, and records an unreachable server
if the collector exits. INFO reports health transitions; both processes keep
running until stopped. Monitoring requires the computer to remain awake.
`--log-file` retains three 10 MiB backups of the collector log.

Plugins return source-owned upserts, explicit deletions, or an explicit complete
snapshot. Absence from a partial feed never implies deletion. Conflicting IDs
from different sources fail publication. Existing stable IDs are preserved;
missing IDs derive from the source key and normalized content. Plugin versions
and job IDs are provenance, not event identity.

Converters can publish progressive batches, including individual records, before the
whole input finishes. Each batch uses the same atomic publication and rollback
mechanism. Intermediate batches retain the prior input checkpoint; only the
final batch accepts the input and acknowledges its source. A failed or cancelled
run keeps its published records and retries unfinished input using stable IDs.

The publisher validates each batch and writes directly to the configured target,
using temporary files beside their final destinations for atomic replacement. It
updates only changed reports and descriptors, then atomically
replaces `.timeline-collector/publication.json` with the new namespace snapshot
and checkpoints. Both timeline backends read that committed snapshot. Dated JSON
exports remain available for existing consumers; a pending journal restores
their previous bytes after a failed or interrupted write. Reports are partitioned
by namespace and UTC start hour, named
`<namespace>_<sessions>_<events>_<YYYY-MM-DDTHHZ>.json`; for example,
`EXAMPLE_2_10_2026-10-19T14Z.json`. Session counts follow the timeline's
classification (`activities` array or `data.kind: session`); counts include only
top-level records and exclude zones and nested activities. Cross-hour sessions
stay in their start hour. Only affected hours and descriptors change. Old count
filenames are retired in the same recoverable publication transaction. Both
servers exclude active exports from indexing and read the atomic snapshot, so
filename changes cannot duplicate data. Exports remain readable without collector
state, and old daily collector reports migrate on the next publication.
On first adoption,
existing materialized records and descriptors are retained in the snapshot;
ordinary legacy report files are kept. New independently written files remain readable.
Directories ending in `_legacy`, `_backup`, or `.bak` are comparison/rollback
copies. They are excluded from adoption and from the committed reader inventory;
their JSON is never parsed or changed by publication.
The snapshot and acquisition cache are local operational data and never ship.
Snapshot ownership is stored as record IDs; each event payload appears only once.
Older snapshots containing per-source payload copies are upgraded automatically,
preserving their IDs, checkpoints and ordinary timeline reader compatibility.

Converters that own local archive discovery may implement `read_local(context)`
to yield `InputBatch` values without first copying the entire input. The runner
uses it only for the `local` source plugin; other connectors keep their reader.
Such converters must pin file revisions, honor configured selection rules,
exclude generated output, and advance the checkpoint only after the selected
input succeeds. The source lease and shared publisher still apply. Standalone
commands, UI actions and scheduled runs all use this same path.

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
