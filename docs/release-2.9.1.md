# OpenBEXI Timeline 2.9.1

This patch improves continuous collection and publication while preserving the
existing timeline JSON structure, stable record identities, and public demo data.

- Converters can publish completed batches directly to their configured target
  while a longer conversion continues. Java and Python timelines read committed
  output consistently during updates and recovery.
- Published reports are split by namespace and UTC hour. Filenames include
  session and event counts: `<namespace>_<sessions>_<events>_<YYYY-MM-DDTHHZ>.json`.
- Repeat collection uses checkpoints and cached input revisions to skip unchanged
  data. Rolling UTC date windows can include yesterday's late-arriving logs.
- Watch and interval sources can wait for a configurable quiet period before
  reading new or changing files. Settling observations survive collector restarts.
- Missing input is reported once and retried on later passes. Progress summaries
  report useful work without flooding normal logs with unchanged polling.
- The collector provides `/api/health`, rotating log files, and an independent
  local monitor that records health transitions and daily history.
- IntelliJ launchers use the project Python environment and current collector
  entry points. Public GEO and demo launchers are included.

The application and collector core are **2.9.1**. The independently built
`filesources` plugin is **1.0.1** and requires collector 2.9.1 or newer within
major version 2. Other public plugins retain their existing versions.

Existing workspaces remain compatible. Continuous operation requires the
collector server to stay running; the health monitor observes it and does not
start it. `resume_on_restart` resumes configured schedules when the collector
server is launched again. The 64 MiB committed namespace snapshot limit remains.

The Windows x64 installer bundles Java, Python, the collector core, and all six
public plugins. Source ZIP and tar.gz archives, independent wheels/JARs, HBDS
architecture JSON/PNG diagrams, release notes, regression evidence, and SHA-256
checksums accompany the release. The architecture diagrams describe the shared
2.9 architecture. Private converters, operational configurations, logs, and
generated deployment data are excluded.

See the [collector guide](../timeline_data_collector/README.md),
[2.9.1 validation report](release-2.9.1-regressions.json), and
[HBDS architecture](design/2.9/README.md). Historical tags and releases are retained.
