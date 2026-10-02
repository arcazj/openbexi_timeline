import {createTimelineEmbed} from '../src/openbexi_timeline_embed.js';
import {earthOrbitTimelineData} from '../src/openbexi_timeline_earth_orbit.js';

// Synthetic records use Earth Orbit's existing catalog shapes.
const launches=[
    {norad_id:'900001',satellite_name:'Example Aurora',launch_date:'2026-02-05',source:'SYNTHETIC'},
    {norad_id:'900002',satellite_name:'Example Horizon',launch_date:'2026-05-11',source:'SYNTHETIC'}
];
const decayed={'Example Aurora':[{NORAD_CAT_ID:'900001',OBJECT_NAME:'Example Aurora',DECAY_DATE:'2026-06-08'}]};
const satellites=[{norad_id:'900002',satellite_name:'Example Horizon',decay:{decay_status:'PREDICTED',
    predicted_decay_window:{start:'2026-10-04T08:00:00Z',end:'2026-10-06T20:00:00Z',confidence:0.65}}}];
let adapted=earthOrbitTimelineData({launches,decayed,satellites});
const status=document.getElementById('status');
const response=await fetch('../models/demos/space_exploration.json');
if(!response.ok)throw new Error('Unable to load the satellite model.');
const model=await response.json();
Object.assign(model.params[0],{title:'Satellite history',date:'2026-06-01T00:00:00Z'});
const embed=createTimelineEmbed(document.getElementById('satellite-timeline'),{model,data:adapted.data,
    onStatus:value=>{status.textContent=value.message;},
    onError:error=>{status.textContent=error.message;},
    onSelect:({id})=>{
        const selected=adapted.selection.get(id);
        if(selected) document.getElementById('selection').textContent=`NORAD ${selected.noradId}: ${selected.kind}. The host can open satellite details here.`;
    }
});
async function run(action){try {await action();} catch(error){status.textContent=error.message;}}
document.getElementById('select').onclick=()=>run(()=>embed.selectEvent('launch:900001'));
document.getElementById('view').onchange=event=>run(()=>embed.setView(event.target.value));
document.getElementById('refresh').onclick=()=>run(async()=>{
    const next=[...launches,{norad_id:'900003',satellite_name:'Example Solstice',launch_date:'2026-08-20',source:'SYNTHETIC'}];
    const update=earthOrbitTimelineData({launches:next,decayed,satellites});
    await embed.setData(update.data); adapted=update;
});
await run(async()=>{await embed.ready;await embed.setRange('2026-01-01','2027-01-01');});
window.addEventListener('pagehide',()=>embed.destroy(),{once:true});
