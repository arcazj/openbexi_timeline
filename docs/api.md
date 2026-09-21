# OpenBEXI Timeline REST API

API v1 runs at `/api/v1` in the Java server. The browser application version is 1.1.

- [Setup, authentication, CRUD examples, and storage semantics](rest-api.md)
- [Offline endpoint reference and optional live public-query explorer](api.html)
- [OpenAPI 3.1 contract](../swagger/openapi-v1.json)
- [Legacy Swagger 2.0 contract](../swagger/openbexi_timeline_swagger.yaml)

The new contract is generated from `tools/build-api-spec.mjs`. Run `npm run api:spec` after a contract change and `npm run api:spec -- --check` in validation.

Public examples support discovery and queries. Editable datasets require a configured Bearer token and use safe individual-record operations and whole-dataset ETags. A writer may manage events, sessions, and saved filters; an administrator may also create/delete datasets and replace models. Legacy MongoDB, Kafka, and HTTP data sources are not advertised as writable repositories by this API version.
