import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile(new URL('../../demos/catalog.json', import.meta.url), 'utf8'));

async function settle(page) {
    await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
}

async function staysInsideSidePanel(locator, sideBox) {
    const box = await locator.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(sideBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(sideBox.x + sideBox.width + 1);
}

async function inspect(page) {
    return page.evaluate(async () => {
        const timeline = await (await import('/src/openbexi_demo.js')).demoReady;
        const scene = timeline.ob_scene[0];
        const renderer = scene.ob_renderer;
        return {
            width: timeline.width, height: timeline.height,
            records: timeline.staticData.events.filter(event => !event.zone).length,
            drawCalls: renderer.info.render.calls,
            webgl: renderer.getContext() instanceof WebGL2RenderingContext,
            reference: timeline.ob_scene.sync_time,
            numeric: timeline.staticTimeAxis?.kind === 'numeric',
            overview: timeline.ob_visible_view,
            dockOverview: Boolean(timeline.params[0].dockOverview),
            hasOverview: scene.bands.some(band => band.name.includes('overview_')),
            overviewIds: [...new Set((scene.bands.at(-1)?.sessions || [])
                .flatMap(session => session.activities).map(event => String(event.id)))],
            regions: [timeline.ob_timeline_body_frame, timeline.ob_views.tablePanel,
                timeline.ob_timeline_right_panel, timeline.ob_timeline_header.parentElement]
                .map(region => ({scrollbar: getComputedStyle(region).scrollbarWidth,
                    webkit: getComputedStyle(region, '::-webkit-scrollbar').display,
                    focusable: region.tabIndex >= 0}))
        };
    });
}

for (const demo of catalog.demos) test(`${demo.id}: rendering, overview, panels, and resize`, async ({page}) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-01-15T12:00:00Z'));
    await page.goto(`/demos.html?demo=${demo.id}`);
    await expect(page.locator('#demo-status')).toHaveAttribute('data-state', 'ready');
    await settle(page);
    const initial = await inspect(page);
    expect(initial.records).toBe(demo.recordCount);
    expect(initial.webgl, 'The real Chromium WebGL2 renderer is active').toBe(true);
    expect(initial.drawCalls, 'The WebGL scene draws geometry').toBeGreaterThan(0);
    expect(initial.width).toBe(Math.floor(page.viewportSize().width * 0.75));
    expect(initial.height).toBe(page.viewportSize().height - 40);
    expect(initial.regions.every(region => region.scrollbar === 'none' && region.webkit === 'none')).toBe(true);
    expect(initial.regions.slice(0, 3).every(region => region.focusable)).toBe(true);
    const timelineSlot = page.locator('#demo-timeline-slot');
    const sideSlot = page.locator('#demo-side-slot');
    const timelineBox = await timelineSlot.boundingBox();
    const sideBox = await sideSlot.boundingBox();
    expect(timelineBox.x).toBe(0);
    expect(timelineBox.y).toBe(0);
    expect(timelineBox.width).toBe(initial.width);
    expect(sideBox.x).toBe(initial.width);
    expect(sideBox.width).toBe(page.viewportSize().width - initial.width);
    await expect(page).toHaveScreenshot(`${demo.id}-timeline.png`, {animations: 'disabled'});

    const overview = page.locator('.ob_docked_overview');
    if (initial.dockOverview) {
        await expect(overview).toBeVisible();
        const overviewBox = await overview.boundingBox();
        const eventsBox = await page.getByRole('region', {name: 'Timeline events', exact: true}).boundingBox();
        expect(overviewBox.x).toBe(eventsBox.x);
        expect(overviewBox.width).toBe(eventsBox.width);
        expect(Math.abs(overviewBox.y + overviewBox.height - page.viewportSize().height)).toBeLessThanOrEqual(1);
        expect(Math.abs(eventsBox.y + eventsBox.height - overviewBox.y)).toBeLessThanOrEqual(1);
        const actualIds = await overview.locator('[data-event-id]').evaluateAll(nodes => [...new Set(nodes.map(node => node.dataset.eventId))]);
        expect(actualIds.sort()).toEqual(initial.overviewIds.sort());
        expect(actualIds.length).toBeGreaterThan(0);
    }
    if (initial.hasOverview) {
        await page.getByAltText('Overview', {exact: true}).click();
        expect((await inspect(page)).overview).toBe(false);
        await expect(overview).toBeHidden();
        await page.getByAltText('No overview', {exact: true}).click();
        expect((await inspect(page)).overview).toBe(true);
        if (initial.dockOverview) await expect(overview).toBeVisible();
        await settle(page);
        expect((await inspect(page)).reference).toEqual(initial.reference);
        // A second comparison catches the former black-band regression after toggling.
        await expect(page).toHaveScreenshot(`${demo.id}-timeline.png`, {animations: 'disabled'});
    } else {
        // Some models deliberately have no overview band.
        await expect(page.getByAltText('Overview', {exact: true})).toBeHidden();
    }

    // Open a dataset record through the public API, then exercise exclusion,
    // rendering, and layout using the real browser controls.
    await page.evaluate(async () => {
        const timeline = await (await import('/src/openbexi_demo.js')).demoReady;
        timeline.ob_open_descriptor(0, timeline.staticData.events.find(event => !event.zone));
    });
    await expect(sideSlot.getByRole('button', {name: 'Close event details'})).toBeVisible();
    await staysInsideSidePanel(sideSlot.locator('.ob_static_description'), sideBox);
    await page.getByRole('button', {name: 'Help', exact: true}).click();
    await expect(sideSlot.getByRole('heading', {name: 'Help and sharing'})).toBeVisible();
    await expect(sideSlot.getByRole('button', {name: 'Close event details'})).toHaveCount(0);
    await expect(sideSlot.getByRole('combobox', {name: 'Local dataset'})).toHaveValue(demo.id);
    if (!initial.numeric) {
        await page.getByAltText('Calendar browser', {exact: true}).click();
        await expect(sideSlot.locator('.jsCalendar')).toBeVisible();
        await staysInsideSidePanel(sideSlot.locator('.jsCalendar'), sideBox);
        await expect(sideSlot.getByRole('heading', {name: 'Help and sharing'})).toHaveCount(0);
        await page.getByRole('button', {name: 'Help', exact: true}).click();
        await expect(sideSlot.locator('.jsCalendar')).toHaveCount(0);
        await expect(sideSlot.getByRole('combobox', {name: 'Local dataset'})).toHaveValue(demo.id);
    }
    await page.getByRole('button', {name: 'Split', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Split', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('region', {name: 'Timeline event table', exact: true})).toBeVisible();
    await settle(page);
    const splitEvents = await page.getByRole('region', {name: 'Timeline events', exact: true}).boundingBox();
    expect(splitEvents.width).toBe(Math.floor(initial.width / 2));
    if (initial.dockOverview) expect((await overview.boundingBox()).width).toBe(splitEvents.width);
    await expect(page).toHaveScreenshot(`${demo.id}-split-help.png`, {animations: 'disabled'});

    const table = page.getByRole('region', {name: 'Timeline event table', exact: true});
    if (await table.evaluate(region => region.scrollHeight > region.clientHeight)) {
        await table.focus();
        await page.keyboard.press('PageDown');
        await expect.poll(() => table.evaluate(region => region.scrollTop)).toBeGreaterThan(0);
    }

    await page.getByRole('button', {name: 'Table', exact: true}).click();
    await expect(page.getByRole('region', {name: 'Timeline events', exact: true})).toBeHidden();
    await expect(overview).toBeHidden();
    await page.setViewportSize({width: 390, height: 844});
    await expect.poll(async () => (await inspect(page)).width).toBe(292);
    await expect(sideSlot.getByRole('heading', {name: 'Help and sharing'})).toBeVisible();
    await page.getByRole('button', {name: 'Timeline', exact: true}).click();
    if (initial.dockOverview) await expect(overview).toBeVisible();
    expect((await inspect(page)).reference).toEqual(initial.reference);
    expect(errors, 'No uncaught runtime errors').toEqual([]);
});
