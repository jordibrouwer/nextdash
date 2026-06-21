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
        this.setupModule = new ConfigSetup(this);
        this.setupModule.installPublicMethods();
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
