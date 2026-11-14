# OpenBEXI Timeline 2.9.5

This release improves timeline lookup performance, collector scheduling and
recovery, and the responsiveness of grouped event and session layouts.

## Timeline and server

- Descriptor requests can select a checksum-verified publication part using
  optional record-ID hints. Older publications remain readable.
- Backward history searches use ordered streams of current, pinned file
  versions, avoiding scans through obsolete records. Query cursors, filtering,
  cancellation, and partial-coverage reporting are preserved.
- Grouped layouts check eligibility before copying display metadata and avoid
  repeatedly copying nested child trees. Source records remain unchanged.
- Overview controls restore their enabled state after loading. Previous-activity
  searches retain the current view when coverage is incomplete.
- Python request logs include HTTP methods and diagnostic context. Expected
  Windows client disconnects no longer produce misleading callback failures.

## Collector

- Current-day sources receive priority, while historical dates advance fairly
  and newly arrived files take priority over unchanged-file cleanup.
- Large namespaces use bounded immutable publication parts with atomic
  checkpoint updates. Unchanged parts can be reused.
- Missing target exports are recovered from committed publication data or by
  replaying available source inputs. Removing sources does not remove previously
  published records.
- Verified source cleanup, compression, cancellation, and interrupted-job
  recovery retain durable output. Progress reporting distinguishes completed
  work from idle checks and cache reuse.

## Upgrade and validation

The application and collector core are **2.9.5**. Updated public plugins are
**filesources 1.0.3**, **loki 1.0.2**, and **timeline_json 1.0.1**; other plugin
versions are unchanged.

Restart running services and reload browser pages after upgrading. The Python
server creates its additional history indexes automatically; the first startup
can take longer on a large database. Existing data and checkpoints remain usable.

The release is built from an isolated public-file allowlist. Deployment-specific
plugins, configuration, source logs, target data, credentials, and local
diagnostics are excluded. See the [validation report](release-2.9.5-regressions.json)
for the recorded checks. Installer publication requires a successful installed-app
test and verified release assets and checksums.
