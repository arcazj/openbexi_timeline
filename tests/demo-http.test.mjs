import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createDemoServer, projectRoot} from '../tools/serve-demos.mjs';
import {readDemoCatalog, buildDemoReadme} from '../tools/update-demo-readme.mjs';

test('Local demo links, catalog assets, scripts, styles and reference PNGs resolve over HTTP', async () => {
    const server = createDemoServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/';
    try {
        const catalog = await readDemoCatalog();
        const paths = new Set(['demos.html', 'demos/catalog.json', 'src/openbexi_demo.js', 'src/openbexi_timeline.js',
            'src/openbexi_timeline_data.js', 'src/openbexi_timeline_views.js', 'css/ob_demos.css', 'css/ob_timeline_modern.css',
            'css/ob_timeline_views.css', 'css/ob_jsCalendar.css', 'css/ob_descriptor.css', 'docs/demos.md',
            'node_modules/three/build/three.module.min.js', 'node_modules/three/examples/jsm/controls/DragControls.js',
            'node_modules/three-spritetext/dist/three-spritetext.mjs', 'node_modules/simple-jscalendar/source/jsCalendar.min.js']);
        for (const demo of catalog.demos) {
            for (const key of ['dataset', 'model', 'reference']) if (demo[key]) paths.add(demo[key]);
            for (const view of ['timeline', 'table', 'split']) paths.add('demos.html?demo=' + demo.id + '&view=' + view);
        }
        await Promise.all([...paths].map(async resource => {
            const response = await fetch(new URL(resource, base));
            assert.equal(response.status, 200, resource);
            assert.ok((await response.arrayBuffer()).byteLength > 0, resource);
        }));
        assert.match((await fetch(new URL('src/openbexi_demo.js', base))).headers.get('content-type'), /javascript/);
        assert.equal((await fetch(new URL('missing-demo.json', base))).status, 404);
        assert.equal((await fetch(new URL('.git/config', base))).status, 403);
        assert.equal((await fetch(base, {method: 'POST'})).status, 405);
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('README demo links are generated from the current catalog', async () => {
    const catalog = await readDemoCatalog();
    const readme = await fs.readFile(path.join(projectRoot, 'README.md'), 'utf8');
    const section = readme.match(/<!-- LIVE_DEMOS:START -->[\s\S]*?<!-- LIVE_DEMOS:END -->/)?.[0];
    assert.equal(section?.replaceAll('\r\n', '\n'), buildDemoReadme(catalog));
});
