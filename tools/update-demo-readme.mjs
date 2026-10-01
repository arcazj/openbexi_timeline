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

export function buildDemoReadme(catalog, baseURL = 'https://arcazj.github.io/openbexi_timeline/', {resources = false} = {}) {
    const escape = text => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
    const links = catalog.demos.map(demo => {
        const url = new URL('demos.html', baseURL);
        url.searchParams.set('demo', demo.id);
        return `[${escape(demo.title)}](${url.href})`;
    });
    if (!resources) return [
        '<!-- LIVE_DEMOS:START -->', '## Live demos', '',
        links.join(' ·\n'), '',
        'Explore the [gallery](https://arcazj.github.io/openbexi_timeline/) in your browser. The [demo guide](docs/demos.md#live-demos) lists datasets, models and screenshots.',
        '<!-- LIVE_DEMOS:END -->'
    ].join('\n');
    const lines = [
        '<!-- DEMO_RESOURCES:START -->', '## Live demos', '',
        'Each demo uses Timeline, Table and Split views with its own data, model and time scale. Open a link below to try it in your browser.', '',
        '| Demo | What it shows | Resources |',
        '| --- | --- | --- |'
    ];
    for (const [index, demo] of catalog.demos.entries()) {
        const files = [`[Data](../${demo.dataset})`, `[Model](../${demo.model})`];
        if (demo.reference) files.push(`[Screenshot](../${demo.reference})`);
        lines.push(`| ${links[index]} | ${escape(demo.description)} | ${files.join(' · ')} |`);
    }
    lines.push('', 'Append `&view=table` or `&view=split` to a demo URL to open that view directly.', '<!-- DEMO_RESOURCES:END -->');
    return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const catalog = await readDemoCatalog();
    for (const [relative, resources, name] of [['README.md', false, 'LIVE_DEMOS'], ['docs/demos.md', true, 'DEMO_RESOURCES']]) {
        const file = path.join(projectRoot, relative);
        const original = await fs.readFile(file, 'utf8');
        const section = buildDemoReadme(catalog, undefined, {resources});
        const marker = new RegExp(`<!-- ${name}:START -->[\\s\\S]*?<!-- ${name}:END -->`);
        if (process.argv.includes('--check')) {
            if (original.match(marker)?.[0].replaceAll('\r\n', '\n') !== section) throw new Error(relative + ' demo section is stale. Run npm run demos:readme.');
        } else {
            if (!marker.test(original)) throw new Error(relative + ' is missing the ' + name + ' section markers.');
            await fs.writeFile(file, original.replace(marker, section));
            console.log('Updated ' + relative + ' from ' + catalog.demos.length + ' catalog entries.');
        }
    }
}
