# OpenBEXI Timeline 2.0

**Current build: 2.0.0.** This release includes responsive views,
buffered navigation, complete descriptors and connected diagnostics.
Version 2.0 was distributed under the
[historical GPL license](licenses/GPL-3.0-legacy.txt). Commercial licensing was
still a proposal at that release; see the [current licensing guide](commercial-licensing.md)
for the later transition.

## Changes

- Separate source occurrences retain their identity when external record IDs are
  empty or reused. Overlapping batches still deduplicate the same occurrence;
  original IDs remain available for descriptor requests.
- Calendar navigation renders the selected interval in the main view and retains
  it through zooming. Browsing months does not move the timeline, and background
  redraws preserve the calendar. Loading errors have a red, keyboard-accessible
  details control; later navigation can recover without a page reload.
- The Data panel has a draggable, keyboard-accessible divider with a remembered
  width. Perspective uses a fitted camera and a light background. Multi-band
  views share a top date axis unless a model opts into `dateAxisMode: "per-band"`.
- README starts with an Overview, uses equally sized desktop screenshots, and
  separates local setup, server/API usage and validation. Version and licensing
  information are grouped at the bottom. Demo links remain catalog-generated.
- Local IDE metadata, generated samples and Tomcat runtime files are no longer
  tracked. The source archive includes the portable launch scripts and excludes
  local certificates, private captures and obsolete release-candidate artifacts.
- Mixed file sources preserve each record's namespace and nested-session
  exclusion semantics. Saved presets restore their name, expression and grouping
  together, and equivalent presets retain partial records when regrouping.
  See [current preset captures](ui/saved-presets/README.md).
- Wheel zoom targets only the hovered plot. Main zoom remains pointer-anchored;
  Overview zoom changes its own context span around the centered main-view
  indicator. Context follows navigation and accounts for docked panels. Larger
  marks, count-preserving aggregation, navigation arrows and Fit context remain
  available; a manual Overview span survives loading and main navigation.
- Connected startup uses real timestamps before the first response and enables
  configured Overview bands by default. Both neighboring buffers begin after the
  first useful visible batch, before archive scanning completes. Empty and partial results offer observed source intervals
  when available.
- Server startup prints the configured page URL after its listener is ready.
  Readable request/response lines accompany correlated HTTP/SSE/API summaries,
  with separate batch counts, coverage and timing. Local query detail is opt-in;
  credentials and cursor tokens remain redacted. See
  [diagnostics](connected-diagnostics.md) and [current captures](ui/overview/README.md).
- Navigation reuses aligned windows covering the visible interval plus one
  visible duration on each side. Cached records appear during dragging;
  superseded scans are cancelled. Density limits pause background buffers with
  an explicit partial-coverage warning instead of discarding useful records.
- Descriptor requests run independently, preserve nested metadata and full
  formatted history, and reject stale selections. Separate loading/retry states
  keep the selected summary visible. ISO and legacy dates work on both session
  routes; invalid dates and malformed files return explicit JSON errors. See
  [real synthetic descriptor captures](ui/navigation-details/README.md).

- Timeline, Table, and Split use the available browser content area. Time
  navigation continues through dragging, zooming, and Overview.
- Packed event/session rows and table records have independent accessible page
  controls. Window resizing recalculates capacity and retains an eligible record
  anchor. Search counts and Overview use the complete loaded analysis scope.
- Multiple model overviews remain visible in bounded footer panels. Version 2
  uses this layout for enabled overviews in both full-window and custom sizing.
- Settings > Timeline Info offers **Use full browser window**. The model option
  `params[0].fullWindow` defaults to `true`. Turning it off restores manual Top,
  Left, Width, and Height. Requested custom dimensions survive smaller windows;
  the effective frame is constrained to available space.
- Geometry preferences are stored locally per page and timeline name. Applying
  them does not write to a connected configuration or model file.
- Toolbar separators group Filter and Overview. Zoom buttons sit next to Search;
  the title background fits its text. Highlight matches remains a checkbox.
- Date ticks have a separate high-contrast strip and reserved row spacing.
- Flicks continue farther with smooth deceleration. Clicking stops the movement;
  reduced motion disables continuation. Canvas resolution follows display density,
  capped at 2, avoiding unnecessary supersampling during navigation.
- Connected JSON-file requests return bounded, resumable batches for the visible
  interval before prefetching neighboring intervals. Background loading keeps the
  view usable, identifies partial coverage, and supports Cancel and Retry.
- The frame initializes before data arrives, including when the server is
  unavailable. Configured local JSON datasets load independently of the server.
- Sort by rebuilds groups by namespace, type, or available data fields, including
  nested records. Compact group headings keep the plot visible. Search, selection,
  time range, Overview and page navigation stay synchronized.
- Saved namespace/exclusion filters retain their legacy expressions and grouping.
  Local saved filters persist in browser storage; arbitrary grouping fields such
  as `series` survive normalization and later batches.
- Calendar, Settings, Help, and Data share a responsive width and common styles.
  Help sections collapse independently; its dataset selector opens immediately.
- The duplicate current-view date strip above Overview is removed. Toolbar
  controls remain visible across modes, with unavailable actions explained.

## Prepare the release

Use Node.js 24 and JDK 17 or later, with Maven available on the command path.

```sh
npm ci
npm run demos:validate
npm run demos:readme -- --check
npm test
npx playwright install chromium --only-shell
npm run test:browser
mvn --batch-mode --no-transfer-progress verify
npm run release:source
```

For interactive use, follow [Quick start](../README.md#quick-start).

The source packaging command reads an explicit public-file manifest, rejects
symlinks/path escapes and local document images outside that manifest, and
generates a source archive plus SHA-256 manifest in
`dist/`. It includes current working files, including reviewed uncommitted
changes; it does not read history or copy local deployment directories. It does
not publish, upload, or create a tag. Install dependencies after extracting the
archive; runtime binaries and local certificates are not included.

Current real browser evidence and reproduction commands are in [Overview and startup captures](ui/overview/README.md).
The [original version 2 captures](ui/v2/README.md) and
[progressive loading and panel captures](ui/progressive/README.md) record earlier
checkpoints. See [loading behavior and bounds](progressive-loading.md)
for the protocol, compatibility, and resource limits.
See [privacy](privacy.md) before publishing an existing repository or its history.

The 2026-09-27 release checkpoint passed all 146 JavaScript tests. Maven `verify`
passed 54 executed tests with 34 existing environment-dependent skips. The npm
audit and the audit of 24 Maven runtime dependencies found no known advisories.
Browser coverage has 79 enabled checks and seven duplicate narrow drag cases
intentionally skipped. The full pinned-browser run identified a short-frame-delay
flick regression; a deterministic regression test and the final navigation rerun
cover its correction. Drag probes now wait for the initial layout to settle before
attaching listeners; the affected drag and flick cases passed three repetitions
each. All 14 catalog screenshot comparisons passed without
updating baselines. Demo and descriptor captures use public or synthetic records.

Browser coverage includes dragging in both directions, coasting and click-to-stop,
centered Overview geometry, independent zoom spans, panel resizing, saved presets,
partial loading, stale selections and detail retry. Java HTTP tests reproduce the
ISO-date and descriptor failures and verify valid JSON/status responses. The
[loading comparison](progressive-loading.md) separates measured scheduling gains
from provider and coverage limits.

Release browser checks use the locked Chromium 153 headless shell with SwiftShader.
Earlier screenshots were captured with Chromium 149 and also pass the locked
browser comparisons. Full production archive coverage and exact legacy speed
parity are not claimed. See the [current checkpoint](../prompt4auto_scale.md).
The source archive contains 427 explicit public files and is checked against its
generated SHA-256 manifest after extraction. Local deployment files, logs and
private screenshots are excluded.

## Scope and remaining release decisions

This release implements the progressive-loading, standalone, filtering, panel,
toolbar, centered Overview, navigation, descriptor and server-diagnostics follow-ups to
[the implementation prompt](../prompt4auto_scale.md). Planned connected resource
browsing and transactional YAML/model editing (phases 5–6) remain separate work.
There is no payment service, paid support commitment, or license enforcement.
At the time of version 2.0, ownership, contact and commercial terms remained
unresolved. Version 2.0 was distributed under GPL; later commercial terms do
not replace the rights granted with those copies.
