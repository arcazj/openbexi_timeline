import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';

const base=Date.parse('2026-09-12T12:00:00Z');
const records=Array.from({length:64},(_,index)=>{
    const number=64-index,start=base+number*60000;
    return {id:'event-'+number,start:new Date(start).toISOString(),end:new Date(start+5400000).toISOString(),namespace:'Operations',
        data:{title:number===64?'=1+1':number===63?'A "quote", then\na new line':'Inspection '+number,
            status:number>10?'warning':'nominal',description:'<b>Inspection report</b>',custom:'Additional metadata '+number}};
});
async function ready(page) {
    await expect(page.locator('#demo-status')).toHaveAttribute('data-state','ready');
    await expect.poll(()=>page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return !t.ob_results.pending && !t.ob_results.resizeQueued && !t.ob_results.focusAnimation &&
            t.ob_viewport.headerHeight===t.ob_timeline_header.offsetHeight;
    })).toBe(true);
}
async function setup(page) {
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/json/test-data/default-dataset.json',route=>route.fulfill({json:{records}}));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    return errors;
}
async function showMore(page) {
    const more=page.getByRole('button',{name:'More',exact:true});
    if(await more.isVisible() && await more.getAttribute('aria-expanded')==='false')await more.click();
}
async function table(page) {
    await showMore(page);await page.getByRole('button',{name:'Table',exact:true}).click();await ready(page);
    // A compact menu can remain open while its view buttons are used.
    const more=page.getByRole('button',{name:'More',exact:true});
    if(await more.isVisible() && await more.getAttribute('aria-expanded')==='true')await page.keyboard.press('Escape');
    const panel=page.getByRole('region',{name:'Timeline event table',exact:true});await expect(panel).toBeVisible();return panel;
}
async function exportCSV(page,panel) {
    const received=page.waitForEvent('download');await panel.getByRole('button',{name:/^Export CSV/}).click();
    const download=await received;
    expect(download.suggestedFilename()).toMatch(/-events\.csv$/);
    const csv=await fs.readFile(await download.path(),'utf8');
    // Parse the downloaded artifact, including quoted commas, newlines and quotes.
    const rows=[];let row=[],cell='',quoted=false;
    for(let index=0;index<csv.length;index++) {
        const character=csv[index];
        if(index===0 && character==='\uFEFF')continue;
        if(character==='"') {
            if(quoted && csv[index+1]==='"'){cell+='"';index++;}else quoted=!quoted;
        } else if(character===',' && !quoted){row.push(cell);cell='';}
        else if(character==='\n' && !quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
        else cell+=character;
    }
    return rows;
}

test('Sort, choose columns and download every filtered table page through user controls',async({page})=>{
    const errors=await setup(page);
    await showMore(page);await page.getByRole('button',{name:'Filters',exact:true}).click();
    await page.getByLabel('Filter field',{exact:true}).selectOption('status');
    await page.getByLabel('Filter operator',{exact:true}).selectOption('=');
    await page.getByLabel('Filter value',{exact:true}).fill('warning');
    await page.getByRole('button',{name:'Apply filter',exact:true}).click();await ready(page);
    await page.locator('.ob_panel_heading').getByRole('button',{name:'Close',exact:true}).click();await ready(page);
    const panel=await table(page);
    await panel.locator('.ob_table_columns > summary').click();
    await panel.getByRole('checkbox',{name:'ID',exact:true}).check();
    for(const name of ['End','Source','Status'])await panel.getByRole('checkbox',{name,exact:true}).uncheck();
    await page.keyboard.press('Escape');
    await expect(panel.locator('.ob_table_columns > summary')).toBeFocused();
    await expect(panel.locator('th .ob_table_sort_label')).toHaveText(['Title','Start','ID']);
    const start=panel.getByRole('button',{name:'Start',exact:true});
    await expect(start.locator('.ob_table_sort_icon')).toBeVisible();
    await expect(start.locator('.ob_table_sort_icon')).toHaveText('\u2195');
    await start.focus();await start.locator('.ob_table_sort_icon').click();
    await expect(start).toBeFocused();await expect(start.locator('..')).toHaveAttribute('aria-sort','ascending');
    await expect(start.locator('.ob_table_sort_icon')).toHaveText('\u2191');
    await expect(panel.locator('tbody tr').first()).toContainText('event-11');
    expect(await panel.locator('tbody tr').count()).toBeLessThan(54);
    await panel.getByRole('button',{name:'Next',exact:true}).click();
    await expect(panel.locator('caption')).not.toContainText('Showing 1\u2013');
    await start.click();await expect(start.locator('..')).toHaveAttribute('aria-sort','descending');
    await expect(start.locator('.ob_table_sort_icon')).toHaveText('\u2193');
    await expect(panel.locator('tbody tr').first()).toContainText('event-64');
    await start.focus();await page.keyboard.press('Enter');
    const exported=await exportCSV(page,panel);
    expect(exported[0]).toEqual(['Title','Start','ID']);expect(exported).toHaveLength(55);
    expect(exported.slice(1).map(row=>row[2])).toEqual(Array.from({length:54},(_,index)=>'event-'+(index+11)));
    expect(exported.at(-1)[0]).toBe("'=1+1");expect(exported.at(-2)[0]).toBe('A "quote", then\na new line');
    await expect(panel.locator('.ob_table_export_status')).toHaveText('Exported 54 records in the current table.');
    expect(errors).toEqual([]);
});

test('Phone table controls and compact details preserve metadata and copy original values',async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedTimelineValue=value;}}}));
    const errors=await setup(page),panel=await table(page);
    for(const control of [panel.locator('.ob_table_columns > summary'),panel.getByRole('button',{name:'Export CSV',exact:true})])
        await expect(control).toBeInViewport({ratio:1});
    expect(await panel.locator('.ob_table_tools').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    await panel.locator('.ob_table_columns > summary').click();
    await panel.getByRole('checkbox',{name:'ID',exact:true}).check();
    await page.keyboard.press('Escape');
    const record=panel.locator('.ob_table_record').first();await record.focus();await page.keyboard.press('Enter');await ready(page);
    const details=page.locator('.ob_record_details'),summary=details.locator('.ob_descriptor_summary');
    await expect(details).toBeVisible();await expect(details.locator('h2')).toHaveText('=1+1');
    await expect(summary).toContainText('1 hour 30 minutes');await expect(summary).toContainText('Operations');
    await expect(summary).toContainText('warning');
    await expect(details.locator('.ob_descriptor_fields')).not.toHaveAttribute('open','');
    await summary.getByRole('button',{name:'Copy Start',exact:true}).click();
    await expect(details.locator('.ob_descriptor_copy_status')).toHaveText('Start copied.');
    expect(await page.evaluate(()=>window.copiedTimelineValue)).toBe(records[0].start);
    await summary.getByRole('button',{name:'Copy ID',exact:true}).click();
    expect(await page.evaluate(()=>window.copiedTimelineValue)).toBe('event-64');
    await details.getByText('All fields',{exact:true}).click();
    await expect(details.locator('.ob_descriptor_fields')).toHaveAttribute('open','');
    await expect(details.locator('.ob_descriptor_fields')).toContainText('Additional metadata 64');
    expect(await page.locator('.ob_viewport_side').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
});

test('Clipboard denial exposes a keyboard-selectable fallback and partial tables label downloaded scope',async({page})=>{
    await page.addInitScript(()=>{
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new DOMException('Denied','NotAllowedError');}}});
        document.execCommand=()=>false;
    });
    const errors=await setup(page),panel=await table(page);
    await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        t.ob_results.complete=false;t.ob_views.renderTable();
    });
    await expect(panel.getByRole('button',{name:'Export CSV (loaded records)',exact:true})).toBeVisible();
    await expect(panel.locator('.ob_table_export_status')).toContainText('Coverage incomplete; loaded records only.');
    expect(await exportCSV(page,panel)).toHaveLength(65);
    await expect(panel.locator('.ob_table_export_status')).toContainText('from loaded data; coverage is incomplete.');
    await panel.locator('.ob_table_record').first().click();await ready(page);
    const details=page.locator('.ob_record_details');
    await details.locator('.ob_descriptor_summary').getByRole('button',{name:'Copy ID',exact:true}).click();
    const fallback=details.getByRole('textbox',{name:'ID to copy',exact:true});
    await expect(fallback).toHaveValue('event-64');await expect(fallback).toBeFocused();
    expect(await fallback.evaluate(node=>node.selectionStart===0 && node.selectionEnd===node.value.length)).toBe(true);
    await expect(details.locator('.ob_descriptor_copy_status')).toContainText('Select and copy the ID below.');
    expect(errors).toEqual([]);
});

test('Table tools and detail copy controls follow the high contrast theme',async({page})=>{
    await page.addInitScript(()=>localStorage.setItem('openbexi-timeline:appearance:v1','contrast'));
    const errors=await setup(page),panel=await table(page);
    await expect(panel.locator('.ob_table_tools')).toHaveCSS('color','rgb(0, 0, 0)');
    await expect(panel.locator('.ob_table_tools')).toHaveCSS('background-color','rgb(255, 255, 255)');
    const exportButton=panel.getByRole('button',{name:'Export CSV',exact:true});
    await expect(exportButton).toHaveCSS('border-top-color','rgb(0, 0, 0)');
    await expect(exportButton).toHaveCSS('border-top-width','2px');
    await page.keyboard.press('Tab');await exportButton.focus();await expect(exportButton).toHaveCSS('outline-width','3px');
    await panel.locator('.ob_table_record').first().click();await ready(page);
    const copy=page.locator('.ob_descriptor_summary').getByRole('button',{name:'Copy ID',exact:true});
    await expect(copy).toHaveCSS('color','rgb(0, 0, 0)');await expect(copy).toHaveCSS('background-color','rgb(255, 255, 255)');
    await expect(copy).toHaveCSS('border-top-color','rgb(0, 0, 0)');await expect(copy).toHaveCSS('border-top-width','2px');
    expect(errors).toEqual([]);
});
