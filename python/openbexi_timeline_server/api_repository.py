"""Dataset transactions and configuration-only revision history."""
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import uuid

from .api_common import APIError, atomic_json, canonical, etag, fields, locked, no_links, private_directory, read_json, require_match, string, valid_id
from .api_models import Models, axis, parse_records, validate_record


class Repository:
    def __init__(self, root, storage):
        self.root = Path(root).resolve()
        self.storage = private_directory(storage, self.root)
        self.models = Models(self.root)
        self.public = {}
        self.cache = {}
        catalog = self.root / 'demos/catalog.json'
        if catalog.is_file():
            self.public = {valid_id(item['id']): item for item in json.loads(catalog.read_text(encoding='utf-8'))['demos']}

    def read(self, identity):
        valid_id(identity)
        if identity in self.public:
            if identity not in self.cache:
                entry = self.public[identity]
                model_path, event_path = (self.root / entry[key] for key in ('model', 'dataset'))
                if not model_path.resolve().is_relative_to(self.root) or not event_path.resolve().is_relative_to(self.root):
                    raise OSError('Catalog path escapes the application root.')
                model = self.models.validate(json.loads(model_path.read_text(encoding='utf-8')))
                self.cache[identity] = dict(id=identity, title=entry['title'], description=entry.get('description', ''),
                    model=self.models.canonical(model), events=parse_records(event_path.read_text(encoding='utf-8'), model), filters=[], readOnly=True)
            return deepcopy(self.cache[identity])
        path = no_links(self.storage / (identity + '.json'))
        if not path.is_file():
            raise APIError(404, 'Dataset not found.')
        return read_json(path)

    def identities(self):
        result = list(self.public)
        if self.storage.is_dir():
            result += [p.stem for p in sorted(self.storage.glob('*.json')) if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', p.stem) and p.stem not in self.public and p.is_file() and not p.is_symlink()]
        return result

    def metadata(self, value):
        identity = value['id']
        writable = not value.get('readOnly', False)
        return dict(id=identity, title=value['title'], description=value.get('description', ''), timeAxis=axis(value['model']),
            recordCount=len(value['events']), readOnly=not writable,
            capabilities=dict(read=True, create=writable, update=writable, delete=writable),
            links=dict(self=f'/api/v1/datasets/{identity}', model=f'/api/v1/models/{identity}', events=f'/api/v1/datasets/{identity}/events',
                       sessions=f'/api/v1/datasets/{identity}/sessions', filters=f'/api/v1/models/{identity}/filters'))

    def validate(self, value):
        string(value, 'title', maximum=300, required=True)
        string(value, 'description', '', maximum=10000)
        self.models.validate(value['model'])
        if not isinstance(value['events'], list) or not isinstance(value.get('filters'), list):
            raise APIError(422, 'Events and filters must be arrays.')
        identities = set()
        def record(entry):
            validate_record(entry, axis(value['model']))
            if entry['id'] in identities:
                raise APIError(409, 'Event and activity IDs must be unique.')
            identities.add(entry['id'])
            for child in entry.get('activities', []):
                record(child)
        for entry in value['events']:
            record(entry)
        return value

    def save(self, value):
        self.validate(value)
        value['revision'] = str(uuid.uuid4())
        atomic_json(self.storage / (valid_id(value['id']) + '.json'), value)
        return value

    def create(self, value, observer=None):
        fields(value, {'id', 'title', 'description', 'sourceId', 'model', 'events'})
        identity = valid_id(value.get('id'))
        for key in ('title', 'description', 'sourceId'):
            if key in value and not isinstance(value[key], str):
                raise APIError(422, f'{key} must be a string.')
        with locked(self.storage / '.locks' / (identity + '.lock')):
            if identity in self.identities():
                raise APIError(409, 'Dataset already exists.')
            if 'sourceId' in value:
                if 'model' in value or 'events' in value:
                    raise APIError(422, 'sourceId cannot be combined with model or events.')
                result = self.read(value['sourceId'])
                for item in result.get('filters', []):
                    item['modelId'] = identity
            else:
                model = self.models.validate(value.get('model'))
                result = dict(model=self.models.canonical(model), events=deepcopy(value.get('events', [])), filters=[])
            result.update(id=identity, readOnly=False, title=value.get('title', result.get('title', identity)), description=value.get('description', result.get('description', '')))
            self.validate(result)
            if observer:
                observer(result)
            return self.save(result)

    def mutate(self, identity, expected, edit, observer=None):
        valid_id(identity)
        if identity in self.public:
            raise APIError(405, 'Clone a public example before editing.')
        with locked(self.storage / '.locks' / (identity + '.lock')):
            current = self.read(identity)
            require_match(expected, current)
            result = edit(deepcopy(current))
            if result is None:
                no_links(self.storage / (identity + '.json')).unlink()
                return None
            self.save(result)
            if observer:
                observer(current['model'], result['model'])
            return result


class ModelHistory:
    def __init__(self, storage):
        self.directory = Path(storage) / 'model-history'

    def load(self, identity):
        return read_json(self.directory / (valid_id(identity) + '.json'), {'modelId': identity, 'items': []})

    def list(self, identity):
        return dict(modelId=identity, items=[{k: v for k, v in item.items() if k != 'configuration'} for item in self.load(identity)['items']])

    def read(self, identity, revision):
        if not re.fullmatch(r'[a-f0-9]{64}', revision):
            raise APIError(400, 'Invalid model revision.')
        for item in self.load(identity)['items']:
            if item['revision'] == revision:
                return item
        raise APIError(404, 'Model revision not found.')

    def record(self, identity, actor, previous, current):
        for value in (previous, current):
            if value is not None and set(value) & {'events', 'records', 'activities'}:
                raise ValueError('History accepts model configurations only.')
        def entry(value, actor, state):
            return dict(revision=etag(value).strip('"'), savedAt=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                        savedBy=actor or 'system', state=state, configuration=deepcopy(value))
        with locked(self.directory / '.lock'):
            history = self.load(identity)
            items = history['items']
            if not items and previous is not None:
                items.append(entry(previous, 'existing-configuration', 'baseline'))
            if not items or items[-1]['revision'] != etag(current).strip('"'):
                items.append(entry(current, actor, 'saved'))
                atomic_json(self.directory / (valid_id(identity) + '.json'), history)
            return {k: v for k, v in items[-1].items() if k != 'configuration'}
