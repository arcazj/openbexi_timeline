import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {parseTimelineData} from '../src/openbexi_timeline_data_parser.js';
import {parseLocalTimelineData, readLocalTimelineData, describeLocalProgress, LOCAL_WORKER_THRESHOLD} from '../src/openbexi_timeline_local_data.js';
import {TimelineTextureCache} from '../src/openbexi_timeline_textures.js';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';

const padding = ' '.repeat(LOCAL_WORKER_THRESHOLD);
const sample = {events: [{id: 'sample', start: '2026-10-02', data: {title: 'Café 🌎'}}]};

// Run the actual browser worker module in a separate Node thread. The shim only
// maps Web Worker messaging; parsing and normalization use production sources.
function workers() {
    const state = {started: 0, terminated: 0, replies: 0};
    state.factory = (url, options) => {
        assert.equal(options.type, 'module');
        state.started++;
        const script = `import {parentPort} from 'node:worker_threads';
            globalThis.self = {postMessage: value => parentPort.postMessage(value)};
            await import(${JSON.stringify(url.href)});
            parentPort.on('message', data => self.onmessage({data}));`;
        const thread = new Worker(new URL('data:text/javascript,' + encodeURIComponent(script)));
        const worker = {postMessage: value => thread.postMessage(value), terminate() { state.terminated++; void thread.terminate(); }};
        thread.on('message', data => {state.replies++;worker.onmessage?.({data});});
        thread.on('messageerror', error => worker.onmessageerror?.(error));
        thread.on('error', error => worker.onerror?.(error));
        return worker;
    };
    return state;
}

test('The worker preserves the frozen legacy, nested and snapshot item contracts', async () => {
    const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/event-session-contract.json', import.meta.url), 'utf8'));
    const pool = workers();
    for (const entry of fixture.cases) {
        const input = new Blob([padding, JSON.stringify(entry.input)]);
        const actual = await parseLocalTimelineData(input, entry.source, {workerFactory: pool.factory});
        assert.deepEqual(actual, entry.expectedRenderer, entry.name);
    }
    assert.equal(pool.replies, fixture.cases.length, 'The real worker returned every result');
    assert.equal(pool.terminated, pool.started, 'Completed loads release their workers');
});

test('Streamed downloads report bytes, retain split UTF-8 and process large JSON in a worker', async () => {
    const bytes = new TextEncoder().encode(padding + JSON.stringify(sample));
    const split = bytes.indexOf(0xc3) + 1;
    const body = new ReadableStream({start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
    }});
    const pool = workers(), progress = [];
    const actual = await readLocalTimelineData(new Response(body, {headers: {'Content-Length': String(bytes.length)}}), {},
        {workerFactory: pool.factory, onProgress: value => progress.push(value)});
    assert.deepEqual(actual, parseTimelineData(JSON.stringify(sample)));
    assert.equal(pool.replies, 1);
    assert.ok(progress.some(value => value.loaded === bytes.length && value.total === bytes.length));
    assert.equal(progress.at(-1).stage, 'processing');
    assert.match(describeLocalProgress({stage: 'download', loaded: bytes.length, total: bytes.length}), /100%/);
    assert.equal(describeLocalProgress(progress.at(-1)), 'Processing dataset…');
});

test('Cancellation terminates pending worker processing and ignores late results', async () => {
    const controller = new AbortController();
    let worker, terminated = 0, staleMessage;
    const task = parseLocalTimelineData(padding + JSON.stringify(sample), {}, {signal: controller.signal,
        workerFactory: () => worker = {postMessage() {staleMessage = worker.onmessage;}, terminate() {terminated++;}}});
    controller.abort();
    await assert.rejects(task, {name: 'AbortError'});
    assert.equal(terminated, 1);
    assert.equal(worker.onmessage, null);
    staleMessage({data: {type: 'result', dataset: {events: []}}});
    assert.equal(worker.onmessage, null);
    assert.equal(terminated, 1);
});

test('Cancellation releases an unfinished response stream', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream({start(stream) {stream.enqueue(new TextEncoder().encode('{'));}, cancel() {cancelled = true;}});
    const task = readLocalTimelineData(new Response(body), {}, {signal: controller.signal});
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    await assert.rejects(task, {name: 'AbortError'});
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
});

test('Unavailable module workers fall back to the existing parser and invalid records still fail', async () => {
    const input = padding + JSON.stringify(sample);
    const failedWorker = {postMessage() {queueMicrotask(() => this.onerror?.({preventDefault() {}}));}, terminate() {this.closed = true;}};
    assert.deepEqual(await parseLocalTimelineData(input, {}, {workerFactory: () => failedWorker}), parseTimelineData(input));
    assert.equal(failedWorker.closed, true);
    assert.deepEqual(await parseLocalTimelineData(input, {}, {workerFactory() {throw new Error('Workers unavailable');}}), parseTimelineData(input));
    const pool = workers();
    await assert.rejects(parseLocalTimelineData(padding + '{"events":[{"start":"invalid"}]}', {}, {workerFactory: pool.factory}), /Invalid start date/);
    assert.equal(pool.replies, 1);
    assert.equal(pool.terminated, 1);
});

test('Small JSON and legacy XML retain the browser parser path', async () => {
    const neverWorker = () => {throw new Error('This source must not create a worker');};
    const small = await parseLocalTimelineData(JSON.stringify(sample), {}, {workerFactory: neverWorker});
    assert.deepEqual(small, parseTimelineData(JSON.stringify(sample)));
    const harness = await createTimelineHarness();
    try {
        const {parseLocalTimelineData: parse} = await harness.importModule('src/openbexi_timeline_local_data.js');
        const xml = padding + '<data><event start="2026-10-02" title="Legacy">Description</event></data>';
        let started = 0;
        const actual = await parse(xml, {format: 'simile-xml'}, {workerFactory() {started++;}});
        assert.equal(started, 0);
        assert.equal(actual.events[0].data.title, 'Legacy');
        assert.equal(actual.events[0].data.description, 'Description');
    } finally {harness.close();}
});

test('Icon textures load only on demand, reuse within an instance and dispose independently', () => {
    const requests = [], disposed = [], pending = [];
    const loader = {load(image, onLoad) {
        requests.push(image); pending.push(onLoad);
        return {dispose() {disposed.push(this);}};
    }};
    let repaints = 0;
    const first = new TimelineTextureCache(loader, () => repaints++), second = new TimelineTextureCache(loader);
    assert.equal(requests.length, 0);
    assert.equal(first.get(undefined), undefined);
    assert.equal(first.get('https://example.org/external.png'), undefined);
    const a = first.get('icon/ob_info.png'), b = second.get('icon/ob_info.png');
    assert.equal(first.get('icon/ob_info.png'), a);
    assert.notEqual(a, b);
    assert.equal(requests.length, 2);
    pending[0](); assert.equal(repaints, 1);
    first.dispose();first.dispose();
    pending[0](); assert.equal(repaints, 1, 'Late image callbacks cannot repaint a removed timeline');
    assert.deepEqual(disposed, [a]);
    assert.equal(second.get('icon/ob_info.png'), b);
    second.dispose(); assert.deepEqual(disposed, [a, b]);
});

test('Timeline instances keep separate icon ownership despite shared prototype methods', async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const first = new OB_TIMELINE({autoStart: false}), second = new OB_TIMELINE({autoStart: false});
        assert.equal(first.iconTextures.entries.size, 0);
        assert.equal(second.iconTextures.entries.size, 0);
        const a = first.load_texture('icon/ob_info.png'), b = second.load_texture('icon/ob_info.png');
        assert.notEqual(a, b);
        first.disposeTextures();
        assert.equal(second.load_texture('icon/ob_info.png'), b);
        second.disposeTextures();
    } finally {harness.close();}
});

test('A newer local load wins when an aborted older request still returns', async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const timeline = new OB_TIMELINE({autoStart: false}), requests = [], commits = [];
        timeline.localSource = {url: '/dataset.json', config: {}};
        timeline.ob_results = {ranges: new Map(), visibleRanges: new Map(), updateUI() {},
            commit() {commits.push(timeline.staticData);}, fail(error) {throw error;}};
        harness.window.fetch = () => new Promise(resolve => requests.push(resolve));
        const oldLoad = timeline.loadLocalData(), newLoad = timeline.loadLocalData();
        requests[1](new Response(JSON.stringify(sample)));
        await newLoad;
        requests[0](new Response('{"events":[]}'));
        await oldLoad;
        assert.equal(commits.length, 1);
        assert.equal(timeline.staticData.events[0].id, 'sample');
        assert.equal(timeline.ob_results.fetching, false);
        assert.equal(timeline.ob_results.localProgress, '');
    } finally {harness.close();}
});
