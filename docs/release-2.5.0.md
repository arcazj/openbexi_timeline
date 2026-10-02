# OpenBEXI Timeline 2.5.0

Version 2.5.0 improves event interaction, filtering, table tools and accessibility.

## Changes

- Hover event text, icons, circles and duration bars for full captions. Clicking
  text opens the same details as its shape in 2D and 3D; dragging still pans.
- Sortable table headings always show an arrow control. Sorting, column choices
  and CSV export cover the complete loaded, filtered result across table pages.
  Nested activities retain their inherited source unless they specify their own.
- Saved-filter selection follows changes made through the builder, grouping or
  removable labels. Re-selecting an exclusion preset reliably reapplies it.
- Add a new filter appears first, with a labeled name field and an expanded,
  wide Advanced expression editor.
- The Model and YAML editor button has stronger contrast. High contrast provides
  saved color choices for the overall background and separate menu-bar groups,
  automatic readable text and a reset action.
- Compact phone controls move secondary actions into More. Named browser-local
  saved views and public demo links restore the visible range, selection,
  filters, grouping, scale and table presentation.
- Event details start with a summary and offer original-value copy controls.
  Large local JSON parsing runs in a cancellable worker with progress. Built-in
  icon textures load when needed and are released with their timeline.
- Model editor Apply confirms receipt before restarting the originating timeline.
  Missing confirmations produce a recoverable message and cancel the pending draft.
- Windows saves tolerate brief file-handle contention with bounded retries of
  the same atomic replacement. Persistent failures still report an error.

## Compatibility and upgrade

Event, session and activity JSON formats are unchanged. The API contract remains
1.0.0. Client loading limits remain at 15,000 top-level records, 50,000 records
including activities, 8 Mi JSON payload characters, 32 visible-interval pages and
four neighboring pages. Partial data remains labeled as incomplete.
Snapshot construction and rendering remain on the main thread; see the
[measurements](browser-tests.md#performance-measurements).

Replace browser assets together so the new JavaScript and stylesheets load as a
matching set. Saved views and appearance choices stay in the current browser.
Existing model and server configurations remain compatible.

## Validation

- JavaScript: 338 tests passed across the full suite and focused reruns after
  the final fixes and restoration of the original loading limits.
- Chromium: 313 browser cases passed across the full desktop/narrow run and
  the new Apply-acknowledgement checks; seven duplicate narrow drag cases remain
  intentionally skipped. Changed screenshot baselines were reviewed.
- Compatibility: all six phone Chromium, Firefox and WebKit cases passed.
  One Firefox search case timed out during concurrent testing and passed when
  rerun in isolation.
- Performance: the 1,000- and 10,000-record fixtures passed three isolated
  repeats each. Recorded medians and remaining rendering pauses are documented
  in the [browser testing guide](browser-tests.md#performance-measurements).
- Java on Windows/JDK 21: Maven verification completed with 120 passing tests
  and 34 existing skips. Atomic-file checks cover transient and persistent
  denial, interruption and a real Windows file handle.
- Real browser-to-Java integration passed six checks, including model access,
  edits/history, filters and a local mock AI provider, with unchanged item data.
- Generated schemas, all seven demo models, README links and OpenAPI output
  passed validation. The Pages build contains seven demos and 411 public assets;
  16 deployment-prefix demo/embed checks passed. npm audit found no vulnerabilities.

Previous release: [2.4.0](release-2.4.0.md).
