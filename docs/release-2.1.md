# OpenBEXI Timeline 2.1.0

Version 2.1.0 improves activity navigation, automatic scaling and 3D readability, and publishes all seven public demos on GitHub Pages.

## Changes

- Search centers the first matching activity. Find previous activity and Find next activity sit after Lock current view and navigate in both time directions. Navigation preserves the current scale unless an activity needs a wider span to remain visible.
- Auto scale uses activity density to expand or compress intervals and update time labels. Empty connected windows can seek earlier activity; locking the view preserves its range.
- Overview gives search matches stronger highlights and supports wheel zoom in both directions. The toolbar keeps loading status and cancellation available during connected searches.
- The plot remeasures the toolbar after quick loading-state changes, preventing an empty gap when a loading row disappears within the same render.
- Resync centers the current time. The reference view remains available through Help.
- A found activity glows without growing. Compact 3D bars share rows, retain their model typography, and show full labels with an angled camera. Shift-drag rotates the view. Pagination remains available when records cannot fit.
- Model startup follows explicit HTML `loadModel(...)`, then the model configured in server YAML, then a built-in default. Static pages with explicit local models continue to work without the Java server. See the [model startup guide](demos.md#choosing-a-model-at-startup).
- The [live gallery](https://arcazj.github.io/openbexi_timeline/) includes Operations, Dinosaurs, Satellite ephemeris, JFK, Monet, Religious history and Space exploration. A GitHub Actions workflow builds the required browser dependencies and tests the artifact under the repository URL before deployment.

## Validation

Release checks cover generated schemas, demo models and README links, the OpenAPI specification, JavaScript tests, Java tests and dependency audits, and the full Chromium browser suite. The Pages smoke check runs all seven demos at 1440 × 900 and 800 × 700, including asset loading, record counts, views, search, navigation, scaling, 3D and Help. After deployment, the same check verifies the public site and its exact commit.

Local validation passed 184 JavaScript tests, 59 Java tests (34 environment-dependent skips), and the browser checks. The release suite includes 131 browser cases and seven intentional duplicate-case skips. The 28 screenshot baselines and 18 documentation captures were reviewed and refreshed for the new controls. The npm audit and the audit of 24 Maven runtime dependencies reported no known advisories.

The connected earthquake example is checked with `-data_conf yaml/sources_earthquake.yml`, including a `volcano` search, previous/next activity, compact 3D and narrow layouts. Local source data and validation captures are kept outside the public release.

Run the documented checks in the [browser guide](browser-tests.md) and [demo hosting guide](demos.md#hosting-portability). GitHub Actions provides the results for the tagged commit.

## Release contents and compatibility

Package, Maven, browser source and Help identify this release as **2.1.0**. The REST API contract remains **1.0.0**. Existing explicit model selection remains supported.

`npm run release:source` creates the reviewed source archive and SHA-256 checksum. Its 442-file manifest excludes local deployments, credentials, runtime output and private captures. The existing [GPL license](../LICENSE) and [third-party notices](third-party-notices.md) apply. Previous changes are recorded in [2.0 release notes](release-2.0.md).
