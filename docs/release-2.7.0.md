# OpenBEXI Timeline 2.7.0

Version 2.7.0 reduces progressive loading requests, makes timeline logging easier
to control, and shows the installed UI version in Settings.

- Empty archive work is combined into bounded response batches. A compact file
  time index skips unchanged files outside the requested interval, even after
  their records leave the larger cache. File changes invalidate index entries;
  coverage warnings and scan limits remain visible.
- File traversal uses fewer filesystem metadata reads, reducing the cost of
  scanning large archives on Windows. Cursor diagnostics explain when a copied
  URL contains a redacted or invalid cursor.
- Server output defaults to concise readable response summaries. Successful
  requests use INFO, coverage warnings and HTTP 4xx responses use WARNING, and
  provider failures and HTTP 5xx responses use SEVERE. GET URLs and detailed
  counters require explicit FINE debugging. Source warning details appear at the
  end of a scan instead of repeating on every continuation page.
- **Settings > Trace level** offers INFO, WARNING and ERROR. The choice persists
  in this browser and controls its timeline console messages and server request
  summaries. New cursor pages, searches, descriptor reads and cancellations use
  the selected level without restarting scans or clearing cached records. Live
  subscriptions reconnect once when the level changes.
- Settings displays **OpenBEXI Timeline · Version 2.7.0** above its sections,
  using the same release metadata as Help.
- Timeline titles are larger and bold. The **Go to latest data** button has been
  removed; previous/next activity navigation remains available.

Rebuild and restart the Java service, update browser assets together, and reload
the page. INFO remains the default trace level. ERROR appears as SEVERE in Java
logs. This preference applies to the current browser's timeline requests;
server startup logs and other clients keep their own logging configuration.

Regression checks cover cursor continuity, cached navigation, live reconnection,
file-index invalidation, coverage warnings, log severity, preference persistence
and the displayed version. See [progressive loading](progressive-loading.md),
[connected diagnostics](connected-diagnostics.md) and the
[user guide](help-guide.md#settings).

Previous release: [2.6.1](release-2.6.1.md).
