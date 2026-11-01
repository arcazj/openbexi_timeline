import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const record=(id,namespace,system,status,hostname)=>({id,namespace,start:'2026-09-12T12:00:00Z',end:'2026-09-12T13:00:00Z',
    data:{title:id,system,status,hostname}});
const events=[record('rng-running','DEMO_ALPHA','RNG','RUNNING','ranging-active'),record('rng-finished','DEMO_ALPHA','RNG','FINISHED','ranging-done'),
    record('cmd-running','DEMO_ALPHA','CMD','RUNNING','command-active'),record('cmd-finished','DEMO_ALPHA','CMD','FINISHED','command-done'),
    {id:'lab-east',namespace:'LAB',start:'2026-09-12T12:20:00Z',data:{title:'Lab east',region:'East',severity:2}},
    ...Array.from({length:32},(_,index)=>record('station-'+index,'DEMO_ALPHA','CMD','RUNNING','station-'+String(index).padStart(2,'0')))];

async function ready(page) {
    await page.waitForFunction(()=>{
        const t=window.get_ob_timeline?.('ob_timeline_2');return t?.ob_results?.snapshot&&!t.ob_results.pending;
    });
}
async function setup(page,records=events) {
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const model=JSON.parse(await fs.readFile('HBDS/templates/models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{date:'2026-09-12T12:30:00Z',data:'/__checkboxes.json',showCurrentTime:false});
    await page.route('**/HBDS/templates/models/regular_timeline_earthquake.json',route=>route.fulfill({json:model}));
    await page.route('**/__checkboxes.json',route=>route.fulfill({json:{events:records}}));
    await page.goto('/openbexi_timeline_earthquake.html');await ready(page);
    await page.getByAltText('Sorting and filtering',{exact:true}).click();
    return {errors,panel:page.locator('.ob_filter_panel')};
}
async function openItems(builder,mode,namespace) {
    const group=builder.locator(`[data-filter-section=${mode}]`);
    if(await group.getAttribute('open')===null)await group.locator(':scope > summary').click();
    const details=group.locator(`[data-filter-item-namespace="${namespace}"]`);
    if(await details.getAttribute('open')===null)await details.locator(':scope > summary').click();
    return details;
}

test('Namespace visibility and the DEMO_ALPHA include/exclude examples use exact values and save only on request',async({page})=>{
    const {panel,errors}=await setup(page);
    await panel.getByRole('checkbox',{name:'Show namespace LAB',exact:true}).uncheck();await ready(page);
    expect(await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_results.snapshot.entries.some(entry=>entry.record.namespace==='LAB'))).toBe(false);
    await panel.getByRole('checkbox',{name:'Show namespace LAB',exact:true}).check();await ready(page);
    expect(await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_results.snapshot.entries.some(entry=>entry.record.namespace==='LAB'))).toBe(true);
    await panel.locator('.ob_filter_build_section > summary').click();
    const builder=panel.locator('.ob_new_filter');
    for(const section of ['namespaces','include','exclude'])await expect(builder.locator(`[data-filter-section=${section}]`)).not.toHaveAttribute('open','');
    await expect(builder.getByRole('combobox',{name:'Filter field',exact:true})).toHaveCount(0);
    await builder.locator('[data-filter-section=namespaces] > summary').click();
    await builder.getByRole('checkbox',{name:'Include namespace LAB',exact:true}).uncheck();
    await builder.locator('[data-filter-section=exclude] > summary').click();
    await openItems(builder,'exclude','DEMO_ALPHA');
    const excludedRng=builder.getByRole('checkbox',{name:'Exclude DEMO_ALPHA system: RNG',exact:true});
    await excludedRng.check();
    const expression=builder.getByRole('textbox',{name:'New filter expression',exact:true});
    await expect(expression).toHaveValue(/\|.*system IN \("RNG"\)/);
    expect(await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_results.snapshot.entries.length)).toBe(events.length);
    await builder.getByRole('textbox',{name:'New filter name',exact:true}).fill('Without_ranging');
    await builder.getByRole('button',{name:'Save filter',exact:true}).click();await ready(page);
    expect(await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_results.snapshot.entries.every(entry=>entry.record.data.system==='CMD'))).toBe(true);
    await panel.locator('.ob_filter_build_section > summary').click();
    await builder.getByRole('combobox',{name:'Clone existing filter',exact:true}).selectOption('Without_ranging');
    await builder.locator('[data-filter-section=exclude] > summary').click();
    await openItems(builder,'exclude','DEMO_ALPHA');
    await builder.getByRole('checkbox',{name:'Exclude DEMO_ALPHA system: RNG',exact:true}).uncheck();
    await builder.getByRole('checkbox',{name:'Exclude DEMO_ALPHA status: FINISHED',exact:true}).check();
    await builder.locator('[data-filter-section=include] > summary').click();
    await openItems(builder,'include','DEMO_ALPHA');
    await builder.getByRole('checkbox',{name:'Include DEMO_ALPHA system: RNG',exact:true}).check();
    await expect(expression).toHaveValue(/system IN \("RNG"\).*\|.*status IN \("FINISHED"\)/);
    await builder.getByRole('textbox',{name:'New filter name',exact:true}).fill('Active_ranging');
    await builder.getByRole('button',{name:'Save filter',exact:true}).click();await ready(page);
    expect(await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_results.snapshot.entries.map(entry=>entry.record.id))).toEqual(['rng-running']);
    expect(errors).toEqual([]);
});

test('Dynamic categories paginate within three rows, retain checks, and fit a compact responsive panel',async({page},info)=>{
    const {panel,errors}=await setup(page);
    await panel.locator('.ob_filter_build_section > summary').click();
    const builder=panel.locator('.ob_new_filter');
    await builder.locator('[data-filter-section=include] > summary').click();
    await openItems(builder,'include','DEMO_ALPHA');
    const category=builder.locator('[data-filter-section=include] [data-filter-owner=DEMO_ALPHA][data-filter-attribute=hostname]');
    await category.scrollIntoViewIfNeeded();
    const choices=category.getByRole('checkbox');
    const first=await choices.first().getAttribute('aria-label');await choices.first().check();
    const rows=await category.locator('.ob_filter_value_grid label').evaluateAll(labels=>new Set(labels.map(label=>Math.round(label.getBoundingClientRect().top))).size);
    expect(rows).toBeLessThanOrEqual(3);
    await category.getByRole('button',{name:'Next values page',exact:true}).click();
    const second=await choices.first().getAttribute('aria-label');await choices.first().check();
    await category.getByRole('button',{name:'Previous values page',exact:true}).click();
    await expect(category.getByRole('checkbox',{name:first,exact:true})).toBeChecked();
    await category.getByRole('button',{name:'Next values page',exact:true}).click();
    await expect(category.getByRole('checkbox',{name:second,exact:true})).toBeChecked();
    await openItems(builder,'exclude','LAB');await openItems(builder,'include','DEMO_ALPHA');
    await expect(category.locator('[aria-current=page]')).toHaveText('2');
    await expect(category.getByRole('checkbox',{name:second,exact:true})).toBeChecked();
    await category.getByRole('searchbox').fill('station-31');
    await expect(choices).toHaveCount(1);await expect(choices).toHaveAttribute('aria-label','Include DEMO_ALPHA hostname: station-31');
    await expect(category.locator('nav')).toBeHidden();
    expect(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    const lab=await openItems(builder,'exclude','LAB');
    await expect(lab.locator('[data-filter-attribute=region]')).toBeAttached();
    await expect(builder.locator('[data-filter-item-namespace][open]')).toHaveCount(1);
    await openItems(builder,'include','DEMO_ALPHA');
    await expect(category.getByRole('searchbox')).toHaveValue('station-31');
    await category.getByRole('searchbox').fill('');
    await expect(category.getByRole('checkbox',{name:first,exact:true})).toBeChecked();
    await category.getByRole('button',{name:'Next values page',exact:true}).click();
    await expect(category.getByRole('checkbox',{name:second,exact:true})).toBeChecked();
    if(process.env.FILTER_CAPTURE_DIR) {
        await fs.mkdir(process.env.FILTER_CAPTURE_DIR,{recursive:true});
        await panel.screenshot({path:path.join(process.env.FILTER_CAPTURE_DIR,`builder-${info.project.name}.png`)});
    }
    expect(errors).toEqual([]);
});

test('Namespace accordions clean HTML labels, hide reserved attributes, keep original matching values and support keyboard use',async({page})=>{
    const rich='<div>Ready &amp; queued</div><img src="/__never_load_label.png" onerror="window.filterLabelExecuted=true"><script>window.filterLabelExecuted=true</script>';
    const data=[record('rich','DEMO_ALPHA','RNG','RUNNING','station'),
        {id:'other',namespace:'DEMO_ALPHA',start:'2026-09-12T12:00:00Z',data:{title:'Other',comment:'Not ready'}},
        {id:'empty',namespace:'EMPTY',start:'2026-09-12T12:00:00Z',data:{title:'Hidden',Description:'<p>Hidden</p>',AsRun:'run',START:'start',End:'end',ID:'id'}}];
    Object.assign(data[0].data,{comment:rich,encoded:'&lt;b&gt;Encoded &amp;amp; ready&lt;/b&gt;',description:'<div>Hidden</div>',as_run:'run',
        start:'start',end:'end',id:'id',metadata:{TITLE:'hidden',ID:'hidden',flag:true}});
    const {panel,errors}=await setup(page,data);
    await panel.locator('.ob_filter_build_section > summary').click();
    const builder=panel.locator('.ob_new_filter');
    for(const mode of ['namespaces','include','exclude']){
        await builder.locator(`[data-filter-section=${mode}] > summary`).click();
        await expect(builder.locator('[data-filter-section][open]')).toHaveCount(1);
    }
    await expect(builder.locator('[data-filter-item-namespace]')).toHaveCount(2);
    await expect(builder.locator('[data-filter-item-namespace][open]')).toHaveCount(0);
    const exampleGroup=await openItems(builder,'include','DEMO_ALPHA');
    const comment=exampleGroup.getByRole('checkbox',{name:'Include DEMO_ALPHA comment: Ready & queued',exact:true});
    await expect(comment).toBeVisible();
    await expect(exampleGroup.getByRole('checkbox',{name:'Include DEMO_ALPHA encoded: Encoded & ready',exact:true})).toBeAttached();
    expect(await exampleGroup.locator('[data-filter-attribute]').evaluateAll(rows=>rows.map(row=>row.dataset.filterAttribute)))
        .toEqual(['comment','encoded','hostname','metadata.flag','status','system']);
    await expect(builder.locator('.ob_filter_namespace_content img,.ob_filter_namespace_content script')).toHaveCount(0);
    expect(await page.evaluate(()=>Boolean(window.filterLabelExecuted))).toBe(false);
    await comment.check();
    await expect(exampleGroup.locator('[data-filter-namespace-count]')).toHaveText('1');
    const expression=builder.getByRole('textbox',{name:'New filter expression',exact:true}),before=await expression.inputValue();
    expect(before).toContain(JSON.stringify(rich));
    await builder.locator('[data-filter-section=exclude] > summary').focus();await page.keyboard.press('Enter');
    const empty=builder.locator('[data-filter-mode=exclude][data-filter-item-namespace=EMPTY]');
    await empty.locator(':scope > summary').focus();await page.keyboard.press('Enter');
    await expect(empty).toHaveAttribute('open','');await expect(exampleGroup).toHaveCount(0);
    await expect(empty).toContainText('No selectable attributes.');
    await expect(builder.locator('[data-filter-item-namespace][open]')).toHaveCount(1);
    await builder.locator('[data-filter-section=include] > summary').focus();await page.keyboard.press('Space');
    await exampleGroup.locator(':scope > summary').focus();await page.keyboard.press('Space');
    await expect(exampleGroup).toHaveAttribute('open','');await expect(empty).toHaveCount(0);
    await expect(comment).toBeChecked();await expect(expression).toHaveValue(before);
    const original=await page.evaluate(()=>get_ob_timeline('ob_timeline_2').staticData.events[0].data.comment);expect(original).toBe(rich);
    await builder.getByRole('textbox',{name:'New filter name',exact:true}).fill('Formatted_comment');
    await builder.getByRole('button',{name:'Save filter',exact:true}).click();await ready(page);
    expect(await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_results.snapshot.entries.map(entry=>entry.record.id).sort())).toEqual(['empty','rich']);
    await panel.locator('.ob_filter_build_section > summary').click();
    await builder.getByRole('combobox',{name:'Clone existing filter',exact:true}).selectOption('Formatted_comment');
    const cloned=await openItems(builder,'include','DEMO_ALPHA');await expect(cloned.getByRole('checkbox',{name:'Include DEMO_ALPHA comment: Ready & queued',exact:true})).toBeChecked();
    expect(errors).toEqual([]);
});
