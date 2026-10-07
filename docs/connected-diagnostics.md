# Connected startup and request diagnostics

The embedded timeline server and API v1 share response diagnostics. Java uses
`java.util.logging`: INFO summaries, WARNING for failed requests, FINE for extra
transport/warning-count detail. Configure levels through normal JVM logging
properties. Public examples below contain synthetic values.

## Launch URL

The existing source `connector` supplies the listening ports and transport:

```yaml
data_sources:
  - namespace: sample
    type: json_file
    enable: true
    connector: "secure_sse:8441|secure:8442"
    data_model: /data/sample/yyyy/mm/dd
```

Open the desired HTML page on the chosen listener, for example
`https://localhost:8442/openbexi_timeline_earthquake.html` for REST or the same
page on port 8441 for live updates. HTTPS requires the deployment's configured
certificate. The page discovers its model and data route through
`/openbexi_timeline/config`; absolute source root paths remain on the server.

No `web_ui` section is required. Older deployments may still use that optional
section for a context path or a printed launch URL. It does not create listeners.
When it is absent, use the connector's port and the desired page directly.

Illustrative local output after successful startup:

```text
Timeline service ready: scheme=https port=8442 context= route=/openbexi_timeline/sessions
```

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

Every response has `X-Request-ID`. Look for the same `requestId` in a `timeline`
log entry, then use `loadId` to follow its visible and prefetch pages. For example,
the summary includes these fields (other fields are omitted here for readability):

```json
{"requestId":"sample-request","loadId":"sample-load","method":"GET","route":"/openbexi_timeline/sessions","operation":"records","purpose":"initial","provider":"json_file","status":200,"outcome":"loading","sessionsReturned":2,"eventsReturned":18,"batch":0,"more":true,"complete":false,"elapsedMs":24}
```

Sessions have an `activities` array or `data.kind=session`; other eligible
records count as events, including nested activities. Zones do not count. Identity
includes namespace and parent ancestry. Session containers and their children
are counted separately, once each. `recordsExamined`, `recordsExcluded` and
`recordsReturned` count **top-level scan records**; exclusions include out-of-range,
invalid and filtered records. `uniqueSessions`/`uniqueEvents` are cumulative for
one scan cursor, not sums across windows or retries. Replay repeats a batch with
`cache=replay` and unchanged unique totals. Do not add overlapping window totals.

Unknown counts and coverage use `unknown`, especially for unsupported providers
and control responses. Logical error envelopes are logged as failures even with
HTTP 200. API v1 collection semantics are documented separately; unsupported
response-count shapes remain unknown. API v1 also classifies a record with an
`end` as a session, matching its existing query contract; the legacy UI treats
a flat duration without session metadata as an event. Live SSE logs describe individual snapshots,
never an accumulated rendered count, and are limited to one summary per five
seconds after the first snapshot. Finite requests emit one bounded summary each.
No extra archive scan is performed for diagnostics. Structured summaries omit raw
filters, grouping field names, record contents, credentials and source paths.

### Readable request and response lines

The default `-Dopenbexi.timeline.logFormat=both` writes readable request/response
lines alongside structured summaries. Choose `readable` or `json` to use only one
format; normal `java.util.logging` levels control verbosity. Each request line
contains its actual URL, with private query values redacted by default. For local
troubleshooting, `-Dopenbexi.timeline.logQueryValues=true` includes allowlisted
filter, grouping and record identifiers. Credentials, cookies, authorization
headers and cursor tokens are never included. Keep detailed runtime logs local.

Illustrative synthetic output:

```text
timeline-request [sample-request] GET http://localhost:8123/openbexi_timeline/sessions?startDate=2026-09-12T12%3A00%3A00Z&endDate=2026-09-12T13%3A00%3A00Z&markerDate=2026-09-12T12%3A30%3A00Z&scene=0&loadId=%5Bredacted%5D&purpose=initial
timeline-response [sample-request] Response OK! HTTP 200 operation=records outcome=loading server processing=24 ms loadId=sample-load scene=0 purpose=initial; returned 2 session(s), 18 event(s); batch=0 examined=256 excluded=236 cumulative sessions=2 events=18 complete=false more=true cache=miss coverage warnings=0; date min=2026-09-12T12:00:00Z; date marker=2026-09-12T12:30:00Z; date max=2026-09-12T13:00:00Z
```

The marker comes from the client's `markerDate`; clients that omit it report
`unknown`. Browser `timeline-client` lines use the response's request ID and
report loaded snapshot counts, request latency and client build time separately
from server processing. They describe completion of scene construction, not a
guaranteed screen-paint time. `timeline.ob_last_population` exposes these timings
for local measurement. Counts can differ from a single batch because the client
merges overlapping windows and nested identities.

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

After repairing files, click **Refresh**. Restart the Java service first if you
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
