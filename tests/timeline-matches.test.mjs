import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createStaticSearchMatcher, createStaticMatchSnapshot, createProviderMatchSnapshot} from '../src/openbexi_timeline_matches.js';
import {parseTimelineData, searchTimelineData} from '../src/openbexi_timeline_data.js';
import {filterLocalData} from '../src/openbexi_timeline_filters.js';

const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/mixed-hazard-matches.json', import.meta.url), 'utf8'));
const record = (id, title, extra = {}) => ({id, start: '2026-09-12T12:00:00Z', data: {title}, render: {}, ...extra});
const entry = (snapshot, id) => snapshot.entries.find(item => item.record.id === id);

test('Source occurrence identity is separate from external IDs, searchable fields, and ordering',()=>{
    const events=[record('', 'First', {sourceRecordKey:'opaque/1',searchMatch:false}),
        record('', 'Second', {sourceRecordKey:'opaque/2',searchMatch:false}),
        record(null,'Third',{sourceRecordKey:'opaque/3',searchMatch:false}),
        record('shared','Fourth',{sourceRecordKey:'opaque/4',searchMatch:false}),
        record('shared','Fifth',{sourceRecordKey:'opaque/5',searchMatch:false})];
    const metadata={version:1,query:'',complete:true,hasCondition:false,revision:'one',
        domain:{from:'2026-09-12T00:00:00Z',to:'2026-09-13T00:00:00Z'}};
    const data=parseTimelineData(JSON.stringify({events,timelineMatch:metadata}));
    assert.deepEqual(data.events.map(item=>item.id),['','',null,'shared','shared']);
    assert.ok(data.events.every(item=>item.data.sourceRecordKey===undefined));
    const snapshot=createProviderMatchSnapshot(data,metadata,'');
    assert.equal(snapshot.entries.length,5);assert.equal(new Set(snapshot.entries.map(item=>item.key)).size,5);
    data.events.reverse();
    assert.deepEqual(createProviderMatchSnapshot(data,metadata,'').entries.map(item=>item.key).sort(),snapshot.entries.map(item=>item.key).sort());
    assert.equal(createStaticMatchSnapshot(data,'opaque').matchingKeys.length,0,'Opaque source identities are not search metadata');
    assert.equal(filterLocalData(data,'|sourceRecordKey').events.length,5,'Internal keys cannot trigger local exclusions');
    assert.equal(filterLocalData(data,'opaque').events.length,0,'Internal key values cannot trigger local includes');
});

test('Static matching keeps case-insensitive literal substring semantics and metadata fields', () => {
    const matcher = createStaticSearchMatcher('  VOLCANO  ');
    assert.equal(matcher.query, 'volcano');
    assert.equal(matcher.matches(fixture.events[1]), true, 'Namespace matches even when the label lacks the query');
    assert.equal(matcher.matches(fixture.events[3].activities[0]), true, 'Metadata tags are searchable');
    assert.equal(matcher.matches(fixture.events[0]), false, 'Source yellow styling is not match identity');
    assert.equal(createStaticSearchMatcher('ash observation').matches(fixture.events[3].activities[0]), true);
    assert.equal(createStaticSearchMatcher('ash equipment').matches(fixture.events[3].activities[0]), false,
        'Spaces are not translated into provider-specific OR syntax');
    for (const query of ['*', '.*', '[', 'ash;equipment']) {
        assert.equal(createStaticSearchMatcher(query).matches(record('literal', query)), true);
        assert.equal(createStaticSearchMatcher(query).matches(record('other', 'ordinary')), false);
    }
});

test('One complete snapshot distinguishes direct events, directly matching sessions, and structural parents', () => {
    const snapshot = createStaticMatchSnapshot(fixture, 'volcano', {sourceScope: 'hazard-fixture'});
    assert.deepEqual(snapshot.counts, {eligible: {events: 7, sessions: 2}, matching: {events: 4, sessions: 1}});
    assert.equal(snapshot.matchingKeys.length, 5);
    const context = entry(snapshot, 'context-session');
    assert.equal(context.directMatch, false, 'Child fields are not treated as the parent own fields');
    assert.equal(context.qualifies, true);
    assert.deepEqual(snapshot.structuralParentKeys, [context.key]);
    assert.equal(entry(snapshot, 'direct-session').directMatch, true);
    assert.equal(entry(snapshot, 'unmatched-child').qualifies, false);
    const directChild = snapshot.entries.find(item => item.parentKey === entry(snapshot, 'direct-session').key);
    assert.equal(directChild.directMatch, false, 'A parent match does not mark its child');
    assert.equal(directChild.qualifies, false);
    assert.equal(snapshot.zones.length, 1);
    assert.ok(!snapshot.entries.some(item => item.record.zone), 'Decorative zones add no match or record count');
    assert.equal(entry(snapshot, 'late').directMatch, true, 'Matching happens before detail-window/page culling');
});

test('Matching bounds include real direct duration endpoints and exclude structural parents and zones', () => {
    const snapshot = createStaticMatchSnapshot(fixture, 'volcano');
    assert.deepEqual(snapshot.matchingBounds, {from: Date.parse('2026-09-12T10:00:00Z'), to: Date.parse('2026-09-12T23:00:00Z')});
    const childOnly = createStaticMatchSnapshot(fixture, 'ash observation');
    assert.deepEqual(childOnly.matchingBounds, {from: Date.parse('2026-09-12T12:00:00Z'), to: Date.parse('2026-09-12T12:05:00Z')});
    const parentOnly = createStaticMatchSnapshot(fixture, 'volcano watch');
    assert.deepEqual(parentOnly.counts.matching, {events: 0, sessions: 1});
    assert.deepEqual(parentOnly.matchingBounds, {from: Date.parse('2026-09-12T15:00:00Z'), to: Date.parse('2026-09-12T16:00:00Z')});
});

test('Empty conditions, zero matches, and empty data yield no blanket highlights or fit bounds', () => {
    for (const query of ['', '   ', 'does-not-exist']) {
        const snapshot = createStaticMatchSnapshot(fixture, query);
        assert.equal(snapshot.hasCondition, query.trim().length > 0);
        assert.equal(snapshot.entries.length, 9, 'Eligible context remains in the snapshot');
        assert.deepEqual(snapshot.matchingKeys, []);
        assert.deepEqual(snapshot.structuralParentKeys, []);
        assert.deepEqual(snapshot.counts.matching, {events: 0, sessions: 0});
        assert.equal(snapshot.matchingBounds, null);
    }
    const empty = createStaticMatchSnapshot({events: []}, 'volcano');
    assert.deepEqual(empty.entries, []);
    assert.deepEqual(empty.counts.eligible, {events: 0, sessions: 0});
    assert.equal(empty.matchingBounds, null);
});

test('Keys are source/parent qualified, stable across ordering and queries, and preserve simultaneous records', () => {
    const snapshot = createStaticMatchSnapshot(fixture, 'volcano', {sourceScope: 'one'});
    const repeatedIds = snapshot.entries.filter(item => item.record.id === 'shared-id');
    assert.equal(repeatedIds.length, 2);
    assert.equal(repeatedIds[0].record.start, repeatedIds[1].record.start);
    assert.notEqual(repeatedIds[0].key, repeatedIds[1].key);
    const repeatedChildren = snapshot.entries.filter(item => item.record.id === 'shared-child');
    assert.equal(repeatedChildren.length, 2);
    assert.notEqual(repeatedChildren[0].key, repeatedChildren[1].key);
    const reordered = structuredClone(fixture);
    reordered.events.reverse();
    for (const item of reordered.events) item.activities?.reverse();
    const again = createStaticMatchSnapshot(reordered, 'equipment', {sourceScope: 'one'});
    assert.deepEqual(again.entries.map(item => item.key).sort(), snapshot.entries.map(item => item.key).sort());
    const otherScope = createStaticMatchSnapshot(fixture, 'volcano', {sourceScope: 'two'});
    assert.ok(otherScope.entries.every(item => !snapshot.entries.some(previous => previous.key === item.key)));
    const simultaneous = createStaticMatchSnapshot({events: [record('a', 'volcano'), record('b', 'volcano')]}, 'volcano');
    assert.equal(simultaneous.counts.matching.events, 2);
    assert.equal(simultaneous.matchingBounds.from, simultaneous.matchingBounds.to, 'Minimum fit span is a navigation concern');
});

test('Snapshots are detached and immutable without freezing or changing source records', () => {
    const data = structuredClone(fixture);
    const before = structuredClone(data);
    const snapshot = createStaticMatchSnapshot(data, 'volcano');
    assert.deepEqual(data, before);
    assert.equal(Object.isFrozen(data.events[0]), false);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.throws(() => snapshot.entries[0].record.render.backgroundColor = 'red', TypeError);
    assert.throws(() => snapshot.matchingKeys.push('fake'), TypeError);
    data.events[1].data.title = 'Edited later';
    assert.equal(snapshot.entries[1].record.data.title, 'ORANGE - Kilauea');
    assert.equal(snapshot.entries[0].record.render.backgroundColor, '#F8DF09');
});

test('Nested ancestors qualify once without inflating direct counts or duration bounds', () => {
    const data = {events: [record('outer', 'Outer group', {activities: [
        record('inner', 'Inner group', {activities: [record('leaf', 'volcano')]}),
        record('sibling', 'Other event')
    ]})]};
    const snapshot = createStaticMatchSnapshot(data, 'volcano');
    assert.deepEqual(snapshot.counts, {eligible: {events: 2, sessions: 2}, matching: {events: 1, sessions: 0}});
    assert.equal(snapshot.structuralParentKeys.length, 2);
    assert.equal(entry(snapshot, 'sibling').qualifies, false);
});

test('Flat parentSessionId relationships qualify the correct source session without mutating the data', () => {
    const data = {events: [
        record('parent', 'Context', {namespace: 'one', data: {title: 'Context', kind: 'session'}}),
        record('parent', 'Other source', {namespace: 'two', data: {title: 'Other source', kind: 'session'}}),
        record('child', 'volcano', {namespace: 'one', data: {title: 'volcano', parentSessionId: 'parent'}})
    ]};
    const snapshot = createStaticMatchSnapshot(data, 'volcano');
    assert.equal(snapshot.structuralParentKeys.length, 1);
    assert.equal(entry(snapshot, 'child').parentKey, snapshot.entries[0].key);
    assert.equal(snapshot.entries[1].qualifies, false);
    assert.deepEqual(snapshot.counts.matching, {events: 1, sessions: 0});
    assert.equal(data.events[0].activities, undefined, 'Links are metadata, not injected child copies');
});

test('Invalid identities, missing parents, cycles, and invalid fit dates fail explicitly', () => {
    assert.throws(() => createStaticMatchSnapshot({events: [record('a', 'volcano'), record('a', 'volcano')]}), /Duplicate record identity/);
    assert.throws(() => createStaticMatchSnapshot({events: [record(undefined, 'volcano')]}), /normalized record IDs/);
    assert.throws(() => createStaticMatchSnapshot({events: [record('orphan', 'volcano', {data: {parentSessionId: 'missing'}})]}), /Missing parent session/);
    assert.throws(() => createStaticMatchSnapshot({events: [record('cycle', 'volcano', {data: {title: 'volcano', kind: 'session', parentSessionId: 'cycle'}})]}, 'volcano'), /Cyclic parent sessions/);
    assert.throws(() => createStaticMatchSnapshot({events: [record('bad', 'volcano', {start: 'invalid'})]}, 'volcano'), /normalized valid dates/);
    assert.throws(() => createStaticMatchSnapshot({events: []}, '', {sourceScope: {}}), /stable string/);
});

test('Existing search output still retains zones and all children of a qualifying parent', () => {
    const before = structuredClone(fixture);
    for (const query of ['', 'volcano', 'equipment', 'ash observation', 'no-such-event', '*']) {
        const normalized = query.trim().toLocaleLowerCase();
        const expected = fixture.events.filter(event => event.zone || !normalized ||
            JSON.stringify(event.data).toLocaleLowerCase().includes(normalized) ||
            event.activities?.some(activity => JSON.stringify(activity.data).toLocaleLowerCase().includes(normalized)));
        assert.deepEqual(searchTimelineData(fixture, query), {dateTimeFormat: fixture.dateTimeFormat, events: expected});
    }
    const filtered = searchTimelineData(fixture, 'ash observation');
    assert.equal(filtered.events.find(item => item.id === 'context-session').activities.length, 2,
        'The existing UI behavior changes only when Results controls are introduced');
    filtered.events[0].data.title = 'Changed layout copy';
    assert.deepEqual(fixture, before);
});

test('The normalized import feeds snapshot metadata without reinterpreting numeric-axis instants', () => {
    const parsed = parseTimelineData(JSON.stringify({events: [
        {id: 'numeric', title: 'volcano epoch', start: 70, end: 60}
    ]}), {time: {kind: 'numeric', millisecondsPerUnit: 31536000000, direction: -1}});
    const snapshot = createStaticMatchSnapshot(parsed, 'volcano');
    assert.deepEqual(snapshot.matchingBounds, {from: -70 * 31536000000, to: -60 * 31536000000});
    assert.deepEqual(snapshot.entries[0].record, parsed.events[0]);
});
