# OpenBEXI Timeline 2.2.1

Version 2.2.1 improves selection and makes REST and live timeline loading follow
the configured connector.

## Changes

- Place the time cursor above the visible span, with its tip on the timeline edge.
- Show each table title's icon, falling back to the event or session color when
  the icon is absent or cannot load.
- Selecting an event or session in Timeline or Table smoothly centers its
  timestamp or midpoint while preserving the time span and selection glow.
  Another gesture interrupts the move; reduced motion makes it immediate.
- Draw selected activity above the Overview shading with a gold fill, dark
  outline and a minimum visible width.
- Stop REST requests after the initial view and bounded adjacent buffers load.
  Reuse cached intervals, cancel obsolete work, and ignore stale responses.
  Navigation checks expired visible windows; **Refresh** checks the retained
  windows. ETags avoid rebuilding unchanged snapshots.
- Subscribe to revision notifications on `secure_sse:<port>`. Reconnect with the
  last event ID and reconcile additions, changes and deletions without duplicate
  records or resetting the selected timestamp and zoom.
- Keep loading, empty intervals and failed updates distinct. Offer **Go to latest
  data** when another observed timestamp is available.

## Configuration and compatibility

Keep transport settings in the existing source `connector`, for example
`secure_sse:8441|secure:8442`. No `web_ui` section is required to serve a timeline.
`secure:<port>` uses REST; `secure_sse:<port>` enables live notifications and
finite JSON requests on the SSE sessions route. Restart the Java service and
reload the browser to use both sides of the updated protocol.

Existing models and static demo data remain supported. The API v1 contract stays
at 1.0.0. Browser, package, Help and Maven versions are 2.2.1.

Loading remains bounded: 32 pages per visible interval, four per neighbor, and
at most four retained windows. Coverage warnings remain visible when limits are
reached. Live changes use a shared file metadata inventory checked once per
second; an incomplete scan cannot guarantee deletion reconciliation. See
[loading and refresh behavior](progressive-loading.md) for bounds and limitations,
and the [Help guide](help-guide.md) for controls.

## Validation

Regression checks cover selection and layout, icons and fallback colors, finite
loading, cache reuse, conditional refresh, stale responses, SSE revisions and
deletion reconciliation. Java HTTP tests exercise ETags, SSE reconnection and
file changes against an embedded server. Browser checks use synthetic public
fixtures at desktop and narrow widths.

Checks completed on Windows:

- `npm test`: 216 passed. A follow-up run passed 31 focused cases, including the
  additional regression for replacing a selection during animation.
- Maven verification: 69 passed, 34 environment-dependent tests skipped. The
  updated HTTP refresh test and final 2.2.1 JAR build also passed.
- Chromium: 40 checks passed across activity focus, all seven demos, connected
  loading, details and navigation at desktop and narrow widths. Fourteen
  Split/Help baselines were reviewed and passed comparison without updates.
- Demo validation, generated README checks, the seven-demo Pages build, and
  the 539-file source archive completed successfully.

The source archive uses the explicit public-file manifest. Private deployment
YAML, generated operational data, local logs and screenshots stay outside it.
This patch updates local release metadata; publishing and tagging are separate
actions. Earlier changes are in the [2.2.0 notes](release-2.2.md).
