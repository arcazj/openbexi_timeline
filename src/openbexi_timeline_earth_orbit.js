/** Earth Orbit catalog adapter. Source objects stay in an external selection map. */
export function earthOrbitTimelineData({launches=[],decayed=[],satellites=[]}={}) {
    if(!Array.isArray(launches) || !Array.isArray(satellites)) throw new Error('Launches and satellites must be arrays.');
    if(!decayed || typeof decayed!=='object') throw new Error('Decayed records must be an array or an object of arrays.');
    const confirmed=Array.isArray(decayed)?decayed:Object.values(decayed).flatMap(value=>{
        if(!Array.isArray(value)) throw new Error('Each decayed catalog group must be an array.');
        return value;
    });
    const events=new Map(), selection=new Map(), warnings=[], confirmedIds=new Set();
    const identity=record=>{
        const value=record?.norad_id ?? record?.noradId ?? record?.NORAD_CAT_ID ?? record?.NORADID;
        if(typeof value==='number' && !Number.isSafeInteger(value)) return null;
        return value!=null && /^\d+$/.test(String(value))?String(value):null;
    };
    const active=new Map(satellites.map(record=>[identity(record),record]).filter(([id])=>id));
    const date=value=>{
        if(typeof value!=='string')return null;
        const text=value.trim(), day=/^\d{4}-\d{2}-\d{2}$/.test(text);
        if(!day && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text))return null;
        const ms=Date.parse(text);
        if(!Number.isFinite(ms) || new Date(Date.parse(text.slice(0,10))).toISOString().slice(0,10)!==text.slice(0,10))return null;
        return {text,ms,precision:day?'day':'instant'};
    };
    function add(record,kind,startValue,endValue,confidence) {
        const noradId=identity(record), start=date(startValue), end=endValue===undefined?null:date(endValue);
        if(!noradId || !start || endValue!==undefined && (!end || end.ms<start.ms)) {
            warnings.push(`Skipped ${kind} record: missing NORAD ID or invalid date/window.`); return;
        }
        const id=`${kind}:${noradId}`;
        if(events.has(id))return;
        const name=record.satellite_name || record.name || record.OBJECT_NAME || `NORAD ${noradId}`;
        const labels={launch:'Launch',confirmed:'Confirmed decay',predicted:'Predicted re-entry'};
        const data={title:`${labels[kind]}: ${name}`,description:`NORAD ${noradId}. ${labels[kind]}. Date precision: ${start.precision}.`,
            namespace:labels[kind],noradId,datePrecision:start.precision};
        if(kind==='predicted' && confidence!==undefined)data.confidence=confidence;
        if(record.source!==undefined)data.source=record.source;
        const item={id,start:start.text,data,render:{color:{launch:'#237ab9',confirmed:'#a84432',predicted:'#886114'}[kind]}};
        if(end)item.end=end.text;
        events.set(id,item);
        selection.set(id,{noradId,kind,record,satellite:active.get(noradId) || null});
        if(kind==='confirmed')confirmedIds.add(noradId);
    }
    for(const record of [...launches,...satellites]) {
        const value=record?.launch_date ?? record?.launchDate ?? record?.LAUNCH_DATE;
        if(value!=null)add(record,'launch',value);
    }
    for(const record of confirmed) add(record,'confirmed',record?.decayDateIso ?? record?.DECAY_DATE ?? record?.decay_date);
    for(const record of satellites) {
        if(record?.decay?.decay_status==='CONFIRMED') add(record,'confirmed',record.decay.decay_date);
    }
    for(const record of satellites) {
        const decay=record?.decay;
        if(decay?.decay_status==='PREDICTED' && !confirmedIds.has(identity(record))) {
            const window=decay.predicted_decay_window;
            add(record,'predicted',window?.start,window?.end ?? null,window?.confidence);
        }
    }
    return {data:{dateTimeFormat:'iso8601',events:[...events.values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))},selection,warnings};
}
