import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

test('Transport removes absent optional values without changing literal filters or searches',async()=>{
    const h=await createTimelineHarness();
    try {
        const {cleanTimelineURL}=await h.importModule('src/openbexi_timeline_transport.js');
        const url=cleanTimelineURL('/sessions?namespace=undefined&height=undefined&filter=null&search=undefined');
        assert.equal(url.searchParams.has('namespace'),false);assert.equal(url.searchParams.has('height'),false);
        assert.equal(url.searchParams.get('filter'),'null');assert.equal(url.searchParams.get('search'),'undefined');
    } finally {h.close();}
});

test('Details preserve full history, metadata and safe links independently of timeline requests',async()=>{
    const h=await createTimelineHarness();
    try {
        const {loadDescriptor,cancelDescriptor}=await h.importModule('src/openbexi_timeline_descriptor.js');
        const panel=h.window.document.createElement('aside');h.window.document.body.append(panel);
        const requests=[];h.window.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));
        const t={name:'synthetic',data:'http://localhost/sessions?startDate=current',ob_timeline_right_panel:panel,
            ob_scene:[{}],ob_get_url_head:()=>t.data,ob_remove_descriptor:()=>cancelDescriptor(t)};
        const first=loadDescriptor(t,0,{id:'first',start:'2026-09-12T12:30:00Z',data:{namespace:'operations',title:'First'}});
        assert.equal(new URL(requests[0].url).searchParams.get('namespace'),'operations');
        const second=loadDescriptor(t,0,{id:'second',start:'2026-09-12T12:30:00Z',data:{title:'Second',status:'warning'}});
        assert.equal(requests[0].options.signal.aborted,true);
        requests[0].resolve(new Response(JSON.stringify({event_descriptor:[{id:'first',data:{description:'Stale'}}]})));await first;
        assert.equal(panel.querySelector('h2').textContent,'Second');
        requests[1].resolve(new Response(JSON.stringify({event_descriptor:[{id:'second',data:{history:['Started','Ready'],
            description:'<b>Started</b><br>Ready [confirmed]\n<a href="https://example.org/report">Report</a><script>window.leaked=true</script><img src=x onerror="window.leaked=true">'}}]})));
        await second;
        assert.equal(t.data,'http://localhost/sessions?startDate=current');assert.equal(t.dataAbort,undefined);
        assert.match(panel.textContent,/warning/);assert.match(panel.textContent,/Started.*Ready/s);assert.match(panel.textContent,/Ready \[confirmed\]/);
        assert.equal(panel.querySelector('b').textContent,'Started');assert.equal(panel.querySelector('a').href,'https://example.org/report');
        assert.equal(panel.querySelector('script,img'),null);assert.equal(h.window.leaked,undefined);
        cancelDescriptor(t);
    } finally {h.close();}
});

test('Empty detail responses keep summary data and offer a separate retry',async()=>{
    const h=await createTimelineHarness();
    try {
        const {loadDescriptor,cancelDescriptor}=await h.importModule('src/openbexi_timeline_descriptor.js');
        const panel=h.window.document.createElement('aside');h.window.document.body.append(panel);
        h.window.fetch=async()=>new Response('',{status:200,headers:{'X-Request-ID':'synthetic-request'}});
        const t={name:'synthetic',data:'unchanged',ob_timeline_right_panel:panel,ob_scene:[{}],
            ob_get_url_head:()=>'/sessions',ob_remove_descriptor:()=>cancelDescriptor(t)};
        await loadDescriptor(t,0,{id:'sample',start:'2026-09-12T12:30:00Z',data:{title:'Summary',status:'warning'}});
        assert.match(panel.textContent,/Summary/);assert.match(panel.textContent,/empty response, HTTP 200.*synthetic-request/);
        assert.ok([...panel.querySelectorAll('button')].some(button=>button.textContent==='Retry details'));
        assert.equal(t.data,'unchanged');cancelDescriptor(t);
    } finally {h.close();}
});

test('Occurrence keys stay internal while descriptor requests use the original external ID',async()=>{
    const h=await createTimelineHarness();
    try {
        const {loadDescriptor,cancelDescriptor}=await h.importModule('src/openbexi_timeline_descriptor.js');
        const panel=h.window.document.createElement('aside');h.window.document.body.append(panel);
        let requested;
        h.window.fetch=async url=>{requested=new URL(url);return new Response(JSON.stringify({event_descriptor:[]}));};
        const t={name:'synthetic',ob_timeline_right_panel:panel,ob_scene:[{}],ob_get_url_head:()=>'/sessions',ob_remove_descriptor:()=>cancelDescriptor(t)};
        await loadDescriptor(t,0,{id:'external-record',sourceRecordKey:'opaque-parent',start:'2026-09-12T12:00:00Z',data:{title:'Source record'},
            activities:[{id:'external-child',sourceRecordKey:'opaque-child',data:{title:'Child record'}}]});
        assert.equal(requested.searchParams.get('event_id'),'external-record');
        assert.ok(!panel.textContent.includes('sourceRecordKey'));assert.ok(!panel.textContent.includes('opaque-'));
        assert.match(panel.textContent,/external-record/);assert.match(panel.textContent,/external-child/);
        assert.equal(panel.querySelector('details,summary'),null,'Activities and metadata are always expanded');
        cancelDescriptor(t);
    } finally {h.close();}
});

test('Details prioritize ID and namespace with readable dates and always visible metadata',async()=>{
    const h=await createTimelineHarness();
    try {
        const {renderDescriptor}=await h.importModule('src/openbexi_timeline_descriptor.js');
        const panel=h.window.document.createElement('aside');h.window.document.body.append(panel);
        const t={name:'summary',staticData:{},ob_timeline_right_panel:panel,ob_remove_descriptor:()=>{}};
        const record={id:'external-1',recordKind:'event',start:'2026-09-12T12:00:00Z',end:'2026-09-12T13:30:00Z',namespace:'Operations',
            data:{title:'Inspection',status:'Ready',type:'Session',custom:'Detailed metadata',description:'<b>Safe description</b>'}};
        renderDescriptor(t,0,record);
        const summary=panel.querySelector('.ob_descriptor_summary');
        assert.match(summary.textContent,/2026-09-12 12:00:00 UTC/);
        assert.match(summary.textContent,/1 hour 30 minutes/);
        assert.match(summary.textContent,/Operations/);assert.match(summary.textContent,/Ready/);
        assert.deepEqual([...summary.querySelectorAll('dt')].map(node=>node.textContent),['ID','Namespace','Status','Type','Start','End','Duration']);
        assert.equal(panel.querySelector('details,summary'),null);
        assert.match(panel.querySelector('.ob_descriptor_fields').textContent,/Detailed metadata/);
        assert.deepEqual([...panel.querySelectorAll('.ob_descriptor_fields th')].map(node=>node.textContent),['custom']);
        assert.equal(panel.querySelector('.ob_descriptor_description b').textContent,'Safe description');
        assert.equal(panel.querySelector('.ob_record_details').lastElementChild.className,'ob_descriptor_description_section');
        assert.equal(panel.querySelector('[aria-label^="Copy"],.ob_descriptor_copy,textarea'),null);
        renderDescriptor(t,0,{...record,data:{...record.data,custom:'Updated metadata'}});
        assert.equal(panel.querySelector('details,summary'),null,'Fetched metadata stays expanded');
        assert.match(panel.querySelector('.ob_descriptor_fields').textContent,/Updated metadata/);
        renderDescriptor(t,0,{id:'different',start:record.start,data:{title:'Instant'}});
        assert.equal(panel.querySelector('.ob_descriptor_fields'),null);
        assert.match(panel.querySelector('.ob_descriptor_summary').textContent,/Instant event/);
    } finally {h.close();}
});

test('Full formatted descriptions appear once after all visible metadata, without a flattened preview',async()=>{
    const h=await createTimelineHarness();
    try {
        const {renderDescriptor}=await h.importModule('src/openbexi_timeline_descriptor.js');
        const panel=h.window.document.createElement('aside');h.window.document.body.append(panel);
        const t={name:'compact',ob_timeline_right_panel:panel,ob_remove_descriptor:()=>{}};
        const description='<b>'+ 'Detailed report. '.repeat(30)+'</b><br><a href="https://example.org/report">Full report</a>';
        renderDescriptor(t,0,{id:0,start:0,namespace:' ',data:{title:'At epoch',status:'',type:null,namespace:'Operations',empty:[],blank:'  ',count:0,enabled:false,description}});
        const summary=panel.querySelector('.ob_descriptor_summary');
        assert.deepEqual([...summary.querySelectorAll('dt')].map(node=>node.textContent),['ID','Namespace','Start','Duration']);
        assert.equal(summary.querySelector('dd').textContent,'0');
        assert.equal(panel.querySelector('.ob_descriptor_namespace').textContent,'Operations');
        assert.equal(panel.querySelector('.ob_descriptor_preview'),null);
        const more=panel.querySelector('.ob_descriptor_fields');assert.equal(more.tagName,'DIV');
        assert.equal(panel.querySelector('details,summary'),null);
        const full=panel.querySelector('.ob_descriptor_description');
        assert.equal(panel.querySelectorAll('.ob_descriptor_description').length,1);
        assert.equal(full.closest('details'),null);
        assert.equal(full.textContent,'Detailed report. '.repeat(30)+'Full report');
        assert.equal(full.querySelectorAll('br').length,1);
        assert.equal(full.querySelector('a').href,'https://example.org/report');
        assert.equal(panel.querySelector('.ob_record_details').lastElementChild,full.parentElement);
        assert.equal(summary.nextElementSibling,more,'No description preview follows Duration');
        assert.deepEqual([...more.querySelectorAll('th')].map(node=>node.textContent),['count','enabled']);
        assert.match(more.textContent,/count0enabledfalse/);
        assert.equal(panel.querySelector('[aria-label^="Copy"],textarea'),null);
    } finally {h.close();}
});

test('Descriptor duration follows numeric-axis units and handles historical timestamps',async()=>{
    const h=await createTimelineHarness();
    try {
        const {renderDescriptor}=await h.importModule('src/openbexi_timeline_descriptor.js');
        const panel=h.window.document.createElement('aside');h.window.document.body.append(panel);
        const t={name:'dates',ob_timeline_right_panel:panel,ob_remove_descriptor:()=>{},
            staticTimeAxis:{kind:'numeric',millisecondsPerUnit:1000,unit:'Ma'},formatEventDate:value=>(Number(value)/1000)+' Ma'};
        renderDescriptor(t,0,{start:1000,end:2500,data:{title:'Numeric period'}});
        assert.match(panel.querySelector('.ob_descriptor_summary').textContent,/Duration1.5 Ma/);
        delete t.staticTimeAxis;delete t.formatEventDate;
        renderDescriptor(t,0,{start:'2 BCE',end:'1 BCE',data:{title:'Historical period'}});
        assert.match(panel.querySelector('.ob_descriptor_summary').textContent,/Duration365 days/);
    } finally {h.close();}
});

test('Source metadata remains secondary and is never mislabeled as namespace',async()=>{
    const h=await createTimelineHarness();
    try {
        const {renderDescriptor}=await h.importModule('src/openbexi_timeline_descriptor.js');
        const panel=h.window.document.createElement('aside');h.window.document.body.append(panel);
        const t={name:'source',ob_timeline_right_panel:panel,ob_remove_descriptor:()=>{}};
        renderDescriptor(t,0,{id:'report',start:0,namespace:'',data:{title:'Report',namespace:'',source:'Original provider'}});
        assert.ok(![...panel.querySelectorAll('.ob_descriptor_summary dt')].some(term=>['Source','Namespace'].includes(term.textContent)));
        const source=[...panel.querySelectorAll('.ob_descriptor_fields th')].find(term=>term.textContent==='source');
        assert.equal(source.nextElementSibling.textContent,'Original provider');
    } finally {h.close();}
});
