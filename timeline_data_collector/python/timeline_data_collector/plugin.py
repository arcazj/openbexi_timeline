"""Small helpers for plugin packages and their standalone entry points."""
from pathlib import Path
import json


def manifest_for(module_file):
    module = Path(module_file).resolve()
    for path in (module.parent / 'plugin.json', module.parents[2] / 'plugin.json'):
        if path.is_file(): return json.loads(path.read_text(encoding='utf-8-sig'))
    raise ValueError('Installed plugin manifest is missing')


def standalone(plugin_id, arguments=None):
    from .cli import main
    return main(arguments, plugin=plugin_id)
