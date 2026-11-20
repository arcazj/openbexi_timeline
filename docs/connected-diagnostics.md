# Connected startup and request diagnostics

The Python server uses standard Python logging. Timeline requests report INFO
summaries, WARNING for invalid requests or incomplete coverage, and ERROR for
server failures. Public examples here contain synthetic values.

## Launch URL

Start the workspace server with:

```sh
python -m openbexi_timeline_server --workspace HBDS/workspace.json
```

The service YAML selects connector IDs, hosts, ports and transports. The public
workspace includes HTTP listeners on ports 8080 and 8783, both served by Python.
For example, open `http://127.0.0.1:8783/openbexi_timeline.html`. The startup log
prints `Web UI ready:` followed by the listener URL. Secure listeners support PEM
certificate/key settings and existing JKS/PKCS12 keystores, or a trusted TLS reverse
proxy. See the [TLS storage details](security.md#deployment).

The page discovers model and data routes through `/openbexi_timeline/config`.
Absolute source paths stay on the server. Historical connector IDs are retained
for workspace compatibility; the current owner is Python.

## What the UI sends

| Operation | Method and route | Important parameters |
| --- | --- | --- |
| Restore settings/filters | POST `/openbexi_timeline/sessions` | `ob_request=readFilters`, existing user/timeline identifiers |
| Select/save a filter | POST same route | `ob_request=updateFilter`/`saveFilter`, legacy filter expression and `sortBy` |
| Load visible/context records | GET same route | `matchProtocol=1`, `progressive=1`, `startDate`, `endDate`, `search`, `filter` |
| Next batch | GET same route | Same query/window plus returned `cursor` |
| Cancel continuation | GET same route | Same query/window/cursor plus `cancel=1` |
| Conditional refresh | GET same route | Same query/window plus `If-None-Match`; unchanged completed windows return `304` |
| Descriptor | POST same route | `ob_request=readDescriptor` and record identity |
| SSE listener | GET `/openbexi_timeline_sse/sessions` | `Accept: application/json` for finite batches; `live=1` with `text/event-stream` for revision notifications |
| Managed API data/models | `/api/v1/...` | See the [REST API guide](rest-api.md) and [OpenAPI](../swagger/openapi-v1.json) for authentication and CRUD |

The browser uses real instants from its first connected frame; UTC display
formatting never shifts request timestamps. The initial response is rendered
before complete archive coverage. After a useful first batch (or four empty
batches), both adjacent buffers receive a page before current continuations.
Later pages alternate among the three intervals. There is one active data fetch,
at most four aligned retained windows, cancellation and stale-response guards.
See [loader and scan limits](progressive-loading.md).

REST stays idle after those finite loads. Navigation conditionally checks expired
visible cache entries; **Refresh** checks all retained windows. SSE maintains one
subscription, resumes with `Last-Event-ID`, and reloads changed windows while
preserving the selected record and time span. Heartbeats do not trigger data reads.

The UI attaches a random `loadId` to each logical load and a `purpose` of
`initial`, `visible`, `past-prefetch`, `future-prefetch`, `refresh`, or `retry`.
Overview zoom is a local projection of loaded records; it issues no request.
Overview click/drag deliberately navigates the main view and can cause a load.
Unspecified purposes in other clients remain unspecified in logs.

Example (URL-encode values when constructing a request):

```http
GET /openbexi_timeline/sessions?matchProtocol=1&progressive=1&startDate=2026-09-12T12%3A00%3A00Z&endDate=2026-09-12T13%3A00%3A00Z&loadId=sample-load&purpose=initial
Accept: application/json
```

An abbreviated response can contain:

```json
{
  "events": [],
  "timelineMatch": {
    "version": 1, "progressive": true, "query": "", "hasCondition": false,
    "revision": "sample-revision", "provider": "json_file",
    "domain": {"from": "2026-09-12T12:00:00Z", "to": "2026-09-12T13:00:00Z"},
    "batch": 0, "complete": false, "nextCursor": "opaque-continuation",
    "recordsExamined": 256, "recordsExcluded": 256, "recordsReturned": 0,
    "uniqueSessions": 0, "uniqueEvents": 0, "cache": "miss", "warnings": []
  }
}
```

This is **loading**, not a confirmed empty interval: more batches remain. A
missing source or bounded scan can leave `complete=false` with warnings even
after the final cursor. `availableRange`, when present, describes an observed
source interval, not guaranteed filtered coverage. The UI offers explicit
navigation there; it never silently replaces a configured date. Retry preserves
the coherent displayed view. Local JSON continues to work without the server.

## Reading logs

Responses carry `X-Request-ID` and `X-Timeline-Server`. Match the request ID from
the browser Network panel with the server's `timeline-response` line. The Python
server logs bounded summaries for session requests and HTTP failures. A typical
line includes:

```text
INFO: timeline-response [sample-request] HTTP 200 method=GET outcome=partial reason=none server processing=24 ms; returned=20 examined=256 complete=False more=True warnings=0 warning_codes=none operation=records error_type=none location=n/a
```

`returned` and `examined` count top-level scan records. `complete=False` or
`more=True` indicates unfinished coverage. Check `timelineMatch.warningDetails`
for source numbers, relative filenames and suggested fixes. The summary reports
warning codes without record contents, raw queries, credentials or source paths.
Failures report a safe error type and code location instead of private data.

The response's `uniqueSessions` and `uniqueEvents` count nested identities once per
scan; they are not sums across windows or retries. A session has activities or
`data.kind=session`; zones do not count. API v1 also treats records with `end` as
sessions, following its established query contract. Overlapping windows can
contain the same records, so do not add their totals.

In **Settings > Trace level**, choose INFO, WARNING or ERROR. The preference is
saved locally and sent as `traceLevel` on timeline requests. It controls that
request's diagnostics and browser console messages without reloading records or
discarding the cache. A live subscription reconnects once to apply a change.
The service's `server.log_level` supplies its default threshold. Successful
requests use INFO, client errors and coverage warnings use WARNING, and unexpected
failures use ERROR. Keep detailed runtime logs local.

Browser `timeline-client` entries report the response request ID, snapshot counts,
request latency and client build time. These describe scene construction, not a
guaranteed screen-paint time. `timeline.ob_last_population` exposes those timings
for local measurement. Counts may differ from one batch after the browser merges
windows and nested identities. The browser's `loadId` and `purpose` remain useful
for comparing requests in the Network panel.

### Descriptor requests and errors

Descriptors use a separate POST request with `event_id`, `start` and the record's
namespace. ISO and legacy timestamps are accepted by both session routes.
The response is an `event_descriptor` array retaining nested metadata, complete
history, supported formatting and links. Details do not replace or cancel the
timeline's data request. The panel shows the summary while loading and keeps it
on error, with a separate **Retry details** action.

Missing descriptors return HTTP 404 with `descriptorStatus: "not_found"`; invalid
identity/dates return 400 and malformed descriptor files return 500, each with a
JSON body. Empty, truncated or malformed JSON is a request failure even under
HTTP 200. The UI retains valid records and reports the operation and request ID.

## Startup and filtering

For explicit HTML models, inspect the public configuration response first: its
`data` route must match the listener. An SSE listener advertises
`/openbexi_timeline_sse/sessions`; sending startup POST requests to the REST route
on that listener used to return HTTP 405. Settings now use finite JSON requests.
The live subscription starts with initial data loading and keeps the active range,
filter, user and timeline parameters.

If the Status report says **A configured source is unavailable**, the file scan
could not resolve an enabled source's root path. Check the source YAML
actually used to start the server: each enabled `json_file` source's `data_model`
root must exist and be accessible to the server process. Restore the path, mount
or permissions, or set `enable: false` for a source that should not be used, then
restart the service with that configuration. Displayed records from other sources
do not prove that every enabled source is available. This warning keeps coverage
partial even after all accessible files finish loading.

Click **Status: Partial data** to open **Source diagnostics**. Each reported issue
identifies the source namespace and its one-based position in the startup YAML's
`data_sources` list, including disabled entries in that numbering. File and
directory issues also show a path relative to the configured source root, a
reason and a suggested fix. For a source configured as a single file, the report
shows its filename. Missing roots are identified by source number and namespace;
use that entry's `data_model` in the server YAML to check the full path.

The server returns these entries in `timelineMatch.warningDetails` alongside the
existing summary `warnings`. Reasons distinguish missing paths, access denial,
invalid JSON (with a character position), oversized records and missing top-level
`events` arrays. Scan-limit details name the threshold reached and show the
examined file, record and decoded-character counts for the whole interval.
Absolute server paths and raw exception messages or record contents are omitted.
Each scan retains up to 100 distinct details and reports when further details
are omitted. Repeated details across loaded intervals appear once in the UI.
Older servers continue to show their summary warnings without source details.

After repairing files, click **Refresh**. Restart the Python service first if you
changed its startup YAML. The refreshed report drops resolved issues; Ready
still requires complete coverage without warnings in the visible interval.

**Visible scan limit reached** and **Neighbor loading paused at the scan limit**
describe page-budget stops. They are distinct from **Loaded-data limit reached**,
which means retained records or payloads exceeded the cache budget. File scans
that report per-page work have a larger finite page allowance so startup can
populate past context before a drag; see [the limits](progressive-loading.md#bounds-and-compatibility).

Connection failures and empty intervals appear in Status on the secondary menu
bar. Loading, searching and incomplete coverage are orange; completed work is
green, failures are red and cancelled work is gray. Click Status to open its
report and click again to close it, matching Timeline details. Record transfers
use source rules and the active saved filter before serialization; see
[filter syntax](filter-syntax.md). SSE revision messages contain no event payloads.

Compare performance with the same model, time range, saved filter, source data,
browser and server runtime. Measure both first response and first rendered
records, plus request counts. Separate cold startup from warmed caches; keep
operational captures and logs in ignored local storage.
