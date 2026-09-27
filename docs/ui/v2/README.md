# Version 2.0 browser evidence

These are real Chromium screenshots of the public Operations sample. They are
not mockups and contain no private deployment data. Captured on Windows with
Chromium 149.0.7827.55, Playwright 1.63.0, and SwiftShader WebGL.
The [latest progressive-loading and panel evidence](../progressive/README.md)
adds Calendar, Settings, Help, Data, series grouping during loading, and
unavailable-server captures. The viewport captures here were also refreshed.

| View | Capture |
| --- | --- |
| Full-window timeline, 1440 × 900 | [Desktop](timeline-desktop.png) |
| Wrapped toolbar, 800 × 700 | [Narrow](timeline-narrow.png) |
| Pagination and overview, 390 × 844 | [Phone](timeline-mobile.png) |
| Split timeline/table with independent pages | [Split](split-desktop.png) |
| Custom geometry applied through Timeline Info | [Settings](settings-custom.png) |
| Grouped bands and high-contrast date strips | [Desktop](grouping-and-date-labels.png), [Narrow](grouping-and-date-labels-narrow.png) |
| Delayed synthetic connected response and Cancel | [Desktop](connected-loading.png), [Narrow](connected-loading-narrow.png) |

Reproduce from the repository root after `npm ci`:

```powershell
# Optional: use an installed Chromium when the Playwright-managed browser is absent.
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = '<path to Chromium executable>'
$env:V2_CAPTURE_DIR = 'docs/ui/v2'
npx playwright test tests/browser/viewport-v2.spec.mjs --project=desktop
```

The test uses its own local fixture server. It checks page dimensions, plot/table
overflow, all seven demos, keyboard focus, viewport resizing, and persistence of
custom geometry. Node tests separately traverse every table page and every packed
detail page, and check complete overview scope, session continuation, and anchors.
Current validation totals, loading measurements, and reproduction commands are in
the [release notes](../../release-2.0.md) and
[latest evidence](../progressive/README.md). The browser checks include reviewed
desktop/narrow baselines, page and panel geometry, custom preferences, drag and
coast cancellation, grouping, and loading/Cancel/Retry. Java integration checks
exercise the JSON-file provider using temporary synthetic sources.

The captured browser is an installed compatibility fallback, not the browser
revision bundled with this Playwright release. Run the suite with the managed
browser in CI and review any rendering differences before a final stable release.
No live private provider was used for this release evidence.

The connected screenshots use intercepted, delayed public responses. Background
loading now permits interaction while displaying a compact indicator. Overview
retains its context axis, with measured gaps between labels, while the duplicate
current-view strip has been removed.
