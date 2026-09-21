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
            'src/openbexi_timeline_data.js', 'src/openbexi_timeline_views.js', 'src/openbexi_timeline_overview.js',
            'src/openbexi_timeline_scale.js', 'src/openbexi_timeline_ticks.js', 'src/openbexi_timeline_overview_panel.js', 'css/ob_demos.css', 'css/ob_timeline_modern.css',
            'src/openbexi_timeline_help.js', 'src/openbexi_timeline_share.js', 'css/ob_help.css',
            'src/openbexi_timeline_model_validation.js', 'src/openbexi_timeline_schema_validators.js',
            'schemas/demo-model.schema.json', 'schemas/demo-catalog.schema.json',
            'css/ob_timeline_views.css', 'css/ob_jsCalendar.css', 'css/ob_descriptor.css', 'docs/demos.md',
            'help/resources.json', 'docs/help-guide.md', 'docs/help-guide.html', 'docs/api.md', 'docs/api.html',
            'docs/api-reference.js', 'docs/rest-api.md', 'docs/security.md', 'swagger/openapi-v1.json',
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

test('Help resources resolve locally and guide anchors exist; offline API needs no external scripts', async () => {
    const server = createDemoServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/';
    try {
        const manifestResponse = await fetch(new URL('help/resources.json', base));
        assert.equal(manifestResponse.status, 200);
        const manifest = await manifestResponse.json();
        const localResources = manifest.sections.flatMap(section => section.links).filter(resource => {
            if (resource.disabledReason) return false;
            assert.ok(resource.href, resource.label + ' must have a destination');
            return new URL(resource.href, base).origin === new URL(base).origin;
        });
        assert.ok(localResources.length > 0, 'Help must expose local documentation');
        await Promise.all(localResources.map(async resource => {
            const url = new URL(resource.href, base);
            const anchor = decodeURIComponent(url.hash.slice(1));
            url.hash = '';
            const response = await fetch(url);
            assert.equal(response.status, 200, resource.label + ': ' + resource.href);
            const body = await response.text();
            assert.ok(body.trim().length > 0, resource.href);
            if (anchor && url.pathname.endsWith('.md')) {
                const headings = [...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => match[1].trim()
                    .toLowerCase().replace(/[^a-z0-9\s_-]/g, '').replace(/\s/g, '-'));
                assert.ok(headings.includes(anchor), resource.href + ' must link to an existing heading');
            } else if (anchor && url.pathname.endsWith('.html')) {
                const ids = [...body.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
                assert.ok(ids.includes(anchor), resource.href + ' must link to an existing HTML section');
            }
        }));
        const apiResponse = await fetch(new URL('docs/api.html', base));
        assert.match(apiResponse.headers.get('content-type'), /text\/html/);
        const apiHTML = await apiResponse.text();
        assert.doesNotMatch(apiHTML, /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i,
            'The offline API reference must not depend on external scripts');
        for (const [, href] of apiHTML.matchAll(/\bhref=["']([^"']+)["']/g)) {
            const url = new URL(href, new URL('docs/api.html', base));
            if (url.origin === new URL(base).origin) {
                assert.equal((await fetch(url)).status, 200, 'Offline API link: ' + href);
            }
        }
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('README demo links are generated from the current catalog', async () => {
    const catalog = await readDemoCatalog();
    const readme = await fs.readFile(path.join(projectRoot, 'README.md'), 'utf8');
    const section = readme.match(/<!-- LIVE_DEMOS:START -->[\s\S]*?<!-- LIVE_DEMOS:END -->/)?.[0];
    assert.equal(section?.replaceAll('\r\n', '\n'), buildDemoReadme(catalog));
});
