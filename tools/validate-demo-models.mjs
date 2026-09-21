import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {validateDemoCatalog, validateDemoModel} from '../src/openbexi_timeline_model_validation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function validateDemoFiles(catalogFile = path.join(root, 'demos/catalog.json')) {
    const file = path.resolve(catalogFile);
    const catalog = validateDemoCatalog(JSON.parse(await fs.readFile(file, 'utf8')), {label: file});
    const base = new URL(catalog.basePath, pathToFileURL(file));
    if (base.protocol !== 'file:') throw new Error(file + ': $.basePath must resolve to local files for CLI validation');
    for (const [index, demo] of catalog.demos.entries()) {
        const modelURL = new URL(demo.model, base);
        if (modelURL.protocol !== 'file:') throw new Error(file + ': $.demos[' + index + '].model must resolve to a local file');
        const modelFile = fileURLToPath(modelURL);
        validateDemoModel(JSON.parse(await fs.readFile(modelFile, 'utf8')), {label: modelFile});
        for (const key of ['dataset', 'reference']) if (demo[key]) {
            const resource = new URL(demo[key], base);
            if (resource.protocol !== 'file:') throw new Error(file + ': $.demos[' + index + '].' + key + ' must resolve to a local file');
            try { await fs.access(fileURLToPath(resource)); }
            catch { throw new Error(file + ': $.demos[' + index + '].' + key + ' file does not exist: ' + demo[key]); }
        }
    }
    return catalog.demos.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const count = await validateDemoFiles(process.argv[2]);
        console.log('Validated demo catalog, ' + count + ' models, and their local dataset/reference files.');
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
