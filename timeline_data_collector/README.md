# Timeline data collector

Collector output uses a shared metadata normalizer. A deployment can keep its
satellite names, aliases and series in the private local file
`HBDS/reference/satellites.json`, or select another local file with
`OPENBEXI_SATELLITE_CATALOG`. The public code and release contain no operational
mapping values. A dictionary has `version: 1` and a `satellites` array whose entries
contain `name`, `series` and optional `aliases`. All collectors use this dictionary;
unknown satellite names are preserved and their series is `others`. Dictionary
changes invalidate converter checkpoints and normalize retained contributions
before upserts, preserving source ownership and canonical record IDs/dates.

The optional local catalog property `field_aliases` maps imported field names to
canonical names. Set `flatten_fields: true` to flatten nested `fields` objects
and use their subject or title as the descriptor description. The default keeps
nested fields and supplied descriptions unchanged. These settings apply to the
selected catalog without namespace-specific rules; deployment dictionaries stay
outside the public release.

Events and sessions retain their timeline `data` object. Dated descriptor files
and both timeline descriptor endpoints expose metadata at the descriptor root.
The writer preserves canonical root metadata when imported attributes collide.
Historical nested descriptors remain readable during adoption. Every namespace
uses the same Data panel, typography and icon/text interaction in 2D and 3D.

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
Run `timeline-data-collector serve --workspace HBDS/GEO_Workspace.json`.
By default, only enabled sources in the selected workspace are collected.
Repeat `--allow-workspace PATH` to collect additional workspaces in the same
process, or pass `--all-workspaces` to discover all workspace JSON documents
beside the selected workspace. Shared source/target
identities run once, even when several workspaces reference them; conflicting
definitions are rejected. An OS lease prevents a second collector process from
scheduling the same source.

The dashboard defaults to `http://127.0.0.1:8765`. The HBDS editor has a **Data
collector** link. Collection begins with the service and continues without a
browser. When additional workspaces are requested, the dashboard selects which
one to display while all requested workspaces are collected. Disabled sources and static NONE sources stay
disabled; schedules explicitly stopped in the dashboard stay stopped on restart.

Today means the current UTC calendar day, resolved again after midnight. All due
current-day sources are checked before historical work. Each enabled namespace
has a dedicated current worker in the same collector process. Its sources run
sequentially, so a long conversion cannot block unrelated namespaces.
Plugin resource locks still serialize access to shared parser state without
holding up unrelated converters.

One background coordinator starts historical work only after current workers
are idle. Changed current input interrupts a historical job at its next safe
checkpoint before conversion starts; committed output and the unfinished date
remain available for resumption. Unchanged polls do not interrupt backfill.
A namespace checks current work between its own historical units. When there is spare capacity,
history advances immediately in round-robin order, one changed file or dated
correlation unit at a time. The dispatcher checks current work between these
units; an in-flight parser/publication finishes its unit before switching.
Historical sources have their own rotation, so current polling cannot keep
returning the queue to its first source. A completed dated correlation unit
advances to the next date even when it published several progressive batches.
Optimized local readers compare scanned date revisions with completed historical
checkpoints. New or changed files in an existing date folder take priority over
ordinary backfill, even when the date folder's own timestamp has not changed.
Directory discovery skips descendants once a date partition is scheduled and
rechecks its parent folders between units. Newly arrived folders precede the
remaining historical backlog. Unknown file layouts receive a complete
background pass. Future planned records are also retained and processed in spare
time; mixed-date files are never limited to a historical cutoff. Current and historical checkpoints are committed independently
with publication, so neither can hide changes from the other. The default quiet
period is 10 seconds unless `settle_seconds` is explicitly configured. Quiet periods and
periodic checksum verification still apply. Streaming sources keep their live
subscription; generators have no historical-file scan.

Local source compression is enabled by default (`execution.compress_sources: true`).
After the quiet period, the collector writes and verifies a gzip archive before
removing the original. Identical plain/gzip pairs keep the existing gzip. When a
new plain file differs from an existing gzip, the previous archive is retained in
the source folder's hidden `.collector-revisions` directory and the new revision
becomes the canonical gzip. Open writers, changing files and failed compression
are deferred. Already compressed formats (including XLSX) remain compressed as-is.
Only selected inputs are normalized: source filters, date windows, and excluded
output directories still apply. Filters such as `*.csv` also match `*.csv.gz`.
Cleanup follows the same file/day units as collection; file-based continuous
readers limit cleanup to one second between files and continue on the next poll.
Readers may normalize a selected correlation unit together to avoid
repeatedly rebuilding correlations. Converters receive decoded working copies,
or read gzip directly when the plugin declares support. Remote originals are not modified. Completed compression counts and
elapsed time are logged at INFO; per-file diagnostics are DEBUG.

Cross-directory duplicate cleanup and timestamp-based relocation require an
explicit **source** date layout, for example:
```yaml
source_path: /var/lib/openbexi/raw/
execution:
  source_date_layout: yyyy/yyyy_MM_dd
```
Use `yyyy/mm/dd` for a source tree organized that way. The target's date template
never enables this rule: leave `source_date_layout` absent for undated inputs
such as undated ticket exports. They still receive compression and same-directory cleanup.
For dated inputs, historical passes compare decompressed SHA-256 contents within
the same host/component and file format, then verify the surviving bytes under
file locks before deleting a duplicate. Files with one unambiguous UTC trace date
move to that date folder, retaining their names and component subdirectories.
Existing files with different contents, missing/ambiguous timestamps, and files
spanning multiple UTC dates remain untouched. Explicit offsets are converted to
UTC; timestamps without an offset use the source timezone (UTC by default).
Only record timestamps (line prefixes, structured time fields, or journald time)
authorize relocation; dates mentioned inside messages or build headers do not.
Source filters and target exclusion still apply. A persistent revision index
avoids rereading unchanged files and recognizes duplicates found in later passes.
New or changed revisions are inspected again immediately. Polls read cached
revision metadata in batches. Completed cleanup is remembered,
so incoming files run before cached archive entries; interrupted or deferred
cleanup remains pending and resumes on a later pass. Continuous historical
passes budget inspection and moves/duplicate removal separately to one second
each between files, finishing any file operation already in progress. Periodic audits of
unchanged inputs select the oldest checks first, with up to 100 candidates and
one second of inspection per pass (finishing an open file). This prevents large
archives from occupying every historical turn. `--force` performs the full audit.
Current-day collection runs before this historical cleanup. INFO reports only
completed moves/removals and elapsed time; detailed decisions stay at DEBUG.

Health sampling is integrated into the same process: `latest.json` and daily
JSONL history are written every 60 seconds beneath the service state directory's
`monitor` folder. Separate monitoring launch configurations are not needed. An external OS supervisor is still needed to restart a process
after a crash.
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
INFO contains completed-work summaries: namespace, converter/log family, UTC
date range, parsed counts, new/updated records, files parsed, and elapsed seconds.
Unchanged polls emit no INFO. WARNING and ERROR remain visible. For example:

```text
INFO DEMO: Parsed source records from 2026-01-01 to 2026-01-01 UTC; 2 new, 1 updated; 4 files; completed in 1.250 s
```

During long jobs, INFO reports advancing work at most every 30 seconds of
otherwise quiet work, with the selected UTC dates, current/historical priority,
file progress when the converter supplies it, committed record totals, and elapsed
time. The first changed progressive batch is reported immediately; subsequent
batch messages are coalesced. Converter stages lasting at least two seconds also
report completion and duration. Short cache replays and per-file details stay at
DEBUG. Repeated status, zero-progress heartbeats, cache replays and source-check
progress stay at DEBUG. Periodic progress with zero new and zero updated published
records also stays at DEBUG, even when file-reading counts advance.
A blocked converter can report its shared-resource wait at DEBUG, and that wait
can be cancelled.
Completed parsing summaries remain at INFO even with zero new/updated records.
Progress logging reads counters only; it does not rescan source files.
Compression and source timestamp checks expose their own phase and file counters.
Health warnings name the problem directly. Inline publications automatically
split as they grow, so nearing the old inline size limit is not a health alert.

Use `--log-level DEBUG` for startup, configuration, plugin loading, source
selection, scanning, checksums, copying, checkpoints, scheduling and detailed
publication traces. Other plugin INFO diagnostics are downgraded to DEBUG by the CLI.

At DEBUG, slow steps report that they are still working every 10 seconds. Messages
use UTC timestamps with milliseconds and go to stderr; `--json` results stay on
stdout. `--log-file <local-path>` also retains them in a rotating local file.
New startup diagnostics do not dump plugin options, credentials, source records,
checkpoint contents or arbitrary exception payloads. URL credentials and signed
query strings are redacted. Failures identify the stage, exception type and code
location; schema failures also identify the field and validation rule.

Explicit standalone `run --once` commands only consider the selected workspace.
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

The unified service automatically schedules enabled sources. Source execution
settings still provide the polling interval and quiet period:
```yaml
execution:
  mode: watch
  date: today
  lookback_hours: 24
  interval_seconds: 2
  settle_seconds: 10
  compress_sources: true
  overlap: skip
  resume_on_restart: true
```
Start `serve --workspace <workspace.json> --log-level INFO --log-file <local-log>`.
This prioritizes today UTC, with earlier dates processed when the current queue
is idle. Legacy standalone repeats retain their explicit date-window behavior.
Readers can mark an `InputBatch` as `revalidate_only=True` when periodically
checking unchanged committed input. Such audits still run, but do not cancel
historical work. Changed input and explicit forced replays retain priority.
The file readers persist metadata observations and wait for the configured quiet
period before reading a new revision. Writes reset only that file's timer.
Snapshot sources wait for the complete input group to settle to avoid deleting
records from a file still being uploaded. A one-shot run retains its immediate
processing behavior. Content checksums are cached by verified file revision and
periodically audited; unchanged polling does not reread the entire archive.

Conflicting record IDs report both contributing source names and the ID, without
logging record contents. When retiring duplicate inputs, back up the publication
and explicitly transfer their ownership to the canonical source within the same
namespace (`Publisher.publish(..., adopt_sources=..., preserve_missing=True)`).
Removing a source from YAML alone retains its published contribution and cannot
resolve conflicting updates. Never transfer ownership between namespaces.

`GET /api/health` reports all workspaces' active sources, settling/missing inputs,
failures, stalled publication and snapshot capacity. The service records this
health automatically. Failed work stays visible across empty polls and restarts
until a complete conversion succeeds for that same source and checkpoint scope;
a successful current-day pass cannot hide a historical failure.
An interrupted idle check can also recover without rewriting output: the reader
must confirm `metrics.checkpoint_current` for the same scope and date range,
with available, settled input and a completed pass. This clears only the
interrupted-worker alert, preserving the original job and other failures.
Dashboard clients that disconnect while a response is being sent are closed
quietly; the collector keeps running and does not retry on the closed socket.
The obsolete namespace-wide 64 MiB error is treated separately after migration:
a newer, verified version 2 publication from the same source resolves that
capacity alert. Its failed job remains unchanged, and `pending_recovery` in
health retains the earlier scope until a complete replay succeeds. Startup and
successful publication reconcile these alerts; malformed or missing parts,
older commits, and other failures never qualify. Historical checkpoints are
not advanced by reconciliation.
An optional external watchdog can also detect process exit:
`python tools/monitor-collector.py --url http://127.0.0.1:8765`. It samples every
60 seconds, writes `latest.json` and daily JSONL history under
`.local-private/timeline-collector/monitor`, and records an unreachable server
if the collector exits. INFO reports health transitions; both processes keep
running until stopped. Monitoring requires the computer to remain awake.
`--log-file` retains three 10 MiB backups of the collector log.

Plugins return source-owned upserts, explicit deletions, or snapshots. Collector
runs preserve existing records absent from a snapshot: disappearing sources,
files, or rows never remove target data. Explicit record deletion commands in the
plugin contract remain distinct from missing input. Conflicting IDs
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

Before each conversion pass, the collector checks for deleted target reports,
descriptors (including nested activities), and publication parts. Missing reports
and descriptors are regenerated from the committed snapshot, even when input is
unchanged or temporarily unavailable. Intact exports and source checkpoints stay
unchanged. Idle checks list output directories without decoding the namespace
again; a changed publication invalidates that inventory.

Deleted publication parts are reconstructed from surviving reports only when
their bytes match the committed checksum. If both copies are gone, verified
surviving records are preserved and affected source checkpoints are reset,
including historical scopes. Normal collection then replays the source logs;
stable aggregate ID mappings are retained, and health notices identify records
still awaiting replay. Deleting the whole target
or its publication index also causes inputs to be processed again. Surviving
exports can be adopted even when their combined size exceeds 64 MiB, provided
each individual file fits the budget. Recovery needs a running collector and,
when no committed copy survives, the original inputs and processing of their
dates. No manual `--force` is required. Malformed or modified publication parts
remain explicit integrity errors rather than being treated as deleted files.
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

Small publications use version 1 inline events. When the namespace exceeds
64 MiB, the writer automatically uses a version 2 index with immutable,
SHA-256-verified event parts. Existing version 2 publications stay partitioned.
Small updates reuse verified, unchanged parts without serializing or reading
them a second time. Ownership maps are copied separately from historical record
payloads, and parsed timestamps use a bounded cache. Every previous part is still
checked before publication; the atomic checkpoint and rollback rules are unchanged.
Parts follow UTC start hours and split at an 8 MiB target; each index or part
must fit the backends' 64 MiB file budget. A namespace's total event history can
therefore grow past that limit. Ownership and checkpoints live in the index,
which commits atomically after all parts, reports and descriptors are ready.
The timeline server indexes committed publications immediately; the input
settling delay still applies to ordinary files being transferred.
Unchanged parts are reused; older parts remain available to readers that pinned
an earlier generation. Failed writes restore exports and preserve checkpoints.

Publication still materializes the namespace in memory. An individual record
or ownership/checkpoint index exceeding the per-file budget fails before any
output changes. First adoption of legacy reports also retains its 64 MiB input
budget; existing materialized data remains readable if adoption fails. This is
not unbounded streaming history, and retained parts require disk capacity.

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
