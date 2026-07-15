/**
 * Bookmark open tracking (dashboard). Analytics UI lives in Config → Stats and dashboard health.
 */
class BookmarkAnalytics {
    async trackBookmarkOpen(pageId, index) {
        const payload = JSON.stringify({ pageId, index });
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
