# Record visuals in the shared timeline core

The dinosaur demo uses the same `OB_TIMELINE` scene, renderer, cameras, search, filters, table, overview, pagination and descriptors as every other model. There is no separate dinosaur viewer or dataset-ID branch. All dataset-specific periods, names, orientations, colors and asset mappings are configuration or content.

Open `demos.html?demo=dinausaurs`. **Scientific** selects the core orthographic camera; **Museum** selects its perspective camera. **Orbit** enables the existing camera controls. **Front view**, **Isometric view** and **Fit all records** restore useful viewpoints. Selecting a record uses the normal descriptor and focus path. Its artwork can move toward the viewer and enlarge while a connector retains its link to the unchanged occurrence bar. Reduced-motion preferences disable the selection animation.

The dinosaur model opts into the reusable **stage** presentation: horizontal translucent lanes recede into the scene, models stand upright above their occurrence bars, and a raised ruler and colored period ribbons frame the display. A diagonal, elevated camera shows the lane depth. This is a shared core option available to other datasets; ordinary models keep the existing board presentation.

In the overview, a name followed by `+N records` identifies a representative. Clicking expands the original members through the core explorer. Search, filters, tables, counts and the overview retain all records. Coeval records that cannot fit still use ordinary pagination. Visual clustering is independent of Auto scale: the dinosaur model keeps the time axis linear.

## Configuration

`rendering.recordVisuals` is optional. `enabled` defaults to `false`; omitted settings preserve existing models. Properties are validated in the browser, both model schemas and HBDS schema. Asset paths resolve from the application root; files within a manifest resolve relative to that manifest.

```json
{
  "rendering": {
    "recordVisuals": {
      "enabled": true,
      "manifest": "icon/survey/manifest.json",
      "keyField": "data.assetKey",
      "fallbackImage": "icon/survey/unavailable.svg",
      "width": 148,
      "height": 94,
      "gap": 14,
      "depth": 30,
      "maxModels": 16,
      "minimumModelPixels": 48,
      "clusterPixels": 170,
      "selectedScale": 1.55,
      "selectedLift": 95,
      "transitionMs": 280,
      "bandOpacity": 0,
      "presentation3D": "stage",
      "stageLaneDepth": 70,
      "stageSurfaceOpacity": 0.5,
      "stageRows": 3,
      "stageScale": 1.5,
      "label2D": "Scientific",
      "label3D": "Museum"
    }
  }
}
```

| Property | Default | Behavior |
| --- | --- | --- |
| `manifest` / `fallbackImage` | `null` | Same-origin local assets; no external hotlinking. |
| `keyField` / `caseInsensitive` | `data.title` / `true` | Exact field-to-manifest lookup; no genus guessing. |
| `imageField` | `null` | Optional record field containing a local image URL. |
| `rotation` | `[0,0,0]` | Default XYZ Euler rotation, radians; entries may override it. |
| `width` / `height` / `gap` / `depth` | `128` / `92` / `18` / `32` | Display geometry, independent of physical size. |
| `maxModels` / `minimumModelPixels` | `16` / `60` | Detailed model budget; other records keep images/placeholders. |
| `clusterPixels` | `0` | Projected midpoint bucket width; zero disables visual clustering. |
| `selectedScale` / `selectedLift` / `transitionMs` | `1` / `0` / `0` | Optional foreground selection without changing dates. |
| `bandOpacity` | `1` | Zero removes the opaque surface while retaining native panning. |
| `presentation3D` | `board` | `stage` uses horizontal display lanes and upright artwork in the existing perspective scene. Scientific/2D layout is unchanged. |
| `stageLaneDepth` | `100` | Lane depth in scene units, 40–400. Native row allocation reserves this space. |
| `stageSurfaceOpacity` | `0.22` | Opacity of the translucent lane surfaces, 0–1. |
| `stageRows` | `3` | Preferred number of balanced lanes, rounded to 1–8. Overlapping intervals allocate additional rows and native pages as needed. |
| `stageScale` | `1.5` | Initial artwork enlargement, 1–3; projected collision checks can reduce it to keep neighboring records accessible. |
| `label2D` / `label3D` | `Scientific` / `Museum` | Labels for existing camera modes. |

A manifest can serve any collection:

```json
{
  "version": 1,
  "notice": "Display sizes are normalized.",
  "entries": {
    "station-17": {
      "model": "station-17.glb",
      "image": "station-17.webp",
      "rotation": [0, 1.5707963267948966, 0],
      "label": "Survey module reconstruction",
      "source": "https://example.org/source",
      "creator": "Asset creator",
      "license": "CC0-1.0",
      "licenseURL": "https://creativecommons.org/publicdomain/zero/1.0/"
    }
  }
}
```

Image-only entries are supported. `kind: "schematic"` explicitly distinguishes a placeholder from an asset reconstruction. Unavailable models retain their image; missing manifests/images fall back to a neutral marker. Same-origin glTF dependencies are checked before parsing. Geometry and materials are cached and shared, loading is bounded, stale scene completions are ignored, and instances are released when the core rebuilds.

The `depth` value sets the artwork's base offset above a board presentation and, when positive, caps its initial normalized model depth in either presentation. Zero disables this cap. In a stage presentation, the loaded artwork's height determines its elevation so that its feet sit above the bar. Selection enlargement and inspection rotation can extend that envelope; collision checks follow the rotated bounds. If artwork cannot fit, the layout tries smaller sizes, then a compact marker; in extreme crowding the exact native bar and label retain access to the descriptor. No record is removed. The image cache holds at most 64 entries and releases unused textures; timeline posters are downsampled to 512 pixels while descriptors retain the original image.

Stage mode keeps the native timeline in the XY plane and uses Z as camera up. Model-local Y rotates toward world Z; source X coordinates and interval widths never move. `rendering.camera.yaw` turns around the stage and `pitch` measures elevation above it, in radians. Framing reserves space for the docked overview and bounds navigation above the floor. Saved board camera poses are ignored when a model changes to stage mode, while saved appearance preferences are retained. **Model view** restores the configured stage viewpoint.

Stage lanes, period ribbons and date rulers cover the prepared time buffer, so they continue toward the viewport edges while panning. Perspective activity labels use the bar's actual camera-visible interval, including intervals whose midpoint is offscreen. Homogeneous clipping handles both viewport edges, near/far planes and the docked overview boundary without shortening the native bar or modifying source dates. Scientific/2D visibility retains its existing behavior.

Model-response limits and cache byte counts measure downloaded model files, not total GPU memory. Decoded textures and external glTF buffers can use additional memory. The shipped dinosaur models are self-contained GLBs; representative high-resolution assets should be measured separately when adding another collection.

## Architecture

- `openbexi_timeline_record_assets.js`: exact mapping, local loading, normalized prototypes, cache and reference lifecycle.
- `openbexi_timeline_record_visuals.js`: decorations on native record markers, projected collision checks, LOD, foreground selection and media in the existing descriptor. It creates no renderer or camera.
- `openbexi_timeline_data.js` and `openbexi_timeline_adaptive.js`: reserve complete image/label footprints before existing row packing and pagination. Stage mode balances records across preferred lanes, adding rows when intervals overlap. Occurrence coordinates are unchanged.
- `openbexi_timeline_exploration.js`: optional representative clusters, with complete original membership and native expansion.
- `openbexi_timeline_overview.js`: compact original-record projection for clustered views.
- `openbexi_timeline_activity_focus.js`: shared readable DOM labels, reconciled against projected artwork bounds, plus stage lane geometry and camera framing.
- `openbexi_timeline_event_interaction.js`: artwork, bars and labels resolve to the same original marker. Pointer capture keeps label clicks valid through deferred resize.

## Dinosaur data and scientific limits

The source remains the historical 224-record dataset. Raw numeric ages and uncertainty prefixes are retained. For example, Avalonia remains **210–205 Ma**, an interval of **5 Ma**. A missing end remains a point observation; display size does not imply body size or an individual animal's lifespan. Historical classifications are shown as source metadata, not newly validated taxonomy.

Period boundaries are model-defined annotations from the [ICS December 2024 chart](https://stratigraphy.org/ICSchart/ChronostratChart2024-12.pdf): Triassic 251.902–201.4 Ma, Jurassic 201.4–143.1 Ma, Cretaceous 143.1–66 Ma. These are estimates from that chart version; its uncertainty values remain available at the source. Original record intervals are not rewritten to fit modern boundaries.

There are 26 exact-genus 3D assets: one Smithsonian composite skeleton and 25 stylized AI-generated illustrations. The remaining 198 records have clearly labeled schematics. This is not complete scientifically validated genus reconstruction coverage. See [asset research and provenance](dinosaur-assets-research.md) for licenses, rejected candidates, hashes and refresh instructions.

## Verification

Run `npm test`, `npm run test:browser`, and `node tools/benchmark-record-visuals.mjs` using an installed Playwright Chromium. The benchmark uses only synthetic data and software WebGL; hardware frame-rate targets require a separate device measurement. See the [measurements and screenshots](record-visuals-validation.md) for results.
