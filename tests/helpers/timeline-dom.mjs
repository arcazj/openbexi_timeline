import {JSDOM} from 'jsdom';
import * as THREE from 'three';
import vm from 'node:vm';
import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Construct the actual Three.js scene and DOM. Only GPU rendering, image loading
// and 2D text measurement are stubbed; this is not a screenshot/visual test.
export async function createTimelineHarness(options = {}) {
    const dom = new JSDOM(options.html || '<!doctype html><html><head></head><body></body></html>', {
        url: options.url || 'http://localhost/', runScripts: 'outside-only'
    });
    const context = dom.getInternalVMContext();
    const {window} = dom;
    window.structuredClone = structuredClone;
    const requests = [];
    window.fetch = async resource => {
        const url = new URL(String(resource), 'http://localhost/');
        requests.push(url.pathname);
        try {
            const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
            if (path.relative(root, file).startsWith('..')) throw new Error('Invalid path');
            return new Response(await fs.readFile(file), {status: 200});
        } catch { return new Response('Not found', {status: 404}); }
    };
    const draw = {font: '', measureText: text => ({width: String(text).length * 7, actualBoundingBoxLeft: 0, actualBoundingBoxRight: String(text).length * 7}),
        clearRect() {}, fillRect() {}, strokeRect() {}, fillText() {}, strokeText() {},
        beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, quadraticCurveTo() {},
        rect() {}, fill() {}, stroke() {}, save() {}, restore() {}, scale() {}, translate() {}, setTransform() {}};
    window.HTMLCanvasElement.prototype.getContext = function () { return {...draw, canvas: this}; };
    const style = window.document.createElement('style');
    style.textContent = await fs.readFile(path.join(root, 'css/ob_timeline_views.css'), 'utf8');
    window.document.head.appendChild(style);
    let renderCount = 0;
    class WebGLRenderer {
        constructor() { this.domElement = window.document.createElement('canvas'); this.shadowMap = {}; }
        setClearColor() {}
        setPixelRatio() {}
        setSize(width, height) { this.domElement.width = width; this.domElement.height = height; }
        dispose() {}
        render(scene, camera) {
            renderCount++;
            for (const value of camera.projectionMatrix.elements) if (!Number.isFinite(value)) throw new Error('Invalid camera projection');
            scene.traverse(object => {
                if (![object.position.x, object.position.y, object.position.z].every(Number.isFinite)) throw new Error('Non-finite object position: ' + object.type + ' ' + JSON.stringify({text: object.text, position: object.position, data: object.parent?.data}));
                const positions = object.geometry?.attributes?.position?.array;
                if (positions && !positions.every(Number.isFinite)) throw new Error('Non-finite geometry');
            });
        }
    }
    class TextureLoader { load() { return new THREE.Texture(); } }
    const three = new vm.SyntheticModule(Object.keys(THREE), function () {
        for (const key of Object.keys(THREE)) this.setExport(key,
            key === 'WebGLRenderer' ? WebGLRenderer : key === 'TextureLoader' ? TextureLoader : THREE[key]);
    }, {context});
    const aliases = {
        drag_controls: 'node_modules/three/examples/jsm/controls/DragControls.js',
        'three-spritetext': 'node_modules/three-spritetext/dist/three-spritetext.mjs'
    };
    const modules = new Map();
    async function load(file) {
        file = path.resolve(root, file);
        if (!modules.has(file)) modules.set(file, new vm.SourceTextModule(await fs.readFile(file, 'utf8'), {
            context, identifier: file,
            initializeImportMeta(meta) { meta.url = new URL(path.relative(root, file).replaceAll('\\', '/'), 'http://localhost/').href; }
        }));
        return modules.get(file);
    }
    async function importModule(file) {
        const module = await load(file);
        if (module.status === 'unlinked') await module.link(async (specifier, parent) => specifier === 'three' ? three :
            load(aliases[specifier] || path.resolve(path.dirname(parent.identifier), specifier)));
        if (module.status !== 'evaluated') await module.evaluate();
        return module.namespace;
    }
    return {window, requests, importModule, get renderCount() { return renderCount; }, close() { window.close(); }};
}
