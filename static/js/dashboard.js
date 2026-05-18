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

class TagAutocomplete {
    constructor(input, getTagsFn) {
        this._input = input;
        this._getTagsFn = getTagsFn;
        this._dropdown = null;
        this._activeIndex = -1;
        this._onInput = this._handleInput.bind(this);
        this._onKeydown = this._handleKeydown.bind(this);
        this._onBlur = this._handleBlur.bind(this);
        this._onScroll = this._reposition.bind(this);
        input.addEventListener('input', this._onInput);
        input.addEventListener('keydown', this._onKeydown);
        input.addEventListener('blur', this._onBlur);
        input.addEventListener('focus', this._onInput);
    }
    static attach(input, getTagsFn) {
        TagAutocomplete.detach(input);
        input._tagAutocomplete = new TagAutocomplete(input, getTagsFn);
    }
    static detach(input) {
        if (input._tagAutocomplete) { input._tagAutocomplete._destroy(); delete input._tagAutocomplete; }
    }
    _handleInput() {
        const token = this._currentToken();
        if (!token) { this._close(); return; }
        const known = (this._getTagsFn() || []).map(t => t.toLowerCase());
        const used = this._usedTags();
        const candidates = known.filter(t => t.startsWith(token) && t !== token && !used.includes(t))
            .sort((a, b) => a.localeCompare(b)).slice(0, 8);
        if (candidates.length === 0) { this._close(); return; }
        this._open(candidates, token);
    }
    _handleKeydown(e) {
        if (!this._dropdown) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); this._activeIndex = Math.min(this._activeIndex + 1, this._items().length - 1); this._highlightActive(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this._activeIndex = Math.max(this._activeIndex - 1, 0); this._highlightActive(); }
        else if (e.key === 'Tab' || e.key === 'Enter') { const t = this._items()[this._activeIndex] ?? this._items()[0]; if (t) { e.preventDefault(); this._accept(t.dataset.tag); } }
        else if (e.key === 'Escape') { e.preventDefault(); this._close(); }
    }
    _handleBlur() { setTimeout(() => this._close(), 120); }
    _open(candidates, token) {
        if (!this._dropdown) {
            this._dropdown = document.createElement('ul');
            this._dropdown.className = 'tag-ac-dropdown';
            document.body.appendChild(this._dropdown);
            window.addEventListener('scroll', this._onScroll, true);
        }
        this._dropdown.innerHTML = '';
        this._activeIndex = 0;
        candidates.forEach((tag, i) => {
            const li = document.createElement('li');
            li.className = 'tag-ac-item' + (i === 0 ? ' tag-ac-item-active' : '');
            li.dataset.tag = tag;
            const bold = document.createElement('strong');
            bold.textContent = tag.slice(0, token.length);
            li.appendChild(bold);
            li.appendChild(document.createTextNode(tag.slice(token.length)));
            li.addEventListener('mousedown', (e) => { e.preventDefault(); this._accept(tag); });
            this._dropdown.appendChild(li);
        });
        this._reposition();
    }
    _reposition() {
        if (!this._dropdown) return;
        const r = this._input.getBoundingClientRect();
        this._dropdown.style.cssText = `left:${r.left}px;top:${r.bottom}px;width:${r.width}px`;
    }
    _close() {
        if (this._dropdown) { this._dropdown.remove(); this._dropdown = null; window.removeEventListener('scroll', this._onScroll, true); }
        this._activeIndex = -1;
    }
    _items() { return this._dropdown ? [...this._dropdown.querySelectorAll('.tag-ac-item')] : []; }
    _highlightActive() { this._items().forEach((li, i) => li.classList.toggle('tag-ac-item-active', i === this._activeIndex)); }
    _accept(tag) {
        const val = this._input.value;
        const lastComma = val.lastIndexOf(',');
        const prevParts = (lastComma >= 0 ? val.slice(0, lastComma) : '').split(',').map(t => t.trim()).filter(Boolean);
        prevParts.push(tag);
        this._input.value = prevParts.join(', ') + ', ';
        this._input.selectionStart = this._input.selectionEnd = this._input.value.length;
        this._close();
        this._input.dispatchEvent(new Event('input', { bubbles: true }));
        this._input.focus();
    }
    _currentToken() {
        const val = this._input.value;
        const lastComma = val.lastIndexOf(',');
        return (lastComma >= 0 ? val.slice(lastComma + 1) : val).trimStart().toLowerCase();
    }
    _usedTags() {
        const val = this._input.value;
        const lastComma = val.lastIndexOf(',');
        return (lastComma >= 0 ? val.slice(0, lastComma) : '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    }
    _destroy() {
        this._input.removeEventListener('input', this._onInput);
        this._input.removeEventListener('keydown', this._onKeydown);
        this._input.removeEventListener('blur', this._onBlur);
        this._input.removeEventListener('focus', this._onInput);
        this._close();
    }
}

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
        this.allBookmarks = []; // For global shortcuts
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
            showSearchFlowBanner: true,
            showSyncToasts: false,
            showCheatSheetButton: true,
            showStatus: false,
            colorizeStatus: true,
            showPing: false,
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
            showLinkPreviewCards: true,
            linkPreviewHoverDelayMs: 150,
            sortMethod: 'order',
            layoutPreset: 'default',
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
        this.tabId = `dash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.lastSyncToastAt = 0;
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

    async init() {
        await this.loadData();
        this.applyVisualSettings();
        this.initializeAutoDarkMode();
        this.loadCollapsedStates();
        await this.language.init(this.settings.language);
        this.setupDOM();
        this.initializeSearchComponent();
        this.initializeStatusMonitor();
        this.initializeKeyboardNavigation();
        this.initializeSwipeNavigation();
        this.initializeHyprMode();
        this.renderPageNavigation();
        this.renderDashboard({ animate: false });
        this.setupPageShortcuts();
        this.setupReorderUndoShortcut();
        this.setupPasteToQuickAdd();
        this.setupToolbarActions();
        this.setupConfigStructureReloadListener();
        this.scheduleBackupTip();

            // Initialize new features
            this.analytics = new BookmarkAnalytics(this);
            this.analytics.loadAnalytics();
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
            }
        });

        // Initialize follow-up UI immediately after first render (no extra frame delay).
        document.body.classList.remove('loading');
        this.initializeOnboarding();
        this.maybeShowWhatsNew();
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
                    this.showSyncToast('Synced config changes.');
                    return;
                }
                if (event.key === this.settingsSyncEventKey) {
                    await this.refreshAfterConfigSettingsUpdate(payload);
                    this.showSyncToast('Applied dashboard settings update.');
                }
            } catch (error) {
                window.location.reload();
            }
        });
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
            const deviceSpecific = localStorage.getItem('deviceSpecificSettings') === 'true';
            if (deviceSpecific) {
                const deviceSettings = localStorage.getItem('dashboardSettings');
                this.settings = deviceSettings ? { ...serverSettings, ...JSON.parse(deviceSettings) } : serverSettings;
                // Always use favicon settings from server, regardless of device-specific
                this.settings.enableCustomFavicon = serverSettings.enableCustomFavicon;
                this.settings.customFaviconPath = serverSettings.customFaviconPath;
                this.settings.fontPreset = serverSettings.fontPreset;
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
            if (typeof this.settings.showTips === 'undefined') {
                this.settings.showTips = false;
            }
            if (typeof this.settings.showSearchFlowBanner === 'undefined') {
                this.settings.showSearchFlowBanner = true;
            }
            if (typeof this.settings.showLinkPreviewCards === 'undefined') {
                this.settings.showLinkPreviewCards = true;
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
                this.settings.fontPreset = window.DashboardFont.normalizePresetId(this.settings.fontPreset);
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
                this.settings.showStatus = false;
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

            // Check for page hash in URL
            const hash = window.location.hash.substring(1);
            let initialPageId = this.pages.length > 0 ? this.pages[0].id : 'default';
            if (hash && /^\d+$/.test(hash)) {
                const pageIndex = parseInt(hash) - 1;
                if (pageIndex >= 0 && pageIndex < this.pages.length) {
                    initialPageId = this.pages[pageIndex].id;
                }
            }
            this.currentPageId = initialPageId;
            
            // Load bookmarks and categories for initial page
            await this.loadPageBookmarks(this.currentPageId);
            
            // Always load all bookmarks so smart collections can work across pages.
            await this.loadAllBookmarks();
        } catch (error) {
            this.showErrorNotification('Failed to load dashboard. Please refresh the page.');
        }
    }

    showNotification(message, type = 'error', { undoCallback = null, duration = 5000 } = {}) {
        const notification = document.getElementById('error-notification');
        if (!notification) return;

        notification.classList.remove('show');
        notification.innerHTML = '';

        const textNode = document.createElement('span');
        textNode.className = 'notification-text';
        textNode.textContent = message;
        notification.appendChild(textNode);

        if (undoCallback) {
            const undoBtn = document.createElement('button');
            undoBtn.type = 'button';
            undoBtn.className = 'notification-undo-btn';
            undoBtn.textContent = 'Ongedaan maken';
            undoBtn.addEventListener('click', () => {
                clearTimeout(this.notificationTimeout);
                notification.classList.remove('show');
                notification.setAttribute('aria-hidden', 'true');
                undoCallback();
            });
            notification.appendChild(undoBtn);
        }

        notification.classList.remove('success', 'has-undo');
        if (type === 'success') notification.classList.add('success');
        if (undoCallback) notification.classList.add('has-undo');

        requestAnimationFrame(() => notification.classList.add('show'));
        notification.setAttribute('aria-hidden', 'false');

        if (this.notificationTimeout) {
            clearTimeout(this.notificationTimeout);
        }

        this.notificationTimeout = setTimeout(() => {
            notification.classList.remove('show', 'success', 'has-undo');
            notification.setAttribute('aria-hidden', 'true');
        }, duration);
    }

    showErrorNotification(message) {
        this.showNotification(message, 'error');
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
            this.showErrorNotification('Failed to load bookmarks for this page.');
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
            
            // Also save to localStorage if device-specific is enabled
            const deviceSpecific = localStorage.getItem('deviceSpecificSettings') === 'true';
            if (deviceSpecific) {
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
            // Show page number or name based on settings
            pageBtn.textContent = this.settings.showPageNamesInTabs ? page.name : (index + 1).toString();
            pageBtn.addEventListener('click', () => {
                // Update all buttons
                container.querySelectorAll('.page-nav-btn').forEach(btn => {
                    btn.classList.remove('active');
                });
                pageBtn.classList.add('active');

                // Load bookmarks for selected page
                this.loadPageBookmarks(page.id);
                // Update title
                this.updatePageTitle(page.name);
                this.markInlineTipUsed('page_switch');
            });
            pageBtn.addEventListener('dblclick', (e) => {
                e.preventDefault();
                this._startPageTabRename(pageBtn, page);
            });
            container.appendChild(pageBtn);
        });
    }

    _startPageTabRename(btn, page) {
        if (btn.querySelector('.page-tab-rename-input')) return;

        const originalLabel = btn.textContent;
        btn.textContent = '';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'page-tab-rename-input';
        input.value = page.name;
        input.setAttribute('aria-label', 'Rename page');
        btn.appendChild(input);
        input.focus();
        input.select();

        let done = false;

        const commit = async () => {
            if (done) return;
            done = true;
            const newName = input.value.trim();
            if (btn.contains(input)) btn.removeChild(input);
            if (!newName || newName === page.name) {
                btn.textContent = originalLabel;
                return;
            }
            page.name = newName;
            btn.textContent = this.settings.showPageNamesInTabs ? newName : originalLabel;
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
            if (btn.contains(input)) btn.removeChild(input);
            btn.textContent = originalLabel;
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        input.addEventListener('blur', commit);
    }

    shouldPackDashboardColumns() {
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

        const colCount = this.getNormalizedColumnsPerRow();
        this.settings.columnsPerRow = colCount;
        const packed = this.shouldPackDashboardColumns();
        const packedClass = packed ? ' packed-columns' : '';

        grid.className = `dashboard-grid columns-${colCount} layout-${this.settings.layoutPreset || 'default'} density-${this.settings.densityMode || 'compact'}${packedClass}`;
        grid.style.setProperty('--packed-columns', String(colCount));
        if (packed) {
            grid.style.removeProperty('grid-template-columns');
        } else {
            grid.style.gridTemplateColumns = `repeat(${colCount}, minmax(0, 1fr))`;
        }

        return { grid, colCount, packed };
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
        document.body.setAttribute('data-show-search-button', this.settings.showSearchButton);
        document.body.setAttribute('data-show-finders-button', this.settings.showFindersButton);
        document.body.setAttribute('data-show-commands-button', this.settings.showCommandsButton);
        document.body.setAttribute('data-show-recent-button', this.settings.showRecentButton !== false);
        document.body.setAttribute('data-show-search-button-text', this.settings.showSearchButtonText);
        document.body.setAttribute('data-show-finders-button-text', this.settings.showFindersButtonText);
        document.body.setAttribute('data-show-commands-button-text', this.settings.showCommandsButtonText);
        document.body.setAttribute('data-show-tips', this.settings.showTips !== false);
        document.body.setAttribute('data-show-search-flow-banner', this.settings.showSearchFlowBanner !== false);
        document.body.setAttribute('data-show-shortcuts', this.settings.showShortcuts !== false);
        document.body.setAttribute('data-show-pin-icon', this.settings.showPinIcon === true ? 'true' : 'false');
        document.body.setAttribute('data-show-note-icon', this.settings.showNoteIcon === false ? 'false' : 'true');
        document.body.setAttribute('data-layout-preset', this.settings.layoutPreset || 'default');
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
            this.searchComponent = new window.SearchComponent(bookmarksForSearch, this.bookmarks, this.allBookmarks, this.settings, this.language, this.finders);
        } else {
            console.warn('SearchComponent not found. Make sure search.js is loaded.');
        }
    }

    // Method to update search component when data changes
    updateSearchComponent() {
        if (this.searchComponent) {
            // Use all bookmarks if global shortcuts is enabled, otherwise just current page
            const bookmarksForSearch = this.settings.globalShortcuts ? this.allBookmarks : this.bookmarks;
            this.searchComponent.updateData(bookmarksForSearch, this.bookmarks, this.allBookmarks, this.settings, this.language, this.finders);
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
            
            // Don't trigger if Ctrl, Alt, or Meta are pressed (but allow Shift)
            if (e.ctrlKey || e.altKey || e.metaKey) {
                if ((e.ctrlKey || e.metaKey) && e.key === '/') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showKeyboardCheatSheet();
                }
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

            // Check if a number key (1-9) was pressed
            const key = e.key;
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

    setupReorderUndoShortcut() {
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !this.pendingReorderSnapshot) {
                return;
            }

            if (this.isModalOpen()) {
                return;
            }

            // Do not interfere with shortcut search behavior
            if (this.searchComponent && this.searchComponent.isActive()) {
                return;
            }

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
            const trimmed = text.trim();
            if (!/^https?:\/\/.+/i.test(trimmed)) return;

            e.preventDefault();

            const handler = this.searchComponent?.commandsComponent?.newCommandHandler;
            if (!handler) return;

            handler.openModal();

            // Wait for modal DOM to be ready, then pre-fill URL and trigger favicon fetch
            setTimeout(() => {
                const urlInput = document.getElementById('new-bookmark-url');
                if (urlInput) {
                    urlInput.value = trimmed;
                    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
                    handler.autoFetchModalFaviconFromUrlField?.();
                }
                const nameInput = document.getElementById('new-bookmark-name');
                if (nameInput) nameInput.focus();
            }, 120);
        });
    }

    setupToolbarActions() {
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
                await dash.saveSettings();
                dash.onboardingStartedInSession = false;
                setTimeout(() => dash.maybeShowWhatsNew(), 0);
            }
        });
        this.onboardingStartedInSession = onboarding.shouldStart();
        onboarding.maybeStart();
        if (!this.onboardingStartedInSession) {
            this.maybeShowWhatsNew();
        }
    }

    initializeButtonTipsRotation() {
        const hintEl = document.getElementById('button-hint-text');
        if (!hintEl) {
            return;
        }
        this.initializeSearchFlowHint();
        if (this.tipRotationTimer) {
            clearTimeout(this.tipRotationTimer);
            this.tipRotationTimer = null;
        }

        const tipsEnabled = this.settings.showTips !== false;
        document.body.setAttribute('data-show-tips', tipsEnabled);
        if (!tipsEnabled) {
            return;
        }

        const priorityTips = [
            'Tip: <code>*</code> recent',
            'Tip: <code>!</code> cheatsheet',
            'Tip: <code>↑/↓</code> navigate bookmarks',
            'Tip: <code>;</code> edit bookmark (highlighted row or focused link)',
            'Tip: <code>Ctrl+/</code> or <code>F1</code> cheatsheet',
            'Tip: <code>Ctrl+Shift+A</code> new bookmark — or just paste a URL anywhere on the dashboard',
            'Tip: <code>[</code> preview card on keyboard-selected bookmark',
            'Tip: <code>Ctrl+C</code> copy URL of keyboard-selected bookmark',
            'Tip: left strip = drag reorder; long-press row (not strip) = inline edit'
        ];
        const normalTips = [
            'Tip: <code>&gt;</code> search, <code>:</code> commands, <code>?</code> finders',
            'Tip: <code>&gt;</code> open search',
            'Tip: <code>?</code> open finders',
            'Tip: <code>:</code> open commands',
            'Tip: <code>/</code> start fuzzy search',
            'Tip: <code>1-9</code> jump to page',
            'Tip: <code>,</code> page overview — see all pages with bookmark counts',
            'Tip: <code>+</code> quick-add — naam | url | shortcut in één invoer',
            'Tip: <code>Shift+←/→</code> switch page',
            'Tip: <code>Enter</code> open selected bookmark',
            'Tip: <code>Space</code> open selected bookmark',
            'Tip: <code>;</code> inline-edit selected bookmark',
            'Tip: hover bookmark (name/icon area) to load preview when enabled',
            'Tip: <code>Esc</code> cancel current state',
            'Tip: <code>Alt+↑/↓</code> reorder in config',
            'Tip: use <code>category:work</code> in search',
            'Tip: use <code>tag:work</code> in search to filter by tag',
            'Tip: use <code>status:online</code> in search',
            'Tip: use <code>page:2</code> in search',
            'Tip: use <code>?g term</code> finder shortcut',
            'Tip: add tags to bookmarks in <code>config</code> → bookmarks',
            'Tip: create dynamic collections in <code>config</code> → collections',
            'Tip: enable tag collections in <code>config</code> → general → Smart Collections',
            'Tip: backups under <code>config</code> → general → Backup & restore',
            'Tip: click a category header to collapse or expand it',
            'Tip: global shortcuts from all pages in <code>config</code> → general → Dashboard',
            'Tip: layout preset & density in <code>config</code> → general → Basics',
            'Tip: long-press a bookmark row (not the drag strip) to edit inline',
            'Tip: visit <code>health</code> page to find broken links and duplicates',
            'Tip: use filters in <code>health</code> page to focus on specific issues',
            'Tip: <code>refresh</code> in health page re-scans all bookmarks',
            'Tip: check health page <code>stale</code> bookmarks you haven\'t used recently',
            'Tip: merge duplicate bookmarks in health page bulk actions',
            'Tip: use <code>:note</code> in the command palette to edit a bookmark\'s note instantly',
            'Tip: double-click a page tab or category title to rename it inline',
            'Tip: delete a bookmark and click <code>Ongedaan maken</code> in the toast to undo within 5s',
            'Tip: hover a preview card and click the clipboard icon to copy the URL',
            'Tip: compact/dense mode shows an open-count badge on each bookmark',
            'Tip: use the search bar in config → bookmarks to filter by name, URL, tag, or note',
            'Tip: the dark/light toggle button in the header flips the theme variant instantly',
            'Tip: use <code>favicon</code> button in health view to refresh a bookmark\'s icon',
            'Tip: add tags when creating a bookmark via <code>:new</code> — autocomplete suggests existing tags',
            ...[
                ['dashboard.tipFaviconToggle', null],
                ['dashboard.tipPackedColumns', null],
                ['dashboard.tipHideShortcutPin', null],
                ['dashboard.tipDisableTips', null],
                ['dashboard.tipDisableTipsAlt', null],
            ].map(([key]) => { const v = this.language.t(key); return v !== key ? v : null; }).filter(Boolean)
        ];

        let normalCounter = 0;
        const run = () => {
            const currentContextTips = this.getInlineContextTipsForCurrentPage();
            if (currentContextTips.length > 0) {
                hintEl.innerHTML = currentContextTips[this.contextTipRotationIndex % currentContextTips.length];
                this.contextTipRotationIndex += 1;
            } else if (!tipsEnabled) {
                // User disabled generic tips and no context tips remain.
                document.body.setAttribute('data-show-tips', 'false');
                return;
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
        if (this.backupTipShown || this.backupTipTimer) {
            return;
        }

        const hintEl = document.getElementById('button-hint-text');
        if (!hintEl) {
            return;
        }

        if (this.settings.showTips === false) {
            return;
        }

        this.backupTipTimer = setTimeout(() => {
            this.backupTipTimer = null;
            if (this.backupTipShown) {
                return;
            }

            const currentHintEl = document.getElementById('button-hint-text');
            if (!currentHintEl || this.settings.showTips === false) {
                return;
            }

            this.backupTipShown = true;
            currentHintEl.innerHTML = 'Tip: maak een backup via <a class="button-hint-link" href="/config#backups">config -> backups</a>.';
        }, 30000);
    }

    initializeSearchFlowHint() {
        const hintEl = document.getElementById('search-flow-hint');
        const closeButton = document.getElementById('search-flow-hint-close');
        if (!hintEl || !closeButton) {
            return;
        }

        hintEl.hidden = false;

        if (this.settings.showSearchFlowBanner === false) {
            hintEl.hidden = true;
            return;
        }

        const storageKey = 'nextDashSearchFlowHintDismissedV2';
        const legacyStorageKey = 'nextDashSearchFlowHintDismissedV1';
        try {
            if (localStorage.getItem(storageKey) === 'true') {
                hintEl.hidden = true;
                return;
            }
            if (localStorage.getItem(legacyStorageKey) === 'true') {
                localStorage.removeItem(legacyStorageKey);
            }
        } catch {
            // Ignore localStorage errors.
        }

        closeButton.onclick = async () => {
            hintEl.hidden = true;
            this.settings.showSearchFlowBanner = false;
            document.body.setAttribute('data-show-search-flow-banner', 'false');
            try {
                sessionStorage.setItem(storageKey, 'true');
            } catch {
                // Ignore localStorage errors.
            }
            await this.saveSettings();
        };
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
        const html = `
            <div class="keyboard-cheat-sheet">
                <div class="keyboard-cheat-sheet-grid">
                    ${sections.map((section) => `
                        <section class="keyboard-cheat-sheet-panel">
                            <h3 class="keyboard-cheat-sheet-section-title">${section.title}</h3>
                            <table class="keyboard-cheat-sheet-table">
                                <tbody>
                                    ${section.items.map((shortcut) => `
                                        <tr>
                                            <td class="keyboard-cheat-sheet-keys">${shortcut.keys}</td>
                                            <td class="keyboard-cheat-sheet-description">${shortcut.description}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </section>
                    `).join('')}
                </div>
            </div>
        `;

        window.AppModal.show({
            title: 'keyboard shortcuts',
            htmlMessage: html,
            confirmText: 'close',
            showCancel: false,
            modalClass: 'keyboard-cheat-sheet-modal',
            modalMaxWidth: '960px',
            modalWidth: '96vw'
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
        overlay.setAttribute('aria-label', 'Page overview');

        const panel = document.createElement('div');
        panel.className = 'page-overview-panel';

        const header = document.createElement('div');
        header.className = 'page-overview-header';
        header.textContent = 'Pages';
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
            li.setAttribute('tabindex', '-1');

            const numSpan = document.createElement('span');
            numSpan.className = 'page-overview-num';
            numSpan.textContent = String(idx + 1);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'page-overview-name';
            nameSpan.textContent = page.name || `Page ${idx + 1}`;

            const countSpan = document.createElement('span');
            countSpan.className = 'page-overview-count';
            countSpan.textContent = String(count);

            li.appendChild(numSpan);
            li.appendChild(nameSpan);
            li.appendChild(countSpan);

            li.addEventListener('click', () => {
                close();
                this.loadPageBookmarks(page.id);
            });

            list.appendChild(li);
        });

        panel.appendChild(list);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        const items = () => list.querySelectorAll('.page-overview-item');

        const setFocus = (idx) => {
            focusedIndex = Math.max(0, Math.min(pages.length - 1, idx));
            items().forEach((el, i) => el.classList.toggle('is-focused', i === focusedIndex));
            items()[focusedIndex]?.scrollIntoView({ block: 'nearest' });
        };

        const close = () => {
            overlay.remove();
            document.removeEventListener('keydown', onKey, true);
        };

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

            let fullUrl = url;
            if (!/^https?:\/\//i.test(url)) fullUrl = 'https://' + url;

            status.textContent = t('dashboard.quickAddFetchingFavicon');
            status.classList.remove('is-error');
            input.disabled = true;

            let icon = '';
            try {
                const faviconUrl = (() => {
                    try {
                        const p = new URL(fullUrl);
                        return (p.protocol === 'http:' || p.protocol === 'https:')
                            ? `${p.protocol}//${p.host}/favicon.ico` : '';
                    } catch { return ''; }
                })();
                if (faviconUrl) {
                    const iconResp = await fetch('/api/icon/from-url', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: faviconUrl })
                    });
                    if (iconResp.ok) {
                        const iconData = await iconResp.json();
                        icon = iconData.icon || '';
                    }
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
        return [
            {
                title: 'navigation',
                items: [
                    { keys: '1–9', description: 'Switch to page tab' },
                    { keys: 'Shift + ← / →', description: 'Previous / next page' },
                    { keys: ',', description: 'Page overview with bookmark counts' },
                    { keys: '↑ / ↓', description: 'Move focus through bookmarks' },
                    { keys: '← / →', description: 'Move horizontally in grid' },
                    { keys: 'Tab / Shift+Tab', description: 'Step linearly through bookmarks' },
                    { keys: 'G + 1–9', description: 'Jump to nth category' },
                    { keys: 'Enter / Space', description: 'Open focused bookmark' },
                    { keys: 'Esc', description: 'Clear selection / close overlay' }
                ]
            },
            {
                title: 'bookmarks',
                items: [
                    { keys: '+', description: 'Quick-add — naam | url | shortcut' },
                    { keys: ';', description: 'Inline edit focused bookmark' },
                    { keys: '[', description: 'Toggle preview card on focused bookmark' },
                    { keys: 'Ctrl + C', description: 'Copy URL of focused bookmark' },
                    { keys: 'Ctrl + Shift + A', description: 'New bookmark modal' },
                    { keys: 'Double-click title', description: 'Rename page tab or category' },
                    { keys: 'Drag handle', description: 'Reorder within / across categories' }
                ]
            },
            {
                title: 'search & commands',
                items: [
                    { keys: '>', description: 'Open search' },
                    { keys: ':', description: 'Command palette' },
                    { keys: '?', description: 'Finders' },
                    { keys: '*', description: 'Recent bookmarks' },
                    { keys: ':new', description: 'Add bookmark via command' },
                    { keys: ':note', description: 'Edit note via command' },
                    { keys: 'category: / tag: / page:', description: 'Filter in search bar' }
                ]
            },
            {
                title: 'other',
                items: [
                    { keys: '! or Ctrl + /', description: 'This cheat sheet' },
                    { keys: 'Delete', description: 'Delete selected bookmark (confirm dialog, or Delete again inside inline edit)' },
                    { keys: '1–8 (config)', description: 'Jump between config tabs' },
                    { keys: 'S (config)', description: 'Save config' }
                ]
            }
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
        const match = base.match(/^(.*)-(dark|light)$/);
        if (!match) {
            return wantsDark ? 'dark' : 'light';
        }
        return `${match[1]}-${wantsDark ? 'dark' : 'light'}`;
    }

    renderDashboard(options = {}) {
        const animate = options && options.animate === true;
        this._renderAnimationsEnabled = animate;
        const container = document.getElementById('dashboard-layout');
        if (!container) return;

        this.leaveBookmarkInlineEditFocusMode();

        // Group bookmarks by category
        const groupedBookmarks = this.groupBookmarksByCategory();
        
        // Clear container
        container.innerHTML = '';
        container.classList.remove('page-transition');

        if (!Array.isArray(this.bookmarks) || this.bookmarks.length === 0) {
            const hasBookmarksOnOtherPages = Array.isArray(this.allBookmarks) && this.allBookmarks.length > 0;
            const currentPage = this.pages.find(p => p.id === this.currentPageId);
            const pageName = currentPage ? currentPage.name : '';

            if (hasBookmarksOnOtherPages) {
                container.innerHTML = `
                    <div class="empty-state empty-state--page">
                        <div class="empty-state-label">// ${pageName}</div>
                        <div class="empty-state-text">This page is empty</div>
                        <div class="empty-state-actions">
                            <button class="empty-state-action-btn" id="empty-state-new-bookmark" type="button"><kbd>Ctrl+Shift+A</kbd> New bookmark</button>
                            <button class="empty-state-action-btn" id="empty-state-search" type="button"><kbd>&gt;</kbd> Search</button>
                            <button class="empty-state-action-btn" id="empty-state-command-new" type="button"><kbd>:new</kbd> Add via command</button>
                        </div>
                    </div>
                `;
                container.querySelector('#empty-state-new-bookmark')?.addEventListener('click', () => {
                    this.searchComponent?.commandsComponent?.newCommandHandler?.openModal();
                });
                container.querySelector('#empty-state-search')?.addEventListener('click', () => {
                    this.searchComponent?.openSearchInterface();
                });
                container.querySelector('#empty-state-command-new')?.addEventListener('click', () => {
                    if (this.searchComponent) {
                        this.searchComponent.openSearchInterface();
                        this.searchComponent.currentQuery = ':new';
                        this.searchComponent.updateSearch();
                        this.searchComponent.renderSearchMatches();
                    }
                });
            } else {
                container.innerHTML = `
                    <div class="empty-state empty-state--fresh">
                        <div class="empty-state-text">No bookmarks yet</div>
                        <div class="empty-state-actions">
                            <button class="empty-state-action-btn" id="empty-state-new-bookmark-fresh" type="button"><kbd>Ctrl+Shift+A</kbd> New bookmark</button>
                            <button class="empty-state-action-btn" id="empty-state-search-fresh" type="button"><kbd>&gt;</kbd> Search</button>
                        </div>
                        <div class="empty-state-action">
                            <a class="btn btn-secondary" href="/config#backups" data-i18n="config.importDescription">Import your data</a>
                        </div>
                    </div>
                `;
                container.querySelector('#empty-state-new-bookmark-fresh')?.addEventListener('click', () => {
                    this.searchComponent?.commandsComponent?.newCommandHandler?.openModal();
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
                isSmartCollection: true
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
        const colCount = gridLayout ? gridLayout.colCount : this.getNormalizedColumnsPerRow();
        const shouldPackColumns = gridLayout ? gridLayout.packed : this.shouldPackDashboardColumns();
        if (shouldPackColumns && columnBlocks.length > 0) {
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
        } else {
            columnBlocks.forEach((el, i) => {
                if (animate) {
                    el.style.setProperty('--stagger-index', String(i));
                    const categoryEnterDelay = (i * ANIM.CATEGORY_STAGGER_STEP) + ANIM.CATEGORY_ENTER_BASE;
                    setTimeout(() => el.classList.remove('animate-enter'), categoryEnterDelay);
                }
                container.appendChild(el);
            });
        }

        if (animate) {
            requestAnimationFrame(() => {
                container.classList.add('page-transition');
                setTimeout(() => container.classList.remove('page-transition'), ANIM.PAGE_TRANSITION);
            });
        }

        // Enable realtime drag-and-drop sorting within each category
        this.initializeCategoryReorder();
        // this.initializeDashboardCategoryReorder();

        // Update search component with current data
        this.updateSearchComponent();
        
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
        input.setAttribute('aria-label', 'Rename category');
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
        categoryDiv.className = 'category';
        if (animate) {
            categoryDiv.classList.add('animate-enter');
        }
        categoryDiv.setAttribute('data-category-id', category.id || '');
        const isSmartCollection = category.isSmartCollection === true;
        if (isSmartCollection) {
            categoryDiv.setAttribute('data-smart-collection', 'true');
        }
        const collapsedKey = isSmartCollection
            ? `smart:${category.id}`
            : `${this.currentPageId}:${category.id}`;
        let isCollapsed;
        if (this.settings.alwaysCollapseCategories) {
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

        // Category title
        const titleElement = document.createElement('h2');
        titleElement.className = 'category-title';
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

        // Bookmarks list
        const bookmarksList = document.createElement('div');
        bookmarksList.className = 'bookmarks-list';
        bookmarksList.setAttribute('data-category-id', category.id || '');
        bookmarksList.setAttribute('data-bookmarks-list', 'true');
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

        categoryDiv.appendChild(bookmarksList);
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
                isSmartCollection: true
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

    getStaleBookmarksList() {
        const staleWindowMs = 30 * 24 * 60 * 60 * 1000;
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
        row.setAttribute('data-bookmark-url', bookmark.url || '');
        if (bookmarkIndex >= 0) {
            row.setAttribute('data-bookmark-index', String(bookmarkIndex));
        } else {
            row.removeAttribute('data-bookmark-index');
        }
        row.setAttribute('data-category-id', categoryId);

        const lead = document.createElement('div');
        lead.className = 'bookmark-lead';
        const reorderHandle = document.createElement('div');
        reorderHandle.className = 'bookmark-reorder-handle';
        reorderHandle.setAttribute('aria-label', 'Drag to reorder');
        reorderHandle.title = 'Drag to reorder';
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
        /* Roving tabindex: only the arrow-selected row’s link is in tab order (see KeyboardNavigation). */
        openLink.tabIndex = -1;
        const textSpan = document.createElement('span');
        textSpan.className = 'bookmark-text';
        textSpan.textContent = bookmark.name || '';
        openLink.appendChild(textSpan);

        openLink.addEventListener('click', (e) => {
            this.recordBookmarkOpened(bookmark);
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
        row.appendChild(shortcutSpan);

        const pinBadge = document.createElement('span');
        pinBadge.className = 'bookmark-pin-badge';
        const showPinIcon = this.settings.showPinIcon === true;
        if (showPinIcon && bookmark.pinned) {
            pinBadge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/></svg>';
            pinBadge.title = 'Pinned';
            pinBadge.setAttribute('aria-label', 'Pinned bookmark');
            pinBadge.setAttribute('role', 'img');
        } else {
            pinBadge.textContent = '';
            pinBadge.classList.add('is-empty');
            pinBadge.setAttribute('aria-hidden', 'true');
        }
        row.appendChild(pinBadge);

        const openCountBadge = document.createElement('span');
        openCountBadge.className = 'bookmark-open-count';
        const openCount = Number(bookmark.openCount || 0);
        if (openCount > 0) {
            openCountBadge.textContent = openCount >= 1000 ? `${Math.floor(openCount / 1000)}k` : String(openCount);
            openCountBadge.title = `Opened ${openCount} time${openCount === 1 ? '' : 's'}`;
            openCountBadge.setAttribute('aria-label', `Opened ${openCount} times`);
        } else {
            openCountBadge.classList.add('is-empty');
            openCountBadge.setAttribute('aria-hidden', 'true');
        }
        row.appendChild(openCountBadge);

        const noteBadge = document.createElement('span');
        noteBadge.className = 'bookmark-note-badge';
        const hasNote = bookmark && String(bookmark.note || '').trim();
        if (hasNote) {
            const label = this.language.t('bookmark.hasNote') || 'Has note';
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
        row.appendChild(noteBadge);

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
        form.appendChild(mkField('Name', nameInput));

        const urlInput = document.createElement('input');
        urlInput.type = 'url';
        urlInput.className = 'bookmark-inline-input';
        urlInput.value = bookmark.url || '';
        form.appendChild(mkField('URL', urlInput));

        let pendingIcon = String(bookmark.icon || '').trim();
        const iconPreview = document.createElement('div');
        iconPreview.className = 'bookmark-inline-icon-preview';

        const iconUrlInput = document.createElement('input');
        iconUrlInput.type = 'text';
        iconUrlInput.className = 'bookmark-inline-input';
        iconUrlInput.placeholder = 'https://.../icon.png';
        iconUrlInput.value = pendingIcon ? `/data/icons/${pendingIcon}` : '';

        const iconActions = document.createElement('div');
        iconActions.className = 'bookmark-inline-icon-actions';

        const setIconBtn = document.createElement('button');
        setIconBtn.type = 'button';
        setIconBtn.className = 'bookmark-inline-action-btn bookmark-inline-save';
        setIconBtn.textContent = 'Set';

        const fetchIconBtn = document.createElement('button');
        fetchIconBtn.type = 'button';
        fetchIconBtn.className = 'bookmark-inline-action-btn';
        fetchIconBtn.textContent = this.language.t('config.fetch') || 'Fetch';
        let inlineAutoFetchTimer = null;
        let inlineAutoFetchInFlight = false;

        const uploadIconBtn = document.createElement('button');
        uploadIconBtn.type = 'button';
        uploadIconBtn.className = 'bookmark-inline-action-btn';
        uploadIconBtn.textContent = 'Upload';

        const iconFileInput = document.createElement('input');
        iconFileInput.type = 'file';
        iconFileInput.accept = 'image/*,.ico,.svg,.webp';
        iconFileInput.style.display = 'none';

        const clearIconBtn = document.createElement('button');
        clearIconBtn.type = 'button';
        clearIconBtn.className = 'bookmark-inline-action-btn';
        clearIconBtn.textContent = 'Clear';

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
                iconPreview.innerHTML = '<span>No icon</span>';
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
        const iconWrap = mkField('Icon URL', iconUrlInput);
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
        tagsInput.placeholder = 'work, dev, personal…';
        tagsInput.value = (Array.isArray(bookmark.tags) ? bookmark.tags : []).join(', ');
        form.appendChild(mkField('Tags', tagsInput));
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
        shortcutInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
        });
        form.appendChild(mkField('Shortcut', shortcutInput));

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
        form.appendChild(mkField('Category', catSelect));

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
        form.appendChild(mkField('Page', pageSelect));

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
        pinLabel.textContent = 'Pinned';
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
        statusLabel.textContent = 'Check status';
        statusWrap.appendChild(statusInput);
        statusWrap.appendChild(statusLabel);
        form.appendChild(statusWrap);

        const actions = document.createElement('div');
        actions.className = 'bookmark-inline-actions';

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'bookmark-inline-action-btn bookmark-inline-save';
        saveBtn.textContent = 'Save';
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
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.cancelBookmarkInlineEdit(row, bookmarkRef);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'bookmark-inline-action-btn bookmark-inline-delete';
        deleteBtn.textContent = 'Delete';
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
        const originalShortcut = String(original.shortcut || '').trim().toUpperCase();
        const candidateUrl = String(candidate.url || '').trim();
        const candidateName = String(candidate.name || '').trim();
        const candidateShortcut = String(candidate.shortcut || '').trim().toUpperCase();
        return originalUrl === candidateUrl && originalName === candidateName && originalShortcut === candidateShortcut;
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
            const safeName = String(bookmark.name || 'Bookmark').replace(/</g, '');
            confirmed = await window.AppModal.danger({
                title: 'Delete bookmark',
                message: `Remove "${safeName}"?`,
                confirmText: 'Delete',
                cancelText: 'Cancel'
            });
        } else {
            confirmed = window.confirm('Delete this bookmark?');
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

        const recentBookmarks = this.getRecentBookmarks(this.bookmarks);
        const openInNewTab = this.settings.openInNewTab;
        const noRecentText = this.language.t('dashboard.noRecentBookmarks') || 'No recent bookmarks yet.';
        const modalHtml = recentBookmarks.length > 0
            ? `
                <div class="recent-bookmarks-modal-list">
                    ${recentBookmarks.map((bookmark, index) => {
                        const safeName = this.escapeHtml(bookmark.name || 'Bookmark');
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

    getRecentBookmarks(bookmarks) {
        return [...(Array.isArray(bookmarks) ? bookmarks : [])]
            .filter((bookmark) => bookmark && bookmark.lastOpened)
            .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))
            .slice(0, 10);
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

        if (this.settings.showLinkPreviewCards === false) {
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
                if (!openLink._previewHoverActive || this.settings.showLinkPreviewCards === false) {
                    return;
                }
                const preview = await this.fetchBookmarkPreviewData(openLink, bookmark);
                if (!preview || !openLink._previewHoverActive) return;
                preview.note = bookmark.note || '';
                preview.tags = Array.isArray(bookmark.tags) ? bookmark.tags.filter(Boolean) : [];
                preview.openCount = Number(bookmark.openCount || 0);
                preview.lastOpened = bookmark.lastOpened || null;
                this.showBookmarkPreviewCard(preview, event);
            }, hoverDelay);
        });

        openLink.addEventListener('mousemove', (event) => {
            if (this.previewCardElement && this.previewCardElement.classList.contains('is-visible')) {
                this.positionBookmarkPreviewCard(event.clientX, event.clientY);
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
            this.hideBookmarkPreviewCard();
        });
    }

    async fetchBookmarkPreviewData(openLink, bookmark) {
        if (openLink._previewData) {
            return openLink._previewData;
        }
        try {
            let preview = null;
            if (bookmark.previewTitle || bookmark.previewDesc || bookmark.previewImage) {
                preview = {
                    title: bookmark.previewTitle || bookmark.name || '',
                    description: bookmark.previewDesc || '',
                    image: bookmark.previewImage || '',
                    domain: this.extractDomainFromUrl(bookmark.url),
                    url: bookmark.url
                };
            } else {
                const response = await fetch(`/api/bookmark-preview?url=${encodeURIComponent(bookmark.url)}`);
                if (!response.ok) return null;
                preview = await response.json();
                bookmark.previewTitle = preview.title || bookmark.previewTitle || '';
                bookmark.previewDesc = preview.description || bookmark.previewDesc || '';
                bookmark.previewImage = preview.image || bookmark.previewImage || '';
            }

            const title = preview.title || bookmark.name || '';
            const description = preview.description || '';
            if (this.settings.showLinkPreviewCards === false) {
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
        document.body.appendChild(card);
        this.previewCardElement = card;
        return card;
    }

    showBookmarkPreviewCard(preview, event) {
        const card = this.ensureBookmarkPreviewCard();
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
            const warn = Number(summary.duplicateCount || 0) + Number(summary.uncheckedCount || 0) + Number(summary.staleCount || 0);

            const existing = anchor.querySelector('.health-badge');
            if (existing) existing.remove();

            if (broken > 0) {
                const badge = document.createElement('span');
                badge.className = 'health-badge';
                badge.textContent = broken > 99 ? '99+' : String(broken);
                badge.title = `${broken} broken bookmark${broken !== 1 ? 's' : ''}`;
                anchor.appendChild(badge);
            } else if (warn > 0) {
                const badge = document.createElement('span');
                badge.className = 'health-badge health-badge-warn';
                badge.textContent = warn > 99 ? '99+' : String(warn);
                badge.title = `${warn} bookmark${warn !== 1 ? 's' : ''} with warnings`;
                anchor.appendChild(badge);
            }
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
