import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {hbdsFixture,hbdsPublicConfiguration} from '../helpers/hbds-fixture.mjs';

const schema=JSON.parse(await fs.readFile('HBDS/schema/configuration.schema.json','utf8'));
const sample=JSON.parse(await fs.readFile('json/test-data/default-dataset.json','utf8'));
async function server(context,{provider=false}={}){
    let document=await hbdsFixture(),revision=1,conflict=false;const writes=[],configs=[],dataRequests=[],previewRequests=[];
    if(provider)for(const model of document.models)delete model.configuration.dataSource;
    await context.route('**/api/v1/hbds**',async route=>{
        const request=route.request();if(request.headers()['x-openbexi-hbds']!=='local-editor'||request.headers().authorization)return route.fulfill({status:403,json:{detail:'Local editor request required.'}});
        if(new URL(request.url()).pathname.endsWith('/schema'))return route.fulfill({json:schema});
        if(request.method()==='PUT'){
            writes.push({headers:request.headers(),document:request.postDataJSON()});
            if(conflict||request.headers()['if-match']!==`"revision-${revision}"`)return route.fulfill({status:412,json:{detail:'Configuration changed. Your draft is preserved; reload and reconcile.'}});
            const next=request.postDataJSON(),changedNamespaceIds=next.models.filter(model=>JSON.stringify(model)!==JSON.stringify(document.models.find(previous=>previous.id===model.id))).flatMap(model=>next.namespaces.filter(namespace=>namespace.modelId===model.id).map(namespace=>namespace.id));
            document=next;revision++;return route.fulfill({json:{document,revision:'revision-'+revision,changedNamespaceIds,restartRequired:false,restartReasons:[]}});
        }
        return route.fulfill({json:{document,revision:'revision-'+revision}});
    });
    await context.route('**/openbexi_timeline/config*',route=>{const url=new URL(route.request().url());configs.push(url.searchParams.get('namespaceId'));return route.fulfill({json:{...hbdsPublicConfiguration(document,'revision-'+revision,url.searchParams.get('namespaceId')||document.defaultNamespaceId),...(provider?{data:'/openbexi_timeline/sessions'}:{})}});});
    await context.route('**/json/test-data/default-dataset.json',route=>route.fulfill({json:{records:sample.records.slice(0,24)}}));
    context.on('request',request=>{if(request.url().includes('/json/test-data/default-dataset.json'))(request.frame().url().includes('model_preview.html')?previewRequests:dataRequests).push(request.url());});
    return {writes,configs,dataRequests,previewRequests,get document(){return document;},get revision(){return 'revision-'+revision;},set conflict(value){conflict=value;}};
}
async function connect(page){
    await page.goto('/openbexi_timeline_model.html?hbds=1');await expect(page.getByRole('heading',{name:'HBDS Editor',exact:true})).toBeVisible();
    await expect(page.getByRole('combobox',{name:'HBDS namespace',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:/connect/i})).toHaveCount(0);
    await expect(page.locator('#dialog')).not.toBeVisible();
    await expect(page.getByRole('button',{name:'Back to model preview',exact:true})).toHaveCount(0);
    await expect(page.locator('#preview-host')).toHaveAttribute('data-state','ready',{timeout:45000});
}

test('HBDS preview follows namespace and tab selection, previews drafts and avoids reloads for menu edits',async({page,context})=>{
    const backend=await server(context),errors=[],models=[];page.on('pageerror',error=>errors.push(error.message));
    context.on('request',request=>{if(request.url().includes('/models/'))models.push(request.url());});
    await connect(page);expect(models).toEqual([]);expect(backend.previewRequests).toHaveLength(1);
    await expect(page.getByRole('combobox',{name:'HBDS timeline tab',exact:true})).toHaveValue('tab-alpha');
    const currentPreview=()=>page.locator('#preview-host iframe').last().evaluate(frame=>({namespace:frame.contentWindow.previewTimeline?.hbdsNamespaceId,title:frame.contentWindow.previewTimeline?.params?.[0]?.title}));
    await page.getByRole('combobox',{name:'HBDS timeline tab',exact:true}).selectOption('tab-beta');
    await expect(page.getByRole('combobox',{name:'HBDS namespace',exact:true})).toHaveValue('namespace-beta');
    await expect.poll(async()=>(await currentPreview()).namespace).toBe('namespace-beta');expect(backend.previewRequests).toHaveLength(2);
    await page.getByRole('button',{name:'Tabs',exact:true}).click();
    await page.getByLabel('tabs.1.title',{exact:true}).fill('Beta draft tab');await page.getByLabel('tabs.1.title',{exact:true}).press('Tab');
    await expect(page.getByRole('combobox',{name:'HBDS timeline tab',exact:true})).toHaveValue('tab-beta');
    await expect(page.getByRole('combobox',{name:'HBDS timeline tab',exact:true}).locator('option:checked')).toHaveText('Beta draft tab');
    await page.getByRole('button',{name:'Model and appearance',exact:true}).click();
    await expect(page.getByRole('button',{name:'Model and appearance',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.locator('[data-hbds-path="models.1.configuration.params"] > summary').click();await page.locator('[data-hbds-path="models.1.configuration.params.0"] > summary').click();
    expect(backend.previewRequests).toHaveLength(2);expect(backend.writes).toHaveLength(0);
    await page.getByLabel('models.1.configuration.params.0.title',{exact:true}).fill('Beta preview draft');await page.getByLabel('models.1.configuration.params.0.title',{exact:true}).press('Tab');
    await expect.poll(async()=>(await currentPreview()).title).toBe('Beta preview draft');expect(backend.writes).toHaveLength(0);
    await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await currentPreview()).title).toBe('Operations sample');
    await page.screenshot({path:`target/hbds-unified-${test.info().project.name}.png`,fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('Settings opens the active HBDS model, namespace and tab beside the preview',async({page,context})=>{
    const backend=await server(context);await page.goto('/openbexi_timeline.html');
    await expect(page.locator('iframe[data-hbds-tab="tab-alpha"]')).toBeVisible();
    await page.evaluate(()=>window.hbdsTabs.select('tab-beta'));
    const timeline=page.frameLocator('iframe[data-hbds-tab="tab-beta"]');
    await expect(timeline.locator('.ob_results_header')).toBeVisible({timeout:45000});
    await page.locator('iframe[data-hbds-tab="tab-beta"]').evaluate(frame=>frame.contentWindow.openbexiTimeline.ob_views.setMode('table'));
    await timeline.getByAltText('Settings',{exact:true}).click();const opened=page.waitForEvent('popup');
    await timeline.getByRole('button',{name:'HBDS Editor',exact:true}).click();const editor=await opened;
    await expect(editor.getByRole('combobox',{name:'HBDS namespace',exact:true})).toHaveValue('namespace-beta');
    await expect(editor.getByRole('combobox',{name:'HBDS timeline tab',exact:true})).toHaveValue('tab-beta');
    await expect(editor.locator('#preview-host')).toHaveAttribute('data-state','ready',{timeout:45000});
    expect(await editor.locator('#preview-host iframe').evaluate(frame=>frame.contentWindow.previewTimeline.hbdsNamespaceId)).toBe('namespace-beta');
    expect(await editor.locator('#preview-host iframe').evaluate(frame=>frame.contentWindow.previewTimeline.ob_views.mode)).toBe('table');
    expect(backend.writes).toHaveLength(0);await editor.close();
});

test('HBDS connected preview scopes every records request and avoids configuration fetches on model edits',async({page,context})=>{
    const backend=await server(context,{provider:true}),requests=[];
    await context.route('**/openbexi_timeline/sessions?*',route=>{requests.push(new URL(route.request().url()).searchParams.get('namespace'));return route.fulfill({json:{dateTimeFormat:'iso8601',events:[]}});});
    await connect(page);await expect.poll(()=>requests.length).toBeGreaterThan(0);expect(new Set(requests)).toEqual(new Set(['EXAMPLE_ALPHA']));
    await page.getByRole('combobox',{name:'HBDS namespace',exact:true}).selectOption('namespace-beta');
    await expect.poll(()=>requests.includes('EXAMPLE_BETA')).toBe(true);
    expect(backend.configs).toEqual(['namespace-alpha','namespace-beta']);expect(requests.every(value=>['EXAMPLE_ALPHA','EXAMPLE_BETA'].includes(value))).toBe(true);
    await page.getByRole('button',{name:'Advanced JSON',exact:true}).click();const value=JSON.parse(await page.getByRole('textbox',{name:'HBDS JSON'}).inputValue());
    value.models[1].configuration.params[0].title='Provider preview';await page.getByRole('textbox',{name:'HBDS JSON'}).fill(JSON.stringify(value));
    await expect(page.locator('#preview-state')).toContainText('Provider preview');expect(backend.configs).toHaveLength(2);
    await page.locator('#live').uncheck();value.models[1].configuration.params[0].title='Manual preview';await page.getByRole('textbox',{name:'HBDS JSON'}).fill(JSON.stringify(value));
    await page.locator('#refresh').click();await expect(page.locator('#preview-state')).toContainText('Manual preview');
    expect(backend.writes).toHaveLength(0);
});

test('HBDS compact phone menu keeps selection, actions and preview accessible',async({page,context})=>{
    await page.setViewportSize({width:390,height:844});await server(context);await connect(page);
    await expect(page.getByRole('combobox',{name:'HBDS namespace',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Save and apply',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Model and appearance',exact:true}).click();
    await expect(page.locator('#preview-host')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'target/hbds-unified-phone.png',fullPage:true});
});

test('HBDS admin edits tabs, reorders and saves; invalid references and conflicts retain the draft',async({page,context})=>{
    const backend=await server(context),errors=[];page.on('pageerror',error=>errors.push(error.message));await connect(page);
    await page.getByRole('button',{name:'Tabs',exact:true}).click();await page.getByLabel('tabs.0.title',{exact:true}).fill('Alpha renamed');await page.getByLabel('tabs.0.title',{exact:true}).press('Tab');
    await page.getByRole('button',{name:'Add tab',exact:true}).click();await expect(page.getByLabel('tabs.2.title',{exact:true})).toBeVisible();
    await page.getByLabel('tabs.2.title',{exact:true}).fill('Third timeline');await page.getByLabel('tabs.2.title',{exact:true}).press('Tab');
    await page.locator('.hbds-entity').last().getByRole('button',{name:'Move up',exact:true}).click();
    await page.getByRole('button',{name:'Save and apply',exact:true}).click();await expect(page.locator('#hbds-editor')).toContainText('Saved and applied.');
    expect(backend.document.tabs.map(tab=>tab.title)).toEqual(['Alpha renamed','Third timeline','Beta timeline']);expect(backend.writes[0].headers['if-match']).toBe('"revision-1"');
    await page.getByRole('button',{name:'Advanced JSON',exact:true}).click();const value=JSON.parse(await page.getByRole('textbox',{name:'HBDS JSON'}).inputValue());value.namespaces[0].modelId='missing-model';await page.getByRole('textbox',{name:'HBDS JSON'}).fill(JSON.stringify(value));
    await page.getByRole('button',{name:'Save and apply',exact:true}).click();await expect(page.locator('.hbds-errors')).toContainText('missing');expect(backend.writes).toHaveLength(1);
    await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByRole('button',{name:'Tabs',exact:true}).click();backend.conflict=true;
    await page.getByLabel('tabs.0.title',{exact:true}).fill('Keep this draft');await page.getByLabel('tabs.0.title',{exact:true}).press('Tab');await page.getByRole('button',{name:'Save and apply',exact:true}).click();
    await expect(page.locator('.hbds-errors')).toContainText('draft is preserved');await expect(page.getByLabel('tabs.0.title',{exact:true})).toHaveValue('Keep this draft');
    expect(await page.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].some(value=>String(value).includes('fixture-admin')))).toBe(false);expect(errors).toEqual([]);
});

test('HBDS host loads one tab, keeps frames on rename and refreshes only the edited namespace',async({page,context})=>{
    test.setTimeout(180000);
    const backend=await server(context),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/openbexi_timeline.html');
    const first=page.frameLocator('iframe[data-hbds-tab="tab-alpha"]');await expect(first.locator('.ob_results_header')).toBeVisible({timeout:45000});await expect(page.locator('iframe[data-hbds-tab]')).toHaveCount(1);
    await expect.poll(()=>backend.dataRequests.length).toBe(1);expect(backend.configs).toEqual([null,'namespace-alpha']);
    await expect(page.locator('.ob_hbds_tabs')).toHaveCount(0);
    const filters=first.getByAltText('Sorting and filtering',{exact:true});
    if(!await filters.isVisible())await first.getByRole('button',{name:'More',exact:true}).click();
    await filters.click();
    await expect(first.getByRole('tab',{name:'Alpha timeline',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(first.locator('.ob_filter_build_section')).not.toHaveAttribute('open','');
    await first.getByRole('tab',{name:'Alpha timeline',exact:true}).focus();await page.keyboard.press('ArrowRight');
    await expect(first.getByRole('tab',{name:'Beta timeline',exact:true})).toBeFocused();await page.keyboard.press('Enter');
    const second=page.frameLocator('iframe[data-hbds-tab="tab-beta"]');await expect(second.locator('.ob_results_header')).toBeVisible({timeout:45000});await expect.poll(()=>backend.dataRequests.length).toBe(2);
    await expect(second.locator('.ob_filter_namespaces')).toBeVisible();
    await expect(second.getByRole('tab',{name:'Beta timeline',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(second.getByRole('tab',{name:'Beta timeline',exact:true})).toBeFocused();
    await expect(second.locator('.ob_filter_build_section')).not.toHaveAttribute('open','');
    await second.getByRole('tab',{name:'Alpha timeline',exact:true}).click();
    await expect(page.locator('iframe[data-hbds-tab="tab-alpha"]')).toBeVisible();
    await first.getByRole('tab',{name:'Beta timeline',exact:true}).click();
    await expect(page.locator('iframe[data-hbds-tab="tab-beta"]')).toBeVisible();
    expect(backend.dataRequests).toHaveLength(2);expect(backend.configs).toEqual([null,'namespace-alpha','namespace-beta']);
    await page.evaluate(()=>{for(const frame of document.querySelectorAll('iframe[data-hbds-tab]'))frame.dataset.original='yes';});
    const editor=await context.newPage();await connect(editor);await editor.getByRole('button',{name:'Tabs',exact:true}).click();await editor.getByLabel('tabs.0.title',{exact:true}).fill('Alpha renamed');await editor.getByLabel('tabs.0.title',{exact:true}).press('Tab');await editor.getByRole('button',{name:'Save and apply',exact:true}).click();
    await expect(editor.locator('#hbds-editor')).toContainText('Saved and applied.');await expect(second.getByRole('tab',{name:'Alpha renamed',exact:true})).toBeVisible({timeout:45000});await expect(page.locator('iframe[data-original="yes"]')).toHaveCount(2);expect(backend.dataRequests).toHaveLength(2);
    await editor.getByRole('combobox',{name:'HBDS namespace',exact:true}).selectOption('namespace-beta');await editor.getByRole('button',{name:'Model and appearance',exact:true}).click();
    await editor.locator('[data-hbds-path="models.1.configuration.params"] > summary').click();await editor.locator('[data-hbds-path="models.1.configuration.params.0"] > summary').click();
    await editor.getByLabel('models.1.configuration.params.0.title',{exact:true}).fill('Updated beta model');await editor.getByLabel('models.1.configuration.params.0.title',{exact:true}).press('Tab');
    await editor.getByRole('button',{name:'Save and apply',exact:true}).click();
    await expect(editor.locator('#hbds-editor')).toContainText('Saved and applied.');await page.bringToFront();
    await expect(page.locator('iframe[data-hbds-tab="tab-alpha"]')).toHaveAttribute('data-original','yes');await expect(page.locator('iframe[data-hbds-tab="tab-beta"]')).not.toHaveAttribute('data-original','yes');
    await expect.poll(()=>page.locator('iframe[data-hbds-tab="tab-beta"]').evaluate(frame=>frame.contentWindow?.openbexiTimeline?.params?.[0]?.title),{timeout:45000}).toBe('Updated beta model');await expect.poll(()=>backend.dataRequests.length).toBe(3);
    expect(await page.evaluate(()=>window.hbdsTabs.activeId)).toBe('tab-beta');expect(errors).toEqual([]);await editor.close();
});
