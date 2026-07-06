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
        this.bookmarksController = new ConfigBookmarksController(this);
        this.bookmarksController.installPublicMethods();
        this.renderController = new ConfigRenderController(this);
        this.renderController.installPublicMethods();
        this.resetController = new ConfigResetController(this);
        this.resetController.installPublicMethods();
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
            showStatusLoading: false,
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
            categorySortModesMigrated: true,
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
        this.applyStructureWorkspacePersistedState?.();
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
            ConfigSettingsDefaults.apply(this.settingsData);
            window.DiscoverabilityState?.init?.(this.settingsData.discoverabilityState);
            this._persistedTheme = String(this.settingsData.theme || '');
            this.syncConfigTabToursSeenFromServer();
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


    openConfigCommandPalette() {
        window.ConfigCommandPalette?.open?.(this);
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
        if (hasDuplicates) {
            return {
                message: this._configT(
                    'config.configSavedReturnDashboardDuplicates',
                    'Settings saved. Duplicate bookmark URLs detected — return to the dashboard to review.'
                ),
                type: 'warning',
                options: {
                    actionLabel: this._configT('config.goToDashboard', 'Open dashboard'),
                    durationMs: 8000,
                    onAction: () => this.goToDashboard(),
                },
            };
        }
        if (scope.settingsOnly) {
            return {
                message: this._configT('config.configSaved', 'Configuration saved successfully!'),
                type: 'success',
                options: { durationMs: 2800 },
            };
        }
        return {
            message: this._configT(
                'config.configSavedReturnDashboard',
                'Settings saved — return to the dashboard to see changes.'
            ),
            type: 'success',
            options: {
                actionLabel: this._configT('config.goToDashboard', 'Open dashboard'),
                durationMs: 6000,
                onAction: () => this.goToDashboard(),
            },
        };
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
