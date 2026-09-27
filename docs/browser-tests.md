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

The regular `npm run test:demos` suite also exercises all seven demos' responsive
layout, and covers detailed scale/projection and panel behavior in the DOM harness.

The 2026-09-27 release checkpoint uses the locked Chromium 153 headless shell.
The suite has 79 enabled checks and seven duplicate narrow drag cases that are
intentionally skipped. The full run found a short-frame-delay flick regression;
the corrected behavior passed focused navigation checks. A separate initial-layout
race in the drag probe was fixed by waiting for the pending layout and toolbar
measurement before attaching listeners. The affected drag and flick cases then
passed three repetitions each, without arbitrary startup sleeps. All 14 catalog
screenshot comparisons passed without updating the reviewed baselines.

The release also passed 146 JavaScript tests and Maven verification with 54
executed tests and 34 existing environment-dependent skips. See the
[release validation record](release-2.1.md), [current captures](ui/overview/README.md)
and [descriptor scenarios](ui/navigation-details/README.md).

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
