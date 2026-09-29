# OpenBEXI Timeline 2.2.3

This update keeps Overview band colors aligned with the main view, fixes sorting
when creating server filters, adds saved 3D perspective and appearance controls,
and searches older source files when a query has no loaded matches.

- Overview draws each source band's background color, including grouped bands and
  color changes. The docked SVG and canvas projections use the same source colors.
- New server filters save the selected **Sort by** value with the expression.
  Existing presets keep their grouping through selection and reload.
- Status buttons sit on the right of the toolbar and open an explanation, source
  warnings and coverage details. A separate orange **Loading items…** indicator
  disappears when loading ends. Explanation buttons also work from the keyboard.
- **Settings → Perspective** provides OrbitControls rotation, pan and camera zoom,
  numeric camera controls, lighting, metalness and roughness. **Save perspective**,
  **Restore saved** and **Reset to defaults** manage browser preferences per user
  and model. See the [Perspective guide](perspective.md).
- Page loads always start in **2D**, including with older saved 3D preferences.
  Enabling 3D restores the saved view or the reference preset: -57° horizontal,
  16° vertical, 30° field of view, ambient intensity 0.3, directional intensity
  1.8, metalness 0 and roughness 0.75. Reset and Restore keep the active mode.
- The view span and activities use local studio reflections for metallic surfaces.
  Icon artwork retains its colors. Monet and Dinosaurs use the same fitted preset,
  retaining their date, age and geological scales.
- Dragging an activity pans the timeline without opening Data or recentering it.
  Clicking still selects the activity and moves it into view.
- Expanded toolbar controls remain clickable while loading, including Cancel
  search on narrow screens; the canvas stays below the toolbar.
- A query with no loaded matches searches available history in bounded pages.
  The toolbar reports the date being checked, with **Stop search** immediately
  to its right. Searching keeps the view stable; finding a match centers it while
  retaining the query, filters, Sort by and zoom. Empty grouped results also keep
  their current time window. Cancellation and query changes ignore late replies.
- Historical searches respect source and user filters. They continue beyond the
  ordinary loading cutoff and report **Search incomplete** for unreadable or
  unsupported sources. A definitive no-match appears only after all available
  eligible history has been searched. See [Progressive loading](progressive-loading.md).

Restart the Java server and reload the browser after updating. Static deployments must
also include the OrbitControls module; the Pages build copies it automatically.
Private configurations, operational data and validation outputs remain local.

## Validation

- JavaScript: 246 tests passed across the full suite and targeted reruns after
  the grouping fix.
- Historical search: all 40 browser checks passed at desktop and narrow widths,
  including a May 21 match beyond 32 pages, stable grouped ranges, progress and
  Stop placement, query changes, cancellation, unreadable sources, HTTP failures
  and compatibility with older servers. Fixtures use synthetic records.
- Earlier browser validation: 37 focused checks passed at desktop and narrow widths. These cover
  perspective, saved preferences, metallic rendering, icon colors, labels,
  selection, sorting, status controls, camera previews, loading cancellation and
  drag reuse. One duplicate narrow drag case was intentionally skipped. Pixel
  comparisons confirm that switching back from 3D restores the original 2D view.
- Maven `verify`: 81 tests passed; 34 existing legacy tests were skipped.
  The 2.2.3 JAR and runtime dependencies were built successfully.
- IntelliJ IDEA build passed with existing deprecation warnings.
- Static site: all 14 demo flows passed under a subdirectory, covering seven
  demos at desktop and narrow widths, including 3D and the model editor.
- Demo models, generated validators and the generated README section passed
  their consistency checks.

Earlier changes: [2.2.2](release-2.2.2.md).
