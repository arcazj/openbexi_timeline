import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {compareTags, publishRelease} from '../tools/publish-release.mjs';

test('version ordering compares numeric components and rejects arbitrary refs', () => {
    assert.ok(compareTags('v2.10.0', 'v2.9.9') > 0);
    assert.ok(compareTags('v3.0.0', 'v2.99.99') > 0);
    assert.throws(() => compareTags('master', 'v2.6.1'));
});

async function fixture(t, options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openbexi-release-test-'));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    await fs.mkdir(path.join(root, 'dist'));
    await fs.mkdir(path.join(root, 'docs'));
    await fs.writeFile(path.join(root, 'package.json'), '{"version":"2.6.1"}');
    await fs.writeFile(path.join(root, 'docs/release-2.6.1.md'), '# Release\n' + 'A reviewed change with upgrade and validation details. '.repeat(4));
    for (const suffix of ['windows-x64-setup.exe', 'source.tar.gz']) {
        const name = 'openbexi-timeline-2.6.1-' + suffix, bytes = Buffer.from('MZ-test-fixture-' + suffix);
        await fs.writeFile(path.join(root, 'dist', name), bytes);
        await fs.writeFile(path.join(root, 'dist', name + '.sha256'), createHash('sha256').update(bytes).digest('hex') + '  ' + name + '\n');
    }
    let tags = ['v2.6.1', 'v2.6.0', 'v2.5.2', ...(options.newer ? ['v2.7.0'] : [])];
    let release;
    const mutations = [];
    const fetcher = async (url, init) => {
        const parsed = new URL(url), endpoint = parsed.pathname.replace('/repos/test/repo', ''), method = init.method;
        if (method !== 'GET') mutations.push({method, endpoint});
        const response = value => new Response(JSON.stringify(value), {status: 200});
        if (endpoint === '/tags') return response(tags.map(name => ({name})));
        if (endpoint === '/releases' && method === 'GET') return response([]);
        if (endpoint === '/releases' && method === 'POST') {
            release = {...JSON.parse(init.body), id: 1, assets: [], upload_url: 'https://uploads.github.com/assets{?name}', html_url: 'https://github.com/test/repo/releases/tag/v2.6.1'};
            return response(release);
        }
        if (endpoint === '/assets') {
            if (options.uploadFailure) return new Response('', {status: 500});
            const asset = {name: parsed.searchParams.get('name'), size: init.body.length, state: 'uploaded',
                digest: 'sha256:' + createHash('sha256').update(init.body).digest('hex')};
            release.assets.push(asset);
            return response(asset);
        }
        if (endpoint === '/releases/1') {
            if (method === 'PATCH') {
                const update = JSON.parse(init.body);
                assert.equal(update.tag_name, 'v2.6.1', 'Every draft update must preserve its intended tag.');
                Object.assign(release, update);
            }
            if (method === 'GET' && options.corruptUpload) return response({...release, assets: []});
            return response(release);
        }
        if (endpoint.startsWith('/git/refs/tags/') && method === 'DELETE') {
            assert.equal(release.draft, false, 'Publish before removing older tags.');
            assert.equal(release.assets.length, 4, 'All four assets must be attached.');
            tags = tags.filter(tag => tag !== endpoint.split('/').at(-1));
            return new Response(null, {status: 204});
        }
        throw new Error('Unexpected request: ' + method + ' ' + url);
    };
    return {root, mutations, run: () => publishRelease(root, {RELEASE_TAG: 'v2.6.1', GH_TOKEN: 'test', GITHUB_REPOSITORY: 'test/repo'}, fetcher), tags: () => tags};
}

test('publishes verified installer and notes while preserving historical tags', async t => {
    const f = await fixture(t);
    await f.run();
    assert.deepEqual(f.tags(), ['v2.6.1', 'v2.6.0', 'v2.5.2']);
    assert.deepEqual(f.mutations.filter(call => call.method === 'DELETE'), []);
});
for (const option of ['uploadFailure', 'corruptUpload', 'newer']) test(option + ' preserves all older tags', async t => {
    const f = await fixture(t, {[option]: true});
    await assert.rejects(f.run());
    assert.equal(f.mutations.some(call => call.method === 'DELETE'), false);
    assert.ok(f.tags().includes('v2.6.0'));
});
test('missing installer fails before creating a release', async t => {
    const f = await fixture(t);
    await fs.unlink(path.join(f.root, 'dist/openbexi-timeline-2.6.1-windows-x64-setup.exe'));
    await assert.rejects(f.run());
    assert.deepEqual(f.mutations, []);
});
test('incorrect checksum fails before creating a release', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.root, 'dist/openbexi-timeline-2.6.1-source.tar.gz.sha256'), 'incorrect');
    await assert.rejects(f.run());
    assert.deepEqual(f.mutations, []);
});
