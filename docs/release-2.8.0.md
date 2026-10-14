# OpenBEXI Timeline 2.8.0

2.8 adds an optional Python server for the existing timeline UI. A persistent SQLite interval index removes repeated directory scans and parsing of entire source files from normal window queries. Indexing handles changed, deleted, incomplete and malformed files separately from requests, retaining partial-coverage diagnostics.

Cursor snapshots and page replay persist across workers and server restarts. The browser honors bounded, cancellable retry delays while the first index is building. Existing visible-window priority, bounded prefetch, cancellation and one-time expired-cursor recovery remain in place.

The Python file backend supports legacy/typed filters, text/pattern/legacy search, scoped activities, progressive loading, historical search, saved filters, descriptors, event creation, live revisions, conditional responses and the public UI asset policy. Java remains supported and handles administration and other providers through an optional bridge. The Windows installer still starts Java. See the [compatibility matrix and migration instructions](python-server.md) before changing a deployment.

Settings now shows both the UI version and the connected backend implementation/version. Trace selection continues to offer INFO, WARNING and ERROR, with one readable request summary and no GET URLs by default.

The bundled LZ4 dependency is updated to 1.11.4 for the native-library extraction and decompression fixes reported during release validation.

HBDS brings generic schemas, model and source templates into `HBDS/`, with private
deployment configuration, users and filters kept outside the public allowlist.
The HBDS Editor supports administrator-authenticated edits on both Java and
Python, revision checks, namespace tabs and scoped live updates. Existing YAML
entry points retain migration aliases. See [HBDS structure](../HBDS/README.md).

Sorting & Filtering now contains namespace navigation, a collapsed new-filter
builder and compact saved filters. The builder supports creating or cloning a
draft, real namespace choices, data-driven grouping fields and typed conditions.
Save filter/Cancel appear once at the bottom; clones require a unique name and
do not alter the active filter until saved. Generated expressions and saved
`filter_value`/`sortBy` fields retain the Java/Python contract. Legacy regex
presets remain editable through Advanced expression. Each saved row has `?`
help and automatically sized expression previews. Revisiting namespace tabs
reuses their loaded timelines.

Validation includes shared filter/search fixtures, Python integration tests, real Java/Python HTTP comparisons and a Chromium test using two Python workers. The browser test loads a view in three requests and refreshes it after a live update in three requests, with no page errors. [Benchmark data](python-server-benchmark.json) records cold/warm latency, request counts, bytes, CPU, memory, concurrency and persistent restart. First-time index construction is slower than a warm load; pre-index large sources before switching traffic.

Local release validation passed 398 JavaScript tests (including the connected-save regression), 48 Python tests, and 152 Java tests with 34 legacy/environment-dependent tests skipped. Desktop/phone checks cover creation, cloning, unique names, cancellation, saved expressions, offline behavior and progressive loading. Real Java and Python HBDS browser checks cover authentication, revision conflicts, lazy tabs, scoped refresh and restart persistence. The legacy Java editor integration also passed.

The complete browser run and focused reruns verify 329 scenarios, with seven conditional skips. Toolbar screenshot references were reviewed separately: every changed pixel is within the toolbar, matching the requested button removal and title styling.

The 100,000-record benchmark passed 11 Java/Python record comparisons. Both servers completed all 20 warm loads; the Java cold scan reached its configured scan limit and reported partial coverage. Browser tests used one dataset request for load/search/grouping/builder interactions at both 1,000 and 10,000 records. At 10,000 records, builder expansion took 231 ms and grouping took 6.91 s with software rendering; grouping remains a performance limitation. See the [measurement details](python-server.md#validation-and-measurement).
