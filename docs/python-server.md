# Python timeline server ? 2.9.7

The Python server serves the browser UI, timeline queries, HBDS editing and the complete API v1. It indexes timeline JSON in SQLite and implements model/dataset administration, users, groups, permissions, entitlements, configuration files, model history and optional AI assistance in Python.

## Install and run

From the repository root, using Python 3.12 or later and Node.js 24:

```powershell
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.lock
.venv/Scripts/python.exe -m pip install --no-deps -e .
npm ci
./tools/start-python-server.ps1 -Check
./tools/start-python-server.ps1 -IndexFirst
```

The launcher defaults to the public demo `HBDS/workspace.json`. Select another timeline with `-Workspace HBDS/GEO_Workspace.json` (PowerShell) or `--workspace HBDS/GEO_Workspace.json` (module). Listener addresses come from the workspace's `service` file. Public demo/GEO workspaces use `HBDS/service.yml`; the generic Python listener is `http://127.0.0.1:8783/openbexi_timeline.html`. `/demos.html` provides local demonstration datasets. On Linux/macOS, use `python3 -m venv .venv`, `.venv/bin/python` and the module command below.

When a workspace or startup YAML model is configured, opening `/` also loads that timeline. Without either, `/` opens the demo gallery. Each workspace listener prints `Web UI ready: <URL>` after it starts; open that link in your browser. The link uses the actual listener port, HTTP/HTTPS scheme and configured context path. Legacy single-listener launches print the configuration details and browser URL before startup.

Windows convenience launcher:

```powershell
.venv/Scripts/python.exe -m openbexi_timeline_server --workspace HBDS/workspace.json --check
.venv/Scripts/python.exe -m openbexi_timeline_server --workspace HBDS/workspace.json

# Explicit namespace files are also supported, independently of a local workspace.
./tools/start-python-server.ps1 -DataConf HBDS/yaml/DEMO_default.yml -ServerConf HBDS/service.yml -IndexFirst
```

`--index-once` prepares or updates the saved index before accepting UI traffic. Without it, the server immediately accepts requests, publishes records as source files become available, and reports partial coverage until initial indexing finishes. The UI honors increasing retry delays up to two seconds. A completed empty window has no continuation cursor and stops loading.

Queries wait at most 250 ms for the index writer. Temporary SQLite contention
returns an incomplete page with `reason=index_busy`, a continuation token and a
500 ms retry hint; the UI retries automatically without advancing or losing the
current page. These waiting responses are not cached. Retired index records are
removed in small background transactions, never during a timeline query, while
current records and snapshots pinned by active cursors are preserved. Unexpected
server failures log the request ID, exception class, SQLite error code name and
code location without including request or record contents.

Forward pages use a covering index for the cursor's pinned file versions, so
retired versions do not consume the query budget on every continuation. Restart
the server to add this index to an existing database. Response logs include
warning codes (for example, `scan_limit`), the operation, and validation locations
for rejected requests. On Windows, a peer reset during Proactor socket shutdown
finishes socket cleanup and logs at DEBUG; unrelated exceptions remain visible.

New queries also select overlapping files from their current versions through
that covering index. Broad backward-history searches no longer traverse retired
records in the global interval index while creating their first cursor. This
avoids first-page timeouts during frequent collector updates; existing cursors
still retain the file versions they originally selected. Apply this query fix
by restarting the Python timeline server; no target deletion or collector reset
is needed.

Workspace and legacy launches both enable application logging. Completed sessions
requests print `timeline-response ... HTTP 200 method=GET` (or `method=POST`),
with the request ID, operation and processing time. Request URLs, search text and
record contents are omitted. `server.log_level` and the browser's `traceLevel`
still control which responses appear; use `INFO` to see successful requests.
Restart the Python timeline server after changing its logging code.

An index records its owning workspace. After that workspace's data paths change, restarting rebuilds the derived index automatically. A state directory owned by another workspace is rejected. For indexes created before workspace ownership was recorded, stop the server and archive the old state directory before restarting with changed paths.

The generic example does not include operational data. Populate its `target_path` directories through the collector/import workflow, or point a private namespace configuration at existing timeline JSON files. Missing sources produce explicit coverage warnings.

## Configuration

HBDS is the configuration reference for the server and collector. Each namespace has a file named `<namespace>_<model_name>.yml` under `HBDS/yaml`, with a model under `HBDS/models`. Input/output paths resolve relative to the namespace YAML; workspace references resolve relative to the selected workspace file. Editor tab and alias changes stay within that workspace, and each workspace has its own default Python index directory. `/yyyy/mm/dd` partitions are discovered recursively, including older partitions containing sessions that overlap the visible window. `${NAME}` substitution applies to source paths and the state directory; a missing required variable is a configuration error.

```yaml
# HBDS/yaml/DEMO_default.yml
config_version: 2
namespace: DEMO
model: models/default.json
enable: true
target_path: ../../.local-private/events/DEMO/yyyy/mm/dd
connectors: [python_api]
sources:
  - id: incoming
    source_path: ../../examples/DEMO/input
    source_plugin: local
    converter_plugin: timeline_json
```

Listener definitions and shared `server`/`timeline_server` settings live in the service YAML. `server.poll_seconds`, `settle_seconds`, `verify_seconds` and `log_level` are accepted as defaults; `timeline_server` overrides them. Collector `local`, `sftp`, `s3` and `oracle` sources are read from their materialized `target_path` outputs. This service does not import remote data or connect to those systems. Their input filters and credentials remain the collector's responsibility. For `json_file` sources, scalar filters retain legacy/typed record-filter semantics; list filters select output filenames using globs. Neither source credentials nor deployment paths are exposed in startup settings.

Legacy combined YAML and `data_model`/`data_path` aliases remain supported for existing integrations. New deployments use the [namespace and service formats](../HBDS/README.md). A native namespace configuration starts every enabled Python listener referenced by an enabled namespace, sharing one application and index; it currently requires `--workers 1`. TLS is configured per listener in the service file.

Use `--workers 2` with a legacy single-listener configuration to run multiple processes sharing one **local** state directory. SQLite WAL, atomic file versions, a single indexer lease and persisted cursor snapshots coordinate them. Use a separate state directory for each source configuration; incompatible reuse is rejected. Keep the state directory across restarts. It is a rebuildable cache: original source JSON remains authoritative. After a machine power failure, a recently issued cursor can require the UI's bounded retry. WAL NORMAL avoids flushing the disk for every indexed file. Do not share the SQLite directory over a network filesystem.

Default limits are 10,000 source files, 64 MiB per source file, 2 MiB per record, 100,000 records examined per query, 15 seconds of query processing, 256 top-level records per page and a 512 KiB page target. A single permitted large record may exceed the page target. These are configurable through `max_files`, `max_file_bytes`, `max_record_bytes`, `max_records`, `max_query_seconds` and `page_size`. Partial or malformed files retain their readable prefix with warnings. Files changing during a read keep the previous snapshot and are retried. Changed/deleted files update the next scan; unchanged metadata is periodically checked by content hash.

Historical search shares the configured `max_records` and `max_query_seconds` limits. An archive larger than the default 100,000 examined records may need higher limits to search its full history; a `scan_limit` warning means older matches can remain unread. History pages use a chronological index so each page continues from the previous timestamp and record identity.

Text searches use literal, case-insensitive matching, consistent with the browser.
Simple legacy filter terms also use direct text matching; large descriptions do
not subject these literal checks to the regex timeout. Actual regular expressions
retain their processing limit. A failed loading interval is marked `error` in the
status report, keeps already loaded records, and can be resumed with Retry.

## Routes and compatibility

| Route / operation | Python behavior |
| --- | --- |
| `/openbexi_timeline/sessions` | Finite JSON, progressive queries, filters, search annotations, history, replay, cancellation and conditional requests |
| `/openbexi_timeline_sse/sessions` | Same JSON contract; `GET ?live=1` with `Accept: text/event-stream` selects revision notifications |
| `POST .../sessions?ob_request=readFilters/updateFilter/addFilter/saveFilter/deleteFilter` | Existing saved-filter JSON format and atomic writes |
| `POST .../sessions?ob_request=readDescriptor` | Partitioned descriptor lookup scoped to event identity and namespace; 404 for absent descriptors |
| `POST .../sessions?ob_request=addEvent` | Atomic valid JSON in enabled directory sources, followed by an index refresh |
| `/openbexi_timeline/config` | Public model/data route and backend implementation/version |
| `/health`, `/ready` | Index counts/readiness without private source paths; `/ready` is 503 during initial indexing |
| `/api/v1/hbds` | Automatic same-origin local editor access; other clients require administrator authentication. Revision-checked saves; no Java bridge required |
| Other `/api/v1/...` routes | Native Python administration with scoped authentication, ETags, history, configuration CRUD and optional AI |
| Public UI assets | Explicit public-asset allowlist; source data, deployment YAML, state and hidden files are not served |

Startup advertises the SSE route so the existing UI uses one live revision subscription alongside finite JSON reads. The REST route supports explicit refresh. Responses include `X-Request-ID`, `X-Timeline-Revision` and `X-Timeline-Server: Python/2.9.7`. Settings displays the UI version and connected backend version separately.

The modern UI's `matchProtocol=1` contract is the compatibility target. Full sessions are filtered before nested activities are scoped to the time window. Search annotates visible records; it does not silently discard nonmatching records. History queries return matching records. Original source styling and external IDs are preserved, while source occurrence keys distinguish repeated IDs. Dates are normalized to UTC, including extended years and BCE dates. Byte-for-byte key ordering, cursor tokens, revision hashes and diagnostic timings differ by backend.

Intentional differences from legacy quirks: missing/invalid time ranges return 400 rather than synthetic demo events; event creation writes valid escaped JSON and correct source namespaces rather than reproducing the old writer's trailing commas; operational file/index failures are reported without private paths. Python's bounded `regex` engine supports the tested legacy patterns and Java `\Q...\E` literals, but arbitrary Java-specific regular expressions need validation before migration. Custom clients use `matchProtocol=1` for annotated search and stable activity identity.

Legacy descriptor reads accept json-simple's optional separators and literal control characters while preserving string contents. Source event streams retry literal control characters using a bounded streaming reader without duplicating an already returned prefix. Truncated documents and other unsupported syntax continue to report partial coverage or descriptor errors; source files are never rewritten by these readers.

Partitioned collector publications include optional descriptor ID lists for each
immutable part, including nested activities. A descriptor request reads and
checksum-verifies the matching part instead of decoding the entire namespace.
Older publications and missing or inconsistent hints fall back to a verified
scan. The collector adds hints at its next publication, without rewriting
unchanged event parts or forcing a timeline reindex.
Hints are omitted if they would exceed the publication index's byte budget.

Backward history pages merge chronological streams from the cursor's pinned file
versions. Obsolete versions retained for other readers are not scanned. The
covering index is created automatically at server startup; its first creation
can take longer on a large existing database. Filters, equal-timestamp ordering,
cursor replay and coverage warnings retain the same behavior.

## Administration, HTTPS and upgrading

Run the complete API without a timeline workspace with:

```powershell
.venv/Scripts/python.exe -m openbexi_timeline_server --api-only --root . --data-directory .local-private/api-data --host 127.0.0.1 --port 8781
```

Existing API token and role configuration remains supported. Use the [REST API
guide](rest-api.md) and [AI setup guide](ai-assistance.md) for configuration.
AI proposals remain drafts until explicitly applied through the editor.
AI assistance requires `--workers 1` so in-flight cancellation and request quotas
share one server process. Multiple workers remain supported when AI is disabled.

For HTTPS, supply `--ssl-certfile` and `--ssl-keyfile`, configure a PEM certificate
and key in the service file, or terminate TLS at your existing reverse proxy.
Legacy saved-filter identities are profile names; administration uses its scoped
authentication and permission checks.

The 2.9.7 Windows installer bundles Python and upgrades the application while
preserving the user data directory. Existing workspace paths and saved records
remain authoritative. Keep a local backup of the previous installation and data
for rollback to the retained 2.9.6 release. Do not delete source records or
collector checkpoints during an upgrade.

## Validation and performance

```powershell
.venv/Scripts/python.exe -m unittest discover -s tests/python -v
node tests/integration/python-backend.mjs
npm run test:integration
npm run test:hbds:integration
.venv/Scripts/python.exe tools/benchmark-python-server.py --files 1000 --records 100 --repeats 20
```

The benchmark uses isolated synthetic data, validates query results, measures
HTTP latency and decoded bytes, and restarts the Python server against its saved
index. It leaves operational data and running services untouched. Its cold run
starts with a fresh application index; it does not flush the operating-system
file cache. Browser rendering is covered by the separate browser regressions.

See the [2.9.7 release validation](release-2.9.7-regressions.json) for completed
checks and recorded limitations.
