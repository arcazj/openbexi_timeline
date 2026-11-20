# OpenBEXI Timeline 2.9.7

Version 2.9.7 moves the application server, public collectors and Windows runtime
to Python while preserving the JavaScript browser interface and existing timeline
record formats. The previous 2.9.6 release remains available for rollback.

## Changes

- The server implements API v1 model and dataset administration, users and groups,
  permissions and entitlements, configuration-file editing, model history and AI
  assistance directly in Python. Existing authentication, conditional writes,
  saved filters and workspace boundaries remain in place.
- Default generation and earthquake/volcano acquisition run in Python. Seeded
  record identities and GEO output are checked against reference fixtures;
  bounded archive recovery, gap filling and distinct VAN/VONA notices are retained.
- Collector publication reuses a bounded cache of verified immutable file bytes
  and avoids copying unrelated checkpoint histories. File identity, integrity,
  atomic publication, cancellation and restart recovery remain checked.
- Metadata normalization uses deployment-local dictionaries and explicit rules.
  Public packages contain generic extension points and synthetic test fixtures.
- The Windows installer bundles the Python server, collector and public plugins.
  Upgrade validation covers existing user data and legacy connector configuration.
- Active package versions, documentation, design artifacts and downloads use 2.9.7.
  Published branches are consolidated onto master; retained releases are 2.9.6
  and 2.9.7.

## Upgrade

Back up the installation's user data and local deployment configuration. Install
2.9.7, then start the timeline and collector normally. Existing input/output data
and collector checkpoints remain local. Source installations use Python 3.12+
and the locked dependencies; see the [Python server guide](python-server.md) and
[collector guide](../timeline_data_collector/README.md).

A continuous collector keeps polling after historical work finishes. Check its
history and current-source status separately; an active service does not itself
mean a historical backlog is still pending. Restart long-running processes to
load the new code. Warm-cache performance should be measured separately from
initial indexing and first publication.

## Downloads and validation

The release includes source ZIP and TAR.GZ archives, a Windows x64 installer,
public Python wheels, release notes, architecture artifacts and SHA-256 checksums.
The [regression report](release-2.9.7-regressions.json) records completed checks,
counts and environment limitations. Deployment-specific code, configurations,
data, local validation logs and recovery backups are excluded from the release.
