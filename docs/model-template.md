# Generic timeline model template

[HBDS/templates/models/model_template.json](../HBDS/templates/models/model_template.json) is a loadable example
with a detail band, a docked overview, field mappings, a reference window, and
every current rendering default. It uses the bundled operations sample and opens
at `2026-09-12T12:30:00Z`, within that sample's date range.

The template was assembled from all 14 JSON models in the local `models/` tree:
seven provider models (including five deployment-local files) and seven demo
models. The legacy test fixture was also checked. Deployment-specific names,
colors, dates, endpoints, and credentials are not copied into the template.
The contracts are [demo-model.schema.json](../schemas/demo-model.schema.json),
[legacy-model.schema.json](../schemas/legacy-model.schema.json), and the
[rendering defaults](../src/openbexi_timeline_rendering.js).

Open the file in the model editor, or load it from a page at the application root:

```javascript
await timeline.loadModel('HBDS/templates/models/model_template.json');
```

`dataSource.url` is relative to the hosting page, as in the existing loader. Change
it if the page is hosted in a subdirectory. The template is an example; it is not
selected automatically by an existing deployment.

## Attribute inventory

Values in the JSON are representative choices unless explicitly described below
as rendering defaults. Required fields refer to the strict file-backed model
schema; the legacy provider schema intentionally accepts additional properties.
Nested requirements apply only when their containing object is present.

| Path | Type and requirement | Purpose / source |
| --- | --- | --- |
| `$schema` | Optional string | Relative reference to the strict model schema. |
| `params` | Required array with exactly one object | Shared model contract. |
| `params[].name` | Required nonempty string | Timeline instance identifier; all models. |
| `params[].title` | Optional string | Visible report title; all models. |
| `params[].date` | Required string or number | Initial calendar instant, or numeric axis value; calendar demos and dinosaurs. |
| `params[].timeZone`, `timeZoneLabel` | Optional strings | Time-zone setting and display label; all models, JFK and dinosaurs. |
| `params[].displayOffsetMinutes` | Optional number | Fixed display offset; JFK. Zero in the UTC template. |
| `params[].top`, `left` | Optional numbers | Position for custom geometry; all models. |
| `params[].width`, `height` | Required positive numbers | Geometry in pixels; all models. |
| `params[].fullWindow` | Optional boolean; schema default `true` | Fill available space; regular and demo models. |
| `params[].fontSize`, `fontFamily`, `fontStyle`, `fontWeight` | Optional positive number, string, enum, string/number | Timeline typography; existing models and published schema. |
| `params[].data` | Optional string | Provider URL for legacy models; empty for the file-backed template. |
| `params[].overview`, `dockOverview`, `showCurrentTime` | Optional booleans | Overview layout and current-time display; demo models. |
| `params[].overviewHeightRatio` | Optional number between 0 and 1 | Overview share; JFK, Monet, religions and dinosaurs. |
| `params[].dateAxisMode` | Optional `shared` or `per-band`; default `shared` | Published date-axis setting. |
| `params[].camera` | Optional `Orthographic` or `Perspective` | Model preview camera; published schema. Ordinary page startup uses 2D. |
| `dataSource` | Required object in file-backed models | File loading configuration; absent in provider models. |
| `dataSource.format` | Required `json` or `simile-xml` | Operations/space/ephemeris versus historical demo adapters. |
| `dataSource.url` | Optional nonempty string | Dataset URL; required by the loader unless supplied separately or using inline/offline data. |
| `dataSource.recordsPath` | Optional property path | `records` in the operations snapshot; parser default is `events`. |
| `dataSource.fields` | Optional object | Record mapping; ephemeris and the published schema. |
| `dataSource.fields.id`, `title`, `description`, `namespace`, `color` | Optional path string or ordered array of paths | Template makes parser fallback paths explicit. Start/end retain their existing record fields. |
| `dataSource.iconColors` | Optional map from icon string to color string | JFK and Monet; empty until an icon mapping is needed. |
| `dataSource.zones` | Optional array | Highlighted reference intervals; JFK. Template adds one sample window. |
| `dataSource.zones[].start`, `end`, `title` | Required time values and string | Window boundaries and label. |
| `dataSource.zones[].id`, `color`, `opacity` | Optional string/number, string, number from 0 to 1 | Window identity and styling. |
| `dataSource.zones[].render` | Optional object | Window-specific presentation. |
| `dataSource.zones[].render.color`, `opacity`, `height`, `verticalAlign`, `labelPosition` | Optional string, opacity, positive number, `top`/`center`, `top`/`bottom` | Published zone rendering attributes. |
| `bands` | Required nonempty array | Band order is display order; all models. |
| `bands[].name`, `height`, `intervalUnit`, `intervalPixels` | Required string, positive number/percentage, time-unit enum, positive number | Band identity, layout, and scale; all models. |
| `bands[].intervalUnitPos`, `dateFormat` | Optional `TOP`/`BOTTOM`, string | Axis placement and label format; all models. |
| `bands[].color`, `SessionColor`, `eventColor`, `textColor`, `dateColor` | Optional strings | Band and activity colors; all models. `SessionColor` retains its existing capitalization. |
| `bands[].fontSize`, `fontFamily`, `fontStyle`, `fontWeight` | Optional positive number, string, enum, string/number | Band typography; demos and schema. |
| `bands[].model[].sortBy` | Required `NONE` when a sorting entry is present | Existing strict demo contract. This nested array is not a separate UI model document. |
| `bands[].range`, `context` | Optional objects with required `from`/`to` | Visible range and wider context; operations and historical demos. `context` requires `range`. |
| `bands[].focus` | Optional object or nonempty array | Magnified ranges; operations, JFK and religions. Requires `range`. |
| `bands[].focus.from`, `to`, `magnification` | Required time values and number at least 1 | Focus boundaries and scale multiplier. |
| `bands[].ticks`, `bands[].focus.ticks` | Optional objects | Explicit ticks; historical demos. Required `unit` and positive `step`, optional `format`. |
| `bands[].tickMinutes`, `bands[].focus.tickMinutes` | Optional positive numbers | Calendar minute tick alternative; operations. Do not combine with `ticks` in the same object. |
| `bands[].scaleHeader` | Optional object with required `label` | Dinosaurs and Monet. Optional `unit`, `height`, `color`, `textColor`. |
| `bands[].labelPosition`, `topPadding`, `trackIncrement`, `sessionHeight`, `defaultEventSize` | Optional enum and numbers | Label placement, packing and activity geometry; demos. |
| `bands[].uncertaintyOpacity` | Optional number from 0 to 1 | Uncertain interval presentation; Monet. |
| `bands[].sourceBands` | Optional array of distinct existing detail-band names | Overview projection; Monet, dinosaurs and religions. |
| `bands[].fitRows`, `showContextLabel`, `viewportHandles` | Optional booleans | Overview presentation; demo models. |
| `bands[].overviewLabel` | Optional string or `false` | Overview title; historical demos. |
| `bands[].overviewContextRatio`, `overviewMarkerSize` | Optional numbers from 1 to 12 | Published overview settings. |
| `rendering` | Optional object | All nine groups are included using the exact current runtime defaults. |

The complete types, defaults, bounds, and descriptions for `rendering.theme`,
`axis`, `overview`, `camera`, `activity`, `layout`, `interaction`, `controls`, and
`table` are in the [rendering inventory](model-rendering-inventory.md).
Source-level YAML `render` and per-record `render` retain their own scopes.

## Background images

The template includes optional image fields at all three levels. Each accepts an
image URL string or `null` (the default, retaining the existing color):

| Scope | Property | Color fallback |
| --- | --- | --- |
| Overall timeline canvas | `rendering.theme.sceneBackgroundImage` | `rendering.theme.sceneBackground` |
| Individual band, including an overview band | `bands[].backgroundImage` | `bands[].color` |
| Highlight zone | `dataSource.zones[].render.backgroundImage` | `dataSource.zones[].render.color` or the existing zone color |

For example, set a band's `backgroundImage` to `images/band-background.png` after
placing that image in the application's served assets. URLs resolve relative to
the hosting page. The renderer accepts same-origin HTTP(S) images; the hosting
server must expose the requested file. Images stretch to their respective
surfaces in 2D and 3D. The overall canvas image appears behind the bands, so opaque
band backgrounds can cover it. Zone images follow the zone's `render.opacity`.

Projected overview regions inherit their source band's image unless the overview
band supplies its own image. Zone images also appear in the overview. Background
images are separate from legacy band/event `image` icons and cube `texture`
reflections. They do not change record selection, grouping, or event colors.

The configured color remains visible until loading succeeds, and stays in place
if the image fails. WebGL textures are cached per timeline and reused across
scene rebuilds. Failed WebGL loads are not repeatedly retried during rebuilds;
reloading the timeline instance retries them. A customized high-contrast workspace color
temporarily replaces the overall image and restores it when that mode is left.

## Alternatives retained from existing models

These options are documented separately because enabling every model's settings
together would change the intended dataset or create incompatible axis settings.

| Attribute | Type / source | How to use it |
| --- | --- | --- |
| `dataSource.time` | Optional object; dinosaurs | Numeric-axis configuration with required `kind: "numeric"`, `unit`, and positive `millisecondsPerUnit`; optional `direction` (`-1`/`1`) and string array `approximatePrefixes`. Calendar models omit it. |
| `bands[].groupBy` | Optional property path; ephemeris | For example, `namespace`. Remove overview `sourceBands` when projecting dynamically generated groups. |
| `bands[].filter` | Optional object; religions | Required `field` path and `equals` string/number/boolean/null. Example: `{"field":"namespace","equals":"operations"}`. Omitting it retains all records. |
| `bands[].eventKind` | Optional `event`/`duration`; religions | Restrict a band to milestones or durations. Omit to show both. |
| `bands[].secondaryScale` | Optional object; Monet | Required `format: "elapsedYears"`, calendar `origin`, positive `step`. Optional `position`, `height`, `color`, `textColor`, `suffix`, `min`. Appropriate for a calendar history or age scale. |
| `params[].data_default_port`, `data_sse_port` | Legacy integer extensions; provider models and test fixture | Endpoint substitutions for legacy deployments. Obtain values from the actual server configuration. They are not allowed in the strict file-backed model schema. |
| `bands[].subIntervalPixels` | Legacy number or `AUTO`; provider models | Legacy subdivisions; omitted from strict file-backed models. |
| `bands[].model[].alternateColor` | Legacy string; provider models | Alternate group color. Requires the legacy model schema. |
| `bands[].model[].sortBy` | Legacy string; provider models | The legacy schema also accepts values beyond the strict demo value `NONE`; use the existing provider's supported grouping fields. |
| `bands[].intervalPixels` | Legacy numeric string or number; provider models | The template uses numbers as required by the strict schema. |
| `params[].date` | Legacy `current_time` string; provider models | Selects the current date on the provider path. A file-backed model should specify a valid date within its dataset. |

For a numeric axis, adapt the complete date configuration together: initial date,
band ranges/context/focus, zones, and ticks. Use `ticks.unit: "NUMERIC"` and remove
calendar `tickMinutes` and `secondaryScale`. For example, the existing dinosaurs
model uses `unit: "Ma"`, `millisecondsPerUnit: 31536000000`, `direction: -1`, and
`approximatePrefixes: ["?"]`. Its ranges decrease numerically because larger
values mean further in the past. See the complete
[numeric example](../HBDS/templates/models/demos/dinausaurs.json).

For Simile XML, use `format: "simile-xml"`, the appropriate XML dataset URL, and
remove the snapshot's `recordsPath: "records"` so the adapter reads `events`.
`iconColors` can then map the original icon strings to colors. The existing demo
catalog may supply normalized JSON snapshots instead; use the adapter matching
the actual content loaded by the caller.

For a server-backed copy, switch `$schema` to `../schemas/legacy-model.schema.json`,
remove `dataSource`, use `date: "current_time"`, and configure `params[0].data` with
the actual sessions endpoint or let the host provide it. Remove sample-specific
`range`, `context`, and `focus` settings so dates come from the current server
window. Legacy transport ports are optional and deployment-specific. Keep the
existing source YAML independent of this example.

## Namespace and HBDS mapping boundary

This file describes a UI `Model`. A top-level YAML `model` setting can select a UI
model file. Each source's YAML `data_model` instead describes its materialized
data storage path. Neither field implies that the UI model contains users,
groups, permissions, ingestion credentials, or source connectors. Those belong
to the subsequent HBDS design and source configuration.

The namespace `filter.include`/`exclude` in `source_template.yml` selects source
files. The UI band's `filter.field`/`equals` selects displayed records. Keep these
as distinct structures when deriving the HBDS classes.
