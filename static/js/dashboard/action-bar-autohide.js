/**
 * A docked action bar that slides into its edge and comes back.
 *
 * Docked on the left, the right or the bottom, the bar stands over the page
 * margin -- and at some widths over the config rail or the first column. With
 * a delay set it slides into the edge it is docked on once the reader leaves
 * it alone, and comes back when the pointer touches that edge beside it, when
 * focus moves into it, or on ' / Shift+O. In the header or behind the menu
 * nothing slides: the bar is part of the band there.
 *
 * State lives on <body> as data-action-bar-hidden, so the slide itself is CSS
 * and reduced motion is handled where every other animation is.
 *
 * While the bar is away a small handle stands on that edge, so the place it
 * comes back from is visible. It grows as the pointer comes near -- the
 * nearness is --edge-proximity, 0 to 1, on the handle -- and a click on it
 * brings the bar back for anyone who misses the edge itself.
 */
(function (global) {
    'use strict';

    const DOCKS = ['bottom', 'left', 'right'];
    /** How close to the edge the pointer has to come, in pixels. */
    const EDGE = 6;
    /** How far past the ends of the bar the edge still counts. */
    const SLACK = 24;
    /** From how far away the handle starts to grow, in pixels. */
    const NEAR = 340;

    let timer = null;
    let hidden = false;
    let bound = false;
    let frame = 0;
    let handle = null;

    const settings = () => global.dashboardInstance?.settings || {};
    const place = () => document.body.getAttribute('data-action-bar') || 'header';
    const docked = () => DOCKS.includes(place());
    const enabled = () => settings().actionBarEnabled !== false;
    const seconds = () => Number(settings().actionBarAutoHideSeconds) || 0;
    const bar = () => document.querySelector('.dashboard-section.section-controls .header-shortcuts');
    // No hover on a touch screen, so nothing would ever bring the bar back.
    const touchOnly = () => global.matchMedia?.('(hover: none)').matches === true;

    /** The handle on the edge; drawn only while the bar is away (CSS). */
    function edgeHandle() {
        if (handle) return handle;
        handle = document.createElement('div');
        handle.className = 'action-bar-edge-handle';
        // The keys and the edge already bring the bar back; this is a picture
        // of where, not a control of its own.
        handle.setAttribute('aria-hidden', 'true');
        handle.addEventListener('click', () => show());
        document.body.appendChild(handle);
        return handle;
    }

    function setHidden(value) {
        hidden = value;
        edgeHandle().style.setProperty('--edge-proximity', '0');
        document.body.toggleAttribute('data-action-bar-hidden', value);
        const el = bar();
        if (el) {
            // Out of view is out of the tab order and the accessibility tree.
            if (value) el.setAttribute('inert', '');
            else el.removeAttribute('inert');
        }
    }

    /** The reader is using the bar: over it, in it, or in a menu it opened. */
    function inUse() {
        const el = bar();
        if (!el) return false;
        return el.matches(':hover')
            || el.contains(document.activeElement)
            || Boolean(el.querySelector('[aria-expanded="true"]'));
    }

    function arm() {
        clearTimeout(timer);
        timer = null;
        const wait = seconds();
        if (!wait || !docked() || !enabled() || touchOnly()) return;
        timer = setTimeout(() => {
            timer = null;
            if (inUse()) {
                arm();
                return;
            }
            setHidden(true);
        }, wait * 1000);
    }

    function show() {
        if (hidden) setHidden(false);
        arm();
    }

    /** Is the pointer on the edge the bar is docked to, beside the bar? */
    function atEdge(x, y) {
        const el = bar();
        if (!el) return false;
        const r = el.getBoundingClientRect();
        // The page's own width, not the window's: a classic scrollbar stands
        // between the two, and the page hears no pointer over it -- so the
        // right edge measured from innerWidth could never be reached.
        const { clientWidth: width, clientHeight: height } = document.documentElement;
        switch (place()) {
            case 'left':
                return x <= EDGE && y >= r.top - SLACK && y <= r.bottom + SLACK;
            case 'right':
                return x >= width - EDGE && y >= r.top - SLACK && y <= r.bottom + SLACK;
            case 'bottom':
                return y >= height - EDGE && x >= r.left - SLACK && x <= r.right + SLACK;
            default:
                return false;
        }
    }

    /** How close the pointer is to the docked edge: 0 far away, 1 on it. */
    function nearness(x, y) {
        const { clientWidth: width, clientHeight: height } = document.documentElement;
        let distance;
        switch (place()) {
            case 'left': distance = x; break;
            case 'right': distance = width - x; break;
            case 'bottom': distance = height - y; break;
            default: return 0;
        }
        return Math.max(0, Math.min(1, 1 - distance / NEAR));
    }

    function onPointerMove(e) {
        if (!hidden || frame) return;
        const { clientX: x, clientY: y } = e;
        frame = requestAnimationFrame(() => {
            frame = 0;
            if (!hidden || !docked()) return;
            if (atEdge(x, y)) {
                show();
                return;
            }
            edgeHandle().style.setProperty('--edge-proximity', nearness(x, y).toFixed(3));
        });
    }

    function bind() {
        if (bound) return;
        bound = true;
        document.addEventListener('pointermove', onPointerMove, { passive: true });
        // Leaving the window is being far from every edge.
        document.documentElement.addEventListener('pointerleave', () => {
            if (handle) handle.style.setProperty('--edge-proximity', '0');
        });
        // Over the bar the wait stops; leaving it, or tabbing out, starts it again.
        document.addEventListener('pointerover', (e) => {
            if (!hidden && bar()?.contains(e.target)) {
                clearTimeout(timer);
                timer = null;
            }
        });
        document.addEventListener('pointerout', (e) => {
            const el = bar();
            if (el && el.contains(e.target) && !el.contains(e.relatedTarget)) arm();
        });
        document.addEventListener('focusin', (e) => {
            if (bar()?.contains(e.target)) show();
        });
        document.addEventListener('focusout', (e) => {
            const el = bar();
            if (el && el.contains(e.target) && !el.contains(e.relatedTarget)) arm();
        });
        // Not on hashchange. Switching page or view used to bring the bar back,
        // so a reader moving through pages had it slide in and out on every
        // step. A load, the edge, focus and ' / Shift+O are what call it.
    }

    /** Settings changed: start over from a visible bar. */
    function sync() {
        bind();
        setHidden(false);
        arm();
    }

    /**
     * ' and Shift+O. Answers whether the key did anything, so the caller only
     * swallows it when there was a docked bar to move.
     */
    function toggle() {
        if (!enabled() || !docked()) return false;
        if (hidden) {
            show();
        } else {
            clearTimeout(timer);
            timer = null;
            setHidden(true);
        }
        return true;
    }

    global.ActionBarAutoHide = {
        sync,
        toggle,
        show,
        isHidden: () => hidden,
    };
}(typeof window !== 'undefined' ? window : globalThis));
