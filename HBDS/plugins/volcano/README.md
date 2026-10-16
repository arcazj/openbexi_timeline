# Volcano feed converter

The Java converter migrated from `openbexi_quake` lives under `java/src/main/java/org/openbexi/volcano`. The original feed parser, dates and stable record IDs are retained. Build with `mvn verify`; `tools/build-collector.py --plugin volcano` packages the independent JAR and Python adapter. Java 21 is required.

GEO uses `HBDS/yaml/volcano_geoscience.yml`, with both roles set to `volcano`. Live output remains `/data/volcano/yyyy/mm/dd`. `options.input_file` selects a local raw feed JSON file relative to the workspace. Use `--offline` with that file. Corrections to an existing upstream record update its stable ID.

```sh
timeline-convert-volcano --workspace HBDS/GEO_Workspace.json --namespace volcano --source input --once
```

The separate committed demo workspace uses `NONE` and requires no converter.

See [collector setup and API contracts](../../../timeline_data_collector/README.md) for installation, UI execution, repeat policies and recovery.
