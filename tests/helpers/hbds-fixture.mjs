import fs from 'node:fs/promises';

export async function hbdsFixture(){
    const model=JSON.parse(await fs.readFile('HBDS/templates/models/demos/default-dataset.json','utf8'));
    model.dataSource.url='json/test-data/default-dataset.json';
    return {schemaVersion:1,defaultNamespaceId:'namespace-alpha',
        namespaces:[{id:'namespace-alpha',namespace:'EXAMPLE_ALPHA',modelId:'model-alpha',render:{},filter:{},connectorIds:[]},
            {id:'namespace-beta',namespace:'EXAMPLE_BETA',modelId:'model-beta',render:{},filter:{},connectorIds:[]}],
        models:[{id:'model-alpha',configuration:structuredClone(model)},{id:'model-beta',configuration:structuredClone(model)}],
        sources:[],connectors:[],tabs:[{id:'tab-alpha',namespaceId:'namespace-alpha',title:'Alpha timeline',order:0,enabled:true},
            {id:'tab-beta',namespaceId:'namespace-beta',title:'Beta timeline',order:1,enabled:true}],
        users:[],roles:[],groups:[],grants:[],deployment:{}};
}
export function hbdsPublicConfiguration(document,revision='revision-1',namespaceId=document.defaultNamespaceId){
    const namespace=document.namespaces.find(item=>item.id===namespaceId);
    return {hbds:{revision,namespaceId,namespace:namespace.namespace,tabs:structuredClone(document.tabs),modelConfiguration:structuredClone(document.models.find(model=>model.id===namespace.modelId).configuration)}};
}
