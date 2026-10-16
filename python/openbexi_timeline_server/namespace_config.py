"""Versioned namespace documents shared by the collector and timeline.

This module validates configuration structure, not installed processing plugins.
"""
from copy import deepcopy
import hashlib
import json
import os
import posixpath
from pathlib import Path, PureWindowsPath
import re
from urllib.parse import urlsplit
import warnings

import yaml

VERSION = 3
NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_-]{0,63}$')
RESERVED = {'CON','PRN','AUX','NUL',*(f'COM{i}' for i in range(1,10)),*(f'LPT{i}' for i in range(1,10))}
ALIASES = {'data_path': 'source_path', 'data_model': 'target_path'}
PROTOCOLS = {'http', 'https', 'no_secure', 'secure', 'secure_sse'}


class UniqueLoader(yaml.SafeLoader):
    pass


def _mapping(loader, node, deep=False):
    loader.flatten_mapping(node)
    result = {}
    for key, value in node.value:
        key = loader.construct_object(key, deep=deep)
        if key in result:
            raise ValueError(f'Duplicate YAML key: {key}')
        result[key] = loader.construct_object(value, deep=deep)
    return result


UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _mapping)


def read_yaml(path):
    path = Path(path)
    if path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError('Configuration exceeds 2 MiB')
    value = yaml.load(path.read_text(encoding='utf-8-sig'), Loader=UniqueLoader)
    if not isinstance(value, dict):
        raise ValueError('Configuration must be a mapping')
    return value


def rename_fields(value):
    """Rename only configuration fields, preserving opaque plugin options."""
    value = deepcopy(value)
    for old, new in ALIASES.items():
        if old in value:
            if new in value and value[new] != value[old]:
                raise ValueError(f'Conflicting {old} and {new}')
            value[new] = value.pop(old)
    for field in ('sources', 'data_sources'):
        if field in value:
            if not isinstance(value[field], list) or any(not isinstance(x, dict) for x in value[field]):
                raise ValueError(f'{field} must be a list of mappings')
            value[field] = [rename_fields(x) for x in value[field]]
    return value


def resolved_path(value, base):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('Path must be a nonempty string')
    def variable(match):
        if match[1] not in os.environ:
            raise ValueError(f'Environment variable {match[1]} is not set')
        return os.environ[match[1]]
    value = re.sub(r'\$\{([A-Za-z_][A-Za-z0-9_]*)}', variable, value)
    if '://' in value:
        uri = urlsplit(value)
        if not uri.scheme or not uri.netloc or uri.username or uri.password or uri.query or uri.fragment:
            raise ValueError('Source URI requires a host/bucket and cannot contain credentials, query or fragment')
        return value
    if PureWindowsPath(value).is_absolute() or value.startswith('/'):
        return posixpath.normpath(value.replace('\\', '/'))
    return (Path(base) / value).resolve().as_posix()


def has_namespace(value, namespace):
    path = urlsplit(value).path if '://' in value else value
    return namespace in path.replace('\\', '/').split('/')


def validate_namespace(document, path=None, hbds_root=None):
    value = rename_fields(document)
    if type(value.get('config_version')) is not int or value['config_version'] not in (2, VERSION):
        raise ValueError('Namespace configuration requires config_version: 2 or 3')
    name = value.get('namespace')
    if not isinstance(name, str) or not NAME.fullmatch(name) or name.upper() in RESERVED:
        raise ValueError('Namespace must be a portable identifier of 1–64 characters')
    model = value.get('model')
    if not isinstance(model, str) or not model.endswith('.json'):
        raise ValueError('Namespace requires a display model JSON reference')
    model_name = PureWindowsPath(model).stem
    if not NAME.fullmatch(model_name) or model_name.upper() in RESERVED: raise ValueError('Model filename must be a portable identifier')
    if path is not None and Path(path).name != name + '_' + model_name + '.yml':
        raise ValueError('Namespace filename must exactly match <namespace>_<model_name>.yml')
    for forbidden in ('data_sources', 'server', 'timeline_server', 'source_path', 'source_plugin', 'converter_plugin'):
        if forbidden in value:
            raise ValueError(f'{forbidden} does not belong at namespace level')
    if not isinstance(value.get('enable', True), bool):
        raise ValueError('Namespace enable must be boolean')
    base = Path(path).resolve().parent if path is not None else Path.cwd()
    target = resolved_path(value.get('target_path'), base)
    external_target = value.get('allow_external_namespace_path', False)
    if not isinstance(external_target, bool):
        raise ValueError('allow_external_namespace_path must be boolean')
    if '://' in target or not external_target and not has_namespace(target, name):
        raise ValueError('target_path must be local and contain the namespace, or explicitly allow an external namespace path')
    value['target_path'] = target
    refs = value.get('connectors', [])
    if not isinstance(refs, list) or any(not isinstance(x, str) or not x for x in refs) or len(set(refs)) != len(refs):
        raise ValueError('connectors must contain unique connector IDs')
    sources = value.get('sources')
    if not isinstance(sources, list) or not sources:
        raise ValueError('Namespace requires a nonempty sources list')
    ids = set()
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError('Each source must be a mapping')
        ident = source.get('id')
        if not isinstance(ident, str) or not NAME.fullmatch(ident) or ident.casefold() in ids:
            raise ValueError('Source IDs must be valid and unique within their namespace')
        ids.add(ident.casefold())
        if not isinstance(source.get('enable', True), bool):
            raise ValueError('Source enable must be boolean')
        for plugin in ('source_plugin', 'converter_plugin'):
            if not isinstance(source.get(plugin), str) or not NAME.fullmatch(source[plugin]):
                raise ValueError(f'Source requires a registered {plugin} identifier')
        if not isinstance(source.get('options', {}), dict):
            raise ValueError('Source options must be a mapping')
        exception = source.get('allow_external_namespace_path', False)
        if not isinstance(exception, bool):
            raise ValueError('allow_external_namespace_path must be boolean')
        if 'source_path' in source:
            source['source_path'] = resolved_path(source['source_path'], base)
            if not exception and not has_namespace(source['source_path'], name):
                raise ValueError('source_path must contain the namespace or explicitly allow an external namespace path')
        elif value['config_version'] == 2 and source['source_plugin'] != 'oracle':
            raise ValueError('File/object sources require source_path')
    metadata_root = Path(hbds_root) if hbds_root else (base.parent if base.name == 'yaml' else base)
    value['model'] = resolved_path(value['model'], metadata_root)
    if '://' in value['model'] or not Path(value['model']).resolve().is_relative_to((metadata_root/'models').resolve()):
        raise ValueError('Display models must be located in HBDS/models')
    return value


def validate_service(document, path=None):
    value = deepcopy(document or {})
    if type(value.get('config_version')) is not int or value['config_version'] not in (2, VERSION):
        raise ValueError('Service configuration requires config_version: 2 or 3')
    if any(key in value for key in ('namespace', 'sources', 'data_sources')):
        raise ValueError('Service configuration cannot own namespaces or sources')
    listeners = value.get('connectors', [])
    if not isinstance(listeners, list):
        raise ValueError('Service connectors must be a list')
    ids, bindings = set(), []
    base = Path(path).resolve().parent if path is not None else Path.cwd()
    for item in listeners:
        if not isinstance(item, dict) or not NAME.fullmatch(str(item.get('id', ''))):
            raise ValueError('Connector requires a valid ID')
        if item['id'] in ids: raise ValueError('Duplicate connector ID')
        ids.add(item['id'])
        if not isinstance(item.get('enable',True),bool): raise ValueError('Connector enable must be boolean')
        if item.get('type') not in PROTOCOLS: raise ValueError('Unsupported connector type')
        if item.get('owner') not in ('java', 'python'): raise ValueError('Connector owner must be java or python')
        port, host = item.get('port'), item.setdefault('host', '127.0.0.1')
        if type(port) is not int or not 1 <= port <= 65535: raise ValueError('Connector port must be between 1 and 65535')
        if not isinstance(host, str) or not host: raise ValueError('Connector host must be a nonempty string')
        host = '127.0.0.1' if host == 'localhost' else host
        if item.get('enable',True) and any(p == port and (h == host or h in ('0.0.0.0','::') or host in ('0.0.0.0','::')) for h,p in bindings):
            raise ValueError('Conflicting connector bindings')
        if item.get('enable',True): bindings.append((host, port))
        if item['type'] not in ('http','no_secure'):
            tls = item.get('tls')
            if not isinstance(tls, dict): raise ValueError('Secure connector requires tls settings')
            fields = ('certfile','keyfile') if item['owner'] == 'python' else ('keystore',)
            for field in fields:
                tls[field] = resolved_path(tls.get(field), base)
            if item['owner'] == 'java' and not isinstance(tls.get('password_env'), str):
                raise ValueError('Java TLS requires password_env')
    return value


def resolve_namespace_files(paths, hbds_root=None, workspace_path=None):
    paths = [paths] if isinstance(paths, (str, Path)) else list(paths)
    resolved = []
    for selected in paths:
        selected=Path(selected).resolve()
        metadata=Path(hbds_root).resolve() if hbds_root else (selected.parent.parent if selected.parent.name=='yaml' else selected.parent)
        workspace=Path(workspace_path).resolve() if workspace_path else metadata/'workspace.json'
        if workspace.exists():
            aliases=json.loads(workspace.read_text(encoding='utf-8')).get('aliases',{})
            visited=set()
            while selected.name in aliases:
                if selected.name in visited: raise ValueError('Cyclic namespace filename alias')
                visited.add(selected.name)
                alias=aliases[selected.name]
                if not isinstance(alias,str) or Path(alias).name!=alias or not alias.endswith('.yml'):
                    raise ValueError('Workspace alias must be a namespace filename')
                selected=selected.with_name(alias)
        resolved.append(selected)
    return tuple(resolved)


def load_bundle(paths, service_path=None, hbds_root=None, workspace_path=None):
    resolved=resolve_namespace_files(paths,hbds_root,workspace_path)
    if not resolved: raise ValueError('At least one namespace file is required')
    if len({os.path.normcase(str(p)) for p in resolved}) != len(resolved):
        raise ValueError('Configuration file was specified more than once')
    service = validate_service(read_yaml(service_path), service_path) if service_path else {}
    entries, names, targets = [], set(), set()
    for path in resolved:
        document = read_yaml(path)
        if 'data_sources' in document and 'namespace' not in document:
            if len(resolved) != 1 or service_path:
                raise ValueError('Migrate combined configuration before loading multiple namespace files')
            warnings.warn('Combined configuration is deprecated; migrate to namespace files', DeprecationWarning, stacklevel=2)
            return rename_fields(document)
        namespace = validate_namespace(document, path, hbds_root)
        name = namespace['namespace'].casefold()
        target = namespace['target_path'].replace('\\','/').casefold().rstrip('/')
        if name in names: raise ValueError('Duplicate namespace')
        if any(target == t or target.startswith(t+'/') or t.startswith(target+'/') for t in targets):
            raise ValueError('Namespace output paths overlap')
        names.add(name); targets.add(target)
        known = {c['id'] for c in service.get('connectors', [])}
        if any(ref not in known for ref in namespace.get('connectors', [])):
            raise ValueError('Namespace references an undefined service connector')
        entries.append(namespace)
    return {'config_version': VERSION, 'data_sources': entries, **{k:v for k,v in service.items() if k != 'config_version'}}


class Bundle:
    """Reloadable list; consumers decide when a validated snapshot becomes active."""
    def __init__(self, paths, service_path=None, hbds_root=None, workspace_path=None):
        self.service_path = Path(service_path).resolve() if service_path else None
        self.hbds_root = Path(hbds_root).resolve() if hbds_root else None
        self.workspace_path = Path(workspace_path).resolve() if workspace_path else None
        self.paths = resolve_namespace_files(paths,self.hbds_root,self.workspace_path)
        self.snapshot = load_bundle(self.paths, self.service_path, self.hbds_root,self.workspace_path)

    def read(self):
        paths=resolve_namespace_files(self.paths,self.hbds_root,self.workspace_path)
        candidate = load_bundle(paths, self.service_path, self.hbds_root,self.workspace_path)
        self.paths=paths
        self.snapshot = candidate
        return deepcopy(candidate)

    def __str__(self):
        return ', '.join(map(str, self.paths))

    @property
    def identity(self):
        return hashlib.sha256(json.dumps([list(map(str,self.paths)),str(self.service_path),str(self.workspace_path)]).encode()).hexdigest()
