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
 */
(function (global) {
    'use strict';

    const DOCKS = ['bottom', 'left', 'right'];
    /** How close to the edge the pointer has to come, in pixels. */
    const EDGE = 6;
    /** How far past the ends of the bar the edge still counts. */
    const SLACK = 24;

    let timer = null;
    let hidden = false;
    let bound = false;
    let frame = 0;

    const settings = () => global.dashboardInstance?.settings || {};
    const place = () => document.body.getAttribute('data-action-bar') || 'header';
    const docked = () => DOCKS.includes(place());
    const enabled = () => settings().actionBarEnabled !== false;
    const seconds = () => Number(settings().actionBarAutoHideSeconds) || 0;
    const bar = () => document.querySelector('.dashboard-section.section-controls .header-shortcuts');
    // No hover on a touch screen, so nothing would ever bring the bar back.
    const touchOnly = () => global.matchMedia?.('(hover: none)').matches === true;

    function setHidden(value) {
        hidden = value;
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

    function onPointerMove(e) {
        if (!hidden || frame) return;
        const { clientX: x, clientY: y } = e;
        frame = requestAnimationFrame(() => {
            frame = 0;
            if (hidden && docked() && atEdge(x, y)) show();
        });
    }

    function bind() {
        if (bound) return;
        bound = true;
        document.addEventListener('pointermove', onPointerMove, { passive: true });
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
        // Arriving somewhere new is a moment the reader may want the actions.
        global.addEventListener('hashchange', () => {
            if (docked() && seconds()) show();
        });
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
