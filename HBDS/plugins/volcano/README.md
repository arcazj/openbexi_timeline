# Volcano feed converter

The converter runs entirely in Python, retaining the original feed parser's UTC dates and stable record IDs. `tools/build-collector.py --plugin volcano` builds its Python wheel; no Java runtime or compiler is required.

GEO uses `HBDS/yaml/volcano_geoscience.yml`, with both roles set to `volcano`. Live output remains `/data/volcano/yyyy/mm/dd`. `options.input_file` selects a local raw feed JSON file relative to the workspace. Use `--offline` with that file. Corrections to an existing upstream record update its stable ID.

```sh
timeline-convert-volcano --workspace HBDS/GEO_Workspace.json --namespace volcano --source input --once
```

The separate committed demo workspace uses `NONE` and requires no converter.

Historical date ranges use HANS search pagination with inclusive UTC date bounds; completed ranges are queried again for corrections. `options.archive` imports all history and resumes its incremental checkpoint. Pages advance only after their daily reports are saved. Interrupted bounded ranges resume their own checkpoints, while incomplete or repeating pages fail without marking the interval complete. Recent structured metadata is retained when an archive page supplies only HTML.

VAN and VONA documents sharing a `noticeIdentifier` remain separate records. Ordinary notices retain their established IDs; aviation notices use an identifier qualified with `:vona`. Older pending checkpoints automatically replay their pages with this corrected identity. Existing `.archive-progress.json` and bounded archive checkpoints remain compatible. `options.timeout_seconds` bounds the whole acquisition (default 1800).

See [collector setup and API contracts](../../../timeline_data_collector/README.md) for installation, UI execution, repeat policies and recovery.
