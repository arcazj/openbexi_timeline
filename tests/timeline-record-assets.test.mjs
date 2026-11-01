import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GLTFLoader} from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';
import {completeManifestEntries, schematicFor, sourceRecords} from '../tools/fetch-dinosaur-assets.mjs';

const pause = () => new Promise(resolve => setImmediate(resolve));
const record = title => ({id: title, data: {title}});
const document = {asset: {version: '2.0'}};
const response = json => new Response(JSON.stringify(json), {headers: {'Content-Type': 'application/json'}});
const object = () => {
    const scene = new THREE.Group(), geometry = new THREE.BoxGeometry(2, 4, 10), material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(5, 8, -3); scene.add(mesh);
    return {scene, animations: [], geometry, material};
};
async function harness(configuration = {}, options = {}) {
    const h = await createTimelineHarness();
    h.window.TextDecoder = TextDecoder;
    const module = await h.importModule('src/openbexi_timeline_record_assets.js');
    const requests = [], manifest = {version: 1, entries: {alpha: {model: 'alpha.glb', image: 'alpha.png'}, beta: {model: 'beta.glb', image: 'beta.png'}, gamma: {model: 'gamma.glb'}}};
    const manager = new module.TimelineRecordAssets({manifest: 'assets/manifest.json', ...configuration}, {
        baseURL: 'http://localhost/view.html',
        fetch: async url => { requests.push(url); return response(url.endsWith('manifest.json') ? manifest : document); },
        loader: {parseAsync: async () => object()}, ...options
    });
    return {...h, module, manager, requests, manifest, dispose() { manager.dispose(); h.close(); }};
}

test('assets use configured exact keys, resolve local URLs, and preserve provenance', async () => {
    const h = await harness({fallbackImage: '/icon/missing.svg', imageField: 'data.picture'});
    try {
        h.manifest.notice = 'Illustrative models; source dates are unchanged.';
        h.manifest.entries.alpha.creator = 'Public Artist';
        h.manifest.entries.imageOnly = {image: 'only.webp', license: 'CC0-1.0'};
        h.manifest.entries.remote = {model: 'https://remote.example/model.glb', image: '//remote.example/image.png'};
        await h.manager.ready();
        assert.equal(h.manager.entry(record('ALPHA')).creator, 'Public Artist');
        assert.equal(h.manager.image(record('Alpha')), 'http://localhost/assets/alpha.png');
        assert.equal(h.manager.image(record('imageOnly')), 'http://localhost/assets/only.webp');
        assert.equal(h.manager.status(record('imageOnly')), 'image');
        assert.equal(await h.manager.load(record('imageOnly')), null);
        assert.equal(h.manager.entry(record('Alpha species')), null, 'No genus guessing or unrelated substitutions');
        assert.equal(h.manager.entry(record('remote')), null);
        assert.equal(h.manager.image(record('remote')), 'http://localhost/icon/missing.svg');
        assert.equal(h.manager.image({data: {title: 'unknown', picture: '/local/Figure.PNG'}}), 'http://localhost/local/Figure.PNG');
        assert.equal(h.manager.image({data: {picture: 'https://remote.example/picture.png'}}), 'http://localhost/icon/missing.svg');
        assert.equal(h.manager.notice, h.manifest.notice);
        assert.equal(h.module.recordAssetKey(record('Alpha'), 'data.constructor'), null);
        for (const url of ['javascript:alert(1)', 'data:text/html,secret', 'https://user:pass@localhost/item.glb', 'https://remote.example/item.glb'])
            assert.equal(h.module.localRecordAssetURL(url, 'http://localhost/'), null);
        assert.equal(h.requests.length, 1);
    } finally { h.dispose(); }
});

test('configured field and case sensitivity do not depend on names or record types', async () => {
    const h = await harness({keyField: 'metadata.visualKey', caseInsensitive: false});
    try {
        h.manifest.entries = {'Exact-Key': {image: 'key.png'}};
        await h.manager.ready();
        assert.equal(h.manager.entry({metadata: {visualKey: 'Exact-Key'}}).key, 'Exact-Key');
        assert.equal(h.manager.entry({metadata: {visualKey: 'exact-key'}}), null);
        assert.equal(h.manager.entry({data: {title: 'Exact-Key'}}), null);
    } finally { h.dispose(); }
});

test('rotation, centering and display normalization preserve originals and share GPU resources', async () => {
    const h = await harness({rotation: [0, Math.PI / 2, 0]});
    try {
        const original = record('Alpha'), before = JSON.stringify(original);
        const value = await h.manager.load(original);
        const box = new THREE.Box3().setFromObject(value.object), size = box.getSize(new THREE.Vector3());
        assert.ok(Math.abs(size.x - 1) < 1e-6); assert.ok(Math.abs(size.y - .4) < 1e-6); assert.ok(Math.abs(size.z - .2) < 1e-6);
        assert.ok(Math.abs(box.min.y) < 1e-6); assert.ok(Math.abs((box.min.x + box.max.x) / 2) < 1e-6);
        assert.equal(JSON.stringify(original), before);
        const a = h.manager.instance(value), b = h.manager.instance(value);
        const meshes = object => { const values = []; object.traverse(node => { if (node.isMesh) values.push(node); }); return values; };
        assert.notEqual(a, b); assert.equal(meshes(a)[0].geometry, meshes(b)[0].geometry); assert.equal(meshes(a)[0].material, meshes(b)[0].material);
        assert.equal(meshes(a)[0].userData.timelineSharedAsset, true);
        h.manager.release(a); assert.equal(h.manager.instances.size, 1);
        h.manager.release(b); assert.equal(h.manager.instances.size, 0);
        assert.equal(h.manager.status(original), 'loaded'); assert.equal(h.manager.stats.loaded, 1);
    } finally { h.dispose(); }
});

test('models are deduplicated and progressive loads obey concurrency and queue limits', async () => {
    const completions = [], h = await harness({maxConcurrent: 1, maxEntries: 3, maxQueued: 1}, {loader: {parseAsync: () => new Promise(resolve => completions.push(() => resolve(object())))}});
    try {
        await h.manager.ready();
        const first = h.manager.load(record('alpha')), duplicate = h.manager.load(record('ALPHA'));
        await pause();
        const second = h.manager.load(record('beta'));
        await pause();
        assert.equal(await h.manager.load(record('gamma')), null);
        assert.equal(h.manager.active, 1); assert.equal(h.manager.queue.length, 1); assert.equal(completions.length, 1);
        completions.shift()(); assert.equal(await first, await duplicate); await pause();
        assert.equal(completions.length, 1); completions.shift()(); await second; await pause();
        assert.equal(h.manager.active, 0); assert.equal(h.requests.filter(url => url.endsWith('alpha.glb')).length, 1);
        assert.equal(h.manager.stats.loaded, 2); assert.equal(h.manager.stats.deferred, 1);
    } finally { h.dispose(); }
});

test('cache eviction never disposes an asset while a displayed instance retains it', async () => {
    const created = [], h = await harness({maxEntries: 1}, {loader: {parseAsync: async () => { const value = object(); created.push(value); return value; }}});
    try {
        const value = await h.manager.load(record('alpha')), instance = h.manager.instance(value);
        let disposed = 0; created[0].geometry.addEventListener('dispose', () => disposed++);
        assert.equal(await h.manager.load(record('beta')), null); assert.equal(disposed, 0);
        h.manager.release(instance);
        assert.ok(await h.manager.load(record('beta'))); assert.equal(disposed, 1);
        assert.equal(h.manager.cache.size, 1); assert.equal(h.manager.stats.evicted, 1);
        assert.equal(h.manager.instance(value), null, 'An evicted prototype cannot be cloned after its resources are disposed');
    } finally { h.dispose(); }
});

test('remote nested glTF dependencies fail before parsing and leave the local image available', async () => {
    let parseCalls = 0;
    const h = await harness({}, {loader: {parseAsync: async () => { parseCalls++; return object(); }}});
    try {
        await h.manager.ready();
        h.manager.fetch = async () => response({asset: {version: '2.0'}, images: [{uri: 'https://remote.example/texture.png'}]});
        assert.equal(await h.manager.load(record('alpha')), null);
        assert.equal(parseCalls, 0); assert.equal(h.manager.status(record('alpha')), 'fallback');
        assert.equal(h.manager.image(record('alpha')), 'http://localhost/assets/alpha.png');
        assert.equal(await h.manager.load(record('alpha')), null); assert.equal(h.manager.stats.failed, 1);
    } finally { h.dispose(); }
});

test('failed manifests and oversized models degrade without dropping records or throwing', async () => {
    const h = await harness({maxAssetBytes: 1024});
    try {
        await h.manager.ready();
        h.manager.fetch = async () => response({asset: {version: '2.0'}, extras: 'x'.repeat(2048)});
        assert.equal(await h.manager.load(record('alpha')), null); assert.equal(h.manager.status(record('alpha')), 'fallback');
        assert.equal(h.manager.stats.cachedBytes, 0);
        const failing = new h.module.TimelineRecordAssets({manifest: '/missing.json', fallbackImage: '/fallback.svg'}, {fetch: async () => new Response('', {status: 404})});
        await failing.ready(); assert.equal(failing.manifestState, 'fallback'); assert.equal(await failing.load(record('alpha')), null);
        assert.equal(failing.image(record('alpha')), 'http://localhost/fallback.svg'); failing.dispose();
    } finally { h.dispose(); }
});

test('dispose resolves pending callers and disposes late parser output without notifying a dead scene', async () => {
    let finish, changes = 0;
    const parsed = object(), h = await harness({}, {loader: {parseAsync: () => new Promise(resolve => { finish = () => resolve(parsed); })}, onChange: () => changes++});
    try {
        let disposals = 0; parsed.geometry.addEventListener('dispose', () => disposals++);
        const first = h.manager.load(record('alpha')); await pause();
        assert.equal(typeof finish, 'function'); const before = changes;
        h.manager.dispose(); assert.equal(await first, null);
        finish(); await pause();
        assert.equal(disposals, 1); assert.equal(changes, before); assert.equal(h.manager.active, 0); assert.equal(h.manager.cache.size, 0);
        assert.equal(h.manager.status(record('alpha')), 'disposed');
    } finally { h.dispose(); }
});

test('shipped manifest models parse through the real loader with finite normalized bounds and verified provenance', async () => {
    const h = await createTimelineHarness(); h.window.TextDecoder = TextDecoder;
    const {TimelineRecordAssets} = await h.importModule('src/openbexi_timeline_record_assets.js');
    const previousSelf=globalThis.self,previousBitmap=globalThis.createImageBitmap;
    // Node has no image decoder. Embedded image transport/material binding is
    // exercised here; browser regressions verify actual JPEG decoding/display.
    globalThis.self=globalThis;
    globalThis.createImageBitmap=async blob=>{assert.ok(blob.size>0);return {width:1,height:1,close(){}};};
    // The shared DOM harness stubs TextureLoader for canvas tests. Use the real
    // loader here and copy the binary buffer across the VM realm boundary.
    const loader = new GLTFLoader();
    const assets = new TimelineRecordAssets({manifest: '/icon/dinosaurs/manifest.json', rotation: [0, Math.PI / 2, 0]}, {
        loader: {parseAsync: (buffer, base) => loader.parseAsync(Uint8Array.from(new Uint8Array(buffer)).buffer, base)}
    });
    try {
        await assets.ready(); assert.equal(assets.manifestState, 'ready'); assert.equal(assets.entries.size, 224);
        const sources = sourceRecords(await fs.readFile(new URL('../json/test-data/dinausaurs.json', import.meta.url), 'utf8'));
        assert.equal(sources.length, 224);
        for (const source of sources) {
            const entry = assets.entry(record(source.name)); assert.ok(entry, source.name);
            assert.ok(entry.imageURL); assert.ok(entry.label, source.name);
            if(entry.kind==='schematic')assert.match(entry.label, /not a.*reconstruction/, source.name);
        }
        let modelCount = 0, imageCount = 0;
        for (const [key, entry] of assets.entries) {
            if (!entry.model) {
                imageCount++; assert.equal(entry.kind, 'schematic');
                assert.equal(await assets.load(record(key)), null);
                const svg = await fs.readFile(new URL('../icon/dinosaurs/' + entry.image, import.meta.url), 'utf8');
                const parsed = new h.window.DOMParser().parseFromString(svg, 'image/svg+xml');
                assert.equal(parsed.querySelector('parsererror'), null, key);
                assert.equal(parsed.querySelector('script,image,use,a,foreignObject'), null, key);
                assert.match(parsed.documentElement.textContent, /not (?:a|an) (?:\w+ )?reconstruction|no body shape is inferred/i, key);
                assert.ok(entry.sourceClassification); assert.ok(entry.creator); assert.ok(entry.license);
                continue;
            }
            modelCount++;
            const bytes = await fs.readFile(new URL('../icon/dinosaurs/' + entry.model, import.meta.url));
            assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, key);
            const value = await assets.load(record(key));
            assert.ok(value, key + ': ' + (assets.cache.get(key)?.error || 'model not loaded'));
            assert.ok(Object.values(value.size).every(n => Number.isFinite(n) && n > 0), key);
            assert.ok(Math.abs(Math.max(...Object.values(value.size)) - 1) < 1e-5, key);
            assert.equal(entry.license, 'CC0-1.0'); assert.ok(entry.creator); assert.ok(entry.source);
        }
        assert.ok(modelCount>=22, 'The shipped exact-genus model coverage does not regress');
        assert.equal(imageCount, sources.length-modelCount);
        assert.equal(assets.stats.failed, 0); assert.equal(assets.stats.loaded, modelCount);
    } finally {
        assets.dispose(); h.close();
        if(previousSelf===undefined)delete globalThis.self;else globalThis.self=previousSelf;
        if(previousBitmap===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=previousBitmap;
    }
});

test('offline manifest enrichment preserves reviewed entries and derives schematic symbols only from source clades', () => {
    const existing = {custom: {image: 'reviewed.svg', kind: 'illustration', label: 'Reviewed custom illustration'},
        known: {model: 'known.glb', image: 'known.webp'}};
    const records = [{name: 'Custom', classification: 'Theropoda'}, {name: 'Known', classification: 'Theropoda'},
        {name: 'Missing', classification: 'Dinosauria, Saurischia, Sauropodomorpha, Prosauropoda'},
        {name: 'Unclassified', classification: 'Dinosauria'}];
    const entries = completeManifestEntries(existing, records);
    assert.deepEqual(entries.custom, existing.custom);
    assert.deepEqual(entries.known.rotation, [0, Math.PI / 2, 0]);
    assert.equal(existing.known.rotation, undefined, 'The source manifest object is not mutated');
    assert.equal(entries.missing.image, 'schematic-sauropodomorph.svg');
    assert.equal(entries.missing.model, undefined); assert.match(entries.missing.label, /not a reconstruction of Missing$/);
    assert.equal(entries.unclassified.image, 'schematic-unknown.svg');
    assert.equal(schematicFor('Dinosauria, Ornithischia, Thyreophora, Ankylosauria').id, 'armoured');
    assert.equal(schematicFor('Dinosauria, Ornithischia, Ceratopsia').id, 'ceratopsian');
    assert.equal(schematicFor('Dinosauria, Ornithischia, Ornithopoda').id, 'ornithopod');
    assert.equal(schematicFor('Dinosauria, Saurischia, Theropoda').id, 'theropod');
    assert.deepEqual(completeManifestEntries(entries, records), entries, 'Repeated offline refreshes preserve every image-only entry');
});
