import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

test('Connected presets restore and regroup the same records while later pages are delayed',async({page},info)=>{
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const model=JSON.parse(await fs.readFile('models/regular_timeline_earthquake.json','utf8'));
    Object.assign(model.params[0],{data:'http://127.0.0.1:8782/__presets',date:'2026-09-12T12:30:00Z',showCurrentTime:false});
    await page.route('**/models/demos/default-dataset.json',route=>route.fulfill({json:model}));
    const filters=[{name:'All records',filter_value:'',sortBy:'NONE',current:'no'},
        {name:'Exclude routine',filter_value:'|status:nominal',sortBy:'NONE',current:'yes'},
        {name:'Warnings by namespace',filter_value:'|status:nominal',sortBy:'namespace',current:'no'}];
    // Saved names use the same portable characters as the real filter editor.
    filters.forEach(filter=>{filter.name=filter.name.replaceAll(' ','_');});
    const records=Array.from({length:18},(_,i)=>({id:`record-${i}`,namespace:i%2?'research':'operations',
        start:'2026-09-12T12:30:00Z',...(i%3?{}:{end:'2026-09-12T12:38:00Z'}),
        data:{title:`${i%2?'Research':'Operations'} ${i%3?'event':'activity'} ${i+1}`,status:'warning'},
        render:{color:i%2?'#be660f':'#176087',...(i%3?{image:'icon/ob_warning.png'}:{})},searchMatch:false}));
    const requests=[],held=[];
    const response=(route,events,nextCursor=null)=>{
        const u=new URL(route.request().url());
        return route.fulfill({json:{events,timelineMatch:{version:1,progressive:true,query:'',hasCondition:false,
            complete:!nextCursor,revision:'fixture',nextCursor,
            domain:{from:new Date(u.searchParams.get('startDate')).toISOString(),to:new Date(u.searchParams.get('endDate')).toISOString()}}}});
    };
    await page.route('**/__presets**',async route=>{
        const u=new URL(route.request().url());requests.push(u);
        if(u.searchParams.has('cancel')) return route.fulfill({json:{events:[]}});
        if(u.searchParams.get('ob_request')) {
            if(u.searchParams.get('ob_request')==='updateFilter') filters.forEach(f=>{f.current=f.name===u.searchParams.get('filterName')?'yes':'no';});
            return route.fulfill({json:{openbexi_timeline:[{name:model.params[0].name,user:'guest',email:'',sortBy:'NONE',filters,
                sources:[{namespace:'operations',render:{color:'#b4dff0'}},{namespace:'research',render:{color:'#f5dab4'}}]}]}});
        }
        if(u.searchParams.has('cursor')) {held.push(route);return;}
        if(u.searchParams.get('purpose').includes('prefetch')) return response(route,[]);
        return response(route,records,'later-page');
    });
    const state=()=>page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady,r=t.ob_results;r.captureRanges();
        return {ids:r.snapshot?.entries.map(e=>e.record.id).sort(),selected:r.selectedKey,range:[...r.ranges.values()][0],
            groups:t.ob_viewport.fullBands.filter(b=>!b.name.includes('overview_')).map(b=>b.groupValue),error:r.error};
    });
    const ready=()=>page.waitForFunction(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;return !t.ob_results.pending&&t.ob_results.snapshot?.entries.length===18;});
    const capture=async name=>{
        if(process.env.PRESET_CAPTURE_DIR) {
            await fs.mkdir(process.env.PRESET_CAPTURE_DIR,{recursive:true});
            await page.screenshot({path:path.join(process.env.PRESET_CAPTURE_DIR,`${name}-${info.project.name}.png`)});
        }
    };
    await page.goto('/demos.html?demo=default-dataset');await ready();
    await expect.poll(()=>held.length).toBeGreaterThan(0);
    const obsoletePage=held[0];
    expect(requests.find(u=>u.searchParams.get('progressive')==='1').searchParams.get('filterName')).toBe('Exclude_routine');
    await page.evaluate(async()=>{const t=await(await import('/src/openbexi_demo.js')).demoReady;t.ob_results.selectedKey=t.ob_results.snapshot.entries[0].key;});
    const initial=await state();await capture('ungrouped');
    await page.getByAltText('Sorting and filtering',{exact:true}).click();
    await expect(page.getByRole('radio',{name:'Exclude_routine',exact:true})).toBeChecked();
    await page.getByRole('radio',{name:'Warnings_by_namespace',exact:true}).check();await ready();
    await expect(page.getByRole('combobox',{name:'Sort by',exact:true})).toHaveValue('namespace');
    await expect.poll(async()=>(await state()).groups).toEqual(['operations','research']);
    const grouped=await state();expect(grouped.ids).toEqual(initial.ids);expect(grouped.range).toEqual(initial.range);
    expect(grouped.selected).toBe(initial.selected);await capture('grouped');
    await page.getByRole('radio',{name:'Exclude_routine',exact:true}).check();await ready();
    await expect(page.getByRole('combobox',{name:'Sort by',exact:true})).toHaveValue('NONE');
    await expect.poll(async()=>(await state()).groups).toEqual([null]);
    const returned=await state();expect(returned.ids).toEqual(initial.ids);expect(returned.range).toEqual(initial.range);
    expect(returned.selected).toBe(initial.selected);
    // Obsolete continuation pages must never repopulate a superseded view.
    await response(obsoletePage,[{...records[0],id:'obsolete'}]).catch(()=>{});
    await ready();expect((await state()).ids).not.toContain('obsolete');expect((await state()).error).toBe('');
    expect(errors).toEqual([]);
    await page.evaluate(async()=>{(await(await import('/src/openbexi_demo.js')).demoReady).ob_results.cancelLoad();});
});
