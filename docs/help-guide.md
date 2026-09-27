# OpenBEXI Timeline help

These notes describe the version 2.1 browser application and the local demos in this repository. The checked-in API specification has its own version, 1.0.0. See the [README](../README.md) for the demo catalog and the [demo configuration guide](demos.md) for all model options.

## User manual

- Use **Timeline**, **Table**, or **Split** on the main toolbar to change the presentation. Split places the chart beside the event table.
- Select an event or session to open **Data**. Drag the divider beside the panel to change its width. The focused divider also supports arrow keys; double-click resets its width. Your chosen width is saved for that timeline.
- Enter a search to center the first matching event or session automatically, with enough space for its full duration. This works with Auto scale on or off. File-backed demos search the complete dataset, including records outside the visible range.
- **Lock current view** is followed by **Find previous activity** and **Find next activity**. These controls are available before searching and with Auto scale on or off. During a search, **Clear search** sits immediately before Lock current view. The activity buttons respect the active search and filters and center the result they find.
- Drag the timeline to navigate through time. Overview keeps its visible-window rectangle centered while the surrounding time context moves. Its arrows and plot dragging navigate the main view; wheel zoom over Overview changes only its context span.
- Previous/next activity centers the result while preserving the current time span, widening only when needed for the activity's duration. A gold glow marks the result without enlarging its bar, icon or text, changing its depth, or adding rows. Reduced-motion settings disable the brief brightness pulse.
- **3D** uses an angled grid, colored tracks and raised, shaded activity bars. Full titles use the model's font size and remain readable as you rotate. Activities share compact rows when space allows; extra pages appear only when the records and readable titles cannot fit. Hold **Shift** while dragging to rotate; regular dragging moves through time.
- Use row pagination to browse records that do not fit vertically. The timeline fills the browser window by default and recalculates page capacity when resized; long panel content can scroll independently.
- Use **Resync** (Go to current time) to center the current date and time. Date-based models also provide a calendar; numeric timelines, such as millions of years ago, use their declared axis units instead.

The Help panel collects project resources and local demo choices. The local demos run from files and do not require a Java data service. They do not offer server login, saved server filters, or event creation.

In **Help**, selecting a local dataset immediately loads its default view. **Reset reference view** returns the current local demo to its model's initial date, Timeline view, default Overview setting, and first row, and clears the search.

In **Share**, choose **Copy link** to copy the current local demo's dataset, time, view, search, and Overview setting. A localhost link works on a computer running the demo server at that address. Copying puts the link on your clipboard; it does not publish the data or send a message. Server-backed timelines share the page address without private server settings.

In **Diagnostics**, use **Refresh** for current view, scale, and record-count information, then **Copy diagnostics** if needed. The report excludes event contents, search text, backend URLs, and browser storage. If browser clipboard access is unavailable, the selected text can be copied manually.

Calendar month arrows browse dates without moving the timeline. Select a day to
load that interval. If loading fails, the red **Update failed — open details**
control opens the reason; Retry or navigate to resume. Loaded records stay visible.
Loading status appears in the toolbar; its Stop control or Escape cancels loading.
The startup plot stays clear. A no-results panel appears only after an active search finishes without a result in the visible interval.
Multi-band views share one top date axis by default. A model can explicitly request
separate axes with `params.dateAxisMode: "per-band"`.

## Auto scale and exploration

**Auto scale** gives busy intervals more space and compresses quiet intervals.
Axis labels choose suitable units from milliseconds to years. Numeric timelines
keep their declared units. Overview always uses uniform time spacing.

- **Search details** or **Timeline details** lists the loading and completion
  state of each retained interval. Incomplete coverage does not mean that no
  events occurred.
- If a completed interval contains no relevant activity, Auto scale looks for
  earlier activity. **Lock current view**, dragging and reading Data prevent this
  automatic movement. **Resync** keeps the view at now even when only historical
  records are available. Turning Auto scale off restores ordinary spacing.
- A new search centers its first result once. Later batches keep the chosen view.
  If no match is loaded, connected searches inspect nearby past and future
  intervals and center the first result while preserving the current time span.
  **Find previous activity** and **Find next activity** search backward and forward
  without moving the plot until a result arrives; **Cancel search** retains the view.
- Overview emphasizes search matches with larger yellow markers, dark outlines
  and a match count; other records fade while Highlight matches is enabled.
  Scroll down over Overview to widen its time range and up to narrow it. Both
  directions update Overview's labels and keep the main time range unchanged.
- Dense point events form clickable groups with event and warning counts. Use
  **Event groups** to expand them with a keyboard. Table and Overview retain the
  original records. Selected events, pinned records, durations, sessions, and
  records with `priority` or `severity` set to `high`, `critical` or `emergency`
  remain individual. Warning counts use `status` or `severity` values containing
  `warning`, `warn` or `alert`.
- Focus the timeline and use Left/Right to pan, Plus/Minus to zoom, and
  Alt+Left/Right to move between matches. Automatic moves are immediate, with no
  animation; the existing reduced-motion preference also disables coasting.

Connected searches inspect at most eight expanding intervals, 32 response pages
and 20 seconds. They stop at the first page containing relevant activity and
release unused cursors. A result from an incomplete scan is earlier/later activity,
not a claim that it is the nearest event in the entire archive. If nothing is
found within those bounds, choose a date or adjust the filters to continue.

## Design

Every demo uses the same toolbar, loader, chart renderer, table, and responsive layout. Models define the differences in appearance: band heights and colors, event and duration styles, highlighted intervals, tick labels, initial range, and expanded focus intervals. Text above the toolbar is omitted so that the chart uses the available window height.

Overview projects the rows already laid out in the normal view. It preserves event colors, relative row order, sessions, groups, and zones. A model can keep Overview below the scrolling rows, use a wider time range, and fit those rows into a compact miniature.

See [model options](demos.md#catalog-and-models) and [responsive layout](demos.md#responsive-layout-and-overview).

## Data design

The [demo catalog](../demos/catalog.json) maps a demo ID to its dataset and model. A model's `dataSource` describes its format and field mapping; `params` defines initial view settings and `bands` describes the chart. Different schemas and visual styles belong in those files rather than dataset-specific JavaScript.

The shared loader accepts JSON and legacy Simile XML. A file's suffix does not determine its format: several supplied `.json` files contain XML and explicitly declare `simile-xml`. Field mappings can use dotted paths and fallback paths. Numeric axes declare their units and direction; approximate source values remain available in event metadata.

Ranges limit the initial visible interval. Context ranges select the records laid out for that view without deleting records from the loaded dataset. Focus intervals change horizontal spacing and have an inverse mapping so navigation and Overview remain aligned. The table and search can use records outside the initial range.

Follow [Add a demo](demos.md#add-a-demo) to add a dataset, model, and catalog entry, then regenerate the README and run validation.

## Architecture

| Component | Responsibility |
| --- | --- |
| [demos.html](../demos.html), [openbexi_demo.js](../src/openbexi_demo.js) | Catalog selection, model loading, and responsive demo shell. |
| [openbexi_timeline.js](../src/openbexi_timeline.js) | Timeline lifecycle, Three.js scene construction, toolbar, navigation, and panels. |
| [openbexi_timeline_data.js](../src/openbexi_timeline_data.js) | Shared file loading, normalized event data, and normal-band layout. |
| [openbexi_timeline_scale.js](../src/openbexi_timeline_scale.js), [openbexi_timeline_ticks.js](../src/openbexi_timeline_ticks.js) | Time-to-pixel transforms and model-driven axis ticks. |
| [openbexi_timeline_overview.js](../src/openbexi_timeline_overview.js), [openbexi_timeline_overview_panel.js](../src/openbexi_timeline_overview_panel.js) | Projection of normal rows, visible-range windows, and docked Overview. |
| [openbexi_timeline_views.js](../src/openbexi_timeline_views.js) | Timeline, Table, and Split view layout and interaction. |
| [serve-demos.mjs](https://github.com/arcazj/openbexi_timeline/blob/master/tools/serve-demos.mjs) | Local static-file server for demos and documentation. |
| [Java server](https://github.com/arcazj/openbexi_timeline/blob/master/src/com/openbexi/timeline/server/openbexi_timeline.java) | Separate server-backed application using the Java data-source and servlet components. |

The static demos do not call the Java service. The [API reference](api.html) documents the checked-in Swagger contract, not a running server discovered by the demo page.

## Tests

Use Node.js 24 or later. From the repository root:

```sh
npm install
npm run test:demos
node tools/update-demo-readme.mjs --check
```

The demo suite validates catalog coverage, source imports, model settings, local HTTP assets, interaction state, responsive layout, time scales, axis ticks, Overview geometry, and docked panel behavior. It uses actual scene objects and a simulated DOM, with GPU rendering and text measurement stubbed. The separate `npm run test:browser` suite renders all seven demos in Chromium/WebGL, compares reviewed screenshots at two window sizes, and checks panel boundaries, Overview toggling, scrolling, and resizing. See the [browser regression guide](browser-tests.md) for installation and baseline review instructions.

To update the generated README demo list after a catalog edit, run `npm run demos:readme`. Java test sources are also present under [src/com/openbexi/timeline/tests](https://github.com/arcazj/openbexi_timeline/blob/master/src/com/openbexi/timeline/tests/test_timeline.java); the demo suite does not run them.

## Deployment

For local demos, install dependencies and run:

```sh
npm run demo
```

Open `http://localhost:8780/demos.html`. The server binds to `127.0.0.1`; `npm run demo -- --port 8788` selects another port. A demo link can select a dataset and view, for example `demos.html?demo=monet&view=split`.

Static hosting must include the page, source modules, styles, icons, demo catalog, models, datasets, and browser dependencies referenced by the page's import map. Include `help`, `docs`, `swagger`, `README.md`, and `LICENSE` to keep the Help links available. Keep their relative directory structure when hosting under a subdirectory. See [hosting portability](demos.md#hosting-portability).

The Java deployment is separate. Its [Maven configuration](https://github.com/arcazj/openbexi_timeline/blob/master/pom.xml) targets Java 17, and the repository provides [Windows](https://github.com/arcazj/openbexi_timeline/blob/master/openbexi_timeline.bat) and [shell](https://github.com/arcazj/openbexi_timeline/blob/master/openbexi_timeline.sh) startup examples. Configure their installation and data paths for your environment before use. The [Kubernetes deployment](https://github.com/arcazj/openbexi_timeline/blob/master/yaml/deployment.yaml) and [service](https://github.com/arcazj/openbexi_timeline/blob/master/yaml/service.yaml) are examples containing environment and storage placeholders, not a deployment created by opening a local demo.

## Resource maintenance

[help/resources.json](../help/resources.json) supplies Help resource labels and destinations. Local links are relative to the project root. Keep linked documents with the deployed assets, and only enable a Live API link when a real documentation endpoint is configured. No public prompt-history document is currently included.
