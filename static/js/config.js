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
        this.backup = new ConfigBackup(this.language.t.bind(this.language));
        this.settings = new ConfigSettings(this.language);
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
            showTips: false,
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
            showIcons: false,
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
        window.MobileExperience?.initConfig?.();
        await this.loadData();
        // Align categories page with bookmarks page before first render
        this.currentCategoriesPageId = parseInt(this.currentPageId) || 1;
        await this.language.init(this.settingsData.language);
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
            this.generalLayers.applyHash(window.location.hash);
            this.settings?.refreshStatusEssentialsSummary?.(this.settingsData, this.allBookmarksData);
            this.settings?.updateStatusOptionsVisibility?.(this.settingsData.showStatus);
        }
        if (typeof window.installSettingInfoButtons === 'function' && this.settings) {
            window.installSettingInfoButtons(this.settings);
        }
        this.setupGeneralCardCollapsible();
        
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
                if (typeof window.installSettingInfoButtons === 'function' && this.settings) {
                    window.installSettingInfoButtons(this.settings);
                }
                this.refreshPageDropdowns();
            }, 0);
        }


        if (this.stats && window.location.hash === '#stats') {
            this.stats.refresh(this);
        }
        if (window.location.hash.startsWith('#colors')) {
            await this.ensureColorsEditor();
        }

        const categoriesSelector = document.getElementById('categories-page-selector');
        if (categoriesSelector) {
            this.loadPageCategories(this.currentCategoriesPageId);
        }
        this.savedSnapshot = this.captureUndoSnapshot();
        this.refreshSmartCollectionCounters();
        this.settings?.refreshStatusEssentialsSummary?.(this.settingsData, this.allBookmarksData);
        this.validateBookmarkConflicts({ showToast: false });

        if (window.SkeletonLoading && typeof window.SkeletonLoading.finish === 'function') {
            window.SkeletonLoading.finish();
        } else {
            document.body.classList.remove('loading');
        }

        this.scheduleConfigBookmarksTour();
        this.scheduleConfigFindersTour();
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
    }

    _isConfigTabTourBusy(exclude) {
        const entries = [
            ['bookmarks', this._configBookmarksTourActive, this._configBookmarksTourStarting],
            ['finders', this._configFindersTourActive, this._configFindersTourStarting],
            ['stats', this._configStatsTourActive, this._configStatsTourStarting],
            ['categories', this._configCategoriesTourActive, this._configCategoriesTourStarting],
            ['tags', this._configTagsTourActive, this._configTagsTourStarting],
            ['pages', this._configPagesTourActive, this._configPagesTourStarting],
            ['collections', this._configCollectionsTourActive, this._configCollectionsTourStarting],
            ['theme', this._configThemeTourActive, this._configThemeTourStarting],
        ];
        for (const [name, active, starting] of entries) {
            if (exclude && name === exclude) continue;
            if (active || starting) return true;
        }
        return false;
    }

    /** Close other config tab tours (without marking complete) so the active tab tour can run. */
    dismissOtherConfigTabTours(except) {
        const tours = [
            ['bookmarks', window.ConfigBookmarksTour, '_configBookmarksTourActive', '_configBookmarksTourStarting', 'cancelConfigBookmarksTourSchedule'],
            ['finders', window.ConfigFindersTour, '_configFindersTourActive', '_configFindersTourStarting', 'cancelConfigFindersTourSchedule'],
            ['stats', window.ConfigStatsTour, '_configStatsTourActive', '_configStatsTourStarting', 'cancelConfigStatsTourSchedule'],
            ['categories', window.ConfigCategoriesTour, '_configCategoriesTourActive', '_configCategoriesTourStarting', 'cancelConfigCategoriesTourSchedule'],
            ['tags', window.ConfigTagsTour, '_configTagsTourActive', '_configTagsTourStarting', 'cancelConfigTagsTourSchedule'],
            ['pages', window.ConfigPagesTour, '_configPagesTourActive', '_configPagesTourStarting', 'cancelConfigPagesTourSchedule'],
            ['collections', window.ConfigCollectionsTour, '_configCollectionsTourActive', '_configCollectionsTourStarting', 'cancelConfigCollectionsTourSchedule'],
            ['theme', window.ConfigThemeTour, '_configThemeTourActive', '_configThemeTourStarting', 'cancelConfigThemeTourSchedule'],
        ];
        for (const [name, TourClass, activeKey, startingKey, cancelMethod] of tours) {
            if (except && name === except) continue;
            TourClass?.teardownStaleDom?.();
            this[activeKey] = false;
            this[startingKey] = false;
            if (typeof this[cancelMethod] === 'function') {
                this[cancelMethod]();
            }
        }
    }

    onConfigCategoriesTabOpened() {
        if (this.hasSeenConfigCategoriesTour()) return Promise.resolve();
        this.dismissOtherConfigTabTours('categories');
        const schedule = () => this.scheduleConfigCategoriesTour();
        const pageId = this.currentCategoriesPageId || this.currentPageId || 1;
        if (typeof this.loadPageCategories === 'function') {
            return this.loadPageCategories(pageId).finally(schedule);
        }
        schedule();
        return Promise.resolve();
    }

    async reloadTagsTabData() {
        try {
            await this.bookmarkStore.loadAll();
        } catch (error) {
            console.warn('Could not reload bookmarks for tags view', error);
        }
        try {
            this.tags?.refresh(this);
        } catch (error) {
            console.warn('Could not refresh tags tab', error);
        }
    }

    async onConfigTagsTabOpened() {
        await this.reloadTagsTabData();
        if (this.hasSeenConfigTagsTour()) return;
        if (this._configTagsTourActive || this._configTagsTourStarting) {
            return;
        }
        this.dismissOtherConfigTabTours('tags');
        this.scheduleConfigTagsTour();
    }

    onConfigPagesTabOpened() {
        if (this.hasSeenConfigPagesTour()) return Promise.resolve();
        if (this._configPagesTourActive || this._configPagesTourStarting) {
            this.renderPagesTab();
            return Promise.resolve();
        }
        this.dismissOtherConfigTabTours('pages');
        const schedule = () => this.scheduleConfigPagesTour();
        this.renderPagesTab();
        schedule();
        return Promise.resolve();
    }

    onConfigCollectionsTabOpened() {
        if (this.hasSeenConfigCollectionsTour()) return Promise.resolve();
        if (this._configCollectionsTourActive || this._configCollectionsTourStarting) {
            return Promise.resolve();
        }
        this.dismissOtherConfigTabTours('collections');
        const schedule = () => this.scheduleConfigCollectionsTour();
        if (this.collections?.refresh) {
            try {
                this.collections.refresh(this);
            } catch {
                // ignore
            }
        }
        schedule();
        return Promise.resolve();
    }

    hasSeenConfigBookmarksTour() {
        if (this.settingsData?.configBookmarksTourCompleted === true) return true;
        try {
            return localStorage.getItem(window.ConfigBookmarksTour?.STORAGE_KEY || 'nextdash:config-bookmarks-tour-v1') === '1';
        } catch {
            return false;
        }
    }

    syncConfigBookmarksTourSeenFromServer() {
        const key = window.ConfigBookmarksTour?.STORAGE_KEY || 'nextdash:config-bookmarks-tour-v1';
        try {
            if (this.settingsData?.configBookmarksTourCompleted === true) {
                localStorage.setItem(key, '1');
            } else {
                localStorage.removeItem(key);
            }
        } catch {
            // ignore
        }
    }

    async markConfigBookmarksTourCompleted() {
        this.settingsData.configBookmarksTourCompleted = true;
        try {
            localStorage.setItem(
                window.ConfigBookmarksTour?.STORAGE_KEY || 'nextdash:config-bookmarks-tour-v1',
                '1'
            );
        } catch {
            // ignore
        }
        if (this.settings?.saveSettingsToServer) {
            await this.settings.saveSettingsToServer(this.settingsData);
        }
    }

    cancelConfigBookmarksTourSchedule() {
        this._configBookmarksTourScheduleId = (this._configBookmarksTourScheduleId || 0) + 1;
        if (this._configBookmarksTourScheduleTimer) {
            clearTimeout(this._configBookmarksTourScheduleTimer);
            this._configBookmarksTourScheduleTimer = null;
        }
    }

    scheduleConfigBookmarksTour() {
        if (typeof window.ConfigBookmarksTour !== 'function') return;
        if (this.hasSeenConfigBookmarksTour()) return;
        if (this._configBookmarksTourActive || this._configBookmarksTourStarting) return;
        if (this._isConfigTabTourBusy('bookmarks')) return;
        if (document.body?.classList.contains('loading')) return;

        this.cancelConfigBookmarksTourSchedule();
        const runId = this._configBookmarksTourScheduleId;
        this._configBookmarksTourScheduleTimer = setTimeout(() => {
            this._configBookmarksTourScheduleTimer = null;
            if (runId !== this._configBookmarksTourScheduleId) return;
            if (
                this.hasSeenConfigBookmarksTour() ||
                this._configBookmarksTourActive ||
                this._configBookmarksTourStarting ||
                this._isConfigTabTourBusy('bookmarks')
            ) {
                return;
            }
            if (!this.isConfigBookmarksTabActive()) return;
            void this.maybeStartConfigBookmarksTour();
        }, 550);
    }

    isConfigBookmarksTabActive() {
        if (this.ui?._currentTab === 'bookmarks') return true;
        const activeTab = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
        if (activeTab === 'bookmarks') return true;
        const hash = (window.location.hash || '').replace(/^#/, '');
        return hash === 'bookmarks' || hash.startsWith('bookmarks/');
    }

    configBookmarksTourFailureMessage(reason) {
        const keyByReason = {
            'missing-script': 'config.resetConfigBookmarksTourFailedReload',
            'no-bookmarks-tab': 'config.resetConfigBookmarksTourFailedTab',
            'dom-not-ready': 'config.resetConfigBookmarksTourFailedDom',
            'render-failed': 'config.resetConfigBookmarksTourFailedDom',
            'step-error': 'config.resetConfigBookmarksTourFailedDom',
            blocked: 'config.resetConfigBookmarksTourFailedDom',
            mobile: 'config.resetConfigBookmarksTourFailedMobile',
            error: 'config.resetConfigBookmarksTourFailedDom',
        };
        const fallbacks = {
            'missing-script': 'Could not start the Bookmarks tour. Refresh the page and try again.',
            'no-bookmarks-tab': 'Could not start the Bookmarks tour. Open the Bookmarks tab first.',
            'dom-not-ready': 'Could not start the Bookmarks tour. The editor is still loading — refresh and try again.',
            mobile: 'Could not start the Bookmarks tour. Use a wider window or disable mobile device emulation in your browser.',
            error: 'Could not start the Bookmarks tour. Refresh the page and try again.',
        };
        const key = keyByReason[reason] || 'config.resetConfigBookmarksTourFailed';
        try {
            if (this.language && typeof this.language.t === 'function') {
                const msg = this.language.t(key);
                if (msg && msg !== key) return msg;
            }
        } catch {
            // ignore
        }
        return fallbacks[reason] || 'Could not start the Bookmarks tour. Open the Bookmarks tab first.';
    }

    async maybeStartConfigBookmarksTour({ force = false } = {}) {
        if (this._configBookmarksTourStarting) {
            return { ok: false, reason: 'starting' };
        }
        const blockReason = window.ConfigBookmarksTour?.getBlockReason?.({
            force,
            hasSeen: () => this.hasSeenConfigBookmarksTour(),
        });
        if (blockReason) {
            if (force) console.warn('Config Bookmarks tour blocked:', blockReason);
            return { ok: false, reason: blockReason };
        }
        if (this._configBookmarksTourActive && !force) return { ok: false, reason: 'active' };
        if (this._isConfigTabTourBusy('bookmarks')) {
            return { ok: false, reason: 'active-other' };
        }
        if (!force && this.hasSeenConfigBookmarksTour()) return { ok: false, reason: 'completed' };

        if (force) {
            this.cancelConfigBookmarksTourSchedule();
            window.ConfigBookmarksTour.teardownStaleDom?.();
            this._configBookmarksTourActive = false;
            if (document.body?.classList.contains('loading')) {
                window.SkeletonLoading?.finish?.();
            }
            this.ensureBookmarksTabActive();
        } else if (!this.isConfigBookmarksTabActive()) {
            return { ok: false, reason: 'wrong-tab' };
        }

        const resumeCleanup = window.ConfigBookmarksTour?.consumeResume?.() === 'cleanup';

        const tour = new window.ConfigBookmarksTour({
            language: this.language,
            hasSeen: () => this.hasSeenConfigBookmarksTour(),
            onMarkSeen: () => this.markConfigBookmarksTourCompleted(),
        });
        if (!tour.canStart({ force: force || resumeCleanup })) {
            return { ok: false, reason: force ? 'no-bookmarks-tab' : 'mobile' };
        }

        this._configBookmarksTourStarting = true;
        this._configBookmarksTourActive = true;
        try {
            const started = await tour.prepareAndStart({ force, resumeCleanup });
            if (!started) {
                this._configBookmarksTourActive = false;
                window.ConfigBookmarksTour.teardownStaleDom?.();
                return { ok: false, reason: tour.lastFailureReason || 'prepare-failed' };
            }
            this.cancelConfigBookmarksTourSchedule();
            return { ok: true };
        } catch (error) {
            console.error('Config Bookmarks tour failed to start', error);
            this._configBookmarksTourActive = false;
            window.ConfigBookmarksTour.teardownStaleDom?.();
            return { ok: false, reason: 'error' };
        } finally {
            this._configBookmarksTourStarting = false;
        }
    }

    ensureBookmarksTabActive() {
        if (this.ui?.switchToTab) {
            this.ui.switchToTab('bookmarks');
        } else {
            const panel = document.querySelector('[data-tab-content="bookmarks"]');
            if (panel && !panel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="bookmarks"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'bookmarks' && !hash.startsWith('bookmarks/')) {
            window.history.replaceState(null, '', '#bookmarks');
        }
    }

    hasSeenConfigFindersTour() {
        if (this.settingsData?.configFindersTourCompleted === true) return true;
        try {
            return localStorage.getItem(window.ConfigFindersTour?.STORAGE_KEY || 'nextdash:config-finders-tour-v1') === '1';
        } catch {
            return false;
        }
    }

    syncConfigFindersTourSeenFromServer() {
        const key = window.ConfigFindersTour?.STORAGE_KEY || 'nextdash:config-finders-tour-v1';
        try {
            if (this.settingsData?.configFindersTourCompleted === true) {
                localStorage.setItem(key, '1');
            } else {
                localStorage.removeItem(key);
            }
        } catch {
            // ignore
        }
    }

    async markConfigFindersTourCompleted() {
        this.settingsData.configFindersTourCompleted = true;
        try {
            localStorage.setItem(
                window.ConfigFindersTour?.STORAGE_KEY || 'nextdash:config-finders-tour-v1',
                '1'
            );
        } catch {
            // ignore
        }
        if (this.settings?.saveSettingsToServer) {
            await this.settings.saveSettingsToServer(this.settingsData);
        }
    }

    cancelConfigFindersTourSchedule() {
        this._configFindersTourScheduleId = (this._configFindersTourScheduleId || 0) + 1;
        if (this._configFindersTourScheduleTimer) {
            clearTimeout(this._configFindersTourScheduleTimer);
            this._configFindersTourScheduleTimer = null;
        }
    }

    scheduleConfigFindersTour() {
        if (typeof window.ConfigFindersTour !== 'function') return;
        if (this.hasSeenConfigFindersTour()) return;
        if (this._configFindersTourActive || this._configFindersTourStarting) return;
        if (this._isConfigTabTourBusy('finders')) return;
        if (document.body?.classList.contains('loading')) return;

        this.cancelConfigFindersTourSchedule();
        const runId = this._configFindersTourScheduleId;
        this._configFindersTourScheduleTimer = setTimeout(() => {
            this._configFindersTourScheduleTimer = null;
            if (runId !== this._configFindersTourScheduleId) return;
            if (
                this.hasSeenConfigFindersTour() ||
                this._configFindersTourActive ||
                this._configFindersTourStarting ||
                this._isConfigTabTourBusy('finders')
            ) {
                return;
            }
            if (!this.isConfigFindersTabActive()) return;
            void this.maybeStartConfigFindersTour();
        }, 550);
    }

    isConfigFindersTabActive() {
        if (this.ui?._currentTab === 'finders') return true;
        const activeTab = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
        if (activeTab === 'finders') return true;
        const hash = (window.location.hash || '').replace(/^#/, '');
        return hash === 'finders';
    }

    configFindersTourFailureMessage(reason) {
        const keyByReason = {
            'missing-script': 'config.resetConfigFindersTourFailedReload',
            'no-finders-tab': 'config.resetConfigFindersTourFailedTab',
            'dom-not-ready': 'config.resetConfigFindersTourFailedDom',
            'render-failed': 'config.resetConfigFindersTourFailedDom',
            'step-error': 'config.resetConfigFindersTourFailedDom',
            blocked: 'config.resetConfigFindersTourFailedDom',
            mobile: 'config.resetConfigFindersTourFailedMobile',
            error: 'config.resetConfigFindersTourFailedDom',
        };
        const fallbacks = {
            'missing-script': 'Could not start the Finders tour. Refresh the page and try again.',
            'no-finders-tab': 'Could not start the Finders tour. Open the Finders tab first.',
            'dom-not-ready': 'Could not start the Finders tour. Finders are still loading — refresh and try again.',
            mobile: 'Could not start the Finders tour. Use a wider window or disable mobile device emulation in your browser.',
            error: 'Could not start the Finders tour. Refresh the page and try again.',
        };
        const key = keyByReason[reason] || 'config.resetConfigFindersTourFailed';
        try {
            if (this.language && typeof this.language.t === 'function') {
                const msg = this.language.t(key);
                if (msg && msg !== key) return msg;
            }
        } catch {
            // ignore
        }
        return fallbacks[reason] || 'Could not start the Finders tour. Open the Finders tab first.';
    }

    async maybeStartConfigFindersTour({ force = false } = {}) {
        if (this._configFindersTourStarting) {
            return { ok: false, reason: 'starting' };
        }
        const blockReason = window.ConfigFindersTour?.getBlockReason?.({
            force,
            hasSeen: () => this.hasSeenConfigFindersTour(),
        });
        if (blockReason) {
            if (force) console.warn('Config Finders tour blocked:', blockReason);
            return { ok: false, reason: blockReason };
        }
        if (this._configFindersTourActive && !force) return { ok: false, reason: 'active' };
        if (this._isConfigTabTourBusy('finders')) {
            return { ok: false, reason: 'active-other' };
        }
        if (!force && this.hasSeenConfigFindersTour()) return { ok: false, reason: 'completed' };

        if (force) {
            this.cancelConfigFindersTourSchedule();
            window.ConfigFindersTour.teardownStaleDom?.();
            this._configFindersTourActive = false;
            if (document.body?.classList.contains('loading')) {
                window.SkeletonLoading?.finish?.();
            }
            this.ensureFindersTabActive();
        } else if (!this.isConfigFindersTabActive()) {
            return { ok: false, reason: 'wrong-tab' };
        }

        const tour = new window.ConfigFindersTour({
            language: this.language,
            hasSeen: () => this.hasSeenConfigFindersTour(),
            onMarkSeen: () => this.markConfigFindersTourCompleted(),
        });
        if (!tour.canStart({ force })) {
            return { ok: false, reason: force ? 'no-finders-tab' : 'mobile' };
        }

        this._configFindersTourStarting = true;
        this._configFindersTourActive = true;
        try {
            const started = await tour.prepareAndStart({ force });
            if (!started) {
                this._configFindersTourActive = false;
                window.ConfigFindersTour.teardownStaleDom?.();
                return { ok: false, reason: tour.lastFailureReason || 'prepare-failed' };
            }
            this.cancelConfigFindersTourSchedule();
            return { ok: true };
        } catch (error) {
            console.error('Config Finders tour failed to start', error);
            this._configFindersTourActive = false;
            window.ConfigFindersTour.teardownStaleDom?.();
            return { ok: false, reason: 'error' };
        } finally {
            this._configFindersTourStarting = false;
        }
    }

    ensureFindersTabActive() {
        if (this.ui?.switchToTab) {
            this.ui.switchToTab('finders');
        } else {
            const panel = document.querySelector('[data-tab-content="finders"]');
            if (panel && !panel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="finders"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'finders') {
            window.history.replaceState(null, '', '#finders');
        }
    }

    hasSeenConfigStatsTour() {
        if (this.settingsData?.configStatsTourCompleted === true) return true;
        try {
            return localStorage.getItem(window.ConfigStatsTour?.STORAGE_KEY || 'nextdash:config-stats-tour-v1') === '1';
        } catch {
            return false;
        }
    }

    syncConfigStatsTourSeenFromServer() {
        const key = window.ConfigStatsTour?.STORAGE_KEY || 'nextdash:config-stats-tour-v1';
        try {
            if (this.settingsData?.configStatsTourCompleted === true) {
                localStorage.setItem(key, '1');
            } else {
                localStorage.removeItem(key);
            }
        } catch {
            // ignore
        }
    }

    async markConfigStatsTourCompleted() {
        this.settingsData.configStatsTourCompleted = true;
        try {
            localStorage.setItem(
                window.ConfigStatsTour?.STORAGE_KEY || 'nextdash:config-stats-tour-v1',
                '1'
            );
        } catch {
            // ignore
        }
        if (this.settings?.saveSettingsToServer) {
            await this.settings.saveSettingsToServer(this.settingsData);
        }
    }

    cancelConfigStatsTourSchedule() {
        this._configStatsTourScheduleId = (this._configStatsTourScheduleId || 0) + 1;
        if (this._configStatsTourScheduleTimer) {
            clearTimeout(this._configStatsTourScheduleTimer);
            this._configStatsTourScheduleTimer = null;
        }
    }

    scheduleConfigStatsTour() {
        if (typeof window.ConfigStatsTour !== 'function') return;
        if (this.hasSeenConfigStatsTour()) return;
        if (this._configStatsTourActive || this._configStatsTourStarting) return;
        if (this._isConfigTabTourBusy('stats')) return;
        if (document.body?.classList.contains('loading')) return;

        this.cancelConfigStatsTourSchedule();
        const runId = this._configStatsTourScheduleId;
        this._configStatsTourScheduleTimer = setTimeout(() => {
            this._configStatsTourScheduleTimer = null;
            if (runId !== this._configStatsTourScheduleId) return;
            if (
                this.hasSeenConfigStatsTour() ||
                this._configStatsTourActive ||
                this._configStatsTourStarting ||
                this._isConfigTabTourBusy('stats')
            ) {
                return;
            }
            if (!this.isConfigStatsTabActive()) return;
            void this.maybeStartConfigStatsTour();
        }, 550);
    }

    isConfigStatsTabActive() {
        if (this.ui?._currentTab === 'stats') return true;
        const activeTab = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
        if (activeTab === 'stats') return true;
        const hash = (window.location.hash || '').replace(/^#/, '');
        return hash === 'stats';
    }

    configStatsTourFailureMessage(reason) {
        const keyByReason = {
            'missing-script': 'config.resetConfigStatsTourFailedReload',
            'no-stats-tab': 'config.resetConfigStatsTourFailedTab',
            'dom-not-ready': 'config.resetConfigStatsTourFailedDom',
            'render-failed': 'config.resetConfigStatsTourFailedDom',
            'step-error': 'config.resetConfigStatsTourFailedDom',
            blocked: 'config.resetConfigStatsTourFailedDom',
            mobile: 'config.resetConfigStatsTourFailedMobile',
            error: 'config.resetConfigStatsTourFailedDom',
        };
        const fallbacks = {
            'missing-script': 'Could not start the Stats tour. Refresh the page and try again.',
            'no-stats-tab': 'Could not start the Stats tour. Open the Stats tab first.',
            'dom-not-ready': 'Could not start the Stats tour. Stats are still loading — refresh and try again.',
            mobile: 'Could not start the Stats tour. Use a wider window or disable mobile device emulation in your browser.',
            error: 'Could not start the Stats tour. Refresh the page and try again.',
        };
        const key = keyByReason[reason] || 'config.resetConfigStatsTourFailed';
        try {
            if (this.language && typeof this.language.t === 'function') {
                const msg = this.language.t(key);
                if (msg && msg !== key) return msg;
            }
        } catch {
            // ignore
        }
        return fallbacks[reason] || 'Could not start the Stats tour. Open the Stats tab first.';
    }

    async maybeStartConfigStatsTour({ force = false } = {}) {
        if (this._configStatsTourStarting) {
            return { ok: false, reason: 'starting' };
        }
        const blockReason = window.ConfigStatsTour?.getBlockReason?.({
            force,
            hasSeen: () => this.hasSeenConfigStatsTour(),
        });
        if (blockReason) {
            if (force) console.warn('Config Stats tour blocked:', blockReason);
            return { ok: false, reason: blockReason };
        }
        if (this._configStatsTourActive && !force) return { ok: false, reason: 'active' };
        if (this._isConfigTabTourBusy('stats')) {
            return { ok: false, reason: 'active-other' };
        }
        if (!force && this.hasSeenConfigStatsTour()) return { ok: false, reason: 'completed' };

        if (force) {
            this.cancelConfigStatsTourSchedule();
            window.ConfigStatsTour.teardownStaleDom?.();
            this._configStatsTourActive = false;
            if (document.body?.classList.contains('loading')) {
                window.SkeletonLoading?.finish?.();
            }
            this.ensureStatsTabActive();
        } else if (!this.isConfigStatsTabActive()) {
            return { ok: false, reason: 'wrong-tab' };
        }

        const tour = new window.ConfigStatsTour({
            language: this.language,
            hasSeen: () => this.hasSeenConfigStatsTour(),
            onMarkSeen: () => this.markConfigStatsTourCompleted(),
        });
        if (!tour.canStart({ force })) {
            return { ok: false, reason: force ? 'no-stats-tab' : 'mobile' };
        }

        this._configStatsTourStarting = true;
        this._configStatsTourActive = true;
        try {
            const started = await tour.prepareAndStart({ force });
            if (!started) {
                this._configStatsTourActive = false;
                window.ConfigStatsTour.teardownStaleDom?.();
                return { ok: false, reason: tour.lastFailureReason || 'prepare-failed' };
            }
            this.cancelConfigStatsTourSchedule();
            return { ok: true };
        } catch (error) {
            console.error('Config Stats tour failed to start', error);
            this._configStatsTourActive = false;
            window.ConfigStatsTour.teardownStaleDom?.();
            return { ok: false, reason: 'error' };
        } finally {
            this._configStatsTourStarting = false;
        }
    }

    ensureStatsTabActive() {
        if (this.ui?.switchToTab) {
            this.ui.switchToTab('stats');
        } else {
            const panel = document.querySelector('[data-tab-content="stats"]');
            if (panel && !panel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="stats"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'stats') {
            window.history.replaceState(null, '', '#stats');
        }
    }

    hasSeenConfigCategoriesTour() {
        if (this.settingsData?.configCategoriesTourCompleted === true) return true;
        try {
            return localStorage.getItem(
                window.ConfigCategoriesTour?.STORAGE_KEY || 'nextdash:config-categories-tour-v1'
            ) === '1';
        } catch {
            return false;
        }
    }

    syncConfigCategoriesTourSeenFromServer() {
        const key = window.ConfigCategoriesTour?.STORAGE_KEY || 'nextdash:config-categories-tour-v1';
        try {
            if (this.settingsData?.configCategoriesTourCompleted === true) {
                localStorage.setItem(key, '1');
            } else {
                localStorage.removeItem(key);
            }
        } catch {
            // ignore
        }
    }

    async markConfigCategoriesTourCompleted() {
        this.settingsData.configCategoriesTourCompleted = true;
        try {
            localStorage.setItem(
                window.ConfigCategoriesTour?.STORAGE_KEY || 'nextdash:config-categories-tour-v1',
                '1'
            );
        } catch {
            // ignore
        }
        if (this.settings?.saveSettingsToServer) {
            await this.settings.saveSettingsToServer(this.settingsData);
        }
    }

    cancelConfigCategoriesTourSchedule() {
        this._configCategoriesTourScheduleId = (this._configCategoriesTourScheduleId || 0) + 1;
        if (this._configCategoriesTourScheduleTimer) {
            clearTimeout(this._configCategoriesTourScheduleTimer);
            this._configCategoriesTourScheduleTimer = null;
        }
    }

    scheduleConfigCategoriesTour() {
        if (typeof window.ConfigCategoriesTour !== 'function') return;
        if (this.hasSeenConfigCategoriesTour()) return;
        if (this._configCategoriesTourActive || this._configCategoriesTourStarting) return;
        if (this._isConfigTabTourBusy('categories')) return;
        if (document.body?.classList.contains('loading')) return;

        this.cancelConfigCategoriesTourSchedule();
        const runId = this._configCategoriesTourScheduleId;
        this._configCategoriesTourScheduleTimer = setTimeout(() => {
            this._configCategoriesTourScheduleTimer = null;
            if (runId !== this._configCategoriesTourScheduleId) return;
            if (
                this.hasSeenConfigCategoriesTour() ||
                this._configCategoriesTourActive ||
                this._configCategoriesTourStarting ||
                this._isConfigTabTourBusy('categories')
            ) {
                return;
            }
            if (!this.isConfigCategoriesTabActive()) return;
            this.dismissOtherConfigTabTours('categories');
            void this.maybeStartConfigCategoriesTour();
        }, 550);
    }

    isConfigCategoriesTabActive() {
        if (this.ui?._currentTab === 'categories') return true;
        const activeTab = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
        if (activeTab === 'categories') return true;
        const hash = (window.location.hash || '').replace(/^#/, '');
        return hash === 'categories';
    }

    configCategoriesTourFailureMessage(reason) {
        const keyByReason = {
            'missing-script': 'config.resetConfigCategoriesTourFailedReload',
            'no-categories-tab': 'config.resetConfigCategoriesTourFailedTab',
            'dom-not-ready': 'config.resetConfigCategoriesTourFailedDom',
            'render-failed': 'config.resetConfigCategoriesTourFailedDom',
            'step-error': 'config.resetConfigCategoriesTourFailedDom',
            blocked: 'config.resetConfigCategoriesTourFailedDom',
            mobile: 'config.resetConfigCategoriesTourFailedMobile',
            error: 'config.resetConfigCategoriesTourFailedDom',
        };
        const fallbacks = {
            'missing-script': 'Could not start the Categories tour. Refresh the page and try again.',
            'no-categories-tab': 'Could not start the Categories tour. Open the Categories tab first.',
            'dom-not-ready':
                'Could not start the Categories tour. Categories are still loading — refresh and try again.',
            mobile:
                'Could not start the Categories tour. Use a wider window or disable mobile device emulation in your browser.',
            error: 'Could not start the Categories tour. Refresh the page and try again.',
        };
        const key = keyByReason[reason] || 'config.resetConfigCategoriesTourFailed';
        try {
            if (this.language && typeof this.language.t === 'function') {
                const msg = this.language.t(key);
                if (msg && msg !== key) return msg;
            }
        } catch {
            // ignore
        }
        return fallbacks[reason] || 'Could not start the Categories tour. Open the Categories tab first.';
    }

    async maybeStartConfigCategoriesTour({ force = false } = {}) {
        if (this._configCategoriesTourStarting) {
            return { ok: false, reason: 'starting' };
        }
        const blockReason = window.ConfigCategoriesTour?.getBlockReason?.({
            force,
            hasSeen: () => this.hasSeenConfigCategoriesTour(),
        });
        if (blockReason) {
            if (force) console.warn('Config Categories tour blocked:', blockReason);
            return { ok: false, reason: blockReason };
        }
        if (this._configCategoriesTourActive && !force) return { ok: false, reason: 'active' };
        if (this._isConfigTabTourBusy('categories')) {
            return { ok: false, reason: 'active-other' };
        }
        if (!force && this.hasSeenConfigCategoriesTour()) return { ok: false, reason: 'completed' };

        this.dismissOtherConfigTabTours('categories');

        if (force) {
            this.cancelConfigCategoriesTourSchedule();
            window.ConfigCategoriesTour.teardownStaleDom?.();
            this._configCategoriesTourActive = false;
            if (document.body?.classList.contains('loading')) {
                window.SkeletonLoading?.finish?.();
            }
            this.ensureCategoriesTabActive();
        } else if (!this.isConfigCategoriesTabActive()) {
            return { ok: false, reason: 'wrong-tab' };
        }

        const tour = new window.ConfigCategoriesTour({
            language: this.language,
            hasSeen: () => this.hasSeenConfigCategoriesTour(),
            onMarkSeen: () => this.markConfigCategoriesTourCompleted(),
        });
        if (!tour.canStart({ force })) {
            return { ok: false, reason: force ? 'no-categories-tab' : 'mobile' };
        }

        this._configCategoriesTourStarting = true;
        this._configCategoriesTourActive = true;
        try {
            const started = await tour.prepareAndStart({ force });
            if (!started) {
                this._configCategoriesTourActive = false;
                window.ConfigCategoriesTour.teardownStaleDom?.();
                return { ok: false, reason: tour.lastFailureReason || 'prepare-failed' };
            }
            this.cancelConfigCategoriesTourSchedule();
            return { ok: true };
        } catch (error) {
            console.error('Config Categories tour failed to start', error);
            this._configCategoriesTourActive = false;
            window.ConfigCategoriesTour.teardownStaleDom?.();
            return { ok: false, reason: 'error' };
        } finally {
            this._configCategoriesTourStarting = false;
        }
    }

    ensureCategoriesTabActive() {
        if (this.ui?.switchToTab) {
            this.ui.switchToTab('categories');
        } else {
            const panel = document.querySelector('[data-tab-content="categories"]');
            if (panel && !panel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="categories"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'categories') {
            window.history.replaceState(null, '', '#categories');
        }
    }

    hasSeenConfigTagsTour() {
        if (this.settingsData?.configTagsTourCompleted === true) return true;
        try {
            return localStorage.getItem(
                window.ConfigTagsTour?.STORAGE_KEY || 'nextdash:config-tags-tour-v1'
            ) === '1';
        } catch {
            return false;
        }
    }

    syncConfigTagsTourSeenFromServer() {
        const key = window.ConfigTagsTour?.STORAGE_KEY || 'nextdash:config-tags-tour-v1';
        try {
            if (this.settingsData?.configTagsTourCompleted === true) {
                localStorage.setItem(key, '1');
            } else {
                localStorage.removeItem(key);
            }
        } catch {
            // ignore
        }
    }

    async markConfigTagsTourCompleted() {
        this.settingsData.configTagsTourCompleted = true;
        try {
            localStorage.setItem(
                window.ConfigTagsTour?.STORAGE_KEY || 'nextdash:config-tags-tour-v1',
                '1'
            );
        } catch {
            // ignore
        }
        if (this.settings?.saveSettingsToServer) {
            await this.settings.saveSettingsToServer(this.settingsData);
        }
    }

    cancelConfigTagsTourSchedule() {
        this._configTagsTourScheduleId = (this._configTagsTourScheduleId || 0) + 1;
        if (this._configTagsTourScheduleTimer) {
            clearTimeout(this._configTagsTourScheduleTimer);
            this._configTagsTourScheduleTimer = null;
        }
    }

    scheduleConfigTagsTour() {
        if (typeof window.ConfigTagsTour !== 'function') return;
        if (this.hasSeenConfigTagsTour()) return;
        if (this._configTagsTourActive || this._configTagsTourStarting) return;
        if (this._isConfigTabTourBusy('tags')) return;
        if (document.body?.classList.contains('loading')) return;

        this.cancelConfigTagsTourSchedule();
        const runId = this._configTagsTourScheduleId;
        this._configTagsTourScheduleTimer = setTimeout(() => {
            this._configTagsTourScheduleTimer = null;
            if (runId !== this._configTagsTourScheduleId) return;
            if (
                this.hasSeenConfigTagsTour() ||
                this._configTagsTourActive ||
                this._configTagsTourStarting ||
                this._isConfigTabTourBusy('tags')
            ) {
                return;
            }
            if (!this.isConfigTagsTabActive()) return;
            this.dismissOtherConfigTabTours('tags');
            void this.maybeStartConfigTagsTour();
        }, 550);
    }

    isConfigTagsTabActive() {
        if (this.ui?._currentTab === 'tags') return true;
        const activeTab = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
        if (activeTab === 'tags') return true;
        const hash = (window.location.hash || '').replace(/^#/, '');
        return hash === 'tags';
    }

    configTagsTourFailureMessage(reason) {
        const keyByReason = {
            'missing-script': 'config.resetConfigTagsTourFailedReload',
            'no-tags-tab': 'config.resetConfigTagsTourFailedTab',
            'dom-not-ready': 'config.resetConfigTagsTourFailedDom',
            'render-failed': 'config.resetConfigTagsTourFailedDom',
            'step-error': 'config.resetConfigTagsTourFailedDom',
            blocked: 'config.resetConfigTagsTourFailedDom',
            mobile: 'config.resetConfigTagsTourFailedMobile',
            error: 'config.resetConfigTagsTourFailedDom',
        };
        const fallbacks = {
            'missing-script': 'Could not start the Tags tour. Refresh the page and try again.',
            'no-tags-tab': 'Could not start the Tags tour. Open the Tags tab first.',
            'dom-not-ready': 'Could not start the Tags tour. Tags are still loading — refresh and try again.',
            mobile:
                'Could not start the Tags tour. Use a wider window or disable mobile device emulation in your browser.',
            error: 'Could not start the Tags tour. Refresh the page and try again.',
        };
        const key = keyByReason[reason] || 'config.resetConfigTagsTourFailed';
        try {
            if (this.language && typeof this.language.t === 'function') {
                const msg = this.language.t(key);
                if (msg && msg !== key) return msg;
            }
        } catch {
            // ignore
        }
        return fallbacks[reason] || 'Could not start the Tags tour. Open the Tags tab first.';
    }

    async maybeStartConfigTagsTour({ force = false } = {}) {
        if (this._configTagsTourStarting) {
            return { ok: false, reason: 'starting' };
        }
        const blockReason = window.ConfigTagsTour?.getBlockReason?.({
            force,
            hasSeen: () => this.hasSeenConfigTagsTour(),
        });
        if (blockReason) {
            if (force) console.warn('Config Tags tour blocked:', blockReason);
            return { ok: false, reason: blockReason };
        }
        if (this._configTagsTourActive && !force) return { ok: false, reason: 'active' };
        if (this._isConfigTabTourBusy('tags')) {
            return { ok: false, reason: 'active-other' };
        }
        if (!force && this.hasSeenConfigTagsTour()) return { ok: false, reason: 'completed' };

        this.dismissOtherConfigTabTours('tags');

        if (force) {
            this.cancelConfigTagsTourSchedule();
            window.ConfigTagsTour.teardownStaleDom?.();
            this._configTagsTourActive = false;
            if (document.body?.classList.contains('loading')) {
                window.SkeletonLoading?.finish?.();
            }
            this.ensureTagsTabActive();
        } else if (!this.isConfigTagsTabActive()) {
            return { ok: false, reason: 'wrong-tab' };
        }

        const tour = new window.ConfigTagsTour({
            language: this.language,
            hasSeen: () => this.hasSeenConfigTagsTour(),
            onMarkSeen: () => this.markConfigTagsTourCompleted(),
        });
        if (!tour.canStart({ force })) {
            return { ok: false, reason: force ? 'no-tags-tab' : 'mobile' };
        }

        this._configTagsTourStarting = true;
        this._configTagsTourActive = true;
        try {
            const started = await tour.prepareAndStart({ force });
            if (!started) {
                this._configTagsTourActive = false;
                window.ConfigTagsTour.teardownStaleDom?.();
                return { ok: false, reason: tour.lastFailureReason || 'prepare-failed' };
            }
            this.cancelConfigTagsTourSchedule();
            return { ok: true };
        } catch (error) {
            console.error('Config Tags tour failed to start', error);
            this._configTagsTourActive = false;
            window.ConfigTagsTour.teardownStaleDom?.();
            return { ok: false, reason: 'error' };
        } finally {
            this._configTagsTourStarting = false;
        }
    }

    ensureTagsTabActive() {
        if (this.ui?.switchToTab) {
            this.ui.switchToTab('tags');
        } else {
            const panel = document.querySelector('[data-tab-content="tags"]');
            if (panel && !panel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="tags"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'tags') {
            window.history.replaceState(null, '', '#tags');
        }
    }

    hasSeenConfigPagesTour() {
        if (this.settingsData?.configPagesTourCompleted === true) return true;
        try {
            return localStorage.getItem(
                window.ConfigPagesTour?.STORAGE_KEY || 'nextdash:config-pages-tour-v1'
            ) === '1';
        } catch {
            return false;
        }
    }

    syncConfigPagesTourSeenFromServer() {
        const key = window.ConfigPagesTour?.STORAGE_KEY || 'nextdash:config-pages-tour-v1';
        try {
            if (this.settingsData?.configPagesTourCompleted === true) {
                localStorage.setItem(key, '1');
            } else {
                localStorage.removeItem(key);
            }
        } catch {
            // ignore
        }
    }

    async markConfigPagesTourCompleted() {
        this.settingsData.configPagesTourCompleted = true;
        try {
            localStorage.setItem(
                window.ConfigPagesTour?.STORAGE_KEY || 'nextdash:config-pages-tour-v1',
                '1'
            );
        } catch {
            // ignore
        }
        if (this.settings?.saveSettingsToServer) {
            await this.settings.saveSettingsToServer(this.settingsData);
        }
    }

    cancelConfigPagesTourSchedule() {
        this._configPagesTourScheduleId = (this._configPagesTourScheduleId || 0) + 1;
        if (this._configPagesTourScheduleTimer) {
            clearTimeout(this._configPagesTourScheduleTimer);
            this._configPagesTourScheduleTimer = null;
        }
    }

    scheduleConfigPagesTour() {
        if (typeof window.ConfigPagesTour !== 'function') return;
        if (this.hasSeenConfigPagesTour()) return;
        if (this._configPagesTourActive || this._configPagesTourStarting) return;
        if (this._isConfigTabTourBusy('pages')) return;
        if (document.body?.classList.contains('loading')) return;

        this.cancelConfigPagesTourSchedule();
        const runId = this._configPagesTourScheduleId;
        this._configPagesTourScheduleTimer = setTimeout(() => {
            this._configPagesTourScheduleTimer = null;
            if (runId !== this._configPagesTourScheduleId) return;
            if (
                this.hasSeenConfigPagesTour() ||
                this._configPagesTourActive ||
                this._configPagesTourStarting ||
                this._isConfigTabTourBusy('pages')
            ) {
                return;
            }
            if (!this.isConfigPagesTabActive()) return;
            this.dismissOtherConfigTabTours('pages');
            void this.maybeStartConfigPagesTour();
        }, 550);
    }

    isConfigPagesTabActive() {
        if (this.ui?._currentTab === 'pages') return true;
        const activeTab = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
        if (activeTab === 'pages') return true;
        const hash = (window.location.hash || '').replace(/^#/, '');
        return hash === 'pages';
    }

    configPagesTourFailureMessage(reason) {
        const keyByReason = {
            'missing-script': 'config.resetConfigPagesTourFailedReload',
            'no-pages-tab': 'config.resetConfigPagesTourFailedTab',
            'dom-not-ready': 'config.resetConfigPagesTourFailedDom',
            'render-failed': 'config.resetConfigPagesTourFailedDom',
            'step-error': 'config.resetConfigPagesTourFailedDom',
            blocked: 'config.resetConfigPagesTourFailedDom',
            mobile: 'config.resetConfigPagesTourFailedMobile',
            error: 'config.resetConfigPagesTourFailedDom',
        };
        const fallbacks = {
            'missing-script': 'Could not start the Pages tour. Refresh the page and try again.',
            'no-pages-tab': 'Could not start the Pages tour. Open the Pages tab first.',
            'dom-not-ready':
                'Could not start the Pages tour. Pages are still loading — refresh and try again.',
            mobile:
                'Could not start the Pages tour. Use a wider window or disable mobile device emulation in your browser.',
            error: 'Could not start the Pages tour. Refresh the page and try again.',
        };
        const key = keyByReason[reason] || 'config.resetConfigPagesTourFailed';
        try {
            if (this.language && typeof this.language.t === 'function') {
                const msg = this.language.t(key);
                if (msg && msg !== key) return msg;
            }
        } catch {
            // ignore
        }
        return fallbacks[reason] || 'Could not start the Pages tour. Open the Pages tab first.';
    }

    async maybeStartConfigPagesTour({ force = false } = {}) {
        if (this._configPagesTourStarting) {
            return { ok: false, reason: 'starting' };
        }
        const blockReason = window.ConfigPagesTour?.getBlockReason?.({
            force,
            hasSeen: () => this.hasSeenConfigPagesTour(),
        });
        if (blockReason) {
            if (force) console.warn('Config Pages tour blocked:', blockReason);
            return { ok: false, reason: blockReason };
        }
        if (this._configPagesTourActive && !force) return { ok: false, reason: 'active' };
        if (this._isConfigTabTourBusy('pages')) {
            return { ok: false, reason: 'active-other' };
        }
        if (!force && this.hasSeenConfigPagesTour()) return { ok: false, reason: 'completed' };

        this.dismissOtherConfigTabTours('pages');

        if (force) {
            this.cancelConfigPagesTourSchedule();
            window.ConfigPagesTour.teardownStaleDom?.();
            this._configPagesTourActive = false;
            if (document.body?.classList.contains('loading')) {
                window.SkeletonLoading?.finish?.();
            }
            this.ensurePagesTabActive();
        } else if (!this.isConfigPagesTabActive()) {
            return { ok: false, reason: 'wrong-tab' };
        }

        const tour = new window.ConfigPagesTour({
            language: this.language,
            hasSeen: () => this.hasSeenConfigPagesTour(),
            onMarkSeen: () => this.markConfigPagesTourCompleted(),
        });
        if (!tour.canStart({ force })) {
            return { ok: false, reason: force ? 'no-pages-tab' : 'mobile' };
        }

        this._configPagesTourStarting = true;
        this._configPagesTourActive = true;
        try {
            const started = await tour.prepareAndStart({ force });
            if (!started) {
                this._configPagesTourActive = false;
                window.ConfigPagesTour.teardownStaleDom?.();
                return { ok: false, reason: tour.lastFailureReason || 'prepare-failed' };
            }
            this.cancelConfigPagesTourSchedule();
            return { ok: true };
        } catch (error) {
            console.error('Config Pages tour failed to start', error);
            this._configPagesTourActive = false;
            window.ConfigPagesTour.teardownStaleDom?.();
            return { ok: false, reason: 'error' };
        } finally {
            this._configPagesTourStarting = false;
        }
    }

    ensurePagesTabActive() {
        if (this.ui?.switchToTab) {
            this.ui.switchToTab('pages');
        } else {
            const panel = document.querySelector('[data-tab-content="pages"]');
            if (panel && !panel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="pages"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'pages') {
            window.history.replaceState(null, '', '#pages');
        }
    }

    hasSeenConfigCollectionsTour() {
        if (this.settingsData?.configCollectionsTourCompleted === true) return true;
        try {
            return localStorage.getItem(
                window.ConfigCollectionsTour?.STORAGE_KEY || 'nextdash:config-collections-tour-v1'
            ) === '1';
        } catch {
            return false;
        }
    }

    syncConfigCollectionsTourSeenFromServer() {
        const key =
            window.ConfigCollectionsTour?.STORAGE_KEY || 'nextdash:config-collections-tour-v1';
        try {
            if (this.settingsData?.configCollectionsTourCompleted === true) {
                localStorage.setItem(key, '1');
            } else {
                localStorage.removeItem(key);
            }
        } catch {
            // ignore
        }
    }

    async markConfigCollectionsTourCompleted() {
        this.settingsData.configCollectionsTourCompleted = true;
        try {
            localStorage.setItem(
                window.ConfigCollectionsTour?.STORAGE_KEY || 'nextdash:config-collections-tour-v1',
                '1'
            );
        } catch {
            // ignore
        }
        if (this.settings?.saveSettingsToServer) {
            await this.settings.saveSettingsToServer(this.settingsData);
        }
    }

    cancelConfigCollectionsTourSchedule() {
        this._configCollectionsTourScheduleId = (this._configCollectionsTourScheduleId || 0) + 1;
        if (this._configCollectionsTourScheduleTimer) {
            clearTimeout(this._configCollectionsTourScheduleTimer);
            this._configCollectionsTourScheduleTimer = null;
        }
    }

    scheduleConfigCollectionsTour() {
        if (typeof window.ConfigCollectionsTour !== 'function') return;
        if (this.hasSeenConfigCollectionsTour()) return;
        if (this._configCollectionsTourActive || this._configCollectionsTourStarting) return;
        if (this._isConfigTabTourBusy('collections')) return;
        if (document.body?.classList.contains('loading')) return;

        this.cancelConfigCollectionsTourSchedule();
        const runId = this._configCollectionsTourScheduleId;
        this._configCollectionsTourScheduleTimer = setTimeout(() => {
            this._configCollectionsTourScheduleTimer = null;
            if (runId !== this._configCollectionsTourScheduleId) return;
            if (
                this.hasSeenConfigCollectionsTour() ||
                this._configCollectionsTourActive ||
                this._configCollectionsTourStarting ||
                this._isConfigTabTourBusy('collections')
            ) {
                return;
            }
            if (!this.isConfigCollectionsTabActive()) return;
            this.dismissOtherConfigTabTours('collections');
            void this.maybeStartConfigCollectionsTour();
        }, 550);
    }

    isConfigCollectionsTabActive() {
        if (this.ui?._currentTab === 'collections') return true;
        const activeTab = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
        if (activeTab === 'collections') return true;
        const hash = (window.location.hash || '').replace(/^#/, '');
        return hash === 'collections';
    }

    configCollectionsTourFailureMessage(reason) {
        const keyByReason = {
            'missing-script': 'config.resetConfigCollectionsTourFailedReload',
            'no-collections-tab': 'config.resetConfigCollectionsTourFailedTab',
            'dom-not-ready': 'config.resetConfigCollectionsTourFailedDom',
            'render-failed': 'config.resetConfigCollectionsTourFailedDom',
            'step-error': 'config.resetConfigCollectionsTourFailedDom',
            blocked: 'config.resetConfigCollectionsTourFailedDom',
            mobile: 'config.resetConfigCollectionsTourFailedMobile',
            error: 'config.resetConfigCollectionsTourFailedDom',
        };
        const fallbacks = {
            'missing-script': 'Could not start the Collections tour. Refresh the page and try again.',
            'no-collections-tab': 'Could not start the Collections tour. Open the Collections tab first.',
            'dom-not-ready':
                'Could not start the Collections tour. Collections are still loading — refresh and try again.',
            mobile:
                'Could not start the Collections tour. Use a wider window or disable mobile device emulation in your browser.',
            error: 'Could not start the Collections tour. Refresh the page and try again.',
        };
        const key = keyByReason[reason] || 'config.resetConfigCollectionsTourFailed';
        try {
            if (this.language && typeof this.language.t === 'function') {
                const msg = this.language.t(key);
                if (msg && msg !== key) return msg;
            }
        } catch {
            // ignore
        }
        return fallbacks[reason] || 'Could not start the Collections tour. Open the Collections tab first.';
    }

    async maybeStartConfigCollectionsTour({ force = false } = {}) {
        if (this._configCollectionsTourStarting) {
            return { ok: false, reason: 'starting' };
        }
        const blockReason = window.ConfigCollectionsTour?.getBlockReason?.({
            force,
            hasSeen: () => this.hasSeenConfigCollectionsTour(),
        });
        if (blockReason) {
            if (force) console.warn('Config Collections tour blocked:', blockReason);
            return { ok: false, reason: blockReason };
        }
        if (this._configCollectionsTourActive && !force) return { ok: false, reason: 'active' };
        if (this._isConfigTabTourBusy('collections')) {
            return { ok: false, reason: 'active-other' };
        }
        if (!force && this.hasSeenConfigCollectionsTour()) return { ok: false, reason: 'completed' };

        this.dismissOtherConfigTabTours('collections');

        if (force) {
            this.cancelConfigCollectionsTourSchedule();
            window.ConfigCollectionsTour.teardownStaleDom?.();
            this._configCollectionsTourActive = false;
            if (document.body?.classList.contains('loading')) {
                window.SkeletonLoading?.finish?.();
            }
            this.ensureCollectionsTabActive();
        } else if (!this.isConfigCollectionsTabActive()) {
            return { ok: false, reason: 'wrong-tab' };
        }

        const tour = new window.ConfigCollectionsTour({
            language: this.language,
            hasSeen: () => this.hasSeenConfigCollectionsTour(),
            onMarkSeen: () => this.markConfigCollectionsTourCompleted(),
        });
        if (!tour.canStart({ force })) {
            return { ok: false, reason: force ? 'no-collections-tab' : 'mobile' };
        }

        this._configCollectionsTourStarting = true;
        this._configCollectionsTourActive = true;
        try {
            const started = await tour.prepareAndStart({ force });
            if (!started) {
                this._configCollectionsTourActive = false;
                window.ConfigCollectionsTour.teardownStaleDom?.();
                return { ok: false, reason: tour.lastFailureReason || 'prepare-failed' };
            }
            this.cancelConfigCollectionsTourSchedule();
            return { ok: true };
        } catch (error) {
            console.error('Config Collections tour failed to start', error);
            this._configCollectionsTourActive = false;
            window.ConfigCollectionsTour.teardownStaleDom?.();
            return { ok: false, reason: 'error' };
        } finally {
            this._configCollectionsTourStarting = false;
        }
    }

    ensureCollectionsTabActive() {
        if (this.ui?.switchToTab) {
            this.ui.switchToTab('collections');
        } else {
            const panel = document.querySelector('[data-tab-content="collections"]');
            if (panel && !panel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="collections"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'collections') {
            window.history.replaceState(null, '', '#collections');
        }
    }

    onConfigColorsTabOpened() {
        if (this.hasSeenConfigThemeTour()) return Promise.resolve();
        this.dismissOtherConfigTabTours('theme');
        const schedule = () => this.scheduleConfigThemeTour();
        if (typeof this.ensureColorsEditor === 'function') {
            return this.ensureColorsEditor().finally(schedule);
        }
        schedule();
        return Promise.resolve();
    }

    hasSeenConfigThemeTour() {
        if (this.settingsData?.configThemeTourCompleted === true) return true;
        try {
            return localStorage.getItem(
                window.ConfigThemeTour?.STORAGE_KEY || 'nextdash:config-theme-tour-v1'
            ) === '1';
        } catch {
            return false;
        }
    }

    syncConfigThemeTourSeenFromServer() {
        const key = window.ConfigThemeTour?.STORAGE_KEY || 'nextdash:config-theme-tour-v1';
        try {
            if (this.settingsData?.configThemeTourCompleted === true) {
                localStorage.setItem(key, '1');
            } else {
                localStorage.removeItem(key);
            }
        } catch {
            // ignore
        }
    }

    async markConfigThemeTourCompleted() {
        this.settingsData.configThemeTourCompleted = true;
        try {
            localStorage.setItem(
                window.ConfigThemeTour?.STORAGE_KEY || 'nextdash:config-theme-tour-v1',
                '1'
            );
        } catch {
            // ignore
        }
        if (this.settings?.saveSettingsToServer) {
            await this.settings.saveSettingsToServer(this.settingsData);
        }
    }

    cancelConfigThemeTourSchedule() {
        this._configThemeTourScheduleId = (this._configThemeTourScheduleId || 0) + 1;
        if (this._configThemeTourScheduleTimer) {
            clearTimeout(this._configThemeTourScheduleTimer);
            this._configThemeTourScheduleTimer = null;
        }
    }

    scheduleConfigThemeTour() {
        if (typeof window.ConfigThemeTour !== 'function') return;
        if (this.hasSeenConfigThemeTour()) return;
        if (this._configThemeTourActive || this._configThemeTourStarting) return;
        if (this._isConfigTabTourBusy('theme')) return;
        if (document.body?.classList.contains('loading')) return;

        this.cancelConfigThemeTourSchedule();
        const runId = this._configThemeTourScheduleId;
        this._configThemeTourScheduleTimer = setTimeout(() => {
            this._configThemeTourScheduleTimer = null;
            if (runId !== this._configThemeTourScheduleId) return;
            if (
                this.hasSeenConfigThemeTour() ||
                this._configThemeTourActive ||
                this._configThemeTourStarting ||
                this._isConfigTabTourBusy('theme')
            ) {
                return;
            }
            if (!this.isConfigColorsTabActive()) return;
            this.dismissOtherConfigTabTours('theme');
            void this.maybeStartConfigThemeTour();
        }, 550);
    }

    isConfigColorsTabActive() {
        if (this.ui?._currentTab === 'colors') return true;
        const activeTab = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
        if (activeTab === 'colors') return true;
        const hash = (window.location.hash || '').replace(/^#/, '');
        return hash === 'colors' || hash.startsWith('colors/');
    }

    configThemeTourFailureMessage(reason) {
        const keyByReason = {
            'missing-script': 'config.resetConfigThemeTourFailedReload',
            'no-colors-tab': 'config.resetConfigThemeTourFailedTab',
            'dom-not-ready': 'config.resetConfigThemeTourFailedDom',
            'render-failed': 'config.resetConfigThemeTourFailedDom',
            'step-error': 'config.resetConfigThemeTourFailedDom',
            blocked: 'config.resetConfigThemeTourFailedDom',
            mobile: 'config.resetConfigThemeTourFailedMobile',
            error: 'config.resetConfigThemeTourFailedDom',
        };
        const fallbacks = {
            'missing-script': 'Could not start the Theme tour. Refresh the page and try again.',
            'no-colors-tab': 'Could not start the Theme tour. Open the Theme tab first.',
            'dom-not-ready':
                'Could not start the Theme tour. The editor is still loading — refresh and try again.',
            mobile:
                'Could not start the Theme tour. Use a wider window or disable mobile device emulation in your browser.',
            error: 'Could not start the Theme tour. Refresh the page and try again.',
        };
        const key = keyByReason[reason] || 'config.resetConfigThemeTourFailed';
        try {
            if (this.language && typeof this.language.t === 'function') {
                const msg = this.language.t(key);
                if (msg && msg !== key) return msg;
            }
        } catch {
            // ignore
        }
        return fallbacks[reason] || 'Could not start the Theme tour. Open the Theme tab first.';
    }

    async maybeStartConfigThemeTour({ force = false } = {}) {
        if (this._configThemeTourStarting) {
            return { ok: false, reason: 'starting' };
        }
        const blockReason = window.ConfigThemeTour?.getBlockReason?.({
            force,
            hasSeen: () => this.hasSeenConfigThemeTour(),
        });
        if (blockReason) {
            if (force) console.warn('Config Theme tour blocked:', blockReason);
            return { ok: false, reason: blockReason };
        }
        if (this._configThemeTourActive && !force) return { ok: false, reason: 'active' };
        if (this._isConfigTabTourBusy('theme')) {
            return { ok: false, reason: 'active-other' };
        }
        if (!force && this.hasSeenConfigThemeTour()) return { ok: false, reason: 'completed' };

        this.dismissOtherConfigTabTours('theme');

        if (force) {
            this.cancelConfigThemeTourSchedule();
            window.ConfigThemeTour?.teardownStaleDom?.();
            this._configThemeTourActive = false;
            if (document.body?.classList.contains('loading')) {
                window.SkeletonLoading?.finish?.();
            }
            this.ensureColorsTabActive();
            await this.ensureColorsEditor();
        } else if (!this.isConfigColorsTabActive()) {
            return { ok: false, reason: 'wrong-tab' };
        }

        const tour = new window.ConfigThemeTour({
            language: this.language,
            hasSeen: () => this.hasSeenConfigThemeTour(),
            onMarkSeen: () => this.markConfigThemeTourCompleted(),
        });
        if (!tour.canStart({ force })) {
            return { ok: false, reason: force ? 'no-colors-tab' : 'mobile' };
        }

        this._configThemeTourStarting = true;
        this._configThemeTourActive = true;
        try {
            const started = await tour.prepareAndStart({ force });
            if (!started) {
                this._configThemeTourActive = false;
                window.ConfigThemeTour?.teardownStaleDom?.();
                return { ok: false, reason: tour.lastFailureReason || 'prepare-failed' };
            }
            this.cancelConfigThemeTourSchedule();
            return { ok: true };
        } catch (error) {
            console.error('Config Theme tour failed to start', error);
            this._configThemeTourActive = false;
            window.ConfigThemeTour?.teardownStaleDom?.();
            return { ok: false, reason: 'error' };
        } finally {
            this._configThemeTourStarting = false;
        }
    }

    ensureColorsTabActive() {
        if (this.ui?.switchToTab) {
            this.ui.switchToTab('colors');
        } else {
            const panel = document.querySelector('[data-tab-content="colors"]');
            if (panel && !panel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="colors"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (!hash.startsWith('colors')) {
            window.history.replaceState(null, '', '#colors');
        }
    }

    ensureGeneralTabActive() {
        if (this.ui?.switchToTab) {
            this.ui.switchToTab('general');
        } else {
            const generalPanel = document.querySelector('[data-tab-content="general"]');
            if (generalPanel && !generalPanel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="general"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (!hash.startsWith('general')) {
            window.history.replaceState(null, '', '#general');
            this.generalLayers?.applyLayer?.('essentials', { updateHash: false });
        }
    }

    async ensureColorsEditor() {
        if (!document.getElementById('theme-colors-editor')) return;
        if (!this.colorsEditor) {
            this.colorsEditor = new ColorsEditor({
                root: document.getElementById('theme-colors-editor'),
                language: this.language,
                settings: this.settingsData,
                onDirtyChange: (dirty) => this.setColorsDirtyState(dirty),
            });
        }
        await this.colorsEditor.init();
    }

    async removeCustomTheme(themeId) {
        return this.colorsEditor?.removeCustomTheme(themeId);
    }

    async guardColorsTabLeave(targetTab) {
        if (this._configThemeTourActive || this._configThemeTourStarting) {
            return true;
        }
        if (this.ui._currentTab !== 'colors' || targetTab === 'colors') {
            if (targetTab === 'colors') await this.ensureColorsEditor();
            return true;
        }
        if (!this.colorsEditor?.isDirty()) return true;
        const ok = await this.colorsEditor.confirmLeave();
        if (ok && targetTab === 'colors') await this.ensureColorsEditor();
        return ok;
    }

    hasUnsavedColorChanges() {
        return Boolean(this.colorsEditor?.isDirty());
    }

    async loadData() {
        try {
            this.deviceSpecific = this.storage.getDeviceSpecificFlag();
            const { bookmarks, pages, settings } = await this.data.loadData(this.deviceSpecific);

            this.pagesData = this.applyPagesNormalization(pages, { trackRepair: true });
            this.originalPagesData = JSON.parse(JSON.stringify(this.pagesData));
            this.findersData = await this.data.loadFinders();
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
                this.settingsData.showTips = false;
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
            this.syncConfigBookmarksTourSeenFromServer();
            this.syncConfigFindersTourSeenFromServer();
            this.syncConfigStatsTourSeenFromServer();
            this.syncConfigCategoriesTourSeenFromServer();
            this.syncConfigTagsTourSeenFromServer();
            this.syncConfigPagesTourSeenFromServer();
            this.syncConfigCollectionsTourSeenFromServer();
            this.syncConfigThemeTourSeenFromServer();
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

    async saveAllBookmarkPages() {
        await this.bookmarkStore.persistAllPages((fn) => this.withRetry(fn));
    }

    async loadPageBookmarks(pageId) {
        try {
            this.currentPageId = parseInt(pageId);
            await this.bookmarkStore.loadPage(pageId);
            this.bookmarksPageCategories = (await this.data.loadCategoriesByPage(pageId)).map(cat => ({ ...cat }));

            if (this.bookmarks) {
                this.bookmarks.activeDetailIndex = null;
                const formEl = document.getElementById('bookmark-detail-form');
                const emptyEl = document.getElementById('bookmark-detail-empty');
                if (formEl) formEl.setAttribute('hidden', '');
                if (emptyEl) emptyEl.style.display = '';
            }

            this.refreshBookmarksFilterOptions();
            // Page switch: do NOT flush current DOM inputs into newly loaded page data.
            this.refreshBookmarksList({ skipFlush: true });
            this.syncBookmarksPageSelectorUI(this.currentPageId);
        } catch (error) {
            this.ui.showErrorWithReload(this.language.t('config.errorLoadingBookmarks'));
        }
    }

    async loadPageCategories(pageId) {
        try {
            this.currentCategoriesPageId = parseInt(pageId, 10);
            this.categoriesData = (await this.data.loadCategoriesByPage(pageId)).map(cat => ({ ...cat }));

            const bookmarksForPage = Number(pageId) === Number(this.currentPageId)
                ? this.bookmarksData
                : await this.data.loadBookmarksByPage(pageId);

            if (this.categoriesData.length === 0 && this.bookmarksReferenceCategories(bookmarksForPage)) {
                this.categoriesData = this.rebuildCategoriesFromBookmarkRefs(bookmarksForPage);
                if (this.categoriesData.length > 0) {
                    try {
                        await this.data.saveCategoriesByPage(this.categoriesData, this.currentCategoriesPageId);
                        this.ui.showNotification(
                            this.language.t('config.categoriesRecovered') || 'Recovered missing categories from bookmark references.',
                            'success'
                        );
                    } catch (recoverErr) {
                        console.error('Failed to persist recovered categories:', recoverErr);
                    }
                }
            }

            const categoryIdMap = this.ensureStableCategoryIds(this.categoriesData);
            if (categoryIdMap.size > 0) {
                this.reassignBookmarkCategoriesFromMap(categoryIdMap, bookmarksForPage);
                if (Number(pageId) === Number(this.currentPageId)) {
                    this.bookmarksData = bookmarksForPage;
                }
            }

            this.categories.render(this.categoriesData, this.generateId.bind(this));
            this.categories.initReorder(this.categoriesData, (newCategories) => {
                this.categoriesData = newCategories;
            });
            this.categoriesListHydrated = true;
        } catch (error) {
            this.ui.showErrorWithReload(this.language.t('config.errorLoadingCategories'));
        }
    }

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
                if (typeof this.refreshCustomSelects === 'function') {
                    this.refreshCustomSelects();
                }
                return;
            }
        }
    }

    setupDOM() {
        this.settings.applyTheme(this.settingsData.theme);
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
            const layoutVersion = (this.settingsData.layoutVersion || 'classic') === 'modern' ? 'modern' : 'classic';
            this.settingsData.layoutVersion = layoutVersion;
            document.documentElement.setAttribute('data-layout-version', layoutVersion);
            document.body.setAttribute('data-layout-version', layoutVersion);
        }
        document.body.setAttribute('data-density-mode', this.settingsData.densityMode || 'compact');
        this.settings.applyBackgroundOpacity(this.settingsData.backgroundOpacity);
        this.settings.applyFontWeight(this.settingsData.fontWeight);
        if (window.DashboardFont) {
            window.DashboardFont.applyMainFont(this.settingsData);
        }
        this.settings.applyAutoDarkMode(this.settingsData.autoDarkMode, this.settingsData);
    }

    async setupEventListeners() {
        // Setup input validation
        this.setupInputValidation();
        
        // Setup settings listeners with callbacks
        await this.settings.setupListeners(this.settingsData, {
            onThemeChange: async (theme) => {
                this.settings.applyTheme(theme);
                this.settings.reloadThemeCSS();
                this.settings.updateAutoPreview(theme);
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
            onLayoutVersionChange: (layoutVersion) => {
                if (window.LayoutVersionUtils) {
                    this.settingsData.layoutVersion = window.LayoutVersionUtils.applyLayoutVersion(
                        this.settingsData,
                        layoutVersion || 'classic'
                    );
                } else {
                    const version = (layoutVersion || 'classic') === 'modern' ? 'modern' : 'classic';
                    this.settingsData.layoutVersion = version;
                    document.documentElement.setAttribute('data-layout-version', version);
                    document.body.setAttribute('data-layout-version', version);
                }
            },
            onLayoutPresetChange: (preset) => {
                if (window.LayoutUtils) {
                    this.settingsData.layoutPreset = window.LayoutUtils.applyLayoutPreset(this.settingsData, preset || 'default');
                } else {
                    document.body.setAttribute('data-layout-preset', preset || 'default');
                }
            },
            onDensityModeChange: (densityMode) => {
                const normalizedDensity = ['comfortable', 'compact', 'dense', 'auto'].includes(densityMode) ? densityMode : 'compact';
                this.settingsData.densityMode = normalizedDensity;
                document.body.setAttribute('data-density-mode', normalizedDensity);
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
                this.signalDashboardSettingsUpdated('settings-updated');
            },
            onCalendarUrlChange: async () => {
                this.settings.updateFromUI(this.settingsData);
                await this.settings.saveSettingsToServer(this.settingsData);
                this.signalDashboardSettingsUpdated('settings-updated');
            },
            onButtonBarPositionChange: async () => {
                this.settings.updateFromUI(this.settingsData);
                await this.settings.saveSettingsToServer(this.settingsData);
                this.signalDashboardSettingsUpdated('settings-updated');
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
                window.LayoutModernNudge?.reset?.();
                if (window.dashboardInstance) {
                    window.dashboardInstance.layoutModernNudge?.dismiss?.(false);
                    window.dashboardInstance.layoutModernNudge = null;
                    window.dashboardInstance.discoverabilityQueue?.scheduleRun?.();
                }
                this.ui.showNotification(
                    this.language.t('config.resetLayoutModernNudgeSuccess')
                        || 'Layout prompt reset — reload the dashboard to see it again.',
                    'success'
                );
            });
        }

        const resetPasteSpotlightBtn = document.getElementById('reset-paste-spotlight-btn');
        if (resetPasteSpotlightBtn) {
            resetPasteSpotlightBtn.addEventListener('click', () => {
                window.FeatureSpotlight?.resetPasteSpotlight?.();
                if (window.dashboardInstance) {
                    window.dashboardInstance.pasteSpotlight?.dismiss?.(false);
                    window.dashboardInstance.pasteSpotlight = null;
                    window.dashboardInstance.maybeShowPasteSpotlight?.();
                }
                this.ui.showNotification(
                    this.language.t('config.resetPasteSpotlightSuccess')
                        || 'Paste spotlight reset — reload the dashboard if it does not appear.',
                    'success'
                );
            });
        }

        const resetDiscoverabilitySessionBtn = document.getElementById('reset-discoverability-session-btn');
        if (resetDiscoverabilitySessionBtn) {
            resetDiscoverabilitySessionBtn.addEventListener('click', () => {
                window.DiscoverabilityQueue?.resetSessionState?.();
                if (window.dashboardInstance?.discoverabilityQueue) {
                    window.dashboardInstance.discoverabilityQueue.scheduleRun({ delay: 300 });
                }
                this.ui.showNotification(
                    this.language.t('config.resetDiscoverabilitySessionSuccess')
                        || 'Discoverability queue reset for this browser session.',
                    'success'
                );
            });
        }

        this.settings.updateStatusOptionsVisibility(this.settingsData.showStatus);

        this.settings.attachSettingResetButtons(this.settingsData, () => this.markDirty());

        const addPageBtn = document.getElementById('add-page-btn');
        if (addPageBtn) addPageBtn.addEventListener('click', () => this.addPage());

        const addCategoryBtn = document.getElementById('add-category-btn');
        if (addCategoryBtn) addCategoryBtn.addEventListener('click', () => this.addCategory());

        const addBookmarkBtn = document.getElementById('add-bookmark-btn');
        if (addBookmarkBtn) addBookmarkBtn.addEventListener('click', () => this.addBookmark());

        if (window.ConfigQuickAdd) {
            this.quickAdd = new window.ConfigQuickAdd(this);
            const quickAddBtn = document.getElementById('config-quick-add-btn');
            if (quickAddBtn) quickAddBtn.addEventListener('click', () => this.quickAdd.open());
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
                    const formEl = document.getElementById('bookmark-detail-form');
                    const emptyEl = document.getElementById('bookmark-detail-empty');
                    if (formEl) formEl.setAttribute('hidden', '');
                    if (emptyEl) emptyEl.style.display = '';
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
                const formEl = document.getElementById('bookmark-detail-form');
                const emptyEl = document.getElementById('bookmark-detail-empty');
                if (formEl) formEl.setAttribute('hidden', '');
                if (emptyEl) emptyEl.style.display = '';
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

        const bulkApplyCategoryBtn = document.getElementById('bulk-apply-category-btn');
        const bulkCategorySelect = document.getElementById('bulk-category-select');
        if (bulkApplyCategoryBtn && bulkCategorySelect) {
            bulkApplyCategoryBtn.addEventListener('click', () => {
                const selectedCategory = bulkCategorySelect.value;
                if (!selectedCategory) {
                    this.ui.showNotification(this.language.t('config.selectCategoryFirst') || 'Select a category first.', 'info');
                    return;
                }
                const updated = this.bookmarks.bulkUpdateCategory(this.bookmarksData, selectedCategory);
                if (updated > 0) {
                    const template = this.language.t('config.bulkCategoryUpdated') || 'Category updated for {count} bookmark(s).';
                    this.ui.showNotification(template.replace('{count}', String(updated)), 'success');
                }
                this.refreshBookmarksList({ skipFlush: true });
                this.markDirty();
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

        const bulkMovePageBtn = document.getElementById('bulk-move-page-btn');
        const bulkPageSelect = document.getElementById('bulk-page-select');
        const bulkMoveCategorySelect = document.getElementById('bulk-move-category-select');
        if (bulkPageSelect && bulkMoveCategorySelect) {
            bulkPageSelect.addEventListener('change', async () => {
                const targetPageId = Number(bulkPageSelect.value || 0);
                bulkMoveCategorySelect.innerHTML = '';
                if (!targetPageId) {
                    bulkMoveCategorySelect.disabled = true;
                    return;
                }
                const currentPageId = Number(this.currentPageId) || 1;
                const cats = targetPageId === currentPageId
                    ? (this.bookmarksPageCategories || [])
                    : await fetch(`/api/categories?page=${targetPageId}`).then(r => r.ok ? r.json() : []).catch(() => []);
                const emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = 'No category';
                bulkMoveCategorySelect.appendChild(emptyOpt);
                cats.forEach(cat => {
                    const opt = document.createElement('option');
                    opt.value = cat.id;
                    opt.textContent = cat.name;
                    bulkMoveCategorySelect.appendChild(opt);
                });
                bulkMoveCategorySelect.disabled = false;
            });
        }
        if (bulkMovePageBtn && bulkPageSelect) {
            bulkMovePageBtn.addEventListener('click', async () => {
                const targetPageId = Number(bulkPageSelect.value || 0);
                if (!targetPageId) {
                    this.ui.showNotification('Select a target page first.', 'info');
                    return;
                }
                const targetCategory = bulkMoveCategorySelect ? bulkMoveCategorySelect.value : '';
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

        const addFinderBtn = document.getElementById('add-finder-btn');
        if (addFinderBtn) addFinderBtn.addEventListener('click', () => this.addFinder());

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
                this.currentCategoriesPageId = pid;
                const categoriesSelector = document.getElementById('categories-page-selector');
                if (categoriesSelector) {
                    categoriesSelector.value = String(pid);
                }
                this.currentBookmarksSearch = '';
                const searchEl = document.getElementById('bookmarks-search');
                if (searchEl) searchEl.value = '';
                const clearEl = document.getElementById('bookmarks-search-clear');
                if (clearEl) clearEl.hidden = true;
                await this.loadPageBookmarks(e.target.value);
                await this.loadPageCategories(pid);
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
                this.refreshBookmarksList();
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
            categoriesPageSelector.addEventListener('change', (e) => {
                this.currentCategoriesPageId = parseInt(e.target.value);
                this.loadPageCategories(e.target.value);
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

    initThemeIconStylingControls() {
        const enableCheckbox = document.getElementById('theme-iconstyling-enable');
        const controls = document.getElementById('theme-iconstyling-controls');
        const styleSelect = document.getElementById('theme-iconstyling-style');
        const intensityRange = document.getElementById('theme-iconstyling-intensity');
        const preview = document.getElementById('theme-iconstyling-preview');
        if (!enableCheckbox || !controls || !styleSelect || !intensityRange || !preview) return;

        const theme = this.settingsData.theme || document.documentElement.getAttribute('data-theme') || 'default';
        const entry = (this.settingsData.themeIconStyling && this.settingsData.themeIconStyling[theme]) || { enabled: false, style: 'muted', intensity: 0.5 };

        enableCheckbox.checked = !!entry.enabled;
        styleSelect.value = entry.style || 'muted';
        intensityRange.value = String(entry.intensity || 0.5);
        controls.hidden = !enableCheckbox.checked;
        this.updateThemeIconStylingPreview(theme);

        enableCheckbox.addEventListener('change', async (e) => {
            const enabled = !!e.target.checked;
            controls.hidden = !enabled;
            this.settingsData.themeIconStyling = this.settingsData.themeIconStyling || {};
            this.settingsData.themeIconStyling[theme] = this.settingsData.themeIconStyling[theme] || { enabled: false, style: 'muted', intensity: 0.5 };
            this.settingsData.themeIconStyling[theme].enabled = enabled;
            await this.settings.saveSettingsToServer(this.settingsData);
            this.signalDashboardSettingsUpdated('settings-updated');
            this.updateThemeIconStylingPreview(theme);
        });

        styleSelect.addEventListener('change', async (e) => {
            const style = e.target.value;
            this.settingsData.themeIconStyling = this.settingsData.themeIconStyling || {};
            this.settingsData.themeIconStyling[theme] = this.settingsData.themeIconStyling[theme] || { enabled: false, style: 'muted', intensity: 0.5 };
            this.settingsData.themeIconStyling[theme].style = style;
            await this.settings.saveSettingsToServer(this.settingsData);
            this.signalDashboardSettingsUpdated('settings-updated');
            this.updateThemeIconStylingPreview(theme);
        });

        intensityRange.addEventListener('input', async (e) => {
            const intensity = parseFloat(e.target.value) || 0.5;
            this.settingsData.themeIconStyling = this.settingsData.themeIconStyling || {};
            this.settingsData.themeIconStyling[theme] = this.settingsData.themeIconStyling[theme] || { enabled: false, style: 'muted', intensity: 0.5 };
            this.settingsData.themeIconStyling[theme].intensity = intensity;
            this.updateThemeIconStylingPreview(theme);
        });

        intensityRange.addEventListener('change', async (e) => {
            const intensity = parseFloat(e.target.value) || 0.5;
            this.settingsData.themeIconStyling = this.settingsData.themeIconStyling || {};
            this.settingsData.themeIconStyling[theme] = this.settingsData.themeIconStyling[theme] || { enabled: false, style: 'muted', intensity: 0.5 };
            this.settingsData.themeIconStyling[theme].intensity = intensity;
            await this.settings.saveSettingsToServer(this.settingsData);
            this.signalDashboardSettingsUpdated('settings-updated');
        });
    }

    updateThemeIconStylingPreview(theme) {
        const preview = document.getElementById('theme-iconstyling-preview');
        const styleSelect = document.getElementById('theme-iconstyling-style');
        const intensityRange = document.getElementById('theme-iconstyling-intensity');
        if (!preview || !styleSelect || !intensityRange) return;
        const entry = (this.settingsData.themeIconStyling && this.settingsData.themeIconStyling[theme]) || { enabled: false, style: 'muted', intensity: 0.5 };
        const elems = Array.from(preview.querySelectorAll('.preview-icon'));
        elems.forEach((el) => {
            el.classList.remove('icon-themed', 'icon-themed--muted', 'icon-themed--tinted', 'icon-themed--overlay');
        });
        if (entry.enabled) {
            elems.forEach((el) => el.classList.add('icon-themed', `icon-themed--${entry.style || 'muted'}`));
            preview.style.setProperty('--icon-theme-intensity', String(entry.intensity || 0.5));
        } else {
            preview.style.removeProperty('--icon-theme-intensity');
        }
    }

    async updateHealthBadge() {
        const anchor = document.querySelector('header.header a[href="/health"]');
        if (!anchor) return;
        try {
            const response = await fetch('/api/bookmark-health');
            if (!response.ok) return;
            const data = await response.json();
            const summary = data?.summary || {};
            const broken = Number(summary.brokenCount || 0);
            const warn = Number(summary.duplicateCount || 0) + Number(summary.uncheckedCount || 0) + Number(summary.staleCount || 0);
            const existing = anchor.querySelector('.health-badge');
            if (existing) existing.remove();
            const brokenLabel = this.language?.t('dashboard.healthBrokenShort') || 'broken';
            const warnLabel = this.language?.t('dashboard.healthWarnShort') || 'warnings';
            const appendBadge = (count, type) => {
                const badge = document.createElement('span');
                const n = count > 99 ? '99+' : String(count);
                const isBroken = type === 'broken';
                badge.className = isBroken
                    ? 'health-badge health-badge--labeled'
                    : 'health-badge health-badge-warn health-badge--labeled';
                badge.textContent = `${n} ${isBroken ? brokenLabel : warnLabel}`;
                anchor.appendChild(badge);
            };
            if (broken > 0) {
                appendBadge(broken, 'broken');
            } else if (warn > 0) {
                appendBadge(warn, 'warn');
            }
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

    async confirmLeaveWithUnsavedChanges() {
        if (!this.isDirty) return true;
        if (!window.AppModal) {
            return window.confirm(this.language.t('config.unsavedChangesLeaveConfirm'));
        }

        const saveAndLeave = await window.AppModal.confirm({
            title: this.language.t('config.unsavedChangesTitle'),
            message: this.language.t('config.unsavedChangesSavePrompt'),
            confirmText: this.language.t('config.unsavedChangesSaveAndLeave'),
            cancelText: this.language.t('config.unsavedChangesMoreOptions')
        });
        if (saveAndLeave) {
            await this.saveChanges();
            return !this.isDirty;
        }

        return window.AppModal.danger({
            title: this.language.t('config.unsavedChangesLeaveTitle'),
            message: this.language.t('config.unsavedChangesLeaveMessage'),
            confirmText: this.language.t('config.unsavedChangesLeaveWithoutSaving'),
            cancelText: this.language.t('config.unsavedChangesStayHere')
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
                if (target.getAttribute('data-field') !== 'name') return;
                const row = target.closest('.category-item');
                const category = row ? row._categoryRef : null;
                if (!category) return;
                const categoryBeforeRename = category.originalId || category.id;
                const renameResult = this.applyCategoryRenameWithConflictGuard(category, target.value, categoryBeforeRename);
                if (!renameResult) {
                    return;
                }
                await this.persistCategoriesStructureAndRefresh({
                    persistBookmarks: true,
                    eventType: 'category-renamed',
                    categoryRenameMap: renameResult
                });
            });
        }
    }

    applyCategoryRenameWithConflictGuard(category, rawName, previousId) {
        const nextName = String(rawName || '').trim();
        const originalName = category.name || '';
        const currentId = category.id || '';
        const oldId = previousId || category.originalId || currentId;
        const normalizedNextName = nextName.toLowerCase();
        const hasDuplicate = this.categoriesData.some((item) => {
            if (item === category) return false;
            return String(item.name || '').trim().toLowerCase() === normalizedNextName;
        });

        if (!nextName || hasDuplicate) {
            const fallbackName = originalName || oldId || this.language.t('config.newCategoryPrefix');
            category.name = fallbackName;
            category.id = oldId;
            category.originalId = oldId;
            this.categories.render(this.categoriesData, this.generateId.bind(this));
            this.categories.initReorder(this.categoriesData, (newCategories) => {
                this.categoriesData = newCategories;
            });
            this.ui.showNotification('Category name must be unique and not empty.', 'error');
            return false;
        }

        category.name = nextName;
        category.id = oldId;
        category.originalId = oldId;
        return { oldId, newId: oldId };
    }

    reassignBookmarkCategoryIds(oldId, nextId) {
        if (!oldId || !nextId || oldId === nextId) {
            return;
        }
        this.bookmarksData.forEach((bookmark) => {
            if (bookmark.category === oldId) {
                bookmark.category = nextId;
            }
        });
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

    signalDashboardReload(eventType = 'structure-updated') {
        try {
            const payload = {
                type: eventType,
                sourceTabId: this.tabId,
                timestamp: Date.now()
            };
            localStorage.setItem(this.structureSyncEventKey, JSON.stringify(payload));
            sessionStorage.setItem('nextdash:pending-dashboard-structure-sync', JSON.stringify(payload));
        } catch (error) {
            // Keep config functional even if storage access is blocked.
        }
    }

    signalDashboardSettingsUpdated(eventType = 'settings-updated') {
        try {
            const payload = {
                type: eventType,
                sourceTabId: this.tabId,
                timestamp: Date.now()
            };
            localStorage.setItem(this.settingsSyncEventKey, JSON.stringify(payload));
            sessionStorage.setItem('nextdash:pending-dashboard-settings-sync', JSON.stringify(payload));
        } catch (error) {
            // Keep config functional even if storage access is blocked.
        }
    }

    showSyncToast(message, type = 'success') {
        if (this.settingsData?.showSyncToasts === false) {
            return;
        }
        const now = Date.now();
        if (now - this.lastSyncToastAt < 2000) {
            return;
        }
        this.lastSyncToastAt = now;
        this.ui.showNotification(message, type);
    }

    async persistPagesStructureAndRefresh(eventType = 'page-updated') {
        try {
            await this.withRetry(() => this.data.savePages(this.pagesData));
            await this.refreshStructureDependentUI();
            this.signalDashboardReload(eventType);
            this.showSyncToast('Dashboard sync complete.', 'success');
        } catch (error) {
            console.error('Error persisting page structure:', error);
            this.showSyncToast('Dashboard sync failed. Retry from config.', 'error');
        }
    }

    async persistCategoriesStructureAndRefresh(options = {}) {
        if (!this.currentCategoriesPageId) {
            return;
        }

        try {
            const categoriesForSelectedPage = this.getCategoriesFromDOM();
            if (categoriesForSelectedPage && categoriesForSelectedPage.length >= 0) {
                this.categoriesData = categoriesForSelectedPage;
                await this.withRetry(() => this.data.saveCategoriesByPage(categoriesForSelectedPage, this.currentCategoriesPageId));
            }

            if (options.persistBookmarks === true) {
                const renameMap = options.categoryRenameMap || null;
                const bookmarksSavePageId = this.getResolvedBookmarksPageId();
                if (Number(bookmarksSavePageId) === Number(this.currentCategoriesPageId)) {
                    if (renameMap && renameMap.oldId && renameMap.newId && renameMap.oldId !== renameMap.newId) {
                        this.reassignBookmarkCategoryIds(renameMap.oldId, renameMap.newId);
                    }
                    await this.saveBookmarksPage(bookmarksSavePageId, this.bookmarksData);
                } else {
                    const pageBookmarks = await this.withRetry(() => this.data.loadBookmarksByPage(this.currentCategoriesPageId));
                    let changed = false;
                    const categoryIdSet = new Set(this.categoriesData.map((category) => category.id));
                    const nextBookmarks = pageBookmarks.map((bookmark) => {
                        if (renameMap && bookmark.category === renameMap.oldId) {
                            changed = true;
                            return { ...bookmark, category: renameMap.newId };
                        }
                        if (bookmark.category && !categoryIdSet.has(bookmark.category)) {
                            changed = true;
                            return { ...bookmark, category: '' };
                        }
                        return bookmark;
                    });
                    if (changed) {
                        await this.saveBookmarksPage(this.currentCategoriesPageId, nextBookmarks);
                    }
                }
            }

            await this.refreshStructureDependentUI();
            this.signalDashboardReload(options.eventType || 'category-updated');
            this.showSyncToast('Dashboard sync complete.', 'success');
        } catch (error) {
            console.error('Error persisting category structure:', error);
            this.showSyncToast('Dashboard sync failed. Retry from config.', 'error');
        }
    }

    async refreshStructureDependentUI() {
        const previousPageId = Number(this.currentPageId) || 1;
        const previousCategoriesPageId = Number(this.currentCategoriesPageId) || previousPageId;
        const selectedPageExists = this.pagesData.some((page) => Number(page.id) === previousPageId);
        const selectedCategoriesPageExists = this.pagesData.some((page) => Number(page.id) === previousCategoriesPageId);

        this.currentPageId = selectedPageExists ? previousPageId : (this.pagesData[0]?.id || 1);
        this.currentCategoriesPageId = selectedCategoriesPageExists ? previousCategoriesPageId : this.currentPageId;

        await this.loadPageBookmarks(this.currentPageId);
        await this.loadPageCategories(this.currentCategoriesPageId);
        this.renderConfig();
        this.initReordering();
    }

    updateThemePreviewBadge(options = {}) {
        const badge = document.getElementById('theme-preview-badge');
        if (!badge) return;
        const current = String(this.settingsData?.theme || '');
        const persisted = String(this._persistedTheme || '');
        const pending = current !== persisted;
        const saving = options.saving === true;

        badge.hidden = !pending && !saving;
        badge.classList.toggle('is-visible', pending || saving);
        badge.classList.toggle('is-saving', saving);

        const hintKey = saving ? 'config.themePreviewSaving' : 'config.themePreviewSaveHint';
        const hintFallback = saving ? 'Saving theme…' : 'Preview — click Save to keep';
        const hint = this.language?.t(hintKey);
        badge.textContent = hint && hint !== hintKey ? hint : hintFallback;
    }

    async autosaveThemeSelection(theme) {
        if (theme) {
            this.settingsData.theme = theme;
        }
        const token = ++this._themeAutosaveToken;
        this.updateThemePreviewBadge({ saving: true });

        this.suppressDirtyTracking = true;
        this.settings.updateFromUI(this.settingsData);

        let ok = false;
        try {
            if (this.deviceSpecific) {
                this.storage.saveDeviceSettings(this.settingsData);
                ok = true;
            } else {
                ok = await this.settings.saveSettingsToServer(this.settingsData);
            }
        } catch {
            ok = false;
        }
        this.suppressDirtyTracking = false;

        if (token !== this._themeAutosaveToken) return;

        if (ok) {
            this._persistedTheme = String(this.settingsData.theme || '');
            this.updateThemePreviewBadge();
            this.flashSavedIndicator();
            const msg = this.language?.t('config.themeSaved');
            const text = msg && msg !== 'config.themeSaved' ? msg : 'Theme saved';
            if (window.AppNotification?.show) {
                window.AppNotification.show(text, 'success', { durationMs: 3000 });
            } else {
                this.ui.showNotification(text, 'success', { duration: 3000 });
            }
            this.signalDashboardSettingsUpdated('settings-autosave');
            return;
        }

        this.updateThemePreviewBadge();
        const errMsg = this.language?.t('config.themeSaveFailed');
        const errText = errMsg && errMsg !== 'config.themeSaveFailed'
            ? errMsg
            : 'Could not save theme — use Save to try again';
        if (window.AppNotification?.show) {
            window.AppNotification.show(errText, 'error', { durationMs: 5000 });
        } else {
            this.ui.showNotification(errText, 'error', { duration: 5000 });
        }
    }

    setupDirtyTracking() {
        const root = document.querySelector('.config-main');
        if (!root) {
            return;
        }
        const mark = () => {
            this.markDirty();
            this.validateBookmarkConflicts({ showToast: false });
        };
        const shouldIgnoreTarget = (target) => {
            if (!target || !target.id) return false;
            return target.id === 'page-selector' || target.id === 'categories-page-selector' || target.id === 'bookmarks-category-filter' || target.id === 'packed-columns-checkbox' || target.id === 'bookmarks-search' || target.id === 'theme-select';
        };
        root.addEventListener('input', (event) => {
            if (this.suppressDirtyTracking) return;
            if (event.target && event.target.closest('#app-notification')) return;
            if (shouldIgnoreTarget(event.target)) return;
            mark();
        });
        root.addEventListener('change', (event) => {
            if (this.suppressDirtyTracking) return;
            if (event.target && event.target.closest('#app-notification')) return;
            if (shouldIgnoreTarget(event.target)) return;
            mark();
        });
        window.addEventListener('beforeunload', (event) => {
            if (this.isNavigatingAway) return;
            if (!this.isDirty && !this.hasUnsavedColorChanges()) return;
            event.preventDefault();
            event.returnValue = '';
        });
        this.setDirtyState(false);
    }

    flashSavedIndicator() {
        const saveStatus = document.getElementById('save-status-indicator');
        if (!saveStatus) return;
        saveStatus.textContent = this.language?.t('config.allSaved') || 'All saved ✓';
        saveStatus.classList.remove('is-hidden', 'is-unsaved');
        saveStatus.classList.add('is-saved-flash');
        clearTimeout(this._savedFlashTimer);
        this._savedFlashTimer = setTimeout(() => {
            saveStatus.classList.remove('is-saved-flash');
            if (this.isDirty) {
                saveStatus.classList.add('is-hidden');
            } else {
                saveStatus.textContent = this.language?.t('config.savedShort') || 'Saved';
            }
        }, 1500);
    }

    setupAutosaveLowRiskFields() {
        const selector = [
            '#show-tips-checkbox',
            '#show-config-button-checkbox',
            '#show-health-dashboard-checkbox',
            '#show-recent-button-checkbox',
            '#animations-enabled-checkbox',
            '#include-finders-in-search-checkbox',
            '#interleave-mode-checkbox',
            '#global-shortcuts-checkbox',
            '#show-sync-toasts-checkbox'
        ].join(', ');
        let debounceTimer = null;
        document.querySelectorAll(selector).forEach((el) => {
            el.addEventListener('change', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(async () => {
                    if (!this.settings?.updateFromUI) return;
                    this.suppressDirtyTracking = true;
                    this.settings.updateFromUI(this.settingsData);
                    let ok = false;
                    if (this.deviceSpecific) {
                        this.storage.saveDeviceSettings(this.settingsData);
                        ok = true;
                    } else {
                        ok = await this.settings.saveSettingsToServer(this.settingsData);
                    }
                    this.suppressDirtyTracking = false;
                    if (ok) {
                        this.flashSavedIndicator();
                        this.signalDashboardSettingsUpdated('settings-autosave');
                    }
                }, 450);
            });
        });
    }

    setupStickySaveBar() {
        const sticky = document.getElementById('config-save-sticky');
        const saveSticky = document.getElementById('save-btn-sticky');
        const discardSticky = document.getElementById('discard-sticky-btn');
        saveSticky?.addEventListener('click', () => this.saveChanges());
        discardSticky?.addEventListener('click', () => this.discardChanges());
        if (!sticky) return;
        const onScroll = () => {
            sticky.classList.toggle('is-scroll-active', window.scrollY > 100 && this.isDirty);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        this._stickySaveScrollHandler = onScroll;
        onScroll();
    }

    setColorsDirtyState(isDirty) {
        this.colorsDirty = isDirty === true;
        document.body.classList.toggle('colors-is-dirty', this.colorsDirty);
        const colorsTab = document.querySelector('.tab-button[data-tab="colors"]');
        colorsTab?.classList.toggle('tab-has-unsaved', this.colorsDirty);
    }

    getSaveButtons() {
        return [
            document.getElementById('save-btn'),
            document.getElementById('save-btn-sticky'),
        ].filter(Boolean);
    }

    setDirtyState(isDirty) {
        this.isDirty = isDirty === true;
        const saveButtons = this.getSaveButtons();
        const badge = document.getElementById('unsaved-indicator');
        const saveStatus = document.getElementById('save-status-indicator');
        const undoTopBtn = document.getElementById('undo-top-btn');
        const discardTopBtn = document.getElementById('discard-top-btn');
        saveButtons.forEach((saveBtn) => {
            saveBtn.classList.toggle('has-unsaved', this.isDirty);
        });
        if (badge) {
            badge.classList.toggle('is-visible', this.isDirty);
        }
        if (saveStatus) {
            saveStatus.textContent = this.language?.t('config.savedShort') || 'Saved';
            saveStatus.classList.toggle('is-unsaved', this.isDirty);
            saveStatus.classList.toggle('is-hidden', this.isDirty);
        }
        if (undoTopBtn) {
            undoTopBtn.disabled = !this.undoSnapshot;
            undoTopBtn.classList.toggle('is-visible', !!this.undoSnapshot);
        }
        if (discardTopBtn) {
            discardTopBtn.disabled = !this.isDirty;
            discardTopBtn.classList.toggle('is-visible', this.isDirty);
        }
        document.body.classList.toggle('config-is-dirty', this.isDirty);
        if (this._stickySaveScrollHandler) {
            this._stickySaveScrollHandler();
        }
    }

    markDirty() {
        this.setDirtyState(true);
    }

    clearDirty() {
        this.setDirtyState(false);
    }

    captureUndoSnapshot() {
        return {
            bookmarksData: JSON.parse(JSON.stringify(this.bookmarksData || [])),
            categoriesData: JSON.parse(JSON.stringify(this.categoriesData || [])),
            findersData: JSON.parse(JSON.stringify(this.findersData || [])),
            settingsData: JSON.parse(JSON.stringify(this.settingsData || {})),
            pagesData: JSON.parse(JSON.stringify(this.pagesData || [])),
            currentPageId: this.currentPageId,
            currentCategoriesPageId: this.currentCategoriesPageId,
            currentBookmarksCategoryFilter: this.currentBookmarksCategoryFilter
        };
    }

    restoreUndoSnapshot(snapshot) {
        if (!snapshot) return;
        this.suppressDirtyTracking = true;
        this.bookmarksData = snapshot.bookmarksData;
        this.categoriesData = snapshot.categoriesData;
        this.findersData = snapshot.findersData;
        this.settingsData = snapshot.settingsData;
        this.pagesData = snapshot.pagesData;
        this.currentPageId = snapshot.currentPageId;
        this.currentCategoriesPageId = snapshot.currentCategoriesPageId;
        this.currentBookmarksCategoryFilter = snapshot.currentBookmarksCategoryFilter || '__all__';
        this.renderConfig();
        this.initReordering();
        this.refreshBookmarksFilterOptions();
        this.refreshBookmarksList();
        this.suppressDirtyTracking = false;
        this.markDirty();
    }

    showUndoNotification(message, snapshot = null) {
        const activeSnapshot = snapshot || this.captureUndoSnapshot();
        if (!activeSnapshot) return;
        this.undoSnapshot = activeSnapshot;
        this.setDirtyState(this.isDirty);
        this.ui.showNotification(message, 'warning', {
            actionLabel: 'Undo',
            durationMs: 8000,
            onAction: () => {
                this.restoreUndoSnapshot(this.undoSnapshot);
                this.undoSnapshot = null;
                this.setDirtyState(this.isDirty);
                this.ui.showNotification('Undone.', 'success');
            }
        });
    }

    setupGeneralCardCollapsible() {
        const storageKey = 'nextdash-config-general-panel-state';
        // Panels open by default; everything else starts collapsed.
        const DEFAULT_OPEN_ESSENTIALS = new Set(['localization', 'basics-core', 'layout', 'status-essentials-summary']);
        const DEFAULT_OPEN_ADVANCED = new Set([]);
        const layer = this.generalLayers?.layer || 'essentials';
        const DEFAULT_OPEN = layer === 'advanced'
            ? DEFAULT_OPEN_ADVANCED
            : layer === 'all'
                ? new Set([...DEFAULT_OPEN_ESSENTIALS, ...DEFAULT_OPEN_ADVANCED])
                : DEFAULT_OPEN_ESSENTIALS;

        let saved = null;
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    saved = parsed;
                }
            }
        } catch {
            saved = null;
        }

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
            const panelId = card.getAttribute('data-general-panel');
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
            title.addEventListener('click', () => {
                card.classList.toggle('is-collapsed');
                if (card.getAttribute('data-general-panel')) persistState();
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

    async discardChanges() {
        if (!this.isDirty) {
            return;
        }
        const confirmed = await window.AppModal.danger({
            title: 'Discard unsaved changes',
            message: 'Revert all unsaved changes from this session?',
            confirmText: 'Discard',
            cancelText: 'Cancel'
        });
        if (!confirmed) {
            return;
        }
        window.location.reload();
    }

    setupCascadingCheckboxes() {
        // Define parent-child relationships for checkboxes
        const cascadingPairs = [
            { parent: 'show-status-checkbox', children: ['show-ping-checkbox', 'show-status-loading-checkbox', 'skip-fast-ping-checkbox'] },
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
            if (!catMatched && categoriesSelector.options.length > 0) {
                categoriesSelector.options[0].selected = true;
                this.currentCategoriesPageId = Number(categoriesSelector.options[0].value);
            }
            if (categoriesSelector.__customSelectInstance) {
                categoriesSelector.__customSelectInstance.refresh();
            }
        }

        this.refreshBookmarksFilterOptions();
        this.refreshBookmarksList();
        this.renderStructureWorkspace();
        this.finders.render(this.findersData);
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
        this.pages.initReorder(this.pagesData, (newPages) => {
            this.pagesData = newPages;
            this.pages.renderPageSelector(this.getVisiblePages(), this.currentPageId);
        });

        this.categories.initReorder(this.categoriesData, (newCategories) => {
            this.categoriesData = newCategories;
        });

        this.refreshBookmarksList();

        this.finders.initReorder(this.findersData, (newFinders) => {
            this.findersData = newFinders;
        });
    }

    async addPage(options = {}) {
        let pageName = (options.pageName || '').trim();
        let templateId = options.templateId || 'blank';
        if (!options.skipPrompt) {
            const details = await this.promptNewPageDetails();
            if (!details) return;
            pageName = details.pageName;
            templateId = details.templateId;
        }
        const newPage = this.pages.add(this.pagesData, this.generateId.bind(this));
        if (pageName) {
            newPage.name = pageName;
        }
        const template = this.getPageTemplateDefinition(templateId);
        const defaultCategories = template.categories;
        try {
            await this.data.saveCategoriesByPage(defaultCategories, newPage.id);
            await this.saveBookmarksPage(newPage.id, template.bookmarks);
        } catch (error) {
            console.error('Error creating new page:', error);
        }
        
        this.pages.render(this.pagesData, this.generateId.bind(this), this.isPageArchived.bind(this));
        this.pages.renderPageSelector(this.pagesData, newPage.id);
        this.pages.initReorder(this.pagesData, (newPages) => {
            this.pagesData = newPages;
            this.pages.renderPageSelector(this.pagesData, this.currentPageId);
        });

        const pageSelector = document.getElementById('page-selector');
        if (pageSelector) {
            pageSelector.value = String(newPage.id);
            this.currentPageId = newPage.id;
            this.loadPageBookmarks(newPage.id);
        }

        const categoriesSelector = document.getElementById('categories-page-selector');
        if (categoriesSelector) {
            categoriesSelector.innerHTML = '';
            this.getVisiblePages().forEach(page => {
                const option = document.createElement('option');
                option.value = page.id;
                option.textContent = page.name;
                if (Number(page.id) === Number(newPage.id)) option.selected = true;
                categoriesSelector.appendChild(option);
            });
            if (categoriesSelector.__customSelectInstance) {
                categoriesSelector.__customSelectInstance.refresh();
            }
            this.currentCategoriesPageId = newPage.id;
            this.loadPageCategories(newPage.id);
        }

        await this.persistPagesStructureAndRefresh('page-added');
        this.renderStructureWorkspace();
    }

    async addCategory() {
        if (!this.categoriesData) this.categoriesData = [];
        
        this.categories.add(this.categoriesData, this.generateId.bind(this));
        this.categories.render(this.categoriesData, this.generateId.bind(this));
        this.categories.initReorder(this.categoriesData, (newCategories) => {
            this.categoriesData = newCategories;
        });
        this.markDirty();
        await this.persistCategoriesStructureAndRefresh({ eventType: 'category-added' });
        this.renderStructureWorkspace();
    }

    addBookmark() {
        const filterValue = this.currentBookmarksCategoryFilter || '__all__';
        const preferredCategory = (filterValue !== '__all__' && filterValue !== '__none__') ? filterValue : '';
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

    addFinder() {
        this.finders.add(this.findersData);
        this.finders.render(this.findersData);
        this.finders.initReorder(this.findersData, (newFinders) => {
            this.findersData = newFinders;
        });
        this.markDirty();
    }

    async removePage(index) {
        const page = this.pagesData[index];
        if (!page) return;
        
        if (page.id === 1) {
            this.ui.showNotification(this.language.t('config.cannotRemoveMainPage'), 'error');
            return;
        }
        
        let pageBookmarks = [], pageCategories = [];
        try {
            [pageBookmarks, pageCategories] = await Promise.all([
                this.data.loadBookmarksByPage(page.id),
                this.data.loadCategoriesByPage(page.id),
            ]);
        } catch (e) { /* ignore — show modal with 0 counts */ }
        pageBookmarks = Array.isArray(pageBookmarks) ? pageBookmarks : [];
        pageCategories = Array.isArray(pageCategories) ? pageCategories : [];
        const confirmed = await window.AppModal.danger({
            title: this.language.t('config.removePageTitle'),
            message: `${this.language.t('config.removePageMessage').replace('{pageName}', page.name)}\n\nImpact: ${pageCategories.length} categories, ${pageBookmarks.length} bookmarks.`,
            confirmText: this.language.t('config.remove'),
            cancelText: this.language.t('config.cancel')
        });
        
        if (!confirmed) return;
        
        try {
            await this.data.deletePage(page.id);
            
            this.pagesData.splice(index, 1);
            
            const origIndex = this.originalPagesData.findIndex(p => p.id === page.id);
            if (origIndex !== -1) {
                this.originalPagesData.splice(origIndex, 1);
            }
            
            this.pages.render(this.pagesData, this.generateId.bind(this), this.isPageArchived.bind(this));
            this.pages.renderPageSelector(this.getVisiblePages(), 1);
            this.pages.initReorder(this.pagesData, (newPages) => {
                this.pagesData = newPages;
                this.pages.renderPageSelector(this.pagesData, this.currentPageId);
            });
            
            this.currentPageId = 1;
            this.currentCategoriesPageId = 1;
            await this.loadPageBookmarks(1);
            await this.loadPageCategories(1);
            
            const pageSelector = document.getElementById('page-selector');
            if (pageSelector) pageSelector.value = '1';
            
            const categoriesSelector = document.getElementById('categories-page-selector');
            if (categoriesSelector) {
                categoriesSelector.innerHTML = '';
                this.getVisiblePages().forEach(p => {
                    const option = document.createElement('option');
                    option.value = p.id;
                    option.textContent = p.name;
                    if (Number(p.id) === 1) option.selected = true;
                    categoriesSelector.appendChild(option);
                });
                if (categoriesSelector.__customSelectInstance) {
                    categoriesSelector.__customSelectInstance.refresh();
                }
            }
            await this.persistPagesStructureAndRefresh('page-removed');
            this.renderStructureWorkspace();
            this.ui.showNotification(this.language.t('config.pageDeleted'), 'success');
        } catch (error) {
            console.error('Error deleting page:', error);
            this.ui.showNotification(this.language.t('config.errorDeletingPage'), 'error');
        }
    }

    async removeCategory(index) {
        const category = this.categoriesData[index];
        if (!category) return;
        const impactedBookmarks = Number(this.currentPageId) === Number(this.currentCategoriesPageId)
            ? this.bookmarksData.filter((bookmark) => bookmark.category === category.id)
            : 0;
        let deleteMode = 'uncategorize';
        let moveTargetId = '';
        if (impactedBookmarks.length > 0) {
            const flow = await this.resolveCategoryDeleteFlow(category, impactedBookmarks.length);
            if (!flow || flow.action === 'cancel') {
                return;
            }
            deleteMode = flow.action;
            moveTargetId = flow.targetCategoryId || '';
        }
        
        const undoSnapshot = this.captureUndoSnapshot();
        const removed = await this.categories.remove(this.categoriesData, index, {
            message: this.language.t('config.removeCategoryMessage')
        });
        if (removed) {
            if (Number(this.currentPageId) === Number(this.currentCategoriesPageId)) {
                if (deleteMode === 'move' && moveTargetId) {
                    this.bookmarksData.forEach((bookmark) => {
                        if (bookmark.category === category.id) {
                            bookmark.category = moveTargetId;
                        }
                    });
                } else if (deleteMode === 'delete') {
                    this.bookmarksData = this.bookmarksData.filter((bookmark) => bookmark.category !== category.id);
                } else {
                    this.bookmarksData.forEach((bookmark) => {
                        if (bookmark.category === category.id) {
                            bookmark.category = '';
                        }
                    });
                }
            }
            
            this.categories.render(this.categoriesData, this.generateId.bind(this));
            this.categories.initReorder(this.categoriesData, (newCategories) => {
                this.categoriesData = newCategories;
            });
            this.showUndoNotification('Category removed.', undoSnapshot);
            this.markDirty();
            await this.persistCategoriesStructureAndRefresh({ persistBookmarks: true, eventType: 'category-removed' });
            this.renderStructureWorkspace();
        }
    }

    async resolveCategoryDeleteFlow(category, impactedCount) {
        const alternativeCategories = this.categoriesData.filter((item) => item.id !== category.id);
        if (alternativeCategories.length === 0) {
            const confirmed = await window.AppModal.confirm({
                title: this.language.t('config.deleteCategoryTitleShort') || 'Delete category',
                message: (this.language.t('config.deleteCategoryImpact') || '{count} bookmarks to uncategorized.').replace('{count}', String(impactedCount)),
                confirmText: this.language.t('config.continue') || 'Continue',
                cancelText: this.language.t('config.cancel')
            });
            return confirmed ? { action: 'uncategorize' } : { action: 'cancel' };
        }

        const optionsHtml = this._categorySelectOptionsHtml(alternativeCategories);
        const html = `
            <p>${(this.language.t('config.categoryDeleteInUse') || '{count} bookmarks in').replace('{count}', String(impactedCount))} <strong>${this._escHtml(category.name)}</strong>.</p>
            <p>${this.language.t('config.categoryDeleteChoose') || 'Choose action before delete:'}</p>
            <select id="category-delete-target-select" class="page-selector" style="max-width:100%;">
                ${optionsHtml}
            </select>
            <div style="display:flex; gap:0.5rem; margin-top:0.75rem; flex-wrap:wrap;">
                <button class="btn btn-primary btn-small" onclick="window.tempCategoryDeleteAction('move')">${this.language.t('config.moveToSelected') || 'Move selected'}</button>
                <button class="btn btn-secondary btn-small" onclick="window.tempCategoryDeleteAction('uncategorize')">${this.language.t('config.setUncategorized') || 'Set uncategorized'}</button>
                <button class="btn btn-danger btn-small" onclick="window.tempCategoryDeleteAction('delete')">${this.language.t('config.deleteBookmarksToo') || 'Delete bookmarks'}</button>
            </div>
        `;

        return new Promise((resolve) => {
            window.tempCategoryDeleteAction = (action) => {
                const selectEl = document.getElementById('category-delete-target-select');
                const targetCategoryId = selectEl ? selectEl.value : '';
                delete window.tempCategoryDeleteAction;
                window.AppModal.hide();
                resolve({ action, targetCategoryId });
            };
            window.AppModal.show({
                title: this.language.t('config.deleteCategoryTitleShort') || 'Delete category',
                htmlMessage: html,
                confirmText: this.language.t('config.cancel'),
                showCancel: false,
                onConfirm: () => {
                    delete window.tempCategoryDeleteAction;
                    resolve({ action: 'cancel' });
                }
            });
        });
    }

    async mergeCategory(index) {
        const sourceCategory = this.categoriesData[index];
        if (!sourceCategory) return;
        const targetCategories = this.categoriesData.filter((item) => item.id !== sourceCategory.id);
        if (targetCategories.length === 0) {
            this.ui.showNotification(this.language.t('config.mergeNeedSecondCategory') || 'Need second category.', 'info');
            return;
        }

        const optionsHtml = this._categorySelectOptionsHtml(targetCategories);
        const html = `
            <p>${this.language.t('config.mergeIntoLabel') || 'Merge into'} <strong>${this._escHtml(sourceCategory.name)}</strong>:</p>
            <select id="merge-category-target-select" class="page-selector" style="max-width:100%;">
                ${optionsHtml}
            </select>
        `;
        const confirmed = await window.AppModal.confirm({
            title: this.language.t('config.mergeCategoryTitleShort') || 'Merge category',
            htmlMessage: html,
            confirmText: this.language.t('config.merge') || 'Merge',
            cancelText: this.language.t('config.cancel')
        });
        if (!confirmed) return;

        const targetSelect = document.getElementById('merge-category-target-select');
        const targetId = targetSelect ? targetSelect.value : '';
        if (!targetId) return;

        const targetCategory = this.categoriesData.find((item) => item.id === targetId);
        if (!targetCategory) return;

        const undoSnapshot = this.captureUndoSnapshot();
        if (Number(this.currentPageId) === Number(this.currentCategoriesPageId)) {
            this.bookmarksData.forEach((bookmark) => {
                if (bookmark.category === sourceCategory.id) {
                    bookmark.category = targetId;
                }
            });
        }
        this.categoriesData.splice(index, 1);
        this.categories.render(this.categoriesData, this.generateId.bind(this));
        this.categories.initReorder(this.categoriesData, (newCategories) => {
            this.categoriesData = newCategories;
        });
        const mergedText = (this.language.t('config.categoryMergedInto') || 'Merged into {name}.').replace('{name}', targetCategory.name);
        this.showUndoNotification(mergedText, undoSnapshot);
        this.markDirty();
        await this.persistCategoriesStructureAndRefresh({ persistBookmarks: true, eventType: 'category-merged' });
        this.renderStructureWorkspace();
    }

    async removeBookmark(index) {
        const undoSnapshot = this.captureUndoSnapshot();
        const removed = await this.bookmarks.remove(this.bookmarksData, index);
        if (removed) {
            if (this.bookmarks.activeDetailIndex === index) {
                this.bookmarks.activeDetailIndex = null;
                const formEl = document.getElementById('bookmark-detail-form');
                const emptyEl = document.getElementById('bookmark-detail-empty');
                if (formEl) formEl.setAttribute('hidden', '');
                if (emptyEl) emptyEl.style.display = '';
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

    async removeFinder(index) {
        const undoSnapshot = this.captureUndoSnapshot();
        const removed = await this.finders.remove(this.findersData, index);
        if (removed) {
            this.finders.render(this.findersData);
            this.finders.initReorder(this.findersData, (newFinders) => {
                this.findersData = newFinders;
            });
            this.showUndoNotification('Finder removed.', undoSnapshot);
            this.markDirty();
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
            if (!catMatched && catSel.options.length > 0) {
                catSel.options[0].selected = true;
                this.currentCategoriesPageId = Number(catSel.options[0].value);
            }
            if (catSel.__customSelectInstance) {
                catSel.__customSelectInstance.refresh();
            }
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

        const bulkCategorySelect = document.getElementById('bulk-category-select');
        if (bulkCategorySelect) {
            bulkCategorySelect.innerHTML = '';
            const emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = this.language.t('config.moveCategoryShort') || 'move category';
            bulkCategorySelect.appendChild(emptyOption);
            options.slice(4).forEach((optionData) => {
                const option = document.createElement('option');
                option.value = optionData.value;
                option.textContent = optionData.label;
                bulkCategorySelect.appendChild(option);
            });
        }

        const bulkPageSelect = document.getElementById('bulk-page-select');
        if (bulkPageSelect) {
            const currentPageId = Number(this.currentPageId) || 1;
            bulkPageSelect.innerHTML = '';

            const emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = this.language.t('config.movePageShort') || 'move page';
            bulkPageSelect.appendChild(emptyOption);

            this.getVisiblePages().forEach((page) => {
                const option = document.createElement('option');
                option.value = String(page.id);
                option.textContent = Number(page.id) === currentPageId ? `${page.name} (current)` : page.name;
                if (Number(page.id) === currentPageId) {
                    option.disabled = true;
                }
                bulkPageSelect.appendChild(option);
            });
        }
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
                this.currentPageId = Number(page.id);
                this.currentCategoriesPageId = Number(page.id);
                const pageSelector = document.getElementById('page-selector');
                if (pageSelector) pageSelector.value = String(page.id);
                const categoriesSelector = document.getElementById('categories-page-selector');
                if (categoriesSelector) categoriesSelector.value = String(page.id);
                await this.loadPageBookmarks(page.id);
                await this.loadPageCategories(page.id);
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

    getArchivedPageIds() {
        return Array.isArray(this.settingsData.archivedPageIds) ? this.settingsData.archivedPageIds.map(Number) : [];
    }

    isPageArchived(pageId) {
        return this.getArchivedPageIds().includes(Number(pageId));
    }

    getVisiblePages() {
        return this.pagesData.filter((page) => !this.isPageArchived(page.id));
    }

    async archivePage(index) {
        const page = this.pagesData[index];
        if (!page || Number(page.id) === 1) {
            return;
        }
        if (this.isPageArchived(page.id)) {
            this.ui.showNotification(this.language.t('config.pageAlreadyArchived') || 'Already archived.', 'info');
            return;
        }
        const archived = this.getArchivedPageIds();
        archived.push(Number(page.id));
        this.settingsData.archivedPageIds = Array.from(new Set(archived));
        await this.settings.saveSettingsToServer(this.settingsData);
        if (Number(this.currentPageId) === Number(page.id)) {
            const fallback = this.getVisiblePages()[0];
            if (fallback) {
                this.currentPageId = Number(fallback.id);
                this.currentCategoriesPageId = Number(fallback.id);
                await this.loadPageBookmarks(this.currentPageId);
                await this.loadPageCategories(this.currentCategoriesPageId);
            }
        }
        this.renderConfig();
        this.ui.showNotification(this.language.t('config.pageArchived') || 'Page archived.', 'success');
    }

    async restoreArchivedPage(pageId) {
        const targetId = Number(pageId);
        this.settingsData.archivedPageIds = this.getArchivedPageIds().filter((id) => id !== targetId);
        await this.settings.saveSettingsToServer(this.settingsData);
        if (Number(this.currentPageId) === targetId || Number(this.currentCategoriesPageId) === targetId) {
            await this.loadPageBookmarks(targetId);
            await this.loadPageCategories(targetId);
        }
        this.renderConfig();
        this.ui.showNotification(this.language.t('config.pageRestored') || 'Page restored.', 'success');
    }

    getPageTemplateDefinition(templateId) {
        if (templateId === 'work') {
            return {
                categories: [
                    { id: 'planning', name: 'Planning' },
                    { id: 'build', name: 'Build' },
                    { id: 'docs', name: 'Docs' }
                ],
                bookmarks: []
            };
        }
        if (templateId === 'personal') {
            return {
                categories: [
                    { id: 'daily', name: 'Daily' },
                    { id: 'finance', name: 'Finance' },
                    { id: 'media', name: 'Media' }
                ],
                bookmarks: []
            };
        }
        if (templateId === 'learn') {
            return {
                categories: [
                    { id: 'courses', name: 'Courses' },
                    { id: 'references', name: 'References' },
                    { id: 'practice', name: 'Practice' }
                ],
                bookmarks: []
            };
        }
        return {
            categories: [{ id: 'others', name: this.language.t('dashboard.others') }],
            bookmarks: []
        };
    }

    async promptNewPageDetails() {
        const html = `
            <label class="structure-inline-label" for="new-page-name-input">${this.language.t('config.pageNameLabelShort') || 'Page name'}</label>
            <input id="new-page-name-input" type="text" class="page-selector" style="max-width:100%;" placeholder="${this.language.t('config.newPagePlaceholder') || 'New page'}">
            <label class="structure-inline-label" for="new-page-template-select">${this.language.t('config.template') || 'Template'}</label>
            <select id="new-page-template-select" class="page-selector" style="max-width:100%;">
                <option value="blank">${this.language.t('config.templateBlank') || 'Blank'}</option>
                <option value="work">${this.language.t('config.templateWork') || 'Work'}</option>
                <option value="personal">${this.language.t('config.templatePersonal') || 'Personal'}</option>
                <option value="learn">${this.language.t('config.templateLearn') || 'Learn'}</option>
            </select>
        `;
        const confirmed = await window.AppModal.confirm({
            title: this.language.t('config.createPageTitle') || 'Create page',
            htmlMessage: html,
            confirmText: this.language.t('config.create') || 'Create',
            cancelText: this.language.t('config.cancel')
        });
        if (!confirmed) return null;
        const nameInput = document.getElementById('new-page-name-input');
        const templateSelect = document.getElementById('new-page-template-select');
        return {
            pageName: nameInput ? nameInput.value.trim() : '',
            templateId: templateSelect ? templateSelect.value : 'blank'
        };
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
            this.ensurePagesTabActive();
            await this.addPage();
            return;
        }
        if (command === 'add-category') {
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

    getCategoriesFromDOM() {
        const categoriesList = document.getElementById('categories-list');
        if (!categoriesList) return null;

        const categoryItems = categoriesList.querySelectorAll('.category-item');
        const categories = [];

        categoryItems.forEach((item) => {
            const category = item._categoryRef;
            if (category) categories.push(category);
        });

        return categories;
    }

    bookmarksReferenceCategories(bookmarks) {
        if (!Array.isArray(bookmarks)) return false;
        return bookmarks.some((bookmark) => String(bookmark?.category || '').trim() !== '');
    }

    rebuildCategoriesFromBookmarkRefs(bookmarks) {
        if (!Array.isArray(bookmarks)) return [];
        const ids = [];
        const seen = new Set();
        bookmarks.forEach((bookmark) => {
            const id = String(bookmark?.category || '').trim();
            if (!id || seen.has(id)) return;
            seen.add(id);
            ids.push(id);
        });
        return ids.map((id) => ({
            id,
            originalId: id,
            name: this.formatRecoveredCategoryName(id),
            icon: ''
        }));
    }

    formatRecoveredCategoryName(categoryId) {
        const slug = String(categoryId || '').trim();
        if (!slug) return 'Category';
        if (slug.startsWith('cat_')) {
            return slug.slice(4).replace(/_/g, ' ') || slug;
        }
        return slug.replace(/-/g, ' ').replace(/_/g, ' ');
    }

    async getBookmarksForPage(pageId) {
        const pid = parseInt(pageId, 10);
        if (Number(pid) === Number(this.currentPageId)) {
            return this.bookmarksData;
        }
        return this.data.loadBookmarksByPage(pid);
    }

    async resolveCategoriesForSave(pageId) {
        const pid = parseInt(pageId, 10);
        if (!Number.isFinite(pid) || pid < 1) return null;

        const fromDom = this.getCategoriesFromDOM();
        const domMatchesPage = Number(this.currentCategoriesPageId) === pid;
        let categories = null;

        if (domMatchesPage && Array.isArray(fromDom) && fromDom.length > 0) {
            categories = fromDom.map((cat) => ({ ...cat }));
        } else if (domMatchesPage && Array.isArray(this.categoriesData) && this.categoriesData.length > 0) {
            categories = this.categoriesData.map((cat) => ({ ...cat }));
        } else if (domMatchesPage && this.categoriesListHydrated && Array.isArray(fromDom) && fromDom.length === 0) {
            categories = [];
        } else {
            return null;
        }

        if (categories.length === 0) {
            const bookmarks = await this.getBookmarksForPage(pid);
            if (this.bookmarksReferenceCategories(bookmarks)) {
                return null;
            }
        }

        return categories;
    }

    generateStableCategoryId() {
        return `cat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    }

    ensureStableCategoryIds(categories) {
        const idMap = new Map();
        if (!Array.isArray(categories)) {
            return idMap;
        }
        const usedIds = new Set();
        categories.forEach((category, index) => {
            if (!category) return;
            const previousId = String(category.id || '').trim();
            let stableId = previousId;
            if (!stableId || usedIds.has(stableId)) {
                stableId = this.generateStableCategoryId();
                while (usedIds.has(stableId)) {
                    stableId = this.generateStableCategoryId();
                }
            }
            usedIds.add(stableId);
            category.id = stableId;
            category.originalId = stableId;

            if (previousId && previousId !== stableId) {
                idMap.set(previousId, stableId);
            }
            if (!previousId) {
                const legacySlug = this.generateId(category.name || `category-${index + 1}`);
                if (legacySlug && legacySlug !== stableId && !idMap.has(legacySlug)) {
                    idMap.set(legacySlug, stableId);
                }
            }
        });
        return idMap;
    }

    reassignBookmarkCategoriesFromMap(idMap, bookmarks) {
        if (!(idMap instanceof Map) || idMap.size === 0 || !Array.isArray(bookmarks)) {
            return;
        }
        bookmarks.forEach((bookmark) => {
            const currentCategory = String(bookmark?.category || '').trim();
            if (currentCategory && idMap.has(currentCategory)) {
                bookmark.category = idMap.get(currentCategory);
            }
        });
    }

    _configT(key, fallback) {
        const value = this.language?.t(key);
        return value && value !== key ? value : fallback;
    }

    goToDashboard() {
        window.location.href = '/';
    }

    buildConfigSaveFeedback(duplicateUrls = []) {
        const hasDuplicates = Array.isArray(duplicateUrls) && duplicateUrls.length > 0;
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

    async saveChanges() {
        const conflicts = this.validateBookmarkConflicts({ showToast: true });
        if (conflicts.hasConflicts) {
            return;
        }
        const saveStatus = document.getElementById('save-status-indicator');
        if (saveStatus) {
            saveStatus.textContent = this.language?.t('config.savingChanges') || 'Saving changes...';
            saveStatus.classList.remove('is-unsaved');
        }
        this.ui.showNotification(this.language.t('config.savingChanges'), 'info');

        try {
            this.settings.updateFromUI(this.settingsData);

            const saveBookmarksPageId = this.getResolvedBookmarksPageId();
            this.currentPageId = saveBookmarksPageId;

            if (Number.isFinite(saveBookmarksPageId) && saveBookmarksPageId >= 1) {
                this.settingsData.currentPage = saveBookmarksPageId;
            }

            const duplicateUrls = this.findDuplicateBookmarkUrls(this.bookmarksData);

            await this.saveAllBookmarkPages();
            await this.data.saveFinders(this.findersData);
            
            if (this.currentCategoriesPageId) {
                const categoriesForSelectedPage = await this.resolveCategoriesForSave(this.currentCategoriesPageId);
                if (categoriesForSelectedPage !== null) {
                    await this.data.saveCategoriesByPage(categoriesForSelectedPage, this.currentCategoriesPageId);
                }
            }
            
            await this.data.savePages(this.pagesData);
            
            // Merge keyboard custom bindings into settings
            if (this.keyboard && typeof this.keyboard.getSaveData === 'function') {
                const keyboardData = this.keyboard.getSaveData();
                this.settingsData.customKeyBindings = keyboardData.customKeyBindings;
            }
            
            if (this.deviceSpecific) {
                this.storage.saveDeviceSettings(this.settingsData);
            } else {
                await this.data.saveSettings(this.settingsData);
                this.storage.clearDeviceSettings();
            }

            this.originalPagesData = JSON.parse(JSON.stringify(this.pagesData));
            this.refreshPageDropdowns();
            this.signalDashboardSettingsUpdated('settings-saved');
            const saveFeedback = this.buildConfigSaveFeedback(duplicateUrls);
            this.ui.showNotification(saveFeedback.message, saveFeedback.type, saveFeedback.options);
            this.clearDirty();
            this.flashSavedIndicator();
            this.undoSnapshot = null;
            this.savedSnapshot = this.captureUndoSnapshot();
            this._persistedTheme = String(this.settingsData.theme || '');
            this.updateThemePreviewBadge();
            this.setDirtyState(false);
            if (typeof this._persistGeneralPanelState === 'function') {
                this._persistGeneralPanelState();
            }
            this.refreshSmartCollectionCounters();
            try {
                await this.bookmarkStore.loadAll();
            } catch (error) {
                // keep previous store state
            }
            this.settings?.refreshStatusEssentialsSummary?.(this.settingsData, this.allBookmarksData);
            if (this.stats && window.location.hash === '#stats') {
                this.stats.refresh(this);
            }
        } catch (error) {
            console.error('Error saving configuration:', error);
            if (saveStatus) {
                saveStatus.textContent = 'Save failed';
                saveStatus.classList.add('is-unsaved');
            }
            const message = String(error?.message || '');
            if (message.toLowerCase().includes('duplicate shortcut')) {
                this.ui.showNotification(message, 'error');
            } else {
                this.ui.showNotification(this.language.t('config.errorSavingConfig'), 'error');
            }
        }
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
            message: tx('config.resetAllDataMessage', 'This will permanently delete all pages, categories, bookmarks, finders, and settings. This action cannot be undone.'),
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

    _escHtml(str) {
        return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    _categorySelectOptionsHtml(categories) {
        return categories
            .map((item) => `<option value="${this._escHtml(item.id)}">${this._escHtml(item.name)}</option>`)
            .join('');
    }

    generateId(text) {
        return text.toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    normalizePagesData(pages) {
        const raw = Array.isArray(pages) ? pages : [];
        const list = raw
            .filter((page) => page && Number.isFinite(Number(page.id)) && Number(page.id) >= 1)
            .map((page) => ({
                ...page,
                id: Number(page.id),
                name: String(page.name || '').trim(),
            }));
        let repaired = false;

        if (!list.some((page) => page.id === 1)) {
            list.unshift({ id: 1, name: 'main' });
            repaired = true;
        }
        if (list.length === 0) {
            return { pages: [{ id: 1, name: 'main' }], repaired: true };
        }

        list.forEach((page) => {
            if (!page.name) {
                page.name = page.id === 1 ? 'main' : `Page ${page.id}`;
                repaired = true;
            }
        });

        if (raw.length === 0 || raw.length !== list.length) {
            repaired = true;
        }
        return { pages: list, repaired };
    }

    applyPagesNormalization(pages, options = {}) {
        const { pages: normalized, repaired } = this.normalizePagesData(pages);
        if (options.trackRepair && repaired) {
            this._pagesRepairedOnLoad = true;
        }
        return normalized;
    }

    renderPagesTab() {
        this.pagesData = this.applyPagesNormalization(this.pagesData);
        this.pages.render(this.pagesData, this.generateId.bind(this), this.isPageArchived.bind(this));
        this.pages.initReorder(this.pagesData, (newPages) => {
            this.pagesData = newPages;
            this.pages.renderPageSelector(this.getVisiblePages(), this.currentPageId);
        });
    }

    async reloadPagesFromServerIfNeeded() {
        if (!this._pagesRepairedOnLoad) {
            return;
        }
        try {
            const response = await fetch('/api/pages');
            if (!response.ok) {
                return;
            }
            const pages = await response.json();
            this.pagesData = this.applyPagesNormalization(pages);
            this.originalPagesData = JSON.parse(JSON.stringify(this.pagesData));
            this._pagesRepairedOnLoad = false;
        } catch (error) {
            console.warn('Failed to reload pages after repair:', error);
        }
    }

    async persistRepairedPagesIfNeeded() {
        if (!this._pagesRepairedOnLoad) {
            return;
        }
        try {
            await this.withRetry(() => this.data.savePages(this.pagesData));
            this.originalPagesData = JSON.parse(JSON.stringify(this.pagesData));
            this.signalDashboardReload('pages-repaired');
            // Keep flag until reloadPagesFromServerIfNeeded confirms sync
        } catch (error) {
            console.warn('Auto-persist of default page structure failed:', error);
        }
    }

    resolvePageId(rawPageId, pages) {
        const candidates = Array.isArray(pages) ? pages : [];
        const parsed = Number(rawPageId);
        if (
            Number.isFinite(parsed) &&
            parsed >= 1 &&
            candidates.some((page) => Number(page.id) === parsed)
        ) {
            return parsed;
        }
        if (candidates.length > 0) {
            return Number(candidates[0].id);
        }
        return 1;
    }
}

let configManager;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { configManager = new ConfigManager(); window.configManager = configManager; });
} else {
    configManager = new ConfigManager();
    window.configManager = configManager;
}
