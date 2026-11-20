"""Native versioned resource API: models, datasets, records and administration."""
from copy import deepcopy
from http import HTTPStatus
import hmac
import inspect
import json
import logging
import os
from pathlib import Path
import re
import threading
from urllib.parse import quote
import uuid

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse, Response

from . import __version__
from .api_access import AccessStore, Principal, access_etag
from .api_common import APIError, etag, fields, merge, require_match, strict_json, valid_id
from .api_models import axis, coordinate, session, validate_record
from .api_repository import ModelHistory, Repository

LOG = logging.getLogger('openbexi.timeline')
QUERY = {'from', 'to', 'search', 'namespace', 'kind'}


def allow(method, allowed):
    if method not in allowed:
        raise APIError(405, 'Method is not supported for this resource.', {'Allow': ', '.join((*allowed, 'OPTIONS'))})


def system_admin(principal):
    if not principal.system_admin:
        raise APIError(403 if principal.authenticated else 401, 'This operation requires system administrator access.')


def item(items, identity, sessions=False):
    for value in items:
        if value['id'] == identity and (not sessions or session(value)):
            return value
    raise APIError(404, 'Record not found.')


def visible_filter(value, principal, permissions):
    return value.get('visibility', 'shared') != 'personal' or permissions['admin'] or value.get('createdBy') == principal.id


def require_filter(value, principal, permissions):
    if not visible_filter(value, principal, permissions):
        raise APIError(404, 'Filter not found.')


def query_values(value, time_axis):
    start = coordinate(value['from'], time_axis) if 'from' in value else float('-inf')
    end = coordinate(value['to'], time_axis) if 'to' in value else float('inf')
    if start > end:
        raise APIError(422, 'from must precede to along the dataset time axis.')
    for key in ('search', 'namespace', 'kind'):
        if key in value and (not isinstance(value[key], str) or len(value[key]) > 500):
            raise APIError(422, f'{key} must be text of at most 500 characters.')
    if 'kind' in value and value['kind'] not in ('event', 'session', 'zone'):
        raise APIError(422, 'kind must be event, session, or zone.')
    return start, end


def validate_filter(value, time_axis):
    if not isinstance(value.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,159}', value['id']):
        raise APIError(422, 'Filter id must be path-safe.')
    if not isinstance(value.get('title'), str) or not value['title'].strip():
        raise APIError(422, 'Filter title must be a nonempty string.')
    if not isinstance(value.get('query'), dict) or set(value['query']) - QUERY:
        raise APIError(422, 'Filter query accepts from, to, search, namespace, and kind.')
    query_values(value['query'], time_axis)
    if value.get('visibility', 'shared') not in ('shared', 'personal'):
        raise APIError(422, 'Filter visibility must be shared or personal.')
    if 'sortBy' in value:
        sort = value['sortBy']
        if isinstance(sort, str):
            if len(sort) > 200:
                raise APIError(422, 'Filter sortBy is too long.')
        elif isinstance(sort, dict):
            if set(sort) - {'field', 'direction'} or not isinstance(sort.get('field'), str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.]{0,99}', sort['field']) or sort.get('direction') not in ('asc', 'desc'):
                raise APIError(422, 'Invalid filter sorting metadata.')
        else:
            raise APIError(422, 'sortBy must be text or a field/direction object.')


def query(dataset, params, sessions):
    seen = set()
    for key, value in params.multi_items():
        if key not in QUERY | {'offset', 'limit', 'filterId'} or key in seen:
            raise APIError(400, 'Unknown or repeated query parameter: ' + key)
        seen.add(key)
    selected = deepcopy(item(dataset['filters'], params['filterId'])['query']) if 'filterId' in params else {}
    selected.update({key: value for key, value in params.items() if key in QUERY})
    time_axis = axis(dataset['model'])
    start, end = query_values(selected, time_axis)
    try:
        offset, limit = int(params.get('offset', '0')), int(params.get('limit', '100'))
        if not 0 <= offset <= 2147483647 or not 1 <= limit <= 1000:
            raise ValueError()
    except ValueError as error:
        raise APIError(400, 'Invalid pagination: limit must be 1..1000 and offset must be nonnegative.') from error
    result = []
    for record in dataset['events']:
        kind = 'zone' if record.get('zone') else 'session' if session(record) else 'event'
        if (sessions and kind != 'session') or (selected.get('kind') and selected['kind'] != kind):
            continue
        if selected.get('namespace') and selected['namespace'] != record.get('namespace', ''):
            continue
        if selected.get('search') and selected['search'].lower() not in json.dumps(record, ensure_ascii=False).lower():
            continue
        if coordinate(record['start'], time_axis) > end or coordinate(record.get('end', record['start']), time_axis) < start:
            continue
        result.append(record)
    result.sort(key=lambda record: (coordinate(record['start'], time_axis), record['id']))
    return dict(items=result[offset:offset + limit], total=len(result), offset=offset, limit=limit,
                nextOffset=offset + limit if offset + limit < len(result) else None, timeAxis=time_axis)


class NativeAPI:
    def __init__(self, root, data_directory=None):
        self.root = Path(root).resolve()
        self.storage = Path(data_directory or os.environ.get('OPENBEXI_API_DATA_DIR') or Path.home() / '.openbexi-timeline' / 'api')
        self.repository = Repository(self.root, self.storage)
        self.access = AccessStore(self.storage)
        self.history = ModelHistory(self.storage)
        self.tokens = [(os.environ.get(name), role, identity) for name, role, identity in (
            ('OPENBEXI_API_TOKEN', 3, 'service-admin'), ('OPENBEXI_API_WRITE_TOKEN', 2, 'service-writer'), ('OPENBEXI_API_READ_TOKEN', 1, 'service-reader'))]
        if any(token and len(token) < 32 for token, _, _ in self.tokens):
            raise ValueError('API tokens must contain at least 32 characters.')
        self.origins = {value.strip() for value in os.environ.get('OPENBEXI_API_CORS_ORIGINS', '').split(',') if value.strip()}
        self.configurations = {}
        self._ai = None
        self._ai_lock = threading.Lock()

    def ai(self):
        with self._ai_lock:
            if self._ai is None:
                from .api_ai import AIService
                self._ai = AIService(self.root, self.storage)
            return self._ai

    def configuration(self, identity=None):
        from .api_config_files import ConfigFiles
        if identity not in self.configurations:
            roots = [Path(value) for value in os.environ.get('OPENBEXI_CONFIG_ROOTS', '').split(os.pathsep) if value] if identity is None else []
            directory = self.storage / 'config-files' if identity is None else self.storage / 'config-files-models' / valid_id(identity)
            self.configurations[identity] = ConfigFiles(self.root, directory, roots)
        return self.configurations[identity]

    def principal(self, request):
        header = request.headers.get('authorization')
        if header is None:
            return Principal()
        if not header.startswith('Bearer '):
            raise APIError(401, 'Use Bearer authentication.')
        supplied = header[7:]
        for token, role, identity in self.tokens:
            if token and hmac.compare_digest(token.encode(), supplied.encode()):
                return Principal(identity, role)
        return self.access.authenticate(supplied)

    async def __call__(self, request):
        headers = {'Cache-Control': 'no-store', 'Vary': 'Origin, Authorization', 'X-Content-Type-Options': 'nosniff'}
        origin = request.headers.get('origin')
        if origin in self.origins:
            headers.update({'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'ETag, Location, X-OpenBEXI-History-Warning'})
        try:
            if request.method == 'OPTIONS':
                if origin and origin not in self.origins:
                    raise APIError(403, 'Cross-origin API access is not configured for this origin.')
                headers.update({'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
                                'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, If-None-Match'})
                return Response(status_code=204, headers=headers)
            principal = await run_in_threadpool(self.principal, request)
            value = None
            if request.method in ('POST', 'PUT', 'PATCH'):
                content_type = request.headers.get('content-type', '').split(';', 1)[0].strip()
                if content_type != 'application/json' and not (request.method == 'PATCH' and content_type == 'application/merge-patch+json'):
                    raise APIError(415, 'Send application/json (or application/merge-patch+json for PATCH).')
                content = bytearray()
                async for chunk in request.stream():
                    content.extend(chunk)
                    if len(content) > 2 * 1024 * 1024:
                        raise APIError(413, 'JSON request exceeds 2 MiB.')
                try:
                    value = strict_json(content.decode('utf-8'))
                    if not isinstance(value, dict):
                        raise ValueError()
                except (ValueError, UnicodeError, RecursionError) as error:
                    raise APIError(400, 'Malformed JSON object.') from error
            result, status, extra = await run_in_threadpool(self.route, request, principal, value)
            if inspect.isawaitable(result):
                result = await result
            headers.update(extra)
            if request.method in ('GET', 'HEAD') and headers.get('ETag') and request.headers.get('if-none-match') == headers['ETag']:
                return Response(status_code=304, headers=headers)
            if request.method == 'HEAD' or status == 204:
                return Response(status_code=status, headers=headers, media_type='application/json')
            return JSONResponse(result, status, headers=headers)
        except APIError as error:
            status, detail = error.status, str(error)
            headers.update(error.headers)
        except Exception as error:
            LOG.error('Native API operation failed; error_type=%s', type(error).__name__)
            status, detail = 500, 'The request could not be completed. No partial edit was saved.'
        if status == 401:
            headers['WWW-Authenticate'] = 'Bearer realm="OpenBEXI API"'
        if status == 405:
            headers.setdefault('Allow', 'GET, HEAD, OPTIONS')
        problem = dict(type='about:blank', title=HTTPStatus(status).phrase, status=status, detail=detail, instance=request.url.path)
        return Response(status_code=status, headers=headers, media_type='application/problem+json') if request.method == 'HEAD' else JSONResponse(problem, status, headers=headers, media_type='application/problem+json')

    def documents(self, request, value, suffix, identity=None):
        from .api_config_files import document_etag
        store = self.configuration(identity)
        method = request.method
        base = '/api/v1/config-files' if identity is None else f'/api/v1/models/{identity}/config-files'
        if not suffix:
            if method in ('GET', 'HEAD'):
                result = dict(items=store.list())
                if identity:
                    result['modelId'] = identity
                return result, 200, {}
            allow(method, ('GET', 'HEAD', 'POST'))
            result = store.create(value)
            return result, 201, {'Location': base + '/' + result['id'], 'ETag': document_etag(result)}
        if len(suffix) != 1:
            raise APIError(404, 'Configuration document not found.')
        if method in ('GET', 'HEAD'):
            result = store.read(suffix[0])
        elif method == 'PUT':
            result = store.update(suffix[0], request.headers.get('if-match'), value)
        elif method == 'DELETE':
            store.delete(suffix[0], request.headers.get('if-match'))
            return None, 204, {}
        else:
            allow(method, ('GET', 'HEAD', 'PUT', 'DELETE'))
        return result, 200, {'ETag': document_etag(result)}

    def route(self, request, principal, value):
        parts = request.path_params.get('path', '').split('/')
        method, get = request.method, request.method in ('GET', 'HEAD')
        expected = request.headers.get('if-match')
        if len(parts) == 4 and parts[0] == 'models' and parts[2:] == ['ai', 'cancel']:
            if not principal.authenticated:
                raise APIError(401, 'Authenticate to cancel your AI request.')
            allow(method, ('POST',))
            fields(value, {'requestId'})
            if not isinstance(value.get('requestId'), str):
                raise APIError(422, 'Provide a requestId string.')
            return self.ai().cancel(valid_id(parts[1]), principal.id, value['requestId']), 200, {}
        if parts == ['me']:
            allow(method, ('GET', 'HEAD'))
            if not principal.authenticated:
                raise APIError(401, 'Authenticate to inspect access.')
            return self.access.me(principal), 200, {}
        if parts == ['access', 'users']:
            system_admin(principal)
            if get:
                return {'items': self.access.users()}, 200, {}
            allow(method, ('GET', 'HEAD', 'POST'))
            if any(token and value.get('token') == token for token, _, _ in self.tokens):
                raise APIError(409, 'User credentials must differ from service credentials.')
            return self.access.create_user(value), 201, {}
        if parts[0] == 'workspaces':
            system_admin(principal)
            if len(parts) == 1:
                if get:
                    return {'items': self.access.workspaces()}, 200, {}
                allow(method, ('GET', 'HEAD', 'POST'))
                return self.access.create_workspace(value), 201, {}
            if len(parts) != 3 or parts[2] != 'entitlement':
                raise APIError(404, 'Workspace resource not found.')
            identity = valid_id(parts[1])
            allow(method, ('GET', 'HEAD', 'PUT'))
            result = self.access.entitlement(identity) if get else self.access.update_entitlement(identity, expected, value)
            return result, 200, {'ETag': etag(result)}
        if parts[0] == 'config-files':
            system_admin(principal)
            return self.documents(request, value, parts[1:])
        if parts in ([''], ['health']):
            allow(method, ('GET', 'HEAD'))
            return dict(status='ok', apiVersion='1', applicationVersion=__version__, openapi='/api/v1/openapi.json', datasets='/api/v1/datasets', models='/api/v1/models', writesConfigured=any(token and role >= 2 for token, role, _ in self.tokens)), 200, {}
        if parts == ['openapi.json']:
            allow(method, ('GET', 'HEAD'))
            return json.loads((self.root / 'swagger/openapi-v1.json').read_text(encoding='utf-8')), 200, {}
        if parts[0] not in ('datasets', 'models'):
            raise APIError(404, 'Resource not found.')
        repository, access = self.repository, self.access
        if len(parts) == 1:
            if get:
                result = []
                for identity in repository.identities():
                    if not principal.authenticated and identity not in repository.public:
                        continue
                    model_access = access.access(identity, principal)
                    if identity not in repository.public and not model_access['permissions']['read']:
                        continue
                    metadata = repository.metadata(repository.read(identity))
                    if parts[0] == 'models':
                        metadata.update({key: model_access[key] for key in ('modelId', 'workspaceId', 'role', 'permissions', 'scoped')})
                    result.append(metadata)
                return {'items': result}, 200, {}
            allow(method, ('GET', 'HEAD', 'POST') if parts[0] == 'datasets' else ('GET', 'HEAD'))
            system_admin(principal)
            def created(dataset):
                if access.reserved(dataset['id']):
                    raise APIError(409, 'Reserved model identities cannot be reused. Choose a new ID.')
                if 'sourceId' in value:
                    access.inherit(value['sourceId'], dataset['id'])
            result = repository.create(value, created)
            return repository.metadata(result), 201, {'ETag': etag(result), 'Location': '/api/v1/datasets/' + result['id']}
        identity = valid_id(parts[1])
        if identity not in repository.public:
            access.require(principal, identity, 'read')
        dataset = repository.read(identity)
        model_access = access.access(identity, principal)
        allowed = model_access['permissions']
        if parts[0] == 'models' and len(parts) >= 3:
            resource = parts[2]
            if resource == 'access' and len(parts) == 3:
                allow(method, ('GET', 'HEAD', 'PUT'))
                if not get:
                    access.require(principal, identity, 'admin')
                    if identity in repository.public:
                        raise APIError(405, 'Clone a public example before assigning private access.')
                    access.update(identity, principal, expected, value)
                    model_access = access.access(identity, principal)
                return model_access, 200, {'ETag': access_etag(model_access)}
            if resource in ('preview', 'config-files', 'versions', 'ai'):
                access.require(principal, identity, 'admin')
                if resource == 'preview' and len(parts) == 3:
                    allow(method, ('GET', 'HEAD'))
                    return dict(dateTimeFormat='iso8601', events=dataset['events']), 200, {'ETag': etag(dataset)}
                if resource == 'config-files':
                    if identity in repository.public:
                        raise APIError(405, 'Clone a public example before creating model documents.')
                    return self.documents(request, value, parts[3:], identity)
                if resource == 'versions' and len(parts) in (3, 4):
                    allow(method, ('GET', 'HEAD'))
                    return (self.history.list(identity) if len(parts) == 3 else self.history.read(identity, parts[3])), 200, {}
                if resource == 'ai' and len(parts) == 4:
                    access.require_feature(identity, 'ai')
                    if parts[3] == 'providers':
                        allow(method, ('GET', 'HEAD'))
                        return self.ai().providers(), 200, {}
                    allow(method, ('POST',))
                    if parts[3] == 'generate':
                        return self.ai().generate(identity, principal.id, value), 200, {}
                    raise APIError(404, 'AI resource not found.')
            if resource == 'filters':
                parts[0] = 'datasets'
        if parts[0] == 'models':
            if len(parts) != 2:
                raise APIError(404, 'Resource not found.')
            if get:
                return dataset['model'], 200, {'ETag': etag(dataset)}
            allow(method, ('GET', 'HEAD', 'PUT'))
            access.require(principal, identity, 'admin')
            model = repository.models.validate(value)
            def change(current):
                if current['events'] and axis(current['model']) != axis(model):
                    raise APIError(409, 'A populated dataset time axis cannot be reinterpreted. Create another dataset for a different axis.')
                current['model'] = repository.models.canonical(model)
                return current
            headers = {}
            def history(previous, current):
                try:
                    self.history.record(identity, principal.id, previous, current)
                except (OSError, ValueError):
                    LOG.error('Model saved but configuration history could not be recorded.')
                    headers['X-OpenBEXI-History-Warning'] = 'Model saved; history unavailable'
            result = repository.mutate(identity, expected, change, history)
            headers['ETag'] = etag(result)
            return result['model'], 200, headers
        if len(parts) == 2:
            if get:
                return repository.metadata(dataset), 200, {'ETag': etag(dataset)}
            allow(method, ('GET', 'HEAD', 'PATCH', 'DELETE'))
            access.require(principal, identity, 'admin')
            if method == 'PATCH':
                fields(value, {'title', 'description'})
                if any(not isinstance(v, str) for v in value.values()):
                    raise APIError(422, 'Title and description must be strings.')
            def change(current):
                if method == 'DELETE':
                    access.retire(identity)
                    return None
                current.update(value)
                return current
            result = repository.mutate(identity, expected, change)
            return (None, 204, {}) if result is None else (repository.metadata(result), 200, {'ETag': etag(result)})
        if len(parts) > 4 or parts[2] not in ('events', 'sessions', 'filters') or (len(parts) == 4 and not parts[3]):
            raise APIError(404, 'Resource not found.')
        collection, target = parts[2], parts[3] if len(parts) == 4 else None
        filters, sessions = collection == 'filters', collection == 'sessions'
        key = 'filters' if filters else 'events'
        if get:
            if target:
                result = item(dataset[key], target, sessions)
                if filters:
                    require_filter(result, principal, allowed)
            elif filters:
                visible = [v for v in dataset['filters'] if visible_filter(v, principal, allowed)]
                result = dict(items=visible, total=len(visible), modelId=identity)
            else:
                if 'filterId' in request.query_params:
                    require_filter(item(dataset['filters'], request.query_params['filterId']), principal, allowed)
                result = query(dataset, request.query_params, sessions)
            return result, 200, {'ETag': etag(dataset)}
        allow(method, ('GET', 'HEAD', 'POST') if target is None else ('GET', 'HEAD', 'PUT', 'PATCH', 'DELETE'))
        access.require(principal, identity, 'writeFilters' if filters else 'writeRecords')
        creating = target is None
        if creating:
            value.setdefault('id', str(uuid.uuid4()))
            target = value['id']
        def change(current):
            records = current[key]
            previous = next((record for record in records if record['id'] == target), None)
            if creating and previous is not None:
                raise APIError(409, 'Record already exists.')
            if not creating:
                if previous is None or (sessions and not session(previous)):
                    raise APIError(404, 'Record not found.')
                if filters:
                    require_filter(previous, principal, allowed)
            if method == 'DELETE':
                records.remove(previous)
                return current
            replacement = merge(previous, value) if method == 'PATCH' else deepcopy(value)
            if replacement.get('id', target) != target:
                raise APIError(422, 'Record id is immutable.')
            replacement['id'] = target
            if filters:
                owner = previous.get('createdBy', principal.id) if previous else principal.id
                if 'createdBy' in value and value['createdBy'] != owner:
                    raise APIError(422, 'Filter creator is immutable.')
                if 'modelId' in value and value['modelId'] != identity:
                    raise APIError(422, 'Filter belongs to another model.')
                replacement.update(createdBy=owner, modelId=identity)
                validate_filter(replacement, axis(current['model']))
            else:
                validate_record(replacement, axis(current['model']))
                if sessions and not session(replacement):
                    raise APIError(422, 'A session needs an end, activities, or data.kind=session.')
            if previous is None:
                records.append(replacement)
            else:
                records[records.index(previous)] = replacement
            return current
        result = repository.mutate(identity, expected, change)
        headers = {'ETag': etag(result)}
        if creating:
            resource = 'models' if filters and '/models/' in request.url.path else 'datasets'
            headers['Location'] = f'/api/v1/{resource}/{identity}/{collection}/' + quote(target, safe='')
        return (None if method == 'DELETE' else item(result[key], target, sessions)), (204 if method == 'DELETE' else 201 if creating else 200), headers
