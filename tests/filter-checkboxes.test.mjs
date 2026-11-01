import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {compileFilter,decodeFilter} from '../src/openbexi_timeline_filter_expression.js';
import {discoverFilterChoices,createFilterSelection,setFilterValue,filterSelectionExpression,isFilterSelectableAttribute,
    filterSelectionFromExpression} from '../src/openbexi_timeline_filter_choices.js';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const session=(id,namespace,system,status,extra={})=>({id,namespace,start:'2026-09-12T12:00:00Z',end:'2026-09-12T13:00:00Z',
    data:{title:id,system,...(status?{status}:{}),...extra},activities:[]});
const records=[session('rng-running','DEMO_ALPHA','RNG','RUNNING'),session('rng-finished','DEMO_ALPHA','RNG','FINISHED'),
    session('cmd-running','DEMO_ALPHA','CMD','RUNNING'),session('cmd-finished','DEMO_ALPHA','CMD','FINISHED'),
    session('rng-prefix','DEMO_ALPHA','RNG-extra','RUNNING'),session('rng-no-status','DEMO_ALPHA','RNG'),
    session('other','OTHER','RNG','FINISHED',{region:'East',priority:3})];
const matches=selection=>records.filter(compileFilter(filterSelectionExpression(selection))).map(record=>record.id);

test('Excluding DEMO_ALPHA system RNG matches the exact attribute and leaves CMD and other values eligible',()=>{
    const selection=createFilterSelection(['DEMO_ALPHA']);setFilterValue(selection,'exclude','DEMO_ALPHA','system','RNG',true);
    assert.deepEqual(matches(selection),['cmd-running','cmd-finished','rng-prefix']);
    assert.match(filterSelectionExpression(selection),/\|.*system IN \("RNG"\)/);
});
test('Including RNG and excluding FINISHED retains running RNG and RNG without a status',()=>{
    const selection=createFilterSelection(['DEMO_ALPHA']);setFilterValue(selection,'include','DEMO_ALPHA','system','RNG',true);
    setFilterValue(selection,'exclude','DEMO_ALPHA','status','FINISHED',true);
    assert.deepEqual(matches(selection),['rng-running','rng-no-status']);
});
test('Namespace-owned arbitrary attributes use OR within a field, AND between fields and exclusion precedence',()=>{
    const selection=createFilterSelection(['DEMO_ALPHA','OTHER']);
    setFilterValue(selection,'include','DEMO_ALPHA','system','RNG',true);setFilterValue(selection,'include','DEMO_ALPHA','system','CMD',true);
    setFilterValue(selection,'include','DEMO_ALPHA','status','RUNNING',true);
    setFilterValue(selection,'include','OTHER','priority',3,true);setFilterValue(selection,'exclude','OTHER','region','West',true);
    assert.deepEqual(matches(selection),['rng-running','cmd-running','other']);
    setFilterValue(selection,'exclude','OTHER','region','East',true);
    assert.deepEqual(matches(selection),['rng-running','cmd-running']);
});
test('No namespace matches nothing; no item inclusion admits the selected namespace minus exclusions',()=>{
    assert.deepEqual(matches(createFilterSelection()),[]);
    assert.deepEqual(matches(createFilterSelection(['OTHER'])),['other']);
});
test('Dynamic discovery keeps types and nested namespace ownership without requiring known attribute names',()=>{
    const data=[session('typed','NEW_NAMESPACE','custom','ACTIVE',{priority:3,enabled:true,metrics:{score:4},sourceRecordKey:'internal'})];
    data[0].activities=[{id:'nested',data:{namespace:'CHILD',customFlag:false}}];
    const choices=discoverFilterChoices(data,['CONFIGURED']);
    assert.deepEqual(choices.namespaces,['CHILD','CONFIGURED','NEW_NAMESPACE']);
    assert.equal(choices.attributes.get('NEW_NAMESPACE').get('metrics.score').get('4'),4);
    assert.equal(choices.attributes.get('CHILD').get('customFlag').get('false'),false);
    assert.ok(!choices.fields.includes('sourceRecordKey'));
    const selection=createFilterSelection(['OTHER']);setFilterValue(selection,'include','OTHER','priority','3',true);
    assert.deepEqual(matches(selection),[]);setFilterValue(selection,'include','OTHER','priority',3,true);
    assert.deepEqual(matches(selection),['other']);
});
test('Generated checkbox expressions round trip and preserve punctuation, types and namespace ownership',()=>{
    const selection=createFilterSelection(['DEMO_ALPHA','OTHER']);
    setFilterValue(selection,'include','DEMO_ALPHA','title','A+B | 25% "quoted"',true);
    setFilterValue(selection,'exclude','DEMO_ALPHA','status','FINISHED',true);
    setFilterValue(selection,'include','OTHER','enabled',false,true);
    const expression=filterSelectionExpression(selection),restored=filterSelectionFromExpression(expression);
    assert.equal(filterSelectionExpression(restored),expression);
    assert.equal(filterSelectionFromExpression('expr: title CONTAINS "manual"'),null);
    assert.equal(filterSelectionFromExpression('|status:FINISHED'),null);
    assert.ok(filterSelectionFromExpression('expr: namespace = DEMO_ALPHA AND NOT status = FINISHED'));
    assert.equal(filterSelectionFromExpression('expr: (namespace = DEMO_ALPHA AND system = RNG) OR (namespace = DEMO_ALPHA AND status = RUNNING)'),null);
    assert.equal(filterSelectionFromExpression('expr: namespace = DEMO_ALPHA | namespace = DEMO_ALPHA AND system = RNG AND status = FINISHED'),null);
    assert.equal(filterSelectionFromExpression('expr: namespace = DEMO_ALPHA AND system = RNG AND system = CMD'),null);
    const unnamed=createFilterSelection(['']);setFilterValue(unnamed,'exclude','','status','FINISHED',true);
    assert.equal(filterSelectionExpression(filterSelectionFromExpression(filterSelectionExpression(unnamed))),filterSelectionExpression(unnamed));
});

test('Checkbox discovery hides the six reserved attributes, aliases and nested fields without changing records or groupings',()=>{
    const data=[session('hidden','DEMO_ALPHA','RNG','RUNNING',{Description:'<p>Private note</p>',AsRun:'<div>Run</div>',
        as_run:'run', 'as-run':'run', START:'start',End:'end',ID:'id',Title:'heading',nested:{TITLE:'nested',description:{content:'hidden'}},
        satellite_id:'station-id',endState:'open'})];
    const before=JSON.stringify(data),choices=discoverFilterChoices(data),fields=[...choices.attributes.get('DEMO_ALPHA').keys()];
    assert.deepEqual(fields.sort(),['endState','satellite_id','status','system']);
    assert.ok(choices.fields.includes('title'),'Group by remains independent');
    assert.ok(choices.fields.includes('nested.TITLE'));
    assert.equal(isFilterSelectableAttribute('data.As_Run'),false);
    assert.equal(isFilterSelectableAttribute('data.station_id'),true);
    assert.equal(JSON.stringify(data),before);
    assert.deepEqual([...discoverFilterChoices([{namespace:'EMPTY',data:{description:'hidden',title:'hidden'}}]).attributes.get('EMPTY')],[]);
});

test('Filter labels decode formatted text in an inert document without rewriting matching values',async()=>{
    const h=await createTimelineHarness();
    try {
        const {filterLabelText}=await h.importModule('src/openbexi_timeline_filter_builder.js');
        assert.equal(filterLabelText('<div>Ready &amp; queued</div><script>window.labelScript=true</script><img src="missing" onerror="window.labelScript=true">'),'Ready & queued');
        assert.equal(filterLabelText('&lt;b&gt;Encoded &amp;amp; ready&lt;/b&gt;'),'Encoded & ready');
        assert.equal(filterLabelText('Line 1<br>Line 2'),'Line 1 Line 2');
        assert.equal(filterLabelText('A < B'),'A < B');
        assert.equal(filterLabelText(0),'0');assert.equal(filterLabelText(false),'false');
        assert.equal(h.window.labelScript,undefined);
    }finally{h.close();}
});

test('Remote choices use the persistent catalog once, independently of viewport, filters and event pages',async()=>{
    const h=await createTimelineHarness();
    try {
        const {ensureFilterChoiceRecords}=await h.importModule('src/openbexi_timeline_filter_values.js');
        const t={data:'http://localhost/openbexi_timeline/sessions?namespace=DEMO_ALPHA&filter=old&search=old',ob_user_name:'arcazj',
            ob_results:{visibleRanges:new Map([['main',{from:0,to:1000}]])}};
        const requests=[];let release,first=0,second=0;
        const catalog={version:1,indexing:false,namespaces:[{namespace:'DEMO_ALPHA',attributes:[{field:'system',values:['RNG','CMD']}]}]};
        h.window.fetch=async input=>{requests.push(new URL(input));return new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({filterCatalog:catalog})));});};
        ensureFilterChoiceRecords(t,()=>first++);ensureFilterChoiceRecords(t,()=>second++);release();
        for(let n=0;n<100&&t.filterChoiceLoading;n++)await new Promise(resolve=>setTimeout(resolve,5));
        assert.equal(t.filterChoiceLoading,false);assert.equal(t.filterChoiceRecords,undefined);
        assert.equal(t.filterChoiceCatalog.namespaces[0].attributes[0].values.join(','),'RNG,CMD');
        assert.ok(first>=2);assert.ok(second>=1);assert.equal(requests.length,1);
        assert.equal(requests[0].pathname,'/openbexi_timeline/filter-values');
        assert.deepEqual([...requests[0].searchParams.keys()],['userName']);
        t.ob_results.visibleRanges.set('main',{from:10000,to:20000});ensureFilterChoiceRecords(t);assert.equal(requests.length,1);
    }finally{h.close();}
});

test('The visual builder applies both examples, keeps drafting isolated, and preserves manual clones',async()=>{
    const h=await createTimelineHarness();
    try {
        const {OB_TIMELINE}=await h.importModule('src/openbexi_timeline.js');
        const t=new OB_TIMELINE({autoStart:false});
        const model=JSON.parse(await fs.readFile('HBDS/templates/models/demos/default-dataset.json','utf8'));
        model.dataSource={format:'json'};
        await t.applyModel(model,{inlineData:{events:records}});
        t.ob_results.request();await new Promise(resolve=>setTimeout(resolve,40));
        t.ob_create_filters(0,undefined,'add_filter');
        const panel=t.ob_timeline_right_panel,group=panel.querySelector('.ob_new_filter');
        const find=name=>panel.querySelector(`[aria-label="${name}"]`);
        const check=(name,checked)=>{const input=find(name);assert.ok(input,name);input.checked=checked;input.dispatchEvent(new h.window.Event('change'));};
        const open=(mode,namespace)=>{
            group.querySelector(`[data-filter-section=${mode}]`).open=true;group.refreshFilterChoices();
            const details=group.querySelector(`[data-filter-mode=${mode}][data-filter-item-namespace="${namespace}"]`);
            details.open=true;details.dispatchEvent(new h.window.Event('toggle'));
        };
        assert.equal(find('Filter field'),null);
        for(const section of group.querySelectorAll('[data-filter-section]'))assert.equal(section.open,false);
        const future={id:'future',namespace:'FUTURE',data:{custom:'new'}};
        t.filterChoiceRecords={events:[...t.staticData.events,future]};group.refreshFilterChoices();
        assert.equal(find('Include namespace FUTURE').checked,true);
        assert.equal(compileFilter(find('New filter expression').value)(future),true,'Late namespace choices also update the generated expression');
        delete t.filterChoiceRecords;group.refreshFilterChoices();
        check('Include namespace OTHER',false);
        open('exclude','DEMO_ALPHA');
        check('Exclude DEMO_ALPHA system: RNG',true);
        assert.deepEqual(records.filter(compileFilter(find('New filter expression').value)).map(record=>record.id),['cmd-running','cmd-finished','rng-prefix']);
        check('Exclude DEMO_ALPHA system: RNG',false);
        check('Exclude DEMO_ALPHA status: FINISHED',true);open('include','DEMO_ALPHA');
        check('Include DEMO_ALPHA system: RNG',true);
        assert.deepEqual(records.filter(compileFilter(find('New filter expression').value)).map(record=>record.id),['rng-running','rng-no-status']);
        assert.equal(t.ob_scene[0].ob_filter_value,'');
        find('New filter name').value='Ranging';group.querySelector('.ob_filter_draft_actions button').click();
        await new Promise(resolve=>setTimeout(resolve,60));
        assert.deepEqual([...t.ob_results.snapshot.entries].filter(entry=>!entry.parentKey).map(entry=>entry.record.id),['rng-running','rng-no-status']);
        t.ob_filters.push({name:'Manual',filter_value:'expr: title CONTAINS "RNG"',sortBy:'NONE'});
        t.ob_create_filters(0,undefined,'add_filter');
        const clone=panel.querySelector('[data-filter-clone]');clone.value='Manual';clone.dispatchEvent(new h.window.Event('change'));
        assert.equal(find('New filter expression').value,'expr: title CONTAINS "RNG"');
        assert.equal(find('Include namespace DEMO_ALPHA').disabled,true);
        assert.equal(panel.querySelector('.ob_filter_manual_notice').hidden,false);
        const hidden='expr: namespace = "DEMO_ALPHA" AND title IN ("rng-running")';
        t.ob_filters.push({name:'Hidden',filter_value:hidden,sortBy:'NONE'});
        t.ob_create_filters(0,undefined,'add_filter');
        const hiddenClone=panel.querySelector('[data-filter-clone]');hiddenClone.value='Hidden';hiddenClone.dispatchEvent(new h.window.Event('change'));
        assert.equal(find('New filter expression').value,hidden);
        assert.equal(find('Include namespace DEMO_ALPHA').disabled,true);
        assert.equal(panel.querySelector('.ob_filter_manual_notice').hidden,false);
        find('New filter name').value='Preserved_hidden';panel.querySelector('.ob_filter_draft_actions button').click();
        await new Promise(resolve=>setTimeout(resolve,60));
        assert.equal(decodeFilter(t.ob_filters.find(filter=>filter.name==='Preserved_hidden').filter_value),hidden);
        assert.deepEqual([...t.ob_results.snapshot.entries].filter(entry=>!entry.parentKey).map(entry=>entry.record.id),['rng-running']);
    }finally{h.close();}
});
