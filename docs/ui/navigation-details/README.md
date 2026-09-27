# Navigation and complete descriptors

These are real Chromium/WebGL captures of the application using synthetic
records and mocked HTTP responses. They contain no private deployment content.

- [Desktop descriptor, 1440 × 900](details-desktop.png)
- [Narrow descriptor, 800 × 700](details-narrow.png)

The fixture includes metadata, an array of history entries, formatted chronological
text, and a report link. The panel retains its summary during loading and offers
a separate retry after an empty response. All 40 history lines remain accessible
through panel scrolling. On narrow layouts the panel ends above Overview.

The browser test checks stale selections, retry, wrapping, both drag directions,
centered Overview geometry, wheel zoom, navigation arrows and resizing. The
Java HTTP test independently checks ISO and legacy date parsing, preservation of
descriptor arrays/brackets, both session routes, and JSON error responses.

Reproduce the captures:

```powershell
$env:NAVIGATION_CAPTURE_DIR='docs/ui/navigation-details'
npx playwright test navigation-details.spec.mjs
```

The browser clock is fixed at 12 September 2026, 12:30 UTC. This workstation used
Chromium 149 with SwiftShader through `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; differences
from the lockfile's managed browser can affect pixels. Screenshots establish
appearance; the separate HTTP tests establish the Java endpoint behavior.
