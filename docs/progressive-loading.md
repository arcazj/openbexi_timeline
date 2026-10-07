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
loading leaves navigation, grouping, and the current records available. Loading
status appears in the toolbar. Its Stop control or Escape cancels the current
load; Retry reconnects while retaining the view. Changing the
query cancels superseded work and rejects late responses. Navigation cancels only
scans outside the retained buffer and schedules replenishment every 16–80 ms while
moving. Cached records enter the view before release without rebuilding the scene.
Measured request latency and movement speed guide replenishment and direction
priority. If data density fills the cache budget, neighboring scans pause with a
partial-coverage warning; visible work can evict distant buffers first. Moving
into a paused interval resumes it as visible work. A visible interval that exceeds
the budget retains accepted records and shows **Status: Data limit reached** in
orange. Use wheel or keyboard zoom to narrow the visible range and load that
interval, preserving the search and display options. Coverage remains partial
and exact Fit matches stays disabled until loading completes. At this limit the
client releases remaining cursors; narrowing the view or changing the query
resumes loading.
After processing finishes, **Status: Ready** is green when completed intervals
cover the visible time span. A data limit outside that span remains in the
report and does not prevent Ready. Gaps and limits inside the visible span stay
orange; navigating, zooming, changing filters or refreshing checks coverage again.
File scans can return empty pages while reading records outside the requested
interval or walking directories. Their visible and neighboring scans continue
past the short fallback page limits, so past sessions can reach Overview before
the first drag. A warning that a configured source is unavailable still prevents
complete coverage; check its server configuration and filesystem access.
Loading failures show a red **Status: Error** in the secondary menu bar. Click it or
press Enter to inspect the error. Use Retry or Refresh, or navigate to another
interval, to resume. Cancelled work shows **Status: Cancelled** in gray.
Calendar month arrows only browse
the calendar; choosing a day moves the timeline and requests that interval first.
Counts and Overview describe loaded records and identify partial coverage.
Searches prioritize sources whose namespaces match the query while retaining
other sources as context. If no match is loaded, an active text search scans
earlier configured files in the background. Changing the query, filter or
**Sort by** cancels superseded search work and rejects late results. Changing
presentation options preserves a pending search. Connected zoom can extend
beyond the loaded cache and requests the wider visible interval.
Overview has its own linear zoom span; its context follows the main interval to
keep the visible-window indicator centered. Zooming Overview does not change the
main range or analysis scope. See [request and diagnostic examples](connected-diagnostics.md).

## Historical search

Auto scale distinguishes completed empty intervals from incomplete coverage.
**Timeline details** shows the state of each retained window. Static demos can
look backward from an empty view. Connected views stay at the chosen date until
the user navigates or starts a search.

Entering a text search checks loaded records first. If there is no match, the
timeline automatically requests earlier history through the visible end date.
The server scans eligible configured file sources incrementally with the active
query, filter and **Sort by**. It continues through the archive rather than
stopping after eight nearby windows or 32 total pages. Each response remains
bounded, and the browser yields between pages so navigation stays responsive.
Available history means the files reachable through eligible configured sources;
it does not include unrelated archives or disabled sources. Records rejected by
source or user filters do not make the search incomplete. An enabled source
that cannot be read still makes coverage incomplete: a namespace filter alone
cannot prove which namespaces its records contain.

The view stays still while the secondary menu bar shows **Status: Searching…**.
Its tooltip and report show the date being checked, the number of files examined
and coverage warnings. Click Status to open or close the report. **Stop search**
sits immediately to the right and cancels outstanding search work while keeping
the view and displayed records. Changing the query, filter or Sort by also cancels stale work.
Cached source records can be reused, with the current filters applied again.

The first matching batch stops the historical scan and centers a matching
record at the current zoom. Later loading does not repeatedly recenter the view.
**No matching records** is final only after the server confirms that all eligible
history through the original visible end date was examined, including the
partially loaded visible interval. It makes no claim about future records. A
failed request, unreadable file or unsupported eligible provider makes the
search incomplete, and the toolbar explains that coverage is incomplete.
Stopping is also distinct from an exhaustive no-match result. REST connections
do not explore archives or poll when no search is active.

This uses `history=backward` with `matchProtocol=1&progressive=1` on the existing
sessions endpoint. Continuations keep the same query, source configuration,
filter, search mode, Sort by and end date; cancellation releases the cursor. Older servers
without this history protocol fall back to a nearby search of up to eight
expanding windows, 32 pages and 20 seconds. An empty fallback result explicitly
remains incomplete. **Find previous activity** and **Find next activity** retain
their directional navigation behavior; they do not claim an exhaustive archive
search. No new server endpoint is required.

Historical responses add `timelineMatch.history`:

| Field | Meaning |
| --- | --- |
| `direction` | `backward` for the historical scan |
| `exhausted` | All eligible scan work has ended; only a result with `incomplete: false` confirms complete coverage |
| `incomplete` | Some eligible history could not be examined, even if `exhausted` is also `true` |
| `checkingRange` | Optional `{from, to}` timestamps for the date range being checked |
| `filesExamined` | Number of files examined so far |
| `supported` | `false` when the provider cannot perform this historical scan |

The ordinary `timelineMatch.nextCursor` continues the historical scan. An empty
page with a continuation is progress, not a final no-match result.

See [Auto scale and exploration](help-guide.md#auto-scale-and-exploration) for
navigation, Lock current view, grouping and accessibility controls.

## File-provider protocol

The `json_file` provider accepts `matchProtocol=1&progressive=1` on the existing
sessions endpoint. `startDate`, `endDate`, `search`, and legacy filter parameters
retain their meanings. The response includes `events` and the existing
`timelineMatch` metadata.

New clients send `searchMode=text` for literal case-insensitive metadata search,
`searchMode=pattern` for a case-insensitive regular expression, or
`searchMode=legacy` for the original case-sensitive expression rules. Spaces and
semicolons act as OR only in Legacy. An omitted mode retains Legacy behavior for
existing clients. `timelineMatch.searchMode` acknowledges the interpretation;
Text and Pattern clients reject unacknowledged modes with a compatibility error.
Mode participates in cache, conditional-response, and continuation identities.
The same mode applies to visible pages, historical search, and SSE updates.

Progressive responses include these additional fields:

| Field | Meaning |
| --- | --- |
| `progressive` | `true` for a resumable response |
| `nextCursor` | Opaque continuation token, or `null` when scanning has ended |
| `batch` | Zero-based page sequence |
| `recordsExamined` | Top-level source records examined for this page |
| `charactersRead` | Decoded source characters read for this page |
| `elapsedMillis` | Time spent processing this page, excluding HTTP overhead |
| `warnings` | Reasons that coverage is incomplete |
| `warningDetails` | Source number and namespace, relative file/directory path when available, reason and suggested fix for each issue; at most 100 entries per scan |
| `recordsReturned` / `recordsExcluded` | Top-level page records retained/excluded by date, validation and legacy filtering |
| `uniqueSessions` / `uniqueEvents` | Cumulative unique nested-aware counts for this cursor, not across windows |
| `cache` | `miss` or `replay`; replay does not increase unique totals |
| `availableRange` | Optional observed source interval; filters and completeness are not implied |
| `latestRange` | Latest start timestamp observed during the scan, with its duration when available; not proof of the newest record in the entire archive |
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

- A page yields after 256 returned records, 4096 examined records, 512 directory entries, 512 Ki decoded
  characters, or a 50 ms cooperative processing target. Checks happen between work
  units, so these are not hard HTTP latency guarantees. A single record is capped
  at 2 Mi decoded characters; the final record can exceed the page character target.
- An ordinary interval scan stops at 64 Mi decoded characters, 10,000 files, or
  100,000 top-level records. Directory and nested-record depth is limited to 32. Limits and skipped
  malformed records produce partial-coverage warnings. Historical searches keep
  the per-page bounds and continue across the available archive; a source that
  cannot be fully examined prevents an exhaustive no-match result.
- The server keeps at most eight cursor sessions. Idle sessions expire after
  90 seconds, with periodic cleanup. Completed cursors are evicted before active
  ones, then the least recently used cursor is selected. Pages are serialized through the cursor
  registry. Deployment concurrency tuning is separate from this default.
- The client retains at most four aligned windows (three visible spans can cross
  four fixed boundaries), 15,000 top-level records, 50,000 total
  records including activities, and 8 Mi JSON payload characters. File-provider
  responses that report nonnegative integer `recordsExamined` and `charactersRead`
  counters allow up to 512 pages per interval, including neighboring intervals.
  This finite guard lets cold archive scans finish beyond the short fallback
  budgets. Zero-work pages are allowed because directory traversal and cached
  file exclusions may not read characters or examine individual records.
  Providers without those counters retain the fallback of 32 pages per visible
  interval and four per neighbor. A scan-page limit has a separate warning from
  a retained-data limit. The client uses a 15-second timeout per connected request
  and yields between batches so input and rendering can run. The bounds count characters, not heap
  bytes or compressed network bytes.
  Historical searches have a separate continuation and do not use the
  interval limit as an aggregate search limit.
  Background intervals pause at the scan limit, leaving visible work available.
  An expired cursor restarts once with loaded records retained; repeated failures
  show an explicit error instead of silently retrying forever.
- REST connections become idle after the bounded initial load and adjacent buffers.
  Navigation loads missing intervals and conditionally revalidates visible cached
  windows older than 30 seconds. **Refresh** explicitly checks all retained windows.
  Existing single-response providers remain compatible, but do not gain server paging automatically.
  Set `timeline.progressiveLoading = false` before initialization to retain the
  previous foreground/SSE loading path when an integration requires it.
- Static local datasets still load as one file. Their UI shell appears first;
  local Cancel and Retry do not require the data server.

## REST refresh and live updates

The source YAML's existing `connector` chooses the transport. For example,
`connector: "secure_sse:8441|secure:8442"` enables both HTTPS listeners.
Use `secure_sse` for live updates; `secure_see` is not a connector name.

- **REST (`secure:<port>`):** no periodic browser polling or automatic archive
  exploration while idle. Small moves reuse cached records. Navigation and the
  toolbar's **Refresh** use `If-None-Match` when a completed window has an ETag.
  A `304` keeps the existing snapshot and avoids parsing and drawing unchanged data.
- **SSE (`secure_sse:<port>`):** one EventSource connects to
  `/openbexi_timeline_sse/sessions?live=1` with the active range, filter, user and timeline. Source changes send a revision in
  both the SSE `id` field and `data: {"revision":"…"}`. The client ignores
  repeated revisions and reconciles changed windows through the same bounded
  JSON loader. Completed replacement snapshots remove deleted records. The
  selected record and current time span remain stable while updates arrive.
- EventSource reconnects using `Last-Event-ID`; the server sends its current
  revision if it changed while disconnected. Status shows reconnecting or
  unavailable live updates. **Refresh** is available during a disconnection.
- During revalidation the previous records remain visible until their replacement
  window completes. This can temporarily retain one old and one new copy of a
  window, in addition to the normal cache budget. An incomplete scan retains old
  records and reports partial coverage; narrow the view to finish reconciliation.
- **Go to latest data** appears for an empty visible interval when the loader has
  observed another timestamp. It preserves the time span. Its destination is the
  latest observed data, which can be incomplete when a scan reaches its limit.

Conditional responses and live notifications use a shared metadata inventory of
configured JSON sources. It checks file paths, sizes and modification times,
including creations and deletions; it does not parse event contents. Each
inventory is cached for one second and bounded to 100,000 entries and depth 32.
SSE checks it once per second and sends heartbeat comments while unchanged.
Inventory errors end the stream with a clear retrying status; manual REST reads remain
available. Slow storage can increase update latency. Changes that preserve both
file size, modification time and file identity cannot invalidate the source cache;
normal file writes update the modification time. A restart clears all caches.

## Measured navigation checkpoint (2026-09-25)

These measurements describe the loader before the 2.2.1 scan limits and refresh
changes. They are retained as a historical checkpoint.

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
Overview retains its separate context axis. Perspective initially fits the bands;
saved camera settings preserve a chosen viewpoint when the window or Data panel
changes size. Toolbar icons stay present across local, connected,
and unavailable-server states; unavailable actions explain their disabled state.

See [saved-preset browser evidence](ui/saved-presets/README.md) and the
[earlier loading captures](ui/progressive/README.md) for tested paths and limits.

## Source cache and filtered live updates (2.2.2)

A shared server cache retains immutable records and a time index for complete,
unchanged JSON files. It admits files up to 4 Mi characters, retains at most
256 files and 16 Mi characters of source text equivalent, and evicts the least
recently used entries. Parsed object overhead is additional. File size,
modification time and file identity are checked before reuse. Incomplete or
oversized files continue through the streaming parser. This cache stores source
records; every request reapplies its own source rules and user filter.

Explicit-model pages discover the connector through the public configuration
endpoint. Finite settings requests precede data loading. SSE connects at the
start of the data load with the active filter and range, so continued archive
work does not delay the live subscription. A terminal browser connection error
retries after two seconds; native EventSource handles ordinary reconnections.
Live revisions trigger bounded JSON reconciliation with the same server filters.

Status sits in the secondary menu bar. **Status: Loading…** and **Status: Searching…**
are orange while work continues; **Status: Ready** turns green after successful
completion. Partial coverage, data limits and interrupted connections stay orange;
errors are red and cancelled work is gray. Click Status to open the report and
click again to close it. The tooltip and report include loaded item counts,
available search progress and recovery details. The report's **Loading items…**
indicator disappears when loading ends.
See [filter syntax and saved presets](filter-syntax.md).
