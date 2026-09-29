import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {compileFilter} from '../src/openbexi_timeline_filter_expression.js';
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
        await t.loadModel('/models/demos/default-dataset.json',{dataset:'/json/test-data/default-dataset.json'});
        t.ob_create_filters(0,undefined,'add_filter');
        const panel=t.ob_timeline_right_panel;
        const name=panel.querySelector('[aria-label="New filter name"]'),input=panel.querySelector('textarea');
        name.value='Advanced';input.value='expr: priority >';
        t.ob_load_filters('addFilter',0,undefined,true);
        assert.match(panel.querySelector('[data-filter-error]').textContent,/character/);
        assert.equal(input.getAttribute('aria-invalid'),'true');
        assert.ok(!t.ob_filters.some(filter=>filter.name==='Advanced'));
        input.value='expr: title CONTAINS "A+B | ready"';
        const select=panel.querySelector('[aria-label="Sort by"]');
        if(![...select.options].some(option=>option.value==='namespace'))select.add(new h.window.Option('namespace','namespace'));
        select.value='namespace';t.ob_load_filters('addFilter',0,undefined,true);
        const saved=t.ob_filters.find(filter=>filter.name==='Advanced');
        assert.equal(saved.sortBy,'namespace');assert.equal(t.ob_sortBy,'namespace');
        t.ob_create_filters(0,t.ob_filters.indexOf(saved),'edit_filter');t.ob_help_filters();
        assert.equal(panel.querySelector('textarea').value,'expr: title CONTAINS "A+B | ready"');
        assert.equal(panel.querySelector('[data-filter-syntax]').hidden,false);
        assert.match(panel.querySelector('[data-filter-syntax]').textContent,/Legacy:/);
    } finally {h.close();}
});
