# Deterministic session, event and zone generator

The generator runs entirely in Python. Its seeded random stream, UUIDs, timestamps, descriptors, sessions, activities and zones preserve the previous generator's output. Build the Python wheel with `tools/build-collector.py --plugin default`; no Java runtime or compiler is required.

Set both plugin roles to `default`. Options: `seed` (integer, default 0), `count` (1–100000, default 100), `zones` (boolean, default true). Use an isolated output namespace for generated tests. The last date may be at most 366 days after the first date, with both dates included. Templates can contain events just before the anchor day.

```sh
timeline-convert-default --workspace HBDS/Generator_Workspace.json --date 2026-10-16 --once
```

The supplied `HBDS/Generator_Workspace.json` selects this plugin in the isolated
`DEMO_GENERATOR` namespace. IntelliJ's **Generator - Demo** configuration runs it
offline once and writes to `.local-private/events/DEMO_GENERATOR`. The committed
earthquake/volcano samples remain independent. Repeating a seed/date range
preserves IDs and output; Run again reprocesses it without duplicating records.

See [collector setup and API contracts](../../../timeline_data_collector/README.md) for installation, UI execution, repeat policies and recovery.
