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
    // The public demo counts into a website of its own (the server writes
    // data-mode="demo" only there, with the demo's id). Every event then says
    // so, which is a second line of defence: if one ever landed in the wrong
    // website it could be filtered out by this property.
    const isDemo = !!self && self.getAttribute('data-mode') === 'demo';

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

    /**
     * The demo's session depth, counted from the events that pass through
     * nextdashTrack: a view change is `view:*` or `page-switch`, anything else
     * that is not the demo's own bookkeeping or a notice appearing by itself
     * is an action. Only ever sent as a band (see sendSessionDepth).
     */
    const depth = { views: 0, actions: 0 };
    function countDepth(name) {
        if (!isDemo || name.startsWith('demo:')) return;
        if (name.startsWith('view:') || name === 'page-switch') depth.views += 1;
        else if (!name.endsWith(':shown')) depth.actions += 1;
    }

    /**
     * A guard against a loop: one production day had 2,575 pageviews from 21
     * sessions. An identical event (same name, same props) inside 500 ms is a
     * double fire and is dropped; past 100 events in a rolling minute the rest
     * are dropped silently. The four snapshots go out once per load and are
     * never counted against the cap. Pure on purpose: the clock is passed in,
     * so a test can walk through time without waiting for it.
     */
    const RATE_DEDUPE_MS = 500;
    const RATE_WINDOW_MS = 60000;
    const RATE_MAX_EVENTS = 100;
    const RATE_EXEMPT = ['settings-snapshot', 'content-snapshot', 'widgets-snapshot', 'containers-snapshot', 'views-snapshot'];

    function createRateLimiter() {
        let last = { key: '', at: -Infinity };
        let sent = [];
        return function allow(name, props, now) {
            let key;
            try {
                key = `${name}\u0000${JSON.stringify(props === undefined ? null : props)}`;
            } catch (_) {
                key = String(name);
            }
            if (key === last.key && now - last.at < RATE_DEDUPE_MS) return false;
            last = { key, at: now };
            if (RATE_EXEMPT.includes(name)) return true;
            sent = sent.filter((t) => now - t < RATE_WINDOW_MS);
            if (sent.length >= RATE_MAX_EVENTS) return false;
            sent.push(now);
            return true;
        };
    }
    const allowEvent = createRateLimiter();

    // Public helper. No-op (but always callable) when disabled.
    window.nextdashTrack = function (name, props) {
        if (!enabled || !name) return;
        try {
            if (!allowEvent(String(name), props, Date.now())) return;
        } catch (_) {
            // The guard failing must not stop the event or break the app.
        }
        countDepth(String(name));
        let safe = sanitizeProps(props);
        if (isDemo) safe = { ...(safe && typeof safe === 'object' ? safe : {}), mode: 'demo' };
        if (umamiReady) {
            rawTrack(name, safe);
        } else {
            queue.push([name, safe]);
        }
    };

    // Exposed for the tests that pin the promise the setting makes.
    window.nextdashBucketCount = bucketCount;
    window.nextdashRateLimit = createRateLimiter;

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
        ['layoutPreset', pick('layoutPreset', 'default')],
        ['densityMode', pick('densityMode', 'compact')],
        ['categorySpacing', pick('categorySpacing', 'balanced')],
        ['sideMargin', pick('sideMargin', 'balanced')],
        ['fontPreset', pick('fontPreset', 'source-code-pro')],
        ['fontSize', pick('fontSize', 'm')],
        ['backgroundType', pick('backgroundType', 'none')],
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
        ['showIcons', flag('showIcons')],
        ['showRowTags', flag('showRowTags')],
        ['linkPreviewCards', flag('showLinkPreviewCards')],
        // Search
        ['interleaveMode', flag('interleaveMode')],
        ['findersInSearch', flag('includeFindersInSearch')],
        // Views and inbox
        ['healthAutoRecheck', flag('healthAutoRecheckEnabled')],
        ['newBookmarkCheckMode', pick('newBookmarkCheckMode', 'periodic')],
        ['staleDays', bucketOf('bookmarkStaleDays', [30, 90, 180, 365])],
        // Smart collections
        ['smartRecent', flag('showSmartRecentCollection')],
        ['smartMostUsed', flag('showSmartMostUsedCollection')],
        // Config habits and the rest
        ['language', pick('language', 'en')],
        ['sessionTips', flagOn('enableSessionTips')],
        ['serverLog', flag('serverLogEnabled')],
        ['weather', flag('showWeatherWithDate')],
        ['hyprMode', flag('hyprMode')],
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
     * What this browser remembers between page loads, only ever written while
     * analytics is on: when each snapshot last went out and what it said, the
     * release it last ran, and when it first saw the app. Storage can be absent
     * or refuse writes (private windows, blocked site data), and then the
     * snapshots simply go out every load, as they did before.
     */
    const STATE_KEY = 'nextdash.analytics';
    function readState() {
        try {
            const state = JSON.parse(window.localStorage.getItem(STATE_KEY) || 'null');
            return state && typeof state === 'object' ? state : {};
        } catch (_) {
            return {};
        }
    }
    function writeState(state) {
        try {
            window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
        } catch (_) {
            // Not remembered; the next load decides again.
        }
    }

    /** A short, non-reversible fingerprint of a payload, to tell "same as last time". */
    function hashPayload(payload) {
        const text = JSON.stringify(payload);
        let hash = 5381;
        for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
        return (hash >>> 0).toString(36);
    }

    /**
     * A snapshot goes out when it says something new: first time, a changed
     * payload (the release is part of it, so every update sends a full set), a
     * new calendar month (Umami's visitor id rotates monthly, and a visitor
     * without a snapshot would vanish from the adoption figures), or a week
     * since the last one.
     *
     * A snapshot per page load was 55% of every event and 700,000 stored
     * properties in a hundred days, for numbers that moved a few times.
     */
    const SNAPSHOT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
    const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7);
    function snapshotDue(previous, payload, now) {
        if (!Array.isArray(previous) || previous.length < 2) return true;
        if (previous[0] !== hashPayload(payload)) return true;
        if (monthOf(previous[1]) !== monthOf(now)) return true;
        return now - previous[1] >= SNAPSHOT_REFRESH_MS;
    }
    window.nextdashSnapshotDue = snapshotDue;

    /**
     * Remembered only once the tracker has loaded: a snapshot that was queued
     * for a tracker that then failed to load (offline, blocked) was never sent,
     * and must not count as sent for the next week.
     */
    const afterTrackerLoad = [];
    function sendSnapshot(name, payload) {
        const now = Date.now();
        const state = readState();
        state.snap = state.snap && typeof state.snap === 'object' ? state.snap : {};
        if (!snapshotDue(state.snap[name], payload, now)) return;
        const remember = () => {
            const latest = readState();
            latest.snap = latest.snap && typeof latest.snap === 'object' ? latest.snap : {};
            latest.snap[name] = [hashPayload(payload), now];
            writeState(latest);
        };
        window.nextdashTrack(name, payload);
        if (umamiReady) remember();
        else afterTrackerLoad.push(remember);
    }

    /**
     * One settings snapshot per page load at most (and see snapshotDue for how
     * rarely it is actually sent), so adoption reads as "X% of visitors have
     * feature Y on": the weekly repeat keeps those who never touch a setting
     * in the picture.
     */
    function trackSettingsSnapshot(settings) {
        // The demo's settings are the seed's, which says nothing about anyone.
        if (!enabled || isDemo || !settings || typeof settings !== 'object') return;
        if (trackSettingsSnapshot._sent) return; // once per page load
        trackSettingsSnapshot._sent = true;
        const payload = buildPayload(SETTINGS_FIELDS, settings);
        // Who and how: a code for this install, how the server runs, and how
        // it is reached. Each a fixed word or short code, set by the server.
        const installRef = self.getAttribute('data-install');
        if (/^[0-9a-f]{16}$/.test(installRef || '')) payload.installId = installRef;
        const distribution = self.getAttribute('data-distribution');
        if (/^[a-z]{1,10}$/.test(distribution || '')) payload.distribution = distribution;
        payload.exposure = hostExposure(window.location.hostname);
        sendSnapshot('settings-snapshot', payload);
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
        if (!enabled || isDemo) return;
        trackFeatureSnapshots();
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
        sendSnapshot('content-snapshot', buildPayload(CONTENT_FIELDS, counts));
    }

    /**
     * The three feature snapshots: widgets, containers and the list views.
     *
     * Raw values from the server (analytics_snapshots.go, on the script tag as
     * data-snapshots), encoded here by the same rule as everything above. The
     * server sends counts, yes/no and the settings' own enums; it never sends a
     * name, so the only strings that reach these tables are short fixed words.
     */
    /** A count as a bucket, with -1 ("never", "all") kept apart. */
    const bucketOrWord = (key, steps, word) => (s) => (Number(s[key]) < 0 ? word : bucket(s[key], steps));

    /** One bucket per widget type, from the server's closed register. */
    function widgetFields(raw) {
        const fields = [
            ['total', bucketOf('total', [0, 1, 3, 6, 12])],
            ['pages', bucketOf('pages', [0, 1, 2, 5])],
        ];
        const byType = raw && typeof raw.byType === 'object' ? raw.byType : {};
        Object.keys(byType).sort().forEach((type) => {
            if (!/^[a-z]{1,20}$/.test(type)) return;
            // A type nobody has stays out: absent reads as none, and the
            // register is long enough that the zeros were most of the event.
            if (!(Number(byType[type]) > 0)) return;
            fields.push([type, () => bucket(byType[type], [0, 1, 2, 5])]);
        });
        return fields;
    }

    const CONTAINER_FIELDS = [
        ['socketSet', flag('socketSet')],
        ['control', flag('control')],
        ['writeToken', flag('writeToken')],
        ['runAsRoot', flag('runAsRoot')],
        ['updateInterval', pick('updateInterval', 'off')],
        ['refreshSeconds', pick('refreshSeconds', '5')],
        ['logLines', pick('logLines', '200')],
        ['confirmStopRestart', flag('confirmStopRestart')],
        ['hidden', bucketOf('hidden', [0, 1, 5, 20])],
        ['customWebUIs', bucketOf('customWebUIs', [0, 1, 5, 20])],
        ['hostAddressSet', flag('hostAddressSet')],
        ['githubToken', flag('githubToken')],
        ['imagesChecked', bucketOf('imagesChecked', [0, 5, 15, 40])],
        ['updatesWaiting', bucketOf('updatesWaiting', [0, 1, 3, 10])],
    ];

    const VIEW_FIELDS = [
        // Health
        ['healthChecked', bucketOf('healthChecked', [0, 10, 50, 200, 500])],
        ['healthDown', bucketOf('healthDown', [0, 1, 3, 10])],
        ['certsDue', bucketOf('certsDue', [0, 1, 3])],
        ['certsExpired', bucketOf('certsExpired', [0, 1, 3])],
        ['lastCheckHours', bucketOrWord('lastCheckHours', [1, 6, 24, 168], 'never')],
        // Inbox
        ['inboxUnread', bucketOf('inboxUnread', [0, 5, 20, 100])],
        ['inboxNoted', bucketOf('inboxNoted', [0, 1, 5, 20])],
        ['inboxKept', bucketOf('inboxKept', [0, 10, 50])],
        ['inboxFromExtension', flag('inboxFrom_extension')],
        ['inboxFromPaste', flag('inboxFrom_paste')],
        // The Bookmarks view
        ['bmColumns', bucketOrWord('bmColumns', [0, 2, 4, 6, 9], 'all')],
    ];

    function trackFeatureSnapshots() {
        if (!enabled || isDemo) return;
        if (trackFeatureSnapshots._sent) return;
        const raw = self && self.getAttribute('data-snapshots');
        if (!raw) return;
        let snaps;
        try {
            snaps = JSON.parse(raw);
        } catch (_) {
            return;
        }
        if (!snaps || typeof snaps !== 'object') return;
        trackFeatureSnapshots._sent = true;
        if (snaps.widgets) sendSnapshot('widgets-snapshot', buildPayload(widgetFields(snaps.widgets), snaps.widgets));
        if (snaps.containers) sendSnapshot('containers-snapshot', buildPayload(CONTAINER_FIELDS, snaps.containers));
        if (snaps.views) sendSnapshot('views-snapshot', buildPayload(VIEW_FIELDS, snaps.views));
    }

    // Exposed so the dashboard/config can report once their settings are loaded.
    // Always defined (a no-op when off) so callers never feature-detect. The
    // feature snapshots go out with the content (trackContentSnapshot): both
    // are the server's counts.
    window.nextdashTrackSettings = trackSettingsSnapshot;
    window.nextdashTrackContent = trackContentSnapshot;

    /** "v1.19" from "v1.19.8" or "v2026.07" from "v2026.07.23.6", else "unknown". */
    function minorOf(tag) {
        const match = /^v\d+\.\d+/.exec(String(tag || ''));
        return match ? match[0] : 'unknown';
    }

    /**
     * Three small questions the snapshots cannot answer, none of which carries
     * more than a fixed word: how fast people move to a new release, how soon a
     * new install gets its first bookmark, and whether the app breaks.
     */
    if (enabled && !isDemo) {
        const state = readState();
        let changed = false;

        // `app-updated`: the minor release this browser moved from and to. Never
        // on the first visit, which has nothing to move from.
        if (releaseTag && state.release !== releaseTag) {
            if (state.release) {
                window.nextdashTrack('app-updated', { from: minorOf(state.release), to: minorOf(releaseTag) });
            }
            state.release = releaseTag;
            changed = true;
        }

        // The first sighting, kept only as a time, and only counted as an install
        // worth timing when it started small: for a library that was already
        // there, "time to first bookmark" would measure nothing.
        if (!state.first) {
            let started = false;
            try {
                started = Number(JSON.parse(self.getAttribute('data-content') || '{}').bookmarks) <= 10;
            } catch (_) {
                started = false;
            }
            state.first = Date.now();
            state.fresh = started;
            changed = true;
        }
        if (changed) writeState(state);

        // `first-bookmark`: once per browser, as a band: ten minutes, a day, a
        // week, or later.
        const FIRST_STEPS = [10 * 60 * 1000, 24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000];
        const FIRST_WORDS = ['10m', '1d', '7d'];
        const trackAll = window.nextdashTrack;
        window.nextdashTrack = function (name, props) {
            trackAll(name, props);
            if (name !== 'bookmark-created' || !props || props.result !== 'ok') return;
            const now = readState();
            if (!now.fresh || now.firstBookmark) return;
            const since = Date.now() - now.first;
            const index = FIRST_STEPS.findIndex((step) => since <= step);
            now.firstBookmark = true;
            writeState(now);
            trackAll('first-bookmark', { after: index === -1 ? 'later' : FIRST_WORDS[index] });
        };

        // `app-error`: that something threw, and in which view. Never the
        // message or the stack, which can hold a URL or a title. At most three
        // per page load, so a loop cannot become a flood, and only errors from
        // this app's own scripts, not from an extension or a blocked resource.
        let errorsSent = 0;
        const viewOf = () => {
            const word = window.location.hash.replace(/^#/, '').split(/[/?&=]/)[0];
            if (/^\d{1,2}$/.test(word)) return 'page';
            return /^[a-z][a-z0-9-]{0,30}$/i.test(word) ? word.toLowerCase() : 'other';
        };
        const reportError = (kind) => {
            if (errorsSent >= 3) return;
            errorsSent += 1;
            window.nextdashTrack('app-error', { kind, view: viewOf() });
        };
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('error', (event) => {
                if (event && event.filename && !String(event.filename).startsWith(window.location.origin)) return;
                reportError('error');
            });
            window.addEventListener('unhandledrejection', () => reportError('rejection'));
        }
    }

    /**
     * `demo:session-depth`: how far a demo visit went, once, when it ends.
     *
     * Two bands, never the numbers: views and actions, each as the first step
     * it fits in. A page restored from the back/forward cache starts a new
     * visit (pageshow above), so one is counted per pagehide, not per tab.
     */
    /**
     * An address as the demo reports it: the path and the bare `#view`, never a
     * query and never what follows the view name in the hash. A hash that is
     * not a plain word (or a page number) is dropped altogether.
     */
    function demoSafeUrl(raw) {
        try {
            const url = new URL(raw, window.location.href);
            const view = url.hash.replace(/^#/, '').split(/[/?&=]/)[0];
            const hash = /^[a-z0-9][a-z0-9-]{0,30}$/i.test(view) ? `#${view}` : '';
            return `${url.origin}${url.pathname}${hash}`;
        } catch (_) {
            return '';
        }
    }

    /** Umami's data-before-send hook: every payload leaves with a safe url and referrer. */
    function demoBeforeSend(_type, payload) {
        if (!payload || typeof payload !== 'object') return payload;
        const out = { ...payload };
        if (out.url) out.url = demoSafeUrl(out.url);
        if (out.referrer) out.referrer = demoSafeUrl(out.referrer);
        return out;
    }

    /**
     * Where nextDash is opened, as one word: "localhost", "lan" (a private or
     * link-local address, a name without dots, or .local/.lan/.home.arpa/.internal)
     * or "domain" (anything else). The word is all that leaves.
     */
    function hostExposure(hostname) {
        const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
        if (!host) return 'unknown';
        if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host)) return 'localhost';
        if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return 'lan';
        if (/^(fe80:|fc|fd)/.test(host) && host.includes(':')) return 'lan';
        if (!host.includes('.') && !host.includes(':')) return 'lan';
        if (/\.(local|lan|home\.arpa|internal|home)$/.test(host)) return 'lan';
        return 'domain';
    }
    window.nextdashHostExposure = hostExposure;

    /** Umami's data-before-send hook outside the demo: no hostname, referrer or page title. */
    function installBeforeSend(_type, payload) {
        if (!payload || typeof payload !== 'object') return payload;
        const out = { ...payload };
        if ('hostname' in out) out.hostname = hostExposure(out.hostname);
        if ('referrer' in out) out.referrer = '';
        if ('title' in out) out.title = 'nextDash';
        return out;
    }

    const DEPTH_STEPS = [0, 1, 2, 5, 10, 25, 50];
    let depthSent = false;
    function sendSessionDepth() {
        if (depthSent || !umamiReady) return;
        depthSent = true;
        rawTrack('demo:session-depth', {
            views: bucket(depth.views, DEPTH_STEPS),
            actions: bucket(depth.actions, DEPTH_STEPS),
            mode: 'demo',
        });
        depth.views = 0;
        depth.actions = 0;
    }

    if (!enabled || !websiteId || !scriptSrc) {
        return;
    }

    const tracker = document.createElement('script');
    tracker.defer = true;
    tracker.src = scriptSrc;
    tracker.setAttribute('data-website-id', websiteId);
    if (isDemo) {
        // Nobody chose to be counted here, so a browser that says "do not
        // track" is believed. The recorder reads the tracker's session, so it
        // stays quiet for that visitor as well.
        tracker.setAttribute('data-do-not-track', 'true');
        tracker.setAttribute('data-mode', 'demo');
        // Typed text can reach the address (the Inbox search, Health's filter),
        // and Umami records the page address: no query at all, and the hash cut
        // to its view name (see demoBeforeSend).
        tracker.setAttribute('data-exclude-search', 'true');
        tracker.setAttribute('data-before-send', 'nextdashDemoBeforeSend');
        window.nextdashDemoBeforeSend = demoBeforeSend;
        window.addEventListener('pagehide', sendSessionDepth);
        window.addEventListener('pageshow', (event) => { if (event.persisted) depthSent = false; });
    } else {
        // What Umami would record about where this runs is the address people
        // open nextDash on, which is their own: a LAN address, a private domain,
        // the login page of the proxy in front. None of it leaves; the snapshot
        // carries `exposure` instead (see hostExposure).
        tracker.setAttribute('data-before-send', 'nextdashBeforeSend');
        window.nextdashBeforeSend = installBeforeSend;
    }
    // Umami hooks history.pushState/replaceState and counts every address
    // change as a pageview, so each in-app view switch (#config, #inbox, #1)
    // became one and bounce rate was meaningless. Auto-tracking is off; the
    // page load is reported once below, and view changes stay `view:*` events.
    tracker.setAttribute('data-auto-track', 'false');
    tracker.addEventListener('load', function () {
        umamiReady = true;
        try {
            // The path only: the hash is the in-app view, which has its own events.
            window.umami.track((payload) => ({ ...payload, url: window.location.pathname }));
        } catch (_) {
            // Analytics must never break the app.
        }
        while (queue.length) {
            const [name, props] = queue.shift();
            rawTrack(name, props);
        }
        while (afterTrackerLoad.length) afterTrackerLoad.shift()();
    });
    tracker.addEventListener('error', function () {
        // Blocked (ad-blocker / offline / CSP). Drop the queue silently.
        queue.length = 0;
        afterTrackerLoad.length = 0;
    });
    document.head.appendChild(tracker);
})();
