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
