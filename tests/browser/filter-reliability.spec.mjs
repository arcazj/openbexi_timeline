import {test,expect} from '@playwright/test';

const name='NAMESPACE_Exclude_Nominal_RNG';
const records=[
    {id:'finished',namespace:'operations',start:'2026-09-12T12:00:00Z',data:{title:'Nominal ranging',system:'RNG',status:'FINISHED'}},
    {id:'warning',namespace:'operations',start:'2026-09-12T12:05:00Z',data:{title:'Ranging warning',system:'RNG',status:'WARNING'}},
    {id:'other',namespace:'planning',start:'2026-09-12T12:10:00Z',data:{title:'Planning completed',system:'PLAN',status:'FINISHED'}}
];
async function ready(page) {
    await expect(page.locator('#demo-status')).toHaveAttribute('data-state','ready');
    await page.waitForFunction(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return t.ob_results.snapshot && !t.ob_results.pending && !t.ob_results.loading;});
}
async function ids(page) {
    await ready(page);
    return page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return t.ob_results.snapshot.entries.map(entry=>entry.record.id).sort();});
}
async function openFilters(page) {
    const more=page.getByRole('button',{name:'More',exact:true});
    if(await more.isVisible())await more.click();
    await page.getByAltText('Sorting and filtering',{exact:true}).click();
}
test.beforeEach(async({page})=>{
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    await page.route('**/json/test-data/default-dataset.json',route=>route.fulfill({json:{records}}));
});

test('Saved exclusion radios can be reapplied after chips, builder criteria and grouping change',async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);await openFilters(page);
    await page.getByRole('button',{name:'Add a new filter',exact:true}).click();
    await page.getByRole('textbox',{name:'New filter name',exact:true}).fill(name);
    await page.getByRole('textbox',{name:'New filter expression',exact:true}).fill('|system:RNG+status:FINISHED');
    await page.getByRole('combobox',{name:'Sort by',exact:true}).selectOption('namespace');
    await page.getByRole('button',{name:'Save new filter',exact:true}).click();
    const radio=page.getByRole('radio',{name,exact:true});
    await expect.poll(()=>ids(page)).toEqual(['other','warning']);await expect(radio).toBeChecked();
    await page.getByRole('button',{name:'Remove Filter: '+name,exact:true}).click();
    await expect.poll(()=>ids(page)).toEqual(['finished','other','warning']);await expect(radio).not.toBeChecked();
    await radio.check();await expect.poll(()=>ids(page)).toEqual(['other','warning']);
    await page.getByRole('combobox',{name:'Filter field',exact:true}).selectOption('status');
    await page.getByRole('textbox',{name:'Filter value',exact:true}).fill('FINISHED');
    await page.getByRole('button',{name:'Apply filter',exact:true}).click();
    await expect.poll(()=>ids(page)).toEqual(['finished','other']);await expect(radio).not.toBeChecked();
    await radio.check();await expect.poll(()=>ids(page)).toEqual(['other','warning']);
    await page.getByRole('button',{name:'Remove Group: namespace',exact:true}).click();await ready(page);
    await expect(radio).not.toBeChecked();await radio.check();await ready(page);
    await expect(page.getByRole('combobox',{name:'Sort by',exact:true})).toHaveValue('namespace');
    await expect(radio).toBeChecked();expect(errors).toEqual([]);
});

test('New filter editor is first, expanded and labeled without overflowing a phone panel',async({page},info)=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto('/demos.html?demo=default-dataset');await ready(page);await openFilters(page);
    const panel=page.locator('.ob_viewport_side');
    await expect(panel.locator('fieldset').first()).toHaveClass('ob_new_filter');
    await page.getByRole('button',{name:'Add a new filter',exact:true}).click();
    await expect(panel.locator('.ob_filter_advanced')).toHaveAttribute('open','');
    const editor=page.getByRole('textbox',{name:'New filter expression',exact:true});
    await expect(editor).toBeVisible();
    const layout=await panel.evaluate(node=>{
        const section=node.querySelector('.ob_new_filter'),text=section.querySelector('textarea'),label=section.querySelector('label'),input=section.querySelector('input');
        const bounds=section.getBoundingClientRect(),field=text.getBoundingClientRect(),name=input.getBoundingClientRect(),caption=label.getBoundingClientRect();
        return {ratio:field.width/bounds.width,label:caption.right,input:name.left,overflow:node.scrollWidth-node.clientWidth,text:label.textContent};
    });
    expect(layout.ratio).toBeGreaterThan(.88);expect(layout.ratio).toBeLessThan(.92);
    expect(layout.label).toBeLessThan(layout.input);expect(layout.text).toBe('Filter name');expect(layout.overflow).toBeLessThanOrEqual(1);
    await page.screenshot({path:info.outputPath('phone-filter-editor.png')});
    await page.getByRole('textbox',{name:'New filter name',exact:true}).fill('Phone warnings');
    await editor.fill('expr: status = "WARNING"');
    await page.getByRole('button',{name:'Save new filter',exact:true}).click();
    await expect.poll(()=>ids(page)).toEqual(['warning']);
});
