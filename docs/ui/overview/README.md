# Overview captures

These PNGs are captures of the actual Chromium/WebGL application on Windows,
using public catalog data or explicitly synthetic connected records. They are
not generated mockups. The menu bar keeps its display icons directly accessible,
with latest data, previous/next activity, Auto scale and Lock current view grouped
together. Two menu rows use horizontal scrolling when space is limited. Status
labels distinguish loading, completion, errors and incomplete coverage.
See the [wide toolbar](../toolbar-layout/wide.png) and
[scrolling toolbar](../toolbar-layout/narrow.png) for the two available-space cases.
Earlier `../v2/` and `../progressive/` images record earlier checkpoints.

| Dataset | Desktop, 1440 x 900 | Narrow, 800 x 700 |
| --- | --- | --- |
| Operations sample | [View](default-dataset-desktop.png) | [View](default-dataset-narrow.png) |
| Dinosaur lifespans (Ma) | [View](dinausaurs-desktop.png) | [View](dinausaurs-narrow.png) |
| Satellite ephemeris | [View](ephemeris-desktop.png) | [View](ephemeris-narrow.png) |
| JFK chronology | [View](jfk-desktop.png) | [View](jfk-narrow.png) |
| Claude Monet | [View](monet-desktop.png) | [View](monet-narrow.png) |
| Religious history (BCE/CE) | [View](religions-desktop.png) | [View](religions-narrow.png) |
| Space exploration | [View](space_exploration-desktop.png) | [View](space_exploration-narrow.png) |
| Synthetic dense records | [View](dense-desktop.png) | [View](dense-narrow.png) |
| Synthetic connected loading | [View](connected-desktop.png) | [View](connected-narrow.png) |

All catalog captures use the initial date, main ranges and authored Overview
spans in [the models](../../../models/demos/). Overview centers its context on
the main interval; authored endpoints determine the span. Source records and titles
come from [the catalog](../../../demos/catalog.json). Operations uses 12 September
2026, 08:00–17:00 main focus and a day Overview; historical/numeric axes retain
their model units. The browser clock is fixed to 15 January 2026 at noon UTC in
the catalog checks, with reduced motion and device scale 1. The synthetic
connected check fixes 12 September 2026 at 12:30 UTC and holds a continuation
response while showing current/past/future sessions. Dense captures use 600 overlapping
copies of a public record and expose counts on aggregated marks.

Reproduction:

```powershell
$env:DEMO_CAPTURE_DIR='test-results/current-captures'
npx playwright test demos.spec.mjs --update-snapshots
$env:OVERVIEW_CAPTURE_DIR='docs/ui/overview'
npx playwright test independent-overview.spec.mjs
```

Copy each reviewed `<DEMO_CAPTURE_DIR>/<demo>-<layout>-timeline.png` to this
directory using the catalog ID and `-desktop`/`-narrow` suffix. The capture option
always writes current pixels, even if changes fall within comparison tolerance.
For baseline updates, Playwright normalizes underscores to hyphens in filenames;
review the matching `split-help` capture as well. The catalog's
`reference` fields point here; `npm run demos:readme` regenerates the compact
README links and the resource table in the demo guide.

These captures and baselines use the lockfile-managed Chromium 153 headless shell with SwiftShader. Screenshots are visual evidence; the interaction tests
separately check main pointer anchoring, centered context, manual Overview zoom,
Auto scale, resizing and normal panel scrolling. GPU/browser differences can
affect pixel comparisons. No private records or deployment pages are pictured.
