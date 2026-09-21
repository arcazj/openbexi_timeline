import {modelSchema, catalogSchema} from './openbexi_timeline_schema_validators.js';

function jsonPath(pointer) {
    return '$' + (pointer || '').split('/').slice(1).map(part => {
        const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
        return /^\d+$/.test(key) ? '[' + key + ']' : /^[A-Za-z_$][\w$]*$/.test(key) ? '.' + key : '[' + JSON.stringify(key) + ']';
    }).join('');
}

export class DemoValidationError extends Error {
    constructor(label, issues) {
        super(label + ': ' + issues.map(issue => issue.path + ' ' + issue.message).join('; '));
        this.name = 'DemoValidationError';
        this.issues = issues;
    }
}

function schemaIssues(validator, value) {
    if (validator(value)) return [];
    return validator.errors.map(error => {
        const property = error.keyword === 'required' ? error.params.missingProperty :
            error.keyword === 'additionalProperties' ? error.params.additionalProperty : undefined;
        const pointer = error.instancePath + (property === undefined ? '' : '/' + property.replaceAll('~', '~0').replaceAll('/', '~1'));
        return {path: jsonPath(pointer), message: error.message};
    });
}

function calendarTime(value) {
    if (typeof value === 'number') return value;
    const year = value.trim().match(/^([+-]?\d{1,6})\s*(BC|BCE|AD|CE)?$/i);
    if (!year) return Date.parse(value);
    const date = new Date(0);
    date.setUTCFullYear(/^BC/i.test(year[2] || '') ? 1 - Number(year[1]) : Number(year[1]), 0, 1);
    return date.getTime();
}

export function validateDemoModel(value, {label = 'model'} = {}) {
    const issues = schemaIssues(modelSchema, value);
    if (issues.length) throw new DemoValidationError(label, issues);
    const issue = (path, message) => issues.push({path, message});
    const axis = value.dataSource.time;
    const numeric = axis?.kind === 'numeric';
    const toTime = (date, path) => {
        const number = typeof date === 'number' || /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(date.trim()) ? Number(date) : NaN;
        const time = numeric ? number * axis.millisecondsPerUnit * (axis.direction || 1) : calendarTime(date);
        if (!Number.isFinite(time) || !Number.isFinite(new Date(time).getTime())) issue(path,
            numeric ? 'must be a finite value in the declared numeric axis unit' : 'must be a valid calendar date');
        return time;
    };
    const range = (interval, path) => {
        const from = toTime(interval.from, path + '.from'), to = toTime(interval.to, path + '.to');
        if (Number.isFinite(from) && Number.isFinite(to) && to <= from) issue(path + '.to', 'must follow from in the declared axis direction');
    };
    const ticks = (settings, path) => {
        if (numeric !== (settings.unit === 'NUMERIC')) issue(path + '.unit',
            numeric ? 'must be NUMERIC for a numeric axis' : 'NUMERIC requires dataSource.time.kind = "numeric"');
        if (['MONTH', 'YEAR', 'DECADE', 'CENTURY'].includes(settings.unit) && !Number.isInteger(settings.step))
            issue(path + '.step', 'must be an integer for a calendar month or year unit');
    };
    toTime(value.params[0].date, '$.params[0].date');
    const names = new Set();
    const normalNames = new Set(value.bands.filter(band => !band.name.includes('overview_')).map(band => band.name));
    if (!normalNames.size) issue('$.bands', 'must include a normal band');
    value.bands.forEach((band, index) => {
        const path = '$.bands[' + index + ']';
        const overview = band.name.includes('overview_');
        if (names.has(band.name)) issue(path + '.name', 'must be unique');
        names.add(band.name);
        if (typeof band.height === 'string' && parseFloat(band.height) > 100) issue(path + '.height', 'must not exceed 100%');
        if (band.range) range(band.range, path + '.range');
        if (band.context) range(band.context, path + '.context');
        if (band.ticks) ticks(band.ticks, path + '.ticks');
        if (numeric && band.tickMinutes !== undefined) issue(path + '.tickMinutes', 'is only supported on calendar axes; use ticks.unit = "NUMERIC"');
        if (band.ticks && band.tickMinutes !== undefined) issue(path + '.tickMinutes', 'cannot be combined with ticks');
        const focuses = Array.isArray(band.focus) ? band.focus : band.focus ? [band.focus] : [];
        focuses.forEach((focus, focusIndex) => {
            const focusPath = path + '.focus' + (Array.isArray(band.focus) ? '[' + focusIndex + ']' : '');
            range(focus, focusPath);
            if (focus.ticks) ticks(focus.ticks, focusPath + '.ticks');
            if (numeric && focus.tickMinutes !== undefined) issue(focusPath + '.tickMinutes', 'is only supported on calendar axes');
            if (focus.ticks && focus.tickMinutes !== undefined) issue(focusPath + '.tickMinutes', 'cannot be combined with ticks');
        });
        if (band.sourceBands) {
            if (!overview) issue(path + '.sourceBands', 'is only supported on Overview bands');
            band.sourceBands.forEach((name, sourceIndex) => {
                if (!normalNames.has(name)) issue(path + '.sourceBands[' + sourceIndex + ']', 'must reference an existing normal band');
                else if (value.bands.find(source => source.name === name).groupBy) issue(path + '.sourceBands[' + sourceIndex + ']',
                    'cannot select a generated group band; omit sourceBands to project all groups');
            });
        }
        if (band.secondaryScale) {
            if (numeric) issue(path + '.secondaryScale', 'elapsedYears requires a calendar axis');
            if (!Number.isFinite(calendarTime(band.secondaryScale.origin))) issue(path + '.secondaryScale.origin', 'must be a valid calendar date');
        }
    });
    if (value.params[0].dockOverview && !value.bands.at(-1).name.includes('overview_'))
        issue('$.params[0].dockOverview', 'requires a trailing Overview band');
    (value.dataSource.zones || []).forEach((zone, index) => {
        const path = '$.dataSource.zones[' + index + ']';
        const start = toTime(zone.start, path + '.start'), end = toTime(zone.end, path + '.end');
        if (Number.isFinite(start) && Number.isFinite(end) && end <= start) issue(path + '.end', 'must follow start in the declared axis direction');
    });
    if (issues.length) throw new DemoValidationError(label, issues);
    return value;
}

export function validateDemoCatalog(value, {label = 'catalog'} = {}) {
    const issues = schemaIssues(catalogSchema, value);
    if (issues.length) throw new DemoValidationError(label, issues);
    const ids = new Set();
    value.demos.forEach((demo, index) => {
        if (ids.has(demo.id)) issues.push({path: '$.demos[' + index + '].id', message: 'must be unique'});
        ids.add(demo.id);
    });
    if (issues.length) throw new DemoValidationError(label, issues);
    return value;
}
