# Local files, S3, SFTP and Oracle readers

Select `source_plugin: local`, `json_file`, `s3`, `sftp` or `oracle`; select a separate converter such as `timeline_json`. File checksums and converter versions skip unchanged inputs. Inputs are copied to an immutable private snapshot before conversion.

Install optional drivers with `pip install "timeline-plugin-filesources[s3,sftp,oracle]"`. SFTP requires known-host verification. Oracle requires a SELECT query with a `:watermark` bind, key/watermark columns and field mapping. Store credentials in environment references or provider profiles. Reader metadata caches are private; the core commits conversion progress only after publication.

See [collector setup and API contracts](../../../timeline_data_collector/README.md) for installation, UI execution, repeat policies and recovery.
