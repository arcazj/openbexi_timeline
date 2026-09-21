import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile(new URL('../../demos/catalog.json', import.meta.url), 'utf8'));

async function twoFrames(page) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function beginProbe(page, kind) {
    return page.evaluate(async kind => {
        const timeline = await (await import('/src/openbexi_demo.js')).demoReady;
        const scene = timeline.ob_scene[0];
        const svg = timeline.ob_timeline_panel.querySelector('.ob_docked_overview svg');
        window.dragStats = {renders: 0, rebuilds: 0, svgReplacements: 0, invalidMoves: 0,
            renderMilliseconds: 0, maxRenderMilliseconds: 0, started: []};
        window.dragNodes = [...(svg?.querySelectorAll('[data-event-id]') || [])];
        if (!window.dragProbeInstalled) {
            window.dragProbeInstalled = true;
            for (const [name, counter] of [['ob_render', 'renders'], ['update_all_timelines', 'rebuilds']]) {
                const original = timeline[name];
                timeline[name] = function (...args) {
                    const start = performance.now();
                    window.dragStats[counter]++;
                    try { return original.apply(this, args); }
                    finally {
                        if (name === 'ob_render') {
                            const duration = performance.now() - start;
                            window.dragStats.renderMilliseconds += duration;
                            window.dragStats.maxRenderMilliseconds = Math.max(window.dragStats.maxRenderMilliseconds, duration);
                        }
                    }
                };
            }
            const move = timeline.move_band;
            timeline.move_band = function (...args) {
                if (!args.slice(2, 5).every(Number.isFinite)) window.dragStats.invalidMoves++;
                return move.apply(this, args);
            };
            const replace = Element.prototype.replaceChildren;
            Element.prototype.replaceChildren = function (...args) {
                if (this.matches?.('.ob_docked_overview svg')) window.dragStats.svgReplacements++;
                return replace.apply(this, args);
            };
        }
        scene.dragControls.addEventListener('dragstart', event => window.dragStats.started.push({
            name: event.object.name, type: event.object.type
        }));

        // Resolve a visible object using the same raycast as DragControls. The
        // gesture itself is real browser input, never a synthetic drag callback.
        const {Raycaster, Vector2} = await import('three');
        const raycaster = new Raycaster();
        const canvas = scene.ob_renderer.domElement.getBoundingClientRect();
        const frame = timeline.ob_timeline_body_frame.getBoundingClientRect();
        const x = frame.left + frame.width * 0.5;
        for (let y = frame.top + 55; y < frame.bottom - 20; y += 8) {
            for (const dx of [0, -40, 40, -80, 80, -120, 120, -180, 180, -240, 240, -320, 320]) {
                const clientX = x + dx;
                raycaster.setFromCamera(new Vector2((clientX - canvas.left) / canvas.width * 2 - 1,
                    -(y - canvas.top) / canvas.height * 2 + 1), scene.ob_camera);
                const hit = raycaster.intersectObjects(scene.dragControls.objects, scene.dragControls.recursive)[0]?.object;
                const matches = kind === 'session' ? hit?.isMesh && hit.name === '' && hit.data :
                    hit?.isMesh && hit.name.includes('_band_') && !hit.name.includes('overview_') && hit.sortBy !== 'true';
                if (matches) return {x: clientX, y, marker: timeline.ob_markerDate.getTime()};
            }
        }
        return null;
    }, kind);
}

async function drag(page, direction, kind = 'band') {
    const point = await beginProbe(page, kind);
    expect(point, `A visible ${kind} is available for the real mouse gesture`).not.toBeNull();
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + direction * 120, point.y, {steps: 16});
    await twoFrames(page);
    const held = await page.evaluate(async () => {
        const timeline = await (await import('/src/openbexi_demo.js')).demoReady;
        return {...window.dragStats, marker: timeline.ob_markerDate.getTime(),
            reusedEvents: window.dragNodes.every(node => node.isConnected)};
    });
    expect(held.started.length).toBeGreaterThan(0);
    expect(held.renders).toBeGreaterThan(0);
    expect(held.rebuilds, 'Pointer movement must not reconstruct the scene').toBe(0);
    expect(held.svgReplacements, 'Pointer movement must retain the Overview SVG').toBe(0);
    expect(held.reusedEvents, 'Overview event DOM nodes survive panning').toBe(true);
    expect(held.invalidMoves).toBe(0);
    expect(Number.isFinite(held.marker)).toBe(true);
    expect(Math.sign(held.marker - point.marker)).toBe(-direction);

    await page.mouse.up();
    await twoFrames(page);
    await expect.poll(() => page.evaluate(async () => {
        const scene = (await (await import('/src/openbexi_demo.js')).demoReady).ob_scene[0];
        return scene.ob_pan_frame === undefined && scene.ob_drag_frame === undefined;
    })).toBe(true);
    await twoFrames(page);
    const released = await page.evaluate(async () => {
        const timeline = await (await import('/src/openbexi_demo.js')).demoReady;
        const positions = timeline.ob_scene[0].bands.map(band => timeline.ob_scene[0].getObjectByName(band.name)?.position.x);
        return {...window.dragStats, marker: timeline.ob_markerDate.getTime(), positions};
    });
    expect(released.rebuilds, 'A gesture may commit once, never rebuild on every animation tick').toBeLessThanOrEqual(1);
    expect(released.invalidMoves).toBe(0);
    expect(released.positions.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(released.marker)).toBe(true);
    expect(Math.sign(released.marker - point.marker)).toBe(-direction);
    return {direction, kind, held, released};
}

for (const demo of catalog.demos) test(`${demo.id}: horizontal drag reuses rendered content in both directions`, async ({page}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Drag work is measured once at the desktop viewport; resize has separate coverage.');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/demos.html?demo=${demo.id}`);
    await expect(page.locator('#demo-status')).toHaveAttribute('data-state', 'ready');
    await twoFrames(page);
    const reports = [await drag(page, 1), await drag(page, -1)];
    if (demo.id === 'default-dataset') reports.push(await drag(page, 1, 'session'));
    await testInfo.attach('drag-work-counts', {body: JSON.stringify(reports, null, 2), contentType: 'application/json'});
    // Resizing reconstructs the scene; the time selected by a completed pan must
    // survive that later reconstruction instead of jumping to the old reference.
    const marker = reports.at(-1).released.marker;
    await page.setViewportSize({width: 1280, height: 800});
    await expect.poll(() => page.evaluate(async () =>
        (await (await import('/src/openbexi_demo.js')).demoReady).width)).toBe(960);
    await twoFrames(page);
    const resizedMarker = await page.evaluate(async () =>
        (await (await import('/src/openbexi_demo.js')).demoReady).ob_markerDate.getTime());
    expect(Math.abs(resizedMarker - marker)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
});
