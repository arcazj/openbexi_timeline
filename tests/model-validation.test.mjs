import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {validateDemoModel, validateDemoCatalog, DemoValidationError} from '../src/openbexi_timeline_model_validation.js';
import {validateDemoFiles} from '../tools/validate-demo-models.mjs';
import {createTimelineHarness, root} from './helpers/timeline-dom.mjs';

const read = async file => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
const operations = await read('models/demos/default-dataset.json');
const dinosaurs = await read('models/demos/dinausaurs.json');
const religions = await read('models/demos/religions.json');
const catalog = await read('demos/catalog.json');

function rejectsAt(model, mutate, expectedPath, expectedMessage) {
    const value = structuredClone(model);
    mutate(value);
    assert.throws(() => validateDemoModel(value), error => {
        assert.ok(error instanceof DemoValidationError);
        assert.ok(error.issues.some(issue => issue.path === expectedPath &&
            (!expectedMessage || expectedMessage.test(issue.message))), error.message);
        assert.ok(error.message.includes(expectedPath));
        return true;
    });
}

test('Published JSON Schemas and compiled validators accept every catalog model without modifying it', async () => {
    assert.equal(validateDemoCatalog(catalog), catalog);
    for (const demo of catalog.demos) {
        const model = await read(demo.model);
        const original = JSON.stringify(model);
        assert.equal(validateDemoModel(model, {label: demo.model}), model);
        assert.equal(JSON.stringify(model), original);
    }
    assert.equal(await validateDemoFiles(), 7);
    execFileSync(process.execPath, ['tools/build-demo-validators.mjs', '--check'], {cwd: root, stdio: 'pipe'});
});

test('Schema errors name the exact field for unsupported options, dimensions and tick settings', () => {
    rejectsAt(operations, model => model.bands[0].range.form = model.bands[0].range.from,
        '$.bands[0].range.form', /additional properties/);
    rejectsAt(operations, model => model.bands[0]['typo.option'] = true, '$.bands[0]["typo.option"]');
    rejectsAt(operations, model => delete model.params[0].width, '$.params[0].width', /required/);
    rejectsAt(operations, model => model.params[0].width = 0, '$.params[0].width');
    rejectsAt(operations, model => model.params[0].overviewHeightRatio = 1, '$.params[0].overviewHeightRatio');
    rejectsAt(operations, model => model.bands[0].ticks = {unit: 'MINUTE', step: 0}, '$.bands[0].ticks.step');
    rejectsAt(operations, model => model.bands[0].focus.magnification = 0, '$.bands[0].focus.magnification');
    rejectsAt(operations, model => model.bands[0].height = '-50%', '$.bands[0].height');
    rejectsAt(operations, model => model.dataSource.format = 'csv', '$.dataSource.format');
    rejectsAt(dinosaurs, model => model.dataSource.time.direction = 0, '$.dataSource.time.direction');
});

test('Calendar and numeric ranges reject invalid dates and reversed axis direction before rendering', () => {
    rejectsAt(operations, model => model.params[0].date = 'not-a-date', '$.params[0].date', /calendar/);
    rejectsAt(operations, model => model.bands[0].range.to = model.bands[0].range.from, '$.bands[0].range.to', /follow from/);
    rejectsAt(operations, model => model.bands[0].context.from = 'garbage', '$.bands[0].context.from');
    rejectsAt(operations, model => model.bands[0].focus.to = model.bands[0].focus.from, '$.bands[0].focus.to');
    rejectsAt(dinosaurs, model => model.bands[0].range = {from: 40, to: 240}, '$.bands[0].range.to');
    rejectsAt(dinosaurs, model => model.bands[0].range.from = '2026-09-12', '$.bands[0].range.from', /numeric/);
    rejectsAt(dinosaurs, model => model.params[0].date = 1e300, '$.params[0].date', /finite/);
    const historical = structuredClone(religions);
    historical.params[0].date = '44 BCE';
    assert.equal(validateDemoModel(historical), historical, 'Historical initial dates and extended ISO BCE ranges remain valid');
    rejectsAt(religions, model => model.bands[0].range.to = '-002000-01-01T00:00:00Z', '$.bands[0].range.to');
});

test('Model references and incompatible axis options report their own fields', () => {
    rejectsAt(operations, model => model.bands[1].sourceBands = ['missing'], '$.bands[1].sourceBands[0]', /existing normal band/);
    rejectsAt(operations, model => model.bands[1].sourceBands = [model.bands[1].name], '$.bands[1].sourceBands[0]');
    rejectsAt(operations, model => model.bands[0].sourceBands = [model.bands[0].name], '$.bands[0].sourceBands', /Overview/);
    rejectsAt(operations, model => model.bands[1].name = model.bands[0].name, '$.bands[1].name', /unique/);
    rejectsAt(operations, model => model.bands.pop(), '$.params[0].dockOverview', /trailing Overview/);
    rejectsAt(operations, model => model.bands[0].ticks = {unit: 'NUMERIC', step: 20}, '$.bands[0].ticks.unit', /numeric/);
    rejectsAt(dinosaurs, model => model.bands[0].ticks.unit = 'YEAR', '$.bands[0].ticks.unit', /NUMERIC/);
    rejectsAt(dinosaurs, model => model.bands[0].tickMinutes = 10, '$.bands[0].tickMinutes', /calendar/);
    rejectsAt(religions, model => model.bands[0].ticks.step = 1.5, '$.bands[0].ticks.step', /integer/);
    rejectsAt(dinosaurs, model => model.bands[0].secondaryScale = {format: 'elapsedYears', origin: '1900', step: 10},
        '$.bands[0].secondaryScale', /calendar/);
});

test('Catalog validation rejects duplicate IDs, missing paths and malformed counts with paths', () => {
    for (const [mutate, expectedPath] of [
        [value => value.demos[1].id = value.demos[0].id, '$.demos[1].id'],
        [value => delete value.demos[0].dataset, '$.demos[0].dataset'],
        [value => value.demos[0].recordCount = -1, '$.demos[0].recordCount'],
        [value => value.demos[0].unexpected = true, '$.demos[0].unexpected']
    ]) {
        const value = structuredClone(catalog);
        mutate(value);
        assert.throws(() => validateDemoCatalog(value), error => error.issues.some(issue => issue.path === expectedPath));
    }
});

test('The browser loader validates a demo before fetching data or replacing an existing timeline', async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const timeline = new OB_TIMELINE();
        await timeline.loadModel('models/demos/default-dataset.json', {dataset: 'json/test-data/default-dataset.json'});
        const originalParams = timeline.params;
        const originalData = timeline.staticData;
        const renders = harness.renderCount;
        const invalid = structuredClone(operations);
        invalid.bands[0].range.to = 'invalid';
        const fetches = [];
        harness.window.fetch = async url => {
            fetches.push(String(url));
            return new Response(JSON.stringify(invalid), {status: 200});
        };
        await assert.rejects(timeline.loadModel('invalid-model.json', {dataset: 'do-not-fetch.json'}),
            /invalid-model\.json: \$\.bands\[0\]\.range\.to/);
        assert.deepEqual(fetches, ['invalid-model.json']);
        assert.equal(timeline.params, originalParams);
        assert.equal(timeline.staticData, originalData);
        assert.equal(harness.renderCount, renders);
    } finally { harness.close(); }
});

test('Legacy models without dataSource retain their existing loader path', async () => {
    const harness = await createTimelineHarness();
    try {
        const {OB_TIMELINE} = await harness.importModule('src/openbexi_timeline.js');
        const timeline = new OB_TIMELINE();
        const legacy = {params: [{name: 'legacy'}], bands: [{name: 'legacy-band'}], legacyOption: true};
        harness.window.fetch = async () => new Response(JSON.stringify(legacy), {status: 200});
        timeline.updateURL = async () => 'http://localhost/sessions';
        let initialized = false;
        timeline.initializeTimeline = () => { initialized = true; };
        await timeline.loadModel('legacy.json');
        assert.equal(initialized, true);
        assert.equal(timeline.params[0].data, 'http://localhost/sessions');
    } finally { harness.close(); }
});
