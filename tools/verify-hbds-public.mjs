import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {parse} from 'yaml';
import {createHash} from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicNamespace = /^(?:DEMO(?:_[A-Z0-9]+)*|EXAMPLE|SOURCE[12]|TEST_SOURCE1|earthquake|volcano|namespace|sourceId|Namespace\.namespace|data\.(?:satellite|namespace)|<namespace_for_[A-Za-z0-9_]+>)$/;
const privatePath = /(?:^|\/)(?:private|generated|backups|imports)(?:\/|$)/i;
const secretKeys = /^(?:password|api_key|aws_access_key_id|aws_secret_access_key|aws_session_token|authorization|token|tokenHash)$/i;
const publicAccess = {
    users: ['admin', 'guest'].map(id => ({id, name: id, email: id + '@example.invalid', admin: id === 'admin', roleId: 'role_' + id, groupId: 'group_' + id})),
    groups: [{id: 'group_admin', name: 'Administrators'}, {id: 'group_guest', name: 'Guests'}],
    roles: [{id: 'role_admin', name: 'Administrator', ceiling: 'admin'}, {id: 'role_guest', name: 'Guest', ceiling: 'r'}]
};

function inspectAccess(name, entries, file, complete = false) {
    const defaults = publicAccess[name], seen = new Set();
    if (!Array.isArray(entries) || complete && entries.length !== defaults.length)
        throw new Error('Public HBDS access defaults must contain only admin and guest: ' + file);
    for (const entry of entries) {
        const expected = defaults.find(value => value.id === entry?.id);
        if (!expected || seen.has(entry.id) || Object.keys(entry).length !== Object.keys(expected).length ||
            Object.entries(expected).some(([key, value]) => entry[key] !== value))
            throw new Error('Private user or access metadata in public HBDS file; only unchanged admin and guest defaults are publishable: ' + file);
        seen.add(entry.id);
    }
}

export function inspectPublicHbds(file, text) {
    if (!file.startsWith('HBDS/')) return;
    if (privatePath.test(file) || /^(?:private|operational)[_.-]/i.test(path.basename(file))) throw new Error('Private HBDS file cannot be published: ' + file);
    if (!/^HBDS\/(?:plugins\/(?:README\.md$|(?:default|earthquake|volcano|filesources|timeline_json|mqtt)\/)|schema\/|templates\/|README\.md$|aliases\.json$|service\.yml$|(?:workspace|GEO_Workspace|Generator_Workspace)\.json$|yaml\/(?:DEMO_default|DEMO_GENERATOR_default|(?:volcano|earthquake)_geoscience(?:_demo)?)\.yml$|models\/(?:default|geoscience(?:_demo)?)\.json$|filters\/default\.json$|(?:users|groups|roles)\/defaults\.json$)/.test(file)) throw new Error('HBDS file is outside public areas: ' + file);
    if (!/\.(json|ya?ml)$/i.test(file)) return;
    const value = /\.json$/i.test(file) ? JSON.parse(text) : parse(text, {uniqueKeys: true});
    const accessFile = /^HBDS\/(users|groups|roles)\/defaults\.json$/.exec(file);
    if (accessFile) inspectAccess(accessFile[1], value, file, true);
    // HBDS design diagrams store user examples as attribute-value objects.
    for (const definition of value?.hypergraph?.class || []) {
        if (definition.name !== 'User') continue;
        const attributes = new Map(definition.attributes.map(attribute => [attribute.id, attribute.name]));
        const users = (value.hypergraph.object || []).filter(item => item.classId === definition.id).map(item =>
            Object.fromEntries(item.attributeValues.map(attribute => [attributes.get(attribute.attributeId), attribute.value])));
        inspectAccess('users', users, file);
    }
    if (/^HBDS\/(?:workspace|GEO_Workspace|Generator_Workspace)\.json$/.test(file)) {
        const publicFiles = new Set(['yaml/DEMO_default.yml', 'yaml/DEMO_GENERATOR_default.yml', 'yaml/volcano_geoscience.yml', 'yaml/earthquake_geoscience.yml',
            'yaml/volcano_geoscience_demo.yml', 'yaml/earthquake_geoscience_demo.yml']);
        if (value.service !== 'service.yml' || !Array.isArray(value.namespace_files) || !value.namespace_files.length ||
            value.namespace_files.some(name => !publicFiles.has(name)))
            throw new Error('Public workspace must reference reviewed public namespace files and service.yml: ' + file);
        const publicNames = new Set([...publicFiles].map(name => path.posix.basename(name)));
        if (Object.entries(value.aliases || {}).some(([from, to]) => !publicNames.has(from) || !publicNames.has(to)))
            throw new Error('Public workspace alias references an unreviewed namespace file: ' + file);
        if (value.default_namespace_id && !publicNamespace.test(value.default_namespace_id) ||
            (value.tabs || []).some(tab => !publicNamespace.test(tab.namespaceId)))
            throw new Error('Operational namespace in public workspace: ' + file);
    }
    function visit(item, key = '') {
        if (Array.isArray(item)) {
            if (Object.hasOwn(publicAccess, key)) inspectAccess(key, item, file);
            item.forEach(value => visit(value, key)); return;
        }
        if (item && typeof item === 'object') {
            if ('email' in item && 'roleId' in item && 'groupId' in item && typeof item.id === 'string') inspectAccess('users', [item], file);
            for (const [name, value] of Object.entries(item)) visit(value, name); return;
        }
        if (typeof item !== 'string') return;
        if (/^(?:user|username|userId)$/i.test(key) && item && !['admin', 'guest'].includes(item) &&
            !/^(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|<[^>]+>)$/.test(item))
            throw new Error('Private user identity in public HBDS file: ' + file);
        if (key === 'namespace' && !publicNamespace.test(item)) throw new Error('Operational namespace in public HBDS example: ' + file);
        if (secretKeys.test(key) && item && !/^(?:Bearer )?(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|<[^>]+>)$/i.test(item)) throw new Error('Literal credential in public HBDS example: ' + file);
        if (item !== 'HBDS/users/defaults.json' && /(?:^|[\/\\])(?:Users|home)[\/\\][^<${/\\]+/i.test(item) ||
            /(?:^|[^\d])(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?:$|[^\d])/.test(item))
            throw new Error('Private endpoint or home path in public HBDS example: ' + file);
        if (key === 'email' && item && !/@example\.(?:invalid|com|org|net)$/.test(item)) throw new Error('Non-example user email in public HBDS file: ' + file);
    }
    visit(value);
}
export async function verifyPublicHbds(repository = root) {
    const manifest = JSON.parse(await fs.readFile(path.join(repository, 'release/public-files.json'), 'utf8'));
    const permitted = new Set(manifest.filter(file => file.startsWith('HBDS/')));
    const tracked = execFileSync('git', ['ls-files', '-z', '--', 'HBDS'], {cwd: repository, encoding: 'utf8'}).split('\0').filter(Boolean);
    for (const file of tracked) if (privatePath.test(file) || !permitted.has(file)) throw new Error('Unapproved HBDS file is tracked by Git: ' + file);
    for (const file of permitted) {
        const resolved = path.resolve(repository, file), actual = await fs.realpath(resolved);
        if (resolved !== actual || !(await fs.lstat(resolved)).isFile()) throw new Error('Public HBDS assets cannot be links: ' + file);
        inspectPublicHbds(file, await fs.readFile(resolved, 'utf8'));
    }
    const normalized = async file => (await fs.readFile(path.join(repository,file),'utf8')).replace(/\r\n/g,'\n');
    const model = await normalized('HBDS/schema/openbexi_timeline.json');
    const contract = JSON.parse(model).metadata.extensions.timeline;
    if (contract.provenanceNormalization !== 'utf8-lf') throw new Error('HBDS provenance must declare portable UTF-8/LF hashes.');
    for (const item of contract.provenance) {
        if (!manifest.includes(item.file) || createHash('sha256').update(await normalized(item.file)).digest('hex') !== item.sha256)
            throw new Error('HBDS model input changed; regenerate the design artifacts: ' + item.file);
    }
    if (model !== await normalized('docs/design/2.9/openbexi_timeline.json')) throw new Error('Published HBDS model differs from its design model.');
    return {publicFiles: permitted.size, trackedFiles: tracked.length};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log(JSON.stringify(await verifyPublicHbds(), null, 2));
}
