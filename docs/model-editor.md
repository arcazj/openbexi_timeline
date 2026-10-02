# Model and YAML editor

Open **Settings → Edit models → Model and YAML editor** in any timeline. The editor opens
`openbexi_timeline_model.html` with that timeline's model and data source.
You can also open the editor directly and choose any of the seven public demos.
See the [desktop, narrow and phone views](ui/model-editor/README.md).

An application using a server-selected model or connected source opens a focused
editor. The document chooser, create/import/rename/delete controls, document-status
row and workspace selector are hidden. Save/Export, Undo, Redo and Revert remain in
a compact toolbar with the draft's change state. Apply, validation errors, operation
messages and authorization warnings remain available. The subtitle sits beside the
editor title when space permits; both wrap on phones.

Demo launches (`demos.html`) and standalone editing retain the full document
manager. Launch links carry `launch=connected`, `launch=demo` or `launch=standalone`;
the layout survives reload and connecting or disconnecting from the server. This
parameter controls presentation only. A direct `?modelId=<id>` link without a
launch context retains the full layout and still requires administrator access.

## Edit and preview

The form groups work into **Overview**, **Data**, **Appearance**, **Filters** and
**Access**. It provides color pickers, choices, numeric inputs, toggles, and
controls to add, remove or reorder array items. Use **Add optional property** to
expose a setting that currently uses its default. Search with **Find a property**.
**Advanced text** edits the same JSON or YAML draft.

Managed model documents require that model's administrator role. Open the editor
with `?modelId=<id>` and connect using your user token. Access controls, saved
filters and configuration history use separate server resources. See
[model access](model-access.md) for setup and role boundaries. Local example
copies retain import, preview and export.

Selecting a workspace model opens its saved configuration. **Save to server**
updates that model with its current revision check; an intervening server edit
leaves your draft intact and asks you to reconcile it. Use the **Managed model**
entry in Open document to reload the current server version. Saved filters share
the dataset revision but remain separate from configuration edits.

Overview lists saved model versions. **Open as draft** opens a historical
configuration as a local copy. **Save as server copy** stores it as a separate
scoped configuration document; it does not replace the active managed model.
There is no automatic rollback or deployment action.

**Live preview** uses the application's actual renderer in an isolated frame.
Valid edits refresh it automatically after a short typing delay. Invalid edits
show validation errors and retain the last valid preview. You can pause automatic
updates, refresh manually, and interact with the preview's Timeline, Table, Split,
overview, search and 3D controls. Previewing does not save the document.

**Apply to original timeline**, available when launched from Settings, validates
the draft and reloads the originating page with a one-use model override. It does
not write a file. The override expires after one minute and is consumed on reload;
subsequent reloads use the normal configured model. Save separately for persistence.

Drafts are scoped to the originating timeline instance. Applications that create
multiple timelines in a changing order can pass a stable `instanceId` to
`new OB_TIMELINE({instanceId: 'my-timeline'})`. An explicitly edited nonempty
`dataSource.url` takes precedence over the page's original dataset option for the
applied reload; unchanged sources retain their normal precedence.

When launched from Settings, the preview inherits the visible date, search, view
and camera. Editing the model's date or camera mode takes precedence over that
context. Changing camera optics, such as field of view, keeps the inherited 2D/3D mode.
Applying a model reloads the timeline in 2D. Enable 3D to use its saved perspective.
**Use preview data URL in model** makes a chosen demo dataset explicit in a saved
file, so reopening a copy does not depend on the original demo page's options.

Models with `dataSource` use the demo schema. Provider models use the legacy schema,
which preserves legacy extension keys. Both accept optional `rendering` settings.
See the [rendering inventory](model-rendering-inventory.md) for supported properties,
defaults, precedence and the configuration intentionally retained in code.

Event, session and activity JSON metadata is a fixed contract. Configuration,
access and AI changes must not add fields or reshape items; see the
[compatibility rule](event-session-contract.md).

## Optional AI

Connect as a model administrator to use a configured AI provider. Ask for an
explanation, a generated configuration, or a repair. A vision-capable model can
use a dropped timeline image as a rendering reference. Review the proposed
changes and preview before accepting them into the draft; saving remains separate.
Cancellation, failure and invalid candidates retain the existing draft. Provider
keys stay on the server. Model JSON/YAML is supported; source and deployment YAML
remain manual. See [AI setup and capabilities](ai-assistance.md).

## Documents and YAML

- Create a model or source YAML draft, import a file, or duplicate an example.
- Undo, redo and revert changes; the editor warns before discarding unsaved work.
- Public examples are read-only. Save a copy or export your edits.
- Export downloads the current validated document. It does not overwrite the source.
- YAML form edits preserve comments, unrelated keys and document structure. Edit
  anchored or aliased values in Advanced text so their shared meaning stays explicit.
- Model YAML with `params` and `bands` can be validated, previewed and saved directly.
  Source YAML previews its referenced model. Connection, permission, converter and
  deployment changes take effect in the server, so the editor reports restart requirements.

On GitHub Pages, use local import, preview and export. Server CRUD is available when
the page is served by a Java server with the configuration API enabled.

## Server file CRUD

Set `OPENBEXI_API_TOKEN` to an administrator token of at least 32 characters, start
the Java server, then choose **Connect to server** in the editor. The token stays in
the editor's memory and is discarded on disconnect or closing the page.

By default, new files are stored as actual `.json`, `.yml` or `.yaml` files under
`config-files` inside `OPENBEXI_API_DATA_DIR` (outside the public web root).
They are separate from API datasets. Saving a new file does not automatically
switch a running timeline to it; export/deploy it or configure the appropriate model.

To edit existing deployment files, explicitly register their directories using
`OPENBEXI_CONFIG_ROOTS` or the JVM property `openbexi.api.configRoots`.
Use the platform path separator: `;` on Windows, `:` on Unix. For example:

```powershell
$env:OPENBEXI_CONFIG_ROOTS = 'C:\projects\openbexi_timeline\models;C:\projects\openbexi_timeline\yaml'
```

All file listing, reading and mutation requires administrator authentication.
The global file API requires a system administrator. Model administrators use
isolated `/api/v1/models/{id}/config-files` resources and cannot edit unrelated
models or shared deployment roots.
The public `/openbexi_timeline/config` response remains limited to model and data
URLs. Registered files appear under server-issued IDs; the API does not accept
arbitrary filesystem paths from the browser.

Saves validate first and replace files atomically. Edits and deletes require the
last document `ETag` in `If-Match`. A conflicting edit leaves the draft and saved
file intact. Rename a saved document separately from content changes; the response
returns its new ID. Rename/delete checks references in registered configuration
documents and, for registered public models, root launch pages and the demo catalog.
External applications outside those registered locations require their own updates.

YAML text is persisted verbatim through this API. It does not use the legacy
`data_sources.saveYaml` method, which reconstructs only source entries and loses
other root content. YAML saves are marked **restart required**. The editor does
not claim that a saved server configuration has already become active.

See [REST API](rest-api.md) for endpoints and authentication details.
