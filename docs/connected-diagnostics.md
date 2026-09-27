# Connected startup and request diagnostics

The embedded timeline server and API v1 share response diagnostics. Java uses
`java.util.logging`: INFO summaries, WARNING for failed requests, FINE for extra
transport/warning-count detail. Configure levels through normal JVM logging
properties. Public examples below contain synthetic values.

## Launch URL

Keep deployment addresses in the local source YAML, alongside `data_sources`:

```yaml
web_ui:
  entry_page: demos.html
  port: 8123
  host: localhost
  context_path: /viewer
# data_sources: your existing configured providers
```

`port` selects the connector serving the page; it does not create a listener.
The connector must also exist in the source configuration. `context_path`
mounts the embedded application there. HTTP/HTTPS comes from that connector,
and the ready URL uses its actual bound port. The exact configured filename is
preserved, including `.htm` versus `.html`. Without an entry page the server
prints configuration guidance instead of guessing a URL.

For a reverse proxy or separate UI service, set `external_base_url` to the
browser-facing base (for example `https://example.test/viewer/`). The configured
entry page is resolved against it. The server verifies its own listener's
readiness; it cannot verify an external proxy's health. With multiple listeners,
set `port` so the UI URL is announced only by its designated connector.

Illustrative local output after successful startup:

```text
Timeline service ready: scheme=http port=8123 context=/viewer route=/openbexi_timeline/sessions
Web UI ready: http://localhost:8123/viewer/demos.html
```

## What the UI sends

| Operation | Method and route | Important parameters |
| --- | --- | --- |
| Restore settings/filters | POST `/openbexi_timeline/sessions` | `ob_request=readFilters`, existing user/timeline identifiers |
| Select/save a filter | POST same route | `ob_request=updateFilter`/`saveFilter`, legacy filter expression and `sortBy` |
| Load visible/context records | GET same route | `matchProtocol=1`, `progressive=1`, `startDate`, `endDate`, `search`, `filter` |
| Next batch | GET same route | Same query/window plus returned `cursor` |
| Cancel continuation | GET same route | Same query/window/cursor plus `cancel=1` |
| Descriptor | POST same route | `ob_request=readDescriptor` and record identity |
| SSE listener | `/openbexi_timeline_sse/sessions` | GET controls or data; `Accept: application/json` for finite batches, `text/event-stream` for legacy live snapshots |
| Managed API data/models | `/api/v1/...` | See the [REST API guide](rest-api.md) and [OpenAPI](../swagger/openapi-v1.json) for authentication and CRUD |

The browser uses real instants from its first connected frame; UTC display
formatting never shifts request timestamps. The initial response is rendered
before complete archive coverage. After a useful first batch (or four empty
batches), both adjacent buffers receive a page before current continuations.
Later pages alternate among the three intervals. There is one active data fetch,
at most four aligned retained windows, cancellation and stale-response guards.
See [loader and scan limits](progressive-loading.md).

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
