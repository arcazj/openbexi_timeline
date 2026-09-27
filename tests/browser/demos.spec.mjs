import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';

const catalog = JSON.parse(await fs.readFile(new URL('../../demos/catalog.json', import.meta.url), 'utf8'));

async function settle(page) {
    await page.mouse.move(0,0);
    await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.waitForFunction(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return !t.ob_results.pending && t.ob_viewport.headerHeight===t.ob_timeline_header.offsetHeight;});
    await page.waitForTimeout(180);
    // Resizing can finish after the toolbar settles. Await the actual host
    // dimensions before recording geometry for the assertions below.
    await page.waitForFunction(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,v=t.ob_viewport;
        const width=t.layoutHost.clientWidth-(v.panelOpen && !v.overlay?v.sideWidth:0);
        return !t.ob_results.pending && t.width===width && t.height===t.layoutHost.clientHeight;
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
            dockOverview: Boolean(timeline.ob_viewport.overviewHeight),
            hasOverview: scene.bands.some(band => band.name.includes('overview_')),
            overviewIds: [...new Set(scene.bands.filter(b=>b.name.includes('overview_')).flatMap(b=>b.sessions)
                .flatMap(session => session.activities).map(event => String(event.id)))],
            overviewRecords:scene.bands.filter(b=>b.name.includes('overview_')).flatMap(b=>b.sessions).flatMap(s=>s.activities).length,
            regions: [timeline.ob_timeline_body_frame, timeline.ob_views.tablePanel,
                timeline.ob_timeline_right_panel, timeline.ob_timeline_header.parentElement]
                .map(region => ({scrollbar: getComputedStyle(region).scrollbarWidth,
                    webkit: getComputedStyle(region, '::-webkit-scrollbar').display,
                    focusable: region.tabIndex >= 0}))
        };
    });
}

for (const demo of catalog.demos) test(`${demo.id}: rendering, overview, panels, and resize`, async ({page}, info) => {
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
    expect(initial.width).toBe(page.viewportSize().width);
    expect(initial.height).toBe(page.viewportSize().height);
    expect(await page.locator('.ob_paged_frame').evaluate(e=>getComputedStyle(e).overflow)).toBe('hidden');
    expect(initial.regions.slice(0, 3).every(region => region.focusable)).toBe(true);
    const axisGaps = await page.locator('.ob_docked_overview [data-overview-axis]').evaluateAll(axes => axes.flatMap(axis => {
        const labels = [...axis.querySelectorAll('text')].map(label => label.getBoundingClientRect())
            .filter(rect => rect.width > 0).sort((a,b) => a.left-b.left);
        return labels.slice(1).map((rect,index) => rect.left-labels[index].right);
    }));
    expect(axisGaps.every(gap => gap >= 4), 'Overview date labels keep a readable gap, including long dates at edges').toBe(true);
    const timelineSlot = page.locator('#demo-timeline-slot');
    const sideSlot = page.locator('#demo-side-slot');
    const timelineBox = await timelineSlot.locator('.ob_timeline_panel').boundingBox();
    expect(timelineBox.x).toBe(0);
    expect(timelineBox.y).toBe(0);
    expect(timelineBox.width).toBe(initial.width);
    await expect(page).toHaveScreenshot(`${demo.id}-timeline.png`, {animations: 'disabled'});
    if (process.env.DEMO_CAPTURE_DIR) {
        await fs.mkdir(process.env.DEMO_CAPTURE_DIR,{recursive:true});
        await page.screenshot({path:`${process.env.DEMO_CAPTURE_DIR}/${demo.id}-${info.project.name}-timeline.png`,animations:'disabled'});
    }

    const overviews = page.locator('.ob_docked_overview');
    const overview = overviews.last();
    if (initial.dockOverview) {
        await expect(overview).toBeVisible();
        const overviewBox = await overview.boundingBox();
        const eventsBox = await page.getByRole('region', {name: 'Timeline events', exact: true}).boundingBox();
        expect(overviewBox.x).toBe(eventsBox.x);
        expect(overviewBox.width).toBe(eventsBox.width);
        expect(Math.abs(overviewBox.y + overviewBox.height - page.viewportSize().height)).toBeLessThanOrEqual(1);
        expect(eventsBox.y+eventsBox.height).toBeLessThanOrEqual((await overviews.first().boundingBox()).y+1);
        const actualIds = await overviews.locator('[data-event-id]').evaluateAll(nodes => [...new Set(nodes.map(node => node.dataset.eventId))]);
        expect(actualIds.every(id=>initial.overviewIds.includes(id))).toBe(true);
        expect(await overviews.locator('[data-record-count]').evaluateAll(nodes=>nodes.reduce((sum,n)=>sum+Number(n.dataset.recordCount),0))).toBe(initial.overviewRecords);
        expect(actualIds.length).toBeGreaterThan(0);
        const visibleMarks=await overviews.evaluateAll(panels=>panels.map(panel=>{
            const svg=panel.querySelector('svg'),width=svg.viewBox.baseVal.width,height=svg.viewBox.baseVal.height;
            return [...svg.querySelectorAll('[data-event-id]')].filter(mark=>{const b=mark.getBBox();return b.x+b.width>=0 && b.x<=width && b.y+b.height>=0 && b.y<=height;}).length;
        }));
        expect(visibleMarks.every(count=>count>0),'Every populated Overview shows records in its initial display window').toBe(true);
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
        const overviewControl=page.getByAltText('Overview', {exact: true});
        await expect(overviewControl).toHaveAttribute('aria-disabled','true');
    }

    // Open a dataset record through the public API, then exercise exclusion,
    // rendering, and layout using the real browser controls.
    await page.evaluate(async () => {
        const timeline = await (await import('/src/openbexi_demo.js')).demoReady;
        timeline.ob_open_descriptor(0, timeline.staticData.events.find(event => !event.zone));
    });
    await expect(sideSlot.getByRole('button', {name: 'Close event details'})).toBeVisible();
    await settle(page);
    const sideBox=await page.locator('.ob_viewport_side').boundingBox();
    await staysInsideSidePanel(sideSlot.locator('.ob_static_description'), sideBox);
    await page.getByRole('button', {name: 'Help', exact: true}).click();
    await expect(sideSlot.getByRole('heading', {name: 'Help and sharing'})).toBeVisible();
    await expect(sideSlot.getByRole('button', {name: 'Close event details'})).toHaveCount(0);
    await expect(sideSlot.getByRole('combobox', {name: 'Local dataset'})).toHaveValue(demo.id);
    if (!initial.numeric) {
        await page.getByAltText('Calendar browser', {exact: true}).click();
        await expect(sideSlot.locator('.jsCalendar')).toBeVisible();
        await settle(page);
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
    expect(splitEvents.width).toBe(Math.floor((await inspect(page)).width / 2));
    if (initial.dockOverview) expect((await overview.boundingBox()).width).toBe(splitEvents.width);
    if (initial.dockOverview) {
        const visible=await overviews.evaluateAll(panels=>panels.map(panel=>{
            const viewport=panel.getBoundingClientRect();
            return [...panel.querySelectorAll('[data-event-id]')].some(mark=>{
                const box=mark.getBoundingClientRect();
                return box.right>viewport.left && box.left<viewport.right && box.bottom>viewport.top && box.top<viewport.bottom;
            });
        }));
        expect(visible.every(Boolean),'Populated Overviews retain visible marks after opening panels and switching to Split').toBe(true);
    }
    await expect(page).toHaveScreenshot(`${demo.id}-split-help.png`, {animations: 'disabled'});
    if (process.env.DEMO_CAPTURE_DIR) await page.screenshot({path:`${process.env.DEMO_CAPTURE_DIR}/${demo.id}-${info.project.name}-split-help.png`,animations:'disabled'});

    const table = page.getByRole('region', {name: 'Timeline event table', exact: true});
    const next=table.getByRole('button',{name:'Next',exact:true});
    if(await next.count() && await next.isEnabled()) {
        const caption=await table.locator('caption').textContent();
        await next.focus();await page.keyboard.press('Enter');
        await expect(table.locator('caption')).not.toHaveText(caption);
        expect(await table.evaluate(e=>e.scrollTop)).toBe(0);
    }

    await page.getByRole('button', {name: 'Table', exact: true}).click();
    await expect(page.getByRole('region', {name: 'Timeline events', exact: true})).toBeHidden();
    await expect(overview).toBeHidden();
    await page.setViewportSize({width: 390, height: 844});
    await expect.poll(async () => (await inspect(page)).width).toBe(390);
    await expect(sideSlot.getByRole('heading', {name: 'Help and sharing'})).toBeVisible();
    await page.getByRole('button', {name: 'Timeline', exact: true}).click();
    if (initial.dockOverview) await expect(overview).toBeVisible();
    expect((await inspect(page)).reference).toEqual(initial.reference);
    expect(errors, 'No uncaught runtime errors').toEqual([]);
});
