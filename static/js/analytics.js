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
        const body = { pageId, index, source: resolvedSource, method: method || 'unknown' };
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
