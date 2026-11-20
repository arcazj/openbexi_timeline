import {access} from 'node:fs/promises';
import path from 'node:path';

/** Prefer an explicit interpreter, then the project venv, then setup-python/PATH. */
export async function resolvePython(root) {
    const configured = process.env.OPENBEXI_PYTHON || process.env.PYTHON;
    if (configured) return configured;
    const local = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    try {
        await access(local);
        return local;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return 'python';
    }
}
