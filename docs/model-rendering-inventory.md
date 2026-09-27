# Model rendering inventory

## Contract and migration

Rendering configuration lives in the optional root `rendering` object. `src/openbexi_timeline_rendering.js` defines its defaults, field metadata, bounds and resolver. The browser editor and published schemas expose the same contract. Defaults are deeply frozen and every timeline receives an independent resolved copy. Applying a model retains an untouched `modelDocument` and copies working parameters and bands.

Omitting `rendering`, specifying an empty object, or explicitly providing all defaults produces the same geometry. Existing demo model properties remain in place. File-backed demo models continue to reject unknown fields. Provider models use `schemas/legacy-model.schema.json`, which preserves legacy extensions, numeric-string intervals, `AUTO` subintervals and alternate group colors while validating the new rendering object strictly.

Settings apply to the whole timeline. Existing band, record and source-specific settings retain their established scope. Explicit `params[0].camera` overrides the initial rendering camera mode. Saved layout preferences and URL/share state retain their existing precedence. Camera controls, searches and navigation change runtime state; they do not rewrite the model.

All values in the tables below are presentation preferences, not engine resource or security limits. Null optional theme colors retain the current stylesheet theme. Validation rejects unknown rendering keys, invalid types, values outside the listed bounds, empty visible-column sets and label width inversions. The editor displays the validation issue at the model property path.

## Existing model data retained

| Category | Model properties | Consumer and precedence |
| --- | --- | --- |
| Identity and initial state | `params[0].name/title/date/timeZone/timeZoneLabel/displayOffsetMinutes` | Main initialization and data date formatting; startup remains explicit HTML model, YAML model, built-in default. |
| Window and overview layout | `top/left/width/height/fullWindow/overview/dockOverview/overviewHeightRatio/showCurrentTime/dateAxisMode` | Viewport, shared axes and overview; saved user layout wins when present. |
| Typography | `params[0].fontSize/fontFamily/fontStyle/fontWeight`; band equivalents | Main renderer and activity labels; record typography overrides band typography. Band font-family/style/weight are now accepted by the strict schema and honored in static preparation. |
| Bands | `bands[].name/height/color/SessionColor/eventColor/textColor/dateColor` | Band order is array order. Source styling retains its existing priority for source-grouped bands. |
| Time scales | `intervalUnit/intervalPixels/intervalUnitPos/dateFormat/ticks/tickMinutes/range/context/focus` | Scale and tick engines; calendar arithmetic stays in code. |
| Rows and activities | `trackIncrement/sessionHeight/defaultEventSize/topPadding/labelPosition/eventKind` | Data packing and scene creation; geometry and pagination are derived. |
| Grouping and filters | `groupBy/filter/model[].sortBy/model[].alternateColor` | Static/provider projection; actual record membership remains computed. |
| Overview projection | `sourceBands/fitRows/showContextLabel/viewportHandles/overviewContextRatio/overviewMarkerSize/overviewLabel` | Overview projection and SVG footer. |
| Scale strips | `scaleHeader`, `secondaryScale` | Band-specific height/color/text and labels override their corresponding new rendering defaults. |
| Source fields and icons | `dataSource.format/url/recordsPath/fields/iconColors` | Field mappings accept one path or an ordered array of fallback paths. Existing paths and per-record image references remain supported. |
| Numeric and historical axes | `dataSource.time.kind/unit/millisecondsPerUnit/direction/approximatePrefixes` | Numeric transformations and historical dates; mathematical date bounds remain in code. |
| Zones | `dataSource.zones[].start/end/title/render` | Zone color/opacity/height/alignment/label location stay model or record driven. |
| Legacy rendering extensions | `bands[].texture/defaultSessionTexture/subIntervalPixels/model`, camera and geometry fields | Legacy schema retains unknown extension fields rather than silently stripping them. |
| Per-record overrides | `render.color/textColor/opacity/image/fontSize/fontFamily/fontStyle/fontWeight` | Record styling remains distinct from timeline preferences and source configuration. |
| Deployment and source connectivity | YAML model path and `data_sources` configuration | Server configuration remains separate from public rendering; credentials, permissions and connection strings do not enter rendering models. |

## Newly centralized rendering properties

Each subsection names the consumer that previously contained the literal defaults. Bounds are inclusive. Arrays and enums are validated against the published schemas.

### theme

Scene and optional application surface colors.

Consumer: `openbexi_timeline.js: update_scene; applyRenderingTheme`.

| Property | Default | Type / allowed values |
| --- | --- | --- |
| `rendering.theme.sceneBackground` | `"#f7f9fc"` | string |
| `rendering.theme.headerBackground` | `null` | string or null |
| `rendering.theme.panelBackground` | `null` | string or null |
| `rendering.theme.panelText` | `null` | string or null |

### axis

Date axes and automatic tick spacing.

Consumer: `openbexi_timeline.js: render_band_scale_headers/createDateText; paging: dateAxisHeight/rowHeader; ticks: bandTicks`.

| Property | Default | Type / allowed values |
| --- | --- | --- |
| `rendering.axis.background` | `"#f7f9fc"` | string |
| `rendering.axis.separatorColor` | `"#8090a0"` | string |
| `rendering.axis.textColor` | `"#233449"` | string |
| `rendering.axis.minimumHeight` | `28` | 16 to 160 |
| `rendering.axis.verticalPadding` | `16` | 0 to 80 |
| `rendering.axis.minimumFontSize` | `12` | 6 to 48 |
| `rendering.axis.targetTickPixels` | `100` | 30 to 400 |
| `rendering.axis.groupHeaderHeight` | `24` | 12 to 120 |
| `rendering.axis.scaleHeaderColor` | `"#edf0f1"` | string |
| `rendering.axis.scaleHeaderText` | `"#397a9c"` | string |
| `rendering.axis.secondaryColor` | `"#ffd58a"` | string |
| `rendering.axis.secondaryText` | `"#704308"` | string |

### overview

Overview SVG labels, markers and visible-range indicators.

Consumer: `openbexi_timeline_overview_panel.js: createPanel/syncPanel/syncAxis`.

| Property | Default | Type / allowed values |
| --- | --- | --- |
| `rendering.overview.borderColor` | `"#aab8bf"` | string |
| `rendering.overview.headingColor` | `"#566871"` | string |
| `rendering.overview.headingFontSize` | `11` | 6 to 32 |
| `rendering.overview.countFontSize` | `10` | 6 to 32 |
| `rendering.overview.axisFontSize` | `10` | 6 to 32 |
| `rendering.overview.markerStroke` | `"#253746"` | string |
| `rendering.overview.markerStrokeWidth` | `0.35` | 0 to 8 |
| `rendering.overview.dimmedOpacity` | `0.25` | 0 to 1 |
| `rendering.overview.matchColor` | `"#ffe04b"` | string |
| `rendering.overview.matchOpacity` | `0.95` | 0 to 1 |
| `rendering.overview.matchStroke` | `"#783800"` | string |
| `rendering.overview.matchStrokeWidth` | `2` | 0 to 8 |
| `rendering.overview.viewportColor` | `"#ffffff"` | string |
| `rendering.overview.viewportOpacity` | `0.08` | 0 to 1 |
| `rendering.overview.viewportStroke` | `"#536872"` | string |
| `rendering.overview.viewportStrokeWidth` | `1` | 0 to 8 |
| `rendering.overview.handleColor` | `"#eff8ff"` | string |
| `rendering.overview.handleStroke` | `"#4d89ae"` | string |
| `rendering.overview.handleWidth` | `7` | 3 to 24 |
| `rendering.overview.handleMaxHeight` | `48` | 12 to 120 |

### camera

3D camera and lighting. Existing params.camera takes precedence for initial mode.

Consumer: `openbexi_timeline.js: ob_set_camera; activity_focus: positionActivityCamera/begin`.

| Property | Default | Type / allowed values |
| --- | --- | --- |
| `rendering.camera.mode` | `"Orthographic"` | Orthographic, Perspective |
| `rendering.camera.fieldOfView` | `30` | 10 to 100 |
| `rendering.camera.yaw` | `-0.42` | -0.65 to 0.65 |
| `rendering.camera.pitch` | `0.22` | 0.06 to 0.46 |
| `rendering.camera.roll` | `-0.12` | -0.5 to 0.5 |
| `rendering.camera.rotationSensitivity` | `0.002` | 0.0001 to 0.02 |
| `rendering.camera.ambientColor` | `"#ffffff"` | string |
| `rendering.camera.ambientIntensity` | `1.5` | 0 to 5 |
| `rendering.camera.directionalColor` | `"#ffffff"` | string |
| `rendering.camera.directionalIntensity` | `1.8` | 0 to 5 |

### activity

Activity labels, 3D materials and selection brightness. Selection never enlarges activities.

Consumer: `openbexi_timeline_activity_focus.js: activityLabelMetrics/register/sync`.

| Property | Default | Type / allowed values |
| --- | --- | --- |
| `rendering.activity.labelMinWidth` | `80` | 20 to 400 |
| `rendering.activity.labelMaxWidth` | `360` | 40 to 1600 |
| `rendering.activity.labelHorizontalPadding` | `24` | 0 to 200 |
| `rendering.activity.lineHeight` | `1.25` | 1 to 3 |
| `rendering.activity.shininess` | `24` | 0 to 100 |
| `rendering.activity.shadowColor` | `"#17363d"` | string |
| `rendering.activity.shadowOpacity` | `0.16` | 0 to 1 |
| `rendering.activity.laneOpacity` | `0.08` | 0 to 1 |
| `rendering.activity.glowColor` | `"#ffca28"` | string |
| `rendering.activity.glowOutline` | `"#ae5b00"` | string |
| `rendering.activity.glowOpacity` | `0.22` | 0 to 1 |
| `rendering.activity.glowPulse` | `0.12` | 0 to 1 |
| `rendering.activity.transitionMs` | `850` | 0 to 5000 |
| `rendering.activity.matchBackground` | `"#fff6bd"` | string |
| `rendering.activity.leaderColor` | `"#507585"` | string |
| `rendering.activity.selectedLeaderColor` | `"#9c5900"` | string |

### layout

Responsive layout preferences; computed positions and page membership are not persisted.

Consumer: `openbexi_timeline_viewport.js: measure; views: applyLayout`.

| Property | Default | Type / allowed values |
| --- | --- | --- |
| `rendering.layout.sidebarBreakpoint` | `900` | 320 to 2400 |
| `rendering.layout.sidebarMinimum` | `320` | 180 to 800 |
| `rendering.layout.sidebarDefaultMaximum` | `480` | 180 to 1400 |
| `rendering.layout.sidebarDefaultRatio` | `0.22` | 0.1 to 0.7 |
| `rendering.layout.sidebarMaximumRatio` | `0.6` | 0.2 to 0.85 |
| `rendering.layout.minimumPlotWidth` | `420` | 80 to 1200 |
| `rendering.layout.overviewMaxHeight` | `180` | 40 to 800 |
| `rendering.layout.minimumDetailHeight` | `100` | 40 to 800 |
| `rendering.layout.splitRatio` | `0.5` | 0.2 to 0.8 |

### interaction

Initial search preferences and user navigation increments. Saved/URL state still takes precedence.

Consumer: `openbexi_timeline_results.js: constructor/mount; viewport: mountSideResizer; overview_panel: createPanel`.

| Property | Default | Type / allowed values |
| --- | --- | --- |
| `rendering.interaction.searchMode` | `"highlight"` | highlight, only |
| `rendering.interaction.highlight` | `true` | boolean |
| `rendering.interaction.autoScale` | `false` | boolean |
| `rendering.interaction.adaptiveRatio` | `8` | 1 to 16 |
| `rendering.interaction.zoomInFactor` | `0.8` | 0.1 to 0.99 |
| `rendering.interaction.zoomOutFactor` | `1.25` | 1.01 to 10 |
| `rendering.interaction.overviewPanFraction` | `0.5` | 0.05 to 1 |
| `rendering.interaction.overviewKeyboardFraction` | `0.1` | 0.01 to 1 |
| `rendering.interaction.resizeStep` | `20` | 1 to 100 |
| `rendering.interaction.resizeLargeStep` | `50` | 1 to 300 |

### controls

Labels for existing, approved view and overview actions.

Consumer: `openbexi_timeline_views.js: constructor; overview_panel: createPanel`.

| Property | Default | Type / allowed values |
| --- | --- | --- |
| `rendering.controls.timelineLabel` | `"Timeline"` | string |
| `rendering.controls.tableLabel` | `"Table"` | string |
| `rendering.controls.splitLabel` | `"Split"` | string |
| `rendering.controls.previousOverviewLabel` | `"←"` | string |
| `rendering.controls.previousOverviewTitle` | `"Navigate earlier"` | string |
| `rendering.controls.nextOverviewLabel` | `"→"` | string |
| `rendering.controls.nextOverviewTitle` | `"Navigate later"` | string |
| `rendering.controls.fitOverviewLabel` | `"Fit context"` | string |
| `rendering.controls.fitOverviewTitle` | `"Fit loaded context in Overview"` | string |

### table

Table columns and details links.

Consumer: `openbexi_timeline_views.js: renderTable`.

| Property | Default | Type / allowed values |
| --- | --- | --- |
| `rendering.table.emptyText` | `"No events to display."` | string |
| `rendering.table.columns` | `[{"field":"title","label":"Title"},{"field":"start","label":"Start"},{"field":"end","label":"End"},{"field":"source","label":"Source"},{"field":"status","label":"Status"}]` | array |

## Values intentionally retained in code

- Calendar/numeric conversion, density analysis, packing, pagination, hit testing, projected coordinates, responsive measurements and camera fitting remain algorithms.
- Runtime selection, pan/zoom, page membership, cached projections, timers, requests and GPU resources are never serialized into models.
- Maximum tick counts, date mathematical bounds, request bounds, protected paths and authorization remain engine/server constraints.
- The built-in icon preload catalog remains resource initialization. Models already select event icons through record image paths and source icon mappings; preload order has no presentation meaning.
- Base stylesheet rules for structural display, focus visibility, pointer handling and accessibility remain CSS. Optional surface colors and the migrated visual settings are applied per timeline. Replacing every CSS rule with model fields would expose implementation mechanics without a supported design purpose.
- Existing table formatting uses the timeline's own time-axis formatter. The selectable fields are title, start, end, source, status, description and id; arbitrary executable formatters are not accepted.
- UI action handlers stay in code. The controls section changes labels and tooltips for approved actions.

## Further candidates requiring a separate behavior contract

These audit findings are not exposed as editable model properties in this migration. No placeholder fields are accepted for them.

| Candidate | Current location | Reason to retain current behavior |
| --- | --- | --- |
| Full button themes, hover/pressed shadows and focus styles | `css/ob_timeline_views.css`, modern/classic stylesheets | A complete theme contract must define keyboard focus and contrast across every control; the new surface and renderer colors cover scoped presentation without replacing accessibility rules. |
| Menu visibility and arbitrary menu reordering | Main header/settings builders | Hiding essential navigation or editing actions needs explicit rules and accessible alternatives. Approved action labels are configurable now. |
| Arbitrary table field expressions and format callbacks | `TimelineViews.renderTable` | The column model supports the defined record fields and existing date formatting. Executable expressions are not presentation data. A future declarative field-path contract should define missing values and record inheritance first. |
| Request cadence, network timeouts, density bin count and search traversal budgets | Loader, exploration and adaptive modules | These affect server work, completeness and performance. They need a transport/engine configuration contract and workload validation, separate from rendering preferences. |
| Replacing built-in texture preload lists | Main constructor | Existing icon mappings and record image paths already choose presentation; preloading is a resource optimization. |
| Exporting computed pagination, density maps or camera-fit coordinates | Paging, adaptive and activity-focus modules | These values depend on records and viewport size. Persisting them would make a model stale or device dependent. |

## Validation evidence

`tests/timeline-rendering.test.mjs` checks independent immutable defaults, parity between model schemas and rendering metadata, invalid settings, all top-level legacy models, and default-output equivalence for all seven public demos. It also checks WebGL axis/background output, SVG overview styles, table column order, search defaults, responsive split geometry, 3D camera/light/material values, wrapping metrics and glow without activity resizing. Existing overview, paging, startup, model, interaction and browser suites remain required; visual baselines are not changed for default rendering.

Use `openbexi_timeline_earthquake -data_conf "yaml/sources_earthquake.yml"` for connected-provider validation alongside every catalog demo. The editor previews use the real renderer and apply valid model revisions in an isolated frame; importing or previewing a configuration does not save it.
