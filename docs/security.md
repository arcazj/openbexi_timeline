# Dependency and deployment security

OpenBEXI Timeline 2.9.7 runs its server and public collectors in Python. The
browser uses the npm lockfile; Python runtime versions are recorded in
`requirements.lock`, public package metadata and
`release/windows/collector-requirements.txt`. The Windows installer includes its
own pinned Python runtime and verifies downloaded runtime and package hashes.

## Validate and review dependencies

Use Python 3.12+ and Node.js 24 in an isolated development environment:

```sh
python -m pip install -r requirements.lock -r timeline_data_collector/requirements-test.txt -e . -e timeline_data_collector
python -m pip check
python -m unittest discover -s tests/python -v
python tools/test-collector.py
npm ci
npm audit --audit-level=moderate
npm test
npm run test:integration
```

Dependency versions and successful tests are evidence for the tested build;
they are not a claim that future advisories or deployment vulnerabilities cannot
exist. Review Python, npm, container and operating-system advisories when updating
or deploying. Automated dependency updates cover npm, pip, containers and Actions.
Use public or synthetic fixtures in diagnostics, following the [privacy guide](privacy.md).

## Deployment

Build and run the container from the repository root:

```sh
docker build -t openbexi-timeline .
docker run --rm -p 127.0.0.1:8442:8442 -v openbexi-data:/data openbexi-timeline
```

The container runs the Python API as an unprivileged user. The volume retains
managed data. Use a trusted TLS reverse proxy and API tokens for a remote service;
see the [REST API guide](rest-api.md).

For a source checkout, create a Python environment and install the application.
Launch `bash openbexi_timeline.sh --workspace HBDS/workspace.json`, or
`openbexi_timeline.bat --workspace HBDS/workspace.json` on Windows. The launchers
select the repository `.venv`, or the `OPENBEXI_PYTHON` interpreter override.
`OPENBEXI_TIMELINE_HOME` selects another installation root. Explicit path arguments
are resolved from the caller's directory. With no arguments, selection uses
`OPENBEXI_HBDS_CONFIG`, `OPENBEXI_TIMELINE_CONFIG`, the historical
`OPENBEXI_TIMELINE_DATA_PATH`, then the bundled default workspace.

Existing HTTP connector IDs and ports remain usable when their old owner is
`java`; the Python runtime adapts that setting in memory. Secure listeners accept
PEM `tls.certfile`/`tls.keyfile` or existing JKS/PKCS12 `tls.keystore`,
`tls.password_env` and optional `tls.key_alias` settings. Source stores and user
configuration files are not rewritten. Keystore keys are converted into password-
encrypted PEM files in restricted temporary storage, loaded into the SSL context,
and removed before the listener starts. Passwords and key material are never
logged.

JKS support covers Sun JKS versions 1 and 2 with the store password protecting the
private key, matching the former launcher. PKCS12 supports explicit `key_alias` selection, including a nonprimary private
key in a multi-key Java store. JCEKS and provider-specific JKS protection are rejected. TLS startup
fails on wrong passwords, corrupt stores, unsupported formats or mismatched keys;
it never falls back to an unencrypted listener.

Static files are served through an explicit public-asset allowlist. Repository
internals, deployment YAML, arbitrary JSON, source code, build output, dotfiles,
directory listings and unpublished symlink targets are unavailable. New public
asset locations require deliberate changes in `python/openbexi_timeline_server/assets.py`.

Keep writable API data outside the static application root. Supply tokens through
environment variables or the deployment's secret manager. Never place credentials
in shared URLs or checked-in configuration. Back up the private data directory
before upgrades. The Windows upgrade replaces application-owned runtime files and
retains user data; uninstall also retains that data.

Managed models use workspace membership and explicit model grants. User tokens
are stored as hashes; the system administrator token remains a recovery
credential. Reader/writer service tokens apply only to unscoped models. Model
administrators edit only their scoped configuration documents; global documents
require the system administrator. See [model access](model-access.md).

Writes validate complete input, require current ETags, and use local process and
filesystem locks plus atomic replacement. Use storage that supports local file
locking and atomic rename. This is single-host persistence, not a distributed
database. Configuration references block unsafe renames and deletion.

AI assistance is disabled until configured by the operator. Keys remain on the
server; browser requests cannot choose provider endpoints. Model administrator
access and workspace AI entitlement are required. Input/output limits, timeouts,
and in-memory hourly/concurrency limits bound requests. Proposals require user
review and cannot mutate datasets. Limits apply per server worker. See
[AI assistance](ai-assistance.md) for configuration and privacy details.
