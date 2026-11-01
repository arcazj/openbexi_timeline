# Shared record visuals: validation and measurements

Local Windows validation, 30 October 2026. All screenshots use the existing OpenBEXI Timeline renderer, cameras, controls, descriptors and record state. Public dinosaur data and synthetic records were used; no private operational data was published.

## Visual evidence

| View | Screenshot |
| --- | --- |
| Scientific overview, all 224 source records represented | [Overview](ui/record-visuals/scientific-overview.png) |
| Diagonal stage view with upright models, three balanced lanes and a raised ruler | [Museum](ui/record-visuals/museum-overview.png) |
| Jurassic interval, intermediate zoom | [Intermediate](ui/record-visuals/museum-intermediate.png) |
| 135–119 Ma focus with continuous guides and labels for visible earlier/later sessions | [Time-window edges](ui/record-visuals/museum-interval-edges.png) |
| Selected, enlarged Smithsonian Triceratops with original 67–65 Ma interval | [Detail](ui/record-visuals/museum-detail.png) |
| Same selected skeleton after model rotation | [Rotated detail](ui/record-visuals/museum-detail-rotated.png) |
| Selected record and descriptor at 1024 × 768 | [Tablet](ui/record-visuals/museum-tablet.png) |

The opaque gray timeline surface is replaced by horizontal translucent display lanes, raised period ribbons, a readable geological ruler, thin occurrence bars and upright local artwork. The diagonal camera exposes the lane depth. Expandable clusters keep the broad view compact; the complete original record set remains in the table and overview. Selection enlarges and brings the model forward without changing its occurrence interval. The skeleton's upright orientation, texture and rotation were checked in the real browser. The stage uses the existing shared renderer and cameras; Scientific mode retains its original 2D layout.

## Automated checks

| Suite | Result |
| --- | --- |
| JavaScript core, models, filtering, overview and controls | 442 passed |
| Descriptor protocol and metadata | 10 passed |
| Artwork layout, camera clipping, resource lifecycle, manifests and click capture | 36 passed |
| Complete desktop and narrow Chromium browser regression | 399 passed; seven duplicate narrow drag measurements intentionally skipped |
| Rebuilt local static bundle under a deployment URL prefix | 16 passed: seven demos and the embedded timeline at two widths |

The stage update adds checks for upright model orientation, horizontal lane geometry, balanced row allocation, source-date preservation, resource cleanup and migration from saved board camera poses. Existing browser checks cover first-click selection on models, full labels and duration bars, camera persistence, resize, asset failures and switching back to the unchanged 2D image.

The time-edge regression reproduced missing labels for camera-visible sessions in the 135–119 Ma view: perspective rendering still used flat 2D bounds, while the stage lanes and rulers stopped at the nominal time window. Source intervals and native bar geometry were intact. Labels now use camera-clipped interval positions, and the stage guides span the prepared time buffer. New tests compare 2D and 3D across three earlier/later windows, preserve full bar lengths and source data, exercise real mouse panning in both directions, and cover intervals crossing both viewport edges and the near plane. The docked overview remains outside the label viewport.

The following backend and integration results were established during the preceding shared-core implementation; those suites were not rerun for this rendering-only stage update:

| Suite | Previous result |
| --- | --- |
| Python server | 78 passed |
| Collector and public plugins, including a local MQTT broker | 93 passed |
| Current Java sources and JUnit regression | 182 passed; 33 legacy tests disabled; one host symlink assumption aborted |
| Real Java/Python API and browser integrations | Seven runs passed, 74 checks, no browser errors |

HBDS schema, generated validator and design provenance checks passed. All 26 model binaries passed checksum, real glTF parsing and normalized geometry checks. Asset tests use Node bitmap stand-ins for embedded-image transport; real Chromium screenshots verify the Smithsonian texture and orientation. Unrelated-model tests use synthetic survey records and a different lookup field to verify the feature does not depend on dinosaur names or the demo identifier.

Regression testing found decorative period meshes intercepting pointer hits before the native band. Normalized zone meshes, background images and labels now pass those hits through, preserving the existing band pan behavior. Real raycaster tests cover both calendar-based Operations data and the numeric dinosaur model; legacy interactive zones remain separate.

The current 406-case browser matrix ran in two batches: 51 targeted activity-label, stage, perspective, artwork and drag cases passed with seven intentional skips, and all 348 remaining UI cases passed, including the four local-data worker cases. No screenshot baselines needed changes for this visibility correction; the Scientific/2D views remain unchanged.

The integration runs cover the Java model workspace plus canonical, namespace-file and named-workspace HBDS configurations on both Python and Java. They verify authorization, conditional writes, live previews, scoped reloads, saved filters, persistence through complete server restarts and preservation of unrelated workspace state. Each run uses isolated local fixtures and public Monet records; the AI-provider check uses a synthetic loopback service.

The Java run recompiled current application and test sources with cached JDK 21 dependencies and a Java 17 release target. It does not imply a Maven packaging run or activation of external legacy services. All build and browser checks are local; nothing was deployed.

## Performance

Historical measurements from 29 October 2026, before the time-edge visibility correction; these are not a new performance measurement of that fix. Measured for the stage presentation with `node tools/benchmark-record-visuals.mjs`, Node 24 and Chromium software WebGL (ANGLE SwiftShader) on Windows, Intel Core i7-1265U, 1440 × 900 viewport. Each case uses synthetic records, the native core layout and 90 camera-movement frames around the stage's actual focus. Time to ready measures the initial usable data/layout state; progressive artwork may still be loading. The frame sample starts after queued model loads finish.

| Records | Ready | Visible representatives | Draw calls | Triangles | CPU median / p95 per render | Observed software FPS |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 935 ms | 10 | 119 | 68,526 | 10.9 / 51.6 ms | 1.81 |
| 5,000 | 6,025 ms | 10 | 119 | 68,526 | 36.1 / 233.7 ms | 1.65 |

Both cases preserve every source record and fit the representatives onto one native page. They share one cached model across repeated synthetic records, with zero asset failures. This measures large record-set layout, clustering and shared geometry; it does **not** measure thousands of distinct high-resolution models. Software frame intervals had a p95 of approximately 1,333–1,717 ms. Software rasterization is not smooth at this resolution, and the aspirational 60 FPS target has not been demonstrated on physical GPU hardware. These stage measurements replace the earlier board-view figures; they should not be presented as hardware performance.

## Scientific and feature limits

- 26 exact-genus model entries: one Smithsonian composite skeleton and 25 explicitly labeled stylized, AI-generated illustrations. The other 198 records have schematic fallbacks. Complete scientifically validated genus reconstruction coverage remains unavailable.
- Source classifications, names, uncertainty prefixes and occurrence dates are preserved, including Avalonia at 210–205 Ma. Period annotations identify the ICS December 2024 chart version; historical source taxonomy is not revalidated.
- Imported models are static. There are no fabricated breathing or walking animations. Rotation and foreground selection use the shared scene.
- Dense, coincident records expand into native pages. At extreme camera angles, artwork may shrink or use a marker/native bar to preserve access and avoid overlap.
- Tablet-sized browser rendering is captured above. Physical tablet GPU performance and native touch hardware remain unmeasured.

See [architecture and configuration](record-visuals.md) and [asset provenance](dinosaur-assets-research.md).
