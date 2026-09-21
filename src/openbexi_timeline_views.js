/** Timeline presentation controls. The WebGL scene stays intact when switching views. */
export class TimelineViews {
    constructor(timeline) {
        this.timeline = timeline;
        this.mode = "timeline";
        this.sceneIndex = 0;
        this.dirty = true;
        this.scrollPositions = {timeline: 0};
        this.onScroll = () => {
            if (this.mode !== "table") this.scrollPositions[this.mode] = this.frame.scrollLeft;
            this.layoutTimeMarker();
            this.renderOverviewViewport();
        };

        this.controls = document.createElement("div");
        this.controls.className = "ob_view_modes";
        this.controls.setAttribute("role", "group");
        this.controls.setAttribute("aria-label", "Timeline view");
        this.buttons = new Map();
        const iconPaths = {
            timeline: "M3 3v18h18 M6 4h8v3H6z M11 10h9v3h-9z M6 16h6v3H6z",
            table: "M3 4h18v16H3z M3 9h18 M3 14h18 M9 4v16",
            split: "M3 4h18v16H3z M12 4v16 M5.5 8h4 M7 12h3 M5.5 16h3 M14.5 8h4 M14.5 12h4 M14.5 16h4"
        };
        for (const [mode, label] of [["timeline", "Timeline"], ["table", "Table"], ["split", "Split"]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.setAttribute("aria-label", label);
            button.setAttribute("aria-pressed", String(mode === this.mode));
            button.title = mode === "split" ? "Vertical split: timeline and table side by side" : label + " view";
            const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            icon.setAttribute("viewBox", "0 0 24 24");
            icon.setAttribute("aria-hidden", "true");
            icon.setAttribute("focusable", "false");
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", iconPaths[mode]);
            icon.appendChild(path);
            button.appendChild(icon);
            button.addEventListener("click", () => this.setMode(mode));
            this.controls.appendChild(button);
            this.buttons.set(mode, button);
        }
        // The header is also a drag handle. Using a view button must not move the panel.
        for (const type of ["mousedown", "mousemove", "mouseup", "mouseout"]) {
            this.controls.addEventListener(type, event => {
                event.stopPropagation();
                timeline.moving = false;
            });
        }
        timeline.ob_timeline_header.appendChild(this.controls);

        this.tablePanel = document.createElement("div");
        this.tablePanel.id = timeline.name + "_event_table";
        this.tablePanel.className = "ob_event_table_panel";
        this.tablePanel.setAttribute("role", "region");
        this.tablePanel.setAttribute("aria-label", "Timeline event table");
        this.tablePanel.tabIndex = 0;
        this.tablePanel.hidden = true;
        timeline.ob_timeline_panel.appendChild(this.tablePanel);
    }

    setMode(mode) {
        if (!this.buttons.has(mode)) return;
        if (this.frame && this.mode !== "table") this.scrollPositions[this.mode] = this.frame.scrollLeft;
        this.mode = mode;
        this.applyLayout();
    }

    refresh(sceneIndex) {
        this.sceneIndex = sceneIndex;
        this.dirty = true;
        if (this.frame !== this.timeline.ob_timeline_body_frame) {
            if (this.frame) this.frame.removeEventListener("scroll", this.onScroll);
            this.frame = this.timeline.ob_timeline_body_frame;
            this.frame.addEventListener("scroll", this.onScroll, {passive: true});
        }
        this.applyLayout();
    }

    applyLayout() {
        const timeline = this.timeline;
        const frame = timeline.ob_timeline_body_frame;
        const scene = timeline.ob_scene[this.sceneIndex];
        if (!frame || !scene) return;

        timeline.ob_timeline_panel.dataset.viewMode = this.mode;
        for (const [mode, button] of this.buttons) {
            button.setAttribute("aria-pressed", String(mode === this.mode));
        }
        const height = scene.ob_height;
        const headerHeight = parseInt(timeline.ob_timeline_header.style.height, 10) || 40;
        const splitWidth = Math.floor(scene.width / 2);
        const split = this.mode === "split";
        frame.hidden = this.mode === "table";
        // A scrollable viewport preserves canvas dimensions, camera, zoom and drag coordinates.
        frame.style.width = split ? splitWidth + "px" : "100%";
        frame.style.height = split ? height + "px" : "";
        this.tablePanel.hidden = this.mode === "timeline";
        this.tablePanel.style.top = headerHeight + "px";
        this.tablePanel.style.left = split ? splitWidth + "px" : "0px";
        this.tablePanel.style.width = split ? (scene.width - splitWidth) + "px" : "100%";
        this.tablePanel.style.height = height + "px";
        if (split && (this.scrollPositions.split === undefined || this.splitSceneWidth !== scene.width)) {
            this.scrollPositions.split = (scene.width - (frame.clientWidth || splitWidth)) / 2;
            this.splitSceneWidth = scene.width;
        }
        if (this.mode !== "table") frame.scrollLeft = this.scrollPositions[this.mode];
        if (this.mode !== "timeline" && this.dirty) this.renderTable();
        this.layoutToolbar();
        this.renderOverviewViewport();
    }

    renderOverviewViewport() {
        const scene = this.timeline.ob_scene[this.sceneIndex];
        if (scene?.ob_camera && scene?.ob_renderer && scene.overviewViewports?.length) {
            this.timeline.ob_render(this.sceneIndex);
        }
    }

    layoutToolbar() {
        const timeline = this.timeline;
        const search = timeline.ob_search_input;
        const marker = timeline.ob_time_marker;
        if (!search || !marker) return;

        const controlsLeft = this.controls.offsetLeft;
        search.style.maxWidth = Math.max(40, controlsLeft - search.offsetLeft - 12) + "px";
        const left = Math.max(search.offsetLeft + search.offsetWidth + 12,
            timeline.ob_timeline_header.offsetWidth / 2 - 200);
        marker.style.left = left + "px";
        marker.style.width = Math.max(0, Math.min(500, controlsLeft - left - 12)) + "px";
        marker.title = marker.textContent;
        this.layoutTimeMarker();
    }

    layoutTimeMarker() {
        const timeline = this.timeline;
        const scene = timeline.ob_scene[this.sceneIndex];
        const marker = timeline.ob_marker;
        if (!this.frame || !marker || !scene) return;
        const width = this.frame.clientWidth || (this.mode === "split" ? Math.floor(scene.width / 2) : scene.width);
        const mainBand = scene.bands?.find(band => !band.name.includes('overview_'));
        const referenceOffset = mainBand?.timeScale ?
            timeline.dateToBandPixelOffSet(this.sceneIndex, mainBand, timeline.ob_scene.sync_time) : 0;
        const center = scene.width / 2 + referenceOffset - this.frame.scrollLeft;
        marker.style.left = (center - parseInt(marker.style.width, 10) / 2) + "px";
        marker.style.visibility = this.mode === "table" || center < 0 || center > width ? "hidden" : "visible";
    }

    renderTable() {
        const timeline = this.timeline;
        const scene = timeline.ob_scene[this.sceneIndex];
        const table = document.createElement("table");
        table.className = "ob_event_table";
        const caption = table.createCaption();
        const header = table.createTHead().insertRow();
        for (const label of ["Title", "Start", "End", "Source", "Status"]) {
            const cell = document.createElement("th");
            cell.scope = "col";
            cell.textContent = label;
            header.appendChild(cell);
        }
        const body = table.createTBody();
        const events = scene.sessions?.events;
        let count = 0;
        // Use the same loaded response as the canvas; server filtering and search apply to both.
        for (const session of Array.isArray(events) ? events : []) {
            if (!session || session.zone !== undefined) continue;
            const activities = Array.isArray(session.activities) ? session.activities : [session];
            for (const activity of activities) {
                if (!activity || activity.zone !== undefined || !activity.data) continue;
                const data = activity.data;
                const row = body.insertRow();
                if (String(activity.render?.backgroundColor).toUpperCase() === "#F8DF09") {
                    row.className = "ob_event_table_match";
                }
                const formatDate = value => value && timeline.formatEventDate ? timeline.formatEventDate(value) : value;
                const values = [data.title, formatDate(activity.start), formatDate(activity.end),
                    activity.namespace ?? data.namespace ?? session.namespace ?? session.data?.namespace,
                    data.status];
                for (const value of values) {
                    // Event data is text, never markup.
                    row.insertCell().textContent = value === undefined || value === null || value === "" ? "\u2014" : String(value);
                }
                count++;
            }
        }
        caption.textContent = count + (count === 1 ? " event" : " events");
        if (count === 0) {
            const empty = body.insertRow().insertCell();
            empty.colSpan = 5;
            empty.className = "ob_event_table_empty";
            empty.textContent = "No events to display.";
        }
        const scrollTop = this.tablePanel.scrollTop;
        const scrollLeft = this.tablePanel.scrollLeft;
        this.tablePanel.replaceChildren(table);
        this.tablePanel.scrollTop = scrollTop;
        this.tablePanel.scrollLeft = scrollLeft;
        this.dirty = false;
    }
}
