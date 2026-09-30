export const SEARCH_MODES = ['text', 'pattern', 'legacy'];

export function validateSearchMode(metadata, mode, query) {
    if (mode && query.trim() && (metadata.searchMode || 'legacy') !== mode)
        throw new Error('This server did not confirm the search mode. Select Legacy search or update the server.');
}

// Search metadata, including nested field names, but never transport identity,
// styling, timestamps, or the contents of a different activity.
export function searchableFields(record) {
    const fields = [];
    const visit = value => {
        if (value && typeof value === 'object') {
            for (const [key, child] of Object.entries(value)) {
                if (key === 'sourceRecordKey') continue;
                if (!Array.isArray(value)) fields.push(key);
                visit(child);
            }
        } else if (value !== undefined && value !== null) fields.push(String(value));
    };
    visit(record.data || {});
    return fields;
}

export function compileSearch(search = '', mode = 'text') {
    if (!SEARCH_MODES.includes(mode)) throw new Error('Choose Text, Pattern, or Legacy search.');
    const query = String(search).trim();
    if (query.length > 500) throw new Error('Search is limited to 500 characters.');
    const hasCondition = Boolean(query) && !(mode === 'legacy' && query === '*');
    let pattern;
    if (hasCondition && mode !== 'text') {
        try { pattern = new RegExp(mode === 'legacy' ? query.replaceAll(';', '|').replaceAll(' ', '|') : query, mode === 'pattern' ? 'i' : ''); }
        catch { throw new Error('Invalid search pattern. Check brackets and parentheses, or use Text.'); }
    }
    return {query: mode === 'text' ? query.toLowerCase() : query, hasCondition, matches: record => {
        if (!hasCondition || record.zone) return false;
        if (mode === 'legacy') {
            const {activities, searchMatch, sourceRecordKey, ...own} = record;
            return pattern.test(JSON.stringify(own).replaceAll(' ', '').replaceAll('"', ''));
        }
        return searchableFields(record).some(value => mode === 'text' ? value.toLowerCase().includes(query.toLowerCase()) : pattern.test(value));
    }};
}
