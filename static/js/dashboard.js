// Dashboard JavaScript

// Animation timing constants — adjust here to change the overall animation tempo.
const ANIM = Object.freeze({
    BOOKMARK_STAGGER_STEP:  16,   // ms added per bookmark index during enter animation
    CATEGORY_STAGGER_STEP:  28,   // ms added per category index during enter animation
    BOOKMARK_ENTER_BASE:   240,   // ms base delay before first bookmark enter animation clears
    CATEGORY_ENTER_BASE:   260,   // ms base delay before first category enter animation clears
    PAGE_TRANSITION:       250,   // ms page-transition CSS class lifetime
    BOOKMARK_MOVE_IN:      180,   // ms bookmark-move-in animation duration after reorder
    STALE_FLASH:          2200,   // ms stale-bookmark highlight flash duration
});


const _sessionTags = new Set();

const BACKGROUND_PRESETS = {
    // dark gradients
    sunset:   'linear-gradient(135deg, #c94b4b 0%, #4b134f 100%)',
    ocean:    'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
    aurora:   'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
    forest:   'linear-gradient(135deg, #0a3d0c 0%, #1a5e1f 50%, #0d2d0e 100%)',
    ember:    'linear-gradient(135deg, #3a1500 0%, #8b3800 60%, #ff6600 100%)',
    lavender: 'linear-gradient(135deg, #3d2b6b 0%, #7b5ea7 50%, #c2a0e0 100%)',
    nordic:   'linear-gradient(135deg, #2c3e50 0%, #3498db 100%)',
    rose:     'linear-gradient(135deg, #b91d73 0%, #f953c6 100%)',
    // light gradients
    morning:  'linear-gradient(135deg, #fff1eb 0%, #ace0f9 100%)',
    meadow:   'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
    blush:    'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    mist:     'linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)',
    petal:    'linear-gradient(135deg, #ffd6e7 0%, #ffafcc 100%)',
};

const THEME_BACKGROUND_MAP = {
    'cherry-graphite-dark':  'rose',
    'desert-sand-dark':      'ember',
    'forest-moss-dark':      'forest',
    'lavender-mist-dark':    'lavender',
    'midnight-neon-dark':    'aurora',
    'neon-grid-dark':        'aurora',
    'glacier-mint-dark':     'nordic',
    'kelp-drift-dark':       'ocean',
    'mulberry-silk-dark':    'rose',
    'rusted-rail-dark':      'ember',
    'steel-dawn-dark':       'nordic',
    'nordic-frost-dark':     'nordic',
    'ocean-depth-dark':      'ocean',
    'paper-ink-dark':        'nordic',
    'retro-crt-dark':        'ember',
    'arctic-cyan-dark':      'ocean',
    'copper-circuit-dark':   'ember',
    'coral-reef-dark':       'sunset',
    'emerald-matrix-dark':   'forest',
    'monochrome-mist-dark':  'nordic',
    'obsidian-gold-dark':    'aurora',
    'royal-amethyst-dark':   'lavender',
    'sakura-night-dark':     'rose',
    'solar-ember-dark':      'sunset',
    'sunflower-ink-dark':    'sunset',
    'volcanic-ash-dark':     'ember',
    'cherry-graphite-light': 'blush',
    'desert-sand-light':     'morning',
    'forest-moss-light':     'meadow',
    'lavender-mist-light':   'petal',
    'midnight-neon-light':   'mist',
    'neon-grid-light':       'mist',
    'glacier-mint-light':    'mist',
    'kelp-drift-light':      'meadow',
    'mulberry-silk-light':   'petal',
    'rusted-rail-light':     'morning',
    'steel-dawn-light':      'mist',
    'nordic-frost-light':    'mist',
    'ocean-depth-light':     'mist',
    'paper-ink-light':       'morning',
    'retro-crt-light':       'morning',
    'arctic-cyan-light':     'mist',
    'copper-circuit-light':  'morning',
    'coral-reef-light':      'blush',
    'emerald-matrix-light':  'meadow',
    'monochrome-mist-light': 'mist',
    'obsidian-gold-light':   'morning',
    'royal-amethyst-light':  'petal',
    'sakura-night-light':    'petal',
    'solar-ember-light':     'morning',
    'sunflower-ink-light':   'morning',
    'volcanic-ash-light':    'morning',
    'dark':  'aurora',
    'light': 'mist',
};

class Dashboard {
    constructor() {
        this.bookmarks = [];
        /** All pages — search / global shortcuts; not for getRecentBookmarks (page-local recent UX). */
        this.allBookmarks = [];
        this.finders = [];
        this.categories = [];
        this.collapsedCategories = {};
        this.pages = [];
        this.currentPageId = 'default';
        this.settings = {
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
            showConfigButton: true,
            showHealthDashboard: true,
            showRecentButton: true,
            showTips: false,

            showSyncToasts: false,
            showCheatSheetButton: true,
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
            showIcons: false,
            showLinkPreviewCards: false,
            linkPreviewHoverDelayMs: 150,
            sortMethod: 'order',
            layoutPreset: 'default',
            layoutVersion: 'classic',
            densityMode: 'compact',
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
        // Ensure any active preview is removed when navigating away
        window.addEventListener('beforeunload', () => {
            try { this.dismissBookmarkPreviewInteractions(); } catch (_e) {}
        });
        this.searchComponent = null;
        this.statusMonitor = null;
        this.statusMonitorInitialized = false;
        this.keyboardNavigation = null;
        this.swipeNavigation = null;
        this.categoryReorderInstances = [];
        this.dashboardCategoryReorderInstances = [];
        this._categoryDragRelayHandler = null;
        this._categoryDropHandler = null;
        this._pendingCategoryOrderFromDrop = null;
        this._pendingCategorySave = null;
        this.pendingReorderSave = null;
        this.pendingReorderSnapshot = null;
        this.pendingMetadataSave = null;
        this.notificationTimeout = null;
        this.tipRotationTimer = null;
        this.backupTipTimer = null;
        this.backupTipShown = false;
        this.tipRotationIndex = 0;
        this.tipPriorityIndex = 0;
        this.contextTipRotationIndex = 0;
        this.inlineTipUsageStorageKey = 'nextdash-inline-context-tip-usage-v2';
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
        this.language = new ConfigLanguage();
        this.weatherService = typeof window.WeatherService === 'function' ? new window.WeatherService() : null;
        this.weatherRefreshTimer = null;
        this.dateTimeRefreshTimer = null;
        this.weatherData = null;
        this.inlineEditingBookmarkIndex = null;
        this.onboardingStartedInSession = false;
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

    areRotatingTipsEnabled() {
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) {
            return false;
        }
        if (window.TipsPolicy && typeof window.TipsPolicy.shouldShowRotatingTips === 'function') {
            return window.TipsPolicy.shouldShowRotatingTips(this.settings);
        }
        return this.settings.showTips !== false;
    }

    isCoarsePointer() {
        return window.matchMedia('(hover: none) and (pointer: coarse)').matches
            || window.matchMedia('(max-width: 768px)').matches;
    }

    async init() {
        await this.loadData();
        if (window.TipsPolicy && typeof window.TipsPolicy.applyExpiry === 'function') {
            await window.TipsPolicy.applyExpiry(this);
        }
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
        this.renderDashboard({ animate: false });
        this.setupPageShortcuts();
        this.setupTagFilterEscapeShortcut();
        this.setupTagFilterIndicator();
        this.setupReorderUndoShortcut();
        this.setupPasteToQuickAdd();
        if (typeof QuickAddWidget === 'function') {
            this.quickAddWidget = new QuickAddWidget(this);
        }
        this.setupToolbarActions();
        window.DashboardTagCloud?.init?.();
        this.refreshAddBookmarkToolbarLabel();
        this.setupHeaderEnhancements();
        this.setupConfigStructureReloadListener();
        this.setupConfigReturnRefreshListener();
        this.setupExtensionBookmarkSavedListener();
        this.scheduleBackupTip();

            // Initialize new features
            this.analytics = new BookmarkAnalytics();
            this.setupBookmarkTracking();
            this.buildSearchIndex();
        
        // Add hash change listener for navigation
        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.substring(1);
            if (hash && /^\d+$/.test(hash)) {
                const pageIndex = parseInt(hash) - 1;
                if (pageIndex >= 0 && pageIndex < this.pages.length && this.pages[pageIndex].id !== this.currentPageId) {
                    this.loadPageBookmarks(this.pages[pageIndex].id);
                }
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.renderDateWeatherLine();
                this.updateHealthBadge();
                this.maybeRefreshAfterConfigReturn();
            }
        });

        this._configRefreshReady = true;
        this.markPendingConfigSyncAsAppliedAfterLoad();

        // Initialize follow-up UI immediately after first render (no extra frame delay).
        if (window.SkeletonLoading && typeof window.SkeletonLoading.finish === 'function') {
            window.SkeletonLoading.finish();
        } else {
            document.body.classList.remove('loading');
        }
        this.updateMiniStatusLine();
        this.discoverabilityQueue = typeof window.DiscoverabilityQueue === 'function'
            ? new window.DiscoverabilityQueue(this)
            : null;
        this.initializeOnboarding();
        this.initializeFeatureTour();
        this.initializeConfigBookmarksTour();
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() !== false) {
            this.discoverabilityQueue?.scheduleRun();
        }
    }

    setupExtensionBookmarkSavedListener() {
        window.addEventListener('nextdash:bookmark-saved', async (event) => {
            const detail = event.detail || {};
            const fallback = this.language?.t('dashboard.extensionBookmarkSaved')
                || 'Bookmark saved from extension';
            const message = detail.message || fallback;
            this.showNotification(message, 'success', { duration: 6000 });

            const pageId = detail.pageId != null ? String(detail.pageId) : null;
            if (pageId && pageId !== String(this.currentPageId)) {
                const targetPage = this.pages.find((p) => String(p.id) === pageId);
                if (targetPage) {
                    await this.loadPageBookmarks(targetPage.id);
                }
            } else if (pageId) {
                await this.loadPageBookmarks(this.currentPageId);
            } else {
                await this.loadAllBookmarks();
            }
            this.buildSearchIndex();
            this.renderDashboard({ animate: false });
            this.updateHealthBadge();
        });
    }

    setupConfigStructureReloadListener() {
        window.addEventListener('storage', async (event) => {
            if (!event.newValue) {
                return;
            }
            try {
                const payload = JSON.parse(event.newValue);
                if (payload?.sourceTabId && payload.sourceTabId === this.tabId) {
                    return;
                }
                if (event.key === this.structureSyncEventKey) {
                    await this.refreshAfterConfigStructureUpdate(payload);
                    this.lastAppliedStructureSyncAt = payload?.timestamp || Date.now();
                    this.lastAppliedSettingsSyncAt = Math.max(this.lastAppliedSettingsSyncAt, payload?.timestamp || 0);
                    try {
                        sessionStorage.removeItem(this.pendingStructureSyncKey);
                        sessionStorage.removeItem(this.pendingSettingsSyncKey);
                    } catch { /* ignore */ }
                    this.showSyncToast(this.formatDashboardLabel('syncConfigChanges', {}, 'Synced config changes.'));
                    return;
                }
                if (event.key === this.settingsSyncEventKey) {
                    await this.refreshAfterConfigSettingsUpdate(payload);
                    this.lastAppliedSettingsSyncAt = payload?.timestamp || Date.now();
                    try {
                        sessionStorage.removeItem(this.pendingSettingsSyncKey);
                    } catch { /* ignore */ }
                    this.showSyncToast(this.formatDashboardLabel('syncSettingsApplied', {}, 'Applied dashboard settings update.'));
                }
            } catch (error) {
                window.location.reload();
            }
        });
    }

    setupConfigReturnRefreshListener() {
        window.addEventListener('pageshow', () => {
            this.maybeRefreshAfterConfigReturn();
        });
    }

    readPendingConfigSync(key) {
        try {
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const payload = JSON.parse(raw);
            return payload && Number(payload.timestamp) > 0 ? payload : null;
        } catch {
            return null;
        }
    }

    markPendingConfigSyncAsAppliedAfterLoad() {
        const structurePending = this.readPendingConfigSync(this.pendingStructureSyncKey);
        const settingsPending = this.readPendingConfigSync(this.pendingSettingsSyncKey);
        const now = Date.now();
        if (structurePending) {
            this.lastAppliedStructureSyncAt = Math.max(this.lastAppliedStructureSyncAt, structurePending.timestamp, now);
            sessionStorage.removeItem(this.pendingStructureSyncKey);
        }
        if (settingsPending) {
            this.lastAppliedSettingsSyncAt = Math.max(this.lastAppliedSettingsSyncAt, settingsPending.timestamp, now);
            sessionStorage.removeItem(this.pendingSettingsSyncKey);
        }
        if (!structurePending && !settingsPending) {
            this.lastAppliedStructureSyncAt = now;
            this.lastAppliedSettingsSyncAt = now;
        }
    }

    async maybeRefreshAfterConfigReturn() {
        if (!this._configRefreshReady || this._configReturnRefreshInFlight) {
            return;
        }

        const structurePending = this.readPendingConfigSync(this.pendingStructureSyncKey);
        const settingsPending = this.readPendingConfigSync(this.pendingSettingsSyncKey);
        const structureTs = structurePending?.timestamp || 0;
        const settingsTs = settingsPending?.timestamp || 0;

        if (structureTs <= this.lastAppliedStructureSyncAt && settingsTs <= this.lastAppliedSettingsSyncAt) {
            return;
        }

        this._configReturnRefreshInFlight = true;
        try {
            if (structureTs > this.lastAppliedStructureSyncAt) {
                await this.refreshAfterConfigStructureUpdate(structurePending || {});
                this.lastAppliedStructureSyncAt = structureTs;
                sessionStorage.removeItem(this.pendingStructureSyncKey);
                if (settingsTs > 0) {
                    this.lastAppliedSettingsSyncAt = Math.max(this.lastAppliedSettingsSyncAt, settingsTs);
                    sessionStorage.removeItem(this.pendingSettingsSyncKey);
                }
                this.showSyncToast(this.formatDashboardLabel('syncConfigChanges', {}, 'Synced config changes.'));
                return;
            }

            if (settingsTs > this.lastAppliedSettingsSyncAt) {
                await this.refreshAfterConfigSettingsUpdate(settingsPending || {});
                this.lastAppliedSettingsSyncAt = settingsTs;
                sessionStorage.removeItem(this.pendingSettingsSyncKey);
                this.showSyncToast(this.formatDashboardLabel('syncSettingsApplied', {}, 'Applied dashboard settings update.'));
            }
        } finally {
            this._configReturnRefreshInFlight = false;
        }
    }

    showSyncToast(message) {
        if (this.settings?.showSyncToasts === false) {
            return;
        }
        const now = Date.now();
        if (now - this.lastSyncToastAt < 2000) {
            return;
        }
        this.lastSyncToastAt = now;
        this.showNotification(message, 'success');
    }

    async refreshAfterConfigStructureUpdate(payload = {}) {
        try {
            await this.loadData();
            await this.withRetry(() => this.loadPageBookmarks(this.currentPageId), 2, 220);
            await this.withRetry(() => this.loadAllBookmarks(), 2, 220);
            this.renderPageNavigation();
            this.renderDashboard();
            this.initializeButtonTipsRotation();
            if (this.searchComponent) {
                this.updateSearchComponent();
            }
        } catch (error) {
            window.location.reload();
        }
    }

    async refreshAfterConfigSettingsUpdate(payload = {}) {
        try {
            await this.loadData();
            if (this.settings.language && this.settings.language !== this.language.currentLanguage) {
                await this.language.loadTranslations(this.settings.language);
            }
            this.applyVisualSettings();
            this.setupDOM();
            this.updateStatusMonitor();
            await this.withRetry(() => this.loadPageBookmarks(this.currentPageId), 2, 220);
            await this.withRetry(() => this.loadAllBookmarks(), 2, 220);
            this.renderPageNavigation();
            this.renderDashboard();
            this.initializeButtonTipsRotation();
            if (this.searchComponent) {
                this.updateSearchComponent();
            }
            if (this.statusMonitor && this.settings.showStatus) {
                this.statusMonitor.refreshAllStatuses();
            }
        } catch (error) {
            window.location.reload();
        }
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

    async loadData() {
        try {
            const [pagesRes, settingsRes, findersRes] = await Promise.all([
                fetch('/api/pages'),
                fetch('/api/settings'),
                fetch('/api/finders')
            ]);

            this.pages = await pagesRes.json();
            this.finders = await findersRes.json();
            
            // Load settings from server first
            const serverSettings = await settingsRes.json();
            
            // Load settings from localStorage or server based on device-specific flag
            const deviceSpecific = window.DeviceSettingsMerge?.isDeviceSpecificEnabled?.() === true
                || localStorage.getItem('deviceSpecificSettings') === 'true';
            if (deviceSpecific && window.DeviceSettingsMerge?.mergeServerAndDeviceSettings) {
                const deviceSettings = window.DeviceSettingsMerge.getDeviceSettingsRaw?.();
                this.settings = window.DeviceSettingsMerge.mergeServerAndDeviceSettings(serverSettings, deviceSettings);
            } else if (deviceSpecific) {
                const deviceSettings = localStorage.getItem('dashboardSettings');
                this.settings = deviceSettings ? { ...serverSettings, ...JSON.parse(deviceSettings) } : serverSettings;
            } else {
                this.settings = serverSettings;
            }

            if (!Array.isArray(this.settings.smartRecentPageIds)) {
                this.settings.smartRecentPageIds = [];
            }
            if (!Array.isArray(this.settings.smartTodayPageIds)) {
                this.settings.smartTodayPageIds = [];
            }
            if (!Array.isArray(this.settings.smartStalePageIds)) {
                this.settings.smartStalePageIds = [];
            }
            if (!Array.isArray(this.settings.smartMostUsedPageIds)) {
                this.settings.smartMostUsedPageIds = [];
            }
            if (typeof this.settings.showSmartRecentCollection === 'undefined') {
                this.settings.showSmartRecentCollection = false;
            }
            if (typeof this.settings.showSmartTodayCollection === 'undefined') {
                this.settings.showSmartTodayCollection = true;
            }
            if (typeof this.settings.showSmartStaleCollection === 'undefined') {
                this.settings.showSmartStaleCollection = false;
            }
            if (typeof this.settings.showSmartMostUsedCollection === 'undefined') {
                this.settings.showSmartMostUsedCollection = false;
            }
            if (typeof this.settings.showRecentButton === 'undefined') {
                this.settings.showRecentButton = true;
            }
            if (typeof this.settings.pasteUrlQuickAdd === 'undefined') {
                this.settings.pasteUrlQuickAdd = true;
            }
            if (typeof this.settings.showHealthDashboard === 'undefined') {
                this.settings.showHealthDashboard = true;
            }
            if (typeof this.settings.showAddBookmarkButton === 'undefined') {
                this.settings.showAddBookmarkButton = true;
            }
            if (typeof this.settings.showTips === 'undefined') {
                this.settings.showTips = false;
            }

            if (typeof this.settings.showLinkPreviewCards === 'undefined') {
                this.settings.showLinkPreviewCards = false;
            }
            if (![100, 150, 250].includes(Number(this.settings.linkPreviewHoverDelayMs))) {
                this.settings.linkPreviewHoverDelayMs = 150;
            }
            if (typeof this.settings.showSyncToasts === 'undefined') {
                this.settings.showSyncToasts = false;
            }
            if (typeof this.settings.packedColumns === 'undefined') {
                this.settings.packedColumns = true;
            }
            this.settings.columnsPerRow = this.getNormalizedColumnsPerRow();
            if (!['comfortable', 'compact', 'dense', 'auto'].includes(String(this.settings.densityMode || ''))) {
                this.settings.densityMode = 'compact';
            }
            if (window.DashboardFont) {
                window.DashboardFont.normalizeFontSettings(this.settings);
            } else if (!this.settings.fontPreset) {
                this.settings.fontPreset = 'source-code-pro';
            }
            if (typeof this.settings.showShortcuts === 'undefined') {
                this.settings.showShortcuts = true;
            }
            if (typeof this.settings.showPinIcon === 'undefined') {
                this.settings.showPinIcon = false;
            }
            if (typeof this.settings.showNoteIcon === 'undefined') {
                this.settings.showNoteIcon = true;
            }
            if (typeof this.settings.showStatus === 'undefined') {
                this.settings.showStatus = true;
            }
            if (typeof this.settings.colorizeStatus === 'undefined') {
                this.settings.colorizeStatus = true;
            }
            if (typeof this.settings.showPing === 'undefined') {
                this.settings.showPing = true;
            }
            if (typeof window.normalizeStatusOfflineRetries === 'function') {
                this.settings.statusOfflineRetries = window.normalizeStatusOfflineRetries(this.settings.statusOfflineRetries);
            } else {
                this.settings.statusOfflineRetries = 3;
            }
            if (typeof window.normalizeStatusOfflineRetryDelayMs === 'function') {
                this.settings.statusOfflineRetryDelayMs = window.normalizeStatusOfflineRetryDelayMs(this.settings.statusOfflineRetryDelayMs);
            } else {
                this.settings.statusOfflineRetryDelayMs = 450;
            }
            if (typeof window.normalizeStatusRecheckIntervalMinutes === 'function') {
                this.settings.statusRecheckIntervalMinutes = window.normalizeStatusRecheckIntervalMinutes(this.settings.statusRecheckIntervalMinutes);
            } else {
                this.settings.statusRecheckIntervalMinutes = 5;
            }
            if (typeof this.settings.onboardingCompleted === 'undefined') {
                this.settings.onboardingCompleted = true;
            }
            if (!Number.isFinite(Number(this.settings.smartRecentLimit)) || Number(this.settings.smartRecentLimit) < 0) {
                this.settings.smartRecentLimit = 50;
            } else {
                this.settings.smartRecentLimit = Number(this.settings.smartRecentLimit);
            }
            if (!Number.isFinite(Number(this.settings.smartTodayLimit)) || Number(this.settings.smartTodayLimit) < 0) {
                this.settings.smartTodayLimit = 8;
            } else {
                this.settings.smartTodayLimit = Number(this.settings.smartTodayLimit);
            }
            if (!Number.isFinite(Number(this.settings.smartStaleLimit)) || Number(this.settings.smartStaleLimit) < 0) {
                this.settings.smartStaleLimit = 50;
            } else {
                this.settings.smartStaleLimit = Number(this.settings.smartStaleLimit);
            }
            if (!Number.isFinite(Number(this.settings.smartMostUsedLimit)) || Number(this.settings.smartMostUsedLimit) < 0) {
                this.settings.smartMostUsedLimit = 25;
            } else {
                this.settings.smartMostUsedLimit = Number(this.settings.smartMostUsedLimit);
            }
            if (!this.settings.dateFormat) {
                this.settings.dateFormat = 'short-slash';
            }
            if (typeof this.settings.showTime === 'undefined') {
                this.settings.showTime = true;
            }
            if (!['24h', '12h'].includes(String(this.settings.timeFormat || ''))) {
                this.settings.timeFormat = '24h';
            }
            if (typeof this.settings.showWeatherWithDate === 'undefined') {
                this.settings.showWeatherWithDate = false;
            }
            if (!this.settings.weatherSource) {
                this.settings.weatherSource = 'manual';
            }
            if (!this.settings.weatherUnit) {
                this.settings.weatherUnit = 'celsius';
            }
            if (!Number.isFinite(Number(this.settings.weatherRefreshMinutes)) || Number(this.settings.weatherRefreshMinutes) <= 0) {
                this.settings.weatherRefreshMinutes = 30;
            } else {
                this.settings.weatherRefreshMinutes = Number(this.settings.weatherRefreshMinutes);
            }

            // Update document title based on custom title settings
            this.updateDocumentTitle();

            // Page from ?page=<id> or legacy #<1-based index>
            const hash = window.location.hash.substring(1);
            const deepLink = typeof DashboardDeepLink !== 'undefined'
                ? DashboardDeepLink.parseDashboardDeepLink()
                : null;
            let initialPageId = this.pages.length > 0 ? this.pages[0].id : 'default';
            if (deepLink?.pageId != null && this.pages.some((p) => p.id === deepLink.pageId)) {
                initialPageId = deepLink.pageId;
            } else if (hash && /^\d+$/.test(hash)) {
                const pageIndex = parseInt(hash, 10) - 1;
                if (pageIndex >= 0 && pageIndex < this.pages.length) {
                    initialPageId = this.pages[pageIndex].id;
                }
            }
            this.currentPageId = initialPageId;
            
            // Load bookmarks and categories for initial page
            await this.loadPageBookmarks(this.currentPageId);
            
            // Always load all bookmarks so smart collections can work across pages.
            await this.loadAllBookmarks();

            await this.consumeDashboardDeepLink();
        } catch (error) {
            const msg = this.language?.t?.('dashboard.loadFailed')
                || 'Failed to load dashboard. Please reload the page.';
            const translated = (typeof msg === 'string' && msg !== 'dashboard.loadFailed') ? msg : 'Failed to load dashboard. Please reload the page.';
            if (window.AppNotification?.showErrorWithReload) {
                window.AppNotification.showErrorWithReload(translated);
            } else {
                this.showErrorNotification(translated, { reload: true });
            }
        }
    }

    showNotification(message, type = 'error', { undoCallback = null, duration = 5000, onAction = null, actionLabel = null, durationMs = null } = {}) {
        if (!window.AppNotification) return;
        const opts = { duration: durationMs ?? duration };
        const undo = undoCallback || onAction;
        if (undo) {
            opts.onAction = undo;
            opts.actionLabel = actionLabel || (this.language ? this.language.t('dashboard.undo') : 'Undo');
        }
        window.AppNotification.show(message, type, opts);
    }

    showErrorNotification(message, options = {}) {
        if (options.reload && window.AppNotification?.showErrorWithReload) {
            window.AppNotification.showErrorWithReload(message, options);
            return;
        }
        this.showNotification(message, 'error', options);
    }

    loadCollapsedStates() {
        const stored = localStorage.getItem('collapsedCategories');
        if (stored) {
            this.collapsedCategories = JSON.parse(stored);
        }
    }

    saveCollapsedStates() {
        localStorage.setItem('collapsedCategories', JSON.stringify(this.collapsedCategories));
    }

    async loadPageBookmarks(pageId) {
        try {
            const [bookmarksRes, categoriesRes] = await Promise.all([
                fetch(`/api/bookmarks?page=${pageId}`),
                fetch(`/api/categories?page=${pageId}`)
            ]);
            
            this.bookmarks = await bookmarksRes.json();
            this.categories = (await categoriesRes.json()).map(cat => ({ ...cat, name: this.language.t(cat.name) || cat.name }));
            this.currentPageId = pageId;
            this.initializeButtonTipsRotation();
            
            // Update URL hash
            const pageIndex = this.pages.findIndex(p => p.id === pageId);
            if (pageIndex !== -1) {
                window.location.hash = `#${pageIndex + 1}`;
            }
            
            // Update page title
            const page = this.pages.find(p => p.id === pageId);
            if (page) {
                this.updatePageTitle(page.name);
            }
            this.updateMiniStatusLine();
            
            // Update document title with page name if enabled
            this.updateDocumentTitle();

            // Update search component and render
            if (this.searchComponent) {
                this.updateSearchComponent();
            }
            window.scrollTo({ top: 0, behavior: 'instant' });
            this.renderDashboard({ animate: true });

            // Reset keyboard navigation to first element when changing pages
            if (this.keyboardNavigation) {
                this.keyboardNavigation.resetToFirst();
            }
        } catch (error) {
            this.showErrorNotification('Failed to load bookmarks for this page.', { reload: true });
        }
    }

    async loadAllBookmarks() {
        try {
            const allBookmarksRes = await fetch('/api/bookmarks?all=true');
            this.allBookmarks = await allBookmarksRes.json();
            
            // Update search component with all bookmarks
            if (this.searchComponent) {
                this.updateSearchComponent();
            }
        } catch (error) {
            this.showErrorNotification('Failed to refresh global shortcuts.');
        }
    }

    async saveSettings() {
        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(this.settings)
            });
            
            if (!response.ok) {
                throw new Error('Failed to save settings');
            }
            
            // Also save device-local subset when device-specific is enabled
            const deviceSpecific = window.DeviceSettingsMerge?.isDeviceSpecificEnabled?.() === true
                || localStorage.getItem('deviceSpecificSettings') === 'true';
            if (deviceSpecific && window.DeviceSettingsMerge?.saveDeviceLocalSettings) {
                window.DeviceSettingsMerge.saveDeviceLocalSettings(this.settings);
            } else if (deviceSpecific) {
                localStorage.setItem('dashboardSettings', JSON.stringify(this.settings));
            }
        } catch (error) {
            this.showErrorNotification('Failed to save settings.');
        }
    }

    updatePageTitle(pageName) {
        const titleElement = document.querySelector('.title');
        if (titleElement) {
            const defaultTitle = this.language.t('dashboard.defaultPageTitle');
            titleElement.textContent = pageName || (defaultTitle !== 'dashboard.defaultPageTitle' ? defaultTitle : '');
        }
    }

    updateDocumentTitle() {
        const currentPage = this.pages && this.currentPageId
            ? this.pages.find(p => p.id === this.currentPageId)
            : null;
        const pageName = currentPage?.name || '';

        if (this.settings?.enableCustomTitle) {
            const base = (this.settings.customTitle || '').trim();
            if (base) {
                document.title = this.settings.showPageInTitle && pageName
                    ? `${pageName} — ${base}`
                    : base;
            } else {
                document.title = pageName || 'nextDash';
            }
        } else {
            document.title = pageName ? `${pageName} — nextDash` : 'nextDash';
        }
    }

    /** Inline page-tab rename (name/icon/color) — desktop/tablet landscape only. */
    allowsPageTabInlineEdit() {
        return window.MobileExperience?.isMobileLayout?.() !== true;
    }

    renderPageNavigation() {
        const container = document.getElementById('page-navigation');
        if (!container) return;

        container.innerHTML = '';

        this.pages.forEach((page, index) => {
            const pageBtn = document.createElement('button');
            pageBtn.className = 'page-nav-btn';
            if (page.id === this.currentPageId) {
                pageBtn.classList.add('active');
            }
            this._renderPageTabContent(pageBtn, page, index);
            pageBtn.addEventListener('click', () => {
                container.querySelectorAll('.page-nav-btn').forEach(btn => btn.classList.remove('active'));
                pageBtn.classList.add('active');
                this.loadPageBookmarks(page.id);
                this.updatePageTitle(page.name);
                this.markInlineTipUsed('page_switch');
            });
            pageBtn.addEventListener('dblclick', (e) => {
                if (!this.allowsPageTabInlineEdit()) return;
                e.preventDefault();
                this._startPageTabRename(pageBtn, page, index);
            });
            container.appendChild(pageBtn);
        });
        this.updateMiniStatusLine();
    }

    _renderPageTabContent(btn, page, index) {
        btn.innerHTML = '';
        if (page.icon) {
            const iconEl = document.createElement('span');
            iconEl.className = 'page-tab-icon';
            iconEl.textContent = page.icon;
            btn.appendChild(iconEl);
        }
        if (page.color) {
            const dot = document.createElement('span');
            dot.className = 'page-tab-dot';
            dot.style.background = page.color;
            btn.appendChild(dot);
        }
        const label = document.createElement('span');
        label.className = 'page-tab-label';
        label.textContent = this.settings.showPageNamesInTabs ? page.name : (index + 1).toString();
        btn.appendChild(label);
    }

    /**
     * Place a fixed popover fully inside the viewport, anchored to a page tab (or similar).
     */
    _positionPageTabPopover(popover, anchorEl, { initial = false } = {}) {
        const pad = 8;
        const gap = 6;
        if (initial) {
            popover.style.visibility = 'hidden';
        }
        popover.style.top = '0';
        popover.style.left = '0';
        popover.style.right = 'auto';
        popover.style.bottom = 'auto';

        const measure = () => {
            const anchor = anchorEl.getBoundingClientRect();
            const pop = popover.getBoundingClientRect();
            const maxLeft = Math.max(pad, window.innerWidth - pad - pop.width);
            const maxTop = Math.max(pad, window.innerHeight - pad - pop.height);

            let top = anchor.bottom + gap;
            let left = anchor.left;

            if (left + pop.width > window.innerWidth - pad) {
                left = anchor.right - pop.width;
            }
            left = Math.min(Math.max(pad, left), maxLeft);

            if (top + pop.height > window.innerHeight - pad) {
                const above = anchor.top - gap - pop.height;
                top = above >= pad ? above : maxTop;
            }
            top = Math.min(Math.max(pad, top), maxTop);

            popover.style.top = `${Math.round(top)}px`;
            popover.style.left = `${Math.round(left)}px`;
            if (initial) {
                popover.style.visibility = '';
            }
        };

        if (initial) {
            requestAnimationFrame(measure);
        } else {
            measure();
        }
    }

    _startPageTabRename(btn, page, index) {
        if (!this.allowsPageTabInlineEdit()) return;
        if (btn.querySelector('.page-tab-popover')) return;

        const PAGE_COLORS = [
            null,
            '#e05252', '#e08852', '#d4bf4a', '#4cac6b',
            '#5285e0', '#8b5fe0', '#e052a8', '#52c8e0'
        ];

        // Build popover
        const popover = document.createElement('div');
        popover.className = 'page-tab-popover';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'page-tab-popover-name';
        nameInput.value = page.name;
        nameInput.placeholder = 'Page name';

        const iconInput = document.createElement('input');
        iconInput.type = 'text';
        iconInput.className = 'page-tab-popover-icon';
        iconInput.value = page.icon || '';
        iconInput.placeholder = '📌';
        iconInput.maxLength = 4;

        const swatches = document.createElement('div');
        swatches.className = 'page-tab-color-swatches';
        PAGE_COLORS.forEach(color => {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'page-tab-color-swatch' + (page.color === color ? ' selected' : '');
            sw.style.background = color || 'transparent';
            if (!color) sw.classList.add('swatch-none');
            sw.addEventListener('mousedown', (e) => {
                e.preventDefault();
                swatches.querySelectorAll('.page-tab-color-swatch').forEach(s => s.classList.remove('selected'));
                sw.classList.add('selected');
                page.color = color;
            });
            swatches.appendChild(sw);
        });

        const row = document.createElement('div');
        row.className = 'page-tab-popover-row';
        row.appendChild(iconInput);
        row.appendChild(nameInput);

        popover.appendChild(row);
        popover.appendChild(swatches);

        document.body.appendChild(popover);
        this._positionPageTabPopover(popover, btn, { initial: true });

        const reposition = () => {
            if (popover.isConnected) {
                this._positionPageTabPopover(popover, btn);
            }
        };
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);

        const removeRepositionListeners = () => {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
        };

        nameInput.focus();
        nameInput.select();

        let done = false;
        const commit = async () => {
            if (done) return;
            done = true;
            removeRepositionListeners();
            popover.remove();
            const newName = nameInput.value.trim();
            const newIcon = iconInput.value.trim();
            if (!newName) { this._renderPageTabContent(btn, page, index); return; }
            page.name = newName;
            page.icon = newIcon || undefined;
            this._renderPageTabContent(btn, page, index);
            this.updatePageTitle(newName);
            try {
                await fetch('/api/pages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.pages)
                });
            } catch (e) { /* ignore */ }
        };
        const cancel = () => {
            if (done) return;
            done = true;
            removeRepositionListeners();
            popover.remove();
            this._renderPageTabContent(btn, page, index);
        };

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        iconInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); nameInput.focus(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });

        // Close on outside click
        const onOutside = (e) => {
            if (!popover.contains(e.target) && e.target !== btn) {
                document.removeEventListener('mousedown', onOutside);
                commit();
            }
        };
        setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
    }

    shouldStackDashboardCategories() {
        return (
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(max-width: 767px)').matches
        );
    }

    getEffectiveColumnsPerRow() {
        if (this.shouldStackDashboardCategories()) {
            return 1;
        }
        return this.getNormalizedColumnsPerRow();
    }

    shouldPackDashboardColumns() {
        if (this.shouldStackDashboardCategories()) {
            return false;
        }
        return (
            this.settings.packedColumns === true &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(min-width: 768px)').matches
        );
    }

    getNormalizedColumnsPerRow() {
        const parsed = parseInt(String(this.settings.columnsPerRow), 10);
        return Math.max(1, Math.min(12, Number.isFinite(parsed) ? parsed : 3));
    }

    syncDashboardGridLayout() {
        const grid = document.getElementById('dashboard-layout');
        if (!grid) {
            return null;
        }

        const configuredColCount = this.getNormalizedColumnsPerRow();
        this.settings.columnsPerRow = configuredColCount;
        const colCount = this.getEffectiveColumnsPerRow();
        const packed = this.shouldPackDashboardColumns();
        const packedClass = packed ? ' packed-columns' : '';

        grid.className = `dashboard-grid columns-${colCount} layout-${this.settings.layoutPreset || 'default'} density-${this.settings.densityMode || 'compact'}${packedClass}`;
        grid.setAttribute('role', 'grid');
        grid.setAttribute(
            'aria-label',
            this.language?.t('dashboard.bookmarksGridLabel') || 'Bookmarks'
        );
        grid.style.setProperty('--packed-columns', String(colCount));
        document.body.setAttribute(
            'data-dashboard-stack-categories',
            this.shouldStackDashboardCategories() ? 'true' : 'false'
        );
        const colMin = 'var(--dashboard-column-min, 250px)';
        const colMax = 'var(--dashboard-column-max, 300px)';
        grid.style.setProperty(
            '--dashboard-grid-max-width',
            `calc(${colCount} * ${colMax} + ${Math.max(0, colCount - 1)} * var(--gap, 1.5rem))`
        );

        if (packed) {
            grid.style.removeProperty('grid-template-columns');
        } else if (colCount === 1) {
            grid.style.gridTemplateColumns = 'minmax(0, 1fr)';
        } else {
            grid.style.gridTemplateColumns = `repeat(${colCount}, minmax(${colMin}, ${colMax}))`;
        }

        return { grid, colCount, packed };
    }

    _distributeDashboardColumnBlocks(container, columnBlocks, { animate = false, gridLayout = null } = {}) {
        if (!container || !columnBlocks.length) {
            return;
        }

        const colCount = gridLayout?.colCount ?? this.getEffectiveColumnsPerRow();
        const shouldPackColumns = gridLayout?.packed ?? this.shouldPackDashboardColumns();

        if (shouldPackColumns) {
            const columns = Array.from({ length: colCount }, () => {
                const col = document.createElement('div');
                col.className = 'dashboard-column';
                return col;
            });
            columnBlocks.forEach((el, i) => {
                if (animate) {
                    el.style.setProperty('--stagger-index', String(i));
                    const categoryEnterDelay = (i * ANIM.CATEGORY_STAGGER_STEP) + ANIM.CATEGORY_ENTER_BASE;
                    setTimeout(() => el.classList.remove('animate-enter'), categoryEnterDelay);
                }
                columns[i % colCount].appendChild(el);
            });
            columns.forEach((c) => container.appendChild(c));
            return;
        }

        columnBlocks.forEach((el, i) => {
            if (animate) {
                el.style.setProperty('--stagger-index', String(i));
                const categoryEnterDelay = (i * ANIM.CATEGORY_STAGGER_STEP) + ANIM.CATEGORY_ENTER_BASE;
                setTimeout(() => el.classList.remove('animate-enter'), categoryEnterDelay);
            }
            container.appendChild(el);
        });
    }

    _copyDashboardGridLayoutToElement(target, sourceGrid) {
        if (!target || !sourceGrid) {
            return;
        }
        const layoutClasses = [...sourceGrid.classList].filter((cls) =>
            cls === 'dashboard-grid'
            || cls === 'packed-columns'
            || cls.startsWith('columns-')
            || cls.startsWith('layout-')
            || cls.startsWith('density-')
        );
        target.className = `tag-filter-view-body ${layoutClasses.join(' ')}`.trim();
        target.setAttribute('role', 'grid');
        target.setAttribute(
            'aria-label',
            this.language?.t('dashboard.tagFilterGridLabel') || 'Filtered bookmarks'
        );
    }

    /**
     * Tag filter: one equal-width dashboard column per chunk (10 bookmarks), not round-robin.
     */
    _distributeTagFilterColumnBlocks(container, chunkBlocks, { animate = false, gridLayout = null } = {}) {
        if (!container || !chunkBlocks.length) {
            return;
        }

        const chunkColCount = chunkBlocks.length;
        const shouldPackColumns = gridLayout?.packed ?? this.shouldPackDashboardColumns();
        const gap = 'var(--gap, 1.5rem)';
        const colMax = 'var(--dashboard-column-max, 300px)';

        container.style.setProperty('--packed-columns', String(chunkColCount));
        container.style.setProperty(
            '--dashboard-grid-max-width',
            `calc(${chunkColCount} * ${colMax} + ${Math.max(0, chunkColCount - 1)} * ${gap})`
        );

        if (shouldPackColumns) {
            chunkBlocks.forEach((el, i) => {
                if (animate) {
                    el.style.setProperty('--stagger-index', String(i));
                    const categoryEnterDelay = (i * ANIM.CATEGORY_STAGGER_STEP) + ANIM.CATEGORY_ENTER_BASE;
                    setTimeout(() => el.classList.remove('animate-enter'), categoryEnterDelay);
                }
                const col = document.createElement('div');
                col.className = 'dashboard-column tag-filter-dashboard-column';
                col.appendChild(el);
                container.appendChild(col);
            });
            return;
        }

        const colMin = 'var(--dashboard-column-min, 250px)';
        if (chunkColCount === 1) {
            container.style.gridTemplateColumns = 'minmax(0, 1fr)';
        } else {
            container.style.gridTemplateColumns = `repeat(${chunkColCount}, minmax(${colMin}, ${colMax}))`;
        }

        chunkBlocks.forEach((el, i) => {
            if (animate) {
                el.style.setProperty('--stagger-index', String(i));
                const categoryEnterDelay = (i * ANIM.CATEGORY_STAGGER_STEP) + ANIM.CATEGORY_ENTER_BASE;
                setTimeout(() => el.classList.remove('animate-enter'), categoryEnterDelay);
            }
            container.appendChild(el);
        });
    }

    setupDOM() {
        // Control date visibility and set up if visible
        this.updateDateVisibility();

        // Apply theme - use classList to preserve other classes
        document.body.classList.remove('dark', 'light');
        document.body.classList.add(this.settings.theme);
        document.documentElement.setAttribute('data-theme', this.settings.theme);
        document.body.setAttribute('data-theme', this.settings.theme);
        document.body.setAttribute('data-show-title', this.settings.showTitle);
        document.body.setAttribute('data-show-date', this.settings.showDate);
        document.body.setAttribute('data-show-config-button', this.settings.showConfigButton);
        document.body.setAttribute('data-show-health-dashboard', this.settings.showHealthDashboard !== false);
        document.body.setAttribute('data-show-cheatsheet-button', this.settings.showCheatSheetButton !== false);
        document.body.setAttribute('data-show-add-bookmark-button', this.settings.showAddBookmarkButton !== false);
        document.body.setAttribute('data-show-search-button', this.settings.showSearchButton);
        document.body.setAttribute('data-show-finders-button', this.settings.showFindersButton);
        document.body.setAttribute('data-show-commands-button', this.settings.showCommandsButton);
        document.body.setAttribute('data-show-recent-button', this.settings.showRecentButton !== false);
        document.body.setAttribute('data-show-tips', this.areRotatingTipsEnabled() ? 'true' : 'false');
        document.body.setAttribute(
            'data-show-tag-cloud-button',
            this.settings.showTagCloudButton === true ? 'true' : 'false'
        );
        document.body.setAttribute('data-button-position', this.settings.buttonBarPosition || 'bottom');

        document.body.setAttribute('data-show-shortcuts', this.settings.showShortcuts !== false);
        document.body.setAttribute('data-show-pin-icon', this.settings.showPinIcon === true ? 'true' : 'false');
        document.body.setAttribute('data-show-note-icon', this.settings.showNoteIcon === false ? 'false' : 'true');
        document.body.setAttribute('data-layout-preset', this.settings.layoutPreset || 'default');
        const layoutVersion = window.LayoutVersionUtils
            ? window.LayoutVersionUtils.normalizeLayoutVersion(this.settings.layoutVersion)
            : ((this.settings.layoutVersion || 'classic') === 'modern' ? 'modern' : 'classic');
        this.settings.layoutVersion = layoutVersion;
        if (window.LayoutVersionUtils) {
            window.LayoutVersionUtils.applyLayoutVersionToDOM(layoutVersion);
        } else {
            document.documentElement.setAttribute('data-layout-version', layoutVersion);
            document.body.setAttribute('data-layout-version', layoutVersion);
        }
        document.body.setAttribute('data-density-mode', this.settings.densityMode || 'compact');

        // Apply font size
        this.applyFontSize();

        if (window.DashboardFont) {
            window.DashboardFont.applyMainFont(this.settings);
        }

        // Apply background dots
        this.applyBackgroundDots();

        // Apply animations
        this.applyAnimations();

        // Control title visibility dynamically
        this.updateTitleVisibility();
        
        // Control config button visibility dynamically  
        this.updateConfigButtonVisibility();

        // Control health beta link visibility dynamically
        this.updateHealthDashboardVisibility();

        // Control page tabs visibility dynamically
        this.updatePageTabsVisibility();
        this.initializeButtonTipsRotation();

        // Apply columns setting
        this.syncDashboardGridLayout();
    }

    // Helper to find the header container used across different templates/layouts
    getHeaderContainer() {
        // Prefer an explicit .header if present, fall back to known header-top / header-actions
        const header = document.querySelector('.header') || document.querySelector('.header-top') || document.querySelector('.header-actions') || document.querySelector('.dashboard-section.section-controls .container');
        // Final fallback to body so insert/append operations don't throw
        return header || document.body;
    }

    initializeSearchComponent() {
        // Initialize search component with current data
        // Use all bookmarks if global shortcuts is enabled, otherwise just current page
        const bookmarksForSearch = this.settings.globalShortcuts ? this.allBookmarks : this.bookmarks;
        
        if (window.SearchComponent) {
            this.searchComponent = new window.SearchComponent(bookmarksForSearch, this.bookmarks, this.allBookmarks, this.settings, this.language, this.finders, this.pages);
        } else {
            console.warn('SearchComponent not found. Make sure search.js is loaded.');
        }
    }

    // Method to update search component when data changes
    updateSearchComponent() {
        if (this.searchComponent) {
            // Use all bookmarks if global shortcuts is enabled, otherwise just current page
            const bookmarksForSearch = this.settings.globalShortcuts ? this.allBookmarks : this.bookmarks;
            this.searchComponent.updateData(bookmarksForSearch, this.bookmarks, this.allBookmarks, this.settings, this.language, this.finders, this.pages);
        }
        window.DashboardTagCloud?.syncFromSettings?.();
    }

    applyFindFilter(query) {
        this._findFilter = query || '';
        const layout = document.getElementById('dashboard-layout');

        if (!this._findFilter) {
            layout?.querySelectorAll('.bookmark-link').forEach(t => t.classList.remove('find-hidden'));
            return;
        }

        const q = this._findFilter.toLowerCase();
        layout?.querySelectorAll('.bookmark-link').forEach(tile => {
            const name = (tile.querySelector('.bookmark-name')?.textContent || '').toLowerCase();
            const url  = (tile.getAttribute('data-bookmark-url') || '').toLowerCase();
            tile.classList.toggle('find-hidden', !name.includes(q) && !url.includes(q));
        });
    }

    applyTagFilter(tag, { animate = true } = {}) {
        const normalized = String(tag || '').trim().toLowerCase();
        const changed = this._tagFilter !== normalized;
        this._tagFilter = normalized;

        document.body.setAttribute('data-tag-filter-active', normalized ? 'true' : 'false');
        if (normalized) {
            document.body.setAttribute('data-tag-filter', normalized);
        } else {
            document.body.removeAttribute('data-tag-filter');
        }
        window.DashboardTagCloud?.setActiveTag?.(normalized);
        this.updateTagFilterIndicator();

        if (changed) {
            this.renderDashboard({ animate: Boolean(animate) });
        }
    }

    clearTagFilter() {
        this.applyTagFilter('', { animate: true });
    }

    getBookmarksForTagFilter(tag) {
        const normalized = String(tag || '').trim().toLowerCase();
        if (!normalized || !Array.isArray(this.bookmarks)) {
            return [];
        }
        const seen = new Set();
        const matched = [];
        for (const bookmark of this.bookmarks) {
            const tags = (bookmark.tags || [])
                .map((raw) => String(raw || '').trim().toLowerCase())
                .filter(Boolean);
            if (!tags.includes(normalized)) {
                continue;
            }
            const key = `${String(bookmark.url || '').trim()}|${String(bookmark.name || '').trim()}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            matched.push(bookmark);
        }
        return this.sortBookmarks(matched);
    }

    renderTagFilterDashboard(container, options = {}) {
        const animate = options && options.animate === true;
        this._renderAnimationsEnabled = animate;
        const tag = this._tagFilter;
        const matched = this.getBookmarksForTagFilter(tag);
        const CHUNK_SIZE = 10;

        container.innerHTML = '';
        container.classList.remove('page-transition', 'tag-filter-layout');
        const gridLayout = this.syncDashboardGridLayout();
        container.classList.add('tag-filter-view');

        if (matched.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state empty-state--tag-filter';
            empty.textContent = this.language?.t?.('dashboard.tagFilterEmpty', 'No bookmarks with this tag on this page.') || 'No bookmarks with this tag on this page.';
            container.appendChild(empty);
            if (this.language?.applyTranslations) {
                this.language.applyTranslations();
            }
            this.updateSearchComponent();
            this.updateTagFilterIndicator();
            return;
        }

        const chunkBlocks = [];
        for (let offset = 0; offset < matched.length; offset += CHUNK_SIZE) {
            const chunk = matched.slice(offset, offset + CHUNK_SIZE);
            const chunkIndex = Math.floor(offset / CHUNK_SIZE);
            chunkBlocks.push(
                this.createCategoryElement(
                    {
                        id: `__tag_filter_chunk_${chunkIndex}`,
                        name: '',
                        tagFilterChunk: true,
                    },
                    chunk
                )
            );
        }

        const body = document.createElement('div');
        this._copyDashboardGridLayoutToElement(body, container);
        this._distributeTagFilterColumnBlocks(body, chunkBlocks, { animate, gridLayout });
        container.appendChild(body);

        if (animate) {
            requestAnimationFrame(() => {
                container.classList.add('page-transition');
                setTimeout(() => container.classList.remove('page-transition'), ANIM.PAGE_TRANSITION);
            });
        }

        this.updateSearchComponent();
        this.updateTagFilterIndicator();
        this.syncBookmarkGridA11y();
        this.keyboardNavigation?.scheduleUpdate?.();
        if (this.statusMonitor) {
            if (this.statusMonitorInitialized) {
                this.statusMonitor.updateBookmarks(matched);
            } else {
                this.statusMonitor.init(matched);
                this.statusMonitorInitialized = true;
            }
        }
    }

    initializeStatusMonitor() {
        // Initialize status monitor with current settings
        if (window.StatusMonitor) {
            this.statusMonitor = new window.StatusMonitor(this.settings);
            // Make dashboard instance available globally for status monitor
            window.dashboardInstance = this;
        } else {
            console.warn('StatusMonitor not found. Make sure status.js is loaded.');
        }
    }

    initializeKeyboardNavigation() {
        // Initialize keyboard navigation component
        if (window.KeyboardNavigation) {
            this.keyboardNavigation = new window.KeyboardNavigation(this);
        } else {
            console.warn('KeyboardNavigation not found. Make sure keyboard-navigation.js is loaded.');
        }
    }

    initializeSwipeNavigation() {
        // Initialize swipe navigation component for touch gestures
        if (window.SwipeNavigation) {
            this.swipeNavigation = new window.SwipeNavigation(this);
        } else {
            console.warn('SwipeNavigation not found. Make sure swipe-navigation.js is loaded.');
        }
    }

    initializeHyprMode() {
        // Initialize HyprMode component
        if (window.hyprMode) {
            window.hyprMode.init(this.settings.hyprMode || false, this.language);
        } else {
            console.warn('HyprMode not found. Make sure hypr-mode.js is loaded.');
        }
    }

    // Method to update status monitor when settings change
    updateStatusMonitor() {
        if (this.statusMonitor) {
            this.statusMonitor.updateSettings(this.settings);
        }
    }

    setupPageShortcuts() {
        // Listen for number key presses to switch pages
        document.addEventListener('keydown', (e) => {
            // Only handle number keys 1-9
            // Ignore if user is typing in an input field or if search is active
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }
            
            // Check if shortcut search is active
            const searchElement = document.getElementById('shortcut-search');
            if (searchElement && searchElement.classList.contains('show')) {
                return;
            }

            if (this.isModalOpen()) {
                return;
            }

            if (window.DashboardTagCloud?.modalOpen) {
                if (e.key === '/' && window.DashboardTagCloud.handleSlashKey?.(e)) {
                    return;
                }
                return;
            }
            
            // Don't trigger if Ctrl, Alt, or Meta are pressed (but allow Shift)
            if (e.ctrlKey || e.altKey || e.metaKey) {
                return;
            }

            if (e.key === 'F1') {
                e.preventDefault();
                e.stopPropagation();
                this.showKeyboardCheatSheet();
                return;
            }

            if (e.key === ',') {
                e.preventDefault();
                e.stopPropagation();
                this.showPageOverlay();
                return;
            }

            const key = e.key;

            if (key === '/') {
                if (window.DashboardTagCloud?.handleSlashKey?.(e)) {
                    return;
                }
            }

            // Check if a number key (1-9) was pressed
            if (key === '>') this.markInlineTipUsed('search_open');
            if (key === '?') this.markInlineTipUsed('finder_open');
            if (key === ':') this.markInlineTipUsed('command_open');
            if (key >= '1' && key <= '9') {
                const pageIndex = parseInt(key) - 1;
                
                // Check if this page exists
                if (pageIndex < this.pages.length) {
                    e.preventDefault(); // Prevent default browser behavior
                    e.stopPropagation(); // Stop the event from reaching other listeners
                    
                    const page = this.pages[pageIndex];
                    
                    // Update navigation buttons
                    const navButtons = document.querySelectorAll('.page-nav-btn');
                    navButtons.forEach(btn => btn.classList.remove('active'));
                    if (navButtons[pageIndex]) {
                        navButtons[pageIndex].classList.add('active');
                    }
                    
                    // Load the page
                    this.loadPageBookmarks(page.id);
                    this.updatePageTitle(page.name);
                    this.markInlineTipUsed('page_switch');
                }
            }
            
            // Handle Shift + Arrow keys for page navigation
            if (e.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
                e.preventDefault();
                e.stopPropagation();
                
                // Find current page index
                const currentIndex = this.pages.findIndex(page => page.id === this.currentPageId);
                if (currentIndex === -1) return;
                
                let newIndex;
                if (key === 'ArrowLeft') {
                    // Previous page
                    newIndex = currentIndex > 0 ? currentIndex - 1 : this.pages.length - 1;
                } else {
                    // Next page
                    newIndex = currentIndex < this.pages.length - 1 ? currentIndex + 1 : 0;
                }
                
                const page = this.pages[newIndex];
                
                // Update navigation buttons
                const navButtons = document.querySelectorAll('.page-nav-btn');
                navButtons.forEach(btn => btn.classList.remove('active'));
                if (navButtons[newIndex]) {
                    navButtons[newIndex].classList.add('active');
                }
                
                // Load the page
                this.loadPageBookmarks(page.id);
                this.updatePageTitle(page.name);
                this.markInlineTipUsed('page_switch');
            }
        });
    }

    setupTagFilterEscapeShortcut() {
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (window.DashboardTagCloud?.modalOpen) return;
            if (this.isModalOpen()) return;
            if (this.searchComponent && this.searchComponent.isActive()) return;
            if (!this._tagFilter) return;
            e.preventDefault();
            e.stopPropagation();
            window.DashboardTagCloud?.clearDashboardFilter?.();
        });
    }

    setupTagFilterIndicator() {
        this.updateTagFilterIndicator();
    }

    formatTagFilterCountLabel(count) {
        if (count === 1) {
            return this.language?.t('dashboard.tagFilterCountOne') || '1 bookmark';
        }
        return (this.language?.t('dashboard.tagFilterCountMany') || '{count} bookmarks')
            .replace('{count}', String(count));
    }

    updateTagFilterIndicator() {
        const wrap = document.getElementById('tag-filter-indicator');
        if (!wrap) return;
        this.tagFilterIndicator = wrap;

        const tag = this._tagFilter;
        wrap.replaceChildren();

        if (!tag) {
            wrap.hidden = true;
            this.tagFilterIndicatorChip = null;
            this.tagFilterIndicatorClear = null;
            return;
        }

        const count = this.getBookmarksForTagFilter(tag).length;
        const countLabel = this.formatTagFilterCountLabel(count);
        const chipAria = (this.language?.t('dashboard.tagFilterChipAria')
            || 'Tag filter active: {tag}, {count} on this page')
            .replace('{tag}', tag)
            .replace('{count}', countLabel);
        const clearAria = this.language?.t('dashboard.tagFilterChipClear') || 'Clear tag filter';

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tag-filter-indicator-chip';
        chip.setAttribute('aria-label', chipAria);

        const prefix = document.createElement('span');
        prefix.className = 'tag-filter-indicator-prefix';
        prefix.setAttribute('aria-hidden', 'true');
        prefix.textContent = '#';

        const tagEl = document.createElement('span');
        tagEl.className = 'tag-filter-indicator-tag';
        tagEl.textContent = tag;

        const countEl = document.createElement('span');
        countEl.className = 'tag-filter-indicator-count';
        countEl.textContent = countLabel;

        chip.append(prefix, tagEl, countEl);
        chip.addEventListener('click', () => {
            if (window.DashboardTagCloud?.isEligible?.()) {
                window.DashboardTagCloud.openModal();
            }
        });

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'tag-filter-indicator-clear';
        clearBtn.setAttribute('aria-label', clearAria);
        clearBtn.textContent = '×';
        clearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.clearTagFilter();
            window.DashboardTagCloud?.restoreBookmarkFocus?.();
        });

        wrap.append(chip, clearBtn);
        wrap.hidden = false;

        this.tagFilterIndicatorChip = chip;
        this.tagFilterIndicatorTag = tagEl;
        this.tagFilterIndicatorCount = countEl;
        this.tagFilterIndicatorClear = clearBtn;
    }

    setupReorderUndoShortcut() {
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (window.DashboardTagCloud?.modalOpen) return;
            if (this.isModalOpen()) return;
            if (this.searchComponent && this.searchComponent.isActive()) return;
            if (this._tagFilter) return;

            if (!this.pendingReorderSnapshot) return;
            e.preventDefault();
            e.stopPropagation();
            this.undoPendingReorder();
        });
    }

    setupPasteToQuickAdd() {
        document.addEventListener('paste', (e) => {
            if (this.settings?.pasteUrlQuickAdd === false) return;
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
            if (this.isModalOpen()) return;
            if (this.searchComponent && this.searchComponent.isActive()) return;

            const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
            const trimmed = text.trim().split(/\s/)[0];
            const looksLikeUrl = trimmed && (
                /^https?:\/\/.+/i.test(trimmed)
                || /^[\w.-]+\.[a-z]{2,}/i.test(trimmed)
            );
            if (!looksLikeUrl) return;

            e.preventDefault();

            const handler = this.searchComponent?.commandsComponent?.newCommandHandler;
            if (!handler) return;

            handler.openModal({ url: trimmed });
        });
    }

    setupHeaderEnhancements() {
        document.getElementById('page-overview-header-btn')?.addEventListener('click', () => {
            this.showPageOverlay();
        });
        document.getElementById('quick-add-toolbar-btn')?.addEventListener('click', () => {
            if (this.quickAddWidget) {
                this.quickAddWidget.open();
            } else {
                this.searchComponent?.commandsComponent?.newCommandHandler?.openModal();
            }
        });
    }

    updateMiniStatusLine() {
        const el = document.getElementById('dashboard-mini-status');
        if (!el) return;
        const dateLine = document.querySelector('.date-time-line')?.textContent?.trim() || '';
        const page = this.pages.find((p) => p.id === this.currentPageId);
        const pageName = page?.name || '';
        const badge = document.querySelector('.health-link a .health-badge');
        const parts = [];
        if (dateLine) parts.push(dateLine);
        if (pageName) parts.push(pageName);
        if (badge) {
            const badgeText = badge.textContent.trim();
            if (badgeText) parts.push(badgeText);
        }
        if (!parts.length) {
            el.hidden = true;
            el.textContent = '';
            return;
        }
        el.hidden = false;
        el.textContent = parts.join(' · ');
    }

    openEmptyStateAdd() {
        if (this.quickAddWidget) {
            this.quickAddWidget.open();
            return;
        }
        this.searchComponent?.commandsComponent?.newCommandHandler?.openModal();
    }

    openEmptyStateCommand(commandPrefix) {
        if (!this.searchComponent || !commandPrefix) return;
        this.searchComponent.openSearchInterface();
        this.searchComponent.currentQuery = commandPrefix;
        this.searchComponent.updateSearch();
        this.searchComponent.renderSearchMatches();
    }

    refreshAddBookmarkToolbarLabel() {
        const btn = document.getElementById('quick-add-toolbar-btn');
        const label = btn?.querySelector('.search-button-label');
        if (!label) return;
        label.textContent = this.language?.t('dashboard.addBookmarkShort') || 'bookmark';
    }

    shouldShowEmptyStateKeyboardActions() {
        return !this.isCoarsePointer() && window.MobileExperience?.isMobileLayout?.() !== true;
    }

    buildEmptyStateAddLabel() {
        if (this.isCoarsePointer()) {
            return this.language?.t('dashboard.emptyStateAddAction') || '+ bookmark';
        }
        return this.language?.t('dashboard.emptyStateAddAction') || '+ bookmark';
    }

    buildEmptyStateAddHint() {
        if (this.isCoarsePointer()) {
            return this.language?.t('dashboard.emptyStateAddTouch') || 'Tap + bookmark in the bar below';
        }
        return this.language?.t('dashboard.emptyStateAddDesktop') || 'Press + for the full add-bookmark form (& for quick-add line)';
    }

    createHealthCountBadge(count, type) {
        const badge = document.createElement('span');
        const n = count > 99 ? '99+' : String(count);
        const brokenLabel = this.language?.t('dashboard.healthBrokenShort') || 'broken';
        const warnLabel = this.language?.t('dashboard.healthWarnShort') || 'warnings';
        const isBroken = type === 'broken';
        badge.className = isBroken
            ? 'health-badge health-badge--labeled'
            : 'health-badge health-badge-warn health-badge--labeled';
        badge.textContent = `${n} ${isBroken ? brokenLabel : warnLabel}`;
        const ariaKey = isBroken ? 'dashboard.healthBrokenAria' : 'dashboard.healthWarnAria';
        const ariaFallback = isBroken ? '{count} broken bookmarks' : '{count} bookmarks with warnings';
        const ariaTemplate = this.language?.t(ariaKey) || ariaFallback;
        badge.setAttribute('aria-label', ariaTemplate.replace('{count}', n));
        return badge;
    }

    setupToolbarKbdTooltips() {
        if (this.isCoarsePointer()) return;

        let tip = document.getElementById('toolbar-kbd-tooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'toolbar-kbd-tooltip';
            tip.className = 'toolbar-kbd-tooltip';
            tip.setAttribute('role', 'tooltip');
            tip.setAttribute('aria-hidden', 'true');
            document.body.appendChild(tip);
        }

        const formatKeys = (keysList) => {
            const SF = window.ShortcutFormat;
            if (!SF || typeof SF.keysToHtml !== 'function') {
                return keysList.map((k) => `<kbd>${k}</kbd>`).join('<span class="kbd-sep">+</span>');
            }
            return keysList.map((k) => SF.keysToHtml(k)).join('<span class="kbd-sep">·</span>');
        };

        const defs = [
            { id: 'quick-add-toolbar-btn', labelKey: 'dashboard.tooltipAddBookmark', keys: ['+'] },
            { id: 'search-button', labelKey: 'dashboard.tooltipSearch', keys: ['>'] },
            { id: 'commands-button', labelKey: 'dashboard.tooltipCommands', keys: [':'] },
            { id: 'finders-button', labelKey: 'dashboard.tooltipFinders', keys: ['?'] },
            { id: 'recent-bookmarks-button', labelKey: 'dashboard.tooltipRecent', keys: ['*'] },
            { id: 'help-button', labelKey: 'dashboard.tooltipCheatsheet', keys: ['!', 'F1'] }
        ];

        const toolbarButtons = [];
        const defByButton = new Map();

        defs.forEach((def) => {
            const btn = def.id ? document.getElementById(def.id) : document.querySelector(def.selector);
            if (!btn) return;
            toolbarButtons.push(btn);
            defByButton.set(btn, def);
            btn.removeAttribute('data-tooltip');
            btn.removeAttribute('data-i18n-tooltip');
        });

        const hide = () => {
            tip.classList.remove('is-visible');
            tip.setAttribute('aria-hidden', 'true');
            tip.removeAttribute('data-for');
        };

        const show = (btn, labelKey, keys) => {
            const label = this.language?.t(labelKey) || labelKey;
            tip.replaceChildren();
            const labelSpan = document.createElement('span');
            labelSpan.className = 'toolbar-kbd-tooltip-label';
            labelSpan.textContent = label;
            const keysSpan = document.createElement('span');
            keysSpan.className = 'toolbar-kbd-tooltip-keys';
            keysSpan.innerHTML = formatKeys(keys);
            tip.append(labelSpan, keysSpan);
            const rect = btn.getBoundingClientRect();
            tip.classList.add('is-visible');
            tip.setAttribute('aria-hidden', 'false');
            tip.dataset.for = btn.id || 'toolbar-btn';
            tip.style.left = `${rect.left + rect.width / 2}px`;
            tip.style.top = `${rect.top}px`;
        };

        const syncToolbarKbdTooltip = () => {
            const hoveredBtn = toolbarButtons.find((btn) => btn.matches(':hover'));
            if (hoveredBtn) {
                const def = defByButton.get(hoveredBtn);
                if (def) show(hoveredBtn, def.labelKey, def.keys);
                return;
            }
            const focusedBtn = toolbarButtons.find((btn) => btn.matches(':focus-visible'));
            if (focusedBtn) {
                const def = defByButton.get(focusedBtn);
                if (def) show(focusedBtn, def.labelKey, def.keys);
                return;
            }
            hide();
        };

        if (this._toolbarKbdTooltipSync) {
            document.removeEventListener('pointermove', this._toolbarKbdTooltipSync);
            document.removeEventListener('focusin', this._toolbarKbdTooltipSync);
            document.removeEventListener('focusout', this._toolbarKbdTooltipSync);
        }
        this._toolbarKbdTooltipSync = syncToolbarKbdTooltip;
        document.addEventListener('pointermove', syncToolbarKbdTooltip, { passive: true });
        document.addEventListener('focusin', syncToolbarKbdTooltip);
        document.addEventListener('focusout', syncToolbarKbdTooltip);

        if (!this._toolbarKbdTooltipDocBound) {
            this._toolbarKbdTooltipDocBound = true;
            window.addEventListener('scroll', hide, { passive: true, capture: true });
            window.addEventListener('blur', hide);
        }

        hide();
        syncToolbarKbdTooltip();
    }

    setupToolbarActions() {
        this.setupToolbarKbdTooltips();
        const helpButton = document.getElementById('help-button');
        if (helpButton) {
            helpButton.addEventListener('click', () => {
                this.showKeyboardCheatSheet();
            });
        }
        const searchButton = document.getElementById('search-button');
        if (searchButton) {
            searchButton.addEventListener('click', () => this.markInlineTipUsed('search_open'));
        }
        const findersButton = document.getElementById('finders-button');
        if (findersButton) {
            findersButton.addEventListener('click', () => this.markInlineTipUsed('finder_open'));
        }
        const commandsButton = document.getElementById('commands-button');
        if (commandsButton) {
            commandsButton.addEventListener('click', () => this.markInlineTipUsed('command_open'));
        }
        const recentButton = document.getElementById('recent-bookmarks-button');
        if (recentButton) {
            recentButton.addEventListener('click', () => {
                this.toggleRecentBookmarksModal();
            });
        }

        // What's new FAB (opposite corner from button bar)
        const whatsNewBtn = document.getElementById('whats-new-btn');
        if (whatsNewBtn) {
            whatsNewBtn.addEventListener('click', () => {
                window.openWhatsNewModal?.({ force: true });
            });
        }


        // Launcher tile dimming: dim non-matching tiles when search is active
        document.addEventListener('nextdash:find', (e) => {
            this.applyFindFilter(e.detail.query);
        });

        document.addEventListener('nextdash:launcher-filter', (e) => {
            const grid = document.getElementById('dashboard-layout');
            if (!grid || !grid.classList.contains('layout-launcher')) return;
            const { active, urls } = e.detail;
            grid.querySelectorAll('.bookmark-link').forEach(tile => {
                const href = tile.querySelector('a.bookmark-open')?.href || '';
                if (!active || urls.size === 0) {
                    tile.classList.remove('launcher-dim');
                } else {
                    tile.classList.toggle('launcher-dim', !urls.has(href));
                }
            });
        });

        document.addEventListener('keydown', (e) => {
            const isTypingContext = Boolean(
                e.target && (
                    e.target.tagName === 'INPUT' ||
                    e.target.tagName === 'TEXTAREA' ||
                    e.target.isContentEditable
                )
            );

            if (isTypingContext) {
                return;
            }

            if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === '*') {
                e.preventDefault();
                this.toggleRecentBookmarksModal();
            }

            if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === '!') {
                if (this.isModalOpen()) {
                    return;
                }
                if (this.searchComponent && this.searchComponent.isActive()) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                this.showKeyboardCheatSheet();
            }
        });
    }

    maybeShowPasteSpotlight() {
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return;
        if (typeof window.FeatureSpotlight !== 'function') return;
        if (this.onboardingStartedInSession) return;

        const spotlight = new window.FeatureSpotlight({
            language: this.language,
            onTry: () => {
                const handler = this.searchComponent?.commandsComponent?.newCommandHandler;
                if (handler) handler.openModal();
            },
        });
        spotlight.show(1400);
        this.pasteSpotlight = spotlight;
    }

    maybeShowWhatsNew() {
        if (this.onboardingStartedInSession || (typeof this.isModalOpen === 'function' && this.isModalOpen())) {
            return;
        }
        this.showWhatsNewModal({ force: false });
    }

    showWhatsNewModal(options = {}) {
        if (typeof window.openWhatsNewModal !== 'function') {
            return;
        }
        const force = options.force === true;
        window.openWhatsNewModal({
            force,
            ifBlockingModalOpen: force ? undefined : () => this.isModalOpen()
        });
    }

    initializeOnboarding() {
        if (typeof window.Onboarding !== 'function') {
            this.onboardingStartedInSession = false;
            return;
        }
        const dash = this;
        const onboarding = new window.Onboarding({
            hasBookmarks: Array.isArray(this.bookmarks) && this.bookmarks.length > 0,
            serverCompleted: dash.settings?.onboardingCompleted === true,
            settings: dash.settings,
            language: dash.language,
            mobileCompact: window.MobileExperience?.shouldSkipHeavyUi?.() === true,
            onApplySettings: (nextSettings) => {
                dash.settings = nextSettings;
                dash.setupDOM();
                dash.initializeAutoDarkMode();
                dash.renderPageNavigation();
                dash.renderDashboard();
                dash.updateSearchComponent();
                dash.onboardingStartedInSession = false;
            },
            onPersist: async () => {
                dash.settings.onboardingCompleted = true;
                if (dash.settings.showTips !== false) {
                    dash.settings.showTips = true;
                }
                if (
                    dash.settings.showTips !== false &&
                    window.TipsPolicy &&
                    typeof window.TipsPolicy.startPromoPeriod === 'function' &&
                    window.MobileExperience?.shouldShowDiscoverabilityUi?.() !== false
                ) {
                    window.TipsPolicy.startPromoPeriod();
                }
                document.body.setAttribute('data-show-tips', dash.areRotatingTipsEnabled() ? 'true' : 'false');
                await dash.saveSettings();
                dash.initializeButtonTipsRotation();
                dash.onboardingStartedInSession = false;
                if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() !== false) {
                    dash.discoverabilityQueue?.scheduleRun({ afterOnboarding: true });
                }
            }
        });
        this.onboardingStartedInSession = onboarding.shouldStart();
        if (this.onboardingStartedInSession) {
            try {
                localStorage.removeItem('nextdash:feature-tour-spotlight-v1');
                localStorage.removeItem('nextdash:recent-open-spotlight-v1');
                localStorage.removeItem('nextdash:search-flow-hint-v1');
            } catch {}
        }
        onboarding.maybeStart();
    }

    initializeFeatureTour() {
        if (window.MobileExperience?.shouldSkipHeavyUi?.()) return;
        const params = new URLSearchParams(window.location.search);
        if (params.has('tour')) {
            params.delete('tour');
            const clean = params.toString();
            history.replaceState(null, '', clean ? `?${clean}` : window.location.pathname);
            this.startFeatureTour();
        }
    }

    initializeConfigBookmarksTour() {
        if (window.MobileExperience?.shouldSkipHeavyUi?.()) return;
        if (typeof window.ConfigBookmarksTour?.maybeStartDashboardPhase !== 'function') return;
        this._configBookmarksTour = window.ConfigBookmarksTour.maybeStartDashboardPhase(this);
    }

    startFeatureTour(onFinish) {
        if (window.MobileExperience?.shouldSkipHeavyUi?.()) return;
        if (typeof window.FeatureTour !== 'function') return;
        if (this.featureTour) this.featureTour.finish?.();
        const dash = this;
        this.featureTour = new window.FeatureTour({
            settings: dash.settings,
            language: dash.language,
            onApplySettings: (nextSettings) => {
                dash.settings = nextSettings;
                dash.setupDOM();
                dash.renderPageNavigation();
                dash.renderDashboard();
                dash.updateSearchComponent();
            },
            onPersist: async () => {
                await dash.saveSettings();
                if (typeof onFinish === 'function') onFinish();
            }
        });
        this.featureTour.start();
    }

    maybeShowTourSpotlight() {
        this.discoverabilityQueue?.scheduleRun();
    }

    initializeButtonTipsRotation() {
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) {
            document.body.setAttribute('data-show-tips', 'false');
            return;
        }
        this.initializeSearchFlowHint();
        const hintEl = document.getElementById('button-hint-text');
        if (!hintEl) {
            return;
        }
        if (this.tipRotationTimer) {
            clearTimeout(this.tipRotationTimer);
            this.tipRotationTimer = null;
        }

        const tipsEnabled = this.areRotatingTipsEnabled();
        document.body.setAttribute('data-show-tips', tipsEnabled ? 'true' : 'false');
        if (!tipsEnabled) {
            return;
        }

        const tip = (key, fallback = '') => {
            const fullKey = `dashboard.${key}`;
            const v = this.language?.t?.(fullKey);
            if (v && v !== fullKey) return v;
            return fallback || null;
        };
        const tips = (...entries) => entries.map(([key, fb]) => tip(key, fb)).filter(Boolean);
        const tipKeys = (...keys) => keys.map((key) => tip(key)).filter(Boolean);

        const priorityTips = tips(
            ['tipRecentStarShort', 'Tip: <code>*</code> recent'],
            ['tipOpenLastRecent', 'Tip: <code>*</code> shows recent bookmarks — <code>:open last 5</code> in command mode opens them in tabs'],
            ['tipCheatsheetBang', 'Tip: <code>!</code> cheatsheet'],
            ['tipNavigateArrows', 'Tip: <code>↑/↓</code> navigate bookmarks'],
            ['tipEditSemicolon', 'Tip: <code>;</code> edit bookmark (highlighted row or focused link)'],
            ['tipCheatsheetCtrlSlash', 'Tip: <code>F1</code> cheatsheet'],
            ['tipPreviewBracket', 'Tip: <code>[</code> preview card on keyboard-selected bookmark'],
            ['tipCopyUrlCtrlC', 'Tip: <code>Ctrl+C</code> copy URL of keyboard-selected bookmark'],
            ['tipDragStripInlineEdit', 'Tip: left strip = drag reorder; long-press row (not strip) = inline edit'],
        ).concat(tipKeys('tipNewBookmarkAmpersand'));

        const normalTips = tips(
            ['tipSearchCommandFinder', 'Tip: <code>&gt;</code> search, <code>:</code> commands, <code>?</code> finders'],
            ['tipOpenSearch', 'Tip: <code>&gt;</code> open search'],
            ['tipOpenFinders', 'Tip: <code>?</code> open finders'],
            ['tipOpenCommands', 'Tip: <code>:</code> open commands'],
            ['tipJumpToPage', 'Tip: <code>1-9</code> jump to page'],
            ['tipPageOverview', 'Tip: <code>,</code> page overview — see all pages with bookmark counts'],
            ['tipQuickAddAmpersand', 'Tip: <code>&amp;</code> quick-add — name | url | shortcut in one field'],
            ['tipSwitchPage', 'Tip: <code>Shift+←/→</code> switch page'],
            ['tipEnterOpenBookmark', 'Tip: <code>Enter</code> open selected bookmark'],
            ['tipSpaceOpenBookmark', 'Tip: <code>Space</code> open selected bookmark'],
            ['tipInlineEditSemicolon', 'Tip: <code>;</code> inline-edit selected bookmark'],
            ['tipHoverPreview', 'Tip: hover bookmark (name/icon area) to load preview when enabled'],
            ['tipEnableLinkPreview', 'Tip: enable link preview cards in config → general → advanced → bookmarks'],
            ['tipEscCancel', 'Tip: <code>Esc</code> cancel current state'],
            ['tipAltReorderConfig', 'Tip: <code>Alt+↑/↓</code> reorder in config'],
            ['tipSearchCategory', 'Tip: use <code>category:work</code> in search'],
            ['tipSearchTag', 'Tip: use <code>tag:work</code> in search to filter by tag'],
            ['tipSearchStatus', 'Tip: use <code>status:online</code> in search'],
            ['tipSearchPage', 'Tip: use <code>page:2</code> in search'],
            ['tipFinderShortcut', 'Tip: use <code>?g term</code> finder shortcut'],
            ['tipAddTagsConfig', 'Tip: add tags to bookmarks in <code>config</code> → bookmarks'],
            ['tipDynamicCollections', 'Tip: create dynamic collections in <code>config</code> → collections'],
            ['tipTagCollections', 'Tip: enable tag collections in <code>config</code> → general → Smart Collections'],
            ['tipBackupsConfig', 'Tip: backups under <code>config</code> → general → Backup & restore'],
            ['tipCollapseCategory', 'Tip: click a category header to collapse or expand it'],
            ['tipGlobalShortcuts', 'Tip: global shortcuts from all pages in <code>config</code> → general → Dashboard'],
            ['tipLayoutPreset', 'Tip: layout preset & density in <code>config</code> → general → Basics'],
            ['tipLongPressInlineEdit', 'Tip: long-press a bookmark row (not the drag strip) to edit inline'],
            ['tipHealthPage', 'Tip: visit <code>health</code> page to find broken links and duplicates'],
            ['tipHealthFilters', 'Tip: use filters in <code>health</code> page to focus on specific issues'],
            ['tipHealthRefresh', 'Tip: <code>refresh</code> in health page re-scans all bookmarks'],
            ['tipHealthStale', 'Tip: check health page <code>stale</code> bookmarks you haven\'t used recently'],
            ['tipHealthMerge', 'Tip: merge duplicate bookmarks in health page bulk actions'],
            ['tipCommandNote', 'Tip: use <code>:note</code> in the command palette to edit a bookmark\'s note instantly'],
            ['tipInlineRename', 'Tip: double-click a page tab or category title to rename it inline'],
            ['tipPreviewCopyUrl', 'Tip: hover a preview card and click the clipboard icon to copy the URL'],
            ['tipCompactBadge', 'Tip: compact/dense mode shows an open-count badge on each bookmark'],
            ['tipConfigSearchBar', 'Tip: use the search bar in config → bookmarks to filter by name, URL, tag, or note'],
            ['tipThemeToggle', 'Tip: the dark/light toggle button in the header flips the theme variant instantly'],
            ['tipHealthFavicon', 'Tip: use <code>favicon</code> button in health view to refresh a bookmark\'s icon'],
            ['tipNewBookmarkTags', 'Tip: add tags when creating a bookmark via <code>:new</code> — autocomplete suggests existing tags'],
        );
        if (this.settings?.showTagCloudButton === true) {
            normalTips.push(...tips(
                ['tipTagCloudSlash', 'Tip: press <code>/</code> for the tag word cloud (desktop) — pick a tag to filter bookmarks on the dashboard'],
            ));
        }
        normalTips.push(
            ...tipKeys(
                'tipUndoDelete',
                'tipFaviconToggle',
                'tipPackedColumns',
                'tipHideShortcutPin',
                'tipKeyboardTab',
                'tipDisableTips',
                'tipDisableTipsAlt',
                'tipNewBookmarkAmpersandShort',
            ),
        );

        let normalCounter = 0;
        const run = () => {
            if (!this.areRotatingTipsEnabled()) {
                document.body.setAttribute('data-show-tips', 'false');
                return;
            }
            const currentContextTips = this.getInlineContextTipsForCurrentPage();
            if (currentContextTips.length > 0) {
                hintEl.innerHTML = currentContextTips[this.contextTipRotationIndex % currentContextTips.length];
                this.contextTipRotationIndex += 1;
            } else {
                const showPriority = normalCounter >= 5;
                if (showPriority) {
                    hintEl.innerHTML = priorityTips[this.tipPriorityIndex % priorityTips.length];
                    this.tipPriorityIndex += 1;
                    normalCounter = 0;
                } else {
                    hintEl.innerHTML = normalTips[this.tipRotationIndex % normalTips.length];
                    this.tipRotationIndex += 1;
                    normalCounter += 1;
                }
            }
            const delay = 5000 + Math.floor(Math.random() * 3001); // 5-8s
            this.tipRotationTimer = setTimeout(run, delay);
        };
        run();
    }

    scheduleBackupTip() {
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) {
            return;
        }
        if (this.backupTipShown || this.backupTipTimer) {
            return;
        }

        const hintEl = document.getElementById('button-hint-text');
        if (!hintEl) {
            return;
        }

        if (!this.areRotatingTipsEnabled()) {
            return;
        }

        this.backupTipTimer = setTimeout(() => {
            this.backupTipTimer = null;
            if (this.backupTipShown) {
                return;
            }

            const currentHintEl = document.getElementById('button-hint-text');
            if (!currentHintEl || !this.areRotatingTipsEnabled()) {
                return;
            }

            this.backupTipShown = true;
            currentHintEl.innerHTML = this.language ? this.language.t('dashboard.tipBackup') : 'Tip: create a backup via <a class="button-hint-link" href="/config#backups">config → backups</a>.';
        }, 30000);
    }

    initializeSearchFlowHint() {
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return;
        const hintEl = document.getElementById('search-flow-hint');
        if (!hintEl) return;

        if (this.isCoarsePointer()) {
            hintEl.querySelectorAll('.sfh-seg-swipe').forEach((el) => el.classList.remove('hidden'));
        }

        const storageKey = 'nextdash:search-flow-hint-v2';
        try {
            if (localStorage.getItem(storageKey)) return;
        } catch {}

        hintEl.hidden = false;
        try { localStorage.setItem(storageKey, '1'); } catch {}

        // CSS handles the staggered wipe animation on .sfh-seg spans.
        // Last segment delay is 2.22s + 0.3s duration; dismiss after segments + reading time.
        setTimeout(() => {
            hintEl.classList.add('dismissing');
            setTimeout(() => { hintEl.hidden = true; }, 500);
        }, 6200);
    }
    getInlineTipUsageState() {
        try {
            const raw = localStorage.getItem(this.inlineTipUsageStorageKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return {};
            }
            return parsed;
        } catch {
            return {};
        }
    }

    getCurrentPageTipUsage() {
        const state = this.getInlineTipUsageState();
        const pageKey = String(Number(this.currentPageId) || this.currentPageId || 'default');
        const pageState = state[pageKey];
        if (!pageState || typeof pageState !== 'object' || Array.isArray(pageState)) {
            return {};
        }
        return pageState;
    }

    markInlineTipUsed(tipKey) {
        if (!tipKey) return;
        try {
            const state = this.getInlineTipUsageState();
            const pageKey = String(Number(this.currentPageId) || this.currentPageId || 'default');
            if (!state[pageKey] || typeof state[pageKey] !== 'object' || Array.isArray(state[pageKey])) {
                state[pageKey] = {};
            }
            if (state[pageKey][tipKey] === true) {
                return;
            }
            state[pageKey][tipKey] = true;
            localStorage.setItem(this.inlineTipUsageStorageKey, JSON.stringify(state));
            this.initializeButtonTipsRotation();
        } catch {
            // ignore localStorage errors
        }
    }

    getInlineContextTipsForCurrentPage() {
        const usage = this.getCurrentPageTipUsage();
        const tips = [];
        if (!usage.search_open) {
            tips.push(this.language?.t?.('dashboard.contextTipSearchOpen') || 'Tip: <code>&gt;</code> open search (hides after first use on this page)');
        }
        if (!usage.finder_open) {
            tips.push(this.language?.t?.('dashboard.contextTipFinderOpen') || 'Tip: <code>?</code> open finders (hides after first use on this page)');
        }
        if (!usage.command_open) {
            tips.push(this.language?.t?.('dashboard.contextTipCommandOpen') || 'Tip: <code>:</code> open commands (hides after first use on this page)');
        }
        if (!usage.bookmark_open) {
            tips.push(this.language?.t?.('dashboard.contextTipBookmarkOpen') || 'Tip: open any bookmark once on this page to hide this tip');
        }
        if (Array.isArray(this.pages) && this.pages.length > 1 && !usage.page_switch) {
            tips.push(this.language?.t?.('dashboard.contextTipPageSwitch') || 'Tip: switch page with <code>1-9</code> or <code>Shift+←/→</code> to hide this tip');
        }
        return tips;
    }

    isModalOpen() {
        return Boolean(document.querySelector('.modal-overlay.show'));
    }

    showKeyboardCheatSheet() {
        if (!window.AppModal) {
            return;
        }

        const sections = this.getKeyboardCheatSheetItems();
        const formatKeys = (keys) => {
            if (window.ShortcutFormat && typeof window.ShortcutFormat.keysToHtml === 'function') {
                return window.ShortcutFormat.keysToHtml(keys);
            }
            return keys;
        };
        const filterPlaceholder = this.language?.t('dashboard.cheatsheetFilterPlaceholder') || 'Filter shortcuts…';
        const html = `
            <div class="keyboard-cheat-sheet">
                <input type="text" id="cheat-sheet-filter" class="cheat-sheet-filter"
                       placeholder="${filterPlaceholder}" autocomplete="off" spellcheck="false"
                       aria-label="${filterPlaceholder}">
                ${sections.map((section, i) => `
                    <details class="cheat-sheet-group" ${i === 0 ? 'open' : ''}>
                        <summary class="cheat-sheet-group-title">${section.title}</summary>
                        <table class="keyboard-cheat-sheet-table">
                            <tbody>
                                ${section.items.map((shortcut) => `
                                    <tr>
                                        <td class="keyboard-cheat-sheet-keys">${formatKeys(shortcut.keys)}</td>
                                        <td class="keyboard-cheat-sheet-description">${shortcut.description}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </details>
                `).join('')}
            </div>
        `;

        window.AppModal.show({
            title: this.language?.t('dashboard.cheatsheetTitle') || 'keyboard shortcuts',
            htmlMessage: html,
            confirmText: this.language?.t('dashboard.cheatsheetClose') || 'close',
            showCancel: false,
            modalClass: 'keyboard-cheat-sheet-modal',
        });

        const filterInput = document.getElementById('cheat-sheet-filter');
        if (!filterInput) return;

        setTimeout(() => filterInput.focus(), 60);

        filterInput.addEventListener('input', () => {
            const q = filterInput.value.toLowerCase().trim();
            const groups = document.querySelectorAll('.cheat-sheet-group');
            groups.forEach((group, i) => {
                const rows = group.querySelectorAll('tr');
                let visible = 0;
                rows.forEach(row => {
                    const match = !q || row.textContent.toLowerCase().includes(q);
                    row.style.display = match ? '' : 'none';
                    if (match) visible++;
                });
                if (q) {
                    group.hidden = visible === 0;
                    if (visible > 0) group.open = true;
                } else {
                    group.hidden = false;
                    group.open = i === 0;
                }
            });
        });
    }

    showPageOverlay() {
        if (document.getElementById('page-overview-overlay')) return;

        const pages = Array.isArray(this.pages) ? this.pages : [];
        if (pages.length === 0) return;

        const allBookmarks = Array.isArray(this.allBookmarks) ? this.allBookmarks : [];

        const overlay = document.createElement('div');
        overlay.id = 'page-overview-overlay';
        overlay.className = 'page-overview-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        const isMobileLayout = window.MobileExperience?.isMobileLayout?.() === true;
        if (isMobileLayout) {
            overlay.classList.add('page-overview-overlay--mobile');
        }

        const panel = document.createElement('div');
        panel.className = 'page-overview-panel';

        const header = document.createElement('div');
        header.className = 'page-overview-header';
        const headerTitle = document.createElement('span');
        headerTitle.className = 'page-overview-header-title';
        const pagesLabel = this.language?.t('dashboard.pagesOverview');
        headerTitle.textContent = pagesLabel && pagesLabel !== 'dashboard.pagesOverview'
            ? pagesLabel
            : 'Pages';
        header.appendChild(headerTitle);

        if (isMobileLayout) {
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'page-overview-close';
            const closeLabel = this.language?.t('dashboard.closePageOverview');
            closeBtn.setAttribute(
                'aria-label',
                closeLabel && closeLabel !== 'dashboard.closePageOverview' ? closeLabel : 'Close'
            );
            closeBtn.textContent = '×';
            header.appendChild(closeBtn);
        }

        const ariaLabel = this.language?.t('dashboard.pagesOverviewAria');
        overlay.setAttribute(
            'aria-label',
            ariaLabel && ariaLabel !== 'dashboard.pagesOverviewAria' ? ariaLabel : 'Page overview'
        );
        panel.appendChild(header);

        const list = document.createElement('ul');
        list.className = 'page-overview-list';

        let focusedIndex = pages.findIndex(p => p.id === this.currentPageId);
        if (focusedIndex < 0) focusedIndex = 0;

        pages.forEach((page, idx) => {
            const count = allBookmarks.filter(b => String(b.pageId) === String(page.id)).length;
            const li = document.createElement('li');
            li.className = 'page-overview-item' + (page.id === this.currentPageId ? ' is-current' : '');
            li.setAttribute('data-idx', String(idx));

            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'page-overview-link';
            link.setAttribute('aria-current', page.id === this.currentPageId ? 'page' : 'false');

            const numSpan = document.createElement('span');
            numSpan.className = 'page-overview-num';
            numSpan.textContent = String(idx + 1);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'page-overview-name';
            nameSpan.textContent = page.name || `Page ${idx + 1}`;

            const countSpan = document.createElement('span');
            countSpan.className = 'page-overview-count';
            countSpan.textContent = String(count);

            link.appendChild(numSpan);
            link.appendChild(nameSpan);
            link.appendChild(countSpan);

            link.addEventListener('click', () => {
                close();
                this.loadPageBookmarks(page.id);
            });

            li.appendChild(link);
            list.appendChild(li);
        });

        panel.appendChild(list);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        const items = () => list.querySelectorAll('.page-overview-item');

        const setFocus = (idx) => {
            focusedIndex = Math.max(0, Math.min(pages.length - 1, idx));
            items().forEach((el, i) => {
                el.classList.toggle('is-focused', i === focusedIndex);
                const btn = el.querySelector('.page-overview-link');
                if (i === focusedIndex) {
                    btn?.focus({ preventScroll: true });
                    el.scrollIntoView({ block: 'nearest' });
                }
            });
        };

        const close = () => {
            overlay.remove();
            document.removeEventListener('keydown', onKey, true);
        };

        if (isMobileLayout) {
            header.querySelector('.page-overview-close')?.addEventListener('click', close);
        }

        const onKey = (e) => {
            if (e.key === 'Escape' || e.key === ',') {
                e.preventDefault();
                e.stopPropagation();
                close();
            } else if (e.key === 'ArrowDown' || e.key === 'Tab') {
                e.preventDefault();
                setFocus(focusedIndex + 1);
            } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
                e.preventDefault();
                setFocus(focusedIndex - 1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const page = pages[focusedIndex];
                if (page) { close(); this.loadPageBookmarks(page.id); }
            } else if (e.key >= '1' && e.key <= '9') {
                const idx = parseInt(e.key) - 1;
                if (idx < pages.length) {
                    e.preventDefault();
                    close();
                    this.loadPageBookmarks(pages[idx].id);
                }
            }
        };

        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        document.addEventListener('keydown', onKey, true);

        requestAnimationFrame(() => {
            overlay.classList.add('is-visible');
            setFocus(focusedIndex);
        });
    }

    showOmnibox() {
        if (document.getElementById('omnibox-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'omnibox-overlay';
        overlay.className = 'omnibox-overlay';

        const box = document.createElement('div');
        box.className = 'omnibox-box';

        const t = (key) => this.language && typeof this.language.t === 'function' ? this.language.t(key) : key.split('.').pop();
        const hint = document.createElement('span');
        hint.className = 'omnibox-hint';
        hint.textContent = t('dashboard.quickAddHint');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'omnibox-input';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = t('dashboard.quickAddHint');

        const status = document.createElement('span');
        status.className = 'omnibox-status';

        box.appendChild(hint);
        box.appendChild(input);
        box.appendChild(status);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const close = () => {
            overlay.remove();
            document.removeEventListener('keydown', onKey, true);
        };

        const submit = async () => {
            const raw = input.value.trim();
            if (!raw) { close(); return; }

            const parts = raw.split('|').map(p => p.trim());
            const name = parts[0] || '';
            const url = parts[1] || '';
            const shortcut = (parts[2] || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

            if (!name || !url) {
                status.textContent = t('dashboard.quickAddNameUrlRequired');
                status.classList.add('is-error');
                input.focus();
                return;
            }

            if (shortcut) {
                const duplicate = (this.allBookmarks || []).some(
                    b => (b.shortcut || '').toUpperCase() === shortcut
                );
                if (duplicate) {
                    status.textContent = t('dashboard.quickAddShortcutExists').replace('{shortcut}', shortcut);
                    status.classList.add('is-error');
                    input.focus();
                    return;
                }
            }

            let fullUrl = window.BookmarkUrlUtils?.ensureHttpUrl(url) || url;
            if (!/^https?:\/\//i.test(fullUrl)) fullUrl = 'https://' + url;

            status.textContent = t('dashboard.quickAddFetchingFavicon');
            status.classList.remove('is-error');
            input.disabled = true;

            let icon = '';
            let previewTitle = '';
            let previewDesc = '';
            let previewImage = '';
            try {
                if (window.BookmarkPreviewService) {
                    icon = await window.BookmarkPreviewService.fetchAndUploadFavicon(fullUrl);
                    try {
                        const preview = await window.BookmarkPreviewService.fetchLinkPreview(fullUrl);
                        previewTitle = preview.title || '';
                        previewDesc = preview.description || '';
                        previewImage = preview.image || '';
                    } catch { /* optional */ }
                }
            } catch { /* favicon is optional */ }

            status.textContent = t('dashboard.quickAddAdding');

            try {
                const response = await fetch('/api/bookmarks/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        page: this.currentPageId,
                        bookmark: {
                            name,
                            url: fullUrl,
                            shortcut,
                            category: '',
                            pinned: false,
                            checkStatus: false,
                            icon,
                            previewTitle: previewTitle || undefined,
                            previewDesc: previewDesc || undefined,
                            previewImage: previewImage || undefined,
                            createdAt: Date.now()
                        }
                    })
                });
                if (response.ok) {
                    close();
                    await this.loadPageBookmarks(this.currentPageId);
                    this.showNotification(t('dashboard.quickAddAdded').replace('{name}', name), 'success');
                } else if (response.status === 409) {
                    status.textContent = t('dashboard.quickAddUrlExists');
                    status.classList.add('is-error');
                    input.disabled = false;
                    input.focus();
                } else {
                    status.textContent = t('dashboard.quickAddAddFailed');
                    status.classList.add('is-error');
                    input.disabled = false;
                    input.focus();
                }
            } catch {
                status.textContent = t('dashboard.quickAddNetworkError');
                status.classList.add('is-error');
                input.disabled = false;
                input.focus();
            }
        };

        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
            else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
        };

        document.addEventListener('keydown', onKey, true);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        requestAnimationFrame(() => {
            overlay.classList.add('is-visible');
            input.focus();
        });
    }

    getKeyboardCheatSheetItems() {
        const t = (key, fallback) => {
            if (!this.language?.t) return fallback;
            const fullKey = `dashboard.cheatsheet.${key}`;
            const value = this.language.t(fullKey);
            return value !== fullKey ? value : fallback;
        };
        const item = (keys, key, fallback) => ({ keys, description: t(key, fallback) });
        const section = (titleKey, titleFallback, items) => ({
            title: t(titleKey, titleFallback),
            items,
        });

        return [
            section('sectionNavigation', 'Navigation', [
                item('1–9', 'navPageTab', 'Switch to page tab'),
                item('Shift + ← / →', 'navPrevNextPage', 'Previous / next page'),
                item(',', 'navPageOverview', 'Page overview with bookmark counts'),
                item('↑ / ↓', 'navFocusUpDown', 'Move focus up / down through bookmarks'),
                item('← / →', 'navFocusLeftRight', 'Move focus left / right in grid'),
                item('Home / End', 'navCategoryHomeEnd', 'First / last bookmark in the focused category'),
                item('Ctrl + Home / End', 'navGridHomeEnd', 'First / last bookmark on the page'),
                item('Page Up / Page Down', 'navPageScroll', 'Jump one screen up / down through bookmarks'),
                item('Tab / Shift+Tab', 'navTabLinear', 'Step linearly through all bookmarks'),
                item('G + 1–9', 'navGotoCategory', 'Jump to first bookmark in nth category'),
                item('Enter / Space', 'navOpenFocused', 'Open focused bookmark'),
                item('Esc', 'navEscClear', 'Clear selection / close overlay'),
            ]),
            section('sectionBookmarks', 'Bookmarks', [
                item('&', 'bmQuickAdd', 'Quick-add — type name | url | shortcut in one line'),
                item('Ctrl + V', 'bmPasteUrlModal', 'Paste a URL to open the new-bookmark modal pre-filled'),
                item('+', 'bmNewBookmarkModal', 'Open full new-bookmark modal (+ on dashboard)'),
                item('Ctrl + Shift + A', 'bmNewBookmarkModalGlobal', 'Open full new-bookmark modal from anywhere'),
                item(';', 'bmInlineEdit', 'Inline-edit focused bookmark'),
                item('Shift + M', 'bmQuickMove', 'Quick-move focused bookmark — choose category or page'),
                item('Ctrl + C', 'bmCopyUrl', 'Copy URL of focused bookmark (row flashes green)'),
                item('[', 'bmTogglePreview', 'Toggle hover preview card on focused bookmark'),
                item('Delete', 'bmDelete', 'Delete focused bookmark (confirm, or Delete again in inline edit)'),
                item('Double-click page tab', 'bmRenamePageTab', 'Rename page tab — also set emoji icon and colour dot'),
                item('Double-click category', 'bmRenameCategory', 'Rename category header'),
                item('Drag handle', 'bmDragReorder', 'Reorder within or across categories'),
            ]),
            section('sectionSearchModes', 'Search modes', [
                item('>', 'smRegularSearch', 'Regular search — filter bookmarks on current page by name'),
                item('/', 'smTagCloudSlash', 'Open tag word cloud (desktop); arrow keys select tag or clear filter, Enter apply, Esc close; with interleave search on and modal closed, / can start fuzzy search'),
                item('@', 'smGlobalSearch', 'Global search — fuzzy search across all pages at once; result shows page name as context'),
                item(':', 'smCommandPalette', 'Command palette — type a command name to run it'),
                item('?', 'smFinders', 'Finders — e.g. ?g query to search Google'),
                item('*', 'smRecentPanel', 'Recent bookmarks panel'),
                item('mode chips', 'smModeChips', 'Click › search · : commands · ? finders at the top of the overlay to switch mode instantly'),
                item('category: / tag: / page: / status:', 'smFieldFilters', 'Filter results by field directly in the search bar'),
            ]),
            section('sectionCommandsBookmarks', 'Commands — bookmarks', [
                item(':new', 'cbNew', 'Open new-bookmark modal (same as + / Ctrl+Shift+A)'),
                item(':note', 'cbNote', 'Edit note on the focused bookmark'),
                item(':pin / :unpin', 'cbPin', 'Toggle pin flag on the focused bookmark'),
                item(':tag', 'cbTagList', 'List all tags in the command palette (dashboard layout unchanged)'),
                item(':tag <name>', 'cbTagBrowse', 'Browse bookmarks by tag in the palette — :tag work or :tag:work'),
                item(':tag +name / :tag -name', 'cbTagMutate', 'Add or remove a tag on the focused bookmark — :tag +name / :tag -name'),
                item(':remove', 'cbRemove', 'Delete the focused bookmark'),
                item(':find <text>', 'cbFind', 'Filter bookmark tiles on the current page — hides tiles that don\'t match name or URL'),
                item(':open all', 'cbOpenAll', 'Open every bookmark on the current page in new tabs (capped at 15; offers "open all" above that)'),
                item(':open last [n]', 'cbOpenLast', 'Open the N most recently opened bookmarks on this page (default 5, max 50; tab batch capped at 15)'),
                item(':goto <url or domain>', 'cbGoto', 'Navigate directly — full URLs open as-is, bare domains get https:// prepended'),
                item(':duplicates', 'cbDuplicates', 'Find bookmarks with duplicate URLs across all pages'),
                item(':stale <days>', 'cbStale', 'Show bookmarks not opened in <days> days (default 30)'),
                item(':save / :saved', 'cbSave', 'Save the current search query / show saved searches'),
            ]),
            section('sectionCommandsAppearance', 'Commands — appearance', [
                item(':layout <preset>', 'caLayout', 'Switch layout — default / compact / cards / masonry / list / launcher'),
                item(':theme <name>', 'caTheme', 'Switch colour theme'),
                item(':density <mode>', 'caDensity', 'Change density — comfortable / compact / dense'),
                item(':columns <n>', 'caColumns', 'Set number of columns (1–6)'),
                item(':fontsize <size>', 'caFontsize', 'Change font size'),
                item(':favicons on/off', 'caFavicons', 'Toggle bookmark icons'),
                item(':preview on/off', 'caPreview', 'Toggle hover preview cards'),
                item(':packed on/off', 'caPacked', 'Toggle packed (variable-width) columns'),
                item(':buttonbar <position>', 'caButtonbar', 'Move the button bar — bottom (default) / bottom-left / bottom-right'),
                item(':sort <method>', 'caSort', 'Change sort order — order / az / recent / custom'),
            ]),
            section('sectionOther', 'Other', [
                item('! or F1', 'otCheatSheet', 'This cheat sheet'),
                item('★ (corner button)', 'otWhatsNew', 'Open what\'s new release notes'),
                item('Ctrl + V (dashboard)', 'otPasteUrlDashboard', 'Paste URL anywhere on the dashboard to quick-add a bookmark'),
                item('1–8 (config page)', 'otConfigTabs', 'Jump between config tabs'),
                item('S (config page)', 'otConfigSave', 'Save config changes'),
                item('Alt + ↑ / ↓ (config page)', 'otConfigReorder', 'Reorder selected bookmark'),
                item('Ctrl/Cmd + K (config page)', 'otConfigPalette', 'Open config command palette'),
            ]),
        ];
    }

    setupBookmarkTracking() {
        // Track when bookmarks are opened
        document.addEventListener('click', (e) => {
            if (e.target.closest('.bookmark-inline-form')) {
                return;
            }
            const openLink = e.target.closest('a.bookmark-open');
            if (!openLink) {
                return;
            }
            const bookmarkRow = openLink.closest('.bookmark-link[data-bookmark-index]');
            if (bookmarkRow && bookmarkRow.dataset.bookmarkIndex !== undefined) {
                const index = parseInt(bookmarkRow.dataset.bookmarkIndex, 10);
                if (!Number.isNaN(index) && index >= 0) {
                    this.analytics?.trackBookmarkOpen(this.currentPageId, index);
                    this.markInlineTipUsed('bookmark_open');
                    // Hide any active preview card when a bookmark link is clicked
                    try {
                        this.dismissBookmarkPreviewInteractions();
                    } catch (err) {
                        // ignore errors
                    }
                }
            }
        });
    }

    async buildSearchIndex() {
        try {
            await fetch('/api/search-index', { method: 'POST' });
        } catch (error) {
            // Keep dashboard functional if indexing fails
            console.warn('Search index build failed:', error);
        }
    }

    applyVisualSettings() {
        const opacity = Number(this.settings.backgroundOpacity ?? 1);
        const clampedOpacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
        document.documentElement.style.setProperty('--dashboard-bg-opacity', String(clampedOpacity));
        document.body.style.setProperty('opacity', String(Math.max(0.65, clampedOpacity)));

        const weight = this.settings.fontWeight || 'normal';
        document.body.style.setProperty('--dashboard-font-weight', weight);
        document.body.style.fontWeight = weight;

        const iconSize = this.settings.launcherIconSize || 'normal';
        document.body.setAttribute('data-launcher-icon-size', iconSize);

        this.applyBackground();
    }

    applyBackground() {
        const type = this.settings.backgroundType || 'none';
        const body = document.body;
        body.classList.remove('has-custom-background', 'bg-gradient', 'bg-image');
        document.documentElement.style.removeProperty('--custom-background-image');

        if (type === 'none') {
            body.classList.toggle('no-background-dots', !this.settings.showBackgroundDots);
            return;
        }

        const forceNoDots = (type === 'image');
        body.classList.toggle('no-background-dots', forceNoDots || !this.settings.showBackgroundDots);
        body.classList.add('has-custom-background');

        let presetName = '';
        if (type === 'auto') {
            presetName = THEME_BACKGROUND_MAP[this.settings.theme || ''] || '';
        } else if (type === 'gradient') {
            presetName = this.settings.backgroundGradient || '';
        }

        if (presetName) {
            const css = BACKGROUND_PRESETS[presetName] || '';
            if (css) {
                document.documentElement.style.setProperty('--custom-background-image', css);
                body.classList.add('bg-gradient');
            }
            return;
        }

        if (type === 'image') {
            const url = (this.settings.backgroundImageUrl || '').trim();
            if (url) {
                document.documentElement.style.setProperty(
                    '--custom-background-image',
                    `url('${url.replace(/'/g, '%27')}')`
                );
                body.classList.add('bg-image');
            }
        }
    }

    initializeAutoDarkMode() {
        const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
        const applyPreferredTheme = () => {
            if (!this.settings.autoDarkMode || !media) {
                return;
            }
            const preferred = this.getPairedThemeVariant(this.settings.theme || 'dark', media.matches);
            document.body.classList.remove('dark', 'light');
            document.body.classList.add(preferred);
            document.documentElement.setAttribute('data-theme', preferred);
            document.body.setAttribute('data-theme', preferred);
            this.settings.theme = preferred;
            this.applyBackground();
        };

        applyPreferredTheme();

        if (media && typeof media.addEventListener === 'function') {
            media.addEventListener('change', applyPreferredTheme);
        }
    }

    getPairedThemeVariant(themeId, wantsDark) {
        const base = String(themeId || 'dark');
        if (base === 'dark' || base === 'light') {
            return wantsDark ? 'dark' : 'light';
        }
        const userCustomIds = window.UserCustomThemeIds;
        if (Array.isArray(userCustomIds) && userCustomIds.includes(base)) {
            return base;
        }
        const match = base.match(/^(.*)-(dark|light)$/);
        if (!match) {
            return base;
        }
        return `${match[1]}-${wantsDark ? 'dark' : 'light'}`;
    }

    renderDashboard(options = {}) {
        const animate = options && options.animate === true;
        this._renderAnimationsEnabled = animate;
        const container = document.getElementById('dashboard-layout');
        if (!container) return;

        this.leaveBookmarkInlineEditFocusMode();

        if (this._tagFilter) {
            this.renderTagFilterDashboard(container, options);
            return;
        }

        this.updateTagFilterIndicator();

        // Group bookmarks by category
        const groupedBookmarks = this.groupBookmarksByCategory();
        
        // Clear container
        container.innerHTML = '';
        container.classList.remove('page-transition', 'tag-filter-layout', 'tag-filter-view');

        if (!Array.isArray(this.bookmarks) || this.bookmarks.length === 0) {
            const hasBookmarksOnOtherPages = Array.isArray(this.allBookmarks) && this.allBookmarks.length > 0;
            const currentPage = this.pages.find(p => p.id === this.currentPageId);
            const pageName = currentPage ? currentPage.name : '';

            const addLabel = this.buildEmptyStateAddLabel();
            const addHint = this.buildEmptyStateAddHint();
            const showKeyboardActions = this.shouldShowEmptyStateKeyboardActions();
            const emptyPageText = this.language?.t('dashboard.emptyPage') || 'This page is empty';
            const searchLabel = this.language?.t('dashboard.searchLabel') || 'Search';
            const commandNewLabel = this.language?.t('dashboard.emptyStateCommandNew') || 'Add via command';
            const commandTagLabel = this.language?.t('dashboard.emptyStateCommandTag') || 'Browse by tag';
            const searchActionHtml = showKeyboardActions
                ? `<button class="empty-state-action-btn" id="empty-state-search" type="button"><kbd>&gt;</kbd> ${searchLabel}</button>`
                : `<button class="empty-state-action-btn" id="empty-state-search" type="button">${searchLabel}</button>`;
            const commandNewHtml = showKeyboardActions
                ? `<button class="empty-state-action-btn" id="empty-state-command-new" type="button"><kbd>:new</kbd> ${commandNewLabel}</button>`
                : '';
            const commandTagHtml = showKeyboardActions
                ? `<button class="empty-state-action-btn" id="empty-state-command-tag" type="button"><kbd>:tag</kbd> ${commandTagLabel}</button>`
                : '';

            if (hasBookmarksOnOtherPages) {
                container.innerHTML = `
                    <div class="empty-state empty-state--page">
                        <div class="empty-state-label">// ${pageName}</div>
                        <div class="empty-state-text" data-i18n="dashboard.emptyPage">${emptyPageText}</div>
                        <div class="empty-state-actions">
                            <button class="empty-state-action-btn empty-state-action-btn--primary" id="empty-state-new-bookmark" type="button">${addLabel}</button>
                            ${searchActionHtml}
                            ${commandNewHtml}
                            ${commandTagHtml}
                        </div>
                        <p class="empty-state-hint">${addHint}</p>
                    </div>
                `;
                container.querySelector('#empty-state-new-bookmark')?.addEventListener('click', () => {
                    this.openEmptyStateAdd();
                });
                container.querySelector('#empty-state-search')?.addEventListener('click', () => {
                    this.searchComponent?.openSearchInterface();
                });
                container.querySelector('#empty-state-command-new')?.addEventListener('click', () => {
                    this.openEmptyStateCommand(':new');
                });
                container.querySelector('#empty-state-command-tag')?.addEventListener('click', () => {
                    this.openEmptyStateCommand(':tag');
                });
            } else {
                const freshText = this.language?.t('dashboard.emptyFresh') || 'No bookmarks yet';
                const searchFreshHtml = showKeyboardActions
                    ? `<button class="empty-state-action-btn" id="empty-state-search-fresh" type="button"><kbd>&gt;</kbd> ${searchLabel}</button>`
                    : `<button class="empty-state-action-btn" id="empty-state-search-fresh" type="button">${searchLabel}</button>`;
                container.innerHTML = `
                    <div class="empty-state empty-state--fresh">
                        <div class="empty-state-text" data-i18n="dashboard.emptyFresh">${freshText}</div>
                        <div class="empty-state-actions">
                            <button class="empty-state-action-btn empty-state-action-btn--primary" id="empty-state-new-bookmark-fresh" type="button">${addLabel}</button>
                            ${searchFreshHtml}
                        </div>
                        <p class="empty-state-hint">${addHint}</p>
                        <div class="empty-state-action">
                            <a class="btn btn-secondary" href="/config#pages" data-i18n="dashboard.emptyStateSetupPages">Set up pages in config</a>
                            <a class="btn btn-secondary" href="/config#backups" data-i18n="config.importDescription">Import your data</a>
                        </div>
                    </div>
                `;
                container.querySelector('#empty-state-new-bookmark-fresh')?.addEventListener('click', () => {
                    this.openEmptyStateAdd();
                });
                container.querySelector('#empty-state-search-fresh')?.addEventListener('click', () => {
                    this.searchComponent?.openSearchInterface();
                });
            }
            if (this.language && typeof this.language.applyTranslations === 'function') {
                this.language.applyTranslations();
            }
            this.updateSearchComponent();
            return;
        }

        const columnBlocks = [];

        // Render smart collections first for quick access to derived sets.
        const smartCollections = this.getSmartCollections(this.getSmartCollectionSourceBookmarks());
        smartCollections.forEach((collection) => {
            if (!Array.isArray(collection.bookmarks) || collection.bookmarks.length === 0) {
                return;
            }
            const collectionBookmarks = collection.id === '__smart_recent__'
                ? [...collection.bookmarks].sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))
                : collection.id === '__smart_most_used__'
                    ? [...collection.bookmarks].sort((a, b) => Number(b.openCount || 0) - Number(a.openCount || 0))
                    : collection.id === '__smart_today__'
                        ? [...collection.bookmarks]
                        : this.sortBookmarks(collection.bookmarks);
            const collectionElement = this.createCategoryElement({
                id: collection.id,
                name: collection.name,
                icon: collection.icon,
                isSmartCollection: true,
                customCollection: collection.customCollection || null,
            }, collectionBookmarks);
            columnBlocks.push(collectionElement);
        });

        // Render categories (bookmark.category is normalized to string keys in groupBookmarksByCategory)
        this.categories.forEach(category => {
            const id = String(category.id);
            const categoryBookmarks = this.sortBookmarks(groupedBookmarks[id] || []);
            if (categoryBookmarks.length === 0) return;

            const categoryElement = this.createCategoryElement(category, categoryBookmarks);
            columnBlocks.push(categoryElement);
        });

        // Handle bookmarks without category
        const uncategorizedBookmarks = groupedBookmarks[''] || [];
        if (uncategorizedBookmarks.length > 0) {
            const _unc = this.language.t('dashboard.uncategorized');
            const uncategorizedCategory = { id: '', name: _unc !== 'dashboard.uncategorized' ? _unc : 'Uncategorized' };
            const categoryElement = this.createCategoryElement(uncategorizedCategory, this.sortBookmarks(uncategorizedBookmarks));
            columnBlocks.push(categoryElement);
        }

        const knownCategoryIds = new Set(this.categories.map((c) => String(c.id)));
        const orphanLabelBase = (() => {
            const raw = this.language.t('dashboard.unknownCategory');
            return raw && raw !== 'dashboard.unknownCategory' ? raw : 'Unknown category';
        })();
        Object.keys(groupedBookmarks).forEach((key) => {
            const id = String(key);
            if (id === '' || knownCategoryIds.has(id)) {
                return;
            }
            const orphanBookmarks = groupedBookmarks[id];
            if (!Array.isArray(orphanBookmarks) || orphanBookmarks.length === 0) {
                return;
            }
            const orphanCategory = {
                id,
                name: `${orphanLabelBase} (${id})`,
                icon: '⚠'
            };
            columnBlocks.push(this.createCategoryElement(orphanCategory, this.sortBookmarks(orphanBookmarks)));
        });

        const gridLayout = this.syncDashboardGridLayout();
        this._distributeDashboardColumnBlocks(container, columnBlocks, { animate, gridLayout });

        if (animate) {
            requestAnimationFrame(() => {
                container.classList.add('page-transition');
                setTimeout(() => container.classList.remove('page-transition'), ANIM.PAGE_TRANSITION);
            });
        }

        // Enable realtime drag-and-drop sorting within each category
        this.initializeCategoryReorder();
        // this.initializeDashboardCategoryReorder();

        this.updateSearchComponent();
        this.syncBookmarkGridA11y();
        this.keyboardNavigation?.scheduleUpdate?.();
        
        // Initialize or update status monitoring after rendering
        if (this.statusMonitor) {
            // Check if this is the first time initializing or just updating bookmarks
            if (this.statusMonitorInitialized) {
                // Just update bookmarks without clearing cache
                this.statusMonitor.updateBookmarks(this.bookmarks);
            } else {
                // First time initialization
                this.statusMonitor.init(this.bookmarks);
                this.statusMonitorInitialized = true;
            }
        }
    }

    groupBookmarksByCategory() {
        const grouped = {};
        
        this.bookmarks.forEach(bookmark => {
            const categoryId = String(bookmark.category ?? '').trim();
            if (!grouped[categoryId]) {
                grouped[categoryId] = [];
            }
            grouped[categoryId].push(bookmark);
        });

        // Bookmarks are kept in the order they appear in the JSON file
        // No sorting applied - respects the order from data/bookmarks-X.json

        return grouped;
    }

    sortBookmarks(bookmarks) {
        const sorted = [...(Array.isArray(bookmarks) ? bookmarks : [])];
        const method = this.settings.sortMethod || 'order';
        const pinned = sorted
            .filter((bookmark) => Boolean(bookmark?.pinned))
            .sort((a, b) => (a?.name || '').localeCompare(b?.name || '', undefined, { sensitivity: 'base' }));
        const regular = sorted.filter((bookmark) => !bookmark?.pinned);

        if (method === 'az') {
            return [
                ...pinned,
                ...regular.sort((a, b) => (a?.name || '').localeCompare(b?.name || '', undefined, { sensitivity: 'base' }))
            ];
        }

        if (method === 'recent') {
            return [
                ...pinned,
                ...regular.sort((a, b) => (b?.lastOpened || 0) - (a?.lastOpened || 0))
            ];
        }

        if (method === 'custom') {
            return [...pinned, ...regular];
        }

        return [...pinned, ...regular];
    }

    initializeCategoryReorder() {
        this.destroyCategoryReorderInstances();

        if (typeof DragReorder === 'undefined') {
            return;
        }

        const categoryLists = document.querySelectorAll('.bookmarks-list[data-category-id]');
        categoryLists.forEach((listElement) => {
            if (listElement.getAttribute('data-smart-collection') === 'true') {
                return;
            }
            const categoryId = listElement.getAttribute('data-category-id') || '';

            const reorderInstance = new DragReorder({
                container: listElement,
                itemSelector: '.bookmark-link',
                handleSelector: '.bookmark-reorder-handle',
                /* 0 here: longPressMs blocked immediate native drag when whole row was handle; with narrow strip only, require instant drag. */
                longPressMs: 0,
                delegateItemDragOver: true,
                onReorder: () => {
                    this.syncBookmarksFromDom();
                }
            });

            this.categoryReorderInstances.push(reorderInstance);
        });
        this.ensureBookmarkDragOverRelay();
    }

    /**
     * HTML5 dragover does not bubble from bookmark rows across category headers / column gaps.
     * Single document-level relay uses elementFromPoint so drops into other columns work.
     */
    ensureBookmarkDragOverRelay() {
        if (this._bookmarkDragRelayHandler) {
            return;
        }
        this._bookmarkDragRelayHandler = (e) => {
            const dragged = window.__dragReorderState && window.__dragReorderState.selected;
            if (!dragged || !e.dataTransfer) {
                return;
            }
            if (!dragged.classList || !dragged.classList.contains('bookmark-link')) {
                return;
            }
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el) {
                return;
            }
            const targetList = el.closest('.bookmarks-list[data-category-id]');
            if (!targetList || targetList.getAttribute('data-smart-collection') === 'true') {
                return;
            }
            if (!window.__dragReorderState.placeholder) {
                const ph = document.createElement('div');
                ph.className = 'bookmark-drop-placeholder';
                ph.setAttribute('aria-hidden', 'true');
                window.__dragReorderState.placeholder = ph;
            }
            const placeholder = window.__dragReorderState.placeholder;
            const targetItem = el.closest('.bookmark-link.reorder-item');
            if (targetItem && targetItem !== dragged) {
                targetItem.parentNode.insertBefore(placeholder, targetItem);
                const sameParent = dragged.parentNode === targetItem.parentNode;
                let isBefore = false;
                if (sameParent) {
                    for (let cur = dragged.previousSibling; cur; cur = cur.previousSibling) {
                        if (cur === targetItem) {
                            isBefore = true;
                            break;
                        }
                    }
                }
                if (sameParent) {
                    if (isBefore) {
                        targetItem.parentNode.insertBefore(dragged, targetItem);
                    } else {
                        targetItem.parentNode.insertBefore(dragged, targetItem.nextSibling);
                    }
                } else {
                    targetItem.parentNode.insertBefore(dragged, targetItem.nextSibling);
                }
            } else if (!targetItem) {
                if (dragged.parentNode !== targetList) {
                    targetList.appendChild(dragged);
                }
                targetList.appendChild(placeholder);
            }
        };
        document.addEventListener('dragover', this._bookmarkDragRelayHandler, { capture: true, passive: false });
    }

    initializeDashboardCategoryReorder() {
        this.destroyDashboardCategoryReorderInstances();
        if (typeof DragReorder === 'undefined') return;

        const grid = document.getElementById('dashboard-layout');
        if (!grid) return;

        const isPacked = grid.classList.contains('packed-columns');
        const onReorder = () => {
            // Small delay so the DOM is fully settled after touch/mouse drag ends
            requestAnimationFrame(() => this.syncCategoriesFromDom());
        };

        if (isPacked) {
            grid.querySelectorAll('.dashboard-column').forEach((col) => {
                this.dashboardCategoryReorderInstances.push(new DragReorder({
                    container: col,
                    itemSelector: '.category:not([data-smart-collection="true"])',
                    itemClass: 'category-reorder-item',
                    handleSelector: '.category-reorder-handle',
                    longPressMs: 0,
                    delegateItemDragOver: false,
                    touchContainerSelector: '.dashboard-column',
                    onReorder
                }));
            });
        } else {
            this.dashboardCategoryReorderInstances.push(new DragReorder({
                container: grid,
                itemSelector: '.category:not([data-smart-collection="true"])',
                itemClass: 'category-reorder-item',
                handleSelector: '.category-reorder-handle',
                longPressMs: 0,
                delegateItemDragOver: false,
                touchContainerSelector: '#dashboard-layout',
                onReorder
            }));
        }
    }

    ensureCategoryDragOverRelay() {
        if (this._categoryDragRelayHandler) return;

        // Accept the drop and immediately sync+save — DOM is correct at this moment.
        this._categoryDropHandler = (e) => {
            const dragged = window.__dragReorderState && window.__dragReorderState.selected;
            if (!dragged || !dragged.classList.contains('category')) return;
            e.preventDefault();
            this.syncCategoriesFromDom();
        };
        document.addEventListener('drop', this._categoryDropHandler, { capture: true });

        this._categoryDragRelayHandler = (e) => {
            const dragged = window.__dragReorderState && window.__dragReorderState.selected;
            if (!dragged) return;
            if (!dragged.classList || !dragged.classList.contains('category')) return;
            if (!e.dataTransfer) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el) return;
            const targetColumn = el.closest('.dashboard-column');
            if (!targetColumn) return;
            const targetItem = el.closest('.category.category-reorder-item');
            if (!window.__dragReorderState.placeholder) {
                const ph = document.createElement('div');
                ph.className = 'bookmark-drop-placeholder';
                ph.setAttribute('aria-hidden', 'true');
                window.__dragReorderState.placeholder = ph;
            }
            const placeholder = window.__dragReorderState.placeholder;
            if (targetItem && targetItem !== dragged) {
                targetItem.parentNode.insertBefore(placeholder, targetItem);
                if (dragged.parentNode === targetItem.parentNode) {
                    let isBefore = false;
                    for (let cur = dragged.previousSibling; cur; cur = cur.previousSibling) {
                        if (cur === targetItem) { isBefore = true; break; }
                    }
                    targetItem.parentNode.insertBefore(dragged, isBefore ? targetItem : targetItem.nextSibling);
                } else {
                    targetItem.parentNode.insertBefore(dragged, targetItem.nextSibling);
                }
            } else if (!targetItem && dragged.parentNode !== targetColumn) {
                targetColumn.appendChild(dragged);
                targetColumn.appendChild(placeholder);
            }
        };
        document.addEventListener('dragover', this._categoryDragRelayHandler, { capture: true, passive: false });
    }

    destroyCategoryReorderInstances() {
        if (this._bookmarkDragRelayHandler) {
            document.removeEventListener('dragover', this._bookmarkDragRelayHandler, { capture: true, passive: false });
            this._bookmarkDragRelayHandler = null;
        }
        if (!Array.isArray(this.categoryReorderInstances)) {
            this.categoryReorderInstances = [];
            return;
        }

        this.categoryReorderInstances.forEach((instance) => {
            if (instance && typeof instance.destroy === 'function') {
                instance.destroy();
            }
        });
        this.categoryReorderInstances = [];
    }

    destroyDashboardCategoryReorderInstances() {
        if (this._categoryDragRelayHandler) {
            document.removeEventListener('dragover', this._categoryDragRelayHandler, { capture: true, passive: false });
            this._categoryDragRelayHandler = null;
        }
        if (this._categoryDropHandler) {
            document.removeEventListener('drop', this._categoryDropHandler, { capture: true });
            this._categoryDropHandler = null;
        }
        (this.dashboardCategoryReorderInstances || []).forEach((i) => {
            if (i && typeof i.destroy === 'function') i.destroy();
        });
        this.dashboardCategoryReorderInstances = [];
    }

    syncBookmarksFromDom() {
        const previousBookmarks = this.bookmarks.map((bookmark) => ({ ...bookmark }));
        const nextBookmarks = [];
        const movedElements = [];
        let bookmarkCursor = 0;

        const categoryLists = document.querySelectorAll('.bookmarks-list[data-category-id]');
        categoryLists.forEach((listElement) => {
            if (listElement.getAttribute('data-smart-collection') === 'true') {
                return;
            }
            const categoryId = listElement.getAttribute('data-category-id') || '';
            const listBookmarks = listElement.querySelectorAll('.bookmark-link[data-bookmark-index]');

            listBookmarks.forEach((bookmarkElement) => {
                const oldBookmarkIndex = parseInt(bookmarkElement.getAttribute('data-bookmark-index'), 10);
                if (Number.isNaN(oldBookmarkIndex) || !previousBookmarks[oldBookmarkIndex]) {
                    return;
                }

                const bookmark = previousBookmarks[oldBookmarkIndex];
                const movedAcrossCategories = (bookmark.category || '') !== categoryId;
                nextBookmarks.push({ ...bookmark, category: categoryId });
                bookmarkElement.setAttribute('data-bookmark-index', String(bookmarkCursor));
                bookmarkElement.setAttribute('data-category-id', categoryId);
                if (movedAcrossCategories) {
                    movedElements.push(bookmarkElement);
                }
                bookmarkCursor += 1;
            });
        });

        if (nextBookmarks.length === 0 || nextBookmarks.length !== previousBookmarks.length) {
            return;
        }

        if (!this.pendingReorderSnapshot) {
            this.pendingReorderSnapshot = previousBookmarks.map((bookmark) => ({ ...bookmark }));
        }

        this.bookmarks = nextBookmarks;
        movedElements.forEach((element) => {
            element.classList.add('bookmark-move-in');
            setTimeout(() => element.classList.remove('bookmark-move-in'), ANIM.BOOKMARK_MOVE_IN);
        });
        this.updateSearchComponent();
        if (this.statusMonitor) {
            this.statusMonitor.updateBookmarks(this.bookmarks);
        }
        this.scheduleBookmarkOrderSave();
    }

    syncCategoriesFromDom() {
        const grid = document.getElementById('dashboard-layout');
        if (!grid) return;
        const els = grid.querySelectorAll('.category[data-category-id]:not([data-smart-collection="true"])');
        const newIds = Array.from(els).map((el) => el.getAttribute('data-category-id')).filter(Boolean);

        if (!newIds.length) return;

        const byId = new Map(this.categories.map((c) => [String(c.id), c]));
        const renderedSet = new Set(newIds);

        // Categories not rendered (empty) — preserve them appended after rendered ones
        const unrendered = this.categories.filter((c) => !renderedSet.has(String(c.id)));
        const newCategories = [
            ...newIds.map((id) => byId.get(id)).filter(Boolean),
            ...unrendered
        ];

        this.categories = newCategories;
        this.scheduleCategoryOrderSave();
    }

    scheduleCategoryOrderSave() {
        if (this._pendingCategorySave) clearTimeout(this._pendingCategorySave);
        this._pendingCategorySave = setTimeout(() => this.saveCategoryOrder(), 1000);
    }

    async saveCategoryOrder() {
        try {
            // Set originalId = id so the backend position-fallback doesn't remap bookmarks
            const payload = this.categories.map((c) => ({ ...c, originalId: c.id }));
            const res = await fetch(`/api/categories?page=${this.currentPageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('Save failed');
            this._pendingCategorySave = null;
        } catch (err) {
            this._pendingCategorySave = null;
            this.showErrorNotification(`${err.message || 'Failed to save category order.'} Please try again.`);
        }
    }

    _startCategoryRename(titleEl, nameSpan, category) {
        if (titleEl.querySelector('.category-rename-input')) return;

        const originalName = category.name;
        titleEl.classList.add('category-title--renaming');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'category-rename-input';
        input.value = originalName;
        input.setAttribute('aria-label', this.formatDashboardLabel('renameCategoryAria', {}, 'Rename category'));
        nameSpan.replaceWith(input);
        input.focus();
        input.select();

        let done = false;

        const commit = async () => {
            if (done) return;
            done = true;
            titleEl.classList.remove('category-title--renaming');
            const newName = input.value.trim();
            input.replaceWith(nameSpan);
            if (!newName || newName === originalName) {
                nameSpan.textContent = originalName.toLowerCase();
                return;
            }
            category.name = newName;
            nameSpan.textContent = newName.toLowerCase();
            // Orphan categories (bookmarks referencing a non-existent category ID) are not
            // in this.categories, so the save would skip them. Add the category first.
            if (!this.categories.some(c => String(c.id) === String(category.id))) {
                this.categories.push({ id: category.id, name: newName });
            }
            await this.saveCategoryOrder();
        };

        const cancel = () => {
            if (done) return;
            done = true;
            titleEl.classList.remove('category-title--renaming');
            input.replaceWith(nameSpan);
            nameSpan.textContent = originalName.toLowerCase();
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        input.addEventListener('blur', commit);
    }

    scheduleBookmarkOrderSave(options = {}) {
        if (this.pendingReorderSave) {
            clearTimeout(this.pendingReorderSave);
        }

        const successMessage = typeof options.successMessage === 'string' && options.successMessage.trim()
            ? options.successMessage.trim()
            : 'Bookmark order saved.';

        this.pendingReorderSave = setTimeout(() => {
            this.saveBookmarkOrder({ successMessage });
        }, 1000);
    }

    async saveBookmarkOrder(options = {}) {
        const payload = [...this.bookmarks];

        try {
            const response = await fetch(`/api/bookmarks?page=${this.currentPageId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let message = 'Failed to save bookmark order';
                try {
                    const errorBody = await response.json();
                    if (response.status === 409 && errorBody?.error === 'duplicate_shortcut') {
                        message = `Shortcut "${errorBody.shortcut}" already exists on another bookmark.`;
                    } else if (errorBody?.message) {
                        message = String(errorBody.message);
                    }
                } catch (error) {
                    // Ignore parse issues and keep fallback message.
                }
                throw new Error(message);
            }

            // Keep global shortcut index updated when enabled
            if (this.settings.globalShortcuts) {
                await this.loadAllBookmarks();
            }

            this.pendingReorderSave = null;
            this.pendingReorderSnapshot = null;
        } catch (error) {
            if (this.pendingReorderSnapshot) {
                this.bookmarks = [...this.pendingReorderSnapshot];
                this.renderDashboard();
            }
            this.pendingReorderSave = null;
            this.pendingReorderSnapshot = null;
            this.showErrorNotification(`${error.message || 'Failed to save bookmark order.'} Changes were reverted.`);
        }
    }

    undoPendingReorder() {
        if (!this.pendingReorderSnapshot) {
            return;
        }

        if (this.pendingReorderSave) {
            clearTimeout(this.pendingReorderSave);
            this.pendingReorderSave = null;
        }

        this.bookmarks = [...this.pendingReorderSnapshot];
        this.pendingReorderSnapshot = null;
        this.renderDashboard();
    }

    createCategoryElement(category, bookmarks) {
        const animate = this._renderAnimationsEnabled === true;
        const categoryDiv = document.createElement('div');
        const isTagFilterChunk = category.tagFilterChunk === true;
        categoryDiv.className = isTagFilterChunk ? 'category tag-filter-chunk' : 'category';
        if (animate) {
            categoryDiv.classList.add('animate-enter');
        }
        categoryDiv.setAttribute('data-category-id', category.id || '');
        categoryDiv.setAttribute('role', 'rowgroup');
        const isSmartCollection = category.isSmartCollection === true;
        if (isSmartCollection) {
            categoryDiv.setAttribute('data-smart-collection', 'true');
        }
        if (isTagFilterChunk) {
            categoryDiv.setAttribute('data-tag-filter-chunk', 'true');
        }
        const collapsedKey = isSmartCollection
            ? `smart:${category.id}`
            : `${this.currentPageId}:${category.id}`;
        let isCollapsed;
        if (isTagFilterChunk) {
            isCollapsed = false;
        } else if (this.settings.alwaysCollapseCategories) {
            isCollapsed = true;
        } else if (collapsedKey in this.collapsedCategories) {
            isCollapsed = this.collapsedCategories[collapsedKey];
        } else if (!isSmartCollection && category.id in this.collapsedCategories) {
            // Migrate legacy bare-key entry to page-scoped key on first render
            isCollapsed = this.collapsedCategories[category.id];
            this.collapsedCategories[collapsedKey] = isCollapsed;
            delete this.collapsedCategories[category.id];
            this.saveCollapsedStates();
        } else {
            isCollapsed = false;
        }
        categoryDiv.setAttribute('data-collapsed', isCollapsed ? 'true' : 'false');

        if (!isTagFilterChunk) {
        // Category title
        const titleElement = document.createElement('h2');
        titleElement.className = isSmartCollection ? 'category-title smart-collection-title' : 'category-title';
        const titleDomId = `category-title-${String(category.id || 'uncategorized').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        titleElement.id = titleDomId;
        categoryDiv.setAttribute('aria-labelledby', titleDomId);
        titleElement.setAttribute('role', 'rowheader');
        titleElement.tabIndex = -1;
        const categoryIcon = (category.icon || '').trim();
        titleElement.innerHTML = '';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'category-title-name';
        nameSpan.textContent = category.name.toLowerCase();

        if (this.isUploadedCategoryIcon(categoryIcon)) {
            const iconImage = document.createElement('img');
            iconImage.src = `/data/icons/${categoryIcon}`;
            iconImage.alt = '';
            iconImage.className = 'bookmark-icon';
            titleElement.appendChild(iconImage);
            try {
                const currentTheme = document.documentElement.getAttribute('data-theme') || this.settings.theme || 'default';
                const entry = (this.settings.themeIconStyling && this.settings.themeIconStyling[currentTheme]) || { enabled: false };
                if (entry.enabled) {
                    iconImage.classList.add('icon-themed', `icon-themed--${entry.style || 'muted'}`);
                    iconImage.style.setProperty('--icon-theme-intensity', String(entry.intensity || 0.5));
                }
            } catch (e) {
                // ignore
            }
            titleElement.appendChild(document.createTextNode(' '));
        } else {
            const textIcon = categoryIcon || '▣';
            titleElement.appendChild(document.createTextNode(`${textIcon} `));
        }
        titleElement.appendChild(nameSpan);

        const chevron = document.createElement('span');
        chevron.className = 'category-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        titleElement.appendChild(chevron);

        if (isSmartCollection) {
            const whyHint = this.getSmartCollectionWhyHint(category.id, category);
            if (whyHint) {
                const whyBtn = document.createElement('button');
                whyBtn.type = 'button';
                whyBtn.className = 'smart-collection-why-btn';
                whyBtn.textContent = 'ℹ';
                whyBtn.setAttribute('data-tooltip', whyHint);
                whyBtn.setAttribute(
                    'aria-label',
                    this.language?.t?.('dashboard.smartWhyAria') || 'Why am I seeing this collection?'
                );
                whyBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                });
                titleElement.appendChild(whyBtn);
            }
        }

        titleElement.addEventListener('click', () => {
            const isCollapsed = categoryDiv.getAttribute('data-collapsed') === 'true';
            categoryDiv.setAttribute('data-collapsed', isCollapsed ? 'false' : 'true');
            this.collapsedCategories[collapsedKey] = !isCollapsed;
            this.saveCollapsedStates();
        });

        if (!isSmartCollection) {
            titleElement.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._startCategoryRename(titleElement, nameSpan, category);
            });
        }

        categoryDiv.appendChild(titleElement);
        }

        // Bookmarks list
        const bookmarksList = document.createElement('div');
        bookmarksList.className = 'bookmarks-list';
        bookmarksList.setAttribute('data-category-id', category.id || '');
        bookmarksList.setAttribute('data-bookmarks-list', 'true');
        bookmarksList.setAttribute('role', 'presentation');
        if (isSmartCollection) {
            bookmarksList.setAttribute('data-smart-collection', 'true');
        }

        bookmarks.forEach((bookmark, index) => {
            const bookmarkElement = this.createBookmarkElement(bookmark, category.id || '', true);
            if (animate) {
                bookmarkElement.classList.add('animate-enter');
                bookmarkElement.style.setProperty('--item-index', String(index));
                const bookmarkEnterDelay = (index * ANIM.BOOKMARK_STAGGER_STEP) + ANIM.BOOKMARK_ENTER_BASE;
                setTimeout(() => bookmarkElement.classList.remove('animate-enter'), bookmarkEnterDelay);
            }
            bookmarksList.appendChild(bookmarkElement);
        });

        if (isSmartCollection && bookmarks.length === 0) {
            const t = (key, fallback) => this.language?.t?.(key) || fallback;
            const emptyMessages = {
                '__smart_today__':     t('dashboard.smartEmptyToday',    'No bookmarks scheduled for today'),
                '__smart_recent__':    t('dashboard.smartEmptyRecent',   'No bookmarks opened recently'),
                '__smart_stale__':     t('dashboard.smartEmptyStale',    'No stale bookmarks'),
                '__smart_most_used__': t('dashboard.smartEmptyMostUsed', 'No bookmarks opened yet'),
            };
            const msg = emptyMessages[category.id] || t('dashboard.smartEmptyGeneric', 'No bookmarks');
            const emptyEl = document.createElement('div');
            emptyEl.className = 'smart-collection-empty';
            emptyEl.textContent = msg;
            bookmarksList.appendChild(emptyEl);
        }

        const categoryBody = document.createElement('div');
        categoryBody.className = 'category-body';
        categoryBody.appendChild(bookmarksList);
        categoryDiv.appendChild(categoryBody);
        return categoryDiv;
    }

    isUploadedCategoryIcon(iconValue) {
        return typeof iconValue === 'string' && /\.[a-z0-9]+$/i.test(iconValue);
    }

    getSmartCollections(bookmarks) {
        const now = Date.now();
        const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
        const staleWindowMs = 30 * 24 * 60 * 60 * 1000;
        const normalized = Array.isArray(bookmarks) ? bookmarks : [];
        const currentPageId = Number(this.currentPageId);

        const currentPageIndex = this.pages.findIndex((page) => page.id === this.currentPageId);
        const currentPageNumber = currentPageIndex >= 0 ? (currentPageIndex + 1) : null;

        const pageAllowed = (pageIds) => {
            if (!Array.isArray(pageIds) || pageIds.length === 0) {
                return true;
            }
            const normalizedIds = pageIds
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value) && value > 0);
            if (normalizedIds.includes(currentPageId)) {
                return true;
            }
            if (currentPageNumber !== null && normalizedIds.includes(currentPageNumber)) {
                return true;
            }
            return false;
        };

        const recentBookmarks = normalized.filter((bookmark) => {
            const lastOpened = Number(bookmark.lastOpened || 0);
            return lastOpened > 0 && (now - lastOpened) <= oneWeekMs;
        });

        const staleBookmarks = normalized.filter((bookmark) => {
            const lastOpened = Number(bookmark.lastOpened || 0);
            return lastOpened === 0 || (now - lastOpened) > staleWindowMs;
        });
        const mostUsedBookmarks = normalized
            .filter((bookmark) => Number(bookmark.openCount || 0) > 0)
            .sort((a, b) => Number(b.openCount || 0) - Number(a.openCount || 0));

        const collections = [];
        const todayBookmarks = this.getSmartStartTodayBookmarks(normalized);

        if (this.settings.showSmartTodayCollection !== false && pageAllowed(this.settings.smartTodayPageIds) && todayBookmarks.length > 0) {
            const translatedTodayLabel = this.language?.t?.('dashboard.smartTodayCollection');
            const todayLabel = translatedTodayLabel && translatedTodayLabel !== 'dashboard.smartTodayCollection'
                ? translatedTodayLabel
                : 'Today';
            collections.push({
                id: '__smart_today__',
                name: `${todayLabel} (${todayBookmarks.length})`,
                icon: '☀',
                bookmarks: todayBookmarks
            });
        }

        if (this.settings.showSmartRecentCollection !== false && pageAllowed(this.settings.smartRecentPageIds)) {
            const configuredLimit = Number(this.settings.smartRecentLimit ?? 50);
            const effectiveLimit = Number.isFinite(configuredLimit) && configuredLimit > 0
                ? configuredLimit
                : null;
            collections.push({
                id: '__smart_recent__',
                name: `Recently opened (${effectiveLimit ? Math.min(recentBookmarks.length, effectiveLimit) : recentBookmarks.length})`,
                icon: '⚡',
                bookmarks: effectiveLimit ? recentBookmarks.slice(0, effectiveLimit) : recentBookmarks
            });
        }

        if (this.settings.showSmartStaleCollection !== false && pageAllowed(this.settings.smartStalePageIds)) {
            const configuredLimit = Number(this.settings.smartStaleLimit ?? 50);
            const effectiveLimit = Number.isFinite(configuredLimit) && configuredLimit > 0
                ? configuredLimit
                : null;
            collections.push({
                id: '__smart_stale__',
                name: `Stale bookmarks (${effectiveLimit ? Math.min(staleBookmarks.length, effectiveLimit) : staleBookmarks.length})`,
                icon: '⌛',
                bookmarks: effectiveLimit ? staleBookmarks.slice(0, effectiveLimit) : staleBookmarks
            });
        }

        if (this.settings.showSmartMostUsedCollection === true && pageAllowed(this.settings.smartMostUsedPageIds)) {
            const configuredLimit = Number(this.settings.smartMostUsedLimit ?? 25);
            const effectiveLimit = Number.isFinite(configuredLimit) && configuredLimit > 0
                ? configuredLimit
                : null;
            collections.push({
                id: '__smart_most_used__',
                name: 'Most used',
                icon: '📈',
                bookmarks: effectiveLimit ? mostUsedBookmarks.slice(0, effectiveLimit) : mostUsedBookmarks
            });
        }

        // User-defined collections from settings
        const userCollections = Array.isArray(this.settings?.collections) ? this.settings.collections : [];
        for (const col of userCollections) {
            if (!col.id || !col.name || !Array.isArray(col.rules) || col.rules.length === 0) continue;
            const matched = this._evaluateCollection(col, normalized);
            collections.push({
                id: `custom:${col.id}`,
                name: col.icon ? `${col.icon} ${col.name}` : col.name,
                icon: col.icon || '',
                bookmarks: matched,
                isSmartCollection: true,
                customCollection: col,
            });
        }

        if (this.settings?.showTagCollections) {
            const minCount = this.settings.tagCollectionsMinCount || 0;
            const tagMap = new Map();
            normalized.forEach(bm => {
                (bm.tags || []).forEach(tag => {
                    if (!tagMap.has(tag)) tagMap.set(tag, []);
                    tagMap.get(tag).push(bm);
                });
            });
            [...tagMap.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .forEach(([tag, bms]) => {
                    if (minCount > 0 && bms.length < minCount) return;
                    collections.push({
                        id: `tag:${tag}`,
                        name: `🏷 ${tag}`,
                        icon: '🏷',
                        bookmarks: bms,
                        isSmartCollection: true
                    });
                });
        }

        return collections;
    }

    _smartWhyT(key, fallback, vars = {}) {
        const fullKey = `dashboard.${key}`;
        let text = this.language?.t?.(fullKey);
        if (!text || text === fullKey) text = fallback;
        Object.entries(vars).forEach(([k, v]) => {
            text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        });
        return text;
    }

    _getCurrentPageDisplayName() {
        const page = (this.pages || []).find((p) => Number(p.id) === Number(this.currentPageId));
        const raw = page?.name || this.language?.t?.('dashboard.defaultPageTitle') || 'dashboard';
        return String(raw).trim() || 'dashboard';
    }

    _formatSmartWhyLimitSuffix(settingsKey, defaultLimit = 0) {
        const configured = Number(this.settings?.[settingsKey] ?? defaultLimit);
        if (!Number.isFinite(configured) || configured <= 0) return '';
        return this._smartWhyT('smartWhyLimitSuffix', ' Up to {limit} shown.', { limit: configured });
    }

    getSmartCollectionWhyHint(collectionId, category = {}) {
        const page = this._getCurrentPageDisplayName();

        if (collectionId === '__smart_today__') {
            return this._smartWhyT(
                'smartWhyToday',
                'Smart picks for now — recent opens, pins, and time-of-day keywords.{limitSuffix} Visible on page “{page}”.',
                { page, limitSuffix: this._formatSmartWhyLimitSuffix('smartTodayLimit', 8) }
            );
        }
        if (collectionId === '__smart_recent__') {
            return this._smartWhyT(
                'smartWhyRecent',
                'Bookmarks opened in the last 7 days.{limitSuffix} Visible on page “{page}”.',
                { page, limitSuffix: this._formatSmartWhyLimitSuffix('smartRecentLimit', 50) }
            );
        }
        if (collectionId === '__smart_stale__') {
            return this._smartWhyT(
                'smartWhyStale',
                'Not opened in 30+ days (or never).{limitSuffix} Visible on page “{page}”.',
                { page, limitSuffix: this._formatSmartWhyLimitSuffix('smartStaleLimit', 50) }
            );
        }
        if (collectionId === '__smart_most_used__') {
            return this._smartWhyT(
                'smartWhyMostUsed',
                'Your most-opened bookmarks.{limitSuffix} Visible on page “{page}”.',
                { page, limitSuffix: this._formatSmartWhyLimitSuffix('smartMostUsedLimit', 25) }
            );
        }
        if (String(collectionId).startsWith('tag:')) {
            const tag = String(collectionId).slice(4);
            return this._smartWhyT(
                'smartWhyTag',
                'All bookmarks tagged “{tag}”. Visible on page “{page}”.',
                { tag, page }
            );
        }
        if (String(collectionId).startsWith('custom:')) {
            const col = category.customCollection;
            if (!col || !Array.isArray(col.rules) || col.rules.length === 0) {
                return this._smartWhyT(
                    'smartWhyCustomGeneric',
                    'Matches rules you set in config → collections. Visible on page “{page}”.',
                    { page }
                );
            }
            const joiner = String(col.logic || 'and').toLowerCase() === 'or' ? ' OR ' : ' AND ';
            const rules = col.rules
                .map((rule) => {
                    const field = rule.field || 'tag';
                    const op = rule.operator === 'excludes' ? 'excludes' : 'includes';
                    const value = String(rule.value || '').trim();
                    if (!value) return '';
                    return `${field} ${op} “${value}”`;
                })
                .filter(Boolean)
                .join(joiner);
            return this._smartWhyT(
                'smartWhyCustom',
                'Your collection rules: {rules}. Visible on page “{page}”.',
                { rules: rules || '—', page }
            );
        }
        return '';
    }

    _evaluateCollection(collection, bookmarks) {
        return bookmarks.filter(bm => {
            const results = collection.rules.map(rule => {
                const field = rule.field;
                const op = rule.operator || 'includes';
                const val = (rule.value || '').toLowerCase();
                if (!val) return false;
                if (field === 'tag') {
                    const has = (bm.tags || []).some(t => t.toLowerCase() === val);
                    return op === 'excludes' ? !has : has;
                }
                if (field === 'category') {
                    const match = (bm.category || '').toLowerCase() === val;
                    return op === 'excludes' ? !match : match;
                }
                if (field === 'shortcut') {
                    const match = (bm.shortcut || '').toLowerCase() === val;
                    return op === 'excludes' ? !match : match;
                }
                return false;
            });
            return collection.logic === 'or' ? results.some(Boolean) : results.every(Boolean);
        });
    }

    getSmartStartTodayBookmarks(bookmarks) {
        const source = Array.isArray(bookmarks) ? bookmarks : [];
        if (source.length === 0) {
            return [];
        }

        const now = new Date();
        const nowMs = now.getTime();
        const hour = now.getHours();
        const day = now.getDay(); // 0 = Sunday, 1 = Monday, ...
        const oneDayMs = 24 * 60 * 60 * 1000;
        const oneWeekMs = 7 * oneDayMs;
        const oneMonthMs = 30 * oneDayMs;
        const configuredLimit = Number(this.settings.smartTodayLimit ?? 8);
        const maxItems = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : null;

        const keywordBoosts = this.getSmartStartKeywordBoosts(hour, day);
        const seenUrls = new Set();
        const scored = [];

        source.forEach((bookmark) => {
            const url = String(bookmark?.url || '').trim();
            if (!url || seenUrls.has(url)) {
                return;
            }
            seenUrls.add(url);

            const openCount = Number(bookmark.openCount || 0);
            const lastOpened = Number(bookmark.lastOpened || 0);
            const isPinned = Boolean(bookmark.pinned);
            const haystack = `${String(bookmark?.name || '')} ${url}`.toLowerCase();

            let score = 0;
            if (openCount > 0) {
                score += Math.min(18, Math.log2(openCount + 1) * 6);
            }
            if (isPinned) {
                score += 10;
            }

            if (lastOpened > 0) {
                const age = nowMs - lastOpened;
                if (age <= oneDayMs) {
                    score += 26;
                } else if (age <= (3 * oneDayMs)) {
                    score += 18;
                } else if (age <= oneWeekMs) {
                    score += 12;
                } else if (age <= oneMonthMs) {
                    score += 6;
                }
            } else if (openCount === 0) {
                score -= 4;
            }

            keywordBoosts.forEach(({ keyword, boost }) => {
                if (haystack.includes(keyword)) {
                    score += boost;
                }
            });

            if (this.isCurrentPageBookmark(bookmark)) {
                score += 2;
            }

            scored.push({ bookmark, score, lastOpened, openCount });
        });

        scored.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            if ((b.lastOpened || 0) !== (a.lastOpened || 0)) {
                return (b.lastOpened || 0) - (a.lastOpened || 0);
            }
            if ((b.openCount || 0) !== (a.openCount || 0)) {
                return (b.openCount || 0) - (a.openCount || 0);
            }
            return String(a.bookmark?.name || '').localeCompare(String(b.bookmark?.name || ''), undefined, { sensitivity: 'base' });
        });

        return (maxItems ? scored.slice(0, maxItems) : scored).map((entry) => entry.bookmark);
    }

    getSmartStartKeywordBoosts(hour, day) {
        const commonBoosts = this.parseSmartKeywordList(this.settings.smartTodayWorkKeywords, 4, 3);
        const eveningBoosts = this.parseSmartKeywordList(this.settings.smartTodayEveningKeywords, 5, 3);
        const weekendBoosts = this.parseSmartKeywordList(this.settings.smartTodayWeekendKeywords, 3, 2);

        const boosts = [...commonBoosts];
        if (hour >= 18 || hour < 6) {
            boosts.push(...eveningBoosts);
        }
        if (day === 0 || day === 6) {
            boosts.push(...weekendBoosts);
        }
        return boosts;
    }

    parseSmartKeywordList(raw, firstBoost = 4, restBoost = 3) {
        const text = String(raw || '');
        const tokens = text
            .split(',')
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean);
        return tokens.map((keyword, index) => ({
            keyword,
            boost: index === 0 ? firstBoost : restBoost
        }));
    }

    isCurrentPageBookmark(bookmark) {
        const bookmarkPage = Number(bookmark?.pageId);
        const currentPage = Number(this.currentPageId);
        if (Number.isFinite(bookmarkPage) && Number.isFinite(currentPage) && bookmarkPage > 0) {
            return bookmarkPage === currentPage;
        }
        return true;
    }

    getSmartCollectionSourceBookmarks() {
        if (Array.isArray(this.allBookmarks) && this.allBookmarks.length > 0) {
            return this.allBookmarks;
        }
        return this.bookmarks;
    }

    getStaleBookmarksList(days) {
        const effectiveDays = (days && days > 0) ? days : 30;
        const staleWindowMs = effectiveDays * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const source = this.getSmartCollectionSourceBookmarks();
        if (!Array.isArray(source)) {
            return [];
        }
        return source.filter((bookmark) => {
            const lastOpened = Number(bookmark.lastOpened || 0);
            return lastOpened === 0 || (now - lastOpened) > staleWindowMs;
        });
    }

    scrollToStaleCollection() {
        const el = document.querySelector('.category[data-category-id="__smart_stale__"]');
        if (!el) {
            this.showNotification(
                'Stale section not visible (disabled in settings, wrong page filter, or no stale rows).',
                'info'
            );
            return;
        }
        const collapsedKey = 'smart:__smart_stale__';
        el.setAttribute('data-collapsed', 'false');
        this.collapsedCategories[collapsedKey] = false;
        this.saveCollapsedStates();
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        el.classList.add('nextdash-stale-flash');
        setTimeout(() => el.classList.remove('nextdash-stale-flash'), ANIM.STALE_FLASH);
    }

    async consumeDashboardDeepLink() {
        if (typeof DashboardDeepLink === 'undefined') return;
        const link = DashboardDeepLink.parseDashboardDeepLink();
        if (!DashboardDeepLink.hasDeepLinkTarget(link)) return;

        if (link.pageId != null && this.pages.some((p) => p.id === link.pageId)) {
            if (this.currentPageId !== link.pageId) {
                await this.loadPageBookmarks(link.pageId);
            }
        }

        const focus = () => this.focusDashboardDeepLinkTarget(link);
        requestAnimationFrame(() => requestAnimationFrame(focus));
    }

    expandCategoryForDeepLink(categoryId) {
        if (!categoryId) return null;
        const escaped = typeof CSS !== 'undefined' && CSS.escape
            ? CSS.escape(categoryId)
            : String(categoryId).replace(/["\\]/g, '\\$&');
        const catEl = document.querySelector(
            `.category[data-category-id="${escaped}"]:not([data-smart-collection="true"])`
        );
        if (!catEl) return null;
        const collapsedKey = `${this.currentPageId}:${categoryId}`;
        catEl.setAttribute('data-collapsed', 'false');
        this.collapsedCategories[collapsedKey] = false;
        if (categoryId in this.collapsedCategories) {
            delete this.collapsedCategories[categoryId];
        }
        this.saveCollapsedStates();
        return catEl;
    }

    findBookmarkRowForDeepLink(link) {
        if (!link) return null;
        if (link.bookmarkIndex != null && link.bookmarkIndex >= 0) {
            const byIndex = document.querySelector(
                `.bookmark-link[data-bookmark-index="${link.bookmarkIndex}"]`
            );
            if (byIndex) return byIndex;
        }
        if (!link.url) return null;
        const targetUrl = String(link.url).trim();
        const canonical = typeof BookmarkUrlUtils !== 'undefined'
            ? BookmarkUrlUtils.canonicalBookmarkURLKey(targetUrl)
            : targetUrl.toLowerCase();
        const rows = document.querySelectorAll('.bookmark-link[data-bookmark-url]');
        for (const row of rows) {
            const rowUrl = String(row.getAttribute('data-bookmark-url') || '').trim();
            if (!rowUrl) continue;
            const rowKey = typeof BookmarkUrlUtils !== 'undefined'
                ? BookmarkUrlUtils.canonicalBookmarkURLKey(rowUrl)
                : rowUrl.toLowerCase();
            if (rowKey === canonical) return row;
        }
        return null;
    }

    focusDashboardDeepLinkTarget(link) {
        if (!link) return false;

        if (link.categoryId) {
            const catEl = this.expandCategoryForDeepLink(link.categoryId);
            catEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        const row = this.findBookmarkRowForDeepLink(link);
        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.classList.remove('bookmark-deep-link-focus');
            void row.offsetWidth;
            row.classList.add('bookmark-deep-link-focus');
            row.addEventListener(
                'animationend',
                () => row.classList.remove('bookmark-deep-link-focus'),
                { once: true }
            );
            if (this.keyboardNavigation?.navigableElements) {
                this.keyboardNavigation.updateNavigableElements?.();
                const navIdx = this.keyboardNavigation.navigableElements.indexOf(row);
                if (navIdx >= 0) {
                    this.keyboardNavigation.currentIndex = navIdx;
                    this.keyboardNavigation.highlightCurrentElement?.();
                }
            }
        } else if (link.bookmarkIndex != null || link.url) {
            const msg = this.language?.t?.('dashboard.deepLinkBookmarkNotFound')
                || 'Bookmark not found on this page (it may have moved).';
            this.showNotification(msg, 'info', { duration: 4000 });
        }

        DashboardDeepLink.stripDeepLinkParams();
        return Boolean(row);
    }

    ensureBookmarkMutationSnapshot() {
        if (!this.pendingReorderSnapshot) {
            this.pendingReorderSnapshot = this.bookmarks.map((bm) => ({ ...bm }));
        }
    }

    /**
     * Open inline edit for keyboard-selected row, Tab-focused row (e.g. .bookmark-open), or smart list row without data-bookmark-index.
     * @returns {boolean} true if editor opened
     */
    tryOpenInlineBookmarkEdit() {
        const kn = this.keyboardNavigation;
        const layout = document.getElementById('dashboard-layout');
        let el = null;
        if (layout && document.activeElement && document.activeElement.closest) {
            const hit = document.activeElement.closest('.bookmark-link');
            if (hit && layout.contains(hit) && !hit.classList.contains('recent-bookmark-link')) {
                el = hit;
            }
        }
        if (!el && kn && kn.currentIndex >= 0 && Array.isArray(kn.navigableElements)) {
            el = kn.navigableElements[kn.currentIndex];
        }
        if (!el || !el.classList.contains('bookmark-link') || el.classList.contains('bookmark-inline-editing')) {
            return false;
        }

        let bookmark = null;
        if (el.hasAttribute('data-bookmark-index')) {
            const idx = parseInt(el.getAttribute('data-bookmark-index'), 10);
            if (Number.isFinite(idx) && idx >= 0 && this.bookmarks[idx]) {
                bookmark = this.bookmarks[idx];
            }
        }
        if (!bookmark) {
            const url = String(el.getAttribute('data-bookmark-url') || '').trim();
            const cat = String(el.getAttribute('data-category-id') || '').trim();
            if (url) {
                bookmark = this.bookmarks.find(
                    (b) => String((b.url || '').trim()) === url && String(b.category || '') === cat
                ) || this.bookmarks.find((b) => String((b.url || '').trim()) === url);
            }
        }
        if (!bookmark && Array.isArray(this.allBookmarks)) {
            const url = String(el.getAttribute('data-bookmark-url') || '').trim();
            const cat = String(el.getAttribute('data-category-id') || '').trim();
            if (url) {
                bookmark = this.allBookmarks.find(
                    (b) => String((b.url || '').trim()) === url && String(b.category || '') === cat
                ) || this.allBookmarks.find((b) => String((b.url || '').trim()) === url);
            }
        }
        if (!bookmark) {
            return false;
        }
        const bookmarkRef = this.resolveBookmarkReference(bookmark);
        if (!bookmarkRef) {
            return false;
        }
        this.openBookmarkInlineEditor(el, bookmarkRef);
        return true;
    }

    /**
     * Long-press (not on reorder handle) opens inline editor. Uses AbortController on row to drop listeners on rebuild.
     * @param {AbortSignal} signal
     */
    attachBookmarkRowLongPress(row, openLink, bookmarkRef, signal) {
        const longMs = 500;
        const slop = 8;
        let timer = null;
        let startX = 0;
        let startY = 0;
        let activePointerId = null;

        const clearTimer = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            row.classList.remove('bookmark-longpress-armed');
            activePointerId = null;
        };

        const onPointerDown = (e) => {
            if (e.button !== undefined && e.button !== 0) {
                return;
            }
            if (e.target.closest('.bookmark-reorder-handle')) {
                return;
            }
            if (e.target.closest('.bookmark-inline-form')) {
                return;
            }
            clearTimer();
            startX = e.clientX;
            startY = e.clientY;
            activePointerId = e.pointerId;
            row.classList.add('bookmark-longpress-armed');
            timer = setTimeout(() => {
                timer = null;
                row.classList.remove('bookmark-longpress-armed');
                activePointerId = null;
                if (row.classList.contains('bookmark-inline-editing')) {
                    return;
                }
                this.openBookmarkInlineEditor(row, bookmarkRef);
                const blockNav = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    openLink.removeEventListener('click', blockNav, true);
                };
                openLink.addEventListener('click', blockNav, { capture: true, once: true });
            }, longMs);
        };

        const onPointerMove = (e) => {
            if (activePointerId !== null && e.pointerId !== activePointerId) {
                return;
            }
            if (!timer) {
                return;
            }
            const dx = Math.abs(e.clientX - startX);
            const dy = Math.abs(e.clientY - startY);
            if (dx > slop || dy > slop) {
                clearTimer();
            }
        };

        const onPointerEnd = (e) => {
            if (activePointerId !== null && e.pointerId !== activePointerId) {
                return;
            }
            clearTimer();
        };

        /* Bubble phase: avoid stealing native drag from .bookmark-reorder-handle (capture broke DnD in some browsers). */
        row.addEventListener('pointerdown', onPointerDown, { capture: false, signal });
        row.addEventListener('pointermove', onPointerMove, { capture: false, signal });
        row.addEventListener('pointerup', onPointerEnd, { capture: false, signal });
        row.addEventListener('pointercancel', onPointerEnd, { capture: false, signal });
        row.addEventListener('lostpointercapture', onPointerEnd, { capture: false, signal });
    }

    resolveBookmarkIndex(bookmark) {
        let idx = this.bookmarks.indexOf(bookmark);
        if (idx === -1 && bookmark && bookmark.url) {
            const u = (bookmark.url || '').trim();
            idx = this.bookmarks.findIndex((b) => (b.url || '').trim() === u);
        }
        return idx;
    }

    populateBookmarkRowView(row, bookmark, categoryId, allowInlineEdit) {
        if (row._bookmarkLongPressAbort) {
            row._bookmarkLongPressAbort.abort();
            row._bookmarkLongPressAbort = null;
        }
        const bookmarkRef = this.resolveBookmarkReference(bookmark);
        const bookmarkIndex = bookmarkRef?.scope === 'current' ? bookmarkRef.index : -1;
        row.classList.remove('bookmark-inline-editing');
        row.innerHTML = '';
        row.className = 'bookmark-link reorder-item is-idle';
        row.setAttribute('role', 'row');
        row.setAttribute('data-bookmark-url', bookmark.url || '');
        const tagList = (bookmark.tags || [])
            .map((raw) => String(raw || '').trim().toLowerCase())
            .filter(Boolean);
        if (tagList.length) {
            row.setAttribute('data-bookmark-tags', tagList.join(','));
        } else {
            row.removeAttribute('data-bookmark-tags');
        }
        if (bookmarkIndex >= 0) {
            row.setAttribute('data-bookmark-index', String(bookmarkIndex));
        } else {
            row.removeAttribute('data-bookmark-index');
        }
        row.setAttribute('data-category-id', categoryId);

        const lead = document.createElement('div');
        lead.className = 'bookmark-lead';
        lead.setAttribute('role', 'presentation');
        const reorderHandle = document.createElement('div');
        reorderHandle.className = 'bookmark-reorder-handle';
        const dragLabel = this.formatDashboardLabel('dragToReorderAria', {}, 'Drag to reorder');
        reorderHandle.setAttribute('aria-label', dragLabel);
        reorderHandle.title = dragLabel;
        lead.appendChild(reorderHandle);

        if (this.settings.showIcons) {
            const iconSlot = document.createElement('span');
            iconSlot.className = 'bookmark-icon-slot';
            lead.appendChild(iconSlot);

            if (bookmark.icon) {
                const placeholder = document.createElement('span');
                placeholder.className = 'icon-placeholder';
                iconSlot.appendChild(placeholder);

                const iconImg = document.createElement('img');
                iconImg.src = `/data/icons/${bookmark.icon}`;
                iconImg.className = 'bookmark-icon';
                iconImg.alt = '';
                iconImg.loading = 'lazy';
                iconImg.draggable = false;
                iconImg.addEventListener('load', () => placeholder.remove());
                iconImg.addEventListener('error', () => {
                    placeholder.remove();
                    iconImg.remove();
                });
                iconSlot.appendChild(iconImg);
                try {
                    const currentTheme = document.documentElement.getAttribute('data-theme') || this.settings.theme || 'default';
                    const entry = (this.settings.themeIconStyling && this.settings.themeIconStyling[currentTheme]) || { enabled: false };
                    if (entry.enabled) {
                        iconSlot.classList.add('icon-themed', `icon-themed--${entry.style || 'muted'}`);
                        iconSlot.style.setProperty('--icon-theme-intensity', String(entry.intensity || 0.5));
                    }
                } catch (e) {
                    // ignore
                }
            }
        }
        row.appendChild(lead);

        const openLink = document.createElement('a');
        openLink.className = 'bookmark-open';
        openLink.href = bookmark.url || '#';
        openLink.id = this.bookmarkCellId(bookmark, bookmarkIndex, categoryId);
        openLink.setAttribute('role', 'gridcell');
        /* Roving tabindex: only the arrow-selected row’s link is in tab order (see KeyboardNavigation). */
        openLink.tabIndex = -1;
        const textSpan = document.createElement('span');
        textSpan.className = 'bookmark-text';
        textSpan.textContent = bookmark.name || '';
        openLink.appendChild(textSpan);

        openLink.addEventListener('click', (e) => {
            this.recordBookmarkOpened(bookmark);
            if (document.getElementById('dashboard-layout')?.classList.contains('layout-launcher')) {
                row.classList.remove('bookmark-pulse');
                void row.offsetWidth; // force reflow so re-clicking restarts the animation
                row.classList.add('bookmark-pulse');
                row.addEventListener('animationend', () => row.classList.remove('bookmark-pulse'), { once: true });
            }
            if (window.hyprMode && window.hyprMode.isEnabled()) {
                e.preventDefault();
                window.hyprMode.handleBookmarkClick(bookmark.url);
            }
        });

        if (this.settings.openInNewTab) {
            openLink.target = '_blank';
            openLink.rel = 'noopener noreferrer';
        }

        this.attachBookmarkPreviewBehavior(openLink, bookmark);

        row.appendChild(openLink);

        const shortcutSpan = document.createElement('span');
        shortcutSpan.className = 'bookmark-shortcut';
        shortcutSpan.setAttribute('role', 'presentation');
        const showShortcuts = this.settings.showShortcuts !== false;
        const shortcutText = showShortcuts && bookmark.shortcut && String(bookmark.shortcut).trim()
            ? String(bookmark.shortcut).toUpperCase()
            : '';
        shortcutSpan.textContent = shortcutText;
        if (!shortcutText) {
            shortcutSpan.classList.add('is-empty');
            shortcutSpan.setAttribute('aria-hidden', 'true');
        } else {
            shortcutSpan.dataset.shortcut = shortcutText;
        }
        {
            let linkLabel = bookmark.name || bookmark.url || this.bookmarkFallbackName();
            if (shortcutText) {
                const shortcutPrefix = this.language?.t('dashboard.shortcutAriaPrefix') || 'shortcut';
                linkLabel = `${linkLabel}, ${shortcutPrefix} ${shortcutText}`;
            }
            openLink.setAttribute('aria-label', linkLabel);
        }
        row.appendChild(shortcutSpan);

        const pinBadge = document.createElement('span');
        pinBadge.className = 'bookmark-pin-badge bookmark-superscript-badge';
        const showPinIcon = this.settings.showPinIcon === true;
        if (showPinIcon && bookmark.pinned) {
            pinBadge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/></svg>';
            pinBadge.title = this.formatDashboardLabel('pinnedBookmarkTitle', {}, 'Pinned');
            pinBadge.setAttribute('aria-label', this.formatDashboardLabel('pinnedBookmarkAria', {}, 'Pinned bookmark'));
            pinBadge.setAttribute('role', 'img');
        } else {
            pinBadge.textContent = '';
            pinBadge.classList.add('is-empty');
            pinBadge.setAttribute('aria-hidden', 'true');
        }
        openLink.appendChild(pinBadge);

        const openCountBadge = document.createElement('span');
        openCountBadge.className = 'bookmark-open-count';
        const openCount = Number(bookmark.openCount || 0);
        if (openCount > 0) {
            openCountBadge.textContent = openCount >= 1000 ? `${Math.floor(openCount / 1000)}k` : String(openCount);
            const openCountLabel = openCount === 1
                ? this.formatDashboardLabel('openCountOnce', {}, 'Opened once')
                : this.formatDashboardLabel('openCountMany', { count: openCount }, `Opened ${openCount} times`);
            openCountBadge.title = openCountLabel;
            openCountBadge.setAttribute('aria-label', openCountLabel);
        } else {
            openCountBadge.classList.add('is-empty');
            openCountBadge.setAttribute('aria-hidden', 'true');
        }
        row.appendChild(openCountBadge);

        const noteBadge = document.createElement('span');
        noteBadge.className = 'bookmark-note-badge bookmark-superscript-badge';
        const hasNote = bookmark && String(bookmark.note || '').trim();
        if (hasNote) {
            const label = this.language?.t('bookmark.hasNote') || 'Has note';
            const noteText = String(bookmark.note || '').trim();
            const tooltipText = noteText.length > 200 ? noteText.slice(0, 200) + '…' : noteText;
            noteBadge.setAttribute('data-note-tooltip', tooltipText);
            noteBadge.setAttribute('role', 'img');
            noteBadge.setAttribute('aria-label', label);
            noteBadge.appendChild(this.createNoteBadgeSvg());
        } else {
            noteBadge.classList.add('is-empty');
            noteBadge.setAttribute('aria-hidden', 'true');
        }
        openLink.appendChild(noteBadge);

        if (allowInlineEdit && bookmarkRef) {
            const ac = new AbortController();
            row._bookmarkLongPressAbort = ac;
            this.attachBookmarkRowLongPress(row, openLink, bookmarkRef, ac.signal);
        }
        this.restoreBookmarkRowStatus(row, bookmark);
    }

    restoreBookmarkRowStatus(row, bookmark) {
        if (!this.statusMonitor || !this.settings.showStatus || !bookmark?.checkStatus || !row) {
            return;
        }
        const cached = this.statusMonitor.getCachedStatus(bookmark.url);
        if (cached) {
            const pingText = this.settings.showPing && cached.ping ? `${cached.ping}ms` : '';
            this.statusMonitor.setBookmarkStatus(row, cached.status, pingText);
            return;
        }
        const persisted = this.statusMonitor.getPersistedStatus(bookmark);
        if (persisted) {
            this.statusMonitor.setBookmarkStatus(row, persisted, '');
            return;
        }
        // No cache yet (or URL changed): run a fresh check so status color returns without page refresh.
        this.statusMonitor.refreshBookmarkStatus(bookmark.url);
    }

    resolveBookmarkReference(bookmark) {
        if (!bookmark) {
            return null;
        }
        const bookmarkIndex = this.resolveBookmarkIndex(bookmark);
        if (bookmarkIndex >= 0 && this.bookmarks[bookmarkIndex]) {
            return {
                scope: 'current',
                index: bookmarkIndex,
                pageId: Number(this.currentPageId),
                bookmark: this.bookmarks[bookmarkIndex],
                original: { ...this.bookmarks[bookmarkIndex] }
            };
        }

        const sourcePageId = Number(bookmark.pageId || bookmark.pageID || 0);
        if (!Number.isFinite(sourcePageId) || sourcePageId <= 0) {
            return null;
        }
        return {
            scope: 'remote',
            pageId: sourcePageId,
            bookmark,
            original: { ...bookmark }
        };
    }

    enterBookmarkInlineEditFocusMode() {
        document.body.classList.add('bookmark-inline-edit-active');
    }

    leaveBookmarkInlineEditFocusMode() {
        document.body.classList.remove('bookmark-inline-edit-active');
    }

    openBookmarkInlineEditor(row, bookmarkRef) {
        if (!bookmarkRef || !bookmarkRef.bookmark) {
            return;
        }
        // Inline editor should always take focus; clear any active preview card/timers first.
        this.dismissBookmarkPreviewInteractions();
        const bookmark = bookmarkRef.bookmark;
        if (!bookmark) {
            return;
        }
        if (row._bookmarkLongPressAbort) {
            row._bookmarkLongPressAbort.abort();
            row._bookmarkLongPressAbort = null;
        }

        const bookmarkIndex = bookmarkRef.scope === 'current' ? bookmarkRef.index : -1;
        this.inlineEditingBookmarkIndex = bookmarkIndex;
        row.classList.add('bookmark-inline-editing');
        row.innerHTML = '';

        const form = document.createElement('div');
        form.className = 'bookmark-inline-form';

        const cfg = (key, fallback) => this.configLabel(key, fallback);

        const mkField = (labelText, inputEl) => {
            const wrap = document.createElement('div');
            wrap.className = 'bookmark-inline-field';
            const lab = document.createElement('label');
            lab.className = 'bookmark-inline-label';
            lab.textContent = labelText;
            wrap.appendChild(lab);
            wrap.appendChild(inputEl);
            return wrap;
        };

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'bookmark-inline-input';
        nameInput.value = bookmark.name || '';
        form.appendChild(mkField(cfg('bookmarkName', 'Name'), nameInput));

        const urlInput = document.createElement('input');
        urlInput.type = 'url';
        urlInput.className = 'bookmark-inline-input';
        urlInput.value = bookmark.url || '';
        form.appendChild(mkField(cfg('urlLabelShort', 'URL'), urlInput));

        let pendingIcon = String(bookmark.icon || '').trim();
        const iconPreview = document.createElement('div');
        iconPreview.className = 'bookmark-inline-icon-preview';

        const iconUrlInput = document.createElement('input');
        iconUrlInput.type = 'text';
        iconUrlInput.className = 'bookmark-inline-input';
        iconUrlInput.placeholder = cfg('detailIconUrlPlaceholder', 'https://.../icon.png');
        iconUrlInput.value = pendingIcon ? `/data/icons/${pendingIcon}` : '';

        const iconActions = document.createElement('div');
        iconActions.className = 'bookmark-inline-icon-actions';

        const setIconBtn = document.createElement('button');
        setIconBtn.type = 'button';
        setIconBtn.className = 'bookmark-inline-action-btn bookmark-inline-save';
        setIconBtn.textContent = cfg('detailSetIconUrlBtn', 'Set URL');

        const fetchIconBtn = document.createElement('button');
        fetchIconBtn.type = 'button';
        fetchIconBtn.className = 'bookmark-inline-action-btn';
        fetchIconBtn.textContent = cfg('fetch', 'Fetch');
        let inlineAutoFetchTimer = null;
        let inlineAutoFetchInFlight = false;

        const uploadIconBtn = document.createElement('button');
        uploadIconBtn.type = 'button';
        uploadIconBtn.className = 'bookmark-inline-action-btn';
        uploadIconBtn.textContent = cfg('detailUploadIconBtn', 'Upload');

        const iconFileInput = document.createElement('input');
        iconFileInput.type = 'file';
        iconFileInput.accept = 'image/*,.ico,.svg,.webp';
        iconFileInput.style.display = 'none';

        const clearIconBtn = document.createElement('button');
        clearIconBtn.type = 'button';
        clearIconBtn.className = 'bookmark-inline-action-btn';
        clearIconBtn.textContent = cfg('detailClearIconBtn', 'Clear');

        const iconState = document.createElement('span');
        iconState.className = 'bookmark-inline-icon-state';
        const iconFetchState = document.createElement('span');
        iconFetchState.className = 'bookmark-inline-icon-state';

        const syncIconState = () => {
            iconState.textContent = pendingIcon
                ? (this.language.t('config.iconSet') || 'Icon set')
                : (this.language.t('config.iconNone') || 'No icon');
            clearIconBtn.disabled = !pendingIcon;
            if (pendingIcon) {
                iconPreview.innerHTML = `<img src="/data/icons/${pendingIcon}" alt="">`;
            } else {
                iconPreview.innerHTML = `<span>${cfg('iconNone', 'No icon')}</span>`;
            }
        };

        setIconBtn.addEventListener('click', async () => {
            const inputValue = (iconUrlInput.value || '').trim();
            if (!inputValue) {
                this.showErrorNotification('Icon URL is required.');
                return;
            }
            if (inputValue.startsWith('/data/icons/')) {
                const existingIcon = inputValue.replace('/data/icons/', '').trim();
                if (!existingIcon) {
                    this.showErrorNotification('Icon URL is required.');
                    return;
                }
                pendingIcon = existingIcon;
                syncIconState();
                iconFetchState.textContent = this.language.t('config.iconSet') || 'Icon set';
                this.showNotification(this.language.t('dashboard.iconUrlSet') || 'Icon URL set.', 'success');
                return;
            }
            setIconBtn.disabled = true;
            iconFetchState.textContent = this.language.t('config.iconFetching') || 'Fetching...';
            const nextIcon = await this.uploadBookmarkIconFromUrl(inputValue);
            setIconBtn.disabled = false;
            if (!nextIcon) {
                iconFetchState.textContent = this.language.t('config.iconFetchFailed') || 'Fetch failed';
                this.showErrorNotification('Invalid or blocked icon URL.');
                return;
            }
            pendingIcon = nextIcon;
            iconUrlInput.value = `/data/icons/${nextIcon}`;
            syncIconState();
            iconFetchState.textContent = this.language.t('config.iconFound') || 'Found';
            this.showNotification('Icon URL set.', 'success');
        });

        fetchIconBtn.addEventListener('click', async () => {
            const urlValue = (urlInput.value || '').trim();
            if (!urlValue) {
                this.showErrorNotification('URL is required.');
                return;
            }
            fetchIconBtn.disabled = true;
            iconFetchState.textContent = this.language.t('config.iconFetching') || 'Fetching...';
            const fetchedIcon = await this.fetchAndAssignFaviconForUrl(urlValue);
            fetchIconBtn.disabled = false;
            if (!fetchedIcon) {
                iconFetchState.textContent = this.language.t('config.iconNotFound') || 'Not found';
                this.showErrorNotification('Favicon fetch failed.');
                return;
            }
            pendingIcon = fetchedIcon;
            iconUrlInput.value = `/data/icons/${fetchedIcon}`;
            syncIconState();
            iconFetchState.textContent = this.language.t('config.iconFound') || 'Found';
            this.showNotification('Favicon fetched.', 'success');
        });
        urlInput.addEventListener('blur', () => {
            if (inlineAutoFetchTimer) {
                clearTimeout(inlineAutoFetchTimer);
            }
            inlineAutoFetchTimer = setTimeout(async () => {
                const urlValue = (urlInput.value || '').trim();
                if (!urlValue || pendingIcon || inlineAutoFetchInFlight) {
                    return;
                }
                inlineAutoFetchInFlight = true;
                iconFetchState.textContent = this.language.t('config.iconFetching') || 'Fetching...';
                const fetchedIcon = await this.fetchAndAssignFaviconForUrl(urlValue);
                inlineAutoFetchInFlight = false;
                if (!fetchedIcon) {
                    iconFetchState.textContent = this.language.t('config.iconNotFound') || 'Not found';
                    return;
                }
                pendingIcon = fetchedIcon;
                iconUrlInput.value = `/data/icons/${fetchedIcon}`;
                syncIconState();
                iconFetchState.textContent = this.language.t('config.iconFound') || 'Found';
            }, 250);
        });

        uploadIconBtn.addEventListener('click', () => {
            iconFileInput.click();
        });

        iconFileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) {
                return;
            }
            uploadIconBtn.disabled = true;
            const uploadedIcon = await this.uploadBookmarkIconFile(file);
            uploadIconBtn.disabled = false;
            e.target.value = '';
            if (!uploadedIcon) {
                this.showErrorNotification('Icon upload failed.');
                return;
            }
            pendingIcon = uploadedIcon;
            iconUrlInput.value = `/data/icons/${uploadedIcon}`;
            syncIconState();
            this.showNotification('Icon uploaded.', 'success');
        });

        clearIconBtn.addEventListener('click', () => {
            pendingIcon = '';
            iconUrlInput.value = '';
            syncIconState();
        });

        iconActions.appendChild(uploadIconBtn);
        iconActions.appendChild(fetchIconBtn);
        iconActions.appendChild(setIconBtn);
        iconActions.appendChild(clearIconBtn);
        iconActions.appendChild(iconState);
        iconActions.appendChild(iconFetchState);
        const iconWrap = mkField(cfg('iconUrlOptional', 'Icon URL (opt)'), iconUrlInput);
        iconWrap.appendChild(iconPreview);
        iconWrap.appendChild(iconFileInput);
        iconWrap.appendChild(iconActions);
        form.appendChild(iconWrap);
        syncIconState();

        // Note field
        const noteInput = document.createElement('textarea');
        noteInput.className = 'bookmark-inline-textarea';
        noteInput.value = bookmark.note || '';
        form.appendChild(mkField(this.language.t('bookmark.noteLabel') || 'Note', noteInput));

        const tagsInput = document.createElement('input');
        tagsInput.type = 'text';
        tagsInput.className = 'bookmark-inline-input';
        tagsInput.placeholder = cfg('detailTagsPlaceholder', 'work, dev, personal…');
        tagsInput.value = (Array.isArray(bookmark.tags) ? bookmark.tags : []).join(', ');
        form.appendChild(mkField(cfg('detailTagsLabel', 'Tags'), tagsInput));
        // Seed session pool from loaded bookmarks
        (this.allBookmarks?.length ? this.allBookmarks : this.bookmarks ?? []).forEach(bm => (bm.tags || []).forEach(t => _sessionTags.add(t)));
        TagAutocomplete.attach(tagsInput, () => {
            tagsInput.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).forEach(t => _sessionTags.add(t));
            return [..._sessionTags];
        });

        const shortcutInput = document.createElement('input');
        shortcutInput.type = 'text';
        shortcutInput.className = 'bookmark-inline-input';
        shortcutInput.maxLength = 5;
        shortcutInput.value = (bookmark.shortcut || '').toUpperCase();
        const shortcutConflictHint = document.createElement('span');
        shortcutConflictHint.className = 'bookmark-inline-conflict';
        shortcutConflictHint.hidden = true;
        shortcutConflictHint.textContent = this.language?.t('config.shortcutConflict') || 'Shortcut already in use';
        const syncShortcutConflict = (value) => {
            const normalized = String(value || '').trim();
            const conflict = Boolean(normalized) && this.hasShortcutConflict(normalized, bookmarkRef);
            shortcutConflictHint.hidden = !conflict;
            shortcutInput.classList.toggle('field-conflict', conflict);
        };
        shortcutInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
            syncShortcutConflict(e.target.value);
        });
        syncShortcutConflict(shortcutInput.value);
        const shortcutField = mkField(cfg('shortcut', 'Shortcut'), shortcutInput);
        shortcutField.appendChild(shortcutConflictHint);
        form.appendChild(shortcutField);

        const catSelect = document.createElement('select');
        catSelect.className = 'bookmark-inline-select';
        const optEmpty = document.createElement('option');
        optEmpty.value = '';
        optEmpty.textContent = '—';
        catSelect.appendChild(optEmpty);
        (this.categories || []).forEach((cat) => {
            const o = document.createElement('option');
            o.value = cat.id || '';
            o.textContent = cat.name || cat.id || '';
            if ((bookmark.category || '') === (cat.id || '')) {
                o.selected = true;
            }
            catSelect.appendChild(o);
        });
        form.appendChild(mkField(cfg('category', 'Category'), catSelect));

        const pageSelect = document.createElement('select');
        pageSelect.className = 'bookmark-inline-select';
        const currentPageId = Number(this.currentPageId);
        (Array.isArray(this.pages) ? this.pages : []).forEach((page) => {
            const o = document.createElement('option');
            o.value = page.id;
            o.textContent = page.name || String(page.id);
            if (Number(page.id) === currentPageId) o.selected = true;
            pageSelect.appendChild(o);
        });
        form.appendChild(mkField(cfg('page', 'Page'), pageSelect));

        const reloadCatSelectForPage = async (pageId) => {
            const isCurrentPage = Number(pageId) === currentPageId;
            const cats = isCurrentPage
                ? (this.categories || [])
                : await fetch(`/api/categories?page=${pageId}`).then(r => r.ok ? r.json() : []).catch(() => []);
            const prevValue = catSelect.value;
            catSelect.innerHTML = '';
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '—';
            catSelect.appendChild(empty);
            let matched = false;
            cats.forEach(cat => {
                const o = document.createElement('option');
                o.value = cat.id || '';
                o.textContent = cat.name || cat.id || '';
                if ((cat.id || '') === prevValue) { o.selected = true; matched = true; }
                catSelect.appendChild(o);
            });
            // No match from previous page — default to first real category so bookmark doesn't land in Others
            if (!matched && cats.length > 0) {
                catSelect.selectedIndex = 1;
            }
        };

        pageSelect.addEventListener('change', () => reloadCatSelectForPage(pageSelect.value));

        const pinInput = document.createElement('input');
        pinInput.type = 'checkbox';
        pinInput.id = `bookmark-inline-pin-${bookmarkIndex >= 0 ? bookmarkIndex : `remote-${bookmarkRef.pageId}`}`;
        pinInput.checked = Boolean(bookmark.pinned);
        const pinWrap = document.createElement('div');
        pinWrap.className = 'bookmark-inline-field bookmark-inline-check';
        const pinLabel = document.createElement('label');
        pinLabel.htmlFor = pinInput.id;
        pinLabel.textContent = cfg('pinnedShort', 'Pinned');
        pinWrap.appendChild(pinInput);
        pinWrap.appendChild(pinLabel);
        form.appendChild(pinWrap);

        const statusInput = document.createElement('input');
        statusInput.type = 'checkbox';
        statusInput.id = `bookmark-inline-status-${bookmarkIndex >= 0 ? bookmarkIndex : `remote-${bookmarkRef.pageId}`}`;
        statusInput.checked = Boolean(bookmark.checkStatus);
        const statusWrap = document.createElement('div');
        statusWrap.className = 'bookmark-inline-field bookmark-inline-check';
        const statusLabel = document.createElement('label');
        statusLabel.htmlFor = statusInput.id;
        statusLabel.textContent = cfg('statusCheck', 'Status check');
        statusWrap.appendChild(statusInput);
        statusWrap.appendChild(statusLabel);
        form.appendChild(statusWrap);

        const actions = document.createElement('div');
        actions.className = 'bookmark-inline-actions';

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'bookmark-inline-action-btn bookmark-inline-save';
        saveBtn.textContent = cfg('saveChanges', 'Save');
        saveBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await this.commitBookmarkInlineEdit(bookmarkRef, {
                nameInput,
                urlInput,
                iconUrlInput,
                shortcutInput,
                catSelect,
                pageSelect,
                pinInput,
                statusInput,
                noteInput,
                tagsInput,
                getPendingIcon: () => pendingIcon
            }, row);
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'bookmark-inline-action-btn';
        cancelBtn.textContent = this.formatDashboardLabel('cancel', {}, 'Cancel');
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.cancelBookmarkInlineEdit(row, bookmarkRef);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'bookmark-inline-action-btn bookmark-inline-delete';
        deleteBtn.textContent = cfg('delete', 'Delete');
        if (bookmarkRef.scope !== 'current') {
            deleteBtn.style.display = 'none';
        }
        deleteBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await this.deleteBookmarkAtIndexInline(bookmarkIndex);
        });

        actions.appendChild(saveBtn);
        actions.appendChild(cancelBtn);
        actions.appendChild(deleteBtn);

        const hint = document.createElement('span');
        hint.className = 'bookmark-inline-hint';
        hint.textContent = this.formatDashboardLabel(
            'inlineEditHint',
            {},
            'Ctrl+Enter to save · Esc to cancel'
        );
        actions.appendChild(hint);

        form.appendChild(actions);

        form.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.cancelBookmarkInlineEdit(row, bookmarkRef);
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                saveBtn.click();
            }
        });

        const rowRect = row.getBoundingClientRect();
        const formExpectedWidth = Math.max(rowRect.width, Math.min(420, window.innerWidth * 0.9));
        const rightOverflow = (rowRect.left + formExpectedWidth) - (window.innerWidth - 8);
        if (rightOverflow > 0) {
            form.style.marginLeft = `-${Math.ceil(rightOverflow)}px`;
        }

        row.appendChild(form);
        this.destroyCategoryReorderInstances();
        this.initializeCategoryReorder();
        this.enterBookmarkInlineEditFocusMode();
        nameInput.focus();
        nameInput.select();
    }

    async commitBookmarkInlineEdit(bookmarkRef, fields, row) {
        const bookmark = bookmarkRef?.bookmark;
        if (!bookmark || !bookmarkRef) {
            return;
        }

        const name = fields.nameInput.value.trim();
        const url = fields.urlInput.value.trim();
        const shortcut = fields.shortcutInput.value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
        const category = fields.catSelect.value;
        const targetPageId = fields.pageSelect ? Number(fields.pageSelect.value) : null;
        const isPageMove = bookmarkRef.scope === 'current'
            && targetPageId !== null
            && Number.isFinite(targetPageId)
            && targetPageId !== Number(this.currentPageId);

        if (!name || !url) {
            this.showErrorNotification('Name and URL are required.');
            return;
        }

        if (shortcut && this.hasShortcutConflict(shortcut, bookmarkRef)) {
            this.showErrorNotification('Shortcut must be unique across all bookmarks.');
            fields.shortcutInput.focus();
            fields.shortcutInput.select();
            return;
        }

        if (shortcut) {
            const finderShortcutConflict = (Array.isArray(this.finders) ? this.finders : []).some((finder) => {
                return String(finder?.shortcut || '').trim().toUpperCase() === shortcut;
            });
            if (finderShortcutConflict) {
                this.showNotification('Warning: this shortcut is also used by a finder.', 'error');
            }
        }

        const previousUrl = String(bookmark.url || '').trim();
        const parsedTags = fields.tagsInput
            ? fields.tagsInput.value.split(',').map(t => t.trim().toLowerCase()).filter((t, i, arr) => t && arr.indexOf(t) === i)
            : (bookmark.tags || []);
        const nextBookmarkState = {
            name,
            url,
            icon: typeof fields.getPendingIcon === 'function' ? fields.getPendingIcon() : bookmark.icon,
            shortcut,
            category,
            pinned: fields.pinInput.checked,
            checkStatus: fields.statusInput.checked,
            note: fields.noteInput ? String(fields.noteInput.value || '').trim() : (bookmark.note || ''),
            tags: parsedTags
        };

        if (isPageMove) {
            await this._moveBookmarkToPage(bookmarkRef, nextBookmarkState, targetPageId, row);
            return;
        }

        if (bookmarkRef.scope === 'current') {
            this.ensureBookmarkMutationSnapshot();
            Object.assign(bookmark, nextBookmarkState);
            this.inlineEditingBookmarkIndex = null;
            this.syncEditedBookmarkAcrossCollections(bookmarkRef, previousUrl);
            this.renderDashboard();
            this.scheduleBookmarkOrderSave();
            return;
        }

        const savedRemote = await this.saveRemoteBookmarkEdit(bookmarkRef, nextBookmarkState);
        if (!savedRemote) {
            return;
        }

        this.inlineEditingBookmarkIndex = null;
        await this.loadAllBookmarks();
        this.renderDashboard();
    }

    async _moveBookmarkToPage(bookmarkRef, bookmarkState, targetPageId, row) {
        const index = bookmarkRef.index;
        try {
            // Animate row out before removing
            if (row) {
                row.classList.add('bookmark-move-out');
                await new Promise(resolve => setTimeout(resolve, 320));
            }

            // Remove from current page
            this.ensureBookmarkMutationSnapshot();
            this.bookmarks.splice(index, 1);

            // Load target page, append bookmark (keep chosen category, or clear if none chosen)
            const targetRes = await fetch(`/api/bookmarks?page=${targetPageId}`);
            if (!targetRes.ok) throw new Error('Failed to load target page.');
            const targetBookmarks = await targetRes.json();
            targetBookmarks.push({ ...bookmarkState });

            // Save both pages
            await fetch(`/api/bookmarks?page=${this.currentPageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.bookmarks)
            });
            await fetch(`/api/bookmarks?page=${targetPageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(targetBookmarks)
            });

            const targetPage = (Array.isArray(this.pages) ? this.pages : []).find(p => Number(p.id) === targetPageId);
            const targetName = targetPage?.name || String(targetPageId);

            this.inlineEditingBookmarkIndex = null;
            // Reload current page so categories are fresh (config may have added new ones)
            await this.loadPageBookmarks(this.currentPageId);
            this.renderDashboard();
            this.showNotification(`Moved to "${targetName}".`, 'success');
        } catch (err) {
            this.showErrorNotification(err.message || 'Failed to move bookmark.');
        }
    }

    hasShortcutConflict(shortcut, bookmarkRef) {
        const normalized = String(shortcut || '').trim().toUpperCase();
        if (!normalized) {
            return false;
        }

        const ignoreBookmarkIndex = bookmarkRef?.scope === 'current' ? bookmarkRef.index : -1;
        const localConflict = (Array.isArray(this.bookmarks) ? this.bookmarks : []).some((bookmark, index) => {
            if (index === ignoreBookmarkIndex) {
                return false;
            }
            return String(bookmark?.shortcut || '').trim().toUpperCase() === normalized;
        });
        if (localConflict) {
            return true;
        }

        const currentPageIdNumber = Number(this.currentPageId);
        return (Array.isArray(this.allBookmarks) ? this.allBookmarks : []).some((bookmark) => {
            const shortcutValue = String(bookmark?.shortcut || '').trim().toUpperCase();
            if (!shortcutValue || shortcutValue !== normalized) {
                return false;
            }
            if (bookmarkRef?.scope === 'remote' && this.isSameBookmarkReference(bookmarkRef, bookmark)) {
                return false;
            }
            if (bookmarkRef?.scope === 'current' && this.isSameBookmarkReference(bookmarkRef, bookmark)) {
                return false;
            }
            const bookmarkPageId = Number(bookmark?.pageId || bookmark?.pageID || 0);
            return bookmarkPageId !== currentPageIdNumber;
        });
    }

    isSameBookmarkReference(bookmarkRef, candidate) {
        if (!bookmarkRef || !candidate) {
            return false;
        }
        const refPageId = Number(bookmarkRef.pageId || this.currentPageId);
        const candidatePageId = Number(candidate.pageId || candidate.pageID || this.currentPageId);
        if (refPageId !== candidatePageId) {
            return false;
        }
        const original = bookmarkRef.original || {};
        const originalUrl = String(original.url || '').trim();
        const originalName = String(original.name || '').trim();
        const candidateUrl = String(candidate.url || '').trim();
        const candidateName = String(candidate.name || '').trim();
        return originalUrl === candidateUrl && originalName === candidateName;
    }

    async uploadBookmarkIconFromUrl(iconUrl) {
        try {
            const response = await fetch('/api/icon/from-url', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url: iconUrl })
            });
            if (!response.ok) {
                return '';
            }
            const result = await response.json();
            return String(result?.icon || '').trim();
        } catch (error) {
            return '';
        }
    }

    async uploadBookmarkIconFile(file) {
        const formData = new FormData();
        formData.append('icon', file);
        try {
            const response = await fetch('/api/icon', {
                method: 'POST',
                body: formData
            });
            if (!response.ok) {
                return '';
            }
            const result = await response.json();
            return String(result?.icon || '').trim();
        } catch (error) {
            return '';
        }
    }

    deriveFaviconFromBookmarkUrl(bookmarkUrl) {
        const safeUrl = String(bookmarkUrl || '').trim();
        if (!safeUrl) {
            return '';
        }
        try {
            const parsed = new URL(safeUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return '';
            }
            return `${parsed.protocol}//${parsed.host}/favicon.ico`;
        } catch (_error) {
            return '';
        }
    }

    async fetchAndAssignFaviconForUrl(bookmarkUrl) {
        const safeUrl = String(bookmarkUrl || '').trim();
        if (!safeUrl) {
            return '';
        }
        try {
            const previewResponse = await fetch(`/api/bookmark-preview?url=${encodeURIComponent(safeUrl)}`);
            if (previewResponse.ok) {
                const preview = await previewResponse.json();
                const previewIconUrl = String(preview?.icon || '').trim();
                if (previewIconUrl) {
                    const iconFromPreview = await this.uploadBookmarkIconFromUrl(previewIconUrl);
                    if (iconFromPreview) {
                        return iconFromPreview;
                    }
                }
            }
        } catch (_error) {
            // Ignore and continue fallback.
        }
        const fallbackUrl = this.deriveFaviconFromBookmarkUrl(safeUrl);
        if (!fallbackUrl) {
            return '';
        }
        return this.uploadBookmarkIconFromUrl(fallbackUrl);
    }

    cancelBookmarkInlineEdit(row, bookmarkRef) {
        this.leaveBookmarkInlineEditFocusMode();
        const bookmark = bookmarkRef?.bookmark;
        if (!bookmark) {
            this.inlineEditingBookmarkIndex = null;
            this.renderDashboard();
            return;
        }
        const categoryId = row.getAttribute('data-category-id') || bookmark.category || '';
        this.inlineEditingBookmarkIndex = null;
        this.populateBookmarkRowView(row, bookmark, categoryId, true);
        this.destroyCategoryReorderInstances();
        this.initializeCategoryReorder();
    }

    syncEditedBookmarkAcrossCollections(bookmarkRef, previousUrl = '') {
        if (!bookmarkRef || !bookmarkRef.bookmark) {
            return;
        }
        const updated = bookmarkRef.bookmark;
        const updatedPageId = Number(bookmarkRef.pageId || this.currentPageId);
        const previousUrlTrimmed = String(previousUrl || '').trim();
        const updatedUrlTrimmed = String(updated.url || '').trim();

        if (!Array.isArray(this.allBookmarks)) {
            return;
        }

        this.allBookmarks.forEach((bookmark) => {
            const bookmarkPageId = Number(bookmark.pageId || bookmark.pageID || 0);
            if (bookmarkPageId !== updatedPageId) {
                return;
            }
            const bookmarkUrl = String(bookmark.url || '').trim();
            const shouldSync = this.isSameBookmarkReference(bookmarkRef, bookmark)
                || (previousUrlTrimmed && bookmarkUrl === previousUrlTrimmed);
            if (!shouldSync) {
                return;
            }
            bookmark.name = updated.name;
            bookmark.url = updated.url;
            bookmark.icon = updated.icon;
            bookmark.shortcut = updated.shortcut;
            bookmark.category = updated.category;
            bookmark.pinned = updated.pinned;
            bookmark.checkStatus = updated.checkStatus;
        });

        if (updatedUrlTrimmed && previousUrlTrimmed && updatedUrlTrimmed !== previousUrlTrimmed) {
            bookmarkRef.original.url = updated.url;
        }
        bookmarkRef.original.name = updated.name;
        bookmarkRef.original.shortcut = updated.shortcut;
        bookmarkRef.original.category = updated.category;
    }

    findBookmarkIndexByReference(list, bookmarkRef) {
        const original = bookmarkRef?.original || {};
        const originalUrl = String(original.url || '').trim();
        const originalName = String(original.name || '').trim();
        const originalShortcut = String(original.shortcut || '').trim().toUpperCase();
        const originalCategory = String(original.category || '').trim();

        let index = list.findIndex((bookmark) => {
            return String(bookmark?.url || '').trim() === originalUrl
                && String(bookmark?.name || '').trim() === originalName
                && String(bookmark?.shortcut || '').trim().toUpperCase() === originalShortcut
                && String(bookmark?.category || '').trim() === originalCategory;
        });
        if (index >= 0) return index;

        index = list.findIndex((bookmark) => {
            return String(bookmark?.url || '').trim() === originalUrl
                && String(bookmark?.name || '').trim() === originalName;
        });
        if (index >= 0) return index;

        return list.findIndex((bookmark) => String(bookmark?.url || '').trim() === originalUrl);
    }

    async saveRemoteBookmarkEdit(bookmarkRef, editedBookmark) {
        const pageId = Number(bookmarkRef.pageId || 0);
        if (!Number.isFinite(pageId) || pageId <= 0) {
            this.showErrorNotification('Unable to resolve bookmark source page.');
            return false;
        }

        try {
            const pageResponse = await fetch(`/api/bookmarks?page=${pageId}`);
            if (!pageResponse.ok) {
                throw new Error('Failed to load source page bookmarks.');
            }
            const sourceBookmarks = await pageResponse.json();
            const sourceIndex = this.findBookmarkIndexByReference(sourceBookmarks, bookmarkRef);
            if (sourceIndex < 0) {
                throw new Error('Could not locate original bookmark on source page.');
            }

            sourceBookmarks[sourceIndex] = {
                ...sourceBookmarks[sourceIndex],
                name: editedBookmark.name,
                url: editedBookmark.url,
                icon: editedBookmark.icon,
                shortcut: editedBookmark.shortcut,
                category: editedBookmark.category,
                pinned: editedBookmark.pinned,
                checkStatus: editedBookmark.checkStatus
            };

            const saveResponse = await fetch(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(sourceBookmarks)
            });
            if (!saveResponse.ok) {
                throw new Error('Failed to save bookmark on source page.');
            }

            Object.assign(bookmarkRef.bookmark, editedBookmark);
            this.syncEditedBookmarkAcrossCollections(bookmarkRef, bookmarkRef.original?.url || '');
            return true;
        } catch (error) {
            this.showErrorNotification(error.message || 'Failed to save bookmark changes.');
            return false;
        }
    }

    async deleteBookmarkAtIndexInline(bookmarkIndex) {
        const bookmark = this.bookmarks[bookmarkIndex];
        if (!bookmark) {
            return;
        }

        let confirmed = false;
        if (window.AppModal && typeof window.AppModal.danger === 'function') {
            const safeName = String(bookmark.name || this.bookmarkFallbackName()).replace(/</g, '');
            confirmed = await window.AppModal.danger({
                title: this.configLabel('removeBookmarkTitle', 'Remove bookmark'),
                message: this.formatDashboardLabel('deleteBookmarkConfirm', { name: safeName }, `Remove "${safeName}"?`),
                confirmText: this.configLabel('delete', 'Delete'),
                cancelText: this.formatDashboardLabel('cancel', {}, 'Cancel')
            });
        } else {
            confirmed = window.confirm(this.configLabel('removeBookmarkMessage', 'Delete this bookmark?'));
        }

        if (!confirmed) {
            return;
        }

        this.ensureBookmarkMutationSnapshot();
        const deletedBookmark = { ...bookmark };
        const deletedIndex = bookmarkIndex;
        this.bookmarks.splice(bookmarkIndex, 1);
        this.inlineEditingBookmarkIndex = null;
        this.renderDashboard();

        if (this._pendingDeleteTimer) {
            clearTimeout(this._pendingDeleteTimer);
            this._pendingDeleteTimer = null;
        }

        this._pendingDeleteTimer = setTimeout(() => {
            this._pendingDeleteTimer = null;
            this.scheduleBookmarkOrderSave({ successMessage: 'Bookmark deleted.' });
        }, 5000);

        this.showNotification(
            `"${String(deletedBookmark.name || deletedBookmark.url).slice(0, 40)}" verwijderd`,
            'success',
            {
                duration: 5000,
                undoCallback: () => {
                    if (this._pendingDeleteTimer) {
                        clearTimeout(this._pendingDeleteTimer);
                        this._pendingDeleteTimer = null;
                    }
                    this.bookmarks.splice(deletedIndex, 0, deletedBookmark);
                    this.pendingReorderSnapshot = null;
                    this.renderDashboard();
                }
            }
        );
    }

    createBookmarkElement(bookmark, categoryId, allowInlineEdit = true) {
        const row = document.createElement('div');
        this.populateBookmarkRowView(row, bookmark, categoryId, allowInlineEdit);
        return row;
    }

    createRecentBookmarkElement(bookmark) {
        const link = document.createElement('a');
        link.href = bookmark.url;
        link.className = 'bookmark-link recent-bookmark-link';

        const textWrapper = document.createElement('span');
        textWrapper.className = 'bookmark-text recent-bookmark-text';
        textWrapper.textContent = bookmark.name;
        link.appendChild(textWrapper);

        const meta = document.createElement('span');
        meta.className = 'bookmark-shortcut recent-bookmark-meta';
        meta.textContent = bookmark.category || 'No category';
        link.appendChild(meta);

        if (this.settings.openInNewTab) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }

        link.addEventListener('click', () => {
            this.recordBookmarkOpened(bookmark);
        });

        return link;
    }

    static OPEN_TABS_CAP = 15;
    static OPEN_LAST_DEFAULT = 5;
    static RECENT_MODAL_DISPLAY_LIMIT = 10;

    formatDashboardLabel(key, replacements = {}, fallback = '') {
        let text = this.language?.t(`dashboard.${key}`) || fallback || key;
        Object.entries(replacements).forEach(([name, value]) => {
            text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
        });
        return text;
    }

    configLabel(key, fallback = '') {
        const fullKey = `config.${key}`;
        const value = this.language?.t(fullKey);
        return value && value !== fullKey ? value : fallback;
    }

    bookmarkFallbackName() {
        return this.configLabel('detailBookmarkFallback', '')
            || this.formatDashboardLabel('bookmarkLinkFallback', {}, 'Bookmark');
    }

    _hashForA11yId(value) {
        const str = String(value || '');
        let hash = 0;
        for (let i = 0; i < str.length; i += 1) {
            hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash).toString(36) || '0';
    }

    bookmarkCellId(bookmark, bookmarkIndex, categoryId) {
        const pageId = Number(this.currentPageId) || 0;
        const cat = String(categoryId ?? 'x').replace(/[^a-zA-Z0-9_-]/g, '') || 'x';
        if (bookmarkIndex >= 0) {
            return `bookmark-cell-p${pageId}-${cat}-i${bookmarkIndex}`;
        }
        const url = String(bookmark?.url || '').trim();
        const seed = url || String(bookmark?.name || 'bookmark');
        return `bookmark-cell-p${pageId}-${cat}-u${this._hashForA11yId(seed)}`;
    }

    getBookmarkGridElement() {
        const root = document.getElementById('dashboard-layout');
        if (!root) {
            return null;
        }
        return root.querySelector('.tag-filter-view-body[role="grid"]') || root;
    }

    syncBookmarkGridA11y() {
        const grid = this.getBookmarkGridElement();
        if (!grid || grid.getAttribute('role') !== 'grid') {
            return;
        }

        const rowgroups = grid.querySelectorAll('.category[role="rowgroup"]');
        let totalRows = 0;
        rowgroups.forEach((group) => {
            const rows = group.querySelectorAll('.bookmark-link[data-bookmark-url]');
            group.setAttribute('aria-rowcount', String(rows.length));
            rows.forEach((row, idx) => {
                row.setAttribute('aria-rowindex', String(idx + 1));
                const openLink = row.querySelector('a.bookmark-open');
                if (openLink) {
                    openLink.setAttribute('aria-colindex', '1');
                    openLink.setAttribute('aria-colcount', '1');
                }
            });
            totalRows += rows.length;
        });

        grid.setAttribute('aria-rowcount', String(totalRows));
        const layoutCols = typeof this.getEffectiveColumnsPerRow === 'function'
            ? this.getEffectiveColumnsPerRow()
            : 1;
        grid.setAttribute('aria-colcount', String(Math.max(1, layoutCols)));
    }

    /**
     * Same sort/filter as {@link getRecentBookmarks}, then drops rows without a URL.
     * Pass the same bookmark array you would pass to {@link getRecentBookmarks} (page-local:
     * `this.bookmarks`, not `this.allBookmarks`).
     */
    getRecentBookmarksWithUrls(bookmarks, limit) {
        return this.getRecentBookmarks(bookmarks, limit).filter(
            (bookmark) => bookmark && String(bookmark.url || '').trim()
        );
    }

    sameBookmarkList(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        const key = (bookmark) => String(bookmark?.id ?? bookmark?.url ?? '');
        return a.every((item, index) => key(item) === key(b[index]));
    }

    buildOpenTabsPlans(bookmarks, labelKeys) {
        const list = (bookmarks || []).filter((b) => b && String(b.url || '').trim());
        if (list.length === 0) return [];

        const cap = Dashboard.OPEN_TABS_CAP;
        const n = list.length;
        if (n <= cap) {
            return [{
                label: this.formatDashboardLabel(labelKeys.all, { n }, `Open ${n}`),
                bookmarks: list,
            }];
        }
        return [
            {
                label: this.formatDashboardLabel(labelKeys.first, { cap, n }, `Open first ${cap} of ${n}`),
                bookmarks: list.slice(0, cap),
            },
            {
                label: this.formatDashboardLabel(labelKeys.all, { n }, `Open all ${n}`),
                bookmarks: list,
            },
        ];
    }

    openBookmarksInNewTabs(bookmarks) {
        (bookmarks || []).forEach((bookmark) => {
            const url = String(bookmark?.url || '').trim();
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
        });
    }

    isRecentBookmarksModalOpen() {
        const overlay = document.getElementById('app-modal');
        const panel = overlay ? overlay.querySelector('.modal') : null;
        return Boolean(
            overlay &&
            panel &&
            overlay.classList.contains('show') &&
            panel.classList.contains('recent-bookmarks-modal')
        );
    }

    toggleRecentBookmarksModal() {
        if (!window.AppModal) {
            return;
        }

        if (this.isModalOpen() && !this.isRecentBookmarksModalOpen()) {
            return;
        }

        if (this.isRecentBookmarksModalOpen()) {
            window.AppModal.hide();
            return;
        }

        // Page-local recent list (* modal) — always this.bookmarks, never allBookmarks.
        const recentBookmarks = this.getRecentBookmarks(
            this.bookmarks,
            Dashboard.RECENT_MODAL_DISPLAY_LIMIT
        );
        const openInNewTab = this.settings.openInNewTab;
        const noRecentText = this.language.t('dashboard.noRecentBookmarks') || 'No recent bookmarks yet.';
        const shownWithUrls = this.getRecentBookmarksWithUrls(
            this.bookmarks,
            Dashboard.RECENT_MODAL_DISPLAY_LIMIT
        );
        const lastWithUrls = this.getRecentBookmarksWithUrls(
            this.bookmarks,
            Dashboard.OPEN_LAST_DEFAULT
        );
        const openPlans = [
            ...this.buildOpenTabsPlans(shownWithUrls, {
                all: 'recentOpenShown',
                first: 'recentOpenShownFirst',
            }),
        ];
        if (!this.sameBookmarkList(shownWithUrls, lastWithUrls)) {
            openPlans.push(
                ...this.buildOpenTabsPlans(lastWithUrls, {
                    all: 'recentOpenLast',
                    first: 'recentOpenLastFirst',
                })
            );
        }
        const openToolbarHtml = openPlans.length > 0
            ? `
                <div class="recent-bookmarks-modal-toolbar" role="toolbar" aria-label="${this.escapeHtml(this.formatDashboardLabel('recentOpenToolbar', {}, 'Open recent bookmarks'))}">
                    <div class="recent-bookmarks-open-actions">
                        ${openPlans.map((plan, index) => `
                            <button type="button" class="recent-bookmarks-open-btn modal-button" data-open-plan="${index}">
                                <span class="modal-button-name">${this.escapeHtml(plan.label)}</span>
                            </button>
                        `).join('')}
                    </div>
                    <p class="recent-bookmarks-open-hint">${this.escapeHtml(
                        this.formatDashboardLabel(
                            'recentOpenCommandHint',
                            { n: Dashboard.OPEN_LAST_DEFAULT },
                            `:open last ${Dashboard.OPEN_LAST_DEFAULT} in command mode`
                        )
                    )}</p>
                </div>
            `
            : '';
        const modalHtml = recentBookmarks.length > 0
            ? `
                ${openToolbarHtml}
                <div class="recent-bookmarks-modal-list">
                    ${recentBookmarks.map((bookmark, index) => {
                        const safeName = this.escapeHtml(bookmark.name || this.bookmarkFallbackName());
                        const safeUrl = this.escapeHtml(bookmark.url || '#');
                        const safeCategory = this.escapeHtml(bookmark.category || (this.language.t('dashboard.uncategorized') || 'Other'));
                        const target = openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : '';
                        return `
                            <a class="recent-bookmarks-modal-item" href="${safeUrl}" data-recent-index="${index}"${target}>
                                <span class="recent-bookmarks-modal-name">${safeName}</span>
                                <span class="recent-bookmarks-modal-meta">${safeCategory}</span>
                            </a>
                        `;
                    }).join('')}
                </div>
            `
            : `<div class="recent-bookmarks-empty">${this.escapeHtml(noRecentText)}</div>`;

        window.AppModal.show({
            title: this.language.t('dashboard.recentBookmarksTitle') || 'Recent bookmarks',
            htmlMessage: modalHtml,
            confirmText: this.language.t('dashboard.close') || 'Close',
            showCancel: false,
            modalClass: 'recent-bookmarks-modal',
            modalMaxWidth: '760px',
            modalWidth: '92vw'
        });

        if (recentBookmarks.length > 0) {
            const items = document.querySelectorAll('.recent-bookmarks-modal-item[data-recent-index]');
            items.forEach((item) => {
                item.addEventListener('click', (e) => {
                    const index = parseInt(e.currentTarget.getAttribute('data-recent-index'), 10);
                    if (!Number.isNaN(index) && recentBookmarks[index]) {
                        this.recordBookmarkOpened(recentBookmarks[index]);
                    }
                });
            });

            document.querySelectorAll('.recent-bookmarks-open-btn[data-open-plan]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const index = parseInt(btn.getAttribute('data-open-plan'), 10);
                    const plan = openPlans[index];
                    if (!plan?.bookmarks?.length) return;
                    this.openBookmarksInNewTabs(plan.bookmarks);
                });
            });
        }
    }

    escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Recent bookmarks by `lastOpened` (newest first).
     *
     * Scope is **whatever array you pass** — this helper does not read `this.bookmarks` or
     * `this.allBookmarks` itself. All dashboard “recent” UX is **page-local**:
     *
     * - `this.bookmarks` — bookmarks on the **current page** (use this for `*` modal, `:open last`,
     *   open-tabs actions, and any new recent UI).
     * - `this.allBookmarks` — every bookmark on **all pages** (search / global shortcuts only).
     *   Do **not** pass `allBookmarks` here unless you intentionally add a cross-page recent feature
     *   and update copy (cheat sheet, help, commands) to say “across all pages”.
     *
     * `lastOpened` is updated when a bookmark is opened on the dashboard; it is per bookmark record,
     * but filtering by page still requires passing only that page’s rows.
     *
     * @param {Array<object>} bookmarks — usually `this.bookmarks` (current page)
     * @param {number} [limit=10] — max rows returned; `limit <= 0` returns the full sorted list
     * @returns {Array<object>}
     */
    getRecentBookmarks(bookmarks, limit = 10) {
        const sorted = [...(Array.isArray(bookmarks) ? bookmarks : [])]
            .filter((bookmark) => bookmark && bookmark.lastOpened)
            .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
        if (limit == null || limit <= 0) return sorted;
        return sorted.slice(0, limit);
    }

    buildBookmarkTooltip(bookmark, previewTitle, previewDescription) {
        const parts = [];
        const title = previewTitle || bookmark.name || '';
        if (title) parts.push(title);
        if (previewDescription) parts.push(previewDescription);
        const url = String(bookmark.url || '').trim();
        if (url) parts.push(url);
        const openCount = Number(bookmark.openCount || 0);
        const lastOpened = bookmark.lastOpened || null;
        if (openCount > 0) {
            let usageLine = `Opened ${openCount}×`;
            if (lastOpened) {
                const diffDays = Math.floor((Date.now() - new Date(lastOpened)) / 86400000);
                const ago = diffDays === 0 ? 'today'
                    : diffDays === 1 ? 'yesterday'
                    : diffDays < 7 ? `${diffDays} days ago`
                    : diffDays < 30 ? `${Math.floor(diffDays / 7)}w ago`
                    : diffDays < 365 ? `${Math.floor(diffDays / 30)}mo ago`
                    : `${Math.floor(diffDays / 365)}y ago`;
                usageLine += ` · last ${ago}`;
            }
            parts.push(usageLine);
        }
        return parts.join('\n');
    }

    attachBookmarkPreviewBehavior(openLink, bookmark) {
        const initialTitle = bookmark.previewTitle || bookmark.name || '';
        const initialDescription = bookmark.previewDesc || '';

        if (this.settings.showLinkPreviewCards !== true) {
            openLink.title = this.buildBookmarkTooltip(bookmark, initialTitle, initialDescription);
            if (openLink.dataset.previewLoaded === 'true') return;
            openLink.addEventListener('mouseenter', async () => {
                if (openLink.dataset.previewLoaded === 'true') return;
                const preview = await this.fetchBookmarkPreviewData(openLink, bookmark);
                if (!preview) return;
                openLink.title = this.buildBookmarkTooltip(bookmark, preview.title || bookmark.name || '', preview.description || '');
            }, { once: true });
            return;
        }

        // Prevent browser native title tooltip when card preview is enabled.
        openLink.removeAttribute('title');

        openLink.addEventListener('mouseenter', async (event) => {
            openLink._previewHoverActive = true;
            if (openLink._previewHoverTimer) {
                clearTimeout(openLink._previewHoverTimer);
            }
            const hoverDelay = [100, 150, 250].includes(Number(this.settings.linkPreviewHoverDelayMs))
                ? Number(this.settings.linkPreviewHoverDelayMs)
                : 150;
            openLink._previewHoverTimer = setTimeout(async () => {
                if (!openLink._previewHoverActive || this.settings.showLinkPreviewCards !== true) {
                    return;
                }
                const preview = await this.fetchBookmarkPreviewData(openLink, bookmark);
                if (!preview || !openLink._previewHoverActive) return;
                preview.note = bookmark.note || '';
                preview.tags = Array.isArray(bookmark.tags) ? bookmark.tags.filter(Boolean) : [];
                preview.openCount = Number(bookmark.openCount || 0);
                preview.lastOpened = bookmark.lastOpened || null;
                this.showBookmarkPreviewCard(preview, event, { openLink, bookmark });
            }, hoverDelay);
        });

        openLink.addEventListener('mousemove', (event) => {
            if (this.previewCardElement && this.previewCardElement.classList.contains('is-visible')) {
                this.positionBookmarkPreviewCard(event.clientX, event.clientY);
                const ctx = this.previewCardElement._previewContext;
                if (ctx) {
                    ctx.pointer = { clientX: event.clientX, clientY: event.clientY };
                }
            }
        });

        // Close preview when link activated via keyboard (Enter / Space)
        openLink.addEventListener('keydown', (e) => {
            const key = e.key;
            if (key === 'Enter' || key === ' ') {
                try { this.dismissBookmarkPreviewInteractions(); } catch (_e) {}
            }
        });

        openLink.addEventListener('mouseleave', () => {
            openLink._previewHoverActive = false;
            if (openLink._previewHoverTimer) {
                clearTimeout(openLink._previewHoverTimer);
                openLink._previewHoverTimer = null;
            }
            this.scheduleHideBookmarkPreviewCard();
        });
    }

    scheduleHideBookmarkPreviewCard() {
        if (this._previewHideTimer) {
            clearTimeout(this._previewHideTimer);
        }
        this._previewHideTimer = setTimeout(() => {
            this._previewHideTimer = null;
            if (!this._previewCardHovered) {
                this.hideBookmarkPreviewCard();
            }
        }, 140);
    }

    async fetchBookmarkPreviewData(openLink, bookmark, { forceRefresh = false } = {}) {
        if (!forceRefresh && openLink._previewData) {
            return openLink._previewData;
        }
        try {
            let preview = null;
            if (!forceRefresh && (bookmark.previewTitle || bookmark.previewDesc || bookmark.previewImage)) {
                preview = {
                    title: bookmark.previewTitle || bookmark.name || '',
                    description: bookmark.previewDesc || '',
                    image: bookmark.previewImage || '',
                    domain: this.extractDomainFromUrl(bookmark.url),
                    url: bookmark.url
                };
            } else {
                const refreshParam = forceRefresh ? '&refresh=1' : '';
                const response = await fetch(`/api/bookmark-preview?url=${encodeURIComponent(bookmark.url)}${refreshParam}`);
                if (!response.ok) return null;
                preview = await response.json();
                bookmark.previewTitle = preview.title || bookmark.previewTitle || '';
                bookmark.previewDesc = preview.description || bookmark.previewDesc || '';
                bookmark.previewImage = preview.image || bookmark.previewImage || '';
                if (forceRefresh) {
                    this.persistBookmarkPreviewMetadata(bookmark);
                }
            }

            const title = preview.title || bookmark.name || '';
            const description = preview.description || '';
            if (this.settings.showLinkPreviewCards !== true) {
                openLink.title = `${title}${description ? `\n${description}` : ''}`;
            } else {
                openLink.removeAttribute('title');
            }
            openLink.dataset.previewLoaded = 'true';
            openLink._previewData = preview;
            return preview;
        } catch (_error) {
            openLink.dataset.previewLoaded = 'true';
            return null;
        }
    }

    persistBookmarkPreviewMetadata(bookmark) {
        if (!bookmark) return;

        const updatedUrl = String(bookmark.url || '').trim();
        if (!updatedUrl) return;

        (this.bookmarks || []).forEach((bm) => {
            if (String(bm.url || '').trim() === updatedUrl) {
                bm.previewTitle = bookmark.previewTitle || '';
                bm.previewDesc = bookmark.previewDesc || '';
                bm.previewImage = bookmark.previewImage || '';
            }
        });
        (this.allBookmarks || []).forEach((bm) => {
            if (String(bm.url || '').trim() === updatedUrl) {
                bm.previewTitle = bookmark.previewTitle || '';
                bm.previewDesc = bookmark.previewDesc || '';
                bm.previewImage = bookmark.previewImage || '';
            }
        });

        if (this.pendingPreviewSave) {
            clearTimeout(this.pendingPreviewSave);
        }
        this.pendingPreviewSave = setTimeout(() => {
            this.pendingPreviewSave = null;
            fetch(`/api/bookmarks?page=${this.currentPageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.bookmarks)
            }).catch((error) => {
                console.error('Failed to save bookmark preview metadata:', error);
            });
        }, 800);
    }

    async refreshVisibleBookmarkPreview() {
        const card = this.previewCardElement;
        const ctx = card?._previewContext;
        if (!card || !ctx?.openLink || !ctx?.bookmark) return false;

        const refreshBtn = card.querySelector('.bookmark-preview-card-refresh');
        refreshBtn?.classList.add('is-loading');
        refreshBtn?.setAttribute('disabled', 'true');

        try {
            delete ctx.openLink._previewData;
            delete ctx.openLink.dataset.previewLoaded;
            const preview = await this.fetchBookmarkPreviewData(ctx.openLink, ctx.bookmark, { forceRefresh: true });
            if (!preview) return false;

            preview.note = ctx.bookmark.note || '';
            preview.tags = Array.isArray(ctx.bookmark.tags) ? ctx.bookmark.tags.filter(Boolean) : [];
            preview.openCount = Number(ctx.bookmark.openCount || 0);
            preview.lastOpened = ctx.bookmark.lastOpened || null;

            const pointer = ctx.pointer || { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 };
            this.showBookmarkPreviewCard(preview, pointer, ctx);
            return true;
        } finally {
            refreshBtn?.classList.remove('is-loading');
            refreshBtn?.removeAttribute('disabled');
        }
    }

    extractDomainFromUrl(url) {
        try {
            return new URL(url).hostname || '';
        } catch (_error) {
            return '';
        }
    }

    ensureBookmarkPreviewCard() {
        if (this.previewCardElement) {
            return this.previewCardElement;
        }
        const card = document.createElement('div');
        card.className = 'bookmark-preview-card';
        card.innerHTML = `
            <button type="button" class="bookmark-preview-card-refresh" aria-label="Refresh preview">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-2.64-6.36"/>
                    <polyline points="21 3 21 9 15 9"/>
                </svg>
            </button>
            <div class="bookmark-preview-card-image-wrap"><img class="bookmark-preview-card-image" alt="" /></div>
            <div class="bookmark-preview-card-content">
                <div class="bookmark-preview-card-title"></div>
                <div class="bookmark-preview-card-description"></div>
                <div class="bookmark-preview-card-note"></div>
                <div class="bookmark-preview-card-tags"></div>
                <div class="bookmark-preview-card-url"></div>
                <div class="bookmark-preview-card-domain"></div>
                <div class="bookmark-preview-card-usage"></div>
            </div>
        `;
        const refreshBtn = card.querySelector('.bookmark-preview-card-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.refreshVisibleBookmarkPreview();
            });
        }
        card.addEventListener('mouseenter', () => {
            this._previewCardHovered = true;
            if (this._previewHideTimer) {
                clearTimeout(this._previewHideTimer);
                this._previewHideTimer = null;
            }
        });
        card.addEventListener('mouseleave', () => {
            this._previewCardHovered = false;
            this.scheduleHideBookmarkPreviewCard();
        });
        document.body.appendChild(card);
        this.previewCardElement = card;
        return card;
    }

    showBookmarkPreviewCard(preview, event, context = null) {
        const card = this.ensureBookmarkPreviewCard();
        const refreshBtn = card.querySelector('.bookmark-preview-card-refresh');
        if (refreshBtn) {
            const label = this.language?.t?.('dashboard.previewCardRefreshAria');
            refreshBtn.setAttribute(
                'aria-label',
                label && label !== 'dashboard.previewCardRefreshAria' ? label : 'Refresh preview'
            );
        }
        if (context?.openLink && context?.bookmark) {
            card._previewContext = {
                openLink: context.openLink,
                bookmark: context.bookmark,
                pointer: {
                    clientX: event?.clientX ?? context.pointer?.clientX ?? 0,
                    clientY: event?.clientY ?? context.pointer?.clientY ?? 0,
                },
            };
        }
        const titleEl = card.querySelector('.bookmark-preview-card-title');
        const descEl = card.querySelector('.bookmark-preview-card-description');
        const domainEl = card.querySelector('.bookmark-preview-card-domain');
        const imageEl = card.querySelector('.bookmark-preview-card-image');
        const imageWrap = card.querySelector('.bookmark-preview-card-image-wrap');

        const title = String(preview?.title || '').trim() || String(preview?.url || '').trim() || 'Untitled link';
        const description = String(preview?.description || '').trim();
        const noteText = String(preview?.note || '').trim();
        const domain = String(preview?.domain || this.extractDomainFromUrl(preview?.url || '')).trim();
        const image = String(preview?.image || '').trim();

        titleEl.textContent = title;
        descEl.textContent = description;
        descEl.style.display = description ? 'block' : 'none';
        const noteEl = card.querySelector('.bookmark-preview-card-note');
        if (noteEl) {
            if (noteText) {
                const truncated = noteText.length > 140 ? `${noteText.slice(0, 137)}...` : noteText;
                noteEl.textContent = truncated;
                noteEl.style.display = 'block';
            } else {
                noteEl.textContent = '';
                noteEl.style.display = 'none';
            }
        }
        const tagsEl = card.querySelector('.bookmark-preview-card-tags');
        if (tagsEl) {
            const tags = Array.isArray(preview?.tags) ? preview.tags.filter(Boolean) : [];
            if (tags.length > 0) {
                tagsEl.innerHTML = '';
                tags.forEach(tag => {
                    const chip = document.createElement('span');
                    chip.className = 'bookmark-tag-chip';
                    chip.textContent = tag;
                    tagsEl.appendChild(chip);
                });
                tagsEl.style.display = 'flex';
            } else {
                tagsEl.innerHTML = '';
                tagsEl.style.display = 'none';
            }
        }

        domainEl.textContent = domain;
        domainEl.style.display = domain ? 'block' : 'none';

        const urlEl = card.querySelector('.bookmark-preview-card-url');
        if (urlEl) {
            const rawUrl = String(preview?.url || '').trim();
            urlEl.textContent = rawUrl;
            urlEl.style.display = rawUrl ? 'block' : 'none';
        }

        const usageEl = card.querySelector('.bookmark-preview-card-usage');
        if (usageEl) {
            const openCount = Number(preview?.openCount || 0);
            const lastOpened = preview?.lastOpened || null;
            if (openCount > 0) {
                let lastText = '';
                if (lastOpened) {
                    const date = new Date(lastOpened);
                    const now = new Date();
                    const diffDays = Math.floor((now - date) / 86400000);
                    if (diffDays === 0) lastText = 'today';
                    else if (diffDays === 1) lastText = 'yesterday';
                    else if (diffDays < 7) lastText = `${diffDays} days ago`;
                    else if (diffDays < 30) lastText = `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) === 1 ? '' : 's'} ago`;
                    else if (diffDays < 365) lastText = `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) === 1 ? '' : 's'} ago`;
                    else lastText = `${Math.floor(diffDays / 365)} year${Math.floor(diffDays / 365) === 1 ? '' : 's'} ago`;
                }
                const countText = `opened ${openCount} time${openCount === 1 ? '' : 's'}`;
                usageEl.textContent = lastText ? `${countText} · last ${lastText}` : countText;
                usageEl.style.display = 'block';
            } else {
                usageEl.textContent = '';
                usageEl.style.display = 'none';
            }
        }

        if (image) {
            imageEl.src = image;
            imageWrap.style.display = 'block';
        } else {
            imageEl.removeAttribute('src');
            imageWrap.style.display = 'none';
        }

        card.classList.add('is-visible');
        document.body.classList.add('preview-card-active');
        this.positionBookmarkPreviewCard(event.clientX, event.clientY);
    }

    positionBookmarkPreviewCard(clientX, clientY) {
        const card = this.previewCardElement;
        if (!card) return;
        const offsetX = 16;
        const offsetY = 18;
        const margin = 12;

        const rect = card.getBoundingClientRect();
        const width = rect.width || 360;
        const height = rect.height || 140;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Prefer right of cursor; flip left if it would overflow right edge
        let left = clientX + offsetX;
        if (left + width > vw - margin) {
            left = clientX - width - offsetX;
        }

        // Prefer below cursor; flip above if it would overflow bottom edge
        let top = clientY + offsetY;
        if (top + height > vh - margin) {
            top = clientY - height - offsetY;
        }

        // Final clamp so the card never goes off any edge
        left = Math.min(Math.max(margin, left), vw - width - margin);
        top = Math.min(Math.max(margin, top), vh - height - margin);

        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
    }

    hideBookmarkPreviewCard() {
        if (!this.previewCardElement) return;
        this.previewCardElement.classList.remove('is-visible');
        this.previewCardElement._previewContext = null;
        this._previewCardHovered = false;
        document.body.classList.remove('preview-card-active');
    }

    dismissBookmarkPreviewInteractions() {
        const hoverLinks = document.querySelectorAll('.bookmark-open');
        hoverLinks.forEach((linkEl) => {
            if (linkEl && linkEl._previewHoverTimer) {
                clearTimeout(linkEl._previewHoverTimer);
                linkEl._previewHoverTimer = null;
            }
            if (linkEl) {
                linkEl._previewHoverActive = false;
            }
        });
        this.hideBookmarkPreviewCard();
    }

    recordBookmarkOpened(bookmark) {
        if (!bookmark) return;

        bookmark.openCount = Number(bookmark.openCount || 0) + 1;
        bookmark.lastOpened = Date.now();
        this.syncAllBookmarksMetadata(bookmark);
        this.refreshSmartCollectionsAfterOpen(bookmark.url);

        if (this.pendingMetadataSave) {
            clearTimeout(this.pendingMetadataSave);
        }

        this.pendingMetadataSave = setTimeout(() => {
            this.pendingMetadataSave = null;
            fetch(`/api/bookmarks?page=${this.currentPageId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(this.bookmarks)
            }).catch((error) => {
                console.error('Failed to save bookmark metadata:', error);
            });
        }, 1000);
    }

    syncAllBookmarksMetadata(updatedBookmark) {
        if (!updatedBookmark || !Array.isArray(this.allBookmarks)) {
            return;
        }

        const updatedUrl = (updatedBookmark.url || '').trim();
        if (!updatedUrl) {
            return;
        }

        this.allBookmarks.forEach((bookmark) => {
            const bookmarkUrl = (bookmark.url || '').trim();
            if (!bookmarkUrl || bookmarkUrl !== updatedUrl) {
                return;
            }

            if (Number(bookmark.pageId) === Number(this.currentPageId)) {
                bookmark.lastOpened = updatedBookmark.lastOpened;
                bookmark.openCount = updatedBookmark.openCount;
            }
        });
    }

    refreshSmartCollectionsAfterOpen(url) {
        if (!url) {
            return;
        }

        // Multiple smart collections can change when openCount/lastOpened updates.
        this.renderDashboard();
    }

    updateTitleVisibility() {
        // Update the data attribute for CSS visibility control
        document.body.setAttribute('data-show-title', this.settings.showTitle);
        
        // Update the title text if showing
        const titleElement = document.querySelector('.title');
        if (titleElement && this.settings.showTitle) {
            const currentPage = this.pages.find(p => p.id === this.currentPageId);
            titleElement.textContent = currentPage ? currentPage.name : this.language.t('dashboard.defaultPageTitle');
        }
    }

    applyFontSize() {
        // Remove existing font size classes
        document.body.classList.remove('font-size-xs', 'font-size-s', 'font-size-sm', 'font-size-m', 'font-size-lg', 'font-size-l', 'font-size-xl');
        document.body.classList.remove('font-size-small', 'font-size-medium', 'font-size-large'); // Remove old classes
        
        // Migrate old values to new values
        let fontSize = this.settings.fontSize || 'm';
        if (fontSize === 'small') fontSize = 'sm';
        if (fontSize === 'medium') fontSize = 'm';
        if (fontSize === 'large') fontSize = 'l';
        
        // Update settings if migration occurred
        if (this.settings.fontSize !== fontSize) {
            this.settings.fontSize = fontSize;
            this.saveSettings();
        }
        
        // Add current font size class
        document.body.classList.add(`font-size-${fontSize}`);
    }

    applyBackgroundDots() {
        // Toggle background dots class
        if (this.settings.showBackgroundDots !== false) {
            document.body.classList.remove('no-background-dots');
        } else {
            document.body.classList.add('no-background-dots');
        }
    }

    applyAnimations() {
        // Toggle animations class
        if (this.settings.animationsEnabled !== false) {
            document.body.classList.remove('no-animations');
        } else {
            document.body.classList.add('no-animations');
        }
    }

    updateConfigButtonVisibility() {
        let configLink = document.querySelector('.config-link');

        // Config button is always visible
        if (!configLink) {
            configLink = document.createElement('div');
            configLink.className = 'config-link';
            const configLabel = this.language.t('dashboard.config');
            configLink.innerHTML = `<a href="/config">${configLabel !== 'dashboard.config' ? configLabel : 'config'}</a>`;

            const headerActions = document.querySelector('.header-actions');
            if (headerActions) {
                headerActions.appendChild(configLink);
            }
        }
    }

    updateHealthDashboardVisibility() {
        let healthLink = document.querySelector('.health-link');

        if (this.settings.showHealthDashboard !== false) {
            if (!healthLink) {
                healthLink = document.createElement('div');
                healthLink.className = 'health-link';
                const healthLabel = this.language.t('dashboard.health');
                healthLink.innerHTML = `<a href="/health">${healthLabel !== 'dashboard.health' ? healthLabel : 'health'}</a>`;

                const headerActions = document.querySelector('.header-actions');
                if (headerActions) {
                    const configLink = headerActions.querySelector('.config-link');
                    if (configLink) {
                        headerActions.insertBefore(healthLink, configLink);
                    } else {
                        headerActions.appendChild(healthLink);
                    }
                }
            }
            this.updateHealthBadge();
        } else if (healthLink) {
            healthLink.remove();
        }
    }

    async updateHealthBadge() {
        const anchor = document.querySelector('.health-link a');
        if (!anchor) return;

        try {
            const response = await fetch('/api/bookmark-health');
            if (!response.ok) return;
            const data = await response.json();
            const summary = data?.summary || {};
            const broken = Number(summary.brokenCount || 0);
            const warn = Number(summary.duplicateCount || 0)
                + Number(summary.shortcutConflictCount || 0)
                + Number(summary.uncheckedCount || 0)
                + Number(summary.staleCount || 0);

            const existing = anchor.querySelector('.health-badge');
            if (existing) existing.remove();

            if (broken > 0) {
                anchor.appendChild(this.createHealthCountBadge(broken, 'broken'));
            } else if (warn > 0) {
                anchor.appendChild(this.createHealthCountBadge(warn, 'warn'));
            }
            this.updateMiniStatusLine();
        } catch (e) {
            // Silently skip — badge is non-critical
        }
    }

    updatePageTabsVisibility() {
        const pageNavigation = document.getElementById('page-navigation');
        if (pageNavigation) {
            pageNavigation.style.display = this.settings.showPageTabs ? 'block' : 'none';
        }
    }

    updateDateVisibility() {
        let dateElement = document.getElementById('date-element');

        if (this.shouldRenderDateBlock()) {
            // Show date - create if it doesn't exist
            if (!dateElement) {
                dateElement = document.createElement('div');
                dateElement.id = 'date-element';
                dateElement.className = 'date';
                
                // Insert at the beginning of header (use safe header container)
                const header = this.getHeaderContainer();
                if (header.firstChild) {
                    header.insertBefore(dateElement, header.firstChild);
                } else {
                    header.appendChild(dateElement);
                }
            }
            
            this.renderDateWeatherLine();
            this.scheduleDateTimeRefresh();
            this.scheduleWeatherRefresh();
            this.refreshWeather(false);
        } else {
            // Hide date - remove if it exists
            if (dateElement) {
                dateElement.remove();
            }
            this.clearDateTimeRefreshTimer();
            this.clearWeatherRefreshTimer();
            this.weatherData = null;
        }
    }

    shouldRenderDateBlock() {
        return this.settings.showDate || this.settings.showTime || this.settings.showWeatherWithDate;
    }

    clearDateTimeRefreshTimer() {
        if (this.dateTimeRefreshTimer) {
            clearInterval(this.dateTimeRefreshTimer);
            this.dateTimeRefreshTimer = null;
        }
    }

    scheduleDateTimeRefresh() {
        this.clearDateTimeRefreshTimer();
        this.dateTimeRefreshTimer = setInterval(() => {
            if (!document.hidden) {
                this.renderDateWeatherLine();
            }
        }, 60 * 1000);
    }

    clearWeatherRefreshTimer() {
        if (this.weatherRefreshTimer) {
            clearInterval(this.weatherRefreshTimer);
            this.weatherRefreshTimer = null;
        }
    }

    scheduleWeatherRefresh() {
        this.clearWeatherRefreshTimer();
        if (!this.shouldRenderDateBlock() || !this.settings.showWeatherWithDate) {
            return;
        }
        const minutes = Number(this.settings.weatherRefreshMinutes || 30);
        const intervalMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;
        this.weatherRefreshTimer = setInterval(() => {
            this.refreshWeather(true);
        }, intervalMs);
    }

    formatDateLine(date) {
        const safeDate = date instanceof Date ? date : new Date();
        const fmt = String(this.settings.dateFormat || 'short-slash');
        const locale = String(this.settings.language || document.documentElement.getAttribute('data-lang') || 'en');

        if (fmt === 'short-slash') {
            const day = String(safeDate.getDate()).padStart(2, '0');
            const month = String(safeDate.getMonth() + 1).padStart(2, '0');
            const year = safeDate.getFullYear();
            return `${day}/${month}/${year}`;
        }

        if (fmt === 'short-dash') {
            const day = String(safeDate.getDate()).padStart(2, '0');
            const month = String(safeDate.getMonth() + 1).padStart(2, '0');
            const year = safeDate.getFullYear();
            return `${day}-${month}-${year}`;
        }

        if (fmt === 'mm-slash') {
            // MM/DD/YYYY
            const day = String(safeDate.getDate()).padStart(2, '0');
            const month = String(safeDate.getMonth() + 1).padStart(2, '0');
            const year = safeDate.getFullYear();
            return `${month}/${day}/${year}`;
        }

        if (fmt === 'iso') {
            // YYYY-MM-DD
            const day = String(safeDate.getDate()).padStart(2, '0');
            const month = String(safeDate.getMonth() + 1).padStart(2, '0');
            const year = safeDate.getFullYear();
            return `${year}-${month}-${day}`;
        }

        if (fmt === 'weekday-only') {
            try {
                return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(safeDate);
            } catch (e) {
                return safeDate.toLocaleDateString(locale, { weekday: 'long' });
            }
        }

        // long-weekday or any other value: use localized long format
        try {
            return new Intl.DateTimeFormat(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(safeDate);
        } catch (e) {
            const day = String(safeDate.getDate()).padStart(2, '0');
            const month = String(safeDate.getMonth() + 1).padStart(2, '0');
            const year = safeDate.getFullYear();
            return `${day}-${month}-${year}`;
        }
    }

    formatTimeLine(date) {
        const safeDate = date instanceof Date ? date : new Date();
        const timeFormat = this.settings.timeFormat === '12h' ? '12h' : '24h';
        const hours24 = safeDate.getHours();
        const minutes = String(safeDate.getMinutes()).padStart(2, '0');
        if (timeFormat === '12h') {
            const period = hours24 >= 12 ? 'PM' : 'AM';
            const hours12 = hours24 % 12 || 12;
            return `${String(hours12).padStart(2, '0')}:${minutes} ${period}`;
        }
        return `${String(hours24).padStart(2, '0')}:${minutes}`;
    }

    renderDateWeatherLine() {
        const dateElement = document.getElementById('date-element');
        if (!dateElement) return;
        const now = new Date();
        const datePart = this.settings.showDate ? this.formatDateLine(now) : '';
        const timePart = this.settings.showTime ? this.formatTimeLine(now) : '';
        const weatherPart = this.formatWeatherText(this.weatherData);

        // Localized date/time line: prefer translation keys when available
        const t = (key, fallback) => {
            const val = this.language?.t ? this.language.t(key) : null;
            return (val && val !== key) ? val : fallback;
        };
        const tplCombined = t('dashboard.dateTimeLine', "It's {time} @ {date}");
        const tplTimeOnly = t('dashboard.dateTimeOnly', "It's {time}");

        let dateTimeText = '';
        if (timePart && datePart) {
            dateTimeText = tplCombined.replace('{time}', timePart).replace('{date}', datePart);
        } else if (timePart) {
            dateTimeText = tplTimeOnly.replace('{time}', timePart);
        } else if (datePart) {
            const raw = t('dashboard.dateOnly', null);
            dateTimeText = raw ? raw.replace('{date}', datePart) : datePart;
        }

        dateElement.textContent = '';
        if (dateTimeText) {
            const dateTimeLine = document.createElement('div');
            dateTimeLine.className = 'date-time-line';
            dateTimeLine.textContent = dateTimeText;
            dateTimeLine.setAttribute('role', 'button');
            dateTimeLine.setAttribute('tabindex', '0');
            dateTimeLine.setAttribute('aria-haspopup', 'dialog');
            dateTimeLine.addEventListener('click', () => this.showDatePopover());
            dateTimeLine.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.showDatePopover(); } });
            dateElement.appendChild(dateTimeLine);
        }
        if (weatherPart) {
            const weatherLine = document.createElement('div');
            weatherLine.className = 'date-weather-line';
            const weatherIcon = this.getWeatherIconMarkup(this.weatherData?.weatherCode);
            weatherLine.innerHTML = `<span class="weather-icon" aria-hidden="true">${weatherIcon}</span><span class="weather-text">${weatherPart}</span>`;
            dateElement.appendChild(weatherLine);
        }
    }

    showMovePopover(anchorEl, bookmark, bookmarkIndex) {
        const existing = document.getElementById('move-popover');
        if (existing) { existing.remove(); return; }

        const t = (key, fallback) => {
            const val = this.language?.t ? this.language.t(key) : null;
            return (val && val !== key) ? val : fallback;
        };

        const realCategories = (this.categories || []).filter(c => !c.isSmartCollection);
        const otherPages = (this.pages || []).filter(p => String(p.id) !== String(this.currentPageId));
        const currentCategoryId = String(bookmark.category ?? '').trim();

        const pop = document.createElement('div');
        pop.id = 'move-popover';
        pop.className = 'move-popover';
        pop.setAttribute('role', 'listbox');
        pop.setAttribute('aria-label', t('dashboard.movePopoverTitle', 'Move to…'));

        const header = document.createElement('div');
        header.className = 'move-popover-header';
        header.textContent = t('dashboard.movePopoverTitle', 'Move to…');
        pop.appendChild(header);

        const items = [];

        if (realCategories.length > 0) {
            const catLabel = document.createElement('div');
            catLabel.className = 'move-popover-section-label';
            catLabel.textContent = t('dashboard.movePopoverCategorySection', 'Category');
            pop.appendChild(catLabel);

            realCategories.forEach(cat => {
                const isCurrent = String(cat.id) === currentCategoryId;
                const item = document.createElement('div');
                item.className = 'move-popover-item' + (isCurrent ? ' is-current' : '');
                item.setAttribute('role', 'option');
                item.setAttribute('data-type', 'category');
                item.setAttribute('data-id', String(cat.id));
                item.setAttribute('aria-selected', String(isCurrent));

                const check = document.createElement('span');
                check.className = 'move-popover-check';
                check.textContent = isCurrent ? '✓' : '';
                item.appendChild(check);

                const label = document.createElement('span');
                label.textContent = cat.name;
                item.appendChild(label);

                pop.appendChild(item);
                items.push(item);
            });
        }

        if (otherPages.length > 0) {
            const divider = document.createElement('div');
            divider.className = 'move-popover-divider';
            pop.appendChild(divider);

            const pageLabel = document.createElement('div');
            pageLabel.className = 'move-popover-section-label';
            pageLabel.textContent = t('dashboard.movePopoverPageSection', 'Page');
            pop.appendChild(pageLabel);

            otherPages.forEach(page => {
                const item = document.createElement('div');
                item.className = 'move-popover-item';
                item.setAttribute('role', 'option');
                item.setAttribute('data-type', 'page');
                item.setAttribute('data-id', String(page.id));
                item.setAttribute('aria-selected', 'false');

                const check = document.createElement('span');
                check.className = 'move-popover-check';
                check.textContent = '';
                item.appendChild(check);

                const label = document.createElement('span');
                label.textContent = page.name;
                item.appendChild(label);

                pop.appendChild(item);
                items.push(item);
            });
        }

        if (items.length === 0) return;

        // Position: try right of row, fall back to left
        const rect = anchorEl.getBoundingClientRect();
        const vpW = window.innerWidth;
        const vpH = window.innerHeight;
        const popW = 220;
        let left = rect.right + 8;
        if (left + popW > vpW - 8) left = rect.left - popW - 8;
        if (left < 8) left = 8;
        pop.style.cssText = `left:${left}px;top:${rect.top}px;`;
        document.body.appendChild(pop);
        const popH = pop.offsetHeight;
        const top = Math.min(rect.top, vpH - popH - 8);
        pop.style.top = `${Math.max(8, top)}px`;

        let focusedIdx = items.findIndex(i => i.classList.contains('is-current'));
        if (focusedIdx < 0) focusedIdx = 0;

        const setFocus = (idx) => {
            items.forEach((el, i) => el.classList.toggle('is-focused', i === idx));
            focusedIdx = idx;
            items[idx]?.scrollIntoView({ block: 'nearest' });
        };
        setFocus(focusedIdx);

        const close = () => {
            pop.remove();
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('click', onOutside);
        };

        const confirm = (item) => {
            const type = item.getAttribute('data-type');
            const id = item.getAttribute('data-id');
            close();
            if (type === 'category') {
                this._quickMoveToCategory(bookmark, id);
            } else if (type === 'page') {
                const bookmarkRef = { index: bookmarkIndex, scope: 'current' };
                this._moveBookmarkToPage(bookmarkRef, { ...bookmark }, Number(id), anchorEl);
            }
        };

        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); setFocus((focusedIdx + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); setFocus((focusedIdx - 1 + items.length) % items.length); return; }
            if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); if (items[focusedIdx]) confirm(items[focusedIdx]); return; }
        };

        items.forEach((item, idx) => {
            item.addEventListener('mouseenter', () => setFocus(idx));
            item.addEventListener('click', () => confirm(item));
        });

        document.addEventListener('keydown', onKey, true);
        setTimeout(() => {
            const onOutside = (e) => { if (!pop.contains(e.target)) close(); };
            document.addEventListener('click', onOutside);
        }, 0);
    }

    _quickMoveToCategory(bookmark, categoryId) {
        const cat = (this.categories || []).find(c => String(c.id) === String(categoryId));
        const catName = cat?.name || categoryId;
        this.ensureBookmarkMutationSnapshot();
        bookmark.category = categoryId;
        this.scheduleBookmarkOrderSave();
        this.renderDashboard();
        const t = (key, fallback) => {
            const val = this.language?.t ? this.language.t(key) : null;
            return (val && val !== key) ? val : fallback;
        };
        this.showNotification(
            t('dashboard.movedToCategory', 'Moved to "{name}"').replace('{name}', catName),
            'success', { duration: 2500 }
        );
    }

    showDatePopover() {
        const existing = document.getElementById('date-popover');
        if (existing) { existing.remove(); return; }

        const dateEl = document.getElementById('date-element');
        if (!dateEl) return;
        const rect = dateEl.getBoundingClientRect();
        const now = new Date();

        const isoWeek = (d) => {
            const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
            const jan1 = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
            return Math.ceil((((tmp - jan1) / 86400000) + 1) / 7);
        };

        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
        weekStart.setHours(0, 0, 0, 0);
        const days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(weekStart);
            d.setDate(weekStart.getDate() + i);
            return d;
        });

        const locale = this.settings?.language || navigator.language || 'en';
        const dayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
        const dayLabels = days.map(d => dayFmt.format(d).slice(0, 2));

        const t = (key, fallback) => {
            const val = this.language?.t ? this.language.t(key) : null;
            return (val && val !== key) ? val : fallback;
        };

        const pop = document.createElement('div');
        pop.id = 'date-popover';
        pop.className = 'date-popover';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', t('dashboard.weekOverviewLabel', 'Week overview'));
        pop.style.cssText = `position:fixed;top:${rect.bottom + 8}px;left:${rect.left}px;`;

        const weekLabel = document.createElement('div');
        weekLabel.className = 'date-popover-week-label';
        weekLabel.textContent = `${t('dashboard.weekLabel', 'Week')} ${isoWeek(now)}  ·  ${now.getFullYear()}`;
        pop.appendChild(weekLabel);

        const grid = document.createElement('div');
        grid.className = 'date-popover-grid';
        dayLabels.forEach(lbl => {
            const el = document.createElement('span');
            el.className = 'date-popover-col-label';
            el.textContent = lbl;
            grid.appendChild(el);
        });
        days.forEach(d => {
            const el = document.createElement('span');
            el.className = 'date-popover-day';
            if (d.toDateString() === now.toDateString()) el.classList.add('is-today');
            if (d.getDay() === 0 || d.getDay() === 6) el.classList.add('is-weekend');
            el.textContent = d.getDate();
            grid.appendChild(el);
        });
        pop.appendChild(grid);

        const calendarUrl = this.settings?.calendarUrl?.trim();
        if (calendarUrl) {
            const footer = document.createElement('div');
            footer.className = 'date-popover-footer';
            const calLink = document.createElement('a');
            calLink.className = 'date-popover-cal-link';
            calLink.href = calendarUrl;
            calLink.target = '_blank';
            calLink.rel = 'noopener noreferrer';
            calLink.textContent = t('dashboard.openCalendar', 'Open calendar →');
            footer.appendChild(calLink);
            pop.appendChild(footer);
        }

        document.body.appendChild(pop);

        const close = () => {
            pop.remove();
            document.removeEventListener('click', outside);
            document.removeEventListener('keydown', onKey);
        };
        const outside = (e) => { if (!pop.contains(e.target) && !dateEl.contains(e.target)) close(); };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        setTimeout(() => {
            document.addEventListener('click', outside);
            document.addEventListener('keydown', onKey);
        }, 0);
    }

    formatWeatherText(weatherData) {
        if (!weatherData || !this.weatherService) return '';
        const weatherLabelKey = this.weatherService?.getWeatherLabelKey(weatherData.weatherCode) || '';
        const isUnknownCondition = weatherLabelKey === 'dashboard.weatherCode.unknown';
        const conditionText = isUnknownCondition ? '' : this.getWeatherConditionLabel(weatherData.weatherCode);
        const temperature = Number(weatherData.temperature);
        const roundedTemperature = Number.isFinite(temperature) ? Math.round(temperature) : null;
        if (roundedTemperature === null) return '';
        const locationName = weatherData.locationName || (this.language?.t ? this.language.t('dashboard.weatherCurrentLocation') : 'Current location');
        const unitSymbol = weatherData.unitSymbol || 'C';
        if (!conditionText) {
            return `${locationName}, ${roundedTemperature}°${unitSymbol}`;
        }
        return `${locationName}, ${conditionText}, ${roundedTemperature}°${unitSymbol}`;
    }

    getWeatherIconMarkup(weatherCode) {
        const iconByType = {
            clear: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v3"></path><path d="M12 19v3"></path><path d="M4.9 4.9l2.1 2.1"></path><path d="M17 17l2.1 2.1"></path><path d="M2 12h3"></path><path d="M19 12h3"></path><path d="M4.9 19.1L7 17"></path><path d="M17 7l2.1-2.1"></path>',
            cloudy: '<path d="M6 17h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1A3.5 3.5 0 0 0 6 17z"></path>',
            fog: '<path d="M4 10h16"></path><path d="M3 14h18"></path><path d="M5 18h14"></path>',
            drizzle: '<path d="M6 14h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1A3.5 3.5 0 0 0 6 14z"></path><path d="M9 17l-1 2"></path><path d="M13 17l-1 2"></path><path d="M17 17l-1 2"></path>',
            rain: '<path d="M6 13h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1A3.5 3.5 0 0 0 6 13z"></path><path d="M8 16l-1 3"></path><path d="M12 16l-1 3"></path><path d="M16 16l-1 3"></path>',
            snow: '<path d="M6 13h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1A3.5 3.5 0 0 0 6 13z"></path><path d="M9 16v4"></path><path d="M7.5 17.5h3"></path><path d="M13 16v4"></path><path d="M11.5 17.5h3"></path><path d="M17 16v4"></path><path d="M15.5 17.5h3"></path>',
            thunderstorm: '<path d="M6 13h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1A3.5 3.5 0 0 0 6 13z"></path><path d="M13 14l-3 5h2l-1 3 4-6h-2z"></path>',
            unknown: '<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2.2-2.5 4"></path><circle cx="12" cy="17.5" r="0.8"></circle>'
        };
        const weatherType = this.weatherService?.getWeatherType(weatherCode) || 'unknown';
        const iconPath = iconByType[weatherType] || iconByType.unknown;
        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="weather-icon-svg">${iconPath}</svg>`;
    }

    getWeatherConditionLabel(weatherCode) {
        const key = this.weatherService?.getWeatherLabelKey(weatherCode) || 'dashboard.weatherCode.unknown';
        const fallbackKey = 'dashboard.weatherCode.unknown';
        const dashboardTranslations = this.language?.translations?.dashboard || {};

        // Existing locale files store weather keys as literal dotted keys:
        // "weatherCode.clear": "Clear"
        const dottedKey = key.replace('dashboard.', '');
        const dottedFallbackKey = fallbackKey.replace('dashboard.', '');
        if (typeof dashboardTranslations[dottedKey] === 'string') {
            return dashboardTranslations[dottedKey];
        }
        if (typeof dashboardTranslations[dottedFallbackKey] === 'string') {
            return dashboardTranslations[dottedFallbackKey];
        }

        // Future-proof fallback if locales become nested objects later.
        const translated = this.language?.t ? this.language.t(key) : '';
        if (translated && translated !== key) {
            return translated;
        }
        const fallback = this.language?.t ? this.language.t(fallbackKey) : '';
        if (fallback && fallback !== fallbackKey) {
            return fallback;
        }
        return 'Unknown';
    }

    async refreshWeather(forceRefresh = false) {
        if (!this.shouldRenderDateBlock() || !this.settings.showWeatherWithDate || !this.weatherService) {
            this.weatherData = null;
            this.renderDateWeatherLine();
            return;
        }

        if (this.settings.weatherSource === 'manual' && !String(this.settings.weatherLocation || '').trim()) {
            this.weatherData = null;
            this.renderDateWeatherLine();
            return;
        }

        try {
            this.weatherData = await this.weatherService.fetchWeather(this.settings, {
                useCache: !forceRefresh
            });
        } catch (error) {
            this.weatherData = null;
        }
        this.renderDateWeatherLine();
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new Dashboard();
});
