// Status Monitoring JavaScript
function normalizeStatusOfflineRetries(value) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return 3;
    return Math.min(10, Math.max(1, parsed));
}

function normalizeStatusOfflineRetryDelayMs(value) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return 450;
    return Math.min(3000, Math.max(100, parsed));
}

function normalizeStatusRecheckIntervalMinutes(value) {
    const allowed = [1, 3, 5, 10, 15, 30];
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || !allowed.includes(parsed)) return 5;
    return parsed;
}

function statusPingFetch(url, init) {
    return typeof nextDashFetch === 'function' ? nextDashFetch(url, init) : fetch(url, init);
}

/**
 * Whether a bookmark takes part in availability checking at all.
 *
 * Checking is one three-state choice — off, periodic, monitor — stored as two
 * mutually exclusive flags, so a monitored bookmark has checkStatus false.
 * Testing checkStatus alone would hide the status dot on exactly the bookmarks
 * the user cares most about being up.
 */
function bookmarkIsChecked(bookmark) {
    return Boolean(bookmark?.checkStatus || bookmark?.monitor);
}

function statusCacheKey(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (typeof BookmarkUrlUtils !== 'undefined' && typeof BookmarkUrlUtils.canonicalBookmarkURLKey === 'function') {
        return BookmarkUrlUtils.canonicalBookmarkURLKey(raw);
    }
    let t = raw.toLowerCase();
    const hash = t.indexOf('#');
    if (hash >= 0) t = t.slice(0, hash);
    return t.replace(/\/+$/, '');
}

class StatusMonitor {
    constructor(settings = {}) {
        this.settings = settings;
        this.statusCache = new Map(); // Cache for status results
        this._inFlightPings = new Set();
        // Results collected during a round, written as one request when it
        // ends. Before batching every result went out on its own, so a page
        // closed mid-round lost nothing; now it would, and pagehide is the
        // event that still fires when a tab is closed or backgrounded on
        // mobile. sendBeacon rather than fetch: an ordinary request started
        // during unload is not guaranteed to be sent.
        this._pendingStatuses = new Map();
        if (typeof window !== 'undefined') {
            window.addEventListener('pagehide', () => this.beaconPendingStatuses());
        }
        this.checkInterval = null;
        this.isChecking = false;
        this.loadingIndicator = document.getElementById('status-loading-indicator');
        // Cap parallel /api/ping calls so many bookmarks do not freeze browser + server.
        this.maxConcurrentChecks = 4;
        this.pingObserver = null;
        this._pingObserverBookmarks = null;
        /** Pixels beyond viewport edges to still treat a row as “visible” for initial / interval pings */
        this.viewportPingMarginPx = 220;
        this.applyRetrySettings();
        this.applyStatusColorMode();
    }

    resolveStatusRowElement(bookmarkElement, bookmarkUrl = '') {
        if (bookmarkElement?.isConnected) {
            return bookmarkElement;
        }
        const url = String(bookmarkUrl || bookmarkElement?.getAttribute?.('data-bookmark-url') || '').trim();
        if (!url) {
            return null;
        }
        return this.getStatusTargetElement({ url });
    }

    applyRetrySettings() {
        this.offlineRetryCount = normalizeStatusOfflineRetries(this.settings.statusOfflineRetries);
        this.offlineRetryDelayMs = normalizeStatusOfflineRetryDelayMs(this.settings.statusOfflineRetryDelayMs);
        this.recheckIntervalMinutes = normalizeStatusRecheckIntervalMinutes(this.settings.statusRecheckIntervalMinutes);
    }

    statusT(key, fallback, replacements = {}) {
        const lang = window.dashboardInstance?.language;
        if (!lang || typeof lang.t !== 'function') {
            return Object.entries(replacements).reduce(
                (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
                fallback
            );
        }
        const fullKey = key.startsWith('dashboard.') ? key : `dashboard.${key}`;
        let text = lang.t(fullKey);
        if (text === fullKey) text = fallback;
        return Object.entries(replacements).reduce(
            (out, [name, value]) => out.replaceAll(`{${name}}`, String(value)),
            text
        );
    }

    async runChecksWithConcurrency(bookmarks, fn) {
        const list = Array.isArray(bookmarks) ? bookmarks : [];
        if (list.length === 0) {
            return;
        }
        const limit = Math.max(1, Math.min(this.maxConcurrentChecks, list.length));
        let next = 0;
        const worker = async () => {
            while (next < list.length) {
                const i = next;
                next += 1;
                await fn(list[i]);
            }
        };
        await Promise.all(Array.from({ length: limit }, () => worker()));
    }

    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    updateSettings(settings) {
        const wasStatusEnabled = this.settings.showStatus;
        this.settings = settings;
        this.applyRetrySettings();
        this.applyStatusColorMode();
        if (!this.settings.showStatus) {
            this.clearAllStatuses();
            this.stopPeriodicChecks();
            this.detachViewportPingObserver();
            this.hideLoadingIndicator();
        } else if (!wasStatusEnabled) {
            this.startPeriodicChecks();
            if (window.dashboardInstance && window.dashboardInstance.bookmarks) {
                this.attachViewportPingObserver(window.dashboardInstance.bookmarks);
            }
        } else if (this.settings.showStatus) {
            this.stopPeriodicChecks();
            this.startPeriodicChecks();
        }

        // Hide loading indicator if the option is disabled
        if (this.settings.showStatusLoading !== true) {
            this.hideLoadingIndicator();
        }
    }

    applyStatusColorMode() {
        document.body.classList.toggle('status-color-lock', this.settings.colorizeStatus === false);
        if (this.settings.showStatus && window.dashboardInstance?.bookmarks) {
            this.applyCachedStatuses(window.dashboardInstance.bookmarks);
        }
    }

    getBookmarkSelectorValue(url) {
        const normalized = String(url || '');
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
            return CSS.escape(normalized);
        }
        return normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    getStatusTargetElement(bookmark, bookmarkIndex) {
        const url = String(bookmark?.url || '').trim();
        if (!url) {
            return null;
        }
        const escapedUrl = this.getBookmarkSelectorValue(url);
        const baseSelector = `.bookmarks-list[data-bookmarks-list="true"]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${escapedUrl}"]`;
        const index = Number.isInteger(bookmarkIndex) ? bookmarkIndex : Number.parseInt(bookmark?.dashboardIndex, 10);
        if (Number.isFinite(index) && index >= 0) {
            const byIndex = document.querySelector(`${baseSelector}[data-bookmark-index="${index}"]`);
            if (byIndex) {
                return byIndex;
            }
        }
        return document.querySelector(baseSelector);
    }

    isElementNearViewport(el, marginPx) {
        const m = Number.isFinite(marginPx) ? marginPx : this.viewportPingMarginPx;
        if (!el || typeof el.getBoundingClientRect !== 'function') {
            return false;
        }
        const r = el.getBoundingClientRect();
        const vh = typeof window.innerHeight === 'number' ? window.innerHeight : 0;
        const vw = typeof window.innerWidth === 'number' ? window.innerWidth : 0;
        return r.bottom >= -m && r.top <= vh + m && r.right >= -m && r.left <= vw + m;
    }

    filterBookmarksNearViewport(bookmarks) {
        const list = Array.isArray(bookmarks) ? bookmarks : [];
        return list.filter((b, index) => {
            if (!bookmarkIsChecked(b)) {
                return false;
            }
            const el = this.getStatusTargetElement(b, index);
            return el && this.isElementNearViewport(el);
        });
    }

    detachViewportPingObserver() {
        if (this.pingObserver) {
            this.pingObserver.disconnect();
            this.pingObserver = null;
        }
        this._pingObserverBookmarks = null;
    }

    /**
     * Ping bookmarks as they scroll near the viewport (avoids flooding /api/ping on large pages).
     * @param {Array} bookmarks
     */
    attachViewportPingObserver(bookmarks) {
        this.detachViewportPingObserver();
        if (!this.settings.showStatus || typeof IntersectionObserver === 'undefined') {
            return;
        }
        const bmList = Array.isArray(bookmarks) ? bookmarks : [];
        this._pingObserverBookmarks = bmList;
        const margin = `${Math.round(this.viewportPingMarginPx)}px`;
        this.pingObserver = new IntersectionObserver((entries) => {
            const list = this._pingObserverBookmarks || (window.dashboardInstance && window.dashboardInstance.bookmarks);
            if (!list || !this.settings.showStatus) {
                return;
            }
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }
                const row = entry.target;
                const url = String(row.getAttribute('data-bookmark-url') || '').trim();
                if (!url) {
                    return;
                }
                const rowIndex = Number.parseInt(row.getAttribute('data-bookmark-index'), 10);
                let bookmark = null;
                if (Number.isFinite(rowIndex) && rowIndex >= 0 && list[rowIndex]) {
                    bookmark = list[rowIndex];
                } else {
                    const wantKey = statusCacheKey(url);
                    bookmark = list.find((b) => statusCacheKey(b?.url) === wantKey);
                }
                if (bookmarkIsChecked(bookmark)) {
                    this.checkBookmarkStatus(bookmark, rowIndex);
                }
            });
        }, {
            root: null,
            rootMargin: `${margin} 0px ${margin} 0px`,
            threshold: 0
        });

        const rows = document.querySelectorAll(
            '.bookmarks-list[data-bookmarks-list="true"]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url]'
        );
        rows.forEach((row) => {
            const url = String(row.getAttribute('data-bookmark-url') || '').trim();
            const rowIndex = Number.parseInt(row.getAttribute('data-bookmark-index'), 10);
            let bookmark = null;
            if (Number.isFinite(rowIndex) && rowIndex >= 0 && bmList[rowIndex]) {
                bookmark = bmList[rowIndex];
            } else {
                const wantKey = statusCacheKey(url);
                bookmark = bmList.find((b) => statusCacheKey(b?.url) === wantKey);
            }
            if (bookmarkIsChecked(bookmark)) {
                this.pingObserver.observe(row);
            }
        });
    }

    async pingBookmarkOnce(bookmark) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        try {
            const response = await statusPingFetch(`/api/ping?url=${encodeURIComponent(bookmark.url)}${this.settings.skipFastPing ? '&skipFastPing=1' : ''}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.status === 429) {
                return {
                    status: 'rate_limited',
                    ping: null,
                    errorDetail: 'Rate limited'
                };
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            return {
                status: result.status === 'online' ? 'online' : 'offline',
                ping: result.ping ?? null,
                errorDetail: result.errorDetail || result.error || ''
            };
        } catch (error) {
            clearTimeout(timeoutId);
            // A ping that times out (AbortError) or fails at the network layer
            // (Safari surfaces this as a TypeError "Load failed") is an expected
            // outcome for an unreachable/slow site, not a programming error — the
            // bookmark is simply marked offline. Log it quietly so it doesn't read
            // as a red console error; keep console.error only for the unexpected.
            if (error.name === 'AbortError') {
                console.warn('Ping timeout for', bookmark.url);
            } else if (error instanceof TypeError) {
                console.warn('Ping failed for', bookmark.url, ':', error.message);
            } else {
                console.error('Ping error for', bookmark.url, ':', error);
            }
            return {
                status: 'offline',
                ping: null,
                errorDetail: 'Unreachable'
            };
        }
    }

    /**
     * Record one check result.
     *
     * Inside a round this only collects: `flushPendingStatuses()` sends the
     * whole set as a single write when the round ends. Loading the dashboard
     * used to fire one POST per row that pinged -- ten of them over seven
     * seconds on a page of 115 rows -- and each took the store's global lock
     * and rewrote the whole page file.
     *
     * Outside a round -- a single row rechecked by hand -- there is nothing to
     * batch, so it flushes immediately and the reader sees the write land.
     */
    async persistBookmarkStatus(bookmark, status, errorDetail = '') {
        const url = String(bookmark?.url || '').trim();
        if (!url) {
            return;
        }
        const pageId = Number(window.dashboardInstance?.currentPageId);
        if (!Number.isFinite(pageId) || pageId <= 0) {
            return;
        }

        const resolved = status === 'online' ? 'online' : 'offline';
        const detail = resolved === 'online' ? '' : (errorDetail || 'Unreachable');

        if (!this._pendingStatuses) {
            this._pendingStatuses = new Map();
        }
        // Keyed on the URL, so a bookmark checked twice in one round is written
        // once with its latest answer.
        this._pendingStatuses.set(statusCacheKey(url) || url, { url, status: resolved, error: detail, pageId });

        this.applyLocalStatus(bookmark, resolved, detail);

        if (!this.isChecking) {
            await this.flushPendingStatuses();
        }
    }

    /** Keep the in-memory copy in step, so the grid does not need a reload. */
    applyLocalStatus(bookmark, status, detail) {
        const dashboard = window.dashboardInstance;
        const list = dashboard?.bookmarks;
        if (!Array.isArray(list)) {
            return;
        }
        const local = list.find((b) => b === bookmark)
            || list.find((b) => statusCacheKey(b?.url) === statusCacheKey(bookmark?.url));
        if (local) {
            local.lastChecked = Date.now();
            local.lastError = status === 'online' ? '' : detail;
        }
    }

    /**
     * Send everything collected since the last flush as one write.
     *
     * Grouped by page because the endpoint writes one page file at a time, and
     * a round can cross pages when global shortcuts are on.
     */
    async flushPendingStatuses() {
        const pending = this._pendingStatuses;
        if (!pending || pending.size === 0) {
            return;
        }
        this._pendingStatuses = new Map();

        const byPage = new Map();
        pending.forEach((entry) => {
            const list = byPage.get(entry.pageId) || [];
            list.push({ url: entry.url, status: entry.status, error: entry.error });
            byPage.set(entry.pageId, list);
        });

        const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const [pageId, results] of byPage) {
            try {
                await send('/api/health/statuses', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pageId, results })
                });
            } catch (error) {
                console.warn('Failed to persist bookmark statuses', error);
            }
        }
    }

    /**
     * Last chance to keep a round's results when the page is going away.
     *
     * Same payload as the ordinary flush, sent with sendBeacon so the browser
     * delivers it after the document is gone. Nothing to await and nothing to
     * report: if it fails, the rows are simply checked again next time.
     */
    beaconPendingStatuses() {
        const pending = this._pendingStatuses;
        if (!pending || pending.size === 0 || typeof navigator?.sendBeacon !== 'function') {
            return;
        }
        this._pendingStatuses = new Map();

        const byPage = new Map();
        pending.forEach((entry) => {
            const list = byPage.get(entry.pageId) || [];
            list.push({ url: entry.url, status: entry.status, error: entry.error });
            byPage.set(entry.pageId, list);
        });
        byPage.forEach((results, pageId) => {
            try {
                navigator.sendBeacon('/api/health/statuses',
                    new Blob([JSON.stringify({ pageId, results })], { type: 'application/json' }));
            } catch {
                // Nothing useful to do while the page is unloading.
            }
        });
    }

    cacheStatusResult(bookmarkUrl, entry) {
        const key = statusCacheKey(bookmarkUrl);
        if (!key) return;
        this.statusCache.set(key, {
            ...entry,
            timestamp: Date.now()
        });
    }

    async checkBookmarkStatus(bookmark, bookmarkIndex) {
        if (!this.settings.showStatus || !bookmarkIsChecked(bookmark)) {
            return null;
        }

        const cacheKey = statusCacheKey(bookmark.url);
        if (!cacheKey || this._inFlightPings.has(cacheKey)) {
            return null;
        }
        this._inFlightPings.add(cacheKey);

        let resolvedIndex = bookmarkIndex;
        if (!Number.isFinite(resolvedIndex) && window.dashboardInstance?.bookmarks) {
            resolvedIndex = window.dashboardInstance.bookmarks.indexOf(bookmark);
        }

        const bookmarkElement = this.getStatusTargetElement(bookmark, resolvedIndex);
        if (!bookmarkElement) {
            this._inFlightPings.delete(cacheKey);
            return null;
        }

        const cached = this.statusCache.get(cacheKey);
        const hasRowStatus = bookmarkElement.classList.contains('status-online')
            || bookmarkElement.classList.contains('status-offline');
        if (!cached?.confirmed && !hasRowStatus) {
            this.setBookmarkStatus(bookmarkElement, 'checking', '', bookmark.url);
        }

        let lastResult = { status: 'offline', ping: null, errorDetail: 'Unreachable' };

        try {
        for (let attempt = 1; attempt <= this.offlineRetryCount; attempt += 1) {
            lastResult = await this.pingBookmarkOnce(bookmark);
            if (lastResult.status === 'rate_limited') {
                this.setBookmarkStatus(bookmarkElement, 'checking', '', bookmark.url);
                return null;
            }
            if (lastResult.status === 'online') {
                this.cacheStatusResult(bookmark.url, {
                    status: 'online',
                    ping: lastResult.ping,
                    failStreak: 0,
                    confirmed: true
                });
                const pingText = this.settings.showPing && lastResult.ping ? `${lastResult.ping}ms` : '';
                this.setBookmarkStatus(bookmarkElement, 'online', pingText, bookmark.url);
                await this.persistBookmarkStatus(bookmark, 'online');
                return { status: 'online', ping: lastResult.ping };
            }

            if (attempt < this.offlineRetryCount) {
                this.setBookmarkStatus(bookmarkElement, 'checking', '', bookmark.url);
                await this.delay(this.offlineRetryDelayMs);
            }
        }

        this.cacheStatusResult(bookmark.url, {
            status: 'offline',
            ping: null,
            failStreak: this.offlineRetryCount,
            confirmed: true,
            errorDetail: lastResult.errorDetail
        });
        this.setBookmarkStatus(bookmarkElement, 'offline', '', bookmark.url);
        await this.persistBookmarkStatus(bookmark, 'offline', lastResult.errorDetail);
        return { status: 'offline', ping: null };
        } finally {
            this._inFlightPings.delete(cacheKey);
        }
    }

    setBookmarkStatus(bookmarkElement, status, text = '', bookmarkUrl = '') {
        const target = this.resolveStatusRowElement(bookmarkElement, bookmarkUrl);
        if (!target) {
            return;
        }
        bookmarkElement = target;
        // Remove existing status classes
        bookmarkElement.classList.remove('status-online', 'status-offline', 'status-checking');

        // Add new status class
        bookmarkElement.classList.add(`status-${status}`);

        // Update status text badge (row-level grid cell when showPing is on)
        let statusElement = bookmarkElement.querySelector(':scope > .status-text');

        if (!statusElement && text && this.settings.showPing) {
            statusElement = document.createElement('span');
            statusElement.className = 'status-text bookmark-superscript-badge';
            const shortcut = bookmarkElement.querySelector(':scope > .bookmark-shortcut');
            if (shortcut) {
                bookmarkElement.insertBefore(statusElement, shortcut);
            } else {
                bookmarkElement.appendChild(statusElement);
            }
        }

        if (statusElement) {
            if (text && this.settings.showPing) {
                statusElement.textContent = text;
                statusElement.classList.remove('is-empty');
                statusElement.removeAttribute('aria-hidden');
            } else {
                statusElement.textContent = '';
                statusElement.classList.add('is-empty');
                statusElement.setAttribute('aria-hidden', 'true');
            }
            statusElement.style.removeProperty('display');
        }

        // Status indicator dot removed - no longer used
    }

    getPersistedStatus(bookmark) {
        const error = String(bookmark?.lastError || '').trim();
        if (error) {
            return 'offline';
        }
        return null;
    }

    async checkAllBookmarks(bookmarks, options = {}) {
        if (!this.settings.showStatus || this.isChecking) {
            return;
        }

        this.isChecking = true;
        this.showLoadingIndicator();

        // Filter bookmarks that should be checked
        const bookmarksToCheck = bookmarks.filter(bookmarkIsChecked);
        if (bookmarksToCheck.length === 0) {
            // Nothing opted in: stop quietly. Checking is deliberately per-bookmark,
            // so "none selected" is a valid state, not a misconfiguration worth
            // interrupting the dashboard over on every load.
            this.isChecking = false;
            this.hideLoadingIndicator();
            return;
        }

        const full = options && options.full === true;
        const toRun = full ? bookmarksToCheck : this.filterBookmarksNearViewport(bookmarksToCheck);
        if (toRun.length === 0 && !full) {
            this.isChecking = false;
            this.hideLoadingIndicator();
            return;
        }

        try {
            await this.runChecksWithConcurrency(toRun, (bookmark) => this.checkBookmarkStatus(bookmark));
        } catch (error) {
            console.error('Error checking bookmarks:', error);
        }

        this.applyCachedStatuses(bookmarks);
        this.isChecking = false;
        // After isChecking drops, so a later single recheck goes straight out
        // rather than sitting in a batch nobody will flush.
        await this.flushPendingStatuses();
        this.hideLoadingIndicator();
    }

    clearAllStatuses() {
        // Remove status classes and elements from normal bookmark rows only.
        const bookmarkElements = document.querySelectorAll('.bookmarks-list[data-bookmarks-list="true"]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url]');
        bookmarkElements.forEach(element => {
            element.classList.remove('status-online', 'status-offline', 'status-checking');

            const statusText = element.querySelector(':scope > .status-text');
            if (statusText) {
                statusText.textContent = '';
                statusText.classList.add('is-empty');
                statusText.setAttribute('aria-hidden', 'true');
                statusText.style.removeProperty('display');
            }

            const indicator = element.querySelector('.status-indicator');
            if (indicator) {
                indicator.remove();
            }
        });

        this.statusCache.clear();
    }

    startPeriodicChecks(intervalMinutes) {
        this.stopPeriodicChecks();

        if (this.settings.showStatus) {
            const minutes = normalizeStatusRecheckIntervalMinutes(
                intervalMinutes ?? this.recheckIntervalMinutes ?? this.settings.statusRecheckIntervalMinutes
            );
            this.recheckIntervalMinutes = minutes;
            this.checkInterval = setInterval(() => {
                if (window.dashboardInstance && window.dashboardInstance.bookmarks) {
                    this.checkAllBookmarks(window.dashboardInstance.bookmarks, { full: false });
                }
            }, minutes * 60 * 1000);
        }
    }

    stopPeriodicChecks() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    refreshBookmarkStatus(bookmarkUrl) {
        if (window.dashboardInstance && window.dashboardInstance.bookmarks) {
            const normalizedUrl = String(bookmarkUrl || '').trim();
            if (!normalizedUrl) {
                return;
            }
            const wantKey = statusCacheKey(normalizedUrl);
            const bookmark = window.dashboardInstance.bookmarks.find(
                (b) => statusCacheKey(b?.url) === wantKey
            );
            if (bookmark) {
                this.checkBookmarkStatus(bookmark);
            }
        }
    }

    refreshAllStatuses() {
        if (window.dashboardInstance && window.dashboardInstance.bookmarks) {
            this.checkAllBookmarks(window.dashboardInstance.bookmarks, { full: true });
        }
    }

    getCachedStatus(bookmarkUrl) {
        const normalizedUrl = String(bookmarkUrl || '').trim();
        if (!normalizedUrl) {
            return null;
        }
        return this.statusCache.get(statusCacheKey(normalizedUrl));
    }

    /**
     * Reachability for search filters: online | offline | null (not monitored or not checked yet).
     */
    getBookmarkReachability(bookmark) {
        const url = String(bookmark?.url || '').trim();
        if (!url) {
            return null;
        }

        const dash = window.dashboardInstance;
        const fresh = dash?.bookmarks?.find((candidate) => candidate?.url === url)
            || dash?.allBookmarks?.find((candidate) => candidate?.url === url)
            || bookmark;

        if (!bookmarkIsChecked(fresh)) {
            return null;
        }

        const cachedStatus = String(this.getCachedStatus(url)?.status || '').toLowerCase();
        if (cachedStatus === 'online' || cachedStatus === 'offline') {
            return cachedStatus;
        }
        const error = String(fresh.lastError || '').trim();
        if (error) {
            return 'offline';
        }
        if (Number(fresh.lastChecked || 0) > 0) {
            return 'online';
        }
        return null;
    }

    clearCache() {
        this.statusCache.clear();
    }

    // Show loading indicator
    showLoadingIndicator() {
        if (this.settings.showStatusLoading === true && this.loadingIndicator) {
            this.loadingIndicator.classList.add('show');
        }
    }

    // Hide loading indicator
    hideLoadingIndicator() {
        if (this.loadingIndicator) {
            this.loadingIndicator.classList.remove('show');
        }
    }

    // Initialize status monitoring
    init(bookmarks) {
        this.applyStatusColorMode();
        if (!this.settings.showStatus) {
            return;
        }

        // Initial check: rows in/near viewport only; off-screen rows ping when scrolled into view
        this.checkAllBookmarks(bookmarks, { full: false });
        this.attachViewportPingObserver(bookmarks);

        // Start periodic checks
        this.startPeriodicChecks();
    }

    // Update bookmarks without clearing cache - only check new/uncached bookmarks
    updateBookmarks(bookmarks) {
        if (!this.settings.showStatus) {
            return;
        }

        // First, apply cached status to existing bookmarks
        this.applyCachedStatuses(bookmarks);

        // Then check only bookmarks that don't have cached status
        const uncachedBookmarks = bookmarks.filter(bookmark =>
            bookmarkIsChecked(bookmark) && !this.statusCache.has(statusCacheKey(bookmark.url))
        );

        const uncachedNear = this.filterBookmarksNearViewport(uncachedBookmarks);

        if (uncachedNear.length > 0) {
            this.checkUncachedBookmarks(uncachedNear);
        }
        this.attachViewportPingObserver(bookmarks);
    }

    // Apply cached statuses to bookmarks that already have them
    applyCachedStatuses(bookmarks) {
        bookmarks.forEach((bookmark, index) => {
            if (!bookmarkIsChecked(bookmark)) {
                return;
            }
            const bookmarkElement = this.getStatusTargetElement(bookmark, index);
            if (!bookmarkElement) {
                return;
            }

            const cached = this.statusCache.get(statusCacheKey(bookmark.url));
            if (cached) {
                const pingText = this.settings.showPing && cached.ping ? `${cached.ping}ms` : '';
                this.setBookmarkStatus(bookmarkElement, cached.status, pingText);
                return;
            }

            const persisted = this.getPersistedStatus(bookmark);
            if (persisted) {
                this.setBookmarkStatus(bookmarkElement, persisted, '');
            }
        });
    }

    // Check only bookmarks that don't have cached status
    async checkUncachedBookmarks(bookmarks) {
        if (this.isChecking) {
            return;
        }

        this.isChecking = true;
        this.showLoadingIndicator();

        try {
            await this.runChecksWithConcurrency(bookmarks, (bookmark) => this.checkBookmarkStatus(bookmark));
        } catch (error) {
            console.error('Error checking bookmarks:', error);
        }

        this.applyCachedStatuses(bookmarks);
        this.isChecking = false;
        this.hideLoadingIndicator();
    }

    // Cleanup method
    destroy() {
        this.stopPeriodicChecks();
        this.detachViewportPingObserver();
        this.clearAllStatuses();
        this.clearCache();
        this.hideLoadingIndicator();
    }
}

// Export for use in other modules
window.StatusMonitor = StatusMonitor;
// The row renderer decides whether to draw a status badge at all, and has to
// answer the same question this file answers nine times over. It was testing
// `checkStatus` alone, which is false for a monitored bookmark — so Monitor,
// the heavier of the two modes, rendered with no status while Periodic showed
// one. Exported so there is a single answer rather than a second copy.
window.bookmarkIsChecked = bookmarkIsChecked;
window.normalizeStatusOfflineRetries = normalizeStatusOfflineRetries;
window.normalizeStatusOfflineRetryDelayMs = normalizeStatusOfflineRetryDelayMs;
window.normalizeStatusRecheckIntervalMinutes = normalizeStatusRecheckIntervalMinutes;
