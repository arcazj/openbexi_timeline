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
        cancelDescriptor(t);
    } finally {h.close();}
});

test('Details show readable dates, duration, source/status and collapsed complete metadata with safe copy controls',async()=>{
    const h=await createTimelineHarness();
    try {
        const {renderDescriptor}=await h.importModule('src/openbexi_timeline_descriptor.js');
        const panel=h.window.document.createElement('aside');h.window.document.body.append(panel);
        const t={name:'summary',staticData:{},ob_timeline_right_panel:panel,ob_remove_descriptor:()=>{}};
        const record={id:'external-1',start:'2026-09-12T12:00:00Z',end:'2026-09-12T13:30:00Z',namespace:'Operations',
            data:{title:'Inspection',status:'Ready',custom:'Detailed metadata',description:'<b>Safe description</b>'}};
        renderDescriptor(t,0,record);
        const summary=panel.querySelector('.ob_descriptor_summary');
        assert.match(summary.textContent,/2026-09-12 12:00:00 UTC/);
        assert.match(summary.textContent,/1 hour 30 minutes/);
        assert.match(summary.textContent,/Operations/);assert.match(summary.textContent,/Ready/);
        assert.equal(panel.querySelector('.ob_descriptor_fields').open,false);
        assert.match(panel.querySelector('.ob_descriptor_fields').textContent,/Detailed metadata/);
        assert.equal(panel.querySelector('.ob_descriptor_description b').textContent,'Safe description');
        let copied;
        Object.defineProperty(h.window.navigator,'clipboard',{value:{writeText:async value=>{copied=value;}}});
        await summary.querySelector('[aria-label="Copy Start"]').onclick();
        assert.equal(copied,record.start);
        assert.equal(panel.querySelector('.ob_descriptor_copy_status').textContent,'Start copied.');
        panel.querySelector('.ob_descriptor_fields').open=true;
        renderDescriptor(t,0,{...record,data:{...record.data,custom:'Updated metadata'}});
        assert.equal(panel.querySelector('.ob_descriptor_fields').open,true,'Fetching details preserves the expanded fields');
        renderDescriptor(t,0,{id:'different',start:record.start,data:{title:'Instant'}});
        assert.equal(panel.querySelector('.ob_descriptor_fields').open,false);
        assert.match(panel.querySelector('.ob_descriptor_summary').textContent,/Instant event/);
    } finally {h.close();}
});

test('Clipboard restrictions fall back to selectable original values and announce the outcome',async()=>{
    const h=await createTimelineHarness();
    try {
        const {renderDescriptor}=await h.importModule('src/openbexi_timeline_descriptor.js');
        const panel=h.window.document.createElement('aside');h.window.document.body.append(panel);
        const t={name:'copy',ob_timeline_right_panel:panel,ob_remove_descriptor:()=>{}};
        renderDescriptor(t,0,{id:'original-id',start:0,data:{title:'At epoch'}});
        const button=panel.querySelector('[aria-label="Copy ID"]');
        await button.onclick();
        const fallback=panel.querySelector('textarea');
        assert.equal(fallback.value,'original-id');assert.equal(fallback.readOnly,true);
        assert.equal(h.window.document.activeElement,fallback);assert.equal(fallback.selectionEnd,'original-id'.length);
        assert.match(panel.querySelector('.ob_descriptor_copy_status').textContent,/Select and copy/);
        assert.equal(panel.querySelector('[aria-label="Copy Start"]').disabled,false,'Zero timestamps have a copy control');
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

test('Descriptor summary falls back to source metadata when normalized namespaces are empty',async()=>{
    const h=await createTimelineHarness();
    try {
        const {renderDescriptor}=await h.importModule('src/openbexi_timeline_descriptor.js');
        const panel=h.window.document.createElement('aside');h.window.document.body.append(panel);
        const t={name:'source',ob_timeline_right_panel:panel,ob_remove_descriptor:()=>{}};
        renderDescriptor(t,0,{id:'report',start:0,namespace:'',data:{title:'Report',namespace:'',source:'Original provider'}});
        const source=[...panel.querySelectorAll('.ob_descriptor_summary dt')].find(term=>term.textContent==='Source');
        assert.equal(source.nextElementSibling.textContent,'Original provider');
    } finally {h.close();}
});
