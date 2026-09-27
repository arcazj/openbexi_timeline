# Third-party components and release review

Third-party components retain their own licenses. A proposed first-party
commercial agreement cannot replace them. The source release excludes
`node_modules`, downloaded JARs, build outputs, and local certificates; the
package lock and Maven descriptor specify dependencies to install separately.

The direct browser dependencies are Three.js, three-spritetext, and
simple-jscalendar. Their installed packages contain MIT license notices; retain
those complete notices when distributing a build that bundles them. A build
also needs the notices for transitive and copied dependencies, not just these
three package names. Preserve existing source headers and asset attribution.

The Java dependencies and overrides are listed in [pom.xml](../pom.xml).
Inspect resolved dependencies and each artifact's POM/license files before
distributing a bundled runtime. Development dependencies also carry their own
terms if redistributed. Useful inventory commands are:

```sh
npm ls --all
mvn dependency:tree
```

The existing repository includes example datasets, images, and icons. Their
presence in a public repository does not establish commercial redistribution
rights. The owner must review provenance and permissions for the selected paid
bundle. This document records release-review work still needed; it is not a
claim that every dependency or asset has been cleared for commercial use.
