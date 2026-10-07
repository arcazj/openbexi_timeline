# OpenBEXI Timeline 2.6.1

Version 2.6.1 makes partial-data reports actionable and updates the licensing
contact to [openbexi@gmail.com](mailto:openbexi@gmail.com).

- Click **Status: Partial data** to see the configured source namespace and YAML
  entry number, the affected file or directory relative to its source root, the
  reason for the warning and a suggested fix.
- Source diagnostics distinguish unavailable sources, missing top-level `events`
  arrays, malformed or truncated JSON, unreadable files, oversized records and
  invalid records. Scan-limit details identify the limit reached and the examined
  file, record and decoded-character counts.
- Repeated diagnostics from visible and neighboring intervals appear once. The
  report wraps long filenames and scrolls at narrow widths. Each server scan
  retains up to 100 distinct details and reports when additional details are
  omitted. Absolute source roots and record contents remain on the server.
- Files without an `events` array are no longer cached as successful empty files,
  so their warnings remain visible on Refresh until the files are corrected.
  Sources sharing a namespace retain their own configuration entry numbers.
- Licensing contact information is consistent across the license, commercial
  licensing guide, order form, source header, design instructions and API docs.

Rebuild and restart the Java service, replace browser assets together, and reload
the page to use the new diagnostics. Older servers still show summary warnings.
Use **Refresh** after correcting source files. Green **Ready** continues to
require complete coverage without warnings in the visible time span.

The event/session payload format, API version 1.0.0, existing filters and saved
views are unchanged. See [connected diagnostics](connected-diagnostics.md).

## Validation

- All 350 JavaScript tests passed, including the source-diagnostics report,
  progressive loading, matching, rendering and descriptor checks.
- Maven verification passed: 159 tests, no failures or errors, 34 existing skips.
- All six browser/API integration checks passed with 27 unchanged timeline items.
- All 20 Chromium desktop and narrow status/perspective checks passed, including
  keyboard access, five themes, source details and recovery after Refresh.
- All 16 deployed-path demo checks passed at desktop and narrow widths, including
  the embedded satellite timeline.
- Model/schema validation and generated README/API checks passed. The npm audit
  found zero vulnerabilities; OSV checked 24 Maven runtime dependencies with no
  known advisories.
- The public-file audit confirmed aligned version markers and no old contact
  email addresses. Existing repository, demo and container hosting URLs remain
  unchanged.

Previous release: [2.6.0](release-2.6.0.md).
