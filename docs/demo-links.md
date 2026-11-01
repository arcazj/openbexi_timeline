# Demo descriptor references

Updated 30 October 2026. Reference handling belongs to the shared descriptor, so it works in both 2D and 3D without demo-specific renderer branches.

- URL fields use short **Open reference** or **Open report** labels. Hover exposes the complete URL.
- Links open in a separate tab with `noopener noreferrer`, preserving the current timeline, camera and selection. Keyboard activation follows the same behavior.
- Existing descriptive anchor text is retained. Empty or unsupported URLs never become navigation links.
- Legacy Simile imports retain linked descriptions for the shared descriptor's allowlist sanitizer. Unlinked descriptions retain their existing normalized plain text.
- Table descriptions and CSV exports use readable plain text while the descriptor retains its clickable links. Cached table text refreshes when a description changes.
- URL repairs are stored in the public source datasets. Record titles, dates, durations, classifications and description prose are preserved.

## Destination repairs

All 224 dinosaur reference destinations returned HTTP 200 during the local check: 204 exact-name pages in the current [Natural History Museum directory](https://www.nhm.ac.uk/discover/dino-directory/name/name-az-all/gallery.html), plus 20 historical-name references on Wikipedia. Avalonia uses the dinosaur-qualified URL, avoiding the unrelated geological article. Historical aliases may redirect to their current taxonomic discussion; the timeline retains its supplied names and dates.

Monet's obsolete art-store pages and deleted water-lily file were replaced with references from the [National Gallery of Art](https://www.nga.gov/artworks/72138-artists-garden-argenteuil-corner-garden-dahlias), [Musée d'Orsay](https://www.musee-orsay.fr/en/artworks/la-seine-argenteuil-10866), [National Gallery](https://www.nationalgallery.org.uk/paintings/claude-monet-the-water-lily-pond), and the existing Wikipedia painting reference. JFK's deleted photograph link now points to the [JFK Library's account](https://www.jfklibrary.org/learn/about-jfk/jfk-in-history/november-22-1963-death-of-the-president).

The religious-history import restores 1,590 inline links. Thirteen relative Wikipedia edit links now open a readable reference, HTTP Wikipedia links use HTTPS, and 35 references to a retired university Bible service now retain their book/verse in Bible Gateway links. Nine further confirmed unavailable references were replaced with current pages, including the [National Archives](https://www.archives.gov/founding-docs/declaration-transcript), [UN peacekeeping archive](https://peacekeeping.un.org/sites/default/files/past/unefi.htm), [YIVO](https://encyclopedia.yivo.org/article.aspx/yiddish_literature/yiddish_literature_after_1800), and the referenced institutions' current websites. The replacements returned HTTP 200. Remaining inconclusive destinations are retained for future review. Operations, ephemeris and space exploration supply no descriptor reference URLs.

## Audit scope and repeatability

The initial live audit attempted 1,620 distinct destination pages, including proposed dinosaur replacements: 1,174 returned HTTP 200, 11 returned 404, 388 returned 429, one returned 403, two returned 504, and 44 had DNS, connection or timeout errors. These are **pre-repair audit figures**, not a claim that every historical URL now works. Rate limits and blocked responses are inconclusive; page fragments and external page content are not covered by HTTP status checks. Original URLs and individual responses are retained in the local audit artifacts.

Inventory all public demo references without making network requests:

```powershell
node tools/check-demo-links.mjs
```

Explicitly recheck live destinations and save a local report:

```powershell
node tools/check-demo-links.mjs --live --output .local-private/demo-links-audit.json
```

The maintenance command uses serial requests with a delay and stops contacting a host when it returns 403 or 429. It never runs automatically while viewing a descriptor. Unverified results produce a nonzero exit status and are recorded separately from confirmed 404/410 responses.

Automated coverage in `tests/timeline-descriptor.test.mjs` verifies all supplied descriptor references, short labels, safe navigation and preserved source data. `tests/browser/descriptor-links.spec.mjs` exercises mouse and keyboard activation in all seven demos, in 2D and 3D, at desktop and narrow widths. Browser navigation uses intercepted destinations; live availability is checked separately.

Local regression: **490 JavaScript tests passed** and **413 Chromium browser cases passed** across desktop and narrow viewports, with seven duplicate narrow drag measurements intentionally skipped. After the final table/CSV text correction, the affected suites were rerun: **35 JavaScript tests** and **36 browser cases passed**, including all 14 descriptor-link cases. No screenshot baselines were changed for this fix.

The final static bundle was rebuilt successfully and passed all **16 bundle checks** across desktop and tablet widths, covering the seven demos and embedded timeline.
