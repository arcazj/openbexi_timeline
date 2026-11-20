# Independently built timeline plugins

Only explicitly allowlisted public packages ship. All other directories here
are ignored by the public repository, Docker context and release packaging.
Installing a private package never requires rebuilding the public collector.

Each package owns `plugin.json`, `schemas/options.schema.json`, `pyproject.toml`,
source, tests and documentation. All public plugins in 2.9.7 run in Python.
The collector discovers `*/plugin.json` under service `plugins.roots`
and the installed entry-point group `timeline_data_collector.plugins`. An
editable installation and its identical manifest form one registration;
conflicting or duplicated registrations and incompatible API versions fail.

The manifest API is **1**, documented by
[`../schema/plugin.schema.json`](../schema/plugin.schema.json). `runtime` names
the converter implementation. `entry_point` always identifies its Python
plugin factory.
An installed provider exposes `manifest()` without importing optional drivers.

```python
from timeline_data_collector.contracts import InputBatch, RecordBatch

class Plugin:
    def read(self, context):
        # Acquire input; never acknowledge a candidate checkpoint here.
        yield InputBatch(items=[payload], checkpoint={"upstream_offset": offset})

    def convert(self, batch, context):
        return RecordBatch(records=compatible_events,
                           checkpoint=batch.checkpoint,
                           acknowledge=batch.acknowledge)
```

A source-only package implements `read`; a converter implements `convert`.
A reader may also expose `acquire(context)` to commit remote raw-file revisions
under `source_path`. When the converter exposes `read_local(context)`, the runner
calls acquisition first and then uses that local reader. Other pairings continue
through `read(context)`, which must perform its own acquisition. This optional
API-1 extension keeps converter-specific file discovery out of transport plugins.
A converter may additionally implement `convert_batches(batch, context)` to
yield progressive `RecordBatch` results. Set `commit_input=False` on intermediate
upserts: they are published atomically while retaining the previous input
checkpoint and withholding acknowledgement. The final batch must use
`commit_input=True` (the default); emit it only after all input is processed.
On failure or cancellation, published upserts remain visible and the incomplete
input is retried. Use stable IDs so replay updates records without duplication.
The runner closes the iterator on failure/cancellation to release plugin resources.
A package providing both roles may implement `collect(context)` yielding
`RecordBatch` directly. The runner selects it only when both configured plugin
IDs match. All variants share validation, publication, leases and checkpoints.
Check `context.check_cancelled()` between units of work. Never write the final
target from a plugin. Keep acquired input in `context.workdir` until publication
can be recovered; return checkpoint candidates and optional acknowledgement
callbacks. Use `context.options` for late environment-variable expansion.
Do not persist resolved credentials in checkpoints, logs or errors.

The core preserves IDs supplied by a plugin. Feed adapters should derive IDs
from immutable upstream keys and keep update timestamps in data, not identity.
`snapshot=True` explicitly replaces only that source's contribution;
`deleted_ids` removes only records that source owns. Default batches are upserts.

The default generator preserves its established seeded random stream, IDs,
descriptors and activity structure. Earthquake and volcano plugins preserve
their acquired report formats and checkpoint files across the Python migration.
Invalid or incomplete feed responses, timeout and cancellation prevent an
unfinished interval or page from being accepted as complete.

Build with `python -m build <package>`. `tools/build-collector.py` builds the
server, collector and public plugin wheels and rejects Java artifacts.
Plugins can also be built independently using
its `--plugin <name>` selector. Install a wheel with `python -m pip install` in
the collector environment. A converter's standalone command accepts
`--workspace`; it delegates to the shared runner and needs no dashboard server.

The `filesources` transport aliases are supplied by one package to avoid copying
shared cache/recovery code into each driver. Generic HTTP payloads, MySQL and
Kafka can be implemented as additional packages; only listed manifests are
implemented integrations.
