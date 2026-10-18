# Local files, S3, SFTP and Oracle readers

Select `source_plugin: local`, `json_file`, `s3`, `sftp` or `oracle`; select a separate converter such as `timeline_json`. File checksums and converter versions skip unchanged inputs. Inputs are copied to an immutable private snapshot before conversion.

For local inputs, a missing path or a folder with no matching input files logs a warning with the namespace, source ID and path, then skips that source. The job succeeds with zero batches, other sources continue, and existing output and publication checkpoints are preserved. The next invocation or scheduled pass checks the input again. Permission errors, unreadable or malformed files, and files disappearing during processing still fail visibly.

On Windows, staged inputs use extended absolute paths so adding the snapshot directory does not make a valid source filename exceed the legacy 260-character path limit. No system registry changes are needed.

Install optional drivers with `pip install "timeline-plugin-filesources[s3,sftp,oracle]"`. SFTP requires known-host verification. Oracle requires a SELECT query with a `:watermark` bind, key/watermark columns and field mapping. Store credentials in environment references or provider profiles. Reader metadata caches are private; the core commits conversion progress only after publication.

See [collector setup and API contracts](../../../timeline_data_collector/README.md) for installation, UI execution, repeat policies and recovery.
