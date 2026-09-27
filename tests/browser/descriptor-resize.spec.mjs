import {test,expect} from '@playwright/test';

async function ready(page) {
    await expect.poll(()=>page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return !t.ob_results.pending && !t.ob_results.resizeQueued && t.ob_viewport.headerHeight===t.ob_timeline_header.offsetHeight;
    })).toBe(true);
}

test('Data divider supports real dragging and keyboard resizing without losing the selected record',async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/demos.html?demo=monet');await ready(page);
    await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;
        t.ob_open_descriptor(0,t.staticData.events.find(record=>!record.zone));});
    const divider=page.getByRole('separator',{name:'Resize Data panel'});
    await expect(divider).toBeVisible();await ready(page);
    const panel=page.locator('.ob_viewport_side'),before=await panel.boundingBox();
    const title=await panel.locator('h2').textContent();
    const grip=await divider.boundingBox(),x=grip.x+grip.width/2,y=grip.y+grip.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-150,y,{steps:8});
    await expect.poll(async()=>Number(await divider.getAttribute('aria-valuenow'))).toBe(Math.round(before.width+150));
    await page.mouse.up();await ready(page);
    const grown=await panel.boundingBox();expect(grown.width-before.width).toBeCloseTo(150,0);
    expect(grown.x+grown.width).toBeLessThanOrEqual(page.viewportSize().width+1);
    await expect(panel.locator('h2')).toHaveText(title);
    expect(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    if(page.viewportSize().width<900) {
        const overview=await page.locator('.ob_docked_overview').first().boundingBox();
        expect(grown.y+grown.height).toBeLessThanOrEqual(overview.y+1);
    }
    await divider.focus();await page.keyboard.press('Shift+ArrowRight');await ready(page);
    expect(Number(await divider.getAttribute('aria-valuenow'))).toBe(Math.round(grown.width-50));
    await page.keyboard.press('Home');await ready(page);
    expect(await divider.getAttribute('aria-valuenow')).toBe(await divider.getAttribute('aria-valuemin'));
    await page.getByRole('button',{name:'Close event details'}).click();await expect(divider).toBeHidden();
    expect(errors).toEqual([]);
});
