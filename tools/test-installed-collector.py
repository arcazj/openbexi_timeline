"""Exercise installed public plugins using only the installer's Python and Java."""
from pathlib import Path
import json
import os
import sys
import yaml
from timeline_data_collector.cli import main
from timeline_data_collector.configuration import load
from timeline_data_collector.registry import Registry

workspace = Path(sys.argv[1]).resolve()
root = workspace.parent
config = load(workspace)
registry = Registry(config.plugin_roots)
for plugin in ('filesources', 'timeline_json', 'default', 'earthquake', 'volcano', 'mqtt', 'loki'):
    assert registry.metadata(plugin)['visibility'] == 'public'
namespace = root / 'yaml/DEMO_default.yml'
value = yaml.safe_load(namespace.read_text(encoding='utf-8-sig'))
value['sources'] = [dict(id='generator', source_plugin='default', converter_plugin='default', options=dict(seed=42, count=80, zones=True))]
namespace.write_text(yaml.safe_dump(value), encoding='utf-8')
arguments = ['run', '--workspace', str(workspace), '--plugin', 'default', '--date', '2026-10-16', '--offline']
assert main(arguments) == 0
from timeline_data_collector.publisher import Publisher
publication = Publisher(value['target_path'], 'DEMO')
before = publication.read_state()['events']
assert len(before) == 83, len(before)
assert any(record.get('activities') for record in before)
assert main(arguments + ['--force']) == 0
assert publication.read_state()['events'] == before
print('Installed collector: seven public plugins, bundled Java conversion, 83 records, stable forced rerun.')
