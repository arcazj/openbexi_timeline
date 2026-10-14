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
    await page.locator('.ob_filter_build_section > summary').click();
    await page.getByRole('textbox',{name:'New filter name',exact:true}).fill(name);
    await page.getByRole('textbox',{name:'New filter expression',exact:true}).fill('|system:RNG+status:FINISHED');
    await page.getByRole('combobox',{name:'Group by (sort_by)',exact:true}).selectOption('namespace');
    await page.getByRole('button',{name:'Save filter',exact:true}).click();
    const radio=page.getByRole('radio',{name,exact:true});
    await expect.poll(()=>ids(page)).toEqual(['other','warning']);await expect(radio).toBeChecked();
    await page.getByRole('button',{name:'Remove Filter: '+name,exact:true}).click();
    await expect.poll(()=>ids(page)).toEqual(['finished','other','warning']);await expect(radio).not.toBeChecked();
    await radio.check();await expect.poll(()=>ids(page)).toEqual(['other','warning']);
    await page.locator('.ob_filter_build_section > summary').click();
    await page.getByRole('combobox',{name:'Filter field',exact:true}).selectOption('status');
    await page.getByRole('textbox',{name:'Filter value',exact:true}).fill('FINISHED');
    await page.getByRole('textbox',{name:'New filter name',exact:true}).fill('Finished');
    await page.getByRole('button',{name:'Save filter',exact:true}).click();
    await expect.poll(()=>ids(page)).toEqual(['finished','other']);await expect(radio).not.toBeChecked();
    await radio.check();await expect.poll(()=>ids(page)).toEqual(['other','warning']);
    await page.getByRole('button',{name:'Remove Group: namespace',exact:true}).click();await ready(page);
    await expect(radio).not.toBeChecked();await radio.check();await ready(page);
    await expect(page.getByRole('combobox',{name:'Sort by',exact:true})).toHaveValue('namespace');
    await expect(radio).toBeChecked();expect(errors).toEqual([]);
});

test('Expanding the phone builder shows one draft with bottom Save and Cancel actions',async({page},info)=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto('/demos.html?demo=default-dataset');await ready(page);await openFilters(page);
    const panel=page.locator('.ob_viewport_side');
    await expect(panel.locator('.ob_filter_namespaces')).toBeVisible();
    await expect(panel.locator('.ob_filter_build_section')).not.toHaveAttribute('open','');
    await expect(panel.locator('.ob_saved_filters > legend')).toHaveText('List of saved filters');
    await expect(panel.locator('.ob_panel_heading').getByRole('button',{name:'Add a new filter',exact:true})).toHaveCount(0);
    await expect(panel.locator('.ob_new_filter')).toBeHidden();
    await panel.locator('.ob_filter_build_section > summary').click();
    await expect(panel.locator('.ob_filter_build_section')).toHaveAttribute('open','');
    await expect(panel.locator('.ob_filter_build_section .ob_new_filter')).toBeVisible();
    await expect(panel.locator('.ob_filter_advanced')).toHaveAttribute('open','');
    const editor=page.getByRole('textbox',{name:'New filter expression',exact:true});
    await expect(editor).toBeVisible();
    const layout=await panel.evaluate(node=>{
        const section=node.querySelector('.ob_new_filter'),text=section.querySelector('textarea'),label=section.querySelector('label'),input=section.querySelector('input');
        const bounds=section.getBoundingClientRect(),field=text.getBoundingClientRect(),name=input.getBoundingClientRect(),caption=label.getBoundingClientRect();
        return {ratio:field.width/bounds.width,label:caption.right,input:name.left,overflow:node.scrollWidth-node.clientWidth,text:label.textContent};
    });
    expect(layout.ratio).toBeGreaterThan(.95);expect(layout.ratio).toBeLessThanOrEqual(1);
    expect(layout.label).toBeLessThan(layout.input);expect(layout.text).toBe('Filter name');expect(layout.overflow).toBeLessThanOrEqual(1);
    await page.screenshot({path:info.outputPath('phone-filter-editor.png')});
    await page.getByRole('textbox',{name:'New filter name',exact:true}).fill('Phone warnings');
    await editor.fill('expr: status = "WARNING"');
    await page.getByRole('button',{name:'Save filter',exact:true}).click();
    await expect.poll(()=>ids(page)).toEqual(['warning']);
    await expect(panel.locator('.ob_filter_build_section')).not.toHaveAttribute('open','');
    await expect(page.getByRole('button',{name:'Retry filters',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Filter syntax',exact:true})).toHaveCount(0);
});


test('Create and clone drafts save supported filters, protect originals and cancel without requests',async({page},info)=>{
    const requests=[];page.on('request',request=>{if(request.url().includes('/json/test-data/'))requests.push(request.url());});
    await page.goto('/demos.html?demo=default-dataset');await ready(page);await openFilters(page);
    const build=page.locator('.ob_filter_build_section');await build.locator('summary').first().click();
    await expect(build.getByLabel('New filter name',{exact:true})).toBeVisible();
    expect(await build.getByLabel('Namespace',{exact:true}).locator('option:not([hidden])').allTextContents()).toEqual(['operations','planning']);
    const choices=await build.getByLabel('Group by (sort_by)',{exact:true}).locator('option').allTextContents();
    expect(choices).toContain('title');expect(choices).toContain('status');
    await build.getByLabel('Namespace',{exact:true}).selectOption('operations');
    await build.getByLabel('Group by (sort_by)',{exact:true}).selectOption('status');
    await build.getByLabel('Filter field',{exact:true}).selectOption('status');
    await build.getByLabel('Filter value',{exact:true}).fill('WARNING');
    await expect(build.getByLabel('New filter expression',{exact:true})).toHaveValue('expr: namespace = "operations" AND (status = "WARNING")');
    expect(await ids(page)).toEqual(['finished','other','warning']);
    await build.getByLabel('New filter name',{exact:true}).fill('Warnings');
    const actions=build.locator('.ob_filter_draft_actions');
    await expect(actions.getByRole('button',{name:'Save filter',exact:true})).toHaveCount(1);
    await expect(build.locator('.ob_filter_advanced button')).toHaveCount(0);
    await actions.getByRole('button',{name:'Save filter',exact:true}).click();await expect.poll(()=>ids(page)).toEqual(['warning']);
    await build.locator('summary').first().click();
    await build.getByLabel('Clone existing filter',{exact:true}).selectOption('Warnings');
    await expect(build.getByLabel('Namespace',{exact:true})).toHaveValue('operations');
    await expect(build.getByLabel('Group by (sort_by)',{exact:true})).toHaveValue('status');
    await build.getByLabel('New filter name',{exact:true}).fill('Warnings');
    await actions.getByRole('button',{name:'Save filter',exact:true}).click();
    await expect(build.locator('[data-filter-error]')).toContainText('already exists');
    await build.getByLabel('New filter name',{exact:true}).fill('Copied warnings');
    await actions.getByRole('button',{name:'Save filter',exact:true}).click();await ready(page);
    await expect(page.getByRole('radio',{name:'Copied_warnings',exact:true})).toBeChecked();
    await expect(page.getByRole('radio',{name:'Warnings',exact:true})).not.toBeChecked();
    await build.locator('summary').first().click();
    await build.getByLabel('Clone existing filter',{exact:true}).selectOption('Warnings');
    await build.getByLabel('New filter name',{exact:true}).fill('Unsaved');
    await actions.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(build).not.toHaveAttribute('open','');
    await expect(page.getByRole('radio',{name:'Unsaved',exact:true})).toHaveCount(0);
    await expect(page.getByRole('radio',{name:'Copied_warnings',exact:true})).toBeChecked();
    expect(requests).toHaveLength(1);
    await build.locator('summary').first().click();await build.getByLabel('Clone existing filter',{exact:true}).selectOption('Warnings');
    await page.screenshot({path:info.outputPath('create-clone-filter.png')});
    expect(await page.locator('.ob_filter_panel').evaluate(panel=>panel.scrollWidth<=panel.clientWidth+1)).toBe(true);
});
