"""Private principals, workspace membership, scoped permissions and entitlements."""
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
from pathlib import Path
import secrets
import uuid

from .api_common import APIError, atomic_json, etag, fields, locked, read_json, require_match, string, valid_id


@dataclass(frozen=True)
class Principal:
    id: str = 'anonymous'
    service_role: int = 0

    @property
    def authenticated(self):
        return self.id != 'anonymous'

    @property
    def system_admin(self):
        return self.service_role == 3


def permissions(rank):
    return dict(read=rank >= 1, write=rank >= 2, writeRecords=rank >= 2, writeFilters=rank >= 2, admin=rank >= 3)


def default_entitlement():
    return dict(mode='community', status='active', eligibilityCategory='none', verificationStatus='notRequired', features={'ai': True}, revision='initial')


def access_etag(value):
    return etag({k: v for k, v in value.items() if k not in ('role', 'permissions')})


class AccessStore:
    def __init__(self, storage):
        self.directory = Path(storage) / '.access'
        self.file = self.directory / 'state.json'

    @contextmanager
    def state(self, write=False):
        with locked(self.directory / 'state.lock'):
            value = read_json(self.file, dict(version=1, users={}, models={}, workspaces={'default': dict(id='default', name='Default workspace', organizationId='default', entitlement=default_entitlement())}))
            yield value
            if write:
                atomic_json(self.file, value)

    def authenticate(self, token):
        hashed = hashlib.sha256(token.encode()).hexdigest()
        with self.state() as state:
            for identity, user in state['users'].items():
                if user.get('enabled', True) and hmac.compare_digest(hashed, user['tokenHash']):
                    return Principal(identity)
        raise APIError(401, 'Invalid API credentials.')

    def me(self, principal):
        with self.state() as state:
            return dict(id=principal.id, systemAdmin=principal.system_admin, serviceRole=principal.service_role, workspaceIds=state['users'].get(principal.id, {}).get('workspaceIds', []))

    def reserved(self, identity):
        with self.state() as state:
            return identity in state['models'] or identity in state.get('retiredModelIds', [])

    def retire(self, identity):
        with self.state(True) as state:
            retired = state.setdefault('retiredModelIds', [])
            if identity not in retired:
                retired.append(identity)

    def inherit(self, source_id, identity):
        with self.state(True) as state:
            source = state['models'].get(source_id)
            if source and source.get('scoped'):
                if identity in state['models'] or identity in state.get('retiredModelIds', []):
                    raise APIError(409, 'Model identity is reserved. Choose a new ID.')
                state['models'][identity] = dict(deepcopy(source), modelId=identity, datasetId=identity, revision=str(uuid.uuid4()))

    def users(self):
        with self.state() as state:
            return [{k: v for k, v in user.items() if k != 'tokenHash'} for user in state['users'].values()]

    def create_user(self, value):
        fields(value, {'id', 'displayName', 'token', 'workspaceIds'})
        identity = valid_id(value.get('id'))
        if identity == 'anonymous' or identity.startswith('service-'):
            raise APIError(422, 'Reserved user identity.')
        token = string(value, 'token', '', 512) or secrets.token_urlsafe(32)
        if len(token) < 32:
            raise APIError(422, 'User token must contain 32 to 512 characters.')
        display = string(value, 'displayName', identity)
        hashed = hashlib.sha256(token.encode()).hexdigest()
        with self.state(True) as state:
            if identity in state['users']:
                raise APIError(409, 'User already exists.')
            memberships = value.get('workspaceIds')
            if not isinstance(memberships, list) or not memberships or any(not isinstance(v, str) or v not in state['workspaces'] for v in memberships) or len(set(memberships)) != len(memberships):
                raise APIError(422, 'Workspace memberships must be unique existing workspace IDs.')
            if any(user['tokenHash'] == hashed for user in state['users'].values()):
                raise APIError(409, 'Credential already belongs to a user.')
            user = dict(id=identity, displayName=display, workspaceIds=memberships, enabled=True)
            state['users'][identity] = dict(user, tokenHash=hashed)
            return dict(user, token=token)

    def workspaces(self):
        with self.state() as state:
            return list(state['workspaces'].values())

    def create_workspace(self, value):
        fields(value, {'id', 'name', 'organizationId'})
        identity = valid_id(value.get('id'))
        result = dict(id=identity, name=string(value, 'name', identity), organizationId=valid_id(value.get('organizationId', identity)), entitlement=default_entitlement())
        with self.state(True) as state:
            if identity in state['workspaces']:
                raise APIError(409, 'Workspace already exists.')
            state['workspaces'][identity] = result
        return result

    @staticmethod
    def definition(state, identity):
        return deepcopy(state['models'].get(identity, dict(modelId=identity, datasetId=identity, workspaceId='default', grants=[], roles=[], scoped=False, revision='legacy')))

    @staticmethod
    def effective(state, principal, model):
        if principal.system_admin:
            return dict(role='admin', permissions=permissions(3))
        if not model.get('scoped'):
            return dict(role={2: 'readWrite', 1: 'readOnly'}.get(principal.service_role, 'none'), permissions=permissions(principal.service_role))
        user = state['users'].get(principal.id)
        if user and user.get('enabled', True) and model['workspaceId'] in user['workspaceIds']:
            for grant in model['grants']:
                if grant['userId'] != principal.id:
                    continue
                name = grant['role']
                rank = {'admin': 3, 'readWrite': 2, 'readOnly': 1}.get(name, 0)
                allowed = permissions(rank)
                if not rank:
                    for custom in model['roles']:
                        if custom['name'] == name:
                            allowed.update({key: True for key in custom['permissions']})
                            allowed['write'] = allowed['writeRecords'] or allowed['writeFilters']
                return dict(role=name, permissions=allowed)
        return dict(role='none', permissions=permissions(0))

    def access(self, identity, principal):
        with self.state() as state:
            result = self.definition(state, identity)
            result.update(self.effective(state, principal, result))
            return result

    def require(self, principal, identity, permission):
        if not self.access(identity, principal)['permissions'].get(permission):
            raise APIError(403 if principal.authenticated else 401, f'This model requires {permission} permission.')

    def update(self, identity, principal, expected, value):
        fields(value, {'workspaceId', 'grants', 'roles'})
        with self.state(True) as state:
            current = self.definition(state, identity)
            if not self.effective(state, principal, current)['permissions']['admin']:
                raise APIError(403, 'Model administrator access is required.')
            require_match(expected, current, access_etag(current))
            workspace = string(value, 'workspaceId', current['workspaceId'])
            if workspace not in state['workspaces']:
                raise APIError(422, 'Workspace does not exist.')
            if workspace != current['workspaceId'] and not principal.system_admin:
                raise APIError(403, 'Only system administrators may transfer workspace ownership.')
            roles, grants = value.get('roles', current['roles']), value.get('grants')
            if not isinstance(roles, list) or len(roles) > 50 or not isinstance(grants, list) or len(grants) > 1000:
                raise APIError(422, 'Provide grants and at most 50 custom roles.')
            names = {'admin', 'readWrite', 'readOnly'}
            for custom in roles:
                fields(custom, {'name', 'permissions'})
                name = valid_id(custom.get('name'))
                allowed = custom.get('permissions')
                if name in names or not isinstance(allowed, list) or 'read' not in allowed or any(not isinstance(p, str) or p not in {'read', 'writeRecords', 'writeFilters'} for p in allowed) or len(set(allowed)) != len(allowed):
                    raise APIError(422, 'Custom roles need a unique name and distinct read/writeRecords/writeFilters permissions including read.')
                names.add(name)
            identities, admin = set(), False
            for grant in grants:
                fields(grant, {'userId', 'role'})
                user_id, role = string(grant, 'userId', required=True), string(grant, 'role', required=True)
                user = state['users'].get(user_id)
                if not user or not user.get('enabled', True) or workspace not in user['workspaceIds']:
                    raise APIError(422, 'Every model user must be an active member of its workspace.')
                if user_id in identities or role not in names:
                    raise APIError(422, 'Duplicate user or unknown model role.')
                identities.add(user_id)
                admin |= role == 'admin'
            if not admin:
                raise APIError(409, 'A model must retain at least one active administrator.')
            result = dict(current, workspaceId=workspace, grants=grants, roles=roles, scoped=True, revision=str(uuid.uuid4()))
            state['models'][identity] = result
            return result

    def entitlement(self, workspace):
        with self.state() as state:
            if workspace not in state['workspaces']:
                raise APIError(404, 'Workspace not found.')
            return state['workspaces'][workspace]['entitlement']

    def update_entitlement(self, workspace, expected, value):
        fields(value, {'mode', 'status', 'eligibilityCategory', 'verificationStatus', 'expiresAt', 'features'})
        if value.get('mode') not in ('community', 'commercial', 'exempt') or value.get('status') not in ('active', 'suspended', 'expired'):
            raise APIError(422, 'Invalid entitlement mode or status.')
        if value.get('eligibilityCategory', 'none') not in ('none', 'student', 'researcher', 'charity', 'nonprofit', 'other') or value.get('verificationStatus', 'notRequired') not in ('notRequired', 'pending', 'verified', 'rejected'):
            raise APIError(422, 'Invalid eligibility or verification status.')
        if value['mode'] == 'exempt' and (value.get('verificationStatus') != 'verified' or value.get('eligibilityCategory', 'none') == 'none'):
            raise APIError(422, 'Exempt access requires verified eligibility.')
        if 'expiresAt' in value:
            self.expiry(value['expiresAt'])
        features = value.get('features')
        if not isinstance(features, dict) or set(features) - {'ai'} or any(not isinstance(flag, bool) for flag in features.values()):
            raise APIError(422, 'features accepts the ai boolean.')
        with self.state(True) as state:
            if workspace not in state['workspaces']:
                raise APIError(404, 'Workspace not found.')
            require_match(expected, state['workspaces'][workspace]['entitlement'])
            result = dict(value, revision=str(uuid.uuid4()))
            state['workspaces'][workspace]['entitlement'] = result
            return result

    @staticmethod
    def expiry(value):
        try:
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                raise ValueError()
            return parsed
        except (ValueError, TypeError, AttributeError) as error:
            raise APIError(422, 'expiresAt must be an ISO instant.') from error

    def require_feature(self, identity, feature):
        with self.state() as state:
            model = self.definition(state, identity)
            entitlement = state['workspaces'][model['workspaceId']]['entitlement']
            if entitlement['status'] != 'active' or ('expiresAt' in entitlement and self.expiry(entitlement['expiresAt']) <= datetime.now(timezone.utc)) or not entitlement['features'].get(feature):
                raise APIError(403, f'The workspace entitlement does not enable {feature}.')
