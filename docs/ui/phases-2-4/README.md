# Results and adaptive time spacing — phases 2–4

Implemented on 2026-09-23. These are actual application captures, using the checked-in
mixed-hazard fixture and hazard bands. They are not generated mockups or evidence of
a connection to the user's deployed hazard server.

## Using the controls

- **Search** retains the existing provider's query meaning. File-backed search is
  case-insensitive literal matching; the legacy JSON-file server keeps its regex
  syntax, including semicolon/space alternatives and `*` for no condition.
- **Results → Highlight matches** keeps eligible surrounding records. **Show only
  matches** removes nonmatching children and empty groups, retaining necessary
  parent containers. Directly matched sessions do not automatically match children.
- Counts distinguish events and sessions, and include offscreen records. Source
  colors remain intact; labels/outlines and overview cues indicate matches.
- **Fit matches** includes the real matching endpoints plus padding. Structural
  parent durations do not widen the fit. It needs a query and complete coverage.
- **Auto scale** selects a time map using the displayed records. Changing Search,
  Results or Auto preserves visible real endpoints, including Split view.
- **Settings → Timeline display** sets the maximum adaptive ratio, from 1 to 16.
  Changing it does not enable Auto. The strip shows relative time slopes for the
  committed map; a `1×` result is valid when uniform spacing wins.
- Wheel up zooms in; wheel down zooms out. Detail zoom preserves the pointer time;
  overview zoom targets its linear time. Zoom buttons are keyboard accessible.
- A hidden selection keeps its identity and descriptor, with an action to restore
  Highlight mode. Clearing search restores ordinary styling and eligible records.

## Mapping and coverage rules

For static files, the analysis domain is initialized from the complete loaded data
and model bounds. It stays fixed through search and Results changes. The overview
is linear over that domain, even when a model previously magnified its overview.
Configured overview source groups still apply. Detail model focus remains active
initially and is explicitly labeled; Auto or navigation enters the new mapping.
Turning Auto off thereafter uses uniform spacing. Reset restores the model's
reference view, while retaining the Auto preference.

Maps use 64 bins, positive quiet-region weights, logarithmic density weights, and
at most five candidates (`1`, `2`, `4`, `8`, plus the chosen maximum). The exact
detail row-packing algorithm scores detached candidate geometry without renderer
allocation. Uniform is always considered and wins ties. Maps are strictly
increasing and invertible; beyond the domain they extend the edge's positive slope.
Wheel navigation keeps its chosen map to preserve the pointer anchor. Search,
Results, ratio and width changes reevaluate candidates. Dragging defers data/query
commits and demo resizing until the gesture ends.

The legacy `json_file` HTTP and SSE adapters support opt-in `matchProtocol=1`.
Responses carry authoritative per-record `searchMatch` flags and `timelineMatch`
metadata: version, query, revision, condition state, domain and completeness.
Enabled configured roots are read without rewriting files. Bounded inventory also
finds long sessions stored in earlier partitions. Existing request filters apply
before matching. Streams detect revisions across that same inventory, and each
request/stream owns its configuration copy. The client aborts superseded HTTP
requests and rejects older request/stream results.

The scan bounds are 10,000 JSON files, 100,000 top-level records, 64 MiB of file
contents, 100,000 visited paths and depth 32. Hitting a bound marks the response
partial. Partial views label their counts as loaded records, use uniform spacing
and disable exact Fit. Read/parse/search failures retain the last valid view with
an error. Unsupported providers, including the unextended Mongo adapter and the
separate REST API, retain legacy behavior and do not claim authoritative coverage.
No changes to authentication, provider query syntax or deployment are implied.

## Real captures

| State | Screenshot |
| --- | --- |
| No search | [Normal context](hazards-no-search.png) |
| Highlight matches | [Context with yellow match cues](hazards-highlight.png) |
| Show only matches | [Matching events and sessions](hazards-only.png) |
| Auto scale | [Automatic spacing](hazards-auto.png) |
| Fit matches | [Including the late offscreen match](hazards-fit.png) |
| Wheel zoom | [Changed detail window](hazards-zoom.png) |
| Empty search | [Empty state](hazards-empty.png) |
| Phone, 390 × 844 | [Wrapped controls](hazards-phone.png) |
| Settings | [Ratio setting](hazards-settings.png) |
| Dense synthetic fixture | [Uniform](dense-uniform.png), [Adaptive](dense-adaptive.png) |

[capture.mjs](capture.mjs) starts a temporary loopback demo server, exercises the
real controls and WebGL renderer, checks all seven catalog demos, saves captures,
and closes browser/server resources. [capture.json](capture.json) records the
browser, assertions, ranges, counts and selected maps. Run it from the repository
root with `node docs/ui/phases-2-4/capture.mjs`; set `TIMELINE_CAPTURE_BROWSER` when
using an installed Chromium executable. This run uses installed Chromium 149;
the Playwright-locked browser and historical screenshot baselines were not run or
silently regenerated. Final baseline review belongs to phase 7.

## Verification and limits

The full JavaScript suite passed 101 tests. Maven passed 37 executed tests, with
34 existing tests skipped (71 reported, zero failures/errors). Real-browser
checks passed without page errors; the dense fixture used 148 rows with uniform
spacing and 40 rows with Auto scale.

Focused JavaScript tests cover snapshot identity, both Results modes, nested
sessions, source preservation, selection, empty states, adaptive inversion, bounds,
uniform ties, fit, rapid zoom, Split view, deferred gestures, partial providers,
and stale HTTP responses. Existing demo/layout/navigation/share/help tests were
updated where the new behavior intentionally changes previous expectations.
Java tests exercise the actual HTTP servlet, regex semantics, request isolation,
long sessions in earlier partitions, file preservation, watcher revisions and
partial/failure states. They use temporary fixtures, not production data.

[performance.json](performance.json) records the CPU-only candidate-layout
benchmark, with five measured samples after a warmup. On this Windows/Node 24 run,
median times were approximately 2.4 ms / 10.9 ms / 72.8 ms for 250 / 1,000 / 5,000
clustered records. The synthetic text measure uses 7 px per character; these are
not browser end-to-end render timings. Heap deltas are reported, not peak or
retained memory. Full GPU stress, production-provider latency, locked visual
baselines and deployment validation remain part of phase 7.

Connected read-only YAML/model browsing is phase 5; draft editing and conditional
saves are phase 6. Those controls and configuration endpoints are not added here.
