# OpenBEXI Timeline

Version **2.7.0** · [Release notes](docs/release-2.7.0.md).

Explore events, sessions and activity histories in Timeline, Table, Split and 3D
views. Search, filter and group records, navigate through time, and inspect their
details. Use local JSON datasets or connect to a Java server for progressive
loading and managed data.

Save named views, share a demo's exact time range and filters, and export filtered
table results as CSV. On small screens, **More** keeps secondary controls within reach.

## Quick start

**Windows:** download the installer from the [latest release](https://github.com/arcazj/openbexi_timeline/releases/latest).
It includes Java and browser dependencies. See [Windows installation](docs/windows-installation.md).

Install **Node.js 24**, then run:

```sh
npm ci
npm run demo
```

Open [the local demo](http://localhost:8780/demos.html). The supplied datasets run
without a Java server. For connected data, see [server setup](docs/connected-diagnostics.md)
and [the REST API guide](docs/rest-api.md).

Server logs default to readable INFO summaries and WARNING/SEVERE diagnostics.
**Settings > Trace level** selects INFO (all three levels), WARNING (warnings and
errors), or ERROR (errors only) for this browser's timeline messages and requests.
The choice is saved locally and takes effect without reloading records. Settings
also displays the installed UI version above the sections.
GET URLs and scan details require DEBUG/FINE logging; see [logging options](docs/connected-diagnostics.md#log-levels-and-readable-summaries).

<!-- LIVE_DEMOS:START -->
## Live demos

[Operations sample](https://arcazj.github.io/openbexi_timeline/demos.html?demo=default-dataset) ·
[Dinosaurs](https://arcazj.github.io/openbexi_timeline/demos.html?demo=dinausaurs) ·
[Satellite ephemeris](https://arcazj.github.io/openbexi_timeline/demos.html?demo=ephemeris) ·
[JFK chronology](https://arcazj.github.io/openbexi_timeline/demos.html?demo=jfk) ·
[Claude Monet](https://arcazj.github.io/openbexi_timeline/demos.html?demo=monet) ·
[Religious history](https://arcazj.github.io/openbexi_timeline/demos.html?demo=religions) ·
[Space exploration](https://arcazj.github.io/openbexi_timeline/demos.html?demo=space_exploration)

Explore the [gallery](https://arcazj.github.io/openbexi_timeline/) in your browser. The [demo guide](docs/demos.md#live-demos) lists datasets, models and screenshots.
<!-- LIVE_DEMOS:END -->

## Documentation

- [User guide](docs/help-guide.md): controls, search, filters, status and Settings.
- [Models and datasets](docs/demos.md) and [the live model editor](docs/model-editor.md).
- [Embed a timeline](docs/embedding.md) in another application, with a satellite example.
- [Deployment](docs/security.md) and [development and testing](docs/development.md).
- [Documentation index](docs/README.md): all guides and reference material.

## Screenshots

[Dataset gallery](docs/ui/overview/README.md) ·
[Wide menu bars](docs/ui/toolbar-layout/wide.png) ·
[Narrow menu bars](docs/ui/toolbar-layout/narrow.png) ·
[High contrast](docs/ui/settings/contrast.png)

## License

See the [license](LICENSE) for paid commercial use and free-use exemptions.
The [licensing guide](docs/commercial-licensing.md) explains eligibility and contact
details. [Third-party notices](docs/third-party-notices.md) also apply.
