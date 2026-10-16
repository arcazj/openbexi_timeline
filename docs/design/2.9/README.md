# OpenBEXI Timeline 2.9 HBDS plugin architecture

This design describes the plugin refactor for release **2.9.0**, tagged
**v2.9.0**. It preserves the timeline's existing sessions, events, activities,
zones, namespace identities, display models and demo behavior. The public core,
independent plugins and local dashboard are implemented. Application regression
results are recorded separately in `regression-results.json`.

- [HBDS model JSON](openbexi_timeline.json): 35 classes, six hyperclasses,
  190 typed attributes, 39 relationships and 19 example objects.
- [Configuration structure](configuration-view.json): implemented workspace,
  namespace, plugin manifest, execution and release examples.
- [Readable architecture overview](architecture-overview.png) and its
  [editable SVG](architecture-overview.svg).
- [Full HBDS diagram](openbexi_timeline.png), rendered in the native HBDS viewer.
- [Schema and example validation](schema-validation.json),
  [native viewer checks](validation-results.json) and
  [overview checks](overview-validation.json).

The HBDS model is a domain diagram, distinct from a timeline display model.
The configuration view illustrates separate files; it does not introduce a
second aggregate configuration file. The runtime contracts live in `HBDS/schema`; the model and examples are generated
from the actual public configuration and plugin manifests.

**Configuration and plugins.** GEO remains a workspace referencing separate
`earthquake` and `volcano` namespaces and their distinct converters. Each
namespace owns source instances; each instance selects source and converter
roles. A namespace can use multiple plugin types, and one plugin can serve
multiple namespaces. The default multi-namespace view shows All and retains
the earthquake/volcano buttons and `by_namespace` grouping.

All plugin packages live under `HBDS/plugins/<plugin_name>` and build
independently. A package may provide a source adapter, a converter, or both.
The public `timeline_data_collector` core loads compatible installed plugins
without domain-specific imports or a rebuild. Transport adapters can support
files, HTTP, S3, Oracle, MySQL, MQTT and Kafka as integrations are added.

**Standalone and UI execution.** A converter command accepts `--workspace`
and optional namespace/source selectors. It uses the same runner, validation,
publisher, state and leases as collector UI jobs; the collector web server
does not need to be running for standalone use. The UI offers start, cancel,
run again, repeat settings, progress, errors and last-success information.

Run again creates a new job for the selected inputs. Interval mode waits a
configured delay after completion; jobs never overlap for the same source
and output. Streaming mode maintains one subscription rather than repeatedly
launching subscribers. Scheduling starts through an explicit action;
`resume_on_restart` defaults to false. Force conversion does not reset a
stream checkpoint. Replay, if supported, needs an explicit range or offset.

**Publication and compatibility.** The common writer owns validation,
idempotent updates, source ownership, atomic output publication and checkpoint
advancement. Stable event/session IDs survive reruns and converter upgrades.
Failures retain the last successful output. Both timeline APIs continue
serving materialized JSON when converters are absent or unavailable.

Committed demo fixtures use `NONE`, which invokes no ingestion. Live datasets
keep separate namespace files and generated output directories. Existing
numeric and historical demo dates remain supported. `timeline_json` remains
available for incoming canonical JSON that needs validation and publication.
The existing seven-entry demo catalog remains a display catalog.

**Public and private distribution.** Public packages include the core,
default generator and earthquake/volcano plugins. Private operational
converters, credentials, local configuration, state and generated data stay
outside GitHub and release artifacts. Public examples contain no operational
converter mappings. A visibility field is descriptive; explicit Git and
packaging rules enforce the boundary. The detailed implementation prompt is
maintained locally because it includes private migration details.

**Regression and release.** Capture before/after record identities, counts,
sessions and display behavior. Verify the collector, public and private
plugins, both Java/Python servers, all catalog demos, GEO demo/live modes,
browser interactions, reruns, concurrent jobs, recovery and streaming replay.
Use the existing test suites and add meaningful coverage of the new
contracts. A failing test or unavailable required integration remains visible
in the report; passing model validation is not application regression proof.

Release assets must include a tested Windows x64 installer, source `.zip`
and `.tar.gz` archives, release notes, checksums, and the HBDS JSON/PNG
artifacts. Use standard ZIP and gzip-compressed tar formats. Include the
public collector, plugins and their required runtimes in the documented
Windows installation mode; test conversion as well as timeline startup.
The release publisher verifies all required assets and hashes before publishing.
Private packages are excluded by Git, the source manifest and package builders.

Publish **v2.9.0** from the tested public commit after implementation and
regression gates pass. Build assets from that revision, verify uploaded
hashes and release notes, and retain historical tags. The version is shared across Java, Python, browser help and package metadata.
Publication is a separate step after the required checks pass.

**Reproduce the artifacts.** The native HBDS reference is pinned to commit
`51b61998c12597cd435680158f185c81af2fa9ce`. With repository dependencies,
Python and Chromium installed, run from the timeline repository root:

```powershell
node docs/design/2.9/build-artifacts.mjs
node docs/design/2.9/validate-artifacts.mjs .local-private/hbds-reference
node docs/design/2.9/render-artifacts.mjs .local-private/hbds-reference
node docs/design/2.9/render-overview.mjs
```

The renderer serves the local reference through read-only browser routes.
Model input hashes, reference cardinalities, public examples and rendered
labels are checked. These commands do not run conversion jobs, alter live
datasets or publish a release.
