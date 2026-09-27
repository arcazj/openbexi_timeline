# Progressive loading and standalone startup

The timeline builds its frame before requesting records. Models with a local
`dataSource` or a JSON file in `params[0].data` load that file directly, without
contacting the Java data service. Serve those files over HTTP as usual; browser
restrictions still apply to `file:` URLs.

For connected timelines, the client requests the visible interval first. After
useful current records arrive (or four empty pages), both neighboring intervals
get an early batch. Further pages alternate among current, past and future work.
The default buffer extends one visible span beyond each edge. Aligned windows
reuse overlapping pages and cursors during dragging; the direction of movement
gets priority when new buffer coverage is needed. Completed adjacent windows can
jointly cover a new visible range. Background
loading leaves navigation, grouping, and the current records available. Cancel
stops the current load; Retry reconnects while retaining the view. Changing the
query cancels superseded work and rejects late responses. Navigation cancels only
scans outside the retained buffer and schedules replenishment every 16–80 ms while
moving. Cached records enter the view before release without rebuilding the scene.
Measured request latency and movement speed guide replenishment and direction
priority. If data density fills the cache budget, neighboring scans pause with a
partial-coverage warning; visible work can evict distant buffers first. Moving
into a paused interval resumes it as visible work. A visible interval that exceeds
the budget still requires a narrower time range.
Loading failures have a red **Update failed — open details** control. Click it or
press Enter to inspect the error. Retry or navigate to another interval to resume;
an explicit Cancel stays cancelled until Retry. Calendar month arrows only browse
the calendar; choosing a day moves the timeline and requests that interval first.
Counts and Overview describe loaded records and identify partial coverage.
Overview has its own linear zoom span; its context follows the main interval to
keep the visible-window indicator centered. Zooming Overview does not change the
main range or analysis scope. See [request and diagnostic examples](connected-diagnostics.md).

## File-provider protocol

The `json_file` provider accepts `matchProtocol=1&progressive=1` on the existing
sessions endpoint. `startDate`, `endDate`, `search`, and legacy filter parameters
retain their meanings. The response includes `events` and the existing
`timelineMatch` metadata, with these additional fields:

| Field | Meaning |
| --- | --- |
| `progressive` | `true` for a resumable response |
| `nextCursor` | Opaque continuation token, or `null` when scanning has ended |
| `batch` | Zero-based page sequence |
| `recordsExamined` | Top-level source records examined for this page |
| `charactersRead` | Decoded source characters read for this page |
| `elapsedMillis` | Time spent processing this page, excluding HTTP overhead |
| `warnings` | Reasons that coverage is incomplete |
| `recordsReturned` / `recordsExcluded` | Top-level page records retained/excluded by date, validation and legacy filtering |
| `uniqueSessions` / `uniqueEvents` | Cumulative unique nested-aware counts for this cursor, not across windows |
| `cache` | `miss` or `replay`; replay does not increase unique totals |
| `availableRange` | Optional observed source interval; filters and completeness are not implied |
| `cancelled` | `true` on an acknowledged cursor cancellation |

Send the same request with `cursor=<nextCursor>` for the next page. Keep its source,
user, timeline, filter, query, and interval unchanged. Repeating the immediately
previous cursor returns its cached response. `cancel=1` with the cursor releases
the scan. Expired or mismatched cursors return an actionable retry error.

The parser resumes inside the file rather than reading the whole file before
splitting it. Date partitions for the requested interval are visited first. Older
partitions are then scanned incrementally because they may contain long sessions
that overlap the interval. Without a source index, proving complete coverage can
still require visiting the archive. An empty early page is not proof of no data.

## Bounds and compatibility

- A page yields after 256 top-level records, 512 directory entries, 512 Ki decoded
  characters, or a 50 ms cooperative processing target. Checks happen between work
  units, so these are not hard HTTP latency guarantees. A single record is capped
  at 2 Mi decoded characters; the final record can exceed the page character target.
- A scan stops at 64 Mi decoded characters, 10,000 files, or 100,000 top-level
  records. Directory and nested-record depth is limited to 32. Limits and skipped
  malformed records produce partial-coverage warnings.
- The server keeps at most eight cursor sessions. Idle sessions expire after
  90 seconds, with periodic cleanup. Completed cursors are evicted before active
  ones, then the least recently used cursor is selected. Pages are serialized through the cursor
  registry. Deployment concurrency tuning is separate from this default.
- The client retains at most four aligned windows (three visible spans can cross
  four fixed boundaries), 15,000 top-level records, 50,000 total
  records including activities, and 8 Mi JSON payload characters. It limits each
  interval scan to 512 pages, uses a 15-second timeout per connected request, and yields between
  batches so input and rendering can run. The bounds count characters, not heap
  bytes or compressed network bytes.
  Background intervals pause at the scan limit, leaving visible work available.
  An expired cursor restarts once with loaded records retained; repeated failures
  show an explicit error instead of silently retrying forever.
- Connected views refresh every 30 seconds after loading. Existing single-response
  providers remain compatible, but do not gain server paging automatically.
  Set `timeline.progressiveLoading = false` before initialization to retain the
  previous foreground/SSE loading path when an integration requires it.
- Static local datasets still load as one file. Their UI shell appears first;
  local Cancel and Retry do not require the data server.

## Measured navigation checkpoint (2026-09-25)

A synthetic browser comparison used the same renderer, model and requested time
interval, replacing only the loader with its pre-change copy for the baseline.
The fixture returned one useful current record followed by 39 empty archive
continuations, plus one record in each neighboring interval. Each response had
an artificial 10 ms delay. Three alternating runs used Chromium 149/SwiftShader
at 1440 × 900 with reduced motion. Times below are medians from the initial
current request, rather than end-to-end production startup times.

| Measurement | Previous loader | Current loader |
| --- | ---: | ---: |
| First useful response | 22 ms | 15 ms |
| First useful scene constructed | 140 ms | 119 ms |
| First frame opportunity after construction | 147 ms | 127 ms |
| Past buffer available | 174 ms | 152 ms |
| Future buffer available | 4,801 ms | 262 ms |
| Visible cursor reaches its final page | 4,693 ms | 1,612 ms |

The main improvement is earlier future coverage and removal of the fixed wait
between every archive page. The current loader's cached mouse drag reached its
first render call in a median 28 ms and its next frame opportunity in 59 ms;
mean work per render call was 2.63 ms, with zero scene rebuilds before release.
These cached-input figures describe the current loader only. Separate public
demo tests exercise real gestures in both directions, session dragging, coasting
and click-to-stop while checking that rendered objects survive the gesture.

Frame opportunity is measured with two animation callbacks after rendering;
it is not a GPU presentation timestamp. This small scheduling fixture does not
measure source disk throughput, high-density rendering or full legacy-deployment
parity. The first baseline run also paid browser initialization costs, which is
why medians are reported. Provider indexing, record size, network latency and
configured scan limits still determine when a real interval becomes complete.
Real Java HTTP tests independently verify the provider and descriptor contracts.

## Filtering and panels

Progressive file responses include an opaque `sourceRecordKey` for each source
record and nested activity. This occurrence identity keeps records separate when
external IDs are empty or reused, while merging the same occurrence returned by
overlapping intervals. It is stable across scans while the source file and record
order remain unchanged. External IDs remain available for descriptor lookup;
the internal key is excluded from search, legacy filters, and Data panel content.
Independent occurrences in different files remain separate.

Saved server filters retain their inclusion/exclusion expression and saved Sort by
setting. Namespace metadata is available before filtering. Grouping also preserves
arbitrary source fields such as `series`, including nested-record inheritance and
the fallback group. Changing grouping keeps the active filter and visible range.
An explicit `namespace` takes precedence over legacy `data.namespace`; the
parent/source namespace is only a fallback. Exclusions inspect a session's full
nested context before its returned activities are scoped to the requested range.
The filter panel restores the active preset and its Sort by value together.
Equivalent presets retain partial records during regrouping; changed expressions,
sources or user/timeline scope invalidate that cache. Refresh also reads afresh.
Local filters use the same expression structure and persist per page and timeline
in browser storage. Server filter actions are disabled while disconnected, with
Retry available.

Calendar, Settings, Help, and Data share a width of approximately 22% of the window,
bounded to 320–480 px and capped by available space. Narrow screens use an overlay.
Long content scrolls inside the panel. Help sections collapse independently, and
changing the local dataset dropdown opens the selection immediately.

The current-view date axis appears once at the top of each page by default,
including grouped bands. Set `params.dateAxisMode` to `"per-band"` to retain a
separate axis in every main band, positioned by its `intervalUnitPos` setting.
Overview retains its separate context axis. The Perspective view uses a fitted,
front-facing camera to preserve complete, readable bands when the window or
Data panel changes size. Toolbar icons stay present across local, connected,
and unavailable-server states; unavailable actions explain their disabled state.

See [saved-preset browser evidence](ui/saved-presets/README.md) and the
[earlier loading captures](ui/progressive/README.md) for tested paths and limits.
