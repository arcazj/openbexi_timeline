# HBDS configuration

HBDS is the configuration home for OpenBEXI Timeline. The generic
[domain definition](schema/openbexi_timeline.json) describes classes and
relationships. The [runtime schema](schema/configuration.schema.json) validates
their compact JSON instance representation. Both Java and Python use this same
contract; event/session JSON is unchanged.

```text
HBDS/
  schema/                 Generic HBDS definition and runtime JSON Schema
  templates/              Reviewed generic models, YAML imports, and examples
    default.hbds.json      Runnable generic configuration
    models/               UI model templates and public demos
    yaml/                 Legacy import/export examples
  private/                Ignored operational configuration and identities
    configurations/       Authoritative deployment .hbds.json documents
    imports/              Preserved legacy inputs; not active after migration
    filters/              Existing user filter storage
    backups/              Original migration bytes
    migration.json        Local legacy-path aliases
  generated/              Ignored YAML/model exports for external consumers
```

Only files explicitly listed in `release/public-files.json` are public. New HBDS
files are ignored by default. Real namespaces, identities, credentials and
operational paths belong under `private/`. The public verifier rejects operational
namespace names and literal credentials in generic examples. It also rejects
tracked private files. `.gitignore` alone does not remove already tracked files.

## Ownership and editing

Each namespace references one model and owns its default render and filter
settings. Filter lists select filenames; string filters on JSON sources select
records. Sources reference a namespace, retain their ordered input paths
and provider settings, and may override namespace defaults. A model's
`configuration` owns its parameters, bands, rendering and zones. The source's
`configuration` owns its legacy provider fields; it cannot contain another
`namespace` value. `data_model` is the source output location, not a UI model.

`TimelineTab` has `id`, `namespaceId`, `title`, `order` and `enabled`. Its model is
resolved through the namespace. Tab names and order changes preserve existing
frames; visited tabs load lazily. A model or namespace change refreshes only the
affected loaded tabs. The host page and unrelated tabs remain loaded.
Namespace navigation is inside **Sorting & Filtering**, in its always-expanded
**Namespaces** section. Switching there keeps the panel open and reuses visited
timelines; no namespace bar occupies the top of the page.

The HBDS Editor connects automatically when opened from the local running Java or
Python server; no token entry or Connect button is needed. If the server is still
starting, the editor retries every five seconds until connected. The current
namespace, tab and live model preview open together; selecting another namespace
or tab updates the properties and preview. Forms are built from schemas as
sections open. Tab labels and other nonvisual edits keep preview data loaded.
Save checks the whole document, references and revision before
replacing the canonical file atomically. A conflict keeps the draft intact. Undo,
cancel and advanced JSON remain available. There is no periodic browser polling
for configuration changes.

The public startup response contains selected UI configuration, tab metadata and
namespace identity. Private documents, provider credentials and user/group lists
are never static assets. Direct same-origin loopback editor requests can read and
write HBDS without a token. Both the client address and Host must be local, and
cross-origin or forwarded requests do not qualify. Other HBDS API clients require
a system administrator credential (`OPENBEXI_API_TOKEN`). This local access applies
only to HBDS; other administration APIs retain their authorization checks. The modeled
role/group/grant policy is validated as configuration. Existing legacy sessions
authorization is not replaced by this migration; adding users or grants does not
silently establish a new login or data-access system.

## Start, migrate and export

Use a private canonical document as `-data_conf` on either server, or set
`OPENBEXI_HBDS_CONFIG`. A generic template is promoted to a private copy before
editing, so operational changes cannot overwrite public examples.

```powershell
node tools/hbds-migrate.mjs --import path/to/sources.yml --model path/to/model.json --output HBDS/private/configurations/team.hbds.json
.venv/Scripts/python.exe -m openbexi_timeline_server -data_conf HBDS/private/configurations/team.hbds.json --port 8088
```

`node tools/hbds-migrate.mjs --migrate-workspace` validates legacy configurations,
backs up original bytes, moves models/YAML/filters into HBDS, and writes local
aliases. Existing model/source values and multiple-path lists are preserved.
Import-only sources remain valid. Legacy aliases resolve to the canonical JSON,
so editing an archived YAML input does not change the running configuration.

External collectors that still require YAML use an explicit export:

```powershell
node tools/hbds-migrate.mjs --export HBDS/private/configurations/team.hbds.json --output HBDS/generated/team.yml
```

The export writes YAML and its selected UI model. Export paths must be new; the
tool refuses to overwrite a different existing file. It does not run an external
collector. Generic YAML files remain examples, not a second configuration store.

## API and application of changes

- `GET /api/v1/hbds`: canonical document and revision, with an `ETag`.
- `GET /api/v1/hbds/schema`: complete runtime schema for forms and validation.
- `PUT /api/v1/hbds`: raw document, requiring the last `ETag` in `If-Match`.
- `GET /openbexi_timeline/config?namespaceId=<id>`: public runtime projection.

Save responses identify affected namespaces and pending restart reasons. Models,
tabs and namespace string record filters take effect dynamically.
Source, connector and deployment/listener changes require restart. The backend
retains active provider settings until restart and continues reporting pending
changes on later saves. Follow the returned reasons for provider-specific filter
or namespace-binding changes. Restart each Java/Python process using that file.

Namespace/source `render` fields retain their ingestion meaning: export the YAML
and reload the collector to apply defaults to newly converted records. They do
not recolor already stored events. Use the model's bands and `rendering` settings
for live UI appearance changes.

Run `npm run hbds:verify` for schema freshness and public-file checks, and
`npm run test:hbds` for contract, migration and editor/runtime tests.
`npm run test:hbds:integration` exercises a real Python server and Chromium;
append `-- --java` to exercise the Java backend after compiling its test helpers.
