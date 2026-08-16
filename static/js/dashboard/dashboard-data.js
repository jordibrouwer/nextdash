/**
 * Dashboard data — pages, settings, bookmarks loading (phase-1 PR1).
 */
function dashFetch(url, init) {
    return typeof nextDashFetch === 'function' ? nextDashFetch(url, init) : fetch(url, init);
}

class DashboardData {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    safeBookmarkOpenHref(url) {
        return window.BookmarkUrlUtils?.safeHttpResourceUrl?.(url) || '';
    }

    samePageId(a, b) {
        return Number(a) === Number(b);
    }

    needsCrossPageBookmarks() {
        const d = this.dash;
        const s = d.settings;
        if (!s) return false;
        if (s.globalShortcuts === true) return true;
        if (s.showTagCollections) return true;
        if (s.showTagCloudButton === true) return true;
        if (s.showSmartTodayCollection !== false && this._smartCollectionFilterNeedsCrossPageData(s.smartTodayPageIds)) {
            return true;
        }
        if (s.showSmartRecentCollection !== false && this._smartCollectionFilterNeedsCrossPageData(s.smartRecentPageIds)) {
            return true;
        }
        if (s.showSmartStaleCollection !== false && this._smartCollectionFilterNeedsCrossPageData(s.smartStalePageIds)) {
            return true;
        }
        if (s.showSmartMostUsedCollection === true && this._smartCollectionFilterNeedsCrossPageData(s.smartMostUsedPageIds)) {
            return true;
        }
        return false;
    }

    needsCrossPageBookmarksAtStartup() {
        const d = this.dash;
        const s = d.settings;
        if (!s) return false;
        if (s.globalShortcuts === true) return true;
        if (s.showTagCollections) return true;
        if (s.showTagCloudButton === true) return true;
        if (s.showSmartRecentCollection !== false && this._smartCollectionFilterNeedsCrossPageData(s.smartRecentPageIds)) {
            return true;
        }
        if (s.showSmartStaleCollection !== false && this._smartCollectionFilterNeedsCrossPageData(s.smartStalePageIds)) {
            return true;
        }
        if (s.showSmartMostUsedCollection === true && this._smartCollectionFilterNeedsCrossPageData(s.smartMostUsedPageIds)) {
            return true;
        }
        return false;
    }

    shouldDeferCrossPageBookmarksLoad() {
        const d = this.dash;
        const s = d.settings;
        if (!s || s.showSmartTodayCollection === false) {
            return false;
        }
        if (this.needsCrossPageBookmarksAtStartup()) {
            return false;
        }
        return this._smartCollectionFilterNeedsCrossPageData(s.smartTodayPageIds);
    }

    // Whether evaluating this collection requires bookmarks from pages other
    // than the current one. NOT the inverse of
    // dashboard-smart-collections.js's _isSmartCollectionPageAllowed — that
    // asks only "is the current page in scope", which is also true for a
    // scope spanning the current page *and* others (still needs cross-page
    // data) and for an empty/all-pages scope (always needs cross-page data).
    // Only the id/index normalization is shared, via
    // dash.smartCollections' helpers.
    _smartCollectionFilterNeedsCrossPageData(pageIds) {
        const sc = this.dash.smartCollections;
        const { currentPageId, currentPageNumber } = sc._resolveSmartCollectionPageIdentity();
        if (!Array.isArray(pageIds) || pageIds.length === 0) {
            return true;
        }
        const normalizedIds = sc._normalizeSmartCollectionPageIds(pageIds);
        if (normalizedIds.length === 0) {
            return true;
        }
        return !normalizedIds.every((id) => id === currentPageId || id === currentPageNumber);
    }

    deferredLoadAllBookmarks() {
        const d = this.dash;
        if (d._deferredAllBookmarksLoadInFlight) {
            return d._deferredAllBookmarksLoadInFlight;
        }
        d._deferredAllBookmarksLoadInFlight = this.loadAllBookmarks()
            .then(() => {
                if (window.BookmarkUrlUtils?.healAllowLocalBookmarksSetting?.(d.settings, d.allBookmarks)) {
                    this.saveSettings().catch(() => {});
                }
                if (d.settings?.showSmartTodayCollection !== false) {
                    d.renderDashboard({ animate: false });
                }
                if (d.searchComponent) {
                    d.updateSearchComponent();
                }
            })
            .finally(() => {
                d._deferredAllBookmarksLoadInFlight = null;
            });
        return d._deferredAllBookmarksLoadInFlight;
    }

    async withRetry(task, retries = 2, baseDelayMs = 220) {
        let lastError = null;
        for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
                return await task();
            } catch (error) {
                lastError = error;
                if (attempt >= retries) break;
                const delayMs = baseDelayMs * (2 ** attempt);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
        throw lastError;
    }

    async loadData(options = {}) {
        const d = this.dash;
        const { skipPageBookmarks = false } = options;
        try {
            const [pagesRes, settingsRes, findersRes] = await Promise.all([
                fetch('/api/pages'),
                fetch('/api/settings'),
                fetch('/api/finders')
            ]);

            if (!pagesRes.ok || !settingsRes.ok || !findersRes.ok) {
                throw new Error('Failed to load dashboard bootstrap data');
            }

            d.pages = await pagesRes.json();
            d.finders = await findersRes.json();
            
            // Load settings from server first
            const serverSettings = await settingsRes.json();
            
            // Load settings from localStorage or server based on device-specific flag
            const deviceSpecific = window.DeviceSettingsMerge?.isDeviceSpecificEnabled?.() === true
                || localStorage.getItem('deviceSpecificSettings') === 'true';
            if (deviceSpecific && window.DeviceSettingsMerge?.mergeServerAndDeviceSettings) {
                const deviceSettings = window.DeviceSettingsMerge.getDeviceSettingsRaw?.();
                d.settings = window.DeviceSettingsMerge.mergeServerAndDeviceSettings(serverSettings, deviceSettings);
            } else if (deviceSpecific) {
                const deviceSettings = localStorage.getItem('dashboardSettings');
                if (deviceSettings) {
                    try {
                        d.settings = { ...serverSettings, ...JSON.parse(deviceSettings) };
                    } catch {
                        d.settings = serverSettings;
                    }
                } else {
                    d.settings = serverSettings;
                }
            } else {
                d.settings = serverSettings;
            }
            window.DiscoverabilityState?.init?.(d.settings.discoverabilityState);
            delete d.settings._sortMigratedPageIds;

            if (!Array.isArray(d.settings.smartRecentPageIds)) {
                d.settings.smartRecentPageIds = [];
            }
            if (!Array.isArray(d.settings.smartTodayPageIds)) {
                d.settings.smartTodayPageIds = [];
            }
            if (!Array.isArray(d.settings.smartStalePageIds)) {
                d.settings.smartStalePageIds = [];
            }
            if (!Array.isArray(d.settings.smartMostUsedPageIds)) {
                d.settings.smartMostUsedPageIds = [];
            }
            if (typeof d.settings.showSmartRecentCollection === 'undefined') {
                d.settings.showSmartRecentCollection = false;
            }
            if (typeof d.settings.showSmartTodayCollection === 'undefined') {
                d.settings.showSmartTodayCollection = true;
            }
            if (typeof d.settings.showSmartStaleCollection === 'undefined') {
                d.settings.showSmartStaleCollection = false;
            }
            if (typeof d.settings.showSmartMostUsedCollection === 'undefined') {
                d.settings.showSmartMostUsedCollection = false;
            }
            if (typeof d.settings.showRecentButton === 'undefined') {
                d.settings.showRecentButton = true;
            }
            if (typeof d.settings.showCheatSheetButton === 'undefined') {
                d.settings.showCheatSheetButton = true;
            }
            if (typeof d.settings.showCollapseAllButton === 'undefined') {
                d.settings.showCollapseAllButton = true;
            }
            if (typeof d.settings.pasteUrlQuickAdd === 'undefined') {
                d.settings.pasteUrlQuickAdd = true;
            }
            if (typeof d.settings.inboxEnabled === 'undefined') {
                d.settings.inboxEnabled = true;
            }
            if (d.settings.inboxEnabled !== false) {
                d.settings.pasteUrlQuickAdd = true;
            }
            if (d.settings.inboxEnabled === false && String(d.settings.pasteDestination || '').toLowerCase() === 'inbox') {
                d.settings.pasteDestination = 'ask';
            }
            // Health can no longer be disabled — always force it on.
            d.settings.showHealthDashboard = true;
            if (typeof d.settings.showAddBookmarkButton === 'undefined') {
                d.settings.showAddBookmarkButton = true;
            }
            if (typeof d.settings.showLinkPreviewCards === 'undefined') {
                d.settings.showLinkPreviewCards = false;
            }
            if (![100, 150, 250].includes(Number(d.settings.linkPreviewHoverDelayMs))) {
                d.settings.linkPreviewHoverDelayMs = 150;
            }
            if (typeof d.settings.updateCheckEnabled === 'undefined') {
                d.settings.updateCheckEnabled = true;
            }
            if (typeof d.settings.packedColumns === 'undefined') {
                d.settings.packedColumns = true;
            }
            d.settings.columnsPerRow = d.getNormalizedColumnsPerRow();
            if (!['comfortable', 'compact', 'dense', 'auto'].includes(String(d.settings.densityMode || ''))) {
                d.settings.densityMode = 'compact';
            }
            if (window.DashboardFont) {
                window.DashboardFont.normalizeFontSettings(d.settings);
            } else if (!d.settings.fontPreset) {
                d.settings.fontPreset = 'source-code-pro';
            }
            if (typeof d.settings.showShortcuts === 'undefined') {
                d.settings.showShortcuts = true;
            }
            if (typeof d.settings.showPinIcon === 'undefined') {
                d.settings.showPinIcon = false;
            }
            if (typeof d.settings.showNoteIcon === 'undefined') {
                d.settings.showNoteIcon = true;
            }
            if (typeof d.settings.showStatus === 'undefined') {
                d.settings.showStatus = true;
            }
            if (typeof d.settings.colorizeStatus === 'undefined') {
                d.settings.colorizeStatus = true;
            }
            if (typeof d.settings.showPing === 'undefined') {
                d.settings.showPing = true;
            }
            if (typeof d.settings.showStatusLoading === 'undefined') {
                d.settings.showStatusLoading = false;
            }
            if (typeof window.normalizeStatusOfflineRetries === 'function') {
                d.settings.statusOfflineRetries = window.normalizeStatusOfflineRetries(d.settings.statusOfflineRetries);
            } else {
                d.settings.statusOfflineRetries = 3;
            }
            if (typeof window.normalizeStatusOfflineRetryDelayMs === 'function') {
                d.settings.statusOfflineRetryDelayMs = window.normalizeStatusOfflineRetryDelayMs(d.settings.statusOfflineRetryDelayMs);
            } else {
                d.settings.statusOfflineRetryDelayMs = 450;
            }
            if (typeof window.normalizeStatusRecheckIntervalMinutes === 'function') {
                d.settings.statusRecheckIntervalMinutes = window.normalizeStatusRecheckIntervalMinutes(d.settings.statusRecheckIntervalMinutes);
            } else {
                d.settings.statusRecheckIntervalMinutes = 5;
            }
            if (typeof d.settings.onboardingCompleted === 'undefined') {
                d.settings.onboardingCompleted = true;
            }
            if (!Number.isFinite(Number(d.settings.smartRecentLimit)) || Number(d.settings.smartRecentLimit) < 0) {
                d.settings.smartRecentLimit = 50;
            } else {
                d.settings.smartRecentLimit = Number(d.settings.smartRecentLimit);
            }
            if (!Number.isFinite(Number(d.settings.smartTodayLimit)) || Number(d.settings.smartTodayLimit) < 0) {
                d.settings.smartTodayLimit = 8;
            } else {
                d.settings.smartTodayLimit = Number(d.settings.smartTodayLimit);
            }
            if (!Number.isFinite(Number(d.settings.smartStaleLimit)) || Number(d.settings.smartStaleLimit) < 0) {
                d.settings.smartStaleLimit = 50;
            } else {
                d.settings.smartStaleLimit = Number(d.settings.smartStaleLimit);
            }
            if (!Number.isFinite(Number(d.settings.smartMostUsedLimit)) || Number(d.settings.smartMostUsedLimit) < 0) {
                d.settings.smartMostUsedLimit = 25;
            } else {
                d.settings.smartMostUsedLimit = Number(d.settings.smartMostUsedLimit);
            }
            if (!d.settings.dateFormat) {
                d.settings.dateFormat = 'short-slash';
            }
            if (typeof d.settings.showTime === 'undefined') {
                d.settings.showTime = true;
            }
            if (!['24h', '12h'].includes(String(d.settings.timeFormat || ''))) {
                d.settings.timeFormat = '24h';
            }
            if (typeof d.settings.showWeatherWithDate === 'undefined') {
                d.settings.showWeatherWithDate = false;
            }
            if (!d.settings.weatherSource) {
                d.settings.weatherSource = 'manual';
            }
            if (!d.settings.weatherUnit) {
                d.settings.weatherUnit = 'celsius';
            }
            if (!Number.isFinite(Number(d.settings.weatherRefreshMinutes)) || Number(d.settings.weatherRefreshMinutes) <= 0) {
                d.settings.weatherRefreshMinutes = 30;
            } else {
                d.settings.weatherRefreshMinutes = Number(d.settings.weatherRefreshMinutes);
            }

            // Update document title based on custom title settings
            d.updateDocumentTitle();

            // Page from ?page=<id> or legacy #<1-based index>
            const hash = window.location.hash.substring(1);
            const deepLink = typeof DashboardDeepLink !== 'undefined'
                ? DashboardDeepLink.parseDashboardDeepLink()
                : null;
            let initialPageId = d.pages.length > 0 ? d.pages[0].id : 'default';
            if (deepLink?.pageId != null && d.pages.some((p) => p.id === deepLink.pageId)) {
                initialPageId = deepLink.pageId;
            } else if (hash && /^\d+$/.test(hash)) {
                const pageIndex = parseInt(hash, 10) - 1;
                if (pageIndex >= 0 && pageIndex < d.pages.length) {
                    initialPageId = d.pages[pageIndex].id;
                }
            }
            d.currentPageId = initialPageId;

            await window.DashboardCategorySort?.migrateLegacySortAllPages?.(d);
            
            if (!skipPageBookmarks) {
                // Load bookmarks and categories for initial page
                await this.loadPageBookmarks(d.currentPageId, { animate: true });

                if (this.needsCrossPageBookmarksAtStartup()) {
                    await this.loadAllBookmarks();
                } else {
                    d.allBookmarks = [];
                    if (this.shouldDeferCrossPageBookmarksLoad()) {
                        void this.deferredLoadAllBookmarks();
                    }
                }

                if (this.needsCrossPageBookmarksAtStartup()
                    && window.BookmarkUrlUtils?.healAllowLocalBookmarksSetting?.(d.settings, d.allBookmarks)) {
                    this.saveSettings().catch(() => {});
                }

                // Deliberately not consumed here. A deep link points at DOM —
                // a category element, a bookmark row — and none of it exists
                // during loadData(): the grid is rendered by init() afterwards.
                // Following the link at this point found nothing and announced
                // that the category had been deleted, about one sitting in
                // plain sight. init() runs it once the grid is up.

                const initialHash = window.location.hash.substring(1);
                if (initialHash === 'inbox' && d.inbox?.isEnabled?.()) {
                    await d.inbox.openInboxView();
                } else if (initialHash === 'health' && d.health?.isEnabled?.()) {
                    await d.health.openHealthView();
                } else if ((initialHash === 'config' || initialHash.startsWith('config/')) && d.config?.isEnabled?.()) {
                    // Bare #config means “open config”, not “open Overview”; a
                    // sectioned hash is an explicit deep link. On cold load, a
                    // stored Shift+H/I location is read here (before the lazy
                    // module loads) so sub-tabs can be buffered on the loader.
                    let section = initialHash === 'config'
                        ? undefined
                        : window.DashboardConfigLoader?.sectionFromHash?.(`#${initialHash}`);
                    if (initialHash === 'config') {
                        const stored = window.DashboardConfigLoader?.loadLastConfigLocation?.();
                        if (stored?.section) {
                            section = stored.section;
                            const prop = DashboardConfigLoader.SUB_TAB_STATE?.[stored.section];
                            if (prop && stored.subTab) {
                                d.config[prop] = stored.subTab;
                            }
                        }
                    }
                    await d.config.openConfigView(section);
                }
            }
        } catch (error) {
            const msg = d.language?.t?.('dashboard.loadFailed')
                || 'Failed to load dashboard. Please reload the page.';
            const translated = (typeof msg === 'string' && msg !== 'dashboard.loadFailed') ? msg : 'Failed to load dashboard. Please reload the page.';
            if (window.AppNotification?.showErrorWithReload) {
                window.AppNotification.showErrorWithReload(translated);
            } else {
                d.showErrorNotification(translated, { reload: true });
            }
            throw error;
        }
    }

    loadCollapsedStates() {
        const d = this.dash;
        try {
            const stored = localStorage.getItem('collapsedCategories');
            if (stored) {
                d.collapsedCategories = JSON.parse(stored);
            }
        } catch {
            d.collapsedCategories = {};
        }
    }

    saveCollapsedStates() {
        const d = this.dash;
        try {
            localStorage.setItem('collapsedCategories', JSON.stringify(d.collapsedCategories));
        } catch {
            // localStorage unavailable (private browsing, quota exceeded) — state is kept in memory only
        }
    }

    isCurrentPageBookmarksLoad(loadId) {
        const d = this.dash;
        return loadId === d._pageBookmarksLoadId;
    }

    clonePageBookmarks(bookmarks) {
        return (Array.isArray(bookmarks) ? bookmarks : []).map((bookmark) => ({ ...bookmark }));
    }

    clonePageCategories(categories) {
        const d = this.dash;
        return (Array.isArray(categories) ? categories : []).map((cat) => ({
            ...cat,
            name: d.language.t(cat.name) || cat.name,
        }));
    }

    getCachedPageData(pageId) {
        const d = this.dash;
        const entry = d._pageDataCache?.get(Number(pageId));
        if (!entry) {
            return null;
        }
        return {
            bookmarks: this.clonePageBookmarks(entry.bookmarks),
            categories: entry.categories.map((cat) => ({ ...cat })),
        };
    }

    setPageDataCache(pageId, bookmarks, categories) {
        const d = this.dash;
        if (!d._pageDataCache) {
            d._pageDataCache = new Map();
        }
        d._pageDataCache.set(Number(pageId), {
            bookmarks: this.clonePageBookmarks(bookmarks),
            categories: (Array.isArray(categories) ? categories : []).map((cat) => ({ ...cat, name: cat.name })),
            cachedAt: Date.now(),
        });
    }

    updatePageDataCache(pageId, partial = {}) {
        const d = this.dash;
        const pid = Number(pageId);
        if (!Number.isFinite(pid) || !d._pageDataCache?.has(pid)) {
            return;
        }
        const entry = d._pageDataCache.get(pid);
        if (Array.isArray(partial.bookmarks)) {
            entry.bookmarks = this.clonePageBookmarks(partial.bookmarks);
        }
        if (Array.isArray(partial.categories)) {
            entry.categories = partial.categories.map((cat) => ({ ...cat }));
        }
        entry.cachedAt = Date.now();
    }

    invalidatePageDataCache(pageId = null) {
        const d = this.dash;
        if (!d._pageDataCache) {
            return;
        }
        if (pageId == null) {
            d._pageDataCache.clear();
            return;
        }
        d._pageDataCache.delete(Number(pageId));
    }

    async fetchDataRevision() {
        try {
            const res = await fetch('/api/data-revision', { cache: 'no-store' });
            if (!res.ok) {
                return null;
            }
            const body = await res.json();
            const revision = String(body?.revision || '').trim();
            return revision || null;
        } catch {
            return null;
        }
    }

    async fetchAndStoreDataRevision() {
        const revision = await this.fetchDataRevision();
        if (revision) {
            this.dash._serverDataRevision = revision;
        }
        return revision;
    }

    /**
     * Compare server data revision with last seen value.
     * @returns {Promise<boolean>} true when revision changed since last sync
     */
    async syncDataRevision({ invalidateOnChange = true } = {}) {
        const revision = await this.fetchDataRevision();
        if (!revision) {
            return false;
        }
        const d = this.dash;
        const prev = String(d._serverDataRevision || '');
        const changed = Boolean(prev && prev !== revision);
        if (changed && invalidateOnChange) {
            this.invalidatePageDataCache();
        }
        d._serverDataRevision = revision;
        return changed;
    }

    async refreshIfDataRevisionChanged() {
        const d = this.dash;
        if (!d._bookmarksReady || d.isInlineEditActive?.()) {
            return false;
        }
        const changed = await this.syncDataRevision({ invalidateOnChange: true });
        if (!changed) {
            return false;
        }
        if (d.activeView === 'inbox' && d.inbox?.isEnabled?.()) {
            await d.inbox.loadAndRender();
            return true;
        }
        if (d.activeView === 'health' && d.health?.isEnabled?.()) {
            await d.health.loadAndRender({ refresh: true });
            return true;
        }
        if (d.needsCrossPageBookmarks?.()) {
            await this.loadAllBookmarks();
        }
        await this.loadPageBookmarks(d.currentPageId, { forceFetch: true, animate: false });
        return true;
    }

    _bookmarkUrlKey(url) {
        if (typeof BookmarkUrlUtils !== 'undefined' && typeof BookmarkUrlUtils.canonicalBookmarkURLKey === 'function') {
            return BookmarkUrlUtils.canonicalBookmarkURLKey(url);
        }
        return String(url || '').trim().toLowerCase();
    }

    _getPageBookmarksFromAll(pageId) {
        const d = this.dash;
        if (!Array.isArray(d.allBookmarks) || d.allBookmarks.length === 0) {
            return null;
        }
        const pid = Number(pageId);
        return d.allBookmarks.filter((bookmark) => Number(bookmark.pageId) === pid);
    }

    _bookmarkTagsKey(tags) {
        if (!Array.isArray(tags)) {
            return '';
        }
        return tags
            .map((tag) => String(tag).trim().toLowerCase())
            .filter(Boolean)
            .sort()
            .join('\0');
    }

    // Field set mirrors the Go side's bookmarkContentFingerprint
    // (activity_bookmark.go) — kept in sync by hand, since a field one side
    // treats as content and the other omits would let a real change through
    // undetected. Encoding (case-folding, tag sort order) differs from Go's
    // fingerprint because this one only ever compares against itself.
    _bookmarkStaleFingerprint(bookmark) {
        const name = String(bookmark?.name ?? '').trim();
        const shortcut = String(bookmark?.shortcut ?? '').trim().toUpperCase();
        const url = this._bookmarkUrlKey(bookmark?.url);
        const category = String(bookmark?.category ?? '').trim();
        const tags = this._bookmarkTagsKey(bookmark?.tags);
        const pinned = bookmark?.pinned ? '1' : '0';
        const checkStatus = bookmark?.checkStatus ? '1' : '0';
        const icon = String(bookmark?.icon ?? '').trim();
        const note = String(bookmark?.note ?? '').trim();
        return [name, url, shortcut, category, tags, pinned, checkStatus, icon, note].join('\x01');
    }

    isPageBookmarksStale(pageId, bookmarks) {
        const fromAll = this._getPageBookmarksFromAll(pageId);
        if (!fromAll) {
            return false;
        }
        const current = Array.isArray(bookmarks) ? bookmarks : [];
        if (fromAll.length !== current.length) {
            return true;
        }
        const currentByUrl = new Map(current.map((bookmark) => [
            this._bookmarkUrlKey(bookmark.url),
            this._bookmarkStaleFingerprint(bookmark),
        ]));
        return fromAll.some((bookmark) => {
            const key = this._bookmarkUrlKey(bookmark.url);
            if (!currentByUrl.has(key)) {
                return true;
            }
            return currentByUrl.get(key) !== this._bookmarkStaleFingerprint(bookmark);
        });
    }

    invalidateStalePageCaches(pageId = null) {
        const d = this.dash;
        if (!d._pageDataCache?.size) {
            return;
        }
        const pageIds = pageId == null
            ? [...d._pageDataCache.keys()]
            : [Number(pageId)];
        pageIds.forEach((pid) => {
            const entry = d._pageDataCache.get(pid);
            if (entry && this.isPageBookmarksStale(pid, entry.bookmarks)) {
                d._pageDataCache.delete(pid);
            }
        });
    }

    schedulePageBookmarksHealIfNeeded() {
        const d = this.dash;
        // Healing repairs the page grid; the full-container views don't show it.
        if (!d.isBookmarksView()) {
            return;
        }
        const pid = Number(d.currentPageId);
        if (!Number.isFinite(pid) || pid < 1) {
            return;
        }
        if (!this.isPageBookmarksStale(pid, d.bookmarks)) {
            return;
        }
        if (d._pageBookmarksHealInFlight) {
            return;
        }
        d._pageBookmarksHealInFlight = true;
        void this.loadPageBookmarks(pid, { forceFetch: true, animate: false })
            .finally(() => {
                d._pageBookmarksHealInFlight = false;
            });
    }

    async prefetchPageData(pageId) {
        const d = this.dash;
        const pid = Number(pageId);
        if (!Number.isFinite(pid) || pid === Number(d.currentPageId)) {
            return;
        }
        if (d._pageDataCache?.has(pid) || d._pagePrefetchInFlight?.has(pid)) {
            return;
        }
        d._pagePrefetchInFlight.add(pid);
        try {
            const [bookmarksRes, categoriesRes] = await Promise.all([
                fetch(`/api/bookmarks?page=${pid}`),
                fetch(`/api/categories?page=${pid}`),
            ]);
            if (!bookmarksRes.ok || !categoriesRes.ok) {
                return;
            }
            const bookmarks = await bookmarksRes.json();
            const categories = await categoriesRes.json();
            this.setPageDataCache(pid, bookmarks, categories);
        } catch {
            // Best-effort prefetch.
        } finally {
            d._pagePrefetchInFlight.delete(pid);
        }
    }

    // Full-container views (inbox/health/config) replace the entire dashboard
    // layout. _applyLoadedPageData must not yank the user out of one, or
    // rewrite the hash out from under it, while its data loaded in the
    // background — checked with three signals below because each alone has a
    // blind spot. Every view's identity — its name, its layout class, and how
    // to recognize its hash — lives in exactly this one table so a new
    // full-container view is one row here, not three separate edits to keep
    // in sync by hand. (The original deep-link bug this guards against was
    // exactly that shape: one of several places that needed updating for a
    // view got missed.)
    static FULL_CONTAINER_VIEWS = [
        {
            view: 'inbox',
            layoutClass: 'inbox-layout',
            matchesHash: (hash) => hash === '#inbox',
            isEnabled: (d) => Boolean(d.inbox?.isEnabled?.()),
        },
        {
            view: 'health',
            layoutClass: 'health-layout',
            matchesHash: (hash) => hash === '#health',
            isEnabled: (d) => Boolean(d.health?.isEnabled?.()),
        },
        {
            view: 'config',
            layoutClass: 'config-layout',
            // Config deep links carry a section (#config/appearance), so match
            // the prefix rather than the bare hash the other two views use.
            matchesHash: (hash) => hash === '#config' || hash.startsWith('#config/'),
            isEnabled: (d) => Boolean(d.config?.isEnabled?.()),
        },
    ];

    /**
     * Remember where the user was on the page they are leaving.
     *
     * Read before the grid is swapped out — once renderDashboard has run, the
     * document height belongs to the new page and window.scrollY has already
     * been clamped to it.
     */
    rememberScrollForPage(pageId) {
        const d = this.dash;
        if (!Number.isFinite(pageId) || pageId <= 0 || d.activeView !== 'bookmarks') {
            return;
        }
        if (!d._pageScrollPositions) {
            d._pageScrollPositions = new Map();
        }
        d._pageScrollPositions.set(pageId, window.scrollY || 0);
    }

    /**
     * Consume the remembered offset for a page, if there is one.
     *
     * Consumed, not just read: the offset describes one particular departure,
     * and leaving it behind would make a later deliberate visit to that page
     * land halfway down for no reason the user can see.
     */
    takeRememberedScroll(pageId) {
        const key = Number(pageId);
        const stored = this.dash._pageScrollPositions?.get(key);
        this.dash._pageScrollPositions?.delete(key);
        return Number.isFinite(stored) ? stored : 0;
    }

    _applyLoadedPageData(targetPageId, bookmarks, categories, options = {}) {
        const d = this.dash;
        const { skipRender = false, animate = false } = options;
        const previousPageId = Number(d.currentPageId);
        if (previousPageId !== targetPageId) {
            this.rememberScrollForPage(previousPageId);
        }
        // Three signals, because each alone has a blind spot:
        //  - the hash, for startup: the initial page load runs before #health/#inbox
        //    is consumed, so activeView is still 'bookmarks' and writing #<n> here
        //    would destroy the deep link before anything acted on it;
        //  - activeView, for the ordinary case;
        //  - the layout class, because this runs several awaits deep: a load that
        //    started while the grid was up can land after the user has opened a view,
        //    and would then rewrite the hash from #health back to #1.
        const layoutEl = document.getElementById('dashboard-layout');
        const hash = window.location.hash;
        const preserveView = DashboardData.FULL_CONTAINER_VIEWS.some(({ view, layoutClass, matchesHash, isEnabled }) => (
            matchesHash(hash)
                || Boolean(layoutEl?.classList.contains(layoutClass))
                || (d.activeView === view && isEnabled(d))
        ));

        // A freshly created empty category is held on screen against the
        // "hide empty categories" setting; that only applies to the page it was
        // made on, so leaving the page drops the pin.
        if (Number.isFinite(previousPageId) && previousPageId !== targetPageId) {
            d.pinnedEmptyCategoryId = null;
        }

        d.bookmarks = bookmarks;
        d.categories = this.clonePageCategories(categories);
        d.currentPageId = targetPageId;
        if (!preserveView) {
            d.setActiveView('bookmarks');
        }
        const pageIndex = d.pages.findIndex((p) => Number(p.id) === targetPageId);
        if (!preserveView && pageIndex !== -1) {
            window.location.hash = `#${pageIndex + 1}`;
        }

        const page = d.pages.find((p) => Number(p.id) === targetPageId);
        if (page) {
            d.updatePageTitle(page.name);
        }
        d.updateMiniStatusLine();
        d.updateDocumentTitle();

        if (d.searchComponent) {
            d.updateSearchComponent();
            if (!skipRender) {
                const restoreTo = this.takeRememberedScroll(targetPageId);
                window.scrollTo({ top: 0, behavior: 'instant' });
                d.renderDashboard({ animate });
                // After the render, or there is nothing tall enough to scroll to
                // yet. A page that has since grown shorter clamps itself.
                if (restoreTo > 0) {
                    requestAnimationFrame(() => {
                        window.scrollTo({ top: restoreTo, behavior: 'instant' });
                    });
                }

                if (d.keyboardNavigation) {
                    if (d.keyboardNavigation.isNavigating()) {
                        d.keyboardNavigation.resetToFirst();
                    } else {
                        d.keyboardNavigation.clearSelection();
                    }
                }
            }
        }

        d.setActivePageNavButton(targetPageId);

        const skipPageThemeRotate = d._pageNavIncludesViewChange === true;
        if (skipPageThemeRotate) {
            d._pageNavIncludesViewChange = false;
        }
        if (
            !skipPageThemeRotate
            && Number.isFinite(previousPageId)
            && previousPageId !== targetPageId
            && d.isBookmarksView()
        ) {
            d.visual?.onDashboardPageChanged?.(previousPageId, targetPageId);
        }

        d._bookmarksReady = true;
        if (d._pendingRecentModalRefresh && d.isRecentBookmarksModalOpen()) {
            d._pendingRecentModalRefresh = false;
            d._fillRecentBookmarksModal();
        }
    }

    async loadPageBookmarks(pageId, options = {}) {
        const d = this.dash;
        const {
            rethrow = false,
            skipInlineEditConfirm = false,
            skipRender = false,
            animate = false,
            forceFetch = false,
        } = options;
        const targetPageId = Number(pageId);
        if (!Number.isFinite(targetPageId)) {
            if (rethrow) {
                throw new Error('Invalid page id for loadPageBookmarks');
            }
            return false;
        }

        if (!skipInlineEditConfirm && d.isInlineEditActive() && d.hasInlineEditUnsavedChanges()) {
            if (!(await d.confirmInlineEditBeforeNavigation())) {
                if (rethrow) {
                    throw new Error('loadPageBookmarks cancelled: unsaved inline edits');
                }
                return false;
            }
        }

        const loadId = ++d._pageBookmarksLoadId;

        try {
            d._abortInlineEditForRender();
            await d.flushPendingDashboardSaves();
            if (!this.isCurrentPageBookmarksLoad(loadId)) {
                return false;
            }

            let useForceFetch = forceFetch;
            if (!useForceFetch) {
                const revisionChanged = await this.syncDataRevision({ invalidateOnChange: true });
                if (revisionChanged) {
                    useForceFetch = true;
                }
            }

            let bookmarks;
            let categories;
            let cached = !useForceFetch ? this.getCachedPageData(targetPageId) : null;
            if (cached && this.isPageBookmarksStale(targetPageId, cached.bookmarks)) {
                this.invalidatePageDataCache(targetPageId);
                cached = null;
            }
            if (cached) {
                bookmarks = cached.bookmarks;
                categories = cached.categories;
            } else {
                const [bookmarksRes, categoriesRes] = await Promise.all([
                    fetch(`/api/bookmarks?page=${targetPageId}`),
                    fetch(`/api/categories?page=${targetPageId}`),
                ]);

                if (!this.isCurrentPageBookmarksLoad(loadId)) {
                    return false;
                }
                if (!bookmarksRes.ok || !categoriesRes.ok) {
                    throw new Error('Failed to load page bookmarks or categories');
                }

                bookmarks = await bookmarksRes.json();
                categories = await categoriesRes.json();
                if (!this.isCurrentPageBookmarksLoad(loadId)) {
                    return false;
                }
                this.setPageDataCache(targetPageId, bookmarks, categories);
            }
            await this.fetchAndStoreDataRevision();

            this._applyLoadedPageData(targetPageId, bookmarks, categories, { skipRender, animate });
            return true;
        } catch (error) {
            if (!this.isCurrentPageBookmarksLoad(loadId)) {
                return false;
            }
            if (rethrow) {
                throw error;
            }
            d.showErrorNotification(
                d.formatDashboardLabel('loadPageBookmarksFailed', {}, 'Failed to load bookmarks for this page.'),
                {
                    retry: () => this.loadPageBookmarks(targetPageId),
                }
            );
            return false;
        }
    }

    async loadAllBookmarks(options = {}) {
        const d = this.dash;
        const { rethrow = false } = options;
        try {
            const allBookmarksRes = await fetch('/api/bookmarks?all=true');
            if (!allBookmarksRes.ok) {
                throw new Error('Failed to load all bookmarks');
            }
            d.allBookmarks = await allBookmarksRes.json();
            this.invalidateStalePageCaches();

            const currentPageId = Number(d.currentPageId);
            if (Number.isFinite(currentPageId)
                && this.isPageBookmarksStale(currentPageId, d.bookmarks)
                && !d._pageBookmarksHealInFlight) {
                await this.loadPageBookmarks(currentPageId, {
                    forceFetch: true,
                    skipRender: true,
                    rethrow: options.rethrow,
                });
            }

            // Update search component with all bookmarks
            if (d.searchComponent) {
                d.updateSearchComponent();
            }
        } catch (error) {
            if (rethrow) {
                throw error;
            }
            d.showErrorNotification(
                d.formatDashboardLabel('refreshGlobalShortcutsFailed', {}, 'Failed to refresh global shortcuts.'),
                {
                    retry: () => this.loadAllBookmarks(),
                }
            );
        }
    }

    /**
     * Reload bookmark data and repaint every surface that reads it — grid, config
     * bookmarks list, health, inbox, search — after add/edit/delete.
     */
    async refreshAfterBookmarkMutation(options = {}) {
        const d = this.dash;
        const pageIds = this._bookmarkMutationPageIds(options);
        const {
            animate = false,
            refreshHealthReport = true,
            repaintActiveView = true,
            despiteModal = false,
        } = options;

        pageIds.forEach((pid) => this.invalidatePageDataCache(pid));

        await this.loadAllBookmarks();

        const currentPageId = Number(d.currentPageId);
        if (pageIds.includes(currentPageId)) {
            await this.loadPageBookmarks(currentPageId, {
                forceFetch: true,
                animate,
                skipInlineEditConfirm: true,
                skipRender: true,
            });
        }

        await this.fetchAndStoreDataRevision();

        d.updateSearchComponent?.();

        if (repaintActiveView) {
            this.repaintBookmarkMutationSurfaces({ animate, refreshHealthReport, despiteModal });
        } else {
            d.config?.repaintBookmarksFilters?.();
            d.config?.repaintBookmarksList?.();
        }

        d.updateHealthBadge?.();
        d.updateTagFilterIndicator?.();
    }

    _bookmarkMutationPageIds(options = {}) {
        const d = this.dash;
        if (Array.isArray(options.pageIds) && options.pageIds.length > 0) {
            return [...new Set(
                options.pageIds
                    .map((id) => Number(id))
                    .filter((id) => Number.isFinite(id) && id > 0)
            )];
        }
        const single = Number(options.pageId ?? d.currentPageId);
        return Number.isFinite(single) && single > 0 ? [single] : [];
    }

    repaintBookmarkMutationSurfaces({ animate = false, refreshHealthReport = true, despiteModal = false } = {}) {
        const d = this.dash;

        d.config?.repaintBookmarksFilters?.();
        d.config?.repaintBookmarksList?.();

        // Not `incremental: false`. Every add/edit/delete/move/tag change comes
        // through here, and forcing the full rebuild threw away the grid, every
        // DragReorder instance, the scroll position and the focused row for
        // what is usually a single changed row. The incremental path decides
        // for itself: canAttemptDataPatch() bails on a layout-settings change
        // and categoryStructureMatches() bails when categories were added,
        // removed or reordered, both falling through to the full render below.
        const renderOpts = { animate, despiteModal };

        if (d.activeView === 'health' && d.health?.isEnabled?.()) {
            if (d.isInlineEditActive() && !despiteModal) {
                return;
            }
            if (refreshHealthReport && typeof d.health.loadAndRender === 'function') {
                void d.health.loadAndRender({ refresh: true });
            } else {
                d.health.render?.();
            }
            return;
        }
        if (d.activeView === 'inbox' && d.inbox?.isEnabled?.()) {
            if (d.isInlineEditActive() && !despiteModal) {
                return;
            }
            d.inbox.render?.();
            return;
        }
        if (d.activeView === 'config' && d.config?.isEnabled?.()) {
            if (d.isInlineEditActive() && !despiteModal) {
                return;
            }
            d.config.render?.();
            return;
        }
        d.renderDashboard?.(renderOpts);
    }

    /**
     * Refresh dashboard data after a bookmark was added/updated on a page.
     * Invalidates the per-page cache so category columns match smart collections.
     */
    async refreshAfterBookmarkAdded(pageId, options = {}) {
        return this.refreshAfterBookmarkMutation({ ...options, pageId });
    }

    async saveSettings() {
        const d = this.dash;
        try {
            const payload = typeof sanitizeSettingsForPersist === 'function'
                ? sanitizeSettingsForPersist(d.settings)
                : d.settings;
            const response = await dashFetch('/api/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            
            if (!response.ok) {
                throw new Error('Failed to save settings');
            }

            // The server drops collections it cannot store — no name, or no
            // rule with a value — and used to do so behind a plain "success",
            // so the row stayed on screen and was gone after a reload with
            // nothing said. Report it instead.
            //
            // Reporting only: the row is deliberately left on screen. A
            // half-filled collection is the normal state between clicking "Add
            // collection" and typing the rule value, and removing it there
            // would take the editor away mid-edit.
            try {
                const body = await response.clone().json();
                const dropped = Array.isArray(body?.droppedCollections) ? body.droppedCollections : [];
                if (dropped.length) {
                    d._droppedCollections = dropped;
                }
            } catch { /* a body we cannot read must not fail an accepted save */ }


            // Also save device-local subset when device-specific is enabled.
            // The server already accepted the settings by this point, so a failure
            // here (private mode, quota exceeded) must not surface as "failed to
            // save" — that would tell the user their change was lost when it was
            // not. The device-local copy is a mirror, not the source of truth.
            try {
                const deviceSpecific = window.DeviceSettingsMerge?.isDeviceSpecificEnabled?.() === true
                    || localStorage.getItem('deviceSpecificSettings') === 'true';
                if (deviceSpecific && window.DeviceSettingsMerge?.saveDeviceLocalSettings) {
                    window.DeviceSettingsMerge.saveDeviceLocalSettings(payload);
                } else if (deviceSpecific) {
                    localStorage.setItem('dashboardSettings', JSON.stringify(payload));
                }
            } catch (storageError) {
                console.warn('Device-local settings mirror failed:', storageError);
            }
            void d.inbox?.bootstrap?.();
            // Other tabs hold their own copy of settings; tell them it moved.
            d.configSync?.publishConfigSync?.('settings');
            return true;
        } catch (error) {
            console.warn('Save settings failed:', error);
            d.showErrorNotification(
                d.formatDashboardLabel('saveSettingsFailed', {}, 'Failed to save settings.')
            );
            // Reported here as before, and also returned so a caller that wants
            // to say something of its own can tell success from failure — the
            // swallowed rejection made every save look like it worked.
            return false;
        }
    }
}

window.DashboardData = DashboardData;
