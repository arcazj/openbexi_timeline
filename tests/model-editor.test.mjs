import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

async function setup(){const harness=await createTimelineHarness();return {harness,api:await harness.importModule('src/openbexi_timeline_model_editor_document.js')};}
test('YAML form edits preserve comments, unrelated keys, order and anchors',async()=>{
    const {harness,api}=await setup();try{
        const doc=new api.EditorDocument('# root note\nmodel: models/original.json # model note\nshared: &palette\n  color: blue\ncopy: *palette\nunknown: keep me\ndata_sources:\n  - namespace: first # source note\n    render:\n      color: "#123456"\n','yaml');
        doc.mutate(['data_sources',0,'render','color'],'#abcdef');doc.mutate(['model'],'models/updated.json');
        assert.match(doc.text,/# root note/);assert.match(doc.text,/# model note/);assert.match(doc.text,/# source note/);
        assert.match(doc.text,/unknown: keep me/);assert.match(doc.text,/&palette/);assert.match(doc.text,/\*palette/);
        assert.equal(doc.value.copy.color,'blue');assert.equal(doc.value.data_sources[0].render.color,'#abcdef');
        assert.throws(()=>doc.mutate(['copy','color'],'red'),/anchored or aliased/);
        assert.equal(doc.value.copy.color,'blue');assert.ok(doc.dirty);
        doc.revert();assert.equal(doc.value.model,'models/original.json');assert.equal(doc.dirty,false);
    }finally{harness.close();}
});
test('YAML sequence movement retains attached comments and supports undo/redo',async()=>{
    const {harness,api}=await setup();try{
        const doc=new api.EditorDocument('data_sources:\n  - namespace: first # first comment\n  - namespace: second # second comment\n','yaml');
        doc.move(['data_sources'],1,0);assert.equal(doc.value.data_sources[0].namespace,'second');assert.match(doc.text,/second # second comment/);
        doc.undo();assert.equal(doc.value.data_sources[0].namespace,'first');doc.redo();assert.equal(doc.value.data_sources[0].namespace,'second');
        doc.saved();assert.equal(doc.dirty,false);doc.mutate(['data_sources',0],undefined,true);assert.equal(doc.value.data_sources.length,1);
    }finally{harness.close();}
});
test('Invalid text and unsafe property paths leave the previous document intact',async()=>{
    const {harness,api}=await setup();try{
        const doc=new api.EditorDocument('{"params":[{"title":"Original"}],"bands":[]}');
        assert.throws(()=>doc.replace('{ broken'));assert.equal(doc.value.params[0].title,'Original');
        assert.throws(()=>doc.mutate(['__proto__','polluted'],true),/Unsupported property/);
        assert.throws(()=>new api.EditorDocument('a: 1\na: 2\n','yaml'),/unique/i);
        assert.throws(()=>new api.EditorDocument('[]'),/root must be an object/);
        doc.mutate(['params',0,'title'],'Updated');doc.undo();assert.equal(doc.value.params[0].title,'Original');
    }finally{harness.close();}
});
test('Schema defaults resolve references, union fields, numeric limits and required objects',async()=>{
    const {harness,api}=await setup();try{
        const schema={definitions:{step:{type:'number',exclusiveMinimum:0}},type:'object',required:['ticks'],properties:{ticks:{type:'object',required:['step','unit'],properties:{step:{$ref:'#/definitions/step'},unit:{enum:['HOUR','DAY']}}}}};
        assert.deepEqual(JSON.parse(JSON.stringify(api.schemaDefault(schema))),{ticks:{step:1,unit:'HOUR'}});
        assert.equal(api.resolveSchema({anyOf:[{type:'string'},{type:'array'}]},schema,[]).type,'array');
    }finally{harness.close();}
});
test('Config client uses authenticated conditional writes and reports conflicts',async()=>{
    const {harness,api}=await setup();try{
        const calls=[];
        const client=new api.ConfigFileClient('https://example.test/api/v1/config-files','secret',async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({id:'one',name:'model.json'}),{status:200,headers:{ETag:'"v2"'}});});
        const result=await client.request('one',{method:'PUT',etag:'"v1"',body:{text:'{}'}});
        assert.equal(calls[0].options.headers.Authorization,'Bearer secret');assert.equal(calls[0].options.headers['If-Match'],'"v1"');
        assert.equal(calls[0].url,'https://example.test/api/v1/config-files/one');assert.equal(result.etag,'"v2"');
        client.fetch=async()=>new Response(JSON.stringify({detail:'Changed by another editor.'}),{status:412});
        await assert.rejects(client.request('one'),/Changed by another editor/);
    }finally{harness.close();}
});
test('YAML configuration validation accepts supported documents and preserves all extension data',async()=>{
    const {harness,api}=await setup();try{
        const cases=[
            {model:null,custom:{retained:['one','two']}},
            {data_sources:[{namespace:'earthquake',type:'third_party_plugin',enable:true,filter:{include:'',exclude:'',custom:[1]},render:{color:'#123456',extra:{keep:true}}}]},
            {server:{host:'127.0.0.1',port:8781,local_browser:true,state_root:'state'},snapshot:{file:'events.json'},version:1},
            {snapshot:{file:'standalone.json'}},
            {apiVersion:'apps/v1',kind:'Deployment',metadata:{name:'timeline'},spec:{replicas:1}},
            {rules:[{pattern:'Catalina',labels:{port:'$2'},value:1}],lowercaseOutputName:true}
        ];
        for(const value of cases){const before=JSON.stringify(value);assert.equal(api.validateYamlConfiguration(value).supported,true);assert.equal(JSON.stringify(value),before);}
        const quake=new api.EditorDocument(await fs.readFile('yaml/sources_earthquake.yml','utf8'),'yaml');assert.equal(api.validateYamlConfiguration(quake.value).type,'sources');
        const unknown={custom:{keep:true}};const result=api.validateYamlConfiguration(unknown);assert.equal(result.supported,false);assert.match(result.diagnostic,/edit and export.*cannot save/);assert.deepEqual(unknown,{custom:{keep:true}});
    }finally{harness.close();}
});
test('YAML known-field errors identify the path before a configuration can be saved',async()=>{
    const {harness,api}=await setup();try{
        const cases=[
            [{model:7},'$.model'],[{data_sources:{}},'$.data_sources'],[{data_sources:[null]},'$.data_sources[0]'],
            [{data_sources:[{namespace:'  '}]},'$.data_sources[0].namespace'],
            [{data_sources:[{namespace:'same'},{namespace:'same'}]},'$.data_sources[1].namespace'],
            [{data_sources:[{namespace:'a',enable:'true'}]},'$.data_sources[0].enable'],
            [{data_sources:[{namespace:'a',type:4}]},'$.data_sources[0].type'],
            [{data_sources:[{namespace:'a',url:[]} ]},'$.data_sources[0].url'],
            [{data_sources:[{namespace:'a',filter:[]} ]},'$.data_sources[0].filter'],
            [{data_sources:[{namespace:'a',filter:{include:false}}]},'$.data_sources[0].filter.include'],
            [{data_sources:[{namespace:'a',render:null}]},'$.data_sources[0].render'],
            [{data_sources:[{namespace:'a',render:{textColor:2}}]},'$.data_sources[0].render.textColor'],
            [{server:[]},'$.server'],[{server:{port:0}},'$.server.port'],[{server:{port:65536}},'$.server.port'],
            [{server:{port:8442.5}},'$.server.port'],[{server:{port:'8442'}},'$.server.port'],
            [{server:{host:127}},'$.server.host'],[{server:{state_root:false}},'$.server.state_root'],
            [{server:{local_browser:'true'}},'$.server.local_browser'],[{snapshot:[]},'$.snapshot'],
            [{snapshot:{file:42}},'$.snapshot.file'],[{apiVersion:2},'$.apiVersion'],[{apiVersion:'v1',kind:false},'$.kind'],
            [{rules:{}},'$.rules']
        ];
        for(const [value,path] of cases)assert.throws(()=>api.validateYamlConfiguration(value),error=>error.name==='YamlConfigurationError' && error.issues.some(issue=>issue.path===path),path);
    }finally{harness.close();}
});
test('Invalid YAML fields disable Save and Export until corrected in the actual editor',async()=>{
    const harness=await createTimelineHarness({html:await fs.readFile('openbexi_timeline_model.html','utf8'),url:'http://localhost/openbexi_timeline_model.html?model=yaml/test-data/default-dataset.yml'});
    try{
        harness.window.CSS={supports:()=>false};
        await harness.importModule('src/openbexi_timeline_model_editor.js');
        for(let retry=0;retry<100 && !harness.window.modelEditor;retry++)await new Promise(resolve=>setTimeout(resolve,10));
        assert.ok(harness.window.modelEditor,'Editor initialization completes');
        const document=harness.window.document,port=document.querySelector('[data-property="server.port"]');
        assert.ok(port);port.value='65536';port.dispatchEvent(new harness.window.Event('input',{bubbles:true}));
        assert.equal(document.getElementById('save').disabled,true);assert.equal(document.getElementById('export').disabled,true);assert.match(document.getElementById('errors').textContent,/\$\.server\.port/);
        port.value='8781';port.dispatchEvent(new harness.window.Event('input',{bubbles:true}));
        assert.equal(document.getElementById('save').disabled,false);assert.equal(document.getElementById('export').disabled,false);assert.equal(document.getElementById('errors').hidden,true);
    }finally{harness.close();}
});
