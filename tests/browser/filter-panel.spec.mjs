import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

async function ready(page) {
    await page.waitForFunction(async()=>!(await(await import('/src/openbexi_demo.js')).demoReady).ob_results.pending);
}

test('Compact saved filters expose copyable expressions and support inline edit, cancel, save and delete',async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);
    const expression='expr: NOT title CONTAINS "A+B | 25% (planned)"';
    await page.evaluate(async expression=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        t.ob_filters=[{name:'ALL',filter_value:'',sortBy:'NONE',current:'yes'},
            {name:'Operations',filter_value:expression,sortBy:'namespace',current:'no'},
            {name:'Warnings',filter_value:'expr: status = "warning"',sortBy:'NONE',current:'no'},
            {name:'Upcoming_sessions',filter_value:'expr: EXISTS(title) AND NOT status = "cancelled"',sortBy:'namespace',current:'no'}];
    },expression);
    await page.getByAltText('Sorting and filtering',{exact:true}).click();
    const panel=page.locator('.ob_filter_panel'),row=panel.locator('.ob_saved_filter').filter({has:page.getByRole('radio',{name:'Operations',exact:true})});
    if(info.project.name==='desktop') {
        await page.getByRole('separator',{name:'Resize Data panel'}).focus();await page.keyboard.press('End');await ready(page);
    }
    const input=row.locator('textarea');
    await expect(input).toHaveValue(expression);await expect(input).toHaveJSProperty('readOnly',true);await expect(input).toBeEnabled();
    expect(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    const edit=await row.getByRole('button',{name:'Edit',exact:true}).boundingBox(),field=await input.boundingBox();
    if(info.project.name==='desktop')expect(Math.abs(edit.y+edit.height/2-field.y-field.height/2)).toBeLessThan(3);
    else expect(field.y).toBeGreaterThanOrEqual(edit.y+edit.height);
    if(process.env.FILTER_CAPTURE_DIR) {
        await fs.mkdir(process.env.FILTER_CAPTURE_DIR,{recursive:true});
        await panel.screenshot({path:path.join(process.env.FILTER_CAPTURE_DIR,`filters-${info.project.name}.png`)});
    }
    await page.evaluate(()=>{document.documentElement.dataset.obTheme='contrast';});
    expect(await panel.evaluate(element=>getComputedStyle(element).getPropertyValue('--filter-border').trim())).toBe('#526c80');
    await input.focus();expect(await input.evaluate(element=>getComputedStyle(element).outlineWidth)).toBe('3px');
    await page.evaluate(()=>{document.documentElement.dataset.obTheme='default';});
    await row.getByRole('button',{name:'Edit',exact:true}).click();await expect(input).toBeFocused();await expect(input).toBeEditable();
    await input.fill('expr: title CONTAINS '+JSON.stringify('Long expression + | (25%) '.repeat(70)));
    expect(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    expect((await input.boundingBox()).height).toBeLessThanOrEqual(140);
    await input.fill('expr: priority >');await row.getByRole('button',{name:'Save',exact:true}).click();
    await expect(row.locator('[data-filter-error]')).toBeVisible();await expect(input).toHaveValue('expr: priority >');
    await input.focus();await page.keyboard.press('Escape');await expect(input).toHaveValue(expression);await expect(input).toHaveJSProperty('readOnly',true);
    await row.getByRole('button',{name:'Edit',exact:true}).click();await input.fill('expr: EXISTS(title)');
    await row.getByRole('button',{name:'Save',exact:true}).click();await ready(page);
    await expect(input).toHaveValue('expr: EXISTS(title)');await expect(input).toHaveJSProperty('readOnly',true);
    await expect(row.getByRole('radio')).toBeChecked();
    await page.reload();await ready(page);await page.getByAltText('Sorting and filtering',{exact:true}).click();
    await expect(input).toHaveValue('expr: EXISTS(title)');await expect(row.getByRole('radio')).toBeChecked();
    await row.getByRole('button',{name:'Delete',exact:true}).click();await ready(page);await expect(row).toHaveCount(0);
    expect(errors).toEqual([]);
});
