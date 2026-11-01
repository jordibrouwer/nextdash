/**
 * Watch feeds: the feeds you chose to follow, and what they have published.
 *
 * Fresh counts what any feed it can find has published, quietly. A watch is the
 * other thing: a feed followed on purpose, whose newest entries the server keeps
 * with their words so they can be read here. This holds the server's answer for
 * the length of a page view and hands it to the row badge, the hover card, the
 * news modal and the toast.
 *
 * Opening the bookmark is what clears the news, as it is for Fresh: lastOpened is
 * already kept, and a second notion of "read" would be a second thing to get wrong.
 */
class DashboardFeedWatch {
    constructor(dashboard) {
        this.dash = dashboard;
        /** canonical URL key -> { newCount, newAt, newest, feeds: [...] } */
        this.byKey = new Map();
        this.limit = 100;
        this.total = 0;
        this._loading = null;
        this._phase = 'none';
        this._remainingMs = 0;
        this._timer = null;
        this._renderQueued = false;
    }

    key(url) {
        return window.BookmarkUrlUtils?.canonicalBookmarkURLKey?.(url)
            ?? String(url || '').trim().toLowerCase();
    }

    _fetch() {
        return typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    }

    _apply(data) {
        const next = new Map(Object.entries(data?.watches || {}));
        const before = JSON.stringify([...this.byKey]);
        this.byKey = next;
        this.limit = Number(data?.limit) || this.limit;
        this.total = Number(data?.total) || 0;
        if (JSON.stringify([...next]) !== before) {
            document.dispatchEvent(new CustomEvent('feedwatch:changed'));
        }
    }

    /** Fetch the watch list once per page view; `force` asks again. */
    async load({ force = false } = {}) {
        if (this._loading && !force) return this._loading;
        this._loading = (async () => {
            try {
                const res = await fetch('/api/feeds/watch');
                if (!res.ok) return false;
                this._apply(await res.json());
                return true;
            } catch {
                return false;
            } finally {
                this._loading = null;
            }
        })();
        return this._loading;
    }

    watchFor(bookmark) {
        return this.byKey.get(this.key(bookmark?.url)) || null;
    }

    isWatched(bookmark) {
        return (this.watchFor(bookmark)?.feeds?.length || 0) > 0;
    }

    /** What is new for this bookmark, or null when nothing is. */
    newsFor(bookmark) {
        const entry = this.watchFor(bookmark);
        if (!entry || !(Number(entry.newCount) > 0)) return null;
        return { newCount: Number(entry.newCount), newest: entry.newest || null, newAt: Number(entry.newAt) || 0 };
    }

    totalNew() {
        let sum = 0;
        this.byKey.forEach((entry) => { sum += Number(entry.newCount) || 0; });
        return sum;
    }

    /** How many bookmarks have news. */
    sitesWithNews() {
        let n = 0;
        this.byKey.forEach((entry) => { if (Number(entry.newCount) > 0) n += 1; });
        return n;
    }

    newestNewAt() {
        let at = 0;
        this.byKey.forEach((entry) => {
            if (Number(entry.newCount) > 0) at = Math.max(at, Number(entry.newAt) || 0);
        });
        return at;
    }

    async candidates(url) {
        const res = await fetch(`/api/feeds/watch/candidates?url=${encodeURIComponent(url)}`);
        if (!res.ok) return { feeds: [] };
        return res.json();
    }

    /**
     * Set the whole set of feeds watched for one bookmark.
     * @returns {Promise<{ok: boolean, error?: string, feedUrl?: string, watch?: object}>}
     */
    async save(url, feeds) {
        let res;
        try {
            res = await this._fetch()('/api/feeds/watch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookmarkUrl: url, feeds }),
            });
        } catch {
            return { ok: false, error: 'network' };
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: data?.error || String(res.status), feedUrl: data?.feedUrl };
        await this.load({ force: true });
        return { ok: true, watch: data?.watch };
    }

    async unwatch(url) {
        const res = await this._fetch()('/api/feeds/unwatch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookmarkUrl: url }),
        });
        if (res.ok) await this.load({ force: true });
        return res.ok;
    }

    /** Ask a paused feed again right now. */
    async retry(url, feedUrl) {
        let res;
        try {
            res = await this._fetch()('/api/feeds/watch/retry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookmarkUrl: url, feedUrl }),
            });
        } catch {
            return false;
        }
        if (res.ok) await this.load({ force: true });
        return res.ok;
    }

    /**
     * The row was opened. The server recomputes the count from lastOpened, so
     * this is only the local half, as for Fresh.
     */
    markOpened(bookmark) {
        const key = this.key(bookmark?.url);
        const entry = this.byKey.get(key);
        if (!entry || !(Number(entry.newCount) > 0)) return;
        this.byKey.set(key, { ...entry, newCount: 0, newest: null });
        this._evaluateWindow();
        // The tab title and the rows follow now, not at the next poll.
        document.dispatchEvent(new CustomEvent('feedwatch:changed'));
    }

    windowMs() {
        const minutes = Number(this.dash?.settings?.feedWatchWindowMinutes) || 30;
        return minutes * 60 * 1000;
    }

    /**
     * Where the "news is open for you" window stands: none, pending (news came
     * while the tab was hidden), open or closed. Kept per device.
     */
    _evaluateWindow() {
        const model = window.FeedWatchWindow;
        if (!model) return this._phase;
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem('nextdash.feedWatchWindow') || 'null'); } catch { /* no storage */ }
        const result = model.next(stored, {
            newestNewAt: this.newestNewAt(),
            now: Date.now(),
            visible: document.visibilityState !== 'hidden',
            windowMs: this.windowMs(),
        });
        // Only when it changed: this runs for every row of a render.
        const same = (a, b) => (a?.newestNewAt || 0) === (b?.newestNewAt || 0) && (a?.startedAt || 0) === (b?.startedAt || 0);
        if (!same(stored, result.stored) || (!stored && result.stored) || (stored && !result.stored)) {
            try {
                if (result.stored) localStorage.setItem('nextdash.feedWatchWindow', JSON.stringify(result.stored));
                else localStorage.removeItem('nextdash.feedWatchWindow');
            } catch { /* no storage */ }
        }
        const changed = result.phase !== this._phase;
        this._phase = result.phase;
        this._remainingMs = result.remainingMs;
        if (changed) document.dispatchEvent(new CustomEvent('feedwatch:changed'));
        return this._phase;
    }

    windowPhase() { return this._evaluateWindow(); }

    /** The length of the window in ms, for the bar. */
    windowLength() { return this.windowMs(); }

    windowRemainingMs() {
        this._evaluateWindow();
        return this._remainingMs;
    }

    /**
     * Keep the window honest: re-evaluate when the tab comes back, and on a
     * slow tick (a fast one while the news modal is open, for its bar).
     */
    /**
     * Tell the reader once that watched feeds have news: one toast however many
     * sites, and not again for news already announced on this device.
     */
    announce() {
        if (document.visibilityState === 'hidden') return;
        if (this._evaluateWindow() === 'closed' || this._evaluateWindow() === 'none') return;
        const newest = this.newestNewAt();
        let announced = 0;
        try { announced = Number(localStorage.getItem('nextdash.feedWatchToasted')) || 0; } catch { /* no storage */ }
        if (!(newest > announced)) return;
        try { localStorage.setItem('nextdash.feedWatchToasted', String(newest)); } catch { /* no storage */ }

        const d = this.dash;
        const t = (key, fb, vars) => {
            let text = d?.language?.t?.(key);
            if (!text || text === key) text = fb;
            Object.keys(vars || {}).forEach((name) => { text = text.replace(`{${name}}`, () => String(vars[name])); });
            return text;
        };
        const sites = this.sitesWithNews();
        let message;
        if (sites === 1) {
            const entry = [...this.byKey.entries()].find(([, e]) => Number(e.newCount) > 0);
            const name = (d?.allBookmarks || []).find((b) => this.key(b.url) === entry?.[0])?.name || entry?.[0] || '';
            message = t('dashboard.feedWatchToastOne', '{site} has news', { site: name });
        } else {
            message = t('dashboard.feedWatchToastMany', '{n} sites have news', { n: sites });
        }
        d?.showNotification?.(message, 'info', {
            actionLabel: t('dashboard.feedWatchRead', 'Read'),
            onAction: () => { void window.FeedWatchNews?.open(); },
            duration: 10000,
        });
    }

    start() {
        if (this._timer !== null) return;
        // The server polls each feed at most hourly; this only picks up what it
        // found, so a slow client tick is enough.
        setInterval(() => {
            if (document.visibilityState !== 'hidden') void this.load({ force: true });
        }, 5 * 60 * 1000);
        const refreshSignals = () => {
            this._evaluateWindow();
            const open = this._phase === 'open' || this._phase === 'pending';
            window.FeedWatchTabBadge?.set(open ? this.totalNew() : 0);
            // The first toast waits for the page to settle: the dashboard's own
            // start-up messages cleared a toast shown while it was loading.
            if (this._settled) this.announce();
        };
        setTimeout(() => { this._settled = true; this.announce(); }, 1500);
        document.addEventListener('feedwatch:changed', refreshSignals);
        // ?news=1 is where a push notification lands.
        try {
            const url = new URL(window.location.href);
            if (url.searchParams.get('news') === '1') {
                url.searchParams.delete('news');
                history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
                void window.FeedWatchNews?.open();
            }
        } catch { /* no URL */ }
        document.addEventListener('visibilitychange', () => {
            this._evaluateWindow();
            if (document.visibilityState === 'visible') {
                this.announce();
                void this.load({ force: true });
            }
        });
        document.addEventListener('feedwatch:changed', () => {
            if (this._renderQueued) return;
            this._renderQueued = true;
            requestAnimationFrame(() => {
                this._renderQueued = false;
                this.dash?.renderDashboard?.();
            });
        });
        const tick = () => {
            this._evaluateWindow();
            const fast = window.FeedWatchNews?.isOpen?.();
            this._timer = setTimeout(tick, fast ? 1000 : 30000);
        };
        tick();
        refreshSignals();
    }

    /** Mark a bookmark's news read: locally at once, then on the server. */
    markSeen(bookmark) {
        const key = this.key(bookmark?.url);
        const entry = this.byKey.get(key);
        if (!entry || !(Number(entry.newCount) > 0)) return;
        this.byKey.set(key, { ...entry, newCount: 0, newest: null });
        document.dispatchEvent(new CustomEvent('feedwatch:changed'));
        void this._fetch()('/api/feeds/watch/seen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookmarkUrl: bookmark.url }),
        }).catch(() => {});
    }

    /** Every unread item across the watched feeds. */
    unreadTotal() { return this.totalNew(); }

    /**
     * Mark single items read or unread. The count moves at once; the answer
     * from the server (which knows the rule) replaces it.
     */
    async markItems(bookmarkUrl, feedUrl, ids, read) {
        const key = this.key(bookmarkUrl);
        const entry = this.byKey.get(key);
        if (!entry || !Array.isArray(ids) || !ids.length) return false;
        const step = read ? -ids.length : ids.length;
        const guess = Math.max(0, (Number(entry.newCount) || 0) + step);
        this.byKey.set(key, { ...entry, newCount: guess, newest: guess > 0 ? entry.newest : null });
        document.dispatchEvent(new CustomEvent('feedwatch:changed'));
        let res;
        try {
            res = await this._fetch()('/api/feeds/watch/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookmarkUrl, feedUrl, ids, read: read === true }),
            });
        } catch {
            res = null;
        }
        await this.load({ force: true });
        return !!res?.ok;
    }

    /** One site's news is read; the same as opening its bookmark. */
    markSiteRead(bookmarkUrl) {
        this.markSeen({ url: bookmarkUrl });
    }

    /** Everything is read, on every watched site. */
    async markAllRead() {
        this.byKey.forEach((entry, key) => {
            if (Number(entry.newCount) > 0) this.byKey.set(key, { ...entry, newCount: 0, newest: null });
        });
        document.dispatchEvent(new CustomEvent('feedwatch:changed'));
        let res;
        try {
            res = await this._fetch()('/api/feeds/watch/seen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ all: true }),
            });
        } catch {
            res = null;
        }
        await this.load({ force: true });
        return !!res?.ok;
    }

    /** The unread items, newest first; one bookmark's when `key` is given. */
    async items(key = '') {
        try {
            const res = await fetch(`/api/feeds/watch/items${key ? `?key=${encodeURIComponent(key)}` : ''}`);
            if (!res.ok) return [];
            return (await res.json()).items || [];
        } catch {
            return [];
        }
    }

    /**
     * What the news modal lists: the new items, then the feeds' other current
     * entries ("earlier"), so there is more to read than what was just found.
     * @returns {Promise<{items: object[], earlier: object[]}>}
     */
    async news(key = '') {
        try {
            const res = await fetch(`/api/feeds/watch/items${key ? `?key=${encodeURIComponent(key)}` : ''}`);
            if (!res.ok) return { items: [], earlier: [] };
            const data = await res.json();
            return { items: data.items || [], earlier: (data.recent || []).map((r) => ({ ...r, earlier: true })) };
        } catch {
            return { items: [], earlier: [] };
        }
    }

    /** Check every watch now, whatever its interval. */
    async pollNow() {
        const res = await this._fetch()('/api/feeds/watch/poll', { method: 'POST' });
        if (!res.ok) return null;
        const data = await res.json();
        this._apply({ watches: data.watches, limit: this.limit, total: this.total });
        await this.load({ force: true });
        return { polled: Number(data.polled) || 0, fresh: Number(data.fresh) || 0 };
    }
}

window.DashboardFeedWatch = DashboardFeedWatch;
