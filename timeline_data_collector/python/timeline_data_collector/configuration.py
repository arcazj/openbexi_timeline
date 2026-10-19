"""Resolve a workspace once for a job; configuration edits are a separate operation."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import json
import os
from .io import identity, expand_env, model_root
from .namespace_config import load_bundle
from .dates import repeat_range


@dataclass(frozen=True)
class Configuration:
    workspace: Path
    hbds_root: Path
    document: dict
    revision: str
    plugin_roots: tuple[Path, ...]
    state_root: Path
    load_options: dict

    def sources(self, namespace=None, source=None, plugin=None, *, include_disabled=False):
        found = []
        for group in self.document['data_sources']:
            if namespace and group['namespace'] != namespace: continue
            for entry in group.get('sources', []):
                if source and entry['id'] != source: continue
                if plugin and entry['converter_plugin'] != plugin: continue
                if include_disabled or group.get('enable', True) and entry.get('enable', True): found.append((group, entry))
        if not found and (namespace or source or plugin): raise ValueError('No configured source matches the selection')
        return found


def source_key(group, source):
    return identity([os.path.normcase(str(model_root(group['target_path']))), group['namespace'], source['id']])


def execution_policy(value):
    policy = dict(value or {})
    mode = policy.setdefault('mode', 'once')
    if mode not in {'once', 'interval', 'watch', 'stream'}: raise ValueError('Unknown execution mode')
    policy.setdefault('overlap', 'skip')
    if policy['overlap'] != 'skip': raise ValueError('Overlapping runs are not supported')
    policy.setdefault('resume_on_restart', False)
    if not isinstance(policy['resume_on_restart'], bool): raise ValueError('resume_on_restart must be boolean')
    for name in ('date', 'end_date'):
        if policy.get(name) is not None and not isinstance(policy[name], str):
            raise ValueError(name + ' must be a string; quote fixed dates in YAML')
    repeat_range(policy.get('date'), policy.get('end_date'), policy.get('lookback_hours', 48))
    seconds = policy.get('settle_seconds', 0)
    if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not 0 <= seconds <= 86400:
        raise ValueError('settle_seconds must be between 0 and 86400')
    if mode in {'interval', 'watch'}:
        seconds = policy.setdefault('interval_seconds', 2 if mode == 'watch' else 300)
        if isinstance(seconds, bool) or not isinstance(seconds, (float, int)) or not 0 < seconds <= 31536000:
            raise ValueError('interval_seconds must be a positive number no greater than one year')
    return policy


def load(workspace, *, dataconf=None, service=None, hbds_root=None):
    workspace = Path(workspace).resolve()
    root = Path(hbds_root).resolve() if hbds_root else workspace.parent
    if dataconf:
        files = [Path(item).resolve() for item in dataconf]
        service_path = Path(service).resolve() if service else root / 'service.yml'
    else:
        document = json.loads(workspace.read_text(encoding='utf-8-sig'))
        files = [workspace.parent / item for item in document.get('namespace_files', [])]
        if not files: raise ValueError('Workspace requires namespace_files')
        service_path = Path(service).resolve() if service else workspace.parent / document.get('service', 'service.yml')
    bundle = load_bundle(files, service_path if service_path.exists() else None, root, workspace)
    for group in bundle['data_sources']:
        if 'sources' not in group:
            raise ValueError('Collector requires namespace files with sources; migrate legacy combined configuration before running')
        for entry in group.get('sources', []): execution_policy(entry.get('execution'))
    settings = bundle.get('plugins', {})
    roots = settings.get('roots', ['plugins'])
    if not isinstance(roots, list) or any(not isinstance(item, str) or not item for item in roots): raise ValueError('plugins.roots must be paths')
    roots = tuple((root / expand_env(item)).resolve() for item in roots)
    selected_state = expand_env(bundle.get('state_root', '../.local-private/timeline-collector'))
    state_root = (root / selected_state).resolve()
    return Configuration(workspace, root, bundle, identity(bundle), roots, state_root,
                         dict(dataconf=dataconf, service=service, hbds_root=str(root)))
