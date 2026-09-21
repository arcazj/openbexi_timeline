# Data-driven demos

Use Node.js 24 or later for the demo tools and tests.

```sh
npm install
npm run demo
```

Open a dataset from the [README demo links](../README.md#live-demos), or open <http://localhost:8780/demos.html> for the default demo. Every demo begins with the original timeline toolbar; there is no page heading, description, or dataset selector above it. Use the same Timeline, Table, Split, search, overview, calendar, and camera controls as the main timeline. Split places the timeline on the left and the table on the right. The return-to-reference control restores the model's initial date. File-backed demos are read-only; server login, saved server filters, and event creation are not shown. Numeric axes have no calendar control.

The file server binds to `127.0.0.1`; it does not publish the project. Change the port with `npm run demo -- --port 8788`. A link can select a view, for example `demos.html?demo=monet&view=split`.

## Catalog and models

`demos/catalog.json` is the source for URL-based dataset selection and the generated README table. Its paths are relative to the repository root (`basePath` resolves from the catalog). Each entry provides `id`, `title`, `description`, `dataset`, `model`, `recordCount` (the expected number of records, excluding zones), and an optional `reference` PNG. The shared loader, renderer, and page contain no demo IDs or dataset-specific branches.

Each model in `models/demos` uses the existing `params` and `bands` structure, plus `dataSource`. The presence of `dataSource` enables the shared file-backed loader; existing server models continue to use their server connection.

| Model option | Meaning |
| --- | --- |
| `params.date` | Initial reference date; numeric-axis models use a value in their declared unit. |
| `params.overview` | Whether overview bands are initially shown. |
| `params.dockOverview` | Keep a trailing Overview visible below independently scrolling timeline rows. |
| `params.overviewHeightRatio` | Optional fraction of the timeline height reserved for its docked Overview, such as `0.22`. |
| `params.displayOffsetMinutes`, `params.timeZoneLabel` | Explicit display offset and label, independent of the browser's local time zone. |
| `params.showCurrentTime` | Set to `false` for historical datasets. |
| `dataSource.format` | `json` or `simile-xml`. Format is explicit rather than inferred from filenames. |
| `dataSource.recordsPath` | Array path inside JSON, such as `records`; defaults to `events`. |
| `dataSource.fields` | Optional dotted field paths, or fallback path arrays, for `id`, `title`, `description`, `namespace`, and `color`. |
| `dataSource.iconColors` | Maps legacy icon references to colors, without depending on unavailable remote icon files. |
| `dataSource.zones` | Extra highlighted intervals with `start`, `end`, `title`, and color/opacity. Dataset zones are also supported. |
| Zone `render.height`, `render.verticalAlign` | Optional strip height and `top` alignment; otherwise the zone spans the band. |
| Zone `render.labelPosition` | Set to `bottom` to place the highlight caption below event rows. |
| `dataSource.time` | Optional numeric axis: `kind: "numeric"`, `unit`, `millisecondsPerUnit`, `direction`, and optional `approximatePrefixes`. The internal coordinate conversion is not a claim that numeric values are calendar dates. |
| Band `height`, `color`, `SessionColor`, `eventColor`, `dateColor` | Band proportions and visual styling. Bands grow when additional rows are needed. |
| Band `intervalUnit`, `intervalPixels`, `dateFormat` | Time scale and tick labels. Supported units run from milliseconds through centuries. |
| Band `range`, `context` | Optional `{from, to}` dates, or values in the declared numeric unit, for the initial visible range and the wider set of records laid out in both normal view and Overview. These ranges follow navigation and resize with the viewport. |
| Band `focus` | Optional `{from, to, magnification, ticks}` or an array of those objects to expand selected intervals. Overlapping magnifications multiply, allowing an hour to be expanded within an already expanded day. Each Overview can define its own scale. |
| Band `ticks`, focus `ticks` | `{unit, step, format}` tick configuration. Calendar units such as `YEAR` and `MONTH` align to calendar boundaries; `HOUR` and `MINUTE` support finer detail. `NUMERIC` uses the declared axis unit, such as a `20` Ma step. `format` overrides the band date format for those ticks. |
| Band `tickMinutes`, focus `tickMinutes` | Compatible shorthand for minute-based tick spacing. |
| Band `labelPosition`, `topPadding` | Duration labels can use `above` or `inside`; top padding controls room above the first row. |
| Band `groupBy` | A dotted event field path, such as `data.satellite`, for generated group bands. |
| Band `filter` | `{field, equals}` selects records by a dotted event field, such as `data.namespace`, without removing them from the loaded dataset. |
| Band `eventKind` | Optional `duration` or `event` selection. |
| Overview `sourceBands` | Optional array of normal band names to project. When omitted, Overview includes all normal bands. |
| Overview `overviewLabel` | Optional compact label, such as `Magnified overview`. |
| Band `secondaryScale` | A second tick scale. With `step`, an `elapsedYears` scale anchors each tick to the `origin` anniversary; `height`, `color`, `textColor`, and `suffix` style its strip. |
| Band `scaleHeader` | Optional in-chart scale annotation with `label`, `unit`, `height`, `color`, and `textColor`. It does not change the main toolbar. |
| Band `uncertaintyOpacity` | Optional opacity for durations with retained Simile uncertainty metadata; original date bounds remain unchanged. |
| Overview `fitRows` | Fits the completed normal-view rows into the miniature without including unused band height or repacking events. |
| Overview `showContextLabel`, `viewportHandles` | `showContextLabel: false` hides the default title/count; `viewportHandles: true` adds handles for panning the visible time range. |

The loader preserves descriptions as text. Legacy image and link references remain metadata; remote images are not needed to render a demo. Simile point events with uncertain end dates remain points unless `isDuration="true"`. BCE dates and years below 100 are interpreted explicitly, avoiding JavaScript's shorthand-year parsing. Numeric approximate values retain their source notation in event metadata.

## Responsive layout and Overview

The demo page reserves 75% of the available width for Timeline, Table, or Split and 25% for event details, the calendar, or other panels. The panel space remains reserved when closed, including on narrow windows. Height follows the window below the original toolbar; dense timeline rows, tables, and panel contents scroll within their own areas. The toolbar keeps its original layout and scrolls horizontally on narrow windows.

Overview projects the normal bands' completed layout into a miniature, retaining event colors, session durations, row order, groups, and highlighted intervals. Point events become compact dots and duration events remain horizontal bars. Each source band has a visible-time-range highlight that follows panning and the Timeline/Split viewport. Search, grouping, refresh, and Overview toggles use the same loaded data and layout; models do not need dataset-specific JavaScript.

## Reference images and source formats

The models use the provided PNGs for band colors, event/duration styles, highlighted windows, and focus scales. JFK opens at 12:00-14:00 UTC-06:00 with five-minute ticks and the shot/time-of-death interval. Its Overview compresses the preceding months, expands the selected day, and further expands 12:00-13:00 through nested focus settings. Religions separates the Jewish and Christian chronologies using source namespace metadata; its main scale expands the first century relative to BCE history, with a wider magnified context in each Overview. Space exploration uses the existing documentation PNG.

Monet uses a uniform 1824–1916 main range with decade ticks, a gold age strip aligned to the November 14, 1840 birth date, and compact event rows with duration labels above thin bars. Its fixed Overview spans 1824–1929 with five-year ticks and a visible-range window. All 27 source records remain loaded, including events outside the initial main range. The scale header, age strip, uncertainty styling, and Overview row fitting are model options shared by the renderer.

Operations opens September 12 from 08:00 to 17:00 UTC, with extra space around 12:10–13:20 and a uniform full-day Overview. Its 48 records for that day keep their source colors and both highlight zones. All 1,008 records remain loaded and available through the table, search, and date navigation. These choices come from the model's range, context, focus, and label settings; the shared renderer has no Operations-specific branches.

Dinosaurs opens at 165–115 Ma, centered on 140 Ma, with a 4× horizontal scale and 5 Ma ticks. Its fixed Overview retains the full 240–40 Ma context, from older ages on the left to younger ages on the right, covering all 224 source records spanning 228–65 Ma. Labels sit above compact duration bars, and the Overview fits the completed event rows into its available height. All event details remain available through navigation, scrolling, search, and the table.

The supplied `jfk.json`, `monet.json`, `religions.json`, and `dinausaurs.json` contain legacy XML despite their suffix. Their catalog models declare `simile-xml`. The ephemeris file's trailing comma was removed so its contents are valid JSON. `default-dataset.json` is a snapshot with a `records` array and separate `zones`. The dinosaurs source uses millions of years ago, not calendar years; its model declares a descending numeric axis. The supplied filename `dinausaurs.json` is retained.

## Add a demo

1. Add the source file under `json/test-data` and an optional reference PNG.
2. Add or reuse a model under `models/demos`. Define all visual and schema differences in its JSON configuration.
3. Add one catalog entry and run `npm run demos:readme`.
4. Run `npm run test:demos`, then inspect the demo in a browser against its reference image.

Validation rejects missing datasets/models/references, duplicate IDs, omitted dataset files, invalid dates, and stale README links. Tests build actual Three.js scene geometry and exercise the DOM, with GPU rendering and text measurement stubbed. They do not replace visual browser checks.

## Hosting portability

The page and its assets use relative paths and can be served under a subdirectory. A static host must include the HTML, `src`, `css`, `icon`, `models/demos`, `demos`, `json/test-data`, reference images, and the browser dependencies referenced by the import map (`three`, `three-spritetext`, and `simple-jscalendar` under `node_modules`). No Java backend or data service is required. To publish public links, first deploy those assets and then generate the README URLs against the chosen public base URL; the current README deliberately uses the local server.
