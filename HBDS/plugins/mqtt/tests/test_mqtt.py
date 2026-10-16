"""Real local Mosquitto protocol tests; the broker runs only on an ephemeral loopback port."""
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import paho.mqtt.client as mqtt
from test_collector import Workspace, event
from timeline_data_collector.configuration import load
from timeline_data_collector.runner import Runner
from timeline_data_collector.publisher import Publisher


class BrokerFixture:
    def __init__(self):
        import os, shutil, socket, subprocess
        self.executable=os.environ.get('TIMELINE_TEST_MOSQUITTO') or shutil.which('mosquitto')
        if not self.executable: raise RuntimeError('Install Mosquitto or set TIMELINE_TEST_MOSQUITTO for protocol tests')
        self.temp=tempfile.TemporaryDirectory(prefix='timeline-mqtt-')
        self.root=Path(self.temp.name)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0));self.port=listener.getsockname()[1]
        self.config=self.root/'broker.conf'
        self.config.write_text(f'listener {self.port} 127.0.0.1\nallow_anonymous true\npersistence true\npersistence_location {self.root.as_posix()}/\nautosave_interval 1\nlog_type all\n',encoding='utf-8')
        self.start()

    def start(self):
        import os, subprocess, socket
        self.log=(self.root/'broker.log').open('ab')
        self.process=subprocess.Popen([self.executable,'-c',str(self.config)],stdout=self.log,stderr=subprocess.STDOUT,
                                      creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            if self.process.poll() is not None: raise RuntimeError((self.root/'broker.log').read_text())
            try:
                with socket.create_connection(('127.0.0.1',self.port),timeout=.2): return
            except OSError: time.sleep(.05)
        raise RuntimeError('Broker did not start')

    def connected(self, client_id):
        return ('Received SUBSCRIBE from '+client_id) in (self.root/'broker.log').read_text(errors='replace')

    def restart(self):
        self.process.terminate();self.process.wait(timeout=10);self.log.close();self.start()

    def close(self):
        self.process.terminate();self.process.wait(timeout=10);self.log.close();self.temp.cleanup()


class MqttTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.ws=Workspace(self.temp.name)
        self.broker=BrokerFixture();self.addCleanup(self.broker.close)
        self.ws.source.update(source_plugin='mqtt',converter_plugin='mqtt',options={'host':'127.0.0.1','port':self.broker.port,
                              'topic':'example/events','client_id':'test-collector','batch_size':2,'max_queue':8})
        self.ws.source.pop('source_path');self.ws.save()
        self.runner=Runner(load(self.ws.path));self.addCleanup(self.runner.close)
        self.publisher=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id='test-publisher')
        self.publisher.connect('127.0.0.1',self.broker.port);self.publisher.loop_start()
        self.addCleanup(lambda:(self.publisher.disconnect(),self.publisher.loop_stop()))

    def wait(self,predicate,seconds=10):
        deadline=time.monotonic()+seconds
        while time.monotonic()<deadline:
            if predicate(): return
            time.sleep(.05)
        self.fail('Timed out waiting for MQTT integration state; jobs='+str(self.runner.state.jobs()))

    def start(self):
        job=self.runner.submit(mode='stream',asynchronous=True)[0]
        self.wait(lambda:self.broker.connected('test-collector'))
        return job['id']

    def send(self,payload):
        info=self.publisher.publish('example/events',payload if isinstance(payload,bytes) else json.dumps(payload),qos=1)
        info.wait_for_publish(timeout=5)

    def test_duplicates_late_records_malformed_quarantine_and_cancel(self):
        ident=self.start()
        self.send(event('one'));self.send(event('one'));self.send(event('late','2025-12-30'));self.send(b'not JSON')
        self.wait(lambda:len(self.ws.records())==2 and bool(list((self.ws.root/'state/plugins').glob('*/quarantine/*.payload'))))
        self.assertEqual({item['id'] for item in self.ws.records()},{'one','late'})
        self.assertTrue(self.runner.cancel(ident))
        self.wait(lambda:self.runner.state.get(ident)['state']=='cancelled')

    def test_commit_before_ack_and_unacknowledged_replay(self):
        original=Publisher.publish
        failed=threading.Event()
        def failure(*args,**kwargs): failed.set();raise OSError('simulated unavailable output')
        with patch.object(Publisher,'publish',side_effect=failure):
            ident=self.start();self.send(event('replay'))
            self.wait(lambda:self.runner.state.get(ident)['state']=='failed')
        self.assertTrue(failed.is_set());self.assertEqual(self.ws.records(),[])
        # Same durable client ID resumes the broker session; no republish is needed.
        resumed=self.runner.submit(mode='stream',asynchronous=True)[0]['id']
        self.wait(lambda:len(self.ws.records())==1)
        self.assertEqual(self.ws.records()[0]['id'],'replay')
        self.runner.cancel(resumed)
        self.wait(lambda:self.runner.state.get(resumed)['state']=='cancelled')

    def test_upstream_versions_prevent_out_of_order_corrections(self):
        self.ws.source['options']['version_field']='data.revision';self.ws.save()
        ident=self.start()
        newest=event('versioned');newest['data'].update(title='Latest correction',revision=2)
        older=event('versioned');older['data'].update(title='Old value',revision=1)
        self.send(newest);self.wait(lambda:len(self.ws.records())==1)
        self.send(older)
        self.wait(lambda:self.runner.state.get(ident)['result'].get('batches',0)>=2)
        self.assertEqual(self.ws.records()[0]['data']['title'],'Latest correction')
        self.runner.cancel(ident);self.wait(lambda:self.runner.state.get(ident)['state']=='cancelled')

    def test_commit_survives_ack_failure_and_redelivery(self):
        with patch.object(mqtt.Client, 'ack', return_value=mqtt.MQTT_ERR_NO_CONN):
            ident=self.start();self.send(event('committed'))
            self.wait(lambda:self.runner.state.get(ident)['state']=='failed')
        self.assertEqual([item['id'] for item in self.ws.records()],['committed'])
        resumed=self.runner.submit(mode='stream',asynchronous=True)[0]['id']
        self.wait(lambda:self.runner.state.get(resumed)['result'].get('batches',0)>=1)
        self.assertEqual([item['id'] for item in self.ws.records()],['committed'])
        self.runner.cancel(resumed);self.wait(lambda:self.runner.state.get(resumed)['state']=='cancelled')

    def test_bounded_backlog_replays_unacknowledged_messages(self):
        self.ws.source['options'].update(max_queue=2,batch_size=1);self.ws.save()
        publishing=threading.Event();release=threading.Event();original=Publisher.publish
        def slow(*args,**kwargs):
            publishing.set()
            if not release.wait(10):raise TimeoutError('Test did not release publication')
            return original(*args,**kwargs)
        with patch.object(Publisher,'publish',side_effect=slow):
            try:
                ident=self.start();self.send(event('bounded-0'));self.assertTrue(publishing.wait(5))
                for index in range(1,12):self.send(event('bounded-'+str(index)))
            finally:release.set()
            self.wait(lambda:self.runner.state.get(ident)['state']=='failed')
        self.ws.source['options'].update(max_queue=128,batch_size=12);self.ws.save()
        resumed=self.runner.submit(mode='stream',asynchronous=True)[0]['id']
        self.wait(lambda:len(self.ws.records())==12)
        self.assertEqual({item['id'] for item in self.ws.records()},{'bounded-'+str(index) for index in range(12)})
        self.runner.cancel(resumed);self.wait(lambda:self.runner.state.get(resumed)['state']=='cancelled')

    def test_network_reconnect_keeps_one_subscription_and_progress(self):
        ident=self.start();self.send(event('before-reconnect'));self.wait(lambda:len(self.ws.records())==1)
        self.broker.restart()
        self.wait(lambda:self.publisher.is_connected())
        self.wait(lambda:(self.broker.root/'broker.log').read_text(errors='replace').count('Received SUBSCRIBE from test-collector')>=2)
        self.send(event('after-reconnect'));self.wait(lambda:len(self.ws.records())==2)
        self.runner.cancel(ident);self.wait(lambda:self.runner.state.get(ident)['state']=='cancelled')


if __name__=='__main__': unittest.main()
