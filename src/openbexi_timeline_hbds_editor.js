import {validateHbdsDocument} from './openbexi_timeline_hbds.js';
import {resolveSchema, schemaDefault, assertPath} from './openbexi_timeline_model_editor_document.js';

const clone=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const HBDS_CHANGE_CHANNEL='openbexi-hbds-changes';

/** The server owns authorization and revision checking; a draft never overwrites a failed save. */
export class HbdsEditorDraft {
    constructor(document,revision){this.value=clone(document);this.saved=clone(document);this.revision=revision;this.history=[];}
    get dirty(){return !same(this.value,this.saved);}
    replace(value){if(same(value,this.value))return;this.history.push(clone(this.value));if(this.history.length>50)this.history.shift();this.value=clone(value);}
    mutate(path,value,remove=false){
        assertPath(path);if(!path.length)throw new Error('Choose a configuration property.');
        const next=clone(this.value),last=path.at(-1);let owner=next;
        for(const key of path.slice(0,-1)){if(owner?.[key]===undefined)throw new Error('The selected configuration changed. Reopen this section.');owner=owner[key];}
        if(remove){if(Array.isArray(owner))owner.splice(last,1);else delete owner[last];}else owner[last]=value;
        this.replace(next);
    }
    move(path,from,to){assertPath(path);const items=path.reduce((value,key)=>value[key],this.value);if(!Array.isArray(items)||to<0||to>=items.length)return;const next=clone(items);next.splice(to,0,next.splice(from,1)[0]);if(path[0]==='tabs')next.forEach((item,index)=>item.order=index);this.mutate(path,next);}
    undo(){if(this.history.length)this.value=this.history.pop();}
    cancel(){this.value=clone(this.saved);this.history=[];}
    savedAs(document,revision,submitted){this.saved=clone(document);this.revision=revision;if(same(this.value,submitted))this.value=clone(document);this.history=[];}
}

export class HbdsEditorClient {
    constructor(baseURL,token='',fetcher=(...args)=>fetch(...args)){this.baseURL=baseURL.replace(/\/$/,'');this.token=token;this.fetch=fetcher;}
    async request({method='GET',document,revision,resource=''}={}){
        const headers={Accept:'application/json','X-OpenBEXI-HBDS':'local-editor'};
        if(this.token)headers.Authorization='Bearer '+this.token;
        if(document!==undefined)headers['Content-Type']='application/json';
        if(method==='PUT'){if(!revision)throw new Error('Reload HBDS to obtain its revision before saving.');headers['If-Match']=revision.startsWith('"')?revision:JSON.stringify(revision);}
        const response=await this.fetch(this.baseURL+resource,{method,headers,cache:'no-store',body:document===undefined?undefined:JSON.stringify(document)});
        const body=await response.json().catch(()=>null);
        if(!response.ok){const error=new Error(body?.detail||body?.message||body?.error?.message||(typeof body?.error==='string'?body.error:null)||`HBDS returned HTTP ${response.status}.`);error.status=response.status;throw error;}
        return {...body,revision:body?.revision||response.headers.get('ETag')};
    }
    async save(draft){validateHbdsDocument(draft.value);const submitted=clone(draft.value),result=await this.request({method:'PUT',document:submitted,revision:draft.revision});if(!result.document||!result.revision)throw new Error('The save response did not include the HBDS document and revision. Reload before saving again.');validateHbdsDocument(result.document);draft.savedAs(result.document,result.revision,submitted);return result;}
}

const element=(tag,text,attributes={})=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);return node;};
const button=(label,action)=>{const node=element('button',label,{type:'button'});node.addEventListener('click',action);return node;};
const title=key=>String(key).replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');
const references={namespaceId:'namespaces',defaultNamespaceId:'namespaces',modelId:'models',groupId:'groups',roleId:'roles'};

/** Compact namespace workspace; object forms are built only when their section opens. */
export function mountHbdsEditor(host,{namespaceId='',tabId='',previewPanel,onPreview,askProperty=async()=>window.prompt('Property name'),baseURL=new URL('../api/v1/hbds',import.meta.url).href,onSaved}={}){
    let client,draft,schema={},modelSchema={},selection=namespaceId,selectedTab=tabId,area='namespace',busy=false,invalidText=false,disposed=false;
    let retryTimer;
    const heading=element('div',undefined,{class:'hbds-toolbar'});
    const context=element('div',undefined,{class:'hbds-context'}),modelLabel=element('span','',{class:'hbds-model-label'});
    heading.append(element('h2','Namespaces and tabs'),modelLabel);
    const notice=element('p','Connecting to the running server…',{role:'status','aria-live':'polite',class:'hbds-notice'});
    const errors=element('p','',{role:'alert',class:'hbds-errors'});errors.hidden=true;
    const controls=element('div',undefined,{class:'hbds-toolbar'}),select=element('select',undefined,{'aria-label':'HBDS namespace'});
    const label=element('label','Namespace ');label.append(select);
    const tabs=element('select',undefined,{'aria-label':'HBDS timeline tab'}),tabLabel=element('label','Timeline tab ');tabLabel.append(tabs);
    context.append(label,tabLabel);
    const save=button('Save and apply',()=>saveDraft().catch(fail));save.className='primary';
    const undo=button('Undo',()=>{draft.undo();invalidText=false;render();});
    const cancel=button('Cancel changes',()=>{if(canLeave()){draft.cancel();invalidText=false;render();}});
    const reload=button('Reload saved',()=>{if(canLeave())load().catch(fail);});
    const revision=element('span','',{class:'hbds-draft-state'});
    controls.append(save,undo,cancel,reload,revision);
    const navigation=element('nav',undefined,{'aria-label':'HBDS configuration areas',class:'area-nav'});
    const areas={namespace:'Namespace',model:'Model and appearance',sources:'Sources',tabs:'Tabs',access:'Access',deployment:'Deployment',advanced:'Advanced JSON'};
    for(const [id,name] of Object.entries(areas))navigation.append(button(name,()=>{if(invalidText){fail(new Error('Correct the JSON syntax or cancel changes before switching sections.'));return;}area=id;renderBody();}));
    const body=element('div',undefined,{class:'hbds-properties'}),workspace=element('section',undefined,{'aria-label':'HBDS configuration',class:'hbds-workspace'});
    const sidebar=element('section',undefined,{class:'hbds-sidebar','aria-label':'HBDS properties'});
    sidebar.append(navigation,body);workspace.append(sidebar);if(previewPanel)workspace.append(previewPanel);
    workspace.hidden=true;host.append(heading,context,controls,notice,errors,workspace);
    select.onchange=()=>{selection=select.value;selectedTab='';render();};
    tabs.onchange=()=>{selectedTab=tabs.value;selection=draft.value.tabs.find(tab=>tab.id===selectedTab)?.namespaceId||selection;render();};
    function fail(error){if(disposed)return;errors.hidden=false;errors.textContent=error.message||String(error);update();}
    function canLeave(){return !(draft?.dirty||invalidText)||confirm('Discard unsaved HBDS changes?');}
    function update(){const editable=Boolean(draft)&&!busy;save.disabled=!editable||invalidText||!draft?.dirty;undo.disabled=!editable||!draft?.history.length;cancel.disabled=!editable||!(draft?.dirty||invalidText);reload.disabled=!editable;body.inert=busy;select.disabled=!editable||invalidText;tabs.disabled=!editable||invalidText||!draft?.value.tabs?.length;revision.textContent=draft?(draft.dirty||invalidText?'Unsaved changes':'Saved'):'';revision.dataset.dirty=String(Boolean(draft?.dirty||invalidText));revision.title=draft?`Revision ${draft.revision}`:'';}
    async function connectServer(){
        if(disposed||busy||client)return;
        clearTimeout(retryTimer);
        const next=new HbdsEditorClient(baseURL);busy=true;update();
        try{const result=await next.request();if(!result.document||!result.revision)throw new Error('The server did not provide an HBDS document and revision.');validateHbdsDocument(result.document);
            const [fields,models]=await Promise.all([next.request({resource:'/schema'}).catch(()=>({})),fetch(new URL('../schemas/demo-model.schema.json',import.meta.url)).then(r=>r.ok?r.json():{}).catch(()=>({}))]);
            if(disposed)return;schema=fields.schema||fields;modelSchema=models;client=next;draft=new HbdsEditorDraft(result.document,result.revision);workspace.hidden=false;errors.hidden=true;notice.textContent='Connected · Preview your edits, then Save and apply.';render();
        }catch(error){
            if(disposed)return;fail(error);
            const retry=!error.status||error.status>=500;
            notice.textContent=retry?'Server unavailable. Retrying automatically…':'HBDS is unavailable from this address. Open the editor from the local running server.';
            if(retry)retryTimer=setTimeout(connectServer,5000);
        }finally{busy=false;update();}
    }
    async function load(){busy=true;update();try{const result=await client.request();validateHbdsDocument(result.document);draft=new HbdsEditorDraft(result.document,result.revision);invalidText=false;errors.hidden=true;render();}finally{busy=false;update();}}
    async function saveDraft(){
        busy=true;update();errors.hidden=true;
        try{const result=await client.save(draft);render();notice.textContent=result.restartRequired?`Saved. Restart required: ${(result.restartReasons||[]).join('; ')||'source or server settings changed'}. Supported UI changes are applied now.`:'Saved and applied. Only affected timeline tabs refresh.';
            const message={type:'ob-hbds-saved',revision:result.revision,changedNamespaceIds:result.changedNamespaceIds||[],restartRequired:Boolean(result.restartRequired)};
            if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel(HBDS_CHANGE_CHANNEL);channel.postMessage(message);channel.close();}
            try{window.opener?.postMessage(message,location.origin);}catch{ /* Other open HBDS hosts receive the broadcast. */ }onSaved?.(result);
        }finally{busy=false;update();}
    }
    function changed(path,value,remove=false){try{draft.mutate(path,value,remove);errors.hidden=true;syncSelection();update();}catch(error){fail(error);}}
    function entityDefault(kind){
        const value=schemaDefault(schema.properties?.[kind]?.items||{type:'object'},schema);const item=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
        item.id='hbds-'+crypto.randomUUID();
        if(kind==='tabs')Object.assign(item,{namespaceId:selection,title:'New timeline',order:Math.max(-1,...draft.value.tabs.map(tab=>tab.order))+1,enabled:true});
        if(kind==='sources')Object.assign(item,{namespaceId:selection,order:Math.max(-1,...draft.value.sources.filter(source=>source.namespaceId===selection).map(source=>source.order))+1,configuration:{type:'json_file',enable:false,data_path:''}});
        if(kind==='models')Object.assign(item,{configuration:clone(draft.value.models[0]?.configuration||{params:[],bands:[]})});
        if(kind==='namespaces')Object.assign(item,{namespace:'NEW_NAMESPACE',modelId:draft.value.models[0]?.id||'',render:{},filter:{},connectorIds:[]});
        if(kind==='roles')Object.assign(item,{name:'New role',ceiling:'denied'});
        if(kind==='groups')item.name='New group';
        if(kind==='users')Object.assign(item,{name:'New user',email:'',admin:false,roleId:draft.value.roles[0]?.id||'',groupId:draft.value.groups[0]?.id||''});
        if(kind==='grants')Object.assign(item,{groupId:draft.value.groups[0]?.id||'',namespaceId:selection,permission:'denied'});
        return item;
    }
    function syncSelection(){
        const options=draft.value.namespaces||[],items=[...(draft.value.tabs||[])].sort((a,b)=>a.order-b.order);
        selection=options.some(n=>n.id===selection)?selection:options.find(n=>n.id===draft.value.defaultNamespaceId)?.id||options[0]?.id||'';
        if(!items.some(tab=>tab.id===selectedTab&&tab.namespaceId===selection))selectedTab=(items.find(tab=>tab.namespaceId===selection&&tab.enabled)||items.find(tab=>tab.namespaceId===selection))?.id||'';
        select.replaceChildren(...options.map(n=>new Option(n.namespace||n.id,n.id)));select.value=selection;
        tabs.replaceChildren(...items.map(tab=>new Option(`${tab.title||tab.id}${tab.enabled?'':' (disabled)'}`,tab.id)));
        if(!selectedTab)tabs.prepend(new Option('No tab for this namespace',''));tabs.value=selectedTab;
        const namespace=options.find(n=>n.id===selection),model=draft.value.models?.find(item=>item.id===namespace?.modelId),tab=items.find(item=>item.id===selectedTab);
        modelLabel.textContent=model?`Model: ${model.configuration?.params?.[0]?.title||model.id}`:'No model selected';
        onPreview?.({namespace:clone(namespace),model:clone(model),tab:clone(tab)});
    }
    function render(){syncSelection();renderBody();}
    function field(value,definition,path,name,required=false){
        const root=path[0]==='models'&&path.includes('configuration')?modelSchema:schema;
        definition=resolveSchema(definition||{},root,value);
        if(value&&typeof value==='object'){
            const group=element('details',undefined,{class:'property-group','data-hbds-path':path.join('.')}),summary=element('summary',`${title(name)}${Array.isArray(value)?` (${value.length})`:''}`);group.append(summary);let built=false;
            const build=()=>{if(built)return;built=true;const current=path.reduce((v,k)=>v[k],draft.value);
                if(Array.isArray(current)){
                    current.forEach((item,index)=>{const row=element('div',undefined,{class:'array-item'}),actions=element('div',undefined,{class:'group-actions'});
                        const up=button('Move up',()=>{draft.move(path,index,index-1);render();});up.disabled=index===0;
                        const down=button('Move down',()=>{draft.move(path,index,index+1);render();});down.disabled=index===current.length-1;
                        actions.append(up,down,button('Remove',()=>{changed([...path,index],undefined,true);render();}));row.append(actions,field(item,definition.items,[...path,index],item?.title||item?.name||item?.namespace||`${name} ${index+1}`,true));group.append(row);});
                    group.append(button('Add item',()=>{const item=path.length===1?entityDefault(path[0]):schemaDefault(definition.items||{},root);changed([...path,current.length],item);render();}));
                }else{
                    for(const [key,item] of Object.entries(current))group.append(field(item,path[0]==='models'&&key==='configuration'?modelSchema:definition.properties?.[key],[...path,key],key,definition.required?.includes(key)));
                    const missing=Object.keys(definition.properties||{}).filter(key=>!(key in current)&&key!=='$schema');
                    if(missing.length){const add=element('select',undefined,{'aria-label':`Optional field in ${path.join('.')}`});add.append(new Option('Add optional field…',''),...missing.map(key=>new Option(title(key),key)));group.append(add,button('Add field',()=>{if(add.value){changed([...path,add.value],schemaDefault(definition.properties[add.value],root));render();}}));}
                    if(definition.additionalProperties!==false)group.append(button('Add property',async()=>{const key=await askProperty();if(key){if(Object.hasOwn(current,key)){fail(new Error('This property already exists.'));return;}changed([...path,key],'');render();}}));
                }
            };
            group.addEventListener('toggle',()=>{if(group.open)build();});
            if(path.length<=2||path.at(-1)==='configuration'){group.open=true;build();}
            return group;
        }
        const row=element('label',undefined,{class:'property-field'}),caption=element('span',title(name));let input;
        const reference=path.at(-2)==='connectorIds'?'connectors':references[path.at(-1)];
        const choices=reference?draft.value[reference].map(item=>({value:item.id,label:item.namespace||item.name||(item.protocol?`${item.protocol}:${item.port}`:item.id)})):definition.enum?.map(item=>({value:item,label:String(item)}));
        if(choices){input=element('select');if(!choices.some(item=>item.value===value))input.append(new Option(String(value),String(value)));for(const choice of choices)input.append(new Option(choice.label,String(choice.value)));input.value=String(value);}
        else if(typeof value==='boolean'){input=element('input',undefined,{type:'checkbox'});input.checked=value;}
        else{input=element('input',undefined,{type:typeof value==='number'?'number':/password|secret|token|credential/i.test(name)?'password':'text'});input.value=value===null?'null':String(value??'');if(input.type==='number'){input.step=definition.type==='integer'?'1':'any';if(definition.minimum!==undefined)input.min=definition.minimum;if(definition.maximum!==undefined)input.max=definition.maximum;}}
        input.setAttribute('aria-label',path.join('.'));if(name==='id'||name==='$schema')input.readOnly=true;
        input.addEventListener('change',()=>{if(input.type==='number'&&(input.value===''||!Number.isFinite(Number(input.value)))){fail(new Error(`${path.join('.')} requires a finite number.`));return;}changed(path,input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value==='null'&&(value===null||definition.type?.includes?.('null'))?null:choices?.find(item=>String(item.value)===input.value)?.value??input.value);});
        row.append(caption,input);if(!required&&name!=='id'&&typeof path.at(-1)!=='number')row.append(button('Remove',()=>{changed(path,undefined,true);render();}));return row;
    }
    function collection(key,filter=()=>true){
        const section=element('section',undefined,{class:'hbds-collection'});section.append(element('h3',title(key)));
        draft.value[key].forEach((item,index)=>{if(!filter(item))return;const row=element('div',undefined,{class:'hbds-entity'}),actions=element('div',undefined,{class:'group-actions'});
            const remove=button('Remove '+(item.title||item.name||item.namespace||key),()=>{changed([key,index],undefined,true);render();});actions.append(remove);
            if(key==='tabs'){const up=button('Move up',()=>{draft.move([key],index,index-1);render();});up.disabled=index===0;const down=button('Move down',()=>{draft.move([key],index,index+1);render();});down.disabled=index===draft.value[key].length-1;actions.prepend(up,down);}
            row.append(field(item,schema.properties?.[key]?.items,[key,index],item.title||item.name||item.namespace||item.id,true),actions);section.append(row);
        });
        section.append(button('Add '+key.replace(/s$/,''),()=>{const item=entityDefault(key);changed([key,draft.value[key].length],item);if(key==='namespaces')selection=item.id;render();}));body.append(section);
    }
    function renderBody(){
        body.replaceChildren();for(const [index,id] of Object.keys(areas).entries())navigation.children[index].setAttribute('aria-pressed',String(area===id));if(!draft)return;
        if(area==='namespace'||area==='sources')body.append(element('p','Source render defaults are applied during ingestion. Export YAML and reload the collector; use Model for live timeline appearance.',{class:'property-description'}));
        if(area==='namespace'){body.append(field(draft.value.defaultNamespaceId,schema.properties?.defaultNamespaceId,['defaultNamespaceId'],'Default namespace',true));collection('namespaces',item=>item.id===selection);}
        if(area==='model'){const namespace=draft.value.namespaces.find(n=>n.id===selection);collection('models',model=>model.id===namespace?.modelId);}
        if(area==='sources'){collection('sources',source=>source.namespaceId===selection);collection('connectors');}
        if(area==='tabs'){body.append(element('p','Tabs reference a namespace and use its model. Tabs load only when opened.',{class:'property-description'}));collection('tabs');}
        if(area==='access')for(const key of ['users','groups','roles','grants'])collection(key);
        if(area==='deployment'){body.append(element('p','Server and ingestion settings require a restart. Changes are validated before saving.',{class:'property-description'}),field(draft.value.deployment,schema.properties?.deployment,['deployment'],'Deployment',true));}
        if(area==='advanced'){const label=element('label','Complete HBDS document'),text=element('textarea',JSON.stringify(draft.value,null,2),{'aria-label':'HBDS JSON',spellcheck:'false'});label.append(text);body.append(label);text.addEventListener('input',()=>{try{const value=JSON.parse(text.value);if(!value||!['namespaces','models','tabs'].every(key=>Array.isArray(value[key])))throw new Error('HBDS requires namespaces, models and tabs collections.');draft.replace(value);invalidText=false;errors.hidden=true;syncSelection();}catch(error){invalidText=true;fail(error);}update();});}
        update();
    }
    const unload=event=>{if(draft?.dirty||invalidText){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);update();
    const ready=connectServer();
    return {ready,get dirty(){return Boolean(draft?.dirty||invalidText);},get document(){return draft?clone(draft.value):null;},refreshPreview(){if(draft&&!invalidText)syncSelection();},dispose(){disposed=true;clearTimeout(retryTimer);client=null;window.removeEventListener('beforeunload',unload);host.replaceChildren();}};
}
