import {OB_TIMELINE} from '../src/openbexi_timeline.js';

// Run in tests/timeline_views.html, or import in a DOM-capable test runner.
export function runTimelineViewTests() {
    const results = [];
    const timelines = [];
    const check = (condition, label) => {
        if (!condition) throw new Error(label);
        results.push('PASS: ' + label);
    };
    const event = (title, extra = {}) => ({
        id: title,
        start: '2026-09-20T12:00:00Z',
        data: {title, status: 'STARTED'},
        ...extra
    });
    const createTimeline = (name, events) => {
        const timeline = new OB_TIMELINE();
        timeline.name = name;
        timeline.ob_scene = [{
            top: 0, left: 0, width: 1200, ob_height: 480,
            sessions: {events}, ob_camera: {zoom: 2}
        }];
        timeline.ob_set_body_menu(0);
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 480;
        timeline.ob_scene[0].ob_renderer = {
            domElement: canvas,
            setSize(width, height) {
                canvas.width = width;
                canvas.height = height;
            }
        };
        timeline.ob_set_renderer(0);
        timelines.push(timeline);
        return timeline;
    };

    try {
        const events = [
            event('<img src=x onerror="alert(1)">', {namespace: 'Source A'}),
            {namespace: 'Source B', activities: [
                event('Activity one', {end: '2026-09-20T12:30:00Z'}),
                event('Activity two', {render: {backgroundColor: '#f8df09'}})
            ]},
            {zone: true, data: {title: 'Background zone'}},
            {}, null
        ];
        const timeline = createTimeline('view_test_one', events);
        const views = timeline.ob_views;
        const frame = timeline.ob_timeline_body_frame;
        const canvas = timeline.ob_timeline_body.firstChild;
        const camera = timeline.ob_scene[0].ob_camera;
        const originalEvents = JSON.stringify(events);
        check(views.mode === 'timeline' && !frame.hidden && views.tablePanel.hidden,
            'Timeline is the default and the table is hidden');
        check([...views.buttons.values()].map(button => button.getAttribute('aria-label')).join(',') === 'Timeline,Table,Split',
            'The main toolbar contains all three view controls in screenshot order');
        check([...views.buttons.values()].every(button => button.textContent === '' && button.title &&
            button.querySelector('svg[aria-hidden="true"][focusable="false"] path')),
            'Icon-only buttons have tooltips and accessible labels without redundant SVG announcements');
        views.buttons.get('split').focus();
        check(document.activeElement === views.buttons.get('split') && views.buttons.get('split').type === 'button',
            'Icon controls remain keyboard focusable native buttons');
        check(timeline.ob_timeline_header.contains(timeline.ob_view) &&
            timeline.ob_timeline_header.contains(timeline.ob_settings) &&
            timeline.ob_timeline_header.contains(timeline.ob_search_input),
            'Existing overview, settings and search controls remain in the toolbar');

        let headerMouseEvents = 0;
        timeline.ob_timeline_header.addEventListener('mousedown', () => headerMouseEvents++);
        views.buttons.get('table').dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
        views.buttons.get('table').dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
        views.buttons.get('table').click();
        check(headerMouseEvents === 0 && timeline.moving === false && timeline.ob_timeline_panel.style.left === '0px',
            'View controls do not trigger toolbar dragging or move the timeline');
        check(frame.hidden && !views.tablePanel.hidden && views.tablePanel.style.height === '480px' &&
            views.tablePanel.style.left === '0px' && views.tablePanel.style.width === '100%',
            'Table mode replaces the timeline viewport and uses its full width and height');
        check(views.buttons.get('table').getAttribute('aria-pressed') === 'true' &&
            views.buttons.get('timeline').getAttribute('aria-pressed') === 'false',
            'The selected view is exposed accessibly');
        check(views.tablePanel.querySelectorAll('tbody tr').length === 3 &&
            views.tablePanel.querySelector('caption').textContent === '3 events',
            'Standalone events and grouped activities appear once; zones and placeholders are omitted');
        check(!views.tablePanel.querySelector('img') && views.tablePanel.textContent.includes('<img src=x'),
            'Event titles are rendered as safe text');
        const rows = views.tablePanel.querySelectorAll('tbody tr');
        check(rows[0].cells[2].textContent === '—' && rows[1].cells[3].textContent === 'Source B',
            'Instant events and inherited activity sources are supported');
        check(rows[2].classList.contains('ob_event_table_match'),
            'Search highlighting from the loaded response is retained');

        // Supply layout measurements for runners without a browser layout engine.
        let headerWidth = 1200;
        Object.defineProperty(timeline.ob_timeline_header, 'offsetWidth', {get: () => headerWidth});
        Object.defineProperty(views.controls, 'offsetLeft', {get: () => headerWidth - 271});
        Object.defineProperties(timeline.ob_search_input, {
            offsetLeft: {get: () => 214},
            offsetWidth: {get: () => Math.min(200, parseFloat(timeline.ob_search_input.style.maxWidth) || 200) + 10}
        });
        for (const width of [2000, 1350, 800, 640]) {
            headerWidth = width;
            views.layoutToolbar();
            const search = timeline.ob_search_input;
            const marker = timeline.ob_time_marker;
            const markerWidth = parseFloat(marker.style.width);
            check(search.offsetLeft + search.offsetWidth < views.controls.offsetLeft &&
                (markerWidth === 0 || parseFloat(marker.style.left) + markerWidth < views.controls.offsetLeft),
                'Search and time text leave room for the view controls at width ' + width);
        }

        views.buttons.get('split').click();
        check(!frame.hidden && !views.tablePanel.hidden && frame.style.width === '600px' && frame.style.height === '480px' &&
            views.tablePanel.style.left === '600px' && views.tablePanel.style.width === '600px' &&
            views.tablePanel.style.top === '40px' && views.tablePanel.style.height === '480px',
            'Vertical Split places the timeline left and table right at full height');
        check(Math.abs(frame.scrollLeft - (1200 - (frame.clientWidth || 600)) / 2) <= 1 &&
            parseFloat(timeline.ob_marker.style.left) === 600 - frame.scrollLeft - 8,
            'The split timeline opens centered on the current time with an aligned marker');
        frame.scrollLeft = 350;
        frame.dispatchEvent(new Event('scroll'));
        views.tablePanel.scrollLeft = 70;
        check(timeline.ob_marker.style.left === '242px' && frame.scrollLeft === 350,
            'The marker follows timeline scrolling while the table scrolls independently');
        views.buttons.get('timeline').click();
        check(frame.style.height === '' && frame.style.width === '100%' && frame.scrollLeft === 0 &&
            !frame.hidden && views.tablePanel.hidden && timeline.ob_marker.style.left === '592px',
            'Returning to Timeline restores the original viewport');
        check(timeline.ob_timeline_body.firstChild === canvas && canvas.width === 1200 && canvas.height === 480 &&
            timeline.ob_scene[0].ob_camera === camera && camera.zoom === 2 && JSON.stringify(events) === originalEvents,
            'Switching views preserves the canvas, camera, zoom and source data');
        views.buttons.get('split').click();
        check(frame.scrollLeft === 350, 'Returning to Split restores its previous scroll position');
        // Account for the narrower viewport when vertical scrollbars are present.
        Object.defineProperty(frame, 'clientWidth', {value: 580, configurable: true});
        frame.scrollLeft = 20;
        frame.dispatchEvent(new Event('scroll'));
        views.layoutTimeMarker();
        check(timeline.ob_marker.style.visibility === 'visible', 'The marker stays visible at the viewport edge');
        frame.scrollLeft = 0;
        frame.dispatchEvent(new Event('scroll'));
        check(timeline.ob_marker.style.visibility === 'hidden', 'The marker is hidden when its time is outside the viewport');
        delete frame.clientWidth;

        const second = createTimeline('view_test_two', [event('Second timeline')]);
        views.buttons.get('table').click();
        check(second.ob_views.mode === 'timeline' && second.ob_views.tablePanel.hidden,
            'Each timeline keeps its own view selection');
        // Exercise the same body-menu refresh hook used by scene rebuilds and data updates.
        timeline.ob_scene[0].sessions = {events: [event('Refreshed event')]};
        timeline.ob_timeline_body.replaceChildren();
        timeline.ob_set_body_menu(0);
        timeline.ob_set_renderer(0);
        check(views.mode === 'table' && frame.hidden && views.tablePanel.textContent.includes('Refreshed event') &&
            !views.tablePanel.textContent.includes('Activity one'),
            'Scene refreshes retain the selected view and replace stale table data');
        check(timeline.ob_timeline_header.querySelectorAll('.ob_view_modes').length === 1 &&
            timeline.ob_timeline_panel.querySelectorAll('.ob_event_table_panel').length === 1,
            'Scene refreshes do not duplicate controls or tables');
        timeline.ob_scene[0].ob_height = 601;
        timeline.ob_scene[0].width = 1201;
        views.buttons.get('split').click();
        timeline.ob_set_body_menu(0);
        timeline.ob_set_renderer(0);
        check(frame.style.width === '600px' && views.tablePanel.style.width === '601px' &&
            frame.style.height === '601px' && views.tablePanel.style.height === '601px',
            'Split follows resized timeline dimensions without losing a pixel at odd widths');
        check(Math.abs(frame.scrollLeft - (1201 - (frame.clientWidth || 600)) / 2) <= 1 &&
            canvas.parentElement === timeline.ob_timeline_body,
            'Renderer reattachment restores the centered split viewport after a resize');

        frame.scrollLeft = 400;
        frame.dispatchEvent(new Event('scroll'));
        timeline.ob_timeline_body.replaceChildren();
        timeline.ob_set_body_menu(0);
        timeline.ob_set_renderer(0);
        check(frame.scrollLeft === 400 && timeline.ob_timeline_body.firstChild === canvas,
            'Refreshing a split scene preserves its scroll position and reuses the canvas');

        views.buttons.get('timeline').click();
        timeline.ob_scene[0].sessions = {events: [event('Loaded while hidden')]};
        timeline.ob_set_body_menu(0);
        views.buttons.get('table').click();
        check(views.tablePanel.textContent.includes('Loaded while hidden'),
            'Opening the table after a hidden refresh shows the newest events');
        timeline.ob_scene[0].sessions = {events: [event('Optional fields', {
            render: {backgroundColor: false}, data: {title: 'Optional fields', status: null}
        })]};
        timeline.ob_set_body_menu(0);
        check(views.tablePanel.querySelector('tbody tr').cells[4].textContent === '—',
            'Missing status and disabled background colors do not break the table');
        for (const sessions of [undefined, {events: []}, {events: [{}]}, {events: {}}]) {
            timeline.ob_scene[0].sessions = sessions;
            timeline.ob_set_body_menu(0);
            check(views.tablePanel.textContent.includes('No events to display.'),
                'Empty or unavailable event data has a clear empty state');
        }
        views.setMode('unsupported');
        check(views.mode === 'table', 'Unknown view modes cannot corrupt the current layout');
        results.push(results.length + ' checks passed.');
        return results;
    } finally {
        for (const timeline of timelines) {
            timeline.ob_timeline_panel.remove();
            timeline.ob_timeline_right_panel.remove();
        }
    }
}
