# MQTT subscription and timeline JSON converter

Set both roles to `mqtt`, and supply `options.host` and `topic`. Supports MQTT 3.1.1 with persistent sessions and **QoS 1**. Publishers must also use QoS 1. Install this wheel to obtain the Paho dependency.

`stream` maintains one subscription, reconnects with bounded backoff and runs until cancelled. `once` ends after `idle_timeout` or `max_messages`. A stable client ID is derived from the source; an explicit `client_id` must be unique to that source. Enable broker persistence for durable restart behavior.

Acknowledgement follows durable publication. Redelivery is expected and stable event IDs deduplicate it. Default corrections use arrival order. Set `version_field` (for example `data.revision`) to a monotonic numeric or lexically ordered string field to reject older or repeated versions.

The queue and payload size are bounded. Overflow disconnects without acknowledging unpublished messages. Malformed payloads are durably quarantined before acknowledgement; `malformed_policy: fail` leaves them pending instead. Credentials use environment references; `tls` and `ca_file` configure certificate validation. Quarantine, checkpoints and credentials stay local.

```sh
timeline-convert-mqtt --workspace HBDS/Stream_Workspace.json --mode stream
```

Mosquitto integration tests cover replay after failed publication, reconnect, duplicate IDs, malformed payloads, cancellation and out-of-order versions. MySQL and Kafka can be added as separate plugins; they are not bundled adapters.

See [collector setup and API contracts](../../../timeline_data_collector/README.md) for installation, UI execution, repeat policies and recovery.
