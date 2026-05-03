// Dashboard JavaScript
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
            showRecentButton: true,
            showTips: true,
            showSyncToasts: true,
            showCheatSheetButton: true,
            showStatus: false,
            showPing: false,
            globalShortcuts: true,
            hyprMode: false,
            enableCustomFavicon: false,
            customFaviconPath: '',
            language: 'en',
            interleaveMode: false,
            showPageTabs: true,
            enableFuzzySuggestions: false,
            fuzzySuggestionsStartWith: false,
            keepSearchOpenWhenEmpty: false,
            showIcons: false,
            sortMethod: 'order',
            layoutPreset: 'default',
            densityMode: 'compact',
            packedColumns: true,
            backgroundOpacity: 1,
            fontWeight: 'normal',
            fontPreset: 'source-code-pro',
            autoDarkMode: false,
            showSmartRecentCollection: false,
            showSmartStaleCollection: false,
            showSmartMostUsedCollection: false,
            smartRecentLimit: 50,
            smartStaleLimit: 50,
            smartMostUsedLimit: 25,
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
            showPinIcon: false
        };
        this.searchComponent = null;
        this.statusMonitor = null;
        this.statusMonitorInitialized = false;
        this.keyboardNavigation = null;
        this.swipeNavigation = null;
        this.categoryReorderInstances = [];
        this.pendingReorderSave = null;
        this.pendingReorderSnapshot = null;
        this.pendingMetadataSave = null;
        this.notificationTimeout = null;
        this.tipRotationTimer = null;
        this.tipRotationIndex = 0;
        this.tipPriorityIndex = 0;
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
        this.init();
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
        this.renderDashboard();
        this.setupPageShortcuts();
        this.setupReorderUndoShortcut();
        this.setupToolbarActions();
        this.setupConfigStructureReloadListener();

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

        // Show body after everything is loaded and rendered
        document.body.classList.remove('loading');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => this.initializeOnboarding());
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
            if (!Array.isArray(this.settings.smartStalePageIds)) {
                this.settings.smartStalePageIds = [];
            }
            if (!Array.isArray(this.settings.smartMostUsedPageIds)) {
                this.settings.smartMostUsedPageIds = [];
            }
            if (typeof this.settings.showSmartRecentCollection === 'undefined') {
                this.settings.showSmartRecentCollection = false;
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
            if (typeof this.settings.showTips === 'undefined') {
                this.settings.showTips = true;
            }
            if (typeof this.settings.showSyncToasts === 'undefined') {
                this.settings.showSyncToasts = true;
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

    showNotification(message, type = 'error') {
        const notification = document.getElementById('error-notification');
        if (notification) {
            notification.textContent = message;
            notification.classList.remove('success');
            if (type === 'success') {
                notification.classList.add('success');
            }
            notification.classList.add('show');
            notification.setAttribute('aria-hidden', 'false');

            if (this.notificationTimeout) {
                clearTimeout(this.notificationTimeout);
            }

            this.notificationTimeout = setTimeout(() => {
                notification.classList.remove('show');
                notification.classList.remove('success');
                notification.setAttribute('aria-hidden', 'true');
            }, 5000);
        }
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
            this.renderDashboard();
            
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
            titleElement.textContent = pageName || this.language.t('dashboard.defaultPageTitle');
        }
    }

    updateDocumentTitle() {
        let title = 'Dashboard';
        
        if (this.settings && this.settings.enableCustomTitle) {
            if (this.settings.customTitle && this.settings.customTitle.trim()) {
                title = this.settings.customTitle.trim();
                
                // Add page name if enabled
                if (this.settings.showPageInTitle && this.pages && this.currentPageId) {
                    const currentPage = this.pages.find(p => p.id === this.currentPageId);
                    if (currentPage && currentPage.name) {
                        title += ' | ' + currentPage.name;
                    }
                }
            } else {
                // Custom title is empty, show only page name if enabled
                if (this.settings.showPageInTitle && this.pages && this.currentPageId) {
                    const currentPage = this.pages.find(p => p.id === this.currentPageId);
                    if (currentPage && currentPage.name) {
                        title = currentPage.name;
                    }
                }
            }
        }
        
        document.title = title;
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
            });
            container.appendChild(pageBtn);
        });
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
        document.body.setAttribute('data-show-cheatsheet-button', this.settings.showCheatSheetButton !== false);
        document.body.setAttribute('data-show-search-button', this.settings.showSearchButton);
        document.body.setAttribute('data-show-finders-button', this.settings.showFindersButton);
        document.body.setAttribute('data-show-commands-button', this.settings.showCommandsButton);
        document.body.setAttribute('data-show-recent-button', this.settings.showRecentButton !== false);
        document.body.setAttribute('data-show-search-button-text', this.settings.showSearchButtonText);
        document.body.setAttribute('data-show-finders-button-text', this.settings.showFindersButtonText);
        document.body.setAttribute('data-show-commands-button-text', this.settings.showCommandsButtonText);
        document.body.setAttribute('data-show-tips', this.settings.showTips !== false);
        document.body.setAttribute('data-show-shortcuts', this.settings.showShortcuts !== false);
        document.body.setAttribute('data-show-pin-icon', this.settings.showPinIcon === true ? 'true' : 'false');
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
            
            // Check if a number key (1-9) was pressed
            const key = e.key;
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

    setupToolbarActions() {
        const helpButton = document.getElementById('help-button');
        if (helpButton) {
            helpButton.addEventListener('click', () => {
                this.showKeyboardCheatSheet();
            });
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

    initializeOnboarding() {
        if (typeof window.Onboarding !== 'function') {
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
            },
            onPersist: async () => {
                dash.settings.onboardingCompleted = true;
                await dash.saveSettings();
            }
        });
        onboarding.maybeStart();
    }

    initializeButtonTipsRotation() {
        const hintEl = document.getElementById('button-hint-text');
        if (!hintEl) {
            return;
        }
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
            'Tip: <code>Ctrl+Shift+A</code> new bookmark',
            'Tip: left strip = drag reorder; long-press row (not strip) = inline edit'
        ];
        const normalTips = [
            'Tip: <code>&gt;</code> open search',
            'Tip: <code>?</code> open finders',
            'Tip: <code>:</code> open commands',
            'Tip: <code>/</code> start fuzzy search',
            'Tip: <code>1-9</code> jump to page',
            'Tip: <code>Shift+←/→</code> switch page',
            'Tip: <code>Enter</code> open selected bookmark',
            'Tip: <code>Space</code> open selected bookmark',
            'Tip: <code>;</code> inline-edit selected bookmark',
            'Tip: hover bookmark (name/icon area) to load preview when enabled',
            'Tip: <code>Esc</code> cancel current state',
            'Tip: <code>Alt+↑/↓</code> reorder in config',
            'Tip: use <code>category:work</code> in search',
            'Tip: use <code>status:online</code> in search',
            'Tip: use <code>page:2</code> in search',
            'Tip: use <code>?g term</code> finder shortcut',
            'Tip: backups under <code>config</code> → backups',
            'Tip: click a category header to collapse or expand it',
            'Tip: global shortcuts from all pages in <code>config</code> → general → Dashboard',
            'Tip: layout preset & density in <code>config</code> → general → Basics',
            'Tip: long-press a bookmark row (not the drag strip) to edit inline',
            this.language.t('dashboard.tipPackedColumns'),
            this.language.t('dashboard.tipHideShortcutPin'),
            this.language.t('dashboard.tipDisableTips'),
            this.language.t('dashboard.tipDisableTipsAlt')
        ];

        let normalCounter = 0;
        const run = () => {
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
            const delay = 5000 + Math.floor(Math.random() * 3001); // 5-8s
            this.tipRotationTimer = setTimeout(run, delay);
        };
        run();
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
                <p class="keyboard-cheat-sheet-intro">Keyboard shortcuts, bookmark mouse gestures, search, and quick actions.</p>
                <div class="keyboard-cheat-sheet-grid">
                    ${sections.map((section) => `
                        <section class="keyboard-cheat-sheet-panel">
                            <h3 class="keyboard-cheat-sheet-section-title">${section.title}</h3>
                            <div class="keyboard-cheat-sheet-list">
                                ${section.items.map((shortcut) => `
                                    <div class="keyboard-cheat-sheet-row">
                                        <span class="keyboard-cheat-sheet-keys">${shortcut.keys}</span>
                                        <span class="keyboard-cheat-sheet-description">${shortcut.description}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </section>
                    `).join('')}
                </div>
            </div>
        `;

        window.AppModal.show({
            title: 'Keyboard cheat sheet',
            htmlMessage: html,
            confirmText: 'Close',
            showCancel: false,
            modalClass: 'keyboard-cheat-sheet-modal',
            modalMaxWidth: '920px',
            modalWidth: '94vw'
        });
    }

    getKeyboardCheatSheetItems() {
        return [
            {
                title: 'Navigation',
                items: [
                    { keys: '1-9', description: 'Open the matching page tab' },
                    { keys: 'Shift + ← / →', description: 'Move between page tabs' },
                    { keys: '↑ / ↓', description: 'Move through bookmarks with keyboard focus' },
                    { keys: '← / →', description: 'Move horizontally through the bookmark grid' },
                    { keys: 'Enter / Space', description: 'Open the selected bookmark' },
                    { keys: ';', description: 'Open inline edit (arrow-highlighted row or Tab-focused link)' },
                    { keys: 'Esc', description: 'Clear selection or undo the latest reorder' }
                ]
            },
            {
                title: 'Dashboard bookmarks (mouse)',
                items: [
                    { keys: 'Left strip (handle)', description: 'Drag to reorder within a category or drop into another column' },
                    { keys: 'Long-press row', description: 'Hold ~500ms on the row, not on the strip, to open inline edit' },
                    { keys: 'Hover row', description: 'Load preview metadata on demand when preview-on-hover is enabled' }
                ]
            },
            {
                title: 'Search',
                items: [
                    { keys: '>', description: 'Open search' },
                    { keys: ':', description: 'Open command mode' },
                    { keys: '?', description: 'Open finders' },
                    { keys: '!', description: 'Open keyboard cheat sheet' },
                    { keys: '*', description: 'Open or close recent bookmarks' },
                    { keys: 'Ctrl + / or F1', description: 'Open keyboard cheat sheet' },
                    { keys: 'category:, status:, page:', description: 'Filter search results by metadata' }
                ]
            },
            {
                title: 'New Features',
                items: [
                    { keys: 'Ctrl + Shift + A', description: 'Open new bookmark modal' },
                    { keys: 'Hover bookmark', description: 'Load preview metadata on demand' },
                    { keys: 'Bookmarks tab', description: 'Analytics, duplicate warnings, and bulk actions' },
                    { keys: 'Theme / layout', description: 'Auto dark mode, opacity, font weight, presets' },
                    { keys: 'Alt + Up / Down', description: 'Move selected bookmark in config' }
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

    renderDashboard() {
        const container = document.getElementById('dashboard-layout');
        if (!container) return;

        this.leaveBookmarkInlineEditFocusMode();

        // Group bookmarks by category
        const groupedBookmarks = this.groupBookmarksByCategory();
        
        // Clear container
        container.innerHTML = '';

        if (!Array.isArray(this.bookmarks) || this.bookmarks.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📭</div>
                    <div class="empty-state-text">No bookmarks yet</div>
                    <div class="empty-state-subtext">Use :new or open config to add your first bookmark.</div>
                    <div class="empty-state-action">
                        <a class="btn btn-primary" href="/config#bookmarks">Add bookmarks</a>
                        <a class="btn btn-secondary" href="/config#backups" data-i18n="config.importDescription">Import your data</a>
                    </div>
                </div>
            `;
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
                    : this.sortBookmarks(collection.bookmarks);
            const collectionElement = this.createCategoryElement({
                id: collection.id,
                name: collection.name,
                icon: collection.icon,
                isSmartCollection: true
            }, collectionBookmarks);
            columnBlocks.push(collectionElement);
        });

        // Render categories
        this.categories.forEach(category => {
            const categoryBookmarks = this.sortBookmarks(groupedBookmarks[category.id] || []);
            if (categoryBookmarks.length === 0) return;

            const categoryElement = this.createCategoryElement(category, categoryBookmarks);
            columnBlocks.push(categoryElement);
        });

        // Handle bookmarks without category
        const uncategorizedBookmarks = groupedBookmarks[''] || [];
        if (uncategorizedBookmarks.length > 0) {
            const uncategorizedCategory = { id: '', name: this.language.t('dashboard.uncategorized') };
            const categoryElement = this.createCategoryElement(uncategorizedCategory, this.sortBookmarks(uncategorizedBookmarks));
            columnBlocks.push(categoryElement);
        }

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
                columns[i % colCount].appendChild(el);
            });
            columns.forEach((c) => container.appendChild(c));
        } else {
            columnBlocks.forEach((el) => container.appendChild(el));
        }

        // Enable realtime drag-and-drop sorting within each category
        this.initializeCategoryReorder();

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
            const categoryId = bookmark.category || '';
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
            setTimeout(() => element.classList.remove('bookmark-move-in'), 180);
        });
        this.updateSearchComponent();
        if (this.statusMonitor) {
            this.statusMonitor.updateBookmarks(this.bookmarks);
        }
        this.scheduleBookmarkOrderSave();
    }

    scheduleBookmarkOrderSave() {
        if (this.pendingReorderSave) {
            clearTimeout(this.pendingReorderSave);
        }

        this.pendingReorderSave = setTimeout(() => {
            this.saveBookmarkOrder();
        }, 1000);
    }

    async saveBookmarkOrder() {
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
            this.showNotification('Bookmark order saved.', 'success');
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
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'category';
        categoryDiv.setAttribute('data-category-id', category.id || '');
        const isSmartCollection = category.isSmartCollection === true;
        const collapsedKey = isSmartCollection ? `smart:${category.id}` : category.id;
        const isCollapsed = this.settings.alwaysCollapseCategories
            ? true
            : (this.collapsedCategories[collapsedKey] || false);
        categoryDiv.setAttribute('data-collapsed', isCollapsed ? 'true' : 'false');

        // Category title
        const titleElement = document.createElement('h2');
        titleElement.className = 'category-title';
        const categoryIcon = (category.icon || '').trim();
        titleElement.innerHTML = '';

        if (this.isUploadedCategoryIcon(categoryIcon)) {
            const iconImage = document.createElement('img');
            iconImage.src = `/data/icons/${categoryIcon}`;
            iconImage.alt = '';
            iconImage.className = 'bookmark-icon';
            titleElement.appendChild(iconImage);
            titleElement.appendChild(document.createTextNode(` ${category.name.toLowerCase()}`));
        } else {
            const textIcon = categoryIcon || '▣';
            titleElement.textContent = `${textIcon} ${category.name.toLowerCase()}`;
        }
        titleElement.addEventListener('click', () => {
            const isCollapsed = categoryDiv.getAttribute('data-collapsed') === 'true';
            categoryDiv.setAttribute('data-collapsed', isCollapsed ? 'false' : 'true');
            this.collapsedCategories[collapsedKey] = !isCollapsed;
            this.saveCollapsedStates();
        });
        categoryDiv.appendChild(titleElement);

        // Bookmarks list
        const bookmarksList = document.createElement('div');
        bookmarksList.className = 'bookmarks-list';
        bookmarksList.setAttribute('data-category-id', category.id || '');
        bookmarksList.setAttribute('data-bookmarks-list', 'true');
        if (isSmartCollection) {
            bookmarksList.setAttribute('data-smart-collection', 'true');
        }

        bookmarks.forEach(bookmark => {
            const bookmarkElement = this.createBookmarkElement(bookmark, category.id || '', true);
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

        return collections;
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
        setTimeout(() => el.classList.remove('nextdash-stale-flash'), 2200);
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
                iconImg.addEventListener('load', () => placeholder.remove());
                iconImg.addEventListener('error', () => {
                    placeholder.remove();
                    iconImg.remove();
                });
                iconSlot.appendChild(iconImg);
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

        if (bookmark.previewTitle || bookmark.previewDesc) {
            openLink.title = `${bookmark.previewTitle || bookmark.name}${bookmark.previewDesc ? `\n${bookmark.previewDesc}` : ''}`;
        } else {
            openLink.addEventListener('mouseenter', async () => {
                if (openLink.dataset.previewLoaded === 'true') {
                    return;
                }
                try {
                    const response = await fetch(`/api/bookmark-preview?url=${encodeURIComponent(bookmark.url)}`);
                    if (!response.ok) {
                        return;
                    }
                    const preview = await response.json();
                    const title = preview.title || bookmark.name;
                    const description = preview.description || '';
                    openLink.title = `${title}${description ? `\n${description}` : ''}`;
                    openLink.dataset.previewLoaded = 'true';
                } catch (error) {
                    openLink.dataset.previewLoaded = 'true';
                }
            }, { once: true });
        }

        row.appendChild(openLink);

        const shortcutSpan = document.createElement('span');
        shortcutSpan.className = 'bookmark-shortcut';
        const showShortcuts = this.settings.showShortcuts !== false;
        shortcutSpan.textContent = showShortcuts && bookmark.shortcut && String(bookmark.shortcut).trim()
            ? String(bookmark.shortcut).toUpperCase()
            : '';
        if (!shortcutSpan.textContent) {
            shortcutSpan.classList.add('is-empty');
            shortcutSpan.setAttribute('aria-hidden', 'true');
        }
        row.appendChild(shortcutSpan);

        const pinBadge = document.createElement('span');
        pinBadge.className = 'bookmark-pin-badge';
        const showPinIcon = this.settings.showPinIcon === true;
        if (showPinIcon && bookmark.pinned) {
            pinBadge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 3h8l-1 5 3 3v1H6v-1l3-3-1-5zm4 10v8h-1v-8h1z"></path></svg>';
            pinBadge.title = 'Pinned';
            pinBadge.setAttribute('aria-label', 'Pinned bookmark');
            pinBadge.setAttribute('role', 'img');
        } else {
            pinBadge.textContent = '';
            pinBadge.classList.add('is-empty');
            pinBadge.setAttribute('aria-hidden', 'true');
        }
        row.appendChild(pinBadge);

        if (allowInlineEdit && bookmarkRef) {
            const ac = new AbortController();
            row._bookmarkLongPressAbort = ac;
            this.attachBookmarkRowLongPress(row, openLink, bookmarkRef, ac.signal);
        }
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
        iconUrlInput.type = 'url';
        iconUrlInput.className = 'bookmark-inline-input';
        iconUrlInput.placeholder = 'https://.../icon.png';
        iconUrlInput.value = pendingIcon ? `/data/icons/${pendingIcon}` : '';

        const iconActions = document.createElement('div');
        iconActions.className = 'bookmark-inline-icon-actions';

        const setIconBtn = document.createElement('button');
        setIconBtn.type = 'button';
        setIconBtn.className = 'bookmark-inline-action-btn bookmark-inline-save';
        setIconBtn.textContent = 'Set';

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

        const syncIconState = () => {
            iconState.textContent = pendingIcon ? 'Icon set' : 'No icon';
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
            setIconBtn.disabled = true;
            const nextIcon = await this.uploadBookmarkIconFromUrl(inputValue);
            setIconBtn.disabled = false;
            if (!nextIcon) {
                this.showErrorNotification('Invalid or blocked icon URL.');
                return;
            }
            pendingIcon = nextIcon;
            iconUrlInput.value = `/data/icons/${nextIcon}`;
            syncIconState();
            this.showNotification('Icon URL set.', 'success');
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
        iconActions.appendChild(setIconBtn);
        iconActions.appendChild(clearIconBtn);
        iconActions.appendChild(iconState);
        const iconWrap = mkField('Icon URL', iconUrlInput);
        iconWrap.appendChild(iconPreview);
        iconWrap.appendChild(iconFileInput);
        iconWrap.appendChild(iconActions);
        form.appendChild(iconWrap);
        syncIconState();

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
                pinInput,
                statusInput,
                getPendingIcon: () => pendingIcon
            });
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

    async commitBookmarkInlineEdit(bookmarkRef, fields) {
        const bookmark = bookmarkRef?.bookmark;
        if (!bookmark || !bookmarkRef) {
            return;
        }

        const name = fields.nameInput.value.trim();
        const url = fields.urlInput.value.trim();
        const shortcut = fields.shortcutInput.value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
        const category = fields.catSelect.value;

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
        const nextBookmarkState = {
            name,
            url,
            icon: typeof fields.getPendingIcon === 'function' ? fields.getPendingIcon() : bookmark.icon,
            shortcut,
            category,
            pinned: fields.pinInput.checked,
            checkStatus: fields.statusInput.checked
        };

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
        this.bookmarks.splice(bookmarkIndex, 1);
        this.inlineEditingBookmarkIndex = null;
        this.renderDashboard();
        this.scheduleBookmarkOrderSave();
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

        if (this.settings.showConfigButton) {
            // Show config button - create if it doesn't exist
            if (!configLink) {
                configLink = document.createElement('div');
                configLink.className = 'config-link';
                configLink.innerHTML = `<a href="/config">${this.language.t('dashboard.config')}</a>`;

                // Add to header at the end (use safe header container)
                const header = this.getHeaderContainer();
                header.appendChild(configLink);
            }
        } else {
            // Hide config button - remove if it exists
            if (configLink) {
                configLink.remove();
            }
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
        const tplCombined = this.language?.t ? this.language.t('dashboard.dateTimeLine') : null;
        const tplTimeOnly = this.language?.t ? this.language.t('dashboard.dateTimeOnly') : null;

        let dateTimeText = '';
        if (timePart && datePart) {
            const raw = tplCombined || "It's {time} @ {date}";
            dateTimeText = raw.replace('{time}', timePart).replace('{date}', datePart);
        } else if (timePart) {
            const raw = tplTimeOnly || "It's {time}";
            dateTimeText = raw.replace('{time}', timePart);
        } else if (datePart) {
            // Fallback to showing just the date when time is disabled
            const raw = this.language?.t ? this.language.t('dashboard.dateOnly') : null;
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
