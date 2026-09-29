# OpenBEXI Timeline help

These notes describe the version 2.2 browser application and the local demos in this repository. The checked-in API specification has its own version, 1.0.0. See the [README](../README.md) for the demo catalog and the [demo configuration guide](demos.md) for all model options.

## User manual

- Use **Timeline**, **Table**, or **Split** on the main toolbar to change the presentation. Split places the chart beside the event table.
- The time cursor sits above the visible span. Table titles show their icon or a color marker; an unavailable icon also falls back to the event or session color.
- Selecting an event or session smoothly centers its timestamp or midpoint and preserves the visible time span. The gold selection glow remains visible, with a separate outlined marker above the Overview shading. A new gesture interrupts the movement; reduced motion makes centering immediate.
- Select an event or session to open **Data**. Drag the divider beside the panel to change its width. The focused divider also supports arrow keys; double-click resets its width. Your chosen width is saved for that timeline.
- Enter a search to center the first matching event or session automatically, with enough space for its full duration. This works with Auto scale on or off. File-backed demos search the complete dataset, including records outside the visible range.
- **Lock current view** is followed by **Find previous activity** and **Find next activity**. These controls are available before searching and with Auto scale on or off. During a search, **Clear search** sits immediately before Lock current view. The activity buttons respect the active search and filters and center the result they find.
- Drag the timeline or an activity to navigate through time. Clicking an activity selects it; dragging does not open Data or recenter it. Overview keeps its visible-window rectangle centered while the surrounding time context moves. Its arrows and plot dragging navigate the main view; wheel zoom over Overview changes only its context span.
- Previous/next activity centers the result while preserving the current time span, widening only when needed for the activity's duration. A gold glow marks the result without enlarging its bar, icon or text, changing its depth, or adding rows. Reduced-motion settings disable the brief brightness pulse.
- **3D** uses an angled grid, colored tracks and raised, shaded activity bars. Open **Settings → Perspective** and enable **Adjust perspective** to rotate, pan and zoom the camera. Turn adjustment off or press Escape to navigate the timeline. Save the viewpoint, lighting, metalness and roughness for later visits. The UI always opens in **2D**; enabling 3D restores your saved settings or the reference preset. Metalness affects the view span and activities while icons keep their colors. See [Perspective settings](perspective.md).
- Use row pagination to browse records that do not fit vertically. The timeline fills the browser window by default and recalculates page capacity when resized; long panel content can scroll independently.
- Use **Resync** (Go to current time) to center the current date and time. Date-based models also provide a calendar; numeric timelines, such as millions of years ago, use their declared axis units instead.

The Help panel collects project resources and local demo choices. The local demos run from files and do not require a Java data service. They do not offer server login, saved server filters, or event creation.

In **Help**, selecting a local dataset immediately loads its default view. **Reset reference view** returns the current local demo to its model's initial date, Timeline view, default Overview setting, and first row, and clears the search.

In **Share**, choose **Copy link** to copy the current local demo's dataset, time, view, search, and Overview setting. A localhost link works on a computer running the demo server at that address. Copying puts the link on your clipboard; it does not publish the data or send a message. Server-backed timelines share the page address without private server settings.

In **Diagnostics**, use **Refresh** for current view, scale, and record-count information, then **Copy diagnostics** if needed. The report excludes event contents, search text, backend URLs, and browser storage. If browser clipboard access is unavailable, the selected text can be copied manually.

Calendar month arrows browse dates without moving the timeline. Select a day to
load that interval. If loading fails, click the orange status on the right of the toolbar
to see the reason; Retry or navigate to resume. Loaded records stay visible.
The separate orange **Loading items…** indicator disappears when loading ends.
The Stop control or Escape cancels loading; Escape inside an open status explanation
closes that explanation. **Partial data** can concern loaded or prefetched time
ranges; click it to review the warning and coverage for each range.
The plot stays clear. Toolbar messages describe empty intervals after loading settles
with no records in the visible interval. Partial coverage and source failures have
distinct messages. **Go to latest data** moves to the latest observed timestamp
when one is available; it may not be the newest record in an incomplete archive.

For a REST connection (`secure:<port>`), the browser loads the view and bounded
adjacent buffers, then stays idle. Moving the view reuses cached data and checks
expired visible intervals. Use the toolbar's **Refresh** to check for changes at
the same date. A live connection (`secure_sse:<port>`) receives change notifications
and updates records while preserving the selection and zoom. Its status shows
reconnection or unavailability. See [loading behavior](progressive-loading.md).
Multi-band views share one top date axis by default. A model can explicitly request
separate axes with `params.dateAxisMode: "per-band"`.

## Auto scale and exploration

**Auto scale** gives busy intervals more space and compresses quiet intervals.
Axis labels choose suitable units from milliseconds to years. Numeric timelines
keep their declared units. Overview always uses uniform time spacing.

- **Search details** or **Timeline details** lists the loading and completion
  state of each retained interval. Incomplete coverage does not mean that no
  events occurred.
- In a static demo, if a completed interval contains no relevant activity, Auto
  scale looks for earlier activity. Connected views retain the chosen date until
  navigation or a new search. **Lock current view**, dragging and reading Data prevent this
  automatic movement. **Resync** keeps the view at now even when only historical
  records are available. Turning Auto scale off restores ordinary spacing.
- A new search centers its first result once. Later batches keep the chosen view.
  If no match is loaded, connected text searches automatically scan earlier
  configured files through the visible end date. The toolbar shows the date
  being checked or the number of files examined, with **Stop search** immediately
  to its right. Stopping keeps the view and displayed records. Finding a match
  centers it at the current zoom. Active filters and **Sort by** apply throughout; changing either or the
  query cancels the previous search.
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
  Alt+Left/Right to move between matches. Search and activity-navigation moves
  are immediate; clicking an event or session animates unless reduced motion is enabled.

Historical text searches continue in small batches until a match is found or all
eligible configured history has been examined. **No matching records** is final
only after that complete search. Unreadable files, unsupported sources and failed
requests show an incomplete result. Older servers use a limited nearby search
and also report incomplete coverage when no match is found. The first result
found is not guaranteed to be the nearest in time. See
[historical search](progressive-loading.md#historical-search) for scope and
compatibility details. With no query, a REST connection stays idle after loading
its normal view and buffers.

## Model and YAML editor

Open **Settings → Model and YAML editor** to edit the current model with color
pickers, choices, numeric fields and synchronized JSON/YAML text. Valid changes
refresh a live timeline preview; invalid changes keep the last valid preview.
The preview starts with your current date, search, view and camera.

Use import/export on GitHub Pages or a local static server. **Apply to original
timeline** reloads the original page with your draft once; save or export the
file to keep the change. An authenticated Java server also supports file
creation, editing, renaming and deletion. YAML deployment changes require a
server restart. See the [editor guide](model-editor.md) and
[rendering settings inventory](model-rendering-inventory.md).

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

## Sorting and filtering

Open **Filter syntax** in the Sorting & Filtering editor for legacy and advanced examples. Prefix advanced expressions with `expr:`. Invalid edits leave the last valid filter active. Presets retain **Sort by**. Both REST and SSE apply filters on the server before returning records. See [Filter syntax](filter-syntax.md).
