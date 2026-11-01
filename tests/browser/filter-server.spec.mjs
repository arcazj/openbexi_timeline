import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {compileFilter} from '../../src/openbexi_timeline_filter_expression.js';

test('Connected filters use historical catalogs, send namespace scope, and respect the UI-selected user permissions',async({page,baseURL})=>{
    const errors=[],queries=[],operations=[];page.on('pageerror',error=>errors.push(error.message));
    const records=[{id:'running',namespace:'DEMO_ALPHA',sourceRecordKey:'DEMO_ALPHA-running',start:'2026-09-12T12:00:00Z',data:{title:'Running',system:'RNG',status:'RUNNING'}},
        {id:'finished',namespace:'DEMO_ALPHA',sourceRecordKey:'DEMO_ALPHA-finished',start:'2026-09-12T12:00:00Z',data:{title:'Finished',system:'RNG',status:'FINISHED'}}];
    const model=JSON.parse(await fs.readFile('HBDS/templates/models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{date:'2026-09-12T12:30:00Z',data:new URL('/openbexi_timeline/sessions',baseURL).href,showCurrentTime:false});
    await page.route('**/HBDS/templates/models/regular_timeline_earthquake.json',route=>route.fulfill({json:model}));
    let catalogRequests=0;
    await page.route('**/openbexi_timeline/filter-values*',route=>{
        catalogRequests++;const url=new URL(route.request().url());expect([...url.searchParams.keys()]).toEqual(['userName']);
        return route.fulfill({json:{filterCatalog:{version:1,indexing:false,namespaces:[{namespace:'DEMO_ALPHA',attributes:[
            {field:'system',values:['CMD','RNG','ARCHIVED']},{field:'status',values:['RUNNING','FINISHED','RETIRED']}],excluded:[{field:'serial',reason:'high_cardinality'}]}]}}});
    });
    const definitions=[{name:'ALL',filter_value:'',sortBy:'NONE',owners:['arcazj','guest']},
        {name:'NAMESPACE_Exclude_Nominal_RNG',filter_value:'expr: system = RNG | status = FINISHED',sortBy:'NONE',owners:['arcazj','guest']},
        {name:'Owned',filter_value:'expr: status = RUNNING',sortBy:'NONE',owners:['arcazj']}];
    await page.route('**/openbexi_timeline/sessions*',async route=>{
        const url=new URL(route.request().url()),params=url.searchParams;
        if(route.request().method()==='POST'){
            const user=params.get('userName')||'guest',operation=params.get('ob_request');operations.push({user,operation});
            if(user==='guest'&&['addFilter','saveFilter','deleteFilter'].includes(operation))return route.fulfill({status:403,json:{error:'Guest may view and apply filters only.'}});
            const filters=definitions.filter(item=>user==='admin'||item.owners.includes(user)).map(item=>({...item,canEdit:user!=='guest',current:item.name===(params.get('filterName')||'ALL')?'yes':'no'}));
            return route.fulfill({json:{dateTimeFormat:'iso8601',namespace:'DEMO_ALPHA',scene:'0',openbexi_timeline:[{name:params.get('timelineName'),user,
                top:'0',left:'0',width:'800',height:'600',camera:'Orthographic',multiples:'45',backgroundColor:'#eef1f2',sortBy:'NONE',sources:[{namespace:'DEMO_ALPHA',enable:true}],filters,
                filterAccess:{user,canCreate:user!=='guest',admin:user==='admin',identityMode:'ui'}}]}});
        }
        queries.push(Object.fromEntries(params));
        const names=params.has('namespaces')?JSON.parse(params.get('namespaces')):null,predicate=compileFilter(params.get('filter')||'');
        const from=params.get('startDate'),to=params.get('endDate');
        const events=records.filter(item=>(!names||names.includes(item.namespace))&&predicate(item)&&(!from||Date.parse(item.start)>=Date.parse(from))&&(!to||Date.parse(item.start)<=Date.parse(to))).map(item=>({...item,searchMatch:true}));
        return route.fulfill({json:{dateTimeFormat:'iso8601',scene:'0',events,timelineMatch:{version:1,provider:'json_file',query:params.get('search')||'',searchMode:params.get('searchMode')||'text',
            complete:true,progressive:true,nextCursor:null,hasCondition:false,domain:{from,to},recordsReturned:events.length,recordsExamined:2,charactersRead:200}}});
    });
    await page.goto('/openbexi_timeline_earthquake.html');
    await page.waitForFunction(()=>{const t=window.get_ob_timeline?.('ob_timeline_2');return t?.ob_results?.snapshot&&!t.ob_results.pending&&!t.ob_results.loading;},null,{timeout:15000})
        .catch(error=>{throw new Error(error.message+'; browser errors: '+JSON.stringify(errors)+'; queries: '+JSON.stringify(queries));});
    const selectUser=async user=>{
        await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_login(0));
        await page.locator('#ob_timeline_2_user').fill(user);await page.getByRole('button',{name:'Save user data',exact:true}).click();
        await page.waitForFunction(expected=>get_ob_timeline('ob_timeline_2').ob_filter_access?.user===expected,user);
        await page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_create_filters(0,undefined,'select_filter'));
    };
    await selectUser('guest');
    let panel=page.locator('.ob_filter_panel');
    await expect(panel.locator('.ob_saved_filter')).toHaveCount(2);
    await expect(panel.getByRole('button',{name:'Edit',exact:true})).toHaveCount(0);await expect(panel.getByRole('button',{name:'Delete',exact:true})).toHaveCount(0);
    await expect(panel.locator('.ob_filter_build_section')).toBeHidden();
    await panel.getByRole('radio',{name:'NAMESPACE_Exclude_Nominal_RNG',exact:true}).check();
    await expect.poll(()=>page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_results.snapshot.entries.map(entry=>entry.record.id))).toEqual(['running']);
    expect(operations.some(item=>item.user==='guest'&&item.operation==='updateFilter')).toBe(true);
    await selectUser('admin');panel=page.locator('.ob_filter_panel');
    await expect(panel.locator('.ob_saved_filter')).toHaveCount(3);await expect(panel.getByRole('button',{name:'Edit',exact:true})).toHaveCount(3);
    await panel.locator('.ob_filter_build_section > summary').click();await panel.locator('[data-filter-section=include] > summary').click();
    const namespace=panel.locator('[data-filter-mode=include][data-filter-item-namespace=DEMO_ALPHA]');await namespace.locator(':scope > summary').click();
    await expect(namespace.getByRole('checkbox',{name:'Include DEMO_ALPHA system: ARCHIVED',exact:true})).toBeAttached();
    await expect(namespace.getByRole('checkbox',{name:'Include DEMO_ALPHA status: RETIRED',exact:true})).toBeAttached();
    await expect(namespace.locator('[data-filter-attribute=serial]')).toHaveCount(0);expect(catalogRequests).toBeGreaterThan(0);
    const before=queries.length;await page.waitForTimeout(100);expect(queries.length).toBe(before);
    await panel.getByRole('checkbox',{name:'Show namespace DEMO_ALPHA',exact:true}).uncheck();
    await expect.poll(()=>queries.some(query=>query.namespaces==='[]')).toBe(true);
    await expect.poll(()=>page.evaluate(()=>get_ob_timeline('ob_timeline_2').ob_results.snapshot.entries.length)).toBe(0);
    expect(errors).toEqual([]);
});
