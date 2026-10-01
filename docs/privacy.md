# Public examples and local deployment data

Application code, tests, and documentation must work independently of private
installations. Keep real site identifiers, internal endpoints, credentials,
user profiles, source paths, event content, screenshots, and runtime observations
out of versioned files. Configure services at runtime; use public examples and
synthetic records in tests.

`.gitignore` excludes local filters, deployment helpers, private artifacts, and
generated browser output. Root HTML entry points, top-level models, and source
configuration examples have an explicit list of public files. Review both names
and contents before adding a new public example. A renamed screenshot or JSON
report can still contain private information.

Existing local deployment files can remain at their current paths while excluded
from version control. Keep private captures in `.local-private/` and disposable
diagnostic output in `test-results/`. Do not link those files from public docs.
IDE metadata, generated data samples and the local `tomcat/` runtime directory
are also excluded. Provision certificates locally when using an HTTPS connector;
the public source release does not supply a deployment certificate or private key.

Ignore rules do not remove previously tracked files or erase older commits.
Removing tracking preserves local files when performed with `git rm --cached`;
rewriting shared history requires a separate coordinated operation.

Release source archives use the explicit list in `release/public-files.json`.
The packaging command rejects symlinks and runtime artifacts, strips local file
owner names from archive metadata, and records checksums. Review that list when
adding files; it intentionally does not discover arbitrary local files. Build a
distribution from this archive rather than copying an entire development tree.

Model grants, user token hashes, entitlements, saved model configurations and AI
provider configuration belong in the private API data directory outside the web
root. Provider credentials are read from server environment variables. The editor
keeps an entered API token in memory; it does not export it with a model or save
it to browser storage.

AI is optional. Only an explicit request sends the selected model configuration,
prompt and optional image to the configured provider. Review those inputs before
sending; do not include private event content or credentials. Requests and
responses are not persisted by this AI service, but the selected provider has
its own retention policy. See [AI assistance](ai-assistance.md). Event and session
payloads are never extended with access, licensing or AI metadata.
