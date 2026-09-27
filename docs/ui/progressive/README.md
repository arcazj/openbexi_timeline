# Progressive loading and consistent panels: browser evidence

These are actual application screenshots using the public Operations sample or
synthetic responses. No private deployment data or reference screenshots are
included. The renderer is Chromium WebGL with SwiftShader on Windows, using
Playwright 1.63.0 and installed Chromium 149.0.7827.55.

| State | 1440 × 900 | 800 × 700 |
| --- | --- | --- |
| Calendar with seven readable date columns | [Desktop](panel-calendar-desktop.png) | [Narrow](panel-calendar-narrow.png) |
| Settings and responsive Timeline Info | [Desktop](panel-settings-desktop.png) | [Narrow](panel-settings-narrow.png) |
| Collapsible Help and direct dataset selection | [Desktop](panel-help-desktop.png) | [Narrow](panel-help-narrow.png) |
| Data descriptor | [Desktop](panel-data-desktop.png) | [Narrow](panel-data-narrow.png) |
| First batch visible, grouped by series while the next batch waits | [Desktop](progressive-series-desktop.png) | [Narrow](progressive-series-narrow.png) |
| Standalone UI with the data endpoint unavailable | [Desktop](standalone-offline-desktop.png) | [Narrow](standalone-offline-narrow.png) |

The panel captures use `models/demos/default-dataset.json` and
`json/test-data/default-dataset.json`, centered on 2026-09-12 12:30 UTC with the
model's 08:00–17:00 detail range. The connected fixture creates records inside the
actual requested interval. It returns 30 records, holds the continuation request,
then returns IDs 20–59 to check overlapping-batch deduplication. Three `series`
groups can be selected while that second request is pending. The unavailable
server capture uses the public hazard model and an intercepted connection refusal.
These tests fix the browser clock at 2026-09-12 12:30 UTC. Background progress sits
in the header, with space reserved above the plot and panel titles.

## Reproduce

```powershell
npm ci
npx playwright install chromium --only-shell
$env:PROGRESSIVE_CAPTURE_DIR = 'docs/ui/progressive'
npx playwright test tests/browser/progressive-ui.spec.mjs
```

If the managed browser is unavailable, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an
installed Chromium executable. The captures here use that compatibility fallback;
the managed-browser CI run remains necessary before a stable release. Run
`npm run test:browser` to include all demo baselines, drag, viewport, and API checks.
The test runner starts and stops its own static fixture server.

## Validation

- `npm test`: 121 tests passed, including local startup before fetch completion,
  local cancellation/retry, saved-filter restoration, grouping during loading,
  overlapping batch identities, stale response rejection, and reconnection.
- `mvn --batch-mode --no-transfer-progress verify`: 80 tests, 46 executed and
  34 existing environment-dependent skips; no failures.
- After extending the actual embedded HTTP test, `mvn --batch-mode
  --no-transfer-progress -Dtest=MatchProtocolTest,ProgressiveSourceScanTest test`
  passed all 14 targeted checks. They exercise temporary JSON files, real HTTP
  continuations, namespace/exclusion parity, nested and long-spanning records,
  replay, cancellation, malformed input, and partial coverage.
- Browser validation passed 53 distinct checks across the full and focused runs,
  with seven duplicate narrow drag cases skipped. All 14 demo comparisons passed
  without updating the reviewed baselines. The full run's one obsolete panel-width
  assertion was corrected; the affected drag test and all six new UI cases passed
  in the focused rerun. Final loading checks also assert that the background
  indicator stays inside the header.

The HTTP fixture contains 601 current-window records. In one measured run, the
legacy response took **293 ms / 92,771 JSON characters**; the progressive first
response took **211 ms / 39,782 characters**. Its continuation pages each examined
at most 256 top-level records and collectively returned the same 601 IDs without
duplicates. A separate 1,801-record fixture completed in eight bounded pages.
These are single-run synthetic measurements, not production latency or memory
benchmarks. They do not measure browser time to first paint. The browser test
separately proves the first records render and remain interactive before later
records are released.

All 28 desktop/narrow demo images were reviewed for the intentional panel width,
Help, toolbar, and duplicate-axis changes. Calendar screenshots additionally led
to a fix and a browser assertion for minimum day-column spacing. Static demos,
synthetic connected UI, and the actual JSON-file provider were exercised; no
private live server or alternate-provider performance claim is made.

Protocol behavior and resource bounds are documented in
[Progressive loading](../../progressive-loading.md).
