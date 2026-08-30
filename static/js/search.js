// Search Component JavaScript
class SearchComponent {
    /**
     * The three reasons a fuzzy result can be on screen, strongest first.
     * `key` matches the label fuzzy-search.js puts on every result.
     */
    static FUZZY_GROUPS = [
        { id: 'search_strong', key: 'strong', labelKey: 'searchGroupStrong',
          fallback: 'Best matches', defaultExpanded: true },
        { id: 'search_contains', key: 'contains', labelKey: 'searchGroupContains',
          fallback: 'Contains “{query}”', defaultExpanded: false },
        { id: 'search_elsewhere', key: 'elsewhere', labelKey: 'searchGroupElsewhere',
          fallback: 'In tags, note or url', defaultExpanded: false },
    ];

    /** Rows an open group shows before it defers to a "N more" row. */
    static FUZZY_GROUP_CAP = 12;

    /** How many query-to-pick memories are kept before the weakest are dropped. */
    static MAX_SEARCH_PICKS = 200;

    /**
     * Match a timestamp against an age word used by `opened:` and `added:`.
     *
     * `never` is only meaningful for opened — a bookmark always has a created
     * date — but it costs nothing to accept for both and reads the same way.
     */
    static matchesAgeFilter(timestamp, word) {
        const ts = Number(timestamp || 0);
        const key = String(word || '').toLowerCase();
        if (key === 'never') return ts === 0;
        const windows = {
            today: 86400000,
            week: 7 * 86400000,
            month: 30 * 86400000,
            year: 365 * 86400000,
        };
        const span = windows[key];
        if (!span) return true;      // an unknown word filters nothing
        if (ts === 0) return false;
        return (Date.now() - ts) <= span;
    }

    static STATUS_FILTER_VALUES = new Set([
        'online', 'offline', 'broken', 'ok', 'pinned', 'unpinned', 'checked', 'unchecked',
        // untagged is a first-class collection rule, a stats row and a config
        // filter, and was the one tidy-up question the search bar could not ask.
        // noted is its twin: a note is the thing you left to explain the link.
        'untagged', 'tagged', 'noted', 'unnoted',
        // feed answers "which of these can ever tell me something is new". A row
        // with a feed and nothing new looks exactly like a row with no feed, so
        // without this the only way to find out was to read the count on the
        // Fresh tab and guess which bookmarks it meant.
        'feed', 'unfed',
    ]);

    /**
     * Every filter key the parser understands, in one place.
     *
     * The autocomplete used to carry its own hardcoded list of four, so
     * `opened:` and `added:` worked when typed in full but were invisible to the
     * hint panel and to the incomplete/complete-query checks — the latter
     * meaning `opened:week` never counted as a finished filter and autocomplete
     * kept firing over real results.
     */
    static FILTER_KEYS = ['category', 'status', 'page', 'tag', 'opened', 'added'];

    /** Age words shared by `opened:` and `added:` — see matchesAgeFilter. */
    static AGE_FILTER_VALUES = new Set(['today', 'week', 'month', 'year']);

    static TOP_TAG_FILTER_SUGGESTIONS = 20;

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
        this.emptyStateExpandedGroups = new Set(); // Tracks expanded groups in empty search state
        this.searchGroupsShowAll = new Set();      // Fuzzy groups the user opened past their cap
        this.searchPicks = this.loadSearchPicks(); // Which result these keystrokes meant before
        this.resetLegacySearchPresetsOnce();
        this.searchHistory = this.loadSearchHistory();
        this.recentCommands = this.loadRecentCommands();
        this.savedSearches = this.loadSavedSearches();
        this.lastNonCommandQuery = '';
        this._debounceTimer = null;
        this._openBookmarkTimer = null;
        /** Armed only in "delay" shortcut mode; see _maybeAutoOpenShortcut. */
        this._shortcutOpenTimer = null;

        this.commandsComponent = new window.SearchCommandsComponent(this.language, this.currentBookmarks, this.allBookmarks, (newQuery) => {
            this.currentQuery = newQuery;
            this.updateSearch();
        });
        this.commandsComponent.getRecentCommands = () => this.recentCommands;

        this.findersComponent = new window.SearchFindersComponent(this.language, [], this.settings);

        this.fuzzySearchComponent = new window.FuzzySearchComponent(this.bookmarks, (bookmark) => this.openBookmark(bookmark));
        this.fuzzySearchComponent.updatePicks(this.searchPicks);

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
        this.scrollLockToken = null;
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
        this.searchPicks = this.loadSearchPicks();
        this.fuzzySearchComponent.updatePicks(this.searchPicks);
        this.buildShortcutsMap();
    }

    _getPageName(pageId) {
        if (!pageId || !Array.isArray(this.pages)) return null;
        const page = this.pages.find(p => p.id === pageId);
        return page ? page.name : null;
    }

    buildShortcutsMap() {
        this.shortcuts.clear();

        if (!Array.isArray(this.bookmarks)) {
            this.bookmarks = [];
        }
        this.bookmarks.forEach(bookmark => {
            if (bookmark.shortcut && bookmark.shortcut.trim()) {
                this.shortcuts.set(bookmark.shortcut.toLowerCase(), bookmark);
            }
        });

        if (this.searchActive) {
            this.renderSearchMatches();
        }
    }

    setupEventListeners() {
        // Setup mobile input listener
        const mobileInput = document.getElementById('search-input-mobile');
        if (mobileInput) {
            mobileInput.addEventListener('input', (e) => {
                const raw = e.target.value;
                const inCommandMode = this.currentQuery.startsWith(':');
                const inFinderMode = this.currentQuery.startsWith('?');
                const inGlobalMode = this.currentQuery.startsWith('@');
                const value = inCommandMode
                    ? raw
                    : (inFinderMode || inGlobalMode ? raw.toUpperCase() : raw);
                if (value.length > this.currentQuery.length) {
                    // Character added
                    const newChar = value[value.length - 1];
                    const allowed = inCommandMode || (!inFinderMode && !inGlobalMode)
                        ? /^[\x20-\x7E]$/.test(newChar)
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
            if (this._isInboxSearchContext(e)) {
                return;
            }

            // Don't trigger shortcuts if user is typing in an input, except when search is active and it's a navigation key
            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
                if (!this.searchActive || !['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
                    return;
                }
            }

            // Don't start shortcut search with shift-modified letters (Shift+M/D/T, etc.)
            if (!this.searchActive && e.shiftKey && e.key.length === 1 && /[a-z]/i.test(e.key)) {
                return;
            }

            // Physical key codes — belt-and-suspenders for the shift-modified
            // action shortcuts, on a layout where Shift+letter produces
            // something the check above does not recognise as a letter. Every
            // Shift+letter belongs to an action, so this asks about the family
            // rather than naming its members: the list it replaced still held
            // the four keys that existed when it was written and had silently
            // fallen behind the ones added since.
            if (
                !this.searchActive
                && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey
                && /^Key[A-Z]$/.test(e.code || '')
            ) {
                return;
            }

            // Don't trigger shortcuts if any modifier key is pressed
            // This allows browser shortcuts like Ctrl+W, Ctrl+R, Ctrl+Q, etc.
            //
            // Ctrl/Cmd+Enter is the exception: the grid has always honoured it to
            // force a new tab whatever the open-in-new-tab setting says, and the
            // overlay — where most opens actually happen — swallowed it here, so
            // the chord never reached handleKeyPress at all.
            const forceNewTab = (e.ctrlKey || e.metaKey) && !e.altKey && e.key === 'Enter'
                && (this.searchActive || this.currentQuery.length > 0);
            if (!forceNewTab && (e.ctrlKey || e.altKey || e.metaKey)) {
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
                this._openInMode('?');
            });
        }

        // Add commands button event listener
        const commandsButton = document.getElementById('commands-button');
        if (commandsButton) {
            commandsButton.addEventListener('click', () => {
                this._openInMode(':');
            });
        }

        // Mode tab click handlers
        // Escape does it too, but a line you typed into needs a way out you can
        // point at — on touch there is no Escape at all.
        document.getElementById('search-clear')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeSearch();
        });

        document.querySelectorAll('.search-mode-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                const mode = tab.dataset.mode;
                if (mode === 'command') {
                    this.currentQuery = ':';
                    this.commandsComponent.resetState();
                } else if (mode === 'finder') {
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

    /**
     * Open the overlay directly in commands (`:`) or finders (`?`) mode.
     *
     * The prefix is set before the first updateSearch() so the open is tracked as
     * that mode — going through openSearchInterface() first would briefly run with
     * an empty query and report a plain search open as well.
     */
    _openInMode(prefix) {
        if (!this.searchActive) {
            this.searchMatches = [];
            this.selectedMatchIndex = 0;
        }
        this.commandsComponent.resetState();
        this.currentQuery = prefix;
        this.updateSearch();
        this.renderSearchMatches();
    }

    /**
     * Fire exactly one usage event for the overlay that opened: modal:search,
     * modal:commands, or modal:finders. The three are mutually exclusive, so each
     * counter reads directly without having to subtract the others.
     *
     * Every entry point — the `>`/`:`/`?` keys, the toolbar buttons, and the mode
     * tabs — funnels through updateSearch(), so tracking the mode *transition* here
     * covers them all once. Without the transition check each keystroke inside a
     * mode would fire another event; switching mode mid-session (`:` → `?`) counts
     * as a new open, and closeSearch() resets so reopening counts again.
     */
    _trackModeOpen() {
        const mode = this.currentQuery.startsWith(':')
            ? 'commands'
            : this.currentQuery.startsWith('?')
                ? 'finders'
                : 'search';
        if (mode === this._lastTrackedMode) return;
        this._lastTrackedMode = mode;
        window.nextdashTrack?.(`modal:${mode}`);
    }

    getThemeIconStylingEntry() {
        if (window.ThemeIconStyling) {
            return window.ThemeIconStyling.getThemeIconStylingEntry(this.settings);
        }
        const currentTheme = document.documentElement.getAttribute('data-theme') || this.settings.theme || 'default';
        const map = this.settings?.themeIconStyling || {};
        const entry = map[currentTheme] || {};
        // Absent means on -- see normalizeEntry in theme-icon-styling.js.
        return {
            enabled: entry.enabled !== false,
            style: entry.style || 'muted',
            intensity: Number.isFinite(Number(entry.intensity)) ? Number(entry.intensity) : 0.5,
        };
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
        if (this.settings?.showIcons === false || match?.type !== 'bookmark') {
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

    _isInboxSearchTarget(el) {
        return el?.classList?.contains('inbox-search-input') || !!el?.closest?.('.inbox-search-input');
    }

    _isInboxSearchContext(e) {
        const target = e?.target;
        if (this._isInboxSearchTarget(target)) {
            return true;
        }
        return this._isInboxSearchTarget(document.activeElement);
    }

    _isInboxViewActive() {
        const dash = window.dashboardInstance;
        if (dash?.inbox?.triage?.isOpen?.()) {
            return true;
        }
        if (dash?.activeView === 'inbox') {
            return true;
        }
        return document.getElementById('dashboard-layout')?.classList.contains('inbox-layout') ?? false;
    }

    _isConfigViewActive() {
        const dash = window.dashboardInstance;
        if (dash?.activeView === 'config') {
            return true;
        }
        return document.getElementById('dashboard-layout')?.classList.contains('config-layout') ?? false;
    }

    /**
     * A full-container view (inbox, health, config) is on screen. Such a view
     * owns plain letter keys for its own shortcuts, so search must not swallow
     * them as type-to-search.
     */
    _isDashboardViewActive() {
        const dash = window.dashboardInstance;
        if (this._isInboxViewActive()) {
            return true;
        }
        if (dash?.activeView === 'health') {
            return true;
        }
        if (document.getElementById('dashboard-layout')?.classList.contains('health-layout')) {
            return true;
        }
        if (this._isConfigViewActive()) {
            return true;
        }
        return false;
    }

    _isInboxLauncherKey(e, key) {
        return key === '>'
            || key === ':'
            || key === '?'
            || e.key === '@'
            || e.key === ','
            || e.key === '+'
            || e.key === '&'
            || e.key === '0'
            || (key >= '1' && key <= '9');
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
        if (window.dashboardInstance?.uiHelpers?.isPageOverviewModalOpen?.()) {
            return true;
        }
        if (document.getElementById('omnibox-overlay')) {
            return true;
        }
        if (document.getElementById('move-popover') || document.getElementById('delete-popover') || document.getElementById('tag-popover')) {
            return true;
        }
        if (document.getElementById('date-popover')) {
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

        if (!this.searchActive && this._isInboxSearchContext(e)) {
            return;
        }

        if (!this.searchActive && this._isDashboardViewActive() && !this._isInboxLauncherKey(e, key)) {
            if (e.key.length === 1 && /^[A-Za-z0-9]$/.test(e.key)) {
                return;
            }
        }

        if (!this.searchActive && this.shouldDeferToDashboardOverlay()) {
            return;
        }

        // Dashboard grid shortcuts use shift-modified letters; never open shortcut search for them.
        if (
            !this.searchActive
            && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey
            && (e.code === 'KeyM' || e.code === 'KeyD' || e.code === 'KeyT'
                || (key.length === 1 && /^[A-Z]$/.test(key)))
        ) {
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
        
        if (key === 'ENTER' && (this.searchActive || this.currentQuery.length > 0)) {
            e.preventDefault();
            this._flushSearchUpdate();
            this.selectCurrentMatch({ newTab: (e.ctrlKey || e.metaKey) && !e.altKey });
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
            const root = document.querySelector('#shortcut-search .search-container');
            if (root) {
                const active = document.activeElement;
                if (!(active instanceof Element) || !root.contains(active)) {
                    e.preventDefault();
                    const focusable = window.FocusTrapUtils?.getFocusableElements?.(root) || [];
                    if (focusable.length > 0) {
                        focusable[0].focus({ preventScroll: true });
                    } else {
                        this.focusSearchPanel();
                    }
                    return;
                }
                if (window.FocusTrapUtils?.trapTabKey(e, root)) {
                    return;
                }
            }
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

        // Handle colon key — command launcher, or filter token in normal search (category:work)
        if (key === ':') {
            e.preventDefault();
            if (this.searchActive && this._isNormalSearchMode() && this.currentQuery.length > 0) {
                this.addToQuery(':');
                return;
            }
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

        // / toggles dashboard tag cloud when enabled; config Tags tab uses / for its filter
        if (key === '/') {
            const dash = window.dashboardInstance;
            if (!this.searchActive && dash?.config?.isActiveView?.()) {
                return;
            }
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
            this.addToQuery('?');
            return;
        }

        // , opens the page overview overlay. Guarded on !searchActive like the 0
        // shortcut below: these three sit above the printable-character branches,
        // so without the guard they were unreachable as characters -- ",", "+"
        // and "&" simply could not be typed into a search, a filter or a
        // ":new https://…?a=1&b=2" command.
        if (e.key === ',' && !this.searchActive) {
            e.preventDefault();
            window.dashboardInstance?.showPageOverlay?.();
            return;
        }

        // + opens the full new-bookmark modal
        if (e.key === '+' && !this.searchActive) {
            e.preventDefault();
            window.dashboardInstance?.quickAddWidget?.toggle?.();
            return;
        }

        // & opens the quick-add omnibox
        if (e.key === '&' && !this.searchActive) {
            e.preventDefault();
            window.dashboardInstance?.showOmnibox?.();
            return;
        }

        // 0 opens Inbox when enabled (never feeds into search)
        if (e.key === '0' && !this.searchActive) {
            const dash = window.dashboardInstance;
            if (dash?.inbox?.isEnabled?.() && dash.settings?.inboxShowInPageTabs !== false) {
                if (dash.keyboardNavigation?.isGChordActive?.()) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                void dash.inbox.openInboxView();
                return;
            }
        }

        // Handle space key for commands, finders, global search, and normal-search filters
        if (key === ' ' && (
            this.currentQuery.startsWith(':')
            || this.currentQuery.startsWith('?')
            || this.currentQuery.startsWith('@')
            || (this.searchActive && this._isNormalSearchMode())
        )) {
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

        // Normal search: allow filter syntax (category:work) alongside shortcuts
        if (this.searchActive && this._isNormalSearchMode()) {
            if (e.key.length === 1 && /^[\x20-\x7E]$/.test(e.key)) {
                e.preventDefault();
                this.addToQuery(e.key);
                return;
            }
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

        // A query exists, so search is active -- say so now rather than after the
        // debounce.
        //
        // The flag was set by showSearch(), which runs from updateSearch(), which
        // is debounced. Typing therefore left `isActive()` false for the first
        // characters while the query was already collecting them, and every guard
        // that reads it -- the grid's c/g/j/k/t, the `,` `+` `&` `0` launchers,
        // the tag cloud -- let a key through that belonged to the query.
        // `:buttons cheatsheet` was the visible case: the `c` opened "add a
        // category" instead of reaching the palette, so no command taking an
        // argument that contains one of those letters could be typed at all.
        //
        // Only the flag and its bookkeeping: the overlay still appears when the
        // debounce fires, so what is on screen is unchanged.
        this._beginSearchSession();

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

        // What typing does with a shortcut is a setting: Enter opens (the
        // default), a short pause opens, or the match opens on the spot. See
        // _maybeAutoOpenShortcut.
        this._maybeAutoOpenShortcut();
        this._scheduleUpdateSearch();
    }

    /** Milliseconds of quiet before "delay" mode opens an exact shortcut. */
    static SHORTCUT_OPEN_DELAY_MS = 400;

    /** instant | delay | enter — an unknown or absent value reads as instant. */
    shortcutOpenMode() {
        const mode = String(this.settings?.shortcutOpenMode || '').toLowerCase();
        return (mode === 'delay' || mode === 'enter') ? mode : 'instant';
    }

    cancelPendingShortcutOpen() {
        if (this._shortcutOpenTimer) {
            clearTimeout(this._shortcutOpenTimer);
            this._shortcutOpenTimer = null;
        }
    }

    /**
     * The bookmark a bare query names outright, or null.
     *
     * Both guards are the ones the original had. A longer shortcut sharing the
     * prefix means the typing may not be finished — "gh" cannot open while
     * "ghi" exists — and a finder sharing it would be shadowed by a bookmark
     * that opened first.
     */
    exactShortcutMatch() {
        const query = this._stripModeSwitchPrefix(this.currentQuery);
        const switched = this._hasModeSwitchPrefix(this.currentQuery);
        const isShortcutMode = (switched && this.interleaveMode) || (!switched && !this.interleaveMode);
        if (!isShortcutMode || !query) return null;

        const key = query.toLowerCase();
        const match = this.shortcuts.get(key);
        if (!match) return null;

        const hasLongerMatch = Array.from(this.shortcuts.keys())
            .some((shortcut) => shortcut !== key && shortcut.startsWith(key));
        if (hasLongerMatch) return null;

        const hasFinder = this.settings.includeFindersInSearch && (
            this.findersComponent.shortcuts.has(key)
            || Array.from(this.findersComponent.shortcuts.keys()).some((f) => f.startsWith(key))
        );
        if (hasFinder) return null;

        return match;
    }

    /**
     * Open on typing alone, in the two modes that ask for it.
     *
     * Instant is what the dashboard did before v1.2.0, and what it costs is
     * measurable: on an install with 200 shortcuts, eight of thirteen ordinary
     * search words were swallowed mid-word, because a shortcut fired the moment
     * the query matched it and nothing longer shared its letters — "invoice"
     * opened something at "in" and left "voice" behind. Which of your words
     * survive depends on which other bookmarks you own, and changes every time
     * you add one.
     *
     * Delay is the middle: the same open, held back until you stop typing, so a
     * word that carries on past the shortcut keeps going. It cannot rescue a
     * word typed slowly enough to fall through the pause — which is why Enter,
     * where nothing decides for you, stays the default.
     */
    _maybeAutoOpenShortcut() {
        this.cancelPendingShortcutOpen();
        const mode = this.shortcutOpenMode();
        if (mode === 'enter') return;

        const match = this.exactShortcutMatch();
        if (!match) return;

        if (mode === 'instant') {
            this.openBookmark(match);
            this.resetQuery();
            return;
        }

        const query = this.currentQuery;
        this._shortcutOpenTimer = setTimeout(() => {
            this._shortcutOpenTimer = null;
            // The query has to be the one the timer was armed for: another key,
            // a backspace or a closed panel all mean this is no longer what the
            // user is asking for.
            if (!this.searchActive || this.currentQuery !== query) return;
            const stillMatching = this.exactShortcutMatch();
            if (!stillMatching) return;
            this.openBookmark(stillMatching);
            this.resetQuery();
        }, SearchComponent.SHORTCUT_OPEN_DELAY_MS);
    }

    _scheduleUpdateSearch() {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            this._debounceTimer = null;
            this.updateSearch();
        }, 50);
    }

    _flushSearchUpdate() {
        if (!this._debounceTimer) {
            return;
        }
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
        this.updateSearch();
    }

    _activateMatchAt(index) {
        if (index < 0 || index >= this.selectableMatches.length) {
            return;
        }
        this.selectedMatchIndex = index;
        this.selectCurrentMatch();
    }

    _bindMatchKeyboardActivate(element, index) {
        element.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') {
                return;
            }
            // Space belongs to the query while one is being typed.
            //
            // The highlighted row takes focus, and a focused row is a button, so
            // Space ran the command instead of separating two words: `:buttons`
            // then a space applied the first row rather than letting the reader
            // reach `:buttons cheatsheet`. Every command that takes an argument
            // was unreachable by typing -- the same for a finder query (`?g some
            // phrase`) and a filter (`tag: two words`). Enter still activates,
            // which is the deliberate way in and the one the rest of the view
            // documents.
            if (e.key === ' ' && this._queryTakesSpace()) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            this._activateMatchAt(index);
        });
    }

    /**
     * Whether a space typed now is text rather than an activation.
     *
     * Command, finder and global modes are all "type an argument" modes, and a
     * normal search takes spaces too — a title is words. The exception is an
     * empty query, where there is nothing being typed and Space on a focused row
     * can only have meant "open this".
     */
    _queryTakesSpace() {
        return this.searchActive && this.currentQuery.length > 0;
    }

    /**
     * Say so when the shortcut search missed but a name search would not.
     *
     * With *Switch Search Mode* off — the default — a bare query looks for a
     * bookmark shortcut. Type a bookmark's name and there is usually no
     * shortcut by that name, so the overlay reports nothing while the bookmark
     * is sitting on the page behind it. The search knew: it looked in one of
     * its two places. This adds the other answer as one row, and names the key
     * that gets there, so the reader learns the prefix at the moment it would
     * have helped rather than in a settings panel months earlier.
     *
     * Only when there is something to point at. With no name match either,
     * "nothing found" is the honest answer and another row is noise.
     */
    _appendModeHintIfShortcutSearchMissed(searchQuery, filters) {
        if (!searchQuery || this.searchMatches.length > 0) {
            return;
        }
        const fuzzy = (this.fuzzySearchComponent?.handleFuzzy?.(searchQuery, this.bookmarks) || [])
            .filter((match) => this.matchesAdvancedFilters(match.bookmark, filters));
        if (fuzzy.length === 0) {
            return;
        }
        const count = fuzzy.length;
        const dash = window.dashboardInstance;
        // Singular and plural are separate strings rather than one with a
        // count: "1 bookmarks" is the sort of thing four locales would each
        // have to work around.
        const noun = count === 1
            ? dash?.formatDashboardLabel?.('searchModeHintOne', {}, '1 bookmark')
            : dash?.formatDashboardLabel?.('searchModeHintMany', { count }, `${count} bookmarks`);
        const label = dash?.formatDashboardLabel?.(
            'searchModeHint',
            { query: searchQuery, count: noun },
            `No shortcut "${searchQuery}" — ${noun} by that name. Press / to search names.`,
        );
        this.searchMatches.push({
            type: 'mode-hint',
            label,
            count,
            query: searchQuery,
        });
    }

    /**
     * Does this query carry the mode-switch prefix?
     *
     * `/` is it, and the only one. A second spelling was tried and taken back
     * out: `;` already opens the inline editor on the grid, and a key that
     * means one thing on the page and another in the overlay is the very
     * confusion the second key was meant to spare people.
     *
     * The helper stays even though it now tests one character, because four
     * call sites ask this question and a fifth had drifted into asking it
     * differently.
     */
    _hasModeSwitchPrefix(query) {
        return String(query || '').startsWith('/');
    }

    /** The query with its mode-switch prefix removed, if it had one. */
    _stripModeSwitchPrefix(query) {
        const text = String(query || '');
        return this._hasModeSwitchPrefix(text) ? text.slice(1) : text;
    }

    _isNormalSearchMode() {
        return !this.currentQuery.startsWith(':')
            && !this.currentQuery.startsWith('?')
            && !this.currentQuery.startsWith('@');
    }

    _collectFilterBookmarkPool() {
        const pool = [];
        const seen = new Set();
        const add = (bookmark) => {
            if (!bookmark) return;
            const id = bookmark.id ?? bookmark.url;
            if (id != null && seen.has(id)) return;
            if (id != null) seen.add(id);
            pool.push(bookmark);
        };
        // Prefer current-page copies first so status fields (checkStatus, lastChecked) stay fresh.
        [this.currentBookmarks, this.bookmarks, this.allBookmarks].forEach((list) => {
            if (Array.isArray(list)) list.forEach(add);
        });
        return pool;
    }

    _buildTagUsageCounts(pool) {
        const counts = new Map();
        pool.forEach((bookmark) => {
            for (const raw of bookmark?.tags || []) {
                const tag = String(raw || '').trim().toLowerCase();
                if (!tag) continue;
                counts.set(tag, (counts.get(tag) || 0) + 1);
            }
        });
        return counts;
    }

    /** Tags for tag: filter — top N by usage when no prefix; prefix matches any tag by name. */
    _getTagFilterSuggestions(pool, { prefix = '', limit = null } = {}) {
        const counts = this._buildTagUsageCounts(pool);
        const normalizedPrefix = String(prefix || '').toLowerCase();
        let tags = [...counts.keys()];
        if (normalizedPrefix) {
            tags = tags.filter((tag) => tag.startsWith(normalizedPrefix));
        }
        tags.sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
        if (limit != null) {
            tags = tags.slice(0, limit);
        }
        return tags;
    }

    parseSearchFilters(query) {
        const filters = {
            category: '',
            status: '',
            page: '',
            tag: '',
            // Everything above, in the negative. Custom collections have had an
            // "excludes" operator on every rule field since they were built, so
            // "dev links that are not archived" was expressible in config and
            // not in the bar — which is the shape most tidy-up questions take.
            not: {},
        };

        const parts = (query || '').split(/\s+/).filter(Boolean);
        const remaining = [];
        const KEYS = ['category', 'status', 'page', 'tag', 'opened', 'added'];

        parts.forEach((part) => {
            const negated = part.startsWith('-') && part.length > 1;
            const body = negated ? part.slice(1) : part;
            const lower = body.toLowerCase();
            const key = KEYS.find((name) => lower.startsWith(`${name}:`));
            if (!key) {
                remaining.push(part);
                return;
            }
            const value = lower.slice(key.length + 1);
            if (negated) {
                // An empty value ("-tag:") excludes nothing rather than
                // everything, which is what a half-typed filter should do.
                if (value) filters.not[key] = value;
                return;
            }
            filters[key] = value;
        });

        return {
            filters,
            query: remaining.join(' ').trim()
        };
    }

    _getActiveFilters(filters) {
        const active = { ...filters };
        if (active.status && !SearchComponent.STATUS_FILTER_VALUES.has(String(active.status).toLowerCase())) {
            active.status = '';
        }
        if (active.page) {
            const pageValue = String(active.page).toLowerCase();
            if (pageValue !== 'current' && pageValue !== 'all' && !/^\d+$/.test(pageValue)) {
                active.page = '';
            }
        }
        return active;
    }

    _hasActiveFilters(filters) {
        const active = this._getActiveFilters(filters);
        // `not` is an object, so a plain truthiness sweep would call an empty one
        // an active filter and treat a bare query as filtered.
        const { not = {}, ...scalars } = active;
        return Object.values(scalars).some((value) => Boolean(value))
            || Object.values(not).some((value) => Boolean(value));
    }

    _getCurrentFilterToken(rawQuery) {
        const parts = String(rawQuery || '').split(/\s+/).filter(Boolean);
        return (parts[parts.length - 1] || '').toLowerCase();
    }

    _isIncompleteFilterQuery(rawQuery) {
        const token = this._getCurrentFilterToken(rawQuery);
        if (!token) {
            return false;
        }
        if (!token.includes(':')) {
            return SearchComponent.FILTER_KEYS.some((prefix) => (
                prefix.startsWith(token) || token.startsWith(prefix)
            ));
        }
        const key = token.slice(0, token.indexOf(':'));
        return SearchComponent.FILTER_KEYS.includes(key);
    }

    _isCompleteFilterQuery(raw) {
        const text = String(raw || '').trim();
        if (!text) return false;

        const parsed = this.parseSearchFilters(text);
        if (parsed.query.length > 0) return false;
        if (!this._hasActiveFilters(parsed.filters)) return false;

        const parts = text.split(/\s+/).filter(Boolean);
        return parts.every((part) => {
            const lower = part.toLowerCase();
            if (lower.startsWith('status:')) {
                return SearchComponent.STATUS_FILTER_VALUES.has(lower.slice(7));
            }
            if (lower.startsWith('category:')) {
                return lower.length > 'category:'.length;
            }
            if (lower.startsWith('tag:')) {
                return lower.length > 'tag:'.length;
            }
            if (lower.startsWith('page:')) {
                const pageValue = lower.slice(5);
                return pageValue === 'current' || pageValue === 'all' || /^\d+$/.test(pageValue);
            }
            if (lower.startsWith('opened:')) {
                const value = lower.slice(7);
                // `never` only says anything about a bookmark that was never
                // opened, so it is accepted here but not under `added:`.
                return value === 'never' || SearchComponent.AGE_FILTER_VALUES.has(value);
            }
            if (lower.startsWith('added:')) {
                return SearchComponent.AGE_FILTER_VALUES.has(lower.slice(6));
            }
            return false;
        });
    }

    /**
     * Writes down that this query led to this bookmark.
     *
     * The history kept what you typed and threw away what you then chose,
     * which is the half that would have made the ranking yours. Keyed on the
     * query rather than the bookmark: "mail" meaning Gmail says nothing about
     * what "ma" means, and guessing otherwise makes the list unpredictable in
     * exactly the way a launcher cannot afford.
     *
     * @param {{url: string}} bookmark
     */
    recordSearchPick(bookmark) {
        const url = bookmark && bookmark.url;
        const q = this.normalizePickQuery(this.currentQuery);
        if (!url || !q) return;

        const existing = this.searchPicks.find((p) => p.q === q && p.url === url);
        if (existing) {
            existing.n = (Number(existing.n) || 0) + 1;
            existing.at = Date.now();
        } else {
            this.searchPicks.unshift({ q, url, n: 1, at: Date.now() });
        }

        this.prunePicks();
        this.fuzzySearchComponent.updatePicks(this.searchPicks);
        this.saveSearchPicks();
    }

    /**
     * The query as the memory should hold it.
     *
     * "/mail tag:work" is the same intent as "mail": the prefix picks a mode
     * and the token is a filter. Stored whole, the entry would never match
     * anything typed a second time.
     *
     * @param {string} raw
     * @returns {string} lower-cased, or '' when there is nothing to remember
     */
    normalizePickQuery(raw) {
        const stripped = this._stripModeSwitchPrefix(String(raw || ''));
        const withoutFilters = stripped
            .split(/\s+/)
            .filter((token) => token && !token.includes(':'))
            .join(' ');
        return withoutFilters.trim().toLowerCase();
    }

    /**
     * Holds the memory to 200 entries, dropping the weakest.
     *
     * Weakest is the same judgement the scorer makes — how often, decayed by
     * how long ago — so what survives a flood of one-off searches is the
     * handful of queries you actually lean on.
     */
    prunePicks() {
        if (this.searchPicks.length <= SearchComponent.MAX_SEARCH_PICKS) return;
        this.searchPicks.sort((a, b) =>
            this.fuzzySearchComponent.pickScore(b) - this.fuzzySearchComponent.pickScore(a));
        this.searchPicks = this.searchPicks.slice(0, SearchComponent.MAX_SEARCH_PICKS);
    }

    /**
     * Persist the memory the way saved searches are persisted: settings, so the
     * backup carries it and a second browser inherits it, with localStorage
     * kept in step for an older tab.
     *
     * The settings write is debounced. Saved searches are an explicit act and
     * can afford a POST each; this fires on every bookmark opened from search.
     */
    saveSearchPicks() {
        try {
            localStorage.setItem('dashboardSearchPicks', JSON.stringify(this.searchPicks));
        } catch { /* private mode — the settings copy is the one that matters */ }

        const d = window.dashboardInstance;
        if (!d?.settings) return;
        d.settings.searchPicks = this.searchPicks;
        clearTimeout(this._searchPicksTimer);
        this._searchPicksTimer = setTimeout(() => { void d.saveSettings?.(); }, 2000);
    }

    /** Settings first — it is the copy that travels. */
    loadSearchPicks() {
        const fromSettings = window.dashboardInstance?.settings?.searchPicks;
        if (Array.isArray(fromSettings)) return fromSettings;
        try {
            const stored = localStorage.getItem('dashboardSearchPicks');
            const parsed = stored ? JSON.parse(stored) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /**
     * Groups fuzzy results by *why* they matched.
     *
     * A flat, score-ordered list told you nothing: `Gmail` and
     * `widGetonderzoek` were the same kind of row, and one letter filled the
     * screen with names whose only crime was holding a `g` somewhere in the
     * middle. The score already knew the difference — see the `group` label in
     * fuzzy-search.js — so the list says it out loud and collapses what you
     * almost certainly did not mean.
     *
     * The headers are the ones the empty state and the inline filters already
     * use, so expanding, counting and keyboard-activating come for free.
     *
     * @param {Array} matches - results from handleFuzzy, best-first
     * @param {string} query  - the query, for the "Contains …" label
     * @returns {Array} matches with group headers woven in, or the flat list
     */
    _groupFuzzyMatches(matches, query) {
        this._fuzzyGroupsApplied = false;
        if (!Array.isArray(matches) || matches.length === 0) return matches;

        const buckets = SearchComponent.FUZZY_GROUPS.map((group) => ({
            ...group,
            items: matches.filter((m) => (m.group || 'contains') === group.key)
        })).filter((bucket) => bucket.items.length > 0);

        if (buckets.length === 0) return matches;

        // One kind of match needs no explanation. Typing a full name should not
        // sprout a header over a single row — that trades one sort of clutter
        // for another.
        if (buckets.length === 1) {
            return this._capGroup(buckets[0].items, buckets[0].id);
        }

        const expandedOf = (bucket) => (bucket.defaultExpanded
            ? !this.emptyStateExpandedGroups.has(bucket.id)
            : this.emptyStateExpandedGroups.has(bucket.id));

        const open = new Set(buckets.filter(expandedOf).map((b) => b.id));
        // Every group shut means a screen of headers and counts over nothing,
        // which reads as "not found" while holding the answer one keystroke
        // away. The strongest group left standing opens itself.
        if (open.size === 0) open.add(buckets[0].id);

        const rows = [];
        buckets.forEach((bucket) => {
            const expanded = open.has(bucket.id);
            rows.push({
                type: 'command-group-header',
                groupId: bucket.id,
                label: this.dashboardLabel(bucket.labelKey, bucket.fallback, { query }),
                count: bucket.items.length,
                expanded,
                _emptyStateGroup: bucket.id
            });
            if (expanded) rows.push(...this._capGroup(bucket.items, bucket.id));
        });

        this._fuzzyGroupsApplied = true;
        return rows;
    }

    /**
     * Holds an open group to a screenful, with a row that says what is left.
     * Without it a prefix match on a common letter fills the overlay again,
     * which is the thing the grouping was for.
     */
    _capGroup(items, groupId) {
        const cap = SearchComponent.FUZZY_GROUP_CAP;
        if (items.length <= cap || this.searchGroupsShowAll.has(groupId)) return items;
        return [
            ...items.slice(0, cap),
            {
                type: 'group-more',
                groupId,
                count: items.length - cap,
                label: this.dashboardLabel('searchGroupMore', '{count} more', {
                    count: items.length - cap
                })
            }
        ];
    }

    /** Reveals the rest of a capped group; the cap returns when search closes. */
    showAllInGroup(groupId) {
        this.searchGroupsShowAll.add(groupId);
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
            {
                shortcut: '↳',
                name: this.dashboardLabel(
                    'filterByOpened',
                    'Filter by when it was last opened (never/today/week/month/year)',
                ),
                completion: 'opened: ',
                type: 'filter-completion',
            },
            {
                shortcut: '↳',
                name: this.dashboardLabel('filterByAdded', 'Filter by when it was added (today/week/month/year)'),
                completion: 'added: ',
                type: 'filter-completion',
            },
        ];
    }

    getFilterAutocompleteMatches(rawQuery) {
        const t = (key, fallback, vars = {}) => this.dashboardLabel(key, fallback, vars);

        const query = String(rawQuery || '');
        const parts = query.split(/\s+/).filter(Boolean);
        const currentToken = (parts[parts.length - 1] || '').toLowerCase();
        const basePrefix = parts.slice(0, -1).join(' ').trim();
        const prefixWithSpace = basePrefix ? `${basePrefix} ` : '';

        const pool = this._collectFilterBookmarkPool();
        const categoryMap = new Map();
        pool.forEach((bookmark) => {
            const raw = String(bookmark?.category || '').trim();
            if (!raw) return;
            const key = raw.toLowerCase();
            if (!categoryMap.has(key)) categoryMap.set(key, raw);
        });
        const categories = [...categoryMap.keys()].sort();
        const pageIds = Array.from(new Set([
            ...pool.map((bookmark) => Number(bookmark?.pageId || bookmark?.pageID || 0)),
            ...(this.pages || []).map((page) => Number(page?.id || 0)),
            Number(this.currentPageId || 0),
        ])).filter((id) => Number.isFinite(id) && id > 0).sort((a, b) => a - b);

        const toCompletion = (token, description) => ({
            shortcut: '↳',
            name: description,
            completion: `${prefixWithSpace}${token} `,
            type: 'filter-completion'
        });

        const filterTypeHints = () => ([
            toCompletion('category:', t('filterByCategory', 'Filter by category (example: category:work)')),
            toCompletion('status:', t('filterByStatusFull', 'Filter by status (online/offline/checked/unchecked/pinned/unpinned/broken/ok/feed)')),
            toCompletion('page:', t('filterByPage', 'Filter by page (current/all/number)')),
            toCompletion('tag:', t('filterByTag', 'Filter by tag (example: tag:work)')),
            toCompletion('opened:', t('filterByOpened', 'Filter by when it was last opened (never/today/week/month/year)')),
            toCompletion('added:', t('filterByAdded', 'Filter by when it was added (today/week/month/year)'))
        ]);

        if (currentToken === '' || currentToken === 'category' || currentToken === 'status' || currentToken === 'page'
            || currentToken === 'tag' || currentToken === 'opened' || currentToken === 'added') {
            return filterTypeHints();
        }

        if (!currentToken.includes(':')) {
            const valueHits = [];

            if (currentToken.length >= 2) {
                const categoryHits = categories
                    .filter((category) => category.startsWith(currentToken))
                    .slice(0, 8)
                    .map((category) => toCompletion(
                        `category:${category}`,
                        t('filterCompletionCategory', 'Category: {value}', { value: categoryMap.get(category) || category })
                    ));
                valueHits.push(...categoryHits);

                const tagHits = this._getTagFilterSuggestions(pool, {
                    prefix: currentToken,
                    limit: 12,
                }).map((tag) => toCompletion(
                    `tag:${tag}`,
                    t('filterCompletionTag', 'Tag: {value}', { value: tag })
                ));
                valueHits.push(...tagHits);
            }

            const partialHints = [];
            if ('category'.startsWith(currentToken) && currentToken.length >= 2) {
                partialHints.push(toCompletion('category:', t('filterByCategory', 'Filter by category (example: category:work)')));
            }
            if ('status'.startsWith(currentToken) && currentToken.length >= 2) {
                partialHints.push(toCompletion('status:', t('filterByStatusFull', 'Filter by status (online/offline/checked/unchecked/pinned/unpinned/broken/ok/feed)')));
            }
            if ('page'.startsWith(currentToken) && currentToken.length >= 2) {
                partialHints.push(toCompletion('page:', t('filterByPage', 'Filter by page (current/all/number)')));
            }
            if ('tag'.startsWith(currentToken) && currentToken.length >= 2) {
                partialHints.push(toCompletion('tag:', t('filterByTag', 'Filter by tag (example: tag:work)')));
            }
            if ('opened'.startsWith(currentToken) && currentToken.length >= 2) {
                partialHints.push(toCompletion('opened:', t('filterByOpened', 'Filter by when it was last opened (never/today/week/month/year)')));
            }
            if ('added'.startsWith(currentToken) && currentToken.length >= 2) {
                partialHints.push(toCompletion('added:', t('filterByAdded', 'Filter by when it was added (today/week/month/year)')));
            }

            const combined = [...valueHits, ...partialHints];
            if (combined.length > 0) {
                return combined;
            }

            return [];
        }

        if (currentToken.startsWith('category:')) {
            const value = currentToken.slice('category:'.length);
            const hits = categories
                .filter((category) => !value || category.startsWith(value))
                .slice(0, 12);
            if (hits.length === 0) return [];
            return hits.map((category) => toCompletion(
                `category:${category}`,
                t('filterCompletionCategory', 'Category: {value}', { value: categoryMap.get(category) || category })
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
                ['feed', t('filterStatusFeed', 'Publishes a feed Fresh can read')],
                ['unfed', t('filterStatusUnfed', 'No feed behind it')],
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
            const hits = this._getTagFilterSuggestions(pool, {
                prefix: value,
                limit: value
                    ? 12
                    : SearchComponent.TOP_TAG_FILTER_SUGGESTIONS,
            });
            if (hits.length === 0) return [];
            return hits.map((tag) => toCompletion(
                `tag:${tag}`,
                t('filterCompletionTag', 'Tag: {value}', { value: tag })
            ));
        }

        // The age words are a closed vocabulary, so they can be offered the same
        // way status values are. `never` is only on `opened:` — a bookmark has
        // no "never added" state.
        if (currentToken.startsWith('opened:') || currentToken.startsWith('added:')) {
            const key = currentToken.startsWith('opened:') ? 'opened' : 'added';
            const value = currentToken.slice(key.length + 1);
            const entries = [
                ['today', t('filterAgeToday', 'Within the last day')],
                ['week', t('filterAgeWeek', 'Within the last week')],
                ['month', t('filterAgeMonth', 'Within the last month')],
                ['year', t('filterAgeYear', 'Within the last year')],
            ];
            if (key === 'opened') {
                entries.push(['never', t('filterAgeNever', 'Never opened')]);
            }
            return entries
                .filter(([word]) => word.startsWith(value))
                .map(([word, desc]) => toCompletion(
                    `${key}:${word}`,
                    t('filterAgeEntry', '{key}:{value} — {desc}', { key, value: word, desc })
                ));
        }

        return [];
    }

    _resolveBookmarkForFilters(bookmark) {
        const url = String(bookmark?.url || '').trim();
        if (!url) {
            return bookmark;
        }
        const fromCurrent = this.currentBookmarks?.find((candidate) => candidate?.url === url);
        if (fromCurrent) {
            return fromCurrent;
        }
        const fromSearch = this.bookmarks?.find((candidate) => candidate?.url === url);
        if (fromSearch) {
            return fromSearch;
        }
        const dash = window.dashboardInstance;
        const fromDash = dash?.bookmarks?.find((candidate) => candidate?.url === url);
        return fromDash || bookmark;
    }

    /**
     * Does one bookmark satisfy one filter key?
     *
     * Split out of matchesAdvancedFilters so the negative form can reuse it: a
     * `-tag:x` is exactly `tag:x` with the answer flipped, and writing the
     * predicate twice is how the two drift apart.
     */
    matchesFilterKey(bookmark, key, value) {
        if (!value) return true;
        const wanted = String(value).toLowerCase();

        if (key === 'category') {
            return String(bookmark.category || '').toLowerCase().includes(wanted);
        }

        if (key === 'tag') {
            return (bookmark.tags || []).some((tag) => String(tag).toLowerCase().includes(wanted));
        }

        if (key === 'opened') {
            return SearchComponent.matchesAgeFilter(bookmark.lastOpened, wanted);
        }

        if (key === 'added') {
            return SearchComponent.matchesAgeFilter(bookmark.createdAt, wanted);
        }

        if (key === 'page') {
            if (wanted === 'all' || wanted === 'global') return true;
            const bookmarkPageId = Number(bookmark.pageId || bookmark.pageID || this.currentPageId || 0);
            if (wanted === 'current') {
                return !bookmarkPageId || bookmarkPageId === Number(this.currentPageId || 0);
            }
            if (/^\d+$/.test(wanted)) {
                return bookmarkPageId === Number(wanted);
            }
            return true;
        }

        if (key === 'status') {
            if (!SearchComponent.STATUS_FILTER_VALUES.has(wanted)) return true;
            const hasStatus = bookmark.checkStatus === true;
            const isPinned = bookmark.pinned === true;
            const isBroken = Boolean(String(bookmark.lastError || '').trim());
            const tagCount = (bookmark.tags || []).filter((tag) => String(tag).trim()).length;
            const hasNote = Boolean(String(bookmark.note || '').trim());
            // Known only while Fresh is on: with it off the server answers with
            // an empty map, and every bookmark would read as "no feed" — an
            // answer about the setting rather than about the bookmark.
            const feeds = window.dashboardInstance?.feeds;
            const hasFeed = feeds?.enabled === true
                && Boolean(feeds.byKey?.get(feeds.key(bookmark.url))?.feedUrl);
            const monitor = window.dashboardInstance?.statusMonitor;
            const reachability = typeof monitor?.getBookmarkReachability === 'function'
                ? monitor.getBookmarkReachability(bookmark)
                : null;

            // The questions that are only about the bookmark come from the
            // shared registry, so `status:untagged` here and the config list's
            // "Without tags" cannot drift apart — they used to disagree over a
            // tag that is nothing but spaces.
            if (window.BookmarkPredicates?.has?.(wanted)
                && !['checked', 'unchecked', 'pinned', 'unpinned'].includes(wanted)) {
                return window.BookmarkPredicates.match(wanted, bookmark);
            }

            switch (wanted) {
                case 'checked': return hasStatus;
                case 'unchecked': return !hasStatus;
                case 'pinned': return isPinned;
                case 'unpinned': return !isPinned;
                case 'broken': return isBroken;
                case 'ok': return hasStatus && !isBroken && reachability === 'online';
                case 'online': return reachability === 'online';
                case 'offline': return reachability === 'offline';
                case 'untagged': return tagCount === 0;
                case 'tagged': return tagCount > 0;
                case 'noted': return hasNote;
                case 'unnoted': return !hasNote;
                case 'feed': return hasFeed;
                case 'unfed': return !hasFeed;
                default: return true;
            }
        }

        return true;
    }

    matchesAdvancedFilters(bookmark, filters) {
        if (!bookmark) return false;
        bookmark = this._resolveBookmarkForFilters(bookmark);

        // openCount, lastOpened and createdAt drive every smart collection and the
        // whole stats page, and were reachable from none of the filters — so
        // "added this month and never opened" was answerable in Config and not
        // from the search bar a keyboard-first user actually lives in.
        for (const key of ['category', 'status', 'tag', 'opened', 'added', 'page']) {
            if (!this.matchesFilterKey(bookmark, key, filters[key])) {
                return false;
            }
        }

        // The same predicates, inverted: a bookmark that matches an excluded
        // filter is out.
        const not = filters.not || {};
        for (const key of Object.keys(not)) {
            if (!not[key]) continue;
            if (this.matchesFilterKey(bookmark, key, not[key])) {
                return false;
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
        this._trackModeOpen();

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
                const labelled = results.map(m => {
                    const pageName = this._getPageName(m.bookmark && m.bookmark.pageId);
                    const isCurrentPage = m.bookmark && m.bookmark.pageId === this.currentPageId;
                    const pageMeta = (pageName && !isCurrentPage) ? pageName : null;
                    const combinedMeta = [pageMeta, m.meta].filter(Boolean).join(' · ') || null;
                    return { ...m, meta: combinedMeta, type: 'global-search' };
                });
                // Searching every page makes the flat list longer still, so it
                // gets the same grouping as the single-page search.
                this.searchMatches = this._groupFuzzyMatches(labelled, query);
            }
        } else if (this.currentQuery.startsWith(':')) {
            // Handle commands
            this.searchMatches = this.commandsComponent.handleCommand(this.currentQuery);
        } else if (this.currentQuery.startsWith('?')) {
            // Handle finders
            this.searchMatches = this.findersComponent.handleQuery(this.currentQuery);
        } else {
            const query = this._stripModeSwitchPrefix(this.currentQuery);
            const switched = this._hasModeSwitchPrefix(this.currentQuery);
            const isShortcutMode = (switched && this.interleaveMode) || (!switched && !this.interleaveMode);
            const parsed = this.parseSearchFilters(query);
            const searchQuery = parsed.query;
            const filters = this._getActiveFilters(parsed.filters);
            const hasActiveFilters = this._hasActiveFilters(parsed.filters);
            const filterAutocompleteMatches = this._isCompleteFilterQuery(query)
                ? []
                : this.getFilterAutocompleteMatches(query);
            const isBareFilterTokenQuery = searchQuery.length === 0
                && !hasActiveFilters
                && query.length > 0
                && (filterAutocompleteMatches.length > 0 || this._isIncompleteFilterQuery(query));

            if (isBareFilterTokenQuery) {
                this.searchMatches = [];
            } else if (searchQuery.length === 0 && !hasActiveFilters && query.length === 0) {
                this.searchMatches = this.getEmptyStateMatches();
            } else if (searchQuery.length === 0 && hasActiveFilters) {
                this.searchMatches = this._collectFilterBookmarkPool()
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

                this._appendModeHintIfShortcutSearchMissed(searchQuery, filters);

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
                const fuzzy = this.fuzzySearchComponent.handleFuzzy(searchQuery).filter((match) => this.matchesAdvancedFilters(match.bookmark, filters));
                this.searchMatches = this._groupFuzzyMatches(fuzzy, searchQuery);
            }

            this.lastNonCommandQuery = query;
        }

        if (!this.currentQuery.startsWith(':') && !this.currentQuery.startsWith('?') && this.currentQuery.length > 0) {
            const raw = this._stripModeSwitchPrefix(this.currentQuery);
            const filterAutocompleteMatches = this._isCompleteFilterQuery(raw)
                ? []
                : this.getFilterAutocompleteMatches(raw);
            if (filterAutocompleteMatches.length > 0) {
                const currentToken = this._getCurrentFilterToken(raw);
                const filtersIsExpanded = currentToken.includes(':')
                    ? true
                    : !this.emptyStateExpandedGroups.has('filters');
                const filterHeader = {
                    type: 'command-group-header',
                    groupId: 'inline_filters',
                    label: this.dashboardLabel('filtersGroupLabel', 'Filters'),
                    count: filterAutocompleteMatches.length,
                    expanded: filtersIsExpanded,
                    _emptyStateGroup: 'filters'
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
            // Group headers are selectable, and index 0 is now one of them.
            // Left alone, the core flow — type, press Enter — would collapse a
            // group instead of opening the bookmark it was aiming at. Only the
            // fuzzy groups move the selection: the empty state and the inline
            // filters put a header first on purpose.
            this.selectedMatchIndex = this._fuzzyGroupsApplied
                ? Math.max(0, this.searchMatches.findIndex((m) => m.type !== 'command-group-header'))
                : 0;
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

    _syncDashboardInert() {
        window.FocusTrapUtils?.syncDashboardInert?.();
    }

    focusSearchPanel() {
        if (!this.searchActive) {
            return;
        }
        if (window.MobileExperience?.isMobileLayout?.()) {
            const mobileInput = document.getElementById('search-input-mobile');
            if (mobileInput) {
                mobileInput.focus({ preventScroll: true });
            }
            return;
        }
        const selected = this.matchElements[this.selectedMatchIndex];
        if (selected && typeof selected.focus === 'function') {
            selected.focus({ preventScroll: true });
            return;
        }
        const modeTab = document.querySelector('#shortcut-search .search-mode-tab.active')
            || document.querySelector('#shortcut-search .search-mode-tab');
        if (modeTab && typeof modeTab.focus === 'function') {
            modeTab.focus({ preventScroll: true });
        }
    }

    /**
     * Mark a search session open: the flag, the element to hand focus back to,
     * and the grid cursor released.
     *
     * Separate from showSearch() because the two moments are not the same one.
     * A query starts on the first keystroke; the overlay is drawn a debounce
     * later. Everything that asks "is the reader typing a query" has to be told
     * at the first moment, or it answers for the state before it.
     */
    _beginSearchSession() {
        if (this.searchActive) return;
        this._searchOpenerElement = document.activeElement;
        window.dashboardInstance?.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
        // The open event is fired from _trackModeOpen(), which knows whether this
        // is a plain search, commands, or finders — see updateSearch().
        this.searchActive = true;
    }

    showSearch() {
        this._beginSearchSession();
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
            this._syncDashboardInert();
            
            // Prevent body scroll. The refcount handles the overlap with an open
            // modal, which the old "only if not already hidden" guard could not:
            // it skipped the lock entirely and then had nothing to restore.
            if (!this.scrollLockToken) {
                this.scrollLockToken = window.ScrollLock?.acquire('search-overlay') ?? null;

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
                this.focusSearchPanel();
            });
        }
    }

    closeSearch() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
        // A pending "open after a pause" belongs to the query that is being
        // abandoned here.
        this.cancelPendingShortcutOpen();
        this.searchActive = false;
        // Reset so reopening the same mode counts as a new open.
        this._lastTrackedMode = null;
        this.emptyStateExpandedGroups.clear();
        this.searchGroupsShowAll.clear();
        document.dispatchEvent(new CustomEvent('nextdash:launcher-filter', { detail: { active: false, urls: new Set() } }));
        this.resetQuery();
        // resetQuery clears the state; the prompt is a separate element and used
        // to keep showing the query that had just been abandoned — so Escape
        // read as "did nothing" until the next key replaced the text.
        const queryElement = document.getElementById('search-query');
        if (queryElement) {
            queryElement.textContent = '';
        }
        this.updateModeIndicator();
        const searchElement = document.getElementById('shortcut-search');
        const mobileInput = document.getElementById('search-input-mobile');

        if (searchElement) {
            searchElement.classList.remove('show');
        }
        this._syncDashboardInert();

        
        // Restore body scroll only if this component changed it
        if (this.scrollLockToken) {
            window.ScrollLock?.release(this.scrollLockToken);
            this.scrollLockToken = null;
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
        this.cancelPendingShortcutOpen();
        this.currentQuery = '';
        this.searchMatches = [];
        this.selectedMatchIndex = 0;
        this.selectedChipIndex = 0;
        this.matchElements = []; // Clear element references
        this.selectableMatches = [];
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
        } else if (this._hasModeSwitchPrefix(q) && this.interleaveMode) {
            mode = 'fuzzy';
            label = this.language ? this.language.t('dashboard.searchModeFuzzy', 'FUZZY') : 'FUZZY';
        } else {
            mode = 'search';
            label = this.language ? this.language.t('dashboard.searchModeSearch', 'SEARCH') : 'SEARCH';
        }
        prefix.dataset.mode = mode;
        prefix.textContent = label;

        // The key that starts this mode, in front of the mode itself: > search,
        // : commands, ? finders, @ everywhere. Typing a bare letter still
        // searches — this says which key gets you here on purpose, and which one
        // to press when a single-letter bookmark shortcut would fire instead.
        const chevron = document.querySelector('.search-chevron');
        if (chevron) {
            const KEYS = { search: '>', command: ':', finder: '?', global: '@', fuzzy: '/' };
            chevron.textContent = KEYS[mode] || '>';
            chevron.dataset.mode = mode;
        }

        // A query you can see is a query you can clear.
        const clear = document.getElementById('search-clear');
        if (clear) {
            clear.hidden = q.length === 0;
        }

        // Sync mode tab active state
        document.querySelectorAll('.search-mode-tab').forEach(tab => {
            const isActive = tab.dataset.mode === mode;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
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
                this._bindMatchKeyboardActivate(headerEl, mySelectableIndex);
                fragment.appendChild(headerEl);
                this.matchElements.push(headerEl);
                this.selectableMatches.push(match);
                return;
            }

            // The tail of a capped group: what is left, and the way to it.
            if (match.type === 'group-more') {
                const mySelectableIndex = this.matchElements.length;
                const moreEl = document.createElement('div');
                const selectedClass = mySelectableIndex === this.selectedMatchIndex ? ' keyboard-selected' : '';
                moreEl.className = `search-group-more command-group-child${selectedClass}`;
                moreEl.setAttribute('tabindex', mySelectableIndex === this.selectedMatchIndex ? '0' : '-1');
                moreEl.innerHTML = `
                    <span class="search-group-more-arrow">▾</span>
                    <span class="search-group-more-label">${this._escHtml(match.label)}</span>
                `;
                moreEl.addEventListener('click', () => {
                    this.showAllInGroup(match.groupId);
                    this.updateSearch();
                });
                this._bindMatchKeyboardActivate(moreEl, mySelectableIndex);
                fragment.appendChild(moreEl);
                this.matchElements.push(moreEl);
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
                this._bindMatchKeyboardActivate(chipRow, mySelectableIndex);
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
            } else if (match.type === 'mode-hint') {
                displayName = this._escHtml(match.label || '');
            } else {
                displayName = this._escHtml(match.name || '');
            }

            // For fuzzy/global search, don't show shortcut span to avoid empty space.
            // The mode hint has no shortcut either: it is a sentence about the
            // search, not a thing that can be opened.
            let shortcutHtml = '';
            if (match.type !== 'fuzzy' && match.type !== 'global-search' && match.type !== 'mode-hint') {
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
                } else if (match.type === 'finder') {
                    this.recordSearchHistory(this.currentQuery);
                    match.action();
                    this.closeSearch();
                } else if (match.type === 'finder-completion') {
                    this.currentQuery = match.completion;
                    this.updateSearch();
                    this.selectedMatchIndex = 0; // Auto-select first match after completion
                    this.updateSelectionHighlight(); // Update visual selection
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
                } else if (match.type === 'whats-new') {
                    this.closeSearch();
                    window.openWhatsNewModal?.({ force: true });
                } else {
                    this.openBookmark(match.bookmark);
                }
            });
            this._bindMatchKeyboardActivate(matchElement, mySelectableIndex);

            fragment.appendChild(matchElement);
            this.matchElements.push(matchElement);
            this.selectableMatches.push(match);
        });
        
        // Batch append to DOM
        matchesContainer.appendChild(fragment);
        this.updateSelectionHighlight();
        if (this.searchActive) {
            requestAnimationFrame(() => this.focusSearchPanel());
        }
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

    selectCurrentMatch({ newTab = false } = {}) {
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
            if (selectedMatch.type === 'group-more') {
                this.showAllInGroup(selectedMatch.groupId);
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
            } else if (selectedMatch.type === 'finder') {
                this.recordSearchHistory(this.currentQuery);
                selectedMatch.action();
                this.closeSearch();
            } else if (selectedMatch.type === 'finder-completion') {
                this.currentQuery = selectedMatch.completion;
                this.updateSearch();
                this.selectedMatchIndex = 0; // Auto-select first match after completion
                this.updateSelectionHighlight(); // Update visual selection
            } else if (selectedMatch.type === 'fuzzy') {
                this.recordSearchHistory(this.currentQuery);
                selectedMatch.action();
                this.closeSearch();
            } else if (selectedMatch.type === 'mode-hint') {
                // Do the thing the hint describes rather than only naming it:
                // Enter or a click runs the same query the other way.
                this.currentQuery = `/${selectedMatch.query}`;
                this.updateSearch();
                this.selectedMatchIndex = 0;
                this.updateSelectionHighlight();
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
            } else if (selectedMatch.type === 'whats-new') {
                this.closeSearch();
                window.openWhatsNewModal?.({ force: true });
            } else if (selectedMatch.type === 'hint-new' || selectedMatch.type === 'hint-finder') {
                selectedMatch.action?.();
            } else {
                this.openBookmark(selectedMatch.bookmark, { newTab });
            }
        }
        // If no matches, do nothing (keep search open)
    }

    openBookmark(bookmark, { newTab = false } = {}) {
        this.recordSearchHistory(this.currentQuery);
        // The other half of the same fact: the history keeps what was typed,
        // this keeps what it turned out to mean.
        this.recordSearchPick(bookmark);
        // Opening from search went uncounted before: it bypasses the dashboard row
        // handler that normally records the open. Attribute it to the search source.
        window.dashboardInstance?.recordBookmarkOpened?.(bookmark, undefined, 'search');

        // Close search first if it's active
        if (this.searchActive) {
            this.closeSearch();
        }

        if (this._openBookmarkTimer) {
            clearTimeout(this._openBookmarkTimer);
            this._openBookmarkTimer = null;
        }

        // Small delay to ensure search is closed before opening bookmark
        this._openBookmarkTimer = setTimeout(() => {
            this._openBookmarkTimer = null;
            // Check if HyprMode is enabled
            if (window.hyprMode && window.hyprMode.isEnabled()) {
                window.hyprMode.handleBookmarkClick(bookmark.url);
            } else {
                // Create a link element to open the URL with rel attributes to prevent Referer leakage
                const link = document.createElement('a');
                link.href = bookmark.url;
                link.style.display = 'none'; // Hide the link
                // newTab forces it whatever the setting says — the same
                // promise Ctrl/Cmd+Enter makes on the grid.
                if (newTab || this.settings.openInNewTab) {
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
        this.commandsComponent.resetState();
        this.currentQuery = `tag:${normalized}`;
        this.selectedMatchIndex = 0;
        this.updateSearch();
        if (!this.searchActive) {
            this.showSearch();
        }
    }

    /**
     * Open search on a query someone arrived with.
     *
     * The tag opener beside this one takes a filter; this takes what a person
     * typed somewhere else — the browser's address bar, a link they were sent,
     * a bookmark of a search they run often. Same three steps, because the
     * palette does not care where a query came from.
     */
    openSearchWithQuery(query) {
        const text = String(query || '').trim();
        if (!text) {
            // An address with no term still means "open search", which is what
            // the palette does with an empty query anyway.
            this.openSearchInterface();
            if (!this.searchActive) this.showSearch();
            return;
        }
        this.commandsComponent.resetState();
        this.currentQuery = text;
        this.selectedMatchIndex = 0;
        this.updateSearch();
        this._widenArrivedQueryToNames(text);
        if (!this.searchActive) {
            this.showSearch();
        }
    }

    /**
     * Add the name matches an arrived query would otherwise never see.
     *
     * Which mode a bare query gets is a setting, and with the default —
     * *Switch Search Mode* off — a bare query looks for a shortcut. That is a
     * fair bargain while someone is typing, because they can still press `/`. It is the wrong one for a query that arrives already written:
     * the address bar (see opensearch.go), a deep link, a URL someone was
     * sent. Nobody types a bookmark's full name into their address bar hoping
     * to match a two-letter shortcut, and the failure is silent — the overlay
     * opens on a query the reader cannot revise and reports nothing found.
     *
     * The shortcut matches keep the top of the list: an exact shortcut is the
     * strongest signal there is, and leading with it costs the name matches
     * nothing now that they are present at all. Only plain queries are widened
     * — a prefix (`:`, `?`, `@`, `/`) or a filter means the query already
     * says what it wants.
     */
    _widenArrivedQueryToNames(text) {
        if (!this._isNormalSearchMode || !this._isNormalSearchMode()) {
            return;
        }
        if (/^[/;:?@>]/.test(text)) {
            return;
        }
        const parsed = this.parseSearchFilters(text);
        if (!parsed.query || this._hasActiveFilters(parsed.filters)) {
            return;
        }
        const fuzzy = this.fuzzySearchComponent?.handleFuzzy?.(parsed.query, this.bookmarks) || [];
        if (fuzzy.length === 0) {
            return;
        }
        const seen = new Set(
            (this.searchMatches || [])
                .map((match) => match.bookmark?.url)
                .filter(Boolean),
        );
        for (const match of fuzzy) {
            const url = match.bookmark?.url;
            if (!url || seen.has(url)) {
                continue;
            }
            seen.add(url);
            this.searchMatches.push({ ...match, type: 'bookmark', query: parsed.query });
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
        // Mirrors the guard on the read side: storage can throw in private mode or
        // when the quota is full, and losing search history must not break search.
        try {
            localStorage.setItem('dashboardSearchHistory', JSON.stringify(this.searchHistory.slice(0, 15)));
        } catch {
            // Ignore storage errors.
        }
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
        try {
            localStorage.setItem('dashboardRecentCommands', JSON.stringify(this.recentCommands.slice(0, 5)));
        } catch {
            // Ignore storage errors.
        }
    }

    recordRecentCommand(query) {
        const cleanedQuery = (query || '').trim();
        if (!cleanedQuery.startsWith(':') || cleanedQuery === ':') {
            return;
        }

        this.recentCommands = [cleanedQuery, ...this.recentCommands.filter((entry) => entry !== cleanedQuery)].slice(0, 5);
        this.saveRecentCommands();
    }

    /**
     * Report which command was run, so it is visible which of the ~50 commands
     * actually get used.
     *
     * The name is taken from the typed query and then checked against the
     * registered command list — that check is the point. The query is free text,
     * and match.shortcut cannot be used instead: for context commands (pin, move,
     * copy) it holds the *bookmark's* shortcut, which is user data. Anything not
     * matching a known command is dropped rather than sent.
     */
    _trackCommandUse(query) {
        const raw = String(query || '').trim();
        if (!raw.startsWith(':')) return;
        const name = raw.slice(1).split(/\s+/)[0].toLowerCase();
        if (!name) return;
        const known = this.commandsComponent?.availableCommands;
        if (!known || !Object.prototype.hasOwnProperty.call(known, name)) return;
        window.nextdashTrack?.('command', { name });
    }

    invokeCommand(match) {
        const queryBefore = this.currentQuery;
        this._trackCommandUse(queryBefore);
        const result = match.action();
        if (result && typeof result.then === 'function') {
            result.then((resolved) => this._finishCommandInvoke(queryBefore, match, resolved));
            return;
        }
        this._finishCommandInvoke(queryBefore, match, result);
    }

    _finishCommandInvoke(queryBefore, match, result) {
        if (result === false) {
            return;
        }

        this.recordRecentCommand(queryBefore);

        if (!this.searchActive || !this.currentQuery.startsWith(':')) {
            return;
        }

        if (result && typeof result === 'object' && result.navigate) {
            return;
        }
        if (result && typeof result === 'object' && result.refresh === false) {
            return;
        }

        const stateId = (result && typeof result === 'object' && result.stateId)
            || match.stateId
            || null;
        this.refreshCommandPaletteInPlace(stateId);
    }

    /** Re-render : command rows in place so toggles show updated on/off or ✓ markers. */
    refreshCommandPaletteInPlace(stateId) {
        if (!this.searchActive || !this.currentQuery.startsWith(':')) {
            return;
        }

        this.updateSearch();

        if (stateId) {
            const idx = this.selectableMatches.findIndex((entry) => entry.stateId === stateId);
            if (idx >= 0) {
                this.selectedMatchIndex = idx;
            }
        }

        this.updateSelectionHighlight();
        this._flashCommandMatch(this.selectedMatchIndex);
    }

    _flashCommandMatch(index) {
        const el = this.matchElements[index];
        if (!el || !el.classList.contains('command-entry')) {
            return;
        }
        el.classList.remove('command-just-applied');
        void el.offsetWidth;
        el.classList.add('command-just-applied');
        el.addEventListener('animationend', () => el.classList.remove('command-just-applied'), { once: true });
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

    /**
     * Saved searches, from settings.
     *
     * They used to live only in localStorage, so a documented feature vanished
     * on a cleared cache or a different browser — and, worst of all, sat in no
     * backup: a ZIP taken the same day did not contain them. They are now part
     * of settings.json, which the backup already carries. Any localStorage
     * entries left over from before are read once and migrated up.
     */
    loadSavedSearches() {
        const fromSettings = window.dashboardInstance?.settings?.savedSearches;
        if (Array.isArray(fromSettings) && fromSettings.length) {
            return fromSettings.filter((entry) => entry && entry.name && entry.query);
        }
        try {
            const stored = localStorage.getItem('dashboardSavedSearches');
            const legacy = stored ? JSON.parse(stored).filter((entry) => entry && entry.name && entry.query) : [];
            if (legacy.length) {
                // Migrate on first read, then let the server own them.
                this.savedSearches = legacy;
                void this.saveSavedSearches();
            }
            return legacy;
        } catch (error) {
            return [];
        }
    }

    /**
     * Persist saved searches. Returns whether it actually stuck.
     *
     * Unlike history and recent commands, this one is an explicit user action
     * ("save this search"), so a silent failure would leave them believing it
     * was kept. The caller reports the outcome instead of always claiming success.
     */
    saveSavedSearches() {
        const list = this.savedSearches.slice(0, 10);
        const d = window.dashboardInstance;
        if (d?.settings) {
            d.settings.savedSearches = list;
            // Fire and forget: saveSettings reports its own failures, and the
            // caller's outcome is about whether the entry was accepted here.
            void d.saveSettings?.();
            // Kept in localStorage as well, so an older tab still sees them.
            try { localStorage.setItem('dashboardSavedSearches', JSON.stringify(list)); } catch { /* ignore */ }
            return true;
        }
        try {
            localStorage.setItem('dashboardSavedSearches', JSON.stringify(list));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Save the current query. Returns true, or a reason string when it did not
     * happen: 'no-query' (nothing to save) or 'storage-failed' (private mode /
     * quota). The two need different messages — one is the user's situation, the
     * other is a real failure they would otherwise never hear about.
     */
    saveCurrentSearch(name = null) {
        const query = (this.lastNonCommandQuery || this.currentQuery || '').trim();
        if (!query) {
            return 'no-query';
        }

        const label = (name || query).trim();
        this.savedSearches = [
            { name: label, query },
            ...this.savedSearches.filter((entry) => entry.query !== query && entry.name !== label)
        ].slice(0, 10);
        return this.saveSavedSearches() ? true : 'storage-failed';
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