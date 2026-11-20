"""Validated deployment settings. Collector credentials never enter public responses."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import os
import math
import re
import yaml

from .matching import compile_filter, digest
from .namespace_config import load_bundle, rename_fields, read_yaml, validate_service


class UniqueLoader(yaml.SafeLoader):
    pass


def unique_mapping(loader, node, deep=False):
    loader.flatten_mapping(node)
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in result:
            raise ValueError(f"Duplicate YAML key: {key}")
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)


def expand_path(value, base):
    missing = []
    def variable(match):
        if match[1] not in os.environ:
            missing.append(match[1])
        return os.environ.get(match[1], "")
    result = re.sub(r"\$\{([A-Za-z_][A-Za-z0-9_]*)}", variable, value)
    if missing:
        raise ValueError("Missing environment variable for source path: " + ", ".join(missing))
    path = Path(result).expanduser()
    return path if path.is_absolute() else base / path


@dataclass
class Source:
    index: int
    namespace: str
    model: str
    root: Path
    include: str | list[str] = ""
    exclude: str | list[str] = ""
    render: dict = field(default_factory=dict)

    def public(self):
        return {"namespace": self.namespace, "type": "json_file", "enable": True, "render": self.render}


@dataclass
class Configuration:
    root: Path
    state: Path
    sources: list[Source]
    model: str | None = None
    host: str = "127.0.0.1"
    port: int = 8783
    poll_seconds: float = 5
    verify_seconds: float = 300
    settle_seconds: float = 0
    log_level: str = "INFO"
    providers: list = field(default_factory=list)
    context_path: str = ""
    page_size: int = 256
    cursor_ttl: float = 90
    max_cursors: int = 128
    max_files: int = 10000
    max_file_bytes: int = 64 * 1024 * 1024
    max_record_bytes: int = 2 * 1024 * 1024
    max_records: int = 100000
    max_query_seconds: float = 15
    hbds_path: Path | None = None
    namespace_files: tuple = ()
    service_path: Path | None = None
    hbds_root: Path | None = None
    workspace_path: Path | None = None
    connectors: list = field(default_factory=list)

    @property
    def signature(self):
        return digest([[s.index, s.namespace, s.model, s.include, s.exclude] for s in self.sources])


def workspace_files(path):
    """Read the startup selection; relative filenames are rooted in HBDS."""
    path = Path(path).resolve()
    files = read_yaml(path).get('namespace_files')
    if not isinstance(files, list) or not files or any(not isinstance(item, str) or not item.strip() for item in files):
        raise ValueError('Workspace requires a nonempty namespace_files list of filenames')
    return tuple((path.parent / item).resolve() for item in files)


def workspace_service(path):
    path = Path(path).resolve()
    document = read_yaml(path)
    if 'service' in document:
        if not isinstance(document['service'], str) or not document['service'].strip():
            raise ValueError('Workspace service must be a filename')
        return (path.parent / document['service']).resolve()
    local = path.parent / 'service.local.yml'
    return local if local.is_file() else path.parent / 'service.yml'


def load_configuration(path, root=None, state=None, service_path=None, hbds_root=None, workspace_path=None, **overrides):
    root = Path(root or Path.cwd()).resolve()
    paths = list(path) if isinstance(path, (list, tuple)) else [path]
    if len(paths)>1 or service_path or (Path(paths[0]).is_file() and 'namespace' in read_yaml(paths[0])):
        document=load_bundle(paths,service_path,hbds_root,workspace_path)
        files=tuple(Path(p).resolve() for p in paths)
        metadata=Path(hbds_root).resolve() if hbds_root else (files[0].parent.parent if files[0].parent.name=='yaml' else files[0].parent)
        if workspace_path is not None:
            workspace_path = Path(workspace_path).resolve()
            if state is None:
                state = root / '.local-private' / ('python-' + workspace_path.stem)
        conf=configuration_from_document(document,root,state,namespace_files=files,service_path=service_path,workspace_path=workspace_path,
                                         hbds_root=metadata,connectors=document.get('connectors',[]),**overrides)
        from .namespace_workspace import NamespaceWorkspace
        NamespaceWorkspace(conf).read()  # Validate display models before starting listeners.
        return conf
    from .hbds import Store, legacy_configuration, resolve_alias
    path = resolve_alias(os.environ.get("OPENBEXI_HBDS_CONFIG") or paths[0], root)
    hbds_path = None
    if path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("Configuration exceeds 2 MiB.")
    if path.name.endswith(".hbds.json"):
        store = Store(path, root)
        document = legacy_configuration(store.read()[0])
        hbds_path = store.path
    else:
        document = yaml.load(path.read_text(encoding="utf-8"), Loader=UniqueLoader)
    return configuration_from_document(document, root, state, hbds_path=hbds_path, **overrides)


def configuration_from_document(document, root, state=None, **overrides):
    root = Path(root).resolve()
    document=rename_fields(document)
    if not isinstance(document, dict) or not isinstance(document.get("data_sources"), list):
        raise ValueError("Configuration requires a data_sources list.")
    server = document.get("timeline_server", {})
    collector = document.get("server", {})
    if not isinstance(server, dict) or not isinstance(collector, dict):
        raise ValueError("server and timeline_server must be mappings.")
    settings = {key: collector[key] for key in ("poll_seconds", "verify_seconds", "settle_seconds", "log_level") if key in collector}
    allowed = set(Configuration.__dataclass_fields__) - {"root", "state", "sources", "providers", "hbds_path"}
    unknown = set(server) - allowed - {"state", "java_url"}
    if unknown:
        raise ValueError("Unknown timeline_server settings: " + ", ".join(sorted(unknown)))
    settings.update({key: value for key, value in server.items() if key in allowed})
    settings["model"] = document.get("model", settings.get("model"))
    settings.update({key: value for key, value in overrides.items() if value is not None and key != "java_url"})
    native, providers = [], []
    state_path = expand_path(str(state or server.get("state", ".local-private/python-timeline")), root)
    for index, source in enumerate(document["data_sources"], 1):
        if not isinstance(source, dict):
            raise ValueError(f"data_sources[{index}] must be a mapping.")
        enabled = source.get("enable", True)
        if not (isinstance(enabled, bool) or isinstance(enabled, str) and enabled in ("true", "false")):
            raise ValueError(f"data_sources[{index}].enable must be boolean.")
        if enabled in (False, "false"):
            continue
        kind = str(source.get("type", "json_file")).lower()
        if kind in ("mongo", "mongodb"):
            from .providers import expand
            identity = digest(expand(source))[:24]
            provider = dict(source, index=index, namespace=str(source.get("namespace", "")),
                            snapshot_path=str(state_path / "providers" / f"{index}-{identity}" / "events.json"))
            providers.append(provider)
            source = dict(source, target_path=str(Path(provider["snapshot_path"]).parent))
        elif kind not in ("json_file", "local", "sftp", "s3", "oracle"):
            raise ValueError("Unsupported source provider: " + str(kind) + ". Configure a collector that materializes timeline JSON.")
        models = source.get("target_path")
        if isinstance(models, str):
            models = [models]
        if not isinstance(models, list) or not models or any(not isinstance(m, str) or not m.strip() for m in models):
            raise ValueError(f"data_sources[{index}].target_path must be a path or nonempty path list.")
        rules = source.get("filter") or {}
        if not isinstance(rules, dict):
            raise ValueError(f"data_sources[{index}].filter must be a mapping.")
        for key in ("include", "exclude"):
            rule = rules.get(key, "")
            if not isinstance(rule, str) and not (isinstance(rule, list) and all(isinstance(s, str) for s in rule)):
                raise ValueError(f"data_sources[{index}].filter.{key} must be text or a list of filename patterns.")
            if isinstance(rule, str) and kind in ("json_file", "mongo", "mongodb"):
                compile_filter(rule)
        render = source.get("render") or {}
        if not isinstance(render, dict):
            raise ValueError(f"data_sources[{index}].render must be a mapping.")
        for model in models:
            resolved = str(expand_path(model, root)).replace("\\", "/")
            prefix = re.split(r"/(?:yyyy|mm|dd)(?:/|$)", resolved, maxsplit=1)[0]
            native.append(Source(index, str(source.get("namespace", "")), resolved, Path(prefix).absolute(),
                                 rules.get("include", "") if kind in ("json_file", "mongo", "mongodb") else "",
                                 rules.get("exclude", "") if kind in ("json_file", "mongo", "mongodb") else "", render))
    if not settings.get('connectors') and not settings.get('namespace_files'):
        settings['connectors'] = legacy_connectors(document, root, settings.get('host', '127.0.0.1'))
    conf = Configuration(root, state_path, native, providers=providers, **settings)
    if conf.model is not None and (not isinstance(conf.model, str) or not conf.model.strip()):
        raise ValueError("model must be a nonempty path string.")
    for key in ("port", "page_size", "max_cursors", "max_files", "max_file_bytes", "max_record_bytes", "max_records"):
        value = getattr(conf, key)
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise ValueError(f"timeline_server.{key} must be a positive integer.")
    if conf.page_size > 256 or conf.port > 65535:
        raise ValueError("page_size cannot exceed 256; port must be at most 65535.")
    for key in ("poll_seconds", "verify_seconds", "settle_seconds", "cursor_ttl", "max_query_seconds"):
        value = getattr(conf, key)
        if not isinstance(value, (float, int)) or isinstance(value, bool) or not math.isfinite(value) or value < 0 or value > 86400:
            raise ValueError(f"timeline_server.{key} must be a duration between 0 and 86400 seconds.")
    conf.poll_seconds = max(.25, conf.poll_seconds)
    if conf.cursor_ttl < 1 or conf.max_query_seconds < 1:
        raise ValueError("cursor_ttl and max_query_seconds must be at least one second.")
    if conf.log_level not in ("INFO", "WARNING", "ERROR"):
        raise ValueError("log_level must be INFO, WARNING or ERROR.")
    if conf.context_path and not re.fullmatch(r"/[A-Za-z0-9_/-]+", conf.context_path):
        raise ValueError("Invalid context_path.")
    conf.context_path = conf.context_path.rstrip("/")
    return conf


def legacy_connectors(document, root, host='127.0.0.1'):
    """Retain combined-YAML listener ports/transports and TLS environment names."""
    listeners = {}
    for source in document.get('data_sources', []):
        if source.get('enable', True) in (False, 'false'):
            continue
        connectors = source.get('connector', [])
        if isinstance(connectors, str):
            connectors = [connectors]
        if not isinstance(connectors, list) or any(not isinstance(value, str) for value in connectors):
            raise ValueError('Legacy source connector must be text or a text list.')
        for value in connectors:
            for token in value.split('|'):
                token = token.strip()
                if not token:
                    continue
                match = re.fullmatch(r'(http|https|no_secure|secure|secure_sse):(\d{1,5})', token)
                if not match:
                    raise ValueError('Legacy connector must use a supported protocol:port.')
                protocol, port = match.groups()
                identity = protocol + '_' + port
                listener = dict(id=identity, owner='python', type=protocol, port=int(port), host=host)
                if protocol not in ('http', 'no_secure'):
                    if not os.getenv('TIMELINE_KEYSTORE'):
                        raise ValueError('Legacy secure listeners require TIMELINE_KEYSTORE and TIMELINE_KEYSTORE_PASSWORD.')
                    listener['tls'] = dict(keystore=str(expand_path(os.environ['TIMELINE_KEYSTORE'], Path(root)).resolve()),
                                           password_env='TIMELINE_KEYSTORE_PASSWORD')
                    if os.getenv('TIMELINE_KEY_ALIAS'):
                        listener['tls']['key_alias'] = os.environ['TIMELINE_KEY_ALIAS']
                listeners[identity] = listener
    return validate_service(dict(config_version=3, connectors=list(listeners.values())))['connectors']
