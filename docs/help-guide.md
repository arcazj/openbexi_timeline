# OpenBEXI Timeline help

These notes describe the version 2.6.0 browser application and the local demos in this repository. The checked-in API specification has its own version, 1.0.0. See the [README](../README.md) for the demo catalog and the [demo configuration guide](demos.md) for all model options.

## User manual

- Use **Timeline**, **Table**, or **Split** on the main toolbar to change the presentation. Split places the chart beside the event table.
- In **Table** or **Split**, each sortable heading shows **↕** before sorting begins. Select the heading or its arrow to sort; select it again to reverse the order. **↑** and **↓** identify the active direction. **Columns** chooses the fields to display. **Export CSV** includes the displayed columns and records across all table pages in the current results. Partial coverage is labeled as loaded records only; it does not export unread server history.
- The time cursor sits above the visible span. Table titles show their icon or a color marker; an unavailable icon also falls back to the event or session color.
- Selecting an event or session smoothly centers its timestamp or midpoint and preserves the visible time span. The gold selection glow remains visible, with a separate outlined marker above the Overview shading. A new gesture interrupts the movement; reduced motion makes centering immediate.
- Select an event or session to open **Data**. Drag the divider beside the panel to change its width. The focused divider also supports arrow keys; double-click resets its width. Your chosen width is saved for that timeline.
- Hover an event's text, icon, circle or duration bar to read its complete caption. Click either its text or its shape to open the same **Data** panel in 2D or 3D. Dragging from ordinary 2D event text still pans; Escape dismisses the caption.
- **Data** starts with the event's time, duration, source and status. Expand **All fields** for other metadata. Copy controls beside identifiers and timestamps copy their original values; if clipboard access is blocked, select and copy the offered text manually.
- Enter a search to center the first matching event or session automatically, with enough space for its full duration. This works with Auto scale on or off. File-backed demos search the complete dataset, including records outside the visible range.
- The interface has exactly two menu bars: main and secondary. When space permits, the main bar places **Go to latest data, Find previous activity, Find next activity | Auto scale, Lock current view** immediately after the search field. These controls move to the secondary bar when needed; horizontal scrolling keeps each bar to a single row. Activity navigation respects active search and filters. Use the mouse wheel or plus/minus keys to zoom.
- The secondary bar groups **Calendar | Filter: \<filter name\> → Filters | Timeline details**. Refresh, status, search results and removable filter labels share the two existing bars. A separator also divides **3D** and **Settings**.
- At widths of 600 pixels or less, search, previous/next activity and status stay visible in two rows. **More** opens view choices, settings, filters and other controls. Press Escape to close it and return focus to More. The menu also closes when you select a view or open a side panel.
- Choose a search mode inside **Filters → Search options**. **Text** search matches literal words and phrases without case sensitivity. **Pattern** uses a case-insensitive regular expression. **Legacy** preserves older case-sensitive expressions, with spaces and semicolons as OR. Typing waits briefly before searching; Enter searches immediately. Invalid patterns leave current results in place. Connected Text and Pattern modes require the updated server.
- **Back to previous view** restores the date and zoom before a search or selection moved the timeline, while retaining the current query and filters.
- Active filters and grouping appear as removable labels. In **Sorting & Filtering**, use **Field → Operator → Value** and choose a text, number or boolean value type. **Apply filter** changes the current view; **Add a new filter** saves it as a preset. Existing syntax remains available under **Advanced expression**.
- **Add filter** is beside the panel title and opens the editor above the sorting controls. The **Filter name** label sits beside the name field, and **Advanced expression** starts expanded with a text area filling the available width. Saved-filter selections follow the active expression and grouping, including changes made through the builder or removable labels.
- Drag the timeline or an activity to navigate through time. Clicking an activity selects it; dragging does not open Data or recenter it. Overview keeps its visible-window rectangle centered while the surrounding time context moves. Its arrows and plot dragging navigate the main view; wheel zoom over Overview changes only its context span.
- Previous/next activity centers the result while preserving the current time span, widening only when needed for the activity's duration. A gold glow marks the result without enlarging its bar, icon or text, changing its depth, or adding rows. Reduced-motion settings disable the brief brightness pulse.
- **3D** uses an angled grid, colored tracks and raised, shaded activity bars. Open **Settings → Update perspective** and enable **Adjust perspective** to rotate, pan and zoom the camera. Turn adjustment off or press Escape to navigate the timeline. Save the viewpoint, lighting, metalness and roughness for later visits. The UI always opens in **2D**; enabling 3D restores your saved settings or the reference preset. Metalness affects the view span and activities while icons keep their colors. See [Perspective settings](perspective.md).
- Use row pagination to browse records that do not fit vertically. The timeline fills the browser window by default and recalculates page capacity when resized; long panel content can scroll independently.
- Use **Resync** (Go to current time) to center the current date and time. Date-based models also provide a calendar; numeric timelines, such as millions of years ago, use their declared axis units instead.
- When the red current-time line is enabled, **Current time** appears on its date axis if it fits between date labels and inside the viewport. Its position and visibility follow panning, zooming and resizing.

The Help panel collects project resources and local demo choices. The local demos run from files and do not require a Java data service. They do not offer server login, saved server filters, or event creation.

In **Help**, selecting a local dataset immediately loads its default view. **Reset reference view** returns the current local demo to its model's initial date, Timeline view, default Overview setting, and first row, and clears the search.

In **Help → Share**, choose **Copy link** to copy the current local demo's dataset,
exact visible range and zoom, view, search, filters, grouping, Overview settings,
and selected event. A localhost link works on a computer running the demo server
at that address. Copying puts the link on your clipboard; it does not publish
data or send a message. Server-backed timelines share the page address without
private server settings.

The same section offers **Saved views**. Enter a name and choose **Save view**;
select a saved name and choose **Open saved view** to return to it. Saving under
the same name replaces that view. Up to 20 views are stored per source in this
browser, including search and filter text. **Delete saved view** removes one.
Storage failures appear next to the controls.

Refreshing local JSON reports download and processing progress in **Status**.
Large JSON files are parsed in a background worker when supported. **Stop loading**
or Escape cancels the download or worker and retains the previous dataset.

Connected loading retains up to 15,000 top-level records, 50,000 records including
activities and 8 Mi JSON payload characters. File scans can continue through up
to 512 pages per interval to fill the visible view and neighboring context.
Providers without scan-work counters use 32 pages per visible interval and four
per neighboring interval.
**Data limit reached** identifies a limit that leaves the visible time span
incompletely covered and retains accepted records. Limits outside that span
remain in the status report. See [loading limits](progressive-loading.md) for details.

In **Diagnostics**, use **Refresh** for current view, scale, and record-count information, then **Copy diagnostics** if needed. The report excludes event contents, search text, backend URLs, and browser storage. If browser clipboard access is unavailable, the selected text can be copied manually.

**Sorting & Filtering** shows each saved filter's expression beside its actions.
The preview is read-only and can be selected and copied. Choose **Edit** to change
it, **Save** to validate and store it, or **Cancel** (Escape in the editor) to
restore the saved expression. Errors stay beside the editor and retain your draft.
Use **Add filter** in the panel header to create a preset. Compact metallic rows
highlight the active filter; narrow panels place the expression below the controls.

Calendar month arrows browse dates without moving the timeline. Select a day to
load that interval. The secondary menu bar shows **Status: Loading…** or
**Status: Searching…** in orange while work continues, and **Status: Ready** in
green after successful completion when the visible time span is fully covered.
Partial coverage and data limits within that span stay orange. Limits affecting
only neighboring ranges do not prevent Ready; the report still lists them.
Coverage is checked again after panning, zooming, filtering and refreshing.
Interrupted connections stay orange; **Status: Error** is red and **Status: Cancelled** is gray.
Click the **Status** button
to open the current loading or search report; click it again to close the report,
as with **Timeline details**. The tooltip also gives the current state. If loading
fails, the report explains the reason; Retry or navigate to resume. Loaded records stay visible.
The tooltip and report include loaded item counts and available search progress.
The report's **Loading items…** indicator disappears when loading ends.
The Stop control or Escape cancels loading; Escape inside an open status explanation
closes that explanation. Partial data can concern loaded or prefetched time
ranges; open **Status** to review the warning and coverage for each range.
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

- **Timeline details** lists the loading and completion
  state of each retained interval. Incomplete coverage does not mean that no
  events occurred.
- In a static demo, if a completed interval contains no relevant activity, Auto
  scale looks for earlier activity. Connected views retain the chosen date until
  navigation or a new search. **Lock current view**, dragging and reading Data prevent this
  automatic movement. **Resync** keeps the view at now even when only historical
  records are available. Turning Auto scale off restores ordinary spacing.
- A new search centers its first result once. Later batches keep the chosen view.
  If no match is loaded, connected text searches automatically scan earlier
  configured files through the visible end date. The **Status** tooltip and report
  show the date being checked, with **Stop search** immediately to the button's
  right. Open the report to read file counts and full coverage details. Stopping keeps the view and displayed records. Finding a match
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

## Settings

Settings has four sections: **1. Edit models**, **2. Timeline info**,
**3. Update perspective**, and **4. Change look and feel**. Timeline info and
Update perspective start collapsed; select their headings to expand them.
Timeline info contains geometry and the maximum adaptive ratio.

Choose Default, Apple style, Windows style, Minimal or High contrast using the
circular radio buttons in Change look and feel. They appear horizontally and
wrap on narrow panels. Arrow keys move between choices. Themes apply immediately
and persist in this browser; Default is selected initially. They change interface
controls without altering record colors or the selected time range.
Default uses soft metallic blue-grey shades to distinguish toolbar groups.
High contrast uses a dark steel-blue bar and stronger blue-grey control surfaces,
icons, buttons and separators. Hover, keyboard focus, selected and disabled
controls have clear visual states.

Selecting **High contrast** reveals color pickers directly below it. **Overall
background** changes the workspace, panels and clear canvas; the other pickers
customize separate menu-bar groups, including controls moved into **More**.
Text adjusts to black or white for readability. Model-defined band backgrounds,
event colors and status indicators retain their meaning. Choices persist in this
browser; **Reset high contrast colors** restores the defaults. Switching themes
restores that theme's appearance. The **Model and YAML editor** button has a
stronger fill and outline in every theme.

## Model and YAML editor

The editor organizes work into Overview, Data, Appearance, Filters and Access,
with an Advanced text view of the same draft. Managed configuration requires
model administrator access. Optional AI can propose configuration from text or a
timeline image; review changes before accepting them. Event/session item JSON
metadata remains unchanged. See [model access](model-access.md),
[AI assistance](ai-assistance.md), and the [item contract](event-session-contract.md).

Open **Settings → Edit models → Model and YAML editor** to edit the current model with color
pickers, choices, numeric fields and synchronized JSON/YAML text. Valid changes
refresh a live timeline preview; invalid changes keep the last valid preview.
The preview starts with your current date, search, view and camera.

Opening from a connected application focuses the editor on the current model:
document management is hidden, with Save/Export, Undo, Redo and Revert in a compact
toolbar. Demo and standalone launches keep the full document manager. Server
permissions and validation still apply in either layout.

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
npm ci
npm test
npm run demos:readme -- --check
```

The demo suite validates catalog coverage, source imports, model settings, local HTTP assets, interaction state, responsive layout, time scales, axis ticks, Overview geometry, and docked panel behavior. It uses actual scene objects and a simulated DOM, with GPU rendering and text measurement stubbed. The separate `npm run test:browser` suite renders all seven demos in Chromium/WebGL, compares reviewed screenshots at two window sizes, and checks panel boundaries, Overview toggling, scrolling, and resizing. See the [browser regression guide](browser-tests.md) for installation and baseline review instructions.

After a catalog edit, `npm run demos:readme` updates the compact README links and
the resource table in the demo guide. Run `mvn --batch-mode --no-transfer-progress
verify` for Java and API tests. See [development and release validation](development.md)
for the complete workflow.

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
