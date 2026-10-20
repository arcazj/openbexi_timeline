# OpenBEXI Timeline 2.9.2

This release adds an independent Loki source plugin and improves collector
configuration and workspace isolation. Existing local-file collection and
timeline JSON remain compatible.

- Loki discovers available streams and builds queries from their labels, without
  a fixed application or hostname selector. Newly discovered log families are
  archived even when the selected converter does not yet support them.
- UTC daily acquisition uses bounded concurrent queries, splits saturated query
  windows, and preserves legitimate repeated log entries. Pending gaps,
  late-arrival rescans, and hourly outage retries survive restarts.
- Raw files are committed atomically. Existing files are adopted only when their
  contents can be preserved, and missing or damaged acquired files can be
  repaired from the private acquisition journal.
- An optional source acquisition hook lets converters reuse their local-file
  reader after acquisition. The collector core remains independent of private
  conversion packages.
- The dashboard displays Loki discovery, archive, availability, and recovery
  progress. Its options editor validates changes, checks configuration revisions,
  and requires explicit migration for changes to an established archive identity.
- Scheduler resumption and dashboard job lists respect the selected workspace's
  configured sources.
- Collector documentation and generator launchers use `timeline_data_collector`
  and the shared project-root Python environment.

The application and collector core are **2.9.2**. The new `loki` plugin is
**1.0.0** and requires collector **2.9.2 or newer within major version 2**.
Other independently versioned public plugins retain their existing versions.

Installing the plugin does not enable a source or schedule. Configure a Loki
endpoint, a raw `source_path`, a converter, and a `target_path` in your own
namespace YAML. Authentication uses environment references. Shared endpoints
require explicit namespace routing; fallback endpoints must represent the same
logical source.

Successful empty historical queries cannot establish whether upstream retention
removed missing logs. Such unresolved gaps remain visible. A saturated single
nanosecond also remains a gap when completeness cannot be established. Loki
supplies no universal record identity; duplicate reconciliation uses stream,
timestamp, content, and occurrence count. Full limitations and configuration
options are documented in the [Loki plugin guide](../HBDS/plugins/loki/README.md).

The Windows installer bundles Java, Python, the collector core, and all seven
public plugins. Independent wheels/JARs, reviewed source ZIP/tar.gz archives,
shared architecture diagrams, validation evidence, release notes, and SHA-256
checksums accompany the release. Private converters, operational configurations,
internal endpoints, logs, checkpoints, and deployment data are excluded.

See the [collector guide](../timeline_data_collector/README.md),
[2.9.2 validation report](release-2.9.2-regressions.json), and
[HBDS architecture](design/2.9/README.md). Historical tags and releases are retained.
