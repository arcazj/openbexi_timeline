# Perspective settings

Open **Settings → Perspective** and enable **3D perspective**. The toolbar's
**2D or 3D view** control switches the same camera mode.

Every page load starts in **2D**, including after saving settings while in 3D.
Enable 3D to restore your saved viewpoint and appearance. Without saved settings,
the built-in preset below is used for all timelines, including Claude Monet and
Dinosaurs. **Adjust perspective** starts off.

## Default preset

| Setting | Value |
| --- | --- |
| Reference camera X / Y / Z | -2477.905 / 1596.207 / 1609.17 |
| Reference orbit target X / Y / Z | 0 / 749 / 0 |
| Horizontal / vertical angle | -57° / 16° |
| Camera zoom / field of view | 1 / 30° |
| Ambient light | White, intensity 0.3 |
| Directional light | White, intensity 1.8 |
| Light direction / elevation | -25° / 35° |
| Metalness / roughness | 0 / 0.75 |

These reference coordinates come from the supplied screenshot. The default camera
scales its distance and target to each board and fits the complete view span into
the available width and height. Camera coordinates therefore vary with window
size and layout. The default viewing angles stay the same. Monet keeps its date
and age scales; Dinosaurs keeps its scale in millions of years. Explicit model
camera and light settings can override the preset.

## Choose a viewpoint

Enable **Adjust perspective** to control the camera:

- Left drag rotates around the orbit target.
- Right drag or Shift-drag pans the camera and its target.
- The wheel or middle drag moves the camera closer or farther away.
- With touch, one finger rotates; two fingers pan and zoom.

The model's `rendering.camera.rotationSensitivity` still controls rotation speed;
its default is `0.002`.

Turn off **Adjust perspective**, or press **Escape** while the plot or settings
has focus, to return to timeline dragging and wheel navigation. Camera gestures
keep the timeline's time range, filters, selected record and loaded data.

Expand **Camera position and viewing angle** for numeric position, orbit target,
horizontal and vertical angles, zoom and field of view. Changes appear immediately.
The orbit target is the point around which the camera rotates. Camera zoom changes
the apparent size of the board; the timeline's time zoom remains a separate control.

## Lighting and surfaces

Expand **Lighting** to adjust ambient and directional light colors and intensity,
plus the directional light's horizontal direction and elevation. **Surface** sets
metalness and roughness for the view span, session and activity bars, event markers,
and icon supports.

- Metalness ranges from 0 for a nonmetal surface to 1 for metal.
- Roughness ranges from 0 for smooth reflections to 1 for a matte surface.

Metallic surfaces reflect a neutral studio environment generated locally when 3D
is enabled. No external reflection images are downloaded. Try metalness **1** and
roughness **0.2** for clear reflections. Surface colors remain those of the source
bands and records. Icon artwork and labels keep their colors without being darkened
by metallic lighting. Overview keeps the source band colors.

Roughness defaults to **0.75**. An explicitly configured legacy
`rendering.activity.shininess` initializes roughness using
`sqrt(2 / (shininess + 2))`, bounded to 0.04–1.

## Save and restore

**Save perspective** stores the 3D viewpoint, lights and surfaces for the current
user, model and page in this browser. It keeps **2D as the startup mode**. Saving
while in 2D retains the last 3D viewpoint. Old saved preferences that requested a
3D startup also open in 2D. Positions are relative to the board size so resizing
can preserve the chosen view.

**Restore saved** discards the current preview and restores the last saved settings.
**Reset to defaults** previews the fitted model camera and default appearance.
Both actions keep the current 2D or 3D mode.
Use **Save perspective** after resetting to make those defaults persistent.
Invalid stored values are ignored; a storage failure is reported inside Settings.

Implementation references: [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
and [MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html).
