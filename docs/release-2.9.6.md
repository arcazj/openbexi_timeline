# OpenBEXI Timeline 2.9.6

This release adds GEO history collection and recovery for missing collection
days, and fixes volcano archive failures when ground and aviation notices share
an upstream identifier.

## GEO collection

- Shared IntelliJ configurations provide `GEO_collector` for scheduled
  collection, `GEO_collector_7_days` for the previous seven complete UTC days,
  and `GEO_collector_fill_gaps` for catching up through today.
- The collector accepts `--date past-N-days`. The interval excludes the current
  UTC day and is recalculated on each launch.
- `--fill-gaps` uses each GEO source's recorded collection history to retry
  missing or incomplete days. It rechecks the last fully covered day for late
  arrivals and corrections. A current-day poll never marks the whole day as
  complete. With no history, `--initial-days 7` starts seven days before today
  and includes today.
- Each day has its own job result. A failure stops that source's catch-up while
  allowing the other source to continue; the next run retries unfinished work.
- Earthquake catch-up refreshes cached archive intervals. Volcano historical
  ranges use bounded archive requests with resumable checkpoints and refresh
  completed ranges on subsequent runs.
- Volcano ground and aviation notices retain separate, stable identities even
  when the upstream identifier is shared. Interrupted older checkpoints replay
  automatically with the corrected identity rules.

Catch-up can fill gaps supported by retained job history and upstream archives.
It does not infer every historical gap from exported files. See the
[collector guide](../timeline_data_collector/README.md) for options and limits.

## Upgrade

The application and collector core are **2.9.6**. Earthquake and volcano plugins
are **1.0.1**, including their independent Java converters; other public plugin
versions are unchanged. The packaging tool selects each Java artifact using its
declared plugin version.

Upgrade the core and both GEO plugins together. Source installations must
rebuild the Java plugins; release packages include them. Restart running
services and reload browser pages after upgrading. Existing data and job history
remain usable; no manual checkpoint deletion is required.

## Validation

See the [validation report](release-2.9.6-regressions.json) for checks performed
on this release candidate. GitHub Actions verifies the committed source and
live demos before tagging. The tagged release workflow builds and tests the
Windows installer before publishing installers, source archives, plugin
packages, release notes and checksums.

The public release uses the reviewed file allowlist. Personal IDE settings,
environment files, collected data, credentials and local diagnostics are
excluded. The published 2.9.5 release remains unchanged.
