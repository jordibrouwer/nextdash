/**
 * One-time coach notes: a balloon with an arrow that points at a place on the
 * dashboard and says, once, what it is.
 *
 * A note is defined once (CoachNote.define) and asked for (CoachNote.schedule).
 * Only one is on screen at a time; the others wait in the order they were
 * scheduled and take their turn when the one in front is put away. A note
 * shows when
 *   - the start guide is done,
 *   - no What's New or other modal is open,
 *   - it is not the demo,
 *   - its own canShow() allows it, and
 *   - its anchor is drawn and on screen.
 * Until then it is tried again every 2 s, for up to 10 minutes.
 *
 * Once, ever: seen is kept server-side (a setting promo) and in this browser
 * (a localStorage key). "Got it", Escape, or CoachNote.dismiss() put it away
 * and write both. A note that never showed is never marked seen.
 *
 * Placement is fixed, from the anchor's rect: under it by default, to the left
 * of a column on the right edge, to the right of a column on the left, above a
 * dock at the bottom, and wherever there is room when the wanted side has
 * none. The arrow sits on the side that faces the anchor, on the anchor's
 * centre. The balloon is measured first, hidden, and only then shown and
 * grown: a scaled box measures wrong.
 *
 * A note about a whole group, not one thing in it, defines arrow: false: it
 * has no arrow, and the anchor gets an outline all around it instead.
 */
(function (global) {
    'use strict';

    const RETRY_MS = 2000;
    const GIVE_UP_MS = 10 * 60 * 1000;
    /** After one note goes, the next one waits a moment rather than appearing in its place. */
    const NEXT_MS = 800;
    /** Space between the anchor and the balloon, with the arrow in it. */
    const GAP = 14;
    /** The balloon stays this far inside the window. */
    const EDGE = 8;
    /** The arrow stays this far from the balloon's ends, clear of the rounded corners. */
    const ARROW_INSET = 18;

    const defs = new Map();
    /** Notes asked for and waiting, in the order they were asked. */
    let queue = [];
    /** The note on screen: { id, def, node, anchor }. */
    let active = null;
    let timer = null;
    let followTimer = null;
    let rafId = 0;

    function seen(def) {
        try { if (global.localStorage?.getItem(def.localKey) === '1') return true; } catch { /* private mode */ }
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(def.id) === true;
    }

    function markSeen(def) {
        try { global.localStorage?.setItem(def.localKey, '1'); } catch { /* private mode */ }
        global.DiscoverabilityState?.markSettingPromoSeen?.(def.id);
    }

    /** What holds every note back: the same things that hold back a toast. */
    function blocked() {
        const d = global.dashboardInstance;
        if (!d?.settings || d.settings.onboardingCompleted !== true) return true;
        if (global.DemoLock?.on) return true;
        if (document.querySelector('.whats-new-modal')?.offsetParent) return true;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return true;
        return false;
    }

    /** The anchor if it is drawn and on screen, else null. */
    function visibleAnchor(def) {
        let node = null;
        try { node = def.anchor(); } catch { node = null; }
        if (!node || !node.getClientRects().length) return null;
        const r = node.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return null;
        if (global.getComputedStyle(node).visibility === 'hidden') return null;
        return node;
    }

    function text(def, key, fallback) {
        try { return def[key]?.() || fallback; } catch { return fallback; }
    }

    function el(tag, className, content) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (content !== undefined) node.textContent = content;
        return node;
    }

    /** Which side of the anchor the balloon wants, before room is looked at. */
    function wantedSide(def, rect) {
        const asked = def.side?.();
        if (asked) return asked;
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        // A column stands tall and narrow: the balloon goes beside it, into the page.
        if (rect.height > rect.width * 1.5) return cx > vw / 2 ? 'left' : 'right';
        return cy > vh / 2 ? 'above' : 'below';
    }

    function place(entry) {
        const { node, def } = entry;
        const anchor = visibleAnchor(def);
        if (!anchor) return; // keep where it was until the anchor is back
        if (anchor !== entry.anchor) {
            entry.anchor?.classList.remove('coach-note-anchor-ring', 'coach-note-anchor-frame');
            anchor.classList.add('coach-note-anchor-ring');
            // Without an arrow the whole anchor is outlined instead.
            if (def.arrow === false) anchor.classList.add('coach-note-anchor-frame');
            entry.anchor = anchor;
        }
        const a = anchor.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        // offsetWidth/Height are not scaled by the grow animation.
        const w = node.offsetWidth;
        const h = node.offsetHeight;
        const fits = {
            below: a.bottom + GAP + h <= vh - EDGE,
            above: a.top - GAP - h >= EDGE,
            left: a.left - GAP - w >= EDGE,
            right: a.right + GAP + w <= vw - EDGE,
        };
        const opposite = { below: 'above', above: 'below', left: 'right', right: 'left' };
        const wanted = wantedSide(def, a);
        const side = [wanted, opposite[wanted], 'below', 'above', 'left', 'right'].find((s) => fits[s]) || wanted;

        const cx = a.left + a.width / 2;
        const cy = a.top + a.height / 2;
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        let left;
        let top;
        let arrow;
        if (side === 'below' || side === 'above') {
            left = clamp(cx - w / 2, EDGE, Math.max(EDGE, vw - EDGE - w));
            top = side === 'below' ? a.bottom + GAP : a.top - GAP - h;
            arrow = clamp(cx - left, ARROW_INSET, w - ARROW_INSET);
        } else {
            top = clamp(cy - h / 2, EDGE, Math.max(EDGE, vh - EDGE - h));
            left = side === 'right' ? a.right + GAP : a.left - GAP - w;
            arrow = clamp(cy - top, ARROW_INSET, h - ARROW_INSET);
        }
        node.dataset.side = side;
        node.style.left = `${Math.round(left)}px`;
        node.style.top = `${Math.round(top)}px`;
        node.style.setProperty('--coach-arrow', `${Math.round(arrow)}px`);
    }

    function schedulePlace() {
        if (rafId || !active) return;
        rafId = global.requestAnimationFrame(() => {
            rafId = 0;
            if (active) place(active);
        });
    }

    function show(entry) {
        const def = defs.get(entry.id);
        const node = el('div', 'coach-note');
        const titleId = `coach-note-title-${def.id}`;
        node.setAttribute('role', 'dialog');
        node.setAttribute('aria-labelledby', titleId);
        node.dataset.coachNote = def.id;
        if (def.arrow === false) node.dataset.arrow = 'none';
        const title = el('p', 'coach-note-title', text(def, 'title', ''));
        title.id = titleId;
        const body = el('p', 'coach-note-body', text(def, 'body', ''));
        let field = null;
        if (def.input) {
            // A note that asks for one short text: the field, then "Not now" and "Save".
            field = el('input', 'coach-note-input');
            field.type = 'text';
            field.maxLength = def.input.maxLength || 40;
            field.placeholder = text(def.input, 'placeholder', '');
            field.setAttribute('aria-label', text(def.input, 'label', text(def, 'title', '')));
            field.autocomplete = 'off';
            const row = el('div', 'coach-note-actions');
            const skip = el('button', 'coach-note-skip', text(def, 'skipLabel', 'Not now'));
            skip.type = 'button';
            skip.addEventListener('click', () => dismiss(def.id, 'skip'));
            const save = el('button', 'coach-note-ok', text(def, 'okLabel', 'Save'));
            save.type = 'button';
            const submit = () => {
                const value = field.value.trim();
                if (!value) { field.focus({ preventScroll: true }); return; }
                try { def.onSubmit?.(value); } catch { /* a note's own save never breaks it */ }
                dismiss(def.id, 'save');
            };
            save.addEventListener('click', submit);
            field.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') { event.preventDefault(); submit(); }
            });
            row.append(skip, save);
            node.append(title, body, field, row);
        } else {
            const ok = el('button', 'coach-note-ok', text(def, 'okLabel', 'Got it'));
            ok.type = 'button';
            ok.addEventListener('click', () => dismiss(def.id, 'ok'));
            if (typeof def.secondaryLabel === 'function') {
                // A note with a second way out ("Turn it off"): the two sit side by side.
                const second = el('button', 'coach-note-skip', text(def, 'secondaryLabel', ''));
                second.type = 'button';
                second.addEventListener('click', () => {
                    try { def.onSecondary?.(); } catch { /* a note's own action never breaks it */ }
                    dismiss(def.id, 'secondary');
                });
                const row = el('div', 'coach-note-actions');
                row.append(second, ok);
                node.append(title, body, row);
            } else {
                node.append(title, body, ok);
            }
        }
        document.body.appendChild(node);
        active = { id: def.id, def, node, anchor: null };
        // Measured while hidden, then shown and grown.
        place(active);
        node.classList.add('is-placed');
        if (field) field.focus({ preventScroll: true });
        try { def.onShown?.(); } catch { /* a note's analytics never break it */ }
        followTimer = setInterval(schedulePlace, 500);
    }

    function tick() {
        timer = null;
        if (active) return;
        const now = Date.now();
        queue = queue.filter((e) => {
            const def = defs.get(e.id);
            return def && !seen(def) && now - e.startedAt < GIVE_UP_MS;
        });
        if (!queue.length) return;
        if (!blocked()) {
            for (const entry of queue) {
                const def = defs.get(entry.id);
                if (def.canShow && !def.canShow()) continue;
                // A chance to bring the anchor into view (a bar slid away); it is looked for again next round.
                try { def.prepare?.(); } catch { /* a note's own setup never breaks the queue */ }
                if (!visibleAnchor(def)) continue;
                queue = queue.filter((e) => e !== entry);
                show(entry);
                return;
            }
        }
        timer = setTimeout(tick, RETRY_MS);
    }

    function arm(ms) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(tick, ms);
    }

    function define(def) {
        if (!def || !def.id || !def.localKey || typeof def.anchor !== 'function') return;
        defs.set(def.id, def);
    }

    function schedule(id) {
        const def = defs.get(id);
        if (!def || seen(def)) return;
        if (active?.id === id || queue.some((e) => e.id === id)) return;
        queue.push({ id, startedAt: Date.now() });
        if (!active && !timer) arm(RETRY_MS);
    }

    function dismiss(id, via) {
        if (!active || active.id !== id) return;
        const { def, node, anchor } = active;
        active = null;
        clearInterval(followTimer);
        followTimer = null;
        markSeen(def);
        try { def.onDone?.(via); } catch { /* a note's analytics never break it */ }
        node.remove();
        anchor?.classList.remove('coach-note-anchor-ring', 'coach-note-anchor-frame');
        if (queue.length) arm(NEXT_MS);
    }

    function current() {
        return active ? active.id : null;
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && active) dismiss(active.id, 'escape');
    });
    global.addEventListener('resize', schedulePlace);
    global.addEventListener('scroll', schedulePlace, true);

    global.CoachNote = { define, schedule, dismiss, current };
})(window);
