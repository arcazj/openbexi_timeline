import {test,expect} from '@playwright/test';
import {createDemoServer} from '../../tools/serve-demos.mjs';

let alternate,alternateURL;
test.beforeAll(async()=>{alternate=createDemoServer();await new Promise(resolve=>alternate.listen(0,'127.0.0.1',resolve));alternateURL=`http://127.0.0.1:${alternate.address().port}/openbexi_timeline_embed.html`;});
test.afterAll(async()=>{await new Promise(resolve=>alternate.close(resolve));});
const data={events:[{id:'session',start:'2026-01-01',end:'2026-08-01',data:{title:'Session',kind:'session'},extensions:{untouched:null},activities:[
    {id:'launch',start:'2026-02-01',data:{title:'Launch fixture',custom:[null,{keep:true}]},unknown:{exact:'unchanged'}},
    {id:'decay',start:'2026-06-01',data:{title:'Confirmed decay fixture'}}]}]};
async function host(page) {
    // A real local response retains its network address classification. An
    // intercepted navigation triggers Chromium's local-network access checks.
    await page.goto('/tests/fixtures/embed-host.html');
}
async function mount(page,url) {
    return page.evaluate(async({data,url})=>{
        const {createTimelineEmbed}=await import('/src/openbexi_timeline_embed.js');
        const model=await(await fetch('/models/demos/space_exploration.json')).json();
        model.params[0].date='2026-05-01';
        window.selections=[];window.ranges=[];window.embedErrors=[];window.originalData=data;
        window.embed=createTimelineEmbed(document.getElementById('host'),{url,model,data,view:'table',
            onSelect:value=>selections.push(value),onRangeChange:value=>ranges.push(value),onError:error=>embedErrors.push(error.message)});
        const ready=await embed.ready;
        await embed.setRange('2026-01-01','2027-01-01');return ready;
    },{data,url});
}
const frame=page=>page.frameLocator('#host iframe');

for(const crossOrigin of [false,true])test(`Embedded timeline ${crossOrigin?'cross-origin':'same-origin'}: selection, controls and exact item payloads`,async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const apiRequests=[];page.on('request',request=>{if(/\/(?:api\/|openbexi_timeline\/)/.test(new URL(request.url()).pathname))apiRequests.push(request.url());});
    if(crossOrigin) await page.addInitScript(()=>{
        if(parent!==window)Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage is blocked','SecurityError');}});
    });
    await host(page);const ready=await mount(page,crossOrigin?alternateURL:undefined);expect(ready.count).toBe(3);
    const detail=frame(page).getByRole('button',{name:'Details: Launch fixture',exact:true});await detail.click();
    await expect.poll(()=>page.evaluate(()=>selections.length)).toBe(1);
    expect(await page.evaluate(()=>selections[0])).toEqual({id:'launch',record:data.events[0].activities[0],path:['events',0,'activities',0]});
    expect(await page.evaluate(()=>originalData)).toEqual(data);
    await page.evaluate(()=>embed.selectEvent('decay'));
    expect(await page.evaluate(()=>selections.length)).toBe(1);
    await frame(page).getByAltText('Settings',{exact:true}).click();
    await expect(frame(page).getByRole('button',{name:'Model and YAML editor',exact:true})).toBeHidden();
    await frame(page).getByRole('button',{name:'Close settings',exact:true}).click();
    await page.evaluate(()=>embed.setView('timeline'));
    await expect(frame(page).locator('.ob_paged_frame canvas').first()).toBeVisible();
    expect(errors).toEqual([]);expect(apiRequests).toEqual([]);
});

test('Data revisions preserve the visible range, reject invalid updates and allow recovery',async({page})=>{
    await host(page);await mount(page);
    const before=await page.evaluate(()=>embed.setRange('2026-01-01','2027-01-01'));
    const update=structuredClone(data);update.events[0].activities.push({id:'new',start:'2026-04-01',data:{title:'New fixture'}});
    const after=await page.evaluate(data=>embed.setData(data),update);
    expect(after.count).toBe(4);expect(Math.abs(after.range.from-before.range.from)).toBeLessThan(1000);
    await expect(frame(page).getByRole('button',{name:'Details: New fixture'})).toBeVisible();
    expect(await page.evaluate(async()=>{try{await embed.setData({events:[{id:'bad',start:'invalid'}]});return '';}catch(error){return error.message;}})).toMatch(/Invalid start/);
    await expect(frame(page).getByRole('button',{name:'Details: New fixture'})).toBeVisible();
    expect(await page.evaluate(async()=>{try{await embed.selectEvent('missing');return '';}catch(error){return error.message;}})).toMatch(/not found/);
    await page.evaluate(()=>embed.setView('split'));
    await expect(frame(page).locator('#embed-message')).toBeHidden();
});

test('Multiple instances isolate appearance, reject forged messages, resize and release their frames',async({page})=>{
    await host(page);await mount(page);
    await page.evaluate(async()=>{
        const {createTimelineEmbed}=await import('/src/openbexi_timeline_embed.js');
        window.other=createTimelineEmbed(document.getElementById('other'),{data:{events:[]},appearance:'contrast'});await other.ready;
        const channel=new URLSearchParams(new URL(embed.iframe.src).hash.slice(1)).get('channel');
        const value={protocol:'openbexi-timeline-embed:1',channel,type:'select',value:{id:'forged'}};
        window.dispatchEvent(new MessageEvent('message',{data:value,origin:location.origin,source:other.iframe.contentWindow}));
        window.dispatchEvent(new MessageEvent('message',{data:value,origin:'https://wrong.example',source:embed.iframe.contentWindow}));
        embed.iframe.contentWindow.postMessage({protocol:'openbexi-timeline-embed:1',channel:'wrong-channel',id:88,command:'setData',payload:{data:{events:[]}}},location.origin);
    });
    await expect(frame(page).getByRole('button',{name:'Details: Launch fixture'})).toBeVisible();
    expect(await page.evaluate(()=>selections)).toEqual([]);
    await expect(frame(page).locator('html')).toHaveAttribute('data-ob-theme','default');
    await expect(page.frameLocator('#other iframe').locator('html')).toHaveAttribute('data-ob-theme','contrast');
    const sibling=await page.locator('#other iframe').elementHandle();
    await (await sibling.contentFrame()).evaluate(()=>{
        const victim=parent.document.querySelector('#host iframe');
        const channel=new URLSearchParams(new URL(victim.src).hash.slice(1)).get('channel');
        victim.contentWindow.postMessage({protocol:'openbexi-timeline-embed:1',channel,id:89,command:'setData',payload:{data:{events:[]}}},location.origin);
    });
    expect((await page.evaluate(()=>embed.setView('table'))).count).toBe(3);
    await page.evaluate(()=>embed.setAppearance('minimal'));
    await expect(frame(page).locator('html')).toHaveAttribute('data-ob-theme','minimal');
    await expect(page.frameLocator('#other iframe').locator('html')).toHaveAttribute('data-ob-theme','contrast');
    await page.evaluate(()=>{document.getElementById('host').style.width='380px';});
    await expect.poll(()=>frame(page).locator('.ob_viewport_panel').evaluate(node=>Math.round(node.getBoundingClientRect().width))).toBe(380);
    await page.evaluate(()=>{embed.destroy();embed.destroy();other.destroy();});
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(await page.evaluate(async()=>{try{await embed.setView('table');return '';}catch(error){return error.message;}})).toMatch(/destroyed/);
});

test('Snapshot records and queued updates retain original IDs, parent links and metadata',async({page})=>{
    await host(page);
    const child={id:0,parentSessionId:'s',start:'2026-03-02',data:{title:'Snapshot child',extra:null},extensions:{arbitrary:[1,'a',false]}};
    await page.evaluate(async child=>{
        const {createTimelineEmbed}=await import('/src/openbexi_timeline_embed.js');
        const model=await(await fetch('/models/demos/space_exploration.json')).json();model.params[0].date='2026-03-02';
        const records=[{id:'removed',start:'2026-03-01',deletedAt:'2026-03-02'},
            {id:'s',start:'2026-03-01',end:'2026-03-05',data:{title:'Snapshot session',kind:'session'},activities:[
                {id:'legacy-marker',start:'2026-03-02',deletedAt:'legacy-metadata',data:{title:'Legacy activity'}},
                {id:'following',start:'2026-03-03',data:{title:'Following activity'},unknown:null}]},child];
        window.selections=[];
        window.embed=createTimelineEmbed(document.getElementById('host'),{model,data:{records:[]},view:'table',onSelect:value=>selections.push(value)});
        const update=embed.setData({records});
        child.data.title='A later host mutation';
        await update;
    },child);
    await frame(page).getByRole('button',{name:'Details: Snapshot child',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>selections.length)).toBe(1);
    expect(await page.evaluate(()=>selections[0])).toEqual({id:0,record:child,path:['records',2]});
    await frame(page).getByRole('button',{name:'Close event details',exact:true}).click();
    await frame(page).getByRole('button',{name:'Details: Following activity',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>selections.length)).toBe(2);
    expect(await page.evaluate(()=>selections[1])).toEqual({id:'following',path:['records',1,'activities',1],
        record:{id:'following',start:'2026-03-03',data:{title:'Following activity'},unknown:null}});
    await page.evaluate(()=>embed.destroy());
});

test('Failed startup rejects ready and removes the frame; destroying during startup also settles',async({page})=>{
    await host(page);
    const messages=await page.evaluate(async()=>{
        const {createTimelineEmbed}=await import('/src/openbexi_timeline_embed.js');
        const invalid=createTimelineEmbed(document.getElementById('host'),{model:{},data:{events:[]}});
        let failure;try{await invalid.ready;}catch(error){failure=error.message;}
        const closed=createTimelineEmbed(document.getElementById('other'));closed.destroy();
        let cancelled;try{await closed.ready;}catch(error){cancelled=error.message;}
        return {failure,cancelled};
    });
    expect(messages.failure).toMatch(/model|params|bands/i);expect(messages.cancelled).toMatch(/destroyed/);
    await expect(page.locator('iframe')).toHaveCount(0);
});

test('Model field mappings expose their IDs without changing the source record',async({page})=>{
    await host(page);
    const record={id:'legacy-id',catalog:{id:'mapped-id',title:'Mapped fixture'},start:'2026-03-02',extra:null};
    await page.evaluate(async record=>{
        const {createTimelineEmbed}=await import('/src/openbexi_timeline_embed.js');
        const model=await(await fetch('/models/demos/space_exploration.json')).json();model.params[0].date='2026-03-02';
        model.dataSource={format:'json',recordsPath:'catalog.items',fields:{id:'catalog.id',title:'catalog.title'}};
        window.selections=[];window.embed=createTimelineEmbed(document.getElementById('host'),{
            model,data:{catalog:{items:[record]}},view:'table',onSelect:value=>selections.push(value)});
        await embed.ready;await embed.selectEvent('mapped-id');
    },record);
    await frame(page).getByRole('button',{name:'Details: Mapped fixture',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>selections.length)).toBe(1);
    expect(await page.evaluate(()=>selections[0])).toEqual({id:'mapped-id',record,path:['catalog','items',0]});
});

test('Earth Orbit example updates a live timeline and returns NORAD selections to its host',async({page})=>{
    await page.goto('/demos/embedded-earth-orbit.html');
    await expect(page.locator('#status')).toHaveText('Status: Ready');
    await page.locator('#view').selectOption('table');
    const example=page.frameLocator('#satellite-timeline iframe');
    await example.getByRole('button',{name:'Details: Launch: Example Aurora',exact:true}).click();
    await expect(page.locator('#selection')).toContainText('NORAD 900001: launch');
    await page.getByRole('button',{name:'Add a launch',exact:true}).click();
    await expect(example.getByRole('button',{name:'Details: Launch: Example Solstice',exact:true})).toBeVisible();
});
