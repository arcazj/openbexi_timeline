# Data-driven demos

Use Node.js 24 or later for the demo tools and tests.

```sh
npm install
npm run demo
```

Open <http://localhost:8780/demos.html>. Choose a dataset, then use the same Timeline, Table, Split, search, overview, calendar, and camera controls as the main timeline. Split places the timeline on the left and the table on the right. The return-to-reference control restores the model's initial date. File-backed demos are read-only; server login, saved server filters, and event creation are not shown. Numeric axes have no calendar control.

The file server binds to `127.0.0.1`; it does not publish the project. Change the port with `npm run demo -- --port 8788`. A link can select a view, for example `demos.html?demo=monet&view=split`.

## Catalog and models

`demos/catalog.json` is the source for the selector and generated README table. Its paths are relative to the repository root (`basePath` resolves from the catalog). Each entry provides `id`, `title`, `description`, `dataset`, `model`, `recordCount` (the expected number of records, excluding zones), and an optional `reference` PNG. The shared loader, renderer, and page contain no demo IDs or dataset-specific branches.

Each model in `models/demos` uses the existing `params` and `bands` structure, plus `dataSource`. The presence of `dataSource` enables the shared file-backed loader; existing server models continue to use their server connection.

| Model option | Meaning |
| --- | --- |
| `params.date` | Initial reference date; numeric-axis models use a value in their declared unit. |
| `params.overview` | Whether overview bands are initially shown. |
| `params.displayOffsetMinutes`, `params.timeZoneLabel` | Explicit display offset and label, independent of the browser's local time zone. |
| `params.showCurrentTime` | Set to `false` for historical datasets. |
| `dataSource.format` | `json` or `simile-xml`. Format is explicit rather than inferred from filenames. |
| `dataSource.recordsPath` | Array path inside JSON, such as `records`; defaults to `events`. |
| `dataSource.fields` | Optional dotted field paths, or fallback path arrays, for `id`, `title`, `description`, `namespace`, and `color`. |
| `dataSource.iconColors` | Maps legacy icon references to colors, without depending on unavailable remote icon files. |
| `dataSource.zones` | Extra highlighted intervals with `start`, `end`, `title`, and color/opacity. Dataset zones are also supported. |
| Zone `render.height`, `render.verticalAlign` | Optional strip height and `top` alignment; otherwise the zone spans the band. |
| `dataSource.time` | Optional numeric axis: `kind: "numeric"`, `unit`, `millisecondsPerUnit`, `direction`, and optional `approximatePrefixes`. The internal coordinate conversion is not a claim that numeric values are calendar dates. |
| Band `height`, `color`, `SessionColor`, `eventColor`, `dateColor` | Band proportions and visual styling. Bands grow when additional rows are needed. |
| Band `intervalUnit`, `intervalPixels`, `dateFormat` | Time scale and tick labels. Supported units run from milliseconds through centuries. |
| Band `groupBy` | A dotted event field path, such as `data.satellite`, for generated group bands. |
| Band `eventKind` | Optional `duration` or `event` selection. |
| Band `secondaryScale` | A second tick scale, such as `{ "format": "elapsedYears", "origin": "1840-11-14" }`. |

The loader preserves descriptions as text. Legacy image and link references remain metadata; remote images are not needed to render a demo. Simile point events with uncertain end dates remain points unless `isDuration="true"`. BCE dates and years below 100 are interpreted explicitly, avoiding JavaScript's shorthand-year parsing. Numeric approximate values retain their source notation in event metadata.

## Reference images and source formats

The models use the provided PNGs for band colors, event/duration styles, highlighted windows, and focus scales. Monet includes a birth highlight and age scale; JFK uses minute detail and the shot/time-of-death interval; Religions separates duration and event bands with BCE/CE context; the operations snapshot retains source colors and both zones. Space exploration uses the existing documentation PNG. The legacy Simile references use some nonlinear/compressed axis layouts; these models use the renderer's uniform scales rather than reproducing that compression pixel for pixel.

The supplied `jfk.json`, `monet.json`, `religions.json`, and `dinausaurs.json` contain legacy XML despite their suffix. Their catalog models declare `simile-xml`. The ephemeris file's trailing comma was removed so its contents are valid JSON. `default-dataset.json` is a snapshot with a `records` array and separate `zones`. The dinosaurs source uses millions of years ago, not calendar years; its model declares a descending numeric axis. The supplied filename `dinausaurs.json` is retained.

## Add a demo

1. Add the source file under `json/test-data` and an optional reference PNG.
2. Add or reuse a model under `models/demos`. Define all visual and schema differences in its JSON configuration.
3. Add one catalog entry and run `npm run demos:readme`.
4. Run `npm run test:demos`, then inspect the demo in a browser against its reference image.

Validation rejects missing datasets/models/references, duplicate IDs, omitted dataset files, invalid dates, and stale README links. Tests build actual Three.js scene geometry and exercise the DOM, with GPU rendering and text measurement stubbed. They do not replace visual browser checks.

## Hosting portability

The page and its assets use relative paths and can be served under a subdirectory. A static host must include the HTML, `src`, `css`, `icon`, `models/demos`, `demos`, `json/test-data`, reference images, and the browser dependencies referenced by the import map (`three`, `three-spritetext`, and `simple-jscalendar` under `node_modules`). No Java backend or data service is required. To publish public links, first deploy those assets and then generate the README URLs against the chosen public base URL; the current README deliberately uses the local server.
