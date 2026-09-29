# OpenBEXI Timeline 2.2.2

This patch repairs SSE startup, keeps the plot clear during source failures, and
adds advanced filtering while preserving legacy expressions and saved Sort by.

- Discover the connector route for pages that explicitly load a model. This
  fixes the REST-route HTTP 405 on an SSE port. Settings requests use finite JSON;
  the live subscription starts as visible-range loading begins.
- Keep filter, user, timeline, search and range parameters on live subscriptions.
  Reconnect automatically and reconcile changes through filtered data requests.
- Apply source exclusions and active saved filters before returning JSON records.
  Validate expressions before saving; quoted values and sorting survive reloads.
- Support `expr:` boolean expressions, grouping, typed comparisons, literal text
  matching, lists and field existence. **Filter syntax** opens inline help in the
  Sorting & Filtering editor. See the [syntax guide](filter-syntax.md).
- Show orange connection warnings beside **Refresh**. Empty ranges and errors
  leave the plot clear; previously displayed records stay available during recovery.
- Cache parsed source files with time indexes. Adjacent ranges and refreshes reuse
  unchanged files, with bounded memory and file metadata checks before reuse.
  REST remains idle after its finite load; navigation and Refresh request data.

## Validation

- JavaScript suite: 235 passed. Three focused checks also passed after the final
  reconnect and filter validation changes.
- Maven verification: 73 passed, with 34 environment-dependent tests skipped.
  Four filter and HTTP checks passed after the final server changes; the IntelliJ
  build also passed.
- Chromium: 34 checks passed across desktop and narrow layouts, covering filter
  editing, saved sorting, toolbar warnings, request recovery and viewport behavior.
- Local REST and SSE startup checks used the same model, date range, filter profile
  and data for the comparison. Timing reports, logs and screenshots remain private.
  See [connected diagnostics](connected-diagnostics.md) for the measurement method.

Restart the Java service and reload the browser to apply both sides of this patch.
Private configurations, operational data, logs and deployment captures remain local.

Earlier changes: [2.2.1](release-2.2.1.md).
