import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const base = process.env.OPENBEXI_INSTALL_TEST_URL;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base || '')) throw new Error('A local installer test URL is required.');
const browser = await chromium.launch({executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(base + '/demos.html?demo=monet');
    await page.waitForFunction(async () => {
        const timeline = await (await import('/src/openbexi_demo.js')).demoReady;
        return timeline && !timeline.ob_results.pending && timeline.ob_scene[0].ob_renderer;
    }, null, {timeout: 60_000});
    assert.ok(await page.locator('canvas').count(), 'The installed app renders a timeline.');
    assert.deepEqual(errors, []);
    for (const resource of ['/api/v1/health', '/api/v1/datasets', '/openbexi_timeline_model.html']) {
        assert.equal((await page.request.get(base + resource)).status(), 200, resource);
    }
    console.log('Installed timeline rendered; API, examples and model editor are available.');
} finally { await browser.close(); }
