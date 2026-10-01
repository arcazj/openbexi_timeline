/**
 * Render the proposal with the actual HBDS simulator and rasterize its overview.
 * Usage: node docs/design/2.4/render-artifacts.mjs [path/to/openbexi_hbds]
 * Requires the repository's Playwright dependency and an installed Chromium browser.
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE optionally selects the browser executable.
 * No HTTP server is started: Playwright supplies read-only virtual HTTP responses.
 */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const outputDirectory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(outputDirectory, '../../..');
const reference = path.resolve(process.argv[2] || path.join(repository, '.local-private/hbds-reference'));
const modelText = await readFile(path.join(outputDirectory, 'timeline-2.4.hbds.json'), 'utf8');
const model = JSON.parse(modelText);
const origin = 'http://hbds.test';
// Keep the physical drawing buffer below Chromium's roughly 33-megapixel budget.
const viewport = {width: 4000, height: 4800};
const deviceScaleFactor = 1.25;
const expectedCounts = {
    nodes: model.hypergraph.class.length,
    classes: model.hypergraph.class.filter(node => node.type !== 'hyperclass').length,
    hyperclasses: model.hypergraph.class.filter(node => node.type === 'hyperclass').length,
    links: model.hypergraph.link.length,
    attributes: model.hypergraph.class.reduce((sum, node) => sum + node.attributes.length, 0),
    memberships: model.hypergraph.membership?.length || 0,
    inheritances: model.hypergraph.inheritance?.length || 0,
    objects: model.hypergraph.object?.length || 0,
    objectLinks: model.hypergraph.objectLink?.length || 0
};
const browserPath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    chromium.executablePath(),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(candidate => candidate && existsSync(candidate));
assert(browserPath, 'Install a Chromium browser or set PLAYWRIGHT_CHROMIUM_EXECUTABLE.');
assert(existsSync(path.join(reference, 'test_dynamic_hbds_layout.html')), `HBDS checkout missing: ${reference}`);

const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const pageErrors = [];
const failedRequests = [];
const unexpectedHttpResponses = [];
const expectedOfflineResponses = [];
const fallbackIcons = [];
const monitor = page => {
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('requestfailed', request => failedRequests.push({url: request.url(), error: request.failure()?.errorText}));
    page.on('response', response => {
        if (response.status() < 400) return;
        const entry = {url: response.url(), status: response.status()};
        if (new URL(response.url()).pathname === '/api/ai/providers' && response.status() === 404) expectedOfflineResponses.push(entry);
        else unexpectedHttpResponses.push(entry);
    });
};
const contentTypes = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'
};

// Match server.py's public missing_icon_svg fallback, without starting its API server.
function missingIconSvg(requested) {
    const stem = path.posix.basename(requested, '.svg');
    const label = stem.replace(/[_-]/g, ' ').trim().replace(/\s+/g, ' ') || 'Icon';
    const initials = label.split(' ').slice(0, 2).map(word => word[0]).join('').toUpperCase();
    const hue = parseInt(createHash('sha1').update(stem).digest('hex').slice(0, 6), 16) % 360;
    const escape = text => text.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;'}[character]));
    const title = escape(label.replace(/\b\w/g, character => character.toUpperCase()));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="${title}">
      <title>${title}</title><rect x="10" y="10" width="76" height="76" rx="18" fill="hsl(${hue} 72% 93%)" stroke="hsl(${hue} 58% 38%)" stroke-width="5"/>
      <circle cx="48" cy="38" r="13" fill="none" stroke="#0f172a" stroke-width="5" opacity=".88"/>
      <path d="M26 68c8-12 18-18 22-18s14 6 22 18" fill="none" stroke="#0f172a" stroke-width="5" stroke-linecap="round" opacity=".88"/>
      <text x="48" y="86" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="hsl(${hue} 58% 30%)">${escape(initials)}</text></svg>`;
}

try {
    const context = await browser.newContext({viewport, deviceScaleFactor, locale: 'en-US', timezoneId: 'UTC'});
    const page = await context.newPage();
    monitor(page);
    await page.route(`${origin}/**`, async route => {
        const requested = decodeURIComponent(new URL(route.request().url()).pathname);
        if (requested === '/design/manifest.json') return route.fulfill({json: {
            models: [{value: 'design/model.json', label: 'OpenBEXI Timeline 2.4 proposed HBDS model'}]
        }});
        if (requested === '/design/model.json') return route.fulfill({contentType: contentTypes['.json'], body: modelText});
        if (requested === '/favicon.ico') return route.fulfill({status: 204});
        const target = path.resolve(reference, `.${requested}`);
        if (!target.startsWith(`${reference}${path.sep}`) || requested.split('/').some(part => part.startsWith('.'))) {
            return route.fulfill({status: 404, body: ''});
        }
        try {
            return await route.fulfill({contentType: contentTypes[path.extname(target)] || 'application/octet-stream', body: await readFile(target)});
        } catch {
            if (requested.startsWith('/icons/') && requested.endsWith('.svg')) {
                fallbackIcons.push(requested);
                return route.fulfill({contentType: contentTypes['.svg'], body: missingIconSvg(requested)});
            }
            return route.fulfill({status: 404, body: ''});
        }
    });
    // A virtual root other than models/ or test_models/ disables collaboration and server APIs.
    await page.goto(`${origin}/test_dynamic_hbds_layout.html?modelsPath=design/&manifestPath=design/manifest.json&sharedModel=design/model.json`, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(expected => {
        const state = window.__hbdsDynamicTest?.getState();
        return state?.counts.nodes === expected && state.saved && state.render.completedRenderCount > 0;
    }, expectedCounts.nodes, {timeout: 90_000});
    // Capture the simulator's own WebGL geometry and CSS2D labels; hide only editing chrome.
    await page.addStyleTag({content: `
        body > :not(#container) { display: none !important; }
        #container { inset: 0 !important; transition: none !important; }
        #canvas-model-title { font-size: 36px !important; line-height: 1.3 !important; max-width: calc(100% - 100px) !important; }
    `});
    await page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        window.dispatchEvent(new Event('resize'));
        document.getElementById('fit-model-button').click();
    });
    await page.waitForFunction(() => {
        const render = window.__hbdsDynamicTest.getRenderState();
        return !render.frameScheduled && !render.orbitFrameScheduled && !render.orbitRenderPending;
    });
    await page.evaluate(() => document.fonts.ready);

    const diagnostics = await page.evaluate(async () => {
        const api = window.__hbdsDynamicTest;
        const state = api.getState();
        const data = api.getData();
        const canvas = document.querySelector('#diagram-viewport canvas');
        const gl = canvas.getContext('webgl2');
        const graphics = {drawingBufferWidth: gl.drawingBufferWidth, drawingBufferHeight: gl.drawingBufferHeight, maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE)};
        const labels = api.getLabelMetrics();
        const bounds = document.getElementById('container').getBoundingClientRect();
        const visible = labels.filter(label => label.visible);
        const clippedLabels = visible.filter(label => label.left < bounds.left || label.top < bounds.top || label.right > bounds.right || label.bottom > bounds.bottom).map(({text, classes}) => ({text, classes}));
        const semantic = await import('/js/hbds_semantics.js');
        const effectiveInheritance = data.hypergraph.inheritance.map(relation => {
            const attributes = semantic.getEffectiveClassAttributes(data, relation.subClassId);
            return {classId: relation.subClassId, ancestors: semantic.getClassAncestors(data, relation.subClassId), effectiveAttributes: attributes.length, inheritedAttributes: attributes.filter(attribute => attribute.inherited).length};
        });
        const byKind = kind => visible.filter(label => label.classes.includes(kind));
        const ellipsizedAttributes = [...document.querySelectorAll('.attribute-label')].filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent);
        const attributeOverlaps = [];
        const attributeLabels = byKind('attribute-label');
        for (let i = 0; i < attributeLabels.length; i++) {
            for (let j = i + 1; j < attributeLabels.length; j++) {
                const a = attributeLabels[i], b = attributeLabels[j];
                const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
                const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
                if (width * height > 1) attributeOverlaps.push([a.text, b.text]);
            }
        }
        const fonts = kind => {
            const sizes = byKind(kind).map(label => parseFloat(label.fontSize));
            return {min: Math.min(...sizes), max: Math.max(...sizes)};
        };
        const hubs = api.getLinkHubMetrics();
        return {
            counts: state.counts,
            validation: state.validation,
            semanticProfiles: {valid: state.semanticProfiles.valid, errors: state.semanticProfiles.errors, warnings: state.semanticProfiles.warnings},
            serverConnected: state.serverConnected,
            completedRenderCount: state.render.completedRenderCount,
            canvas: state.canvas,
            graphics,
            fit: api.getFitQuality(),
            pixels: api.sampleRendererPixels(32),
            labels: {classes: byKind('class-label').length, attributes: byKind('attribute-label').length, links: byKind('link-label').length, clipped: clippedLabels, ellipsizedAttributes, attributeOverlaps, fontPixels: {classes: fonts('class-label'), attributes: fonts('attribute-label'), links: fonts('link-label')}},
            relationshipHubs: {count: hubs.length, invalid: hubs.filter(hub => !hub.valid).map(hub => ({id: hub.id, reason: hub.reason}))},
            effectiveInheritance
        };
    });
    await page.locator('#container').screenshot({path: path.join(outputDirectory, 'timeline-2.4.hbds.png'), animations: 'disabled', timeout: 60_000});

    const overviewText = await readFile(path.join(outputDirectory, 'timeline-2.4.overview.svg'), 'utf8');
    const dimensions = overviewText.match(/<svg[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/);
    assert(dimensions, 'Overview SVG must have explicit width and height.');
    const overviewSize = {width: Number(dimensions[1]), height: Number(dimensions[2])};
    const overviewContext = await browser.newContext({viewport: overviewSize, deviceScaleFactor: 2});
    const overviewPage = await overviewContext.newPage();
    monitor(overviewPage);
    await overviewPage.setContent(`<html><head><meta charset="utf-8"><style>html,body{margin:0}svg{display:block}</style></head><body>${overviewText}</body></html>`);
    await overviewPage.evaluate(() => document.fonts.ready);
    await overviewPage.locator('svg').screenshot({path: path.join(outputDirectory, 'timeline-2.4.overview.png')});

    const checks = {
        countsMatch: Object.entries(diagnostics.counts).every(([key, value]) => value === expectedCounts[key]),
        modelValid: diagnostics.validation.valid,
        semanticProfilesValid: diagnostics.semanticProfiles.valid,
        allClassLabelsPresent: diagnostics.labels.classes === expectedCounts.nodes,
        allAttributeLabelsPresent: diagnostics.labels.attributes === expectedCounts.attributes,
        allLinkLabelsPresent: diagnostics.labels.links === expectedCounts.links,
        noClippedLabels: diagnostics.labels.clipped.length === 0,
        noEllipsizedAttributes: diagnostics.labels.ellipsizedAttributes.length === 0,
        noOverlappingAttributes: diagnostics.labels.attributeOverlaps.length === 0,
        validRelationshipHubs: diagnostics.relationshipHubs.count === expectedCounts.links && diagnostics.relationshipHubs.invalid.length === 0,
        renderedPixels: diagnostics.pixels.nonBackground > 0 && diagnostics.pixels.colored > 0,
        graphicsBufferMatchesCanvas: diagnostics.graphics.drawingBufferWidth === diagnostics.canvas.width && diagnostics.graphics.drawingBufferHeight === diagnostics.canvas.height,
        noPageErrors: pageErrors.length === 0,
        noFailedRequests: failedRequests.length === 0 && unexpectedHttpResponses.length === 0
    };
    const result = {
        generatedAt: new Date().toISOString(),
        modelSha256: createHash('sha256').update(modelText).digest('hex'),
        referenceCommit: model.metadata.extensions.timeline24.reference.commit,
        browser: {name: path.basename(browserPath), version: browser.version(), viewport, deviceScaleFactor},
        outputs: {simulator: {file: 'timeline-2.4.hbds.png', width: viewport.width * deviceScaleFactor, height: viewport.height * deviceScaleFactor}, overview: {file: 'timeline-2.4.overview.png', width: overviewSize.width * 2, height: overviewSize.height * 2}},
        expectedCounts, checks, passed: Object.values(checks).every(Boolean),
        ...diagnostics, pageErrors, failedRequests, unexpectedHttpResponses, expectedOfflineResponses, fallbackIcons,
        notes: [`The full PNG is an actual simulator render with editing panels hidden, captured at ${deviceScaleFactor} physical pixels per CSS pixel to remain within the graphics buffer budget.`, 'The native simulator scales attribute text to at most 9 CSS pixels at this full-model fit; class and link labels retain their configured sizes. The capture preserves native font logic. Use the readable overview for orientation and load the JSON in HBDS to inspect attributes at higher zoom.', 'The offline AI provider request returns 404 and uses the simulator\'s local provider definitions.', 'Missing icons use the same generated placeholder as the upstream static server.', 'The overview intentionally simplifies associations; consult the JSON for the complete proposal.', 'Browser validation checks the proposed HBDS model, not future application enforcement.']
    };
    await writeFile(path.join(outputDirectory, 'validation-results.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({passed: result.passed, counts: diagnostics.counts, checks, labels: diagnostics.labels, effectiveInheritance: diagnostics.effectiveInheritance}, null, 2));
    if (!result.passed) process.exitCode = 1;
} finally {
    await browser.close();
}
