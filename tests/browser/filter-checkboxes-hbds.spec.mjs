import {test,expect} from '@playwright/test';
import {hbdsFixture,hbdsPublicConfiguration} from '../helpers/hbds-fixture.mjs';

test('Checked namespaces share one timeline, preserve identity and drafts, and allow an empty selection',async({page,context})=>{
    const document=await hbdsFixture(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const dataRequests=[];
    for(const [index,model] of document.models.entries())model.configuration.dataSource={format:'json',url:'__namespace_'+index+'.json'};
    await context.route('**/openbexi_timeline/config*',route=>{
        const id=new URL(route.request().url()).searchParams.get('namespaceId')||document.defaultNamespaceId;
        return route.fulfill({json:hbdsPublicConfiguration(document,'revision-1',id)});
    });
    await context.route('**/__namespace_*.json',route=>{
        const index=Number(new URL(route.request().url()).pathname.match(/_(\d)\.json/)[1]);dataRequests.push(index);
        return route.fulfill({json:{events:[{id:'same-id',namespace:document.namespaces[index].namespace,start:'2026-09-12T12:00:00Z',
            data:{title:index?'Beta event':'Alpha event',system:index?'CMD':'RNG'}}]}});
    });
    await page.goto('/openbexi_timeline.html');
    const initial=page.frameLocator('iframe[data-hbds-tab="tab-alpha"]');
    await expect(initial.locator('.ob_results_header')).toBeVisible();
    const open=initial.getByAltText('Sorting and filtering',{exact:true});if(!await open.isVisible())await initial.getByRole('button',{name:'More',exact:true}).click();await open.click();
    await expect(initial.getByRole('checkbox',{name:'Show namespace Alpha timeline',exact:true})).toBeChecked();
    await expect(initial.getByRole('checkbox',{name:'Show namespace Beta timeline',exact:true})).not.toBeChecked();
    await initial.locator('.ob_filter_build_section > summary').click();
    await initial.getByRole('textbox',{name:'New filter name',exact:true}).fill('Unsaved draft');
    await initial.getByRole('textbox',{name:'New filter expression',exact:true}).fill('expr: title CONTAINS "draft"');
    await initial.getByRole('checkbox',{name:'Show namespace Beta timeline',exact:true}).check();
    const combined=page.frameLocator('iframe[data-hbds-tab="__all__"]');
    await expect(combined.locator('.ob_results_header')).toBeVisible();
    const identities=()=>combined.locator('body').evaluate(()=>{
        const t=window.openbexiTimeline;
        return t?.ob_results?.pending?null:t?.ob_results?.snapshot?.entries.map(entry=>[entry.record.namespace,entry.record.id]);
    });
    await expect.poll(identities).toEqual([['EXAMPLE_ALPHA','same-id'],['EXAMPLE_BETA','same-id']]);
    await expect(combined.getByRole('textbox',{name:'New filter name',exact:true})).toHaveValue('Unsaved draft');
    await expect(combined.getByRole('textbox',{name:'New filter expression',exact:true})).toHaveValue('expr: title CONTAINS "draft"');
    const requestsAfterLoad=dataRequests.slice();
    await combined.getByRole('checkbox',{name:'Show namespace Alpha timeline',exact:true}).uncheck();
    await expect.poll(identities).toEqual([['EXAMPLE_BETA','same-id']]);
    await combined.getByRole('checkbox',{name:'Show namespace Beta timeline',exact:true}).uncheck();
    await expect.poll(identities).toEqual([]);
    await combined.getByRole('checkbox',{name:'Show namespace Alpha timeline',exact:true}).check();
    await expect.poll(identities).toEqual([['EXAMPLE_ALPHA','same-id']]);
    await expect(combined.getByRole('textbox',{name:'New filter name',exact:true})).toHaveValue('Unsaved draft');
    expect(await page.locator('iframe[data-hbds-tab="__all__"]').count()).toBe(1);
    expect(dataRequests).toContain(1);expect(dataRequests).toEqual(requestsAfterLoad);expect(errors).toEqual([]);
});
