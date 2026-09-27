# Connected navigation and toolbar corrections

This is an earlier checkpoint. The [version 2 evidence](../v2/README.md) records
the later full-window pagination and interaction corrections. The current buffer
spans seven viewport widths, with a longer cancellable coast and loading controls;
vertical rows use pagination.

This public summary describes generic behavior and regression coverage. Private
deployment screenshots, event data, source identifiers, endpoints, user settings,
and raw debugger observations are kept outside versioned documentation.

## Changes

Connected normalized records previously entered the legacy timer-based drag path.
File and connected snapshots now share animation-frame dragging and brief,
elapsed-time deceleration. New navigation cancels old motion; reduced motion
disables continuation.

Repeated drags could move a three-viewport band far enough to expose the scene
background. Backgrounds, ticks, and events now use the same bounded buffer of
five viewport widths. Completed long gestures recenter while preserving real
timestamps; short gestures reuse the scene. Incoming snapshots wait until
dragging and continuation finish.

Search retains the original magnifying-glass icon and input. An active query
reveals independent Highlight matches and Show only matches checkboxes, Fit
matches, and Clear search. Counts and diagnostics are collapsed in Search details.
Loading, errors, and partial coverage retain compact visible feedback. Clearing
returns focus to the input and collapses the contextual actions.

The title has padding, room to wrap, and a 36-pixel minimum height. Connected
panels retain their configured height; dense rows scroll above the overview.

## Verification

The implementation checkpoint passed 109 JavaScript tests and all seven existing
browser drag regressions. Local HTTP/SSE checks exercised repeated pans, both
Auto settings, both visibility modes, checkbox independence, cancellation,
reduced motion, details, and narrow layouts without page errors. All 303 sampled
movement frames retained background coverage. Raw captures remain private.

The JavaScript regressions use public models and synthetic provider responses:

```sh
node --experimental-vm-modules --test tests/timeline-results.test.mjs tests/timeline-interactions.test.mjs
```

The existing browser regression is `tests/browser/drag-performance.spec.mjs`.
Browser checks at the implementation checkpoint used an installed Chromium
build. The locked browser was unavailable, so the complete historical screenshot
comparison suite remains unverified; historical baselines were not changed.

[Public fixture captures from phases 2–4](../phases-2-4/README.md) document an
earlier implementation checkpoint. They are not screenshots of these final
toolbar corrections. Future shareable captures must use public or synthetic data.
