/**
 * Bookmark open tracking (dashboard). Analytics UI lives in Config → Stats and dashboard health.
 */
class BookmarkAnalytics {
    async trackBookmarkOpen(pageId, index, source, method, extra) {
        // Usage analytics (Umami): count that a bookmark was opened, and from where.
        // No id/name/url — `source` is a fixed enum, which keeps it PII-free.
        const resolvedSource = source || 'dashboard';
        window.nextdashTrack?.('bookmark-open', { source: resolvedSource });
        // `method` defaults here, at the one place every open funnels through
        // before the network call, so a caller with no gesture to report (an
        // issue reopened from Health, say) still logs an explicit "unknown"
        // rather than leaving the field to mean two different things.
        const body = {
            pageId, index, source: resolvedSource, method: method || 'unknown',
            sessionId: window.nextdashSessionId?.(),
        };
        // The "full" extras travel only when the reader actually turned the
        // level up. A call site can hand over resultRank or rowIndex whether
        // or not that is on — it is cheap to compute — so the gate belongs
        // here, at the one place every open funnels through, rather than at
        // every caller that happens to have a number on hand.
        if (extra && window.dashboardInstance?.settings?.activityOpenDetail === 'full') {
            Object.assign(body, extra);
        }
        const payload = JSON.stringify(body);
        const hasWriteToken = Boolean(
            document.querySelector('meta[name="nextdash-write-token"]')?.content?.trim()
        );

        if (!hasWriteToken && navigator.sendBeacon) {
            try {
                const blob = new Blob([payload], { type: 'application/json' });
                const queued = navigator.sendBeacon('/api/track-open', blob);
                if (queued) {
                    return;
                }
            } catch {
                // Fall through to fetch keepalive fallback.
            }
        }

        try {
            const request = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await request('/api/track-open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true
            });
        } catch (error) {
            console.error('Error tracking open:', error);
        }
    }
}

/**
 * A random id for this tab only, generated once and kept in memory for as
 * long as the tab stays open.
 *
 * Never written to a cookie or localStorage, and never derived from anything
 * about the client: the moment it survived a reload it would stop meaning
 * "these lines came from the same open tab" and start meaning something
 * closer to a fingerprint, which is a different feature this is not.
 */
let nextdashSessionIdValue = null;
window.nextdashSessionId = function nextdashSessionId() {
    if (!nextdashSessionIdValue) {
        const bytes = new Uint8Array(16);
        (window.crypto || window.msCrypto).getRandomValues(bytes);
        nextdashSessionIdValue = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return nextdashSessionIdValue;
};

/**
 * Whether the reader has this activity channel switched on, read from the
 * same settings the config panel's checkboxes write to. Every Phase 3 sender
 * below calls this before doing anything else: a channel nobody ticked must
 * cost the page nothing, not even a request that the server would drop.
 */
window.nextdashChannelOn = function nextdashChannelOn(name) {
    const channels = window.dashboardInstance?.settings?.activityChannels;
    return Array.isArray(channels) && channels.map((c) => String(c).toLowerCase()).includes(name);
};

/**
 * Fire-and-forget delivery for the five Phase 3 endpoints — the same
 * sendBeacon-first, fetch-keepalive-fallback shape trackBookmarkOpen already
 * uses above, pulled out here rather than duplicated five times.
 */
window.nextdashSendActivity = function nextdashSendActivity(url, body) {
    const payload = JSON.stringify(body);
    const hasWriteToken = Boolean(
        document.querySelector('meta[name="nextdash-write-token"]')?.content?.trim()
    );
    if (!hasWriteToken && navigator.sendBeacon) {
        try {
            if (navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }))) {
                return;
            }
        } catch {
            // Fall through to fetch keepalive fallback.
        }
    }
    try {
        const request = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true,
        }).catch(() => {});
    } catch {
        // Telemetry must never throw into whatever called it.
    }
};

/**
 * "keys" aggregates presses instead of sending one per press: a request per
 * keystroke would be the loudest of the five channels for the least insight
 * of any of them. Counts live in memory and go out on an interval and on
 * pagehide, whichever the tab reaches first.
 */
const nextdashKeyCounts = {};
let nextdashKeyFlushTimer = null;

function nextdashFlushKeys() {
    const keys = Object.keys(nextdashKeyCounts);
    if (keys.length === 0) return;
    const counts = { ...nextdashKeyCounts };
    keys.forEach((k) => delete nextdashKeyCounts[k]);
    window.nextdashSendActivity('/api/track-keys', { keys: counts, sessionId: window.nextdashSessionId() });
}

window.nextdashRecordKey = function nextdashRecordKey(key) {
    if (!key || !window.nextdashChannelOn('keys')) return;
    nextdashKeyCounts[key] = (nextdashKeyCounts[key] || 0) + 1;
    if (!nextdashKeyFlushTimer) {
        nextdashKeyFlushTimer = setInterval(nextdashFlushKeys, 30_000);
    }
};

window.addEventListener('pagehide', nextdashFlushKeys);

/** A page switch, a category folding, or a layout change. */
window.nextdashTrackNav = function nextdashTrackNav(action, detail) {
    if (!window.nextdashChannelOn('nav')) return;
    window.nextdashSendActivity('/api/track-nav', { action, detail, sessionId: window.nextdashSessionId() });
};

/** A search that was issued, how many results it found, and whether it ended in an open. */
window.nextdashTrackSearch = function nextdashTrackSearch(query, resultCount, opened) {
    if (!query || !window.nextdashChannelOn('search')) return;
    window.nextdashSendActivity('/api/track-search', {
        query, resultCount, opened, sessionId: window.nextdashSessionId(),
    });
};

/** Once per tab: the dashboard loaded, and which page it landed on. */
let nextdashSessionSent = false;
window.nextdashTrackSession = function nextdashTrackSession(pageId) {
    if (nextdashSessionSent || !window.nextdashChannelOn('session')) return;
    nextdashSessionSent = true;
    window.nextdashSendActivity('/api/track-session', { pageId, sessionId: window.nextdashSessionId() });
};

/**
 * Script errors the page catches about itself, deduplicated and rate-limited
 * here rather than on the server: a widget stuck in a retry loop must not be
 * able to turn "one broken thing" into thousands of identical lines.
 */
const nextdashErrorSeen = new Set();
let nextdashErrorCount = 0;
let nextdashErrorWindowStart = Date.now();
const NEXTDASH_ERROR_MAX_PER_MINUTE = 20;

function nextdashReportClientError(message, stack, script) {
    if (!window.nextdashChannelOn('clienterror')) return;
    const now = Date.now();
    if (now - nextdashErrorWindowStart > 60_000) {
        nextdashErrorWindowStart = now;
        nextdashErrorCount = 0;
    }
    if (nextdashErrorCount >= NEXTDASH_ERROR_MAX_PER_MINUTE) return;
    const signature = `${message}|${script}`;
    if (nextdashErrorSeen.has(signature)) return;
    // A tab open for days must not grow this without bound — the whole point
    // is catching the same error repeating, not remembering every one ever seen.
    if (nextdashErrorSeen.size > 200) nextdashErrorSeen.clear();
    nextdashErrorSeen.add(signature);
    nextdashErrorCount += 1;
    window.nextdashSendActivity('/api/track-clienterror', {
        message: String(message || '').slice(0, 500),
        stack: String(stack || '').slice(0, 4000),
        script: script || '',
        sessionId: window.nextdashSessionId(),
    });
}

window.addEventListener('error', (e) => {
    nextdashReportClientError(e.message, e.error?.stack, e.filename);
});
window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : '';
    nextdashReportClientError(message, stack, '');
});
