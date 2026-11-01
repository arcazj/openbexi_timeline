import * as THREE from 'three';
import {GLTFLoader} from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from '../node_modules/three/examples/jsm/utils/SkeletonUtils.js';

const bounded = (value, fallback, minimum, maximum) => Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.floor(value))) : fallback;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

/** Read a configured record field without interpreting its value or taxonomy. */
export function recordAssetKey(record, keyField = 'data.title', caseInsensitive = true) {
    let value = record;
    for (const segment of String(keyField).split('.')) {
        if (forbidden.has(segment) || !value || !Object.hasOwn(value, segment)) return null;
        value = value[segment];
    }
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const key = String(value).trim();
    return key ? caseInsensitive ? key.toLowerCase() : key : null;
}

/** Only load explicitly configured assets from the application's own origin. */
export function localRecordAssetURL(value, base, origin = new URL(base).origin) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const url = new URL(value, base);
        return ['http:', 'https:'].includes(url.protocol) && url.origin === origin && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

function rotation(value) {
    return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? value : null;
}

function disposeResources(object) {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    object?.traverse(node => {
        if (node.geometry) geometries.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
            materials.add(material);
            for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
    });
    textures.forEach(texture => { texture.image?.close?.(); texture.dispose(); });
    materials.forEach(material => material.dispose()); geometries.forEach(geometry => geometry.dispose());
}

function gltfDocument(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength >= 12 && view.getUint32(0, true) === 0x46546c67) {
        if (view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== view.byteLength) throw new Error('Invalid binary glTF header.');
        for (let offset = 12; offset + 8 <= view.byteLength;) {
            const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
            offset += 8;
            if (offset + length > view.byteLength) throw new Error('Invalid binary glTF chunk.');
            if (type === 0x4e4f534a) return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset, length)));
            offset += length;
        }
        throw new Error('Missing glTF metadata.');
    }
    return JSON.parse(new TextDecoder().decode(buffer));
}

function checkDependencies(document, base, origin) {
    // GLTFLoader may fetch images or buffers during parseAsync. Validate these
    // before parsing, rather than allowing an asset to initiate remote requests.
    const visit = value => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            if (key === 'uri' && typeof child === 'string' &&
                !/^data:(?:image\/(?:png|jpeg|webp|avif)|application\/(?:octet-stream|gltf-buffer));base64,[a-z0-9+/=\s]+$/i.test(child) &&
                !localRecordAssetURL(child, base, origin)) throw new Error('Asset dependencies must be local.');
            visit(child);
        }
    };
    visit(document);
}

async function responseBuffer(response, limit) {
    if (!response.ok) throw new Error('Asset unavailable (' + response.status + ').');
    const declared = Number(response.headers.get('Content-Length'));
    if (declared > limit) throw new Error('Asset exceeds the configured byte limit.');
    if (!response.body?.getReader) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > limit) throw new Error('Asset exceeds the configured byte limit.');
        return buffer;
    }
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
        while (true) {
            const {value, done} = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > limit) { await reader.cancel(); throw new Error('Asset exceeds the configured byte limit.'); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const data = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return data.buffer;
}

/**
 * Shared record assets for the existing timeline scene, descriptor and cameras.
 * Instances share geometry/materials; release an instance instead of disposing
 * its descendants. No renderer, camera, record classification or data is created.
 */
export class TimelineRecordAssets {
    constructor(configuration = {}, options = {}) {
        this.configuration = {...configuration};
        this.baseURL = new URL(options.baseURL || configuration.baseURL || globalThis.document?.baseURI || import.meta.url);
        this.origin = this.baseURL.origin;
        this.manifestURL = localRecordAssetURL(configuration.manifest, this.baseURL, this.origin);
        this.keyField = configuration.keyField || 'data.title';
        this.caseInsensitive = configuration.caseInsensitive !== false;
        this.maxConcurrent = bounded(configuration.maxConcurrent, 3, 1, 8);
        this.maxEntries = bounded(configuration.maxEntries, 64, 1, 256);
        this.maxQueued = bounded(configuration.maxQueued, 128, 1, 512);
        this.maxAssetBytes = bounded(configuration.maxAssetBytes, 16 * 1024 * 1024, 1024, 128 * 1024 * 1024);
        this.maxCacheBytes = bounded(configuration.maxCacheBytes, 64 * 1024 * 1024, 1024, 256 * 1024 * 1024);
        this.onChange = options.onChange || configuration.onChange || (() => {});
        this.fetch = options.fetch || globalThis.fetch.bind(globalThis);
        this.loader = options.loader || new GLTFLoader();
        this.entries = new Map(); this.cache = new Map(); this.instances = new Map(); this.queue = [];
        this.controller = new AbortController(); this.active = 0; this.clock = 0; this.disposed = false;
        this.stats = {loaded: 0, failed: 0, bytes: 0, cachedBytes: 0, evicted: 0, deferred: 0};
        this.manifestState = configuration.manifest ? 'pending' : 'absent';
    }
    key(record) { return recordAssetKey(record, this.keyField, this.caseInsensitive); }
    ready() {
        if (!this.readyPromise) this.readyPromise = this.readManifest();
        return this.readyPromise;
    }
    async readManifest() {
        if (!this.configuration.manifest) return this;
        if (!this.manifestURL) { this.manifestState = 'fallback'; return this; }
        try {
            const response = await this.fetch(this.manifestURL, {signal: this.controller.signal, credentials: 'same-origin', redirect: 'error'});
            const manifest = JSON.parse(new TextDecoder().decode(await responseBuffer(response, 2 * 1024 * 1024)));
            if (manifest.version !== 1 || !manifest.entries || typeof manifest.entries !== 'object' || Array.isArray(manifest.entries)) throw new Error('Unsupported asset manifest.');
            if (this.disposed) return this;
            this.notice = typeof manifest.notice === 'string' ? manifest.notice : '';
            this.source = typeof manifest.source === 'string' ? manifest.source : '';
            for (const [key, source] of Object.entries(manifest.entries)) {
                if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
                const normalized = this.caseInsensitive ? key.trim().toLowerCase() : key.trim();
                if (!normalized || this.entries.has(normalized)) continue;
                const modelURL = localRecordAssetURL(source.model, this.manifestURL, this.origin);
                const imageURL = localRecordAssetURL(source.image, this.manifestURL, this.origin);
                if (!modelURL && !imageURL) continue;
                this.entries.set(normalized, {...source, key: normalized, modelURL, imageURL,
                    rotation: rotation(source.rotation) || rotation(this.configuration.rotation) || [0, 0, 0]});
            }
            this.manifestState = 'ready';
        } catch (error) { if (!this.disposed) { this.manifestState = 'fallback'; this.manifestError = error.message; } }
        this.notify(); return this;
    }
    entry(record) { return this.entries.get(this.key(record)) || null; }
    image(record) {
        const entry = this.entry(record);
        if (entry?.imageURL) return entry.imageURL;
        if (this.configuration.imageField) {
            // Do not lowercase URL paths when using the same safe field reader.
            const image = recordAssetKey(record, this.configuration.imageField, false);
            const url = localRecordAssetURL(image, this.baseURL, this.origin);
            if (url) return url;
        }
        return localRecordAssetURL(this.configuration.fallbackImage, this.baseURL, this.origin);
    }
    status(record) {
        if (this.disposed) return 'disposed';
        return this.cache.get(this.key(record))?.state || (this.entry(record)?.modelURL ? 'available' : this.image(record) ? 'image' : 'placeholder');
    }
    async load(record) {
        await this.ready();
        if (this.disposed) return null;
        const entry = this.entry(record);
        if (!entry?.modelURL) return null;
        const existing = this.cache.get(entry.key);
        if (existing) { existing.used = ++this.clock; return existing.promise; }
        if (this.queue.length >= this.maxQueued || !this.makeRoom(0, true)) { this.stats.deferred++; return null; }
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        const item = {entry, promise, resolve, state: 'queued', used: ++this.clock, references: 0, bytes: 0};
        this.cache.set(entry.key, item); this.queue.push(item); this.drain();
        return promise;
    }
    notify() { if (!this.disposed) { try { this.onChange(this); } catch { /* A renderer callback cannot strand the queue. */ } } }
    makeRoom(bytes, addingEntry = false, except = null) {
        const over = () => this.cache.size + Number(addingEntry) > this.maxEntries || this.stats.cachedBytes + bytes > this.maxCacheBytes;
        const candidates = [...this.cache.values()].filter(item => item !== except && item.references === 0 && !['queued', 'loading'].includes(item.state)).sort((a, b) => a.used - b.used);
        for (const item of candidates) {
            if (!over()) break;
            this.cache.delete(item.entry.key); this.stats.cachedBytes -= item.bytes;
            disposeResources(item.value?.object); this.stats.evicted++;
        }
        return !over();
    }
    drain() {
        while (!this.disposed && this.active < this.maxConcurrent && this.queue.length) {
            const item = this.queue.shift(); this.active++; item.state = 'loading';
            this.fetchModel(item).finally(() => { this.active--; if (!this.disposed) { this.notify(); this.drain(); } });
        }
    }
    async fetchModel(item) {
        let gltf;
        try {
            const response = await this.fetch(item.entry.modelURL, {signal: this.controller.signal, credentials: 'same-origin', redirect: 'error'});
            const buffer = await responseBuffer(response, this.maxAssetBytes);
            if (this.disposed) { item.resolve(null); return; }
            const base = new URL('.', item.entry.modelURL).href;
            checkDependencies(gltfDocument(buffer), base, this.origin);
            gltf = await this.loader.parseAsync(buffer, base);
            if (this.disposed) { disposeResources(gltf.scene); item.resolve(null); return; }
            if (!this.makeRoom(buffer.byteLength, false, item)) throw new Error('Asset cache is full.');
            const orient = new THREE.Group(); orient.add(gltf.scene); orient.rotation.set(...item.entry.rotation); orient.updateMatrixWorld(true);
            const bounds = new THREE.Box3().setFromObject(orient), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
            const largest = Math.max(size.x, size.y, size.z);
            if (!Number.isFinite(largest) || largest <= 0) throw new Error('Asset has no finite geometry.');
            const centered = new THREE.Group(); centered.add(orient); centered.position.set(-center.x, -bounds.min.y, -center.z);
            const object = new THREE.Group(); object.add(centered); object.scale.setScalar(1 / largest); object.updateMatrixWorld(true);
            object.traverse(node => { node.userData.timelineSharedAsset = true; });
            item.value = {object, animations: gltf.animations || [], entry: item.entry, key: item.entry.key,
                size: {x: size.x / largest, y: size.y / largest, z: size.z / largest},
                bounds: {width: size.x / largest, height: size.y / largest, depth: size.z / largest}};
            item.bytes = buffer.byteLength; item.state = 'loaded'; this.stats.loaded++; this.stats.bytes += item.bytes; this.stats.cachedBytes += item.bytes;
            item.resolve(item.value);
        } catch (error) {
            if (gltf?.scene) disposeResources(gltf.scene);
            item.state = 'fallback'; item.error = error.message;
            if (!this.disposed) this.stats.failed++;
            item.resolve(null);
        }
    }
    instance(value) {
        if (this.disposed || !value?.object) return null;
        const item = this.cache.get(value.key);
        if (!item || item.value !== value) return null;
        const object = cloneSkeleton(value.object); item.references++; item.used = ++this.clock;
        object.userData.recordVisualKind = 'model'; object.userData.recordVisualAsset = item.entry.key;
        this.instances.set(object, item); return object;
    }
    release(object) {
        const item = this.instances.get(object);
        if (!item) return;
        object.removeFromParent(); this.instances.delete(object); item.references = Math.max(0, item.references - 1);
        // Skeleton matrices belong to the instance; mesh geometry/materials do not.
        object.traverse(node => { if (node.isSkinnedMesh) node.skeleton?.dispose(); });
    }
    dispose() {
        if (this.disposed) return;
        this.disposed = true; this.controller.abort(); this.manifestState = 'disposed';
        for (const object of [...this.instances.keys()]) this.release(object);
        this.queue.splice(0).forEach(item => { item.state = 'disposed'; item.resolve(null); });
        for (const item of this.cache.values()) { item.resolve(null); disposeResources(item.value?.object); }
        this.cache.clear(); this.entries.clear(); this.stats.cachedBytes = 0;
    }
}
