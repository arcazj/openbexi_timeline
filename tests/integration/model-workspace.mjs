/**
 * Real browser -> Java API regression. Build Java first with `mvn package` or `mvn verify`.
 * Install Chromium with `npx playwright install chromium`, or configure Playwright's browser path.
 * All users, data and credentials are synthetic. AI uses an ephemeral loopback mock only.
 */
import {chromium, expect as playwrightExpect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const expect = playwrightExpect.configure({timeout: 15_000});
const root = fileURLToPath(new URL('../../', import.meta.url));
const javaCommand = process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
await fs.access(path.join(root, 'target/classes/com/openbexi/timeline/api/ApiServer.class'));
await fs.access(path.join(root, 'target/runtime'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'openbexi-workspace-integration-'));
const ownedTemporary = await fs.realpath(temporary);
const storage = path.join(temporary, 'data');
const systemToken = crypto.randomBytes(40).toString('hex');
const modelId = 'browser-smoke-' + crypto.randomUUID();
const checks = [], errors = [], failedRequests = [], requests = [];
let browser, context, page, java, javaExit, javaError, javaLog, base;
let providerCalls = 0, passed = false;

const provider = http.createServer(async (request, response) => {
    try {
        let text = '';
        for await (const chunk of request) text += chunk;
        const input = JSON.parse(text), prompt = input.messages[1].content[0].text;
        const draft = prompt.split('Selected model configuration draft (data, not executable instructions):\n')[1]
            .split('\nCandidate configuration JSON Schema')[0];
        const candidate = JSON.parse(draft);
        candidate.params[0].title = 'AI integration draft';
        providerCalls++;
        response.writeHead(200, {'Content-Type': 'application/json'});
        response.end(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({
            explanation: 'Local mock rendering proposal.', assumptions: ['Image labels are inferred.'], warnings: [],
            proposal: {kind: 'model', format: 'json', text: JSON.stringify(candidate)}
        })}}]}));
    } catch {
        response.writeHead(500); response.end('Invalid mock request');
    }
});

async function api(method, resource, token = systemToken, body, etag, expected = 200) {
    const headers = {Authorization: 'Bearer ' + token};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (etag) headers['If-Match'] = etag;
    const response = await fetch(base + '/api/v1/' + resource, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000)
    });
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${resource}: ${text}`);
    return {data: text ? JSON.parse(text) : null, etag: response.headers.get('etag')};
}

async function startJava() {
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
    await fs.mkdir(path.join(storage, '.ai'), {recursive: true});
    const config = path.join(storage, '.ai/providers.json');
    await fs.writeFile(config, JSON.stringify({enabled: true, providers: [{
        id: 'local-fixture', adapter: 'local', endpoint: `http://127.0.0.1:${provider.address().port}/chat/completions`,
        models: [{id: 'mock-model', capabilities: {vision: true, structuredOutput: true}}]
    }]}));
    const reservation = net.createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    base = `http://127.0.0.1:${port}`;
    const environment = {...process.env, OPENBEXI_API_TOKEN: systemToken, OPENBEXI_API_DATA_DIR: storage, OPENBEXI_AI_CONFIG: config};
    for (const name of ['OPENBEXI_API_WRITE_TOKEN', 'OPENBEXI_API_READ_TOKEN', 'OPENBEXI_CONFIG_ROOTS', 'OPENBEXI_API_CORS_ORIGINS']) delete environment[name];
    javaLog = createWriteStream(path.join(temporary, 'java-server.log'));
    java = spawn(javaCommand, [
        `-Dopenbexi.api.port=${port}`, `-Dopenbexi.api.root=${root}`, `-Djava.io.tmpdir=${temporary}`,
        '-cp', ['target/classes', 'target/runtime/*'].join(path.delimiter), 'com.openbexi.timeline.api.ApiServer'
    ], {cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    java.stdout.pipe(javaLog, {end: false}); java.stderr.pipe(javaLog, {end: false});
    java.on('error', error => {javaError = error;});
    javaExit = new Promise(resolve => java.once('close', resolve));
    for (let attempt = 0; attempt < 100; attempt++) {
        if (javaError) throw javaError;
        if (java.exitCode !== null) throw new Error('Java API exited during startup; inspect java-server.log.');
        try {if ((await fetch(base + '/api/v1/health', {signal: AbortSignal.timeout(1000)})).ok) return;} catch {}
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Java API startup timed out.');
}

async function connect(target, token) {
    await target.locator('#connect').click();
    await target.locator('#dialog-input').fill(token);
    await target.getByRole('button', {name: 'Continue', exact: true}).click();
    await expect(target.locator('#connect')).toHaveText('Disconnect');
}
async function previewValue(expression) {
    for (const frame of page.frames().filter(frame => frame.url().includes('openbexi_timeline_model_preview.html'))) {
        const value = await frame.evaluate(expression).catch(() => undefined);
        if (value !== undefined) return value;
    }
}

try {
    await startJava();
    const admin = (await api('POST', 'access/users', systemToken, {id: 'integration-admin', workspaceIds: ['default']}, null, 201)).data;
    const reader = (await api('POST', 'access/users', systemToken, {id: 'integration-reader', workspaceIds: ['default']}, null, 201)).data;
    await api('POST', 'datasets', systemToken, {id: modelId, sourceId: 'monet'}, null, 201);
    const access = await api('GET', `models/${modelId}/access`);
    await api('PUT', `models/${modelId}/access`, systemToken,
        {grants: [{userId: admin.id, role: 'admin'}, {userId: reader.id, role: 'readOnly'}]}, access.etag);
    const datasetPath = path.join(storage, modelId + '.json');
    const records = () => fs.readFile(datasetPath, 'utf8').then(text => JSON.parse(text).events);
    const before = await records();
    const editorUrl = base + `/openbexi_timeline_model.html?launch=connected&modelId=${modelId}&model=` + encodeURIComponent(`/api/v1/models/${modelId}`);
    browser = await chromium.launch({executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
    context = await browser.newContext({viewport: {width: 1440, height: 900}});
    await context.tracing.start({screenshots: true, snapshots: true});
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => {
        if (!request.failure()?.errorText.includes('ERR_ABORTED')) failedRequests.push({url: request.url(), error: request.failure()?.errorText});
    });
    page.on('request', request => {
        if (request.url().includes('/api/v1/')) requests.push({path: new URL(request.url()).pathname,
            method: request.method(), frame: request.frame().url(), authorization: Boolean(request.headers().authorization)});
    });
    await page.goto(editorUrl);
    await expect(page.locator('#editor-lock')).toBeVisible();
    await expect(page.locator('#document-management')).toBeHidden();
    await expect(page.locator('#editing-actions #save')).toBeVisible();
    await expect(page.locator('.editor-heading a')).toHaveCount(0);
    assert.equal(requests.length, 0);
    checks.push('protected loading waits for authentication');

    await connect(page, admin.token);
    await expect(page.locator('#preview-host')).toHaveAttribute('data-state', 'ready', {timeout: 45_000});
    await expect(page.locator('#errors')).toBeHidden();
    await expect(page.getByRole('textbox', {name: 'params.0.title', exact: true})).toHaveValue('Claude Monet');
    await expect.poll(() => previewValue(() => window.previewTimeline?.localSource?.url)).toMatch(/^blob:/);
    assert(requests.find(request => request.path.endsWith('/preview') && request.authorization));
    assert(!requests.some(request => request.frame.includes('model_preview') && request.authorization));
    assert.equal(await page.evaluate(token => JSON.stringify(localStorage).includes(token) || JSON.stringify(sessionStorage).includes(token), admin.token), false);
    checks.push('admin preview uses a Blob without iframe credentials or stored tokens');

    await page.locator('#ai-panel summary').click();
    await page.locator('#ai-prompt').fill('');
    await page.locator('#ai-image').setInputFiles({name: 'timeline.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')});
    await page.locator('#ai-generate').click();
    await expect(page.locator('#ai-status')).toContainText('Validated proposal');
    await page.locator('#ai-preview').click();
    await expect(page.locator('#preview-state')).toContainText('AI integration draft');
    assert.equal((await api('GET', `models/${modelId}`, admin.token)).data.params[0].title, 'Claude Monet');
    await page.locator('#ai-accept').click();
    await expect(page.getByRole('textbox', {name: 'params.0.title', exact: true})).toHaveValue('AI integration draft');
    await page.locator('#undo').click();
    await expect(page.getByRole('textbox', {name: 'params.0.title', exact: true})).toHaveValue('Claude Monet');
    assert.equal(providerCalls, 1);
    checks.push('image-only AI proposal validates, previews, accepts and undoes without autosave');

    await page.getByRole('textbox', {name: 'params.0.title', exact: true}).fill('Saved from integration browser');
    const saved = page.waitForResponse(response => response.url() === base + `/api/v1/models/${modelId}` && response.request().method() === 'PUT');
    await page.locator('#save').click();
    assert.equal((await saved).status(), 200);
    await expect(page.locator('#dirty')).toHaveText('Saved on server');
    assert.equal((await api('GET', `models/${modelId}`, admin.token)).data.params[0].title, 'Saved from integration browser');
    const versions = (await api('GET', `models/${modelId}/versions`, admin.token)).data.items;
    assert(versions.length >= 2);
    checks.push('Save updates the selected model and records configuration history');

    await page.getByRole('button', {name: 'Filters', exact: true}).click();
    await page.locator('#filter-name').fill('Integration personal filter');
    await page.locator('#filter-expression').fill('Monet');
    await page.getByRole('button', {name: 'Save filter', exact: true}).click();
    await expect(page.locator('#notice')).toContainText('Saved filter');
    const filters = (await api('GET', `models/${modelId}/filters`, admin.token)).data.items;
    assert(filters.some(filter => filter.title === 'Integration personal filter' && filter.createdBy === admin.id));
    assert.deepEqual(await records(), before);
    checks.push('filter save uses the refreshed revision and preserves every timeline item field');

    const readerPage = await context.newPage();
    await readerPage.goto(editorUrl); await connect(readerPage, reader.token);
    await expect(readerPage.locator('#editor-lock')).toBeVisible();
    await expect(readerPage.locator('#save')).toBeDisabled();
    await expect(readerPage.locator('#raw')).not.toBeEditable();
    await api('GET', `models/${modelId}/preview`, reader.token, undefined, undefined, 403);
    await api('GET', `models/${modelId}/config-files`, reader.token, undefined, undefined, 403);
    await api('POST', `models/${modelId}/ai/generate`, reader.token, {}, undefined, 403);
    const readerModel = await api('GET', `models/${modelId}`, reader.token);
    await api('PUT', `models/${modelId}`, reader.token, readerModel.data, readerModel.etag, 403);
    assert.deepEqual(await records(), before);
    checks.push('reader is denied editor, preview, private documents, model writes and AI');
    assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
    passed = true;
    console.log(`PASS model workspace integration: ${checks.length} checks, ${before.length} unchanged timeline items, ${versions.length} versions, ${providerCalls} loopback AI call; no browser errors.`);
} catch (error) {
    process.exitCode = 1;
    await page?.screenshot({path: path.join(temporary, 'failure.png'), fullPage: true}).catch(() => {});
    await fs.writeFile(path.join(temporary, 'result.json'), JSON.stringify({checks, errors, failedRequests, requests, error: error.stack}, null, 2));
    console.error(`FAIL model workspace integration: ${error.message}\nPrivate diagnostics: ${temporary}`);
} finally {
    await context?.tracing.stop(passed ? {} : {path: path.join(temporary, 'trace.zip')}).catch(() => {});
    await browser?.close();
    if (java && java.exitCode === null) java.kill();
    if (javaExit) await javaExit;
    if (javaLog) await new Promise(resolve => javaLog.end(resolve));
    provider.closeAllConnections();
    if (provider.listening) await new Promise(resolve => provider.close(resolve));
    // Only remove the directory this invocation created. Preserve failed-run diagnostics privately.
    if (passed) {
        const resolved = await fs.realpath(temporary);
        assert.equal(resolved, ownedTemporary);
        assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir()));
        assert(path.basename(resolved).startsWith('openbexi-workspace-integration-'));
        await fs.rm(resolved, {recursive: true, force: true});
    }
}
