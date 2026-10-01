import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';

const catalog=JSON.parse(await fs.readFile('demos/catalog.json','utf8'));
async function ready(page){await expect(page.locator('#preview-host')).toHaveAttribute('data-state','ready',{timeout:45000});await expect(page.locator('#errors')).toBeHidden();}
async function previewValue(page,expression){const frames=page.frames().filter(frame=>frame.url().includes('openbexi_timeline_model_preview.html'));for(const frame of frames){const value=await frame.evaluate(expression).catch(()=>undefined);if(value!==undefined)return value;}}
for(const demo of catalog.demos)test(`Model editor previews and updates ${demo.id} with real demo data`,async({page})=>{
    await page.goto('/openbexi_timeline_model.html?model='+encodeURIComponent(demo.model));await ready(page);
    await expect(page.locator('#preview-state')).toContainText(`${demo.recordCount} records`);
    const first=Number(await page.locator('#preview-host').getAttribute('data-revision'));
    await page.getByRole('textbox',{name:'params.0.title',exact:true}).fill('Preview '+demo.title);
    await expect.poll(()=>page.locator('#preview-host').getAttribute('data-revision')).not.toBe(String(first));
    await expect(page.locator('#preview-state')).toContainText('Preview '+demo.title);
    await expect.poll(()=>previewValue(page,()=>window.previewTimeline?.params?.[0]?.title)).toBe('Preview '+demo.title);
    await expect(page.locator('#dirty')).toHaveText('Unsaved changes');
});
test('Invalid edits retain the last valid live preview and undo restores synchronized text',async({page})=>{
    await page.goto('/openbexi_timeline_model.html?model=models/demos/monet.json');await ready(page);
    const revision=await page.locator('#preview-host').getAttribute('data-revision');
    await page.getByRole('tab',{name:'Advanced text'}).click();const original=await page.locator('#raw').inputValue();
    await page.locator('#raw').fill('{ invalid JSON');await expect(page.locator('#errors')).toBeVisible();
    await expect(page.locator('#save')).toBeDisabled();await expect(page.locator('#preview-host')).toHaveAttribute('data-revision',revision);
    await page.locator('#raw').fill(original.replace('Claude Monet','Edited Monet'));await expect(page.locator('#preview-state')).toContainText('Edited Monet');
    await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#raw')).toHaveValue(original);await expect(page.locator('#preview-state')).toContainText('Claude Monet');
});
test('YAML forms preserve comments and export an edited local document',async({page})=>{
    await page.goto('/openbexi_timeline_model.html');await ready(page);
    const content='# Preserve this comment\nmodel: models/demos/monet.json\nunknown: retained\ndata_sources:\n  - namespace: earthquake # namespace comment\n    enable: true\n';
    await page.locator('#file').setInputFiles({name:'sources.yml',mimeType:'application/yaml',buffer:Buffer.from(content)});
    await expect(page.locator('#document-name')).toHaveText('sources.yml');
    await page.getByRole('textbox',{name:'model',exact:true}).fill('models/demos/jfk.json');
    await page.getByRole('tab',{name:'Advanced text'}).click();
    await expect(page.locator('#raw')).toHaveValue(/# Preserve this comment/);await expect(page.locator('#raw')).toHaveValue(/unknown: retained/);await expect(page.locator('#raw')).toHaveValue(/# namespace comment/);
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('sources.yml');
});
test('Settings opens the active model and Apply updates the originating timeline',async({page})=>{
    await page.goto('/demos.html?demo=monet');await expect(page.locator('#demo-status')).toHaveAttribute('data-state','ready');
    await page.getByAltText('Settings',{exact:true}).click();
    const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Model and YAML editor',exact:true}).click();const editor=await popupPromise;
    await ready(editor);await expect(editor.getByRole('textbox',{name:'params.0.title',exact:true})).toHaveValue('Claude Monet');
    await editor.getByRole('textbox',{name:'params.0.title',exact:true}).fill('Monet from editor');
    await expect(editor.locator('#preview-state')).toContainText('Monet from editor');
    const reloaded=page.waitForEvent('domcontentloaded');await editor.getByRole('button',{name:'Apply to original timeline'}).click();await reloaded;
    await expect.poll(()=>page.evaluate(async()=>{const module=await import('/src/openbexi_demo.js');return (await module.demoReady).params[0].title;})).toBe('Monet from editor');
    await expect(editor.locator('#notice')).toContainText('applied');
    await editor.close();
});

test('Editing camera optics keeps a 3D preview while an explicit camera mode change takes effect',async({page})=>{
    await page.goto('/demos.html?demo=monet');await expect(page.locator('#demo-status')).toHaveAttribute('data-state','ready');
    await page.getByAltText('2D or 3D view',{exact:true}).click();
    await page.getByAltText('Settings',{exact:true}).click();
    const popup=page.waitForEvent('popup');await page.getByRole('button',{name:'Model and YAML editor',exact:true}).click();
    const editor=await popup;await ready(editor);
    await expect.poll(()=>previewValue(editor,()=>window.previewTimeline?.ob_scene?.[0]?.ob_camera?.type)).toBe('PerspectiveCamera');
    await editor.getByRole('tab',{name:'Advanced text'}).click();
    const model=JSON.parse(await editor.locator('#raw').inputValue());model.rendering={camera:{fieldOfView:45}};
    await editor.locator('#raw').fill(JSON.stringify(model,null,2));
    await expect.poll(()=>previewValue(editor,()=>window.previewTimeline?.ob_scene?.[0]?.ob_camera?.fov)).toBe(45);
    await expect.poll(()=>previewValue(editor,()=>window.previewTimeline?.ob_scene?.[0]?.ob_camera?.type)).toBe('PerspectiveCamera');
    model.rendering.camera.mode='Orthographic';await editor.locator('#raw').fill(JSON.stringify(model,null,2));
    await expect.poll(()=>previewValue(editor,()=>window.previewTimeline?.ob_scene?.[0]?.ob_camera?.type)).toBe('OrthographicCamera');
    await editor.close();
});
test('Legacy earthquake model previews standalone and with chosen sample data',async({page})=>{
    await page.goto('/openbexi_timeline_model.html?model=models/regular_timeline_earthquake.json');await ready(page);
    await expect(page.locator('#preview-state')).toContainText('Timeline Hazard report');
    await page.locator('#preview-data').selectOption('default-dataset');
    await expect(page.locator('#preview-state')).toContainText('1008 records');
    expect(await page.evaluate(()=>window.modelEditor.document.value.dataSource)).toBeUndefined();
});
test('Optional rendering controls immediately change the actual preview scene color',async({page})=>{
    await page.goto('/openbexi_timeline_model.html?model=models/demos/monet.json');await ready(page);
    await page.getByRole('combobox',{name:'Optional root property',exact:true}).selectOption('rendering');await page.getByRole('button',{name:'Add section',exact:true}).click();
    await page.getByRole('combobox',{name:'Optional property in rendering',exact:true}).selectOption('theme');await page.getByRole('button',{name:'Add optional property to rendering',exact:true}).click();
    await page.getByRole('combobox',{name:'Optional property in rendering.theme',exact:true}).selectOption('sceneBackground');await page.getByRole('button',{name:'Add optional property to rendering.theme',exact:true}).click();
    const color=page.getByLabel('rendering.theme.sceneBackground color picker',{exact:true});
    await color.fill('#cc3399');
    await expect.poll(()=>previewValue(page,()=>window.previewTimeline?.ob_scene?.[0]?.background?.getHexString())).toBe('cc3399');
    await page.getByRole('tab',{name:'Advanced text'}).click();await expect(page.locator('#raw')).toHaveValue(/"sceneBackground": "#cc3399"/);
    await expect(page.locator('#dirty')).toHaveText('Unsaved changes');
});
test('Server document CRUD uses conditional writes and retains a draft on conflict',async({page})=>{
    let saved=null,version=0,conflict=false;
    const requests=[];
    await page.route('**/api/v1/me',route=>route.fulfill({status:404,json:{detail:'This legacy configuration server has no identity endpoint.'}}));
    await page.route('**/api/v1/config-files**',async route=>{
        const request=route.request(),method=request.method();requests.push({method,headers:request.headers()});
        if(request.headers().authorization!=='Bearer test-admin')return route.fulfill({status:403,json:{detail:'Admin token required.'}});
        const collection=new URL(request.url()).pathname.endsWith('/config-files');
        if(method==='GET')return route.fulfill({json:collection?{items:saved?[{...saved,text:undefined}]:[]}:saved,headers:{ETag:'"v'+version+'"'}});
        if(method==='POST'){saved={...request.postDataJSON(),id:'original',writable:true,restartRequired:false};version++;return route.fulfill({status:201,json:saved,headers:{ETag:'"v'+version+'"'}});}
        if(method==='PUT'){
            if(conflict || request.headers()['if-match']!=='"v'+version+'"')return route.fulfill({status:412,json:{detail:'Document changed. Reload and reconcile your draft.'}});
            const body=request.postDataJSON();saved={...saved,...body,id:body.name!==saved.name?'renamed':saved.id};version++;return route.fulfill({json:saved,headers:{ETag:'"v'+version+'"'}});
        }
        if(method==='DELETE'){saved=null;return route.fulfill({status:204});}
    });
    page.on('dialog',dialog=>dialog.accept());
    await page.goto('/openbexi_timeline_model.html?model=models/demos/monet.json');await ready(page);
    await page.getByRole('button',{name:'Use preview data URL in model'}).click();
    await page.getByRole('button',{name:'Connect to server',exact:true}).click();await page.locator('#dialog-input').fill('test-admin');await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.locator('#connect')).toHaveText('Disconnect');
    await page.locator('#save').click();await page.locator('#dialog-input').fill('monet-copy.json');await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.locator('#dirty')).toHaveText('Saved on server');
    expect(JSON.parse(saved.text).dataSource.url).toBe('json/test-data/monet.json');
    await page.getByRole('textbox',{name:'params.0.title',exact:true}).fill('Saved Monet');await page.locator('#save').click();await expect(page.locator('#dirty')).toHaveText('Saved on server');expect(JSON.parse(saved.text).params[0].title).toBe('Saved Monet');
    conflict=true;await page.getByRole('textbox',{name:'params.0.title',exact:true}).fill('Conflicting draft');await page.locator('#save').click();await expect(page.locator('#errors')).toContainText('Document changed');await expect(page.getByRole('textbox',{name:'params.0.title',exact:true})).toHaveValue('Conflicting draft');await expect(page.locator('#save')).toBeEnabled();
    conflict=false;await page.locator('#documents').selectOption('server:original');await expect(page.getByRole('textbox',{name:'params.0.title',exact:true})).toHaveValue('Saved Monet');
    await page.locator('#rename').click();await page.locator('#dialog-input').fill('renamed.json');await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.locator('#document-name')).toHaveText('renamed.json');
    await page.locator('#delete').click();await expect(page.locator('#document-name')).toHaveText('models/demos/default-dataset.json');expect(saved).toBeNull();
    expect(requests.filter(request=>request.method==='PUT').every(request=>Boolean(request.headers['if-match']))).toBe(true);
    expect(await page.evaluate(()=>Object.values(localStorage).some(value=>String(value).includes('test-admin')))).toBe(false);
});
test('A delayed document open cannot replace a newer selection or edits',async({page})=>{
    await page.goto('/openbexi_timeline_model.html?model=models/demos/monet.json');await ready(page);
    let release;
    await page.route('**/models/demos/jfk.json',async route=>{await new Promise(resolve=>{release=resolve;});await route.continue();});
    const complete=async()=>{
        const finished=page.waitForEvent('requestfinished',{predicate:request=>request.url().endsWith('/models/demos/jfk.json')});
        release();await finished;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    };
    await page.locator('#documents').selectOption('demo:jfk');await expect.poll(()=>typeof release).toBe('function');
    await page.locator('#documents').selectOption('demo:ephemeris');await expect(page.locator('#document-name')).toHaveText('models/demos/ephemeris.json');
    await complete();await expect(page.locator('#document-name')).toHaveText('models/demos/ephemeris.json');
    release=undefined;await page.locator('#documents').selectOption('demo:jfk');await expect.poll(()=>typeof release).toBe('function');
    await page.getByRole('textbox',{name:'params.0.title',exact:true}).fill('Keep these edits');
    await complete();await expect(page.getByRole('textbox',{name:'params.0.title',exact:true})).toHaveValue('Keep these edits');await expect(page.locator('#dirty')).toHaveText('Unsaved changes');
});
test('Known YAML errors disable saving and exporting until the property is corrected',async({page})=>{
    await page.goto('/openbexi_timeline_model.html');await ready(page);
    await page.locator('#file').setInputFiles({name:'server.yml',mimeType:'application/yaml',buffer:Buffer.from('server:\n  host: localhost\n  port: 70000\nsnapshot:\n  file: events.json\n')});
    await expect(page.locator('#errors')).toContainText('$.server.port');await expect(page.locator('#save')).toBeDisabled();await expect(page.locator('#export')).toBeDisabled();
    await page.getByRole('spinbutton',{name:'server.port',exact:true}).fill('8781');await expect(page.locator('#errors')).toBeHidden();await expect(page.locator('#save')).toBeEnabled();await expect(page.locator('#export')).toBeEnabled();
});

async function workspaceServer(page,{admin=true}={}){
    const calls=[];let source=JSON.parse(await fs.readFile('models/demos/monet.json','utf8')),revision=1;
    const grants=[{userId:'alice',role:'admin'}];
    await page.route(url=>url.pathname.startsWith('/api/v1/'),async route=>{
        const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method(),body=request.postDataJSON();calls.push({path,method,body,headers:request.headers()});
        if(request.headers().authorization!=='Bearer session-admin')return route.fulfill({status:401,json:{detail:'Session required'}});
        if(path==='/api/v1/me')return route.fulfill({json:{id:'alice',systemAdmin:false,workspaceIds:['studio']}});
        if(path==='/api/v1/models')return route.fulfill({json:{items:[{modelId:'monet',title:'Studio model',permissions:{admin,read:true,write:admin}}]}});
        if(path.endsWith('/access'))return route.fulfill({json:{modelId:'monet',workspaceId:'studio',grants:method==='PUT'?body.grants:grants,roles:[{name:'reviewer',permissions:['read','writeFilters']}],role:admin?'admin':'readOnly',permissions:{admin,read:true,write:admin}},headers:{ETag:'"access1"'}});
        if(!admin)return route.fulfill({status:403,json:{detail:'Model administrator required'}});
        if(path==='/api/v1/models/monet'){
            if(method==='PUT'){
                if(calls.modelConflict || request.headers()['if-match']!=='"data'+revision+'"')return route.fulfill({status:412,json:{detail:'Dataset revision changed'}});
                source=body;revision++;
            }
            return route.fulfill({json:source,headers:{ETag:'"data'+revision+'"'}});
        }
        if(path.endsWith('/preview'))return route.fulfill({contentType:'application/json',body:await fs.readFile('json/test-data/monet.json','utf8')});
        if(path.endsWith('/config-files'))return route.fulfill({json:method==='POST'?{id:'yaml-copy',...body}:{items:[]},headers:{ETag:'"file1"'}});
        if(path.endsWith('/versions'))return route.fulfill({json:{items:[{revision:'saved'+revision,savedAt:'2026-10-01T12:00:00Z',state:'saved'}]}});
        if(path.endsWith('/versions/saved1'))return route.fulfill({json:{revision:'saved1',configuration:source}});
        if(path.endsWith('/filters')){
            if(method!=='GET' && request.headers()['if-match']!=='"data'+revision+'"')return route.fulfill({status:412,json:{detail:'Dataset revision changed'}});
            return route.fulfill({json:method==='GET'?{items:[]}:body,headers:{ETag:'"data'+revision+'"'}});
        }
        if(path.endsWith('/ai/providers'))return route.fulfill({json:{enabled:true,providers:[{id:'fixture',name:'Configured provider',models:[{id:'text',name:'Text model',capabilities:{vision:false,structuredOutput:true}},{id:'vision',name:'Image model',capabilities:{vision:true,structuredOutput:true}}]}]}});
        if(path.endsWith('/ai/generate')){const value=JSON.parse(body.document.text);value.params[0].title='Reviewed AI title';return route.fulfill({json:{requestId:body.requestId,explanation:'Suggested a title change.',proposal:{kind:'model',format:'json',text:JSON.stringify(value)},assumptions:['Image colors are approximate.'],warnings:[],validation:{valid:true,errors:[]}}});}
        if(path.endsWith('/ai/cancel'))return route.fulfill({json:{cancelled:true}});
        return route.fulfill({status:404,json:{detail:'Unknown test route'}});
    });return calls;
}
async function connectModel(page){await page.locator('#connect').click();await page.locator('#dialog-input').fill('session-admin');await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.locator('#workspace-role')).toContainText('studio');}

test('Five editor areas share the draft, search across areas, and retain keyboard navigation',async({page})=>{
    await page.goto('/openbexi_timeline_model.html?model=models/demos/monet.json');await ready(page);
    await expect(page.locator('.area-nav button')).toHaveCount(5);
    await page.getByRole('button',{name:'Appearance',exact:true}).click();await expect(page.locator('[data-area="appearance"][data-path="bands"]')).toBeVisible();
    await page.locator('#property-filter').fill('params.0.title');await page.getByRole('textbox',{name:'params.0.title',exact:true}).fill('Search across areas');await expect(page.locator('#preview-state')).toContainText('Search across areas');
    await page.locator('#property-filter').fill('');await page.getByRole('button',{name:'Appearance',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('button',{name:'Filters',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('tab',{name:'Advanced text'}).click();await expect(page.locator('#raw')).toHaveValue(/Search across areas/);
});

test('Editor remains usable at desktop, narrow and phone widths',async({page})=>{
    await page.goto('/openbexi_timeline_model.html?model=models/demos/monet.json');await ready(page);
    for(const [name,width,height] of [['desktop',1440,900],['narrow',800,900],['phone',390,844]]){
        await page.setViewportSize({width,height});
        await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
        await expect(page.getByRole('button',{name:'Overview',exact:true})).toBeVisible();
        await page.screenshot({path:`.local-private/editor24-${name}.png`,fullPage:true});
    }
});

test('Connected model access gates the editor and avoids protected requests for a reader',async({page})=>{
    const calls=await workspaceServer(page,{admin:false});await page.goto('/openbexi_timeline_model.html?modelId=monet');await expect(page.locator('#editor-lock')).toBeVisible();await connectModel(page);
    await expect(page.locator('#editor-lock')).toBeVisible();await expect(page.locator('#save')).toBeDisabled();await expect(page.locator('#raw')).not.toBeEditable();
    expect(calls.some(call=>/config-files|ai\/providers|filters|versions/.test(call.path))).toBe(false);
    expect(await page.evaluate(()=>Object.values(localStorage).some(value=>String(value).includes('session-admin')))).toBe(false);
});

test('AI proposals show a validated diff and preview before explicit acceptance, never autosave',async({page})=>{
    const calls=await workspaceServer(page);await page.goto('/openbexi_timeline_model.html?model=models/demos/monet.json');await ready(page);await connectModel(page);
    await page.locator('#ai-panel summary').click();await page.locator('#ai-prompt').fill('Suggest a clearer title');await page.locator('#ai-generate').click();await expect(page.locator('#ai-status')).toContainText('Validated proposal');
    await expect(page.locator('#ai-diff')).toContainText('params.0.title');expect(await page.evaluate(()=>window.modelEditor.document.value.params[0].title)).toBe('Claude Monet');
    await page.screenshot({path:'.local-private/editor24-ai-review.png',fullPage:true});
    await page.locator('#ai-preview').click();await expect(page.locator('#preview-state')).toContainText('Reviewed AI title');expect(await page.evaluate(()=>window.modelEditor.document.value.params[0].title)).toBe('Claude Monet');
    await page.locator('#ai-accept').click();await expect(page.getByRole('textbox',{name:'params.0.title',exact:true})).toHaveValue('Reviewed AI title');await expect(page.locator('#dirty')).toHaveText('Unsaved changes');
    await page.locator('#undo').click();await expect(page.getByRole('textbox',{name:'params.0.title',exact:true})).toHaveValue('Claude Monet');
    expect(calls.filter(call=>call.method!=='GET').map(call=>call.path)).toEqual(['/api/v1/models/monet/ai/generate']);
    const sent=calls.find(call=>call.path.endsWith('/ai/generate')).body;expect(sent.document.kind).toBe('model');expect(sent).not.toHaveProperty('records');expect(sent).not.toHaveProperty('apiKey');
});

test('AI capability controls image upload and protects a manually edited draft from an old proposal',async({page})=>{
    const calls=await workspaceServer(page);await page.goto('/openbexi_timeline_model.html?model=models/demos/monet.json');await ready(page);await connectModel(page);await page.locator('#ai-panel summary').click();
    await expect(page.locator('#ai-image')).toBeDisabled();await page.locator('#ai-model').selectOption('vision');await expect(page.locator('#ai-image')).toBeEnabled();
    const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6x1sAAAAASUVORK5CYII=';
    await page.locator('#ai-image').setInputFiles({name:'timeline.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await expect(page.locator('#ai-image-name')).toContainText('timeline.png');
    await page.locator('#ai-generate').click();await expect(page.locator('#ai-status')).toContainText('Validated proposal');await page.getByRole('textbox',{name:'params.0.title',exact:true}).fill('Manual draft');await expect(page.locator('#ai-accept')).toBeDisabled();expect(await page.evaluate(()=>window.modelEditor.document.value.params[0].title)).toBe('Manual draft');
    expect(calls.find(call=>call.path.endsWith('/ai/generate')).body.image).toEqual({mimeType:'image/png',dataBase64:image});
});

test('Cancelling an AI request preserves the draft and sends a scoped cancellation',async({page})=>{
    const calls=await workspaceServer(page);let release,started=false;
    await page.route('**/api/v1/models/monet/ai/generate',async route=>{started=true;await new Promise(resolve=>{release=resolve;});await route.fulfill({json:{explanation:'Late response'}}).catch(()=>{});});
    await page.goto('/openbexi_timeline_model.html?model=models/demos/monet.json');await ready(page);await connectModel(page);await page.locator('#ai-panel summary').click();await page.locator('#ai-generate').click();await expect.poll(()=>started).toBe(true);
    await page.locator('#ai-cancel').click();await expect(page.locator('#ai-status')).toContainText('cancelled');await expect.poll(()=>calls.filter(call=>call.path.endsWith('/ai/cancel')).length).toBe(1);release();
    expect(await page.evaluate(()=>window.modelEditor.document.value.params[0].title)).toBe('Claude Monet');await expect(page.locator('#ai-review')).toBeHidden();
});

test('Protected model loading and preview wait for administrator authentication and isolate credentials',async({page})=>{
    const calls=await workspaceServer(page);await page.goto('/openbexi_timeline_model.html?modelId=monet&model=/api/v1/models/monet');await expect(page.locator('#editor-lock')).toBeVisible();expect(calls).toHaveLength(0);
    await connectModel(page);await ready(page);await expect(page.getByRole('textbox',{name:'params.0.title',exact:true})).toHaveValue('Claude Monet');
    const modelRequest=calls.find(call=>call.path==='/api/v1/models/monet');expect(modelRequest.headers.authorization).toBe('Bearer session-admin');
    const previewRequest=calls.find(call=>call.path.endsWith('/preview'));expect(previewRequest.headers.authorization).toBe('Bearer session-admin');
    expect(await previewValue(page,()=>window.previewTimeline?.localSource?.url)).toMatch(/^blob:/);
    expect(await previewValue(page,()=>JSON.stringify(window.previewTimeline?.modelDocument))).not.toContain('session-admin');
});

test('Access and filters use model-scoped friendly forms with conditional writes',async({page})=>{
    const calls=await workspaceServer(page);await page.goto('/openbexi_timeline_model.html?model=models/demos/monet.json');await ready(page);await connectModel(page);
    await page.getByRole('button',{name:'Access',exact:true}).click();await expect(page.getByRole('button',{name:'Remove access for alice',exact:true})).toBeDisabled();await page.locator('#grant-user').fill('bob');await page.locator('#grant-role').selectOption('readOnly');await page.getByRole('button',{name:'Add or update access',exact:true}).click();
    await expect(page.locator('#grant-role option[value="reviewer"]')).toHaveText('reviewer');
    await expect(page.locator('#model-grants')).toContainText('bob');const access=calls.find(call=>call.path.endsWith('/access') && call.method==='PUT');expect(access.headers['if-match']).toBe('"access1"');expect(access.body.grants).toContainEqual({userId:'bob',role:'readOnly'});
    await page.getByRole('button',{name:'Filters',exact:true}).click();await page.locator('#filter-name').fill('Planned work');await page.locator('#filter-expression').fill('planned');await page.getByRole('button',{name:'Save filter',exact:true}).click();await expect(page.locator('#notice')).toContainText('Saved filter');const filter=calls.find(call=>call.path.endsWith('/filters') && call.method==='POST');expect(filter.body.query.search).toBe('planned');expect(filter.body.visibility).toBe('personal');expect(filter.headers['if-match']).toBe('"data1"');
});

test('Managed model save updates its resource and history, preserves a conflicting draft, and refreshes filter revision',async({page})=>{
    const calls=await workspaceServer(page);await page.goto('/openbexi_timeline_model.html?model=models/demos/monet.json');await ready(page);await connectModel(page);
    await page.locator('#workspace-model').selectOption('monet');
    await expect(page.locator('#document-source')).toHaveText('Managed model');await expect(page.locator('#document-revision')).toContainText('data1');
    await page.getByRole('textbox',{name:'params.0.title',exact:true}).fill('Saved model title');await page.locator('#save').click();
    await expect(page.locator('#dirty')).toHaveText('Saved on server');await expect(page.locator('#document-revision')).toContainText('data2');await expect(page.locator('#version-list')).toContainText('saved2');
    const saved=calls.find(call=>call.path==='/api/v1/models/monet' && call.method==='PUT');expect(saved.headers['if-match']).toBe('"data1"');expect(saved.body.params[0].title).toBe('Saved model title');expect(calls.some(call=>call.path.endsWith('/config-files') && call.method==='POST')).toBe(false);
    await page.getByRole('button',{name:'Filters',exact:true}).click();await page.locator('#filter-name').fill('After save');await page.locator('#filter-expression').fill('planned');await page.getByRole('button',{name:'Save filter',exact:true}).click();await expect(page.locator('#notice')).toContainText('Saved filter');expect(calls.find(call=>call.path.endsWith('/filters') && call.method==='POST').headers['if-match']).toBe('"data2"');
    calls.modelConflict=true;await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('textbox',{name:'params.0.title',exact:true}).fill('Preserved conflicting draft');await page.locator('#save').click();
    await expect(page.locator('#errors')).toContainText('Your draft is preserved');await expect(page.locator('#dirty')).toHaveText('Unsaved changes');await expect(page.getByRole('textbox',{name:'params.0.title',exact:true})).toHaveValue('Preserved conflicting draft');await expect(page.locator('#version-list')).toContainText('saved2');
    calls.modelConflict=false;page.once('dialog',dialog=>dialog.accept());await page.locator('#documents').selectOption('model:monet');await expect(page.getByRole('textbox',{name:'params.0.title',exact:true})).toHaveValue('Saved model title');await expect(page.locator('#dirty')).toHaveText('Saved on server');
});

test('An accepted YAML model proposal saves a scoped file with original comments preserved',async({page})=>{
    const calls=await workspaceServer(page),model=JSON.parse(await fs.readFile('models/demos/monet.json','utf8'));model.params[0].title='YAML original';
    await page.route('**/api/v1/models/monet/ai/generate',async route=>{
        const request=route.request().postDataJSON();expect(request.document.format).toBe('yaml');
        const proposed=structuredClone(model);proposed.params[0].title='YAML reviewed';
        await route.fulfill({json:{requestId:request.requestId,proposal:{kind:'model',format:'yaml',text:JSON.stringify(proposed,null,2)},validation:{valid:true,errors:[]}}});
    });
    await page.goto('/openbexi_timeline_model.html?model=models/demos/monet.json');await ready(page);await connectModel(page);
    await page.locator('#file').setInputFiles({name:'model-with-comments.yml',mimeType:'application/yaml',buffer:Buffer.from('# Keep this model comment\n'+JSON.stringify(model,null,2)+'\n')});
    await expect(page.locator('#document-name')).toHaveText('model-with-comments.yml');await page.locator('#ai-panel summary').click();await page.locator('#ai-generate').click();await expect(page.locator('#ai-status')).toContainText('Validated proposal');await page.locator('#ai-accept').click();
    expect(await page.evaluate(()=>window.modelEditor.document.text)).toContain('# Keep this model comment');expect(calls.some(call=>call.method==='POST' && call.path.endsWith('/config-files'))).toBe(false);
    await page.locator('#save').click();await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.locator('#dirty')).toHaveText('Saved on server');
    const saved=calls.find(call=>call.method==='POST' && call.path.endsWith('/config-files'));expect(saved.path).toBe('/api/v1/models/monet/config-files');expect(saved.body.kind).toBe('yaml');expect(saved.body.text).toContain('# Keep this model comment');expect(saved.body.text).toContain('YAML reviewed');
});

test('A delayed managed save preserves invalid Advanced text entered during the request',async({page})=>{
    await workspaceServer(page);let release,started=false;
    await page.route('**/api/v1/models/monet',async route=>{
        if(route.request().method()!=='PUT')return route.fallback();
        started=true;const saved=route.request().postDataJSON();await new Promise(resolve=>{release=resolve;});await route.fulfill({json:saved,headers:{ETag:'"data2"'}});
    });
    await page.goto('/openbexi_timeline_model.html?modelId=monet');await connectModel(page);await ready(page);
    await page.getByRole('textbox',{name:'params.0.title',exact:true}).fill('Saved snapshot');await page.locator('#save').click();await expect.poll(()=>started).toBe(true);
    await page.getByRole('tab',{name:'Advanced text'}).click();await page.locator('#raw').fill('{ unfinished user edit');await expect(page.locator('#errors')).toBeVisible();release();
    await expect(page.locator('#notice')).toContainText('Model saved');await expect(page.locator('#raw')).toHaveValue('{ unfinished user edit');await expect(page.locator('#dirty')).toHaveText('Unsaved changes');await expect(page.locator('#save')).toBeDisabled();
});
