# Windows installation — 2.9.7

Download `openbexi-timeline-<version>-windows-x64-setup.exe` from the
[latest release](https://github.com/arcazj/openbexi_timeline/releases/latest).
Release notes, the source archive and SHA-256 checksums are attached there too.

Run the installer on Windows 10 or 11 x64. It installs for your Windows account
and includes the Python runtime, public collectors and browser dependencies.
You do not need a separate Python, Java or Node.js installation. The installer
is currently unsigned.

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

The **Release Windows installer** workflow runs when a stable `X.Y.Z` tag is
pushed. It can also package an existing tag using **Run workflow** on `master`.
The application is built from that exact tag; the selected workflow revision
provides the packaging scripts. Existing tags are never moved.

Publication requires release notes, passing JavaScript and Python tests, a built
installer, and an installed-app check of bundled Python, browser rendering, API
access and uninstall. The release is staged as a draft, assets and checksums are
verified, and then it is published as latest. The retained release set is
2.9.6 and 2.9.7, including their source archives, downloads and notes. Cleanup
retains `master` as the sole branch and preserves both release tags. Run
`git fetch --prune --prune-tags origin` to
synchronize an existing clone's tags after a release.

For a local build on Windows, install Python 3.13, Node.js 24 and Inno Setup 6,
then run from an activated Python environment:

```powershell
npm ci
python -m pip install -r requirements.lock -r timeline_data_collector/requirements-test.txt -e . -e timeline_data_collector
python -m pip install build "setuptools>=77"
python tools/test-collector.py
python tools/build-collector.py
npm run release:source
npm run pages:build
powershell -NoProfile -File tools/package-windows.ps1
```

Outputs are placed in `dist`. The bundled Python runtime and installed packages
retain their license and distribution metadata. Public wheels and source
archives exclude private configurations, collected data and Java artifacts.
