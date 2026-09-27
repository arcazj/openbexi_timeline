// Capture the existing application, without injecting proposed controls or styles.
// From the repository root: node docs/ui/current-app/capture.mjs
// Optionally set TIMELINE_CAPTURE_BROWSER to an installed Chromium executable.
import {chromium} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createDemoServer} from '../../../tools/serve-demos.mjs';

const output = new URL('./', import.meta.url);
await mkdir(output, {recursive: true});
const server = createDemoServer();
await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
});
let browser;
try {
    browser = await chromium.launch({headless: true, executablePath: process.env.TIMELINE_CAPTURE_BROWSER || undefined,
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
    const page = await browser.newPage({viewport: {width: 1440, height: 900},
        deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce'});
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-01-15T12:00:00Z'));
    const route = '/demos.html?demo=space_exploration';
    await page.goto(`http://127.0.0.1:${server.address().port}${route}`);
    await page.locator('#demo-status[data-state="ready"]').waitFor();
    const settle = () => page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await settle();
    const evidence = await page.evaluate(async () => {
        const timeline = await (await import('/src/openbexi_demo.js')).demoReady;
        const renderer = timeline.ob_scene[0].ob_renderer;
        return {title: document.title, records: timeline.staticData.events.filter(event => !event.zone).length,
            webgl2: renderer.getContext() instanceof WebGL2RenderingContext,
            drawCalls: renderer.info.render.calls, dataset: 'json/test-data/space_exploration.json',
            model: 'models/demos/space_exploration.json'};
    });
    if (!evidence.webgl2 || evidence.drawCalls <= 0) throw new Error('Expected actual WebGL rendering.');
    await page.screenshot({path: fileURLToPath(new URL('timeline-desktop.png', output)), animations: 'disabled'});
    await page.getByAltText('Settings', {exact: true}).click();
    await page.locator('#demo-side-slot').getByRole('button', {name: 'Apply Timeline Info', exact: true}).waitFor();
    await settle();
    await page.screenshot({path: fileURLToPath(new URL('settings-desktop.png', output)), animations: 'disabled'});
    const metadata = {capturedAt: new Date().toISOString(), browser: browser.version(), platform: process.platform,
        viewport: page.viewportSize(), route, ...evidence, pageErrors,
        scope: 'Existing local file-backed demo and legacy Settings; proposed Auto scale, Results, Fit matches and server configuration editor are not implemented.',
        screenshots: ['timeline-desktop.png', 'settings-desktop.png']};
    await writeFile(new URL('capture.json', output), JSON.stringify(metadata, null, 2) + '\n');
    console.log(JSON.stringify(metadata, null, 2));
    if (pageErrors.length) throw new Error('Capture completed with page errors; inspect capture.json.');
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
