// Search Component JavaScript
class SearchComponent {
    constructor(bookmarksForSearch, currentBookmarks, allBookmarks, settings = {}, language = null, finders = [], pages = []) {
        this.bookmarks = bookmarksForSearch;
        this.currentBookmarks = currentBookmarks;
        this.allBookmarks = allBookmarks;
        this.settings = settings;
        this.language = language;
        this.finders = finders;
        this.pages = pages || [];
        this.currentPageId = settings.currentPage || 1;
        this.shortcuts = new Map();
        this.currentQuery = '';
        this.searchActive = false;
        this.searchMatches = [];
        this.selectedMatchIndex = 0;
        this.selectedChipIndex = 0;
        this.matchElements = []; // Store references to DOM elements for selection highlighting
        this.selectableMatches = []; // Parallel array of match data for keyboard-selectable items
        this.justCompleted = false; // Flag to prevent accidental execution after completion
        this.emptyStateExpandedGroups = new Set(); // Tracks expanded groups in empty search state
        this.pendingConfirmation = false; // Flag to prevent accidental confirmation execution
        this.resetLegacySearchPresetsOnce();
        this.searchHistory = this.loadSearchHistory();
        this.recentCommands = this.loadRecentCommands();
        this.savedSearches = this.loadSavedSearches();
        this.lastNonCommandQuery = '';
        this._debounceTimer = null;

        this.commandsComponent = new window.SearchCommandsComponent(this.language, this.currentBookmarks, this.allBookmarks, (newQuery) => {
            this.currentQuery = newQuery;
            this.updateSearch();
        });

        this.findersComponent = new window.SearchFindersComponent(this.language, [], this.settings);

        this.fuzzySearchComponent = new window.FuzzySearchComponent(this.bookmarks, (bookmark) => this.openBookmark(bookmark));

        this.interleaveMode = settings.interleaveMode || false;

        this.init();
    }

    resetLegacySearchPresetsOnce() {
        const migrationKey = 'nextdashSearchPresetsClearedV1';
        try {
            if (localStorage.getItem(migrationKey) === 'true') {
                return;
            }
            localStorage.removeItem('dashboardSearchHistory');
            localStorage.removeItem('dashboardSavedSearches');
            localStorage.setItem(migrationKey, 'true');
        } catch (error) {
            // Ignore localStorage errors.
        }
    }

    init() {
        this.buildShortcutsMap();
        this.setupEventListeners();
        this.previousOverflow = null;
        this.preventScrollHandler = null;
    }

    updateData(bookmarksForSearch, currentBookmarks, allBookmarks, settings, language = null, finders = [], pages = []) {
        this.bookmarks = bookmarksForSearch;
        this.currentBookmarks = currentBookmarks;
        this.allBookmarks = allBookmarks;
        this.settings = settings;
        this.language = language || this.language;
        this.finders = finders;
        this.pages = pages || this.pages || [];
        this.commandsComponent.setLanguage(this.language);
        this.commandsComponent.setBookmarks(this.currentBookmarks, this.allBookmarks);
        this.findersComponent.setLanguage(this.language);
        this.findersComponent.setFinders(this.finders);
        this.findersComponent.setSettings(this.settings);
        this.fuzzySearchComponent.updateBookmarks(this.bookmarks);
        this.interleaveMode = settings.interleaveMode || false;
        this.currentPageId = settings.currentPage || this.currentPageId || 1;
        this.savedSearches = this.loadSavedSearches();
        this.buildShortcutsMap();
    }

    _getPageName(pageId) {
        if (!pageId || !Array.isArray(this.pages)) return null;
        const page = this.pages.find(p => p.id === pageId);
        return page ? page.name : null;
    }

    buildShortcutsMap() {
        if (this.searchActive) {
            this.closeSearch();
        }

        // Clear existing shortcuts
        this.shortcuts.clear();

        // Build shortcuts map
        this.bookmarks.forEach(bookmark => {
            if (bookmark.shortcut && bookmark.shortcut.trim()) {
                this.shortcuts.set(bookmark.shortcut.toLowerCase(), bookmark);
            }
        });
    }

    setupEventListeners() {
        // Setup mobile input listener
        const mobileInput = document.getElementById('search-input-mobile');
        if (mobileInput) {
            mobileInput.addEventListener('input', (e) => {
                const raw = e.target.value;
                // In command mode preserve original case for URLs; otherwise uppercase
                const inCommandMode = this.currentQuery.startsWith(':');
                const value = inCommandMode ? raw : raw.toUpperCase();
                if (value.length > this.currentQuery.length) {
                    // Character added
                    const newChar = value[value.length - 1];
                    const allowed = inCommandMode
                        ? /^[\x20-\x7E]$/.test(newChar)  // any printable ASCII in command mode
                        : /^[A-Z0-9: \?/#\.\-_]$/.test(newChar);
                    if (allowed) {
                        this.addToQuery(newChar);
                    }
                } else if (value.length < this.currentQuery.length) {
                    // Character removed
                    this.removeLastChar();
                }
                // Keep input synced
                e.target.value = this.currentQuery;
            });

            mobileInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.selectCurrentMatch();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    if (!this.isAppModalOpen()) {
                        this.closeSearch();
                    }
                }
            });
        }

        // Add keyboard event listener
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts if user is typing in an input, except when search is active and it's a navigation key
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                if (!this.searchActive || !['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
                    return;
                }
            }

            // Don't trigger shortcuts if any modifier key is pressed
            // This allows browser shortcuts like Ctrl+W, Ctrl+R, Ctrl+Q, etc.
            if (e.ctrlKey || e.altKey || e.metaKey) {
                return;
            }

            this.handleKeyPress(e);
        });

        // Close search when clicking outside
        document.addEventListener('click', (e) => {
            const searchElement = document.getElementById('shortcut-search');
            const searchContainer = document.querySelector('.search-container');
            
            if (this.searchActive && searchElement && searchContainer) {
                // If clicked on the backdrop (not on the search container)
                if (e.target === searchElement) {
                    this.closeSearch();
                }
            }
        });

        // Add search button event listener
        const searchButton = document.getElementById('search-button');
        if (searchButton) {
            searchButton.addEventListener('click', () => {
                this.openSearchInterface();
            });
        }

        // Add finders button event listener
        const findersButton = document.getElementById('finders-button');
        if (findersButton) {
            findersButton.addEventListener('click', () => {
                window.dashboardInstance?.markInlineTipUsed?.('finder_open');
                this.openSearchInterface();
                this.currentQuery = '?';
                this.updateSearch();
                this.renderSearchMatches();
            });
        }

        // Add commands button event listener
        const commandsButton = document.getElementById('commands-button');
        if (commandsButton) {
            commandsButton.addEventListener('click', () => {
                window.dashboardInstance?.markInlineTipUsed?.('command_open');
                this.openSearchInterface();
                this.currentQuery = ':';
                this.updateSearch();
                this.renderSearchMatches();
            });
        }

        // Mode tab click handlers
        document.querySelectorAll('.search-mode-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                const mode = tab.dataset.mode;
                if (mode === 'command') {
                    window.dashboardInstance?.markInlineTipUsed?.('command_open');
                    this.currentQuery = ':';
                    this.commandsComponent.resetState();
                } else if (mode === 'finder') {
                    window.dashboardInstance?.markInlineTipUsed?.('finder_open');
                    this.currentQuery = '?';
                } else {
                    this.currentQuery = '';
                    this.commandsComponent.resetState();
                }
                this.updateSearch();
            });
        });

        document.addEventListener('theme-changed', () => {
            if (this.searchActive) {
                this.renderSearchMatches();
            }
        });
    }

    getThemeIconStylingEntry() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || this.settings.theme || 'default';
        const map = this.settings?.themeIconStyling || {};
        return map[currentTheme] || { enabled: false, style: 'muted', intensity: 0.5 };
    }

    _highlightQuery(text, query) {
        if (!query || !text) return this._escHtml(text || '');
        const lc = text.toLowerCase();
        const lcQ = query.toLowerCase();
        const idx = lc.indexOf(lcQ);
        if (idx === -1) return this._escHtml(text);
        return this._escHtml(text.slice(0, idx))
            + `<mark class="search-highlight">${this._escHtml(text.slice(idx, idx + query.length))}</mark>`
            + this._escHtml(text.slice(idx + query.length));
    }

    _escHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    buildSearchBookmarkIconHtml(match) {
        if (!this.settings?.showIcons || match?.type !== 'bookmark') {
            return '';
        }
        const iconName = (match?.bookmark?.icon || '').trim();
        if (!iconName || !/^[\w.\-]+$/.test(iconName)) {
            return '';
        }
        const entry = this.getThemeIconStylingEntry();
        const themedClass = entry.enabled ? ` icon-themed icon-themed--${entry.style || 'muted'}` : '';
        const intensityStyle = entry.enabled ? ` style="--icon-theme-intensity:${entry.intensity || 0.5};"` : '';
        return `<span class="search-match-favicon-slot${themedClass}"${intensityStyle}><img class="bookmark-icon" src="/data/icons/${iconName}" alt="" loading="lazy"></span>`;
    }

    isAppModalOpen() {
        return document.getElementById('app-modal')?.classList.contains('show') === true;
    }

    isChipMatch(match) {
        return match?.type === 'history-chips' || match?.type === 'command-chips';
    }

    applySelectedChipQuery(match) {
        const queries = match?.queries || [];
        if (!queries.length) return;
        const q = queries[this.selectedChipIndex] || queries[0];
        this.currentQuery = q;
        this.selectedChipIndex = 0;
        this.updateSearch();
        this.selectedMatchIndex = 0;
        this.updateSelectionHighlight();
    }

    shouldDeferToDashboardOverlay() {
        const dash = window.dashboardInstance;
        if (document.body.classList.contains('bookmark-inline-edit-active')) {
            return true;
        }
        if (dash?.isInlineEditActive?.()) {
            return true;
        }
        if (dash?.isModalOpen?.()) {
            return true;
        }
        if (window.DashboardTagCloud?.modalOpen) {
            return true;
        }
        return false;
    }

    handleKeyPress(e) {
        const key = e.key.toUpperCase();
        
        // Handle special keys
        if (key === 'ESCAPE') {
            if (!this.isAppModalOpen()) {
                this.closeSearch();
            }
            return;
        }

        if (!this.searchActive && this.shouldDeferToDashboardOverlay()) {
            return;
        }

        // G / GG category navigation — never open shortcut search
        if (!this.searchActive && key === 'G') {
            return;
        }

        if (!this.searchActive && key >= '1' && key <= '9' && window.dashboardInstance?.keyboardNavigation?.isGChordActive?.()) {
            return;
        }

        if ((key === 'ARROWLEFT' || key === 'ARROWRIGHT') && this.searchActive) {
            const match = this.selectableMatches[this.selectedMatchIndex];
            if (this.isChipMatch(match)) {
                e.preventDefault();
                const queries = match.queries || [];
                if (!queries.length) return;
                if (key === 'ARROWLEFT') {
                    this.selectedChipIndex = (this.selectedChipIndex - 1 + queries.length) % queries.length;
                } else {
                    this.selectedChipIndex = (this.selectedChipIndex + 1) % queries.length;
                }
                this.updateSelectionHighlight();
                return;
            }
        }
        
        if (key === 'ENTER' && this.searchActive) {
            e.preventDefault();
            this.selectCurrentMatch();
            return;
        }
        
        if (key === 'ARROWUP' && this.searchActive) {
            e.preventDefault();
            this.navigateMatches(-1);
            return;
        }
        
        if (key === 'ARROWDOWN' && this.searchActive) {
            e.preventDefault();
            this.navigateMatches(1);
            return;
        }

        if (key === 'TAB' && this.searchActive) {
            e.preventDefault();
            this.navigateMatches(e.shiftKey ? -1 : 1);
            return;
        }
        
        if (key === 'BACKSPACE' && this.searchActive) {
            e.preventDefault();
            this.removeLastChar();
            return;
        }

        // Handle > key to open normal search
        if (key === '>') {
            e.preventDefault();
            this.openSearchInterface();
            return;
        }

        // Handle colon key to start commands
        if (key === ':') {
            e.preventDefault();
            window.dashboardInstance?.markInlineTipUsed?.('command_open');
            const keyNav = window.dashboardInstance?.keyboardNavigation;
            const selected = keyNav && typeof keyNav.getSelectedBookmark === 'function'
                ? keyNav.getSelectedBookmark()
                : null;
            if (selected && selected.name) {
                this.commandsComponent.contextBookmark = selected;
                // Auto-expand the Bookmarks group so context commands are immediately visible
                this.commandsComponent.expandedGroups.add('bookmarks');
            }
            this.addToQuery(':');
            return;
        }

        // / toggles dashboard tag cloud when enabled; otherwise interleave fuzzy prefix
        if (key === '/') {
            const dash = window.dashboardInstance;
            if (!this.searchActive && dash && window.DashboardTagCloud?.isEligible?.()) {
                return;
            }
            if (!this.interleaveMode) {
                return;
            }
            e.preventDefault();
            this.addToQuery('/');
            return;
        }

        // Handle @ key to start global search
        if (e.key === '@') {
            e.preventDefault();
            this.addToQuery('@');
            return;
        }

        // Handle ? key to start finders
        if (key === '?') {
            e.preventDefault();
            window.dashboardInstance?.markInlineTipUsed?.('finder_open');
            this.addToQuery('?');
            return;
        }

        // , opens the page overview overlay (never feeds into search)
        if (e.key === ',') {
            e.preventDefault();
            window.dashboardInstance?.showPageOverlay?.();
            return;
        }

        // + opens the full new-bookmark modal (never feeds into search)
        if (e.key === '+') {
            e.preventDefault();
            window.dashboardInstance?.quickAddWidget?.toggle?.();
            return;
        }

        // & opens the quick-add omnibox (never feeds into search)
        if (e.key === '&') {
            e.preventDefault();
            window.dashboardInstance?.showOmnibox?.();
            return;
        }

        // Handle space key for commands, finders, and global search
        if (key === ' ' && (this.currentQuery.startsWith(':') || this.currentQuery.startsWith('?') || this.currentQuery.startsWith('@'))) {
            e.preventDefault();
            this.addToQuery(' ');
            return;
        }

        // In command mode allow all printable characters (needed for URLs: dots, slashes, underscores, etc.)
        // Use e.key directly to preserve original case for URL paths.
        if (this.currentQuery.startsWith(':') && e.key.length === 1) {
            e.preventDefault();
            this.addToQuery(e.key);
            return;
        }

        // In global-search mode allow all printable characters
        if (this.currentQuery.startsWith('@') && e.key.length === 1) {
            e.preventDefault();
            this.addToQuery(e.key);
            return;
        }

        // Only handle letter keys (A-Z) and numbers (0-9) when search is active, otherwise only letters and :
        if (this.searchActive) {
            if (!/^[A-Z0-9\-\._]$/.test(key)) {
                return;
            }
        } else {
            if (this.interleaveMode) {
                if (!/^[A-Z0-9/\-]$/.test(key)) {
                    return;
                }
            } else {
                if (!/^[A-Z:/\-]$/.test(key)) {
                    return;
                }
            }
        }

        e.preventDefault();
        this.addToQuery(key);
    }

    addToQuery(key) {
        this.currentQuery += key;

        // Auto-convert to finder mode if space is pressed after a finder shortcut
        if (key === ' ' && this.settings.includeFindersInSearch) {
            const trimmed = this.currentQuery.trim();
            if (this.findersComponent.shortcuts.has(trimmed.toLowerCase())) {
                this.currentQuery = `?${trimmed.toUpperCase()} `;
            }
        } else if (key !== ' ' && this.currentQuery.startsWith('?')) {
            this.currentQuery = this.findersComponent.completeShortcutWithSpace(this.currentQuery);
        }

        this.commandsComponent.resetState();
        
        // Check for exact match first
        const query = this.currentQuery.startsWith('/') ? this.currentQuery.slice(1) : this.currentQuery;
        const isShortcutMode = (this.currentQuery.startsWith('/') && this.interleaveMode) || (!this.currentQuery.startsWith('/') && !this.interleaveMode);
        
        if (isShortcutMode) {
            const exactMatch = this.shortcuts.get(query.toLowerCase());
            if (exactMatch) {
                // If it's a single character or no other shortcuts start with this query
                const hasLongerMatches = Array.from(this.shortcuts.keys()).some(shortcut => 
                    shortcut !== query.toLowerCase() && 
                    shortcut.startsWith(query.toLowerCase())
                );
                
                const hasFinder = this.settings.includeFindersInSearch && (
                    this.findersComponent.shortcuts.has(query.toLowerCase()) ||
                    Array.from(this.findersComponent.shortcuts.keys()).some(finderShortcut => 
                        finderShortcut.startsWith(query.toLowerCase())
                    )
                );
                
                if (!hasLongerMatches && !hasFinder) {
                    // Open immediately if no longer matches exist and no finder conflicts
                    this.openBookmark(exactMatch);
                    this.resetQuery();
                    return;
                }
            }
        }
        
        // Show search interface and find matches
        this._scheduleUpdateSearch();
    }

    _scheduleUpdateSearch() {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            this._debounceTimer = null;
            this.updateSearch();
        }, 50);
    }

    parseSearchFilters(query) {
        const filters = {
            category: '',
            status: '',
            page: '',
            tag: ''
        };

        const parts = (query || '').split(/\s+/).filter(Boolean);
        const remaining = [];

        parts.forEach((part) => {
            const lower = part.toLowerCase();
            if (lower.startsWith('category:')) {
                filters.category = lower.slice(9);
            } else if (lower.startsWith('status:')) {
                filters.status = lower.slice(7);
            } else if (lower.startsWith('page:')) {
                filters.page = lower.slice(5);
            } else if (lower.startsWith('tag:')) {
                filters.tag = lower.slice(4);
            } else {
                remaining.push(part);
            }
        });

        return {
            filters,
            query: remaining.join(' ').trim()
        };
    }

    dashboardLabel(key, fallback, vars = {}) {
        const fullKey = key.startsWith('dashboard.') ? key : `dashboard.${key}`;
        let text = (this.language?.t?.(fullKey) && this.language.t(fullKey) !== fullKey)
            ? this.language.t(fullKey)
            : fallback;
        Object.entries(vars).forEach(([name, value]) => {
            text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
        });
        return text;
    }

    formatFilterPageValueLabel(pageValue) {
        if (pageValue === 'current') {
            return this.dashboardLabel('filterPageCurrent', 'current page');
        }
        if (pageValue === 'all') {
            return this.dashboardLabel('filterPageAll', 'all pages');
        }
        return pageValue;
    }

    getFilterHintItems() {
        return [
            {
                shortcut: '↳',
                name: this.dashboardLabel('filterByCategory', 'Filter by category (example: category:work)'),
                completion: 'category: ',
                type: 'filter-completion',
            },
            {
                shortcut: '↳',
                name: this.dashboardLabel(
                    'filterByStatusFull',
                    'Filter by status (online/offline/checked/unchecked/pinned/unpinned/broken/ok)',
                ),
                completion: 'status: ',
                type: 'filter-completion',
            },
            {
                shortcut: '↳',
                name: this.dashboardLabel('filterByPage', 'Filter by page (current/all/number)'),
                completion: 'page: ',
                type: 'filter-completion',
            },
            {
                shortcut: '↳',
                name: this.dashboardLabel('filterByTag', 'Filter by tag (example: tag:work)'),
                completion: 'tag: ',
                type: 'filter-completion',
            },
        ];
    }

    getFilterAutocompleteMatches(rawQuery) {
        const t = (key, fallback, vars = {}) => this.dashboardLabel(key, fallback, vars);

        const query = String(rawQuery || '');
        const parts = query.split(/\s+/);
        const currentToken = (parts[parts.length - 1] || '').toLowerCase();
        const basePrefix = parts.slice(0, -1).join(' ').trim();
        const prefixWithSpace = basePrefix ? `${basePrefix} ` : '';

        const categories = Array.from(new Set(
            (this.allBookmarks || [])
                .map((bookmark) => String(bookmark?.category || '').trim().toLowerCase())
                .filter(Boolean)
        )).sort();
        const pageIds = Array.from(new Set(
            (this.allBookmarks || [])
                .map((bookmark) => Number(bookmark?.pageId || bookmark?.pageID || 0))
                .filter((id) => Number.isFinite(id) && id > 0)
        )).sort((a, b) => a - b);

        const toCompletion = (token, description) => ({
            shortcut: '↳',
            name: description,
            completion: `${prefixWithSpace}${token} `,
            type: 'filter-completion'
        });

        const allTags = Array.from(new Set(
            (this.allBookmarks || []).flatMap(bm => (bm.tags || []).map(t => t.toLowerCase()))
        )).sort();

        if (currentToken === '' || currentToken === 'category' || currentToken === 'status' || currentToken === 'page' || currentToken === 'tag') {
            return [
                toCompletion('category:', t('filterByCategory', 'Filter by category (example: category:work)')),
                toCompletion('status:', t('filterByStatusFull', 'Filter by status (online/offline/checked/unchecked/pinned/unpinned/broken/ok)')),
                toCompletion('page:', t('filterByPage', 'Filter by page (current/all/number)')),
                toCompletion('tag:', t('filterByTag', 'Filter by tag (example: tag:work)'))
            ];
        }

        if (currentToken.startsWith('category:')) {
            const value = currentToken.slice('category:'.length);
            return categories
                .filter((category) => category.startsWith(value))
                .slice(0, 8)
                .map((category) => toCompletion(
                    `category:${category}`,
                    t('filterCompletionCategory', 'Category: {value}', { value: category })
                ));
        }

        if (currentToken.startsWith('status:')) {
            const value = currentToken.slice('status:'.length);
            const statusEntries = [
                ['online', t('filterStatusOnline', 'Reachable bookmarks')],
                ['offline', t('filterStatusOffline', 'Unreachable bookmarks')],
                ['broken', t('filterStatusBroken', 'Broken / error response')],
                ['ok', t('filterStatusOk', 'Online and not broken')],
                ['pinned', t('filterStatusPinned', 'Pinned bookmarks')],
                ['unpinned', t('filterStatusUnpinned', 'Not pinned')],
                ['checked', t('filterStatusChecked', 'Status check enabled')],
                ['unchecked', t('filterStatusUnchecked', 'Status check disabled')],
            ];
            return statusEntries
                .filter(([status]) => status.startsWith(value))
                .map(([status, desc]) => toCompletion(
                    `status:${status}`,
                    t('filterStatusEntry', 'status:{status} — {desc}', { status, desc })
                ));
        }

        if (currentToken.startsWith('page:')) {
            const value = currentToken.slice('page:'.length);
            const pageValues = ['current', 'all', ...pageIds.map((id) => String(id))];
            return pageValues
                .filter((pageValue) => pageValue.startsWith(value))
                .slice(0, 10)
                .map((pageValue) => toCompletion(
                    `page:${pageValue}`,
                    t('filterCompletionPage', 'Page: {value}', {
                        value: this.formatFilterPageValueLabel(pageValue),
                    })
                ));
        }

        if (currentToken.startsWith('tag:')) {
            const value = currentToken.slice('tag:'.length);
            return allTags
                .filter((tag) => tag.startsWith(value))
                .slice(0, 8)
                .map((tag) => toCompletion(
                    `tag:${tag}`,
                    t('filterCompletionTag', 'Tag: {value}', { value: tag })
                ));
        }

        return [];
    }

    matchesAdvancedFilters(bookmark, filters) {
        if (!bookmark) return false;

        if (filters.category) {
            const category = String(bookmark.category || '').toLowerCase();
            if (!category.includes(filters.category)) {
                return false;
            }
        }

        if (filters.status) {
            const normalized = filters.status.toLowerCase();
            const hasStatus = bookmark.checkStatus === true;
            const isPinned = bookmark.pinned === true;
            const isBroken = Boolean(bookmark.lastError && String(bookmark.lastError).trim());
            const statusCache = window.dashboardInstance?.statusMonitor?.statusCache;
            const statusKey = typeof statusCacheKey === 'function'
                ? statusCacheKey(bookmark.url)
                : (typeof BookmarkUrlUtils !== 'undefined' && typeof BookmarkUrlUtils.canonicalBookmarkURLKey === 'function'
                    ? BookmarkUrlUtils.canonicalBookmarkURLKey(bookmark.url || '')
                    : String(bookmark.url || ''));
            const cachedStatus = statusCache instanceof Map
                ? statusCache.get(statusKey)?.status
                : '';
            const normalizedCachedStatus = String(cachedStatus || '').toLowerCase();

            if (normalized === 'checked' && !hasStatus) return false;
            if (normalized === 'unchecked' && hasStatus) return false;
            if (normalized === 'pinned' && !isPinned) return false;
            if (normalized === 'unpinned' && isPinned) return false;
            if (normalized === 'broken' && !isBroken) return false;
            if (normalized === 'ok' && isBroken) return false;
            if (normalized === 'online' && normalizedCachedStatus !== 'online') return false;
            if (normalized === 'offline' && normalizedCachedStatus !== 'offline') return false;
        }

        if (filters.tag) {
            const t = filters.tag.toLowerCase();
            if (!(bookmark.tags || []).some(tag => tag.toLowerCase().includes(t))) {
                return false;
            }
        }

        if (filters.page && filters.page !== 'all' && filters.page !== 'global') {
            const bookmarkPageId = Number(bookmark.pageId || bookmark.pageID || this.currentPageId || 0);
            if (filters.page === 'current') {
                if (bookmarkPageId && bookmarkPageId !== Number(this.currentPageId || 0)) {
                    return false;
                }
            } else if (/^\d+$/.test(filters.page)) {
                if (bookmarkPageId !== Number(filters.page)) {
                    return false;
                }
            }
        }

        return true;
    }

    removeLastChar() {
        if (this.currentQuery.length > 0) {
            this.currentQuery = this.currentQuery.slice(0, -1);
            this.commandsComponent.resetState();
            // No resetState for finders needed as they don't have state
            if (this.currentQuery.length === 0 && !this.settings.keepSearchOpenWhenEmpty) {
                this.closeSearch();
            } else {
                this._scheduleUpdateSearch();
            }
        }
    }

    updateSearch() {
        if (this.currentQuery.length > 0) {
            window.DashboardSearchPromo?.onSearchQueryStarted?.(this.currentQuery);
            window.DashboardSearchPromo?.onSearchFilterPrefixUsed?.(this.currentQuery);
        }

        // Find matching shortcuts
        this.searchMatches = [];

        if (this.currentQuery.startsWith('@')) {
            // Handle global search across all pages
            const query = this.currentQuery.slice(1).trim();
            if (!query) {
                this.searchMatches = [{
                    type: 'command-group-header',
                    groupId: 'global-hint',
                    label: this.dashboardLabel('globalSearchHint', 'Search across all pages — type to start'),
                    count: 0,
                    expanded: false
                }];
            } else {
                const results = this.fuzzySearchComponent.handleFuzzy(query, this.allBookmarks);
                this.searchMatches = results.map(m => {
                    const pageName = this._getPageName(m.bookmark && m.bookmark.pageId);
                    const isCurrentPage = m.bookmark && m.bookmark.pageId === this.currentPageId;
                    const pageMeta = (pageName && !isCurrentPage) ? pageName : null;
                    const combinedMeta = [pageMeta, m.meta].filter(Boolean).join(' · ') || null;
                    return { ...m, meta: combinedMeta, type: 'global-search' };
                });
            }
        } else if (this.currentQuery.startsWith(':')) {
            // Handle commands
            this.searchMatches = this.commandsComponent.handleCommand(this.currentQuery);
        } else if (this.currentQuery.startsWith('?')) {
            // Handle finders
            this.searchMatches = this.findersComponent.handleQuery(this.currentQuery);
        } else {
            const query = this.currentQuery.startsWith('/') ? this.currentQuery.slice(1) : this.currentQuery;
            const isShortcutMode = (this.currentQuery.startsWith('/') && this.interleaveMode) || (!this.currentQuery.startsWith('/') && !this.interleaveMode);
            const parsed = this.parseSearchFilters(query);
            const searchQuery = parsed.query;
            const filters = parsed.filters;
            const hasFilters = Object.values(filters).some((value) => Boolean(value));
            
            const filterAutocompleteMatches = this.getFilterAutocompleteMatches(query);
            if (searchQuery.length === 0 && !hasFilters && filterAutocompleteMatches.length > 0 && query.length > 0) {
                // Query is a bare filter token being typed (e.g. "status:", "status:on") —
                // show its completions with a group header, consistent with the empty state.
                // Reuse the same toggle state as the 'filters' empty-state group (defaultOpen=true)
                const filtersIsExpanded = !this.emptyStateExpandedGroups.has('filters');
                this.searchMatches = [
                    {
                        type: 'command-group-header',
                        groupId: 'empty_filters',
                        label: this.dashboardLabel('filtersGroupLabel', 'Filters'),
                        count: filterAutocompleteMatches.length,
                        expanded: filtersIsExpanded,
                        _emptyStateGroup: 'filters'
                    },
                    ...(filtersIsExpanded ? filterAutocompleteMatches : [])
                ];
            } else if (searchQuery.length === 0 && !hasFilters) {
                this.searchMatches = this.getEmptyStateMatches();
            } else if (searchQuery.length === 0 && hasFilters) {
                this.searchMatches = this.bookmarks
                    .filter((bookmark) => this.matchesAdvancedFilters(bookmark, filters))
                    .map((bookmark) => ({
                        shortcut: bookmark.shortcut || 'FILTER',
                        bookmark,
                        type: 'bookmark'
                    }));
            } else if (isShortcutMode) {
                // Handle bookmark shortcuts
                this.shortcuts.forEach((bookmark, shortcut) => {
                    if (shortcut.startsWith(searchQuery.toLowerCase()) && this.matchesAdvancedFilters(bookmark, filters)) {
                        this.searchMatches.push({ shortcut, bookmark, type: 'bookmark', query: searchQuery });
                    }
                });

                // Check if 'config' matches the current query
                if ('config'.startsWith(searchQuery.toLowerCase()) && this.matchesAdvancedFilters({ category: 'config' }, filters)) {
                    this.searchMatches.push({
                        shortcut: 'config',
                        bookmark: { name: this.language ? this.language.t('dashboard.configuration') : 'Configuration', url: '/config' },
                        type: 'config',
                        query: searchQuery
                    });
                }

                // Check if 'colors' matches the current query
                if ('colors'.startsWith(searchQuery.toLowerCase()) && this.matchesAdvancedFilters({ category: 'colors' }, filters)) {
                    this.searchMatches.push({
                        shortcut: 'colors',
                        bookmark: { name: this.language ? this.language.t('dashboard.colorCustomization') : 'Theme Customization', url: '/config#colors' },
                        type: 'colors',
                        query: searchQuery
                    });
                }

                // Sort matches by shortcut length (shorter first)
                this.searchMatches.sort((a, b) => a.shortcut.length - b.shortcut.length);

                // Add fuzzy suggestions if enabled
                if (this.settings.enableFuzzySuggestions) {
                    let fuzzyMatches = this.fuzzySearchComponent.handleFuzzy(searchQuery).filter((match) => this.matchesAdvancedFilters(match.bookmark, filters));
                    const includedUrls = new Set(this.searchMatches.map(m => m.bookmark.url));
                    let filteredFuzzy = fuzzyMatches.filter(m => !includedUrls.has(m.bookmark.url));
                    
                    // If start with option is enabled, filter further
                    if (this.settings.fuzzySuggestionsStartWith) {
                        filteredFuzzy = filteredFuzzy.filter(m => m.bookmark.name.toLowerCase().startsWith(searchQuery.toLowerCase()));
                    }
                    
                    this.searchMatches.push(...filteredFuzzy);
                }

                // Add finder matches for exact shortcut matches
                if (this.settings.includeFindersInSearch) {
                    const finder = this.findersComponent.shortcuts.get(searchQuery.toLowerCase());
                    if (finder) {
                        this.searchMatches.push({
                            name: finder.name,
                            shortcut: `?${finder.shortcut.toUpperCase()}`,
                            completion: `?${finder.shortcut.toUpperCase()} `,
                            meta: this.findersComponent.getFinderMeta(finder),
                            type: 'finder-completion'
                        });
                    }
                    this.searchMatches.push(...this.findersComponent.getFinderSuggestions(searchQuery, 4));
                }

                // Add finder matches if enabled
                if (this.settings.includeFindersInSearch && searchQuery.includes(' ')) {
                    const parts = searchQuery.split(' ');
                    const finderShortcut = parts[0].toLowerCase();
                    const finder = this.findersComponent.shortcuts.get(finderShortcut);
                    if (finder) {
                        const searchText = parts.slice(1).join(' ');
                        if (searchText === '') {
                            // If no search text, show as completion
                            this.searchMatches.push({
                                name: finder.name,
                                shortcut: `?${finder.shortcut.toUpperCase()}`,
                                completion: `?${finder.shortcut.toUpperCase()} `,
                                meta: this.findersComponent.getFinderMeta(finder),
                                type: 'finder-completion'
                            });
                        } else {
                            // If there is search text, show as ready to open
                            this.searchMatches.push({
                                name: finder.name,
                                shortcut: `?${finder.shortcut.toUpperCase()}`,
                                searchText: searchText,
                                url: finder.searchUrl.replace('%s', encodeURIComponent(searchText)),
                                meta: this.findersComponent.getFinderMeta(finder),
                                action: () => this.findersComponent.openFinder(finder, searchText),
                                type: 'finder'
                            });
                        }
                    }
                }
            } else {
                // Handle fuzzy search - only if query is not empty
                this.searchMatches = this.fuzzySearchComponent.handleFuzzy(searchQuery).filter((match) => this.matchesAdvancedFilters(match.bookmark, filters));
            }

            this.lastNonCommandQuery = query;
        }

        if (!this.currentQuery.startsWith(':') && !this.currentQuery.startsWith('?') && this.currentQuery.length > 0) {
            const raw = this.currentQuery.startsWith('/') ? this.currentQuery.slice(1) : this.currentQuery;
            const filterAutocompleteMatches = this.getFilterAutocompleteMatches(raw);
            if (filterAutocompleteMatches.length > 0) {
                const filtersIsExpanded = !this.emptyStateExpandedGroups.has('inline_filters');
                const filterHeader = {
                    type: 'command-group-header',
                    groupId: 'inline_filters',
                    label: this.dashboardLabel('filtersGroupLabel', 'Filters'),
                    count: filterAutocompleteMatches.length,
                    expanded: filtersIsExpanded,
                    _emptyStateGroup: 'inline_filters'
                };
                const seen = new Set();
                const dedupedFilters = filterAutocompleteMatches.filter((match) => {
                    const key = `${match.type}|${match.completion || match.shortcut || ''}|${match.name || ''}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                const filtersWithHeader = filtersIsExpanded
                    ? [filterHeader, ...dedupedFilters]
                    : [filterHeader];
                const bookmarkMatches = this.searchMatches.filter((match) => {
                    const key = `${match.type}|${match.completion || match.shortcut || ''}|${match.name || ''}`;
                    return !seen.has(key);
                });
                this.searchMatches = [...filtersWithHeader, ...bookmarkMatches];
            }
        }

        // Always show search interface, even with no matches
        this.showSearch();
        if (this.selectedMatchIndex === -1) {
            // Keep -1 to avoid auto-selection
        } else {
            this.selectedMatchIndex = 0;
        }
        this.renderSearchMatches();
        this._dispatchLauncherFilter();
    }

    _dispatchLauncherFilter() {
        const canonicalUrl = (raw) => {
            if (typeof BookmarkUrlUtils !== 'undefined' && typeof BookmarkUrlUtils.canonicalBookmarkURLKey === 'function') {
                return BookmarkUrlUtils.canonicalBookmarkURLKey(raw);
            }
            return String(raw || '').trim();
        };
        const urls = new Set(
            this.searchMatches
                .filter(m => m.type === 'bookmark' && m.bookmark && m.bookmark.url)
                .map(m => canonicalUrl(m.bookmark.url))
        );
        document.dispatchEvent(new CustomEvent('nextdash:launcher-filter', {
            detail: { active: this.currentQuery.length > 0, urls }
        }));
    }

    showSearch() {
        if (!this.searchActive) {
            this._searchOpenerElement = document.activeElement;
            this._lastPromoMode = undefined;
        }
        this.searchActive = true;
        const searchElement = document.getElementById('shortcut-search');
        const queryElement = document.getElementById('search-query');
        const mobileInput = document.getElementById('search-input-mobile');

        if (searchElement && queryElement) {
            this.updateModeIndicator();
            queryElement.textContent = this.currentQuery;
            // Auto-scroll to the right to keep the cursor position visible
            queryElement.scrollLeft = queryElement.scrollWidth;
            searchElement.classList.add('show');
            
            // Prevent body scroll only if not already prevented
            if (document.body.style.overflow !== 'hidden') {
                this.previousOverflow = document.body.style.overflow;
                document.body.style.overflow = 'hidden';
                
                // Prevent scroll events outside the search modal
                this.preventScrollHandler = (e) => {
                    const searchElement = document.getElementById('shortcut-search');
                    if (searchElement && !searchElement.contains(e.target)) {
                        e.preventDefault();
                    }
                };
                document.body.addEventListener('touchmove', this.preventScrollHandler, { passive: false });
                document.body.addEventListener('wheel', this.preventScrollHandler, { passive: false });
            }
            
            // Focus mobile input to show keyboard (mobile layout only)
            if (mobileInput && window.MobileExperience?.isMobileLayout?.()) {
                mobileInput.value = this.currentQuery;
                mobileInput.focus();
            }

            requestAnimationFrame(() => {
                window.DashboardSearchPromo?.onSearchOpened?.({ query: this.currentQuery });
            });
        }
    }

    closeSearch() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
        this.searchActive = false;
        this.emptyStateExpandedGroups.clear();
        document.dispatchEvent(new CustomEvent('nextdash:launcher-filter', { detail: { active: false, urls: new Set() } }));
        this.resetQuery();
        const searchElement = document.getElementById('shortcut-search');
        const mobileInput = document.getElementById('search-input-mobile');
        
        if (searchElement) {
            searchElement.classList.remove('show');
        }

        window.DashboardSearchPromo?.onSearchClosed?.();
        
        // Restore body scroll only if this component changed it
        if (this.previousOverflow !== null) {
            document.body.style.overflow = this.previousOverflow;
            this.previousOverflow = null;
        }
        
        // Remove scroll prevention
        if (this.preventScrollHandler) {
            document.body.removeEventListener('touchmove', this.preventScrollHandler);
            document.body.removeEventListener('wheel', this.preventScrollHandler);
            this.preventScrollHandler = null;
        }
        
        // Blur mobile input to hide keyboard
        if (mobileInput) {
            mobileInput.blur();
            mobileInput.value = '';
        }
        
        // Clear the displayed matches
        this.renderSearchMatches();

        const opener = this._searchOpenerElement;
        this._searchOpenerElement = null;
        const fallback = document.getElementById('search-button');
        if (window.FocusTrapUtils?.focusIfConnected) {
            window.FocusTrapUtils.focusIfConnected(opener, fallback);
        } else if (opener?.isConnected && typeof opener.focus === 'function') {
            opener.focus({ preventScroll: true });
        } else if (fallback?.focus) {
            fallback.focus({ preventScroll: true });
        }
    }

    updateSelectionHighlight() {
        const isDesktopSearch = this.searchActive
            && window.MobileExperience?.isMobileLayout?.() !== true;
        // Update keyboard-selected class on existing elements
        this.matchElements.forEach((element, index) => {
            element.querySelectorAll('.search-history-chip.keyboard-selected-chip').forEach((chip) => {
                chip.classList.remove('keyboard-selected-chip');
            });
            const selected = index === this.selectedMatchIndex;
            element.setAttribute('tabindex', selected ? '0' : '-1');
            if (selected) {
                element.classList.add('keyboard-selected');
                const match = this.selectableMatches[index];
                if (this.isChipMatch(match)) {
                    const chips = element.querySelectorAll('.search-history-chip');
                    const chip = chips[this.selectedChipIndex] || chips[0];
                    if (chip) {
                        chip.classList.add('keyboard-selected-chip');
                    }
                }
                // Scroll the selected element into view (only vertical scroll)
                element.scrollIntoView({
                    behavior: 'instant',
                    block: 'nearest'
                    // No 'inline' option to prevent horizontal scrolling
                });
                if (isDesktopSearch && typeof element.focus === 'function') {
                    element.focus({ preventScroll: true });
                }
            } else {
                element.classList.remove('keyboard-selected');
            }
        });

        // Force horizontal scroll position to 0 to prevent drift
        const matchesContainer = document.getElementById('search-matches');
        if (matchesContainer) {
            matchesContainer.scrollLeft = 0;
        }

        // Announce selected item to screen readers
        const announceEl = document.getElementById('search-result-announce');
        if (announceEl && this.matchElements.length > 0) {
            const match = this.selectableMatches[this.selectedMatchIndex];
            let label = match?.bookmark?.name || match?.name || '';
            if (this.isChipMatch(match)) {
                const queries = match.queries || [];
                label = queries[this.selectedChipIndex] || queries[0] || label;
            }
            const pos = `${this.selectedMatchIndex + 1} of ${this.matchElements.length}`;
            announceEl.textContent = label ? `${label}, ${pos}` : pos;
        }
    }

    resetQuery() {
        this.currentQuery = '';
        this.searchMatches = [];
        this.selectedMatchIndex = 0;
        this.selectedChipIndex = 0;
        this.matchElements = []; // Clear element references
        this.selectableMatches = [];
        this.justCompleted = false; // Reset flag
        this._lastPromoMode = undefined;
    }

    updateModeIndicator() {
        const prefix = document.querySelector('.search-prefix');
        if (!prefix) return;
        const q = this.currentQuery;
        let mode, label;
        if (q.startsWith(':')) {
            mode = 'command';
            label = this.language ? this.language.t('dashboard.searchModeCommand', 'CMD') : 'CMD';
        } else if (q.startsWith('?')) {
            mode = 'finder';
            label = this.language ? this.language.t('dashboard.searchModeFinder', 'FIND') : 'FIND';
        } else if (q.startsWith('@')) {
            mode = 'global';
            label = this.language ? this.language.t('dashboard.searchModeGlobal', 'ALL') : 'ALL';
        } else if (q.startsWith('/') && this.interleaveMode) {
            mode = 'fuzzy';
            label = this.language ? this.language.t('dashboard.searchModeFuzzy', 'FUZZY') : 'FUZZY';
        } else {
            mode = 'search';
            label = this.language ? this.language.t('dashboard.searchModeSearch', 'SEARCH') : 'SEARCH';
        }
        prefix.dataset.mode = mode;
        prefix.textContent = label;

        // Sync mode tab active state
        document.querySelectorAll('.search-mode-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.mode === mode);
        });

        const prevMode = this._lastPromoMode;
        this._lastPromoMode = mode;
        if (this.searchActive && prevMode !== undefined && prevMode !== mode) {
            window.DashboardSearchPromo?.onSearchModeChanged?.({ query: this.currentQuery, mode });
        }
    }

    renderSearchMatches() {
        const matchesContainer = document.getElementById('search-matches');
        if (!matchesContainer) return;

        this.updateModeIndicator();
        matchesContainer.innerHTML = '';
        this.matchElements = []; // Reset element references
        this.selectableMatches = [];

        if (this.searchMatches.length === 0) {
            // Show empty container when no matches (no message when opened from button)
            if (this.currentQuery.length > 0) {
                const t = (key, fallback) => this.language ? (this.language.t(key) || fallback) : fallback;
                const q = this.currentQuery.trim();

                // Header: no matches
                const noMatchElement = document.createElement('div');
                noMatchElement.className = 'search-match search-no-match-header';
                noMatchElement.innerHTML = `
                    <span class="search-match-name">
                        <span class="search-no-match-label">${t('dashboard.noMatchesFound', 'No matches found')}</span>
                        <span class="search-no-match-query">&ldquo;${this._escHtml(q.slice(0, 40))}&rdquo;</span>
                    </span>
                `;
                matchesContainer.appendChild(noMatchElement);

                // Hint: add as new bookmark via :new
                const newHint = document.createElement('div');
                newHint.className = 'search-match search-hint-entry';
                newHint.innerHTML = `
                    <span class="search-match-shortcut search-hint-shortcut">:new</span>
                    <span class="search-match-name search-hint-name">${t('dashboard.hintAddBookmark', 'Add as new bookmark')}</span>
                `;
                const hintNewAction = () => {
                    const handler = this.commandsComponent?.newCommandHandler;
                    if (handler) {
                        handler.openModal({ url: q });
                        this.closeSearch();
                        return;
                    }
                    this.currentQuery = `:new ${q}`;
                    this.updateSearch();
                    const input = document.getElementById('search-input-mobile');
                    if (input) {
                        input.value = this.currentQuery;
                        input.focus();
                    }
                };
                newHint.addEventListener('click', hintNewAction);
                matchesContainer.appendChild(newHint);
                this.matchElements.push(newHint);
                this.selectableMatches.push({ type: 'hint-new', action: hintNewAction });

                // Hint: search with top finders if any exist (up to 3, sorted by use count)
                if (Array.isArray(this.finders) && this.finders.length > 0) {
                    const topFinders = [...this.finders]
                        .filter((f) => f.shortcut && f.shortcut.trim())
                        .sort((a, b) => {
                            const byCount = Number(b.useCount || 0) - Number(a.useCount || 0);
                            return byCount !== 0 ? byCount : Number(b.lastUsed || 0) - Number(a.lastUsed || 0);
                        })
                        .slice(0, 3);
                    topFinders.forEach((finder) => {
                        const finderShortcut = finder.shortcut.toUpperCase();
                        const finderHint = document.createElement('div');
                        finderHint.className = 'search-match search-hint-entry';
                        finderHint.innerHTML = `
                            <span class="search-match-shortcut search-hint-shortcut">?${finderShortcut}</span>
                            <span class="search-match-name search-hint-name">${t('dashboard.hintSearchFinder', 'Search on')} ${this._escHtml(finder.name || finderShortcut)}</span>
                        `;
                        const hintFinderAction = () => {
                            this.recordSearchHistory(this.currentQuery);
                            this.findersComponent.openFinder(finder, q);
                            this.closeSearch();
                        };
                        finderHint.addEventListener('click', hintFinderAction);
                        matchesContainer.appendChild(finderHint);
                        this.matchElements.push(finderHint);
                        this.selectableMatches.push({ type: 'hint-finder', action: hintFinderAction });
                    });
                }
            } else {
                const noRecentElement = document.createElement('div');
                noRecentElement.className = 'search-match';
                noRecentElement.innerHTML = `
                    <span class="search-match-shortcut">↺</span>
                    <span class="search-match-name">${this.searchHistory.length > 0 ? (this.language ? this.language.t('dashboard.recentSearches') || 'Recent searches' : 'Recent searches') : (this.language ? this.language.t('dashboard.noRecentSearches') || 'No recent searches' : 'No recent searches')}</span>
                `;
                matchesContainer.appendChild(noRecentElement);
                this.matchElements.push(noRecentElement);
                this.selectableMatches.push({ type: 'no-recent' });
            }
            return;
        }

        // Use DocumentFragment for batch DOM operations (improves performance)
        const fragment = document.createDocumentFragment();
        
        this.searchMatches.forEach((match) => {
            if (match.type === 'command-group-header') {
                const mySelectableIndex = this.matchElements.length;
                const headerEl = document.createElement('div');
                const selectedClass = mySelectableIndex === this.selectedMatchIndex ? ' keyboard-selected' : '';
                headerEl.className = `search-command-group-header${selectedClass}`;
                headerEl.setAttribute('tabindex', mySelectableIndex === this.selectedMatchIndex ? '0' : '-1');
                headerEl.innerHTML = `
                    <span class="search-command-group-arrow">${match.expanded ? '▾' : '▸'}</span>
                    <span class="search-command-group-label">${this._escHtml(match.label)}</span>
                    <span class="search-command-group-count">${match.count}</span>
                `;
                headerEl.addEventListener('click', () => {
                    if (match._emptyStateGroup) {
                        this.toggleEmptyStateGroup(match._emptyStateGroup);
                    } else {
                        this.commandsComponent.toggleGroup(match.groupId);
                    }
                    this.updateSearch();
                });
                fragment.appendChild(headerEl);
                this.matchElements.push(headerEl);
                this.selectableMatches.push(match);
                return;
            }

            // Chip strip for history / recent command items
            if (match.type === 'history-chips' || match.type === 'command-chips') {
                const mySelectableIndex = this.matchElements.length;
                const chipRow = document.createElement('div');
                const selectedClass = mySelectableIndex === this.selectedMatchIndex ? ' keyboard-selected' : '';
                chipRow.className = `search-history-chip-row command-group-child${selectedClass}`;
                match.queries.forEach((q) => {
                    const wrap = document.createElement('div');
                    wrap.className = match.type === 'history-chips'
                        ? 'search-history-chip-wrap'
                        : 'search-history-chip-wrap search-command-chip-wrap';

                    const chip = document.createElement('button');
                    chip.type = 'button';
                    chip.className = match.type === 'command-chips'
                        ? 'search-history-chip search-command-chip'
                        : 'search-history-chip';
                    chip.textContent = q;
                    chip.addEventListener('click', () => {
                        const chipIdx = match.queries.indexOf(q);
                        if (chipIdx >= 0) {
                            this.selectedChipIndex = chipIdx;
                        }
                        this.applySelectedChipQuery(match);
                    });
                    wrap.appendChild(chip);

                    if (match.type === 'history-chips') {
                        const removeBtn = document.createElement('button');
                        removeBtn.type = 'button';
                        removeBtn.className = 'search-history-chip-remove';
                        removeBtn.setAttribute('aria-label', this.historyRemoveLabel());
                        removeBtn.textContent = '×';
                        removeBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.removeSearchHistoryEntry(q);
                            this.updateSearch();
                        });
                        wrap.appendChild(removeBtn);
                    }

                    chipRow.appendChild(wrap);
                });
                fragment.appendChild(chipRow);
                chipRow.setAttribute('tabindex', mySelectableIndex === this.selectedMatchIndex ? '0' : '-1');
                this.matchElements.push(chipRow);
                this.selectableMatches.push(match);
                return;
            }

            const mySelectableIndex = this.matchElements.length;
            const matchElement = document.createElement('div');
            const baseClass = `search-match ${mySelectableIndex === this.selectedMatchIndex ? 'keyboard-selected' : ''}`;
            const configClass = (match.type === 'config' || match.type === 'colors') ? ' config-entry' : '';
            const commandClass = (match.type === 'command' || match.type === 'command-completion') ? ' command-entry' : '';
            const finderClass = (match.type === 'finder' || match.type === 'finder-completion') ? ' finder-entry' : '';
            const fuzzyClass = (match.type === 'fuzzy' || match.type === 'global-search') ? ' fuzzy-entry' : '';
            const historyClass = match.type === 'history' ? ' history-entry' : '';
            const savedClass = match.type === 'saved-search' ? ' saved-search-entry' : '';
            const filterClass = match.type === 'filter-completion' ? ' filter-completion-entry' : '';
            const whatsNewClass = match.type === 'whats-new' ? ' whats-new-entry' : '';
            const groupChildClass = (match.groupId || match.type === 'filter-completion' || match.type === 'whats-new') ? ' command-group-child' : '';
            matchElement.className = baseClass + configClass + commandClass + finderClass + fuzzyClass + historyClass + savedClass + filterClass + whatsNewClass + groupChildClass;
            matchElement.setAttribute('tabindex', mySelectableIndex === this.selectedMatchIndex ? '0' : '-1');

            // Get the display name based on match type
            let displayName;
            if (match.type === 'fuzzy' || match.type === 'global-search') {
                displayName = this.fuzzySearchComponent.highlightFuzzyMatch(match.name, match.query);
            } else if (match.type === 'history' || match.type === 'saved-search') {
                displayName = this._escHtml(match.name);
            } else if (match.type === 'bookmark' || match.type === 'config' || match.type === 'colors') {
                displayName = this._highlightQuery(match.bookmark.name, match.query);
            } else {
                displayName = this._escHtml(match.name || '');
            }

            // For fuzzy/global search, don't show shortcut span to avoid empty space
            let shortcutHtml = '';
            if (match.type !== 'fuzzy' && match.type !== 'global-search') {
                const rawShortcut = match.type === 'whats-new' ? match.shortcut : match.shortcut.toUpperCase();
                const highlightedShortcut = match.query
                    ? this._highlightQuery(rawShortcut, match.query.toUpperCase())
                    : this._escHtml(rawShortcut);
                shortcutHtml = `<span class="search-match-shortcut">${highlightedShortcut}</span>`;
            }
            const bookmarkIconHtml = this.buildSearchBookmarkIconHtml(match);
            
            const finderUseBadge = (match.type === 'finder-completion' && match.useCount > 0)
                ? `<span class="search-match-use-count">${match.useCount}</span>`
                : '';

            const historyRemoveHtml = match.type === 'history'
                ? `<button type="button" class="search-history-remove" aria-label="${this._escHtml(this.historyRemoveLabel())}">×</button>`
                : '';

            const plainName = this._escHtml(match.bookmark?.name || match.name || '');
            matchElement.innerHTML = `
                ${shortcutHtml}
                ${bookmarkIconHtml}
                <span class="search-match-name"${plainName ? ` title="${plainName}"` : ''}>${displayName}${match.meta ? `<span class="search-match-meta">${this._escHtml(match.meta)}</span>` : ''}</span>
                ${finderUseBadge}
                ${historyRemoveHtml}
            `;

            if (match.type === 'history') {
                matchElement.querySelector('.search-history-remove')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.removeSearchHistoryEntry(match.completion || match.name);
                    this.updateSearch();
                });
            }

            matchElement.addEventListener('click', () => {
                if (match.type === 'config') {
                    this.openConfig();
                } else if (match.type === 'colors') {
                    this.openColors();
                } else if (match.type === 'command') {
                    this.invokeCommand(match);
                } else if (match.type === 'command-completion') {
                    this.currentQuery = match.completion;
                    this.updateSearch();
                    this.selectedMatchIndex = 0; // Auto-select first match after completion
                    this.updateSelectionHighlight(); // Update visual selection
                    this.justCompleted = true; // Prevent immediate execution
                } else if (match.type === 'finder') {
                    this.recordSearchHistory(this.currentQuery);
                    match.action();
                    this.closeSearch();
                } else if (match.type === 'finder-completion') {
                    this.currentQuery = match.completion;
                    this.updateSearch();
                    this.selectedMatchIndex = 0; // Auto-select first match after completion
                    this.updateSelectionHighlight(); // Update visual selection
                    this.justCompleted = true; // Prevent immediate execution
                } else if (match.type === 'fuzzy' || match.type === 'global-search') {
                    this.recordSearchHistory(this.currentQuery);
                    match.action();
                    this.closeSearch();
                } else if (match.type === 'history') {
                    this.currentQuery = match.completion;
                    this.updateSearch();
                    this.selectedMatchIndex = 0;
                    this.updateSelectionHighlight();
                } else if (match.type === 'saved-search') {
                    this.currentQuery = match.completion;
                    this.updateSearch();
                    this.selectedMatchIndex = 0;
                    this.updateSelectionHighlight();
                } else if (match.type === 'filter-completion') {
                    this.currentQuery = match.completion;
                    this.updateSearch();
                    this.selectedMatchIndex = 0;
                    this.updateSelectionHighlight();
                    this.justCompleted = true;
                } else if (match.type === 'whats-new') {
                    this.closeSearch();
                    window.openWhatsNewModal?.({ force: true });
                } else {
                    this.openBookmark(match.bookmark);
                }
            });
            
            fragment.appendChild(matchElement);
            this.matchElements.push(matchElement);
            this.selectableMatches.push(match);
        });
        
        // Batch append to DOM
        matchesContainer.appendChild(fragment);
        this.updateSelectionHighlight();
    }

    navigateMatches(direction) {
        const count = this.matchElements.length;
        if (count === 0) return;

        this.selectedMatchIndex += direction;

        if (this.selectedMatchIndex < 0) {
            this.selectedMatchIndex = count - 1;
        } else         if (this.selectedMatchIndex >= count) {
            this.selectedMatchIndex = 0;
        }

        const match = this.selectableMatches[this.selectedMatchIndex];
        if (!this.isChipMatch(match)) {
            this.selectedChipIndex = 0;
        } else {
            const len = match.queries?.length || 0;
            if (len > 0 && this.selectedChipIndex >= len) {
                this.selectedChipIndex = 0;
            }
        }

        this.updateSelectionHighlight();
    }

    selectCurrentMatch() {
        if (this.justCompleted) {
            this.justCompleted = false;
            return;
        }

        // Prevent accidental execution of confirmation options
        if (this.pendingConfirmation) {
            this.pendingConfirmation = false;
            return;
        }
        
        if (this.selectableMatches.length > 0 && this.selectedMatchIndex >= 0) {
            const selectedMatch = this.selectableMatches[this.selectedMatchIndex];
            if (selectedMatch.type === 'command-group-header') {
                if (selectedMatch._emptyStateGroup) {
                    this.toggleEmptyStateGroup(selectedMatch._emptyStateGroup);
                } else {
                    this.commandsComponent.toggleGroup(selectedMatch.groupId);
                }
                this.updateSearch();
                return;
            }
            if (this.isChipMatch(selectedMatch)) {
                this.applySelectedChipQuery(selectedMatch);
                return;
            }
            if (selectedMatch.type === 'config') {
                this.openConfig();
            } else if (selectedMatch.type === 'colors') {
                this.openColors();
            } else if (selectedMatch.type === 'command') {
                this.invokeCommand(selectedMatch);
            } else if (selectedMatch.type === 'command-completion') {
                this.currentQuery = selectedMatch.completion;
                this.updateSearch();
                this.selectedMatchIndex = 0; // Auto-select first match after completion
                this.updateSelectionHighlight(); // Update visual selection
                this.justCompleted = true; // Prevent immediate execution
            } else if (selectedMatch.type === 'finder') {
                this.recordSearchHistory(this.currentQuery);
                selectedMatch.action();
                this.closeSearch();
            } else if (selectedMatch.type === 'finder-completion') {
                this.currentQuery = selectedMatch.completion;
                this.updateSearch();
                this.selectedMatchIndex = 0; // Auto-select first match after completion
                this.updateSelectionHighlight(); // Update visual selection
                this.justCompleted = true; // Prevent immediate execution
            } else if (selectedMatch.type === 'fuzzy') {
                this.recordSearchHistory(this.currentQuery);
                selectedMatch.action();
                this.closeSearch();
            } else if (selectedMatch.type === 'history') {
                this.currentQuery = selectedMatch.completion;
                this.updateSearch();
                this.selectedMatchIndex = 0;
                this.updateSelectionHighlight();
            } else if (selectedMatch.type === 'saved-search') {
                this.currentQuery = selectedMatch.completion;
                this.updateSearch();
                this.selectedMatchIndex = 0;
                this.updateSelectionHighlight();
            } else if (selectedMatch.type === 'filter-completion') {
                this.currentQuery = selectedMatch.completion;
                this.updateSearch();
                this.selectedMatchIndex = 0;
                this.updateSelectionHighlight();
                this.justCompleted = true;
            } else if (selectedMatch.type === 'whats-new') {
                this.closeSearch();
                window.openWhatsNewModal?.({ force: true });
            } else if (selectedMatch.type === 'hint-new' || selectedMatch.type === 'hint-finder') {
                selectedMatch.action?.();
            } else {
                this.openBookmark(selectedMatch.bookmark);
            }
        }
        // If no matches, do nothing (keep search open)
    }

    openBookmark(bookmark) {
        this.recordSearchHistory(this.currentQuery);
        window.dashboardInstance?.markInlineTipUsed?.('bookmark_open');

        // Close search first if it's active
        if (this.searchActive) {
            this.closeSearch();
        }
        
        // Small delay to ensure search is closed before opening bookmark
        setTimeout(() => {
            // Check if HyprMode is enabled
            if (window.hyprMode && window.hyprMode.isEnabled()) {
                window.hyprMode.handleBookmarkClick(bookmark.url);
            } else {
                // Create a link element to open the URL with rel attributes to prevent Referer leakage
                const link = document.createElement('a');
                link.href = bookmark.url;
                link.style.display = 'none'; // Hide the link
                if (this.settings.openInNewTab) {
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                } else {
                    link.rel = 'noreferrer';
                }
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        }, 100);
    }

    openConfig() {
        this.recordSearchHistory(this.currentQuery);

        // Close search first if it's active
        if (this.searchActive) {
            this.closeSearch();
        }
        
        // Navigate to config page
        setTimeout(() => {
            window.location.href = '/config';
        }, 100);
    }

    openColors() {
        this.recordSearchHistory(this.currentQuery);

        // Close search first if it's active
        if (this.searchActive) {
            this.closeSearch();
        }
        
        // Navigate to colors page
        setTimeout(() => {
            window.location.href = '/config#colors';
        }, 100);
    }

    // Public methods for external usage
    isActive() {
        return this.searchActive;
    }

    getCurrentQuery() {
        return this.currentQuery;
    }

    getMatches() {
        return this.searchMatches;
    }

    // Open search interface directly (for button click)
    openSearchInterface() {
        window.dashboardInstance?.markInlineTipUsed?.('search_open');
        if (!this.searchActive) {
            this.currentQuery = '';
            this.searchMatches = [];
            this.selectedMatchIndex = 0;
            this.commandsComponent.resetState();
            this.updateSearch();
        }
    }

    /** Open search with a tag: filter (dashboard tag cloud, config tags tab, etc.). */
    openSearchWithTagFilter(tag) {
        const normalized = String(tag || '').trim().toLowerCase();
        if (!normalized) return;
        window.dashboardInstance?.markInlineTipUsed?.('search_open');
        this.commandsComponent.resetState();
        this.currentQuery = `tag:${normalized}`;
        this.selectedMatchIndex = 0;
        this.updateSearch();
        if (!this.searchActive) {
            this.showSearch();
        }
    }

    loadSearchHistory() {
        try {
            const stored = localStorage.getItem('dashboardSearchHistory');
            return stored ? JSON.parse(stored).filter((entry) => typeof entry === 'string' && entry.trim()).slice(0, 15) : [];
        } catch (error) {
            return [];
        }
    }

    saveSearchHistory() {
        localStorage.setItem('dashboardSearchHistory', JSON.stringify(this.searchHistory.slice(0, 15)));
    }

    removeSearchHistoryEntry(query) {
        const cleaned = (query || '').trim();
        if (!cleaned) return;
        this.searchHistory = this.searchHistory.filter((entry) => entry !== cleaned);
        this.saveSearchHistory();
    }

    historyRemoveLabel() {
        return this.language?.t('dashboard.removeSearchHistoryEntry') || 'Remove from search history';
    }

    recordSearchHistory(query) {
        const cleanedQuery = (query || '').trim();
        if (!cleanedQuery || cleanedQuery.startsWith(':') || cleanedQuery.startsWith('?') || cleanedQuery === '/') {
            return;
        }
        const normalized = cleanedQuery.toLowerCase();
        this.searchHistory = [cleanedQuery, ...this.searchHistory.filter((entry) => entry.toLowerCase() !== normalized)].slice(0, 15);
        this.saveSearchHistory();
    }

    loadRecentCommands() {
        try {
            const stored = localStorage.getItem('dashboardRecentCommands');
            return stored
                ? JSON.parse(stored).filter((entry) => typeof entry === 'string' && entry.startsWith(':') && entry !== ':').slice(0, 5)
                : [];
        } catch (error) {
            return [];
        }
    }

    saveRecentCommands() {
        localStorage.setItem('dashboardRecentCommands', JSON.stringify(this.recentCommands.slice(0, 5)));
    }

    recordRecentCommand(query) {
        const cleanedQuery = (query || '').trim();
        if (!cleanedQuery.startsWith(':') || cleanedQuery === ':') {
            return;
        }

        this.recentCommands = [cleanedQuery, ...this.recentCommands.filter((entry) => entry !== cleanedQuery)].slice(0, 5);
        this.saveRecentCommands();
    }

    invokeCommand(match) {
        const result = match.action();
        if (result !== false) {
            this.recordRecentCommand(this.currentQuery);
        }
        // Keep command palette open so multiple commands can be chained.
        // If command action redirects away, this block naturally becomes irrelevant.
        if (this.searchActive) {
            this.currentQuery = ':';
            this.commandsComponent.resetState();
            this.updateSearch();
            this.selectedMatchIndex = 0;
            this.pendingConfirmation = false;
            this.justCompleted = true;
            this.updateSelectionHighlight();
        }
    }

    toggleEmptyStateGroup(groupId) {
        if (this.emptyStateExpandedGroups.has(groupId)) {
            this.emptyStateExpandedGroups.delete(groupId);
        } else {
            this.emptyStateExpandedGroups.add(groupId);
        }
    }

    getEmptyStateMatches() {
        const t = (key, fallback, vars) => this.dashboardLabel(key, fallback, vars);
        const result = [];
        const historyMatches = this.getSearchHistoryMatches();
        const recentCommandMatches = this.getRecentCommandMatches();
        const savedMatches = this.getSavedSearchMatches();

        const filterItems = this.getFilterHintItems();

        const commandItems = [
            { shortcut: '↳', name: t('emptyStateCommandNew', 'Add via command'), completion: ':new ', type: 'command-completion' },
            { shortcut: '↳', name: t('emptyStateCommandTag', 'Browse by tag'), completion: ':tag ', type: 'command-completion' },
            { shortcut: '↳', name: t('emptyStateCommandNote', 'Edit note'), completion: ':note ', type: 'command-completion' },
        ];

        const finderItems = this.settings.includeFindersInSearch
            ? this.findersComponent.getTopFinders(this.finders.length || 10)
            : [];

        const whatsNewItems = typeof window.shouldShowWhatsNewInSearch === 'function' && window.shouldShowWhatsNewInSearch()
            ? [{
                type: 'whats-new',
                shortcut: '★',
                name: t('emptyStateWhatsNewItem', 'See latest release notes')
            }]
            : [];

        const groups = [
            { id: 'whats-new', label: t('emptyStateWhatsNewLabel', "What's new"), items: whatsNewItems, defaultOpen: true },
            { id: 'recent', label: t('emptyStateRecentLabel', 'Recent'), items: historyMatches, defaultOpen: true },
            { id: 'recent-commands', label: t('emptyStateRecentCommandsLabel', 'Recent commands'), items: recentCommandMatches, defaultOpen: false },
            { id: 'saved', label: t('emptyStateSavedLabel', 'Saved searches'), items: savedMatches, defaultOpen: false },
            { id: 'commands', label: t('emptyStateCommandsGroupLabel', 'Commands'), items: commandItems, defaultOpen: false },
            { id: 'filters', label: t('filtersGroupLabel', 'Filters'), items: filterItems, defaultOpen: false },
            { id: 'finders', label: t('emptyStateFindersLabel', 'Finders'), items: finderItems, defaultOpen: false }
        ];

        for (const group of groups) {
            if (group.items.length === 0) continue;
            const defaultOpen = group.defaultOpen;
            const toggled = this.emptyStateExpandedGroups.has(group.id);
            const isExpanded = toggled ? !defaultOpen : defaultOpen;

            const displayCount = group.items.reduce((n, item) =>
                n + (item._chipCount != null ? item._chipCount : 1), 0);
            result.push({
                type: 'command-group-header',
                groupId: `empty_${group.id}`,
                label: group.label,
                count: displayCount,
                expanded: isExpanded,
                _emptyStateGroup: group.id
            });

            if (isExpanded) {
                result.push(...group.items);
            }
        }

        return result;
    }

    getSearchHistoryMatches() {
        const recent = this.searchHistory.slice(0, 5);
        if (recent.length === 0) return [];
        return [{
            type: 'history-chips',
            queries: recent,
            _chipCount: recent.length
        }];
    }

    getRecentCommandMatches() {
        const recent = this.recentCommands.slice(0, 5);
        if (recent.length === 0) return [];
        return [{
            type: 'command-chips',
            queries: recent,
            _chipCount: recent.length
        }];
    }

    loadSavedSearches() {
        try {
            const stored = localStorage.getItem('dashboardSavedSearches');
            return stored ? JSON.parse(stored).filter((entry) => entry && entry.name && entry.query) : [];
        } catch (error) {
            return [];
        }
    }

    saveSavedSearches() {
        localStorage.setItem('dashboardSavedSearches', JSON.stringify(this.savedSearches.slice(0, 10)));
    }

    saveCurrentSearch(name = null) {
        const query = (this.lastNonCommandQuery || this.currentQuery || '').trim();
        if (!query) {
            return false;
        }

        const label = (name || query).trim();
        this.savedSearches = [
            { name: label, query },
            ...this.savedSearches.filter((entry) => entry.query !== query && entry.name !== label)
        ].slice(0, 10);
        this.saveSavedSearches();
        return true;
    }

    getSavedSearchMatches() {
        return this.savedSearches.map((savedSearch) => ({
            name: savedSearch.name,
            shortcut: '★',
            completion: savedSearch.query,
            type: 'saved-search',
            query: savedSearch.query
        }));
    }
}

// Export for use in other modules
window.SearchComponent = SearchComponent;