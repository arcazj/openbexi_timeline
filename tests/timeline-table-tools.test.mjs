import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';
import {allTableRows} from './helpers/table-pages.mjs';

async function setup(events) {
    const h=await createTimelineHarness();
    const {TimelineViews}=await h.importModule('src/openbexi_timeline_views.js');
    const {document}=h.window;
    const panel=document.createElement('div'),header=document.createElement('header');panel.append(header);document.body.append(panel);
    const t={name:'table-test',ob_timeline_panel:panel,ob_timeline_header:header,
        ob_scene:[{bands:[],sessions:{events}}],ob_viewport:{height:300,headerHeight:40},
        ob_results:{complete:true,supported:true,state:{highlight:true}},ob_open_descriptor:(index,record)=>t.opened=record};
    const views=new TimelineViews(t);views.tablePanel.hidden=false;views.renderTable();
    return {...h,t,views};
}
const record=(id,start,extra={})=>({id,start,data:{title:id,status:'Ready'},...extra});
const rows=h=>[...h.views.tablePanel.querySelectorAll('tbody tr')];
const sort=(h,field)=>h.views.tablePanel.querySelector('[data-sort="'+field+'"]');

test('Table sorts the complete paginated data chronologically, retains focus/selection and leaves source records intact',async()=>{
    const events=Array.from({length:21},(_,index)=>record('Record '+index,new Date(Date.UTC(2026,0,21-index)).toISOString()));
    const original=JSON.stringify(events),h=await setup(events);
    try {
        h.t.ob_results.selectedKey=':Record 20';
        const button=sort(h,'start');
        assert.equal(button.querySelector('.ob_table_sort_icon').textContent,'\u2195');
        button.focus();button.querySelector('.ob_table_sort_icon').click();
        assert.equal(h.window.document.activeElement.dataset.sort,'start');
        assert.equal(sort(h,'start').closest('th').getAttribute('aria-sort'),'ascending');
        assert.equal(sort(h,'start').querySelector('.ob_table_sort_icon').textContent,'\u2191');
        assert.match(rows(h)[0].textContent,/Record 20/);
        assert.equal(rows(h)[0].getAttribute('aria-selected'),'true');
        const all=allTableRows(h.views);
        assert.equal(all.length,21);
        assert.match(all.at(-1).textContent,/Record 0/);
        sort(h,'start').click();
        assert.equal(h.views.tablePage,0);
        assert.equal(sort(h,'start').closest('th').getAttribute('aria-sort'),'descending');
        assert.equal(sort(h,'start').querySelector('.ob_table_sort_icon').textContent,'\u2193');
        assert.match(rows(h)[0].textContent,/Record 0/);
        sort(h,'title').click();
        assert.deepEqual(allTableRows(h.views).map(row=>row.querySelector('[data-record]').textContent),events.map(event=>event.data.title));
        assert.equal(JSON.stringify(events),original);
    } finally {h.close();}
});

test('Missing date values remain last in either direction and equal values retain source order',async()=>{
    const h=await setup([record('Missing',undefined),record('Second','2026-01-02'),record('First','2026-01-01'),record('Tie','2026-01-01')]);
    try {
        sort(h,'start').click();
        assert.deepEqual(allTableRows(h.views).map(row=>row.querySelector('[data-record]').textContent),['First','Tie','Second','Missing']);
        sort(h,'start').click();
        assert.deepEqual(allTableRows(h.views).map(row=>row.querySelector('[data-record]').textContent),['Second','First','Tie','Missing']);
    } finally {h.close();}
});

test('Column chooser supports optional fields and keyboard detail access with title hidden',async()=>{
    const h=await setup([record('external-12','2026-01-01')]);
    try {
        const panel=h.views.tablePanel;
        panel.querySelector('.ob_table_columns').open=true;
        const id=panel.querySelector('[data-column="id"]');id.focus();id.click();
        assert.ok(sort(h,'id'));assert.equal(h.window.document.activeElement.dataset.column,'id');
        assert.equal(panel.querySelector('.ob_table_columns').open,true);
        for(const field of ['title','start','end','source','status']) panel.querySelector('[data-column="'+field+'"]').click();
        assert.equal(panel.querySelectorAll('th').length,1);
        assert.equal(panel.querySelector('[data-column="id"]').disabled,true,'At least one column stays visible');
        const row=rows(h)[0];row.focus();row.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
        assert.equal(h.t.opened.id,'external-12');
        h.views.renderTable();assert.equal(h.window.document.activeElement.dataset.record,':external-12');
        panel.querySelector('.ob_table_columns').dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        assert.equal(panel.querySelector('.ob_table_columns').open,false);
        assert.equal(h.window.document.activeElement.dataset.tableControl,'columns');
    } finally {h.close();}
});

test('CSV exports every current table page, quotes text and neutralizes formulas with honest partial coverage',async()=>{
    const entries=Array.from({length:21},(_,index)=>record('record-'+index,'2026-01-01',
        {data:{title:index===0?'=1+1':index===1?'  @SUM(1,2)':index===2?'A "quote", then\na new line':'Record '+index}}));
    const h=await setup(entries);
    try {
        let blob,download;
        h.window.URL.createObjectURL=value=>{blob=value;return 'blob:table-test';};
        h.window.URL.revokeObjectURL=()=>{};
        h.window.HTMLAnchorElement.prototype.click=function(){download=this.download;};
        h.t.ob_results.complete=false;h.views.renderTable();
        assert.match(h.views.tablePanel.querySelector('[data-table-control="export"]').textContent,/loaded records/);
        assert.match(h.views.tablePanel.querySelector('.ob_table_export_status').textContent,/Coverage incomplete/);
        assert.ok(rows(h).length<21);
        h.views.tablePanel.querySelector('[data-table-control="export"]').click();
        const csv=await new Promise((resolve,reject)=>{const reader=new h.window.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob);});
        assert.equal(download,'table-test-events.csv');
        assert.match(csv,/"'=1\+1"/);assert.match(csv,/"'  @SUM\(1,2\)"/);
        assert.match(csv,/"A ""quote"", then\na new line"/);
        assert.match(csv,/Record 20/);assert.match(csv,/"2026-01-01"/);
        assert.match(h.views.tablePanel.querySelector('.ob_table_export_status').textContent,/Exported 21 records from loaded data/);
        h.t.ob_scene[0].sessions={events:entries.slice(0,2)};h.views.renderTable();
        h.views.tablePanel.querySelector('[data-table-control="export"]').click();
        const filtered=await new Promise(resolve=>{const reader=new h.window.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(blob);});
        assert.ok(!filtered.includes('Record 20'),'Refresh exports only records retained by the current table filter');
    } finally {h.close();}
});

test('Empty tables keep column and sort controls and disable CSV export',async()=>{
    const h=await setup([]);
    try {
        assert.equal(h.views.tablePanel.querySelector('[data-table-control="export"]').disabled,true);
        sort(h,'title').click();
        assert.match(h.views.tablePanel.textContent,/No events to display/);
        assert.equal(rows(h).length,1);
    } finally {h.close();}
});

test('Table tolerates non-array event and nested activity collections without losing valid records or source context',async()=>{
    const h=await setup([]);
    try {
        h.t.ob_viewport.height=1000;
        const unavailable=[undefined,null,{},'unavailable',true,42];
        for(const events of unavailable) {
            h.t.ob_scene[0].sessions={events};h.views.renderTable();
            assert.match(h.views.tablePanel.textContent,/No events to display/);
            assert.equal(h.views.tablePanel.querySelector('[data-table-control="export"]').disabled,true);
        }
        const entries=unavailable.map((activities,index)=>record('Record '+index,'2026-01-01',{
            activities,data:{title:'Record '+index,...(index===0?{source:'Explicit provider'}:{})}
        }));
        h.t.ob_scene[0].sessions={events:entries};h.views.renderTable();
        assert.equal(allTableRows(h.views).length,entries.length,'Invalid activity collections keep their parent record visible');
        const sessions={events:[record('Parent','2026-01-01',{namespace:'Inherited provider',activities:[
            record('Intermediate','2026-01-01',{activities:entries})
        ]})],densityRecords:entries};
        const original=JSON.stringify(sessions);
        h.t.ob_scene[0].sessions=sessions;h.views.renderTable();
        const visible=allTableRows(h.views);
        assert.equal(visible.length,entries.length);
        assert.deepEqual(visible.map(row=>row.cells[3].textContent),
            entries.map((_,index)=>index===0?'Explicit provider':'Inherited provider'));
        assert.equal(JSON.stringify(sessions),original);
    } finally {h.close();}
});

test('Saved table presentation restores visible columns and sort while rejecting invalid state safely',async()=>{
    const h=await setup([record('Later','2 CE'),record('Earlier','2 BCE')]);
    try {
        sort(h,'start').click();
        assert.match(rows(h)[0].textContent,/Earlier/,'Historical dates sort chronologically');
        h.views.tablePanel.querySelector('[data-column="id"]').click();
        const saved=h.views.capturePresentation();
        h.views.tablePanel.querySelector('[data-column="title"]').click();
        sort(h,'start').click();
        assert.equal(h.views.restorePresentation(saved),true);h.views.renderTable();
        assert.equal(sort(h,'start').closest('th').getAttribute('aria-sort'),'ascending');
        assert.ok(sort(h,'title'));assert.ok(sort(h,'id'));
        const before=JSON.stringify(h.views.capturePresentation());
        for(const state of [null,{},[],{sort:{field:'private',direction:'ascending'}},{columns:{id:'false'}}])
            assert.equal(h.views.restorePresentation(state),false);
        assert.equal(JSON.stringify(h.views.capturePresentation()),before);
        assert.equal(h.views.restorePresentation({columns:Object.fromEntries(Object.keys(saved.columns).map(field=>[field,false]))}),true);
        assert.ok(h.views.tableColumns().some(column=>column.visible));
    } finally {h.close();}
});

test('Numeric CSV preserves exact source values, approximate prefixes and zero endpoints without display rounding',async()=>{
    const h=await setup([
        record('Original',-12345678900,{end:0,data:{title:'Original',startValue:'~12.345678901234',endValue:0}}),
        record('Fallback',-12345678900,{data:{title:'Fallback'}})
    ]);
    try {
        let blob;
        h.t.staticTimeAxis={kind:'numeric',unit:'Ma',millisecondsPerUnit:1000000000,direction:-1};
        h.t.formatEventDate=value=>(Number(value)/-1000000000).toFixed(2)+' Ma';
        h.window.URL.createObjectURL=value=>{blob=value;return 'blob:numeric-test';};
        h.window.URL.revokeObjectURL=()=>{};h.window.HTMLAnchorElement.prototype.click=()=>{};
        h.views.renderTable();
        assert.match(rows(h)[0].textContent,/12.35 Ma/,'The visible label still rounds for readability');
        h.views.tablePanel.querySelector('[data-table-control="export"]').click();
        const csv=await new Promise(resolve=>{const reader=new h.window.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(blob);});
        assert.match(csv,/"Start \(Ma\)","End \(Ma\)"/);
        assert.match(csv,/"Original","~12.345678901234","0"/);
        assert.match(csv,/"Fallback","12.3456789",""/);
        assert.ok(!csv.includes('12.35 Ma'));
    } finally {h.close();}
});

test('Table and CSV use nonempty record sources and inherit available session source metadata',async()=>{
    const h=await setup([
        record('Explicit','2026-01-01',{namespace:'',data:{title:'Explicit',namespace:' ',source:'Record provider'}}),
        {namespace:'',data:{namespace:'',source:'Session provider'},activities:[
            record('Inherited','2026-01-02',{namespace:'',data:{title:'Inherited',namespace:''}})
        ]}
    ]);
    try {
        let blob;
        const sources=rows(h).map(row=>row.cells[3].textContent);
        assert.deepEqual(sources,['Record provider','Session provider']);
        h.window.URL.createObjectURL=value=>{blob=value;return 'blob:source-test';};
        h.window.URL.revokeObjectURL=()=>{};h.window.HTMLAnchorElement.prototype.click=()=>{};
        h.views.tablePanel.querySelector('[data-table-control="export"]').click();
        const csv=await new Promise(resolve=>{const reader=new h.window.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(blob);});
        assert.match(csv,/"Record provider"/);assert.match(csv,/"Session provider"/);
    } finally {h.close();}
});

test('Normalized table, source sorting and CSV retain ancestor sources through flattened match projections',async()=>{
    const h=await setup([]);
    try {
        const {parseTimelineData}=await h.importModule('src/openbexi_timeline_data_parser.js');
        const {createStaticMatchSnapshot,projectMatchSnapshot}=await h.importModule('src/openbexi_timeline_matches.js');
        const payload={events:[record('Parent','2026-01-01',{namespace:'Operations',data:{title:'Parent',source:'Parent provider'},activities:[
            record('match inherited','2026-01-02'),
            record('Intermediate','2026-01-02',{activities:[record('match grandchild','2026-01-03')]}),
            record('match explicit namespace','2026-01-04',{namespace:'Child namespace'}),
            record('match explicit source','2026-01-05',{data:{title:'match explicit source',source:'Child provider'}})
        ]})]};
        const data=parseTimelineData(JSON.stringify(payload));
        const before=JSON.stringify(data);
        const snapshot=createStaticMatchSnapshot(data,'match');
        const expected={Parent:'Operations','match inherited':'Operations',Intermediate:'Operations',
            'match grandchild':'Operations','match explicit namespace':'Child namespace','match explicit source':'Child provider'};
        let blob;
        h.window.URL.createObjectURL=value=>{blob=value;return 'blob:projected-source-test';};
        h.window.URL.revokeObjectURL=()=>{};h.window.HTMLAnchorElement.prototype.click=()=>{};
        for(const mode of ['highlight','only']) {
            const projection=projectMatchSnapshot(snapshot,mode),originalProjection=JSON.stringify(projection);
            h.t.ob_scene[0].sessions=projection;h.views.renderTable();
            const visible=allTableRows(h.views);
            assert.equal(visible.length,mode==='only'?4:6);
            for(const row of visible)assert.equal(row.cells[3].textContent,expected[row.querySelector('[data-record]').textContent]);
            sort(h,'source').click();
            if(sort(h,'source').closest('th').getAttribute('aria-sort')!=='ascending')sort(h,'source').click();
            assert.equal(rows(h)[0].querySelector('[data-record]').textContent,'match explicit namespace');
            h.views.tablePanel.querySelector('[data-table-control="export"]').click();
            const csv=await new Promise(resolve=>{const reader=new h.window.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(blob);});
            for(const title of ['match inherited','match grandchild','match explicit namespace','match explicit source'])
                assert.ok(csv.split('\r\n').some(line=>line.startsWith('"'+title+'",') && line.includes(',"'+expected[title]+'",')),title);
            assert.equal(JSON.stringify(projection),originalProjection,'Resolving presentation context does not mutate records');
        }
        assert.equal(JSON.stringify(data),before);
    } finally {h.close();}
});
