# Development and releases

Use Node.js 24 and the locked dependencies. Java builds require JDK 17 or later
and Maven. Start the local demo with `npm run demo` after `npm ci`.

## Validate changes

```sh
npm ci
npm run demos:schemas -- --check
npm run demos:validate
npm run demos:readme -- --check
npm run api:spec -- --check
npm test
npx playwright install chromium --only-shell
npm run test:browser
mvn --batch-mode --no-transfer-progress verify
npm run test:integration
```

The [browser testing guide](browser-tests.md) explains the Windows screenshot
baselines and review process. CI also audits npm and Java runtime dependencies.
Use public or synthetic fixtures in tests and bug reports, following the
[privacy guide](privacy.md).

For the [embedded timeline](embedding.md), run `npm run test:embed` for its data
adapter and unchanged item contract, then
`npx playwright test tests/browser/embedding.spec.mjs` for actual rendering and
cross-origin integration. Both are included in the normal test suites.

Keep the [event/session JSON contract](event-session-contract.md) fixed. The
frozen compatibility fixture covers legacy nested items, snapshots, numeric/BCE
dates and extension metadata; do not regenerate it to hide a format change.
Java tests cover scoped access and real HTTP AI requests against local mock
providers. They do not certify live provider accounts or model availability.

The integration check launches the compiled Java API, a local mock AI provider,
and Chromium with synthetic credentials and temporary data. It checks the real
editor's protected load, save, history, filters, proposal review, reader denial
and unchanged record payloads. Build Java first; `JAVA_HOME` or `java` on PATH
selects the runtime. No paid provider or existing dataset is used.

To verify the static site under its deployment subdirectory:

```sh
npm run pages:build
npm run pages:verify
```

## Maintain documentation

Keep [README](../README.md) focused on the product overview, quick start and
links. Put control descriptions, configuration, troubleshooting and release
details in their guides. Keep the Markdown and HTML user guides consistent.
The [documentation index](README.md) lists the guides and release history.

After editing `demos/catalog.json`, run `npm run demos:readme`. It generates
the compact README links and the resource table in [the demo guide](demos.md)
from the same catalog. Update [Help resources](../help/resources.json) when
adding a link used by the application. Review local links and screenshot
references before publishing.

## Prepare a release

1. Choose the next version using the existing release sequence. Synchronize
   `package.json`, both root versions in `package-lock.json`, `pom.xml`,
   `help/resources.json`, the header in `src/openbexi_timeline.js`, and the
   version shown in both user guides. The OpenAPI contract has its own version.
2. Add `docs/release-<version>.md` with changes, upgrade information and the
   actual validation results. Link it from the documentation index.
3. Update `release/public-files.json` for new public sources, tests and guides.
   Review images before adding them. Keep private configuration, operational
   data, credentials and local reports outside the manifest.
   Include the current `LICENSE`, third-party notices and the historical GPL
   reference. Keep license metadata and source headers consistent; earlier
   GPL releases retain their original grants. See the [licensing guide](commercial-licensing.md).
4. Run the relevant checks above and review intentional screenshot changes.
5. Run `npm run release:source`. It creates
   `dist/openbexi-timeline-<version>-source.tar.gz`, its `.sha256` file and
   `dist/SOURCE-MANIFEST.json` from the explicit public manifest.
6. Commit the reviewed changes to `master`, tag that commit as `v<version>`,
   and push the commit and tag without rewriting remote history. Confirm the
   Verify and Publish live demos workflows complete successfully.
7. Publish the release notes and source archive with its checksum on the
   matching GitHub release. Confirm the deployed `version.json` identifies the
   release commit, then verify the live demo flows.
