import test from 'node:test';
import assert from 'node:assert/strict';
import {earthOrbitTimelineData} from '../src/openbexi_timeline_earth_orbit.js';

test('Catalogs preserve long NORAD identities, day precision, source metadata and external selection',()=>{
    const launch={norad_id:'1234567',satellite_name:'Fixture',launch_date:'2026-01-02',unknown:{nullable:null}};
    const confirmed={NORAD_CAT_ID:'1234567',OBJECT_NAME:'Fixture',DECAY_DATE:'2026-07-12'};
    const original=JSON.stringify({launch,confirmed});
    const result=earthOrbitTimelineData({launches:[launch],decayed:{Fixture:[confirmed]}});
    assert.equal(result.data.events.length,2); assert.deepEqual(result.warnings,[]);
    assert.equal(result.data.events[0].start,'2026-01-02');
    assert.equal(result.data.events[0].data.datePrecision,'day');
    assert.equal(result.selection.get('launch:1234567').record,launch);
    assert.equal(result.selection.get('confirmed:1234567').satellite,null);
    assert.equal(JSON.stringify({launch,confirmed}),original);
    assert.equal('unknown' in result.data.events[0],false);
});

test('Predictions remain ranges with supplied confidence and confirmations take precedence',()=>{
    const satellite={norad_id:'999999',satellite_name:'Prediction',decay:{decay_status:'PREDICTED',
        predicted_decay_window:{start:'2026-10-01T12:00:00Z',end:'2026-10-04T18:00:00Z',confidence:0.4}}};
    const predicted=earthOrbitTimelineData({satellites:[satellite]}).data.events[0];
    assert.equal(predicted.id,'predicted:999999'); assert.equal(predicted.end,'2026-10-04T18:00:00Z');
    assert.equal(predicted.data.confidence,0.4);
    const confirmed=earthOrbitTimelineData({satellites:[satellite],decayed:[{noradId:'999999',decayDateIso:'2026-10-03'}]});
    assert.equal(confirmed.data.events.length,1);assert.equal(confirmed.data.events[0].id,'confirmed:999999');
    assert.equal(confirmed.selection.get('confirmed:999999').satellite,satellite);
});

test('Bad dates, reversed windows and missing identities are reported without fabricated records',()=>{
    const result=earthOrbitTimelineData({launches:[{norad_id:'1',launch_date:'2026-02-30'},{launch_date:'2026-01-02'},
        {norad_id:Number.MAX_SAFE_INTEGER+1,launch_date:'2026-01-02'}],satellites:[{norad_id:'2',decay:{decay_status:'PREDICTED',
        predicted_decay_window:{start:'2026-10-03',end:'2026-10-01'}}}]});
    assert.equal(result.warnings.length,4); assert.deepEqual(result.data.events,[]);
    assert.throws(()=>earthOrbitTimelineData({decayed:{broken:{}}}),/array/);
});

test('Stable IDs deduplicate catalog revisions while preserving distinct lifecycle events',()=>{
    const record={norad_id:'900001',launch_date:'2026-01-01'};
    const next={...record,launch_date:'2026-01-02'};
    const a=earthOrbitTimelineData({launches:[record,record],satellites:[record]});
    const b=earthOrbitTimelineData({launches:[next]});
    assert.equal(a.data.events.length,1);assert.equal(a.data.events[0].id,b.data.events[0].id);
    assert.equal(b.data.events[0].start,'2026-01-02');
});
