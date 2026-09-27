// Bounded work in data coordinates; no renderer resources are allocated here.
export const ADAPTIVE_LIMITS = Object.freeze({bins: 64, maxRatio: 16, candidates: [1, 2, 4, 8],
    minimumSpan: 1000, maximumDate: 8640000000000000});
const time = value => typeof value === 'number' ? value : Date.parse(value);

export function finiteRange(from, to, minimumSpan = ADAPTIVE_LIMITS.minimumSpan) {
    if (![from, to, minimumSpan].every(Number.isFinite) || to < from || minimumSpan <= 0)
        throw new Error('Invalid time range.');
    const bound = ADAPTIVE_LIMITS.maximumDate;
    const span = Math.min(2 * bound, Math.max(minimumSpan, to - from));
    from = Math.max(-bound, Math.min(bound - span, from - Math.max(0, minimumSpan - (to - from)) / 2));
    return {from, to: from + span};
}

export function fitRange(bounds, domain, minimumSpan = ADAPTIVE_LIMITS.minimumSpan) {
    const range = finiteRange(bounds.from, bounds.to, minimumSpan);
    const padding = (range.to - range.from) * 0.08;
    const span = Math.min(domain.to - domain.from, range.to - range.from + 2 * padding);
    const from = Math.max(domain.from, Math.min(domain.to - span, range.from - padding));
    return {from, to: from + span};
}

export function densityMap(records, domain, ratio = 1, bins = ADAPTIVE_LIMITS.bins) {
    const {from, to} = domain;
    if (![from, to, ratio].every(Number.isFinite) || to <= from || ratio < 1 || ratio > ADAPTIVE_LIMITS.maxRatio ||
        !Number.isInteger(bins) || bins < 1 || bins > 512) throw new Error('Invalid adaptive map settings.');
    const step = (to - from) / bins;
    const densities = Array(bins).fill(0);
    for (const record of records) {
        const start = time(record.start), end = record.end === undefined ? start : time(record.end);
        if (![start, end].every(Number.isFinite) || end < start) throw new Error('Invalid density record time.');
        if (end < from || start > to || record.structuralContext || record.zone) continue;
        const first = Math.max(0, Math.min(bins - 1, Math.floor((start - from) / step)));
        const last = Math.max(0, Math.min(bins - 1, Math.floor((end - from) / step)));
        for (let i = first; i <= last; i++) densities[i] += start === end ? 1 :
            Math.max(0, Math.min(end, from + (i + 1) * step) - Math.max(start, from + i * step)) / step;
    }
    const maximum = Math.max(...densities);
    const weights = densities.map(value => maximum ? 1 + (ratio - 1) * Math.log1p(value) / Math.log1p(maximum) : 1);
    const total = weights.reduce((sum, value) => sum + value, 0);
    const units = [0];
    for (const weight of weights) units.push(units.at(-1) + weight / total);
    units[bins] = 1;
    const map = value => {
        const position = (value - from) / step;
        const i = Math.max(0, Math.min(bins - 1, Math.floor(position)));
        return units[i] + (position - i) * weights[i] / total;
    };
    const inverse = value => {
        let low = 0, high = bins - 1;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (units[mid + 1] < value) low = mid + 1; else high = mid;
        }
        return from + (low + (value - units[low]) * total / weights[low]) * step;
    };
    const segments = weights.map((factor, i) => ({from: from + i * step, to: i === bins - 1 ? to : from + (i + 1) * step, factor}));
    return {domain, ratio: maximum ? ratio : 1, segments, map, inverse};
}

export function projectMap(map, range, width) {
    if (!Number.isFinite(width) || width <= 0) throw new Error('A measurable plot width is required.');
    const a = map.map(range.from), span = map.map(range.to) - a;
    if (!Number.isFinite(span) || span <= 0) throw new Error('Invalid projected range.');
    return {from: range.from, to: range.to, contextFrom: map.domain.from, contextTo: map.domain.to,
        focuses: [], magnification: map.ratio, adaptiveMap: map,
        toPixel: value => (map.map(time(value)) - a) / span * width - width / 2,
        toTime: pixel => map.inverse(a + (Number(pixel) + width / 2) / width * span)};
}

// The score callback performs the same label/duration packing for every candidate.
// Ascending candidates mean a tie always chooses less distortion.
export function chooseDensityMap(records, domain, maximumRatio, score) {
    const ratios = [...new Set([...ADAPTIVE_LIMITS.candidates.filter(value => value <= maximumRatio), maximumRatio])].sort((a,b) => a-b);
    let best, bestScore = Infinity;
    for (const ratio of ratios) {
        const candidate = densityMap(records, domain, ratio);
        const cost = score(candidate);
        if (!Number.isFinite(cost)) throw new Error('Invalid candidate layout score.');
        if (cost < bestScore) { best = candidate; bestScore = cost; }
    }
    return best;
}

export function zoomRange(range, domain, anchor, factor, fraction = 0.5) {
    const span = Math.min(domain.to - domain.from, Math.max(ADAPTIVE_LIMITS.minimumSpan, (range.to - range.from) * factor));
    const from = Math.max(domain.from, Math.min(domain.to - span, anchor - span * fraction));
    return {from, to: from + span};
}

// Zoom in mapped coordinates: the real time under the pointer stays under it.
export function zoomMappedRange(map, range, anchor, factor, fraction = 0.5) {
    if (!Number.isFinite(factor) || factor <= 0) throw new Error('Invalid zoom factor.');
    const low = map.map(map.domain.from), high = map.map(map.domain.to);
    const oldSpan = map.map(range.to) - map.map(range.from);
    let span = Math.min(high - low, oldSpan * factor);
    let from = Math.max(low, Math.min(high - span, map.map(anchor) - span * fraction));
    let result = {from: map.inverse(from), to: map.inverse(from + span)};
    if (result.to - result.from < ADAPTIVE_LIMITS.minimumSpan)
        result = zoomRange(range, map.domain, anchor, ADAPTIVE_LIMITS.minimumSpan / (range.to - range.from), fraction);
    return result;
}

export function activityFootprint(record, band, scale, width, measure) {
    const x = scale.toPixel(record.start);
    const end = record.end === undefined ? NaN : scale.toPixel(record.end);
    const duration = Number.isFinite(end) ? end - x : 0;
    const font = `${record.searchMatch ? 'bold' : record.render?.fontWeight || band.fontWeight || 'normal'} ${record.render?.fontStyle || band.fontStyle || 'normal'} ${record.render?.fontSize || band.fontSizeInt || 12}px ${record.render?.fontFamily || band.fontFamily}`;
    const textWidth = measure(record.data?.title || '', font, 6);
    const anchored = ['above', 'inside'].includes(band.labelPosition) && Number.isFinite(end);
    const labelLeft = anchored ? (end >= -width / 2 ? Math.max(x, -width / 2 + 6) : x) : x + duration + 6;
    const occupiedWidth = anchored ? Math.max(duration, labelLeft - x + textWidth) : duration + textWidth + 12;
    return {x, end, width: duration, textWidth, anchored, labelLeft, occupiedWidth};
}

// First available row in O(log n); retains the existing lowest-row preference.
export function createRowPacker(capacity) {
    let size = 1;
    while (size < Math.max(1, capacity)) size *= 2;
    const minimum = new Float64Array(size * 2).fill(-Infinity);
    let count = 0;
    return {get count() { return count; }, add(left, right) {
        let index = 1;
        while (index < size) index = minimum[index * 2] + 12 < left ? index * 2 : index * 2 + 1;
        const row = index - size;
        minimum[index] = right;
        while (index > 1) { index = Math.floor(index / 2); minimum[index] = Math.min(minimum[index * 2], minimum[index * 2 + 1]); }
        count = Math.max(count, row + 1);
        return row;
    }};
}
