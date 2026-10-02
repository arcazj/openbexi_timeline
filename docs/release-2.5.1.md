# OpenBEXI Timeline 2.5.1

Version 2.5.1 delivers the [2.5 interface improvements](release-2.5.0.md) with a
compatibility correction found during CI verification of the initial tag.

The table now treats an invalid legacy event collection as empty when resolving
inherited source labels. Nested activity sources still work in display, sorting
and CSV export. Existing view controls can initialize without valid records.

Functional browser CI now runs on Ubuntu with the required browser dependencies.
The hosted Windows runner denied Firefox WebGL 2 contexts before the app could
start; Windows Chromium screenshot checks remain unchanged. Startup failures
in compatibility checks now include their full error message.

The original connected-data limits remain unchanged: 15,000 top-level records,
50,000 records including activities, 8 Mi JSON payload characters, 32 pages per
visible interval and four pages per neighboring interval. Event/session JSON
and API version 1.0.0 are unchanged.

Replace browser assets together. The existing `v2.5.0` tag is retained; this is
the corrected release for the 2.5 series.

## Validation

- The complete JavaScript suite passed 339 tests, including the existing view
  regression and malformed event/activity collections at multiple depths.
- The updated compatibility harness passed all six local phone Chromium,
  Firefox and WebKit cases. Workflow YAML validation also passed.
- The 2.5 validation covered 313 Chromium cases, six cross-browser/phone cases,
  16 deployment-prefix checks and three repeats of both performance fixtures.
  The corrected guard preserves the valid-record rendering path.
- Java CI passed 154 tests with 34 existing skips, the six-check browser/API
  integration, and its audit of 24 public runtime dependencies with no known
  advisories. npm audit also reported no vulnerabilities.

Previous release: [2.4.0](release-2.4.0.md).
