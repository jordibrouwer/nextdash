/**
 * Column resize for list-view headings (Bookmarks, Tags, Inbox, Containers).
 *
 * A heading cell that carries data-cr-col gets a drag handle on its left
 * edge. Dragging it left widens that column; the one cell marked data-cr-flex
 * (the name) gives way, so the row never outgrows its box. Widths live per
 * view in localStorage (a width suits one screen, so it stays on the device).
 * Double-click on a handle, or Delete on it, puts the column back.
 *
 * A view registers once per render:
 *   ColumnResize.register('bm', { label, apply(widths) {...}, freeze: false });
 * and puts handles in its headings:
 *   cell.append(ColumnResize.handle('bm', 'tags'));   // or handleHtml()
 * apply() paints the widths (a CSS variable, a colgroup). One document-level
 * listener drives every handle, so a heading that is rebuilt needs no rebinding.
 */
(function (global) {
    'use strict';

    const PREFIX = 'nextdash.colwidths.';
    const MIN = 44;
    const MAX = 640;
    const FLEX_FLOOR = 96;
    const STEP = 16;

    const registry = Object.create(null);
    const cache = Object.create(null);

    function load(key) {
        if (cache[key]) return cache[key];
        let map = {};
        try {
            const parsed = JSON.parse(global.localStorage.getItem(PREFIX + key) || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                Object.keys(parsed).forEach((id) => {
                    const w = Number(parsed[id]);
                    if (Number.isFinite(w) && w >= MIN && w <= MAX) map[id] = Math.round(w);
                });
            }
        } catch (e) { map = {}; }
        cache[key] = map;
        return map;
    }

    function save(key) {
        const map = load(key);
        try {
            if (Object.keys(map).length) global.localStorage.setItem(PREFIX + key, JSON.stringify(map));
            else global.localStorage.removeItem(PREFIX + key);
        } catch (e) { /* private window or blocked storage: widths last until reload */ }
    }

    /** Base tracks with the saved widths swapped in; ids[i] names track i. */
    function template(key, base, ids) {
        const map = load(key);
        return base.map((track, i) => (ids[i] && map[ids[i]] ? `${map[ids[i]]}px` : track)).join(' ');
    }

    function register(key, options) {
        registry[key] = options || {};
    }

    function label(key) {
        return (registry[key] && registry[key].label) || 'Resize column';
    }

    function handle(key, id) {
        const el = document.createElement('span');
        el.className = 'cr-handle';
        el.setAttribute('role', 'separator');
        el.setAttribute('aria-orientation', 'vertical');
        el.setAttribute('aria-label', label(key));
        el.tabIndex = 0;
        el.dataset.crKey = key;
        el.dataset.crId = id;
        return el;
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
    }

    function handleHtml(key, id) {
        return `<span class="cr-handle" role="separator" aria-orientation="vertical" aria-label="${esc(label(key))}" tabindex="0" data-cr-key="${esc(key)}" data-cr-id="${esc(id)}"></span>`;
    }

    function paint(key) {
        const reg = registry[key];
        if (reg && typeof reg.apply === 'function') reg.apply(load(key));
    }

    function set(key, id, width) {
        const map = load(key);
        if (width === null) delete map[id];
        else map[id] = Math.round(Math.min(MAX, Math.max(MIN, width)));
        paint(key);
    }

    /** Every column of this heading takes the width it has now, so only the flex cell gives. */
    function freezeOthers(key, head) {
        const map = load(key);
        head.querySelectorAll('.cr-handle').forEach((h) => {
            const id = h.dataset.crId;
            const cell = h.parentElement;
            if (!map[id]) map[id] = Math.round(Math.min(MAX, Math.max(MIN, cell.getBoundingClientRect().width)));
        });
    }

    let drag = null;

    function headOf(h) {
        // A table heading is a th that is itself .lvs-colhead: the row is the whole heading.
        return h.closest('tr') || h.closest('.lvs-colhead, [role="row"]') || h.parentElement;
    }

    function onPointerDown(e) {
        const h = e.target.closest && e.target.closest('.cr-handle');
        if (!h || (e.button !== undefined && e.button !== 0)) return;
        const key = h.dataset.crKey;
        const id = h.dataset.crId;
        const cell = h.parentElement;
        const head = headOf(h);
        if (!key || !id || !cell) return;
        e.preventDefault();
        e.stopPropagation();
        const reg = registry[key] || {};
        const before = Object.assign({}, load(key));
        if (reg.freeze) freezeOthers(key, head);
        const startW = cell.getBoundingClientRect().width;
        const flex = head.querySelector('[data-cr-flex]');
        const room = flex ? Math.max(0, flex.getBoundingClientRect().width - FLEX_FLOOR) : MAX;
        drag = { before, key, id, h, startX: e.clientX, startW, max: Math.min(MAX, startW + room), raf: 0, next: startW, pointerId: e.pointerId };
        try { h.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no capture */ }
        h.classList.add('is-active');
        document.body.classList.add('cr-dragging');
    }

    function onPointerMove(e) {
        if (!drag || (drag.pointerId !== undefined && e.pointerId !== drag.pointerId)) return;
        // Dragging left widens: the column sits right of the flex cell.
        drag.next = Math.min(drag.max, Math.max(MIN, drag.startW + (drag.startX - e.clientX)));
        if (drag.raf) return;
        drag.raf = requestAnimationFrame(() => {
            if (!drag) return;
            drag.raf = 0;
            set(drag.key, drag.id, drag.next);
        });
    }

    function onPointerEnd() {
        if (!drag) return;
        const d = drag;
        drag = null;
        if (d.raf) cancelAnimationFrame(d.raf);
        if (Math.abs(d.next - d.startW) < 1) {
            // A click, not a drag: forget the widths freezing took.
            cache[d.key] = d.before;
            paint(d.key);
        } else {
            set(d.key, d.id, d.next);
            save(d.key);
        }
        d.h.classList.remove('is-active');
        document.body.classList.remove('cr-dragging');
    }

    function onKeyDown(e) {
        const h = e.target.closest && e.target.closest('.cr-handle');
        if (!h) return;
        const key = h.dataset.crKey;
        const id = h.dataset.crId;
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            set(key, id, null);
            save(key);
            return;
        }
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const cell = h.parentElement;
        const head = headOf(h);
        if (registry[key] && registry[key].freeze) freezeOthers(key, head);
        const current = load(key)[id] || cell.getBoundingClientRect().width;
        const flex = head.querySelector('[data-cr-flex]');
        const room = flex ? Math.max(0, flex.getBoundingClientRect().width - FLEX_FLOOR) : MAX;
        const grow = e.key === 'ArrowLeft' ? STEP : -STEP;
        set(key, id, Math.min(current + room, current + grow));
        save(key);
    }

    function onDoubleClick(e) {
        const h = e.target.closest && e.target.closest('.cr-handle');
        if (!h) return;
        e.preventDefault();
        set(h.dataset.crKey, h.dataset.crId, null);
        save(h.dataset.crKey);
    }

    // A handle sits inside a sortable heading; its click is never a sort.
    function onClick(e) {
        if (e.target.closest && e.target.closest('.cr-handle')) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerEnd);
    document.addEventListener('pointercancel', onPointerEnd);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('dblclick', onDoubleClick);
    document.addEventListener('click', onClick, true);

    global.ColumnResize = { register, handle, handleHtml, get: load, template, paint };
})(window);
