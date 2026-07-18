/**
 * Privacy-friendly usage analytics (Umami), opt-out.
 *
 * The server only emits this script's <script> tag when the user has analytics
 * enabled (Settings.EnableUsageAnalytics), so when it's turned off nothing here
 * runs and no third-party request is made at all.
 *
 * This file is NOT the Umami tracker itself. It reads config from its own
 * <script> tag's data-* attributes, injects the real Umami tracker from the
 * configured host, and exposes a single thin helper:
 *
 *     window.nextdashTrack(name, props)
 *
 * Rules for callers (kept deliberately low-cardinality / no PII):
 *   - `name` is a stable enum-like string (e.g. 'view:health', 'bookmark-open').
 *   - `props` may carry only stable enums/indices (page index, tab id, direction).
 *   - NEVER pass bookmark titles, URLs, search queries, or page names.
 *
 * nextdashTrack is always defined (a no-op when analytics is off or umami has
 * not loaded / was blocked), so call sites never need to feature-detect.
 */
(function () {
    'use strict';

    // Resolve our own <script> tag to read its data-* config. document.currentScript
    // works during initial parse; fall back to a query by src for defer/edge cases.
    const self =
        document.currentScript ||
        document.querySelector('script[data-nextdash-analytics]');

    const enabled = self && self.getAttribute('data-nextdash-analytics') === 'on';
    const websiteId = self && self.getAttribute('data-website-id');
    const scriptSrc = self && self.getAttribute('data-analytics-src');

    // Queue tracks fired before the umami tracker finishes loading; flushed on load.
    const queue = [];
    let umamiReady = false;

    function rawTrack(name, props) {
        try {
            if (window.umami && typeof window.umami.track === 'function') {
                if (props && typeof props === 'object') {
                    window.umami.track(name, props);
                } else {
                    window.umami.track(name);
                }
            }
        } catch (_) {
            // Analytics must never break the app.
        }
    }

    // Public helper. No-op (but always callable) when disabled.
    window.nextdashTrack = function (name, props) {
        if (!enabled || !name) return;
        if (umamiReady) {
            rawTrack(name, props);
        } else {
            queue.push([name, props]);
        }
    };

    if (!enabled || !websiteId || !scriptSrc) {
        return;
    }

    const tracker = document.createElement('script');
    tracker.defer = true;
    tracker.src = scriptSrc;
    tracker.setAttribute('data-website-id', websiteId);
    // Let Umami auto-track the initial pageview for real page loads (/, /config).
    // Same-URL view changes (health, inbox, page switches) are tracked manually.
    tracker.addEventListener('load', function () {
        umamiReady = true;
        while (queue.length) {
            const [name, props] = queue.shift();
            rawTrack(name, props);
        }
    });
    tracker.addEventListener('error', function () {
        // Blocked (ad-blocker / offline / CSP). Drop the queue silently.
        queue.length = 0;
    });
    document.head.appendChild(tracker);
})();
