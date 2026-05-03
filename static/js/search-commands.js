// Search Commands Component JavaScript
class SearchCommandsComponent {
    constructor(language = null, currentBookmarks = [], allBookmarks = [], updateQueryCallback = null) {
        this.language = language;
        this.updateQueryCallback = updateQueryCallback;
        
        // Initialize :new command handler
        this.newCommandHandler = new SearchCommandNew(language);
        
        // Initialize :remove command handler
        this.removeCommandHandler = new SearchCommandRemove(language, updateQueryCallback);
        
        // Initialize :columns command handler
        this.columnsCommandHandler = new SearchCommandColumns(language);
        
        // Initialize :fontsize command handler
        this.fontSizeCommandHandler = new SearchCommandFontSize(language);
        
        // Initialize :theme command handler
        this.themeCommandHandler = new SearchCommandTheme(language);
        
        // Available commands
        this.availableCommands = {
            'new': this.handleNewCommand.bind(this),
            'remove': this.handleRemoveCommand.bind(this),
            'theme': this.handleThemeCommand.bind(this),
            'fontsize': this.handleFontSizeCommand.bind(this),
            'columns': this.handleColumnsCommand.bind(this),
            'save': this.handleSaveSearchCommand.bind(this),
            'saved': this.handleSavedSearchesCommand.bind(this),
            'sort': this.handleSortCommand.bind(this),
            'layout': this.handleLayoutCommand.bind(this),
            'density': this.handleDensityCommand.bind(this),
            'buttons': this.handleButtonsCommand.bind(this),
            'tips': this.handleTipsCommand.bind(this),
            'goto': this.handleGotoCommand.bind(this),
            'stale': this.handleStaleCommand.bind(this),
            'duplicate': this.handleDuplicateCommand.bind(this),
            'duplicates': this.handleDuplicateCommand.bind(this)
        };

        // Current page bookmarks and all bookmarks
        this.currentBookmarks = currentBookmarks;
        this.allBookmarks = allBookmarks;
    }

    setLanguage(language) {
        this.language = language;
        if (this.newCommandHandler) {
            this.newCommandHandler.setLanguage(language);
        }
        if (this.removeCommandHandler) {
            this.removeCommandHandler.setLanguage(language);
        }
        if (this.columnsCommandHandler) {
            this.columnsCommandHandler.setLanguage(language);
        }
        if (this.fontSizeCommandHandler) {
            this.fontSizeCommandHandler.setLanguage(language);
        }
        if (this.themeCommandHandler) {
            this.themeCommandHandler.setLanguage(language);
        }
    }

    /**
     * Set current page bookmarks and all bookmarks for remove command
     * @param {Array} currentBookmarks - Bookmarks from current page
     * @param {Array} allBookmarks - All bookmarks from all pages
     */
    setBookmarks(currentBookmarks, allBookmarks) {
        this.currentBookmarks = currentBookmarks;
        this.allBookmarks = allBookmarks;
        this.resetState();
        if (this.removeCommandHandler) {
            this.removeCommandHandler.setBookmarks(currentBookmarks, allBookmarks);
        }
    }

    /**
     * Reset internal state (confirmation mode, etc.)
     */
    resetState() {
        if (this.removeCommandHandler) {
            this.removeCommandHandler.resetState();
        }
        // Add other handlers if they have state
    }

    /**
     * Handle a command query
     * @param {string} query - The full query starting with ':'
     * @returns {Array} Array of match objects with name and action
     */
    handleCommand(query) {
        if (!query.startsWith(':')) {
            return [];
        }

        // If just ":", show available commands
        if (query === ':') {
            return this.getAvailableCommands();
        }

        const afterColon = query.slice(1).trimStart();
        if (afterColon.length === 0) {
            return this.getAvailableCommands();
        }
        const parts = afterColon.split(/\s+/);
        const potentialCommand = parts[0].toLowerCase();

        // Check if it's a complete command
        if (this.availableCommands[potentialCommand]) {
            return this.availableCommands[potentialCommand](parts.slice(1), query);
        }

        // Check if it's the start of a command
        const matchingCommands = Object.keys(this.availableCommands).filter(cmd => 
            cmd.startsWith(potentialCommand)
        );

        if (matchingCommands.length > 0) {
            return matchingCommands.map(commandName => ({
                name: '',
                shortcut: `:${commandName.toUpperCase()}`,
                completion: `:${commandName.toUpperCase()} `,
                type: 'command-completion'
            }));
        }

        return [];
    }

    /**
     * Get list of available commands
     * @returns {Array} Array of command matches
     */
    getAvailableCommands() {
        return Object.keys(this.availableCommands).map(commandName => ({
            name: '',
            shortcut: `:${commandName.toUpperCase()}`,
            completion: `:${commandName.toUpperCase()} `,
            type: 'command-completion'
        }));
    }

    /**
     * Handle the :theme command
     * @param {Array} args - Arguments after 'theme'
     * @param {string} fullQuery - The full query string
     * @returns {Array} Array of theme matches
     */
    handleThemeCommand(args, fullQuery) {
        return this.themeCommandHandler.handle(args);
    }

    /**
     * Handle the :fontsize command
     * @param {Array} args - Arguments after 'fontsize'
     * @param {string} fullQuery - The full query string
     * @returns {Array} Array of font size matches
     */
    handleFontSizeCommand(args, fullQuery) {
        return this.fontSizeCommandHandler.handle(args);
    }

    /**
     * Handle the :columns command
     * @param {Array} args - Arguments after 'columns'
     * @param {string} fullQuery - The full query string
     * @returns {Array} Array of column matches
     */
    handleColumnsCommand(args, fullQuery) {
        return this.columnsCommandHandler.handle(args);
    }

    handleSaveSearchCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        const searchComponent = dashboard ? dashboard.searchComponent : null;
        if (!searchComponent) {
            return [];
        }

        const label = args.join(' ').trim();
        const saved = searchComponent.saveCurrentSearch(label || null);
        if (!saved) {
            return [{ name: 'No active search to save', shortcut: ':SAVE', action: () => false, type: 'command' }];
        }

        return [{ name: `Saved search${label ? `: ${label}` : ''}`, shortcut: ':SAVE', action: () => false, type: 'command' }];
    }

    handleSavedSearchesCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        const searchComponent = dashboard ? dashboard.searchComponent : null;
        if (!searchComponent) {
            return [];
        }

        const savedSearches = searchComponent.getSavedSearchMatches();
        if (savedSearches.length === 0) {
            return [{ name: 'No saved searches yet', shortcut: ':SAVED', action: () => false, type: 'command' }];
        }

        return savedSearches.map((entry) => ({
            name: entry.name,
            shortcut: ':SAVED',
            completion: entry.completion,
            type: 'saved-search'
        }));
    }

    handleSortCommand(args, fullQuery) {
        const method = (args[0] || '').toLowerCase();
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const validMethods = ['order', 'az', 'recent', 'custom'];
        if (!method) {
            return validMethods.map((sortMethod) => ({
                name: sortMethod,
                shortcut: ':SORT',
                completion: `:sort ${sortMethod} `,
                type: 'command-completion'
            }));
        }

        if (!validMethods.includes(method)) {
            return [];
        }

        dashboard.settings.sortMethod = method;
        if (typeof dashboard.renderDashboard === 'function') {
            dashboard.renderDashboard();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }

        return [{ name: `Sorting set to ${method}`, shortcut: ':SORT', action: () => false, type: 'command' }];
    }

    handleLayoutCommand(args, fullQuery) {
        const layout = (args[0] || '').toLowerCase();
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const presets = window.LayoutUtils ? window.LayoutUtils.getLayoutPresets() : ['default', 'compact', 'cards', 'terminal', 'masonry', 'list', 'widgets'];
        if (!layout) {
            return presets.map((preset) => ({
                name: preset,
                shortcut: ':LAYOUT',
                action: () => this.applyLayoutPreset(dashboard, preset),
                type: 'command'
            }));
        }

        const matches = presets.filter((preset) => preset.startsWith(layout));
        if (matches.length === 0) return [];

        return matches.map((preset) => ({
            name: preset,
            shortcut: ':LAYOUT',
            action: () => this.applyLayoutPreset(dashboard, preset),
            type: 'command'
        }));
    }

    handleDensityCommand(args, fullQuery) {
        const density = (args[0] || '').toLowerCase();
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const densityModes = ['comfortable', 'compact', 'dense', 'auto'];
        if (!density) {
            return densityModes.map((mode) => ({
                name: mode,
                shortcut: ':DENSITY',
                action: () => this.applyDensityMode(dashboard, mode),
                type: 'command'
            }));
        }

        const matches = densityModes.filter((mode) => mode.startsWith(density));
        if (matches.length === 0) return [];

        return matches.map((mode) => ({
            name: mode,
            shortcut: ':DENSITY',
            action: () => this.applyDensityMode(dashboard, mode),
            type: 'command'
        }));
    }

    handleButtonsCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];

        const buttons = {
            commands: 'showCommandsButton',
            recent: 'showRecentButton',
            finders: 'showFindersButton',
            cheatsheet: 'showCheatSheetButton',
            search: 'showSearchButton'
        };

        const buttonName = (args[0] || '').toLowerCase();
        const stateArg = (args[1] || '').toLowerCase();

        if (!buttonName) {
            return Object.keys(buttons).map((name) => {
                const enabled = dashboard.settings[buttons[name]] !== false;
                return {
                    name: `${name} (${enabled ? 'on' : 'off'})`,
                    shortcut: ':BUTTONS',
                    action: () => this.toggleButtonVisibility(dashboard, buttons[name]),
                    type: 'command'
                };
            });
        }

        const matchingButtons = Object.keys(buttons).filter((name) => name.startsWith(buttonName));
        if (matchingButtons.length === 0) return [];

        const explicitState = stateArg === 'on' ? true : stateArg === 'off' ? false : null;

        return matchingButtons.map((name) => {
            const settingKey = buttons[name];
            const enabled = dashboard.settings[settingKey] !== false;
            return {
                name: `${name} (${enabled ? 'on' : 'off'})`,
                shortcut: ':BUTTONS',
                action: () => {
                    if (explicitState === null) {
                        return this.toggleButtonVisibility(dashboard, settingKey);
                    }
                    return this.setButtonVisibility(dashboard, settingKey, explicitState);
                },
                type: 'command'
            };
        });
    }

    handleTipsCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const stateArg = (args[0] || '').toLowerCase();
        const explicitState = stateArg === 'on' ? true : stateArg === 'off' ? false : null;
        const enabled = dashboard.settings.showTips !== false;

        const actions = [];
        if (!stateArg || 'on'.startsWith(stateArg)) {
            actions.push({
                name: `on (${enabled ? 'current' : 'off'})`,
                shortcut: ':TIPS',
                action: () => this.setTipsVisibility(dashboard, true),
                type: 'command'
            });
        }
        if (!stateArg || 'off'.startsWith(stateArg)) {
            actions.push({
                name: `off (${enabled ? 'on' : 'current'})`,
                shortcut: ':TIPS',
                action: () => this.setTipsVisibility(dashboard, false),
                type: 'command'
            });
        }

        if (actions.length > 0) {
            return actions;
        }

        if (explicitState === null) {
            return [];
        }

        return [{
            name: explicitState ? 'Tips enabled' : 'Tips disabled',
            shortcut: ':TIPS',
            action: () => this.setTipsVisibility(dashboard, explicitState),
            type: 'command'
        }];
    }

    applyLayoutPreset(dashboard, preset) {
        if (window.LayoutUtils) {
            window.LayoutUtils.applyLayoutPreset(dashboard.settings, preset, {
                syncDashboard: true,
                saveDashboard: true
            });
        } else {
            dashboard.settings.layoutPreset = preset;
            if (typeof dashboard.setupDOM === 'function') {
                dashboard.setupDOM();
            }
            if (typeof dashboard.saveSettings === 'function') {
                dashboard.saveSettings();
            }
        }
        return false;
    }

    applyDensityMode(dashboard, mode) {
        const densityMode = ['comfortable', 'compact', 'dense', 'auto'].includes(mode) ? mode : 'compact';
        dashboard.settings.densityMode = densityMode;

        if (typeof dashboard.setupDOM === 'function') {
            dashboard.setupDOM();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }

        return false;
    }

    toggleButtonVisibility(dashboard, settingKey) {
        const nextValue = dashboard.settings[settingKey] === false;
        return this.setButtonVisibility(dashboard, settingKey, nextValue);
    }

    setButtonVisibility(dashboard, settingKey, enabled) {
        dashboard.settings[settingKey] = enabled;
        if (typeof dashboard.setupDOM === 'function') {
            dashboard.setupDOM();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return false;
    }

    setTipsVisibility(dashboard, enabled) {
        dashboard.settings.showTips = enabled;
        if (typeof dashboard.initializeButtonTipsRotation === 'function') {
            dashboard.initializeButtonTipsRotation();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return false;
    }

    handleGotoCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard || !dashboard.searchComponent) {
            return [];
        }
        const scope = (args[0] || '').toLowerCase();

        if (scope === 'all') {
            const withUrl = (dashboard.allBookmarks || []).filter((b) => b && String(b.url || '').trim());
            if (withUrl.length === 0) {
                return [{
                    name: 'No bookmarks across pages',
                    shortcut: ':GOTO',
                    type: 'command',
                    action: () => {
                        dashboard.showNotification('Nothing to open.', 'info');
                        return true;
                    }
                }];
            }
            return [{
                name: 'Open random bookmark (all pages)',
                shortcut: ':GOTO',
                type: 'command',
                action: () => {
                    const pick = withUrl[Math.floor(Math.random() * withUrl.length)];
                    dashboard.searchComponent.openBookmark(pick);
                    return true;
                }
            }];
        }
        if (!scope) {
            const pagePool = (dashboard.bookmarks || []).filter((b) => b && String(b.url || '').trim());
            const anyAll = (dashboard.allBookmarks || []).some((b) => b && String(b.url || '').trim());
            if (pagePool.length === 0 && !anyAll) {
                return [{
                    name: 'No bookmarks available',
                    shortcut: ':GOTO',
                    type: 'command',
                    action: () => {
                        dashboard.showNotification('Nothing to open.', 'info');
                        return true;
                    }
                }];
            }
            const rows = [{
                name: 'Open random bookmark (this page)',
                shortcut: ':GOTO',
                type: 'command',
                action: () => {
                    const pool = (dashboard.bookmarks || []).filter((b) => b && String(b.url || '').trim());
                    if (pool.length === 0) {
                        dashboard.showNotification('No bookmarks on this page.', 'info');
                        return true;
                    }
                    const pick = pool[Math.floor(Math.random() * pool.length)];
                    dashboard.searchComponent.openBookmark(pick);
                    return true;
                }
            }];
            if (anyAll) {
                rows.push({
                    name: '',
                    shortcut: ':GOTO',
                    completion: ':goto all ',
                    type: 'command-completion'
                });
            }
            return rows;
        }
        if ('all'.startsWith(scope)) {
            return [{
                name: '',
                shortcut: ':GOTO',
                completion: ':goto all ',
                type: 'command-completion'
            }];
        }
        return [];
    }

    getStaleBookmarkPaletteRows(dashboard) {
        const stale = typeof dashboard.getStaleBookmarksList === 'function'
            ? dashboard.getStaleBookmarksList()
            : [];
        if (stale.length === 0) {
            return [{
                name: 'No stale bookmarks in scope',
                shortcut: ':STALE',
                type: 'command',
                action: () => true
            }];
        }
        const cap = 45;
        return stale.slice(0, cap).map((bookmark, i) => ({
            name: bookmark.name,
            shortcut: bookmark.shortcut && String(bookmark.shortcut).trim()
                ? String(bookmark.shortcut).trim()
                : `⌛${i + 1}`,
            bookmark,
            type: 'bookmark'
        }));
    }

    handleStaleCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }
        const a0 = (args[0] || '').toLowerCase();

        if (a0 === 'list') {
            return this.getStaleBookmarkPaletteRows(dashboard);
        }
        if (a0 && 'list'.startsWith(a0) && a0 !== 'list') {
            return [{
                name: '',
                shortcut: ':STALE',
                completion: ':stale list ',
                type: 'command-completion'
            }];
        }
        if (a0) {
            return [];
        }

        return [
            {
                name: 'Jump to Stale section (expand + scroll)',
                shortcut: ':STALE',
                type: 'command',
                action: () => {
                    if (typeof dashboard.scrollToStaleCollection === 'function') {
                        dashboard.scrollToStaleCollection();
                    }
                    return true;
                }
            },
            {
                name: '',
                shortcut: ':STALE',
                completion: ':stale list ',
                type: 'command-completion'
            }
        ];
    }

    handleDuplicateCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        const sub = (args[0] || '').toLowerCase().trim();

        if (sub === 'open' || sub === 'config') {
            return [{
                name: 'Open Config → Bookmarks',
                shortcut: ':DUPLICATE',
                type: 'command',
                action: () => {
                    window.location.href = '/config#bookmarks';
                    return true;
                }
            }];
        }

        if (sub === 'scan') {
            return [{
                name: 'Run duplicate scan',
                shortcut: ':DUPLICATE',
                type: 'command',
                action: () => {
                    this.runDuplicateScan(dashboard);
                    return true;
                }
            }];
        }

        if (sub && sub !== 'scan') {
            const dupPrefix = fullQuery.trim().toLowerCase().startsWith(':duplicates') ? ':duplicates' : ':duplicate';
            if ('open'.startsWith(sub) && sub !== 'open') {
                return [{
                    name: '',
                    shortcut: ':DUPLICATE',
                    completion: `${dupPrefix} open `,
                    type: 'command-completion'
                }];
            }
            if ('config'.startsWith(sub) && sub !== 'config') {
                return [{
                    name: '',
                    shortcut: ':DUPLICATE',
                    completion: `${dupPrefix} config `,
                    type: 'command-completion'
                }];
            }
            return [];
        }

        const trimmed = fullQuery.replace(/\s+$/, '');
        if (trimmed === ':duplicate' || trimmed === ':duplicates') {
            const dupPrefix = trimmed.startsWith(':duplicates') ? ':duplicates' : ':duplicate';
            return [
                {
                    name: 'Scan duplicate URLs (all pages)',
                    shortcut: ':DUPLICATE',
                    type: 'command',
                    action: () => {
                        this.runDuplicateScan(dashboard);
                        return true;
                    }
                },
                {
                    name: '',
                    shortcut: ':DUPLICATE',
                    completion: `${dupPrefix} open `,
                    type: 'command-completion'
                }
            ];
        }

        return [{
            name: 'Scan duplicate URLs (all pages)',
            shortcut: ':DUPLICATE',
            type: 'command',
            action: () => {
                this.runDuplicateScan(dashboard);
                return true;
            }
        }];
    }

    runDuplicateScan(dashboard) {
        fetch('/api/duplicates')
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Request failed'))))
            .then((data) => {
                const groups = Array.isArray(data.duplicateUrls) ? data.duplicateUrls : [];
                const groupCount = groups.length;
                let refCount = 0;
                groups.forEach((g) => {
                    if (Array.isArray(g.bookmarks)) refCount += g.bookmarks.length;
                });
                if (!dashboard || typeof dashboard.showNotification !== 'function') {
                    return;
                }
                if (groupCount === 0) {
                    dashboard.showNotification('No duplicate URLs found.', 'success');
                } else {
                    dashboard.showNotification(
                        `${groupCount} duplicate URL group(s), ${refCount} bookmark row(s). Use Config → Bookmarks to clean up.`,
                        'warning'
                    );
                }
            })
            .catch(() => {
                if (dashboard && typeof dashboard.showNotification === 'function') {
                    dashboard.showNotification('Duplicate scan failed.', 'error');
                }
            });
    }

    /**
     * Handle the :new command
     * Opens a modal to create a new bookmark
     * @param {Array} args - Arguments after 'new'
     * @param {string} fullQuery - The full query string
     * @returns {Array} Array with single action to open modal
     */
    handleNewCommand(args, fullQuery) {
        // Update context for the new command handler
        if (this.newCommandHandler && window.dashboardInstance) {
            const currentPageId = window.dashboardInstance.currentPageId || 1;
            const categories = window.dashboardInstance.categories || [];
            const pages = window.dashboardInstance.pages || [];
            this.newCommandHandler.setContext(currentPageId, categories, pages);
        }
        
        return this.newCommandHandler.handle(args);
    }

    /**
     * Handle the :remove command
     * Shows bookmarks from all pages by default, or current page if query contains '#'
     * When a bookmark is selected, shows Yes/No confirmation
     * @param {Array} args - Arguments after 'remove'
     * @param {string} fullQuery - The full query string
     * @returns {Array} Array of bookmark matches or confirmation options
     */
    handleRemoveCommand(args, fullQuery) {
        return this.removeCommandHandler.handle(args, fullQuery);
    }
}

// Export for use in other modules
window.SearchCommandsComponent = SearchCommandsComponent;