// Optional model-defined ranges and focus magnification for file-backed timelines.
// Both directions share the same piecewise-linear transform, including beyond
// the viewport, so navigation and Overview ranges stay consistent.
const timestamp = value => typeof value === 'number' ? value :
    value && typeof value.getTime === 'function' ? value.getTime() : Date.parse(value);

export function prepareBandScale(timeline, sceneIndex, band) {
    if (!band.range) { delete band.timeScale; return; }
    const scene = timeline.ob_scene[sceneIndex];
    const axis = timeline.staticTimeAxis;
    // Model ranges use the declared numeric unit. Loaded event dates and camera
    // coordinates already use internal milliseconds and must not be converted twice.
    const modelTime = value => axis?.kind === 'numeric' ?
        Number(value) * axis.millisecondsPerUnit * (axis.direction || 1) : timestamp(value);
    const referenceValue = timeline.params?.[0]?.date;
    const reference = axis?.kind === 'numeric' && typeof referenceValue === 'number' ?
        modelTime(referenceValue) : timestamp(referenceValue);
    const shift = Number.isFinite(reference) && Number.isFinite(timeline.ob_scene.sync_time) ?
        timeline.ob_scene.sync_time - reference : 0;
    const from = modelTime(band.range.from) + shift;
    const to = modelTime(band.range.to) + shift;
    const contextFrom = modelTime(band.context?.from ?? band.range.from) + shift;
    const contextTo = modelTime(band.context?.to ?? band.range.to) + shift;
    const width = Number(scene.width);
    if (![from, to, contextFrom, contextTo, width].every(Number.isFinite) ||
        to <= from || contextTo <= contextFrom || width <= 0)
        throw new Error('Invalid band range: ' + band.name);
    const focuses = (Array.isArray(band.focus) ? band.focus : band.focus ? [band.focus] : []).map(focus => {
        const item = {...focus, from: modelTime(focus.from) + shift, to: modelTime(focus.to) + shift,
            magnification: Number(focus.magnification ?? 1)};
        if (![item.from, item.to, item.magnification].every(Number.isFinite) || item.to <= item.from || item.magnification < 1)
            throw new Error('Invalid band focus: ' + band.name);
        return item;
    });
    // Break overlapping intervals into constant-weight segments. Nested focus
    // magnifications multiply, so a day can be expanded within a month and an
    // important hour expanded further without any dataset-specific rendering.
    const boundaries = [...new Set(focuses.flatMap(focus => [focus.from, focus.to]))].sort((a, b) => a - b);
    const segments = boundaries.slice(0, -1).map((start, index) => ({
        from: start, to: boundaries[index + 1],
        magnification: focuses.filter(focus => start >= focus.from && start < focus.to)
            .reduce((product, focus) => product * focus.magnification, 1)
    }));
    const weight = time => segments.reduce((value, segment) => value +
        (segment.magnification - 1) * Math.max(0, Math.min(segment.to - segment.from, time - segment.from)), time);
    for (const segment of segments) segment.weightedFrom = weight(segment.from);
    const unweight = value => {
        let extra = 0;
        for (const segment of segments) {
            if (value <= segment.weightedFrom) return value - extra;
            const weightedSpan = (segment.to - segment.from) * segment.magnification;
            if (value < segment.weightedFrom + weightedSpan)
                return segment.from + (value - segment.weightedFrom) / segment.magnification;
            extra += (segment.to - segment.from) * (segment.magnification - 1);
        }
        return value - extra;
    };
    const focusFrom = focuses[0]?.from ?? from;
    const focusTo = focuses[0]?.to ?? from;
    const magnification = focuses[0]?.magnification ?? 1;
    const left = weight(from);
    const span = weight(to) - left;
    band.timeScale = {
        from, to, contextFrom, contextTo, focusFrom, focusTo, magnification, focuses, axis,
        toPixel: value => (weight(timestamp(value)) - left) / span * width - width / 2,
        toTime: pixel => unweight(left + (Number(pixel) + width / 2) / width * span)
    };
    // These values remain useful to existing model metadata and interval controls;
    // ranged rendering itself always uses the invertible transform above.
    band.intervalPixels = band.gregorianUnitLengths * width / (to - from);
    band.minDate = new Date(contextFrom);
    band.maxDate = new Date(contextTo);
}

export function bandTimeToPixel(timeline, sceneIndex, band, value) {
    const time = timestamp(value);
    if (!Number.isFinite(time)) return NaN;
    return band.timeScale ? band.timeScale.toPixel(time) :
        (time - timeline.ob_scene.sync_time) * band.intervalPixels / band.gregorianUnitLengths;
}

export function bandPixelToTime(timeline, sceneIndex, band, pixel) {
    return band.timeScale ? band.timeScale.toTime(pixel) :
        timeline.ob_scene.sync_time + Number(pixel) * band.gregorianUnitLengths / band.intervalPixels;
}
