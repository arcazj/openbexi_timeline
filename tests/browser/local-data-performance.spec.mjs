import {test, expect} from '@playwright/test';

test('Large JSON uses a real module worker while the page remains responsive', async ({page}, info) => {
    const errors = [], workers = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('worker', worker => workers.push(worker));
    await page.route('**/__local-data-test.html', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Local data benchmark</title>'}));
    await page.goto('/__local-data-test.html');
    const measurements = await page.evaluate(async () => {
        const {parseLocalTimelineData} = await import('/src/openbexi_timeline_local_data.js');
        const {parseTimelineData} = await import('/src/openbexi_timeline_data_parser.js');
        const count = 20000;
        const input = JSON.stringify({events: Array.from({length: count}, (_,index) => ({
            id: String(index), start: '2026-10-02T12:30:00Z', end: '2026-10-02T12:35:00Z',
            data: {title: 'Synthetic activity ' + index, description: 'Local processing benchmark. '.repeat(4)}
        }))});
        let start = performance.now();
        const synchronousCount = parseTimelineData(input).events.length;
        const synchronousMs = performance.now() - start;
        let heartbeatTicks = 0;
        const heartbeat = setInterval(() => heartbeatTicks++, 5);
        start = performance.now();
        const parsed = await parseLocalTimelineData(new Blob([input]));
        const workerMs = performance.now() - start;
        clearInterval(heartbeat);
        return {count: parsed.events.length, synchronousCount, bytes: new Blob([input]).size,
            synchronousMs, workerMs, heartbeatTicks};
    });
    await info.attach('local-json-processing', {body: JSON.stringify(measurements, null, 2), contentType: 'application/json'});
    expect(measurements.count).toBe(20000);
    expect(measurements.synchronousCount).toBe(20000);
    expect(measurements.heartbeatTicks).toBeGreaterThan(0);
    expect(workers).toHaveLength(1);
    expect(errors).toEqual([]);
});

test('Escape cancels local processing, preserves displayed data and Retry finishes the worker load', async ({page}) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/demos.html?demo=monet');
    await expect(page.locator('#demo-status')).toHaveAttribute('data-state', 'ready');
    await page.waitForFunction(async () => !(await (await import('/src/openbexi_demo.js')).demoReady).ob_results.pending);
    const payload = ' '.repeat(300000) + JSON.stringify({events: [{id: 'worker-retry', start: '1870-01-01', data: {title: 'Worker retry sample'}}]});
    await page.route('**/__local_worker_dataset.json', route => route.fulfill({contentType: 'application/json', body: payload}));
    // Hold only worker startup so cancellation has a deterministic opportunity.
    // Retry runs the real production worker and parser without an artificial delay.
    let held, first = true;
    await page.route('**/src/openbexi_timeline_data_worker.js', route => {
        if (first) {first = false;held = route;return;}
        return route.continue();
    });
    try {
        // Escape is scoped to the active timeline. Keep keyboard focus in its
        // plot, as a user navigating that timeline would, before background I/O.
        await page.locator('.ob_paged_frame').focus();
        await page.evaluate(async () => {
            const timeline = await (await import('/src/openbexi_demo.js')).demoReady;
            window.preWorkerData = timeline.staticData;
            timeline.localSource = {url: '/__local_worker_dataset.json', config: {}};
            window.localWorkerLoad = timeline.loadLocalData();
        });
        await expect.poll(() => Boolean(held)).toBe(true);
        await expect(page.getByRole('button', {name: /^Status:/})).toHaveAttribute('aria-description', /Processing dataset/);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', {name: /^Status:/})).toHaveText('Status: Cancelled');
        expect(await page.evaluate(async () => {
            await window.localWorkerLoad;
            const timeline = await (await import('/src/openbexi_demo.js')).demoReady;
            return timeline.staticData === window.preWorkerData && !timeline.ob_results.fetching;
        })).toBe(true);
        await held.abort().catch(() => {});held = null;
        await page.getByRole('button', {name: 'Retry', exact: true}).click();
        await page.waitForFunction(async () => {
            const timeline = await (await import('/src/openbexi_demo.js')).demoReady;
            return timeline.staticData.events[0]?.id === 'worker-retry' && !timeline.ob_results.pending && !timeline.ob_results.fetching;
        });
        await expect(page.getByRole('button', {name: /^Status:/})).toHaveText('Status: Ready');
        expect(errors).toEqual([]);
    } finally {await held?.abort().catch(() => {});}
});
