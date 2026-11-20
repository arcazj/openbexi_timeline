"""Permanent output baselines captured from the released generator."""
from pathlib import Path
from unittest.mock import patch
import hashlib
import json
import tempfile
import unittest
from timeline_data_collector.contracts import Cancelled, Context
from timeline_plugin_default.generator import generate


class NativeGeneratorTests(unittest.TestCase):
    def context(self, root):
        return Context(workspace=root / 'workspace.json', namespace='DEMO', source={'id': 'input'},
                       source_key='input', workdir=root / 'work', checkpoint={})

    def test_released_seeded_output_with_no_subprocess_or_java(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/legacy-seeded.json').read_text())
        with tempfile.TemporaryDirectory() as temp, patch('subprocess.Popen', side_effect=AssertionError('Python-only collection')):
            context = self.context(Path(temp))
            for case in fixture['cases']:
                with self.subTest(request=case['request']):
                    records = generate(case['request'], context)
                    encoded = json.dumps(records, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
                    self.assertEqual(len(records), case['records'])
                    self.assertEqual(hashlib.sha256(encoded).hexdigest(), case['sha256'])

    def test_generation_bounds_and_cancellation(self):
        with tempfile.TemporaryDirectory() as temp:
            context = self.context(Path(temp))
            request = dict(namespace='DEMO', seed=0, count=1, zones=False, start='2024-01-01', end='2024-01-01')
            for changes in ({'count': 0}, {'count': 100001}, {'end': '2023-12-31'}, {'end': '2025-01-02'}):
                with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, 'bounds'):
                    generate(dict(request, **changes), context)
            context.cancel.set()
            with self.assertRaises(Cancelled): generate(request, context)
