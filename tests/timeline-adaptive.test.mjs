import test from 'node:test';
import assert from 'node:assert/strict';
import {densityMap, projectMap, chooseDensityMap, zoomMappedRange, fitRange, finiteRange, createRowPacker} from '../src/openbexi_timeline_adaptive.js';

const domain = {from: Date.parse('2026-09-12'), to: Date.parse('2026-09-13')};
const records = Array.from({length: 250}, (_, index) => ({start: domain.from + 3600000 + index * 1000}));

test('Every bounded candidate is finite, strictly increasing and invertible, including quiet gaps and extrapolation', () => {
    for (const ratio of [1, 2, 4, 8, 16]) {
        const map = densityMap(records, domain, ratio);
        const weights = map.segments.map(segment => segment.factor);
        assert.ok(Math.max(...weights) / Math.min(...weights) <= ratio);
        let previous = -Infinity;
        for (let i = -100; i <= 1100; i++) {
            const time = domain.from + (domain.to-domain.from) * i / 1000;
            const value = map.map(time);
            assert.ok(Number.isFinite(value) && value > previous);
            assert.ok(Math.abs(map.inverse(value)-time) < 0.01);
            previous = value;
        }
    }
});

test('Uniform wins equal layout costs; sparse and empty scopes stay finite', () => {
    assert.equal(chooseDensityMap(records, domain, 16, () => 3).ratio, 1);
    assert.equal(densityMap([], domain, 16).ratio, 1);
    const map = densityMap([{start: domain.from, end: domain.to}], domain, 16);
    assert.equal(map.map((domain.from+domain.to)/2), 0.5);
    assert.throws(() => densityMap(records, domain, Infinity));
    assert.throws(() => densityMap([{start: 'invalid'}], domain));
});

test('Zoom keeps its pointer timestamp through rapid steps and clamps to real bounds', () => {
    const map = densityMap(records, domain, 16);
    let range = {from: domain.from + 600000, to: domain.to - 600000};
    const fraction = 0.31;
    const anchor = projectMap(map, range, 1000).toTime(fraction*1000-500);
    for (let i=0; i<20; i++) {
        range = zoomMappedRange(map, range, anchor, 0.8, fraction);
        assert.ok(Math.abs(projectMap(map, range, 1000).toTime(fraction*1000-500)-anchor) < 0.01);
    }
    assert.deepEqual(zoomMappedRange(map, range, anchor, 1e10), domain);
});

test('Fit pads instants and durations without crossing the supported domain', () => {
    const padded = fitRange({from: domain.from+100000, to: domain.from+100000}, domain);
    assert.ok(padded.to-padded.from >= 1000);
    assert.ok(padded.from < domain.from+100000 && padded.to > domain.from+100000);
    assert.deepEqual(fitRange(domain, domain), domain);
    assert.ok(finiteRange(8640000000000000, 8640000000000000).to <= 8640000000000000);
});

test('Bounded row packing retains the lowest available row for simultaneous and touching labels', () => {
    const packer = createRowPacker(10000);
    for (let i=0; i<10000; i++) assert.equal(packer.add(0, 100), i);
    assert.equal(packer.count, 10000);
    assert.equal(packer.add(113, 150), 0);
    assert.equal(packer.add(113, 150), 1);
});
