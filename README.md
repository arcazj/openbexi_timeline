## OpenBEXI Timeline: A Customizable, Data-Driven Interactive Gantt Chart

## Overview
* OpenBEXI Timeline offers a highly customizable user interface along with a data-driven interactive Gantt chart, designed for the effective visualization of temporal data.

## Docker Deployment
* To utilize OpenBEXI Timeline, deploy it using Docker by downloading the image from its Docker Hub repository: OpenBEXI_Timeline Docker Repository.
* For access, launch Edge, Firefox, or Chrome and navigate to either:
** https://localhost:8442/openbexi_timeline.html

<!-- LIVE_DEMOS:START -->
## Live Demos

These are **local interactive demos**. Install dependencies with `npm install`, then run `npm run demo` and open [the demo gallery](http://localhost:8780/demos.html). The default server listens only on your computer; these links are not public hosted demos.

Every dataset uses the same page, renderer, and Timeline / Table / vertical Split controls. Search works locally. Dataset selection, source format, bands, colors, highlights, and time scales come from [the JSON catalog](demos/catalog.json) and its model files.

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

## Visualization Examples
<img src="https://raw.githubusercontent.com/arcazj/openbexi_timeline/master/doc/openbexi_timeline_space_exploration.PNG" />
<img src="https://raw.githubusercontent.com/arcazj/openbexi_timeline/master/doc/openbexi_timeline_example.PNG" />

## Contribution & Support
Join us in enhancing OpenBEXI Timeline by contributing towards feature development, performance optimization, bug fixes, and more. Your involvement helps us continuously improve and expand the project's capabilities.

## Copyright and Licensing
OpenBEXI_Timeline is available under the GNU License.
