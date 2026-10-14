/** Import/export and workspace migration. Never discovers files outside the project. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parse, stringify} from 'yaml';
import {validateHbdsDocument, resolveHbdsNamespace} from '../src/openbexi_timeline_hbds.js';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = value => structuredClone(value);
const slash = value => value.replaceAll('\\', '/');
const stableId = (kind, value) => kind + '_' + String(value).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 55) + '_' + createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
const exists = async file => fs.access(file).then(() => true, () => false);
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const encode = value => JSON.stringify(value, null, 2) + '\n';

export function importLegacyConfiguration(legacy, model) {
    if (!legacy || !Array.isArray(legacy.data_sources) || !legacy.data_sources.length) throw new Error('Import requires a nonempty data_sources list.');
    const {data_sources, model: legacyModelPath, ...deployment} = clone(legacy);
    const result = {schemaVersion: 1, defaultNamespaceId: '', namespaces: [],
        models: [{id: 'model_default', configuration: clone(model)}], sources: [], connectors: [], tabs: [],
        users: [], groups: [], roles: [], grants: [], deployment};
    const namespaces = new Map(), connectors = new Map();
    for (const [order, entry] of data_sources.entries()) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Each source must be a mapping.');
        const {namespace: originalNamespace, ...configuration} = entry;
        const namespaceName = String(originalNamespace ?? 'default');
        let namespace = namespaces.get(namespaceName);
        if (!namespace) {
            namespace = {id: stableId('namespace', namespaceName), namespace: namespaceName,
                modelId: 'model_default', render: {}, filter: {}, connectorIds: []};
            namespaces.set(namespaceName, namespace); result.namespaces.push(namespace);
            result.tabs.push({id: stableId('tab', namespaceName), namespaceId: namespace.id,
                title: namespaceName, order: result.tabs.length, enabled: true});
        }
        configuration.type ??= 'json_file';
        if (configuration.enable === 'true' || configuration.enable === 'false') configuration.enable = configuration.enable === 'true';
        // Preserve source-specific settings and string/list forms verbatim.
        result.sources.push({id: stableId('source', order + ':' + namespaceName), namespaceId: namespace.id, order, configuration});
        const raw = configuration.connector;
        for (const token of (Array.isArray(raw) ? raw : [raw]).filter(value => typeof value === 'string').flatMap(value => value.split('|'))) {
            const match = /^([A-Za-z][A-Za-z0-9_+-]*):(\d+)$/.exec(token.trim());
            if (!match) continue;
            const key = `${match[1]}:${Number(match[2])}`;
            if (!connectors.has(key)) {
                const connector = {id: stableId('connector', key), protocol: match[1], port: Number(match[2])};
                connectors.set(key, connector); result.connectors.push(connector);
            }
            if (!namespace.connectorIds.includes(connectors.get(key).id)) namespace.connectorIds.push(connectors.get(key).id);
        }
    }
    result.defaultNamespaceId = result.namespaces[0].id;
    return validateHbdsDocument(result);
}

export function exportLegacyConfiguration(document, modelPath) {
    validateHbdsDocument(document);
    const sources = [];
    for (const namespace of document.namespaces) {
        const effective = resolveHbdsNamespace(document, namespace.id).sources;
        const originals = document.sources.filter(source => source.namespaceId === namespace.id).sort((a, b) => a.order - b.order);
        originals.forEach((source, index) => sources.push({order: source.order, value: effective[index]}));
    }
    sources.sort((a, b) => a.order - b.order);
    return {...clone(document.deployment), ...(modelPath ? {model: modelPath} : {}), data_sources: sources.map(source => source.value)};
}

async function checked(root, relative, mustExist = false) {
    const target = path.resolve(root, relative), relation = path.relative(root, target);
    if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) throw new Error('Migration path escapes the project.');
    let parent = target;
    while (!await exists(parent)) parent = path.dirname(parent);
    if (path.resolve(await fs.realpath(parent)) !== path.resolve(parent)) throw new Error('Migration does not follow symbolic links or junctions.');
    if (mustExist && !(await fs.lstat(target)).isFile()) throw new Error('Migration accepts regular files only.');
    return target;
}
async function writeNew(root, relative, bytes) {
    const target = await checked(root, relative);
    await fs.mkdir(path.dirname(target), {recursive: true});
    if (await exists(target)) {
        if (!Buffer.from(bytes).equals(await fs.readFile(target))) throw new Error('Destination exists with different content: ' + relative);
    } else await fs.writeFile(target, bytes, {flag: 'wx'});
    return target;
}
async function listFiles(root, relative) {
    if (!await exists(path.join(root, relative))) return [];
    const result = [];
    for (const entry of await fs.readdir(path.join(root, relative), {withFileTypes: true})) {
        if (entry.isSymbolicLink()) throw new Error('Migration does not follow symbolic links.');
        const file = slash(path.join(relative, entry.name));
        if (entry.isDirectory()) result.push(...await listFiles(root, file));
        else if (entry.isFile()) result.push(file);
    }
    return result;
}
const sanitizeExample = text => text.replace(/\b(?:GCS|GNS|E?SOC|MCC|POC|POV|MWO|GAR|SCR|SRC|DAP)\b/g,
    token => ({GAR: 'DEMO_IMPORT_A', SCR: 'DEMO_IMPORT_B', MWO: 'DEMO_IMPORT_C'}[token] || 'DEMO'));

export async function migrateWorkspace(root = project) {
    root = await fs.realpath(root);
    const manifest = await json(path.join(root, 'release/public-files.json'));
    const publicFiles = new Set(manifest);
    const all = [...await listFiles(root, 'models'), ...await listFiles(root, 'yaml'), ...await listFiles(root, 'filters')];
    if (!all.length) return {alreadyMigrated: true};
    const existingAliases = async file => await exists(path.join(root, file)) ? (await json(path.join(root, file))).aliases : {};
    const privateAliases = await existingAliases('HBDS/private/migration.json');
    const publicAliases = await existingAliases('HBDS/aliases.json');
    const resolveInput = async file => checked(root, privateAliases[file] || publicAliases[file] || file, true);
    const modelFallback = await json(await resolveInput('models/regular_timeline.json'));
    const imports = [], moves = [];
    // Prepare and validate every document before moving any existing file.
    for (const file of all) {
        const source = await checked(root, file, true), bytes = await fs.readFile(source);
        const isPublic = publicFiles.has(file);
        const target = isPublic ? 'HBDS/templates/' + file : 'HBDS/private/' + (file.startsWith('filters/') ? file : 'imports/' + file);
        let publishedBytes = bytes;
        if (isPublic && /\.(json|ya?ml)$/i.test(file)) publishedBytes = Buffer.from(sanitizeExample(bytes.toString('utf8')));
        moves.push({file, target, source, bytes, publishedBytes, isPublic});
        if (isPublic) publicAliases[file] = target;
        else privateAliases[file] = target;
        if (!file.startsWith('yaml/') || !/\.ya?ml$/i.test(file)) continue;
        const value = parse(bytes.toString('utf8'), {uniqueKeys: true});
        if (!Array.isArray(value?.data_sources) || !value.data_sources.length) continue;
        const selected = value.model ? await resolveInput(value.model) : null;
        const document = importLegacyConfiguration(value, selected ? await json(selected) : modelFallback);
        const canonical = 'HBDS/private/configurations/' + file.slice('yaml/'.length).replace(/\.ya?ml$/i, '.hbds.json');
        imports.push({file: canonical, document}); privateAliases[file] = canonical;
    }
    // Check the complete destination plan before making any change. A conflict
    // late in the plan must not leave an earlier configuration half-migrated.
    const targets = new Map();
    for (const [file, bytes] of [...imports.map(item => [item.file, Buffer.from(encode(item.document))]), ...moves.map(item => [item.target, item.publishedBytes])]) {
        if (targets.has(file) && !targets.get(file).equals(bytes)) throw new Error('Conflicting migration destinations: ' + file);
        targets.set(file, bytes);
        const target = await checked(root, file);
        if (await exists(target) && !(await fs.readFile(target)).equals(bytes)) throw new Error('Destination exists with different content: ' + file);
    }
    const backupRoot = 'HBDS/private/backups/migration-' + new Date().toISOString().replace(/[:.]/g, '-');
    for (const move of moves) await writeNew(root, backupRoot + '/' + move.file, move.bytes);
    for (const item of imports) await writeNew(root, item.file, encode(item.document));
    for (const move of moves) {
        const target = await writeNew(root, move.target, move.publishedBytes);
        if (!Buffer.from(move.publishedBytes).equals(await fs.readFile(target))) throw new Error('Migration copy verification failed.');
    }
    // Publish complete aliases before removing originals. An interrupted cleanup
    // still resolves every old path to its complete canonical destination.
    for (const [file, aliases] of [['HBDS/private/migration.json', privateAliases], ['HBDS/aliases.json', publicAliases]]) {
        const target = await checked(root, file), temporary = target + '.migration.tmp';
        await fs.mkdir(path.dirname(target), {recursive: true});
        await fs.writeFile(await checked(root, temporary), encode({version: 1, aliases}));
        await fs.rename(temporary, target);
    }
    for (const move of moves) await fs.unlink(await checked(root, move.file, true));
    for (const name of ['models', 'yaml', 'namespaces', 'users', 'groups', 'roles', 'filters']) {
        await fs.mkdir(await checked(root, 'HBDS/private/' + name), {recursive: true});
    }
    return {movedFiles: moves.length, canonicalConfigurations: imports.length, publicFiles: moves.filter(move => move.isPublic).length,
        privateFiles: moves.filter(move => !move.isPublic).length, backup: backupRoot};
}

async function main() {
    const args = process.argv.slice(2), option = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
    if (args.includes('--migrate-workspace')) {console.log(JSON.stringify(await migrateWorkspace(), null, 2)); return;}
    const input = option('--import'), output = option('--output'), modelPath = option('--model');
    if (input && output) {
        const legacy = parse(await fs.readFile(path.resolve(project, input), 'utf8'), {uniqueKeys: true});
        const model = await json(path.resolve(project, modelPath || legacy.model || 'HBDS/templates/models/regular_timeline.json'));
        await writeNew(project, output, encode(importLegacyConfiguration(legacy, model)));
        console.log('Imported configuration to ' + output); return;
    }
    const exporting = option('--export');
    if (exporting && output) {
        if (!slash(output).startsWith('HBDS/generated/')) throw new Error('Legacy exports must be written under ignored HBDS/generated/.');
        const document = await json(path.resolve(project, exporting));
        const modelOutput = output.replace(/\.ya?ml$/i, '') + '.model.json';
        await writeNew(project, modelOutput, encode(resolveHbdsNamespace(document).modelConfiguration));
        await writeNew(project, output, stringify(exportLegacyConfiguration(document, modelOutput)));
        console.log('Exported legacy model and YAML to ' + output); return;
    }
    throw new Error('Use --migrate-workspace, --import <yaml> --output <private.hbds.json> [--model <model.json>], or --export <hbds.json> --output HBDS/generated/<name>.yml.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
