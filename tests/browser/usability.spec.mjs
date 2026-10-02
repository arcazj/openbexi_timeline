import {test,expect} from '@playwright/test';

const ready=async page=>{
    const status=page.locator('#demo-status');
    await expect(status).toHaveAttribute('data-state',/^(ready|error)$/);
    expect(await status.getAttribute('data-state'),await status.textContent()).toBe('ready');
    await page.waitForFunction(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return !t.ob_results.pending && !t.ob_results.fetching && t.ob_viewport.headerHeight===t.ob_timeline_header.offsetHeight;
    });
};
const click=async(locator,touch)=>touch?locator.tap():locator.click();
const more=page=>page.getByRole('button',{name:'More',exact:true});
async function showControls(page,touch) {
    if(await more(page).isVisible() && await more(page).getAttribute('aria-expanded')==='false')await click(more(page),touch);
}

test('Search, view changes and event details work with touch and keyboard',async({page,isMobile})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    const search=page.getByRole('searchbox',{name:'Search',exact:true});
    await click(search,isMobile);await search.fill('Antenna');await search.press('Enter');await ready(page);
    await expect.poll(()=>page.evaluate(async()=>(await(await import('/src/openbexi_demo.js')).demoReady).ob_results.snapshot.matchingKeys.length)).toBeGreaterThan(0);
    await showControls(page,isMobile);
    const table=page.getByRole('button',{name:'Table',exact:true});
    if(isMobile)await table.tap();else {await table.focus();await page.keyboard.press('Enter');}
    await ready(page);
    const region=page.getByRole('region',{name:'Timeline event table',exact:true});
    await expect(region).toBeVisible();
    const record=region.locator('.ob_table_record').first();
    await record.focus();await page.keyboard.press('Enter');
    await expect(page.locator('.ob_record_details')).toBeVisible();
    await expect(page.getByRole('button',{name:'Close event details',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
});

test('Compact toolbar exposes essentials and More closes with Escape and outside input',async({page,isMobile})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    const header=page.locator('.ob_results_header');
    await expect(header).toHaveAttribute('data-compact','true');
    for(const control of [page.getByRole('searchbox',{name:'Search',exact:true}),more(page),
        page.getByRole('button',{name:'Find previous activity',exact:true}),page.getByRole('button',{name:'Find next activity',exact:true}),page.locator('.ob_results_status')])
        await expect(control).toBeInViewport({ratio:1});
    expect(await page.locator('.ob_primary_toolbar,.ob_activity_toolbar').evaluateAll(rows=>rows.every(row=>row.scrollWidth<=row.clientWidth+1))).toBe(true);
    await click(more(page),isMobile);
    await expect(page.getByLabel('Lock current view',{exact:true})).toBeVisible();
    await page.keyboard.press('Escape');await expect(more(page)).toBeFocused();
    await expect(more(page)).toHaveAttribute('aria-expanded','false');
    await click(more(page),isMobile);
    await click(page.getByRole('searchbox',{name:'Search',exact:true}),isMobile);
    await expect(more(page)).toHaveAttribute('aria-expanded','false');
    await click(more(page),isMobile);
    await click(page.getByAltText('Help',{exact:true}),isMobile);
    await expect(more(page)).toHaveAttribute('aria-expanded','false');
    await click(page.getByRole('button',{name:'Close help',exact:true}),isMobile);
    await expect(more(page)).toBeFocused();
    await page.setViewportSize({width:1440,height:900});await ready(page);
    await expect(more(page)).toBeHidden();
    await expect(page.getByRole('button',{name:'Table',exact:true})).toBeVisible();
    await expect(page.getByLabel('Auto scale',{exact:true})).toBeVisible();
});
