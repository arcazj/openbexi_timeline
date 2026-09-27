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
