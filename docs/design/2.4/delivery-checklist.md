# OpenBEXI Timeline 2.4 delivery record

This record covers the [consolidated prompt](implementation-prompt.md), including
embedding and the connected editor layout. Version remains **2.4.0**. Item JSON
compatibility is a fixed requirement, not a migration option. README stays a short
entry point; detailed behavior belongs in the linked guides.

## Requirements and evidence

| Requirement | Delivered behavior and evidence |
| --- | --- |
| Fixed event/session/activity metadata | Original nested and flat representations, unknown properties, null/absent distinctions and source items are preserved. Frozen fixtures are unchanged. [Contract](../../event-session-contract.md); `event-session-compatibility.test.mjs`, `timeline-embed.test.mjs`, real Java integration. |
| 1. Two menu bars and contrast | Ordered Filters/Calendar controls, responsive navigation after Search, separators, removed time-window button, and visible high-contrast states. `toolbar-ux.spec.mjs`, `status-states.spec.mjs`; [browser guide](../../browser-tests.md). |
| 2. Useful status | Text plus loading/completion/partial/error/cancel colors; the same status control toggles its report. Unfinished work cannot report Ready. `timeline-loading.test.mjs`, `status-states.spec.mjs`, historical search tests. |
| 3. Commercial 2.4 | Confirmed individual licensor and nonprofit exemptions, consistent public license and notices, preserved historical GPL and third-party terms. [Licensing guide](../../commercial-licensing.md). No billing or purchase-verification implementation. |
| 4. Model access | Server-enforced administrator/read-write/read-only grants, bounded custom roles, scoped documents/filters/previews/AI, private clone isolation, last-admin and ID-reuse protections. [Access guide](../../model-access.md); Java API tests and browser-to-Java integration. |
| 5. HBDS model and pictures | Pinned v2 JSON, full viewer PNG, overview PNG/SVG, typed attributes and relationships. [Design and artifacts](README.md). Broader domain proposals are identified separately from implemented API constraints. |
| 6. Model/YAML/filter compatibility | Existing schemas and extensions, loss-aware YAML edits, model-owned personal/shared filters and conditional writes. [Editor guide](../../model-editor.md); document/workspace unit tests, editor browser suite and Java tests. |
| 7. Simple editor | Five property areas, synchronized Advanced text, last valid real preview, undo/redo/revert, document CRUD, saved versions, explicit Apply and save. [Editor guide](../../model-editor.md). |
| 8. Connected layout | Explicit launch context hides document management only for connected applications; essential actions move into a compact toolbar. Inline heading, no home link, visible errors and unchanged authorization. Demo/standalone keep full controls. [Reviewed captures](../../ui/model-editor/README.md); launch-link unit tests and editor browser/integration checks. |
| 9. Optional AI | Unified provider adapters, configured capabilities, image references, review/diff/preview/accept, cancellation and request limits. Keys and item payloads stay outside proposals. [AI guide](../../ai-assistance.md); Java mock-provider and editor tests. |
| 10. Embedded edition | Isolated iframe plus host API, multiple instances, exact origin/source/channel checks, authorized host data, immutable selection payloads, view-preserving updates and cleanup. [API guide](../../embedding.md); unit and browser embedding tests. |
| 11. Earth Orbit example | Adapter for launch arrays, decay catalogs and prediction windows, stable string NORAD IDs, original-record selection map and synthetic interactive example. [Integration guide](../../embedding.md#earth-orbit-integration); adapter tests and browser/deployment flows. Earth Orbit production files are unchanged. |
| 12. Documentation and packaging | Concise README; updated index, editor/help/integration guides, screenshots and source manifest; public assets included in Java and static builds. Local build and publication are distinct. |

## Verification

Run from the repository root using the locked Node/Playwright dependencies, a
supported Chromium browser and Maven/JDK. Windows verification uses JDK 21 with
the Java 17 target. Set `PLAYWRIGHT_BROWSERS_PATH` if browsers are installed outside
the default cache.

```sh
npm test
npm run demos:schemas -- --check
npm run demos:validate
npm run demos:readme -- --check
npm run api:spec -- --check
mvn --batch-mode --no-transfer-progress verify
npm run test:integration
npm run test:browser
node docs/design/2.4/validate-artifacts.mjs .local-private/hbds-reference
node docs/design/2.4/render-artifacts.mjs .local-private/hbds-reference
npm run pages:build
npm run pages:verify
npm run release:source
git diff --check
```

The HBDS reference checkout must be the pinned commit documented in the design.
The source archive's `SOURCE-MANIFEST.json` lists the reviewed files and their
SHA-256 hashes. Inspect generated editor captures before replacing public images;
do not regenerate the frozen item compatibility fixtures.

Verified locally on **2026-10-02**:

- **289 JavaScript tests passed**, with no failures or skips.
- Full Chromium suite: **277 passed**, **seven existing duplicate narrow-drag
  cases skipped**, no failures. Two focused screenshot-readiness checks also
  passed after waiting for preview resizing before capture. Existing visual
  baselines and frozen compatibility fixtures were retained.
- Maven verification and packaging passed: **115 Java tests passed**, with
  **34 skips** (33 disabled legacy cases and one Windows symlink case).
- Real browser-to-Java integration passed **six checks**, retaining all **27**
  original item payloads; authenticated editing, two saved versions and one
  loopback AI proposal completed without browser errors.
- Generated browser validators, all seven demo models, README demo links and
  the OpenAPI contract match their checked-in sources.
- HBDS JSON/schema, semantic and server validation, importer compatibility,
  YAML round-trip and actual viewer checks passed for **26 classes,
  191 attributes and 44 links**. The reviewed overview and viewer report were
  refreshed using the pinned reference; the model JSON is unchanged.
- **428 local documentation references** across **48 documents** resolve to
  existing public files/directories. Package, lockfile and Maven versions agree.

- Static deployment verification passed **16 flows** under a path prefix:
  seven demos and the embedded satellite example at desktop and narrow widths.
  The static build contains **400 public assets**.
- The source archive contains **629 reviewed public files**. Every extracted
  file hash and the archive checksum passed verification. `git diff --check`
  passed; the original item adapter, datasets, schema contract and frozen item
  fixture remain unchanged.

## Delivery boundaries

- The reviewed changes are prepared for `master` under the existing push
  instruction. Git history and Actions report the actual pushed commit and CI
  state; this document records local verification. Preparing source/static
  packages does not publish a Git tag, hosted release or Earth Orbit integration.
- Docker CI/build testing is deferred as requested; no container test is claimed.
- AI protocols are tested with local mock providers. Live account availability,
  billing and model quality require an operator's configured account.
- Onboarding/token-rotation screens, monetary AI budgets, live-account
  certification, backup/recovery drills and formal release publication remain
  separate operational work. Existing request limits and backup guidance remain
  documented; they do not imply these additional features are implemented.
