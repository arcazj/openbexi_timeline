import {captureTimelineViewState, applyTimelineViewState} from './openbexi_timeline_share.js';

const limit = 20;
const cleanName = name => String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);

function sourceKey(timeline) {
    // Scope by source and user without putting endpoint credentials or personal
    // details in the storage key. These hashes are identifiers, not encryption.
    const source = JSON.stringify([globalThis.location?.pathname, timeline.name,
        timeline.demoContext?.id, (timeline.staticData ? timeline.localSource?.url : undefined) || timeline.params?.[0]?.data || timeline.data || '',
        timeline.staticData ? 'static' : 'server', timeline.staticData ? '' : timeline.ob_user_name || timeline.user || '',
        timeline.modelDocument?.dataSource || null]);
    let first = 2166136261, second = 5381;
    for (let i = 0; i < source.length; i++) {
        first = Math.imul(first ^ source.charCodeAt(i), 16777619);
        second = Math.imul(second, 33) ^ source.charCodeAt(i);
    }
    return `openbexi:views:v1:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
}

function storage(timeline) {
    try {
        const store = globalThis.localStorage;
        if (!store) throw new Error('Storage unavailable');
        return {store, key:sourceKey(timeline)};
    } catch { throw new Error('Saved views are unavailable because this browser blocked local storage.'); }
}

export function listTimelineSavedViews(timeline) {
    const {store, key} = storage(timeline);
    let text;
    try { text = store.getItem(key); }
    catch { throw new Error('Saved views could not be read from this browser.'); }
    if (!text) return [];
    try {
        if (text.length > 250000) throw new Error('Too large');
        const data = JSON.parse(text);
        if (data.version !== 1 || !Array.isArray(data.views) || data.views.length > limit) throw new Error('Invalid views');
        return data.views.filter(view => view && typeof view.name === 'string' && cleanName(view.name) === view.name &&
            view.name && view.state && typeof view.state === 'object' && !Array.isArray(view.state) &&
            Object.values(view.state).every(value => typeof value === 'string' && value.length <= 4096));
    } catch { throw new Error('Saved views could not be read because their stored data is invalid.'); }
}

function write(timeline, views) {
    const {store, key} = storage(timeline);
    try {
        if (views.length) store.setItem(key, JSON.stringify({version:1, views}));
        else store.removeItem(key);
    } catch { throw new Error('This browser could not save the view. Storage may be full or blocked.'); }
}

export function saveTimelineView(timeline, name) {
    name = cleanName(name);
    if (!name) throw new Error('Enter a name for this view.');
    const views = listTimelineSavedViews(timeline);
    const index = views.findIndex(view => view.name === name);
    if (index < 0 && views.length >= limit) throw new Error(`You can save up to ${limit} views per source. Delete a view first.`);
    const view = {name, state:captureTimelineViewState(timeline)};
    if (index < 0) views.push(view); else views[index] = view;
    write(timeline, views);
    return view;
}

export function openTimelineSavedView(timeline, name) {
    const view = listTimelineSavedViews(timeline).find(view => view.name === name);
    if (!view) throw new Error('That saved view is no longer available.');
    return applyTimelineViewState(timeline, view.state);
}

export function deleteTimelineSavedView(timeline, name) {
    const views = listTimelineSavedViews(timeline);
    write(timeline, views.filter(view => view.name !== name));
}
