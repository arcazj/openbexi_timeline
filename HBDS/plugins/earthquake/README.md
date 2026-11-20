# USGS earthquake converter

The converter runs entirely in Python, preserving the previous parser's stable IDs, UTC timestamps, metadata and correction merging. `tools/build-collector.py --plugin earthquake` builds its Python wheel; no Java runtime or compiler is required.

GEO uses `HBDS/yaml/earthquake_geoscience.yml`, with both plugin roles set to `earthquake`. Live output remains `/data/earthquake/yyyy/mm/dd`. `options.input_file` accepts a local raw GeoJSON file, resolved relative to the workspace; use `--offline` for deterministic local conversion. `options.archive` selects archive acquisition, and `api_base` can override the feed for a controlled server.

```sh
timeline-convert-earthquake --workspace HBDS/GEO_Workspace.json --namespace earthquake --source input --date 2026-10-16 --once
```

Committed samples use `HBDS/workspace.json` and `NONE`; opening that demo never fetches live data.

Archive acquisition imports newest intervals first, splits oversized or repeatedly failing requests, and saves completed intervals only after their reports are durable. Existing `.import-progress.json` checkpoints remain compatible. A forced bounded run refreshes already completed intervals to discover late arrivals and corrections without duplicating records; older revisions never overwrite newer ones. Requests retry temporary HTTP failures and respect `options.timeout_seconds` (default 1800).

See [collector setup and API contracts](../../../timeline_data_collector/README.md) for installation, UI execution, repeat policies and recovery.
