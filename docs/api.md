# OpenBEXI Timeline API reference

This is an offline reference for the checked-in [Swagger 2.0 specification](../swagger/openbexi_timeline_swagger.yaml), whose API version is **1.0.0**. It is separate from the browser application's version 1.1. The source declares HTTPS, host `openbexi_timeline.swagger.io`, and base path `/`; that declaration does not confirm a reachable service. Local file-backed demos do not provide this API.

## Get sessions by zone

```text
GET /sessions/{startDate}/{endDate}/{filter}/{search}/{userAccess}
```

Returns sessions between the requested start and end dates. Operation ID: `getSessionByZone`. Response media type: `application/json`.

All parameters are required path parameters. Encode each value as a URL path component when constructing a request.

| Parameter | Type | Description |
| --- | --- | --- |
| `startDate` | string, date-time | Start date in ISO format. |
| `endDate` | string, date-time | End date in ISO format. |
| `filter` | string | Criteria used to filter events. |
| `search` | string | Keyword used to search events. |
| `userAccess` | string enum | `read`, `write`, or `admin`, as declared by the contract. This field is not proof of server authorization. |

The specification does not define a filter expression grammar or an empty-value convention for these required path parameters.

## Responses

| Status | Meaning | Body |
| --- | --- | --- |
| `200` | Successful operation | `Response` object below. |
| `400` | Invalid input | No schema specified. |
| `401` | Unauthorized | No schema specified. |

`Response` declares three properties: `status` (string), `message` (string), and `data` (one `Object`, not an array in this specification). No required-property list is provided.

`Object` declares `id` (integer, int64), `type` (string), `label` (string), and `startDate` (string, date). The schema declares `date` here, whereas request bounds use `date-time`.

## Security definitions

The specification includes an OAuth 2 implicit-flow definition named `sessionstore_auth`, with authorization URL `https://localhost:8443/` and scopes `write:sessions` and `read:sessions`. It also defines an API-key header named `api_key`. Neither a global nor an operation-level security requirement is attached to this endpoint in the checked-in file; deployment-specific authentication behavior must be verified against the actual server.

## Scope

Only the GET operation above is defined. Comments mention other operations, but no POST or DELETE contract is supplied. This page does not provide a “Try it out” action or claim that a backend is running.

[Open the offline HTML reference](api.html) or [download the original specification](../swagger/openbexi_timeline_swagger.yaml).
