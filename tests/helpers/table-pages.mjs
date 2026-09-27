import assert from 'node:assert/strict';

/** Traverse the actual controls, retaining rows from each bounded DOM page. */
export function allTableRows(views) {
    const rows=[];
    let pages=0;
    while(true) {
        rows.push(...views.tablePanel.querySelectorAll('tbody tr'));
        const next=views.tablePanel.querySelector('[data-page="next"]');
        if(!next || next.disabled) return rows;
        assert.ok(++pages<10000,'Table pagination must terminate');
        next.click();
    }
}
