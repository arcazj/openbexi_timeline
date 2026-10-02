# Embed a timeline in another application

Use a small JavaScript host API and an iframe containing the existing renderer.
Each instance owns its CSS, Three.js version, controls and WebGL context. The host
supplies JSON data and handles authentication and satellite selection. Timeline,
Table, Split and the 3D control remain available. Embedded records are read-only;
the Model and YAML editor is unavailable inside the frame.

Try the [satellite example](../demos/embedded-earth-orbit.html) after `npm run demo`
at <http://localhost:8780/demos/embedded-earth-orbit.html>. It uses fictional data.

## Host setup

Run `npm ci` and `npm run pages:build`. Serve the complete `dist/pages` directory
under a stable path, for example `/vendor/openbexi-timeline/`. Keep its relative
directories, dependencies, license and notices together. This is a browser
integration; no Java server or npm package publication is required.

```html
<div id="history" style="height:440px;min-height:300px"></div>
<script type="module">
  import {createTimelineEmbed} from
    '/vendor/openbexi-timeline/src/openbexi_timeline_embed.js';

  const timeline = createTimelineEmbed(document.getElementById('history'), {
    title: 'Satellite history',
    data: {events: [
      {id:'launch:900001', start:'2026-02-05',
       data:{title:'Example launch'}, render:{color:'#237ab9'}}
    ]},
    onSelect: ({id, record}) => console.log('Selected', id, record),
    onStatus: ({state, message}) => console.log(state, message),
    onError: error => console.error(error.message)
  });
  await timeline.ready;
  await timeline.setRange('2026-01-01', '2027-01-01');
  // Call timeline.destroy() when the component unmounts.
</script>
```

Give the container an explicit height. It can resize, and several containers can
coexist. Serve over HTTPS or localhost using a browser with WebGL and import-map
support. The host does not need Three.js or an import map of its own.

For a different origin, copy the dependency-free host module into your project
and pass `url: 'https://your-timeline-host/openbexi_timeline_embed.html'`. The
frame loads its own assets; there is no cross-origin module import in the host.
Configure that server's CSP `frame-ancestors` and the host's CSP `frame-src` for
the intended origins. An `X-Frame-Options: SAMEORIGIN` response prevents this
cross-origin setup. Host and frame validate the sender window, exact origin and
instance channel, following the [postMessage guidance](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage#security_concerns).
This isolates application dependencies; it is not a sandbox for untrusted code.

## API

`createTimelineEmbed(container, options)` returns immediately. Options are `url`,
`title` (accessible frame title), `model` (an existing model object), `data`,
`view`, `appearance`, `timeoutMs` (default 30000), and the callbacks below.
Omit `model` to use a basic timeline. An explicit model controls the timeline
title, bands, colors, grouping and time axis; its geometry fills the container.
To change models, destroy the instance and create another.

| Member | Behavior |
| --- | --- |
| `ready` | Promise resolving to `{count, view, range}` after initialization. `count` includes sessions and nested activities. |
| `setData(payload)` | Replace a complete JSON snapshot, retaining the current view, range and surviving selection. Invalid input rejects and keeps the last valid data. |
| `setRange(from, to)` | Navigate using ISO date strings or epoch milliseconds, including with a numeric model axis. |
| `selectEvent(id)` | Focus a unique string/numeric item ID (respecting the model's ID mapping) without echoing `onSelect`. Reject missing or ambiguous IDs. Existing filters still apply. |
| `setView(value)` | Choose `timeline`, `table` or `split`. |
| `setAppearance(value)` | Choose `default`, `apple`, `windows`, `minimal` or `contrast` for this frame. |
| `destroy()` | Remove the frame and its resources; reject pending commands. Safe to call twice. |
| `iframe` | The DOM element, for layout or accessibility integration. |

Commands return promises and run in order, including calls made before `ready`.
Handle rejections and `onStatus` errors in the host's existing status area.
Initialization failures also call `onError` and remove the failed frame. Call
`destroy()` explicitly when unmounting; removing the parent DOM alone does not
remove the SDK's message listener.

- `onSelect({id, record, path})`: a user opens a timeline/table record. `record`
  is a copy of the original JSON item, including unknown fields and nested
  metadata. `id` follows the model's ID mapping, falling back to the renderer's
  generated ID for items without one. `path`, such as `['events', 0, 'activities', 1]`, identifies its
  location in the supplied snapshot without adding fields to it.
- `onRangeChange({from, to})`: the displayed range changes, including changes
  requested through the API. Both bounds use epoch milliseconds. Compare bounds
  before synchronizing another timeline to avoid feedback loops.
- `onStatus({state, message})`: a host command is `loading`, `ready` or `error`.
  The ordinary timeline status control also reports search/rendering activity.

The [event/session contract](event-session-contract.md) remains unchanged.
Supply legacy `events` with nested `activities`, or snapshot `records` with
`parentSessionId`. A model can specify `dataSource.recordsPath`, field mappings
and numeric dates. Keep the same source format for subsequent `setData` calls.
The renderer normalizes an internal copy; original payloads and selection
callbacks retain their fields, types, nulls, IDs and unknown metadata.

The frame does not load a model's configured dataset/provider URL. Fetch data in
the host with its existing credentials, then call `setData`. Never put tokens in
frame URLs or model objects. Model authorization remains the host/backend's
responsibility; hiding editing controls does not grant or enforce server access.
Use trusted models and only send data to a timeline host you control or trust.

## Earth Orbit integration

The adapter follows [Earth Orbit's launch loader](https://github.com/arcazj/openbexi_earth_orbit/blob/92af820c967ad758febe6f7afc05edea10eaa601/js/ganttTimelineLoader.js)
and [re-entry timeline](https://github.com/arcazj/openbexi_earth_orbit/blob/92af820c967ad758febe6f7afc05edea10eaa601/js/reentryTimeline.js).
It accepts the launch array from `/api/launches` or `json/launches/launches.json`,
confirmed decays from `/api/decayed` or `json/decayed/decayed.json` (an array or
object of arrays), and optional current satellite records containing `decay`.

```js
import {earthOrbitTimelineData} from
  '/vendor/openbexi-timeline/src/openbexi_timeline_earth_orbit.js';

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}
const [launches, decayed] = await Promise.all([
  json('/api/launches'), json('/api/decayed')
]);
let catalog = earthOrbitTimelineData({launches, decayed, satellites});
const timeline = createTimelineEmbed(container, {
  model, data: catalog.data,
  onSelect: ({id}) => {
    const selected = catalog.selection.get(id);
    if (selected) onSatelliteSelected(selected);
  }
});
await timeline.ready;
// At the host's next catalog revision:
// const next = earthOrbitTimelineData({launches, decayed, satellites});
// await timeline.setData(next.data);
// catalog = next;
```

Here `satellites`, `container`, `model` and `onSatelliteSelected` come from the
host application. Wire `selected.satellite` to its existing satellite-selection
callback when available. For historical metadata-only objects, use
`selected.record` and `selected.noradId` to open details; an orbit position may
not exist. The selection map stays in the host and never becomes item metadata.

NORAD IDs remain strings, including six or more digits. Launches, confirmed
decays and predicted re-entry windows have distinct stable IDs and labels.
Confirmed dates take precedence over predictions for the same object. Predictions
retain their supplied range and confidence; day-only dates retain day precision.
`catalog.warnings` reports skipped records with invalid IDs or dates. Do not
silently treat predicted windows as confirmed re-entry times.

Refresh on catalog revisions, rather than every orbital animation frame. This
first integration accepts complete JSON snapshots; it does not provide a remote
streaming/patch transport. Large catalogs use the renderer's existing paging,
but each iframe and full snapshot still consumes memory. The example demonstrates
the integration in this repository; it does not replace Earth Orbit's existing UI.

The same [license](../LICENSE) and [third-party notices](third-party-notices.md)
apply to embedded distribution and use.
