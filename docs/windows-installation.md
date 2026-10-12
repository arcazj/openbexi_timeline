# Windows installation

Download `openbexi-timeline-<version>-windows-x64-setup.exe` from the
[latest release](https://github.com/arcazj/openbexi_timeline/releases/latest).
Release notes, the source archive and SHA-256 checksums are attached there too.

Run the installer on Windows 10 or 11 x64. It installs for your Windows account
and includes the Java runtime and browser dependencies. You do not need Node.js,
Maven or a separate Java installation. The installer is currently unsigned.

Open **OpenBEXI Timeline** from the Start menu. Its console starts a local server
and opens your browser at `http://127.0.0.1:8781/demos.html`. Keep the console open
while using the application; press Ctrl+C to stop. The server listens only on
your computer. Demos and the model editor are included. Protected API operations
use the credentials described in the [REST API guide](rest-api.md).

Application files are installed in `%LOCALAPPDATA%\Programs\OpenBEXI Timeline`.
Data and server logs are stored in `%LOCALAPPDATA%\OpenBEXI Timeline\data`.
Uninstall through Windows Settings or the Start menu; your data is retained.
Close the running application before upgrading or uninstalling.

If port 8781 is occupied, close the other instance or launch the installed
`Start-OpenBEXI.ps1` with `-Port 8782`. Use `-DataDirectory <path>` to select another
data location. Startup errors are recorded in `server-error.log` in that location.

## Build and release

The **Release Windows installer** workflow runs when a stable `vX.Y.Z` tag is
pushed. It can also package an existing tag using **Run workflow** on `master`.
The application is built from that exact tag; the selected workflow revision
provides the packaging scripts. Existing tags are never moved.

Publication requires release notes, passing JavaScript and Java tests, a built
installer, and an installed-app check of bundled Java, browser rendering, API
access and uninstall. The release is staged as a draft, assets and checksums are
verified, and then it is published as latest. Only after publication are older
Git tags removed. Older GitHub release records and their downloads are retained;
historical notes also remain in `docs/release-*.md`. If a newer tag appears, cleanup
stops rather than removing it. Run `git fetch --prune --prune-tags origin` to
synchronize an existing clone's tags after a release.

For a local build on Windows, install JDK 21, Maven, Node.js 24 and Inno Setup 6,
set `JAVA_HOME`, then run:

```powershell
npm ci
mvn --batch-mode --no-transfer-progress verify
npm run release:source
npm run pages:build
powershell -NoProfile -File tools/package-windows.ps1
```

Outputs are placed in `dist`. The bundled Java runtime retains its legal notices
under `runtime/legal`; dependency JARs retain their embedded licenses and notices.
