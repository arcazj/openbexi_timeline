# Versioned REST API

The `/api/v1` API serves all seven catalog examples and durable, editable JSON datasets. It uses the same model schema as the browser. Existing `/openbexi_timeline/sessions` and SSE endpoints keep their existing routes.

Catalog examples are public and read-only. Clone an example to edit it. Managed datasets, their models, records, and saved filters require authentication even for reads. The first version uses a JSON repository with atomic file replacement and per-dataset locking; it does not advertise legacy MongoDB, Kafka, or HTTP connectors as writable REST repositories. The legacy MongoDB methods were separately corrected to operate on individual records.

## Start locally

Install JDK 17 or newer and Maven, then run `npm run api` from the repository root. Open `http://localhost:8781/demos.html` or `http://localhost:8781/api/v1/health`. This development launcher listens on loopback. The main Java server also mounts `/api/v1` on its existing connectors.

Configure tokens as environment variables before starting the server. Use independently generated random secrets of at least 32 characters:

| Variable | Access |
| --- | --- |
| `OPENBEXI_API_TOKEN` | Administrator: all reads/writes, dataset creation/deletion, model replacement |
| `OPENBEXI_API_WRITE_TOKEN` | Legacy writer: reads and record/filter edits on unscoped managed datasets |
| `OPENBEXI_API_READ_TOKEN` | Legacy reader: reads of unscoped managed datasets |
| `OPENBEXI_API_DATA_DIR` | Persistent directory outside the public web root; default is `.openbexi-timeline/api` under the server user's home |
| `OPENBEXI_API_CORS_ORIGINS` | Optional comma-separated exact allowed origins, such as `https://timeline.example.com` |

Unset tokens grant no access. The administrator token manages workspaces, user credentials and model grants. User tokens authorize only models granted to that user in their workspace. Scoped models require an explicit grant; legacy writer/reader tokens cannot bypass it. See [model access](model-access.md) for provisioning and role examples. Use HTTPS for remote access. Send tokens only as `Authorization: Bearer ...`; do not put them in URLs, models, source control, or browser local storage. Reads of bundled examples require no token. The API does not accept client-selected filesystem paths or database connection strings.

System properties `openbexi.api.root`, `openbexi.api.dataDir`, and development-only `openbexi.api.port` can override the root, storage directory, and development port. For example, `mvn compile exec:java -Dexec.mainClass=com.openbexi.timeline.api.ApiServer -Dopenbexi.api.port=8781`.

## Resources

| Resource | Methods | Behavior |
| --- | --- | --- |
| `/api/v1/health` | GET, HEAD | Availability, version, links |
| `/api/v1/openapi.json` | GET, HEAD | Machine-readable OpenAPI 3.1 contract |
| `/api/v1/datasets` | GET, POST | Discover datasets; administrator creates or clones |
| `/api/v1/datasets/{id}` | GET, HEAD, PATCH, DELETE | Metadata, capabilities, rename, deletion |
| `/api/v1/models` | GET, HEAD | Discover dataset model links |
| `/api/v1/models/{id}` | GET, HEAD, PUT | Read or replace a dataset's model |
| `/api/v1/me` | GET, HEAD | Current identity and workspace memberships |
| `/api/v1/access/users` | GET, HEAD, POST | System administrator provisions users; new credentials are returned once |
| `/api/v1/workspaces` | GET, HEAD, POST | System administrator lists and creates workspaces |
| `/api/v1/workspaces/{id}/entitlement` | GET, HEAD, PUT | System administrator manages commercial/exempt AI eligibility |
| `/api/v1/models/{id}/access` | GET, HEAD, PUT | Effective permissions; model administrator manages grants |
| `/api/v1/models/{id}/config-files[/{documentId}]` | GET, HEAD, POST, PUT, DELETE | Model administrator manages isolated configuration documents |
| `/api/v1/models/{id}/versions[/{revision}]` | GET, HEAD | Model administrator reads saved configuration history |
| `/api/v1/models/{id}/preview` | GET, HEAD | Model administrator reads authenticated preview items |
| `/api/v1/models/{id}/filters[/{recordId}]` | GET, HEAD, POST, PUT, PATCH, DELETE | Model-owned filters, sharing the dataset filter store |
| `/api/v1/models/{id}/ai/providers` | GET, HEAD | Model administrator with AI entitlement reads configured AI models and capabilities |
| `/api/v1/models/{id}/ai/generate` | POST | Authorized administrator requests an explanation or draft |
| `/api/v1/models/{id}/ai/cancel` | POST | Cancel the caller's pending request |
| `/api/v1/config-files` | GET, HEAD, POST | System administrator lists or creates standalone model/YAML documents |
| `/api/v1/config-files/{id}` | GET, HEAD, PUT, DELETE | System administrator reads, saves, renames or deletes a configuration file |
| `/api/v1/datasets/{id}/events` | GET, HEAD, POST | Query all records, including zones; create a record |
| `/api/v1/datasets/{id}/events/{recordId}` | GET, HEAD, PUT, PATCH, DELETE | Individual record operations |
| `/api/v1/datasets/{id}/sessions` | GET, HEAD, POST | Duration records, activities, or explicit `data.kind: "session"` |
| `/api/v1/datasets/{id}/sessions/{recordId}` | GET, HEAD, PUT, PATCH, DELETE | Session operations on the same underlying records |
| `/api/v1/datasets/{id}/filters` | GET, HEAD, POST | Saved queries |
| `/api/v1/datasets/{id}/filters/{recordId}` | GET, HEAD, PUT, PATCH, DELETE | Saved query operations |

POST a dataset with `{"id":"my-monet","title":"My Monet timeline","sourceId":"monet"}` to clone an example. Alternatively supply a validated `model` and an `events` array. Source models are normalized to JSON records at the API boundary. Events use `{"id":"optional-on-create","start":"1900-01-01T00:00:00Z","data":{"title":"An event"}}`; add `end` for a duration. Generated IDs remain stable after persistence. PUT replaces a record and PATCH merges objects, removes null-valued properties, and replaces arrays.

Models remain data-driven. A model edit cannot change the time axis of a populated dataset, which would reinterpret existing values. Create another dataset when changing units or axis direction. Catalog model changes continue to be made through reviewed source files.

The [event/session JSON contract](event-session-contract.md) is unchanged. Model ownership, grants, commercial eligibility and AI requests live outside item payloads. A model currently binds to one dataset with the same ID. AI drafts never write data or save a model automatically. The [AI guide](ai-assistance.md) describes optional provider setup and review.

Cloning a scoped managed dataset inherits its workspace and model grants before
publishing the copied data. Filters are rebound to the new model ID without
changing event/session records. Clones of public examples and unscoped models
retain legacy access until explicitly scoped.

The administrator preview endpoint returns `{dateTimeFormat:"iso8601",events:[...]}`
with the stored records and dataset ETag. The selected model retains its numeric
or calendar time-axis definition. The editor fetches the snapshot with its bearer
credential and gives the isolated preview a temporary blob URL, never a token.

Collection POST generates the top-level record ID when omitted. Initial records supplied when creating a dataset, and all nested activities, must include their own stable IDs. Legacy source dates without an explicit timezone are normalized to UTC by the API; use explicit offsets when importing timestamps to avoid browser-local timezone ambiguity.

## Querying time and records

Event/session collections accept `from`, `to`, `search`, `namespace`, `kind`, `filterId`, `offset`, and `limit`. Time bounds are inclusive and return records that overlap the interval. Results sort by start along the time axis, then stable ID. Default limit is 100; maximum is 1000. Responses contain `items`, `total`, `offset`, `limit`, `nextOffset`, and `timeAxis`.

- Calendar examples: `/api/v1/datasets/monet/events?from=1840&to=1900&limit=50`
- Numeric units: `/api/v1/datasets/dinausaurs/events?from=165&to=115` uses Ma directly. Values decrease as time advances; they are not synthetic epoch timestamps.
- BCE: `/api/v1/datasets/religions/events?from=-000499-01-01T00:00:00Z&to=0001-01-01T00:00:00Z`
- A filter is `{"id":"paintings","title":"Paintings","query":{"search":"painting","kind":"session"}}`. Use `filterId=paintings`; explicit query fields override saved fields.

Anonymous list responses contain only bundled examples. Authenticated lists include only managed datasets the caller may read. Storage capabilities and effective model permissions are separate fields. Read-only examples reject writes with 405; they are never silently modified. Personal filters are visible to their creator and model administrators; shared filters are visible to authorized model readers. Saved `sortBy` metadata does not change the API's established time/ID query order.

## Revisions and error handling

### Configuration documents

The [Model and YAML editor](model-editor.md) uses `/config-files` for system administrators and `/models/{id}/config-files` for model administrators. These documents
are independent of datasets; deleting a configuration document never deletes
events or sessions. All operations, including reads, require administrator access.
Global documents are real files in `<API data directory>/config-files`; scoped documents use isolated `config-files-models/<modelId>` directories. Register
existing directories explicitly with `OPENBEXI_CONFIG_ROOTS` (platform path
separator) or `openbexi.api.configRoots`. Directory roots must not overlap.

POST and PUT accept `{name, kind, text}` where `kind` is `model` or `yaml` and
`name` is a simple filename. Documents return `id`, `name`, `kind`, `text`,
`location`, `writable` and `restartRequired`; collection items omit `text`.
Use the response `ETag` as `If-Match` for PUT/DELETE. Renaming requires unchanged
content and returns a new ID. Save content edits before renaming.

Model syntax/schema validation and YAML safe parsing happen before atomic writes.
YAML containing `params` and `bands` is validated as a timeline model with the
same demo or legacy schema as JSON. Save it with `kind: "yaml"` and a `.yaml` or
`.yml` filename; its original text, including comments, is retained verbatim.
YAML comments and unknown keys are preserved because the original validated text
is saved. Known source structures, duplicate keys and unsafe tags are checked.
Reference conflicts block rename/delete with 409. Server YAML changes require a
restart. The ordinary public configuration endpoint continues to expose only model
and data URLs, and public asset serving continues to block deployment YAML.

### Dataset revisions

Read a dataset, model, collection, or record and retain its `ETag` response header. Every edit to existing data, including a POST into an existing collection, requires that exact value as `If-Match`. Missing preconditions return 428; a stale version returns 412. Fetch again and reconcile the edit. One whole-dataset revision covers metadata, model, events, and filters, so concurrent writes cannot overwrite one another unnoticed. `If-None-Match` supports conditional GET/HEAD.

Writes are validated before persistence and serialized using process and filesystem locks. Atomic file replacement prevents partially written JSON. This is a single-host repository, not a distributed database; use a local filesystem with atomic rename and locking. Back up the managed-data directory. Request bodies are limited to 2 MiB. Record queries are paginated, but complete datasets are currently read in memory and the administrator preview returns a complete snapshot.

Access grants and workspace entitlements have separate ETags. Saved configuration history uses content hashes. The editor opens historical versions as local copies; saving that copy creates a separate scoped document. Replacing the active model through `/models/{id}` requires its current dataset ETag. A history write failure is reported in `X-OpenBEXI-History-Warning` without undoing a successful model save. Deleted dataset IDs remain reserved so old grants and documents cannot attach to a new dataset.

Errors use `application/problem+json` with `type`, `title`, `status`, `detail`, and `instance`. Common codes are 400 (malformed request), 401/403 (authentication/role), 404 (missing record), 409 (duplicate ID or incompatible axis), 415 (content type), and 422 (validation). A failed edit leaves the previous file intact.

## Documentation and checks

The [offline API reference](api.html) reads the checked-in [OpenAPI contract](../swagger/openapi-v1.json). Help's Live API button activates when the same-origin Java API health check succeeds; static-only demo hosting keeps it disabled.

Run `npm run api:spec -- --check`, `mvn verify`, and `npm run test:demos`. Java HTTP tests start an ephemeral local Tomcat with temporary storage and exercise catalog parsing, numeric/BCE dates, permissions, CRUD, persistence, model validation, stale writes, concurrent edits, and problem responses. Browser screenshot tests cover the existing demo UI independently.
