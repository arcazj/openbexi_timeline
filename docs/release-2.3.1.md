# OpenBEXI Timeline 2.3.1

Version 2.3.1 reorganizes the menu bars and Settings while keeping timeline
navigation, search, filtering and saved perspectives available.

## Menu bars and search

- The second menu bar is always present. Its left side contains **Refresh**,
  a separator, **Go to latest data**, **Find previous activity**, **Find next
  activity**, a separator, **Lock current view**, and **Auto scale**, in that order.
- Loading, data-limit, history-search and other status messages appear in the
  middle. **Filter**, a separator and **Timeline details** sit on the right.
  Groups wrap on smaller screens; expanding details keeps the controls accessible.
- The Text dropdown moves into **Filter → Search options**. Text searches literal
  phrases without case sensitivity; Pattern uses a case-insensitive regular
  expression; Legacy retains older expressions. Typing is debounced and Enter
  searches immediately. Invalid patterns leave the previous results visible.
- Filter provides a field, operator, value and value-type builder, with existing
  expressions under Advanced expression. Removable labels show active filters
  and grouping. **Back to previous view** restores the date and zoom after search
  or selection, retaining the current query and filters.
  Repeating a completed search skips duplicate views when going Back.
- The +/− buttons are replaced by activity navigation. Wheel and keyboard zoom
  remain available. Refresh and Go to latest data also work with local datasets.

See the actual application captures for [wide](ui/toolbar-layout/wide.png) and
[narrow](ui/toolbar-layout/narrow.png) layouts.

## Settings and appearance

Settings contains four sections, in order:

1. **Edit models** opens the Model and YAML editor.
2. **Timeline info** starts collapsed and contains geometry and adaptive-ratio controls.
3. **Update perspective** starts collapsed and contains the existing camera,
   lighting and surface controls.
4. **Change look and feel** provides horizontal circular radio buttons for
   Default, Apple style, Windows style, Minimal and High contrast. Choices wrap
   when needed, apply immediately and persist in the browser. Default is the
   initial choice. Keyboard arrows move between themes.

Themes style menu bars, inputs, buttons and panels without changing activity
colors, data or the selected time range. If browser storage is unavailable,
the chosen theme still applies for the current page and Settings explains why
it cannot be saved. See [Settings captures](../README.md#screenshots).

## Upgrade and release contents

Update the browser assets and restart the Java server together for Text and
Pattern searches. Older servers remain usable with Legacy search; unsupported
search modes report an error rather than silently changing their meaning.
Existing models, datasets, saved filters and perspective preferences remain supported.
The application, npm package, Help and Maven versions are **2.3.1**. The API
schema version remains **1.0.0**.

`npm run release:source` packages the explicit public manifest into
`dist/openbexi-timeline-2.3.1-source.tar.gz` with a SHA-256 checksum. Private
configuration, operational data, logs and build output are excluded.

## Validation

- 266 JavaScript checks passed across the full suite and focused regression reruns.
  Regression checks cover repeated searches followed by Back and cancelling
  selection centering before its first animation frame.
- 211 Chromium browser checks passed across the full run and corrected-case
  reruns at desktop and narrow widths; 7 existing narrow drag checks were skipped.
  All 28 visual comparisons passed. The wide/narrow toolbar and five theme
  captures show the actual application with public data.
- 84 Java tests passed; 34 existing environment-dependent tests were skipped.
  Maven `verify` built the 2.3.1 JAR successfully. IntelliJ's build tool timed out
  without reporting errors, so release compilation was verified with Maven.
- All 14 static-site demo flows passed under the repository subdirectory,
  including navigation, search, 3D and the live model editor.
- Demo models, generated validators, the README catalog and API specification
  passed their consistency checks. The npm audit reported zero vulnerabilities.

Previous release: [2.3.0](release-2.3.0.md).
