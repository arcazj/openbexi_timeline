# OpenBEXI Timeline 2.4 consolidated implementation prompt

Complete OpenBEXI Timeline 2.4 as a simple, friendly timeline application with
commercial licensing, model-specific access, an optional AI-assisted Model and
YAML editor, and a reusable embedded edition. Use the existing application,
README, schemas, examples and tests. Retain working behavior and complete the
requirements below as one coherent delivery.

**Fixed constraint:** never change the JSON structure or metadata of existing
events, sessions or nested activities. Preserve field names, types, nesting,
array order, IDs, null versus absent values, unknown properties and extensions.
Support both legacy `events`/`activities` and snapshot `records` with
`parentSessionId`. Keep the established renderer normalization unchanged. Put
ownership, access, entitlements, AI state, HBDS relationships and embed selection
information in separate configuration, stores, indexes or transport envelopes.
Do not migrate source items into a new shape. This rule takes precedence over
every other requirement; retain the frozen compatibility fixtures.

1. **Keep exactly two menu bars: main and secondary.** Use the label **Filters**.
   Place Calendar before the filter controls, and `Filter: <filter name>` directly
   before Filters. Put Filters before Timeline details, with a separator between
   them. After Search, place Go to latest data, Find previous activity, Find next
   activity, a separator, Auto scale and Lock current view when space permits;
   move that group to the secondary bar on smaller screens. Add a separator
   between the 3D control and Settings. Remove the Narrow time window button.
   Preserve keyboard focus, scrolling within the bars and usable phone layouts.
   High contrast must distinguish icons, buttons and groups between separators.

2. **Make loading and status understandable.** Show orange while work is pending,
   with clear text such as `Status: Loading…` or `Status: Searching…`. Use green
   when work is complete, and distinct text and colors for partial data, errors
   and cancellation. Do not rely on color alone or report Ready while work is
   unfinished. Clicking the status control opens its report; clicking it again
   closes the report, like Timeline details, without cancelling the operation.

3. **Use the confirmed commercial license for 2.4.** The licensor is
   Jean-Christophe Arcaz, individual owner, Maryland, USA; public licensing
   contact: `openbexi@gmail.com`. Apply the existing
   [Commercial and Exempt Use License](../../../LICENSE), including its student,
   educator, noncommercial researcher, charity, nonprofit organization and
   personal noncommercial exemptions. Use `nonprofit` in the entitlement API;
   do not substitute the earlier mistaken abbreviations. Keep entitlement
   separate from authorization and legal permission. Preserve previously granted
   GPL rights and third-party terms. Keep the license, notices, guide, order form,
   source metadata and packaged copies consistent. Do not invent prices,
   subscriptions, purchase verification or customer agreements.

4. **Enforce access per model.** Give managed models stable identities, a workspace,
   and administrator, read/write and read-only roles. Support bounded custom roles.
   Only administrators may edit managed model/YAML configuration or request AI.
   Readers may view, search and use permitted filters; writers may change
   authorized items and filters. Enforce this on the server, including direct
   URLs, previews, documents, exports and AI requests. Prevent removal of the last
   administrator and leakage through private clones or reused IDs. Keep model
   administration separate from shared server administration. Preserve service
   tokens for unscoped data while explicit grants protect scoped models.
   Distinguish public demonstrations from private data.

5. **Maintain the complete HBDS domain description.** Use the pinned
   [OpenBEXI HBDS reference](https://github.com/arcazj/openbexi_hbds/tree/51b61998c12597cd435680158f185c81af2fa9ce)
   and its v2 semantic format. Deliver the
   [importable JSON](timeline-2.4.hbds.json),
   [complete diagram](timeline-2.4.hbds.png),
   [overview](timeline-2.4.overview.png), SVG and reproducible validation.
   Describe classes, typed attributes, identities, links, membership, inheritance,
   ownership and cardinalities for organizations, workspaces, users, memberships,
   roles, entitlements, models, versions, JSON/YAML documents, sources, datasets,
   model-owned filters, preferences, sessions, events, activities and AI requests.
   Explain both item representations without adding conceptual attributes to
   source items. Distinguish implemented invariants from future domain design;
   HBDS validation alone does not enforce application permissions or licensing.

6. **Preserve model, YAML and filter compatibility.** Keep `params`, `bands`,
   `dataSource`, `rendering`, both model schemas and supported legacy extensions.
   Preserve YAML comments, unrelated keys, order where practical, anchors and
   aliases; use Advanced text when an edit changes alias semantics. Support model,
   source, server, deployment and snapshot YAML under their existing validation.
   Retain record identities, parent links, dates, BCE/numeric axes, uncertainty,
   zones and deletion metadata. Never silently change a populated dataset's time
   axis. Each managed filter belongs to a model and has personal/shared visibility;
   retain existing expression and sorting semantics. Keep current user/timeline
   filters compatible without silent conversion. Document the implemented
   one-model/one-dataset boundary separately from the broader HBDS design.

7. **Keep the editor small and usable.** Organize Properties into Overview, Data,
   Appearance, Filters and Access. Keep revisions and saved versions in Overview,
   searchable properties, contextual help, and JSON/YAML Advanced text on the same
   draft. Preserve import, export, duplicate, rename, delete, undo, redo, revert,
   validation, concurrent-save conflicts and the last valid live preview.
   Distinguish local drafts, saved configurations, publication and restart needs.
   Keep the real Timeline, Table, Split, overview and 2D/3D rendering available.
   Apply to original timeline remains explicit and scoped to its originating
   instance; applying or previewing does not save to the server.

8. **Adapt the editor to its launch context.** In
   `openbexi_timeline_model.html`, hide the screenshot's document-management block
   when opened from an application using a server-selected model or connected
   source, rather than `demos.html`. This includes the document chooser, document
   management buttons, original document-status row and workspace selector.
   Keep essential Save/Export, Undo, Redo and Revert actions and dirty state in a
   compact editing toolbar. Keep operation messages, validation errors and
   authorization warnings visible. Demo and standalone editor launches retain
   the full document manager. Carry this presentation context explicitly through
   the launch URL and optional saved context, preserve it on reload and when
   authentication changes, and never use it as authorization. Remove the top
   **OpenBEXI Timeline** link in every mode. Place **Edit a property and see its
   effect in the live timeline.** beside **Model and YAML editor** on the same
   line when space permits; wrap gracefully on narrow screens.

9. **Provide optional, extensible AI assistance.** Use one internal interface with
   adapters for OpenAI, Anthropic Claude, Hugging Face inference, compatible APIs
   and local/future providers. Configure actual model capabilities instead of
   assuming every model supports images, structured output or streaming. Support
   explanations, generation and repair for model JSON/YAML, including existing
   and future rendering options through validated configuration. Allow a timeline
   image to suggest bands, layout, colors, labels and grouping; label uncertain
   details and do not invent factual events or sessions from it. Show a diff and
   live preview before explicit acceptance; save separately. Preserve manual
   editing, undo, cancellation and recovery after failures. Keep provider
   credentials server-side, check model access and eligibility, and enforce input,
   timeout, request and concurrency limits. Do not send timeline records or
   credential-bearing deployment/source YAML to a provider. Describe configured
   capabilities and tested protocols honestly; mock tests do not certify live
   accounts, billing or model quality.

10. **Deliver a reusable embedded edition.** Supply an iframe entry point and a
    small JavaScript host API for initialization, complete data updates, date
    navigation, event selection, view/appearance changes and destruction. Support
    several instances, responsive containers and same-origin/cross-origin hosts.
    Isolate CSS and Three.js dependencies, validate exact message origins, sender
    windows and instance channels, and clean up listeners, pending requests and
    rendering resources. The host owns authentication and supplies authorized
    data; do not copy credentials into URLs, items or child frames. Keep embedded
    records read-only and model editing unavailable there. Retain the last valid
    data after rejected updates and preserve the view and surviving selection.
    Return original item metadata with selection callbacks; keep paths and
    correlation IDs outside items. Support existing model field mappings and
    numeric time axes without a separate item schema.

11. **Include an Earth Orbit integration example.** Follow the catalog and selection
    conventions of [OpenBEXI Earth Orbit](https://github.com/arcazj/openbexi_earth_orbit).
    Adapt launch arrays, confirmed decay catalogs and optional predicted re-entry
    windows into the existing timeline format. Keep NORAD IDs as strings,
    distinguish launches, confirmed decays and predictions, retain date precision,
    window bounds and confidence, and report invalid input. Use a separate map
    to return source records and matching satellites to the host. Historical
    metadata-only objects can open details without inventing an orbit position.
    Refresh on catalog revisions rather than animation frames. Provide a working
    example with synthetic data and instructions for APIs or local catalogs.
    Describe its scope accurately: the example does not imply that Earth Orbit's
    production application has been changed.

12. **Document and verify the delivered application.** Keep README short: overview,
    quick start and links. Put feature details, limitations, licensing, integration,
    migration guidance and release validation in their guides. Update the
    documentation index, affected HTML/Markdown guides and reviewed screenshots.
    Include public assets in the Java allowlist, static build and reviewed source
    manifest. Keep private data, credentials and temporary reports out. Retain
    version **2.4.0** unless a version change is explicitly requested. Verify
    generated schemas, OpenAPI, examples, public links and package contents.
    Commit and push the reviewed, tested changes to `master` under the existing
    instruction, without rewriting remote history; check the verification and
    static-site workflows for that commit.
    Report actual local, Git and publication state; never present a prepared
    archive as an already published release.

Test immutable item fixtures; menu ordering, contrast and status behavior; role
isolation and direct-request denial; model-owned filters; JSON/YAML editing,
history and conflicts; AI review/cancellation/capability failures; and editor
launch modes at desktop, narrow and phone widths. Exercise the real Java server
with synthetic users and data, and the real renderer with connected and demo
flows. Test embedded messages, metadata, updates, rejected input, unavailable
storage, resize, multiple instances, cleanup and a deployment path prefix.
Validate the HBDS JSON and diagrams with the pinned reference tools. Record
reproducible commands and outcomes in the [delivery record](delivery-checklist.md);
resolve failures before calling the work complete.

**Explicit deferral:** Docker image/build testing in CI remains deferred as
requested. Keep existing container files and notices consistent, but do not claim
a container test was run. Separate operational recommendations—onboarding and
token-rotation screens, monetary AI budgets, live-account certification,
backup/recovery drills and formal release publication—from this implementation
scope unless separately requested. Keep these boundaries visible rather than
implying those capabilities exist.
