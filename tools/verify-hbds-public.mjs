import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {parse} from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const restricted = /(?:^|[^a-z0-9])(?:soc|esoc|mcc|poc|pov|mwo|gar|scr|src|dap)(?:$|[^a-z0-9])/i;
const privatePath = /(?:^|\/)(?:private|generated|backups|imports)(?:\/|$)/i;
const secretKeys = /^(?:password|api_key|aws_access_key_id|aws_secret_access_key|aws_session_token|authorization|token|tokenHash)$/i;

export function inspectPublicHbds(file, text) {
    if (!file.startsWith('HBDS/')) return;
    if (privatePath.test(file) || restricted.test(path.basename(file))) throw new Error('Private HBDS file cannot be published: ' + file);
    if (!/^HBDS\/(?:schema\/|templates\/|README\.md$|aliases\.json$)/.test(file)) throw new Error('HBDS file is outside public areas: ' + file);
    if (!/\.(json|ya?ml)$/i.test(file)) return;
    const value = /\.json$/i.test(file) ? JSON.parse(text) : parse(text, {uniqueKeys: true});
    function visit(item, key = '') {
        if (Array.isArray(item)) {item.forEach(value => visit(value, key)); return;}
        if (item && typeof item === 'object') {for (const [name, value] of Object.entries(item)) visit(value, name); return;}
        if (typeof item !== 'string') return;
        if (['namespace', 'namespaceId', 'modelId'].includes(key) && restricted.test(item)) throw new Error('Operational namespace in public HBDS example: ' + file);
        if (secretKeys.test(key) && item && !/^(?:Bearer )?(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|<[^>]+>)$/i.test(item)) throw new Error('Literal credential in public HBDS example: ' + file);
        if (/(?:^|[\/\\])(?:Users|home)[\/\\][^<${/\\]+/i.test(item) ||
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
    return {publicFiles: permitted.size, trackedFiles: tracked.length};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log(JSON.stringify(await verifyPublicHbds(), null, 2));
}
