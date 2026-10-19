const $ = id => document.getElementById(id);
let state, pending = false;
const option = (value, label) => Object.assign(document.createElement('option'), {value, textContent: label});
function options(id, values, preferred) {
    const selected = preferred ?? $(id).value;
    $(id).replaceChildren(...values.map(([value, label]) => option(value, label)));
    if (values.some(([value]) => value === selected)) $(id).value = selected;
}
function sources() {
    options('namespace', [...new Set(state.sources.map(source => source.namespace))].map(name => [name, name]));
    options('source', state.sources.filter(source => source.namespace === $('namespace').value).map(source => [source.id, source.id]));
    const selected = state.sources.find(source => source.namespace === $('namespace').value && source.id === $('source').value);
    const disabled = !selected || !selected.enabled || selected.static || selected.error;
    $('source-info').textContent = !selected ? 'No sources configured.' : selected.error || (selected.static ? 'Static demo data — no conversion required.' : `${selected.plugin} · ${selected.enabled ? 'Ready' : 'Disabled'}`);
    for (const id of ['run', 'again', 'schedule']) $(id).disabled = Boolean(disabled || pending);
    options('mode', (selected?.modes ?? []).filter(mode => mode !== 'once').map(mode => [mode, {interval:'Interval', watch:'Watch input', stream:'Stream'}[mode]]));
    if (!$('mode').value) $('schedule').disabled = true;
}
async function post(route, body) {
    const response = await fetch(route, {method:'POST', headers:{'Content-Type':'application/json', 'X-Timeline-CSRF':state.csrf}, body:JSON.stringify({workspace:state.workspace, revision:state.revision, ...body})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed');
    return result;
}
function row(title, detail, status, action) {
    const row = document.createElement('div'); row.className = 'row ' + (status || '');
    const text = document.createElement('div'), strong = document.createElement('strong'), p = document.createElement('p');
    strong.textContent = title; p.textContent = detail; text.append(strong, p); row.append(text);
    if (action) { const button = document.createElement('button'); button.textContent = action.label; button.onclick = () => perform(action.run); row.append(button); }
    return row;
}
async function refresh(workspace = $('workspace').value) {
    const response = await fetch('/api/status' + (workspace ? '?workspace=' + encodeURIComponent(workspace) : ''));
    const value = await response.json(); if (!response.ok) throw new Error(value.error);
    state = value; options('workspace', state.workspaces.map(item => [item.id, item.name]), state.workspace); sources();
    $('jobs').replaceChildren(...state.jobs.map(job => row(`${job.request.namespace} / ${job.request.source} · ${job.state}`,
        `${job.id} · ${job.result.records_written ?? 0} records · ${job.result.error || job.result.reason || job.updated_at}`,
        job.state, ['queued','running'].includes(job.state) ? {label:'Cancel',run:() => post('/api/cancel',{job_id:job.id})} : null)));
    if (!state.jobs.length) $('jobs').textContent = 'No conversions yet.';
    $('schedules').replaceChildren(...Object.entries(state.schedules).map(([id,item]) => row(`${item.namespace} / ${item.source}`,
        `${item.policy.mode} · ${state.active_schedules.includes(id) ? 'Running' : 'Stopped'}${item.policy.interval_seconds ? ' · '+item.policy.interval_seconds+' seconds after completion' : ''}`, '',
        item.enabled ? {label:'Stop',run:() => post('/api/schedules/stop',{id})} : null)));
    if (!Object.keys(state.schedules).length) $('schedules').textContent = 'No repeats configured.';
    $('connection').textContent = 'Connected';
}
async function perform(action) {
    if (pending) return; pending = true; $('error').textContent = ''; if(state) sources();
    try { await action(); await refresh(); } catch(error) { $('error').textContent = error.message; }
    finally { pending = false; if(state) sources(); }
}
const selection = () => ({namespace:$('namespace').value, source:$('source').value, offline:$('offline').checked});
const run = force => perform(() => post('/api/jobs',{...selection(), force, date:$('date').value, end_date:$('end-date').value, request_id:crypto.randomUUID()}));
$('conversion').onsubmit = event => { event.preventDefault(); run(false); };
$('again').onclick = () => run(true);
$('schedule').onclick = () => perform(() => post('/api/schedules',{...selection(),date:$('date').value,end_date:$('end-date').value,lookback_hours:Number($('lookback').value),policy:{mode:$('mode').value, interval_seconds:Number($('interval').value),resume_on_restart:$('resume').checked}}));
$('workspace').onchange = () => perform(() => refresh($('workspace').value));
$('namespace').onchange = sources; $('source').onchange = sources;
refresh().catch(error => { $('error').textContent = error.message; });
setInterval(() => { if(!pending) refresh().catch(() => { $('connection').textContent = 'Disconnected'; }); }, 2000);
