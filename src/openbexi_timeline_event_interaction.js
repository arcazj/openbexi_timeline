/** Text and record decorations resolve to the same draggable marker. */
export function bindRecordHitTarget(object, marker) {
    const raycast = object.raycast;
    object.raycast = function (raycaster, intersections) {
        // Three.js raycasting also visits invisible sprites. Selected/3D titles
        // use DOM buttons, so their hidden canvas text must not intercept hits.
        for (let object = this; object; object = object.parent) if (!object.visible) return;
        const start = intersections.length;
        raycast.call(this, raycaster, intersections);
        for (let index = start; index < intersections.length; index++) intersections[index].object = marker;
    };
}

const titleOf = record => String(record?.data?.title || record?.title || 'Untitled activity');
export const POINTER_CLICK_SLOP = 5;

// Use screen pixels: world-space distances change with zoom and perspective.
class ActivityPointerGesture {
    constructor(event) {
        this.pointerId = event.pointerId;
        this.x = event.clientX; this.y = event.clientY;
        this.primary = event.button === 0 && event.isPrimary !== false;
        this.moved = false;
    }

    update(event) {
        if (event.pointerId !== this.pointerId) return;
        // Releasing capture can emit leave/lost-capture before the browser's
        // click, especially when a responsive rebuild moved the title. The
        // completed pointerup still belongs to the original button.
        if (this.ended === 'pointerup' && (event.type === 'pointerleave' || event.type === 'lostpointercapture')) return;
        if (Math.hypot(event.clientX - this.x, event.clientY - this.y) > POINTER_CLICK_SLOP) this.moved = true;
        if (event.type === 'pointerleave' || event.type === 'pointercancel' || event.type === 'lostpointercapture') this.cancelled = true;
        if (event.type !== 'pointermove') this.ended = event.type;
    }

    get clicked() { return this.primary && !this.moved && !this.cancelled && this.ended === 'pointerup'; }
}

/** DOM titles use the same click tolerance as their canvas markers. */
export function bindActivityTitle(label, open) {
    let gesture;
    label.addEventListener('pointerdown', event => {
        gesture = new ActivityPointerGesture(event);
        // A queued layout or camera resize must not move the native pointerup
        // onto the canvas and lose the user's first click on this title.
        if (gesture.primary) try { label.setPointerCapture?.(event.pointerId); } catch { /* Synthetic/older pointer implementations. */ }
        event.stopPropagation();
    });
    label.addEventListener('mousedown', event => event.stopPropagation());
    for (const type of ['pointermove', 'pointerup', 'pointerleave', 'pointercancel', 'lostpointercapture'])
        label.addEventListener(type, event => {
            gesture?.update(event);
            if (type === 'pointerup' || type === 'pointercancel') {
                try { label.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already have been released. */ }
            }
        });
    label.addEventListener('click', event => {
        // Keyboard and assistive-technology activation has no pointer gesture.
        if (event.detail === 0 || gesture?.clicked) open();
        gesture = null;
    });
}

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
        listen(this.canvas, 'pointerdown', event => {
            this.gesture = new ActivityPointerGesture(event);
        }, true);
        for (const type of ['pointermove', 'pointerup', 'pointerleave', 'pointercancel'])
            listen(this.canvas, type, event => this.gesture?.update(event), true);
        // Three.js binds this release handler to pointerup/leave, but omits cancel.
        listen(this.canvas, 'pointercancel', controls._onPointerCancel);
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
