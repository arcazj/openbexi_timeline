import test from 'node:test';
import assert from 'node:assert/strict';
import {bandTicks, secondaryTicks} from '../src/openbexi_timeline_ticks.js';

test('Historical ticks align to actual BCE/CE calendar years with a finer focused scale', () => {
    const band = {dateFormat: 'yyyy', ticks: {unit: 'YEAR', step: 50},
        focus: {from: '0000-01-01', to: '0036-01-01', ticks: {unit: 'YEAR', step: 5}}};
    const ticks = bandTicks(band, Date.parse('-000365-01-01'), Date.parse('0036-01-01'));
    assert.deepEqual(ticks.map(tick => new Date(tick.time).getUTCFullYear()),
        [-350, -300, -250, -200, -150, -100, -50, 0, 5, 10, 15, 20, 25, 30, 35]);
    assert.ok(ticks.every(tick => new Date(tick.time).getUTCMonth() === 0));
});

test('Nested focus ticks keep month context, local hours, and half-hours without duplicate dates', () => {
    const band = {dateFormat: 'HH:mm', ticks: {unit: 'MONTH', step: 1, format: 'yyyy-MM'}, focus: [
        {from: '1963-11-22T15:00:00Z', to: '1963-11-23T06:00:00Z', ticks: {unit: 'HOUR', step: 1}},
        {from: '1963-11-22T18:00:00Z', to: '1963-11-22T19:00:00Z', ticks: {unit: 'MINUTE', step: 30}}
    ]};
    const ticks = bandTicks(band, Date.parse('1963-08-15T06:00:00Z'), Date.parse('1963-11-23T06:00:00Z'), -360);
    assert.equal(new Set(ticks.map(tick => tick.time)).size, ticks.length);
    assert.equal(ticks.find(tick => tick.time === Date.parse('1963-09-01T06:00:00Z'))?.format, 'yyyy-MM');
    assert.equal(ticks.find(tick => tick.time === Date.parse('1963-11-22T18:30:00Z'))?.format, 'HH:mm');
    assert.ok(!ticks.some(tick => tick.time === Date.parse('1963-11-22T19:30:00Z')));
});

test('Tick counts stay bounded when navigating far outside a detailed focus', () => {
    const ticks = bandTicks({intervalUnit: 'MINUTE', tickMinutes: 5}, Date.parse('-001000-01-01'), Date.parse('3000-01-01'));
    assert.ok(ticks.length <= 401);
});

test('Age ticks follow the actual birth anniversary and visible range instead of calendar-year boundaries', () => {
    const scale = {origin: '1840-11-14T00:00:00Z', step: 10, suffix: ' Age'};
    const ticks = secondaryTicks(scale, Date.parse('1824-01-01'), Date.parse('1916-01-01'));
    assert.deepEqual(ticks.map(tick => tick.label), ['0 Age', '10 Age', '20 Age', '30 Age', '40 Age', '50 Age', '60 Age', '70 Age']);
    assert.deepEqual(ticks.map(tick => new Date(tick.time).toISOString()),
        [1840, 1850, 1860, 1870, 1880, 1890, 1900, 1910].map(year => year + '-11-14T00:00:00.000Z'));
    assert.deepEqual(secondaryTicks(scale, Date.parse('1850-01-01'), Date.parse('1850-11-13')), [],
        'The next decade is not reached until the anniversary');
    assert.deepEqual(secondaryTicks(scale, Date.parse('1850-11-14'), Date.parse('1860-11-13')).map(tick => tick.value), [10]);
});
