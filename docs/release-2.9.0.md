# OpenBEXI Timeline 2.9.0

The collector now loads independent source and converter plugins. GEO opens
with both earthquake and volcano data visible, with All, earthquake and volcano
tabs above the filters and `by_namespace` grouping. Committed samples and live
`/data` configuration remain separate.

The public `timeline_data_collector` discovers compatible installed wheels and
`HBDS/plugins/<name>/plugin.json` manifests. Public packages include file/S3/SFTP/
Oracle readers, timeline JSON conversion, the default Java generators, earthquake,
volcano and MQTT. MySQL and Kafka integrations can be added through the same
contract. Operational converters and deployment data remain private.

Standalone commands accept `--workspace`; the local dashboard offers Run,
Run again, Cancel and repeat policies. Interval and watch jobs wait for each run
to finish. Streaming keeps one subscription. Restart resumption is opt-in.
Output ownership, stable IDs, checkpoints, process leases and atomic publication
are shared by CLI and UI. Failed runs preserve the last committed generation.
MQTT QoS 1 acknowledgements follow publication, with durable quarantine and
optional upstream version ordering.

Publication uses an in-memory namespace snapshot capped at 64 MiB, including
ownership and checkpoint metadata. Oversized output fails before replacing the
last successful data. Plan retention or namespace partitioning for large feeds.

Namespace/service configuration version 3 supports converter-only sources.
Version 2 remains readable. `tools/migrate-collector.py` previews migration,
supports explicit plugin mappings, and saves rollback copies with `--apply`.
Existing output paths and static `NONE` sources are preserved. The timeline
servers read materialized JSON without loading any converter.
Concurrent HBDS editors share a file-specific thread lock as well as the
cross-process lock, so stale revisions are rejected on both Linux and Windows.

The Windows x64 installer bundles Java, Python and all six public plugins.
Launch the timeline first to create its desktop workspace; the Start menu also
provides Timeline Data Collector. Optional remote reader drivers are separate
installs. User data survives upgrades and uninstall. Source ZIP and tar.gz,
independent wheels/JARs, release notes, HBDS JSON/PNGs and SHA-256 checksums are
provided with the release.
Desktop restarts preserve the workspace's selected service, plugin roots and
state settings. A launch port override uses a temporary service copy.

See the [collector guide](../timeline_data_collector/README.md),
[HBDS model and diagrams](design/2.9/README.md), and
[regression evidence](design/2.9/regression-results.json) for commands,
compatibility coverage and measured limits. Historical releases and tags are
retained.
