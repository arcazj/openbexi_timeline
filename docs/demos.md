# Data-driven demos

Use Node.js 24 or later for the demo tools and tests.

```sh
npm ci
npm run demo
```

Open a dataset from the [live demo catalog](#live-demos), or open <http://localhost:8780/demos.html> for the default demo. Each demo uses the main and secondary menu bars described in the [user guide](help-guide.md#user-manual), with horizontal scrolling on narrow screens. Timeline, Table, Split, search, Overview, calendar and camera controls work across the catalog. Split places the timeline on the left and the table on the right. Resync centers the current date and time; Help's Reset reference view restores the model's initial date. File-backed demos are read-only; server login, saved server filters, and event creation are not shown. Numeric axes disable the calendar control.

The file server binds to `127.0.0.1`; it does not publish the project. Change the port with `npm run demo -- --port 8788`. A link can select a view, for example `demos.html?demo=monet&view=split`.

<!-- DEMO_RESOURCES:START -->
## Live demos

Each demo uses Timeline, Table and Split views with its own data, model and time scale. Open a link below to try it in your browser.

| Demo | What it shows | Resources |
| --- | --- | --- |
| [Operations sample](https://arcazj.github.io/openbexi_timeline/demos.html?demo=default-dataset) | Sessions, milestones, source colors, and maintenance and verification windows. | [Data](../json/test-data/default-dataset.json) · [Model](../models/demos/default-dataset.json) · [Screenshot](../docs/ui/overview/default-dataset-desktop.png) |
| [Dinosaurs](https://arcazj.github.io/openbexi_timeline/demos.html?demo=dinausaurs) | Dinosaur lifespans on a numeric axis measured in millions of years ago. | [Data](../json/test-data/dinausaurs.json) · [Model](../models/demos/dinausaurs.json) · [Screenshot](../docs/ui/overview/dinausaurs-desktop.png) |
| [Satellite ephemeris](https://arcazj.github.io/openbexi_timeline/demos.html?demo=ephemeris) | Orbital visibility sessions grouped by satellite. | [Data](../json/test-data/ephemeris.json) · [Model](../models/demos/ephemeris.json) · [Screenshot](../docs/ui/overview/ephemeris-desktop.png) |
| [JFK chronology](https://arcazj.github.io/openbexi_timeline/demos.html?demo=jfk) | A minute-scale historical chronology with highlighted reference windows. | [Data](../json/test-data/jfk.json) · [Model](../models/demos/jfk.json) · [Screenshot](../docs/ui/overview/jfk-desktop.png) |
| [Claude Monet](https://arcazj.github.io/openbexi_timeline/demos.html?demo=monet) | Life events, painting periods, original colors, and a secondary age scale. | [Data](../json/test-data/monet.json) · [Model](../models/demos/monet.json) · [Screenshot](../docs/ui/overview/monet-desktop.png) |
| [Religious history](https://arcazj.github.io/openbexi_timeline/demos.html?demo=religions) | BCE/CE dates, duration and event bands, and overview context. | [Data](../json/test-data/religions.json) · [Model](../models/demos/religions.json) · [Screenshot](../docs/ui/overview/religions-desktop.png) |
| [Space exploration](https://arcazj.github.io/openbexi_timeline/demos.html?demo=space_exploration) | A month-scale view with a yearly overview of the supplied space-history events. | [Data](../json/test-data/space_exploration.json) · [Model](../models/demos/space_exploration.json) · [Screenshot](../docs/ui/overview/space_exploration-desktop.png) |

Append `&view=table` or `&view=split` to a demo URL to open that view directly.
<!-- DEMO_RESOURCES:END -->

## Catalog and models

### Choosing a model at startup

Timeline startup uses **explicit HTML model → server YAML model → built-in default**.
Existing pages can keep their model selection:

```javascript
const ob_timeline = new OB_TIMELINE();
ob_timeline.loadModel("models/regular_timeline_earthquake.json");
```

An explicit call skips server configuration discovery. Models with a local JSON data
source continue to work on a static host without the Java backend.

To use the server configuration, keep `new OB_TIMELINE()` and omit the `loadModel(...)`
call. The browser requests `openbexi_timeline/config` under the application's root.
The server reads the top-level `model` field from the YAML selected by `-data_conf`:

```yaml
model: models/regular_timeline_earthquake.json
data_sources:
  # Existing source definitions remain here.
```

Relative YAML model paths resolve from the application root, including deployments
under a context path. The endpoint returns only the model path and data-service URL;
the YAML file remains private. Restart the server after changing this setting.

If YAML omits `model` or leaves it empty, the browser creates a default model with a
main timeline, time axis and Overview, using the server's data service. If configuration
is unavailable, startup falls back after at most 1.5 seconds to an empty standalone
timeline. The default model is built in JavaScript and needs no model file. An explicitly
selected HTML or YAML model that fails to load displays an error containing its path.

Use `await ob_timeline.ready` to wait for the view to initialize. `loadModel(...)`
also returns a promise and retains its existing local-data loading behavior. Each
instance initializes once; delayed configuration replies cannot replace an explicit
selection. For an integration that prepares a model asynchronously, construct with
`new OB_TIMELINE({autoStart: false})`, then call `loadModel(...)` or the existing manual
initialization method when ready.

### Demo catalog

`demos/catalog.json` supplies URL-based dataset selection, the README demo links and this guide's resource table. Its paths are relative to the repository root (`basePath` resolves from the catalog). Each entry provides `id`, `title`, `description`, `dataset`, `model`, `recordCount` (the expected number of records, excluding zones), and an optional `reference` PNG. The shared loader, renderer, and page contain no demo IDs or dataset-specific branches.

Each model in `models/demos` uses the existing `params` and `bands` structure, plus `dataSource`. The presence of `dataSource` enables the shared file-backed loader; existing server models continue to use their server connection.

Both demo and provider models also accept the optional root `rendering` object.
Its 92 settings cover theme, axes, Overview, camera, activity appearance, layout,
interactions, controls and table columns. Omitted settings keep the established
defaults. The [rendering inventory](model-rendering-inventory.md) lists every
setting and its precedence. Open **Settings → Model and YAML editor** to edit
these properties and preview the actual timeline as you type; see the
[editor guide](model-editor.md) for import/export and server file management.

| Model option | Meaning |
| --- | --- |
| `params.date` | Initial reference date; numeric-axis models use a value in their declared unit. |
| `params.dateAxisMode` | `"shared"` (default) shows one date axis at the top of the current page, including grouped and paginated bands. Use `"per-band"` for models whose bands need separate date axes; each band then honors `intervalUnitPos: "TOP"` or `"BOTTOM"`. Overview keeps its separate context axis. |
| `params.overview` | Whether overview bands are initially shown. |
| `params.dockOverview` | Legacy docking preference; version 2 keeps enabled overviews in bounded footers below paginated rows. |
| `params.fullWindow` | Defaults to `true`. Fill available browser space; set `false` for custom model geometry. A saved Timeline Info preference takes precedence. |
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
| Band `height`, `color`, `SessionColor`, `eventColor`, `dateColor` | Band proportions and visual styling. Packed rows are divided into pages when available height is exceeded. |
| Band `intervalUnit`, `intervalPixels`, `dateFormat` | Time scale and tick labels. Supported units run from milliseconds through centuries. |
| Band `range`, `context` | Optional `{from, to}` dates, or values in the declared numeric unit, for the initial visible range and wider layout context. An Overview's authored range initializes its zoom span; its center follows the main interval. |
| Band `focus` | Optional `{from, to, magnification, ticks}` or an array of those objects to expand selected intervals in the main view. Overlapping magnifications multiply. Overview uses a linear axis so its indicator represents actual timestamps. |
| Band `ticks`, focus `ticks` | `{unit, step, format}` tick configuration. Calendar units such as `YEAR` and `MONTH` align to calendar boundaries; `HOUR` and `MINUTE` support finer detail. `NUMERIC` uses the declared axis unit, such as a `20` Ma step. `format` overrides the band date format for those ticks. |
| Band `tickMinutes`, focus `tickMinutes` | Compatible shorthand for minute-based tick spacing. |
| Band `labelPosition`, `topPadding` | Duration labels can use `above` or `inside`; top padding controls room above the first row. |
| Band `groupBy` | A dotted event field path, such as `data.satellite`, for generated group bands. |
| Band `filter` | `{field, equals}` selects records by a dotted event field, such as `data.namespace`, without removing them from the loaded dataset. |
| Band `eventKind` | Optional `duration` or `event` selection. |
| Overview `sourceBands` | Optional array of normal band names to project. When omitted, Overview includes all normal bands. |
| Overview `overviewLabel` | Optional compact label, such as `Magnified overview`. |
| Overview `overviewContextRatio` | Initial span relative to the main window when no range/context is authored; defaults to `4`, bounded from `1` to `12` and capped by the loaded domain. |
| Overview `overviewMarkerSize` | Minimum mark thickness in CSS pixels, from `1` to `12`; defaults to `3`. This does not lengthen a session's duration. |
| Band `secondaryScale` | A second tick scale. With `step`, an `elapsedYears` scale anchors each tick to the `origin` anniversary; `height`, `color`, `textColor`, and `suffix` style its strip. |
| Band `scaleHeader` | Optional in-chart scale annotation with `label`, `unit`, `height`, `color`, and `textColor`. It does not change the main toolbar. |
| Band `uncertaintyOpacity` | Optional opacity for durations with retained Simile uncertainty metadata; original date bounds remain unchanged. |
| Overview `fitRows` | Defaults to `true`: fits completed normal-view rows into the miniature without including unused band height or repacking events. Set `false` to retain the legacy proportional layout. |
| Overview `showContextLabel`, `viewportHandles` | `showContextLabel: false` hides the default title/count; `viewportHandles: true` adds handles for panning the visible time range. |

The loader preserves descriptions as text. Legacy image and link references remain metadata; remote images are not needed to render a demo. Simile point events with uncertain end dates remain points unless `isDuration="true"`. BCE dates and years below 100 are interpreted explicitly, avoiding JavaScript's shorthand-year parsing. Numeric approximate values retain their source notation in event metadata.

## Responsive layout and Overview

The demo page fills the available browser window. Event/session rows and table records use compact page controls when needed, without plot scrollbars. Open panels dock on wide windows and overlay on narrow windows. The toolbar wraps; Settings > Timeline Info supports full-window or custom sizing. Requested custom geometry is preserved during smaller resizes.

Overview projects the normal bands' completed layout into a miniature, retaining event colors, session durations, row order, groups, and highlighted intervals. Point events become compact dots and duration events remain horizontal bars. Each source band has a visible-time-range highlight that follows panning and the Timeline/Split viewport. Search, grouping, refresh, and Overview toggles use the same loaded data and layout; models do not need dataset-specific JavaScript.

Wheel zoom affects only the plot under the pointer. Main zoom anchors its timestamp;
Overview zoom preserves the centered indicator and changes its linear context span.
Overview's context follows main navigation while preserving its chosen duration,
with a minimum span large enough to show the main interval. Its arrows, clicks
and drags navigate the main view. **Fit context** includes the loaded domain
around that center. Narrow overlay panels end above Overview so they cannot
cover its indicator. The default footer allocation is
20% of available height, capped at 180 pixels per Overview; explicit layout
settings still apply. Dense overlapping marks aggregate with counts in their
tooltips, while all eligible source records remain available for analysis.

## Reference images and source formats

The original reference PNGs informed band colors, event/duration styles, highlighted windows and main-view focus scales. The catalog now links to [current application captures](ui/overview/README.md). JFK opens at 12:00-14:00 UTC-06:00 with five-minute ticks and the shot/time-of-death interval; its Overview shows the authored wider context on a linear axis. Religions separates the Jewish and Christian chronologies using source namespace metadata; its main scale expands the first century relative to BCE history, with a wider linear context in each Overview. Space exploration derives its initial Overview range from the main view and available records.

Monet uses a uniform 1824–1916 main range with decade ticks, a gold age strip aligned to the November 14, 1840 birth date, and compact event rows with duration labels above thin bars. Its Overview uses the 105-year span specified by its context, centered on the main interval, with five-year ticks. All 27 source records remain loaded, including events outside the initial main range. The scale header, age strip, uncertainty styling, and Overview row fitting are model options shared by the renderer.

Operations opens September 12 from 08:00 to 17:00 UTC, with extra space around 12:10–13:20 and a uniform full-day Overview. Its 48 records for that day keep their source colors and both highlight zones. All 1,008 records remain loaded and available through the table, search, and date navigation. These choices come from the model's range, context, focus, and label settings; the shared renderer has no Operations-specific branches.

Dinosaurs opens at 165–115 Ma, centered on 140 Ma, with a 4× horizontal scale and 5 Ma ticks. Its fixed Overview retains the full 240–40 Ma context, from older ages on the left to younger ages on the right, covering all 224 source records spanning 228–65 Ma. Labels sit above compact duration bars, and the Overview fits the completed event rows into its available height. All event details remain available through navigation, pagination, search, and the table.

The supplied `jfk.json`, `monet.json`, `religions.json`, and `dinausaurs.json` contain legacy XML despite their suffix. Their catalog models declare `simile-xml`. The ephemeris file's trailing comma was removed so its contents are valid JSON. `default-dataset.json` is a snapshot with a `records` array and separate `zones`. The dinosaurs source uses millions of years ago, not calendar years; its model declares a descending numeric axis. The supplied filename `dinausaurs.json` is retained.

## Add a demo

1. Add the source file under `json/test-data` and an optional reference PNG.
2. Add or reuse a model under `models/demos`. Define all visual and schema differences in its JSON configuration.
3. Add one catalog entry and run `npm run demos:readme`.
4. Run `npm run demos:validate` and `npm run test:demos`, then inspect the demo in a browser against its reference image.
5. Run `npm run test:browser` for Chromium/WebGL layout and screenshot checks. For a new demo, review and add its screenshots using the [browser regression guide](browser-tests.md).

Validation rejects missing datasets/models/references, duplicate IDs, omitted dataset files, invalid dates, and stale README links. The unit suite builds actual Three.js scene geometry and exercises the DOM, with GPU rendering and text measurement stubbed. The browser suite additionally renders all catalog demos using Chromium's actual layout engine and WebGL, comparing reviewed normal/Split screenshots at two window sizes and checking Overview, panels, bounded viewport geometry, keyboard pagination, and resize behavior. Intentional visual changes require baseline review.

## Model validation

The catalog and file-backed models have formal JSON Schema draft-07 definitions in [demo-catalog.schema.json](../schemas/demo-catalog.schema.json) and [demo-model.schema.json](../schemas/demo-model.schema.json). The browser validates the catalog before selecting a demo and validates its model before fetching data or replacing the current timeline. Errors identify the exact field, for example `models/demos/example.json: $.bands[0].ticks.step must be > 0`. Unknown options are rejected so misspelled configuration does not silently change the view. Existing server models without `dataSource` keep their original loading path.

Run `npm run demos:validate` to check every catalog model and its local dataset/reference files. An alternate local catalog can be supplied with `npm run demos:validate -- path/to/catalog.json`. Schema edits require `npm run demos:schemas`; `npm run demos:schemas -- --check` verifies that the committed browser validators match the schemas. Ajv compiles these validators during development; runtime validation uses the generated local ES module without dynamic code generation, a CDN, or extra schema requests.

Structural validation covers dimensions, colors, band options, time units, ratios, and focus magnification. Semantic validation also checks finite dates, endpoint ordering in the declared axis direction, unique names, Overview source references, and incompatible tick/axis options. Calendar configurations support extended ISO dates for BCE history; numeric range and context values use the declared native unit. Numeric ticks use `NUMERIC`, calendar month/year ticks use integer steps, and `ticks` cannot be combined with the `tickMinutes` shorthand. An Overview can select existing normal bands; omit `sourceBands` when using generated groups. A docked Overview must be the last band.

## Hosting portability

The [public gallery](https://arcazj.github.io/openbexi_timeline/) runs all seven demos on GitHub Pages. Its relative asset paths support the repository subdirectory. These demos use public JSON files and work without a Java backend or data service.

Build and verify the same static site locally:

```sh
npm ci
npm run pages:build
npx playwright install chromium --only-shell
npm run pages:verify
```

`pages:build` writes `dist/pages` using the reviewed public-file manifest and the exact browser dependency files referenced by the import map. It includes their license notices, help, public models, datasets, reference images and the Model and YAML editor with its live preview. Server configuration, runtime files and local data are excluded. The generated gallery is `index.html`; `version.json` records the release and commit.

The [Pages workflow](../.github/workflows/pages.yml) runs on pushes to `master`. It validates all seven demos and live model previews at desktop and narrow sizes under `/openbexi_timeline/`, then deploys the tested artifact. Repository **Settings > Pages > Source** must be **GitHub Actions**. The README demo table is generated with the public Pages URL; local use remains available through `npm run demo`.

After deployment, check the actual public site with:

```sh
npm run pages:verify -- --url https://arcazj.github.io/openbexi_timeline/ --commit YOUR_COMMIT_SHA
```

This checks the deployed commit, assets, record counts, Timeline/Table/Split views, search, previous/next navigation, auto scaling, Overview zoom, 3D and Help. It fails on JavaScript errors or failed asset requests.
