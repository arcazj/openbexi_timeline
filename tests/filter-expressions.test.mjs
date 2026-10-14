import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {compileFilter,decodeFilter} from '../src/openbexi_timeline_filter_expression.js';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';
const fixture=JSON.parse(await fs.readFile('tests/fixtures/filter-expressions.json','utf8'));
for(const sample of fixture.cases)test('Shared filter syntax: '+(sample.expression || 'all'),()=>{
    assert.deepEqual(fixture.records.filter(compileFilter(sample.expression)).map(record=>record.id),sample.ids);
});
test('Invalid expressions and excessive nesting fail before applying a filter',()=>{
    for(const expression of fixture.invalid)assert.throws(()=>compileFilter(expression),/Filter|filter|Invalid|regular/);
    assert.throws(()=>compileFilter('expr: '+'NOT '.repeat(35)+'a = b'),/32 levels/);
    assert.throws(()=>compileFilter('x'.repeat(4097)),/4096/);
    assert.equal(compileFilter('expr: priority = -0 AND priority >= -0')({priority:0}),true);
    assert.equal(compileFilter('expr: priority > -0')({priority:0}),false);
});
test('Editor preserves quoted syntax, reports errors inline, and keeps saved sorting',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
        const t=new OB_TIMELINE({autoStart:false});
        await t.loadModel('/HBDS/templates/models/demos/default-dataset.json',{dataset:'/json/test-data/default-dataset.json'});
        t.ob_create_filters(0,undefined,'add_filter');
        const panel=t.ob_timeline_right_panel;
        assert.ok(panel.querySelector('.ob_filter_build_section .ob_new_filter'));
        assert.equal(panel.querySelector('.ob_filter_build_section').open,true);
        assert.equal(panel.querySelector('.ob_filter_advanced').open,true);
        const name=panel.querySelector('[aria-label="New filter name"]'),input=panel.querySelector('textarea');
        assert.equal(name.labels[0].textContent,'Filter name');
        name.value='Advanced';input.value='expr: priority >';
        const draftHelp=panel.querySelector('[aria-label="Filter syntax for new filter"]');
        draftHelp.click();
        assert.match(h.window.document.getElementById(draftHelp.getAttribute('aria-controls')).textContent,/expr: priority >/);
        t.ob_load_filters('addFilter',0,undefined,true);
        assert.match(panel.querySelector('[data-filter-error]').textContent,/character/);
        assert.equal(input.getAttribute('aria-invalid'),'true');
        assert.ok(!t.ob_filters.some(filter=>filter.name==='Advanced'));
        input.value='expr: title CONTAINS "A+B | ready"';
        const select=panel.querySelector('[aria-label="Group by (sort_by)"]');
        if(![...select.options].some(option=>option.value==='namespace'))select.add(new h.window.Option('namespace','namespace'));
        select.value='namespace';t.ob_load_filters('addFilter',0,undefined,true);
        const saved=t.ob_filters.find(filter=>filter.name==='Advanced');
        assert.equal(saved.sortBy,'namespace');assert.equal(t.ob_sortBy,'namespace');
        t.ob_create_filters(0,t.ob_filters.indexOf(saved),'edit_filter');
        const helpButton=panel.querySelector('[aria-label="Filter syntax for Advanced"]');helpButton.click();
        const help=h.window.document.getElementById(helpButton.getAttribute('aria-controls'));
        assert.equal(panel.querySelector('.ob_filter_editing textarea').value,'expr: title CONTAINS "A+B | ready"');
        assert.equal(help.hidden,false);
        assert.match(help.textContent,/Legacy:/);
        select.value='NONE';
        panel.querySelector('[aria-label="Sort by"]').value='NONE';t.ob_apply_timeline_sorting(0);
        assert.ok(panel.querySelector('.ob_filter_build_section > summary'));
        assert.equal(panel.querySelector('[data-filter-sorting] legend').textContent,'Timeline sorting by NONE');
    } finally {h.close();}
});

test('Saved expressions are copyable previews; Edit, validation, Cancel and Save preserve exact syntax',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
        const t=new OB_TIMELINE({autoStart:false});
        await t.loadModel('/HBDS/templates/models/demos/default-dataset.json',{dataset:'/json/test-data/default-dataset.json'});
        const original='expr: NOT title CONTAINS "A+B | 25% (planned)"';
        t.ob_filters=[{name:'ALL',filter_value:'',sortBy:'NONE',current:'yes'},
            {name:'Operations',filter_value:original,sortBy:'namespace',current:'no'}];
        t.ob_create_filters(0,undefined,'select_filter');
        const row=()=>t.ob_timeline_right_panel.querySelectorAll('.ob_saved_filter')[1];
        const click=label=>[...row().querySelectorAll('button')].find(button=>button.textContent===label).click();
        let input=row().querySelector('textarea');
        assert.equal(input.value,original);assert.equal(input.readOnly,true);assert.equal(input.disabled,false);
        click('Edit');input=row().querySelector('textarea');
        assert.equal(input.readOnly,false);assert.equal(h.window.document.activeElement,input);
        input.value='expr: priority >';click('Save');
        assert.equal(t.ob_filters[1].filter_value,original);assert.equal(input.getAttribute('aria-invalid'),'true');
        assert.ok(row().querySelector('[data-filter-error]').textContent);
        click('Cancel');assert.equal(row().querySelector('textarea').value,original);
        assert.equal(row().querySelector('textarea').readOnly,true);
        click('Edit');input=row().querySelector('textarea');input.value=original+' AND EXISTS(title)';
        const updated=input.value;click('Save');
        assert.equal(row().querySelector('textarea').readOnly,true);assert.equal(row().querySelector('textarea').value,updated);
        assert.ok(row().classList.contains('ob_filter_selected'));
        assert.ok(h.window.localStorage.getItem(`openbexi:filters:/:${t.name}`).includes('Operations'));
        // Copying previews remains available during a server outage.
        t.staticData=null;t.ob_scene[0].connected=false;t.ob_create_filters(0,undefined,'select_filter');
        assert.equal(row().querySelector('textarea').disabled,false);
        assert.ok([...row().querySelectorAll('button')].filter(button=>['Edit','Delete'].includes(button.textContent)).every(button=>button.disabled));
        assert.equal(row().querySelector('[aria-label="Filter syntax for Operations"]').disabled,false);
    } finally {h.close();}
});

test('A failed local save retains the draft and original saved criteria',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
        const t=new OB_TIMELINE({autoStart:false});
        await t.loadModel('/HBDS/templates/models/demos/default-dataset.json',{dataset:'/json/test-data/default-dataset.json'});
        t.ob_create_filters(0,0,'edit_filter');
        const input=t.ob_timeline_right_panel.querySelector('.ob_filter_editing textarea'),saved=JSON.stringify(t.ob_filters);
        const before=t.ob_scene[0].ob_filter_value;input.value='expr: EXISTS(title)';
        h.window.Storage.prototype.setItem=()=>{throw new Error('Storage full');};
        t.ob_save_filter(0,0);
        assert.equal(JSON.stringify(t.ob_filters),saved);assert.equal(t.ob_scene[0].ob_filter_value,before);
        assert.equal(input.value,'expr: EXISTS(title)');assert.equal(input.readOnly,false);
        assert.match(t.ob_timeline_right_panel.querySelector('.ob_filter_editing [data-filter-error]').textContent,/Could not save/);
    } finally {h.close();}
});

test('A saved exclusion can be selected again after the builder or filter chip changes its active criteria',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
        const t=new OB_TIMELINE({autoStart:false});
        await t.loadModel('/HBDS/templates/models/demos/default-dataset.json',{dataset:'/json/test-data/default-dataset.json'});
        t.staticData.events=[
            {id:'finished',namespace:'operations',start:'2026-09-12T12:00:00Z',render:{},data:{title:'Nominal ranging',system:'RNG',status:'FINISHED'}},
            {id:'warning',namespace:'operations',start:'2026-09-12T12:00:00Z',render:{},data:{title:'Ranging warning',system:'RNG',status:'WARNING'}}
        ];
        t.ob_filters=[{name:'ALL',filter_value:'',sortBy:'NONE',current:'yes'},
            {name:'NAMESPACE_Exclude_Nominal_RNG',filter_value:'|system:RNG+status:FINISHED',sortBy:'namespace',current:'no'}];
        t.ob_create_filters(0,undefined,'select_filter');
        const selected=()=>t.ob_timeline_right_panel.querySelector('[aria-label="NAMESPACE_Exclude_Nominal_RNG"]');
        const settle=async()=>{const until=Date.now()+3000;while(t.ob_results.pending){assert.ok(Date.now()<until);await new Promise(resolve=>setTimeout(resolve,15));}};
        const ids=()=>Array.from(t.ob_results.snapshot.entries,entry=>entry.record.id);
        selected().click();await settle();
        assert.deepEqual(ids(),['warning']);assert.equal(selected().checked,true);
        t.ob_results.controls.changeFilter('');await settle();
        assert.equal(selected().checked,false,'Clearing the active filter must uncheck its saved preset');
        assert.deepEqual(ids().sort(),['finished','warning']);
        selected().click();await settle();
        assert.deepEqual(ids(),['warning']);assert.equal(selected().checked,true);
        t.ob_results.controls.changeFilter('expr: status = "FINISHED"','Custom');await settle();
        assert.equal(selected().checked,false,'A builder expression must not leave the previous preset checked');
        selected().click();await settle();
        assert.deepEqual(ids(),['warning']);
        t.ob_results.controls.changeFilter(t.ob_scene[0].ob_filter_value,t.ob_scene[0].ob_filter_name,'NONE');await settle();
        assert.equal(selected().checked,false,'The checked preset must describe the current grouping as well as its expression');
        selected().click();await settle();
        assert.equal(t.ob_sortBy,'namespace');assert.deepEqual(ids(),['warning']);
    } finally {h.close();}
});

test('Every saved filter has accessible contextual help that remains usable while disconnected',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
        const t=new OB_TIMELINE({autoStart:false});
        await t.loadModel('/HBDS/templates/models/demos/default-dataset.json',{dataset:'/json/test-data/default-dataset.json'});
        t.ob_filters=[{name:'ALL',filter_value:'',sortBy:'NONE',current:'yes'},
            {name:'Quoted "name" <filter>',filter_value:'|status:FINISHED',sortBy:'NONE',current:'no'}];
        t.staticData=null;t.ob_scene[0].connected=false;t.ob_create_filters(0,undefined,'select_filter');
        const rows=[...t.ob_timeline_right_panel.querySelectorAll('.ob_saved_filter')];
        const helpIds=new Set();
        for(const [index,row] of rows.entries()) {
            const helpButton=[...row.querySelectorAll('button')].find(button=>button.textContent==='?');
            assert.ok(helpButton,'A compact help button belongs to each saved filter');
            assert.equal(helpButton.getAttribute('aria-label'),'Filter syntax for '+t.ob_filters[index].name);
            assert.equal(helpButton.type,'button');assert.equal(helpButton.disabled,false);
            const id=helpButton.getAttribute('aria-controls');assert.ok(id);assert.ok(!helpIds.has(id));helpIds.add(id);
            const help=h.window.document.getElementById(id);
            assert.ok(row.contains(help),'Help explains this row without leaving the filter panel');
            assert.equal(help.getAttribute('role'),'tooltip');assert.equal(help.hidden,true);
            assert.equal(helpButton.getAttribute('aria-describedby'),id);
            helpButton.focus();
            assert.equal(help.hidden,false);
            assert.match(help.textContent,/Legacy:/);assert.match(help.textContent,/expr:/);
            helpButton.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
            assert.equal(help.hidden,true);
            assert.equal(h.window.document.activeElement,helpButton);
            helpButton.click();assert.equal(help.hidden,false);
            assert.equal(row.querySelector('textarea').readOnly,true);assert.equal(row.querySelector('textarea').disabled,false);
            assert.ok([...row.querySelectorAll('button')].filter(button=>['Edit','Delete'].includes(button.textContent)).every(button=>button.disabled));
        }
        assert.ok(![...t.ob_timeline_right_panel.querySelectorAll('button')].some(button=>/^(Retry filters|Filter syntax)$/.test(button.textContent)));
    } finally {h.close();}
});

test('Multiline legacy regex survives adding, editing, cancelling and deleting a saved filter',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
        const t=new OB_TIMELINE({autoStart:false});
        await t.loadModel('/HBDS/templates/models/demos/default-dataset.json',{dataset:'/json/test-data/default-dataset.json'});
        const original='title:Phase \\(A\\);description:25%\n|status:FINISHED+system:RNG';
        assert.doesNotThrow(()=>compileFilter(original));
        t.ob_create_filters(0,undefined,'select_filter');
        t.ob_timeline_right_panel.querySelector('.ob_filter_build_section').open=true;
        t.ob_timeline_right_panel.querySelector('[aria-label="New filter name"]').value='Multiline';
        const draft=t.ob_timeline_right_panel.querySelector('[aria-label="New filter expression"]');
        draft.value=original;draft.dispatchEvent(new h.window.Event('input',{bubbles:true}));
        const action=(scope,label)=>{const found=[...scope.querySelectorAll('button')].find(button=>button.textContent===label);assert.ok(found,label+' action is present');found.click();};
        action(t.ob_timeline_right_panel,'Save filter');
        const row=()=>[...t.ob_timeline_right_panel.querySelectorAll('.ob_saved_filter')].find(row=>row.querySelector('input[type="radio"]').getAttribute('aria-label')==='Multiline');
        let preview=row().querySelector('textarea');
        assert.equal(preview.value,original);assert.equal(preview.readOnly,true);
        assert.equal(preview.rows,1);assert.equal(preview.wrap,'soft');
        action(row(),'Edit');
        let editor=row().querySelector('textarea');assert.equal(editor.value,original);assert.equal(editor.readOnly,false);
        editor.value='title:discarded';action(row(),'Cancel');
        assert.equal(row().querySelector('textarea').value,original);
        action(row(),'Edit');editor=row().querySelector('textarea');
        const updated=original.replace('FINISHED','COMPLETE')+'\n';editor.value=updated;
        editor.dispatchEvent(new h.window.Event('input',{bubbles:true}));action(row(),'Save');
        assert.equal(row().querySelector('textarea').value,updated);
        const stored=JSON.parse(h.window.localStorage.getItem(`openbexi:filters:/:${t.name}`));
        assert.equal(decodeFilter(stored.find(filter=>filter.name==='Multiline').filter_value),updated);
        // Reopen through the saved local profile, including exact line breaks and regex escapes.
        t.ob_filters=undefined;t.ob_create_filters(0,undefined,'select_filter');
        assert.equal(row().querySelector('textarea').value,updated);
        action(row(),'Delete');assert.equal(row(),undefined);
        assert.ok(!JSON.parse(h.window.localStorage.getItem(`openbexi:filters:/:${t.name}`)).some(filter=>filter.name==='Multiline'));
    } finally {h.close();}
});


test('Builder saves supported namespace conditions, clones without applying, and protects existing filters',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
        const t=new OB_TIMELINE({autoStart:false});
        await t.loadModel('/HBDS/templates/models/demos/default-dataset.json',{dataset:'/json/test-data/default-dataset.json'});
        const {parseTimelineData}=await h.importModule('src/openbexi_timeline_data.js');
        t.staticData=parseTimelineData(JSON.stringify({events:[
            {id:'yes',namespace:'operations',start:'2026-09-12T12:00:00Z',data:{title:'Started',status:'STARTED'}},
            {id:'no',namespace:'planning',start:'2026-09-12T12:00:00Z',data:{title:'Other',status:'STARTED'}}]}));
        t.ob_results.request();
        const settled=async()=>{for(let i=0;i<100 && t.ob_results.pending;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(t.ob_results.pending,false);};
        await settled();t.ob_create_filters(0,undefined,'select_filter');
        const panel=()=>t.ob_timeline_right_panel.querySelector('.ob_filter_panel');
        const find=label=>panel().querySelector('[aria-label="'+label+'"]');
        const change=(label,value,event='change')=>{const input=find(label);input.value=value;input.dispatchEvent(new h.window.Event(event,{bubbles:true}));};
        assert.equal(panel().querySelector('[aria-label="Add a new filter"]'),null);
        panel().querySelector('.ob_filter_build_section').open=true;
        const before=t.ob_scene[0].ob_filter_value,requests=h.requests.length;
        change('Namespace','operations');change('Group by (sort_by)','status');change('Filter field','status');change('Filter value','STARTED','input');
        assert.equal(find('New filter expression').value,'expr: namespace = "operations" AND (status = "STARTED")');
        assert.equal(t.ob_scene[0].ob_filter_value,before);assert.equal(t.ob_sortBy || 'NONE','NONE');assert.equal(h.requests.length,requests);
        find('New filter name').value='Scoped';
        panel().querySelector('.ob_filter_draft_actions button').click();await settled();
        const saved=t.ob_filters.find(filter=>filter.name==='Scoped');
        assert.equal(decodeFilter(saved.filter_value),'expr: namespace = "operations" AND (status = "STARTED")');
        assert.equal(saved.sortBy,'status');assert.deepEqual([...t.ob_results.snapshot.entries].map(entry=>entry.record.id),['yes']);
        assert.equal(panel().querySelector('.ob_filter_build_section').open,false);
        panel().querySelector('.ob_filter_build_section').open=true;
        const active=t.ob_scene[0].ob_filter_value,count=t.ob_filters.length;
        change('Clone existing filter','Scoped');
        assert.equal(find('Namespace').value,'operations');assert.equal(find('Group by (sort_by)').value,'status');assert.equal(find('New filter name').value,'');
        assert.equal(find('New filter expression').value,decodeFilter(saved.filter_value));assert.equal(t.ob_scene[0].ob_filter_value,active);
        find('New filter name').value='Scoped';panel().querySelector('.ob_filter_draft_actions button').click();
        assert.match(panel().querySelector('.ob_new_filter [data-filter-error]').textContent,/already exists/);assert.equal(t.ob_filters.length,count);
        find('New filter name').value='Cloned';change('Namespace','planning');
        panel().querySelector('.ob_filter_draft_actions button').click();await settled();
        assert.deepEqual([...t.ob_results.snapshot.entries].map(entry=>entry.record.id),['no']);
        assert.equal(decodeFilter(t.ob_filters.find(filter=>filter.name==='Scoped').filter_value),decodeFilter(saved.filter_value));
        panel().querySelector('.ob_filter_build_section').open=true;change('Clone existing filter','Scoped');
        const current=t.ob_scene[0].ob_filter_value;
        [...panel().querySelectorAll('.ob_filter_draft_actions button')].find(button=>button.textContent==='Cancel').click();
        assert.equal(t.ob_scene[0].ob_filter_value,current);assert.equal(t.ob_filters.length,count+1);assert.equal(panel().querySelector('.ob_filter_build_section').open,false);
        assert.equal(h.requests.length,requests,'Drafting, cloning and local save never refetch the dataset');
    } finally {h.close();}
});

test('Cloning legacy regex preserves its syntax and independent grouping exactly',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');const t=new OB_TIMELINE({autoStart:false});
        await t.loadModel('/HBDS/templates/models/demos/default-dataset.json',{dataset:'/json/test-data/default-dataset.json'});
        const original='|system:RNG+status:FINISHED\n';
        t.ob_filters=[{name:'Legacy',filter_value:original,sortBy:'namespace',current:'yes'}];
        t.ob_create_filters(0,undefined,'add_filter');
        const panel=t.ob_timeline_right_panel,clone=panel.querySelector('[data-filter-clone]');clone.value='Legacy';clone.dispatchEvent(new h.window.Event('change'));
        assert.equal(panel.querySelector('[aria-label="New filter expression"]').value,original);
        panel.querySelector('[aria-label="New filter name"]').value='Legacy_copy';panel.querySelector('.ob_filter_draft_actions button').click();
        assert.equal(decodeFilter(t.ob_filters.find(filter=>filter.name==='Legacy_copy').filter_value),original);
        assert.equal(t.ob_filters.find(filter=>filter.name==='Legacy_copy').sortBy,'namespace');
    } finally {h.close();}
});

test('Namespace and grouping choices use real records, nested session metadata and late source settings',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');const t=new OB_TIMELINE({autoStart:false});
        await t.loadModel('/HBDS/templates/models/demos/default-dataset.json',{dataset:'/json/test-data/default-dataset.json'});
        const {filterDataOptions,refreshFilterOptions}=await h.importModule('src/openbexi_timeline_filters.js');
        t.staticData={events:Array.from({length:101},(_,i)=>({id:String(i),namespace:'real',data:{title:'Record',status:'ok'}}))};
        t.staticData.events[100].activities=[{data:{namespace:'child',type:'activity',metrics:{score:3},enabled:true,sourceRecordKey:'private'}}];
        t.ob_scene[0].sources=[{namespace:'configured',enable:true},{namespace:'disabled',enable:false},{namespace:'real'}];
        t.ob_create_filters(0,undefined,'select_filter');
        const panel=t.ob_timeline_right_panel;
        assert.deepEqual([...panel.querySelector('[data-filter-namespace]').options].filter(option=>!option.hidden).map(option=>option.value),['child','configured','real']);
        const options=filterDataOptions(t);
        for(const field of ['title','status','type','metrics.score','enabled'])assert.ok(options.fields.includes(field),field);
        assert.ok(!options.fields.includes('sourceRecordKey'));assert.equal(filterDataOptions(t).fields,options.fields,'Repeated UI updates reuse the metadata scan');
        t.staticData={events:[...t.staticData.events,{namespace:'late',data:{title:'Late',newField:42}}]};refreshFilterOptions(t);
        assert.ok([...panel.querySelector('[data-filter-builder-sort]').options].some(option=>option.value==='newField'));
        assert.ok([...panel.querySelector('[data-filter-namespace]').options].some(option=>option.value==='late'));
    } finally {h.close();}
});
