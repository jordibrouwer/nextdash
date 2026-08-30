/**
 * Privacy-friendly usage analytics (Umami), opt-in.
 *
 * The server only emits this script's <script> tag when the user has opted in
 * (Settings.AnalyticsOptIn), so while it's off nothing here runs and no
 * third-party request is made at all.
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
    // The published release ("v2026.07.23.6"), read from the What's new index by
    // the server. A fixed, low-cardinality value — one per release — so the
    // settings snapshot can be read per version rather than as one blur across
    // everyone. Empty when the index could not be read.
    const releaseTag = (self && self.getAttribute('data-release')) || '';

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

    /**
     * Property names that carry "how many", and are therefore bucketed.
     *
     * The setting promises every number is rounded into a band, and the two
     * snapshots kept that promise while the action events did not: a bulk
     * recheck reported `count: 37` and a health export `rows: 1274`, which on a
     * small install is a fingerprint and on any install is more than the
     * question needs. Bucketing here rather than at each call site means a new
     * event cannot quietly reintroduce it.
     *
     * `index` and `step` are deliberately not in this list: a page position and
     * a walkthrough step are small, fixed ranges that answer nothing about size.
     */
    const COUNT_PROPS = ['count', 'rows', 'fields', 'items', 'size', 'total'];
    const COUNT_STEPS = [0, 1, 2, 5, 10, 25, 50, 100];

    /**
     * A count as the band it falls in: 0, 1, 2, 5, 10, 25, 50, 100, or `100+`.
     *
     * Small numbers keep their own band because "one row" and "five rows" are
     * different answers about how people work, and neither says anything about
     * the size of a collection.
     */
    function bucketCount(value) {
        return bucket(value, COUNT_STEPS);
    }

    /** Bucket the count-ish properties; leave enums and indices alone. */
    function sanitizeProps(props) {
        if (!props || typeof props !== 'object') return props;
        let out = null;
        for (const key of Object.keys(props)) {
            const value = props[key];
            if (!COUNT_PROPS.includes(key)) continue;
            if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) continue;
            out = out || { ...props };
            out[key] = bucketCount(value);
        }
        return out || props;
    }

    // Public helper. No-op (but always callable) when disabled.
    window.nextdashTrack = function (name, props) {
        if (!enabled || !name) return;
        const safe = sanitizeProps(props);
        if (umamiReady) {
            rawTrack(name, safe);
        } else {
            queue.push([name, safe]);
        }
    };

    // Exposed for the tests that pin the promise the setting makes.
    window.nextdashBucketCount = bucketCount;

    /**
     * Umami accepts at most 50 properties per event and silently drops the
     * rest, so a payload that outgrows this is a payload with holes nobody
     * would notice for months.
     */
    const MAX_EVENT_PROPS = 50;

    /** true only when the setting is on. */
    const flag = (key) => (s) => s[key] === true;
    /** true unless the setting is explicitly off — for the default-on ones. */
    const flagOn = (key) => (s) => s[key] !== false;
    /** A short enum value, or the named default when it is missing. */
    const pick = (key, fallback) => (s) => String(s[key] || fallback).slice(0, 40);
    /** A number as the first step it fits in, so no exact figure goes out. */
    const bucketOf = (key, steps) => (s) => bucket(s[key], steps);

    /**
     * A packaged theme id, or the constant `custom`.
     *
     * A packaged theme goes out by name — one of a fixed list, which is the
     * whole point of asking. A theme the user built has an id like
     * `theme-lz9k2p-x7fa`: random, unique to that install and stable across
     * every page load, which in a payload that promises no profiles is a device
     * id in all but name. It goes out as `custom`, which answers the only
     * question worth asking about it — how many people build one.
     *
     * ThemeUtils is loaded on the dashboard but this file also runs on pages
     * that do not carry it, so the prefix check is repeated rather than
     * depended upon; without it the safe answer is `custom`.
     */
    function themeBucket(theme) {
        const id = String(theme || 'default').trim();
        if (!id) return 'default';
        if (window.ThemeUtils?.isUserCustomThemeId) {
            return window.ThemeUtils.isUserCustomThemeId(id) ? 'custom' : id.slice(0, 40);
        }
        return id.startsWith('theme-') || id.startsWith('custom-') ? 'custom' : id.slice(0, 40);
    }

    function bucket(n, steps) {
        const value = Number(n);
        if (!Number.isFinite(value)) return 'unset';
        for (const step of steps) {
            if (value <= step) return String(step);
        }
        return `${steps[steps.length - 1]}+`;
    }

    /**
     * What the settings snapshot carries, one line per property.
     *
     * A table rather than an object literal because the rule this file lives by
     * — booleans and small enums only, numbers bucketed, never a hostname, path
     * or anything else free-form — is only checkable if every field states how
     * it is encoded. It also keeps the count visible against the 50 above.
     */
    const SETTINGS_FIELDS = [
        // Appearance and layout
        ['theme', (s) => themeBucket(s.theme)],
        ['autoDarkMode', flag('autoDarkMode')],
        ['layoutVersion', pick('layoutVersion', 'classic')],
        ['layoutPreset', pick('layoutPreset', 'default')],
        ['densityMode', pick('densityMode', 'compact')],
        ['categorySpacing', pick('categorySpacing', 'balanced')],
        ['sideMargin', pick('sideMargin', 'balanced')],
        ['fontPreset', pick('fontPreset', 'source-code-pro')],
        ['fontSize', pick('fontSize', 'm')],
        ['backgroundType', pick('backgroundType', 'none')],
        ['buttonBarPosition', pick('buttonBarPosition', 'bottom')],
        ['launcherIconSize', pick('launcherIconSize', 'normal')],
        // The grid
        ['columns', bucketOf('columnsPerRow', [1, 2, 3, 4, 6])],
        ['packedColumns', flag('packedColumns')],
        ['hideEmptyCategories', flag('hideEmptyCategories')],
        ['categoryItemLimit', bucketOf('categoryItemLimit', [0, 10, 15, 25, 50])],
        ['categorySpread', flag('defaultCategorySpread')],
        // What a bookmark row shows
        ['showStatus', flag('showStatus')],
        ['showPing', flag('showPing')],
        ['shortcutDisplay', pick('shortcutDisplay', 'always')],
        ['showIcons', flag('showIcons')],
        ['showRowTags', flag('showRowTags')],
        ['linkPreviewCards', flag('showLinkPreviewCards')],
        // Search
        ['fuzzySuggestions', flag('enableFuzzySuggestions')],
        ['interleaveMode', flag('interleaveMode')],
        ['findersInSearch', flag('includeFindersInSearch')],
        // Views and inbox
        ['inboxEnabled', flagOn('inboxEnabled')],
        ['inboxInPageTabs', flagOn('inboxShowInPageTabs')],
        ['pasteDestination', pick('pasteDestination', 'ask')],
        ['pasteQuickAdd', flag('pasteUrlQuickAdd')],
        ['healthView', flagOn('healthViewEnabled')],
        ['healthAutoRecheck', flag('healthAutoRecheckEnabled')],
        ['newBookmarkCheckMode', pick('newBookmarkCheckMode', 'off')],
        ['monitorInterval', bucketOf('defaultMonitorIntervalMin', [5, 15, 60, 360])],
        ['staleDays', bucketOf('bookmarkStaleDays', [30, 90, 180, 365])],
        // Smart collections
        ['smartRecent', flag('showSmartRecentCollection')],
        ['smartMostUsed', flag('showSmartMostUsedCollection')],
        // Config habits and the rest
        ['bookmarksSort', pick('configBookmarksSort', 'page')],
        ['sessionTips', flagOn('enableSessionTips')],
        ['serverLog', flag('serverLogEnabled')],
        ['weather', flag('showWeatherWithDate')],
        ['globalShortcuts', flag('globalShortcuts')],
        ['hyprMode', flag('hyprMode')],
        ['autoBackup', flag('autoBackupEnabled')],
        ['openInNewTab', flagOn('openInNewTab')],
    ];

    /**
     * Build a payload from a field table.
     *
     * `appVersion` is on every event: without it a default that changed between
     * releases reads as a gradual drift rather than the switch it was.
     *
     * Over the cap it truncates and says so, rather than letting Umami drop the
     * tail in silence — a short payload that admits it is short can be spotted;
     * one that lies cannot.
     */
    function buildPayload(fields, source) {
        const payload = { appVersion: releaseTag || 'unknown' };
        for (const [key, read] of fields) {
            if (Object.keys(payload).length >= MAX_EVENT_PROPS) {
                payload.truncated = true;
                break;
            }
            payload[key] = read(source);
        }
        return payload;
    }

    /**
     * One settings snapshot per page load, so adoption reads directly as
     * "X% of sessions have feature Y on" — a change-only event would miss
     * everyone who never touches a setting.
     */
    function trackSettingsSnapshot(settings) {
        if (!enabled || !settings || typeof settings !== 'object') return;
        if (trackSettingsSnapshot._sent) return; // once per page load
        trackSettingsSnapshot._sent = true;
        window.nextdashTrack('settings-snapshot', buildPayload(SETTINGS_FIELDS, settings));
    }

    /**
     * How much is in there, as its own event.
     *
     * Split from the settings rather than appended to them for two reasons:
     * the two together are past Umami's 50, and they answer different questions
     * — which features are switched on, against how big an install is. The
     * counts come from the server, which reads these files anyway; counting
     * client-side would only ever see the page that happens to be open.
     *
     * Every figure is bucketed. An exact 1274 is distinctive enough to follow
     * one install across releases; `500+` is not.
     */
    const CONTENT_FIELDS = [
        ['bookmarks', bucketOf('bookmarks', [0, 10, 50, 200, 500])],
        ['pages', bucketOf('pages', [1, 2, 5, 10])],
        ['categories', bucketOf('categories', [0, 5, 15, 40])],
        ['tags', bucketOf('tags', [0, 5, 20, 50])],
        ['finders', bucketOf('finders', [0, 3, 10])],
        ['collections', bucketOf('collections', [0, 1, 3])],
        ['monitored', bucketOf('monitored', [0, 3, 10, 30])],
        ['periodic', bucketOf('periodic', [0, 10, 50])],
        ['inboxOpen', bucketOf('inboxOpen', [0, 5, 20, 100])],
        ['inboxAdded', bucketOf('inboxAdded', [0, 10, 50, 200])],
        ['inboxPromoted', bucketOf('inboxPromoted', [0, 10, 50])],
        ['inboxDeleted', bucketOf('inboxDeleted', [0, 10, 50])],
    ];

    function trackContentSnapshot() {
        if (!enabled) return;
        if (trackContentSnapshot._sent) return;
        const raw = self && self.getAttribute('data-content');
        if (!raw) return;
        let counts;
        try {
            counts = JSON.parse(raw);
        } catch (_) {
            return;
        }
        if (!counts || typeof counts !== 'object') return;
        trackContentSnapshot._sent = true;
        window.nextdashTrack('content-snapshot', buildPayload(CONTENT_FIELDS, counts));
    }

    // Exposed so the dashboard/config can report once their settings are loaded.
    // Always defined (a no-op when off) so callers never feature-detect.
    window.nextdashTrackSettings = trackSettingsSnapshot;
    window.nextdashTrackContent = trackContentSnapshot;

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
