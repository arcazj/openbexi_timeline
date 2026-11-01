# Dinosaur asset research and provenance

Reviewed 29 October 2026. Assets are downloaded into the local public asset directory; the application does not call external asset services at runtime. No private operational data was used or uploaded.

## Coverage and limits

The historical source contains 224 genus records. The manifest now supplies **26 exact-genus 3D models**: one Smithsonian museum skeleton scan and 25 stylized AI-generated illustrations. The other **198 records** retain clearly labeled, original schematic clade symbols. A schematic represents the source classification, not a reconstruction of that genus. Record names and original occurrence intervals remain unchanged.

This is not complete anatomical coverage. Exact name matching prevents substituting an unrelated genus. Display dimensions are normalized for readable layouts; they are not estimates of actual body size. Speculative color, soft tissue, feathering and proportions in the illustrative models should not be treated as scientific evidence.

## Smithsonian Triceratops upgrade

- Collection record: [Triceratops horridus Marsh, 1889](https://3d.si.edu/object/3d/triceratops-horridus-marsh-1889:d8c623be-4ebc-11ea-b77f-2e728ce88125), Smithsonian Institution, National Museum of Natural History. The object page explicitly marks the content CC0; see the [Smithsonian Open Access FAQ](https://www.si.edu/openaccess/faq) for the scope of that designation.
- [Primary Voyager metadata](https://3d-api.si.edu/content/document/d8c623be-4ebc-11ea-b77f-2e728ce88125/document.json) describes a composite skeleton assembled using casts and reconstructed elements, including 3D prints. It is not a scan of one complete individual or a living-animal reconstruction.
- [Original medium-quality GLB](https://3d-api.si.edu/content/document/d8c623be-4ebc-11ea-b77f-2e728ce88125/Triceratops_20M-150k-2048-medium.glb): 150,000 triangles, 2,048-pixel embedded textures, 3,217,148 downloaded bytes. Its Draco geometry is decoded once during asset preparation using Three.js's existing bundled decoder. The local standard GLB is 8,283,956 bytes, below the runtime's 16 MiB limit; no decoder or new dependency is needed in the browser.
- [Matching museum image](https://3d-api.si.edu/content/document/d8c623be-4ebc-11ea-b77f-2e728ce88125/scene-image-medium.jpg): 1,280-pixel JPEG. Both model and image use Smithsonian provenance and CC0 metadata.
- The prepared GLB's orientation was checked from its vertex projections: raw X is height and raw Y is body length. The manifest converts these to an upright, horizontal, Y-up display. Voyager's separate document transform cannot be applied directly to this GLB in an ordinary glTF viewer. Geometry, topology and textures were retained; no anatomical edits were made.
- Local files: `icon/dinosaurs/triceratops-skeleton.glb` and `triceratops-skeleton.jpg`. Original and prepared model SHA-256 values, image hash, source URLs, license and processing details are recorded in the manifest. The earlier stylized files are retained but are no longer the selected Triceratops representation.

The retained `triceratops.glb` and `triceratops.webp` are the [3D Assets stylized Triceratops illustration](https://3dassets.dev/assets/dinosaurs-and-prehistoric-life-triceratops-5c18d8d2), created by 3D Assets and released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). They are AI-generated, are not validated reconstructions, and are not used by the active Triceratops manifest entry.

To reproduce decompression after downloading the original linked binary locally:

```sh
node tools/decode-draco-glb.mjs downloaded-triceratops.glb prepared-triceratops.glb
```

## Four additional genus illustrations

The creator's [Primeval Frontier pack](https://3dassets.dev/packs/primeval-frontier) and [machine-readable catalog](https://3dassets.dev/api/v1/packs/primeval-frontier) identify the following individual assets as CC0 1.0, AI-generated, static and unrigged. Their posters were visually reviewed; each has genus-associated features but remains a stylized illustration, not a validated reconstruction. Existing models for other genera were preserved.

| Exact genus | Creator page | Direct GLB | Triangles | Downloaded bytes |
| --- | --- | --- | ---: | ---: |
| Ceratosaurus | [Source](https://3dassets.dev/assets/primeval-frontier-ceratosaurus-ad5f8d8a) | [GLB](https://cdn.3dassets.dev/assets/1689/v1/model.glb) | 9,814 | 475,020 |
| Baryonyx | [Source](https://3dassets.dev/assets/primeval-frontier-baryonyx-8d7232ee) | [GLB](https://cdn.3dassets.dev/assets/1688/v1/model.glb) | 8,808 | 426,716 |
| Oviraptor | [Source](https://3dassets.dev/assets/primeval-frontier-oviraptor-72a3dc5b) | [GLB](https://cdn.3dassets.dev/assets/1700/v1/model.glb) | 6,594 | 321,148 |
| Therizinosaurus | [Source](https://3dassets.dev/assets/primeval-frontier-therizinosaurus-21c88d88) | [GLB](https://cdn.3dassets.dev/assets/1702/v1/model.glb) | 6,574 | 319,576 |

Every active model and matching poster has a SHA-256 hash in `icon/dinosaurs/manifest.json`. The binary header, internal length and triangle counts were verified against the downloaded geometry. Small byte-size differences from the catalog's cached statistics are recorded using the actual downloaded size.

These four additions and the Smithsonian replacement are marked `curated: true`. `tools/fetch-dinosaur-assets.mjs` preserves reviewed entries and their attribution when refreshing the original illustration pack, including during a manifest-only refresh. Replacing a curated asset requires a deliberate source/license review and an updated manifest entry.

## Other sources examined

| Candidate | Finding and reason it was not bundled |
| --- | --- |
| [Smithsonian dinosaur catalog](https://3d.si.edu/explore/museum/natural-history-museum?edan_local=&edan_q=dinosaur) | The reviewed results supplied Triceratops, a Tyrannosaurus/Triceratops scene and Stegosaurus tail spikes. They did not yield additional unmatched whole-animal genera. A whole scene or isolated spike was not substituted for a different record. |
| [Field Museum SUE](https://www.fieldmuseum.org/page/sue-3d-model) | Museum Tyrannosaurus model offered under CC BY-NC 4.0. Not bundled with the unrestricted CC0 assets. |
| [Natural History Museum Vienna Plateosaurus](https://sketchfab.com/3d-models/plateosaurus-skeleton-80683eb568cc46caac0649e395fa5a1b) | Museum skeleton scan, approximately 249,000 triangles; CC Attribution-NonCommercial. Not bundled. |
| [Natural History Museum Vienna Psittacosaurus](https://sketchfab.com/3d-models/psittacosaurus-mongoliensisnhmw-geo199800641-f25dc41ec23242a588772f2205410722) | Museum skeleton scan, approximately 200,000 triangles; CC Attribution-NonCommercial. Not bundled. |
| [University of Wyoming Edmontosaurus skeleton](https://sketchfab.com/3d-models/uw-15561-edmontosaurus-copei-skeleton-6ddb19be075c455796f17502b9a3f899) | Approximately 133,000 triangles; CC Attribution-NonCommercial. Not bundled. |
| [MorphoMuseuM](https://www.morphomuseum.com/) | Scientific 3D data publisher uses CC BY-NC 4.0 for its 3D data. No unrestricted whole-animal asset was selected. |
| [Laser Design Edmontosaurus skull](https://sketchfab.com/3d-models/edmontosaurus-skull-2055d7721e454bd8bd4019eb28e27e13) | Creator credits a Science Museum of Minnesota specimen; CC Attribution and about two million triangles. It represents only a skull and needs optimization. An authorized direct downloadable file was not verified; no account or download restriction was bypassed. Candidate for a future explicitly labeled specimen view. |

Scientific museum assets remain preferable when their licensing, identity, file availability and rendering requirements can be verified. The research does not establish that no other suitable models exist; it records the concrete candidates inspected for this update.
