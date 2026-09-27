# Saved exclusion presets and namespace grouping

These are real Chromium/WebGL screenshots, captured on 2026-09-25 with an
explicitly synthetic connected provider. No private page, profile or data appears.

| Layout | Desktop, 1440 x 900 | Narrow, 800 x 700 |
| --- | --- | --- |
| Combined records, Sort by NONE | [View](ungrouped-desktop.png) | [View](ungrouped-narrow.png) |
| Saved namespace preset | [View](grouped-desktop.png) | [View](grouped-narrow.png) |

The fixture has 18 eligible records in two namespaces, with icons and duration
bars. It holds a continuation response to exercise switching during partial
loading. Grouped rows paginate when space is limited; Overview retains all
loaded records. A narrow window uses the existing panel overlay.

The browser check restores the saved exclusion preset before the first data
request, switches both ways, verifies the selected radio and Sort by, and
preserves eligible identities, selection and time range. An obsolete continuation
cannot repopulate the current view. Java tests separately exercise the actual
file loader, mixed legacy namespaces, exclusions and nested session context.

Reproduce with installed dependencies and Playwright Chromium:

```powershell
$env:PRESET_CAPTURE_DIR='docs/ui/saved-presets'
npx playwright test saved-presets.spec.mjs
```

The clock is fixed at 12 September 2026, 12:30 UTC. Device scale is 1, reduced
motion is enabled, and SwiftShader renders WebGL. This workstation used installed
Chromium 149.0.7827.55 through `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; managed-browser CI
is still required before a stable release.

Validation: 124 JavaScript tests, 10 focused browser checks (this fixture plus
independent Overview/startup coverage at both sizes), and Maven verification with
50 executed tests and 34 existing environment-dependent skips.

A separate private, read-only server comparison matched the legacy record IDs,
namespaces and render attributes in a controlled interval. Live current-page
startup and preset switching were also observed. Missing sources and malformed
archive records limit coverage. An isolated legacy-browser probe did not populate,
so no claim of startup speed parity is made. The
[implementation checkpoint](../../../prompt4auto_scale.md#implementation-checkpoint-2026-09-25)
records the measurements and limits. Private evidence remains local and ignored.
