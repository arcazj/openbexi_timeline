# Loki source plugin

This independent, public source package acquires raw logs through the
[Loki HTTP API](https://grafana.com/docs/loki/latest/reference/loki-http-api/).
It discovers streams and generates disjoint queries from their actual labels;
no fixed application, host, or log-family list is required.

From the repository root:

```powershell
.venv/Scripts/python.exe -m pip install --no-build-isolation -e HBDS/plugins/loki
.venv/Scripts/python.exe -m build --wheel --no-isolation HBDS/plugins/loki
.venv/Scripts/python.exe HBDS/plugins/loki/tests/test_loki.py
```

Select `source_plugin: loki` and an independently installed converter. Keep
`source_path` as the local raw archive and `target_path` as the converter output.
The existing `run`, `validate`, and `serve` commands select a workspace.
`run --date today --mode watch --interval-seconds 60 --lookback-hours 24`
collects by UTC day and rolls forward at midnight. Offline mode reads only
already acquired files. No source configuration or schedule is installed by
installing this package.

```yaml
options:
  loki:
    base_url: http://localhost:3100
    fallback_base_urls: []
    discovery:
      mode: all
      refresh_seconds: 60
    timeout_seconds: 30
    page_size: 5000
    query_window_seconds: 3600
    max_concurrency: 2
    max_requests_per_pass: 64
    retries: 2
    ingestion_delay_seconds: 60
    late_arrival_rescan_seconds: 300
    unavailable_retry_seconds: 3600
    gap_rescan_seconds: 3600
  archive:
    directory_template: "{yyyy}/{yyyy}_{mm}_{dd}/{hostname}/{app}"
    filename_label: filename
    preserve_basename: true
    date_from: auto
    fallback_filename_template: "{app}.{yyyy}_{mm}_{dd}_{hh}.{stream_id}.log"
    encoding: utf-8
```

The complete validated options live in `schemas/options.schema.json`.
All transport options below are under `options.loki`:

| Option | Purpose |
| --- | --- |
| `base_url`, `fallback_base_urls` | Primary endpoint and ordered, equivalent alternatives. |
| `discovery.mode`, `discovery.refresh_seconds` | Discover all label sets; refresh the inventory every 60 seconds by default. |
| `timeout_seconds`, `retries` | Per-request timeout and bounded immediate retries before durable retry scheduling. |
| `page_size`, `query_window_seconds` | Response limit and initial window size; saturated windows split automatically. |
| `max_concurrency`, `max_requests_per_pass` | Parallel query limit and per-pass query budget before parsing. Discovery has its own requests. |
| `ingestion_delay_seconds` | Keep the query upper bound behind the current UTC time. |
| `late_arrival_rescan_seconds` | Minimum delay before revisiting completed windows in the selected days. |
| `unavailable_retry_seconds`, `gap_rescan_seconds` | Persistent retry delays for unavailable sources and failed/incomplete queries. |
| `tenant_env`, `bearer_token_env`, `headers_env` | Environment references for tenant, bearer token, or named HTTP headers. |
| `routing.namespace_label`, `routing.values` | Explicit namespace ownership label and optional value-to-namespace mapping. |

Archive options below are under `options.archive`:

| Option | Purpose |
| --- | --- |
| `directory_template` | Relative path using date, host, app, and stream fields. |
| `filename_label`, `preserve_basename` | Original filename label and whether to retain its basename. |
| `preserve_app_subdirectories` | Preserve relative components after the original app directory, needed by some parsers. Defaults to true. |
| `date_from` | Recognized original filename date (`auto`) or Loki entry timestamp (`loki_timestamp`). |
| `fallback_filename_template` | Filename when there is no usable original basename. Include `stream_id` to distinguish streams. |
| `encoding` | UTF-8 raw-text output. |
| `label_mapping.hostname`, `label_mapping.app` | Label names used for directory routing. |

`max_requests_per_pass` bounds query work before conversion can start.
Acquisition alternates recent and older pending windows and reserves time for
late-arrival checks. Full responses split into disjoint smaller intervals;
a saturated single nanosecond remains an explicit gap. Discovery warnings or
invalid responses never count as complete coverage. The HTTP API does not
provide a discovery pagination cursor: deployments must not silently truncate
successful series responses at a proxy.

`date_from: auto` recognizes year/month/day or month/day/year filename dates,
otherwise using the entry's UTC timestamp. `loki_timestamp` always uses that
timestamp. `label_mapping` optionally names the `hostname` and `app` labels;
missing values use stable stream-based names. Unknown log families are still
archived; parsing depends on the selected converter. Original filenames are
preserved where possible. Distinct original paths sharing a basename receive
a stable collision suffix.

For a shared endpoint, `routing.namespace_label` identifies the namespace label
and optional `routing.values` maps its values to configured namespace names.
Known other namespaces are left to their owner; absent ownership is retained
under `.unrouted` and reported. Prefer a separate source root for each namespace.
Equivalent fallback endpoints share acquisition identity. Source-root ownership
prevents two different configured sources from overwriting the same archive.

Use `tenant_env`, `bearer_token_env`, or `headers_env` (HTTP header name to
environment-variable name) for authentication. Credentials are resolved only in
memory. URLs must not contain credentials. Redirects are rejected so credentials
are never forwarded to unconfigured destinations.

Acquisition state is under the source's private state directory:
`loki/acquisition.sqlite3` and `loki/status.json`. It records discovered streams,
query windows, occurrence-aware log entries, file provenance, and retry times.
Identical lines with the same stream and timestamp retain their occurrence
count; overlapping queries do not multiply it. Loki supplies no universal entry
ID, so redistribution of identical entries between stream label sets cannot
always be distinguished from legitimate records.

Raw publication is atomic and unchanged bytes retain their modification time.
Existing files are adopted only if their entire contents survive in order.
Files awaiting more complete overlap remain visible as adoption conflicts.
Unexpected modifications to an owned file are saved under `loki/repairs`
before restoring its journaled revision. Missing files are rebuilt locally
without requiring the remote retention window still to exist.

Acquisition and timeline checkpoints are separate. Failed conversion leaves
raw logs available for replay. Pending gaps and hourly retry deadlines survive
restarts and the rolling lookback. A successful empty query is not evidence
that historical logs never existed: retention-related gaps cannot be declared
recovered without independently verified coverage. Endpoint, credential-reference,
tenant, routing, or archive-mapping changes require explicit state migration;
do not delete the journal to hide unresolved gaps.

To roll back, stop the Loki schedule, set the source reader back to `local`,
and retain its ID, archive, target, and publication state. Existing raw files and
published events remain usable. Keep the acquisition journal for later recovery.
