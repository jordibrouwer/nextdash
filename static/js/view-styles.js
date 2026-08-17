/**
 * The stylesheets the three views need, fetched when one is opened.
 *
 * Config, Health and Inbox own 268 KB of the 748 KB of CSS in this app, and
 * none of it paints anything on the bookmark grid. It travels in its own bundle,
 * addressed by a data attribute on an inert <link> so nothing requests it until
 * a view actually needs it — and then once, whichever view asks first.
 */
(function (global) {
    'use strict';

    let pending = null;

    function ensureViewStyles() {
        if (pending) return pending;
        const marker = document.querySelector('[data-nextdash-view-css]');
        const href = marker?.getAttribute('data-nextdash-view-css');
        if (!href) {
            // Bundling is off, so the individual sheets are already in the page.
            pending = Promise.resolve();
            return pending;
        }
        pending = new Promise((resolve) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            // Resolved either way: a view that renders unstyled is bad, a view
            // that never renders because a stylesheet 404'd is worse.
            link.addEventListener('load', () => resolve(), { once: true });
            link.addEventListener('error', () => resolve(), { once: true });
            document.head.appendChild(link);
        });
        return pending;
    }

    global.ViewStyles = { ensureViewStyles };
}(typeof window !== 'undefined' ? window : globalThis));
