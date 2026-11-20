"""Administrator configuration documents with conditional, atomic editing."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
from urllib.parse import unquote

import yaml

from .api_common import APIError, atomic_text, fields, locked, no_links, private_directory, require_match, strict_json
from .api_models import Models

MAX_BYTES = 2 * 1024 * 1024


class UniqueLoader(yaml.SafeLoader):
    def construct_mapping(self, node, deep=False):
        self.flatten_mapping(node)
        result = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if key in result:
                raise ValueError('Duplicate YAML property')
            result[key] = self.construct_object(value_node, deep=deep)
        return result


def bounded_yaml(text, aliases=50):
    depth = count = 0
    for event in yaml.parse(text):
        if isinstance(event, yaml.events.AliasEvent):
            count += 1
            if count > aliases:
                raise ValueError('Too many YAML aliases')
        if isinstance(event, (yaml.events.MappingStartEvent, yaml.events.SequenceStartEvent)):
            depth += 1
            if depth > 40:
                raise ValueError('YAML nesting exceeds forty levels')
        elif isinstance(event, (yaml.events.MappingEndEvent, yaml.events.SequenceEndEvent)):
            depth -= 1
    value = yaml.load(text, Loader=UniqueLoader)
    active, completed = set(), set()
    def inspect(item, nesting=0):
        if not isinstance(item, (dict, list)):
            return
        if nesting > 40 or id(item) in active:
            raise ValueError('YAML must not contain cyclic aliases or excessive nesting')
        if id(item) in completed:
            return
        active.add(id(item))
        for child in item.values() if isinstance(item, dict) else item:
            inspect(child, nesting + 1)
        active.remove(id(item))
        completed.add(id(item))
    inspect(value)
    if not isinstance(value, dict):
        raise ValueError('Configuration must contain one mapping document')
    return value


def document_etag(value):
    text = value['id'] + '\n' + value['name'] + '\n' + value['text']
    return '"' + hashlib.sha256(text.encode('utf-8')).hexdigest() + '"'


class ConfigFiles:
    def __init__(self, root, storage, configured_roots=()):
        self.root = Path(root).resolve()
        self.storage = private_directory(storage, self.root)
        self.roots = [self.storage]
        for directory in configured_roots:
            approved = no_links(directory).resolve(strict=True)
            if not approved.is_dir() or any(approved.is_relative_to(p) or p.is_relative_to(approved) for p in self.roots):
                raise ValueError('Configuration roots must be directories and must not overlap.')
            self.roots.append(approved)
        self.models = Models(self.root)

    @staticmethod
    def kind(file):
        return 'model' if file.suffix.lower() == '.json' else 'yaml'

    def documents(self):
        for index, directory in enumerate(self.roots):
            if not directory.is_dir():
                continue
            no_links(directory)
            for base, directories, names in os.walk(directory, followlinks=False):
                base = Path(base)
                directories[:] = [name for name in sorted(directories) if not (base / name).is_symlink()
                                  and not (hasattr(base / name, 'is_junction') and (base / name).is_junction())]
                if len(base.relative_to(directory).parts) >= 9:
                    directories[:] = []
                for name in sorted(names):
                    file = base / name
                    if name.startswith('.') or file.suffix.lower() not in ('.json', '.yaml', '.yml') or not file.is_file() or file.is_symlink():
                        continue
                    no_links(file)
                    yield index, file

    def identity(self, document):
        index, file = document
        return hashlib.sha256(f'{index}:{file.relative_to(self.roots[index])}'.encode()).hexdigest()[:32]

    def find(self, identity):
        if not isinstance(identity, str) or not re.fullmatch('[a-f0-9]{32}', identity):
            raise APIError(400, 'Invalid configuration document ID.')
        for document in self.documents():
            if self.identity(document) == identity:
                return document
        raise APIError(404, 'Configuration document not found.')

    def metadata(self, document):
        index, file = document
        kind = self.kind(file)
        return dict(id=self.identity(document), name=file.name, kind=kind, writable=True,
                    restartRequired=kind == 'yaml',
                    location=('managed/' if index == 0 else f'configured-{index}/') + file.relative_to(self.roots[index]).as_posix())

    @staticmethod
    def read_text(document):
        file = no_links(document[1])
        with file.open('rb') as stream:
            content = stream.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            raise APIError(413, 'Configuration document exceeds 2 MiB.')
        return content.decode('utf-8')

    def list(self):
        return [self.metadata(document) for document in self.documents()]

    def read(self, identity):
        document = self.find(identity)
        return dict(self.metadata(document), text=self.read_text(document))

    @staticmethod
    def filename(value):
        fields(value, {'name', 'kind', 'text'})
        if any(not isinstance(value.get(key), str) for key in ('name', 'kind', 'text')):
            raise APIError(422, 'Provide name, kind and text only.')
        name = value['name']
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_. -]{0,119}\.(json|yaml|yml)', name) or '..' in name or re.match(r'(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])\.', name, re.I):
            raise APIError(422, 'Use a simple JSON or YAML filename without directories or reserved names.')
        if value['kind'] not in ('model', 'yaml') or (value['kind'] == 'model') != name.endswith('.json'):
            raise APIError(422, 'Model files use .json; YAML files use .yaml or .yml.')
        return name

    def validate(self, value):
        self.filename(value)
        if len(value['text'].encode('utf-8')) > MAX_BYTES:
            raise APIError(413, 'Configuration document exceeds 2 MiB.')
        try:
            if value['kind'] == 'yaml':
                return self.validate_yaml(value['text'])
            model = strict_json(value['text'])
            return self.models.validate(model, legacy=True)
        except APIError:
            raise
        except (ValueError, TypeError, yaml.YAMLError, RecursionError) as error:
            raise APIError(422, 'Invalid configuration document.') from error

    def validate_yaml(self, text):
        value = bounded_yaml(text)
        if 'params' in value and 'bands' in value:
            self.models.validate(value, legacy=True)
            return value
        if value.get('model') is not None and not isinstance(value['model'], str):
            raise APIError(422, 'YAML model must be a path string or null.')
        if 'data_sources' in value:
            sources = value['data_sources']
            if not isinstance(sources, list):
                raise APIError(422, 'data_sources must be a list.')
            names = set()
            for source in sources:
                if not isinstance(source, dict) or not isinstance(source.get('namespace'), str) or not source['namespace'].strip():
                    raise APIError(422, 'Every data source needs a namespace.')
                if source['namespace'] in names:
                    raise APIError(422, 'Data source namespaces must be unique.')
                names.add(source['namespace'])
                if 'enable' in source and not isinstance(source['enable'], bool):
                    raise APIError(422, 'Source enable must be Boolean.')
                self.strings(source, 'type', 'permission', 'converter2events_class', 'data_path', 'data_model', 'connector', 'url', 'database', 'collection')
                for field, keys in [('filter', ('include', 'exclude')), ('render', ('color', 'textColor', 'dateColor', 'alternateColor'))]:
                    if field in source:
                        if not isinstance(source[field], dict):
                            raise APIError(422, f'Source {field} must be a mapping.')
                        self.strings(source[field], *keys)
        elif not {'model', 'server', 'snapshot', 'apiVersion', 'rules'} & value.keys():
            raise APIError(422, 'Unsupported YAML configuration type.')
        if 'server' in value:
            server = value['server']
            if not isinstance(server, dict):
                raise APIError(422, 'server must be a mapping.')
            self.strings(server, 'host', 'state_root')
            if 'local_browser' in server and not isinstance(server['local_browser'], bool):
                raise APIError(422, 'server.local_browser must be Boolean.')
            if 'port' in server and (type(server['port']) is not int or not 1 <= server['port'] <= 65535):
                raise APIError(422, 'server.port must be an integer from 1 to 65535.')
        if 'snapshot' in value:
            if not isinstance(value['snapshot'], dict):
                raise APIError(422, 'snapshot must be a mapping.')
            self.strings(value['snapshot'], 'file')
        self.strings(value, 'apiVersion', 'kind')
        if 'rules' in value and not isinstance(value['rules'], list):
            raise APIError(422, 'rules must be a list.')
        return value

    @staticmethod
    def strings(value, *keys):
        if any(key in value and not isinstance(value[key], str) for key in keys):
            raise APIError(422, 'Configuration path and text fields must be strings.')

    def unreferenced(self, target):
        name = target[1].name
        visited = set()
        def references(value):
            if isinstance(value, str):
                compared = unquote(re.split('[?#]', value.replace('\\', '/'), 1)[0])
                expected = name
                if os.name == 'nt':
                    compared, expected = compared.lower(), expected.lower()
                return compared == expected or compared.endswith('/' + expected)
            if isinstance(value, (dict, list)):
                if id(value) in visited:
                    return False
                visited.add(id(value))
                return any(references(child) for child in (value.values() if isinstance(value, dict) else value))
            return False
        found = []
        for document in self.documents():
            if document == target:
                continue
            try:
                text = self.read_text(document)
                value = self.validate_yaml(text) if self.kind(document[1]) == 'yaml' else strict_json(text)
                visited.clear()
                if references(value):
                    found.append(document[1].name)
            except (APIError, ValueError, TypeError, yaml.YAMLError, RecursionError) as error:
                raise APIError(409, f'Correct invalid document {document[1].name} before changing references.') from error
        if target[1].is_relative_to(self.root):
            relative = target[1].relative_to(self.root).as_posix()
            for file in [*self.root.glob('*.html'), self.root / 'demos/catalog.json']:
                if file.exists() and relative in file.read_text(encoding='utf-8'):
                    found.append(file.name)
        if found:
            raise APIError(409, 'Update references before renaming or deleting: ' + ', '.join(found))

    def create(self, value):
        name = self.filename(value)
        self.validate(value)
        with locked(self.storage / '.config.lock'):
            file = no_links(self.storage / name)
            if file.exists():
                raise APIError(409, 'A document with that name already exists.')
            atomic_text(file, value['text'])
            return self.read(self.identity((0, file)))

    def update(self, identity, expected, value):
        name = self.filename(value)
        self.validate(value)
        with locked(self.storage / '.config.lock'):
            index, source = self.find(identity)
            current = self.read(identity)
            require_match(expected, current, document_etag(current))
            if self.kind(source) != value['kind']:
                raise APIError(422, 'Changing document type requires Save As.')
            destination = no_links(source.with_name(name))
            if destination != source:
                if destination.exists():
                    raise APIError(409, 'A document with that name already exists.')
                self.unreferenced((index, source))
                if value['text'] != current['text']:
                    raise APIError(409, 'Save content changes before renaming the file.')
                os.replace(no_links(source), destination)
            else:
                atomic_text(destination, value['text'])
            return self.read(self.identity((index, destination)))

    def delete(self, identity, expected):
        with locked(self.storage / '.config.lock'):
            current = self.read(identity)
            require_match(expected, current, document_etag(current))
            document = self.find(identity)
            self.unreferenced(document)
            no_links(document[1]).unlink()
