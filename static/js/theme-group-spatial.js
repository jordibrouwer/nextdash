/*
 * Spatial theme group: the pointer moves the page's layers.
 *
 * The whole job is to turn the pointer position into two unitless numbers,
 * --sp-x and --sp-y (-1 to 1 from the centre of the viewport), on <html>. What
 * moves, how far and at which depth is CSS (theme-group-spatial.css).
 *
 * Cheap by construction: one passive pointermove listener that only stores the
 * coordinates, one rAF per frame that writes two custom properties on one
 * element, and no layout reads on the way (the viewport size is cached on
 * resize). Nothing here touches a transform; the CSS moves decorative
 * pseudo-elements and the fixed backdrop only, never an ancestor of page
 * content, so position:fixed menus, modals and the action bar keep their place.
 *
 * Still when it should be: no variable is ever written on touch / no-hover
 * devices, under prefers-reduced-motion, or with Effects off. Without the
 * variables the CSS falls back to 0 and the layers rest.
 *
 * Runs only while a spatial-* theme is active and follows html[data-theme],
 * like theme-holidays.js, so switching theme adds or removes it live.
 */
(function () {
    'use strict';

    const PREFIX = 'spatial-';
    const VARS = ['--sp-x', '--sp-y'];
    const root = document.documentElement;

    const mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const mqNoHover = window.matchMedia ? window.matchMedia('(hover: none)') : null;

    let running = false;
    let frame = 0;
    let px = 0;
    let py = 0;
    let lastX = NaN;
    let lastY = NaN;
    let vw = window.innerWidth || 1;
    let vh = window.innerHeight || 1;

    function isSpatial() {
        return String(root.getAttribute('data-theme') || '').startsWith(PREFIX);
    }

    function motionAllowed() {
        if (mqReduce && mqReduce.matches) return false;
        if (mqNoHover && mqNoHover.matches) return false;
        return root.getAttribute('data-effects') !== 'off';
    }

    function write() {
        frame = 0;
        const x = Math.max(-1, Math.min(1, (px / vw) * 2 - 1));
        const y = Math.max(-1, Math.min(1, (py / vh) * 2 - 1));
        // Three decimals is below what the eye can tell apart and keeps an
        // idle pointer from rewriting the same value every frame.
        const rx = Math.round(x * 1000) / 1000;
        const ry = Math.round(y * 1000) / 1000;
        if (rx === lastX && ry === lastY) return;
        lastX = rx;
        lastY = ry;
        root.style.setProperty('--sp-x', String(rx));
        root.style.setProperty('--sp-y', String(ry));
    }

    function schedule() {
        if (!frame) frame = requestAnimationFrame(write);
    }

    function onMove(e) {
        // A finger or a pen is not a hovering pointer; only a mouse-like one
        // drives the scene.
        if (e.pointerType === 'touch') return;
        px = e.clientX;
        py = e.clientY;
        schedule();
    }

    function onLeave(e) {
        // Left the window: settle back to the centre instead of freezing at
        // the edge.
        if (e.relatedTarget) return;
        px = vw / 2;
        py = vh / 2;
        schedule();
    }

    function onResize() {
        vw = window.innerWidth || 1;
        vh = window.innerHeight || 1;
    }

    function clear() {
        if (frame) {
            cancelAnimationFrame(frame);
            frame = 0;
        }
        VARS.forEach((v) => root.style.removeProperty(v));
        lastX = NaN;
        lastY = NaN;
    }

    function start() {
        if (running) return;
        running = true;
        onResize();
        px = vw / 2;
        py = vh / 2;
        document.addEventListener('pointermove', onMove, { passive: true });
        document.addEventListener('pointerout', onLeave, { passive: true });
        window.addEventListener('resize', onResize, { passive: true });
    }

    function stop() {
        if (!running) {
            clear();
            return;
        }
        running = false;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerout', onLeave);
        window.removeEventListener('resize', onResize);
        clear();
    }

    function apply() {
        if (isSpatial() && motionAllowed()) start();
        else stop();
    }

    function init() {
        apply();
        new MutationObserver(apply).observe(root, {
            attributes: true,
            attributeFilter: ['data-theme', 'data-effects'],
        });
        [mqReduce, mqNoHover].forEach((mq) => {
            if (!mq) return;
            if (mq.addEventListener) mq.addEventListener('change', apply);
            else if (mq.addListener) mq.addListener(apply);
        });
    }

    window.NDSpatial = { apply, isRunning: () => running };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
