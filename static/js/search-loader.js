/**
 * The search stack, fetched by the key that opens it.
 *
 * Search, the command palette and the finders are 394 KB — 17% of the
 * JavaScript this page used to parse before the first bookmark was clickable —
 * and none of it runs until someone presses `>`, `:`, `?` or `*`. It travels in
 * its own bundle, addressed by a data attribute on an inert <link> so nothing
 * requests it until it is genuinely wanted.
 *
 * The grid does not wait for it: every caller of `dashboard.searchComponent`
 * guards the call, so a dashboard whose search has not loaded yet renders and
 * navigates exactly as before — it simply has no overlay to open yet.
 *
 * Two things keep that first keypress from feeling like a download. The bundle
 * is prefetched once the page has gone quiet, and again on hover of any button
 * that opens it, so by the time a key is pressed it is usually already in the
 * cache. And when it is not, the keypress is remembered and replayed the moment
 * the code arrives, so nothing is swallowed.
 */
(function (global) {
    'use strict';

    let pending = null;
    let ready = false;

    /** The keys that open some part of the search stack. */
    const OPENING_KEYS = ['>', ':', '?', '*', '/'];

    function bundleHref() {
        const marker = document.querySelector('[data-nextdash-search-js]');
        return marker?.getAttribute('data-nextdash-search-js') || '';
    }

    /**
     * Fetch the bundle once. Resolves when the code has run — or immediately
     * when there is no marker, which is what NEXTDASH_BUNDLE=off looks like:
     * the individual scripts are already in the page.
     */
    function ensureSearch() {
        if (pending) return pending;
        const href = bundleHref();
        if (!href) {
            ready = true;
            pending = Promise.resolve();
            return pending;
        }
        pending = new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = href;
            // Resolved either way: a dashboard whose search failed to load is
            // still a working dashboard, and a promise that never settles would
            // wedge every key that waits on it.
            script.addEventListener('load', () => { ready = true; resolve(); }, { once: true });
            script.addEventListener('error', () => { ready = true; resolve(); }, { once: true });
            document.head.appendChild(script);
        });
        return pending;
    }

    /**
     * Build the search component the dashboard would have built at startup.
     * Idempotent: the dashboard may already have one if bundling is off.
     */
    function initialiseComponent() {
        const d = global.dashboardInstance;
        if (!d || d.searchComponent) return;
        d.initializeSearchComponent?.();
    }

    /**
     * A key arrived before the code did. Load, wire up, and open the overlay the
     * key asked for.
     *
     * Not by re-dispatching the KeyboardEvent: a synthetic keydown reaches the
     * overlay's own listeners but leaves the component's `searchActive` unset,
     * so the panel shows while `isActive()` still answers false and the next
     * Escape has nothing to close. Calling the same entry point the toolbar
     * buttons call keeps one open path for every route in.
     */
    function loadThenOpen(key) {
        void ensureSearch().then(() => {
            initialiseComponent();
            const search = global.dashboardInstance?.searchComponent;
            if (!search) return;
            if (key === ':' || key === '?') {
                search._openInMode?.(key);
            } else if (key === '*') {
                // Recent bookmarks has its own entry point; fall back to the
                // plain overlay if this build does not have it.
                (search.openRecentBookmarks || search.openSearchInterface)?.call(search);
            } else {
                search.openSearchInterface?.();
            }
            // The openers set the query and render, but `searchActive` is
            // showSearch()'s to set — every other caller pairs the two the same
            // way. Without it the panel is on screen while isActive() says it is
            // not, and Escape has nothing to close.
            if (!search.isActive?.()) search.showSearch?.();
        });
    }

    function isTypingTarget(target) {
        if (!target) return false;
        const tag = target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    }

    function onKeydown(event) {
        // `ready` alone, deliberately not `pending`: a prefetch that has started
        // but not finished still leaves the page with no handler for this key,
        // so bowing out on `pending` drops the press into the gap between the
        // request going out and the code arriving. Once `ready` is true the real
        // handlers are installed and this steps aside for good.
        if (ready) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (isTypingTarget(event.target)) return;
        if (!OPENING_KEYS.includes(event.key)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        loadThenOpen(event.key);
    }

    /**
     * Prefetch once the page has actually settled.
     *
     * `requestIdleCallback` on its own fires while the eager bundle is still in
     * flight — measured at 32 ms against a dashboard bundle that finished at
     * 46 ms — so the two compete for the connection and the point of moving
     * search out is lost on exactly the slow links it was moved out for. Wait
     * for `load`, which is after the grid has painted, and only then ask for an
     * idle moment.
     */
    function prefetchOnIdle() {
        const start = () => { void ensureSearch().then(initialiseComponent); };
        const whenIdle = () => {
            if (typeof global.requestIdleCallback === 'function') {
                global.requestIdleCallback(start, { timeout: 4000 });
            } else {
                global.setTimeout(start, 1000);
            }
        };
        if (document.readyState === 'complete') {
            whenIdle();
        } else {
            global.addEventListener('load', whenIdle, { once: true });
        }
    }

    function prefetchOnHover() {
        const ids = ['search-button', 'commands-button', 'finders-button', 'recent-bookmarks-button'];
        ids.forEach((id) => {
            const btn = document.getElementById(id);
            btn?.addEventListener('pointerenter', () => { void ensureSearch().then(initialiseComponent); },
                { once: true });
        });
    }

    // Capture phase, so this runs before the handlers that would have been in
    // the bundle — on the first press there are none, and afterwards this bows
    // out on the `ready` check above.
    document.addEventListener('keydown', onKeydown, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { prefetchOnHover(); prefetchOnIdle(); }, { once: true });
    } else {
        prefetchOnHover();
        prefetchOnIdle();
    }

    global.SearchLoader = { ensureSearch, isReady: () => ready };
}(typeof window !== 'undefined' ? window : globalThis));
