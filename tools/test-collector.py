"""Run public core and independently owned plugin tests; private checkouts are optional."""
from pathlib import Path
import sys
import unittest

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'timeline_data_collector/python'))
sys.path.insert(0,str(root/'timeline_data_collector/tests'))
loader=unittest.TestLoader()
suite=loader.discover(str(root/'timeline_data_collector/tests'))
for name,module in [('filesources','timeline_file_sources'),('timeline_json','timeline_plugin_json'),
                    ('default','timeline_plugin_default'),('earthquake','timeline_plugin_earthquake'),
                    ('volcano','timeline_plugin_volcano'),('mqtt','timeline_plugin_mqtt')]:
    source=root/'HBDS/plugins'/name
    sys.path.insert(0,str(source/'src'))
    for path in sorted((source/'tests').glob('test_*.py')):
        import importlib.util
        spec=importlib.util.spec_from_file_location('plugin_test_'+name+'_'+path.stem,path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        suite.addTests(loader.loadTestsFromModule(module))
result=unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(not result.wasSuccessful())
