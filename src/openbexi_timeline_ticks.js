// Calendar-aware ticks shared by the canvas and docked Overview axes.
// Each magnified interval can select its own tick unit and label format.
const lengths = {MILLISECOND: 1, SECOND: 1000, MINUTE: 60000, HOUR: 3600000, DAY: 86400000, WEEK: 604800000};
const maxTicks = 400;

export function secondaryTicks(scale, from, to) {
    const origin = new Date(scale.origin);
    const step = Number(scale.step);
    if (!Number.isFinite(origin.getTime()) || !Number.isFinite(step) || step <= 0) return [];
    const firstYear = new Date(from).getUTCFullYear();
    const lastYear = new Date(to).getUTCFullYear();
    const stride = Math.max(1, Math.round(step)) * Math.max(1, Math.ceil((lastYear - firstYear) / step / maxTicks));
    const first = Math.max(Number(scale.min ?? 0), Math.floor((firstYear - origin.getUTCFullYear()) / stride) * stride);
    const ticks = [];
    for (let value = first; value <= lastYear - origin.getUTCFullYear(); value += stride) {
        const date = new Date(origin);
        date.setUTCFullYear(origin.getUTCFullYear() + value);
        const time = date.getTime();
        if (time >= from && time <= to) ticks.push({time, value, label: value + (scale.suffix || '')});
    }
    return ticks;
}

function intervalTicks(from, to, settings, offsetMinutes, axis) {
    const unit = String(settings.unit || 'MINUTE').toUpperCase();
    let step = Number(settings.step ?? 1);
    if (!Number.isFinite(step) || step <= 0) throw new Error('Invalid tick step');
    const offset = offsetMinutes * 60000;
    const start = from + offset, end = to + offset;
    const dates = [];
    if (unit === 'NUMERIC') {
        const factor = Number(axis?.millisecondsPerUnit);
        if (axis?.kind !== 'numeric' || !Number.isFinite(factor) || factor <= 0)
            throw new Error('Numeric ticks need a numeric time axis');
        step *= factor;
        step *= Math.max(1, Math.ceil((to - from) / step / maxTicks));
        for (let time = Math.ceil(from / step) * step; time <= to; time += step) dates.push(time);
        return dates;
    }
    if (['MONTH', 'YEAR', 'DECADE', 'CENTURY'].includes(unit)) {
        const yearUnit = unit !== 'MONTH';
        step = Math.max(1, Math.round(step * (unit === 'DECADE' ? 10 : unit === 'CENTURY' ? 100 : 1)));
        const first = new Date(start), last = new Date(end);
        const startIndex = first.getUTCFullYear() * (yearUnit ? 1 : 12) + (yearUnit ? 0 : first.getUTCMonth());
        const endIndex = last.getUTCFullYear() * (yearUnit ? 1 : 12) + (yearUnit ? 0 : last.getUTCMonth());
        step *= Math.max(1, Math.ceil((endIndex - startIndex) / step / maxTicks));
        for (let value = Math.floor(startIndex / step) * step; value <= endIndex; value += step) {
            const date = new Date(0);
            date.setUTCFullYear(yearUnit ? value : Math.floor(value / 12), yearUnit ? 0 : ((value % 12) + 12) % 12, 1);
            const time = date.getTime() - offset;
            if (time >= from && time <= to) dates.push(time);
        }
    } else {
        if (!lengths[unit]) throw new Error('Invalid tick unit: ' + unit);
        step *= lengths[unit];
        step *= Math.max(1, Math.ceil((end - start) / step / maxTicks));
        for (let time = Math.ceil(start / step) * step; time <= end; time += step) dates.push(time - offset);
    }
    return dates;
}

export function bandTicks(band, from, to, offsetMinutes = 0) {
    if (![from, to].every(Number.isFinite) || to < from) return [];
    const settings = band.ticks || (band.tickMinutes ? {unit: 'MINUTE', step: band.tickMinutes} :
        {unit: band.intervalUnit || 'HOUR', step: 1});
    const result = new Map();
    const add = (start, end, ticks, format) => {
        if (end < start) return;
        for (const time of intervalTicks(start, end, ticks, offsetMinutes, band.timeScale?.axis)) result.set(time, {time, format});
    };
    const configured = Array.isArray(band.focus) ? band.focus : band.focus ? [band.focus] : [];
    const focuses = band.timeScale?.focuses || configured.map(focus => ({
        from: band.timeScale?.focusFrom ?? Date.parse(focus.from),
        to: band.timeScale?.focusTo ?? Date.parse(focus.to)
    }));
    // Generate the compressed context separately so a long history never thins
    // the detailed ticks inside a focused interval.
    let cursor = from;
    for (const focus of [...focuses].sort((a, b) => a.from - b.from)) {
        add(cursor, Math.min(to, focus.from), settings, settings.format || band.dateFormat);
        cursor = Math.max(cursor, focus.to);
    }
    add(cursor, to, settings, settings.format || band.dateFormat);
    focuses.forEach((focus, index) => {
        const config = configured[index] || {};
        const ticks = config.ticks || (config.tickMinutes ? {unit: 'MINUTE', step: config.tickMinutes} : settings);
        add(Math.max(from, focus.from), Math.min(to, focus.to), ticks, ticks.format || band.dateFormat);
    });
    return [...result.values()].sort((a, b) => a.time - b.time);
}
