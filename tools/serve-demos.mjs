import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/plain', '.ico': 'image/x-icon'};

export function createDemoServer(root = projectRoot) {
    return http.createServer(async (request, response) => {
        if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
        try {
            const url = new URL(request.url, 'http://localhost');
            const pathname = decodeURIComponent(url.pathname === '/' ? '/demos.html' : url.pathname);
            const file = path.resolve(root, '.' + pathname);
            const relative = path.relative(root, file);
            if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part.startsWith('.'))) {
                response.writeHead(403).end('Forbidden'); return;
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
