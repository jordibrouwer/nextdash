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

    /**
     * One settings snapshot per page load, so adoption reads directly as
     * "X% of sessions have feature Y on" — a change-only event would miss
     * everyone who never touches a setting.
     *
     * Booleans and small enums only; numbers are bucketed. Never a hostname,
     * path, title or any other free-form value.
     */
    function trackSettingsSnapshot(settings) {
        if (!enabled || !settings || typeof settings !== 'object') return;
        if (trackSettingsSnapshot._sent) return; // once per page load
        trackSettingsSnapshot._sent = true;
        const bool = (v) => v === true;
        const bucket = (n, steps) => {
            const value = Number(n);
            if (!Number.isFinite(value)) return 'unset';
            for (const step of steps) {
                if (value <= step) return String(step);
            }
            return `${steps[steps.length - 1]}+`;
        };
        window.nextdashTrack('settings-snapshot', {
            // Appearance / layout
            theme: String(settings.theme || 'default').slice(0, 40),
            autoDarkMode: bool(settings.autoDarkMode),
            layoutPreset: String(settings.layoutPreset || 'default').slice(0, 20),
            densityMode: String(settings.densityMode || 'compact').slice(0, 20),
            columns: bucket(settings.columnsPerRow, [1, 2, 3, 4, 6]),
            packedColumns: bool(settings.packedColumns),
            hideEmptyCategories: bool(settings.hideEmptyCategories),
            categoryItemLimit: bucket(settings.categoryItemLimit, [0, 10, 15, 25, 50]),
            // Features
            inboxEnabled: settings.inboxEnabled !== false,
            healthView: settings.healthViewEnabled !== false,
            healthAutoRecheck: bool(settings.healthAutoRecheckEnabled),
            showStatus: bool(settings.showStatus),
            linkPreviewCards: bool(settings.showLinkPreviewCards),
            smartRecent: bool(settings.showSmartRecentCollection),
            smartMostUsed: bool(settings.showSmartMostUsedCollection),
            weather: bool(settings.showWeatherWithDate),
            globalShortcuts: bool(settings.globalShortcuts),
            hyprMode: bool(settings.hyprMode),
            autoBackup: bool(settings.autoBackupEnabled),
            openInNewTab: settings.openInNewTab !== false,
        });
    }

    // Exposed so the dashboard/config can report once their settings are loaded.
    // Always defined (a no-op when off) so callers never feature-detect.
    window.nextdashTrackSettings = trackSettingsSnapshot;

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
