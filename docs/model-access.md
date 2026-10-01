# Model access and commercial eligibility

Managed models have independent `admin`, `readWrite` and `readOnly` roles.
Administrators edit model-owned JSON/YAML configuration, grants and documents.
Read/write users edit permitted timeline items and saved filters. Readers query
items and use visible filters. Custom roles may grant read, record-write and
filter-write permissions; only the built-in administrator role opens the editor.

The server checks permissions on direct API requests. Hiding an editor button
does not authorize a request. The [item JSON contract](event-session-contract.md)
is unchanged: grants and ownership are stored outside events and sessions.

## Set up a protected model

Start the [Java API server](rest-api.md) with `OPENBEXI_API_TOKEN` configured as a
system administrator credential and private `OPENBEXI_API_DATA_DIR` storage.
The default workspace already exists.

1. Clone an example through `POST /api/v1/datasets` with
   `{"id":"team-model","sourceId":"default-dataset","title":"Team timeline"}`.
2. Create each user with `POST /api/v1/access/users`, for example
   `{"id":"alice","displayName":"Alice","workspaceIds":["default"]}`.
   The response contains a generated bearer token once. Store it securely and
   give it to that user; lists never return tokens or their stored digests.
3. Read `GET /api/v1/models/team-model/access`, retaining its `ETag`.
4. Replace its grants using `PUT` to that URL, with `If-Match` and a body such as:

```json
{
  "workspaceId": "default",
  "grants": [
    {"userId": "alice", "role": "admin"},
    {"userId": "bob", "role": "readOnly"}
  ],
  "roles": []
}
```

Create Bob first. Every grant must reference an active user in the same workspace,
and every protected model must retain an active administrator. Requests use
`Authorization: Bearer <token>`; credentials never belong in URLs.

Open `openbexi_timeline_model.html?modelId=team-model` and connect using Alice's
token. The Access area edits model grants. A reader or writer cannot open managed
configuration documents or request AI generation.

System administrators create additional workspaces through `/api/v1/workspaces`
and provision users through `/api/v1/access/users`. This version uses bearer
credentials; it does not provide account registration, federated login, or a
credential rotation screen.

## Existing data and documents

Existing service writer/reader tokens continue to work on models that have not
been assigned explicit grants. Once a model is scoped, those service tokens do
not bypass its assignments. The system administrator retains recovery access.
Public examples remain read-only; local import and export work on copies.

A managed model currently has one dataset with the same ID. Shared dataset
aliases are not supported. Deleted IDs cannot be reused, preventing old grants,
documents or history from attaching to unrelated new data.

Cloning a protected model inherits its workspace, grants and custom roles before
the copied data becomes available. Legacy service reader/writer tokens therefore
cannot access the private clone. Its filters receive the new model ID; event and
session items remain unchanged. Model documents and saved configuration history
stay with their original model. Cloning a public example or an unscoped model
retains the legacy access behavior until you assign explicit grants.

`/api/v1/models/{id}/filters` is the model-owned route to existing dataset filters;
the old dataset route remains compatible. Shared and personal visibility are
checked on both routes. Sorting metadata is retained; the API's existing time
and stable-ID query ordering remains unchanged. Legacy user/timeline filter files
keep their expression semantics and are not converted silently into API searches.

Model documents live in isolated private directories and are available through
`/api/v1/models/{id}/config-files`. Model administrators cannot use the global
`/config-files` API to edit shared deployment configuration. Saves remain atomic,
preserve original YAML text, and require the document's `ETag` in `If-Match`.
Registered deployment directories are available only through the global API to
system administrators; model-scoped document APIs never enumerate those roots.

Saved model configuration history is available through `/models/{id}/versions`.
It contains configuration only. Loading an older revision creates a draft for
review; saving configuration does not mean a deployment has been restarted.

## Commercial and exempt eligibility

Commercial eligibility is independent of model authorization. An exemption never
grants access to another model. System administrators can configure workspace
entitlements through `/workspaces/{id}/entitlement`, using its own `ETag`:

```json
{
  "mode": "exempt",
  "status": "active",
  "eligibilityCategory": "researcher",
  "verificationStatus": "verified",
  "features": {"ai": true}
}
```

Modes are community, commercial and exempt. Exempt categories include student,
researcher, charity, nonprofit organization and other approved cases. Exempt access requires verified
eligibility. Optional expiry, suspension and the AI feature flag are enforced
separately from model-admin permission. The current entitlement gate controls AI;
it is not a billing service or an automatic eligibility verification service.

The API category for nonprofit organizations is `nonprofit`. New writes reject
superseded preview categories. Operators must review preview entitlements and
assign an appropriate current category; they are not converted automatically.

New workspaces start with active community eligibility and `features.ai: true`.
AI still requires operator-configured providers and a model administrator. Set
the feature to false or suspend the entitlement to disable it for a workspace.

The [Commercial and Exempt Use License](../LICENSE) defines free-use eligibility
and when a paid agreement is required. Workspace settings do not grant a legal
license or verify a purchase. See the [licensing guide](commercial-licensing.md).
