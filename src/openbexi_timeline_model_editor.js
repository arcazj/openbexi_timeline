import {EditorDocument, ConfigFileClient, DocumentOpenGate, documentKind, resolveSchema, schemaDefault, YAML_SCHEMA, yamlType, validateYamlConfiguration} from './openbexi_timeline_model_editor_document.js';
import {buildDefaultModel} from './openbexi_timeline_model_startup.js';
import {validateDemoModel,validateLegacyModel} from './openbexi_timeline_model_validation.js';

const appRoot=new URL('../',import.meta.url);
const $=id=>document.getElementById(id);
const state={catalog:[],schemas:{},document:null,record:null,context:{},client:null,managed:[],locals:[],revision:0,valid:false,rawInvalid:false};
const documentOpen=new DocumentOpenGate();
let previewTimer,rawTimer,previewFrame,pendingFrame,pendingPayload,previewTimeout;
function retireFrame(frame){if(!frame)return;try{frame.contentWindow?.disposePreview?.();}catch{ /* A frame may still be navigating. */ }frame.remove();}
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
function updateState() {
    const record=state.record, doc=state.document;
    $('document-name').textContent=record?.name || 'No document';
    $('document-source').textContent=record?.managed?'Server document':record?.example?'Read-only example · edit a copy':'Local draft';
    $('dirty').textContent=unsaved()?'Unsaved changes':record?.managed?'Saved on server':record?.example?'Original example':'Draft';
    $('save').textContent=record?.managed && state.client?'Save to server':state.client?'Save as server copy':'Export changes';
    $('save').disabled=!state.valid || Boolean(state.client && state.yamlValidation?.supported===false);$('export').disabled=!state.valid;
    $('delete').disabled=!record || Boolean(record.example);
    if(record?.managed && !state.client)$('delete').disabled=true;
    $('use-data').disabled=doc?.kind!=='model' || !doc?.value?.dataSource;
    $('undo').disabled=!doc?.history.length;$('redo').disabled=!doc?.future.length;
    $('revert').disabled=!unsaved();
}
function schemaFor() {return state.document.kind==='yaml'?YAML_SCHEMA:state.document.value.dataSource?state.schemas.demo:state.schemas.provider || state.schemas.demo;}
function validate() {
    try {
        if(state.rawInvalid){clearTimeout(rawTimer);state.document.replace($('raw').value);state.rawInvalid=false;}
        const doc=state.document,value=doc.value;
        state.yamlValidation=null;
        if(doc.kind==='model') {
            if(value.dataSource) validateDemoModel(value,{label:'Model'});
            else validateLegacyModel(value,{label:'Model'});
        } else state.yamlValidation=validateYamlConfiguration(value);
        if(state.yamlValidation?.diagnostic)status(state.yamlValidation.diagnostic);
        clearErrors();state.valid=true;state.rawInvalid=false;updateState();return true;
    } catch(error) {fail(error,true);return false;}
}
function changed({form=false}={}) {
    documentOpen.invalidate();
    $('raw').value=state.document.text;
    if(form)renderForm();
    if(validate())schedulePreview();
    updateState();
}
function mutate(path,value,remove=false) {
    documentOpen.invalidate();
    try {state.document.mutate(path,value,remove);changed({form:remove});}catch(error){fail(error);}
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
            const details=document.createElement('details');details.className='property-group';details.open=path.length<2 || path[0]==='params' || path[0]==='rendering';
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
    Object.entries(state.document.value).forEach(([key,value])=>host.append(render(value,root.properties?.[key] || {},[key],key,root.required?.includes(key))));
    const missing=Object.keys(root.properties || {}).filter(key=>!(key in state.document.value) && key!=='$schema');
    if(missing.length){const select=document.createElement('select');select.setAttribute('aria-label','Optional root property');select.append(new Option('Add model section…',''));missing.forEach(key=>select.append(new Option(prettyName(key),key)));host.append(select,button('Add section',()=>{if(select.value){state.document.mutate([select.value],schemaDefault(root.properties[select.value],root));changed({form:true});}}));}
    filterProperties();
}
function filterProperties(){const term=$('property-filter').value.trim().toLowerCase();for(const field of $('properties').querySelectorAll('.property-field'))field.hidden=Boolean(term && !field.dataset.path.toLowerCase().includes(term));if(term)for(const details of $('properties').querySelectorAll('details'))details.open=true;}

function fillDocuments() {
    const selector=$('documents');selector.replaceChildren(new Option('Choose an example or document…',''));
    function group(label,items,prefix){if(!items.length)return;const element=document.createElement('optgroup');element.label=label;for(const item of items)element.append(new Option(item.title || item.name,prefix+(item.id || item.key)));selector.append(element);}
    group('Public demos',state.catalog,'demo:');group('Server documents',state.managed,'server:');group('Local drafts',state.locals,'local:');
    if(state.record?.selection)selector.value=state.record.selection;
}
function openDocument(text,record,intent=documentOpen.begin(state.document),context=state.context) {
    if(!documentOpen.accepts(intent,state.document))return false;
    const next=new EditorDocument(text,record.kind || documentKind(record.name,text));
    documentOpen.invalidate();clearTimeout(rawTimer);clearTimeout(previewTimer);clearTimeout(previewTimeout);
    retireFrame(pendingFrame);pendingFrame=null;pendingPayload=null;state.revision++;
    state.document=next;state.record=record;state.context=context;state.rawInvalid=false;
    $('raw').value=text;$('property-filter').value='';fillDocuments();renderForm();validate();schedulePreview(true);updateState();
    return true;
}
async function fetchText(url) {const response=await fetch(new URL(url,appRoot));if(!response.ok)throw new Error(`Unable to open ${url}: HTTP ${response.status}.`);return response.text();}
async function openDemo(id,intent=documentOpen.begin(state.document)){
    const entry=state.catalog.find(demo=>demo.id===id);if(!entry)return false;
    const text=await fetchText(entry.model);
    if(!documentOpen.accepts(intent,state.document))return false;
    $('preview-data').value='document';
    return openDocument(text,{name:entry.model,kind:'model',example:true,modelPath:new URL(entry.model,appRoot).href,selection:'demo:'+id},intent,{dataset:new URL(entry.dataset,appRoot).href});
}
async function refreshServer(client=state.client){if(!client)return;const result=await client.request();if(state.client!==client)return;state.managed=result.document.items || [];fillDocuments();}

async function previewPayload() {
    const selected=$('preview-data').value,doc=state.document;let model=clone(doc.value),modelPath=state.record.modelPath,options={};
    if(doc.kind==='yaml') {
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
        if(model.dataSource.url)options.dataset=new URL(model.dataSource.url,appRoot).href;
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
    return {type:'ob-model-preview',model,options,modelPath,previewState:state.context.previewState,revision:state.revision};
}
function schedulePreview(force=false) {
    clearTimeout(previewTimer);
    if(!state.valid || (!force && !$('live').checked))return;
    previewTimer=setTimeout(()=>refreshPreview(),force?0:350);
}
async function refreshPreview() {
    if(!state.valid)return;
    const revision=++state.revision;$('preview-state').textContent='Updating preview…';
    try {
        const payload=await previewPayload();if(revision!==state.revision)return;
        payload.revision=revision;pendingPayload=payload;
        retireFrame(pendingFrame);clearTimeout(previewTimeout);
        pendingFrame=document.createElement('iframe');pendingFrame.title='Interactive live timeline preview';pendingFrame.style.opacity='0';pendingFrame.style.pointerEvents='none';
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
    if(!validate())return;const blob=new Blob([state.document.text],{type:state.document.kind==='yaml'?'application/yaml':'application/json'});
    const anchor=document.createElement('a');anchor.href=URL.createObjectURL(blob);anchor.download=state.record.name.split(/[\\/]/).at(-1);anchor.click();setTimeout(()=>URL.revokeObjectURL(anchor.href),1000);
    status('Downloaded '+anchor.download+'. The server and active timeline were not changed.');
}
async function saveDocument(){
    if(!validate())return;if(!state.client){exportDocument();return;}
    if(state.yamlValidation?.supported===false){status(state.yamlValidation.diagnostic);return;}
    const record=state.record,sourceDocument=state.document;
    let name=record.managed?record.name:await ask('Save a server copy','File name',record.name.split(/[\\/]/).at(-1),'The server stores this document in its managed configuration directory.');if(!name)return;
    const body={name,kind:sourceDocument.kind,text:sourceDocument.text};
    const result=await state.client.request(record.managed?record.id:'',{method:record.managed?'PUT':'POST',body,etag:record.etag});
    if(state.document!==sourceDocument){await refreshServer();status('Saved '+name+' on the server.');return;}
    state.record={...result.document,managed:true,etag:result.etag,selection:'server:'+result.document.id};sourceDocument.savedText=body.text;await refreshServer();updateState();
    status(result.document.restartRequired?'Saved on server. Restart the server to activate this YAML configuration.':'Saved on server. The preview is current; reopen or reload a timeline to use the saved model.');
}
async function renameDocument(){
    const record=state.record,sourceDocument=state.document,client=state.client;
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
    if(record.example || (record.managed && !client))return;
    if(!confirm('Delete '+record.name+'? The server checks for configuration references before deleting a managed file.'))return;
    if(record.managed){await client.request(record.id,{method:'DELETE',etag:record.etag});await refreshServer(client);}
    else state.locals=state.locals.filter(item=>item.key!==record.key);
    if(state.document===sourceDocument)await openDemo(state.catalog[0].id);else fillDocuments();
    status('Deleted '+record.name+'.');
}
function bindActions(){
    for(const id of ['form','text'])$(id+'-tab').onclick=()=>{if(id==='form' && state.rawInvalid){fail(new Error('Correct the document syntax before returning to Properties, or use Revert to restore the previous document.'));return;}for(const mode of ['form','text']){$(mode+'-view').hidden=mode!==id;$(mode+'-tab').setAttribute('aria-selected',String(mode===id));}if(id==='form')renderForm();};
    $('property-filter').oninput=filterProperties;
    $('raw').oninput=()=>{documentOpen.invalidate();clearTimeout(rawTimer);state.rawInvalid=true;state.valid=false;updateState();const source=state.document;rawTimer=setTimeout(()=>{if(state.document!==source)return;try{source.replace($('raw').value);state.rawInvalid=false;if(validate())schedulePreview();}catch(error){fail(error,true);}},350);};
    $('documents').onchange=async()=>{
        if(!canLeave()){fillDocuments();return;}
        const intent=documentOpen.begin(state.document);clearTimeout(rawTimer);
        try{const [kind,id]=$('documents').value.split(':');
            if(kind==='demo')await openDemo(id,intent);
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
    $('connect').onclick=async()=>{try{if(state.client){state.client=null;state.managed=[];$('connect').textContent='Connect to server';fillDocuments();updateState();status('Disconnected. The session token was discarded.');return;}const token=await ask('Connect to the configuration server','Admin token','','Used only in memory for this editor session. The server must enable the configuration file API.',true);if(!token)return;const client=new ConfigFileClient(new URL('api/v1/config-files',appRoot).href,token);await client.request();state.client=client;await refreshServer();$('connect').textContent='Disconnect';updateState();status('Connected. Open a managed document or save a copy of the current draft.');}catch(error){status(error.message);}};
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
    $('apply').onclick=()=>{if(!validate() || state.document.kind!=='model'){status('Only validated model documents can be applied to the originating timeline.');return;}window.opener?.postMessage({type:'ob-model-apply',context:contextKey,model:clone(state.document.value)},location.origin);status('Applying this model to the originating timeline…');};
    window.addEventListener('message',event=>{if(event.origin===location.origin && event.source===window.opener && event.data?.type==='ob-model-apply-result' && event.data.context===contextKey)status(event.data.error || 'The model was applied to the originating timeline. Save separately to persist it.');});
    window.addEventListener('beforeunload',event=>{if(unsaved()){event.preventDefault();event.returnValue='';}});
}
async function start(){
    const responses=await Promise.all([fetchText('demos/catalog.json'),fetchText('schemas/demo-model.schema.json'),fetchText('schemas/legacy-model.schema.json').catch(()=>null)]);
    state.catalog=JSON.parse(responses[0]).demos;state.schemas.demo=JSON.parse(responses[1]);state.schemas.provider=responses[2]?JSON.parse(responses[2]):null;
    for(const demo of state.catalog)$('preview-data').append(new Option(demo.title,demo.id));
    bindActions();const query=new URLSearchParams(location.search),contextKey=query.get('context');
    if(contextKey)try{state.context=JSON.parse(sessionStorage.getItem(contextKey) || '{}');}catch{status('The originating timeline context is unavailable.');}
    const path=query.get('model') || state.context.modelPath;
    if(state.context.model){openDocument(JSON.stringify(state.context.model,null,2)+'\n',{name:path || 'current-timeline.json',kind:'model',example:true,modelPath:path});}
    else if(path){const intent=documentOpen.begin(state.document),context=clone(state.context),url=new URL(path,appRoot);if(url.origin!==location.origin)throw new Error('Open a same-origin model or import the model file.');const entry=state.catalog.find(demo=>new URL(demo.model,appRoot).href===url.href);if(entry && !context.dataset)context.dataset=new URL(entry.dataset,appRoot).href;openDocument(await fetchText(url),{name:path,kind:documentKind(path),example:true,modelPath:url.href},intent,context);}
    else await openDemo(state.catalog[0].id);
    status('Local editing is ready. Changes refresh the preview automatically; saving is explicit.');
    // Expose read-only diagnostics useful for browser validation, without credentials.
    window.modelEditor={get document(){return state.document;},get record(){return {...state.record};},get revision(){return state.revision;}};
}
start().catch(fail);
