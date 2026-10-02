import {EditorDocument, ConfigFileClient, DocumentOpenGate, documentKind, resolveSchema, schemaDefault, YAML_SCHEMA, yamlType, validateYamlConfiguration} from './openbexi_timeline_model_editor_document.js';
import {buildDefaultModel} from './openbexi_timeline_model_startup.js';
import {validateDemoModel,validateLegacyModel} from './openbexi_timeline_model_validation.js';
import {EDITOR_AREAS, propertyArea, isModelConfiguration, isScopedApiUrl, validateConfiguration, assertRecordsUnchanged, ConfigurationReview, ModelWorkspaceClient} from './openbexi_timeline_model_editor_workspace.js';
import {createEditorApplyClient} from './openbexi_timeline_model_link.js';

const appRoot=new URL('../',import.meta.url);
const $=id=>document.getElementById(id);
const state={catalog:[],schemas:{},document:null,record:null,context:{},client:null,managed:[],locals:[],revision:0,valid:false,rawInvalid:false,area:'overview',workspace:null,identity:null,modelId:'',access:null,accessEtag:null,filters:[],providers:[],aiReview:null,aiRequest:null,aiImage:null,previewCandidate:null,requiredModelId:new URLSearchParams(location.search).get('modelId') || ''};
const documentOpen=new DocumentOpenGate();
const documentControls=()=>document.querySelectorAll('.document-bar button,.document-bar select,.document-state button,#editing-actions button');
let previewTimer,rawTimer,previewFrame,pendingFrame,pendingPayload,previewTimeout;
function retireFrame(frame){if(!frame)return;try{frame.contentWindow?.disposePreview?.();}catch{ /* A frame may still be navigating. */ }if(frame.dataset.previewBlob)URL.revokeObjectURL(frame.dataset.previewBlob);frame.remove();}
const clone=value=>structuredClone(value);
const status=message=>{$('notice').textContent=message;};
const fail=(error,invalid=false)=>{$('errors').hidden=false;$('errors').textContent=error.message || String(error);if(invalid)state.valid=false;updateState();};
const clearErrors=()=>{$('errors').hidden=true;$('errors').textContent='';};
function button(text,action,label) {const el=document.createElement('button');el.type='button';el.textContent=text;if(label)el.setAttribute('aria-label',label);el.addEventListener('click',action);return el;}
async function ask(title,label,value='',help='',password=false) {
    const dialog=$('input-dialog');$('dialog-title').textContent=title;$('dialog-label').textContent=label;$('dialog-input').value=value;
    $('dialog-input').type=password?'password':'text';$('dialog-help').textContent=help;dialog.returnValue='';dialog.showModal();$('dialog-input').focus();
    return new Promise(resolve=>dialog.addEventListener('close',()=>{const result=dialog.returnValue==='ok'?$('dialog-input').value.trim():null;$('dialog-input').value='';resolve(result);},{once:true}));
}
function unsaved() {return state.rawInvalid || state.document?.dirty;}
function canLeave() {return !unsaved() || confirm('Discard unsaved changes to this document?');}
function canEdit(){return state.workspace?Boolean(state.modelId?state.access?.permissions?.admin:state.identity?.systemAdmin):!state.requiredModelId;}
function requireEditor(){if(!canEdit())throw new Error('A model administrator must authorize this editor.');}
function configureLaunch(query) {
    // Keep this mode for the editor's lifetime, even when opening a saved version
    // replaces the preview context. A query value conveys no authentication.
    const mode=query.get('launch') || state.context.launchMode || (state.context.providerUrl && !state.context.demoId?'connected':'standalone');
    state.focused=mode==='connected';
    document.body.dataset.editorLaunch=state.focused?'connected':'full';
    $('document-management').hidden=state.focused;
    $('editing-actions').hidden=!state.focused;
    if(!state.focused)return;
    $('editor-lock').textContent='Only model administrators can use this editor. Connect with an administrator token authorized for this model.';
    // Move the existing controls and listeners, keeping one source of truth for
    // saving, validation, history and permission state.
    $('editing-actions').append(...['save','export','undo','redo','revert','dirty'].map($));
    let frame;
    const layout=()=>{
        cancelAnimationFrame(frame);
        frame=requestAnimationFrame(()=>{
            const workspace=document.querySelector('.editor-workspace');
            const top=workspace.getBoundingClientRect().top+window.scrollY;
            workspace.style.height=window.innerWidth>700?Math.max(520,window.innerHeight-top-16)+'px':'';
        });
    };
    const observer=new ResizeObserver(layout);
    for(const element of [document.querySelector('.editor-heading'),$('editing-actions'),$('notice'),$('editor-lock')])observer.observe(element);
    window.addEventListener('resize',layout);
    window.addEventListener('pagehide',()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',layout);},{once:true});
    layout();
}
function updateState() {
    const record=state.record, doc=state.document;
    for(const control of documentControls())control.disabled=false;
    $('document-name').textContent=record?.name || 'No document';
    $('document-source').textContent=record?.apiModel?'Managed model':record?.managed?'Server document':record?.example?'Read-only example · edit a copy':'Local draft';
    $('dirty').textContent=unsaved()?'Unsaved changes':record?.managed?'Saved on server':state.focused?'Unchanged':record?.example?'Original example':'Draft';
    $('save').textContent=record?.managed && state.client?'Save to server':state.client?'Save as server copy':'Export changes';
    $('save').title=record?.name?$('save').textContent+': '+record.name:$('save').textContent;
    $('save').disabled=!state.valid || Boolean(state.client && state.yamlValidation?.supported===false);$('export').disabled=!state.valid;
    $('delete').disabled=!record || Boolean(record.example);
    if(record?.apiModel){$('rename').disabled=true;$('delete').disabled=true;}
    if(record?.managed && !state.client)$('delete').disabled=true;
    $('use-data').disabled=doc?.kind!=='model' || !doc?.value?.dataSource;
    $('undo').disabled=!doc?.history.length;$('redo').disabled=!doc?.future.length;
    $('revert').disabled=!unsaved();
    const locked=!canEdit();$('editor-lock').hidden=!locked;
    $('raw').readOnly=locked;
    document.querySelector('.property-panel').inert=locked;
    document.querySelector('.preview-panel').inert=locked;
    for(const control of documentControls())if(locked)control.disabled=true;
    $('document-revision').textContent=record?.revision?`Revision ${record.revision}`:record?.etag?`Revision ${record.etag}`:record?.managed?'Saved document':'Local draft';
    $('publication-state').textContent=record?.restartRequired?'Restart required':record?.published?'Published':record?.managed?'Saved · not published':'Not published';
    updateAiControls();
}
function schemaFor() {return state.document.kind==='yaml' && !isModelConfiguration(state.document.value)?YAML_SCHEMA:state.document.value.dataSource?state.schemas.demo:state.schemas.provider || state.schemas.demo;}
function validate() {
    try {
        if(state.rawInvalid){clearTimeout(rawTimer);state.document.replace($('raw').value);state.rawInvalid=false;}
        const doc=state.document,value=doc.value;
        state.yamlValidation=null;
        state.yamlValidation=validateConfiguration(doc);
        if(state.yamlValidation?.diagnostic)status(state.yamlValidation.diagnostic);
        clearErrors();state.valid=true;state.rawInvalid=false;updateState();return true;
    } catch(error) {fail(error,true);return false;}
}
function changed({form=false}={}) {
    documentOpen.invalidate();
    state.previewCandidate=null;$('raw').value=state.document.text;
    if(form)renderForm();
    if(validate())schedulePreview();
    updateState();
}
function mutate(path,value,remove=false) {
    documentOpen.invalidate();
    try {requireEditor();state.document.mutate(path,value,remove);changed({form:remove});}catch(error){fail(error);}
}
function prettyName(key) {return String(key).replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');}
function colorHex(value){const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');context.fillStyle=value;context.fillRect(0,0,1,1);return '#'+Array.from(context.getImageData(0,0,1,1).data).slice(0,3).map(channel=>channel.toString(16).padStart(2,'0')).join('');}
function renderForm() {
    const root=schemaFor() || {},host=$('properties');host.replaceChildren();
    if(state.document.kind==='yaml' && yamlType(state.document.value)==='other'){
        const info=document.createElement('p');info.className='property-description';info.textContent='Unrecognized YAML configuration type. Existing properties remain editable and are preserved. You can export this document; the configuration server cannot save it.';host.append(info);
    }
    function render(value,schema,path,label,required=false) {
        schema=resolveSchema(schema,root,value);const field=document.createElement('div');
        field.dataset.path=path.join('.');
        if(value!==null && typeof value==='object') {
            const details=document.createElement('details');details.className='property-group';details.open=path.length<2 || path[0]==='params' || (path[0]==='rendering' && path.length<=2);
            const summary=document.createElement('summary');summary.textContent=prettyName(label)+(Array.isArray(value)?` (${value.length})`:'');summary.title=path.join('.') || 'Document';details.append(summary);
            if(schema.description){const p=document.createElement('p');p.className='property-description';p.textContent=schema.description;details.append(p);}
            if(Array.isArray(value)) {
                value.forEach((item,index)=>{
                    const row=document.createElement('div');row.className='array-item';
                    const actions=document.createElement('div');actions.className='group-actions';
                    const title=item?.name || item?.namespace || item?.title || `${label} ${index+1}`;
                    const up=button('↑',()=>{state.document.move(path,index,index-1);changed({form:true});},`Move ${title} up`);up.disabled=index===0;
                    const down=button('↓',()=>{state.document.move(path,index,index+1);changed({form:true});},`Move ${title} down`);down.disabled=index===value.length-1;
                    const remove=button('Remove',()=>mutate([...path,index],undefined,true),`Remove ${title}`);remove.disabled=value.length<=(schema.minItems || 0);
                    actions.append(up,down,remove);row.append(actions,render(item,schema.items || {},[...path,index],title,true));details.append(row);
                });
                if(!schema.maxItems || value.length<schema.maxItems)details.append(button('Add item',()=>{
                    const item=schemaDefault(schema.items || {},root);
                    if(item && typeof item==='object' && !Array.isArray(item) && 'name' in item)item.name='band_'+(value.length+1);
                    state.document.mutate([...path,value.length],item);changed({form:true});
                },'Add item to '+path.join('.')));
            } else {
                Object.entries(value).forEach(([key,child])=>details.append(render(child,schema.properties?.[key] || (typeof schema.additionalProperties==='object'?schema.additionalProperties:{}),[...path,key],key,schema.required?.includes(key))));
                const missing=Object.keys(schema.properties || {}).filter(key=>!(key in value) && key!=='$schema');
                if(missing.length){
                    const controls=document.createElement('div');controls.className='optional-control';const select=document.createElement('select');select.setAttribute('aria-label','Optional property in '+(path.join('.') || 'model'));
                    const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Add optional property…';select.append(placeholder);
                    missing.forEach(key=>{const option=document.createElement('option');option.value=key;option.textContent=prettyName(key);select.append(option);});
                    controls.append(select,button('Add',()=>{if(select.value){state.document.mutate([...path,select.value],schemaDefault(schema.properties[select.value],root));changed({form:true});}},'Add optional property to '+(path.join('.') || 'model')));details.append(controls);
                }
                if(state.document.kind==='yaml' || schema.additionalProperties!==false){details.append(button('Add custom property',async()=>{
                    const key=await ask('Add property','Property name');if(!key)return;
                    if(Object.hasOwn(value,key)){status('This property already exists.');return;}
                    mutate([...path,key],'');renderForm();
                },'Add custom property to '+(path.join('.') || 'document')));}
            }
            if(path.length && !required && !Array.isArray(path.at(-1)) && typeof path.at(-1)!=='number')details.append(button('Remove section',()=>mutate(path,undefined,true),'Remove '+path.join('.')));
            field.append(details);return field;
        }
        field.className='property-field';const id='field-'+path.map(String).join('-');const labelElement=document.createElement('label');labelElement.htmlFor=id;labelElement.textContent=prettyName(label);labelElement.title=path.join('.');
        const controls=document.createElement('div');controls.className='field-controls';let input;
        if(schema.enum || schema.const!==undefined){input=document.createElement('select');const choices=schema.enum || [schema.const];if(!choices.includes(value))choices.includes(value)||input.append(new Option(String(value),String(value)));for(const option of choices)input.append(new Option(String(option),String(option)));input.value=String(value);input.addEventListener('change',()=>mutate(path,choices.find(choice=>String(choice)===input.value) ?? input.value));}
        else if(typeof value==='boolean'){input=document.createElement('input');input.type='checkbox';input.checked=value;input.addEventListener('change',()=>mutate(path,input.checked));}
        else {input=document.createElement('input');input.type=typeof value==='number'?'number':/password|secret|token|credential|sasl/i.test(String(label))?'password':'text';input.value=value===null?'null':String(value);
            if(input.type==='number'){input.step=schema.type==='integer'?'1':'any';if(schema.minimum!==undefined)input.min=schema.minimum;if(schema.maximum!==undefined)input.max=schema.maximum;}
            input.addEventListener('input',()=>{
                if(input.type==='number' && (input.value==='' || !Number.isFinite(Number(input.value)))){fail(new Error(path.join('.')+' needs a finite number.'),true);return;}
                mutate(path,input.type==='number'?Number(input.value):input.value==='null' && (value===null || schema.type?.includes?.('null'))?null:input.value);
            });
            if(typeof value==='string' && /color|background|stroke|fill/i.test(String(label)) && CSS.supports('color',value)){
                const color=document.createElement('input');color.type='color';color.value=colorHex(value);color.setAttribute('aria-label',path.join('.')+' color picker');
                color.addEventListener('input',()=>{input.value=color.value;mutate(path,color.value);});controls.append(color);
            }
        }
        input.id=id;input.dataset.property=path.join('.');input.setAttribute('aria-label',path.join('.'));controls.append(input);
        if(!required && typeof path.at(-1)!=='number'){const remove=button('×',()=>mutate(path,undefined,true),'Remove '+path.join('.'));remove.className='remove';controls.append(remove);}
        field.append(labelElement,controls);
        if(schema.description){const description=document.createElement('p');description.className='property-description';description.textContent=schema.description;field.append(description);}
        return field;
    }
    Object.entries(state.document.value).forEach(([key,value])=>{const field=render(value,root.properties?.[key] || {},[key],key,root.required?.includes(key));field.dataset.area=propertyArea(key);host.append(field);});
    const missing=Object.keys(root.properties || {}).filter(key=>!(key in state.document.value) && key!=='$schema');
    if(missing.length){const select=document.createElement('select');select.setAttribute('aria-label','Optional root property');select.append(new Option('Add model section…',''));missing.forEach(key=>select.append(new Option(prettyName(key),key)));host.append(select,button('Add section',()=>{if(select.value){state.area=propertyArea(select.value);state.document.mutate([select.value],schemaDefault(root.properties[select.value],root));changed({form:true});}}));}
    filterProperties();
}
function filterProperties(){const term=$('property-filter').value.trim().toLowerCase();for(const field of $('properties').querySelectorAll('.property-field'))field.hidden=Boolean(term && !field.dataset.path.toLowerCase().includes(term));for(const field of $('properties').querySelectorAll(':scope > [data-area]'))field.hidden=!term && field.dataset.area!==state.area;if(term)for(const details of $('properties').querySelectorAll('details'))details.open=true;renderArea();}

function fillDocuments() {
    const selector=$('documents');selector.replaceChildren(new Option('Choose an example or document…',''));
    function group(label,items,prefix){if(!items.length)return;const element=document.createElement('optgroup');element.label=label;for(const item of items)element.append(new Option(item.title || item.name,prefix+(item.id || item.key)));selector.append(element);}
    if(state.modelId && canEdit())group('Managed model',[{id:state.modelId,name:state.modelId+' (reload saved model)'}],'model:');
    group('Public demos',state.catalog,'demo:');group('Server documents',state.managed,'server:');group('Local drafts',state.locals,'local:');
    if(state.record?.selection)selector.value=state.record.selection;
}
function openDocument(text,record,intent=documentOpen.begin(state.document),context=state.context) {
    if(!documentOpen.accepts(intent,state.document))return false;
    const next=new EditorDocument(text,record.kind || documentKind(record.name,text));
    cancelAiRequest();state.aiReview=null;state.previewCandidate=null;$('ai-review').hidden=true;state.area='overview';
    documentOpen.invalidate();clearTimeout(rawTimer);clearTimeout(previewTimer);clearTimeout(previewTimeout);
    retireFrame(pendingFrame);pendingFrame=null;pendingPayload=null;state.revision++;
    state.document=next;state.record=record;state.context=context;state.rawInvalid=false;
    $('raw').value=text;$('property-filter').value='';fillDocuments();renderForm();validate();schedulePreview(true);updateState();
    return true;
}
async function fetchText(url) {const target=new URL(url,appRoot),authorized=canEdit() && state.workspace && state.modelId && isScopedApiUrl(target.href,state.workspace.baseURL,state.modelId);const response=await fetch(target,authorized?{headers:{Authorization:'Bearer '+state.workspace.token},cache:'no-store'}:{});if(!response.ok)throw new Error(`Unable to open ${url}: HTTP ${response.status}.`);return response.text();}
async function openDemo(id,intent=documentOpen.begin(state.document)){
    const entry=state.catalog.find(demo=>demo.id===id);if(!entry)return false;
    const text=await fetchText(entry.model);
    if(!documentOpen.accepts(intent,state.document))return false;
    $('preview-data').value='document';
    return openDocument(text,{name:entry.model,kind:'model',example:true,modelPath:new URL(entry.model,appRoot).href,selection:'demo:'+id},intent,{dataset:new URL(entry.dataset,appRoot).href});
}
async function refreshServer(client=state.client){if(!client)return;const result=await client.request();if(state.client!==client)return;state.managed=result.document.items || [];fillDocuments();}
async function openManagedModel(id,intent=documentOpen.begin(state.document)){
    requireEditor();const client=state.workspace,result=await client.model(id);
    if(client!==state.workspace || id!==state.modelId)return false;
    if(!result.etag)throw new Error('The server did not provide a model revision. Reload before editing.');
    $('preview-data').value='document';
    return openDocument(JSON.stringify(result.data,null,2)+'\n',{name:id+'.json',kind:'model',managed:true,apiModel:id,etag:result.etag,modelPath:client.baseURL+'/'+client.modelPath(id),selection:'model:'+id},intent,{});
}

async function previewPayload() {
    const selected=$('preview-data').value,doc=state.previewCandidate || state.document;let model=clone(doc.value),modelPath=state.record.modelPath,options={},previewBlob;
    if(doc.kind==='yaml' && !isModelConfiguration(model)) {
        if(typeof model.model==='string' && model.model.trim()){modelPath=new URL(model.model,appRoot).href;model=JSON.parse(await fetchText(modelPath));}
        else if(selected==='document'){model=buildDefaultModel();modelPath=undefined;}
        else model=null;
        status('YAML preview shows its referenced model. Source connections, permissions and server settings apply after a validated save and server restart.');
    }
    if(selected!=='document') {
        const entry=state.catalog.find(demo=>demo.id===selected),reference=JSON.parse(await fetchText(entry.model));
        if(!model)model=reference;
        else if(!model.dataSource)options.previewSource=reference.dataSource;
        options.dataset=new URL(entry.dataset,appRoot).href;
    } else if(model.dataSource) {
        if(state.workspace && state.modelId && canEdit()){
            const text=await fetchText(state.workspace.baseURL+'/'+state.workspace.modelPath(state.modelId,'preview'));
            previewBlob=URL.createObjectURL(new Blob([text],{type:'application/json'}));options.dataset=previewBlob;
        }
        else if(model.dataSource.url)options.dataset=new URL(model.dataSource.url,appRoot).href;
        else if(state.context.dataset)options.dataset=state.context.dataset;
        else {
            const referencedDemo=modelPath && state.catalog.find(demo=>new URL(demo.model,appRoot).href===new URL(modelPath,appRoot).href);
            if(referencedDemo)options.dataset=new URL(referencedDemo.dataset,appRoot).href;
            else throw new Error('Choose preview data, or add dataSource.url to this model. The preview data menu includes every public demo.');
        }
    } else {
        const provider=state.context.providerUrl || model.params?.[0]?.data;
        if(provider)options.providerUrl=new URL(provider,appRoot).href;else options.offline=true;
    }
    return {type:'ob-model-preview',model,options,modelPath,previewBlob,previewState:state.context.previewState,revision:state.revision};
}
function schedulePreview(force=false) {
    clearTimeout(previewTimer);
    if(!state.valid || (!force && !$('live').checked))return;
    previewTimer=setTimeout(()=>refreshPreview(),force?0:350);
}
async function refreshPreview() {
    if(!canEdit() || (!state.valid && !state.previewCandidate))return;
    const revision=++state.revision;$('preview-state').textContent='Updating preview…';
    try {
        const payload=await previewPayload();if(revision!==state.revision){if(payload.previewBlob)URL.revokeObjectURL(payload.previewBlob);return;}
        payload.revision=revision;pendingPayload=payload;
        retireFrame(pendingFrame);clearTimeout(previewTimeout);
        pendingFrame=document.createElement('iframe');pendingFrame.title='Interactive live timeline preview';pendingFrame.style.opacity='0';pendingFrame.style.pointerEvents='none';
        if(payload.previewBlob)pendingFrame.dataset.previewBlob=payload.previewBlob;
        pendingFrame.src=new URL('openbexi_timeline_model_preview.html',appRoot).href;$('preview-host').append(pendingFrame);
        previewTimeout=setTimeout(()=>{if(pendingPayload?.revision===revision){retireFrame(pendingFrame);pendingFrame=null;$('preview-state').textContent='Preview timed out. The last valid preview is retained.';}},30000);
    } catch(error){if(revision===state.revision)$('preview-state').textContent=error.message;}
}
window.addEventListener('message',event=>{
    if(event.origin!==location.origin || event.source!==pendingFrame?.contentWindow)return;
    if(event.data?.type==='ob-model-preview-ready'){pendingFrame.contentWindow.postMessage(pendingPayload,location.origin);return;}
    if(event.data?.revision!==state.revision)return;
    if(event.data?.type==='ob-model-preview-rendered'){
        clearTimeout(previewTimeout);retireFrame(previewFrame);previewFrame=pendingFrame;pendingFrame=null;previewFrame.style.opacity='1';previewFrame.style.pointerEvents='auto';
        $('preview-state').textContent=`Live · ${event.data.title}${event.data.count===undefined?'':` · ${event.data.count} records`} · preview ${state.revision}`;
        $('preview-host').dataset.revision=String(state.revision);$('preview-host').dataset.state='ready';
    } else if(event.data?.type==='ob-model-preview-error'){
        clearTimeout(previewTimeout);retireFrame(pendingFrame);pendingFrame=null;$('preview-state').textContent='Preview error: '+event.data.error+' The last valid preview is retained.';
    }
});

function exportDocument(){
    requireEditor();if(!validate())return;const blob=new Blob([state.document.text],{type:state.document.kind==='yaml'?'application/yaml':'application/json'});
    const anchor=document.createElement('a');anchor.href=URL.createObjectURL(blob);anchor.download=state.record.name.split(/[\\/]/).at(-1);anchor.click();setTimeout(()=>URL.revokeObjectURL(anchor.href),1000);
    status('Downloaded '+anchor.download+'. The server and active timeline were not changed.');
}
async function saveDocument(){
    requireEditor();if(!validate())return;if(!state.client){exportDocument();return;}
    if(state.yamlValidation?.supported===false){status(state.yamlValidation.diagnostic);return;}
    const record=state.record,sourceDocument=state.document;
    if(record.apiModel){
        const client=state.workspace,id=record.apiModel,text=sourceDocument.text;
        if(id!==state.modelId)throw new Error('Select this model before saving its configuration.');
        if(!record.etag)throw new Error('Reload the saved model to obtain its current revision.');
        let result;
        try{result=await client.model(id,'',{method:'PUT',body:clone(sourceDocument.value),etag:record.etag});}
        catch(error){if(error.status===412)throw new Error('This model changed on the server. Your draft is preserved. Export it, then choose the managed model in Documents to reload and reconcile changes.');throw error;}
        sourceDocument.savedText=text;
        if(state.document===sourceDocument && client===state.workspace && id===state.modelId){
            state.record={...record,etag:result.etag};
            if(sourceDocument.text===text && !state.rawInvalid){sourceDocument.replace(JSON.stringify(result.data,null,2)+'\n',false);sourceDocument.saved();$('raw').value=sourceDocument.text;renderForm();}
            updateState();
        }
        if(client===state.workspace && id===state.modelId){
            await Promise.all([loadFilters().catch(error=>{$('filters-help').textContent=error.message;}),loadVersions().catch(error=>{$('version-list').textContent=error.message;})]);
            status(result.historyWarning || 'Model saved. Saved versions and filter revision refreshed. Reload a timeline to use the saved configuration.');
        }
        return;
    }
    let name=record.managed?record.name:await ask('Save a server copy','File name',record.name.split(/[\\/]/).at(-1),'The server stores this document in its managed configuration directory.');if(!name)return;
    const body={name,kind:sourceDocument.kind,text:sourceDocument.text};
    const result=await state.client.request(record.managed?record.id:'',{method:record.managed?'PUT':'POST',body,etag:record.etag});
    if(state.document!==sourceDocument){await refreshServer();status('Saved '+name+' on the server.');return;}
    state.record={...result.document,managed:true,etag:result.etag,selection:'server:'+result.document.id};sourceDocument.savedText=body.text;await refreshServer();updateState();
    status(result.document.restartRequired?'Saved on server. Restart the server to activate this YAML configuration.':'Saved on server. The preview is current; reopen or reload a timeline to use the saved model.');
}
async function renameDocument(){
    const record=state.record,sourceDocument=state.document,client=state.client;
    if(record.apiModel)return;
    if(record.example){status('Duplicate this read-only example before renaming.');return;}
    if(record.managed && !client){status('Connect to the server before renaming this document.');return;}
    if(record.managed && unsaved()){status('Save changes before renaming this server document.');return;}
    const name=await ask('Rename document','File name',record.name);if(!name)return;
    if(record.managed){
        const body={name,kind:sourceDocument.kind,text:sourceDocument.text};
        const result=await client.request(record.id,{method:'PUT',body,etag:record.etag});
        sourceDocument.savedText=body.text;
        if(state.document===sourceDocument)state.record={...record,...result.document,etag:result.etag,selection:'server:'+result.document.id};
        await refreshServer(client);
    } else {
        if(state.document===sourceDocument)state.record.name=name;
        const local=state.locals.find(item=>item.key===record.key);if(local)local.name=name;fillDocuments();
    }
    updateState();status('Renamed document to '+name+'.');
}
async function deleteDocument(){
    const record=state.record,sourceDocument=state.document,client=state.client;
    if(record.apiModel)return;
    if(record.example || (record.managed && !client))return;
    if(!confirm('Delete '+record.name+'? The server checks for configuration references before deleting a managed file.'))return;
    if(record.managed){await client.request(record.id,{method:'DELETE',etag:record.etag});await refreshServer(client);}
    else state.locals=state.locals.filter(item=>item.key!==record.key);
    if(state.document===sourceDocument)await openDemo(state.catalog[0].id);else fillDocuments();
    status('Deleted '+record.name+'.');
}
function renderArea(){
    const help={overview:'Name, timeline settings and saved versions. Changes stay in your draft until you save.',data:'Sources and field mappings. Existing session and event records, including their metadata, remain unchanged.',appearance:'Bands, colors, labels, overview, tables and 2D/3D settings. Uncommon settings are expandable.',filters:'Configuration filters and saved filters belong to the selected model.',access:'Only administrators edit model definitions and YAML. Reader and writer roles use the timeline.'};
    $('area-help').textContent=help[state.area];
    for(const tab of document.querySelectorAll('.area-nav button')){tab.setAttribute('aria-pressed',String(tab.dataset.area===state.area));tab.tabIndex=tab.dataset.area===state.area?0:-1;}
    $('version-summary').hidden=state.area!=='overview';$('version-history').hidden=state.area!=='overview' || !state.modelId || !canEdit();
    $('filter-management').hidden=state.area!=='filters';$('access-management').hidden=state.area!=='access';
}
function selectArea(area){if(!EDITOR_AREAS.includes(area))return;state.area=area;$('property-filter').value='';filterProperties();}
function renderWorkspace(){
    $('workspace-role').textContent=state.workspace?(state.modelId?`${state.access?.role || 'No access'} · ${state.access?.workspaceId || state.modelId}`:state.identity?.systemAdmin?'System configuration administrator':'Select a model'):'Local editing';
    $('grant-form').hidden=!state.modelId || !canEdit();$('filter-form').hidden=!state.modelId || !canEdit();
    const chosenRole=$('grant-role').value,roles=new Map([['readOnly','Read only'],['readWrite','Read / write'],['admin','Administrator']]);
    for(const role of state.access?.roles || []){const id=typeof role==='string'?role:role.id || role.name;if(id)roles.set(id,typeof role==='string'?role:role.name || id);}
    $('grant-role').replaceChildren(...[...roles].map(([id,name])=>new Option(name,id)));if(roles.has(chosenRole))$('grant-role').value=chosenRole;
    $('model-grants').replaceChildren();
    for(const grant of state.access?.grants || []){
        const row=document.createElement('div');row.className='managed-row';const label=document.createElement('span');label.textContent=`${grant.userId} · ${grant.role}`;
        const remove=button('Remove',()=>saveAccess(state.access.grants.filter(item=>item.userId!==grant.userId)).catch(fail),`Remove access for ${grant.userId}`);
        remove.disabled=!canEdit() || grant.role==='admin' && state.access.grants.filter(item=>item.role==='admin').length===1;
        row.append(label,remove);$('model-grants').append(row);
    }
    if(state.modelId)$('access-help').textContent='Access applies to this model only. Every model keeps at least one administrator. The server verifies workspace membership and concurrent changes.';
    $('model-filters').replaceChildren();
    for(const filter of state.filters){
        const row=document.createElement('div');row.className='managed-row';const label=document.createElement('span');label.textContent=filter.title || filter.id;
        row.append(label,button('Edit',()=>{state.selectedFilter=filter;$('filter-id').value=filter.id;$('filter-name').value=filter.title || '';$('filter-expression').value=filter.query?.search || '';$('filter-visibility').value=filter.visibility || 'shared';$('filter-sort').value=typeof filter.sortBy==='string'?filter.sortBy:JSON.stringify(filter.sortBy || []);},`Edit filter ${label.textContent}`),button('Delete',()=>deleteFilter(filter).catch(fail),`Delete filter ${label.textContent}`));$('model-filters').append(row);
    }
    renderArea();updateState();
}
async function loadFilters(){
    if(!state.workspace || !state.modelId || !canEdit())return;
    const client=state.workspace,id=state.modelId,result=await client.model(id,'filters');if(client!==state.workspace || id!==state.modelId)return;
    state.filters=result.data.items || [];state.filtersEtag=result.etag;renderWorkspace();
}
async function saveFilter(event){
    event.preventDefault();requireEditor();const id=$('filter-id').value || crypto.randomUUID();
    const filter={...(state.selectedFilter || {}),id,title:$('filter-name').value.trim(),visibility:$('filter-visibility').value,query:{...(state.selectedFilter?.query || {}),search:$('filter-expression').value.trim()}};
    const sorting=$('filter-sort').value.trim(),previousSorting=typeof state.selectedFilter?.sortBy==='string'?state.selectedFilter.sortBy:JSON.stringify(state.selectedFilter?.sortBy || []);
    if(sorting && sorting!==previousSorting)filter.sortBy=sorting;else if(!sorting)delete filter.sortBy;
    if(!filter.query.search)delete filter.query.search;
    const existing=Boolean($('filter-id').value),resource='filters'+(existing?'/'+encodeURIComponent(id):'');
    const priorEtag=state.filtersEtag,result=await state.workspace.model(state.modelId,resource,{method:existing?'PUT':'POST',body:filter,etag:priorEtag});
    if(state.record?.apiModel===state.modelId && state.record.etag===priorEtag)state.record.etag=result.etag;
    resetFilterForm();await loadFilters();status('Saved filter for this model. The configuration draft is unchanged.');
}
function resetFilterForm(){state.selectedFilter=null;$('filter-form').reset();$('filter-id').value='';}
async function deleteFilter(filter){requireEditor();if(!confirm(`Delete filter ${filter.title || filter.id}?`))return;const priorEtag=state.filtersEtag,result=await state.workspace.model(state.modelId,'filters/'+encodeURIComponent(filter.id),{method:'DELETE',etag:priorEtag});if(state.record?.apiModel===state.modelId && state.record.etag===priorEtag)state.record.etag=result.etag;await loadFilters();}
async function saveAccess(grants){
    requireEditor();if(!grants.some(grant=>grant.role==='admin'))throw new Error('Keep at least one model administrator.');
    const client=state.workspace,id=state.modelId,result=await client.model(id,'access',{method:'PUT',body:{workspaceId:state.access.workspaceId,grants},etag:state.accessEtag});
    if(client!==state.workspace || id!==state.modelId)return;
    state.access=result.data;state.accessEtag=result.etag;renderWorkspace();status('Model access saved.');
}
async function loadVersions(){
    if(!state.modelId || !canEdit())return;
    const client=state.workspace,id=state.modelId,result=await client.model(id,'versions');if(client!==state.workspace || id!==state.modelId)return;
    $('version-list').replaceChildren();
    for(const version of result.data.items || []){
        const row=document.createElement('div');row.className='managed-row';const label=document.createElement('span');label.textContent=`${version.savedAt || 'Baseline'} · ${version.revision?.slice(0,12) || version.id || ''}`;
        row.append(label,button('Open as draft',async()=>{try{requireEditor();if(!canLeave())return;const intent=documentOpen.begin(state.document),loaded=await client.model(id,'versions/'+encodeURIComponent(version.revision || version.id));if(client!==state.workspace || id!==state.modelId)return;const text=JSON.stringify(loaded.data.configuration,null,2)+'\n',key=crypto.randomUUID(),record={key,name:`${id}-version.json`,kind:'model',text,selection:'local:'+key};if(openDocument(text,record,intent,{})){state.locals.push(record);fillDocuments();status('Opened the saved configuration as a local draft. Review and save separately.');}}catch(error){fail(error);}},'Open saved version '+(version.revision || version.id)));$('version-list').append(row);
    }
}
async function selectWorkspaceModel(id,{openModel=false}={}){
    cancelAiRequest();state.aiReview=null;state.previewCandidate=null;state.aiImage=null;$('ai-image').value='';$('ai-image-name').textContent='Drop an image here or choose a file. Maximum 1 MiB.';$('ai-remove-image').hidden=true;$('ai-review').hidden=true;state.modelId=id;state.access=null;state.accessEtag=null;state.filters=[];state.providers=[];state.client=null;state.managed=[];
    const client=state.workspace;
    if(id){const result=await client.model(id,'access');if(client!==state.workspace || id!==state.modelId)return;state.access=result.data;state.accessEtag=result.etag;}
    if(canEdit()){
        state.client=new ConfigFileClient(client.baseURL+(id?'/models/'+encodeURIComponent(id):'')+'/config-files',client.token);
        await refreshServer();
        if(id && (openModel || state.pendingModelPath || state.record?.apiModel)){
            if(state.pendingModelPath && !isScopedApiUrl(new URL(state.pendingModelPath,appRoot).href,client.baseURL,id))throw new Error('The protected model URL must match the selected model.');
            if(await openManagedModel(id))state.pendingModelPath=null;
        }
        if(id)await Promise.all([loadFilters().catch(error=>{$('filters-help').textContent=error.message;}),loadAiProviders().catch(error=>{$('ai-availability').textContent=error.message;}),loadVersions().catch(error=>{$('version-list').textContent=error.message;})]);
        schedulePreview(true);
    }else{retireFrame(previewFrame);retireFrame(pendingFrame);previewFrame=pendingFrame=null;clearTimeout(previewTimer);$('preview-state').textContent='Model administrator access required.';}
    fillDocuments();renderWorkspace();
}
async function connectWorkspace(){
    if(state.workspace){cancelAiRequest();state.workspace=state.identity=state.access=state.client=null;state.requiredModelId='';state.modelId='';state.providers=[];state.managed=[];state.filters=[];$('connect').textContent='Connect to server';$('workspace-model').replaceChildren(new Option('Local examples and drafts',''));$('workspace-model').disabled=true;fillDocuments();renderWorkspace();schedulePreview(true);status('Disconnected. The session token was discarded.');return;}
    const token=await ask('Connect to the configuration server','Session or administrator token','','Kept in memory for this session. AI provider credentials stay on the server.',true);if(!token)return;
    const client=new ModelWorkspaceClient(new URL('api/v1',appRoot).href,token);let identity,models=[];
    try{identity=(await client.request('me')).data;models=(await client.request('models')).data.items || [];}catch(error){
        if(error.status!==404)throw error;
        // Older configuration servers authorize the global endpoint themselves.
        await new ConfigFileClient(client.baseURL+'/config-files',token).request();identity={systemAdmin:true,legacy:true};
    }
    state.workspace=client;state.identity=identity;$('workspace-model').replaceChildren();
    if(identity.systemAdmin)$('workspace-model').append(new Option('Shared system configuration',''));
    for(const model of models)$('workspace-model').append(new Option(model.title || model.name || model.modelId,model.modelId || model.id));
    $('workspace-model').disabled=!models.length;
    const id=state.requiredModelId || (identity.systemAdmin?'':models.find(model=>model.permissions?.admin)?.modelId || models[0]?.modelId || '');
    $('workspace-model').value=id;$('connect').textContent='Disconnect';await selectWorkspaceModel(id);status(canEdit()?'Connected. Saves are scoped to the selected model or system configuration.':'Connected. Only administrators can use this model editor.');
}
function selectedAiModel(){const provider=state.providers.find(item=>item.id===$('ai-provider').value);return provider?.models?.find(item=>item.id===$('ai-model').value);}
function updateAiControls(){
    const model=selectedAiModel(),busy=Boolean(state.aiRequest),supported=isModelConfiguration(state.document?.value),allowed=canEdit() && state.workspace && state.modelId && model && supported;
    for(const id of ['ai-explain','ai-generate','ai-repair'])$(id).disabled=!allowed || busy || Boolean(state.aiImage && !model?.capabilities?.vision);
    $('ai-provider').disabled=!state.providers.length || busy;$('ai-model').disabled=!state.providers.length || busy;$('ai-image').disabled=!allowed || busy || !model?.capabilities?.vision;
    $('ai-cancel').hidden=!busy;$('ai-accept').disabled=!state.aiReview || !state.aiReview.current || state.aiReview.document!==state.document || $('raw').value!==state.aiReview.baseRawText || busy;
    if(state.aiReview && $('ai-accept').disabled && !busy)$('ai-status').textContent='The draft changed. Request a new proposal before accepting changes.';
    if(model)$('ai-capabilities').textContent=`${model.capabilities?.vision?'Timeline images supported':'Text only'} · ${model.capabilities?.structuredOutput?'Structured output supported':'Candidate validation required'} · Streaming unavailable`;
    if(state.workspace && state.modelId && !supported)$('ai-availability').textContent='AI supports model definitions in JSON or YAML. Edit source, deployment and server YAML manually; their secrets are not submitted.';
}
function fillAiModels(){const provider=state.providers.find(item=>item.id===$('ai-provider').value);$('ai-model').replaceChildren();for(const model of provider?.models || [])$('ai-model').append(new Option(model.name || model.id,model.id));updateAiControls();}
async function loadAiProviders(){
    const client=state.workspace,id=state.modelId,result=await client.model(id,'ai/providers');if(client!==state.workspace || id!==state.modelId)return;
    state.providers=result.data.enabled?result.data.providers || []:[];$('ai-provider').replaceChildren();for(const provider of state.providers)$('ai-provider').append(new Option(provider.name || provider.id,provider.id));
    $('ai-availability').textContent=state.providers.length?'Choose a server-configured provider and model. AI suggestions require review.':'AI is not configured for this server. Continue editing manually.';fillAiModels();
}
async function selectAiImage(file){
    if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PNG, JPEG or WebP image.');if(file.size>1024*1024)throw new Error('Timeline images must be 1 MiB or smaller.');
    const reader=new FileReader();const dataUrl=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Unable to read image.'));reader.readAsDataURL(file);});
    state.aiImage={mimeType:file.type,dataBase64:String(dataUrl).split(',')[1]};$('ai-image-name').textContent=`${file.name} · ${Math.ceil(file.size/1024)} KiB · sent only with your next request`;$('ai-remove-image').hidden=false;updateAiControls();
}
function cancelAiRequest(){const request=state.aiRequest;if(!request)return;state.aiRequest=null;request.controller.abort();void request.client.model(request.modelId,'ai/cancel',{method:'POST',body:{requestId:request.id}}).catch(()=>{});$('ai-status').textContent='Request cancelled. Your draft is unchanged.';updateAiControls();}
async function requestAi(operation){
    requireEditor();const model=selectedAiModel();if(!state.modelId || !model || !isModelConfiguration(state.document?.value))throw new Error('Select an authorized model and configured AI provider.');
    try{assertRecordsUnchanged({},state.document.value);}catch{throw new Error('Choose a model configuration without inline timeline records before using AI. Record data and metadata remain unchanged.');}
    if(state.aiImage && !model.capabilities?.vision)throw new Error('This provider model does not accept images. Remove the image or select a vision model.');
    const request={id:crypto.randomUUID(),controller:new AbortController(),client:state.workspace,modelId:state.modelId,document:state.document,baseText:state.document.text,rawText:$('raw').value};
    state.aiRequest=request;state.aiReview=null;state.previewCandidate=null;$('ai-review').hidden=true;$('ai-status').textContent='Requesting a proposal…';updateAiControls();
    try{
        const result=await request.client.model(request.modelId,'ai/generate',{method:'POST',signal:request.controller.signal,body:{requestId:request.id,providerId:$('ai-provider').value,providerModelId:model.id,operation,prompt:$('ai-prompt').value,document:{kind:'model',format:state.document.kind==='yaml'?'yaml':'json',text:request.rawText},...(state.aiImage?{image:state.aiImage}:{}),...(state.record.etag?{baseRevision:state.record.etag}:{})}});
        if(state.aiRequest!==request)return;
        if(state.document!==request.document || state.document.text!==request.baseText || $('raw').value!==request.rawText)throw new Error('Your draft changed during this request. Its response was not applied; request a new proposal.');
        const response=result.data;$('ai-explanation').textContent=response.explanation || 'Review the proposed configuration.';$('ai-assumptions').replaceChildren();
        for(const text of [...(response.assumptions || []),...(response.warnings || [])]){const item=document.createElement('li');item.textContent=String(text);$('ai-assumptions').append(item);}
        $('ai-review').hidden=false;
        if(response.proposal){
            if(response.validation?.valid===false)throw new Error('The server rejected this proposal: '+(response.validation.errors || []).join('; '));
            if(response.proposal.format && response.proposal.format!==(state.document.kind==='yaml'?'yaml':'json'))throw new Error('The proposal changed document format. Request a proposal in the current format.');
            state.aiReview=new ConfigurationReview(state.document,response.proposal);state.aiReview.baseRawText=request.rawText;
            $('ai-diff').textContent=state.aiReview.changes.slice(0,100).map(change=>`${change.path}\n− ${JSON.stringify(change.before) ?? '(absent)'}\n+ ${JSON.stringify(change.after) ?? '(removed)'}`).join('\n\n') || 'No configuration values changed.';
            $('ai-status').textContent=`Validated proposal · ${state.aiReview.changes.length} changed properties. Preview and accept explicitly.`;
        }else{$('ai-diff').textContent='Explanation only. Your draft is unchanged.';$('ai-status').textContent='Explanation ready.';}
        $('ai-preview').hidden=!state.aiReview;$('ai-accept').hidden=!state.aiReview;
        requestAnimationFrame(()=>{const body=$('ai-panel').querySelector('.ai-body');body.scrollTop=body.scrollHeight;});
    }catch(error){if(state.aiRequest===request)$('ai-status').textContent=error.name==='AbortError'?'Request cancelled.':error.message;}
    finally{if(state.aiRequest===request)state.aiRequest=null;updateAiControls();}
}
function bindWorkspaceActions(){
    for(const tab of document.querySelectorAll('.area-nav button')){tab.onclick=()=>selectArea(tab.dataset.area);tab.onkeydown=event=>{let index=EDITOR_AREAS.indexOf(state.area);if(event.key==='ArrowRight')index=(index+1)%5;else if(event.key==='ArrowLeft')index=(index+4)%5;else if(event.key==='Home')index=0;else if(event.key==='End')index=4;else return;event.preventDefault();selectArea(EDITOR_AREAS[index]);document.querySelector(`.area-nav [data-area="${state.area}"]`).focus();};}
    $('workspace-model').onchange=()=>{if(!canLeave()){$('workspace-model').value=state.modelId;return;}selectWorkspaceModel($('workspace-model').value,{openModel:true}).catch(fail);};
    $('filter-expression').previousSibling.textContent='Search text ';$('filter-expression').required=false;$('filter-expression').placeholder='Words to match';
    $('filter-sort').closest('label').nextElementSibling.textContent='Saved sorting metadata is preserved. Server query results currently use time and ID order.';
    $('filter-form').onsubmit=event=>saveFilter(event).catch(fail);$('filter-clear').onclick=resetFilterForm;
    $('grant-form').onsubmit=event=>{event.preventDefault();const userId=$('grant-user').value.trim(),role=$('grant-role').value;saveAccess([...(state.access?.grants || []).filter(grant=>grant.userId!==userId),{userId,role}]).catch(fail);};
    $('ai-provider').onchange=fillAiModels;$('ai-model').onchange=updateAiControls;$('ai-image').onchange=()=>selectAiImage($('ai-image').files[0]).catch(error=>{$('ai-status').textContent=error.message;});
    $('ai-image-drop').ondragover=event=>event.preventDefault();$('ai-image-drop').ondrop=event=>{event.preventDefault();if(!canEdit() || !selectedAiModel()?.capabilities?.vision)return;selectAiImage(event.dataTransfer.files[0]).catch(error=>{$('ai-status').textContent=error.message;});};
    $('ai-remove-image').onclick=()=>{state.aiImage=null;$('ai-image').value='';$('ai-image-name').textContent='Drop an image here or choose a file. Maximum 1 MiB.';$('ai-remove-image').hidden=true;updateAiControls();};
    for(const operation of ['explain','generate','repair'])$('ai-'+operation).onclick=()=>requestAi(operation).catch(error=>{$('ai-status').textContent=error.message;});
    $('ai-cancel').onclick=cancelAiRequest;$('ai-preview').onclick=()=>{if(!state.aiReview?.current)return;state.previewCandidate=state.aiReview.candidate;void refreshPreview();$('ai-status').textContent='Previewing the proposal. The draft remains unchanged until you accept.';};
    $('ai-accept').onclick=()=>{try{requireEditor();if($('raw').value!==state.aiReview.baseRawText)throw new Error('The draft changed. Request a new proposal.');state.aiReview.accept(state.document);state.aiReview=null;$('ai-review').hidden=true;state.rawInvalid=false;changed({form:true});$('ai-status').textContent='Accepted into the draft. Save separately; Undo restores the previous draft.';}catch(error){$('ai-status').textContent=error.message;}};
    $('ai-dismiss').onclick=()=>{state.aiReview=null;state.previewCandidate=null;$('ai-review').hidden=true;schedulePreview(true);$('ai-status').textContent='Proposal discarded. Your draft is unchanged.';};
}
function bindActions(){
    bindWorkspaceActions();
    for(const id of ['form','text'])$(id+'-tab').onclick=()=>{if(id==='form' && state.rawInvalid){fail(new Error('Correct the document syntax before returning to Properties, or use Revert to restore the previous document.'));return;}for(const mode of ['form','text']){$(mode+'-view').hidden=mode!==id;$(mode+'-tab').setAttribute('aria-selected',String(mode===id));}if(id==='form')renderForm();};
    $('property-filter').oninput=filterProperties;
    $('raw').oninput=()=>{documentOpen.invalidate();clearTimeout(rawTimer);state.rawInvalid=true;state.valid=false;updateState();const source=state.document;rawTimer=setTimeout(()=>{if(state.document!==source)return;try{source.replace($('raw').value);state.rawInvalid=false;if(validate())schedulePreview();}catch(error){fail(error,true);}},350);};
    $('documents').onchange=async()=>{
        if(!canLeave()){fillDocuments();return;}
        const intent=documentOpen.begin(state.document);clearTimeout(rawTimer);
        try{const [kind,id]=$('documents').value.split(':');
            if(kind==='demo')await openDemo(id,intent);
            else if(kind==='model')await openManagedModel(id,intent);
            else if(kind==='server'){const result=await state.client.request(id);openDocument(result.document.text,{...result.document,managed:true,etag:result.etag,selection:'server:'+id},intent,{});}
            else if(kind==='local'){const record=state.locals.find(item=>item.key===id);if(record)openDocument(record.text,{...record,selection:'local:'+id},intent,record.context || {});}
        }catch(error){if(documentOpen.accepts(intent,state.document))fail(error);}
    };
    for(const kind of ['model','yaml'])$('new-'+kind).onclick=()=>{if(!canLeave())return;const name=kind==='yaml'?'sources-new.yml':'timeline-new.json',text=kind==='yaml'?'# Timeline source configuration\nmodel: models/regular_timeline.json\ndata_sources: []\n':JSON.stringify(buildDefaultModel(),null,2)+'\n';const key=crypto.randomUUID();const record={key,name,kind,text,selection:'local:'+key};state.locals.push(record);state.context={};$('preview-data').value='document';openDocument(text,record);status('Created a local draft. Import or select preview data to see activities.');};
    $('import').onclick=()=>$('file').click();$('file').onchange=async()=>{
        const file=$('file').files[0];if(!file || !canLeave())return;const intent=documentOpen.begin(state.document);clearTimeout(rawTimer);
        try{const text=await file.text();if(!documentOpen.accepts(intent,state.document))return;
            const key=crypto.randomUUID(),record={key,name:file.name,kind:documentKind(file.name,text),text,selection:'local:'+key};
            if(openDocument(text,record,intent,{})){state.locals.push(record);fillDocuments();status('Imported a local draft. Use Export or save a server copy.');}
        }catch(error){if(documentOpen.accepts(intent,state.document))fail(error);}finally{if($('file').files[0]===file)$('file').value='';}
    };
    $('duplicate').onclick=async()=>{if(!state.valid)return;const name=await ask('Duplicate document','New file name',state.record.name.split(/[\\/]/).at(-1).replace(/(\.[^.]+)$/,'-copy$1'));if(!name)return;const key=crypto.randomUUID(),record={key,name,kind:state.document.kind,text:state.document.text,context:clone(state.context),selection:'local:'+key};state.locals.push(record);openDocument(record.text,record);status('Created a local copy.');};
    $('rename').onclick=()=>renameDocument().catch(fail);
    $('delete').onclick=()=>deleteDocument().catch(fail);
    $('connect').onclick=()=>connectWorkspace().catch(error=>{status(error.message);updateState();});
    $('save').onclick=()=>saveDocument().catch(fail);$('export').onclick=exportDocument;
    $('undo').onclick=()=>{state.document.undo();state.rawInvalid=false;changed({form:true});};$('redo').onclick=()=>{state.document.redo();changed({form:true});};
    $('revert').onclick=()=>{if(confirm('Revert to the last opened or saved version?')){state.document.revert();state.rawInvalid=false;changed({form:true});}};
    $('refresh').onclick=()=>schedulePreview(true);$('live').onchange=()=>schedulePreview();$('preview-data').onchange=()=>schedulePreview(true);
    $('use-data').onclick=()=>{
        const selected=state.catalog.find(demo=>demo.id===$('preview-data').value);
        const dataset=selected?new URL(selected.dataset,appRoot):state.context.dataset?new URL(state.context.dataset,appRoot):null;
        if(!dataset){status('Select a demo dataset first.');return;}
        const url=dataset.href.startsWith(appRoot.href)?dataset.href.slice(appRoot.href.length):dataset.href;
        mutate(['dataSource','url'],url);renderForm();status('Added dataSource.url. Saved and exported copies can now find this dataset when reopened.');
    };
    const contextKey=new URLSearchParams(location.search).get('context');
    $('apply').hidden=!window.opener || !contextKey;
    const applyClient=createEditorApplyClient({context:contextKey,onStatus:status});
    $('apply').onclick=()=>{if(!validate() || state.document.kind!=='model'){status('Only validated model documents can be applied to the originating timeline.');return;}applyClient.apply(clone(state.document.value));};
    window.addEventListener('pagehide',()=>applyClient.dispose(),{once:true});
    window.addEventListener('beforeunload',event=>{if(unsaved()){event.preventDefault();event.returnValue='';}});
}
async function start(){
    const query=new URLSearchParams(location.search),contextKey=query.get('context');
    if(contextKey)try{state.context=JSON.parse(sessionStorage.getItem(contextKey) || '{}');}catch{status('The originating timeline context is unavailable.');}
    configureLaunch(query);
    const responses=await Promise.all([fetchText('demos/catalog.json'),fetchText('schemas/demo-model.schema.json'),fetchText('schemas/legacy-model.schema.json').catch(()=>null)]);
    state.catalog=JSON.parse(responses[0]).demos;state.schemas.demo=JSON.parse(responses[1]);state.schemas.provider=responses[2]?JSON.parse(responses[2]):null;
    for(const demo of state.catalog)$('preview-data').append(new Option(demo.title,demo.id));
    bindActions();
    const path=query.get('model') || state.context.modelPath;
    if(state.requiredModelId){state.pendingModelPath=new URL('api/v1/models/'+encodeURIComponent(state.requiredModelId),appRoot).href;openDocument(JSON.stringify(buildDefaultModel(),null,2)+'\n',{name:'Connect to open this model',kind:'model',example:true});}
    else if(state.context.model){openDocument(JSON.stringify(state.context.model,null,2)+'\n',{name:path || 'current-timeline.json',kind:'model',example:true,modelPath:path});}
    else if(path){const intent=documentOpen.begin(state.document),context=clone(state.context),url=new URL(path,appRoot);if(url.origin!==location.origin)throw new Error('Open a same-origin model or import the model file.');const entry=state.catalog.find(demo=>new URL(demo.model,appRoot).href===url.href);if(entry && !context.dataset)context.dataset=new URL(entry.dataset,appRoot).href;openDocument(await fetchText(url),{name:path,kind:documentKind(path),example:true,modelPath:url.href},intent,context);}
    else await openDemo(state.catalog[0].id);
    status(state.requiredModelId?'Connect with a model administrator session to open this protected model.':state.focused?'':'Local editing is ready. Changes refresh the preview automatically; saving is explicit.');
    // Expose read-only diagnostics useful for browser validation, without credentials.
    window.modelEditor={get document(){return state.document;},get record(){return {...state.record};},get revision(){return state.revision;}};
}
start().catch(fail);
