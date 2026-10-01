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
```

The [browser testing guide](browser-tests.md) explains the Windows screenshot
baselines and review process. CI also audits npm and Java runtime dependencies.
Use public or synthetic fixtures in tests and bug reports, following the
[privacy guide](privacy.md).

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
