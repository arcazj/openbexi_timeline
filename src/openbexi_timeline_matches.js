// Matching for complete, normalized file-backed data. Live providers retain their
// own query semantics and must supply their own authoritative match results.
export function createStaticSearchMatcher(search = '') {
    const query = search.trim().toLocaleLowerCase();
    return {
        query,
        hasCondition: query.length > 0,
        // Keep the existing static search fields and literal substring semantics.
        // parseTimelineData places searchable namespace/metadata in record.data.
        matches: record => Boolean(query) &&
            (JSON.stringify(record.data) ?? '').toLocaleLowerCase().includes(query)
    };
}

function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) freeze(child);
    }
    return value;
}

/**
 * Build immutable match metadata before row/window culling or renderer copies.
 * The caller supplies a complete normalized dataset already restricted to its
 * eligible source/domain/filter scope. Counts describe this input, not a server.
 * A parent can qualify through children without becoming a direct search match.
 * No display filtering, source mutation, or navigation occurs here.
 */
export function createStaticMatchSnapshot(dataset, search = '', {sourceScope = ''} = {}) {
    return createMatchSnapshot(dataset, createStaticSearchMatcher(search), {sourceScope});
}

export function createProviderMatchSnapshot(dataset, metadata, search, {sourceScope = ''} = {}) {
    if (metadata?.version !== 1 || metadata.query !== search || !Array.isArray(dataset?.events))
        throw new Error('The provider did not return matching metadata for this query.');
    if (typeof metadata.complete !== 'boolean' || typeof metadata.hasCondition !== 'boolean' ||
        typeof metadata.revision !== 'string' || !metadata.revision ||
        !Number.isFinite(Date.parse(metadata.domain?.from)) || !Number.isFinite(Date.parse(metadata.domain?.to)) ||
        Date.parse(metadata.domain.to) <= Date.parse(metadata.domain.from))
        throw new Error('The provider did not declare valid matching coverage and revision.');
    const matcher = {query: search, hasCondition: metadata.hasCondition === true, matches: record => {
        if (typeof record.searchMatch !== 'boolean') throw new Error('Missing provider match identity.');
        return metadata.hasCondition === true && record.searchMatch;
    }};
    return createMatchSnapshot(dataset, matcher, {sourceScope, allowMissingParents: metadata.complete !== true});
}

function createMatchSnapshot(dataset, matcher, {sourceScope, allowMissingParents = false}) {
    if (typeof sourceScope !== 'string') throw new TypeError('sourceScope must be a stable string.');
    if (!Array.isArray(dataset?.events)) throw new TypeError('Match snapshots require a normalized events array.');
    const data = structuredClone(dataset);
    const entries = [];
    const zones = [];
    const byKey = new Map();
    const topLevel = new Map();
    const children = new Map();
    const sourceOf = (record, inherited = '') => String(record.namespace || record.data?.namespace || inherited);
    const localId = (source, id) => JSON.stringify([source, String(id)]);
    const collect = (record, ancestry = [], parentKey = null, inheritedSource = '') => {
        if (record.zone) { zones.push(record); return; }
        if (!record.sourceRecordKey && (record.id === undefined || record.id === null || String(record.id) === ''))
            throw new Error('Match snapshots require normalized record IDs.');
        const source = sourceOf(record, inheritedSource);
        const path = [...ancestry, [source, String(record.sourceRecordKey || record.id)]];
        const key = JSON.stringify([sourceScope, path]);
        if (byKey.has(key)) throw new Error('Duplicate record identity in match snapshot: ' + record.id);
        const kind = Array.isArray(record.activities) || record.data?.kind === 'session' ? 'session' : 'event';
        const entry = {key, parentKey, kind, record, directMatch: matcher.matches(record), qualifies: false};
        entries.push(entry);
        byKey.set(key, entry);
        children.set(key, []);
        if (parentKey) children.get(parentKey).push(entry);
        else topLevel.set(localId(source, record.id), entry);
        for (const child of record.activities || []) collect(child, path, key, source);
    };
    for (const record of data.events) collect(record);

    // Some static models express sessions as flat records with parentSessionId.
    // Keep those source IDs stable; only the relationship metadata is linked.
    for (const entry of entries) {
        if (entry.parentKey) continue;
        const parentId = entry.record.data?.parentSessionId;
        if (parentId === undefined || parentId === null || parentId === '') continue;
        const parent = topLevel.get(localId(sourceOf(entry.record), parentId));
        if (!parent && allowMissingParents) continue;
        if (!parent || parent.kind !== 'session')
            throw new Error('Missing parent session in complete match scope: ' + parentId);
        entry.parentKey = parent.key;
        children.get(parent.key).push(entry);
    }
    const visiting = new Set();
    const visited = new Set();
    const qualify = entry => {
        if (visiting.has(entry.key)) throw new Error('Cyclic parent sessions in match scope.');
        if (visited.has(entry.key)) return entry.qualifies;
        visiting.add(entry.key);
        let childMatch = false;
        // Do not short-circuit: every entry needs its qualification and cycle check.
        for (const child of children.get(entry.key)) if (qualify(child)) childMatch = true;
        entry.qualifies = entry.directMatch || childMatch;
        visiting.delete(entry.key);
        visited.add(entry.key);
        return entry.qualifies;
    };
    for (const entry of entries) qualify(entry);

    const counts = {eligible: {events: 0, sessions: 0}, matching: {events: 0, sessions: 0}};
    const matchingKeys = [];
    const structuralParentKeys = [];
    let from = Infinity, to = -Infinity;
    for (const entry of entries) {
        const kind = entry.kind === 'session' ? 'sessions' : 'events';
        counts.eligible[kind]++;
        if (entry.directMatch) {
            counts.matching[kind]++;
            matchingKeys.push(entry.key);
            const start = Date.parse(entry.record.start);
            const end = entry.record.end === undefined ? start : Date.parse(entry.record.end);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
                throw new Error('Match bounds require normalized valid dates: ' + entry.record.id);
            from = Math.min(from, start);
            to = Math.max(to, end);
        } else if (entry.qualifies) structuralParentKeys.push(entry.key);
    }
    return freeze({query: matcher.query, hasCondition: matcher.hasCondition, sourceScope,
        dateTimeFormat: data.dateTimeFormat, entries, zones, matchingKeys, structuralParentKeys, counts,
        // Real matching bounds only: padding/minimum span belong to Fit matches.
        matchingBounds: matchingKeys.length ? {from, to} : null});
}

// One projection feeds detail layout, overview, table and density. Match metadata
// is presentation state; source colors and timestamps remain untouched.
export function projectMatchSnapshot(snapshot, mode = 'highlight') {
    if (!['highlight', 'only'].includes(mode)) throw new Error('Unknown Results mode.');
    const only = mode === 'only' && snapshot.hasCondition;
    const records = new Map();
    const events = [];
    const densityRecords = [];
    for (const entry of snapshot.entries) {
        if (only && !entry.qualifies) continue;
        const record = structuredClone(entry.record);
        delete record.activities;
        Object.assign(record, {matchKey: entry.key, searchMatch: entry.directMatch,
            structuralContext: only && !entry.directMatch, recordKind: entry.kind});
        if (entry.kind === 'session') record.activities = [];
        records.set(entry.key, record);
        if (!record.structuralContext) densityRecords.push(record);
    }
    for (const entry of snapshot.entries) {
        const record = records.get(entry.key);
        if (!record) continue;
        const parent = records.get(entry.parentKey);
        if (parent) (parent.activities ??= []).push(record);
        else events.push(record);
    }
    // Zones provide context; an empty matches-only view must actually be empty.
    if (!only) events.push(...structuredClone(snapshot.zones));
    return {dateTimeFormat: snapshot.dateTimeFormat, events, densityRecords,
        displayedKeys: [...records.keys()]};
}
