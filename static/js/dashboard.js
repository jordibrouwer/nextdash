// Dashboard JavaScript

// Animation timing constants — adjust here to change the overall animation tempo.
function dashFetch(url, init) {
    return typeof nextDashFetch === 'function' ? nextDashFetch(url, init) : fetch(url, init);
}

const ANIM = Object.freeze({
    BOOKMARK_STAGGER_STEP:  10,   // ms added per bookmark index during enter animation
    CATEGORY_STAGGER_STEP:  16,   // ms added per category index during enter animation
    BOOKMARK_ENTER_BASE:   140,   // ms base delay before first bookmark enter animation clears
    CATEGORY_ENTER_BASE:   150,   // ms base delay before first category enter animation clears
    PAGE_TRANSITION:       250,   // ms page-transition CSS class lifetime
    BOOKMARK_MOVE_IN:      180,   // ms bookmark-move-in animation duration after reorder
    STALE_FLASH:          2200,   // ms stale-bookmark highlight flash duration
});


const _sessionTags = new Set();

class Dashboard {
    constructor() {
        this.bookmarks = [];
        this._bookmarksReady = false;
        /** All pages — search / global shortcuts; not for getRecentBookmarks (page-local recent UX). */
        this.allBookmarks = [];
        this.finders = [];
        this.categories = [];
        this.collapsedCategories = {};
        this.pages = [];
        this.currentPageId = 'default';
        this.settings = {
            currentPage: 'default',
            theme: 'moss-stone-dark',
            openInNewTab: true,
            columnsPerRow: 3,
            fontSize: 'm',
            showBackgroundDots: true,
            showTitle: true,
            showDate: true,
            showTime: true,
            timeFormat: '24h',
            showConfigButton: true,
            showHealthDashboard: true,
            showRecentButton: false,

            showSyncToasts: false,
            showCheatSheetButton: false,
            showAddBookmarkButton: true,
            showStatus: true,
            colorizeStatus: true,
            showPing: true,
            statusOfflineRetries: 3,
            statusOfflineRetryDelayMs: 450,
            statusRecheckIntervalMinutes: 5,
            globalShortcuts: true,
            hyprMode: false,
            enableCustomFavicon: false,
            customFaviconPath: '',
            themeIconStyling: {},
            language: 'en',
            interleaveMode: false,
            showPageTabs: true,
            enableFuzzySuggestions: false,
            fuzzySuggestionsStartWith: false,
            keepSearchOpenWhenEmpty: false,
            showIcons: true,
            showLinkPreviewCards: false,
            linkPreviewHoverDelayMs: 150,
            categorySortModesMigrated: true,
            layoutPreset: 'default',
            layoutVersion: 'classic',
            densityMode: 'compact',
            packedColumns: true,
            backgroundOpacity: 1,
            fontWeight: 'normal',
            fontPreset: 'source-code-pro',
            autoDarkMode: true,
            showSmartRecentCollection: false,
            showSmartTodayCollection: true,
            showSmartStaleCollection: false,
            showSmartMostUsedCollection: false,
            smartTodayLimit: 8,
            smartRecentLimit: 50,
            smartStaleLimit: 50,
            smartMostUsedLimit: 25,
            categoryItemLimit: 15,
            smartTodayWorkKeywords: 'calendar,mail,gmail,outlook,notion,docs,drive,github,gitlab,jira,slack,teams',
            smartTodayEveningKeywords: 'youtube,spotify,netflix,reddit',
            smartTodayWeekendKeywords: 'news,weather,maps',
            smartTodayPageIds: [],
            smartRecentPageIds: [],
            smartStalePageIds: [],
            smartMostUsedPageIds: [],
            dateFormat: 'short-slash',
            showWeatherWithDate: false,
            weatherSource: 'manual',
            weatherLocation: '',
            weatherUnit: 'celsius',
            weatherRefreshMinutes: 30,
            showShortcuts: true,
            showPinIcon: false,
            showNoteIcon: true
        };
        // Ensure any active preview is removed when navigating away; warn if inline edit is active
        window.addEventListener('beforeunload', (e) => {
            try { this.dismissBookmarkPreviewInteractions(); } catch (_e) {}
            if (this.inlineEditingBookmarkIndex !== null) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
        window.addEventListener('pagehide', (event) => {
            this.flushPendingDashboardSavesOnExit();
            if (event.persisted) {
                return;
            }
            this.teardownDashboardTimers();
            this.keyboardNavigation?.cleanup?.();
            this.swipeNavigation?.cleanup?.();
            window.DashboardTagCloud?.destroy?.();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                void this.flushPendingDashboardSaves();
                return;
            }
            this.renderDateWeatherLine();
            this.updateHealthBadge();
            this.inbox?.restoreViewIfNeeded?.();
            this.health?.restoreViewIfNeeded?.();
            this.maybeRefreshAfterConfigReturn();
        });
        this.searchComponent = null;
        this.statusMonitor = null;
        this.statusMonitorInitialized = false;
        this.keyboardNavigation = null;
        this.swipeNavigation = null;
        this.categoryReorderInstances = [];
        this.dashboardCategoryReorderInstances = [];
        this._categoryListsCache = null;
        this._tagFilters = [];
        this._categoryDragRelayHandler = null;
        this._categoryDropHandler = null;
        this._pendingCategoryOrderFromDrop = null;
        this._pendingCategorySave = null;
        this._categoryOrderSaveInFlight = null;
        this.pendingReorderSave = null;
        this.pendingReorderSnapshot = null;
        this._bookmarkOrderSaveInFlight = null;
        this.pendingPreviewSave = null;
        this._movePopoverCleanup = null;
        this._deletePopoverCleanup = null;
        this.notificationTimeout = null;
        this.structureSyncEventKey = 'nextdash:config-structure-sync';
        this.settingsSyncEventKey = 'nextdash:config-settings-sync';
        this.pendingStructureSyncKey = 'nextdash:pending-dashboard-structure-sync';
        this.pendingSettingsSyncKey = 'nextdash:pending-dashboard-settings-sync';
        this.tabId = `dash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.lastSyncToastAt = 0;
        this.lastAppliedStructureSyncAt = 0;
        this.lastAppliedSettingsSyncAt = 0;
        this._configRefreshReady = false;
        this._configReturnRefreshInFlight = false;
        this._pageBookmarksLoadId = 0;
        /** @type {Map<number, { bookmarks: object[], categories: object[], cachedAt: number }>} */
        this._pageDataCache = new Map();
        this._pagePrefetchInFlight = new Set();
        this.language = new ConfigLanguage();
        this.data = new DashboardData(this);
        this.configSync = new DashboardConfigSync(this);
        this.pageNav = new DashboardPageNav(this);
        this.tagFilter = new DashboardTagFilter(this);
        this.inlineEdit = new DashboardInlineEdit(this);
        this.toolbar = new DashboardToolbar(this);
        this.smartCollections = new DashboardSmartCollections(this);
        this.bookmarkRows = new DashboardBookmarkRows(this);
        this.renderCore = new DashboardRenderCore(this);
        this.renderIncremental = new DashboardRenderIncremental(this);
        this.notifications = new DashboardNotifications(this);
        this.visual = new DashboardVisual(this);
        this.dateWeather = new DashboardDateWeather(this);
        this.preview = new DashboardPreview(this);
        this.recent = new DashboardRecent(this);
        this.promos = new DashboardPromos(this);
        this.uiHelpers = new DashboardUiHelpers(this);
        this.contextMenu = new DashboardContextMenu(this);
        this.setup = new DashboardSetup(this);
        this.persistence = new DashboardPersistence(this);
        this.inbox = new DashboardInbox(this);
        this.health = typeof DashboardHealth === 'function' ? new DashboardHealth(this) : null;
        this.config = typeof DashboardConfig === 'function' ? new DashboardConfig(this) : null;
        this.pasteChoice = new DashboardPasteChoice(this);
        this.activeView = 'bookmarks';
        this.weatherService = typeof window.WeatherService === 'function' ? new window.WeatherService() : null;
        this.weatherRefreshTimer = null;
        this.dateTimeRefreshTimer = null;
        this.weatherData = null;
        this.weatherLastError = null;
        this.inlineEditingBookmarkIndex = null;
        this.onboardingStartedInSession = false;
        this._postOnboardingPromptsTimer = null;
        this._postOnboardingPromptsAttempts = 0;
        this._postOnboardingWhatsNewAbortAttempts = 0;
        this.init();
    }
    
    createNoteBadgeSvg() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.innerHTML = `
            <path d="M7.5 4.75h7l3.75 3.75V19A1.25 1.25 0 0 1 17 20.25H7A1.25 1.25 0 0 1 5.75 19V6A1.25 1.25 0 0 1 7 4.75Z"></path>
            <path d="M14.5 4.75V8.5h3.75"></path>
            <path d="M8.75 11h6.5"></path>
            <path d="M8.75 14h5.25"></path>
        `;
        return svg;
    }



    isCoarsePointer() {
        return window.matchMedia('(hover: none) and (pointer: coarse)').matches
            || window.matchMedia('(max-width: 768px)').matches;
    }

    async init() {
        try {
            await this.loadData();
            this.applyVisualSettings();
            this.initializeAutoDarkMode();
            this.loadCollapsedStates();
            await this.language.init(this.settings.language);
            // Expose instance before mobile banner / i18n helpers (refresh runs before status monitor).
            window.dashboardInstance = this;
            window.MobileExperience?.initDashboard?.();
            this.setupDOM();
            this.initializeSearchComponent();
            this.initializeStatusMonitor();
            window.MobileExperience?.refreshBannerTranslations?.();
            this.initializeKeyboardNavigation();
            this.initializeSwipeNavigation();
            this.initializeHyprMode();
            this.renderPageNavigation();
            void this.inbox.loadItems().then(() => {
                this.pageNav?.updateInboxTabBadge?.();
            });
            this.renderDashboard({ animate: true });
            this.setupPageShortcuts();
            this.setupTagFilterEscapeShortcut();
            this.setupTagFilterIndicator();
            this.setupReorderUndoShortcut();
            this.setupPasteToQuickAdd();
            this.inbox.setupEscapeShortcut();
            this.health?.setupEscapeShortcut();
            this.config?.setupEscapeShortcut();
            if (typeof QuickAddWidget === 'function') {
                this.quickAddWidget = new QuickAddWidget(this);
            }
            this.setupToolbarActions();
            window.DashboardTagCloud?.init?.();
            this.refreshAddBookmarkToolbarLabel();
            this.setupHeaderEnhancements();
            this.setupConfigStructureReloadListener();
            this.setupConfigReturnRefreshListener();
            this.setupDataRevisionListener();
            this.setupExtensionBookmarkSavedListener();

            this.analytics = new BookmarkAnalytics();
            this.setupBookmarkTracking();

            window.addEventListener('hashchange', () => {
                const hash = window.location.hash.substring(1);
                if (hash === 'inbox') {
                    if (this.activeView !== 'inbox') {
                        void this.inbox?.openInboxView?.();
                    }
                    return;
                }
                if (hash === 'health') {
                    if (this.activeView !== 'health') {
                        void this.health?.openHealthView?.();
                    }
                    return;
                }
                if (hash === 'config' || hash.startsWith('config/')) {
                    if (this.activeView !== 'config') {
                        void this.config?.openConfigView?.();
                    } else {
                        this.config?.restoreConfigSectionFromHash?.();
                    }
                    return;
                }
                if (hash && /^\d+$/.test(hash)) {
                    if (this.activeView === 'inbox') {
                        this.inbox?.restoreInboxHash?.();
                        return;
                    }
                    if (this.activeView === 'health') {
                        this.health?.restoreHealthHash?.();
                        return;
                    }
                    const pageIndex = parseInt(hash) - 1;
                    if (pageIndex >= 0 && pageIndex < this.pages.length) {
                        const page = this.pages[pageIndex];
                        if (!this.samePageId(page.id, this.currentPageId)) {
                            void this.requestPageNavigation(page.id);
                        }
                    }
                }
            });

            this._configRefreshReady = true;
            await this.reconcilePendingConfigSyncAfterLoad();

            this.updateMiniStatusLine();
            // Feature-adoption snapshot, once settings are resolved.
            window.nextdashTrackSettings?.(this.settings);
            this.initializeOnboarding();
            if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() !== false && !this.onboardingStartedInSession) {
                this.schedulePostOnboardingPrompts({ delay: 900, resetAttempts: true });
            }
        } catch (error) {
            this._renderBootstrapFatalError();
            return;
        } finally {
            if (window.SkeletonLoading && typeof window.SkeletonLoading.finish === 'function') {
                window.SkeletonLoading.finish();
            } else {
                document.body.classList.remove('loading');
            }
        }
    }

    _renderBootstrapFatalError() {
        window.dashboardInstance = this;
        const container = document.getElementById('dashboard-layout');
        if (!container) {
            return;
        }
        container.setAttribute('aria-busy', 'false');
        container.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'empty-state dashboard-bootstrap-error';
        wrap.setAttribute('role', 'alert');

        const message = document.createElement('p');
        message.className = 'empty-state-text';
        message.textContent = this.formatDashboardLabel(
            'loadFailed',
            {},
            'Failed to load dashboard. Please reload the page.'
        );
        wrap.appendChild(message);

        const reloadBtn = document.createElement('button');
        reloadBtn.type = 'button';
        reloadBtn.className = 'empty-state--category-btn';
        reloadBtn.textContent = this.formatDashboardLabel('reloadPage', {}, 'Reload page');
        reloadBtn.addEventListener('click', () => window.location.reload());
        wrap.appendChild(reloadBtn);

        container.appendChild(wrap);
    }



    showNotification(message, type = 'error', { undoCallback = null, duration = 5000, onAction = null, actionLabel = null, durationMs = null } = {}) {
        return this.notifications.showNotification(...arguments);
    }

    showGroupedNotification(key, count, buildMessage, type = 'success', options = {}) {
        return this.notifications.showGroupedNotification(...arguments);
    }

    showErrorNotification(message, options = {}) {
        return this.notifications.showErrorNotification(...arguments);
    }

    tDashboard(key, fallback = '') {
        return this.notifications.tDashboard(...arguments);
    }

    tConfig(key, fallback = '') {
        return this.notifications.tConfig(...arguments);
    }

    notifyDashboard(key, fallback, type = 'success', options = {}) {
        return this.notifications.notifyDashboard(...arguments);
    }

    notifyConfig(key, fallback, type = 'success', options = {}) {
        return this.notifications.notifyConfig(...arguments);
    }

    applyVisualSettings() {
        return this.visual.applyVisualSettings(...arguments);
    }

    applyBackground() {
        return this.visual.applyBackground(...arguments);
    }

    initializeAutoDarkMode() {
        return this.visual.initializeAutoDarkMode(...arguments);
    }

    getPairedThemeVariant(themeId, wantsDark) {
        return this.visual.getPairedThemeVariant(...arguments);
    }

    applyFontSize() {
        return this.visual.applyFontSize(...arguments);
    }

    applyBackgroundDots() {
        return this.visual.applyBackgroundDots(...arguments);
    }

    applyAnimations() {
        return this.visual.applyAnimations(...arguments);
    }

    updateTitleVisibility() {
        return this.visual.updateTitleVisibility(...arguments);
    }

    updateConfigButtonVisibility() {
        return this.visual.updateConfigButtonVisibility(...arguments);
    }

    updateHealthDashboardVisibility() {
        return this.visual.updateHealthDashboardVisibility(...arguments);
    }

    async updateHealthBadge() {
        return this.visual.updateHealthBadge(...arguments);
    }

    updatePageTabsVisibility() {
        return this.visual.updatePageTabsVisibility(...arguments);
    }

    updateDateVisibility() {
        return this.visual.updateDateVisibility(...arguments);
    }

    shouldRenderDateBlock() {
        return this.visual.shouldRenderDateBlock(...arguments);
    }

    clearDateTimeRefreshTimer() {
        return this.dateWeather.clearDateTimeRefreshTimer(...arguments);
    }

    scheduleDateTimeRefresh() {
        return this.dateWeather.scheduleDateTimeRefresh(...arguments);
    }

    clearWeatherRefreshTimer() {
        return this.dateWeather.clearWeatherRefreshTimer(...arguments);
    }

    scheduleWeatherRefresh() {
        return this.dateWeather.scheduleWeatherRefresh(...arguments);
    }

    formatDateLine(date) {
        return this.dateWeather.formatDateLine(...arguments);
    }

    formatTimeLine(date) {
        return this.dateWeather.formatTimeLine(...arguments);
    }

    renderDateWeatherLine() {
        return this.dateWeather.renderDateWeatherLine(...arguments);
    }

    showDatePopover() {
        return this.dateWeather.showDatePopover(...arguments);
    }

    formatWeatherText(weatherData) {
        return this.dateWeather.formatWeatherText(...arguments);
    }

    getWeatherIconMarkup(weatherCode) {
        return this.dateWeather.getWeatherIconMarkup(...arguments);
    }

    getWeatherConditionLabel(weatherCode) {
        return this.dateWeather.getWeatherConditionLabel(...arguments);
    }

    async refreshWeather(forceRefresh = false) {
        return this.dateWeather.refreshWeather(...arguments);
    }

    attachBookmarkPreviewBehavior(openLink, bookmark) {
        return this.preview.attachBookmarkPreviewBehavior(...arguments);
    }

    scheduleHideBookmarkPreviewCard() {
        return this.preview.scheduleHideBookmarkPreviewCard(...arguments);
    }

    async fetchBookmarkPreviewData(openLink, bookmark, { forceRefresh = false } = {}) {
        return this.preview.fetchBookmarkPreviewData(...arguments);
    }

    persistBookmarkPreviewMetadata(bookmark) {
        return this.preview.persistBookmarkPreviewMetadata(...arguments);
    }

    async refreshVisibleBookmarkPreview() {
        return this.preview.refreshVisibleBookmarkPreview(...arguments);
    }

    extractDomainFromUrl(url) {
        return this.preview.extractDomainFromUrl(...arguments);
    }

    formatPreviewLastOpened(diffDays) {
        return this.preview.formatPreviewLastOpened(...arguments);
    }

    formatPreviewUsageText(openCount, lastOpened) {
        return this.preview.formatPreviewUsageText(...arguments);
    }

    ensureBookmarkPreviewCard() {
        return this.preview.ensureBookmarkPreviewCard(...arguments);
    }

    showBookmarkPreviewCard(preview, event, context = null) {
        return this.preview.showBookmarkPreviewCard(...arguments);
    }

    positionBookmarkPreviewCard(clientX, clientY) {
        return this.preview.positionBookmarkPreviewCard(...arguments);
    }

    hideBookmarkPreviewCard() {
        return this.preview.hideBookmarkPreviewCard(...arguments);
    }

    dismissBookmarkPreviewInteractions() {
        return this.preview.dismissBookmarkPreviewInteractions(...arguments);
    }

    getRecentBookmarksWithUrls(bookmarks, limit) {
        return this.recent.getRecentBookmarksWithUrls(...arguments);
    }

    sameBookmarkList(a, b) {
        return this.recent.sameBookmarkList(...arguments);
    }

    buildOpenTabsPlans(bookmarks, labelKeys) {
        return this.recent.buildOpenTabsPlans(...arguments);
    }

    openBookmarksInNewTabs(bookmarks) {
        return this.recent.openBookmarksInNewTabs(...arguments);
    }

    safeHttpBookmarkHref(raw) {
        return this.recent.safeHttpBookmarkHref(...arguments);
    }

    isRecentBookmarksModalOpen() {
        return this.recent.isRecentBookmarksModalOpen(...arguments);
    }

    toggleRecentBookmarksModal() {
        return this.recent.toggleRecentBookmarksModal(...arguments);
    }

    _fillRecentBookmarksModal() {
        return this.recent._fillRecentBookmarksModal(...arguments);
    }

    _setupRecentModalKeyboardNav(body) {
        return this.recent._setupRecentModalKeyboardNav(...arguments);
    }

    _cleanupRecentModalKeyHandler() {
        return this.recent._cleanupRecentModalKeyHandler(...arguments);
    }

    getRecentBookmarks(bookmarks, limit = 10) {
        return this.recent.getRecentBookmarks(...arguments);
    }

    buildBookmarkTooltip(bookmark, previewTitle, previewDescription) {
        return this.recent.buildBookmarkTooltip(...arguments);
    }

    recordBookmarkOpened(bookmark, bookmarkIndex) {
        return this.recent.recordBookmarkOpened(...arguments);
    }

    canShowPostOnboardingPrompts() {
        return this.promos.canShowPostOnboardingPrompts(...arguments);
    }

    shouldShowWhatsNewPrompt() {
        return this.promos.shouldShowWhatsNewPrompt(...arguments);
    }

    schedulePostOnboardingPrompts(options = {}) {
        return this.promos.schedulePostOnboardingPrompts(...arguments);
    }

    runPostOnboardingPrompts(options = {}) {
        return this.promos.runPostOnboardingPrompts(...arguments);
    }

    maybeShowWhatsNew() {
        return this.promos.maybeShowWhatsNew(...arguments);
    }

    showWhatsNewModal(options = {}) {
        return this.promos.showWhatsNewModal(...arguments);
    }

    initializeOnboarding() {
        return this.promos.initializeOnboarding(...arguments);
    }


    formatDashboardLabel(key, replacements = {}, fallback = '') {
        return this.uiHelpers.formatDashboardLabel(...arguments);
    }

    configLabel(key, fallback = '') {
        return this.uiHelpers.configLabel(...arguments);
    }

    bookmarkFallbackName() {
        return this.uiHelpers.bookmarkFallbackName(...arguments);
    }

    escapeHtml(value) {
        return this.uiHelpers.escapeHtml(...arguments);
    }



    isVisibleBlockingOverlay(el) {
        return this.uiHelpers.isVisibleBlockingOverlay(...arguments);
    }

    isModalOpen() {
        return this.uiHelpers.isModalOpen(...arguments);
    }

    getKeyboardCheatSheetItems() {
        return this.uiHelpers.getKeyboardCheatSheetItems(...arguments);
    }

    showKeyboardCheatSheet() {
        return this.uiHelpers.showKeyboardCheatSheet(...arguments);
    }

    async showPageOverlay() {
        return this.uiHelpers.showPageOverlay(...arguments);
    }

    showOmnibox() {
        return this.uiHelpers.showOmnibox(...arguments);
    }

    setupDOM() {
        return this.setup.setupDOM(...arguments);
    }

    getHeaderContainer() {
        return this.setup.getHeaderContainer(...arguments);
    }

    initializeSearchComponent() {
        return this.setup.initializeSearchComponent(...arguments);
    }

    updateSearchComponent() {
        return this.setup.updateSearchComponent(...arguments);
    }

    applyFindFilter(query) {
        return this.setup.applyFindFilter(...arguments);
    }

    initializeStatusMonitor() {
        return this.setup.initializeStatusMonitor(...arguments);
    }

    initializeKeyboardNavigation() {
        return this.setup.initializeKeyboardNavigation(...arguments);
    }

    initializeSwipeNavigation() {
        return this.setup.initializeSwipeNavigation(...arguments);
    }

    _updatePageSwipeHint() {
        return this.setup._updatePageSwipeHint(...arguments);
    }

    initializeHyprMode() {
        return this.setup.initializeHyprMode(...arguments);
    }

    updateStatusMonitor() {
        return this.setup.updateStatusMonitor(...arguments);
    }

    setupPageShortcuts() {
        return this.setup.setupPageShortcuts(...arguments);
    }

    setupExtensionBookmarkSavedListener() {
        return this.setup.setupExtensionBookmarkSavedListener(...arguments);
    }

    initializeButtonTipsRotation() {
        return this.setup.initializeButtonTipsRotation(...arguments);
    }

    teardownDashboardTimers() {
        return this.setup.teardownDashboardTimers(...arguments);
    }


    initializeSearchFlowHint() {
        return this.setup.initializeSearchFlowHint(...arguments);
    }




    getInlineContextTipsForCurrentPage() {
        return this.setup.getInlineContextTipsForCurrentPage(...arguments);
    }

    setupBookmarkTracking() {
        return this.setup.setupBookmarkTracking(...arguments);
    }

    async flushPendingDashboardSaves() {
        return this.persistence.flushPendingDashboardSaves(...arguments);
    }

    async flushPendingPreviewSave() {
        return this.persistence.flushPendingPreviewSave(...arguments);
    }

    flushPendingDashboardSavesOnExit() {
        return this.persistence.flushPendingDashboardSavesOnExit(...arguments);
    }

    async saveBookmarkPreviewMetadataNow() {
        return this.persistence.saveBookmarkPreviewMetadataNow(...arguments);
    }

    async saveBookmarkOrder(options = {}) {
        return this.persistence.saveBookmarkOrder(...arguments);
    }

    safeBookmarkOpenHref(url) {
        return this.data.safeBookmarkOpenHref(...arguments);
    }

    samePageId(a, b) {
        return this.data.samePageId(...arguments);
    }

    /**
     * True when the bookmark grid for a page is on screen, rather than one of the
     * full-container views (inbox, health). Prefer this over `activeView !== 'inbox'`:
     * that phrasing quietly means "bookmarks" and grows wrong with each new view.
     */
    isBookmarksView() {
        return this.activeView === 'bookmarks';
    }

    needsCrossPageBookmarks() {
        return this.data.needsCrossPageBookmarks(...arguments);
    }

    needsCrossPageBookmarksAtStartup() {
        return this.data.needsCrossPageBookmarksAtStartup(...arguments);
    }

    shouldDeferCrossPageBookmarksLoad() {
        return this.data.shouldDeferCrossPageBookmarksLoad(...arguments);
    }

    _smartCollectionFilterNeedsCrossPageData(pageIds) {
        return this.data._smartCollectionFilterNeedsCrossPageData(...arguments);
    }

    deferredLoadAllBookmarks() {
        return this.data.deferredLoadAllBookmarks(...arguments);
    }

    async withRetry(task, retries = 2, baseDelayMs = 220) {
        return this.data.withRetry(...arguments);
    }

    async loadData() {
        return this.data.loadData(...arguments);
    }

    loadCollapsedStates() {
        return this.data.loadCollapsedStates(...arguments);
    }

    saveCollapsedStates() {
        return this.data.saveCollapsedStates(...arguments);
    }

    isCurrentPageBookmarksLoad(loadId) {
        return this.data.isCurrentPageBookmarksLoad(...arguments);
    }

    async loadPageBookmarks(pageId, options = {}) {
        return this.data.loadPageBookmarks(...arguments);
    }

    async loadAllBookmarks(options = {}) {
        return this.data.loadAllBookmarks(...arguments);
    }

    async saveSettings() {
        return this.data.saveSettings(...arguments);
    }
    setupConfigStructureReloadListener() {
        return this.configSync.setupConfigStructureReloadListener(...arguments);
    }

    setupConfigReturnRefreshListener() {
        return this.configSync.setupConfigReturnRefreshListener(...arguments);
    }

    setupDataRevisionListener() {
        return this.configSync.setupDataRevisionListener(...arguments);
    }

    restoreDashboardInteractionAfterBfcache() {
        return this.configSync.restoreDashboardInteractionAfterBfcache(...arguments);
    }

    readPendingConfigSync(key) {
        return this.configSync.readPendingConfigSync(...arguments);
    }

    markPendingConfigSyncAsAppliedAfterLoad() {
        return this.configSync.markPendingConfigSyncAsAppliedAfterLoad(...arguments);
    }

    async reconcilePendingConfigSyncAfterLoad() {
        return this.configSync.reconcilePendingConfigSyncAfterLoad(...arguments);
    }

    async maybeRefreshAfterConfigReturn() {
        return this.configSync.maybeRefreshAfterConfigReturn(...arguments);
    }

    showSyncToast(message) {
        return this.configSync.showSyncToast(...arguments);
    }

    async refreshAfterConfigStructureUpdate(payload = {}) {
        return this.configSync.refreshAfterConfigStructureUpdate(...arguments);
    }

    async refreshAfterConfigSettingsUpdate(payload = {}) {
        return this.configSync.refreshAfterConfigSettingsUpdate(...arguments);
    }

    async requestPageNavigation(pageId) {
        return this.pageNav.requestPageNavigation(...arguments);
    }

    updatePageTitle(pageName) {
        return this.pageNav.updatePageTitle(...arguments);
    }

    updateDocumentTitle() {
        return this.pageNav.updateDocumentTitle(...arguments);
    }

    allowsPageTabInlineEdit() {
        return this.pageNav.allowsPageTabInlineEdit(...arguments);
    }

    setActivePageNavButton(pageId) {
        return this.pageNav.setActivePageNavButton(...arguments);
    }

    renderPageNavigation() {
        return this.pageNav.renderPageNavigation(...arguments);
    }

    _renderPageTabContent(btn, page, index) {
        return this.pageNav._renderPageTabContent(...arguments);
    }

    _positionPageTabPopover(popover, anchorEl, { initial = false } = {}) {
        return this.pageNav._positionPageTabPopover(...arguments);
    }

    _startPageTabRename(btn, page, index) {
        return this.pageNav._startPageTabRename(...arguments);
    }

    async consumeDashboardDeepLink() {
        return this.pageNav.consumeDashboardDeepLink(...arguments);
    }

    expandCategoryForDeepLink(categoryId) {
        return this.pageNav.expandCategoryForDeepLink(...arguments);
    }

    findBookmarkRowForDeepLink(link) {
        return this.pageNav.findBookmarkRowForDeepLink(...arguments);
    }

    focusDashboardDeepLinkTarget(link) {
        return this.pageNav.focusDashboardDeepLinkTarget(...arguments);
    }

    normalizeTagFilters(tags) {
        return this.tagFilter.normalizeTagFilters(...arguments);
    }

    tagFiltersKey(tags) {
        return this.tagFilter.tagFiltersKey(...arguments);
    }

    tagFiltersEqual(a, b) {
        return this.tagFilter.tagFiltersEqual(...arguments);
    }

    hasActiveTagFilters(tags = this._tagFilters) {
        return this.tagFilter.hasActiveTagFilters(...arguments);
    }

    formatTagFilterTagsLabel(tags = this._tagFilters) {
        return this.tagFilter.formatTagFilterTagsLabel(...arguments);
    }

    formatTagFilterTagsListForMessage(tags = this._tagFilters) {
        return this.tagFilter.formatTagFilterTagsListForMessage(...arguments);
    }

    _syncTagFilterDomAttributes() {
        return this.tagFilter._syncTagFilterDomAttributes(...arguments);
    }

    async setTagFilters(tags, { animate = true } = {}) {
        return this.tagFilter.setTagFilters(...arguments);
    }

    async toggleTagFilter(tag, { animate = true } = {}) {
        return this.tagFilter.toggleTagFilter(...arguments);
    }

    async removeTagFilter(tag, { animate = true } = {}) {
        return this.tagFilter.removeTagFilter(...arguments);
    }

    clearTagFilter() {
        return this.tagFilter.clearTagFilter(...arguments);
    }

    getBookmarksForTagFilters(tags = this._tagFilters) {
        return this.tagFilter.getBookmarksForTagFilters(...arguments);
    }

    getBookmarksForTagFilter(tag) {
        return this.tagFilter.getBookmarksForTagFilter(...arguments);
    }

    renderTagFilterDashboard(container, options = {}) {
        return this.tagFilter.renderTagFilterDashboard(...arguments);
    }

    setupTagFilterEscapeShortcut() {
        return this.tagFilter.setupTagFilterEscapeShortcut(...arguments);
    }

    setupTagFilterIndicator() {
        return this.tagFilter.setupTagFilterIndicator(...arguments);
    }

    formatTagFilterCountLabel(count) {
        return this.tagFilter.formatTagFilterCountLabel(...arguments);
    }

    getTagFilterMatchedBookmarksWithUrls() {
        return this.tagFilter.getTagFilterMatchedBookmarksWithUrls(...arguments);
    }

    buildTagFilterOpenPlans() {
        return this.tagFilter.buildTagFilterOpenPlans(...arguments);
    }

    copyTagFilterLinksToClipboard() {
        return this.tagFilter.copyTagFilterLinksToClipboard(...arguments);
    }

    getTagFilterBookmarkRefs() {
        return this.tagFilter.getTagFilterBookmarkRefs(...arguments);
    }

    async bulkDeleteTagFilterBookmarks() {
        return this.tagFilter.bulkDeleteTagFilterBookmarks(...arguments);
    }

    bulkMoveTagFilterToCategory(categoryId) {
        return this.tagFilter.bulkMoveTagFilterToCategory(...arguments);
    }

    async bulkMoveTagFilterToPage(targetPageId) {
        return this.tagFilter.bulkMoveTagFilterToPage(...arguments);
    }

    showTagFilterBulkMovePopover(anchorEl) {
        return this.tagFilter.showTagFilterBulkMovePopover(...arguments);
    }

    _appendTagFilterToolbarButton(actions, { label, className = '', onClick }) {
        return this.tagFilter._appendTagFilterToolbarButton(...arguments);
    }

    renderTagFilterBanner(wrap, { tags, count = 0 } = {}) {
        return this.tagFilter.renderTagFilterBanner(...arguments);
    }

    updateTagFilterIndicator() {
        return this.tagFilter.updateTagFilterIndicator(...arguments);
    }

    _distributeTagFilterColumnBlocks(container, chunkBlocks, { animate = false, gridLayout = null } = {}) {
        return this.tagFilter._distributeTagFilterColumnBlocks(...arguments);
    }

    isInlineEditActive() {
        return this.inlineEdit.isInlineEditActive(...arguments);
    }

    hasInlineEditUnsavedChanges() {
        return this.inlineEdit.hasInlineEditUnsavedChanges(...arguments);
    }

    dismissInlineEditForNavigation() {
        return this.inlineEdit.dismissInlineEditForNavigation(...arguments);
    }

    async confirmInlineEditBeforeNavigation() {
        return this.inlineEdit.confirmInlineEditBeforeNavigation(...arguments);
    }

    _abortInlineEditForRender() {
        return this.inlineEdit._abortInlineEditForRender(...arguments);
    }

    async confirmDiscardInlineEdit() {
        return this.inlineEdit.confirmDiscardInlineEdit(...arguments);
    }

    tryOpenInlineBookmarkEdit() {
        return this.inlineEdit.tryOpenInlineBookmarkEdit(...arguments);
    }

    openBookmarkInlineEditor(row, bookmarkRef) {
        return this.inlineEdit.openBookmarkInlineEditor(...arguments);
    }

    async commitBookmarkInlineEdit(bookmarkRef, fields, row) {
        return this.inlineEdit.commitBookmarkInlineEdit(...arguments);
    }

    cancelBookmarkInlineEdit(row, bookmarkRef) {
        return this.inlineEdit.cancelBookmarkInlineEdit(...arguments);
    }

    enterBookmarkInlineEditFocusMode() {
        return this.inlineEdit.enterBookmarkInlineEditFocusMode(...arguments);
    }

    leaveBookmarkInlineEditFocusMode() {
        return this.inlineEdit.leaveBookmarkInlineEditFocusMode(...arguments);
    }

    hasShortcutConflict(shortcut, bookmarkRef) {
        return this.inlineEdit.hasShortcutConflict(...arguments);
    }

    async uploadBookmarkIconFromUrl(iconUrl) {
        return this.inlineEdit.uploadBookmarkIconFromUrl(...arguments);
    }

    async uploadBookmarkIconFile(file) {
        return this.inlineEdit.uploadBookmarkIconFile(...arguments);
    }

    deriveFaviconFromBookmarkUrl(bookmarkUrl) {
        return this.inlineEdit.deriveFaviconFromBookmarkUrl(...arguments);
    }

    async fetchAndAssignFaviconForUrl(bookmarkUrl) {
        return this.inlineEdit.fetchAndAssignFaviconForUrl(...arguments);
    }

    ensureBookmarkMutationSnapshot() {
        return this.inlineEdit.ensureBookmarkMutationSnapshot(...arguments);
    }

    _shouldSyncBookmarkMutation(bookmarkRef, candidate, previousUrlTrimmed) {
        return this.inlineEdit._shouldSyncBookmarkMutation(...arguments);
    }

    _applyBookmarkMutationFields(target, source) {
        return this.inlineEdit._applyBookmarkMutationFields(...arguments);
    }

    async confirmDeleteBookmarkInline(bookmark) {
        return this.inlineEdit.confirmDeleteBookmarkInline(...arguments);
    }

    async deleteBookmarkInline(bookmarkRef, options = {}) {
        return this.inlineEdit.deleteBookmarkInline(...arguments);
    }

    async deleteBookmarkAtIndexInline(bookmarkRefOrIndex, options = {}) {
        return this.inlineEdit.deleteBookmarkAtIndexInline(...arguments);
    }

    async deleteRemoteBookmarkInline(bookmarkRef, options = {}) {
        return this.inlineEdit.deleteRemoteBookmarkInline(...arguments);
    }

    async saveRemoteBookmarkEdit(bookmarkRef, editedBookmark) {
        return this.inlineEdit.saveRemoteBookmarkEdit(...arguments);
    }

    async _moveBookmarkToPage(bookmarkRef, bookmarkState, targetPageId, row) {
        return this.inlineEdit._moveBookmarkToPage(...arguments);
    }

    attachBookmarkRowLongPress(row, openLink, bookmarkRef, signal) {
        return this.inlineEdit.attachBookmarkRowLongPress(...arguments);
    }

    syncInlineEditCategoryAfterMove(categoryId, affectedRefs = []) {
        return this.inlineEdit.syncInlineEditCategoryAfterMove(...arguments);
    }

    setupToolbarActions() {
        return this.toolbar.setupToolbarActions(...arguments);
    }

    setupToolbarKbdTooltips() {
        return this.toolbar.setupToolbarKbdTooltips(...arguments);
    }

    setupHeaderEnhancements() {
        return this.toolbar.setupHeaderEnhancements(...arguments);
    }

    syncTagCloudButtonPlacement() {
        return this.toolbar.syncTagCloudButtonPlacement(...arguments);
    }

    syncSideRailDiscoverability() {
        return this.toolbar.syncSideRailDiscoverability(...arguments);
    }

    refreshAddBookmarkToolbarLabel() {
        return this.toolbar.refreshAddBookmarkToolbarLabel(...arguments);
    }

    setupReorderUndoShortcut() {
        return this.toolbar.setupReorderUndoShortcut(...arguments);
    }

    setupPasteToQuickAdd() {
        return this.toolbar.setupPasteToQuickAdd(...arguments);
    }

    openEmptyStateAdd() {
        return this.toolbar.openEmptyStateAdd(...arguments);
    }

    openEmptyStateCommand(commandPrefix) {
        return this.toolbar.openEmptyStateCommand(...arguments);
    }

    shouldShowEmptyStateKeyboardActions() {
        return this.toolbar.shouldShowEmptyStateKeyboardActions(...arguments);
    }

    buildEmptyStateAddLabel() {
        return this.toolbar.buildEmptyStateAddLabel(...arguments);
    }

    buildEmptyStateAddHint() {
        return this.toolbar.buildEmptyStateAddHint(...arguments);
    }

    updateMiniStatusLine() {
        return this.toolbar.updateMiniStatusLine(...arguments);
    }

    isTagCloudDesktopShortcutVisible() {
        return this.toolbar.isTagCloudDesktopShortcutVisible(...arguments);
    }

    isTagCloudTipRelevant() {
        return this.toolbar.isTagCloudTipRelevant(...arguments);
    }

    smartCollectionsNeedRefreshAfterOpen() {
        return this.smartCollections.smartCollectionsNeedRefreshAfterOpen(...arguments);
    }

    _sortSmartCollectionBookmarks(collection) {
        return this.smartCollections._sortSmartCollectionBookmarks(...arguments);
    }

    refreshSmartCollectionSections() {
        return this.smartCollections.refreshSmartCollectionSections(...arguments);
    }

    getSmartCollections(bookmarks) {
        return this.smartCollections.getSmartCollections(...arguments);
    }

    _smartWhyT(key, fallback, vars = {}) {
        return this.smartCollections._smartWhyT(...arguments);
    }

    _getCurrentPageDisplayName() {
        return this.smartCollections._getCurrentPageDisplayName(...arguments);
    }

    _formatSmartWhyLimitSuffix(settingsKey, defaultLimit = 0) {
        return this.smartCollections._formatSmartWhyLimitSuffix(...arguments);
    }

    getSmartCollectionWhyHint(collectionId, category = {}) {
        return this.smartCollections.getSmartCollectionWhyHint(...arguments);
    }

    _evaluateCollection(collection, bookmarks) {
        return this.smartCollections._evaluateCollection(...arguments);
    }

    getSmartStartTodayBookmarks(bookmarks) {
        return this.smartCollections.getSmartStartTodayBookmarks(...arguments);
    }

    getSmartStartKeywordBoosts(hour, day) {
        return this.smartCollections.getSmartStartKeywordBoosts(...arguments);
    }

    parseSmartKeywordList(raw, firstBoost = 4, restBoost = 3) {
        return this.smartCollections.parseSmartKeywordList(...arguments);
    }

    isCurrentPageBookmark(bookmark) {
        return this.smartCollections.isCurrentPageBookmark(...arguments);
    }

    getSmartCollectionSourceBookmarks() {
        return this.smartCollections.getSmartCollectionSourceBookmarks(...arguments);
    }

    getStaleBookmarksList(days) {
        return this.smartCollections.getStaleBookmarksList(...arguments);
    }

    scrollToStaleCollection() {
        return this.smartCollections.scrollToStaleCollection(...arguments);
    }

    _isSmartCollectionPageAllowed(pageIds) {
        return this.smartCollections._isSmartCollectionPageAllowed(...arguments);
    }

    refreshSmartCollectionsAfterOpen(url) {
        return this.smartCollections.refreshSmartCollectionsAfterOpen(...arguments);
    }

    applyBookmarkCategoryMove(bookmarkRefs, categoryId, { notify = true, count } = {}) {
        return this.bookmarkRows.applyBookmarkCategoryMove(...arguments);
    }

    updateBookmarkRowsCategoryInDom(refs, categoryId) {
        return this.bookmarkRows.updateBookmarkRowsCategoryInDom(...arguments);
    }

    collectBookmarkCategoryIds(bookmarks = []) {
        return this.bookmarkRows.collectBookmarkCategoryIds(...arguments);
    }

    formatMovePopoverCurrentCategoriesHint(categoryIds) {
        return this.bookmarkRows.formatMovePopoverCurrentCategoriesHint(...arguments);
    }

    canonicalBookmarkURLKey(raw) {
        return this.bookmarkRows.canonicalBookmarkURLKey(...arguments);
    }

    resolveBookmarkPageId(bookmark) {
        return this.bookmarkRows.resolveBookmarkPageId(...arguments);
    }

    bookmarkMatchesCanonicalUrl(candidate, bookmark) {
        return this.bookmarkRows.bookmarkMatchesCanonicalUrl(...arguments);
    }

    resolveBookmarkIndex(bookmark) {
        return this.bookmarkRows.resolveBookmarkIndex(...arguments);
    }

    resolveBookmarkIndexOnPage(bookmark, pageId) {
        return this.bookmarkRows.resolveBookmarkIndexOnPage(...arguments);
    }

    populateBookmarkRowView(row, bookmark, categoryId, allowInlineEdit) {
        return this.bookmarkRows.populateBookmarkRowView(...arguments);
    }

    restoreBookmarkRowStatus(row, bookmark) {
        return this.bookmarkRows.restoreBookmarkRowStatus(...arguments);
    }

    resolveBookmarkReference(bookmark) {
        return this.bookmarkRows.resolveBookmarkReference(...arguments);
    }

    isSameBookmarkReference(bookmarkRef, candidate) {
        return this.bookmarkRows.isSameBookmarkReference(...arguments);
    }

    syncEditedBookmarkAcrossCollections(bookmarkRef, previousUrl = '') {
        return this.bookmarkRows.syncEditedBookmarkAcrossCollections(...arguments);
    }

    removeBookmarkFromAllBookmarks(bookmarkRef) {
        return this.bookmarkRows.removeBookmarkFromAllBookmarks(...arguments);
    }

    removeBookmarkByUrl(pageId, url) {
        return this.bookmarkRows.removeBookmarkByUrl(pageId, url);
    }

    restoreBookmarkInAllBookmarks(bookmark, pageId) {
        return this.bookmarkRows.restoreBookmarkInAllBookmarks(...arguments);
    }

    findBookmarkIndexByReference(list, bookmarkRef) {
        return this.bookmarkRows.findBookmarkIndexByReference(...arguments);
    }

    createBookmarkElement(bookmark, categoryId, allowInlineEdit = true) {
        return this.bookmarkRows.createBookmarkElement(...arguments);
    }

    createRecentBookmarkElement(bookmark) {
        return this.bookmarkRows.createRecentBookmarkElement(...arguments);
    }

    syncBookmarkMetadataAcrossViews(updatedBookmark, pageId) {
        return this.bookmarkRows.syncBookmarkMetadataAcrossViews(...arguments);
    }

    syncAllBookmarksMetadata(updatedBookmark) {
        return this.bookmarkRows.syncAllBookmarksMetadata(...arguments);
    }

    syncBookmarkGridA11y() {
        return this.bookmarkRows.syncBookmarkGridA11y(...arguments);
    }

    bookmarkCellId(bookmark, bookmarkIndex, categoryId) {
        return this.bookmarkRows.bookmarkCellId(...arguments);
    }

    _hashForA11yId(value) {
        return this.bookmarkRows._hashForA11yId(...arguments);
    }

    getBookmarkGridElement() {
        return this.bookmarkRows.getBookmarkGridElement(...arguments);
    }

    showMovePopover(anchorEl, bookmark, bookmarkIndex) {
        return this.bookmarkRows.showMovePopover(...arguments);
    }

    showDeletePopover(anchorEl, bookmark, bookmarkIndex) {
        return this.bookmarkRows.showDeletePopover(...arguments);
    }

    showTagPopover(anchorEl, bookmark, bookmarkIndex) {
        return this.bookmarkRows.showTagPopover(...arguments);
    }

    _quickMoveToCategory(bookmark, categoryId) {
        return this.bookmarkRows._quickMoveToCategory(...arguments);
    }

    _closeMovePopover() {
        return this.bookmarkRows._closeMovePopover(...arguments);
    }

    _closeDeletePopover() {
        return this.bookmarkRows._closeDeletePopover(...arguments);
    }

    _closeActionPopovers() {
        return this.bookmarkRows._closeActionPopovers(...arguments);
    }

    _positionActionPopoverBeside(pop, anchorEl) {
        return this.bookmarkRows._positionActionPopoverBeside(...arguments);
    }

    _attachActionPopoverPositioning(pop, anchorEl) {
        return this.bookmarkRows._attachActionPopoverPositioning(...arguments);
    }

    _focusActionPopoverItem(items, idx, { syncAriaSelected = false } = {}) {
        return this.bookmarkRows._focusActionPopoverItem(...arguments);
    }

    _restoreActionPopoverFocus(previousFocus, anchorEl) {
        return this.bookmarkRows._restoreActionPopoverFocus(...arguments);
    }

    shouldStackDashboardCategories() {
        return this.renderCore.shouldStackDashboardCategories(...arguments);
    }

    getEffectiveColumnsPerRow() {
        return this.renderCore.getEffectiveColumnsPerRow(...arguments);
    }

    shouldPackDashboardColumns() {
        return this.renderCore.shouldPackDashboardColumns(...arguments);
    }

    getNormalizedColumnsPerRow() {
        return this.renderCore.getNormalizedColumnsPerRow(...arguments);
    }

    syncDashboardGridLayout() {
        return this.renderCore.syncDashboardGridLayout(...arguments);
    }

    _distributeDashboardColumnBlocks(container, columnBlocks, { animate = false, gridLayout = null } = {}) {
        return this.renderCore._distributeDashboardColumnBlocks(...arguments);
    }

    _copyDashboardGridLayoutToElement(target, sourceGrid) {
        return this.renderCore._copyDashboardGridLayoutToElement(...arguments);
    }

    renderDashboard(options = {}) {
        return this.renderCore.renderDashboard(...arguments);
    }

    groupBookmarksByCategory() {
        return this.renderCore.groupBookmarksByCategory(...arguments);
    }

    sortBookmarks(bookmarks) {
        return this.renderCore.sortBookmarks(...arguments);
    }

    initializeCategoryReorder() {
        return this.renderCore.initializeCategoryReorder(...arguments);
    }

    ensureBookmarkDragOverRelay() {
        return this.renderCore.ensureBookmarkDragOverRelay(...arguments);
    }

    initializeDashboardCategoryReorder() {
        return this.renderCore.initializeDashboardCategoryReorder(...arguments);
    }

    toggleAllCategoriesCollapsed() {
        return this.renderCore.toggleAllCategoriesCollapsed(...arguments);
    }

    ensureCategoryDragOverRelay() {
        return this.renderCore.ensureCategoryDragOverRelay(...arguments);
    }

    destroyCategoryReorderInstances() {
        return this.renderCore.destroyCategoryReorderInstances(...arguments);
    }

    destroyDashboardCategoryReorderInstances() {
        return this.renderCore.destroyDashboardCategoryReorderInstances(...arguments);
    }

    _getCategoryLists() {
        return this.renderCore._getCategoryLists(...arguments);
    }

    syncBookmarksFromDom() {
        return this.renderCore.syncBookmarksFromDom(...arguments);
    }

    syncCategoriesFromDom() {
        return this.renderCore.syncCategoriesFromDom(...arguments);
    }

    scheduleCategoryOrderSave() {
        return this.renderCore.scheduleCategoryOrderSave(...arguments);
    }

    async saveCategoryOrder(options = {}) {
        return this.renderCore.saveCategoryOrder(...arguments);
    }

    _startCategoryRename(titleEl, nameSpan, category) {
        return this.renderCore._startCategoryRename(...arguments);
    }

    scheduleBookmarkOrderSave(options = {}) {
        return this.renderCore.scheduleBookmarkOrderSave(...arguments);
    }

    async flushPendingBookmarkSave(options = {}) {
        return this.renderCore.flushPendingBookmarkSave(...arguments);
    }

    async flushPendingCategorySave() {
        return this.renderCore.flushPendingCategorySave(...arguments);
    }

    undoPendingReorder() {
        return this.renderCore.undoPendingReorder(...arguments);
    }

    createCategoryElement(category, bookmarks) {
        return this.renderCore.createCategoryElement(...arguments);
    }

    isUploadedCategoryIcon(iconValue) {
        return this.renderCore.isUploadedCategoryIcon(...arguments);
    }
}

window.Dashboard = Dashboard;

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new Dashboard();
});