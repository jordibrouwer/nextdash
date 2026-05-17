// Search Component JavaScript
class SearchComponent {
    constructor(bookmarksForSearch, currentBookmarks, allBookmarks, settings = {}, language = null, finders = []) {
        this.bookmarks = bookmarksForSearch;
        this.currentBookmarks = currentBookmarks;
        this.allBookmarks = allBookmarks;
        this.settings = settings;
        this.language = language;
        this.finders = finders;
        this.currentPageId = settings.currentPage || 1;
        this.shortcuts = new Map();
        this.currentQuery = '';
        this.searchActive = false;
        this.searchMatches = [];
        this.selectedMatchIndex = 0;
        this.matchElements = []; // Store references to DOM elements for selection highlighting
        this.selectableMatches = []; // Parallel array of match data for keyboard-selectable items
        this.justCompleted = false; // Flag to prevent accidental execution after completion
        this.emptyStateExpandedGroups = new Set(); // Tracks expanded groups in empty search state
        this.pendingConfirmation = false; // Flag to prevent accidental confirmation execution
        this.resetLegacySearchPresetsOnce();
        this.searchHistory = this.loadSearchHistory();
        this.savedSearches = this.loadSavedSearches();
        this.lastNonCommandQuery = '';
        
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

    updateData(bookmarksForSearch, currentBookmarks, allBookmarks, settings, language = null, finders = []) {
        this.bookmarks = bookmarksForSearch;
        this.currentBookmarks = currentBookmarks;
        this.allBookmarks = allBookmarks;
        this.settings = settings;
        this.language = language || this.language;
        this.finders = finders;
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

    buildShortcutsMap() {
        // Clear existing shortcuts
        this.shortcuts.clear();
        this.currentQuery = '';
        this.searchActive = false;
        this.searchMatches = [];

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
                const value = e.target.value.toUpperCase();
                if (value.length > this.currentQuery.length) {
                    // Character added
                    const newChar = value[value.length - 1];
                    if (/^[A-Z0-9: \?/#]$/.test(newChar)) {
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
                    this.closeSearch();
                }
            });
        }

        // Add keyboard event listener
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') {
                const matches = this.commandsComponent.handleCommand(':new');
                const action = Array.isArray(matches) && matches[0] && typeof matches[0].action === 'function'
                    ? matches[0].action
                    : null;
                if (action) {
                    e.preventDefault();
                    action();
                    return;
                }
            }

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

        // Close search on escape
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Escape') {
                this.closeSearch();
            }
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
        if (!iconName) {
            return '';
        }
        const entry = this.getThemeIconStylingEntry();
        const themedClass = entry.enabled ? ` icon-themed icon-themed--${entry.style || 'muted'}` : '';
        const intensityStyle = entry.enabled ? ` style="--icon-theme-intensity:${entry.intensity || 0.5};"` : '';
        return `<span class="search-match-favicon-slot${themedClass}"${intensityStyle}><img class="bookmark-icon" src="/data/icons/${iconName}" alt="" loading="lazy"></span>`;
    }

    handleKeyPress(e) {
        const key = e.key.toUpperCase();
        
        // Handle special keys
        if (key === 'ESCAPE') {
            this.closeSearch();
            return;
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

        // Handle / key to start fuzzy search
        if (key === '/') {
            e.preventDefault();
            this.addToQuery('/');
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

        // + opens the quick-add omnibox (never feeds into search)
        if (e.key === '+') {
            e.preventDefault();
            window.dashboardInstance?.showOmnibox?.();
            return;
        }

        // Handle space key for commands
        if (key === ' ' && this.currentQuery.startsWith(':')) {
            e.preventDefault();
            this.addToQuery(' ');
            return;
        }

        // Handle space key for finders
        if (key === ' ' && this.currentQuery.startsWith('?')) {
            e.preventDefault();
            this.addToQuery(' ');
            return;
        }

        // Only handle letter keys (A-Z) and numbers (0-9) when search is active, otherwise only letters and :
        if (this.searchActive) {
            if (!/^[A-Z0-9\-]$/.test(key)) {
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
        this.updateSearch();
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

    getFilterAutocompleteMatches(rawQuery) {
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
                toCompletion('category:', 'Filter by category (example: category:work)'),
                toCompletion('status:', 'Filter by status (online/offline/checked/unchecked/pinned/unpinned/broken/ok)'),
                toCompletion('page:', 'Filter by page (current/all/number)'),
                toCompletion('tag:', 'Filter by tag (example: tag:work)')
            ];
        }

        if (currentToken.startsWith('category:')) {
            const value = currentToken.slice('category:'.length);
            return categories
                .filter((category) => category.startsWith(value))
                .slice(0, 8)
                .map((category) => toCompletion(`category:${category}`, `Category: ${category}`));
        }

        if (currentToken.startsWith('status:')) {
            const value = currentToken.slice('status:'.length);
            const statusEntries = [
                ['online',    'Reachable bookmarks'],
                ['offline',   'Unreachable bookmarks'],
                ['broken',    'Broken / error response'],
                ['ok',        'Online and not broken'],
                ['pinned',    'Pinned bookmarks'],
                ['unpinned',  'Not pinned'],
                ['checked',   'Status check enabled'],
                ['unchecked', 'Status check disabled'],
            ];
            return statusEntries
                .filter(([status]) => status.startsWith(value))
                .map(([status, desc]) => toCompletion(`status:${status}`, `status:${status} — ${desc}`));
        }

        if (currentToken.startsWith('page:')) {
            const value = currentToken.slice('page:'.length);
            const pageValues = ['current', 'all', ...pageIds.map((id) => String(id))];
            return pageValues
                .filter((pageValue) => pageValue.startsWith(value))
                .slice(0, 10)
                .map((pageValue) => toCompletion(`page:${pageValue}`, `Page: ${pageValue}`));
        }

        if (currentToken.startsWith('tag:')) {
            const value = currentToken.slice('tag:'.length);
            return allTags
                .filter((tag) => tag.startsWith(value))
                .slice(0, 8)
                .map((tag) => toCompletion(`tag:${tag}`, `Tag: ${tag}`));
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
            const cachedStatus = statusCache instanceof Map
                ? statusCache.get(String(bookmark.url || ''))?.status
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
                this.updateSearch();
            }
        }
    }

    updateSearch() {
        // Find matching shortcuts
        this.searchMatches = [];

        if (this.currentQuery.startsWith(':')) {
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
            if (searchQuery.length === 0 && !hasFilters && filterAutocompleteMatches.length > 0) {
                // Query is a bare filter token being typed (e.g. "status:", "status:on") —
                // show its completions instead of the empty state.
                this.searchMatches = filterAutocompleteMatches;
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
                        bookmark: { name: this.language ? this.language.t('dashboard.colorCustomization') : 'Theme Customization', url: '/colors' },
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
                const seen = new Set();
                this.searchMatches = [...filterAutocompleteMatches, ...this.searchMatches].filter((match) => {
                    const key = `${match.type}|${match.completion || match.shortcut || ''}|${match.name || ''}`;
                    if (seen.has(key)) {
                        return false;
                    }
                    seen.add(key);
                    return true;
                });
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
    }

    showSearch() {
        this.searchActive = true;
        const searchElement = document.getElementById('shortcut-search');
        const queryElement = document.getElementById('search-query');
        const mobileInput = document.getElementById('search-input-mobile');
        
        if (searchElement && queryElement) {
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
            
            // Focus mobile input to show keyboard
            if (mobileInput) {
                mobileInput.value = this.currentQuery;
                mobileInput.focus();
            }
        }
    }

    closeSearch() {
        this.searchActive = false;
        this.emptyStateExpandedGroups.clear();
        this.resetQuery();
        const searchElement = document.getElementById('shortcut-search');
        const mobileInput = document.getElementById('search-input-mobile');
        
        if (searchElement) {
            searchElement.classList.remove('show');
        }
        
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
    }

    updateSelectionHighlight() {
        // Update keyboard-selected class on existing elements
        this.matchElements.forEach((element, index) => {
            if (index === this.selectedMatchIndex) {
                element.classList.add('keyboard-selected');
                // Scroll the selected element into view (only vertical scroll)
                element.scrollIntoView({
                    behavior: 'instant',
                    block: 'nearest'
                    // No 'inline' option to prevent horizontal scrolling
                });
            } else {
                element.classList.remove('keyboard-selected');
            }
        });
        
        // Force horizontal scroll position to 0 to prevent drift
        const matchesContainer = document.getElementById('search-matches');
        if (matchesContainer) {
            matchesContainer.scrollLeft = 0;
        }
    }

    resetQuery() {
        this.currentQuery = '';
        this.searchMatches = [];
        this.selectedMatchIndex = 0;
        this.matchElements = []; // Clear element references
        this.selectableMatches = [];
        this.justCompleted = false; // Reset flag
    }

    renderSearchMatches() {
        const matchesContainer = document.getElementById('search-matches');
        if (!matchesContainer) return;

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
                    <span class="search-match-shortcut">—</span>
                    <span class="search-match-name">${t('dashboard.noMatchesFound', 'No matches found')}</span>
                `;
                matchesContainer.appendChild(noMatchElement);

                // Hint: add as new bookmark via :new
                const newHint = document.createElement('div');
                newHint.className = 'search-match search-hint-entry';
                newHint.innerHTML = `
                    <span class="search-match-shortcut search-hint-shortcut">:new</span>
                    <span class="search-match-name search-hint-name">${t('dashboard.hintAddBookmark', 'Add as new bookmark')}</span>
                `;
                newHint.addEventListener('click', () => {
                    this.currentQuery = `:new ${q}`;
                    this.handleSearch(this.currentQuery);
                    const input = document.getElementById('shortcut-search-input');
                    if (input) { input.value = this.currentQuery; input.focus(); }
                });
                matchesContainer.appendChild(newHint);
                this.matchElements.push(newHint);
                this.selectableMatches.push({ type: 'hint-new' });

                // Hint: search with a finder if any exist
                if (Array.isArray(this.finders) && this.finders.length > 0) {
                    const firstFinder = this.finders[0];
                    const finderShortcut = firstFinder.shortcut ? firstFinder.shortcut.toUpperCase() : '?';
                    const finderHint = document.createElement('div');
                    finderHint.className = 'search-match search-hint-entry';
                    finderHint.innerHTML = `
                        <span class="search-match-shortcut search-hint-shortcut">?${finderShortcut}</span>
                        <span class="search-match-name search-hint-name">${t('dashboard.hintSearchFinder', 'Search on')} ${firstFinder.name || finderShortcut}</span>
                    `;
                    finderHint.addEventListener('click', () => {
                        this.currentQuery = `?${finderShortcut} ${q}`;
                        this.handleSearch(this.currentQuery);
                        const input = document.getElementById('shortcut-search-input');
                        if (input) { input.value = this.currentQuery; input.focus(); }
                    });
                    matchesContainer.appendChild(finderHint);
                    this.matchElements.push(finderHint);
                    this.selectableMatches.push({ type: 'hint-finder' });
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
                headerEl.innerHTML = `
                    <span class="search-command-group-arrow">${match.expanded ? '▾' : '▸'}</span>
                    <span class="search-command-group-label">${match.label}</span>
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

            const mySelectableIndex = this.matchElements.length;
            const matchElement = document.createElement('div');
            const baseClass = `search-match ${mySelectableIndex === this.selectedMatchIndex ? 'keyboard-selected' : ''}`;
            const configClass = (match.type === 'config' || match.type === 'colors') ? ' config-entry' : '';
            const commandClass = (match.type === 'command' || match.type === 'command-completion') ? ' command-entry' : '';
            const finderClass = (match.type === 'finder' || match.type === 'finder-completion') ? ' finder-entry' : '';
            const fuzzyClass = match.type === 'fuzzy' ? ' fuzzy-entry' : '';
            const historyClass = match.type === 'history' ? ' history-entry' : '';
            const savedClass = match.type === 'saved-search' ? ' saved-search-entry' : '';
            const filterClass = match.type === 'filter-completion' ? ' filter-completion-entry' : '';
            const groupChildClass = match.groupId ? ' command-group-child' : '';
            matchElement.className = baseClass + configClass + commandClass + finderClass + fuzzyClass + historyClass + savedClass + filterClass + groupChildClass;
            
            // Get the display name based on match type
            let displayName;
            if (match.type === 'fuzzy') {
                displayName = this.fuzzySearchComponent.highlightFuzzyMatch(match.name, match.query);
            } else if (match.type === 'history' || match.type === 'saved-search') {
                displayName = this._escHtml(match.name);
            } else if (match.type === 'bookmark' || match.type === 'config' || match.type === 'colors') {
                displayName = this._highlightQuery(match.bookmark.name, match.query);
            } else {
                displayName = this._escHtml(match.name || '');
            }

            // For fuzzy search, don't show shortcut span to avoid empty space
            let shortcutHtml = '';
            if (match.type !== 'fuzzy') {
                const rawShortcut = match.shortcut.toUpperCase();
                const highlightedShortcut = match.query
                    ? this._highlightQuery(rawShortcut, match.query.toUpperCase())
                    : this._escHtml(rawShortcut);
                shortcutHtml = `<span class="search-match-shortcut">${highlightedShortcut}</span>`;
            }
            const bookmarkIconHtml = this.buildSearchBookmarkIconHtml(match);
            
            const finderUseBadge = (match.type === 'finder-completion' && match.useCount > 0)
                ? `<span class="search-match-use-count">${match.useCount}</span>`
                : '';

            const deleteHistoryHtml = match.type === 'history'
                ? `<button class="search-history-delete" title="Remove from history" tabindex="-1">×</button>`
                : '';

            matchElement.innerHTML = `
                ${shortcutHtml}
                ${bookmarkIconHtml}
                <span class="search-match-name">${displayName}${match.meta ? `<span class="search-match-meta">${match.meta}</span>` : ''}</span>
                ${finderUseBadge}
                ${deleteHistoryHtml}
            `;
            
            if (match.type === 'history') {
                const deleteBtn = matchElement.querySelector('.search-history-delete');
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.deleteHistoryEntry(match.completion);
                    });
                }
            }

            matchElement.addEventListener('click', () => {
                if (match.type === 'config') {
                    this.openConfig();
                } else if (match.type === 'colors') {
                    this.openColors();
                } else if (match.type === 'command') {
                    match.action();
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
                } else if (match.type === 'fuzzy') {
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
    }

    navigateMatches(direction) {
        const count = this.matchElements.length;
        if (count === 0) return;

        this.selectedMatchIndex += direction;

        if (this.selectedMatchIndex < 0) {
            this.selectedMatchIndex = count - 1;
        } else if (this.selectedMatchIndex >= count) {
            this.selectedMatchIndex = 0;
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
            if (selectedMatch.type === 'config') {
                this.openConfig();
            } else if (selectedMatch.type === 'colors') {
                this.openColors();
            } else if (selectedMatch.type === 'command') {
                selectedMatch.action();
                // Keep command palette open so user can run another command immediately.
                if (this.searchActive) {
                    this.currentQuery = ':';
                    this.commandsComponent.resetState();
                    this.updateSearch();
                    this.selectedMatchIndex = 0;
                    this.pendingConfirmation = false;
                    this.justCompleted = true;
                    this.updateSelectionHighlight();
                }
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
            window.location.href = '/colors';
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

    recordSearchHistory(query) {
        const cleanedQuery = (query || '').trim();
        if (!cleanedQuery || cleanedQuery.startsWith(':') || cleanedQuery === '?' || cleanedQuery === '/') {
            return;
        }

        this.searchHistory = [cleanedQuery, ...this.searchHistory.filter((entry) => entry !== cleanedQuery)].slice(0, 15);
        this.saveSearchHistory();
    }

    toggleEmptyStateGroup(groupId) {
        if (this.emptyStateExpandedGroups.has(groupId)) {
            this.emptyStateExpandedGroups.delete(groupId);
        } else {
            this.emptyStateExpandedGroups.add(groupId);
        }
    }

    getEmptyStateMatches() {
        const result = [];
        const historyMatches = this.getSearchHistoryMatches();
        const savedMatches = this.getSavedSearchMatches();
        const recentItems = [...historyMatches, ...savedMatches];

        const filterItems = [
            { shortcut: '↳', name: 'Filter by category (example: category:work)', completion: 'category: ', type: 'filter-completion' },
            { shortcut: '↳', name: 'Filter by status (online/offline/pinned/broken…)', completion: 'status: ', type: 'filter-completion' },
            { shortcut: '↳', name: 'Filter by page (current/all/number)', completion: 'page: ', type: 'filter-completion' },
            { shortcut: '↳', name: 'Filter by tag (example: tag:work)', completion: 'tag: ', type: 'filter-completion' }
        ];

        const finderItems = this.settings.includeFindersInSearch
            ? this.findersComponent.getTopFinders(this.finders.length || 10)
            : [];

        const groups = [
            { id: 'recent', label: 'Recent', items: recentItems },
            { id: 'filters', label: 'Filters', items: filterItems },
            { id: 'finders', label: 'Finders', items: finderItems }
        ];

        for (const group of groups) {
            if (group.id === 'finders' && group.items.length === 0) continue;
            // Recent is open by default when it has items, others start closed
            const defaultOpen = group.id === 'recent' && group.items.length > 0;
            const toggled = this.emptyStateExpandedGroups.has(group.id);
            const isExpanded = toggled ? !defaultOpen : defaultOpen;

            result.push({
                type: 'command-group-header',
                groupId: `empty_${group.id}`,
                label: group.label,
                count: group.items.length,
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
        return this.searchHistory.map((query) => ({
            name: query,
            shortcut: '↺',
            completion: query,
            type: 'history'
        }));
    }

    deleteHistoryEntry(query) {
        this.searchHistory = this.searchHistory.filter((entry) => entry !== query);
        this.saveSearchHistory();
        this.updateSearch();
    }

    clearSearchHistory() {
        this.searchHistory = [];
        this.saveSearchHistory();
        this.updateSearch();
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