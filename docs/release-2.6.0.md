# OpenBEXI Timeline 2.6.0

Version 2.6.0 improves saved-filter editing and connected startup loading.

[View the updated filter panel](ui/filters/README.md).

- **Sorting & Filtering** uses compact rows, soft metallic surfaces, stronger
  borders and clear selection and keyboard-focus states. Add filter sits beside
  the title; sorting, search and filter-building controls take less space.
- Every saved filter shows its exact decoded expression in a copyable, read-only
  text area. **Edit** unlocks that field; **Save** validates and persists it;
  **Cancel** or Escape restores the saved expression. Narrow panels stack the
  controls and expression. Previews remain copyable during a connection failure.
- Invalid expressions and failed local or server saves retain the draft with an
  inline error. A local storage failure leaves the saved criteria unchanged.
- Connected file scans with work counters can continue through up to 512 pages
  per interval, including past and future buffers. This allows sessions beyond
  the previous four-page neighbor cutoff to appear in Overview before dragging.
  Memory budgets still apply, and providers without work counters retain the
  shorter page limits. Scan-limit and retained-data warnings are distinct.
- A configured source that is unavailable still produces partial coverage.
  **Ready** turns green only when the visible interval is completely covered
  without source warnings. See [startup diagnostics](connected-diagnostics.md).
- The development dependency `source-map-js` is updated to 1.2.2 to address the
  vulnerability reported by the release dependency audit.

Replace browser assets together and reload the page. The event/session payload
format and API version 1.0.0 are unchanged. Existing filter expressions, saved
selection, grouping and storage keys remain compatible.

## Validation

- All 349 JavaScript checks passed, covering filters, startup loading, limits,
  matching, rendering, details and the event/session compatibility fixture.
- Chromium desktop and narrow checks passed for filter previews, keyboard
  editing/cancellation, persistence, deletion, connection failures and past
  preloading. Theme contrast and long expressions are covered.
- Maven verification passed: 154 tests, no failures or errors, 34 skips. All
  six browser/API integration checks passed with 27 unchanged timeline items.
- Model/schema validation, generated README and API checks passed. The npm
  dependency audit reports zero vulnerabilities after the dependency update.
- All 16 demo checks passed under the deployment subdirectory at desktop and
  narrow widths, including the embedded timeline.

Previous release: [2.5.2](release-2.5.2.md).
