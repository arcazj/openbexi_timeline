# OpenBEXI Timeline 2.5.2

Version 2.5.2 is a small interface and status correction for the 2.5 series.

- A **Current time** label follows the red time line when there is space on its
  date axis. It hides at date-label collisions and viewport edges, and follows
  panning, zooming and resizing. The red line uses the same time projection as
  events, including adaptive scales.
- **Status: Ready** turns green after processing when the visible time span is
  fully covered. **Data limit reached** stays amber when a limit leaves that
  span incomplete. Limits in neighboring ranges remain in the status report.
- A separator divides Calendar from the active filter labels and Filters.
- Default distinguishes toolbar groups with soft metallic blue-grey shades.
  High contrast uses dark steel-blue bars and stronger blue-grey surfaces with
  readable text, borders and keyboard focus. Custom color preferences still work.

Replace browser assets together. The event/session format, API version 1.0.0
and connected-data budgets are unchanged. A reset palette saved by an earlier
version adopts the new defaults; individually customized palettes are retained.

## Validation

- JavaScript: all 340 existing checks and the new legacy current-time regression
  passed. Visible coverage, loading limits and saved appearance preferences are covered.
- Chromium: focused desktop and narrow-layout checks passed for the current-time
  label, toolbar, themes, loading and status. All 28 updated catalog screenshots
  passed a second comparison without snapshot updates; seven documentation
  screenshots were also reviewed.
- Performance: both synthetic 1,000- and 10,000-record scenarios passed.
- Java: Maven verification succeeded with 154 tests, zero failures or errors and
  34 skips. All six browser/API integration checks passed, preserving 27 record
  payloads and exercising a local mock AI provider.
- All 16 deployment-prefix demo checks passed. Model/schema validation, generated
  documentation and API checks passed. The npm audit reported no vulnerabilities.

Previous release: [2.5.1](release-2.5.1.md).
