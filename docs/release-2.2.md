# OpenBEXI Timeline 2.2.0

Version 2.2.0 adds a visual Model and YAML editor with a live timeline preview
and moves 92 more rendering settings into validated models. Existing models
keep their appearance and behavior when these optional settings are omitted.

## Changes

- Open **Settings → Model and YAML editor** or the
  [public editor](https://arcazj.github.io/openbexi_timeline/openbexi_timeline_model.html).
  Edit colors, choices, numbers, toggles, nested fields and arrays, or use the
  synchronized JSON/YAML text view. Create, import, duplicate, rename, delete,
  undo, redo and export documents.
- Preview valid edits automatically using the actual timeline renderer. The
  preview supports all seven demos, legacy provider models, search, Timeline,
  Table, Split and 3D. Invalid changes retain the last valid preview. Opening
  from Settings carries over the current date, search, view and camera.
- Apply a draft to its original timeline with a single reload. This override
  affects that timeline instance once; save or export separately to keep it.
- Configure theme, axes, Overview, camera, activity appearance, layout,
  interactions, controls and table columns in the optional `rendering` object.
  Schemas validate types and bounds, with matching browser and server checks.
  See the [complete inventory](model-rendering-inventory.md) for defaults,
  precedence, consumer code and settings that remain in the application.
- Manage real JSON and YAML files through the authenticated Java configuration
  API. Saves preserve YAML text, validate content and detect conflicting edits.
  Registered directories control which deployment files are available, and
  reference checks protect linked models during rename and delete.
- Ship the editor, preview, schemas, YAML parser and license with the
  [seven GitHub Pages demos](https://arcazj.github.io/openbexi_timeline/).
  Static hosting supports local import, preview and export.
- Keep a search or navigation destination when loading starts before the next
  render. A delayed display update can no longer restore the previous range.

## Compatibility and deployment

Package, Maven, browser source and Help identify this release as **2.2.0**.
The REST API contract remains **1.0.0** and gains configuration-file endpoints.
Explicit HTML model selection, server YAML selection and the built-in default
retain their startup precedence. Models without `rendering` retain the previous
defaults; legacy extension fields remain supported.

Server file CRUD requires an administrator token. New files are stored outside
the public web root; existing deployment directories must be explicitly registered.
Saving a new file does not activate it automatically. Server YAML changes require
a restart. See the [editor guide](model-editor.md) and [API guide](rest-api.md).

## Validation

Release checks cover generated schemas, all demo models, README links, OpenAPI,
JavaScript tests, Java tests, dependency audits, browser regressions and source
packaging. The Pages check exercises every demo and its live editor at 1440 × 900
and 800 × 700, including assets, record counts, views, search, activity navigation,
scaling, 3D and Help. The same check verifies the deployed commit after publishing.

The release suite includes 212 JavaScript tests, 68 Java tests and 163 browser
cases. The 34 environment-dependent Java skips and seven duplicate browser-case
skips are unchanged. Existing screenshot baselines are retained.

Connected validation uses `openbexi_timeline_earthquake.html` with
`-data_conf yaml/sources_earthquake.yml`, including a `volcano` search, previous/next
activity, 3D and the Settings editor. Local data and captures are excluded from
the release. See the [browser testing guide](browser-tests.md).

`npm run release:source` builds the 535-file reviewed source archive and SHA-256
checksum from the explicit public-file manifest. The existing [GPL license](../LICENSE)
and [third-party notices](third-party-notices.md) apply, including the vendored
YAML parser's ISC license. Previous changes are recorded in the
[2.1 release notes](release-2.1.md).
