/**
 * Main Configuration Manager
 * Orchestrates all configuration modules
 */

class ConfigManager {
    constructor() {
        window.MobileExperience?.applyBodyFlag?.();
        // Initialize modules
        this.storage = new ConfigStorage();
        this.data = new ConfigData(this.storage);
        this.ui = new ConfigUI();
        this.language = new ConfigLanguage();
        this.pages = new ConfigPages(this.language.t.bind(this.language));
        this.categories = new ConfigCategories(this.language.t.bind(this.language));
        this.bookmarks = new ConfigBookmarks(this.language.t.bind(this.language));
        window.configBookmarks = this.bookmarks;
        this.finders = new ConfigFinders(this.language.t.bind(this.language));
        this.faviconPrefetch = new ConfigFaviconPrefetch(this.language.t.bind(this.language));
        this.backup = new ConfigBackup(this.language.t.bind(this.language), this.faviconPrefetch);
        this.settings = new ConfigSettings(this.language);
        this.toursRuntime = new ConfigToursRuntime(this);
        this.tabTours = new ConfigTabTours(this);
        this.tabTours.installPublicMethods();
        this.persistence = new ConfigPersistence(this);
        this.persistence.installPublicMethods();
        this.tabs = new ConfigTabs(this);
        this.tabs.installPublicMethods();
        this.pagesController = new ConfigPagesController(this);
        this.pagesController.installPublicMethods();
        this.categoriesController = new ConfigCategoriesController(this);
        this.categoriesController.installPublicMethods();
        this.findersController = new ConfigFindersController(this);
        this.findersController.installPublicMethods();
        this.themesController = new ConfigThemesController(this);
        this.themesController.installPublicMethods();
        this.stats = null;

        // Data
        this.pagesData = [];
        this.originalPagesData = []; // Track original pages to detect deletions
        this.currentPageId = 1; // Default to page 1
        this.currentCategoriesPageId = 1; // Default to page 1 for categories
        this.bookmarkStore = new ConfigBookmarkStore(this.data);
        this.findersData = [];
        this.categoriesData = []; // Categories for the categories tab
        this.bookmarksPageCategories = []; // Categories for the bookmarks tab (read-only)
        this.categoriesListHydrated = false;
        this.currentBookmarksCategoryFilter = '__all__';
        this.currentBookmarksSort = 'default';
        this.currentBookmarksSearch = '';
        this.settingsData = {
            currentPage: 'default',
            theme: 'cherry-graphite-dark',
            openInNewTab: true,
            columnsPerRow: 3,
            fontSize: 'm',
            showBackgroundDots: true,
            showTitle: true,
            showDate: true,
            showTime: true,
            timeFormat: '24h',
            dateFormat: 'short-slash',
            showWeatherWithDate: false,
            weatherSource: 'manual',
            weatherLocation: '',
            weatherUnit: 'celsius',
            weatherRefreshMinutes: 30,
            showCheatSheetButton: true,
            showAddBookmarkButton: true,
            showRecentButton: true,
            showHealthDashboard: true,
            showTips: true,
            showSearchFlowBanner: true,
            showSyncToasts: false,
            showStatus: true,
            colorizeStatus: true,
            showPing: true,
            skipFastPing: false,
            statusOfflineRetries: 3,
            statusOfflineRetryDelayMs: 450,
            statusRecheckIntervalMinutes: 5,
            globalShortcuts: true,
            hyprMode: false,
            showPageNamesInTabs: false,
            enableCustomFavicon: false,
            customFaviconPath: '',
            enableCustomFont: false,
            customFontPath: '',
            language: 'en',
            interleaveMode: false,
            showPageTabs: true,
            enableFuzzySuggestions: false,
            fuzzySuggestionsStartWith: false,
            keepSearchOpenWhenEmpty: false,
            showIcons: true,
            showLinkPreviewCards: false,
            linkPreviewHoverDelayMs: 150,
            showShortcuts: true,
            showPinIcon: false,
            showNoteIcon: true,
            sortMethod: 'order',
            layoutPreset: 'default',
            layoutVersion: 'classic',
            packedColumns: true,
            backgroundOpacity: 1,
            fontWeight: 'normal',
            fontPreset: 'source-code-pro',
            autoDarkMode: false,
            showSmartRecentCollection: false,
            showSmartTodayCollection: true,
            showSmartStaleCollection: false,
            showSmartMostUsedCollection: false,
            smartTodayLimit: 8,
            smartRecentLimit: 50,
            smartStaleLimit: 50,
            smartMostUsedLimit: 25,
            smartTodayWorkKeywords: 'calendar,mail,gmail,outlook,notion,docs,drive,github,gitlab,jira,slack,teams',
            smartTodayEveningKeywords: 'youtube,spotify,netflix,reddit',
            smartTodayWeekendKeywords: 'news,weather,maps',
            smartTodayPageIds: [],
            smartRecentPageIds: [],
            smartStalePageIds: [],
            smartMostUsedPageIds: [],
            archivedPageIds: [],
            faviconRefreshPolicy: 'on-save',
            pasteUrlQuickAdd: true
            ,themeIconStyling: {}
        };
        this.deviceSpecific = false;
        this.isDirty = false;
        this.undoSnapshot = null;
        this.savedSnapshot = null;
        this.suppressDirtyTracking = false;
        this.isNavigatingAway = false;
        this.structureSyncEventKey = 'nextdash:config-structure-sync';
        this.settingsSyncEventKey = 'nextdash:config-settings-sync';
        this.tabId = `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.lastSyncToastAt = 0;
        this.colorsEditor = null;
        this.colorsDirty = false;
        this._persistedTheme = '';
        this._themeAutosaveToken = 0;
        this._pagesRepairedOnLoad = false;
        this._dirtyRecomputeTimer = null;

        this.init();
    }

    /** Active bookmarks page (mutable array shared with bookmarkStore). */
    get bookmarksData() {
        return this.bookmarkStore.getPage(this.currentPageId);
    }

    set bookmarksData(value) {
        this.bookmarkStore.setPage(this.currentPageId, value);
    }

    /** All bookmarks across pages (same object refs as per-page lists). */
    get allBookmarksData() {
        return this.bookmarkStore.getAll();
    }

    set allBookmarksData(value) {
        this.bookmarkStore.replaceAll(value);
    }

    async init() {
        window.LayoutVersionNudge?.clearLegacySessionKeys?.();
        window.ConfigGeneralTour?.recoverStaleDom?.();
        window.MobileExperience?.initConfig?.();
        await this.loadData();
        this.currentCategoriesPageId = this.getLastCategoriesPageId();
        await this.language.init(this.settingsData.language);
        this.backup.updateLastBackupDisplay(this.settingsData.language);
        window.MobileExperience?.refreshBannerTranslations?.();
        if (typeof ConfigStats === 'function') {
            this.stats = new ConfigStats(this.language.t.bind(this.language));
        }
        if (typeof ConfigKeyboard === 'function') {
            this.keyboard = new ConfigKeyboard(this.language.t.bind(this.language));
        }
        if (typeof ConfigTags === 'function') {
            this.tags = new ConfigTags(this.language.t.bind(this.language));
        }
        if (typeof ConfigCollections === 'function') {
            this.collections = new ConfigCollections(this.language.t.bind(this.language));
        }
        this.setupDOM();
        await this.setupEventListeners();
        this.language.setupLanguageSelector();
        if (typeof ConfigGeneralLayers === 'function') {
            this.generalLayers = new ConfigGeneralLayers();
            this.generalLayers.init();
            this.language.applyTranslations();
            this.generalLayers.syncLayerFromUrlOrStorage();
            window.ConfigSettingsSearch?.relocateForLayout?.();
            window.ConfigSettingsSearch?.syncMobileLayout?.();
            this.settings?.refreshStatusEssentialsSummary?.(this.settingsData, this.allBookmarksData);
            this.settings?.updateStatusOptionsVisibility?.(this.settingsData.showStatus);
            this.setupCascadingCheckboxes();
            const pageTabsCheckbox = document.getElementById('show-page-tabs-checkbox');
            if (pageTabsCheckbox && this.settings) {
                this.settings.setDependentControlState(['show-page-names-in-tabs-checkbox'], pageTabsCheckbox.checked);
            }
        }
        if (typeof window.installSettingInfoButtons === 'function' && this.settings) {
            window.installSettingInfoButtons(this.settings);
        }
        this.setupGeneralCardCollapsible();
        this.setupBookmarksTabCollapsibles();
        
        // Set language for global modal
        if (window.AppModal) {
            window.AppModal.setLanguage(this.language);
        }
        this.renderConfig();
        this.initReordering();
        await this.persistRepairedPagesIfNeeded();
        await this.reloadPagesFromServerIfNeeded();
        this.renderPagesTab();
        if (typeof initCustomSelects === 'function') {
            setTimeout(() => {
                initCustomSelects();
                document.querySelectorAll('select[data-custom-select-init="true"]').forEach((select) => {
                    select.__customSelectInstance?.refresh?.();
                });
                if (typeof window.installSettingInfoButtons === 'function' && this.settings) {
                    window.installSettingInfoButtons(this.settings);
                }
                this.refreshPageDropdowns();
            }, 0);
        }

        if (this.stats && this.isConfigStatsTabActive()) {
            this.stats.refresh(this);
        }
        if (window.location.hash.startsWith('#colors')) {
            await this.ensureColorsEditor();
        }

        const categoriesSelector = document.getElementById('categories-page-selector');
        if (categoriesSelector) {
            await this.loadPageCategories(this.currentCategoriesPageId);
        }
        this.savedSnapshot = this.captureUndoSnapshot();
        this.setDirtyState(false);
        this.refreshSmartCollectionCounters();
        this.settings?.refreshStatusEssentialsSummary?.(this.settingsData, this.allBookmarksData);
        this.validateBookmarkConflicts({ showToast: false });

        if (window.SkeletonLoading && typeof window.SkeletonLoading.finish === 'function') {
            window.SkeletonLoading.finish();
        } else {
            document.body.classList.remove('loading');
        }

        await this.consumeHealthPendingBookmark();

        void this.faviconPrefetch.consumePendingAfterLoad();

        this.scheduleConfigGeneralTour();
        this.scheduleConfigBookmarksTour();
        if (this.isConfigFindersTabActive() && !this.hasSeenConfigFindersTour()) {
            void this.onConfigFindersTabOpened();
        } else if (this.isConfigFindersTabActive()) {
            void this.reloadFindersTabData();
        } else {
            this.scheduleConfigFindersTour();
        }
        this.scheduleConfigStatsTour();
        if (this.isConfigCategoriesTabActive() && !this.hasSeenConfigCategoriesTour()) {
            void this.onConfigCategoriesTabOpened();
        } else {
            this.scheduleConfigCategoriesTour();
        }
        if (this.isConfigTagsTabActive() && !this.hasSeenConfigTagsTour()) {
            void this.onConfigTagsTabOpened();
        } else {
            this.scheduleConfigTagsTour();
        }
        if (this.isConfigPagesTabActive() && !this.hasSeenConfigPagesTour()) {
            void this.onConfigPagesTabOpened();
        } else {
            this.scheduleConfigPagesTour();
        }
        if (this.isConfigCollectionsTabActive() && !this.hasSeenConfigCollectionsTour()) {
            void this.onConfigCollectionsTabOpened();
        } else {
            this.scheduleConfigCollectionsTour();
        }
        if (this.isConfigColorsTabActive() && !this.hasSeenConfigThemeTour()) {
            void this.onConfigColorsTabOpened();
        } else {
            this.scheduleConfigThemeTour();
        }

        window.ConfigSettingsSearch?.refreshIndex?.();
        window.ConfigSettingsSearch?.bootPromoAutoStart?.();

        const params = new URLSearchParams(window.location.search);
        if (params.get('configTour') === '1') {
            void this.maybeStartConfigGeneralTour({ force: true });
        }
    }

    async loadData() {
        try {
            this.deviceSpecific = this.storage.getDeviceSpecificFlag();
            const { bookmarks, pages, settings } = await this.data.loadData(this.deviceSpecific);

            this.pagesData = this.applyPagesNormalization(pages, { trackRepair: true });
            this.originalPagesData = JSON.parse(JSON.stringify(this.pagesData));
            this.findersData = window.ConfigFinders?.normalizeFinders
                ? window.ConfigFinders.normalizeFinders(await this.data.loadFinders(), this.generateId.bind(this))
                : await this.data.loadFinders();
            await this.bookmarkStore.loadAll();
            if (this.bookmarkStore.getAll().length === 0 && Array.isArray(bookmarks) && bookmarks.length > 0) {
                const seedPageId = Number(settings?.currentPage) || Number(this.currentPageId) || 1;
                this.bookmarkStore.setPage(seedPageId, bookmarks);
            }
            this.settingsData = { ...this.settingsData, ...settings };
            this._persistedTheme = String(this.settingsData.theme || '');
            if (!this.settingsData.language || this.settingsData.language === "") {
                this.settingsData.language = 'en';
            }
            if (typeof this.settingsData.interleaveMode === 'undefined') {
                this.settingsData.interleaveMode = false;
            }
            if (typeof this.settingsData.showPageTabs === 'undefined') {
                this.settingsData.showPageTabs = true;
            }
            if (typeof this.settingsData.showSmartRecentCollection === 'undefined') {
                this.settingsData.showSmartRecentCollection = false;
            }
            if (typeof this.settingsData.showSmartTodayCollection === 'undefined') {
                this.settingsData.showSmartTodayCollection = true;
            }
            if (typeof this.settingsData.showSmartStaleCollection === 'undefined') {
                this.settingsData.showSmartStaleCollection = false;
            }
            if (typeof this.settingsData.showRecentButton === 'undefined') {
                this.settingsData.showRecentButton = true;
            }
            if (typeof this.settingsData.showHealthDashboard === 'undefined') {
                this.settingsData.showHealthDashboard = true;
            }
            if (typeof this.settingsData.showTips === 'undefined') {
                this.settingsData.showTips = true;
            }
            if (typeof this.settingsData.showSearchFlowBanner === 'undefined') {
                this.settingsData.showSearchFlowBanner = true;
            }
            if (typeof this.settingsData.showStatus === 'undefined') {
                this.settingsData.showStatus = true;
            }
            if (typeof this.settingsData.colorizeStatus === 'undefined') {
                this.settingsData.colorizeStatus = true;
            }
            if (typeof this.settingsData.showPing === 'undefined') {
                this.settingsData.showPing = true;
            }
            if (typeof this.settingsData.showLinkPreviewCards === 'undefined') {
                this.settingsData.showLinkPreviewCards = false;
            }
            if (![100, 150, 250].includes(Number(this.settingsData.linkPreviewHoverDelayMs))) {
                this.settingsData.linkPreviewHoverDelayMs = 150;
            }
            if (typeof window.normalizeStatusOfflineRetries === 'function') {
                this.settingsData.statusOfflineRetries = window.normalizeStatusOfflineRetries(this.settingsData.statusOfflineRetries);
            } else {
                this.settingsData.statusOfflineRetries = 3;
            }
            if (typeof window.normalizeStatusOfflineRetryDelayMs === 'function') {
                this.settingsData.statusOfflineRetryDelayMs = window.normalizeStatusOfflineRetryDelayMs(this.settingsData.statusOfflineRetryDelayMs);
            } else {
                this.settingsData.statusOfflineRetryDelayMs = 450;
            }
            if (typeof window.normalizeStatusRecheckIntervalMinutes === 'function') {
                this.settingsData.statusRecheckIntervalMinutes = window.normalizeStatusRecheckIntervalMinutes(this.settingsData.statusRecheckIntervalMinutes);
            } else {
                this.settingsData.statusRecheckIntervalMinutes = 5;
            }
            if (typeof this.settingsData.showSyncToasts === 'undefined') {
                this.settingsData.showSyncToasts = false;
            }
            if (typeof this.settingsData.onboardingCompleted === 'undefined') {
                this.settingsData.onboardingCompleted = true;
            }
            if (typeof this.settingsData.configGeneralTourCompleted === 'undefined') {
                this.settingsData.configGeneralTourCompleted = false;
            }
            if (typeof this.settingsData.configBookmarksTourCompleted === 'undefined') {
                this.settingsData.configBookmarksTourCompleted = false;
            }
            if (typeof this.settingsData.configFindersTourCompleted === 'undefined') {
                this.settingsData.configFindersTourCompleted = false;
            }
            if (typeof this.settingsData.configStatsTourCompleted === 'undefined') {
                this.settingsData.configStatsTourCompleted = false;
            }
            if (typeof this.settingsData.configCategoriesTourCompleted === 'undefined') {
                this.settingsData.configCategoriesTourCompleted = false;
            }
            if (typeof this.settingsData.configTagsTourCompleted === 'undefined') {
                this.settingsData.configTagsTourCompleted = false;
            }
            if (typeof this.settingsData.configPagesTourCompleted === 'undefined') {
                this.settingsData.configPagesTourCompleted = false;
            }
            if (typeof this.settingsData.configCollectionsTourCompleted === 'undefined') {
                this.settingsData.configCollectionsTourCompleted = false;
            }
            if (typeof this.settingsData.configThemeTourCompleted === 'undefined') {
                this.settingsData.configThemeTourCompleted = false;
            }
            this.syncConfigTabToursSeenFromServer();
            if (typeof this.settingsData.packedColumns === 'undefined') {
                this.settingsData.packedColumns = true;
            }
            if (typeof this.settingsData.pasteUrlQuickAdd === 'undefined') {
                this.settingsData.pasteUrlQuickAdd = true;
            }
            if (!this.settingsData.dateFormat) {
                this.settingsData.dateFormat = 'short-slash';
            }
            if (typeof this.settingsData.showTime === 'undefined') {
                this.settingsData.showTime = true;
            }
            if (!['24h', '12h'].includes(String(this.settingsData.timeFormat || ''))) {
                this.settingsData.timeFormat = '24h';
            }
            if (typeof this.settingsData.showWeatherWithDate === 'undefined') {
                this.settingsData.showWeatherWithDate = false;
            }
            if (!this.settingsData.weatherSource) {
                this.settingsData.weatherSource = 'manual';
            }
            if (!this.settingsData.weatherUnit) {
                this.settingsData.weatherUnit = 'celsius';
            }
            if (!Number.isFinite(Number(this.settingsData.weatherRefreshMinutes)) || Number(this.settingsData.weatherRefreshMinutes) <= 0) {
                this.settingsData.weatherRefreshMinutes = 30;
            } else {
                this.settingsData.weatherRefreshMinutes = Number(this.settingsData.weatherRefreshMinutes);
            }
            if (!Number.isFinite(Number(this.settingsData.smartRecentLimit)) || Number(this.settingsData.smartRecentLimit) < 0) {
                this.settingsData.smartRecentLimit = 50;
            } else {
                this.settingsData.smartRecentLimit = Number(this.settingsData.smartRecentLimit);
            }
            if (!Number.isFinite(Number(this.settingsData.smartTodayLimit)) || Number(this.settingsData.smartTodayLimit) < 0) {
                this.settingsData.smartTodayLimit = 8;
            } else {
                this.settingsData.smartTodayLimit = Number(this.settingsData.smartTodayLimit);
            }
            if (!Number.isFinite(Number(this.settingsData.smartStaleLimit)) || Number(this.settingsData.smartStaleLimit) < 0) {
                this.settingsData.smartStaleLimit = 50;
            } else {
                this.settingsData.smartStaleLimit = Number(this.settingsData.smartStaleLimit);
            }
            if (typeof this.settingsData.smartTodayWorkKeywords !== 'string' || this.settingsData.smartTodayWorkKeywords.trim() === '') {
                this.settingsData.smartTodayWorkKeywords = 'calendar,mail,gmail,outlook,notion,docs,drive,github,gitlab,jira,slack,teams';
            }
            if (typeof this.settingsData.smartTodayEveningKeywords !== 'string' || this.settingsData.smartTodayEveningKeywords.trim() === '') {
                this.settingsData.smartTodayEveningKeywords = 'youtube,spotify,netflix,reddit';
            }
            if (typeof this.settingsData.smartTodayWeekendKeywords !== 'string' || this.settingsData.smartTodayWeekendKeywords.trim() === '') {
                this.settingsData.smartTodayWeekendKeywords = 'news,weather,maps';
            }
            if (!Array.isArray(this.settingsData.smartRecentPageIds)) {
                this.settingsData.smartRecentPageIds = [];
            }
            if (!Array.isArray(this.settingsData.smartTodayPageIds)) {
                this.settingsData.smartTodayPageIds = [];
            }
            if (!Array.isArray(this.settingsData.smartStalePageIds)) {
                this.settingsData.smartStalePageIds = [];
            }
            if (!Array.isArray(this.settingsData.smartMostUsedPageIds)) {
                this.settingsData.smartMostUsedPageIds = [];
            }
            if (typeof this.settingsData.showSmartMostUsedCollection === 'undefined') {
                this.settingsData.showSmartMostUsedCollection = false;
            }
            if (!Array.isArray(this.settingsData.archivedPageIds)) {
                this.settingsData.archivedPageIds = [];
            }
            if (!['manual', 'on-save'].includes(String(this.settingsData.faviconRefreshPolicy || ''))) {
                this.settingsData.faviconRefreshPolicy = 'on-save';
            }
            if (!Number.isFinite(Number(this.settingsData.smartMostUsedLimit)) || Number(this.settingsData.smartMostUsedLimit) < 0) {
                this.settingsData.smartMostUsedLimit = 25;
            } else {
                this.settingsData.smartMostUsedLimit = Number(this.settingsData.smartMostUsedLimit);
            }
            if (window.DashboardFont) {
                window.DashboardFont.normalizeFontSettings(this.settingsData);
            } else if (!this.settingsData.fontPreset) {
                this.settingsData.fontPreset = 'source-code-pro';
            }
            this.currentPageId = this.resolvePageId(settings.currentPage, this.getVisiblePages());
            if (this.isPageArchived(this.currentPageId)) {
                const visiblePages = this.getVisiblePages();
                this.currentPageId = visiblePages.length > 0 ? Number(visiblePages[0].id) : 1;
            }
            
            await this.loadPageBookmarks(this.currentPageId);
            window.BookmarkUrlUtils?.healAllowLocalBookmarksSetting?.(
                this.settingsData,
                this.bookmarkStore.getAll()
            );
        } catch (error) {
            this.ui.showErrorWithReload(this.language.t('config.errorLoadingConfig'));
        }
    }

    async saveBookmarksPage(pageId, bookmarks) {
        if (Array.isArray(bookmarks)) {
            this.bookmarkStore.setPage(pageId, bookmarks);
        }
        await this.bookmarkStore.persistPage(pageId, (fn) => this.withRetry(fn));
    }

    async loadPageBookmarks(pageId) {
        try {
            this.currentPageId = parseInt(pageId);
            await this.bookmarkStore.loadPage(pageId);
            this.bookmarksPageCategories = (await this.data.loadCategoriesByPage(pageId)).map(cat => ({ ...cat }));
            this.currentBookmarksCategoryFilter = this.getLastCategoryFilterForPage(this.currentPageId);

            if (this.bookmarks) {
                this.bookmarks.activeDetailIndex = null;
                this.bookmarks.setDetailPanelMode?.('empty');
            }

            this.refreshBookmarksFilterOptions();
            // Page switch: do NOT flush current DOM inputs into newly loaded page data.
            this.refreshBookmarksList({ skipFlush: true });
            this.syncBookmarksPageSelectorUI(this.currentPageId);
        } catch (error) {
            this.ui.showErrorWithReload(this.language.t('config.errorLoadingBookmarks'));
        }
    }

    async consumeHealthPendingBookmark() {
        let raw = null;
        try {
            raw = sessionStorage.getItem('nextdash_health_open_bookmark');
            if (!raw) return;
            sessionStorage.removeItem('nextdash_health_open_bookmark');
        } catch (e) {
            return;
        }

        let pending = null;
        try {
            pending = JSON.parse(raw);
        } catch (e) {
            return;
        }

        const pageId = Number(pending?.pageId);
        if (!Number.isFinite(pageId)) return;

        if (this.ui?.switchToTab) {
            this.ui.switchToTab('bookmarks');
        }
        window.location.hash = '#bookmarks';

        if (Number(this.currentPageId) !== pageId) {
            await this.loadPageBookmarks(pageId);
        }

        let idx = Number(pending?.index);
        if (!Number.isFinite(idx) || !this.bookmarksData?.[idx]) {
            const url = String(pending?.url || '').trim().toLowerCase();
            idx = (this.bookmarksData || []).findIndex(
                (bm) => String(bm?.url || '').trim().toLowerCase() === url
            );
        }

        if (idx >= 0 && this.bookmarks?.openDetailPanel) {
            this.bookmarks.openDetailPanel(idx, this.bookmarksData, this.bookmarksPageCategories);
            requestAnimationFrame(() => {
                document.querySelector(`[data-bookmark-index="${idx}"]`)?.scrollIntoView({ block: 'nearest' });
            });
        }
    }

    /**
     * Persist the current categories page before switching away.
     * Does not reload UI — a full persist+refresh would reset the page selector
     * to the old page while the change handler is still applying the new value.
     * @returns {Promise<boolean>} false when validation/save failed (caller should abort switch)
     */

    /**
     * Page id for saves: trust this.currentPageId (set by loadPageBookmarks / structure nav).
     * The native #page-select can desync with the custom-select UI; reading it first caused
     * POSTs to ?page=1 with bookmarksData from page 2.
     */
    getResolvedBookmarksPageId() {
        const mem = Number(this.currentPageId);
        if (
            Number.isFinite(mem) &&
            mem >= 1 &&
            this.getVisiblePages().some((p) => Number(p.id) === mem)
        ) {
            return mem;
        }
        const sel = document.getElementById('page-selector');
        if (sel && sel.options && sel.selectedIndex >= 0) {
            const raw = sel.options[sel.selectedIndex]?.value ?? sel.value;
            const v = parseInt(String(raw), 10);
            if (Number.isFinite(v) && v >= 1 && this.getVisiblePages().some((p) => Number(p.id) === v)) {
                return v;
            }
        }
        return 1;
    }

    /** Keep native + custom #page-selector aligned with the page we actually loaded. */
    syncBookmarksPageSelectorUI(pageId) {
        const sel = document.getElementById('page-selector');
        if (!sel || !sel.options?.length) {
            return;
        }
        const want = String(Number(pageId));
        for (let i = 0; i < sel.options.length; i++) {
            if (String(sel.options[i].value) === want) {
                sel.selectedIndex = i;
                sel.__customSelectInstance?.refresh?.();
                return;
            }
        }
    }

    /** Keep native + custom #categories-page-selector aligned with the categories page we loaded. */

    setupDOM() {
        this.settings.applyAutoDarkMode(this.settingsData.autoDarkMode, this.settingsData);
        this.settings.applyFontSize(this.settingsData.fontSize);
        this.settings.applyBackgroundDots(this.settingsData.showBackgroundDots);
        this.settings.applyAnimations(this.settingsData.animationsEnabled);
        if (window.LayoutUtils) {
            this.settingsData.layoutPreset = window.LayoutUtils.applyLayoutPreset(this.settingsData, this.settingsData.layoutPreset || 'default');
        } else {
            document.body.setAttribute('data-layout-preset', this.settingsData.layoutPreset || 'default');
        }
        if (window.LayoutVersionUtils) {
            this.settingsData.layoutVersion = window.LayoutVersionUtils.applyLayoutVersion(
                this.settingsData,
                this.settingsData.layoutVersion || 'classic'
            );
        } else {
            const normalized = (this.settingsData.layoutVersion || 'classic').toLowerCase().trim();
            const layoutVersion = ['classic', 'modern', 'glass'].includes(normalized) ? normalized : 'classic';
            this.settingsData.layoutVersion = layoutVersion;
            document.documentElement.setAttribute('data-layout-version', layoutVersion);
            document.body.setAttribute('data-layout-version', layoutVersion);
        }
        document.body.setAttribute('data-density-mode', this.settingsData.densityMode || 'compact');
        this.settings.applyBackground(this.settingsData);
        this.settings.applyBackgroundOpacity(this.settingsData.backgroundOpacity);
        this.settings.applyFontWeight(this.settingsData.fontWeight);
        if (window.DashboardFont) {
            window.DashboardFont.applyMainFont(this.settingsData);
        }
    }

    async setupEventListeners() {
        // Setup input validation
        this.setupInputValidation();
        
        // Setup settings listeners with callbacks
        await this.settings.setupListeners(this.settingsData, {
            onThemeChange: async (theme) => {
                const displayTheme = window.VisualSettings?.resolveTheme?.(this.settingsData) || theme;
                this.settings.applyTheme(displayTheme);
                this.settings.reloadThemeCSS();
                this.settings.updateAutoPreview(displayTheme);
                this.settings.applyBackground(this.settingsData);
                try { this.initThemeIconStylingControls(); } catch (e) {}
                await this.autosaveThemeSelection(theme);
            },
            onFontSizeChange: (fontSize) => {
                this.settings.applyFontSize(fontSize);
            },
            onBackgroundDotsChange: (show) => {
                this.settings.applyBackgroundDots(show);
            },
            onAnimationsChange: (enabled) => {
                this.settings.applyAnimations(enabled);
            },
            onLayoutVersionChange: async (layoutVersion) => {
                if (window.LayoutVersionUtils) {
                    this.settingsData.layoutVersion = window.LayoutVersionUtils.applyLayoutVersion(
                        this.settingsData,
                        layoutVersion || 'classic'
                    );
                } else {
                    const normalized = (layoutVersion || 'classic').toLowerCase().trim();
                    const version = ['classic', 'modern', 'glass'].includes(normalized) ? normalized : 'classic';
                    this.settingsData.layoutVersion = version;
                    document.documentElement.setAttribute('data-layout-version', version);
                    document.body.setAttribute('data-layout-version', version);
                }
                await this.autosaveLayoutSettings();
            },
            onLayoutPresetChange: async (preset) => {
                if (window.LayoutUtils) {
                    this.settingsData.layoutPreset = window.LayoutUtils.applyLayoutPreset(this.settingsData, preset || 'default');
                } else {
                    this.settingsData.layoutPreset = preset || 'default';
                    document.body.setAttribute('data-layout-preset', preset || 'default');
                }
                await this.autosaveLayoutSettings();
            },
            onDensityModeChange: async (densityMode) => {
                const normalizedDensity = ['comfortable', 'compact', 'dense', 'auto'].includes(densityMode) ? densityMode : 'compact';
                this.settingsData.densityMode = normalizedDensity;
                document.body.setAttribute('data-density-mode', normalizedDensity);
                await this.autosaveLayoutSettings();
            },
            onBackgroundOpacityChange: (value) => {
                this.settings.applyBackgroundOpacity(value);
            },
            onFontWeightChange: (value) => {
                this.settings.applyFontWeight(value);
            },
            onFontPresetChange: () => {
                if (window.DashboardFont) {
                    window.DashboardFont.applyMainFont(this.settingsData);
                }
            },
            onAutoDarkModeChange: (enabled) => {
                this.settings.applyAutoDarkMode(enabled, this.settingsData);
            },
            onStatusVisibilityChange: () => {
                this.settings.updateStatusOptionsVisibility(this.settingsData.showStatus);
                this.settings.refreshStatusEssentialsSummary(this.settingsData, this.allBookmarksData);
            },
            onLauncherIconSizeChange: async () => {
                this.settings.updateFromUI(this.settingsData);
                if (this.deviceSpecific) {
                    this.storage.saveDeviceSettings(this.settingsData);
                } else {
                    await this.settings.saveSettingsToServer(this.settingsData);
                }
                this.onSettingsAutosaved();
                this.signalDashboardSettingsUpdated('settings-updated');
            },
            onCalendarUrlChange: async () => {
                this.settings.updateFromUI(this.settingsData);
                await this.settings.saveSettingsToServer(this.settingsData);
                this.onSettingsAutosaved();
                this.signalDashboardSettingsUpdated('settings-updated');
            },
            onButtonBarPositionChange: async () => {
                this.settings.updateFromUI(this.settingsData);
                const ok = await this.settings.saveSettingsToServer(this.settingsData);
                if (!ok) {
                    this.ui.showNotification(this.language.t('config.buttonBarPositionSaveError'), 'error');
                    return;
                }
                this.onSettingsAutosaved();
                this.signalDashboardSettingsUpdated('settings-updated');
                this.ui.showNotification(this.language.t('config.buttonBarPositionSaved'), 'success');
            },
            onPackedColumnsChange: async () => {
                this.settings.updateFromUI(this.settingsData);
                let ok = true;
                if (this.deviceSpecific) {
                    this.storage.saveDeviceSettings(this.settingsData);
                } else {
                    ok = await this.settings.saveSettingsToServer(this.settingsData);
                }
                if (!ok) {
                    this.ui.showNotification(this.language.t('config.packedColumnsSaveError'), 'error');
                    return;
                }
                this.onSettingsAutosaved();
                this.signalDashboardSettingsUpdated('settings-updated');
                const on = this.settingsData.packedColumns === true;
                this.ui.showNotification(
                    this.language.t(on ? 'config.packedColumnsSavedOn' : 'config.packedColumnsSavedOff'),
                    'success'
                );
            },
            onNotify: (message, type) => {
                this.ui.showNotification(message, type);
            },
            onBookmarkPreviewsChanged: async () => {
                if (this.bookmarkStore) {
                    await this.bookmarkStore.loadAll();
                }
                const pageId = this.currentPageId || 1;
                await this.loadPageBookmarks(pageId);
                this.refreshBookmarksList({ skipFlush: true });
            },
        });

        const deviceSpecificCheckbox = document.getElementById('device-specific-checkbox');
        if (deviceSpecificCheckbox) {
            deviceSpecificCheckbox.checked = this.deviceSpecific;
            deviceSpecificCheckbox.addEventListener('change', async (e) => {
                this.deviceSpecific = e.target.checked;
                this.storage.setDeviceSpecificFlag(this.deviceSpecific);
                
                const message = this.deviceSpecific 
                    ? this.language.t('config.deviceSpecificEnabled')
                    : this.language.t('config.deviceSpecificDisabled');
                
                if (this.deviceSpecific) {
                    this.storage.saveDeviceSettings(this.settingsData);
                } else {
                    this.storage.clearDeviceSettings();
                }
                this.ui.showNotification(message, 'success');
            });
        }

        const resetConfigGeneralTourBtn = document.getElementById('reset-config-general-tour-btn');
        if (resetConfigGeneralTourBtn) {
            resetConfigGeneralTourBtn.addEventListener('click', async () => {
                try {
                    window.ConfigGeneralTour?.teardownStaleDom?.();
                    this._configGeneralTourActive = false;

                    if (typeof window.ConfigGeneralTour?.resetSeen === 'function') {
                        window.ConfigGeneralTour.resetSeen();
                    }
                    this.settingsData.configGeneralTourCompleted = false;
                    try {
                        localStorage.removeItem(
                            window.ConfigGeneralTour?.STORAGE_KEY || 'nextdash:config-general-tour-v1'
                        );
                    } catch {
                        // ignore
                    }

                    this.ensureGeneralTabActive();
                    await new Promise((resolve) => setTimeout(resolve, 200));

                    const result = await this.maybeStartConfigGeneralTour({ force: true });
                    const started = result?.ok === true;
                    const msg = started
                        ? (this.language?.t('config.resetConfigGeneralTourSuccess')
                            || 'General tour started.')
                        : this.configGeneralTourFailureMessage(result?.reason);
                    this.ui.showNotification(msg, started ? 'success' : 'warning');

                    if (started && this.settings?.saveSettingsToServer) {
                        try {
                            await this.settings.saveSettingsToServer(this.settingsData);
                        } catch {
                            // Tour already running; completion flag syncs on finish.
                        }
                    }
                } catch (error) {
                    console.error('Reset General tour failed', error);
                    this._configGeneralTourActive = false;
                    window.ConfigGeneralTour?.teardownStaleDom?.();
                    this.ui.showNotification(
                        this.configGeneralTourFailureMessage('error'),
                        'error'
                    );
                }
            });
        }

        const resetConfigBookmarksTourBtn = document.getElementById('reset-config-bookmarks-tour-btn');
        if (resetConfigBookmarksTourBtn) {
            resetConfigBookmarksTourBtn.addEventListener('click', async () => {
                try {
                    window.ConfigBookmarksTour?.teardownStaleDom?.();
                    this._configBookmarksTourActive = false;

                    if (typeof window.ConfigBookmarksTour?.resetSeen === 'function') {
                        window.ConfigBookmarksTour.resetSeen();
                    }
                    this.settingsData.configBookmarksTourCompleted = false;
                    try {
                        localStorage.removeItem(
                            window.ConfigBookmarksTour?.STORAGE_KEY || 'nextdash:config-bookmarks-tour-v1'
                        );
                    } catch {
                        // ignore
                    }

                    this.ensureBookmarksTabActive();
                    await new Promise((resolve) => setTimeout(resolve, 200));

                    const result = await this.maybeStartConfigBookmarksTour({ force: true });
                    const started = result?.ok === true;
                    const msg = started
                        ? (this.language?.t('config.resetConfigBookmarksTourSuccess')
                            || 'Bookmarks tour started.')
                        : this.configBookmarksTourFailureMessage(result?.reason);
                    this.ui.showNotification(msg, started ? 'success' : 'warning');

                    if (started && this.settings?.saveSettingsToServer) {
                        try {
                            await this.settings.saveSettingsToServer(this.settingsData);
                        } catch {
                            // Tour already running; completion flag syncs on finish.
                        }
                    }
                } catch (error) {
                    console.error('Reset Bookmarks tour failed', error);
                    this._configBookmarksTourActive = false;
                    window.ConfigBookmarksTour?.teardownStaleDom?.();
                    this.ui.showNotification(
                        this.configBookmarksTourFailureMessage('error'),
                        'error'
                    );
                }
            });
        }

        const resetConfigFindersTourBtn = document.getElementById('reset-config-finders-tour-btn');
        if (resetConfigFindersTourBtn) {
            resetConfigFindersTourBtn.addEventListener('click', async () => {
                try {
                    window.ConfigFindersTour?.teardownStaleDom?.();
                    this._configFindersTourActive = false;

                    if (typeof window.ConfigFindersTour?.resetSeen === 'function') {
                        window.ConfigFindersTour.resetSeen();
                    }
                    this.settingsData.configFindersTourCompleted = false;
                    try {
                        localStorage.removeItem(
                            window.ConfigFindersTour?.STORAGE_KEY || 'nextdash:config-finders-tour-v1'
                        );
                    } catch {
                        // ignore
                    }

                    this.ensureFindersTabActive();
                    await new Promise((resolve) => setTimeout(resolve, 200));

                    const result = await this.maybeStartConfigFindersTour({ force: true });
                    const started = result?.ok === true;
                    const msg = started
                        ? (this.language?.t('config.resetConfigFindersTourSuccess')
                            || 'Finders tour started.')
                        : this.configFindersTourFailureMessage(result?.reason);
                    this.ui.showNotification(msg, started ? 'success' : 'warning');

                    if (started && this.settings?.saveSettingsToServer) {
                        try {
                            await this.settings.saveSettingsToServer(this.settingsData);
                        } catch {
                            // Tour already running; completion flag syncs on finish.
                        }
                    }
                } catch (error) {
                    console.error('Reset Finders tour failed', error);
                    this._configFindersTourActive = false;
                    window.ConfigFindersTour?.teardownStaleDom?.();
                    this.ui.showNotification(
                        this.configFindersTourFailureMessage('error'),
                        'error'
                    );
                }
            });
        }

        const resetConfigStatsTourBtn = document.getElementById('reset-config-stats-tour-btn');
        if (resetConfigStatsTourBtn) {
            resetConfigStatsTourBtn.addEventListener('click', async () => {
                try {
                    window.ConfigStatsTour?.teardownStaleDom?.();
                    this._configStatsTourActive = false;

                    if (typeof window.ConfigStatsTour?.resetSeen === 'function') {
                        window.ConfigStatsTour.resetSeen();
                    }
                    this.settingsData.configStatsTourCompleted = false;
                    try {
                        localStorage.removeItem(
                            window.ConfigStatsTour?.STORAGE_KEY || 'nextdash:config-stats-tour-v1'
                        );
                    } catch {
                        // ignore
                    }

                    this.ensureStatsTabActive();
                    await new Promise((resolve) => setTimeout(resolve, 200));

                    const result = await this.maybeStartConfigStatsTour({ force: true });
                    const started = result?.ok === true;
                    const msg = started
                        ? (this.language?.t('config.resetConfigStatsTourSuccess')
                            || 'Stats tour started.')
                        : this.configStatsTourFailureMessage(result?.reason);
                    this.ui.showNotification(msg, started ? 'success' : 'warning');

                    if (started && this.settings?.saveSettingsToServer) {
                        try {
                            await this.settings.saveSettingsToServer(this.settingsData);
                        } catch {
                            // Tour already running; completion flag syncs on finish.
                        }
                    }
                } catch (error) {
                    console.error('Reset Stats tour failed', error);
                    this._configStatsTourActive = false;
                    window.ConfigStatsTour?.teardownStaleDom?.();
                    this.ui.showNotification(
                        this.configStatsTourFailureMessage('error'),
                        'error'
                    );
                }
            });
        }

        const resetConfigCategoriesTourBtn = document.getElementById('reset-config-categories-tour-btn');
        if (resetConfigCategoriesTourBtn) {
            resetConfigCategoriesTourBtn.addEventListener('click', async () => {
                try {
                    window.ConfigCategoriesTour?.teardownStaleDom?.();
                    this._configCategoriesTourActive = false;

                    if (typeof window.ConfigCategoriesTour?.resetSeen === 'function') {
                        window.ConfigCategoriesTour.resetSeen();
                    }
                    this.settingsData.configCategoriesTourCompleted = false;
                    try {
                        localStorage.removeItem(
                            window.ConfigCategoriesTour?.STORAGE_KEY ||
                                'nextdash:config-categories-tour-v1'
                        );
                    } catch {
                        // ignore
                    }

                    this.ensureCategoriesTabActive();
                    await new Promise((resolve) => setTimeout(resolve, 200));

                    const result = await this.maybeStartConfigCategoriesTour({ force: true });
                    const started = result?.ok === true;
                    const msg = started
                        ? (this.language?.t('config.resetConfigCategoriesTourSuccess') ||
                              'Categories tour started.')
                        : this.configCategoriesTourFailureMessage(result?.reason);
                    this.ui.showNotification(msg, started ? 'success' : 'warning');

                    if (started && this.settings?.saveSettingsToServer) {
                        try {
                            await this.settings.saveSettingsToServer(this.settingsData);
                        } catch {
                            // Tour already running; completion flag syncs on finish.
                        }
                    }
                } catch (error) {
                    console.error('Reset Categories tour failed', error);
                    this._configCategoriesTourActive = false;
                    window.ConfigCategoriesTour?.teardownStaleDom?.();
                    this.ui.showNotification(
                        this.configCategoriesTourFailureMessage('error'),
                        'error'
                    );
                }
            });
        }

        const resetConfigTagsTourBtn = document.getElementById('reset-config-tags-tour-btn');
        if (resetConfigTagsTourBtn) {
            resetConfigTagsTourBtn.addEventListener('click', async () => {
                try {
                    window.ConfigTagsTour?.teardownStaleDom?.();
                    this._configTagsTourActive = false;

                    if (typeof window.ConfigTagsTour?.resetSeen === 'function') {
                        window.ConfigTagsTour.resetSeen();
                    }
                    this.settingsData.configTagsTourCompleted = false;
                    try {
                        localStorage.removeItem(
                            window.ConfigTagsTour?.STORAGE_KEY || 'nextdash:config-tags-tour-v1'
                        );
                    } catch {
                        // ignore
                    }

                    this.ensureTagsTabActive();
                    await new Promise((resolve) => setTimeout(resolve, 200));

                    const result = await this.maybeStartConfigTagsTour({ force: true });
                    const started = result?.ok === true;
                    const msg = started
                        ? (this.language?.t('config.resetConfigTagsTourSuccess') || 'Tags tour started.')
                        : this.configTagsTourFailureMessage(result?.reason);
                    this.ui.showNotification(msg, started ? 'success' : 'warning');

                    if (started && this.settings?.saveSettingsToServer) {
                        try {
                            await this.settings.saveSettingsToServer(this.settingsData);
                        } catch {
                            // Tour already running; completion flag syncs on finish.
                        }
                    }
                } catch (error) {
                    console.error('Reset Tags tour failed', error);
                    this._configTagsTourActive = false;
                    window.ConfigTagsTour?.teardownStaleDom?.();
                    this.ui.showNotification(this.configTagsTourFailureMessage('error'), 'error');
                }
            });
        }

        const resetConfigPagesTourBtn = document.getElementById('reset-config-pages-tour-btn');
        if (resetConfigPagesTourBtn) {
            resetConfigPagesTourBtn.addEventListener('click', async () => {
                try {
                    window.ConfigPagesTour?.teardownStaleDom?.();
                    this._configPagesTourActive = false;

                    if (typeof window.ConfigPagesTour?.resetSeen === 'function') {
                        window.ConfigPagesTour.resetSeen();
                    }
                    this.settingsData.configPagesTourCompleted = false;
                    try {
                        localStorage.removeItem(
                            window.ConfigPagesTour?.STORAGE_KEY || 'nextdash:config-pages-tour-v1'
                        );
                    } catch {
                        // ignore
                    }

                    this.ensurePagesTabActive();
                    await new Promise((resolve) => setTimeout(resolve, 200));

                    const result = await this.maybeStartConfigPagesTour({ force: true });
                    const started = result?.ok === true;
                    const msg = started
                        ? (this.language?.t('config.resetConfigPagesTourSuccess') || 'Pages tour started.')
                        : this.configPagesTourFailureMessage(result?.reason);
                    this.ui.showNotification(msg, started ? 'success' : 'warning');

                    if (started && this.settings?.saveSettingsToServer) {
                        try {
                            await this.settings.saveSettingsToServer(this.settingsData);
                        } catch {
                            // Tour already running; completion flag syncs on finish.
                        }
                    }
                } catch (error) {
                    console.error('Reset Pages tour failed', error);
                    this._configPagesTourActive = false;
                    window.ConfigPagesTour?.teardownStaleDom?.();
                    this.ui.showNotification(this.configPagesTourFailureMessage('error'), 'error');
                }
            });
        }

        const resetConfigCollectionsTourBtn = document.getElementById('reset-config-collections-tour-btn');
        if (resetConfigCollectionsTourBtn) {
            resetConfigCollectionsTourBtn.addEventListener('click', async () => {
                try {
                    window.ConfigCollectionsTour?.teardownStaleDom?.();
                    this._configCollectionsTourActive = false;

                    if (typeof window.ConfigCollectionsTour?.resetSeen === 'function') {
                        window.ConfigCollectionsTour.resetSeen();
                    }
                    this.settingsData.configCollectionsTourCompleted = false;
                    try {
                        localStorage.removeItem(
                            window.ConfigCollectionsTour?.STORAGE_KEY ||
                                'nextdash:config-collections-tour-v1'
                        );
                    } catch {
                        // ignore
                    }

                    this.ensureCollectionsTabActive();
                    await new Promise((resolve) => setTimeout(resolve, 200));

                    const result = await this.maybeStartConfigCollectionsTour({ force: true });
                    const started = result?.ok === true;
                    const msg = started
                        ? (this.language?.t('config.resetConfigCollectionsTourSuccess') ||
                              'Collections tour started.')
                        : this.configCollectionsTourFailureMessage(result?.reason);
                    this.ui.showNotification(msg, started ? 'success' : 'warning');

                    if (started && this.settings?.saveSettingsToServer) {
                        try {
                            await this.settings.saveSettingsToServer(this.settingsData);
                        } catch {
                            // Tour already running; completion flag syncs on finish.
                        }
                    }
                } catch (error) {
                    console.error('Reset Collections tour failed', error);
                    this._configCollectionsTourActive = false;
                    window.ConfigCollectionsTour?.teardownStaleDom?.();
                    this.ui.showNotification(
                        this.configCollectionsTourFailureMessage('error'),
                        'error'
                    );
                }
            });
        }

        const resetConfigThemeTourBtn = document.getElementById('reset-config-theme-tour-btn');
        if (resetConfigThemeTourBtn) {
            resetConfigThemeTourBtn.addEventListener('click', async () => {
                try {
                    window.ConfigThemeTour?.teardownStaleDom?.();
                    this._configThemeTourActive = false;

                    if (typeof window.ConfigThemeTour?.resetSeen === 'function') {
                        window.ConfigThemeTour.resetSeen();
                    }
                    this.settingsData.configThemeTourCompleted = false;
                    try {
                        localStorage.removeItem(
                            window.ConfigThemeTour?.STORAGE_KEY || 'nextdash:config-theme-tour-v1'
                        );
                    } catch {
                        // ignore
                    }

                    this.ensureColorsTabActive();
                    await this.ensureColorsEditor();
                    await new Promise((resolve) => setTimeout(resolve, 200));

                    const result = await this.maybeStartConfigThemeTour({ force: true });
                    const started = result?.ok === true;
                    const msg = started
                        ? (this.language?.t('config.resetConfigThemeTourSuccess') || 'Theme tour started.')
                        : this.configThemeTourFailureMessage(result?.reason);
                    this.ui.showNotification(msg, started ? 'success' : 'warning');

                    if (started && this.settings?.saveSettingsToServer) {
                        try {
                            await this.settings.saveSettingsToServer(this.settingsData);
                        } catch {
                            // Tour already running; completion flag syncs on finish.
                        }
                    }
                } catch (error) {
                    console.error('Reset Theme tour failed', error);
                    this._configThemeTourActive = false;
                    window.ConfigThemeTour?.teardownStaleDom?.();
                    this.ui.showNotification(this.configThemeTourFailureMessage('error'), 'error');
                }
            });
        }

        const resetOnboardingBtn = document.getElementById('reset-onboarding-btn');
        if (resetOnboardingBtn) {
            resetOnboardingBtn.addEventListener('click', async () => {
                this.settingsData.onboardingCompleted = false;
                try {
                    localStorage.removeItem('nextDashOnboardingSeenV2');
                    localStorage.removeItem('nextDashOnboardingVersionV2');
                } catch {
                    // ignore
                }
                const ok = await this.settings.saveSettingsToServer(this.settingsData);
                if (!ok) {
                    this.ui.showNotification(this.language.t('config.resetOnboardingError'), 'error');
                    return;
                }
                this.signalDashboardSettingsUpdated('settings-updated');
                this.ui.showNotification(this.language.t('config.resetOnboardingSuccess'), 'success');
            });
        }

        const resetLayoutModernNudgeBtn = document.getElementById('reset-layout-modern-nudge-btn');
        if (resetLayoutModernNudgeBtn) {
            resetLayoutModernNudgeBtn.addEventListener('click', () => {
                const nudgeApi = window.LayoutVersionNudge || window.LayoutModernNudge;
                nudgeApi?.reset?.();
                let message;
                if (window.dashboardInstance) {
                    const nudge = window.dashboardInstance.layoutVersionNudge
                        || window.dashboardInstance.layoutModernNudge;
                    nudge?.dismiss?.(false);
                    window.dashboardInstance.layoutVersionNudge = null;
                    window.dashboardInstance.layoutModernNudge = null;
                    const started = window.dashboardInstance.maybeShowLayoutModernNudge?.() === true;
                    message = started
                        ? (this.language.t('config.resetLayoutModernNudgeSuccessShown')
                            || 'Layout prompt shown on the dashboard.')
                        : (this.language.t('config.resetLayoutModernNudgeSuccess')
                            || 'Layout prompt reset — reload the dashboard to see it again.');
                } else {
                    nudgeApi?.queueReplay?.();
                    message = this.language.t('config.resetLayoutModernNudgeSuccessOpenDashboard')
                        || 'Layout prompt reset — open the dashboard to see it.';
                }
                this.ui.showNotification(message, 'success');
            });
        }

        const resetPasteSpotlightBtn = document.getElementById('reset-paste-spotlight-btn');
        if (resetPasteSpotlightBtn) {
            resetPasteSpotlightBtn.addEventListener('click', () => {
                let message;
                if (window.dashboardInstance) {
                    window.FeatureSpotlight?.resetPasteSpotlight?.();
                    window.dashboardInstance.pasteSpotlight?.dismiss?.(false);
                    window.dashboardInstance.pasteSpotlight = null;
                    const started = window.dashboardInstance.maybeShowPasteSpotlight?.() === true;
                    message = started
                        ? (this.language.t('config.resetPasteSpotlightSuccessShown')
                            || 'Paste spotlight shown on the dashboard.')
                        : (this.language.t('config.resetPasteSpotlightSuccess')
                            || 'Paste spotlight reset — reload the dashboard if it does not appear.');
                } else {
                    window.FeatureSpotlight?.queuePasteReplay?.();
                    message = this.language.t('config.resetPasteSpotlightSuccessOpenDashboard')
                        || 'Paste spotlight reset — open the dashboard to see it.';
                }
                this.ui.showNotification(message, 'success');
            });
        }

        const resetPreviewCardSpotlightBtn = document.getElementById('reset-preview-card-spotlight-btn');
        if (resetPreviewCardSpotlightBtn) {
            resetPreviewCardSpotlightBtn.addEventListener('click', () => {
                let message;
                if (window.dashboardInstance) {
                    window.PreviewCardSpotlight?.reset?.();
                    window.dashboardInstance.previewCardSpotlight?.dismiss?.(false);
                    window.dashboardInstance.previewCardSpotlight = null;
                    const started = window.dashboardInstance.maybeShowPreviewCardSpotlight?.() === true;
                    message = started
                        ? (this.language.t('config.resetPreviewCardSpotlightSuccessShown')
                            || 'Preview cards spotlight shown on the dashboard.')
                        : (this.language.t('config.resetPreviewCardSpotlightSuccess')
                            || 'Preview cards spotlight reset — reload the dashboard if it does not appear.');
                } else {
                    window.PreviewCardSpotlight?.queueReplay?.();
                    message = this.language.t('config.resetPreviewCardSpotlightSuccessOpenDashboard')
                        || 'Preview cards spotlight reset — open the dashboard to see it.';
                }
                this.ui.showNotification(message, 'success');
            });
        }

        const resetSettingsSearchPromoBtn = document.getElementById('reset-settings-search-promo-btn');
        if (resetSettingsSearchPromoBtn) {
            resetSettingsSearchPromoBtn.addEventListener('click', () => {
                if (window.MobileExperience?.isMobileLayout?.()) {
                    this.ui.showNotification(
                        this.language.t('config.resetSettingsSearchPromoMobile')
                            || 'Settings search promo is hidden on mobile — use a wider window.',
                        'warning'
                    );
                    return;
                }
                window.ConfigSettingsSearch?.resetPromoSeen?.({ replay: true });
                this.ui.showNotification(
                    this.language.t('config.resetSettingsSearchPromoSuccess')
                        || 'Settings search promo reset — it should appear in a moment.',
                    'success'
                );
            });
        }

        const resetAllDashboardPromosBtn = document.getElementById('reset-all-dashboard-promos-btn');
        if (resetAllDashboardPromosBtn) {
            resetAllDashboardPromosBtn.addEventListener('click', () => {
                if (window.MobileExperience?.isMobileLayout?.()) {
                    this.ui.showNotification(
                        this.language.t('config.resetAllDashboardPromosMobile')
                            || 'Dashboard promos are hidden on mobile — use a wider window.',
                        'warning'
                    );
                    return;
                }
                const count = window.DashboardPromoRegistry?.clearAll?.() || 0;
                const message = window.dashboardInstance
                    ? (this.language.t('config.resetAllDashboardPromosSuccess')
                        || `Reset ${count} dashboard promo group(s) — they will replay on the dashboard.`)
                    : (this.language.t('config.resetAllDashboardPromosSuccessOpenDashboard')
                        || 'Dashboard promos reset — open the dashboard to replay them.');
                this.ui.showNotification(message, 'success');
            });
        }

        const resetGJumpPromoBtn = document.getElementById('reset-g-jump-promo-btn');
        if (resetGJumpPromoBtn) {
            resetGJumpPromoBtn.addEventListener('click', () => {
                if (window.MobileExperience?.isMobileLayout?.()) {
                    this.ui.showNotification(
                        this.language.t('config.resetGJumpPromoMobile')
                            || 'G+jump promo is hidden on mobile — use a wider window.',
                        'warning'
                    );
                    return;
                }
                window.DashboardGJumpPromo?.clearPromoSeen?.();
                const message = window.dashboardInstance
                    ? (this.language.t('config.resetGJumpPromoSuccess')
                        || 'G+jump promo reset — press G then 1–9 or GG on the dashboard.')
                    : (this.language.t('config.resetGJumpPromoSuccessOpenDashboard')
                        || 'G+jump promo reset — open the dashboard and press G then 1–9 or GG.');
                this.ui.showNotification(message, 'success');
            });
        }

        const resetCheatsheetPromoBtn = document.getElementById('reset-cheatsheet-promo-btn');
        if (resetCheatsheetPromoBtn) {
            resetCheatsheetPromoBtn.addEventListener('click', () => {
                if (window.MobileExperience?.isMobileLayout?.()) {
                    this.ui.showNotification(
                        this.language.t('config.resetCheatsheetPromoMobile')
                            || 'Cheat sheet promo is hidden on mobile — use a wider window.',
                        'warning'
                    );
                    return;
                }
                window.DashboardFeaturePromos?.clearPromoSeen?.('cheatsheet');
                let message;
                if (window.dashboardInstance) {
                    window.dashboardInstance.showKeyboardCheatSheet?.();
                    message = this.language.t('config.resetCheatsheetPromoSuccessShown')
                        || 'Cheat sheet promo reset — cheat sheet opened on the dashboard.';
                } else {
                    message = this.language.t('config.resetCheatsheetPromoSuccessOpenDashboard')
                        || 'Cheat sheet promo reset — open the dashboard and press ! or F1.';
                }
                this.ui.showNotification(message, 'success');
            });
        }

        const resetWeatherGeolocationPromoBtn = document.getElementById('reset-weather-geolocation-promo-btn');
        if (resetWeatherGeolocationPromoBtn) {
            resetWeatherGeolocationPromoBtn.addEventListener('click', () => {
                if (window.MobileExperience?.isMobileLayout?.()) {
                    this.ui.showNotification(
                        this.language.t('config.resetWeatherGeolocationPromoMobile')
                            || 'Weather location promo is hidden on mobile — use a wider window.',
                        'warning'
                    );
                    return;
                }
                if (this.settingsData.showWeatherWithDate !== true || this.settingsData.weatherSource !== 'browser') {
                    this.ui.showNotification(
                        this.language.t('config.resetWeatherGeolocationPromoNeedsBrowser')
                            || 'Enable weather and choose browser location in General first.',
                        'warning'
                    );
                }
                window.DashboardFeaturePromos?.clearPromoSeen?.('weatherGeolocation');
                let message;
                const dash = window.dashboardInstance;
                if (dash) {
                    const anchor = document.getElementById('date-element');
                    const shown = anchor
                        && window.DashboardFeaturePromos?.tryShow?.('weatherGeolocation', anchor);
                    if (!shown) {
                        void dash.refreshWeather?.(true);
                    }
                    message = this.language.t('config.resetWeatherGeolocationPromoSuccessShown')
                        || 'Weather location promo reset — check the dashboard header (block location if needed).';
                } else {
                    message = this.language.t('config.resetWeatherGeolocationPromoSuccessOpenDashboard')
                        || 'Weather location promo reset — open the dashboard with browser location enabled and deny geolocation if needed.';
                }
                this.ui.showNotification(message, 'success');
            });
        }

        window.ConfigPwaInstall?.bind?.(document.getElementById('pwa-install-panel'));

        this.settings.updateStatusOptionsVisibility(this.settingsData.showStatus);

        this.settings.attachSettingResetButtons(this.settingsData, () => this.markDirty());

        const addPageBtn = document.getElementById('add-page-btn');
        if (addPageBtn) addPageBtn.addEventListener('click', () => this.addPage());

        const addCategoryBtn = document.getElementById('add-category-btn');
        if (addCategoryBtn) addCategoryBtn.addEventListener('click', () => this.addCategory());

        const addBookmarkMenu = document.getElementById('bookmark-add-menu');
        const closeAddBookmarkMenu = () => {
            if (addBookmarkMenu) addBookmarkMenu.open = false;
        };

        const addBookmarkBtn = document.getElementById('add-bookmark-btn');
        if (addBookmarkBtn) {
            addBookmarkBtn.addEventListener('click', () => {
                closeAddBookmarkMenu();
                this.addBookmark();
            });
        }

        if (window.ConfigQuickAdd) {
            this.quickAdd = new window.ConfigQuickAdd(this);
            const quickAddBtn = document.getElementById('config-quick-add-btn');
            if (quickAddBtn) {
                quickAddBtn.addEventListener('click', () => {
                    closeAddBookmarkMenu();
                    this.quickAdd.open();
                });
            }
        }

        const structureAddPageBtn = document.getElementById('structure-add-page-btn');
        if (structureAddPageBtn) structureAddPageBtn.addEventListener('click', () => this.addPage());
        const structureAddCategoryBtn = document.getElementById('structure-add-category-btn');
        if (structureAddCategoryBtn) structureAddCategoryBtn.addEventListener('click', () => this.addCategory());
        const structureAddBookmarkBtn = document.getElementById('structure-add-bookmark-btn');
        if (structureAddBookmarkBtn) structureAddBookmarkBtn.addEventListener('click', () => this.addBookmark());

        const selectAllBookmarksBtn = document.getElementById('select-all-bookmarks-btn');
        if (selectAllBookmarksBtn) {
            selectAllBookmarksBtn.textContent = this.language.t('config.selectShort') || 'select all';
            selectAllBookmarksBtn.addEventListener('click', () => {
                this.bookmarks.selectAllVisible();
            });
        }

        const clearBookmarkSelectionBtn = document.getElementById('clear-bookmark-selection-btn');
        if (clearBookmarkSelectionBtn) {
            clearBookmarkSelectionBtn.textContent = this.language.t('config.clearShort') || 'clear selection';
            clearBookmarkSelectionBtn.addEventListener('click', () => {
                this.bookmarks.clearSelection();
            });
        }

        const detailDeleteBtn = document.getElementById('bookmark-detail-delete-btn');
        if (detailDeleteBtn) {
            detailDeleteBtn.addEventListener('click', () => {
                const activeIdx = this.bookmarks.activeDetailIndex;
                if (activeIdx === null || activeIdx === undefined) return;
                const activeBookmark = this.bookmarksData[activeIdx];
                if (!activeBookmark) return;
                if (activeBookmark._isNew) {
                    // New unsaved bookmark — remove without confirmation
                    this.bookmarksData.splice(activeIdx, 1);
                    this.bookmarks.activeDetailIndex = null;
                    this.bookmarks.setDetailPanelMode?.('empty');
                    this.refreshBookmarksList({ skipFlush: true });
                    this.markDirty();
                } else {
                    this.removeBookmark(activeIdx);
                }
            });
        }

        const bookmarksList = document.getElementById('bookmarks-list');
        if (bookmarksList) {
            bookmarksList.addEventListener('click', (e) => {
                if (e.target.closest('.bookmark-item')) return;
                if (this.bookmarks.activeDetailIndex === null) return;
                this.bookmarks.activeDetailIndex = null;
                document.querySelectorAll('.bookmark-item.is-selected-detail').forEach(el => el.classList.remove('is-selected-detail'));
                this.bookmarks.setDetailPanelMode?.('empty');
            });
        }

        const bulkDeleteBookmarksBtn = document.getElementById('bulk-delete-bookmarks-btn');
        if (bulkDeleteBookmarksBtn) {
            bulkDeleteBookmarksBtn.addEventListener('click', async () => {
                const undoSnapshot = this.captureUndoSnapshot();
                const removed = await this.bookmarks.bulkDelete(this.bookmarksData);
                if (removed) {
                    this.refreshBookmarksList();
                    this.showUndoNotification('Bookmarks removed.', undoSnapshot);
                    this.markDirty();
                }
            });
        }

        const bulkTogglePinBtn = document.getElementById('bulk-toggle-pin-btn');
        if (bulkTogglePinBtn) {
            bulkTogglePinBtn.addEventListener('click', () => {
                this.bookmarks.bulkTogglePin(this.bookmarksData);
                this.refreshBookmarksList({ skipFlush: true });
                this.markDirty();
            });
        }

        const bulkToggleStatusBtn = document.getElementById('bulk-toggle-status-btn');
        const bulkStatusActionSelect = document.getElementById('bulk-status-action-select');
        if (bulkToggleStatusBtn) {
            bulkToggleStatusBtn.addEventListener('click', () => {
                const mode = bulkStatusActionSelect ? bulkStatusActionSelect.value : 'toggle';
                const updated = this.bookmarks.bulkSetStatus(this.bookmarksData, mode);
                if (updated > 0) {
                    const modeLabel = mode === 'enable'
                        ? (this.language.t('config.bulkStatusEnabled') || 'enabled')
                        : mode === 'disable'
                            ? (this.language.t('config.bulkStatusDisabled') || 'disabled')
                            : (this.language.t('config.bulkStatusToggled') || 'toggled');
                    const template = this.language.t('config.bulkStatusUpdated') || 'Status check {mode} for {count} bookmark(s).';
                    this.ui.showNotification(template.replace('{mode}', modeLabel).replace('{count}', String(updated)), 'success');
                }
                this.refreshBookmarksList({ skipFlush: true });
                this.markDirty();
                this.settings?.refreshStatusEssentialsSummary?.(this.settingsData, this.allBookmarksData);
            });
        }

        const bulkMoveApplyBtn = document.getElementById('bulk-move-apply-btn');
        const bulkPageSelect = document.getElementById('bulk-page-select');
        const bulkMoveCategorySelect = document.getElementById('bulk-move-category-select');
        if (bulkPageSelect && bulkMoveCategorySelect) {
            bulkPageSelect.addEventListener('change', async () => {
                await this.populateBulkMoveCategorySelect(Number(bulkPageSelect.value || 0));
            });
        }
        if (bulkMoveApplyBtn && bulkPageSelect) {
            bulkMoveApplyBtn.addEventListener('click', async () => {
                const targetPageId = Number(bulkPageSelect.value || 0);
                if (!targetPageId) {
                    this.ui.showNotification(this.language.t('config.selectPageFirst') || 'Select a target page first.', 'info');
                    return;
                }
                const targetCategory = bulkMoveCategorySelect ? bulkMoveCategorySelect.value : '';
                const currentPageId = Number(this.currentPageId) || 1;
                if (targetPageId === currentPageId) {
                    const updated = this.bookmarks.bulkUpdateCategory(this.bookmarksData, targetCategory);
                    if (updated > 0) {
                        const template = this.language.t('config.bulkCategoryUpdated') || 'Category updated for {count} bookmark(s).';
                        this.ui.showNotification(template.replace('{count}', String(updated)), 'success');
                    }
                    this.refreshBookmarksList({ skipFlush: true });
                    this.markDirty();
                    return;
                }
                await this.bulkMoveBookmarksToPage(targetPageId, targetCategory);
            });
        }

        const bulkRefreshFaviconsBtn = document.getElementById('bulk-refresh-favicons-btn');
        if (bulkRefreshFaviconsBtn) {
            bulkRefreshFaviconsBtn.addEventListener('click', async () => {
                const refreshed = await this.bookmarks.bulkRefreshFavicons(this.bookmarksData);
                if (refreshed <= 0) {
                    this.ui.showNotification(this.language.t('config.selectBookmarksFirst') || 'Select bookmarks first.', 'info');
                    return;
                }
                const template = this.language.t('config.refreshedBookmarksCount') || 'Refreshed {count}.';
                this.ui.showNotification(template.replace('{count}', String(refreshed)), 'success');
                this.refreshBookmarksList({ skipFlush: true });
                this.markDirty();
            });
        }

        if (!this._findersAddDelegationBound) {
            this._findersAddDelegationBound = true;
            document.addEventListener('click', (e) => {
                const btn = e.target?.closest?.('#add-finder-btn');
                if (!btn || btn.disabled) {
                    return;
                }
                const findersPanel = document.querySelector('[data-tab-content="finders"]');
                if (!findersPanel?.classList.contains('active')) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                void this.addFinder();
            }, true);
        }

        const addCollectionBtn = document.getElementById('add-collection-btn');
        if (addCollectionBtn) addCollectionBtn.addEventListener('click', () => {
            if (this.collections) this.collections._openEdit(null, this);
        });

        const pageSelector = document.getElementById('page-selector');
        if (pageSelector) {
            pageSelector.addEventListener('change', async (e) => {
                const pid = parseInt(String(e.target.value), 10);
                if (!Number.isFinite(pid)) {
                    return;
                }
                this.saveLastCategoryFilterForPage(this.currentPageId, this.currentBookmarksCategoryFilter);
                this.currentBookmarksCategoryFilter = this.getLastCategoryFilterForPage(pid);
                this.currentBookmarksSearch = '';
                const searchEl = document.getElementById('bookmarks-search');
                if (searchEl) searchEl.value = '';
                const clearEl = document.getElementById('bookmarks-search-clear');
                if (clearEl) clearEl.hidden = true;
                await this.loadPageBookmarks(e.target.value);
                this.renderStructureWorkspace();
            });
        }
        const faviconPolicySelect = document.getElementById('favicon-refresh-policy-select');
        if (faviconPolicySelect) {
            faviconPolicySelect.value = this.settingsData.faviconRefreshPolicy || 'on-save';
            faviconPolicySelect.addEventListener('change', async (e) => {
                this.settingsData.faviconRefreshPolicy = e.target.value === 'manual' ? 'manual' : 'on-save';
                this.markDirty();
                await this.settings.saveSettingsToServer(this.settingsData);
            });
        }
        document.addEventListener('keydown', (e) => {
            const key = String(e.key).toLowerCase();
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.shiftKey && key === 'k') {
                e.preventDefault();
                window.ConfigSettingsSearch?.focusSearch?.();
                return;
            }
            if (!mod || e.shiftKey || key !== 'k') return;
            e.preventDefault();
            this.openConfigCommandPalette();
        });

        const bookmarksFilterSelector = document.getElementById('bookmarks-category-filter');
        if (bookmarksFilterSelector) {
            bookmarksFilterSelector.addEventListener('change', (e) => {
                this.currentBookmarksCategoryFilter = e.target.value;
                this.saveLastCategoryFilterForPage(this.currentPageId, this.currentBookmarksCategoryFilter);
                if (
                    this.currentBookmarksCategoryFilter &&
                    !String(this.currentBookmarksCategoryFilter).startsWith('__')
                ) {
                    this.saveLastUsedCategoryIdForPage(this.currentPageId, this.currentBookmarksCategoryFilter);
                }
                this.refreshBookmarksList();
                this.renderStructureWorkspace();
            });
        }

        const bookmarksSortSelector = document.getElementById('bookmarks-sort');
        if (bookmarksSortSelector) {
            bookmarksSortSelector.addEventListener('change', (e) => {
                this.currentBookmarksSort = e.target.value;
                this.refreshBookmarksList();
            });
        }

        const bookmarksSearchInput = document.getElementById('bookmarks-search');
        const bookmarksSearchClear = document.getElementById('bookmarks-search-clear');
        if (bookmarksSearchInput) {
            bookmarksSearchInput.addEventListener('input', (e) => {
                this.currentBookmarksSearch = e.target.value;
                if (bookmarksSearchClear) bookmarksSearchClear.hidden = !e.target.value;
                this.refreshBookmarksList();
            });
            bookmarksSearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    bookmarksSearchInput.value = '';
                    this.currentBookmarksSearch = '';
                    if (bookmarksSearchClear) bookmarksSearchClear.hidden = true;
                    this.refreshBookmarksList();
                }
            });
        }
        if (bookmarksSearchClear) {
            bookmarksSearchClear.addEventListener('click', () => {
                if (bookmarksSearchInput) bookmarksSearchInput.value = '';
                this.currentBookmarksSearch = '';
                bookmarksSearchClear.hidden = true;
                this.refreshBookmarksList();
                if (bookmarksSearchInput) bookmarksSearchInput.focus();
            });
        }

        const categoriesPageSelector = document.getElementById('categories-page-selector');
        if (categoriesPageSelector) {
            categoriesPageSelector.addEventListener('change', async (e) => {
                const nextPageId = parseInt(String(e.target.value), 10);
                if (!Number.isFinite(nextPageId)) {
                    return;
                }
                if (Number(nextPageId) === Number(this.currentCategoriesPageId)) {
                    return;
                }

                const flushed = await this.flushCategoriesPageBeforeSwitch();
                if (!flushed) {
                    this.syncCategoriesPageSelectorUI(this.currentCategoriesPageId);
                    return;
                }

                this.currentCategoriesPageId = nextPageId;
                this.saveLastCategoriesPageId(nextPageId);
                await this.loadPageCategories(nextPageId);
                this.syncCategoriesPageSelectorUI(nextPageId);
            });
        }

        const saveBtn = document.getElementById('save-btn');
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveChanges());

        const showWhatsNewBtn = document.getElementById('config-show-whats-new-btn');
        if (showWhatsNewBtn) {
            showWhatsNewBtn.addEventListener('click', () => {
                if (typeof window.openWhatsNewModal === 'function') {
                    window.openWhatsNewModal({ force: true });
                }
            });
        }

        const undoTopBtn = document.getElementById('undo-top-btn');
        if (undoTopBtn) {
            undoTopBtn.addEventListener('click', () => {
                if (this.undoSnapshot) {
                    this.restoreUndoSnapshot(this.undoSnapshot);
                    this.undoSnapshot = null;
                    this.ui.showNotification('Undone.', 'success');
                }
            });
        }

        const discardTopBtn = document.getElementById('discard-top-btn');
        if (discardTopBtn) discardTopBtn.addEventListener('click', () => this.discardChanges());

        const resetBtn = document.getElementById('reset-btn');
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetToDefaults());
        const resetContextTipsBtn = document.getElementById('reset-context-tips-btn');
        if (resetContextTipsBtn) {
            resetContextTipsBtn.addEventListener('click', async () => {
                const confirmed = await window.AppModal.confirm({
                    title: this.language.t('config.resetContextTipsTitle') || 'Reset context tips',
                    message: this.language.t('config.resetContextTipsConfirm') || 'All dismissed context tips will appear again on the dashboard.',
                    confirmText: this.language.t('config.resetContextTipsButton') || 'Reset context tips',
                    cancelText: this.language.t('config.cancel') || 'Cancel',
                });
                if (!confirmed) return;
                try {
                    localStorage.removeItem('nextdash-inline-context-tip-usage-v1');
                    localStorage.removeItem('nextdash-inline-context-tip-usage-v2');
                } catch {
                    // Ignore storage errors
                }
                this.ui.showNotification(this.language.t('config.resetContextTipsSuccess') || 'Context tips reset. They will show again per page.', 'success');
            });
        }
        this.setupStructureAutoSyncListeners();
        this.setupDirtyTracking();
        this.setupAutosaveLowRiskFields();
        this.setupStickySaveBar();
        this.setupNavigationGuards();
        this.setupHealthBadgeRefresh();
        window.ConfigHelpSearch?.init(this.language);
        window.ConfigSettingsSearch?.init(this.language);
        this.updateHealthBadge();
        // Initialize theme icon styling controls
        try {
            this.initThemeIconStylingControls();
        } catch (e) {
            // ignore; non-critical
        }
    }

    setupHealthBadgeRefresh() {
        if (this._healthBadgeRefreshBound) return;
        this._healthBadgeRefreshBound = true;
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.updateHealthBadge();
            }
        });
    }

    async updateHealthBadge() {
        const anchor = document.querySelector('header.header .header-links a.back-link[href^="/health"]');
        const utils = window.HealthBadgeUtils;
        if (!anchor || !utils) return;
        try {
            const summary = await utils.fetchBookmarkHealthSummary();
            if (!summary) return;
            utils.applyHealthBadgeToAnchor(anchor, summary, this.language, {
                onApplied: ({ broken }) => {
                    this._healthBrokenCount = broken;
                    this.settings?.applyStatusEssentialsHealthHref?.(broken);
                    this.settings?.refreshStatusEssentialsSummary?.(this.settingsData, this.allBookmarksData);
                },
            });
        } catch (e) {
            // Non-critical — silently skip
        }
    }

    setupNavigationGuards() {
        document.querySelectorAll('header.header .back-link').forEach((link) => {
            link.addEventListener('click', async (event) => {
                const href = link.getAttribute('href');
                if (!href) {
                    return;
                }
                if (!this.isDirty && !this.hasUnsavedColorChanges()) {
                    return;
                }
                event.preventDefault();
                let shouldLeave = true;
                if (this.isDirty) {
                    shouldLeave = await this.confirmLeaveWithUnsavedChanges();
                }
                if (shouldLeave && this.hasUnsavedColorChanges()) {
                    shouldLeave = await this.colorsEditor.confirmLeave();
                }
                if (!shouldLeave) {
                    return;
                }
                this.isNavigatingAway = true;
                window.location.href = href;
            });
        });
    }

    setupStructureAutoSyncListeners() {
        const pagesList = document.getElementById('pages-list');
        if (pagesList) {
            pagesList.addEventListener('change', async (event) => {
                const target = event.target;
                if (!(target instanceof HTMLInputElement)) return;
                if (target.getAttribute('data-field') !== 'name') return;
                await this.persistPagesStructureAndRefresh('page-renamed');
            });
        }

        const categoriesList = document.getElementById('categories-list');
        if (categoriesList) {
            categoriesList.addEventListener('change', async (event) => {
                const target = event.target;
                if (!(target instanceof HTMLInputElement)) return;
                const field = target.getAttribute('data-field');
                const row = target.closest('.category-item');
                const category = row ? row._categoryRef : null;
                if (!category) return;

                if (field === 'name') {
                    const categoryBeforeRename = category.originalId || category.id;
                    const renameResult = this.applyCategoryRenameWithConflictGuard(category, target.value, categoryBeforeRename);
                    if (!renameResult) return;
                    await this.persistCategoriesStructureAndRefresh({
                        persistBookmarks: true,
                        eventType: 'category-renamed',
                        categoryRenameMap: renameResult
                    });
                    return;
                }

                if (field === 'icon') {
                    category.icon = (target.value || '').trim();
                    await this.persistCategoriesStructureAndRefresh({ eventType: 'category-icon-updated' });
                }
            });
        }
    }

    async withRetry(task, options = {}) {
        const retries = Number(options.retries ?? 2);
        const baseDelayMs = Number(options.baseDelayMs ?? 250);
        let lastError = null;

        for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
                return await task();
            } catch (error) {
                lastError = error;
                if (attempt >= retries) {
                    break;
                }
                const delayMs = baseDelayMs * (2 ** attempt);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }

        throw lastError;
    }

    setupGeneralCardCollapsible() {
        const storageKey = 'nextdash-config-general-panel-state';
        const DEFAULT_OPEN_ESSENTIALS = new Set(['localization', 'basics-core', 'layout', 'status-essentials-summary']);
        const DEFAULT_OPEN_ADVANCED = new Set([]);

        const getDefaultOpenForLayer = (layerMode) => {
            if (layerMode === 'advanced') return DEFAULT_OPEN_ADVANCED;
            if (layerMode === 'all') return new Set([...DEFAULT_OPEN_ESSENTIALS, ...DEFAULT_OPEN_ADVANCED]);
            return DEFAULT_OPEN_ESSENTIALS;
        };

        const readSavedPanelState = () => {
            try {
                const raw = localStorage.getItem(storageKey);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
            } catch { /* ignore */ }
            return null;
        };

        const syncTitleA11y = (card, title) => {
            const expanded = !card.classList.contains('is-collapsed');
            title.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            const panelId = card.getAttribute('data-general-panel');
            if (panelId) {
                title.setAttribute('aria-controls', `general-panel-body-${panelId}`);
            }
        };

        const ensureGeneralCardBody = (card, title, panelId) => {
            if (!panelId || card.querySelector('.general-card-body')) return;
            const body = document.createElement('div');
            body.className = 'general-card-body';
            body.id = `general-panel-body-${panelId}`;
            while (title.nextElementSibling) {
                body.appendChild(title.nextElementSibling);
            }
            title.after(body);
        };

        this.refreshGeneralPanelExpandState = () => {
            const layerMode = document.querySelector('[data-tab-content="general"] > div')?.dataset?.generalLayer
                || this.generalLayers?.layer
                || 'essentials';
            const DEFAULT_OPEN = getDefaultOpenForLayer(layerMode);
            const saved = readSavedPanelState();

            document.querySelectorAll('.general-card[data-general-panel]').forEach((card) => {
                if (card.hidden) return;
                const title = card.querySelector('.section-title');
                if (!title) return;
                const panelId = card.getAttribute('data-general-panel');
                if (!panelId) return;
                const alwaysCollapsed = panelId === 'reset';
                const expanded = !alwaysCollapsed && (saved && Object.prototype.hasOwnProperty.call(saved, panelId)
                    ? Boolean(saved[panelId])
                    : DEFAULT_OPEN.has(panelId));
                card.classList.toggle('is-collapsed', !expanded);
                syncTitleA11y(card, title);
            });
        };

        const layer = this.generalLayers?.layer || 'essentials';
        const DEFAULT_OPEN = getDefaultOpenForLayer(layer);
        let saved = readSavedPanelState();

        const persistState = () => {
            const state = {};
            document.querySelectorAll('.general-card[data-general-panel]').forEach((card) => {
                const id = card.getAttribute('data-general-panel');
                if (id) state[id] = !card.classList.contains('is-collapsed');
            });
            // Also persist smart-collection <details> open state under key 'sc:<id>'
            document.querySelectorAll('.smart-collection-group[data-sc-id]').forEach((el) => {
                state[`sc:${el.dataset.scId}`] = el.open;
            });
            try {
                localStorage.setItem(storageKey, JSON.stringify(state));
            } catch { /* ignore quota / private mode */ }
        };
        // Expose so saveChanges can call it too
        this._persistGeneralPanelState = persistState;

        // Wire general-card collapse
        document.querySelectorAll('.general-card').forEach((card) => {
            const title = card.querySelector('.section-title');
            if (!title) return;
            card.classList.add('is-collapsible');
            title.setAttribute('role', 'button');
            title.setAttribute('tabindex', '0');
            const panelId = card.getAttribute('data-general-panel');
            if (panelId) {
                ensureGeneralCardBody(card, title, panelId);
            }
            if (panelId) {
                const alwaysCollapsed = panelId === 'reset';
                const tier = card.dataset.configTier || 'advanced';
                const layerMode = document.querySelector('[data-tab-content="general"] > div')?.dataset?.generalLayer || 'essentials';
                const tierVisible = layerMode === 'all' || tier === layerMode;
                const expanded = tierVisible && !alwaysCollapsed && (saved && Object.prototype.hasOwnProperty.call(saved, panelId)
                    ? Boolean(saved[panelId])
                    : DEFAULT_OPEN.has(panelId));
                card.classList.toggle('is-collapsed', !expanded);
            }
            syncTitleA11y(card, title);
            const toggleCard = () => {
                card.classList.toggle('is-collapsed');
                syncTitleA11y(card, title);
                if (card.getAttribute('data-general-panel')) persistState();
                if (panelId === 'reset') this.syncResetPanelGuard();
            };
            title.addEventListener('click', toggleCard);
            title.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleCard();
                }
            });
        });

        // Wire smart-collection <details> persistence
        document.querySelectorAll('.smart-collection-group').forEach((el) => {
            const id = el.querySelector('input[type="checkbox"]')?.id || '';
            if (!id) return;
            el.dataset.scId = id;
            const savedOpen = saved && Object.prototype.hasOwnProperty.call(saved, `sc:${id}`)
                ? Boolean(saved[`sc:${id}`])
                : false; // all collapsed by default
            el.open = savedOpen;
            el.addEventListener('toggle', () => persistState());
        });

        this.syncResetPanelGuard();
    }

    setupBookmarksTabCollapsibles() {
        const STRUCTURE_KEY = 'nextdash-config-structure-workspace-v1';
        const MORE_KEY = 'nextdash-config-bookmark-detail-more-v1';

        const structureCard = document.getElementById('structure-workspace-card');
        const structureToggle = document.getElementById('structure-workspace-toggle');
        if (structureCard && structureToggle) {
            let structureExpanded = false;
            try {
                const raw = localStorage.getItem(STRUCTURE_KEY);
                if (raw === '1' || raw === 'true') structureExpanded = true;
            } catch { /* ignore */ }

            const setStructureExpanded = (expanded, persist = true) => {
                structureCard.classList.toggle('is-collapsed', !expanded);
                structureToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                if (persist) {
                    try {
                        localStorage.setItem(STRUCTURE_KEY, expanded ? '1' : '0');
                    } catch { /* ignore */ }
                }
            };

            setStructureExpanded(structureExpanded, false);

            const toggleStructure = () => setStructureExpanded(structureCard.classList.contains('is-collapsed'));
            structureToggle.addEventListener('click', toggleStructure);
            structureToggle.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleStructure();
                }
            });

            this.expandStructureWorkspace = () => setStructureExpanded(true);
        }

        const moreDetails = document.getElementById('bookmark-detail-more');
        if (moreDetails) {
            let moreOpen = false;
            try {
                const raw = localStorage.getItem(MORE_KEY);
                if (raw === '1' || raw === 'true') moreOpen = true;
            } catch { /* ignore */ }

            moreDetails.open = moreOpen;
            moreDetails.addEventListener('toggle', () => {
                try {
                    localStorage.setItem(MORE_KEY, moreDetails.open ? '1' : '0');
                } catch { /* ignore */ }
            });
        }
    }

    async refreshSmartCollectionCounters() {
        try {
            const res = await fetch('/api/bookmarks?all=true');
            if (!res.ok) return;
            const allBookmarks = await res.json();
            const list = Array.isArray(allBookmarks) ? allBookmarks : [];
            const now = Date.now();
            const weekMs = 7 * 24 * 60 * 60 * 1000;
            const staleMs = 30 * 24 * 60 * 60 * 1000;

            const recentCount = list.filter((bookmark) => {
                const lastOpened = Number(bookmark?.lastOpened || 0);
                return lastOpened > 0 && (now - lastOpened) <= weekMs;
            }).length;
            const staleCount = list.filter((bookmark) => {
                const lastOpened = Number(bookmark?.lastOpened || 0);
                return lastOpened === 0 || (now - lastOpened) > staleMs;
            }).length;
            const mostUsedCount = list.filter((bookmark) => Number(bookmark?.openCount || 0) > 0).length;
            const todayCount = list.length;

            const setBadge = (id, count) => {
                const el = document.getElementById(id);
                if (el) el.textContent = String(count);
            };
            setBadge('smart-recent-count-badge', recentCount);
            setBadge('smart-today-count-badge', todayCount);
            setBadge('smart-stale-count-badge', staleCount);
            setBadge('smart-most-used-count-badge', mostUsedCount);
        } catch (error) {
            // Keep config functional even if counters fail.
        }
    }

    setupCascadingCheckboxes() {
        // Define parent-child relationships for checkboxes
        const cascadingPairs = [
            { parent: 'show-status-checkbox', children: ['show-ping-checkbox', 'show-status-loading-checkbox', 'skip-fast-ping-checkbox'] },
            { parent: 'show-page-tabs-checkbox', children: ['show-page-names-in-tabs-checkbox'] },
            { parent: 'enable-custom-title-checkbox', children: ['custom-title-input', 'show-page-in-title-checkbox'] },
            { parent: 'enable-fuzzy-suggestions-checkbox', children: ['fuzzy-suggestions-start-with-checkbox'] },
            { parent: 'enable-custom-favicon-checkbox', children: ['custom-favicon-input'] }
        ];

        // Set up event listeners for each parent checkbox
        cascadingPairs.forEach(pair => {
            const parentCheckbox = document.getElementById(pair.parent);
            if (parentCheckbox) {
                parentCheckbox.addEventListener('change', (e) => {
                    pair.children.forEach(childId => {
                        const childElement = document.getElementById(childId);
                        if (childElement) {
                            if (childElement.type === 'checkbox') {
                                childElement.disabled = !e.target.checked;
                                // Visual feedback: gray out child if disabled
                                const parentItem = childElement.closest('.checkbox-tree-child');
                                if (parentItem) {
                                    if (!e.target.checked) {
                                        parentItem.style.opacity = '0.5';
                                        parentItem.style.pointerEvents = 'none';
                                    } else {
                                        parentItem.style.opacity = '1';
                                        parentItem.style.pointerEvents = 'auto';
                                    }
                                }
                            } else if (childElement.type === 'file' || childElement.tagName === 'INPUT') {
                                childElement.disabled = !e.target.checked;
                                const parentItem = childElement.closest('.checkbox-tree-child');
                                if (parentItem) {
                                    if (!e.target.checked) {
                                        parentItem.style.opacity = '0.5';
                                        parentItem.style.pointerEvents = 'none';
                                    } else {
                                        parentItem.style.opacity = '1';
                                        parentItem.style.pointerEvents = 'auto';
                                    }
                                }
                            }
                        }
                    });
                });
                
                // Initialize disabled state on load
                const isChecked = parentCheckbox.checked;
                pair.children.forEach(childId => {
                    const childElement = document.getElementById(childId);
                    if (childElement) {
                        childElement.disabled = !isChecked;
                        if (!isChecked) {
                            const parentItem = childElement.closest('.checkbox-tree-child');
                            if (parentItem) {
                                parentItem.style.opacity = '0.5';
                                parentItem.style.pointerEvents = 'none';
                            }
                        }
                    }
                });
            }
        });
    }

    setupInputValidation() {
        // Validate columns input (1-6)
        const columnsInput = document.getElementById('columns-input');
        if (columnsInput) {
            columnsInput.addEventListener('input', (e) => {
                let value = parseInt(e.target.value);
                if (isNaN(value)) value = 3;
                if (value < 1) value = 1;
                if (value > 6) value = 6;
                e.target.value = value;
            });
        }

        // Validate custom title (max length handled by maxlength attribute)
        const customTitleInput = document.getElementById('custom-title-input');
        if (customTitleInput) {
            customTitleInput.addEventListener('input', (e) => {
                // Show character count feedback if near limit
                if (e.target.value.length > 85) {
                    e.target.title = `${e.target.value.length} / 100 characters`;
                } else {
                    e.target.title = '';
                }
            });
        }

        // File input validation
        const faviconInput = document.getElementById('custom-favicon-input');
        if (faviconInput) {
            faviconInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    const maxSize = 1024 * 1024; // 1MB
                    if (file.size > maxSize) {
                        this.ui.showNotification(this.language.t('config.fileTooLarge') || 'File is too large (max 1MB)', 'error');
                        e.target.value = '';
                        return;
                    }
                    const validTypes = ['image/x-icon', 'image/png', 'image/jpeg', 'image/gif'];
                    if (!validTypes.includes(file.type)) {
                        this.ui.showNotification(this.language.t('config.invalidFileType') || 'Invalid file type', 'error');
                        e.target.value = '';
                    }
                }
            });
        }

        const fontInput = document.getElementById('custom-font-input');
        if (fontInput) {
            fontInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    const maxSize = 5 * 1024 * 1024; // 5MB
                    if (file.size > maxSize) {
                        this.ui.showNotification(this.language.t('config.fileTooLarge') || 'File is too large (max 5MB)', 'error');
                        e.target.value = '';
                        return;
                    }
                    const validTypes = ['font/woff', 'font/woff2', 'font/ttf', 'font/otf'];
                    if (!validTypes.includes(file.type)) {
                        this.ui.showNotification(this.language.t('config.invalidFileType') || 'Invalid file type', 'error');
                        e.target.value = '';
                    }
                }
            });
        }
    }

    renderConfig() {
        this.pagesData = this.applyPagesNormalization(this.pagesData);
        this.pages.render(this.pagesData, this.generateId.bind(this), this.isPageArchived.bind(this));
        if (this.settings && typeof this.settings.populateSmartPageSelectors === 'function') {
            this.settings.populateSmartPageSelectors(this.pagesData, this.settingsData);
        }

        const visiblePages = this.getVisiblePages();
        if (visiblePages.length > 0 && this.isPageArchived(this.currentPageId)) {
            this.currentPageId = Number(visiblePages[0].id);
        }
        this.pages.renderPageSelector(this.getVisiblePages(), this.currentPageId);

        const categoriesSelector = document.getElementById('categories-page-selector');
        if (categoriesSelector) {
            if (visiblePages.length > 0 && this.isPageArchived(this.currentCategoriesPageId)) {
                this.currentCategoriesPageId = Number(visiblePages[0].id);
            }
            
            categoriesSelector.innerHTML = '';
            const wantCatPage = Number(this.currentCategoriesPageId);
            let catMatched = false;
            this.getVisiblePages().forEach(page => {
                const option = document.createElement('option');
                option.value = page.id;
                option.textContent = page.name;
                if (Number.isFinite(wantCatPage) && Number(page.id) === wantCatPage) {
                    option.selected = true;
                    catMatched = true;
                }
                categoriesSelector.appendChild(option);
            });
            if (catMatched) {
                categoriesSelector.value = String(wantCatPage);
            } else if (categoriesSelector.options.length > 0) {
                categoriesSelector.value = categoriesSelector.options[0].value;
                this.currentCategoriesPageId = Number(categoriesSelector.value);
            }
            categoriesSelector.__customSelectInstance?.refresh?.();
        }

        this.refreshBookmarksFilterOptions();
        this.refreshBookmarksList();
        this.renderStructureWorkspace();
        this.finders.refresh(this);
        this.refreshCustomSelects();
        this.refreshPageDropdowns();
        if (this.collections) this.collections.refresh(this);

        // Set checkbox states
        const interleaveModeCheckbox = document.getElementById('interleave-mode-checkbox');
        if (interleaveModeCheckbox) interleaveModeCheckbox.checked = this.settingsData.interleaveMode;
        this.updateThemePreviewBadge();
    }

    refreshCustomSelects() {
        const selects = document.querySelectorAll('select[data-custom-select-init="true"]');
        
        selects.forEach(select => {
            const wrapper = select.closest('.custom-select-wrapper');
            if (!wrapper) return;

            const optionsContainer = wrapper.querySelector('.custom-select-options');
            const trigger = wrapper.querySelector('.custom-select-trigger .custom-select-text');
            
            if (optionsContainer && trigger) {
                optionsContainer.innerHTML = '';
                
                Array.from(select.options).forEach((option, index) => {
                    const optionDiv = document.createElement('div');
                    optionDiv.className = 'custom-select-option';
                    optionDiv.textContent = option.textContent;
                    optionDiv.dataset.value = option.value;
                    optionDiv.dataset.index = index;
                    
                    if (option.selected) optionDiv.classList.add('selected');
                    
                    optionDiv.addEventListener('click', (e) => {
                        e.stopPropagation();
                        select.selectedIndex = index;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        trigger.textContent = option.textContent;
                        optionsContainer.querySelectorAll('.custom-select-option').forEach(opt => {
                            opt.classList.remove('selected');
                        });
                        optionDiv.classList.add('selected');
                        wrapper.querySelector('.custom-select').classList.remove('open');
                    });
                    
                    optionsContainer.appendChild(optionDiv);
                });
                
                const selectedOption = select.options[select.selectedIndex];
                if (selectedOption) trigger.textContent = selectedOption.textContent;
            }
        });
    }

    initReordering() {
        this.pages.initReorder(this.pagesData, (newPages) => this.handlePagesReordered(newPages));

        this.categories.initReorder(
            this.categoriesData,
            (newCategories) => this.handleCategoriesReordered(newCategories)
        );

        this.refreshBookmarksList();
    }

    addBookmark() {
        const filterValue = this.currentBookmarksCategoryFilter || '__all__';
        let preferredCategory = '';
        if (filterValue !== '__all__' && filterValue !== '__none__' && !String(filterValue).startsWith('__')) {
            preferredCategory = filterValue;
        } else {
            preferredCategory = this.getLastUsedCategoryIdForPage(this.currentPageId) || '';
        }
        const newBookmark = this.bookmarks.add(this.bookmarksData, { preferredCategory });
        this.warnDuplicateUrl(newBookmark.url);
        const newIndex = this.bookmarksData.length - 1;
        this.refreshBookmarksList({ focusIndex: newIndex });
        if (typeof this.bookmarks.openDetailPanel === 'function') {
            this.bookmarks.openDetailPanel(newIndex, this.bookmarksData, this.bookmarksPageCategories);
        }
        if (this.settingsData.faviconRefreshPolicy === 'on-save' && typeof this.bookmarks._refreshDetailMeta === 'function') {
            this.bookmarks._refreshDetailMeta(newIndex, newBookmark);
        }
        this.markDirty();
    }

    async removeBookmark(index) {
        const undoSnapshot = this.captureUndoSnapshot();
        const removed = await this.bookmarks.remove(this.bookmarksData, index);
        if (removed) {
            if (this.bookmarks.activeDetailIndex === index) {
                this.bookmarks.activeDetailIndex = null;
                this.bookmarks.setDetailPanelMode?.('empty');
            }
            this.refreshBookmarksList();
            try {
                const saveBookmarksPageId = this.getResolvedBookmarksPageId();
                this.currentPageId = saveBookmarksPageId;
                await this.saveBookmarksPage(saveBookmarksPageId, this.bookmarksData);
                this.showUndoNotification('Bookmark removed.', undoSnapshot);
                this.markDirty();
            } catch (error) {
                this.restoreUndoSnapshot(undoSnapshot);
                this.undoSnapshot = null;
                this.ui.showNotification('Failed to remove bookmark. Changes reverted.', 'error');
            }
        }
    }

    async moveBookmark(index) {
        const bookmark = this.bookmarksData[index];
        if (!bookmark) return;

        // Create page options
        const pageOptions = this.pagesData
            .map(page => {
                const isCurrent = Number(page.id) === Number(this.currentPageId);
                return `<button class="modal-page-btn ${isCurrent ? 'current' : ''}" ${isCurrent ? 'disabled' : `onclick="window.tempMoveBookmark(${index}, ${page.id})"`}>${page.name}${isCurrent ? ' (current)' : ''}</button>`;
            })
            .join('');

        const html = `
            <p>${this.language.t('config.moveBookmarkMessage')}</p>
            <div class="modal-page-list">
                ${pageOptions}
            </div>
        `;

        // Define temp function
        window.tempMoveBookmark = async (idx, pid) => {
            await this.doMoveBookmark(idx, pid);
            AppModal.hide();
        };

        await window.AppModal.confirm({
            title: this.language.t('config.moveBookmarkTitle'),
            htmlMessage: html,
            confirmText: this.language.t('config.cancel'),
            showCancel: false,
            onConfirm: () => {}
        });

        // Clean up
        delete window.tempMoveBookmark;
    }

    async doMoveBookmark(index, newPageId, targetCategory) {
        const bookmark = this.bookmarksData[index];
        if (!bookmark) return;

        const sourcePageId = this.getResolvedBookmarksPageId();

        if (Number(newPageId) === Number(sourcePageId)) {
            this.ui.showNotification(this.language.t('config.bookmarkAlreadyHere'), 'info');
            return;
        }

        try {
            // Remove from current page
            this.bookmarksData.splice(index, 1);

            // Load bookmarks from new page
            const newPageBookmarks = await this.data.loadBookmarksByPage(newPageId);

            // Use the explicitly chosen category, or clear it if none given
            const movedBookmark = { ...bookmark, category: targetCategory || '' };
            newPageBookmarks.push(movedBookmark);

            // Save both pages
            await this.saveBookmarksPage(sourcePageId, this.bookmarksData);
            await this.saveBookmarksPage(newPageId, newPageBookmarks);

            // Re-render current page
            this.refreshBookmarksList();

            this.ui.showNotification(this.language.t('config.bookmarkMoved'), 'success');
        } catch (error) {
            console.error('Error moving bookmark:', error);
            this.ui.showNotification(this.language.t('config.errorMovingBookmark'), 'error');
        }
    }

    async bulkMoveBookmarksToPage(newPageId, targetCategory = '') {
        const currentPageId = Number(this.currentPageId) || 1;
        if (newPageId === currentPageId) {
            this.ui.showNotification(this.language.t('config.bookmarkAlreadyHere'), 'info');
            return;
        }

        const selectedIndexes = this.bookmarks.getSelectedIndexes();
        if (!Array.isArray(selectedIndexes) || selectedIndexes.length === 0) {
            this.ui.showNotification(this.language.t('config.selectBookmarksFirst') || 'Select bookmarks first.', 'info');
            return;
        }

        const selectedSet = new Set(selectedIndexes);
        const bookmarksToMove = selectedIndexes
            .map((index) => this.bookmarksData[index])
            .filter(Boolean);

        if (bookmarksToMove.length === 0) {
            this.ui.showNotification('No bookmarks selected.', 'info');
            return;
        }

        const remainingBookmarks = this.bookmarksData.filter((_, index) => !selectedSet.has(index));

        try {
            const targetBookmarks = await this.data.loadBookmarksByPage(newPageId);
            const movedBookmarks = bookmarksToMove.map((bookmark) => ({ ...bookmark, category: targetCategory }));
            const updatedTargetBookmarks = [...targetBookmarks, ...movedBookmarks];

            await this.saveBookmarksPage(currentPageId, remainingBookmarks);
            await this.saveBookmarksPage(newPageId, updatedTargetBookmarks);

            this.bookmarksData = remainingBookmarks;
            this.bookmarks.clearSelection();
            this.refreshBookmarksList({ skipFlush: true });
            this.ui.showNotification(`${movedBookmarks.length} bookmark(s) moved to page.`, 'success');
        } catch (error) {
            console.error('Error moving bookmarks to page:', error);
            this.ui.showNotification(this.language.t('config.errorMovingBookmark') || 'Failed to move bookmarks.', 'error');
        }
    }

    refreshPageDropdowns() {
        const visiblePages = this.getVisiblePages();
        this.currentPageId = this.resolvePageId(this.currentPageId, visiblePages);
        this.currentCategoriesPageId = this.resolvePageId(this.currentCategoriesPageId, visiblePages);

        // Bookmarks tab page selector
        this.pages.renderPageSelector(visiblePages, this.currentPageId);
        const pageSel = document.getElementById('page-selector');
        if (pageSel && pageSel.__customSelectInstance) {
            pageSel.__customSelectInstance.refresh();
        }

        // Categories tab page selector
        const catSel = document.getElementById('categories-page-selector');
        if (catSel) {
            const wantCatPage = Number(this.currentCategoriesPageId);
            catSel.innerHTML = '';
            let catMatched = false;
            visiblePages.forEach(page => {
                const opt = document.createElement('option');
                opt.value = page.id;
                opt.textContent = page.name;
                if (Number.isFinite(wantCatPage) && Number(page.id) === wantCatPage) {
                    opt.selected = true;
                    catMatched = true;
                }
                catSel.appendChild(opt);
            });
            if (catMatched) {
                catSel.value = String(wantCatPage);
            } else if (catSel.options.length > 0) {
                catSel.value = catSel.options[0].value;
                this.currentCategoriesPageId = Number(catSel.value);
            }
            catSel.__customSelectInstance?.refresh?.();
        }

        // Settings tab smart-collection page selectors
        if (this.settings && typeof this.settings.populateSmartPageSelectors === 'function') {
            this.settings.populateSmartPageSelectors(this.pagesData, this.settingsData);
        }
    }

    refreshBookmarksFilterOptions() {
        const filterSelect = document.getElementById('bookmarks-category-filter');
        if (!filterSelect) {
            return;
        }

        const previousValue = this.currentBookmarksCategoryFilter || filterSelect.value || '__all__';
        const options = [];

        options.push({ value: '__all__', label: this.language.t('config.allCategories') || 'All categories' });
        options.push({ value: '__none__', label: this.language.t('config.noCategory') || 'No category' });
        options.push({ value: '__missing_icon__', label: this.language.t('config.filterMissingFavicon') || 'Missing favicon' });
        options.push({ value: '__icon_failed__', label: this.language.t('config.filterFaviconFailed') || 'Favicon failed' });

        this.bookmarksPageCategories.forEach((category) => {
            options.push({ value: category.id, label: category.name });
        });

        filterSelect.innerHTML = '';
        options.forEach((optionData) => {
            const option = document.createElement('option');
            option.value = optionData.value;
            option.textContent = optionData.label;
            filterSelect.appendChild(option);
        });

        const isStillValid = options.some((option) => option.value === previousValue);
        this.currentBookmarksCategoryFilter = isStillValid ? previousValue : '__all__';
        filterSelect.value = this.currentBookmarksCategoryFilter;

        const bulkPageSelect = document.getElementById('bulk-page-select');
        if (bulkPageSelect) {
            const currentPageId = Number(this.currentPageId) || 1;
            const previousPage = bulkPageSelect.value;
            bulkPageSelect.innerHTML = '';
            const currentSuffix = this.language.t('config.currentPageShort') || 'current';

            this.getVisiblePages().forEach((page) => {
                const option = document.createElement('option');
                option.value = String(page.id);
                option.textContent = Number(page.id) === currentPageId
                    ? `${page.name} (${currentSuffix})`
                    : page.name;
                bulkPageSelect.appendChild(option);
            });

            const restoredPageId = this.getVisiblePages().some((page) => String(page.id) === previousPage)
                ? Number(previousPage)
                : currentPageId;
            bulkPageSelect.value = String(restoredPageId);
            void this.populateBulkMoveCategorySelect(restoredPageId);
        }
    }

    async populateBulkMoveCategorySelect(pageId) {
        const bulkMoveCategorySelect = document.getElementById('bulk-move-category-select');
        if (!bulkMoveCategorySelect) return;

        const targetPageId = Number(pageId) || 0;
        bulkMoveCategorySelect.innerHTML = '';
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = this.language.t('config.noCategory') || 'No category';
        bulkMoveCategorySelect.appendChild(emptyOpt);

        if (!targetPageId) {
            bulkMoveCategorySelect.disabled = true;
            return;
        }

        const currentPageId = Number(this.currentPageId) || 1;
        const cats = targetPageId === currentPageId
            ? (this.bookmarksPageCategories || [])
            : await fetch(`/api/categories?page=${targetPageId}`).then((r) => (r.ok ? r.json() : [])).catch(() => []);

        (Array.isArray(cats) ? cats : []).forEach((cat) => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.name;
            bulkMoveCategorySelect.appendChild(opt);
        });
        bulkMoveCategorySelect.disabled = false;
    }

    refreshBookmarksList(options = {}) {
        this.bookmarks.render(this.bookmarksData, this.bookmarksPageCategories, {
            filterCategory: this.currentBookmarksCategoryFilter,
            sortOrder: this.currentBookmarksSort || 'default',
            searchQuery: this.currentBookmarksSearch || '',
            skipFlush: options.skipFlush === true
        });
        this.validateBookmarkConflicts({ showToast: false });

        this.bookmarks.initReorder(this.bookmarksData, (newBookmarks, meta = {}) => {
            this.bookmarksData = newBookmarks;
            this.refreshBookmarksList({ ...meta, skipFlush: true });
            this.markDirty();
        }, {
            filterCategory: this.currentBookmarksCategoryFilter
        });

        if (typeof options.focusIndex === 'number') {
            const focusElement = document.querySelector(`[data-bookmark-index="${options.focusIndex}"] input`);
            if (focusElement) {
                focusElement.focus();
            }
        }

        if (typeof options.highlightIndex === 'number') {
            const highlightElement = document.querySelector(`[data-bookmark-index="${options.highlightIndex}"]`);
            if (highlightElement) {
                highlightElement.classList.add('reorder-highlight');
                setTimeout(() => {
                    highlightElement.classList.remove('reorder-highlight');
                }, 700);
            }
        }

        const activeIdx = this.bookmarks?.activeDetailIndex;
        if (typeof activeIdx === 'number' && this.bookmarksData[activeIdx]) {
            this.bookmarks.setDetailPanelMode?.('editing');
        }

        this.renderStructureWorkspace();
    }

    renderStructureWorkspace() {
        const pagesList = document.getElementById('structure-pages-list');
        const categoriesList = document.getElementById('structure-categories-list');
        const contextLabel = document.getElementById('structure-context-label');
        const archivedList = document.getElementById('structure-archived-pages-list');
        if (!pagesList || !categoriesList || !archivedList) {
            return;
        }

        pagesList.innerHTML = '';
        this.getVisiblePages().forEach((page) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `structure-list-item${Number(page.id) === Number(this.currentPageId) ? ' is-active' : ''}`;
            button.textContent = page.name;
            button.addEventListener('click', async () => {
                const targetPageId = Number(page.id);
                const flushed = await this.flushCategoriesPageBeforeSwitch();
                if (!flushed) {
                    this.syncCategoriesPageSelectorUI(this.currentCategoriesPageId);
                    return;
                }
                this.currentPageId = targetPageId;
                this.currentCategoriesPageId = targetPageId;
                this.saveLastCategoriesPageId(targetPageId);
                this.syncBookmarksPageSelectorUI(targetPageId);
                this.syncCategoriesPageSelectorUI(targetPageId);
                await this.loadPageBookmarks(targetPageId);
                await this.loadPageCategories(targetPageId);
                this.renderStructureWorkspace();
            });
            pagesList.appendChild(button);
        });
        archivedList.innerHTML = '';
        this.pagesData.filter((page) => this.isPageArchived(page.id)).forEach((page) => {
            const wrap = document.createElement('div');
            wrap.className = 'structure-list-item';
            wrap.textContent = page.name;
            const restoreButton = document.createElement('button');
            restoreButton.type = 'button';
            restoreButton.className = 'btn btn-secondary btn-small';
            restoreButton.textContent = this.language.t('config.restore') || 'Restore';
            restoreButton.style.float = 'right';
            restoreButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.restoreArchivedPage(page.id);
            });
            wrap.appendChild(restoreButton);
            archivedList.appendChild(wrap);
        });

        categoriesList.innerHTML = '';
        const categoryItems = Array.isArray(this.bookmarksPageCategories) ? this.bookmarksPageCategories : [];
        categoryItems.forEach((category) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `structure-list-item${this.currentBookmarksCategoryFilter === category.id ? ' is-active' : ''}`;
            button.textContent = category.name;
            button.addEventListener('click', () => {
                this.currentBookmarksCategoryFilter = category.id;
                this.saveLastCategoryFilterForPage(this.currentPageId, category.id);
                this.saveLastUsedCategoryIdForPage(this.currentPageId, category.id);
                const filterSelect = document.getElementById('bookmarks-category-filter');
                if (filterSelect) filterSelect.value = category.id;
                this.refreshBookmarksList();
            });
            categoriesList.appendChild(button);
        });

        if (contextLabel) {
            const activePage = this.getVisiblePages().find((page) => Number(page.id) === Number(this.currentPageId));
            const activeCategory = categoryItems.find((category) => category.id === this.currentBookmarksCategoryFilter);
            const categoryLabel = activeCategory
                ? activeCategory.name
                : (this.currentBookmarksCategoryFilter === '__all__'
                    ? (this.language.t('config.allCategories') || 'All categories')
                    : (this.language.t('config.noCategory') || 'No category'));
            const contextTpl = this.language.t('config.structureContextLabel') || 'Context: {page} / {category}';
            contextLabel.textContent = contextTpl
                .replace('{page}', activePage ? activePage.name : (this.language.t('config.page') || 'page'))
                .replace('{category}', categoryLabel);
        }
    }

    openConfigCommandPalette() {
        window.ConfigCommandPalette?.open?.(this);
    }

    async preparePaletteBookmarksContext() {
        this.ensureBookmarksTabActive();
        const pageId = Number(this.currentPageId) || 1;
        await this.loadPageBookmarks(pageId);
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    async preparePaletteCategoriesContext() {
        this.ensureCategoriesTabActive();
        const pageId = Number(this.currentCategoriesPageId) || Number(this.currentPageId) || 1;
        if (!this.categoriesListHydrated || !Array.isArray(this.categoriesData)) {
            await this.loadPageCategories(pageId);
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    async runPaletteAction(command) {
        if (command === 'search-settings') {
            window.ConfigSettingsSearch?.focusSearch?.();
            return;
        }
        if (command === 'add-page') {
            if (!this.ensurePagesTabActive()) return;
            await this.addPage();
            return;
        }
        if (command === 'add-category') {
            if (!this.ensureCategoriesTabActive()) return;
            await this.preparePaletteCategoriesContext();
            await this.addCategory();
            return;
        }
        if (command === 'add-bookmark') {
            await this.preparePaletteBookmarksContext();
            this.addBookmark();
            return;
        }
        if (command === 'refresh-favicon-selection') {
            await this.preparePaletteBookmarksContext();
            const refreshed = await this.bookmarks.bulkRefreshFavicons(this.bookmarksData);
            if (refreshed > 0) {
                const refreshedShort = this.language.t('config.refreshedBookmarksCountShort') || 'Refreshed {count}';
                this.ui.showNotification(refreshedShort.replace('{count}', String(refreshed)), 'success');
            } else {
                this.ui.showNotification(this.language.t('config.selectBookmarksFirst') || 'Select bookmarks first.', 'info');
            }
        }
    }

    _configT(key, fallback) {
        const value = this.language?.t(key);
        return value && value !== key ? value : fallback;
    }

    goToDashboard() {
        window.location.href = '/';
    }

    buildConfigSaveFeedback(duplicateUrls = [], scope = {}) {
        const hasDuplicates = Array.isArray(duplicateUrls) && duplicateUrls.length > 0;
        if (scope.settingsOnly && !hasDuplicates) {
            return null;
        }
        return {
            message: hasDuplicates
                ? this._configT(
                    'config.configSavedReturnDashboardDuplicates',
                    'Settings saved. Duplicate bookmark URLs detected — return to the dashboard to review.'
                )
                : this._configT(
                    'config.configSavedReturnDashboard',
                    'Settings saved — return to the dashboard to see changes.'
                ),
            type: hasDuplicates ? 'warning' : 'success',
            options: {
                actionLabel: this._configT('config.goToDashboard', 'Open dashboard'),
                durationMs: 10000,
                onAction: () => this.goToDashboard(),
            },
        };
    }

    warnDuplicateUrl(url) {
        const normalized = (url || '').trim().toLowerCase();
        if (!normalized) return;

        const duplicate = this.bookmarksData.some((bookmark, index) => {
            if (index === this.bookmarksData.length - 1) return false;
            return (bookmark.url || '').trim().toLowerCase() === normalized;
        });

        if (duplicate) {
            this.ui.showNotification('Duplicate URL detected for the new bookmark.', 'warning');
        }
    }

    findDuplicateBookmarkUrls(bookmarks) {
        const seen = new Set();
        const duplicates = new Set();

        bookmarks.forEach((bookmark) => {
            const url = (bookmark.url || '').trim().toLowerCase();
            if (!url) {
                return;
            }

            if (seen.has(url)) {
                duplicates.add(url);
            } else {
                seen.add(url);
            }
        });

        return Array.from(duplicates);
    }

    getDuplicateFinderShortcutSet() {
        const finderShortcuts = (Array.isArray(this.findersData) ? this.findersData : [])
            .map((finder) => String(finder?.shortcut || '').trim().toUpperCase())
            .filter(Boolean);
        const counts = new Map();
        finderShortcuts.forEach((shortcut) => {
            counts.set(shortcut, (counts.get(shortcut) || 0) + 1);
        });
        return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([shortcut]) => shortcut));
    }

    validateBookmarkConflicts(options = {}) {
        const urlMap = new Map();
        const shortcutMap = new Map();
        const normalizedUrlByIndex = new Map();
        const normalizedShortcutByIndex = new Map();

        this.bookmarksData.forEach((bookmark, index) => {
            const normalizedUrl = (bookmark?.url || '').trim().toLowerCase();
            const normalizedShortcut = (bookmark?.shortcut || '').trim().toUpperCase();
            normalizedUrlByIndex.set(index, normalizedUrl);
            normalizedShortcutByIndex.set(index, normalizedShortcut);

            if (normalizedUrl) {
                const list = urlMap.get(normalizedUrl) || [];
                list.push(index);
                urlMap.set(normalizedUrl, list);
            }
            if (normalizedShortcut) {
                const list = shortcutMap.get(normalizedShortcut) || [];
                list.push(index);
                shortcutMap.set(normalizedShortcut, list);
            }
        });

        const duplicateUrlIndexes = new Set();
        const duplicateShortcutIndexes = new Set();
        const finderConflictIndexes = new Set();
        urlMap.forEach((indexes) => {
            if (indexes.length > 1) {
                indexes.forEach((idx) => duplicateUrlIndexes.add(idx));
            }
        });
        shortcutMap.forEach((indexes) => {
            if (indexes.length > 1) {
                indexes.forEach((idx) => duplicateShortcutIndexes.add(idx));
            }
        });

        // Finder shortcut conflicts are warnings (non-blocking).
        const finderShortcutSet = new Set(
            (Array.isArray(this.findersData) ? this.findersData : [])
                .map((finder) => String(finder?.shortcut || '').trim().toUpperCase())
                .filter(Boolean)
        );
        normalizedShortcutByIndex.forEach((shortcut, index) => {
            if (shortcut && finderShortcutSet.has(shortcut)) {
                finderConflictIndexes.add(index);
            }
        });

        this.bookmarksData.forEach((_, index) => {
            const urlInput = document.getElementById(`bookmark-url-${index}`);
            const shortcutInput = document.getElementById(`bookmark-shortcut-${index}`);
            if (urlInput) {
                urlInput.classList.toggle('field-conflict', duplicateUrlIndexes.has(index));
            }
            if (shortcutInput) {
                const hasBlockingShortcutConflict = duplicateShortcutIndexes.has(index);
                shortcutInput.classList.toggle('field-conflict', hasBlockingShortcutConflict);
                const hasFinderWarning = finderConflictIndexes.has(index);
                shortcutInput.classList.toggle('field-warning', hasFinderWarning && !hasBlockingShortcutConflict);
                if (hasBlockingShortcutConflict) {
                    shortcutInput.title = this.language?.t('config.shortcutUniqueHint')
                        || 'Shortcut must be unique within this page.';
                } else if (hasFinderWarning) {
                    shortcutInput.title = this.language?.t('config.shortcutFinderHint')
                        || 'Shortcut matches a finder shortcut.';
                } else {
                    shortcutInput.removeAttribute('title');
                }
            }
        });

        // Also update the split-view detail panel when it's showing a conflicting bookmark.
        const activeIdx = this.bookmarks?.activeDetailIndex ?? -1;
        if (activeIdx >= 0) {
            const detailUrl = document.getElementById('detail-url');
            const detailUrlMsg = document.getElementById('detail-url-conflict-msg');
            const detailShortcut = document.getElementById('detail-shortcut');
            const detailShortcutMsg = document.getElementById('detail-shortcut-conflict-msg');
            if (detailUrl) {
                const urlVal = detailUrl.value.trim().toLowerCase();
                const isDupUrl = Boolean(urlVal) && duplicateUrlIndexes.has(activeIdx);
                detailUrl.classList.toggle('field-conflict', isDupUrl);
                if (detailUrlMsg) detailUrlMsg.hidden = !isDupUrl;
            }
            if (detailShortcut) {
                const scVal = detailShortcut.value.trim().toUpperCase();
                const hasBlockingShortcutConflict = Boolean(scVal) && duplicateShortcutIndexes.has(activeIdx);
                const hasFinderWarning = Boolean(scVal) && finderConflictIndexes.has(activeIdx);
                detailShortcut.classList.toggle('field-conflict', hasBlockingShortcutConflict);
                detailShortcut.classList.toggle('field-warning', hasFinderWarning && !hasBlockingShortcutConflict);
                if (detailShortcutMsg) detailShortcutMsg.hidden = !hasBlockingShortcutConflict;
                if (hasBlockingShortcutConflict) {
                    detailShortcut.title = this.language?.t('config.shortcutUniqueHint')
                        || 'Shortcut must be unique within this page.';
                } else if (hasFinderWarning) {
                    detailShortcut.title = this.language?.t('config.shortcutFinderHint')
                        || 'Shortcut matches a finder shortcut.';
                } else {
                    detailShortcut.removeAttribute('title');
                }
            }
        }

        const hasConflicts = duplicateUrlIndexes.size > 0 || duplicateShortcutIndexes.size > 0;
        if (hasConflicts && options.showToast) {
            this.ui.showNotification(
                `Fix conflicts first: ${duplicateUrlIndexes.size} duplicate URL(s), ${duplicateShortcutIndexes.size} duplicate shortcut(s) on this page.`,
                'warning'
            );
        }
        if (!hasConflicts && finderConflictIndexes.size > 0 && options.showToast) {
            const duplicateFinderShortcuts = this.getDuplicateFinderShortcutSet();
            const severity = duplicateFinderShortcuts.size > 0 ? 'warning' : 'info';
            this.ui.showNotification(
                `Shortcut warning: ${finderConflictIndexes.size} bookmark shortcut(s) overlap with finder shortcuts.`,
                severity
            );
        }

        const saveButtons = this.getSaveButtons();
        saveButtons.forEach((saveBtn) => {
            saveBtn.disabled = hasConflicts;
        });

        return {
            hasConflicts,
            duplicateUrlCount: duplicateUrlIndexes.size,
            duplicateShortcutCount: duplicateShortcutIndexes.size,
            finderShortcutConflictCount: finderConflictIndexes.size
        };
    }

    async resetToDefaults() {
        const tx = (key, fallback) => {
            const value = this.language.t(key);
            return value === key ? fallback : value;
        };
        const resetDefaultPage = [{ id: 1, name: 'main' }];
        const resetDefaultCategories = [
            { id: 'development', name: 'Development' },
            { id: 'media', name: 'Media' },
            { id: 'social', name: 'Social' },
            { id: 'search', name: 'Search' },
            { id: 'utilities', name: 'Utilities' }
        ];
        const resetDefaultBookmarks = [
            { name: 'GitHub', url: 'https://github.com', shortcut: 'G', category: 'development', checkStatus: true, tags: ['dev', 'code'] },
            { name: 'GitHub Issues', url: 'https://github.com/issues', shortcut: 'GI', category: 'development', tags: ['dev', 'github'] },
            { name: 'GitHub Pull Requests', url: 'https://github.com/pulls', shortcut: 'GP', category: 'development', tags: ['dev', 'github'] },
            { name: 'YouTube', url: 'https://youtube.com', shortcut: 'Y', category: 'media', tags: ['video', 'entertainment'] },
            { name: 'YouTube Studio', url: 'https://studio.youtube.com', shortcut: 'YS', category: 'media', tags: ['video', 'creator'] },
            { name: 'Facebook', url: 'https://facebook.com', shortcut: 'F', category: 'social', tags: ['social'] },
            { name: 'Instagram', url: 'https://instagram.com', shortcut: 'INS', category: 'social', tags: ['social', 'photos'] },
            { name: 'Google', url: 'https://google.com', shortcut: '', category: 'search', tags: ['search'] }
        ];
        const confirmed = await window.AppModal.danger({
            title: tx('config.resetAllDataTitle', 'Reset all data'),
            message: tx('config.resetAllDataMessage', 'This permanently deletes all pages, categories, bookmarks, finders, settings, custom themes, uploaded favicon/font, bookmark icons, and caches. You start over with default sample bookmarks and built-in settings. This cannot be undone.'),
            confirmText: tx('config.resetAllDataButton', 'Reset all data and start over'),
            cancelText: tx('config.cancel', 'Cancel')
        });
        
        if (!confirmed) return;
        const confirmToken = 'RESET';
        const typedToken = await new Promise((resolve) => {
            const typePromptText = tx('config.resetAllDataTypePrompt', `Type ${confirmToken} to confirm permanent reset:`);
            const inputLabel = tx('config.resetAllDataTypeLabel', 'Confirmation text');
            const confirmLabel = tx('config.resetAllDataTypeConfirm', 'Confirm reset');
            const cancelLabel = tx('config.cancel', 'Cancel');
            window.AppModal.show({
                title: tx('config.resetAllDataTypeTitle', 'Final confirmation'),
                htmlMessage: `
                    <p>${typePromptText}</p>
                    <input id="reset-confirm-input" class="modal-select" type="text" autocomplete="off" spellcheck="false" aria-label="${inputLabel}" />
                `,
                confirmText: confirmLabel,
                cancelText: cancelLabel,
                confirmClass: 'danger',
                onConfirm: () => {
                    const input = document.getElementById('reset-confirm-input');
                    resolve(input ? input.value : '');
                },
                onCancel: () => resolve(null)
            });
            setTimeout(() => {
                const input = document.getElementById('reset-confirm-input');
                if (input) {
                    input.focus();
                    input.select();
                }
            }, 80);
        });
        if (typedToken === null) {
            return;
        }
        if (String(typedToken).trim().toUpperCase() !== confirmToken) {
            this.ui.showNotification(
                tx('config.resetAllDataTypeMismatch', 'Reset cancelled: confirmation text did not match.'),
                'warning'
            );
            return;
        }

        const resetBtn = document.getElementById('reset-btn');
        const originalLabel = resetBtn?.textContent;
        if (resetBtn) {
            resetBtn.disabled = true;
            resetBtn.textContent = tx('config.resetAllDataResetting', 'Resetting…');
        }

        try {
            const response = await fetch('/api/reset', {
                method: 'POST',
                headers: nextDashWriteHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ confirm: true }),
            });
            if (!response.ok) throw new Error('Reset failed');
        } catch (error) {
            console.error('Error resetting all data:', error);
            this.ui.showNotification(tx('config.errorSavingConfig', 'Error saving configuration'), 'error');
            if (resetBtn) {
                resetBtn.disabled = false;
                resetBtn.textContent = originalLabel;
            }
            return;
        }

        try {
            sessionStorage.removeItem('nextDashSearchFlowHintDismissedV2');
            localStorage.removeItem('nextDashSearchFlowHintDismissedV1');
        } catch { /* ignore */ }
        try {
            this.storage.clearDeviceSettings();
        } catch (error) {
            console.warn('Could not clear device settings during reset:', error);
        }

        this.isNavigatingAway = true;
        setTimeout(() => { window.location.href = '/'; }, 1000);
    }

    generateId(text) {
        return text.toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

}

let configManager;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { configManager = new ConfigManager(); window.configManager = configManager; });
} else {
    configManager = new ConfigManager();
    window.configManager = configManager;
}
