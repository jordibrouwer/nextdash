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
        const d = this.dash;
        return window.BookmarkUrlUtils?.safeHttpResourceUrl?.(url) || '';
    }

    samePageId(a, b) {
        const d = this.dash;
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

    _smartCollectionFilterNeedsCrossPageData(pageIds) {
        const d = this.dash;
        const currentPageId = Number(d.currentPageId);
        const currentPageIndex = d.pages.findIndex((page) => Number(page.id) === currentPageId);
        const currentPageNumber = currentPageIndex >= 0 ? (currentPageIndex + 1) : null;
        if (!Array.isArray(pageIds) || pageIds.length === 0) {
            return true;
        }
        const normalizedIds = pageIds
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0);
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
        const d = this.dash;
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
            if (typeof d.settings.pasteUrlQuickAdd === 'undefined') {
                d.settings.pasteUrlQuickAdd = true;
            }
            if (typeof d.settings.showHealthDashboard === 'undefined') {
                d.settings.showHealthDashboard = true;
            }
            if (typeof d.settings.showAddBookmarkButton === 'undefined') {
                d.settings.showAddBookmarkButton = true;
            }
            if (typeof d.settings.showTips === 'undefined') {
                d.settings.showTips = false;
            }

            if (typeof d.settings.showLinkPreviewCards === 'undefined') {
                d.settings.showLinkPreviewCards = false;
            }
            if (![100, 150, 250].includes(Number(d.settings.linkPreviewHoverDelayMs))) {
                d.settings.linkPreviewHoverDelayMs = 150;
            }
            if (typeof d.settings.showSyncToasts === 'undefined') {
                d.settings.showSyncToasts = false;
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

                await d.consumeDashboardDeepLink();
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

    _applyLoadedPageData(targetPageId, bookmarks, categories, options = {}) {
        const d = this.dash;
        const { skipRender = false, animate = false } = options;

        d.bookmarks = bookmarks;
        d.categories = this.clonePageCategories(categories);
        d.currentPageId = targetPageId;
        d.refreshButtonTipsOnPageChange?.();

        const pageIndex = d.pages.findIndex((p) => Number(p.id) === targetPageId);
        if (pageIndex !== -1) {
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
                window.scrollTo({ top: 0, behavior: 'instant' });
                d.renderDashboard({ animate });

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

            let bookmarks;
            let categories;
            const cached = !forceFetch ? this.getCachedPageData(targetPageId) : null;
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
            
            // Also save device-local subset when device-specific is enabled
            const deviceSpecific = window.DeviceSettingsMerge?.isDeviceSpecificEnabled?.() === true
                || localStorage.getItem('deviceSpecificSettings') === 'true';
            if (deviceSpecific && window.DeviceSettingsMerge?.saveDeviceLocalSettings) {
                window.DeviceSettingsMerge.saveDeviceLocalSettings(payload);
            } else if (deviceSpecific) {
                localStorage.setItem('dashboardSettings', JSON.stringify(payload));
            }
        } catch (error) {
            d.showErrorNotification(
                d.formatDashboardLabel('saveSettingsFailed', {}, 'Failed to save settings.')
            );
        }
    }
}

window.DashboardData = DashboardData;
