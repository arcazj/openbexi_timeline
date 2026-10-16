"""MQTT 3.1.1 QoS 1, persistent subscriptions and acknowledgement after publication."""
from pathlib import Path
from queue import Queue, Empty, Full
import hashlib
import json
import threading
import time
from timeline_data_collector.contracts import InputBatch, RecordBatch
from timeline_data_collector.io import normalize, atomic_write, identity
from timeline_data_collector.plugin import manifest_for, standalone


class Plugin:
    @staticmethod
    def manifest(): return manifest_for(__file__)

    def read(self, context):
        import paho.mqtt.client as mqtt
        options = context.options
        if context.offline: raise ValueError('MQTT requires a broker connection')
        incoming = Queue(maxsize=options.get('max_queue', 128))
        errors = Queue(maxsize=1)
        subscribed = threading.Event()
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                            client_id=options.get('client_id', 'timeline-' + context.source_key[:32]),
                            clean_session=False, protocol=mqtt.MQTTv311, manual_ack=True)
        if options.get('username'): client.username_pw_set(options['username'], options.get('password'))
        if options.get('tls'): client.tls_set(ca_certs=options.get('ca_file'))
        client.reconnect_delay_set(1, 30)
        def fail(message):
            try: errors.put_nowait(message)
            except Full: pass
            client.disconnect()
        def connected(connection, userdata, flags, reason, properties):
            if reason.is_failure: fail('Broker rejected the connection: ' + str(reason)); return
            status, _ = connection.subscribe(options['topic'], qos=1)
            if status != mqtt.MQTT_ERR_SUCCESS: fail('Could not subscribe to the configured topic')
        def subscription(connection, userdata, mid, reasons, properties):
            if any(reason.is_failure or reason.value != 1 for reason in reasons): fail('Broker did not grant QoS 1')
            else: subscribed.set()
        def received(connection, userdata, message):
            if message.qos != 1: fail('Publisher must use QoS 1 for durable delivery'); return
            if len(message.payload) > options.get('max_payload_bytes', 65536):
                fail('MQTT payload exceeds max_payload_bytes; message remains unacknowledged'); return
            try: incoming.put_nowait(message)
            except Full: fail('MQTT backlog is full; unacknowledged messages remain with the broker')
        client.on_connect, client.on_subscribe, client.on_message = connected, subscription, received
        client.connect_async(options['host'], options.get('port', 1883), keepalive=options.get('keepalive', 30))
        client.loop_start()
        count = context.checkpoint.get('messages_seen', 0)
        received_count = 0
        last_message = time.monotonic()
        deadline = last_message + options.get('connect_timeout', 30)
        try:
            while True:
                context.check_cancelled()
                if not errors.empty(): raise RuntimeError(errors.get_nowait())
                if not subscribed.is_set() and time.monotonic() > deadline: raise TimeoutError('MQTT subscription timed out')
                try: message = incoming.get(timeout=.1)
                except Empty:
                    if context.mode == 'once' and subscribed.is_set() and time.monotonic() - last_message >= options.get('idle_timeout', 2): return
                    continue
                messages = [message]
                capacity = min(options.get('batch_size', 50), options.get('max_messages', 2**31) - received_count)
                while len(messages) < capacity:
                    try: messages.append(incoming.get_nowait())
                    except Empty: break
                count += len(messages); received_count += len(messages); last_message = time.monotonic()
                def acknowledge(messages=messages):
                    for message in messages:
                        result = client.ack(message.mid, message.qos)
                        if result != mqtt.MQTT_ERR_SUCCESS: raise RuntimeError('MQTT acknowledgement failed; durable records will deduplicate redelivery')
                checkpoint = {'messages_seen': count, 'last_batch': identity([hashlib.sha256(m.payload).hexdigest() for m in messages])}
                yield InputBatch([m.payload for m in messages], checkpoint, acknowledge)
                if received_count >= options.get('max_messages', 2**31): return
        finally:
            client.disconnect()
            client.loop_stop()

    def convert(self, batch, context):
        records = []
        versions = dict(context.checkpoint.get('record_versions', {}))
        version_field = context.options.get('version_field')
        for raw in batch.items:
            try:
                converted = normalize(json.loads(raw.decode('utf-8-sig')), context.namespace, context.source_key)
                accepted, candidate_versions = [], dict(versions)
                for record in converted:
                    if version_field:
                        version = record
                        for field in version_field.split('.'): version = version[field]
                        if isinstance(version, bool) or not isinstance(version, (str, int, float)): raise ValueError('Invalid upstream record version')
                        previous = candidate_versions.get(record['id'])
                        if previous is not None and version <= previous: continue
                        candidate_versions[record['id']] = version
                    accepted.append(record)
                records.extend(accepted)
                versions = candidate_versions
            except (ValueError, TypeError, KeyError, UnicodeError) as error:
                if context.options.get('malformed_policy', 'quarantine') == 'fail': raise ValueError('Malformed MQTT payload') from error
                # Quarantine is durable before this batch can be acknowledged, and remains private.
                digest = hashlib.sha256(raw).hexdigest()
                atomic_write(context.workdir / 'quarantine' / (digest + '.payload'), raw)
                context.logger.warning('Quarantined malformed message %s (%s)', digest, type(error).__name__)
        checkpoint = dict(batch.checkpoint)
        if version_field: checkpoint['record_versions'] = versions
        return RecordBatch(records, checkpoint, acknowledge=batch.acknowledge)

    def collect(self, context):
        for incoming in self.read(context): yield self.convert(incoming, context)


def main(): return standalone('mqtt')
