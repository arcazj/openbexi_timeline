# OpenBEXI Timeline 2.9.4

This patch fixes Python timeline startup after saved filters have added metadata
to user profiles. Previously, startup could fail with
`configuration.users[0].filters is not allowed`.

The shared HBDS schema and browser validator now accept the optional `filters`
and `filterAccess` fields written by the Java and Python filter repositories.
Filter references retain their namespace, name, access and optional workspace.
Existing profiles remain valid, and saved filters are preserved.

A regression test creates a filter, reloads the server configuration and saves
the HBDS editor document. Invalid filter metadata continues to be rejected.

The application and collector core are **2.9.4**. Independently versioned plugins
retain their existing versions and requirements. Restart running services to
load the update. No user-profile migration is required.

See the [2.9.4 validation report](release-2.9.4-regressions.json) for the checks
performed locally. GitHub Actions separately builds and tests the Windows
installer before publishing release assets.
