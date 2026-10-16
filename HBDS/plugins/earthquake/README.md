# USGS earthquake converter

The Java converter migrated from `openbexi_quake` lives under `java/src/main/java/org/openbexi/earthquake`. Its parser and stable IDs are retained. `mvn verify` builds the independent JAR; `tools/build-collector.py --plugin earthquake` packages it with its Python adapter. Java 21 is required.

GEO uses `HBDS/yaml/earthquake_geoscience.yml`, with both plugin roles set to `earthquake`. Live output remains `/data/earthquake/yyyy/mm/dd`. `options.input_file` accepts a local raw GeoJSON file, resolved relative to the workspace; use `--offline` for deterministic local conversion. `options.archive` selects archive acquisition, and `api_base` can override the feed for a controlled server.

```sh
timeline-convert-earthquake --workspace HBDS/GEO_Workspace.json --namespace earthquake --source input --date 2026-10-16 --once
```

Committed samples use `HBDS/workspace.json` and `NONE`; opening that demo never fetches live data.

See [collector setup and API contracts](../../../timeline_data_collector/README.md) for installation, UI execution, repeat policies and recovery.
