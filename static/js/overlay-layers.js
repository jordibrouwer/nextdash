/**
 * Which layer is on top.
 *
 * theme-overlays.css draws every layer at a default level: a small one (popover, list, tooltip) at the
 * second, a big one (modal, palette, notes, tag cloud, quick add) at the third, with the accent bar along
 * its top edge. That is right for one layer. When a big layer lies on another big layer, the one underneath
 * drops back to the second level and loses its bar, and the one on top is the fourth: the deepest lift
 * and the darker scrim. CSS cannot see that, because the order is z-index with the document order as the
 * tie-break, and the z-index moves with classes (the bookmark form is raised above the app modal, the app
 * modal above the form, the notes modal above both), so this reads the computed z-index and marks:
 *
 *   data-ov-covered   on the panel of a big layer with another big layer above it
 *   data-ov-level="4" on the panel and the root of the topmost, when there is more than one
 *
 * It only reads and marks. Small layers never need it.
 */
(function (global) {
    'use strict';

    /** @type {{ root: string, panel: string | null, open: (root: Element) => boolean }[]} */
    const BIG_LAYERS = [
        { root: '#app-modal', panel: '.modal', open: (r) => r.classList.contains('show') },
        { root: '#bookmark-form-modal', panel: '.bookmark-form-modal-dialog', open: (r) => r.classList.contains('show') },
        { root: '.notes-modal-overlay', panel: '.notes-modal', open: () => true },
        { root: '#tag-cloud-modal', panel: null, open: (r) => r.classList.contains('is-open') && !r.hasAttribute('hidden') },
        { root: '#omnibox-overlay', panel: '.omnibox-box', open: () => true },
        { root: '#shortcut-search', panel: '.search-container', open: (r) => r.classList.contains('show') },
        { root: '.app-discovery-overlay', panel: '.app-discovery-card', open: (r) => r.classList.contains('show') },
    ];

    const ROOT_SELECTOR = BIG_LAYERS.map((layer) => layer.root).join(',');
    let scheduled = false;

    function zIndexOf(el) {
        const value = parseInt(global.getComputedStyle(el).zIndex, 10);
        return Number.isFinite(value) ? value : 0;
    }

    /** The open big layers, lowest first: z-index, then document order, as the browser paints them. */
    function openLayers() {
        const open = [];
        for (const layer of BIG_LAYERS) {
            document.querySelectorAll(layer.root).forEach((root) => {
                if (!layer.open(root)) return;
                const panel = layer.panel ? root.querySelector(layer.panel) : root;
                if (panel) open.push({ root, panel, z: zIndexOf(root) });
            });
        }
        open.sort((a, b) => {
            if (a.z !== b.z) return a.z - b.z;
            if (a.root === b.root) return 0;
            return a.root.compareDocumentPosition(b.root) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });
        return open;
    }

    function clear(el) {
        el.removeAttribute('data-ov-covered');
        el.removeAttribute('data-ov-level');
    }

    function sync() {
        scheduled = false;
        // Two frames on: the code that opened a popover has placed it by then.
        global.requestAnimationFrame(() => global.requestAnimationFrame(placeArrows));
        document.querySelectorAll('[data-ov-covered], [data-ov-level]').forEach(clear);
        const open = openLayers();
        open.forEach((layer, index) => {
            const top = index === open.length - 1;
            if (!top) {
                layer.panel.setAttribute('data-ov-covered', '');
            } else if (open.length > 1) {
                layer.panel.setAttribute('data-ov-level', '4');
                layer.root.setAttribute('data-ov-level', '4');
            }
        });
    }

    /** Batched to the next frame, so a layer that has just opened is painted at its level the first time. */
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        global.requestAnimationFrame(sync);
    }

    function relevant(mutations) {
        return mutations.some((mutation) => {
            if (mutation.type === 'attributes') {
                const target = /** @type {Element} */ (mutation.target);
                return target.matches?.(ROOT_SELECTOR) === true;
            }
            const touched = Array.from(mutation.addedNodes).concat(Array.from(mutation.removedNodes));
            return touched.some((node) => node.nodeType === Node.ELEMENT_NODE
                && (/** @type {Element} */ (node).matches(ROOT_SELECTOR) || /** @type {Element} */ (node).querySelector(ROOT_SELECTOR)
                    || /** @type {Element} */ (node).matches(ARROW_SELECTOR) || /** @type {Element} */ (node).querySelector(ARROW_SELECTOR)));
        });
    }

    function init() {
        if (typeof MutationObserver === 'undefined' || !document.body) return;
        new MutationObserver((mutations) => {
            if (relevant(mutations)) schedule();
        }).observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'hidden'],
        });
        schedule();
    }

    /*
     * The arrow of a popover: it points at what opened it. A popover is placed by the code that opens
     * it, wherever it fits, so the arrow is read afterwards from where the popover and its trigger
     * ended up, and left out when the popover sits beside the trigger or the trigger cannot be found.
     * The list popover scrolls, so its arrow would be clipped: it has none.
     */
    const ARROW_SELECTOR = '.date-popover, .page-tab-popover, .field-popover';

    function arrowAnchor(pop) {
        const open = Array.from(document.querySelectorAll('[aria-expanded="true"]')).filter((el) => !pop.contains(el));
        const pr = pop.getBoundingClientRect();
        const distance = (el) => {
            const r = el.getBoundingClientRect();
            return Math.hypot(r.left + r.width / 2 - (pr.left + pr.width / 2), r.top + r.height / 2 - (pr.top + pr.height / 2));
        };
        if (open.length) return open.sort((a, b) => distance(a) - distance(b))[0];
        const active = document.activeElement;
        return active && active !== document.body && !pop.contains(active) ? active : null;
    }

    function placeArrow(pop) {
        if (!pop.isConnected) return;
        const anchor = arrowAnchor(pop);
        const clear = () => {
            pop.removeAttribute('data-ov-arrow');
            pop.style.removeProperty('--ov-arrow-x');
        };
        if (!anchor) return clear();
        const pr = pop.getBoundingClientRect();
        const ar = anchor.getBoundingClientRect();
        if (!pr.width || !ar.width) return clear();
        let side = '';
        if (pr.top >= ar.bottom - 2) side = 'top';
        else if (pr.bottom <= ar.top + 2) side = 'bottom';
        if (!side) return clear();
        const x = Math.min(Math.max(ar.left + ar.width / 2 - pr.left, 16), pr.width - 16);
        pop.style.setProperty('--ov-arrow-x', Math.round(x) + 'px');
        pop.setAttribute('data-ov-arrow', side);
    }

    function placeArrows() {
        document.querySelectorAll(ARROW_SELECTOR).forEach(placeArrow);
    }

    global.OverlayLayers = { sync: schedule, syncNow: sync, openLayers, placeArrows };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})(window);
