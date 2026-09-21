## OpenBEXI Timeline: A Customizable, Data-Driven Interactive Gantt Chart

## Overview
* OpenBEXI Timeline offers a highly customizable user interface along with a data-driven interactive Gantt chart, designed for the effective visualization of temporal data.

## Docker Deployment
Build the current source with `docker build -t openbexi-timeline .`, then run `docker run --rm -p 127.0.0.1:8442:8442 -v openbexi-data:/data openbexi-timeline`. Open `http://localhost:8442/demos.html`. The container serves HTTP behind your TLS reverse proxy; configure API tokens to enable managed-data access. See [security and deployment](docs/security.md).

<!-- LIVE_DEMOS:START -->
## Live Demos

These are **local interactive demos**. Install dependencies with `npm install`, then run `npm run demo` and open a dataset using the links below. The default server listens only on your computer; these links are not public hosted demos.

Every dataset uses the same page, renderer, and Timeline / Table / vertical Split controls. Search works locally. Dataset selection, source format, bands, colors, highlights, and time scales come from [the JSON catalog](demos/catalog.json) and its model files.

Each demo starts with the original timeline toolbar, with no heading or dataset selector above it. The layout keeps 75% of the window width for the timeline views and reserves 25% for descriptors, the calendar, and other panels. Height adapts to the window with scrolling inside each area. Overview mirrors the normal layout with compact events, proportional session bars, and a visible-range highlight; model settings can magnify selected time intervals.

| Demo | Description | Configuration | Visual reference |
| --- | --- | --- | --- |
| [Operations sample](http://localhost:8780/demos.html?demo=default-dataset) | Sessions, milestones, source colors, and maintenance and verification windows. | [Dataset](json/test-data/default-dataset.json) · [Model](models/demos/default-dataset.json) | [PNG](json/test-data/default-dataset.png) |
| [Dinosaurs](http://localhost:8780/demos.html?demo=dinausaurs) | Dinosaur lifespans on a numeric axis measured in millions of years ago. | [Dataset](json/test-data/dinausaurs.json) · [Model](models/demos/dinausaurs.json) | Not supplied |
| [Satellite ephemeris](http://localhost:8780/demos.html?demo=ephemeris) | Orbital visibility sessions grouped by satellite. | [Dataset](json/test-data/ephemeris.json) · [Model](models/demos/ephemeris.json) | Not supplied |
| [JFK chronology](http://localhost:8780/demos.html?demo=jfk) | A minute-scale historical chronology with highlighted reference windows. | [Dataset](json/test-data/jfk.json) · [Model](models/demos/jfk.json) | [PNG](json/test-data/jfk.png) |
| [Claude Monet](http://localhost:8780/demos.html?demo=monet) | Life events, painting periods, original colors, and a secondary age scale. | [Dataset](json/test-data/monet.json) · [Model](models/demos/monet.json) | [PNG](json/test-data/monet.png) |
| [Religious history](http://localhost:8780/demos.html?demo=religions) | BCE/CE dates, duration and event bands, and overview context. | [Dataset](json/test-data/religions.json) · [Model](models/demos/religions.json) | [PNG](json/test-data/religions.png) |
| [Space exploration](http://localhost:8780/demos.html?demo=space_exploration) | A month-scale view with a yearly overview of the supplied space-history events. | [Dataset](json/test-data/space_exploration.json) · [Model](models/demos/space_exploration.json) | [PNG](doc/openbexi_timeline_space_exploration.PNG) |

Append `&view=table` or `&view=split` to open that view directly. See the [demo guide](docs/demos.md) for source formats, model options, validation, and portable hosting instructions.

Regenerate this list after editing the catalog with `npm run demos:readme`. Run `npm run test:demos` to validate all catalog entries, data imports, scene geometry, view switching, and local HTTP links.
<!-- LIVE_DEMOS:END -->

## REST API and validation

With JDK 17+ and Maven installed, run `npm run api` and open `http://localhost:8781/docs/api.html`. API v1 provides dataset/model discovery, paginated event and session queries, and authorized CRUD for editable datasets and saved filters. Catalog examples remain read-only and can be cloned. Numeric axes use their actual units, including Ma. See [API setup and examples](docs/rest-api.md) and the [OpenAPI contract](swagger/openapi-v1.json).

Models and catalogs are validated against shared [JSON schemas](schemas/demo-model.schema.json). Run `npm run demos:validate`, `npm run test:demos`, `npm run test:browser`, and `mvn verify`. GitHub CI repeats these checks, verifies generated files, and audits dependencies. The [browser guide](docs/browser-tests.md) explains screenshot baselines; the [security guide](docs/security.md) records dependency updates and audit commands.

## Visualization Examples
<img src="https://raw.githubusercontent.com/arcazj/openbexi_timeline/master/doc/openbexi_timeline_space_exploration.PNG" />
<img src="https://raw.githubusercontent.com/arcazj/openbexi_timeline/master/doc/openbexi_timeline_example.PNG" />

## Contribution & Support
Join us in enhancing OpenBEXI Timeline by contributing towards feature development, performance optimization, bug fixes, and more. Your involvement helps us continuously improve and expand the project's capabilities.

## Copyright and Licensing
OpenBEXI_Timeline is available under the GNU License.
