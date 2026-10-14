# Local filter settings

The application stores user-specific filter settings in this directory. These
files can contain source paths, connection settings, and private search criteria,
so they are ignored by version control. The server creates settings from the
active configuration when a saved filter does not exist.

Tests should create disposable settings using synthetic data. Do not commit
copies of settings produced by a private deployment.
