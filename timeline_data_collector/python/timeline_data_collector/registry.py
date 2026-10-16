"""Discover independently built plugins without importing optional drivers eagerly."""
from __future__ import annotations
from dataclasses import dataclass
from importlib import import_module, metadata
from pathlib import Path
import json
import re
import sys
from . import API_VERSION


@dataclass(frozen=True)
class Registration:
    manifest: dict
    root: Path | None
    loader: object = None


class Registry:
    def __init__(self, roots=(), *, installed=True):
        self.entries = {}
        if installed:
            for entry in metadata.entry_points(group='timeline_data_collector.plugins'):
                provider = entry.load()
                manifest = provider.manifest()
                self.register(manifest, None, provider)
        for selected in roots:
            root = Path(selected).resolve()
            if not root.exists(): continue
            for path in sorted(root.glob('*/plugin.json')):
                manifest = json.loads(path.read_text(encoding='utf-8-sig'))
                self.register(manifest, path.parent)

    def register(self, manifest, root=None, loader=None):
        required = ('id', 'version', 'api_version', 'entry_point', 'capabilities', 'supported_modes')
        if not isinstance(manifest, dict) or any(key not in manifest for key in required): raise ValueError('Incomplete plugin manifest')
        name = manifest['id']
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}', name) or name == 'NONE': raise ValueError('Invalid plugin ID')
        if not isinstance(manifest['version'], str) or not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', manifest['version']): raise ValueError('Plugin version must be a semantic version')
        if str(manifest['api_version']) != API_VERSION: raise ValueError('Incompatible plugin API: ' + name)
        if not manifest['capabilities'] or not set(manifest['capabilities']) <= {'source', 'converter', 'generator'}: raise ValueError('Unknown plugin capability')
        if not set(manifest['supported_modes']) <= {'once', 'interval', 'watch', 'stream'}: raise ValueError('Unknown plugin execution mode')
        old = self.entries.get(name)
        if old:
            # An editable install and its checked-out manifest describe the same package.
            if old.manifest != manifest: raise ValueError('Conflicting plugin registrations: ' + name)
            if old.root is not None or root is None: raise ValueError('Duplicate plugin registration: ' + name)
        registration = Registration(manifest, root, loader or (old.loader if old else None))
        self.entries[name] = registration
        for alias in manifest.get('aliases', []):
            if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}', alias) or alias == 'NONE': raise ValueError('Invalid plugin alias')
            if alias in self.entries and self.entries[alias].manifest != manifest: raise ValueError('Conflicting plugin alias: ' + alias)
            self.entries[alias] = registration

    def metadata(self, name):
        try: return self.entries[name].manifest
        except KeyError: raise ValueError('Plugin unavailable: ' + name) from None

    def load(self, name, capability=None, mode='once', options=None):
        manifest = self.metadata(name)
        if capability and capability not in manifest['capabilities']: raise ValueError(f'{name} does not provide {capability}')
        if mode not in manifest['supported_modes']: raise ValueError(f'{name} does not support {mode}')
        registration = self.entries[name]
        if manifest.get('options_schema') is not None:
            from jsonschema import Draft202012Validator
            Draft202012Validator(manifest['options_schema']).validate(options or {})
        elif registration.root and manifest.get('config_schema'):
            from jsonschema import Draft202012Validator
            schema_path = (registration.root / manifest['config_schema']).resolve()
            if not schema_path.is_relative_to(registration.root): raise ValueError('Plugin schema escapes its package')
            schema = json.loads(schema_path.read_text(encoding='utf-8'))
            Draft202012Validator(schema).validate(options or {})
        if registration.loader:
            factory = registration.loader
        else:
            source = registration.root / 'src'
            if not source.is_dir(): raise ValueError('Plugin source package is missing: ' + name)
            if str(source) not in sys.path: sys.path.insert(0, str(source))
            module, separator, attribute = manifest['entry_point'].partition(':')
            if not separator: raise ValueError('Python adapter entry_point needs module:factory')
            factory = getattr(import_module(module), attribute)
        return factory()

    def describe(self):
        return [dict(item.manifest) for name, item in sorted(self.entries.items()) if name == item.manifest['id']]
