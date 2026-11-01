// Run explicitly to refresh the public, locally hosted illustration pack.
// No private dataset is read or transmitted. Existing filenames are deterministic.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'icon/dinosaurs');
const source = 'https://3dassets.dev/api/v1/packs/dinosaurs-and-prehistoric-life';
const fetchBytes = async url => {
    const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`${response.status}: ${url}`);
    return Buffer.from(await response.arrayBuffer());
};

export function sourceRecords(xml) {
    // The historical file contains HTML descriptions despite its .json suffix.
    // Match the application's inert, tolerant XML/HTML import behavior.
    const dom = new JSDOM(xml);
    try {
        return [...dom.window.document.querySelectorAll('event')].map(event => ({
            name: event.getAttribute('title') || '', classification: event.textContent.trim().replace(/\s+/g, ' ')
        }));
    } finally { dom.window.close(); }
}

// Classification is an explicit data-build step, never runtime application
// logic. These broad symbols represent source clades, not individual anatomy.
export function schematicFor(classification) {
    const tokens = new Set(classification.toLowerCase().split(',').map(value => value.trim()));
    const has = (...values) => values.some(value => tokens.has(value));
    if (has('sauropodomorpha', 'sauropoda', 'prosauropoda')) return {id: 'sauropodomorph', label: 'Sauropodomorph clade'};
    if (has('theropoda')) return {id: 'theropod', label: 'Theropod clade'};
    if (has('ceratopsia', 'neoceratopsia', 'ceratopsidae')) return {id: 'ceratopsian', label: 'Ceratopsian clade'};
    if (has('thyreophora', 'stegosauria', 'ankylosauria')) return {id: 'armoured', label: 'Armoured dinosaur clade'};
    if (has('ornithopoda', 'hadrosauridae')) return {id: 'ornithopod', label: 'Ornithopod clade'};
    return {id: 'unknown', label: 'Neutral fossil record'};
}

export function completeManifestEntries(existing, records) {
    const entries = {...existing};
    for (const record of records) {
        const key = record.name.trim().toLowerCase();
        if (!key) continue;
        const entry = entries[key];
        if (entry?.model) {
            entries[key] = {...entry,
                rotation: entry.rotation || [0, Math.PI / 2, 0],
                label: entry.label || `${record.name}: stylized genus illustration; not a scientifically validated reconstruction`};
            continue;
        }
        // Preserve reviewed image-only entries, including custom replacements.
        if (entry?.image) continue;
        const schematic = schematicFor(record.classification);
        entries[key] = {image: `schematic-${schematic.id}.svg`, kind: 'schematic',
            label: `${schematic.label} schematic based on source classification; not a reconstruction of ${record.name}`,
            sourceClassification: record.classification,
            source: '../../json/test-data/dinausaurs.json', creator: 'OpenBEXI Timeline — original schematic artwork',
            license: 'LicenseRef-OpenBEXI', licenseURL: '../../LICENSE'};
    }
    return entries;
}

async function main() {
    const filename = path.join(output, 'manifest.json');
    let previous;
    try { previous = JSON.parse(await fs.readFile(filename, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; previous = {version: 1, entries: {}}; }
    const records = sourceRecords(await fs.readFile(path.join(root, 'json/test-data/dinausaurs.json'), 'utf8'));
    const genera = new Set(records.map(record => record.name.toLowerCase()));
    let entries = {...previous.entries}, pack;
    await fs.mkdir(output, {recursive: true});
    if (!process.argv.includes('--manifest-only')) {
        pack = JSON.parse(await fetchBytes(source)).data;
        if (pack.licenseLabel !== 'CC0 1.0 Universal') throw new Error('Review changed licensing before downloading.');
        const downloaded = new Set();
        for (const asset of pack.assets) {
            const genus = asset.title.split(' ')[0].toLowerCase();
            if (!genera.has(genus) || downloaded.has(genus)) continue;
            // Reviewed replacements can originate from museum collections or
            // another pack. Refreshing this pack must not undo that curation.
            if (entries[genus]?.curated === true) continue;
            if (asset.license?.slug !== 'cc0-1.0') throw new Error('Unexpected license: ' + genus);
            const glb = await fetchBytes(asset.cdnUrl), poster = await fetchBytes(asset.posterUrl);
            if (glb.toString('ascii', 0, 4) !== 'glTF' || glb.readUInt32LE(8) !== glb.length) throw new Error('Invalid GLB: ' + genus);
            await fs.writeFile(path.join(output, genus + '.glb'), glb);
            await fs.writeFile(path.join(output, genus + '.webp'), poster);
            entries[genus] = {genus, model: genus + '.glb', image: genus + '.webp',
                rotation: entries[genus]?.rotation || [0, Math.PI / 2, 0],
                kind: 'stylized', aiGenerated: true, source: asset.url, download: asset.cdnUrl,
                creator: asset.contributor?.name || '3D Assets', license: 'CC0-1.0',
                licenseURL: asset.license.url, triangles: asset.stats.triangles,
                bytes: glb.length, sha256: createHash('sha256').update(glb).digest('hex'),
                imageSha256: createHash('sha256').update(poster).digest('hex')};
            downloaded.add(genus);
        }
    }
    entries = completeManifestEntries(entries, records);
    await fs.writeFile(filename, JSON.stringify({...previous, version: 1,
        source: pack?.url || previous.source, ...(pack ? {retrieved: new Date().toISOString().slice(0, 10)} : {}),
        notice: previous.notice || '3D models are stylized, AI-generated genus illustrations, not validated anatomical reconstructions. Image-only fallbacks are original schematic clade symbols based on the historical source classification, not genus reconstructions. Display sizes are normalized. Source fossil intervals are unchanged.',
        entries}, null, 2) + '\n');
    const models = Object.values(entries).filter(entry => entry.model).length;
    console.log(`Manifest contains ${models} exact-genus models and ${Object.keys(entries).length - models} image-only entries; source records: ${records.length}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
