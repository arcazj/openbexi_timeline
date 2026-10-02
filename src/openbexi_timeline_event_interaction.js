/** Event text is part of its marker, including when it extends past the shape. */
export function bindEventTextHitTarget(sprite, marker) {
    const raycast = sprite.raycast;
    sprite.raycast = function (raycaster, intersections) {
        // Three.js raycasting also visits invisible sprites. Selected/3D titles
        // use DOM buttons, so their hidden canvas text must not intercept hits.
        for (let object = this; object; object = object.parent) if (!object.visible) return;
        const start = intersections.length;
        raycast.call(this, raycaster, intersections);
        for (let index = start; index < intersections.length; index++) intersections[index].object = marker;
    };
}

const titleOf = record => String(record?.data?.title || record?.title || 'Untitled activity');

/** One caption per timeline, shared by canvas markers and accessible DOM titles. */
export class TimelineEventInteraction {
    constructor(timeline, index, controls) {
        this.timeline = timeline;
        this.controls = controls;
        this.canvas = timeline.ob_scene[index].ob_renderer.domElement;
        this.listeners = [];
        this.caption = document.createElement('div');
        this.caption.id = `${timeline.name}_event_caption`;
        this.caption.className = 'ob_event_caption';
        this.caption.setAttribute('role', 'tooltip');
        this.caption.hidden = true;
        document.body.append(this.caption);
        const listen = (target, type, listener, options) => {
            target.addEventListener(type, listener, options);
            this.listeners.push(() => target.removeEventListener(type, listener, options));
        };
        listen(this.canvas, 'pointermove', event => {
            this.pointer = {clientX: event.clientX, clientY: event.clientY};
            if (event.pointerType === 'touch' || event.buttons) this.hide();
            else if (!this.caption.hidden) this.position(this.pointer);
        }, true);
        listen(controls, 'hoveron', event => {
            this.hovered = event.object.data;
            this.dismissed = false;
            if (this.hovered) this.show(this.hovered, this.pointer, this.canvas);
            else this.hide();
        });
        listen(controls, 'hoveroff', () => { this.hovered = null; this.dismissed = false; this.hide(); });
        listen(controls, 'dragstart', () => this.hide());
        // DragControls retains its hovered object when the pointer leaves the
        // canvas. Returning to that same title/marker does not emit hoveron.
        listen(this.canvas, 'pointermove', event => {
            if (!event.buttons && event.pointerType !== 'touch' && this.hovered && !this.dismissed && this.caption.hidden)
                this.show(this.hovered, event, this.canvas);
        });
        for (const type of ['pointerleave', 'pointerdown', 'pointercancel']) listen(this.canvas, type, () => {
            this.dismissed = false; this.hide();
        });
        listen(document, 'keydown', event => { if (event.key === 'Escape') { this.dismissed = true; this.hide(); } });
        listen(window, 'scroll', () => this.hide(), true);
        listen(window, 'resize', () => this.hide());
    }

    show(record, pointer, target) {
        if (this.timeline.ob_results?.loading || this.timeline.ob_perspective?.adjusting) return;
        this.hide();
        this.caption.textContent = titleOf(record);
        this.caption.hidden = false;
        this.target = target;
        const descriptions = new Set((target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
        descriptions.add(this.caption.id);
        target.setAttribute('aria-describedby', [...descriptions].join(' '));
        const rect = target.getBoundingClientRect();
        this.position(pointer || {clientX: rect.left + rect.width / 2, clientY: rect.bottom});
    }

    position(pointer) {
        const margin = 8;
        const rect = this.caption.getBoundingClientRect();
        const left = Math.max(margin, Math.min(pointer.clientX + 14, window.innerWidth - rect.width - margin));
        let top = pointer.clientY + 18;
        if (top + rect.height > window.innerHeight - margin) top = pointer.clientY - rect.height - 12;
        this.caption.style.left = `${left}px`;
        this.caption.style.top = `${Math.max(margin, top)}px`;
    }

    hide() {
        this.caption.hidden = true;
        if (!this.target) return;
        const descriptions = (this.target.getAttribute('aria-describedby') || '').split(/\s+/)
            .filter(id => id && id !== this.caption.id);
        if (descriptions.length) this.target.setAttribute('aria-describedby', descriptions.join(' '));
        else this.target.removeAttribute('aria-describedby');
        this.target = null;
    }

    dispose() {
        this.hide();
        for (const remove of this.listeners) remove();
        this.listeners = [];
        this.caption.remove();
    }
}
