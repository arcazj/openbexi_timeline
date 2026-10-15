# OpenBEXI Timeline 2.8.1

2.8.1 improves the HBDS Editor and event/session descriptors while retaining the
existing Java and Python data contracts.

## HBDS Editor

Opening the editor from Settings shows the current model preview and its namespace
and timeline tab in one workspace. The originating date, camera and table/timeline
view are preserved. Selecting another namespace or tab updates the properties and
preview together. The separate **Back to model preview** action is removed.

Compact menus use stronger contrast, a clearly selected editing section and a
visible saved/unsaved indicator. The preview sits beside the properties on larger
screens and below them on phones. Model edits update the preview after a short
delay; tab renames and other nonvisual edits keep preview data loaded. Provider
requests remain scoped to the selected namespace.

The editor connects automatically to the local running Java or Python server,
without a token prompt or Connect button. This applies only to direct same-origin
loopback HBDS administration; remote, forwarded and unrelated administration
requests retain their authorization requirements. Revision checks, conflict
handling, undo, explicit **Save and apply**, scoped tab refresh and atomic saves
remain in place. See the [editor guide](model-editor.md) and
[HBDS configuration guide](../HBDS/README.md).

## Descriptors

Descriptors show ID first and Namespace in the summary. All additional properties
and activities are visible without a More details disclosure. The full formatted
description appears once, at the end. Copy buttons, internal recordKind metadata,
the duplicate description preview and the separator after Duration are removed.
Additional property rows use more compact spacing.

## Upgrade

Restart the Java or Python server after updating, then reopen the editor from
Settings. Refresh the browser if it retains older assets. Existing HBDS documents,
data sources and saved filters remain compatible. Settings reports UI version
2.8.1 and the connected backend version separately.

Private deployment files and local data remain outside the source archive and
public HBDS allowlist. The Windows installer continues to start the Java server;
the Python backend remains available as a separate installation.

## Validation

Local validation covered 400 JavaScript tests across the full suite and focused
reruns, 49 Python tests, and 154 passing Java tests with 34 existing skips. Seven
release-publication tests also passed. Schema generation, demo data, API metadata,
the public HBDS boundary, source packaging and the static demo build were checked.
The npm audit reported no vulnerabilities.

Browser checks cover desktop, narrow and phone layouts, active namespace/tab and
view preservation, live draft previews, undo, conditional saves, conflict retention
and namespace-scoped provider requests. Real Java and Python browser integrations
verify persistence across full server restarts and preservation of unaffected tabs.
The running local server was also checked without modifying its configuration.
