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

```sh
npx playwright show-report
```

## What is checked

- Every catalog entry loads its expected number of records without uncaught errors
  and renders actual WebGL geometry.
- Search, previous/next activity, view locking and Resync exercise local and
  connected records. Selected activities glow without changing their size;
  compact 3D labels remain readable through rotation and resizing.
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

The 2.2.0 release checkpoint uses the locked Chromium 153 headless shell.
The suite contains 163 enabled checks and seven duplicate narrow drag cases that
are intentionally skipped. The 28 catalog screenshot comparisons retain the
reviewed 2.1 baselines because default rendering remains compatible.

The release also includes 212 JavaScript tests and 68 Java tests, with 34 existing
environment-dependent Java skips. See the [release validation record](release-2.2.md),
[current captures](ui/overview/README.md) and
[descriptor scenarios](ui/navigation-details/README.md).

The [2.2.1 patch](release-2.2.1.md) adds checks for cursor placement, table icons,
color fallback, selection animation, reduced motion and clear Overview selection.
Resize checks wait for centering before asserting that the selected date stays
fixed. Reviewed Split/Help baselines include the new table markers and the centered
selection. Connected tests cover bounded idle REST behavior, conditional refresh,
SSE revision handling and deletion reconciliation. Private deployment data and
captures remain outside the committed fixtures and release archive.

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
preset reload, status explanations reached with the keyboard, right-side status
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
