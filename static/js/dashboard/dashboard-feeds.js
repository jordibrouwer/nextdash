/**
 * Fresh: what the bookmarks have published since you last opened them.
 *
 * The server does the polling and the counting; this holds the answer for the
 * length of a page view and hands it to the two things that use it — the small
 * count on a row, and the Fresh smart collection.
 *
 * Every other smart collection keys on something you did: opened today, opened
 * recently, opened often, not opened in a month. This one keys on what changed,
 * which is the question none of the others can answer — what is worth opening
 * right now.
 *
 * Not a feed reader, on purpose: there is no list of articles here, no titles,
 * no read state. Opening the bookmark is what clears the count, because
 * lastOpened is already kept for other reasons and a second notion of "read"
 * would be a second thing to get wrong.
 */
class DashboardFeeds {
    constructor(dashboard) {
        this.dash = dashboard;
        this.enabled = false;
        /** canonical URL key -> { feedUrl, newCount, lastItemAt, checkedAt } */
        this.byKey = new Map();
        this.lastPoll = 0;
        // What the last look for feeds found, so config can tell "nothing new"
        // from "nothing to look at" — the difference a reader cannot see on a
        // dashboard that simply never changes.
        this.coverage = { bookmarks: 0, checked: 0, withFeed: 0, lastDiscovery: 0 };
        this._loading = null;
    }

    key(url) {
        return window.BookmarkUrlUtils?.canonicalBookmarkURLKey?.(url)
            ?? String(url || '').trim().toLowerCase();
    }

    /**
     * Fetch the freshness map once per page view.
     *
     * Cheap enough to ask for unconditionally: the server answers `enabled:
     * false` with an empty map when feed polling is off, rather than an error
     * that would be noise in the console of every install that never turns it on.
     */
    async load({ force = false } = {}) {
        if (this._loading && !force) return this._loading;
        this._loading = (async () => {
            try {
                const res = await fetch('/api/feeds');
                if (!res.ok) return false;
                const data = await res.json();
                this.enabled = data?.enabled === true;
                this.lastPoll = Number(data?.lastPoll) || 0;
                this.byKey = new Map(Object.entries(data?.feeds || {}));
                this.coverage = {
                    bookmarks: Number(data?.bookmarks) || 0,
                    checked: Number(data?.checked) || 0,
                    withFeed: Number(data?.withFeed) || 0,
                    lastDiscovery: Number(data?.lastDiscovery) || 0,
                };
                return true;
            } catch {
                // A failed fetch means no badges this page view, which is the
                // same as no feeds — nothing here is worth an error toast.
                return false;
            } finally {
                this._loading = null;
            }
        })();
        return this._loading;
    }

    /** What this bookmark's feed has published since it was last opened. */
    freshFor(bookmark) {
        if (!this.enabled) return null;
        const entry = this.byKey.get(this.key(bookmark?.url));
        if (!entry || !(Number(entry.newCount) > 0)) return null;
        return entry;
    }

    /** Bookmarks with something new, newest publication first. */
    freshBookmarks(bookmarks) {
        if (!this.enabled || !this.byKey.size) return [];
        return (bookmarks || [])
            .filter((bookmark) => this.freshFor(bookmark))
            .sort((a, b) => {
                const at = Number(this.byKey.get(this.key(b.url))?.lastItemAt) || 0;
                const bt = Number(this.byKey.get(this.key(a.url))?.lastItemAt) || 0;
                return at - bt;
            });
    }

    /**
     * Clear a row's count the moment it is opened.
     *
     * The server recomputes it against lastOpened on the next load, so this is
     * only the local half — without it the badge would sit there claiming three
     * new until the page is reloaded, on the row you just read.
     */
    markOpened(bookmark) {
        const key = this.key(bookmark?.url);
        const entry = this.byKey.get(key);
        if (!entry) return;
        this.byKey.set(key, { ...entry, newCount: 0 });
    }

    /**
     * Look for feeds and poll the ones we know, now. Config's "Find feeds now".
     *
     * Returns what the round did rather than a bare true, because the useful
     * answer on most collections is "asked 40 pages, 2 of them publish
     * anything" — a panel that cannot say that leaves an empty dashboard
     * looking like a broken feature.
     */
    async pollNow() {
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await fetcher('/api/feeds/poll', { method: 'POST' });
        if (!res.ok) return null;
        const data = await res.json();
        this.enabled = true;
        this.lastPoll = Number(data?.lastPoll) || 0;
        this.byKey = new Map(Object.entries(data?.feeds || {}));
        this.coverage = {
            bookmarks: Number(data?.bookmarks) || 0,
            checked: Number(data?.checked) || 0,
            withFeed: Number(data?.withFeed) || 0,
            lastDiscovery: Number(data?.lastDiscovery) || 0,
        };
        return {
            ...this.coverage,
            discovered: Number(data?.discovered) || 0,
            found: Number(data?.found) || 0,
            polled: Number(data?.polled) || 0,
        };
    }
}

window.DashboardFeeds = DashboardFeeds;
