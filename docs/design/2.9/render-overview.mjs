// A readable architecture overview derived from the HBDS model and examples.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelText = fs.readFileSync(path.join(here, 'openbexi_timeline.json'), 'utf8');
const model = JSON.parse(modelText), example = model.metadata.extensions.timeline.examples;
for (const name of ['workspace_namespaces', 'namespace_sources', 'source_converter', 'cli_core', 'ui_core', 'publisher_generation', 'release_evidence'])
    assert.ok(model.hypergraph.link.some(item => item.id === 'obt29_' + name));
const ns = Object.values(example.namespaceFiles);
assert.deepEqual(ns.map(item => item.namespace).sort(), ['earthquake', 'volcano']);
const escape = value => String(value).replace(/[&<>"']/g, item => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[item]));
const parts = [];
const text = (x, y, content, size = 24, fill = '#34445b', weight = 400) => parts.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}">${escape(content)}</text>`);
const rect = (x, y, w, h, fill = '#ffffff', border = '#dbe3ee', radius = 18) => parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${border}" stroke-width="2"/>`);
function lines(x, y, values, size = 23, color = '#34445b', spacing = 34) {values.forEach((value, index) => text(x, y + index * spacing, value, size, color));}
function arrow(x1, y1, x2, y2, color = '#8092aa') {parts.push(`<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${color}" stroke-width="3" fill="none" marker-end="url(#arrow)"/>`);}
function panel(x, y, w, h, title, color) {
    rect(x, y, w, h); rect(x + 24, y + 26, 7, 32, color, color, 3); text(x + 47, y + 51, title, 28, '#122238', 650);
}
function box(x, y, w, h, title, details, color = '#0369a1', background = '#f0f9ff') {
    rect(x, y, w, h, background, color); text(x + 22, y + 37, title, 26, color, 650); lines(x + 22, y + 72, details, 22);
}
parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1510" viewBox="0 0 2400 1510" role="img" aria-label="HBDS architecture for OpenBEXI Timeline 2.9"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#8092aa"/></marker></defs><g font-family="Segoe UI, Arial, sans-serif">');
rect(0, 0, 2400, 1510, '#edf2f8', '#edf2f8', 0);
text(64, 82, 'OpenBEXI Timeline', 48, '#102239', 700);
text(64, 131, 'HBDS architecture  /  plugins, execution and publication', 30, '#52657e');
rect(1900, 52, 436, 58, '#e5e7ff', '#c7cdf7', 29); text(1933, 91, '2.9  ·  PLUGIN ARCHITECTURE', 25, '#373e93', 650);

panel(64, 190, 550, 630, '01  Workspace configuration', '#0369a1');
box(96, 280, 486, 106, example.workspace.name, ['Two separate namespaces'], '#0369a1');
arrow(217, 388, 217, 424); arrow(461, 388, 461, 424);
box(96, 428, 230, 128, 'earthquake', ['source instance', 'earthquake plugin'], '#0369a1');
box(352, 428, 230, 128, 'volcano', ['source instance', 'volcano plugin'], '#7c3aed', '#f5f3ff');
lines(96, 613, ['Each namespace selects a display model', 'and owns its sources and output target.', 'A namespace may use several plugins.', 'A plugin may serve several namespaces.'], 23, '#34445b', 37);
text(96, 787, 'Service settings and plugin registry are shared.', 21, '#52657e');

panel(650, 190, 1080, 630, '02  Shared execution path', '#b45309');
box(684, 280, 484, 110, 'Standalone converter', ['--workspace  [--namespace]  [--source]'], '#b45309', '#fffbeb');
box(1200, 280, 496, 110, 'Collector UI', ['Start  ·  Cancel  ·  Run again  ·  Repeat'], '#b45309', '#fffbeb');
arrow(926, 392, 926, 437); arrow(1448, 392, 1448, 437);
box(784, 442, 812, 111, 'timeline_data_collector runtime', ['One runner  ·  validated requests  ·  shared leases and state'], '#b45309', '#fffbeb');
arrow(1190, 555, 1190, 599);
box(684, 604, 316, 135, 'Source adapters', ['File / HTTP / S3 / SQL', 'MQTT / new adapters'], '#7c3aed', '#f5f3ff');
box(1032, 604, 316, 135, 'Converters', ['earthquake / volcano', 'default / other plugins'], '#7c3aed', '#f5f3ff');
box(1380, 604, 316, 135, 'Record batches', ['Compatible timeline JSON', 'Stable IDs + provenance'], '#047857', '#ecfdf5');
arrow(1003, 671, 1027, 671); arrow(1351, 671, 1375, 671);
text(684, 787, 'Independent plugin builds; new plugins require no collector rebuild.', 24, '#52657e');

panel(1766, 190, 570, 630, '03  Publish and display', '#047857');
box(1800, 280, 502, 132, 'Common publisher', ['Validate, merge and publish atomically', 'Advance checkpoints after durable output'], '#047857', '#ecfdf5');
arrow(1740, 671, 1750, 671);
parts.push('<path d="M1750 671 L1750 347 L1794 347" stroke="#8092aa" stroke-width="3" fill="none" marker-end="url(#arrow)"/>');
arrow(2051, 415, 2051, 454);
box(1800, 460, 502, 112, 'Materialized JSON', ['/data/<namespace>/yyyy/mm/dd'], '#047857', '#ecfdf5');
arrow(2051, 575, 2051, 614);
box(1800, 620, 502, 155, 'Timeline  ·  Java and Python', ['Sessions, events, activities and zones', 'Default: All  |  earthquake  |  volcano', 'Keep by_namespace and existing controls'], '#be185d', '#fff1f6');

panel(64, 854, 720, 250, 'Repeat and recovery', '#b45309');
lines(98, 951, ['Run again reprocesses the selected inputs.', 'Interval runs wait for completion and never overlap.', 'Streaming keeps one active subscription.', 'Failures preserve the last valid published generation.'], 23, '#34445b', 34);
panel(812, 854, 720, 250, 'Public and private packages', '#7c3aed');
lines(846, 951, ['Public: core, generators and geoscience plugins.', 'Private: operational converters and mappings.', 'Private code, state and live data stay out of releases.', 'Public installations work without private plugins.'], 23, '#34445b', 34);
panel(1560, 854, 776, 250, 'Static demos', '#be185d');
lines(1594, 951, ['NONE reads committed samples without conversion.', 'Demo and live workspace configurations stay separate.', 'The seven existing catalog demos remain compatible.', 'Historical and numeric date formats are preserved.'], 23, '#34445b', 34);

panel(64, 1140, 2272, 282, 'Release 2.9  ·  publication follows implementation and passing regression tests', '#475569');
const steps = [
    ['Implement and migrate', ['Plugin contracts + CLI + UI', 'Preserve paths and record identities']],
    ['Prove compatibility', ['Both APIs, browser and private suites', 'Replay, recovery, fixtures and counts']],
    ['Build and verify assets', ['Windows installer + ZIP + tar.gz', 'Notes, checksums and HBDS diagrams']],
    ['Publish v2.9.0', ['Verify uploaded asset hashes', 'Retain historical release tags']]
];
steps.forEach(([title, details], index) => {
    const x = 98 + index * 560;
    box(x, 1235, 526, 145, title, details, '#475569', '#f8fafc');
    if (index < 3) arrow(x + 530, 1307, x + 554, 1307);
});
text(64, 1470, `Derived from openbexi_timeline.json  ·  ${model.hypergraph.class.filter(item => item.type !== 'hyperclass').length} classes  ·  ${model.hypergraph.link.length} relationships  ·  Full HBDS model available for inspection`, 22, '#52657e');
parts.push('</g></svg>');
const svg = parts.join('\n');
fs.writeFileSync(path.join(here, 'architecture-overview.svg'), svg + '\n');
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(item => item && fs.existsSync(item));
assert.ok(executablePath, 'A local Chromium browser is required.');
const browser = await chromium.launch({executablePath, headless: true});
try {
    const page = await browser.newPage({viewport: {width: 2400, height: 1510}, deviceScaleFactor: 1.25});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html><body style="margin:0">' + svg + '</body></html>');
    await page.evaluate(() => document.fonts.ready);
    const clipped = await page.locator('svg text').evaluateAll(elements => elements.filter(element => {
        const box = element.getBBox(); return box.x < 0 || box.y < 0 || box.x + box.width > 2400 || box.y + box.height > 1510;
    }).map(element => element.textContent));
    assert.deepEqual(clipped, []); assert.deepEqual(errors, []);
    const png = await page.locator('svg').screenshot({path: path.join(here, 'architecture-overview.png')});
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    assert.equal(width, 3000); assert.equal(height, 1888);
    const report = {passed: true, scope: 'Readable overview of the implemented architecture', source: 'openbexi_timeline.json',
        sourceSha256: createHash('sha256').update(modelText).digest('hex'), width, height, clippedText: clipped, pageErrors: errors};
    fs.writeFileSync(path.join(here, 'overview-validation.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
} finally {await browser.close();}
