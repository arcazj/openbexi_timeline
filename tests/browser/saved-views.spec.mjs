import {test, expect} from '@playwright/test';

const ready = async page => {
    await expect(page.locator('#demo-status')).toHaveAttribute('data-state', 'ready');
    await page.waitForFunction(async () => {
        const t = await (await import('/src/openbexi_demo.js')).demoReady;
        return !t.ob_results.pending && !t.ob_results.fetching &&
            t.ob_viewport.headerHeight === t.ob_timeline_header.offsetHeight;
    });
};

async function openShare(page) {
    const more = page.getByRole('button', {name:'More', exact:true});
    if (await more.isVisible() && await more.getAttribute('aria-expanded') === 'false') await more.click();
    await page.getByRole('button', {name:'Help', exact:true}).click();
    await page.getByRole('tab', {name:'Share', exact:true}).click();
    await ready(page);
    // Refresh after the side panel has reached its final width.
    await page.getByRole('tab', {name:'Share', exact:true}).click();
}

async function configureView(page) {
    return page.evaluate(async () => {
        const t = await (await import('/src/openbexi_demo.js')).demoReady;
        const {applyTimelineShareState} = await import('/src/openbexi_timeline_share.js');
        applyTimelineShareState(t, new URLSearchParams({from:'1870-01-01T00:00:00.000Z', to:'1900-01-01T00:00:00.000Z',
            filter:'expr: EXISTS(title)', filterName:'Titled records', group:'namespace', search:'',
            view:'split', auto:'0', locked:'1', results:'highlight', highlight:'1', ratio:'8'}));
        const record = t.ob_results.snapshot.entries.find(entry => Date.parse(entry.record.start) >= Date.parse('1870-01-01') &&
            Date.parse(entry.record.start) <= Date.parse('1900-01-01'));
        if (!record) throw new Error('Fixture needs a selected record within the saved range.');
        t.ob_results.selectActivity(record.key);
        t.ob_views.restorePresentation({sort:{field:'start', direction:'descending'}, columns:{description:true, source:false}});
        t.ob_results.commit();
        return record.key;
    });
}

const presentation = page => page.evaluate(async () => {
    const t = await (await import('/src/openbexi_demo.js')).demoReady;
    const {captureTimelineViewState} = await import('/src/openbexi_timeline_share.js');
    return captureTimelineViewState(t);
});

test('Share links reload the exact range, selection, filters, grouping and table presentation', async ({page}) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/demos.html?demo=monet'); await ready(page);
    const selected = await configureView(page); await ready(page);
    await openShare(page);
    const link = await page.getByRole('textbox', {name:'Link to this view', exact:true}).inputValue();
    const expected = Object.fromEntries(new URL(link).searchParams);
    expect(expected.selected).toBe(selected);
    await page.goto(link); await ready(page);
    const actual = await presentation(page);
    expect(Math.abs(Date.parse(actual.from) - Date.parse(expected.from))).toBeLessThanOrEqual(1);
    expect(Math.abs(Date.parse(actual.to) - Date.parse(expected.to))).toBeLessThanOrEqual(1);
    for (const key of ['selected', 'filter', 'filterName', 'group', 'view', 'search', 'results', 'highlight', 'auto', 'locked'])
        expect(actual[key], key).toBe(expected[key]);
    expect(JSON.parse(actual.table)).toEqual(JSON.parse(expected.table));
    await expect(page.getByRole('region', {name:'Timeline event table', exact:true})).toBeVisible();
    await expect(page.locator('.ob_event_table th[aria-sort="descending"]')).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('Named views save with Enter and reopen from browser storage through Share', async ({page}) => {
    await page.goto('/demos.html?demo=monet'); await ready(page);
    await configureView(page); await ready(page); await openShare(page);
    const name = page.getByRole('textbox', {name:'Saved view name', exact:true});
    await name.fill('Monet review'); await name.press('Enter');
    await expect(page.locator('.ob_saved_views [role="status"]')).toHaveText('Saved "Monet review" in this browser.');
    const expected = await presentation(page);
    await page.goto('/demos.html?demo=monet'); await ready(page); await openShare(page);
    await page.getByRole('combobox', {name:'Saved views', exact:true}).selectOption('Monet review');
    await page.getByRole('button', {name:'Open saved view', exact:true}).click(); await ready(page);
    const actual = await presentation(page);
    for (const key of ['selected', 'filter', 'group', 'view', 'table']) expect(actual[key], key).toBe(expected[key]);
    expect(Math.abs(Date.parse(actual.from) - Date.parse(expected.from))).toBeLessThanOrEqual(1);
    expect(Math.abs(Date.parse(actual.to) - Date.parse(expected.to))).toBeLessThanOrEqual(1);
    await expect(page.locator('.ob_saved_views [role="status"]')).toHaveText('Opened "Monet review".');
    await page.getByRole('button', {name:'Delete saved view', exact:true}).click();
    await expect(page.getByRole('button', {name:'Open saved view', exact:true})).toBeDisabled();
});
