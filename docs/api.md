# OpenBEXI Timeline REST API

API v1 runs at `/api/v1` in the Java server. Its contract version is independent of the application release.

- [Setup, authentication, CRUD examples, and storage semantics](rest-api.md)
- [Offline endpoint reference and optional live public-query explorer](api.html)
- [OpenAPI 3.1 contract](../swagger/openapi-v1.json)
- [Legacy Swagger 2.0 contract](../swagger/openbexi_timeline_swagger.yaml)

The new contract is generated from `tools/build-api-spec.mjs`. Run `npm run api:spec` after a contract change and `npm run api:spec -- --check` in validation.

Public examples support discovery and queries. Editable datasets require a Bearer token and use individual-record operations and whole-dataset ETags. [Model grants](model-access.md) authorize readers, writers and administrators per model. Only administrators may edit model/YAML configuration; optional [AI assistance](ai-assistance.md) also checks workspace eligibility. Ownership and access metadata never alter the [event/session JSON structure](event-session-contract.md). Legacy MongoDB, Kafka, and HTTP data sources are not advertised as writable repositories by this API version.
