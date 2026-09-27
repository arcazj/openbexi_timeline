import {bandRendering} from './openbexi_timeline_rendering.js';
// Calendar-aware ticks shared by the canvas and docked Overview axes.
// Each magnified interval can select its own tick unit and label format.
const lengths = {MILLISECOND: 1, SECOND: 1000, MINUTE: 60000, HOUR: 3600000, DAY: 86400000, WEEK: 604800000};
const maxTicks = 400;

// Select labels using the local time-to-pixel slope, including compressed gaps.
export function adaptiveTickSettings(duration, pixels, axis, targetPixels = 100) {
    const desired = duration / Math.max(1, pixels / targetPixels);
    if (axis?.kind === 'numeric') {
        const value=desired/axis.millisecondsPerUnit, power=10**Math.floor(Math.log10(Math.max(Number.MIN_VALUE,value)));
        return {unit:'NUMERIC',step:[1,2,5,10].find(n=>n*power>=value)*power};
    }
    const choices=[['MILLISECOND',1,1,'HH:mm:ss.SSS'],['MILLISECOND',10,1,'HH:mm:ss.SSS'],['MILLISECOND',100,1,'HH:mm:ss.SSS'],
        ...[1,5,15,30].map(n=>['SECOND',n,1000,'HH:mm:ss']),
        ...[1,5,15,30].map(n=>['MINUTE',n,60000,'MM/dd HH:mm']),
        ...[1,3,6,12].map(n=>['HOUR',n,3600000,'MM/dd HH:mm']),
        ['DAY',1,86400000,'MMM dd'],['DAY',2,86400000,'MMM dd'],['WEEK',1,604800000,'MMM dd'],
        ...[1,3,6].map(n=>['MONTH',n,2629800000,'MMM yyyy']),
        ...[1,2,5,10,25,50,100,500,1000,10000].map(n=>['YEAR',n,31557600000,'yyyy'])];
    const [unit,step,,format]=choices.find(([,n,length])=>n*length>=desired) || choices.at(-1);
    return {unit,step,format:format.replaceAll('MMM','mmm')};
}

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
    if (band.autoTicks && band.timeScale) {
        const scale=band.timeScale, boundaries=[from,...(scale.adaptiveMap?.segments || []).flatMap(s=>[s.from,s.to])
            .filter(t=>t>from && t<to),to];
        const edges=[...new Set(boundaries)].sort((a,b)=>a-b), ticks=new Map();
        // Adjacent bins with equal slope share calendar alignment and formatting.
        const intervals=[];
        for(let i=1;i<edges.length;i++) {
            const a=edges[i-1],b=edges[i],pixels=Math.abs(scale.toPixel(b)-scale.toPixel(a));
            const settings=adaptiveTickSettings(b-a,pixels,scale.axis,bandRendering(band).axis.targetTickPixels),key=JSON.stringify(settings);
            if(intervals.at(-1)?.key===key) intervals.at(-1).to=b;
            else intervals.push({from:a,to:b,settings,key});
        }
        for(const interval of intervals) for(const time of intervalTicks(interval.from,interval.to,interval.settings,offsetMinutes,scale.axis))
            ticks.set(time,{time,format:interval.settings.format});
        return [...ticks.values()].sort((a,b)=>a.time-b.time);
    }
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
