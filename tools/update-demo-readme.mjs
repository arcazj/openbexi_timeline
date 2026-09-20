import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {projectRoot} from './serve-demos.mjs';

export async function readDemoCatalog() {
    const catalog = JSON.parse(await fs.readFile(path.join(projectRoot, 'demos/catalog.json'), 'utf8'));
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
        '<!-- LIVE_DEMOS:START -->', '## Live Demos', '',
        'These are **local interactive demos**. Install dependencies with `npm install`, then run `npm run demo` and open [the demo gallery](http://localhost:8780/demos.html). The default server listens only on your computer; these links are not public hosted demos.', '',
        'Every dataset uses the same page, renderer, and Timeline / Table / vertical Split controls. Search works locally. Dataset selection, source format, bands, colors, highlights, and time scales come from [the JSON catalog](demos/catalog.json) and its model files.', '',
        '| Demo | Description | Configuration | Visual reference |',
        '| --- | --- | --- | --- |'
    ];
    for (const demo of catalog.demos) {
        const url = new URL('demos.html', baseURL);
        url.searchParams.set('demo', demo.id);
        lines.push(`| [${escape(demo.title)}](${url.href}) | ${escape(demo.description)} | [Dataset](${demo.dataset}) · [Model](${demo.model}) | ${demo.reference ? '[PNG](' + demo.reference + ')' : 'Not supplied'} |`);
    }
    lines.push('', 'Append `&view=table` or `&view=split` to open that view directly. See the [demo guide](docs/demos.md) for source formats, model options, validation, and portable hosting instructions.', '',
        'Regenerate this list after editing the catalog with `npm run demos:readme`. Run `npm run test:demos` to validate all catalog entries, data imports, scene geometry, view switching, and local HTTP links.', '<!-- LIVE_DEMOS:END -->');
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
        const next = marker.test(original) ? original.replace(marker, section) : original.replace('## Visualization Examples', section + '\n\n## Visualization Examples');
        await fs.writeFile(file, next);
        console.log('Updated README demos from ' + catalog.demos.length + ' catalog entries.');
    }
}
