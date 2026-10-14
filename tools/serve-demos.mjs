import http from 'node:http';
import {readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/plain', '.ico': 'image/x-icon'};

export function createDemoServer(root = projectRoot, basePath = '/') {
    if (!basePath.startsWith('/') || !basePath.endsWith('/')) throw new Error('Base path must start and end with /.');
    const publicHbds = readFile(path.join(projectRoot, 'release/public-files.json'), 'utf8').then(text => new Set(JSON.parse(text).filter(file => file.startsWith('HBDS/'))));
    const aliases = readFile(path.join(projectRoot, 'HBDS/aliases.json'), 'utf8').then(text => JSON.parse(text).aliases, () => ({}));
    return http.createServer(async (request, response) => {
        if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
        try {
            const url = new URL(request.url, 'http://localhost');
            if (!url.pathname.startsWith(basePath)) { response.writeHead(404).end('File unavailable'); return; }
            const relativeURL = url.pathname.slice(basePath.length);
            let pathname = decodeURIComponent('/' + (relativeURL || 'demos.html'));
            const oldPath = pathname.slice(1), migrated = (await aliases)[oldPath];
            if (/^(?:models|yaml|filters)[/\\]/i.test(oldPath) && !migrated) {
                response.writeHead(404).end('File unavailable'); return;
            }
            if (migrated) pathname = '/' + migrated;
            const file = path.resolve(root, '.' + pathname);
            const relative = path.relative(root, file);
            if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part.startsWith('.'))) {
                response.writeHead(403).end('Forbidden'); return;
            }
            if (relative.replaceAll('\\', '/').toLowerCase().startsWith('hbds/') &&
                (!(await publicHbds).has(relative.replaceAll('\\', '/')) || path.resolve(await realpath(file)) !== file)) {
                response.writeHead(404).end('File unavailable'); return;
            }
            const content = await readFile(file);
            response.writeHead(200, {'Content-Type': (types[path.extname(file).toLowerCase()] || 'application/octet-stream') + '; charset=utf-8',
                'Cache-Control': 'no-store'});
            response.end(request.method === 'HEAD' ? undefined : content);
        } catch (error) {
            response.writeHead(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 400).end('File unavailable');
        }
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const option = process.argv.indexOf('--port');
    const port = option < 0 ? 8780 : Number(process.argv[option + 1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use --port with a port between 1 and 65535.');
    createDemoServer().listen(port, '127.0.0.1', () => console.log('Open http://localhost:' + port + '/demos.html (Ctrl+C to stop)'));
}
