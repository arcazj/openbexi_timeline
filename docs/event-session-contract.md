# Event and session JSON compatibility

The JSON structure and metadata of existing events, sessions and nested activities
must remain unchanged. OpenBEXI 2.4 adds control information around existing data;
it does not introduce a new item format.

Preserve field names, value types, nesting, array order, identifiers, optional
fields, null versus absent values, and unknown properties. This includes `data`,
`render`, `extensions`, custom metadata, numeric and BCE dates, and activities
nested inside sessions. Preserve both supported representations: legacy `events`
with `activities`, and snapshot `records` with `parentSessionId`.

Model ownership, permissions, licensing, AI requests and HBDS relationships must
use separate configuration, authorization stores or external indexes. Never add
`datasetId`, role fields, entitlement fields, AI provenance or HBDS wrappers to
existing timeline items. A conceptual class in the HBDS diagram does not authorize
a new required field or a record migration.

The renderer and API may continue their established internal normalization. Their
existing output contracts remain stable. Editing model configuration, permissions,
saved filters or AI drafts must not mutate timeline item payloads. Normal user
record edits may change the selected values through the existing API contract.

The frozen synthetic fixtures in
[`tests/fixtures/event-session-contract.json`](../tests/fixtures/event-session-contract.json)
capture the pre-2.4 renderer output for both representations, nested activities,
unknown metadata, and numeric/BCE dates. Run:

```sh
node --experimental-vm-modules --test tests/event-session-compatibility.test.mjs
```

Keep these checks in the normal test suite. Do not regenerate expected fixtures
to make an item-structure change pass.
