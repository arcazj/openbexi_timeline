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
- The timeline keeps 75% of the width, reserves 25% for panels, and fills the height
  below the unchanged toolbar.
- Timeline and vertical Split with Help have reviewed screenshot baselines at both
  desktop and narrow sizes. Toggling Overview must return to the same screenshot,
  detecting the former black band regression.
- Overview stays directly below the visible timeline, spans its width, and projects
  the loaded overview events. Split keeps that alignment, while Table hides it.
- Descriptor, Help, and calendar panels replace one another in the reserved slot.
  Calendar checks apply to date models; the dinosaur axis uses numeric ages.
- Scroll regions retain keyboard access and scrolling without visible scrollbar
  tracks. Resizing preserves the selected time and the open panel.
- Real mouse drags navigate every demo in both directions. Checks retain overview
  event nodes, prevent scene rebuilds while dragging, verify finite coordinates,
  wait for coasting to stop, and preserve the selected time after resizing.
  Work counts and render durations are attached to the report; hardware-dependent
  frame rates are not used as pass/fail thresholds.
- The API reference renders the checked-in OpenAPI contract on a static server.
  Separate explorer checks mock only health, dataset discovery, and event responses
  to verify query encoding, response status, and safe text rendering. The Java API
  integration tests exercise the actual server and persistence.

The regular `npm run test:demos` suite also exercises all seven demos' responsive
layout, and covers detailed scale/projection and panel behavior in the DOM harness.

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
