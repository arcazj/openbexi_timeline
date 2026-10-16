# OpenBEXI Timeline HBDS design

- [HBDS JSON: openbexi_timeline.json](../../../HBDS/schema/openbexi_timeline.json)
- [HBDS diagram: openbexi_timeline.png](../../../HBDS/schema/openbexi_timeline.png)
- [Schema and domain validation](schema-validation.json)
- [Viewer and PNG validation](validation-results.json)

The JSON contains 26 classes, five hyperclasses, 187 typed attributes, 30 class
relationships, and 56 example objects. The PNG is rendered from that JSON by the
actual OpenBEXI HBDS viewer. Open the PNG at full size, or load the JSON into the
viewer to inspect individual classes, nested configuration schemas, and examples.

The public user examples now come from the `admin` and `guest` default registries.
Other parts of the artifacts preserve the existing 2.8 design and predate the named workspace,
namespace-file and shared-service refactoring. See the [recommended model updates](../../../HBDS/README.md#hbds-design-model)
before using them as a description of the current runtime.

The design uses the [UI model template](../../../HBDS/templates/models/model_template.json)
and [source template](../../../HBDS/templates/yaml/source_template.yml). Each attribute includes
its full JSON Schema under `extensions.timeline.jsonSchema`, including nested
properties, allowed values, defaults, and nullability. Model and source examples
are embedded under `metadata.extensions.timeline.examples`. Input hashes make
regeneration necessary when these templates or default user, group and role files change.

## Relationships and ownership

Each user has one role and belongs to one group. `GroupNamespaceAccess` associates
a group with a namespace and assigns `admin`, `rw`, `r`, or `denied`. A group may
access multiple namespaces, and a namespace may be assigned to multiple groups.

A namespace selects one UI `Model` and owns default `Render` and `Filter` objects.
Repeated YAML entries for that namespace remain separate `Source` objects, with
their own settings and optional rendering/filter overrides. Each source owns its
ordered input paths. The namespace's combined path list is derived from those
sources. Empty lists remain valid for import-only sources.

`Connector` describes timeline serving endpoints. `SFTPSettings`, `S3Settings`,
and `OracleSettings` describe ingestion connections. The original single/list
forms of `connector`, `data_path`, and filename filters are preserved. Each
source's `data_model` storage pattern remains separate from `Model.path` and the
AI provider's model identifier.

The UI `Model` owns its parameters, ordered bands, optional rendering preferences,
and optional file-backed adapter. The adapter owns zones and their rendering
objects. Canvas, band, and zone background images are represented explicitly by
`Theme.sceneBackgroundImage`, `Band.backgroundImage`, and
`ZoneRender.backgroundImage`.

Global collector, timeline server, and AI configuration are grouped separately
from namespaces. Existing event/session payloads are not changed by this design.

`TimelineTab` references a namespace and stores its title, order and enabled state.
Its UI model resolves through the namespace. See the [HBDS runtime guide](../../../HBDS/README.md)
for configuration ownership, migration, editor APIs and the authorization boundary.

## Access-policy assumptions

The original `adman` field is interpreted as the boolean `User.admin`. A role's
`ceiling` limits the user's group grant: effective namespace permission is the
lesser of the role ceiling and that group's namespace permission. The ordering
is `denied < r < rw < admin`. Missing grants deny access; duplicate group–namespace
grants are invalid.

The administrator flag permits global user/group administration only when the
role ceiling is `admin`. It does not bypass namespace grants or explicit denial.
Namespace administration comes from effective `admin` permission. Legacy YAML
`permission` strings are retained as source configuration and do not implicitly
grant access. These are explicit design choices for review, not newly deployed
authorization behavior.

Relationship cardinalities use the repository's existing notation: `source`
counts source objects per target, and `target` counts target objects per source.
For example, `Group -> User [1 : 0..*]` means every user has one group, and a group
can contain any number of users. Composition is recorded explicitly in each
link's extension; visual containment of classes in hyperclasses does not imply
inheritance. Semantic membership is declared in `hypergraph.membership`.

## Reproduce and validate

The HBDS reference is pinned to commit
`51b61998c12597cd435680158f185c81af2fa9ce`, matching the repository's existing v2
HBDS interchange format. No reference checkout is modified. From the timeline
repository root, with project dependencies, Python, and a Playwright-compatible
Chromium browser installed:

```powershell
node docs/design/2.8/build-artifacts.mjs
node docs/design/2.8/validate-artifacts.mjs .local-private/hbds-reference
node docs/design/2.8/render-artifacts.mjs .local-private/hbds-reference
```

Validation checks the HBDS schema, native semantic and server validators,
references, example cardinalities, exclusive ownership, permission examples,
model-template compatibility, and round-trip preservation of all seven source
entries. Commented optional provider fields are included. Rendering uses local
read-only browser routes and checks native viewer counts, labels, clipping,
geometry, pixels, and page errors.
