const root = new URL('../', import.meta.url), api = new URL('api/v1/', root);
const element = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
try {
    const response = await fetch(new URL('swagger/openapi-v1.json', root));
    if (!response.ok) throw new Error('The local OpenAPI contract could not be loaded.');
    const spec = await response.json();
    const endpoints = document.getElementById('endpoints'); endpoints.replaceChildren();
    for (const [path, definition] of Object.entries(spec.paths)) {
        for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
            const operation = definition[method]; if (!operation) continue;
            const details = element('details'); details.className = 'endpoint';
            const summary = element('summary'); summary.append(element('strong', method.toUpperCase()), element('code', '/api/v1' + path));
            const params = element('ul');
            for (const parameter of [...(definition.parameters || []), ...(operation.parameters || [])]) params.append(element('li', `${parameter.name} (${parameter.in}${parameter.required ? ', required' : ''}): ${parameter.description}`));
            details.append(summary, element('p', operation.summary), params);
            if (operation.requestBody) details.append(element('p', 'Request schema (resolve named definitions in the OpenAPI download):'), element('pre', JSON.stringify(operation.requestBody, null, 2)));
            endpoints.append(details);
        }
    }
} catch (error) { document.getElementById('endpoints').textContent = error.message; }
const status = document.getElementById('api-state'), select = document.getElementById('dataset'), button = document.getElementById('query'), result = document.getElementById('result');
try {
    const health = await fetch(new URL('health', api), {signal: AbortSignal.timeout(5000)});
    if (!health.ok || (await health.json()).apiVersion !== '1') throw new Error('API unavailable');
    const response = await fetch(new URL('datasets', api));
    if (!response.ok) throw new Error('Dataset discovery failed.');
    for (const dataset of (await response.json()).items) { const option = element('option', dataset.title); option.value = dataset.id; select.append(option); }
    select.disabled = false; button.disabled = false; status.textContent = 'Java API v1 is available.';
} catch { status.textContent = 'Live queries are unavailable on this host. Start npm run api and open this page on port 8781. The endpoint reference remains available.'; }
button.addEventListener('click', async () => {
    button.disabled = true;
    try {
        const url = new URL('datasets/' + encodeURIComponent(select.value) + '/events', api);
        url.searchParams.set('limit', '10');
        if (document.getElementById('search').value) url.searchParams.set('search', document.getElementById('search').value);
        const response = await fetch(url);
        result.textContent = response.status + ' ' + response.statusText + '\n' + JSON.stringify(await response.json(), null, 2);
    } catch (error) { result.textContent = error.message; }
    finally { button.disabled = false; }
});
