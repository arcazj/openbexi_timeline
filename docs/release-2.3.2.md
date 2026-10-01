# OpenBEXI Timeline 2.3.2

This patch makes the two menu bars consistent across screen sizes and makes
loading, completion and failures easier to distinguish.

## Menu bars and status

- Exactly two rows contain the controls. Latest data and previous/next activity
  follow Search when space permits, followed by a separator, Auto scale and
  Lock current view. They move to the secondary row on smaller screens, with
  horizontal scrolling within each row.
- The secondary filter group is Calendar, Filter: \<filter name\>, Filters,
  a separator and Timeline details. A separator also divides 3D and Settings.
- Status shows orange Loading… or Searching… during work, green Ready after
  successful completion, red Error for failures and gray Cancelled when stopped.
  Partial data, data limits and interrupted connections stay orange. Tooltips
  and reports include item counts, search progress and recovery details.
- Status and Timeline details toggle the same report; a second click closes
  it. Keyboard access and cancellation remain available during loading.
- High contrast distinguishes icons, controls, separators and interaction
  states in both bars while preserving the status colors.
- The Narrow time window button is removed. Wheel and keyboard zoom narrow
  the interval when loading reaches a data limit.

## Documentation and upgrade

README contains a short introduction, setup and guide links. The documentation
index, Markdown and HTML user guides, demo resources and application captures
describe the current behavior; release history stays in dedicated notes.

Update the browser assets and server package together. Existing models,
datasets, filters and saved preferences remain supported. Package, browser,
Help and Maven versions are **2.3.2**; the API schema remains **1.0.0**.

`npm run release:source` creates
`dist/openbexi-timeline-2.3.2-source.tar.gz` and its SHA-256 checksum from the
reviewed public-file manifest.

## Validation

- JavaScript suite: **268 passed**. The documentation generator and Help checks
  also passed after the documentation and version updates (**11 tests**).
- Browser checks cover both menu rows, resizing and phone-width scrolling,
  keyboard focus, filters, search, loading, cancellation and recovery. The
  status suite passed **12 cases** across all five themes, including High contrast.
  All **28** catalog screenshot comparisons passed against reviewed captures.
- Static-site build and verification: **14 demo flows passed** across seven
  demos at desktop and narrow widths. The four dense/connected gallery capture
  scenarios also passed.
- Maven verification: **84 tests passed**, with **34 existing disabled tests**
  skipped and no failures, using JDK 21.
- Generated schemas, demo resources and API specification passed their checks;
  all seven demo models validated. Documentation checks covered **299 local
  links**, consistent version metadata and the concise README.
- npm and the **24 Java runtime dependencies** reported no known advisories.

Previous release: [2.3.1](release-2.3.1.md).
