import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function compareTags(a, b) {
    const version = tag => {
        if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Stable version tag required: ' + tag);
        return tag.slice(1).split('.').map(Number);
    };
    const aa = version(a), bb = version(b);
    for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
    return 0;
}

export function verifyRelease(release, tag, expected) {
    if (release.tag_name !== tag || !release.body?.trim() || release.prerelease)
        throw new Error('Release tag, notes or stability check failed.');
    for (const [name, file] of expected) {
        const asset = release.assets.find(item => item.name === name);
        if (!asset || asset.state !== 'uploaded' || asset.size !== file.bytes.length || asset.digest !== 'sha256:' + file.hash)
            throw new Error('Missing or mismatched release asset: ' + name);
    }
}

export async function publishRelease(root, env = process.env, fetcher = fetch) {
    root = path.resolve(root);
    const {version} = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const tag = env.RELEASE_TAG;
    if (tag !== 'v' + version) throw new Error('Tag differs from package version.');
    compareTags(tag, tag);
    if (!env.GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '')) throw new Error('GitHub token and repository are required.');
    const api = 'https://api.github.com/repos/' + env.GITHUB_REPOSITORY;
    const request = async (url, method = 'GET', body, binary = false) => {
        const response = await fetcher(url.startsWith('https:') ? url : api + url, {
            method, headers: {Authorization: 'Bearer ' + env.GH_TOKEN, Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': binary ? 'application/octet-stream' : 'application/json'},
            body: body === undefined ? undefined : binary ? body : JSON.stringify(body)
        });
        if (!response.ok) throw new Error(`GitHub ${method} failed (${response.status}): ${url.split('?')[0]}`);
        return response.status === 204 ? null : response.json();
    };
    const list = async endpoint => {
        const result = [];
        for (let page = 1; ; page++) {
            const batch = await request(`${endpoint}?per_page=100&page=${page}`);
            result.push(...batch);
            if (batch.length < 100) return result;
        }
    };
    const tags = await list('/tags');
    if (!tags.some(item => item.name === tag)) throw new Error('Release tag is missing.');
    // A delayed older build must never publish over or prune a newer tag.
    for (const item of tags) if (compareTags(item.name, tag) > 0) throw new Error('A newer tag already exists.');
    const expected = new Map();
    for (const suffix of ['windows-x64-setup.exe', 'source.tar.gz']) {
        const name = `openbexi-timeline-${version}-${suffix}`;
        const bytes = await fs.readFile(path.join(root, 'dist', name));
        const hash = createHash('sha256').update(bytes).digest('hex');
        if (!bytes.length || (suffix.endsWith('.exe') && bytes.subarray(0, 2).toString() !== 'MZ')) throw new Error('Invalid release binary: ' + name);
        const checksum = await fs.readFile(path.join(root, 'dist', name + '.sha256'));
        if (checksum.toString().trim() !== `${hash}  ${name}`) throw new Error('Checksum mismatch: ' + name);
        expected.set(name, {bytes, hash});
        expected.set(name + '.sha256', {bytes: checksum, hash: createHash('sha256').update(checksum).digest('hex')});
    }
    let notes = await fs.readFile(path.join(root, `docs/release-${version}.md`), 'utf8');
    if (notes.trim().length < 100) throw new Error('Release notes are required.');
    notes = notes.replace(/\]\((?![a-z]+:|#|\/)([^)]+)\)/gi,
        (_, target) => `](https://github.com/${env.GITHUB_REPOSITORY}/blob/${tag}/docs/${target})`);
    notes += `\n## Windows installer\n\nDownload **openbexi-timeline-${version}-windows-x64-setup.exe** below. ` +
        'The per-user installer includes Java and browser dependencies; Node.js, Maven and a separate Java installation are not required. ' +
        'Launch OpenBEXI Timeline from the Start menu and keep its console open while using the application. Press Ctrl+C to stop. ' +
        'Windows 10/11 x64 is supported. The installer is unsigned. ' +
        'Local data is stored in `%LOCALAPPDATA%\\OpenBEXI Timeline\\data` and retained when uninstalling.\n\n' +
        'The installer and source archive each include a SHA-256 checksum. Installation, bundled-Java startup, browser rendering, API access and uninstall were checked on Windows before publication.\n';
    const releases = await list('/releases');
    let release = releases.find(item => item.tag_name === tag);
    if (!release) release = await request('/releases', 'POST', {tag_name: tag, name: 'OpenBEXI Timeline ' + version, body: notes, draft: true, prerelease: false});
    if (release.draft) {
        release = await request('/releases/' + release.id, 'PATCH', {body: notes, name: 'OpenBEXI Timeline ' + version});
        for (const [name, file] of expected) {
            const previous = release.assets.find(asset => asset.name === name);
            if (previous?.digest === 'sha256:' + file.hash && previous.size === file.bytes.length) continue;
            if (previous) await request('/releases/assets/' + previous.id, 'DELETE');
            await request(release.upload_url.replace(/\{.*\}/, '') + '?name=' + encodeURIComponent(name), 'POST', file.bytes, true);
        }
        release = await request('/releases/' + release.id);
        verifyRelease(release, tag, expected);
        release = await request('/releases/' + release.id, 'PATCH', {draft: false, make_latest: 'true'});
    }
    verifyRelease(release, tag, expected);
    if (release.draft) throw new Error('Release is still a draft.');
    const currentTags = await list('/tags');
    for (const item of currentTags) if (compareTags(item.name, tag) > 0) throw new Error('A newer tag appeared; cleanup stopped.');
    // Only tag refs are removed. Historical release records and assets remain available.
    for (const old of currentTags) if (old.name !== tag)
        await request('/git/refs/tags/' + encodeURIComponent(old.name), 'DELETE');
    const finalTags = await list('/tags');
    if (finalTags.length !== 1 || finalTags[0].name !== tag) throw new Error('Tag retention verification failed.');
    console.log(`Published ${release.html_url}; only ${tag} remains.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
    await publishRelease(process.argv[2] || '.');
