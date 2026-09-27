import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {projectRoot} from './serve-demos.mjs';
import {validateDemoCatalog} from '../src/openbexi_timeline_model_validation.js';

export async function readDemoCatalog() {
    const catalog = validateDemoCatalog(JSON.parse(await fs.readFile(path.join(projectRoot, 'demos/catalog.json'), 'utf8')),
        {label: 'demos/catalog.json'});
    const supplied = (await fs.readdir(path.join(projectRoot, 'json/test-data'))).filter(file => file.endsWith('.json')).sort();
    const listed = catalog.demos.map(demo => path.basename(demo.dataset)).sort();
    if (JSON.stringify(supplied) !== JSON.stringify(listed)) throw new Error('The catalog must include each file in json/test-data exactly once.');
    if (new Set(catalog.demos.map(demo => demo.id)).size !== catalog.demos.length) throw new Error('Duplicate demo IDs.');
    for (const demo of catalog.demos) {
        if (!/^[a-z0-9_-]+$/.test(demo.id)) throw new Error('Invalid demo ID: ' + demo.id);
        if (!Number.isInteger(demo.recordCount) || demo.recordCount < 0) throw new Error('Invalid expected record count: ' + demo.id);
        for (const key of ['dataset', 'model', 'reference']) {
            if (!demo[key] && key === 'reference') continue;
            const file = path.resolve(projectRoot, demo[key]);
            if (path.relative(projectRoot, file).startsWith('..')) throw new Error('Demo paths must stay inside the project.');
            await fs.access(file);
        }
    }
    return catalog;
}

export function buildDemoReadme(catalog, baseURL = 'http://localhost:8780/') {
    const escape = text => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
    const lines = [
        '<!-- LIVE_DEMOS:START -->', '## Live demos', '',
        'Start the local server with [Quick start](#quick-start), then choose a demo. Each uses the same Timeline, Table and Split views; its data, bands, colors and time scales come from [the catalog](demos/catalog.json) and model files.', '',
        '| Demo | What it shows | Resources |',
        '| --- | --- | --- |'
    ];
    for (const demo of catalog.demos) {
        const url = new URL('demos.html', baseURL);
        url.searchParams.set('demo', demo.id);
        const resources = [`[Data](${demo.dataset})`, `[Model](${demo.model})`];
        if (demo.reference) resources.push(`[Screenshot](${demo.reference})`);
        lines.push(`| [${escape(demo.title)}](${url.href}) | ${escape(demo.description)} | ${resources.join(' · ')} |`);
    }
    lines.push('', 'Append `&view=table` or `&view=split` to a demo URL to open that view directly. See the [demo guide](docs/demos.md) for data formats, model options and hosting.', '<!-- LIVE_DEMOS:END -->');
    return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const catalog = await readDemoCatalog();
    const file = path.join(projectRoot, 'README.md');
    const original = await fs.readFile(file, 'utf8');
    const section = buildDemoReadme(catalog);
    const marker = /<!-- LIVE_DEMOS:START -->[\s\S]*?<!-- LIVE_DEMOS:END -->/;
    if (process.argv.includes('--check')) {
        if (original.match(marker)?.[0].replaceAll('\r\n', '\n') !== section) throw new Error('README demo section is stale. Run npm run demos:readme.');
    } else {
        if (!marker.test(original)) throw new Error('README is missing the LIVE_DEMOS section markers.');
        const next = original.replace(marker, section);
        await fs.writeFile(file, next);
        console.log('Updated README demos from ' + catalog.demos.length + ' catalog entries.');
    }
}
