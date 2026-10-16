# Deterministic session, event and zone generator

The original Java `event_generator` and `event_generator_zone` implementations now live in this plugin. Build the JAR independently with `mvn verify`; `tools/build-collector.py --plugin default` includes it in the wheel. Java 21 is required (bundled in the Windows installer).

Set both plugin roles to `default`. Options: `seed` (integer, default 0), `count` (1?100000, default 100), `zones` (boolean, default true). Use an isolated output namespace for generated tests. One-shot date ranges support at most 366 days. Templates can contain events just before the anchor day.

```sh
timeline-convert-default --workspace HBDS/Generator_Workspace.json --date 2026-10-16 --once
```

Create that workspace with a namespace source selecting this plugin; it is not installed as an active demo source. Repeating a seed/date range preserves IDs and output; Run again reprocesses it without duplicating records.

See [collector setup and API contracts](../../../timeline_data_collector/README.md) for installation, UI execution, repeat policies and recovery.
