# OpenBEXI Timeline 2.3.0

Version 2.3.0 brings together historical search, filtered live updates, advanced
filtering and saved 3D perspectives. It includes the changes developed in the
2.2.1, 2.2.2 and 2.2.3 checkpoints since the published 2.2.0 version.

## Search and loading

- When a query has no loaded matches, the server searches earlier files in small
  pages until it finds a match or exhausts available history. The right toolbar
  shows the date being checked and a **Stop search** button.
- Searching retains the current view. Finding a match centers its timestamp
  while preserving zoom, filters and **Sort by**. Query changes and cancellation
  release cursors and prevent late responses from moving the timeline.
- A definitive no-match requires complete coverage. Unreadable files,
  unsupported sources, failed requests and limited searches on older servers
  report **Search incomplete**.
- REST connections become idle after loading the visible range and bounded
  neighboring buffers. Navigation and Refresh request data; SSE connections
  receive revision notifications and reconcile filtered changes.
- Source filters and saved user filters apply before records are returned.
  Cached unchanged files reuse parsed records and time indexes.

See [progressive loading](progressive-loading.md) and
[connected setup](connected-diagnostics.md).

## Filtering and presentation

- Legacy filter expressions remain supported. The `expr:` syntax adds boolean
  operators, grouping, comparisons, literal text, lists and field existence.
  **Filter syntax** opens help from Sorting & Filtering. Saved presets retain
  their **Sort by** value. See the [filter guide](filter-syntax.md).
- The time cursor sits above the view span. Table titles show the appropriate
  icon or a color marker. Selecting a record smoothly centers and highlights it;
  its Overview marker remains visible above the shading.
- Overview follows main-band colors. Empty grouped results preserve the time
  window. Status and loading indicators sit on the right beside Refresh, with
  explanations available from the status button.
- **Settings → Perspective** saves camera, lighting, metalness and roughness.
  Every page opens in **2D**; enabling 3D restores the saved view or reference
  preset. The view span and activities use local reflections, while icon colors
  remain readable. Claude Monet and Dinosaurs share the same perspective
  controls. See the [perspective guide](perspective.md).

## Upgrade and release contents

Restart the Java server and reload the browser to update both sides of the
history and live-update protocols. Existing models, static data, legacy filters
and the API v1 contract remain supported. Browser, npm, Help and Maven identify
this release as **2.3.0**; the API schema version remains **1.0.0**.

Native launchers need a local YAML configuration. Pass `-data_conf` with an
existing file or set `OPENBEXI_TIMELINE_CONFIG`. The optional local default
`yaml/sources_startup.yml` is not part of the release. Missing configurations
produce a clear message before Java starts. See [deployment](security.md#deployment).

The source package uses `release/public-files.json`. Generated archives,
build output, temporary reports, private configurations and operational data
are excluded from Git. `npm run release:source` creates the current source
archive and checksum locally in `dist/`.

## Validation

- 246 JavaScript checks passed across the full suite and focused reruns.
- 40 historical-search and navigation browser checks passed at desktop and
  narrow widths, including the May 21 regression using synthetic records.
- 81 Java tests passed; 34 existing environment-dependent tests were skipped.
- All 14 static-site demo flows passed under a subdirectory, including 3D and
  the live model editor. IntelliJ compilation passed.
- Earlier checkpoint checks cover selection, saved filters, status controls,
  metallic rendering, camera preferences and restoring the 2D view.

Previous checkpoints: [2.2.3](release-2.2.3.md), [2.2.2](release-2.2.2.md),
[2.2.1](release-2.2.1.md), [2.2.0](release-2.2.md).
