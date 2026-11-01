# OpenBEXI Timeline 2.9.3

This release improves filtering, overview navigation, record artwork and
descriptor consistency. It includes the public Loki acquisition introduced in
[2.9.2](release-2.9.2.md) and all subsequent public workspace changes.

- Filtering offers value choices and checkbox controls. Java and Python use
  namespace-aware catalogs and workspace-scoped saved filters, so workspaces
  with matching model names retain separate selections.
- Overview visibility follows the active timeline through refreshes, view
  changes and keyboard toggles. Navigation and cached redraws preserve the
  current results and time range.
- Shared record visuals support icons, images and static 3D models. The dinosaur
  demo includes attributed artwork and schematic fallbacks. Native paging and
  selection keep dense records accessible.
- Descriptors use consistent metadata across 2D and 3D. Reference links display
  short labels, expose their URLs on hover and open in separate tabs. Public
  demo datasets include repaired destinations; table and CSV output use readable
  text.
- Collector startup tracing reports configuration, plugin loading, source
  selection, locks, checkpoints and schedule recovery. Incremental publication
  preserves descriptor details and source ownership.
- Metadata normalization uses deployment-owned dictionaries and optional field
  aliases. Nested-field flattening is explicit; the default preserves supplied
  descriptions. Public conversion code has no deployment-specific namespace rules.
- Public packaging removes obsolete browser launchers and uses generic examples.
  Private converters, dictionaries, operational configurations, internal endpoints,
  logs, checkpoints and generated deployment data remain excluded.
- Dependency updates include `fast-uri` 3.1.9, `undici` 8.12.3 and
  `snappy-java` 1.1.10.9 to resolve advisories found by the release audits.

The application and collector core are **2.9.3**. Independently versioned plugins
are `filesources` **1.0.2**, `mqtt` **1.0.1** and `loki` **1.0.1**; these tracing
updates require collector **2.9.3 or newer within major version 2**. Other public
plugins retain their existing versions. Existing timeline JSON and historical
nested descriptors remain readable. Restart running services to load the update.

The dinosaur artwork includes illustrative models and schematic fallbacks;
complete scientifically validated reconstruction coverage is unavailable.
Models are static. Physical tablet GPU performance and a hardware 60 FPS target
have not been established. Historical reference destinations can redirect or be
unavailable; intercepted browser tests do not establish live availability.
Loki retention gaps and saturated timestamps retain the documented 2.9.2 limits.

The Windows installer bundles Java, Python, the collector core and all seven
public plugins. Source ZIP/tar.gz archives, independent wheels/JARs, shared HBDS
architecture diagrams, regression evidence and SHA-256 checksums accompany the
release. Historical tags and downloads remain available.

See the [2.9.3 validation report](release-2.9.3-regressions.json),
[record visuals](record-visuals.md), [demo references](demo-links.md) and
[collector guide](../timeline_data_collector/README.md).
