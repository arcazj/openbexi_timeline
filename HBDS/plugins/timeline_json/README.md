# Timeline JSON converter

Use `source_plugin: local` and `converter_plugin: timeline_json` with `source_path`. Accepts JSON objects with `events`, event arrays, JSONL/NDJSON and gzip input. Existing IDs, nested activities and descriptor data are retained. Incoming namespace values are replaced with the configured namespace.

Default publication upserts IDs. `options.snapshot: true` explicitly replaces this source's contribution; it never removes another source's records. A removed input file alone is not a deletion. Static committed demos use `NONE` instead of this converter.

See [collector setup and API contracts](../../../timeline_data_collector/README.md) for installation, UI execution, repeat policies and recovery.
