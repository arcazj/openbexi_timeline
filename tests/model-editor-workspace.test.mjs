import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

async function setup(){const harness=await createTimelineHarness();return {harness,api:await harness.importModule('src/openbexi_timeline_model_editor_workspace.js'),documents:await harness.importModule('src/openbexi_timeline_model_editor_document.js')};}
const plain=value=>JSON.parse(JSON.stringify(value));
test('AI review validates and waits for acceptance, supports undo, and rejects intervening edits',async()=>{
    const {harness,api,documents}=await setup();try{
        const text=await fs.readFile('models/demos/monet.json','utf8'),doc=new documents.EditorDocument(text),candidate=JSON.parse(text);candidate.params[0].title='Reviewed title';
        const review=new api.ConfigurationReview(doc,{text:JSON.stringify(candidate)});assert.equal(doc.text,text);assert.ok(review.changes.some(change=>change.path==='params.0.title'));
        review.accept(doc);assert.equal(doc.value.params[0].title,'Reviewed title');assert.equal(doc.savedText,text);doc.undo();assert.equal(doc.text,text);
        const stale=new api.ConfigurationReview(doc,{text:JSON.stringify(candidate)});doc.mutate(['params',0,'title'],'Manual change');assert.throws(()=>stale.accept(doc),/draft changed/);assert.equal(doc.value.params[0].title,'Manual change');
        assert.throws(()=>new api.ConfigurationReview(doc,{text:'{"params":[],"bands":[]}'}));
    }finally{harness.close();}
});
test('Record values and their existing metadata remain byte-equivalent during configuration edits',async()=>{
    const {harness,api,documents}=await setup();try{
        const records=[{id:'session',start:'-0044-03-15',data:{metadata:{source:'legacy',unknown:[1,null]}},activities:[{id:'event',data:{metadata:{keep:true}}}]}];
        const doc=new documents.EditorDocument(JSON.stringify({params:[{name:'demo'}],bands:[],events:records}));
        doc.mutate(['params',0,'title'],'Configuration change');assert.equal(JSON.stringify(doc.value.events),JSON.stringify(records));
        assert.throws(()=>doc.mutate(['events',0,'data','metadata','source'],'rewritten'),/immutable/);assert.equal(JSON.stringify(doc.value.events),JSON.stringify(records));
        assert.throws(()=>api.assertRecordsUnchanged({}, {records:[{id:'invented'}]}),/cannot introduce/);
        assert.throws(()=>api.assertRecordsUnchanged({records},{}),/immutable/);
        assert.throws(()=>api.assertRecordsUnchanged({extra:null},{extra:{records:[]}}),/cannot introduce/);
        assert.throws(()=>api.assertRecordsUnchanged({extra:'old'},{extra:{records:records}}),/cannot introduce/);
        assert.throws(()=>api.assertRecordsUnchanged({events:null},{events:[]}),/cannot introduce/);
    }finally{harness.close();}
});
test('A YAML model proposal preserves existing comments and unknown keys through the AST',async()=>{
    const {harness,api,documents}=await setup();try{
        const text='# Keep root\nparams:\n  - name: sample\n    title: Before # Keep title\nbands:\n  - name: detail\nextra: unchanged # Keep extension\n';
        const doc=new documents.EditorDocument(text,'yaml'),review=new api.ConfigurationReview(doc,{text:'params:\n  - name: sample\n    title: After\nbands:\n  - name: detail\nextra: unchanged\n'});
        assert.match(review.candidate.text,/# Keep root/);assert.match(review.candidate.text,/# Keep title/);assert.match(review.candidate.text,/# Keep extension/);review.accept(doc);assert.equal(doc.value.params[0].title,'After');doc.undo();assert.equal(doc.text,text);
    }finally{harness.close();}
});
test('Workspace requests encode model scope, carry conditional authentication and cancellation, and report denial',async()=>{
    const {harness,api}=await setup();try{
        const calls=[],controller=new AbortController(),client=new api.ModelWorkspaceClient('https://example.test/api/v1/','session-only',async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({permissions:{admin:true}}),{headers:{ETag:'"access2"'}});});
        const response=await client.model('team/model','access',{method:'PUT',etag:'"access1"',signal:controller.signal,body:{grants:[]}});
        assert.equal(calls[0].url,'https://example.test/api/v1/models/team%2Fmodel/access');assert.equal(calls[0].options.headers.Authorization,'Bearer session-only');assert.equal(calls[0].options.headers['If-Match'],'"access1"');assert.equal(calls[0].options.signal,controller.signal);assert.equal(response.etag,'"access2"');
        client.fetch=async()=>new Response(JSON.stringify({detail:'Administrator required'}),{status:403});await assert.rejects(client.request('me'),error=>error.status===403 && /Administrator/.test(error.message));
        assert.deepEqual(plain(api.EDITOR_AREAS),['overview','data','appearance','filters','access']);assert.equal(api.propertyArea('rendering'),'appearance');
    }finally{harness.close();}
});
