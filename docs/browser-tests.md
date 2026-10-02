# Browser regression tests

The Playwright suite runs all seven catalog demos in Chromium at 1440 × 900 and
800 × 700, and then resizes each live page to 390 × 844. The real WebGL renderer,
DOM, layout engine, and input handlers run in these tests. SwiftShader supplies
repeatable software WebGL on machines without a physical GPU; this does not
replace the renderer with a mock.

## Run locally

Use Node.js 24. Install the locked dependencies and matching headless Chromium:

```sh
npm ci
npx playwright install chromium --only-shell
npm run test:browser
```

The test runner starts its own local server on port 8782 and stops it when done.
It does not connect to a deployed server or modify a database. Failure screenshots,
expected/actual/diff images, traces, and the HTML report are saved under
`test-results/` and `playwright-report/` (both ignored by Git).

## Touch, keyboard and other browsers

```sh
npx playwright install firefox webkit
npm run test:browser:compat
```

The compatibility configuration runs `usability.spec.mjs` on a 390 × 844 touch
device in Chromium and in desktop Firefox and WebKit. It exercises search,
view switching, event details, keyboard activation, and opening/closing More.
These are functional checks; the reviewed pixel baselines remain Chromium-only.
Set `TIMELINE_TEST_PORT` to use a different local port when running suites
independently. Playwright projects and device emulation follow the
[official configuration guide](https://playwright.dev/docs/test-projects).

## Performance measurements

```sh
npm run test:browser:performance
```

This separate run uses 1,000 and 10,000 synthetic records and attaches
`performance.json` for each case: time to the usable view, search and grouping
through the next paint, drag frame intervals, long tasks, observed interaction
durations, worker starts and renderer resource counts. Compare repeated runs on
the same hardware without other tests running. These lab samples are not field
INP, and software WebGL timings are not hardware-independent performance budgets.
For real user monitoring, assess the 75th percentile separately for mobile and
desktop; [good INP is at most 200 ms](https://web.dev/articles/inp).

The regular `local-data-performance.spec.mjs` additionally verifies real module
worker startup on 20,000 synthetic records, UI responsiveness during parsing,
cancellation, retained old records and Retry. Large JSON decoding and normalization
run in the worker; final snapshot construction and rendering still run on the
main thread. XML and browsers that cannot start module workers use the original
parser. The original drag checks continue to enforce scene and Overview reuse.

Final 2.5.0 validation on October 2, 2026 repeated each fixture three times on
Windows with Chromium and software WebGL, without other test suites running.
The medians were:

| Synthetic records | Usable view | Search through paint | Grouping through paint | Drag frame interval, p95 |
| --- | --- | --- | --- | --- |
| 1,000 | 3.71 s | 0.85 s | 0.80 s | 33.3 ms |
| 10,000 | 3.55 s | 1.88 s | 3.36 s | 83.4 ms |

Usable-view times ranged from 2.87–3.77 seconds for 1,000 records and 3.50–4.41
seconds for 10,000. The 1,000-record fixture ran first in each repeat, so renderer
startup and caching affect comparisons between sizes. Every 10,000-record case
started one parsing worker, but its longest main-thread task still took
2.25–3.24 seconds. These measurements establish a local reference, not a
before/after speedup. Layout and rendering remain the next performance target
for large datasets. Connected-data loading limits retain their previous values.

```sh
npx playwright show-report
```

## What is checked

- `event-targets.spec.mjs` hovers and clicks actual canvas shapes and text in 2D
  and 3D, checks full captions and retained record identity, and drags from text.
- `filter-reliability.spec.mjs` re-selects saved exclusions after changing chips,
  builder expressions and grouping, and checks the new-filter editor at phone
  width. `appearance-colors.spec.mjs` checks Model and YAML button contrast,
  saved custom colors, menu grouping, background restoration and reset.
- Node loader tests confirm the existing record, character, nested-record and
  page limits stop loading safely while retaining accepted data.

- The embedded edition covers real same-origin and cross-origin frames, exact
  event/session metadata callbacks, data updates, invalid input, appearance and
  resize isolation, forged-message rejection, cleanup and the satellite example.
- Every catalog entry loads its expected number of records without uncaught errors
  and renders actual WebGL geometry.
- The Model and YAML editor covers all public examples, five editing areas,
  keyboard and phone layouts, YAML preservation, scoped access and filters,
  conditional model saves, version history, and AI preview/accept/undo/cancel.
  Connected application launches hide document management while retaining compact
  Save/Export and history actions, visible errors and scoped Apply. Checks cover
  reload, the inline heading, all three viewport sizes, read-only denial and save
  conflicts; demo and standalone launches retain the full document manager.
  Browser API fixtures test failures and stale writes deterministically.
  After `mvn verify`, `npm run test:integration` also exercises a real local Java
  server and mock AI provider with isolated synthetic data and credentials.
- Search, previous/next activity, view locking and Resync exercise local and
  connected records. Selected activities glow without changing their size;
  compact 3D labels remain readable through rotation and resizing.
- Exactly two menu bars hold all controls. Latest data and activity navigation,
  followed by a separator, Auto scale and Lock current view, follow search on
  wide screens and move to the secondary bar when needed. At phone widths,
  secondary controls move into More while search, previous/next activity and
  status remain visible. Checks include retained keyboard focus, keyboard zoom,
  menu dismissal and no page-level horizontal overflow.
  The filter builder and removable labels preserve other criteria.
  Text, Pattern and Legacy share browser/server fixtures; checks cover invalid
  patterns, debounce, immediate Enter, mode changes and obsolete responses.
  Back restores the previous range. The application starts in 2D.
- Saved-view checks restore the visible range, selection, scale, filters, grouping
  and table presentation through browser-local named views and public demo links.
  Table/details checks cover sorting, column selection, CSV downloads across
  loaded pages, copy controls, clipboard failure and high contrast.
- Startup checks cover explicit HTML models, YAML configuration, a missing
  model setting, offline/time-limited discovery, and explicit model errors.
- The timeline fills the window, reserving space for an open panel on wide screens
  and keeping the toolbar accessible above overlays on narrow screens.
- Timeline and vertical Split with Help have reviewed screenshot baselines at both
  desktop and narrow sizes. Toggling Overview must return to the same screenshot,
  detecting the former black band regression.
- Overview stays below the detail view and pagination, spans its width, and projects
  the loaded overview events. Split keeps that alignment, while Table hides it.
- Real wheel gestures zoom only the hovered plot with Auto scale on/off. Checks
  preserve the timestamp under the pointer, the other range, selection and page;
  opposite gestures, resizing, later batches and panel scrolling are covered.
- Dense Overview marks aggregate with exact source counts and minimum thickness.
  Cold connected fixtures render current records before a held continuation and
  retain prefetched past records through the first backward drag.
- Descriptor, Help, and calendar panels replace one another in the reserved slot.
  Calendar checks apply to date models; the dinosaur axis uses numeric ages.
- Timeline rows and table records use keyboard-accessible pagination instead of
  plot scrolling. Resizing preserves the selected time and the open panel.
- Real mouse drags navigate every demo in both directions. Checks retain overview
  event nodes, prevent scene rebuilds while dragging, verify finite coordinates,
  wait for coasting to stop, and preserve the selected time after resizing.
  Work counts and render durations are attached to the report; hardware-dependent
  frame rates are not used as pass/fail thresholds.
- A real flick with motion enabled continues after release and stops on a click.
  Date labels remain clear of event rows when Sort by changes the live bands.
- Delayed synthetic connected responses exercise the loading indicator, usable
  background-loading controls, cancellation, failure and Retry at both sizes.
- Progressive responses render before a held continuation, merge overlapping IDs,
  and allow live grouping by series. Startup with the data endpoint unavailable
  retains the frame, toolbar, Help, and reconnect actions.
- Saved presets restore the selected radio and grouping; switching equivalent
  exclusions both ways retains records, selection and time range during a delayed
  continuation. Obsolete batches cannot restore the previous view. See the
  [preset captures](ui/saved-presets/README.md).
- Calendar, Settings, Help, and Data share their width and avoid horizontal
  overflow. Calendar day columns retain readable spacing. Every Help section
  collapses, and selecting a dataset opens it without a separate button.
- The API reference renders the checked-in OpenAPI contract on a static server.
  Separate explorer checks mock only health, dataset discovery, and event responses
  to verify query encoding, response status, and safe text rendering. The Java API
  integration tests exercise the actual server and persistence.
- The Model and YAML editor previews every demo with the actual renderer. Checks
  cover live property edits, invalid drafts, import/export, undo/redo, YAML
  preservation, delayed loads, preview cleanup, camera settings and applying
  changes to the originating timeline. Java tests cover authenticated server-file
  CRUD, validation, persistence, conflicts and references.

The regular `npm run test:demos` suite also exercises all seven demos' responsive
layout, and covers detailed scale/projection and panel behavior in the DOM harness.

Use the Chromium build installed for the locked Playwright dependency.
`npx playwright test --list` lists the current scenarios. Catalog checks compare
28 reviewed images across desktop and narrow layouts; the separate Java suite
runs with Maven. See [development and validation](development.md),
[current captures](ui/overview/README.md) and [descriptor scenarios](ui/navigation-details/README.md).

Cursor placement, table icons, color fallback, selection animation, reduced
motion and Overview selection have dedicated regression checks. Resize checks
wait for centering before asserting the selected date. Connected tests cover
bounded idle REST behavior, conditional refresh, SSE revisions and deletion
reconciliation. Public and synthetic fixtures supply the committed evidence.

## Review intentional visual changes

The committed baselines are under `tests/browser/snapshots/win32/`, grouped by
viewport. Visual CI runs on Windows Server 2025, with the locked Playwright Chromium
version, UTC, English labels, device scale 1, and a fixed clock. Operating systems
render fonts differently, so run baseline comparisons and updates on Windows.
Linux and macOS use separate snapshot paths and require their own reviewed images
if added to visual CI.

```sh
npm run test:browser:update
```

Inspect every changed baseline before committing it. Check the event/session
shapes, tick labels, main/Overview agreement, toolbar, and panel boundaries. Do not
accept new screenshots just to silence a failing test. After reviewing, rerun
`npm run test:browser` without the update flag to ensure the images are stable.
When updating Playwright, reinstall its browser and review any rendering differences.

Set `DEMO_CAPTURE_DIR` when running `demos.spec.mjs` to write the actual Timeline
and Split/Help pixels for every demo, including differences within comparison
tolerance. Set `OVERVIEW_CAPTURE_DIR` for the synthetic dense/connected captures
in `independent-overview.spec.mjs`. Inspect these fresh images before copying
them into documentation or reviewed baselines.

## Continuous integration

`.github/workflows/verify.yml` runs on pull requests, pushes to `master`, and weekly:

1. Node.js 24: install from the lockfile, audit dependencies, rebuild/check validators,
   validate the demo catalog and models, check the generated README, and run tests.
2. Windows Chromium: run all browser checks and publish report/trace artifacts.
   A separate compatibility job runs phone touch checks and Firefox/WebKit workflows.
3. Java 17: run `mvn --batch-mode verify`, including the API tests, and audit the
   resolved runtime dependency graph against OSV advisories.

Actions are pinned to commit hashes, workflow permissions are read-only, and
Dependabot proposes weekly npm, Maven, and GitHub Actions updates.

See [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots) and
[CI configuration](https://playwright.dev/docs/ci) for the underlying tooling.

### 2.2.2 regressions

`progressive-ui.spec.mjs`, `calendar-loading.spec.mjs`, and `viewport-v2.spec.mjs`
cover orange toolbar warnings, absence of automatic search popups, keyboard
access to failure details, retry/drag recovery, responsive filter syntax help,
quoted expressions, inline validation and retained Sort by at both viewport sizes.
Java HTTP tests separately cover SSE route POST requests, saved and explicit
server filters, source exclusions, conditional reads, live edits and deletions.
Java and JavaScript read the same filter-expression fixtures with explicit
expected record IDs.

### 2.2.3 regressions

Duplicate narrow drag cases are intentionally skipped; the drag-performance
suite exercises those gestures at desktop width.

`perspective-status.spec.mjs` covers matching band colors after filtering and
preset reload, status explanations reached with the keyboard, central status
placement, and the separate loading indicator. It also exercises actual
OrbitControls rotation, pan and zoom, numeric camera and appearance changes,
Save, reload, Restore and Reset at both viewport sizes. Camera gestures must
preserve the time range, record count and selection.

`perspective-demos.spec.mjs` checks Monet and Dinosaurs at both widths: the
reference preset, 2D startup after saving 3D settings, restoration of the saved
pose, reset and resize framing, unchanged dates and counts, and visible selection
in Overview. A pixel comparison also verifies the original 2D view after toggling
back from 3D. WebGL pixel checks verify that metalness changes the rendered surface
without black areas. The activity-focus suite checks that textured icons stay
readable at maximum metalness and that session colors are preserved.

The Node suite additionally covers camera persistence across scene rebuilds,
control disposal, invalid stored preferences, blocked browser storage, and the
Sort by value sent when creating a server filter. Existing loading, navigation,
selection, rendering and viewport checks remain part of regression coverage.

### Historical search regressions

`historical-search.spec.mjs` exercises connected text searches at desktop and
narrow widths using synthetic archives. Coverage includes a `locked` match on
May 21 beyond the initially loaded data, progress while the plot stays still,
the adjacent **Stop search** button, cancellation and late-response rejection,
query changes, locking the view, filters and **Sort by**, exhausted history,
unavailable files and HTTP failures. `auto-exploration.spec.mjs` also covers
older servers without the history protocol. An empty limited or failed scan
must be reported as incomplete. The fixture also checks that REST stays idle
without a query. These checks use public synthetic records rather than private
operational files.

### Menu bars and Settings

`toolbar-ux.spec.mjs` checks exactly two menu rows, navigation immediately after
search when it fits, fallback to the secondary row, and the compact More menu at
phone widths. The secondary filter group follows
Calendar, Filter: \<filter name\>, Filters, a separator and Timeline details.
Checks include the separator between 3D and Settings, removal of the old time-window
button, and opening and closing the Status report with the same control.
It captures both menu layouts and all five themes.
Search-mode controls are checked inside Filters. A controlled clock verifies
debouncing independently of machine load; Text, Pattern, invalid-pattern recovery,
Back, filter labels, local Refresh and Go to latest data are exercised through the UI.

Settings checks cover the four ordered sections, the initially collapsed Timeline
info and Update perspective sections, native keyboard radio navigation, immediate
theme changes, persistence after reload, invalid preferences and blocked storage.
High contrast checks cover visible icons, buttons and separators in both bars,
including hover, focus, selected and disabled states.
`status-states.spec.mjs` checks dynamic labels and orange, green, red and gray
states in every theme, including open reports and narrow layouts. Held data
requests verify loading, failure, cancellation, recovery and successful completion;
unit and historical-search tests ensure partial or unfinished work cannot show green.
Theme changes must preserve records and the selected time range.
