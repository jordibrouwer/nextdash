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

        // Initialize :note command handler
        this.noteCommandHandler = new SearchCommandNote(language);

        // Command groups (order matters — shown collapsed by default, max 5 for overview)
        this.commandGroups = [
            {
                id: 'bookmarks',
                label: 'Bookmarks',
                labelKey: 'commands.groupBookmarks',
                commands: [
                    'new', 'add', 'remove', 'note', 'pin', 'move', 'edit', 'copy', 'tag',
                    'open', 'goto', 'find', 'stale', 'duplicates',
                ],
            },
            {
                id: 'navigate-search',
                label: 'Search & navigate',
                labelKey: 'commands.groupNavigateSearch',
                commands: ['save', 'saved', 'history', 'sort', 'page', 'category', 'recent', 'overview', 'inbox', 'filter'],
            },
            {
                id: 'look-and-feel',
                label: 'Look & layout',
                labelKey: 'commands.groupLookAndFeel',
                commands: [
                    'theme', 'layoutversion', 'layout', 'density', 'columns', 'fontsize', 'buttonbar', 'packed',
                    'preview', 'favicons', 'title', 'opacity', 'animations', 'status', 'dark', 'lang', 'tips', 'buttons',
                ],
            },
            {
                id: 'collections',
                label: 'Smart collections',
                labelKey: 'commands.groupCollections',
                commands: ['collections'],
            },
            {
                id: 'settings-tools',
                label: 'Settings & tools',
                labelKey: 'commands.groupSettingsTools',
                commands: ['config', 'backup', 'export', 'metadata', 'health', 'reload', 'cheat', 'whatsnew', 'tour', 'promo'],
            },
        ];
        // Track which groups are expanded (none by default)
        this.expandedGroups = new Set();

        // Bookmark pre-selected via keyboard when : was pressed; used to pre-fill context commands
        this.contextBookmark = null;

        // Available commands
        this.availableCommands = {
            'new': this.handleNewCommand.bind(this),
            'remove': this.handleRemoveCommand.bind(this),
            'theme': this.handleThemeCommand.bind(this),
            'fontsize': this.handleFontSizeCommand.bind(this),
            'columns': this.handleColumnsCommand.bind(this),
            'save': this.handleSaveSearchCommand.bind(this),
            'saved': this.handleSavedSearchesCommand.bind(this),
            'history': this.handleHistoryCommand.bind(this),
            'sort': this.handleSortCommand.bind(this),
            'layoutversion': this.handleLayoutVersionCommand.bind(this),
            'layout': this.handleLayoutCommand.bind(this),
            'density': this.handleDensityCommand.bind(this),
            'buttons': this.handleButtonsCommand.bind(this),
            'tips': this.handleTipsCommand.bind(this),
            'favicons': this.handleFaviconCommand.bind(this),
            'preview': this.handlePreviewCardsCommand.bind(this),
            'previews': this.handlePreviewCardsCommand.bind(this),
            'packed': this.handlePackedColumnsCommand.bind(this),
            'buttonbar': this.handleButtonBarCommand.bind(this),
            'goto': this.handleGotoCommand.bind(this),
            'stale': this.handleStaleCommand.bind(this),
            'duplicates': this.handleDuplicateCommand.bind(this),
            'note': this.handleNoteCommand.bind(this),
            'pin': this.handlePinCommand.bind(this),
            'unpin': this.handlePinCommand.bind(this),
            'move': this.handleMoveCommand.bind(this),
            'edit': this.handleEditCommand.bind(this),
            'copy': this.handleCopyCommand.bind(this),
            'page': this.handlePageCommand.bind(this),
            'recent': this.handleRecentCommand.bind(this),
            'overview': this.handleOverviewCommand.bind(this),
            'inbox': this.handleInboxCommand.bind(this),
            'cheat': this.handleCheatCommand.bind(this),
            'whatsnew': this.handleWhatsNewCommand.bind(this),
            'add': this.handleAddCommand.bind(this),
            'config': this.handleConfigCommand.bind(this),
            'reload': this.handleReloadCommand.bind(this),
            'tag': this.handleTagCommand.bind(this),
            'category': this.handleCategoryCommand.bind(this),
            'open': this.handleOpenCommand.bind(this),
            'find': this.handleFindCommand.bind(this),
            'health': this.handleHealthCommand.bind(this),
            'dark': this.handleDarkCommand.bind(this),
            'title': this.handleTitleCommand.bind(this),
            'lang': this.handleLangCommand.bind(this),
            'animations': this.handleAnimationsCommand.bind(this),
            'status': this.handleStatusCommand.bind(this),
            'collections': this.handleCollectionsCommand.bind(this),
            'opacity': this.handleOpacityCommand.bind(this),
            'backup': this.handleBackupCommand.bind(this),
            'metadata': this.handleMetadataCommand.bind(this),
            'tour': this.handleTourCommand.bind(this),
            'promo': this.handlePromoCommand.bind(this),
            'filter': this.handleFilterCommand.bind(this),
            'export': this.handleExportCommand.bind(this),
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
        if (this.noteCommandHandler) {
            this.noteCommandHandler.setLanguage(language);
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
        this.resetTransientState();
        this.expandedGroups.clear();
        this.contextBookmark = null;
    }

    resetTransientState() {
        if (this.removeCommandHandler) {
            this.removeCommandHandler.resetState();
        }
    }

    _stateOnOff(enabled) {
        return enabled
            ? this._t('commands.stateOn', 'on')
            : this._t('commands.stateOff', 'off');
    }

    _markCurrent(label, isCurrent) {
        return isCurrent ? `${label} ✓` : label;
    }

    _sortModeLabel(method) {
        const key = method === 'az'
            ? 'commands.sortModeAz'
            : method === 'recent'
                ? 'commands.sortModeRecent'
                : 'commands.sortModeOrder';
        const fallback = method === 'az' ? 'A–Z' : method === 'recent' ? 'Recent' : 'Manual order';
        return this._t(key, fallback);
    }

    _formatSortPaletteLabel(method, categoryLabel) {
        const modeLabel = this._sortModeLabel(method);
        if (!categoryLabel) {
            return modeLabel;
        }
        const template = this._t('commands.sortForCategory', '{mode} — {category}');
        return template
            .replace('{mode}', modeLabel)
            .replace('{category}', categoryLabel);
    }

    _paletteRefresh(stateId, options = {}) {
        return {
            stateId,
            navigate: options.navigate === true,
            refresh: options.refresh !== false,
        };
    }

    _closeCommandPalette() {
        window.dashboardInstance?.searchComponent?.closeSearch?.();
    }

    _runOverlayAction(fn) {
        this._closeCommandPalette();
        fn();
        return { refresh: false };
    }

    _CONFIG_SECTIONS = [
        { id: 'general', labelKey: 'commands.configGeneral', fallback: 'General settings' },
        { id: 'colors', labelKey: 'commands.configColors', fallback: 'Theme & colors' },
        { id: 'pages', labelKey: 'commands.configPages', fallback: 'Pages' },
        { id: 'categories', labelKey: 'commands.configCategories', fallback: 'Categories' },
        { id: 'tags', labelKey: 'commands.configTags', fallback: 'Tags' },
        { id: 'bookmarks', labelKey: 'commands.configBookmarks', fallback: 'Bookmarks' },
        { id: 'finders', labelKey: 'commands.configFinders', fallback: 'Finders' },
        { id: 'collections', labelKey: 'commands.configCollections', fallback: 'Collections' },
        { id: 'backups', labelKey: 'commands.configBackups', fallback: 'Backups' },
        { id: 'stats', labelKey: 'commands.configStats', fallback: 'Stats' },
        { id: 'help', labelKey: 'commands.configHelp', fallback: 'Help & about' },
    ];

    _LANG_OPTIONS = [
        { id: 'en', labelKey: 'commands.langEn', fallback: 'English' },
        { id: 'nl', labelKey: 'commands.langNl', fallback: 'Nederlands' },
        { id: 'de', labelKey: 'commands.langDe', fallback: 'Deutsch' },
        { id: 'fr', labelKey: 'commands.langFr', fallback: 'Français' },
    ];

    _OPACITY_PRESETS = [0.65, 0.75, 0.85, 0.95, 1];

    _SMART_COLLECTIONS = [
        { id: 'today', settingKey: 'showSmartTodayCollection', labelKey: 'commands.collectionToday', fallback: 'Start today', defaultOn: true },
        { id: 'recent', settingKey: 'showSmartRecentCollection', labelKey: 'commands.collectionRecent', fallback: 'Recently opened', defaultOn: false },
        { id: 'stale', settingKey: 'showSmartStaleCollection', labelKey: 'commands.collectionStale', fallback: 'Stale bookmarks', defaultOn: false },
        { id: 'mostused', settingKey: 'showSmartMostUsedCollection', labelKey: 'commands.collectionMostUsed', fallback: 'Most used', defaultOn: false },
    ];

    _isSettingEnabled(settings, key, defaultOn = true) {
        const value = settings?.[key];
        if (typeof value === 'undefined') return defaultOn;
        return value !== false && value !== 0;
    }

    _smartCollectionEnabled(settings, entry) {
        const value = settings?.[entry.settingKey];
        if (typeof value === 'undefined') return entry.defaultOn;
        return value === true;
    }

    async _applyLanguage(dashboard, lang) {
        dashboard.settings.language = lang;
        if (dashboard.language?.init) {
            await dashboard.language.init(lang);
        }
        if (typeof dashboard.setupDOM === 'function') {
            dashboard.setupDOM();
        }
        if (typeof dashboard.updateSearchComponent === 'function') {
            dashboard.updateSearchComponent();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return this._paletteRefresh(`lang:${lang}`);
    }

    setAutoDarkMode(dashboard, enabled) {
        dashboard.settings.autoDarkMode = enabled;
        if (typeof dashboard.applyVisualSettings === 'function') {
            dashboard.applyVisualSettings();
        }
        if (typeof dashboard.setupDOM === 'function') {
            dashboard.setupDOM();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return this._paletteRefresh(enabled ? 'dark:on' : 'dark:off');
    }

    setTitleVisibility(dashboard, enabled) {
        dashboard.settings.showTitle = enabled;
        if (dashboard.visual?.updateTitleVisibility) {
            dashboard.visual.updateTitleVisibility();
        } else {
            document.body.setAttribute('data-show-title', enabled !== false);
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return this._paletteRefresh(enabled ? 'title:on' : 'title:off');
    }

    setAnimationsEnabled(dashboard, enabled) {
        dashboard.settings.animationsEnabled = enabled;
        if (typeof dashboard.applyVisualSettings === 'function') {
            dashboard.applyVisualSettings();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return this._paletteRefresh(enabled ? 'animations:on' : 'animations:off');
    }

    setStatusVisibility(dashboard, enabled) {
        dashboard.settings.showStatus = enabled;
        if (typeof dashboard.updateStatusMonitor === 'function') {
            dashboard.updateStatusMonitor();
        }
        if (typeof dashboard.setupDOM === 'function') {
            dashboard.setupDOM();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return this._paletteRefresh(enabled ? 'status:on' : 'status:off');
    }

    setBackgroundOpacity(dashboard, opacity) {
        const value = Math.min(1, Math.max(0.65, Number(opacity) || 1));
        dashboard.settings.backgroundOpacity = value;
        if (typeof dashboard.applyVisualSettings === 'function') {
            dashboard.applyVisualSettings();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return this._paletteRefresh(`opacity:${value}`);
    }

    setSmartCollectionVisibility(dashboard, entry, enabled) {
        dashboard.settings[entry.settingKey] = enabled;
        if (typeof dashboard.setupDOM === 'function') {
            dashboard.setupDOM();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return this._paletteRefresh(`collections:${entry.id}`);
    }

    async _downloadBackup() {
        const dashboard = window.dashboardInstance;
        try {
            const response = await fetch('/api/backup', {
                method: 'GET',
                headers: typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {},
            });
            if (!response.ok) {
                throw new Error(`Backup failed: ${response.status}`);
            }
            const now = new Date();
            const timestamp = now.toISOString().replace('T', '_').replace(/\..+/, '').replace(/:/g, '-');
            const filename = `nextDash-backup-${timestamp}.zip`;
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.style.display = 'none';
            anchor.href = url;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(anchor);
            try {
                localStorage.setItem('nextdash-last-backup', now.toISOString());
            } catch { /* ignore */ }
            dashboard?.showNotification?.(
                this._t('commands.exportDone', 'Backup downloaded'),
                'success'
            );
            return { refresh: false };
        } catch (error) {
            console.error('Backup export failed:', error);
            dashboard?.showNotification?.(
                this._t('commands.exportFailed', 'Backup download failed'),
                'error'
            );
            return false;
        }
    }

    _buildOnOffRows({ prefix, shortcut, enabled, apply }) {
        const rows = [];
        rows.push({
            name: `on (${enabled ? 'current' : this._stateOnOff(false)})`,
            shortcut,
            stateId: `${prefix}:on`,
            type: 'command',
            action: () => apply(true),
        });
        rows.push({
            name: `off (${enabled ? this._stateOnOff(true) : 'current'})`,
            shortcut,
            stateId: `${prefix}:off`,
            type: 'command',
            action: () => apply(false),
        });
        return rows;
    }

    _buildButtonRow(name, settingKey, dashboard, explicitState = null) {
        const enabled = dashboard.settings[settingKey] !== false;
        return {
            name: `${name} (${this._stateOnOff(enabled)})`,
            shortcut: ':BUTTONS',
            stateId: `buttons:${name}`,
            type: 'command',
            action: () => {
                const target = explicitState !== null ? explicitState : !enabled;
                return this.setButtonVisibility(dashboard, settingKey, target, name);
            },
        };
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
        let potentialCommand = parts[0].toLowerCase();
        // Accept common aliases but keep a single canonical command in palette lists.
        if (potentialCommand === 'favicon') potentialCommand = 'favicons';
        if (potentialCommand === 'duplicate') potentialCommand = 'duplicates';
        if (potentialCommand === 'previews') potentialCommand = 'preview';
        if (potentialCommand === 'unpin') potentialCommand = 'pin';
        if (potentialCommand === 'help') potentialCommand = 'cheat';
        if (potentialCommand === 'whats-new') potentialCommand = 'whatsnew';
        if (potentialCommand === 'cat') potentialCommand = 'category';
        if (potentialCommand === 'language') potentialCommand = 'lang';
        if (potentialCommand === 'animation') potentialCommand = 'animations';
        if (potentialCommand === 'collection') potentialCommand = 'collections';

        // :tag:humor shorthand (same as :tag humor / :tag tag:humor)
        const tagShorthand = potentialCommand.match(/^tag:(.+)$/i);
        if (tagShorthand && this.availableCommands.tag) {
            return this.availableCommands.tag([tagShorthand[1], ...parts.slice(1)], query);
        }

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

    toggleGroup(groupId) {
        if (this.expandedGroups.has(groupId)) {
            this.expandedGroups.delete(groupId);
        } else {
            this.expandedGroups.add(groupId);
        }
    }

    /**
     * Get list of available commands as collapsible groups
     * @returns {Array} Array of group headers and (if expanded) command rows
     */
    getAvailableCommands() {
        // Commands that act on a specific bookmark and benefit from a pre-filled name
        const bookmarkContextCmds = new Set(['remove', 'note', 'move', 'edit', 'copy']);
        const ctxName = this.contextBookmark ? this.contextBookmark.name : null;

        const result = [];
        const recent = typeof this.getRecentCommands === 'function' ? this.getRecentCommands() : [];
        const recentSlice = recent.slice(0, 5);
        if (recentSlice.length > 0) {
            result.push({
                type: 'command-group-header',
                groupId: 'palette_recent',
                label: this._t('commands.paletteRecentCommands', 'Recent commands'),
                count: recentSlice.length,
                expanded: true,
            });
            result.push({
                type: 'command-chips',
                queries: recentSlice,
                _chipCount: recentSlice.length,
            });
        }

        for (const group of this.commandGroups) {
            const isExpanded = this.expandedGroups.has(group.id);
            result.push({
                type: 'command-group-header',
                groupId: group.id,
                label: this._t(group.labelKey, group.label),
                count: group.commands.length,
                expanded: isExpanded
            });
            if (isExpanded) {
                for (const cmd of group.commands) {
                    if (this.availableCommands[cmd]) {
                        const useCtx = ctxName && bookmarkContextCmds.has(cmd);
                        result.push({
                            name: useCtx ? ctxName : '',
                            shortcut: `:${cmd.toUpperCase()}`,
                            completion: useCtx
                                ? `:${cmd.toUpperCase()} ${ctxName}`
                                : `:${cmd.toUpperCase()} `,
                            type: 'command-completion',
                            groupId: group.id
                        });
                    }
                }
            }
        }
        return result;
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

    handleNoteCommand(args, fullQuery) {
        return this.noteCommandHandler.handle(args, this.currentBookmarks, this.allBookmarks);
    }

    _noBookmarkSelectionRow(shortcut) {
        return [{
            name: this._t('commands.tagNoSelection', 'No bookmark selected — navigate to one first'),
            shortcut,
            type: 'command',
            action: () => ({ refresh: false }),
        }];
    }

    _resolveBookmarkActionTarget() {
        const dash = window.dashboardInstance;
        const kn = dash?.keyboardNavigation;
        if (kn && kn.currentIndex >= 0 && kn.currentIndex < kn.navigableElements.length) {
            const row = kn.navigableElements[kn.currentIndex];
            const bookmark = typeof kn.getSelectedBookmark === 'function' ? kn.getSelectedBookmark() : null;
            if (row && bookmark) {
                const bookmarkIndex = parseInt(row.dataset.bookmarkIndex ?? '-1', 10);
                return {
                    row,
                    bookmark,
                    bookmarkIndex: Number.isFinite(bookmarkIndex) ? bookmarkIndex : -1,
                };
            }
        }

        const ctx = this.contextBookmark;
        const url = String(ctx?.url || '').trim();
        if (!ctx || !url || !dash) {
            return null;
        }

        const rows = document.querySelectorAll('#dashboard-layout .bookmark-link[data-bookmark-url]');
        for (const row of rows) {
            const rowUrl = String(row.getAttribute('data-bookmark-url') || '').trim();
            if (!rowUrl) continue;
            const sameUrl = rowUrl === url;
            const sameName = !ctx.name || String(ctx.name) === String(
                (dash.bookmarks || []).find((b) => String(b.url || '').trim() === rowUrl)?.name || ''
            );
            if (!sameUrl) continue;
            const bookmarkIndex = parseInt(row.dataset.bookmarkIndex ?? '-1', 10);
            const bookmark = Number.isFinite(bookmarkIndex) && bookmarkIndex >= 0
                ? (dash.bookmarks || [])[bookmarkIndex]
                : ctx;
            return {
                row,
                bookmark: bookmark || ctx,
                bookmarkIndex: Number.isFinite(bookmarkIndex) ? bookmarkIndex : -1,
            };
        }

        return { row: null, bookmark: ctx, bookmarkIndex: -1 };
    }

    _ensureKeyboardSelectionForRow(row) {
        const kn = window.dashboardInstance?.keyboardNavigation;
        if (!kn || !row) return;
        if (typeof kn.updateNavigableElements === 'function') {
            kn.updateNavigableElements();
        }
        const idx = kn.navigableElements.indexOf(row);
        if (idx < 0) return;
        kn.currentIndex = idx;
        if (typeof kn.highlightCurrentElement === 'function') {
            kn.highlightCurrentElement();
        }
    }

    _copyUrlToClipboard(url, row) {
        const trimmed = String(url || '').trim();
        if (!trimmed) return false;

        const flashRow = () => {
            if (!row) return;
            row.classList.remove('bookmark-copy-flash');
            void row.offsetWidth;
            row.classList.add('bookmark-copy-flash');
            row.addEventListener('animationend', () => row.classList.remove('bookmark-copy-flash'), { once: true });
        };

        const done = () => {
            flashRow();
            const dash = window.dashboardInstance;
            if (dash?.showNotification) {
                const raw = this.language?.t?.('dashboard.urlCopied');
                const msg = raw && raw !== 'dashboard.urlCopied' ? raw : 'URL copied';
                dash.showNotification(msg, 'success', { duration: 2000 });
            }
        };

        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(trimmed).then(done).catch(() => {
                const ta = document.createElement('textarea');
                ta.value = trimmed;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch { /* ignore */ }
                document.body.removeChild(ta);
                done();
            });
            return true;
        }

        const ta = document.createElement('textarea');
        ta.value = trimmed;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch { /* ignore */ }
        document.body.removeChild(ta);
        done();
        return true;
    }

    handleMoveCommand(args, fullQuery) {
        const dash = window.dashboardInstance;
        if (!dash) return [];

        const target = this._resolveBookmarkActionTarget();
        if (!target?.bookmark) {
            return this._noBookmarkSelectionRow(':MOVE');
        }

        const name = target.bookmark.name || target.bookmark.url || '';
        return [{
            name: this._t('commands.moveLabel', 'Move "{name}"…').replace('{name}', name),
            shortcut: ':MOVE',
            stateId: 'move',
            type: 'command',
            action: () => {
                if (target.row) {
                    this._ensureKeyboardSelectionForRow(target.row);
                    if (typeof dash.showMovePopover === 'function') {
                        dash.showMovePopover(target.row, target.bookmark, target.bookmarkIndex);
                    } else {
                        dash.keyboardNavigation?.openMovePopoverForCurrent?.();
                    }
                } else {
                    dash.keyboardNavigation?.openMovePopoverForCurrent?.();
                }
                return { refresh: false };
            },
        }];
    }

    handleEditCommand(args, fullQuery) {
        const dash = window.dashboardInstance;
        if (!dash) return [];

        const target = this._resolveBookmarkActionTarget();
        if (!target?.bookmark) {
            return this._noBookmarkSelectionRow(':EDIT');
        }

        const name = target.bookmark.name || target.bookmark.url || '';
        return [{
            name: this._t('commands.editLabel', 'Edit "{name}"').replace('{name}', name),
            shortcut: ':EDIT',
            stateId: 'edit',
            type: 'command',
            action: () => {
                if (target.row) {
                    this._ensureKeyboardSelectionForRow(target.row);
                }
                const opened = typeof dash.tryOpenInlineBookmarkEdit === 'function'
                    && dash.tryOpenInlineBookmarkEdit();
                if (!opened) {
                    return false;
                }
                return { refresh: false };
            },
        }];
    }

    handleCopyCommand(args, fullQuery) {
        const dash = window.dashboardInstance;
        if (!dash) return [];

        const target = this._resolveBookmarkActionTarget();
        if (!target?.bookmark) {
            return this._noBookmarkSelectionRow(':COPY');
        }

        const name = target.bookmark.name || target.bookmark.url || '';
        const url = String(target.bookmark.url || '').trim();
        return [{
            name: this._t('commands.copyLabel', 'Copy URL — {name}').replace('{name}', name),
            shortcut: ':COPY',
            stateId: 'copy',
            type: 'command',
            action: () => {
                if (this._copyUrlToClipboard(url, target.row)) {
                    return { refresh: false };
                }
                return false;
            },
        }];
    }

    handlePageCommand(args, fullQuery) {
        const dash = window.dashboardInstance;
        if (!dash?.pages?.length) {
            return [];
        }

        const query = args.join(' ').trim();
        if (!query) {
            return dash.pages.map((page, index) => {
                const label = page.name || `Page ${index + 1}`;
                const isCurrent = dash.samePageId(page.id, dash.currentPageId);
                return {
                    name: this._markCurrent(label, isCurrent),
                    shortcut: ':PAGE',
                    stateId: `page:${page.id}`,
                    meta: String(index + 1),
                    type: 'command',
                    action: () => this._switchPage(dash, page.id),
                };
            });
        }

        const parsed = parseInt(query, 10);
        if (Number.isFinite(parsed) && parsed >= 1 && parsed <= dash.pages.length && String(parsed) === query) {
            const page = dash.pages[parsed - 1];
            return [{
                name: page.name || `Page ${parsed}`,
                shortcut: ':PAGE',
                stateId: `page:${page.id}`,
                type: 'command',
                action: () => this._switchPage(dash, page.id),
            }];
        }

        const q = query.toLowerCase();
        const matches = dash.pages.filter((page) => {
            const name = String(page.name || '').toLowerCase();
            return name.includes(q) || String(page.id) === query;
        });

        if (matches.length === 0) {
            return [];
        }

        return matches.map((page) => {
            const isCurrent = dash.samePageId(page.id, dash.currentPageId);
            return {
                name: this._markCurrent(page.name || `Page ${page.id}`, isCurrent),
                shortcut: ':PAGE',
                stateId: `page:${page.id}`,
                type: 'command',
                action: () => this._switchPage(dash, page.id),
            };
        });
    }

    async _switchPage(dashboard, pageId) {
        if (dashboard.samePageId(pageId, dashboard.currentPageId)) {
            return this._paletteRefresh(`page:${pageId}`);
        }
        try {
            await dashboard.requestPageNavigation(pageId);
        } catch {
            return false;
        }
        return this._paletteRefresh(`page:${pageId}`);
    }

    handleRecentCommand(args, fullQuery) {
        const dash = window.dashboardInstance;
        if (!dash) return [];

        return [{
            name: this._t('commands.recentLabel', 'Open recent bookmarks'),
            shortcut: ':RECENT',
            type: 'command',
            action: () => this._runOverlayAction(() => dash.toggleRecentBookmarksModal()),
        }];
    }

    handleOverviewCommand(args, fullQuery) {
        const dash = window.dashboardInstance;
        if (!dash?.pages?.length) {
            return [];
        }

        return [{
            name: this._t('commands.overviewLabel', 'Page overview'),
            shortcut: ':OVERVIEW',
            type: 'command',
            action: () => {
                this._closeCommandPalette();
                return dash.showPageOverlay().then(() => ({ refresh: false }));
            },
        }];
    }

    handleInboxCommand(args, fullQuery) {
        const dash = window.dashboardInstance;
        const inbox = dash?.inbox;
        if (!inbox?.isEnabled?.()) {
            return [{
                name: this._t('commands.inboxDisabled', 'Inbox is disabled in settings'),
                shortcut: ':INBOX',
                type: 'command',
                action: () => ({ refresh: false }),
            }];
        }

        const sub = String(args[0] || '').trim().toLowerCase();
        if (!sub || sub === 'open') {
            return [{
                name: this._t('commands.inboxOpenLabel', 'Open Inbox page'),
                shortcut: ':INBOX',
                type: 'command',
                action: () => this._runOverlayAction(async () => {
                    await inbox.openInboxView();
                }),
            }];
        }
        if (sub === 'triage' || sub.startsWith('triage')) {
            return [{
                name: this._t('commands.inboxTriageLabel', 'Triage inbox items'),
                shortcut: ':INBOX TRIAGE',
                type: 'command',
                action: () => this._runOverlayAction(async () => {
                    await inbox.startTriage();
                }),
            }];
        }
        if ('triage'.startsWith(sub)) {
            return [{
                name: '',
                shortcut: ':INBOX',
                completion: ':inbox triage ',
                type: 'command-completion',
            }];
        }
        return [{
            name: '',
            shortcut: ':INBOX',
            completion: ':inbox ',
            type: 'command-completion',
        }];
    }

    handleCheatCommand(args, fullQuery) {
        const dash = window.dashboardInstance;
        if (!dash) return [];

        return [{
            name: this._t('commands.cheatLabel', 'Keyboard cheat sheet'),
            shortcut: ':CHEAT',
            type: 'command',
            action: () => this._runOverlayAction(() => dash.showKeyboardCheatSheet()),
        }];
    }

    handleWhatsNewCommand(args, fullQuery) {
        return [{
            name: this._t('commands.whatsNewLabel', "What's new"),
            shortcut: ':WHATSNEW',
            type: 'command',
            action: () => this._runOverlayAction(() => {
                window.openWhatsNewModal?.({ force: true });
            }),
        }];
    }

    handleAddCommand(args, fullQuery) {
        const dash = window.dashboardInstance;
        if (!dash) return [];

        return [{
            name: this._t('commands.addLabel', 'Quick-add bookmark line'),
            shortcut: ':ADD',
            type: 'command',
            action: () => this._runOverlayAction(() => dash.showOmnibox()),
        }];
    }

    handleReloadCommand(args, fullQuery) {
        return [{
            name: this._t('commands.reloadLabel', 'Reload dashboard'),
            shortcut: ':RELOAD',
            type: 'command',
            action: () => {
                this._closeCommandPalette();
                window.location.reload();
                return { navigate: true };
            },
        }];
    }

    handleConfigCommand(args, fullQuery) {
        const dash = window.dashboardInstance;
        if (!dash) return [];

        const query = args.join(' ').trim().toLowerCase();
        const sectionRow = (section) => ({
            name: this._t(section.labelKey, section.fallback),
            shortcut: ':CONFIG',
            type: 'command',
            action: () => {
                this._closeCommandPalette();
                window.location.href = `/config#${section.id}`;
                return { navigate: true };
            },
        });

        if (!query) {
            return [
                {
                    name: this._t('commands.configOpen', 'Open config'),
                    shortcut: ':CONFIG',
                    type: 'command',
                    action: () => {
                        this._closeCommandPalette();
                        window.location.href = '/config';
                        return { navigate: true };
                    },
                },
                ...this._CONFIG_SECTIONS.map((section) => ({
                    name: this._t(section.labelKey, section.fallback),
                    shortcut: ':CONFIG',
                    completion: `:config ${section.id} `,
                    type: 'command-completion',
                })),
            ];
        }

        const exact = this._CONFIG_SECTIONS.find((section) => section.id === query);
        if (exact) {
            return [sectionRow(exact)];
        }

        const matches = this._CONFIG_SECTIONS.filter((section) => (
            section.id.startsWith(query) || section.id.includes(query)
        ));
        if (matches.length === 0) {
            return [];
        }

        return matches.map((section) => sectionRow(section));
    }

    // ─── :pin / :unpin ────────────────────────────────────────────────────────

    handlePinCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];
        const isUnpin = fullQuery.trimStart().startsWith(':unpin');
        const ctx = this.contextBookmark;

        if (!ctx) {
            return [{
                name: this._t('commands.tagNoSelection', 'No bookmark selected — navigate to one first'),
                shortcut: isUnpin ? ':UNPIN' : ':PIN',
                action: () => true,
                type: 'command'
            }];
        }

        const currentlyPinned = Boolean(ctx.pinned);
        const willPin = isUnpin ? false : !currentlyPinned;
        const name = ctx.name || ctx.url || '';
        const label = willPin
            ? this._t('commands.pinLabel', 'Pin "{name}"').replace('{name}', name)
            : this._t('commands.unpinLabel', 'Unpin "{name}"').replace('{name}', name);

        return [{
            name: `${label} (${this._stateOnOff(currentlyPinned)})`,
            shortcut: isUnpin ? ':UNPIN' : ':PIN',
            stateId: 'pin',
            type: 'command',
            action: () => {
                ctx.pinned = willPin;
                this._persistBookmarkField(ctx, { pinned: willPin });
                return this._paletteRefresh('pin');
            }
        }];
    }

    // ─── :tag (browse by tag in palette; +/− mutates focused bookmark) ───────

    _t(key, fallback) {
        const v = this.language?.t?.(key);
        return v && v !== key ? v : fallback;
    }

    _normalizeTagQuery(raw) {
        let s = String(raw || '').trim().toLowerCase();
        if (s.startsWith('tag:')) {
            s = s.slice(4).trim();
        }
        return s;
    }

    _getTagBookmarkPool() {
        const dash = window.dashboardInstance;
        if (!dash) return [];
        if (dash.settings?.globalShortcuts && Array.isArray(dash.allBookmarks) && dash.allBookmarks.length) {
            return dash.allBookmarks;
        }
        const seen = new Set();
        const out = [];
        for (const bookmark of [...(this.currentBookmarks || []), ...(this.allBookmarks || [])]) {
            const url = String(bookmark?.url || '').trim();
            if (!url || seen.has(url)) continue;
            seen.add(url);
            out.push(bookmark);
        }
        return out;
    }

    _getRankedTags() {
        const counts = new Map();
        for (const bookmark of this._getTagBookmarkPool()) {
            for (const raw of bookmark?.tags || []) {
                const tag = String(raw || '').trim().toLowerCase();
                if (!tag) continue;
                counts.set(tag, (counts.get(tag) || 0) + 1);
            }
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }

    _bookmarkMatchesTagQuery(bookmark, tagQuery) {
        const q = this._normalizeTagQuery(tagQuery);
        if (!q) return false;
        return (bookmark?.tags || []).some((tag) => String(tag).toLowerCase().includes(q));
    }

    _getTagNameCompletionRows(partial) {
        const q = this._normalizeTagQuery(partial);
        const ranked = this._getRankedTags();
        const filtered = q
            ? ranked.filter(([tag]) => tag.includes(q))
            : ranked;
        return filtered.slice(0, 16).map(([tag, count]) => {
            const countLabel =
                count === 1
                    ? this._t('commands.tagBookmarkCountOne', '1 bookmark')
                    : this._t('commands.tagBookmarkCountMany', '{count} bookmarks').replace('{count}', String(count));
            return {
                name: `#${tag}`,
                shortcut: ':TAG',
                completion: `:tag ${tag} `,
                type: 'command-completion',
                meta: countLabel,
            };
        });
    }

    _getTagBrowseBookmarkRows(tagQuery) {
        const q = this._normalizeTagQuery(tagQuery);
        const matches = this._getTagBookmarkPool().filter((bookmark) => this._bookmarkMatchesTagQuery(bookmark, q));
        const cap = 45;
        const dash = window.dashboardInstance;

        if (!matches.length) {
            return [{
                name: this._t('commands.tagNoBookmarks', 'No bookmarks with tag “{tag}”').replace('{tag}', q || tagQuery),
                shortcut: ':TAG',
                type: 'command',
                action: () => true,
            }];
        }

        const rows = matches.slice(0, cap).map((bookmark, i) => {
            const tags = (bookmark.tags || []).filter((t) => String(t).toLowerCase().includes(q));
            return {
                name: bookmark.name || bookmark.url,
                shortcut:
                    bookmark.shortcut && String(bookmark.shortcut).trim()
                        ? String(bookmark.shortcut).trim()
                        : `#${i + 1}`,
                bookmark,
                type: 'bookmark',
                meta: tags.map((t) => `#${t}`).join(' '),
            };
        });

        if (matches.length > cap) {
            rows.push({
                name: this._t('commands.tagBrowseTruncated', 'Showing {shown} of {total} — refine the tag name')
                    .replace('{shown}', String(cap))
                    .replace('{total}', String(matches.length)),
                shortcut: '…',
                type: 'command',
                action: () => true,
            });
        }

        return rows;
    }

    _handleTagMutate(rawName, forceAdd) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];
        const ctx = this.contextBookmark;
        const tagName = this._normalizeTagQuery(rawName);

        if (!ctx) {
            return [{
                name: this._t('commands.tagNoSelection', 'No bookmark selected — navigate to one first'),
                shortcut: ':TAG',
                action: () => true,
                type: 'command',
            }];
        }

        if (!tagName) {
            return [{
                name: this._t('commands.tagMutateNeedName', 'Type :tag +name or :tag -name to add or remove a tag'),
                shortcut: ':TAG',
                completion: ':tag +',
                type: 'command-completion',
            }];
        }

        const tags = Array.isArray(ctx.tags) ? [...ctx.tags] : [];
        const idx = tags.indexOf(tagName);
        const remove = forceAdd === false || (forceAdd !== true && idx >= 0);
        const newTags = remove ? tags.filter((t) => t !== tagName) : [...tags, tagName];
        const label = remove
            ? this._t('commands.tagRemoveLabel', 'Remove tag "#{tag}" from "{name}"')
                  .replace('{tag}', tagName)
                  .replace('{name}', ctx.name)
            : this._t('commands.tagAddLabel', 'Add tag "#{tag}" to "{name}"')
                  .replace('{tag}', tagName)
                  .replace('{name}', ctx.name);

        return [{
            name: label,
            shortcut: ':TAG',
            stateId: `tag:${tagName}`,
            type: 'command',
            action: () => {
                ctx.tags = newTags;
                this._persistBookmarkField(ctx, { tags: newTags });
                return this._paletteRefresh(`tag:${tagName}`);
            },
        }];
    }

    handleTagCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];

        const rawJoined = args.join(' ').trim();
        if (rawJoined.startsWith('+')) {
            return this._handleTagMutate(rawJoined.slice(1).trim(), true);
        }
        if (rawJoined.startsWith('-')) {
            return this._handleTagMutate(rawJoined.slice(1).trim(), false);
        }

        const tagQuery = this._normalizeTagQuery(
            args.map((part) => this._normalizeTagQuery(part)).filter(Boolean).join(' ') || rawJoined
        );

        if (!tagQuery) {
            const rows = this._getTagNameCompletionRows('');
            const ctx = this.contextBookmark;
            if (ctx) {
                const existing =
                    Array.isArray(ctx.tags) && ctx.tags.length
                        ? ctx.tags.map((t) => `#${t}`).join(' ')
                        : this._t('commands.tagNoneOnBookmark', 'none');
                rows.unshift({
                    name: `"${ctx.name}" — ${this._t('commands.tagCurrentOnBookmark', 'tags')}: ${existing}`,
                    shortcut: ':TAG',
                    completion: ':tag ',
                    type: 'command-completion',
                });
                rows.unshift({
                    name: this._t(
                        'commands.tagMutateHint',
                        'On this bookmark: :tag +name to add, :tag -name to remove'
                    ),
                    shortcut: ':TAG',
                    type: 'command',
                    action: () => true,
                });
            }
            if (!rows.length) {
                return [{
                    name: this._t('commands.tagLibraryEmpty', 'No tags yet — add tags in config → bookmarks'),
                    shortcut: ':TAG',
                    type: 'command',
                    action: () => true,
                }];
            }
            return rows;
        }

        const rows = [];
        const ranked = this._getRankedTags();
        const exactTag = ranked.some(([tag]) => tag === tagQuery);
        const prefixOnly = ranked.filter(([tag]) => tag.startsWith(tagQuery) && tag !== tagQuery);

        if (!exactTag && prefixOnly.length > 0) {
            rows.push(
                ...prefixOnly.slice(0, 8).map(([tag, count]) => {
                    const countLabel =
                        count === 1
                            ? this._t('commands.tagBookmarkCountOne', '1 bookmark')
                            : this._t('commands.tagBookmarkCountMany', '{count} bookmarks').replace(
                                  '{count}',
                                  String(count)
                              );
                    return {
                        name: `#${tag}`,
                        shortcut: ':TAG',
                        completion: `:tag ${tag} `,
                        type: 'command-completion',
                        meta: countLabel,
                    };
                })
            );
        }

        rows.push(...this._getTagBrowseBookmarkRows(tagQuery));
        return rows;
    }

    _getVisiblePageCategories() {
        const categories = [];
        document.querySelectorAll('.category[data-category-id]').forEach((el) => {
            if (el.getAttribute('data-collapsed') === 'true') {
                return;
            }
            const id = el.getAttribute('data-category-id') || '';
            const titleEl = el.querySelector('.category-title-name');
            const name = titleEl?.getAttribute('title')
                || titleEl?.textContent?.trim()
                || id;
            categories.push({
                id,
                name,
                index: categories.length + 1,
            });
        });
        return categories;
    }

    _jumpToCategoryIndex(dashboard, index) {
        dashboard?.keyboardNavigation?.jumpToCategory?.(index);
        this._closeCommandPalette();
        return { refresh: false };
    }

    handleCategoryCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];

        const query = args.join(' ').trim();
        const categories = this._getVisiblePageCategories();

        if (categories.length === 0) {
            return [{
                name: this._t('commands.categoryEmpty', 'No categories on this page'),
                shortcut: ':CATEGORY',
                type: 'command',
                action: () => ({ refresh: false }),
            }];
        }

        if (!query) {
            return categories.map((category) => ({
                name: category.name,
                shortcut: ':CATEGORY',
                meta: String(category.index),
                completion: `:category ${category.name} `,
                type: 'command-completion',
            }));
        }

        const parsed = parseInt(query, 10);
        if (Number.isFinite(parsed) && parsed >= 1 && parsed <= categories.length && String(parsed) === query) {
            const category = categories[parsed - 1];
            return [{
                name: category.name,
                shortcut: ':CATEGORY',
                meta: String(parsed),
                type: 'command',
                action: () => this._jumpToCategoryIndex(dashboard, parsed),
            }];
        }

        const q = query.toLowerCase();
        const matches = categories.filter((category) => {
            const name = String(category.name || '').toLowerCase();
            const id = String(category.id || '').toLowerCase();
            return name.includes(q) || id.includes(q);
        });

        if (matches.length === 0) {
            return [];
        }

        return matches.map((category) => ({
            name: category.name,
            shortcut: ':CATEGORY',
            meta: String(category.index),
            type: 'command',
            action: () => this._jumpToCategoryIndex(dashboard, category.index),
        }));
    }

    // ─── :open ────────────────────────────────────────────────────────────────

    static OPEN_TABS_CAP = 15;
    static OPEN_LAST_DEFAULT = 5;
    static OPEN_LAST_MAX = 50;

    _openTabsAction(bookmarks) {
        return () => {
            (bookmarks || []).forEach((b) => {
                const url = String(b?.url || '').trim();
                if (url) window.open(url, '_blank');
            });
            return { refresh: false };
        };
    }

    _buildOpenTabRows(bookmarks, labels) {
        const list = (bookmarks || []).filter((b) => b && String(b.url || '').trim());
        if (list.length === 0) return [];

        const cap = SearchCommandsComponent.OPEN_TABS_CAP;
        const rows = [];
        const n = list.length;

        if (n <= cap) {
            rows.push({
                name: labels.all(n),
                shortcut: ':OPEN',
                type: 'command',
                action: this._openTabsAction(list),
            });
        } else {
            rows.push({
                name: labels.first(cap, n),
                shortcut: ':OPEN',
                type: 'command',
                action: this._openTabsAction(list.slice(0, cap)),
            });
            rows.push({
                name: labels.all(n),
                shortcut: ':OPEN',
                type: 'command',
                action: this._openTabsAction(list),
            });
        }
        return rows;
    }

    _parseOpenLastCount(raw) {
        if (raw == null || raw === '') return SearchCommandsComponent.OPEN_LAST_DEFAULT;
        const n = parseInt(String(raw), 10);
        if (!Number.isFinite(n) || n < 1) return SearchCommandsComponent.OPEN_LAST_DEFAULT;
        return Math.min(n, SearchCommandsComponent.OPEN_LAST_MAX);
    }

    /** :open last — page-local only; see Dashboard.getRecentBookmarks (do not use allBookmarks). */
    _getRecentBookmarksForOpen(dashboard, count) {
        if (!dashboard || typeof dashboard.getRecentBookmarks !== 'function') return [];
        return dashboard.getRecentBookmarks(dashboard.bookmarks || [], count);
    }

    _openAllRows(dashboard) {
        const bookmarks = (dashboard.bookmarks || []).filter((b) => b && String(b.url || '').trim());
        if (bookmarks.length === 0) {
            return [{ name: 'No bookmarks on this page', shortcut: ':OPEN', action: () => true, type: 'command' }];
        }
        return this._buildOpenTabRows(bookmarks, {
            all: (n) => `Open all ${n} bookmark${n !== 1 ? 's' : ''} (${n} new tab${n !== 1 ? 's' : ''})`,
            first: (cap, total) => `Open first ${cap} of ${total} bookmarks (${cap} new tabs)`,
        });
    }

    _openLastRows(dashboard, requestedCount) {
        const recent = this._getRecentBookmarksForOpen(dashboard, requestedCount);
        const valid = recent.filter((b) => b && String(b.url || '').trim());
        if (valid.length === 0) {
            return [{
                name: 'No recently opened bookmarks on this page',
                shortcut: ':OPEN',
                action: () => true,
                type: 'command',
            }];
        }

        const labelCount = Math.min(requestedCount, valid.length);
        return this._buildOpenTabRows(valid, {
            all: (count) => `Open last ${labelCount} recent bookmark${count !== 1 ? 's' : ''} (${count} new tab${count !== 1 ? 's' : ''})`,
            first: (cap) => `Open first ${cap} of last ${labelCount} recent (${cap} new tabs)`,
        });
    }

    _openPinnedRows(dashboard) {
        const bookmarks = (dashboard.bookmarks || []).filter(
            (b) => b && b.pinned && String(b.url || '').trim()
        );
        if (bookmarks.length === 0) {
            return [{
                name: this._t('commands.openPinnedEmpty', 'No pinned bookmarks on this page'),
                shortcut: ':OPEN',
                type: 'command',
                action: () => ({ refresh: false }),
            }];
        }
        return this._buildOpenTabRows(bookmarks, {
            all: (n) => `Open ${n} pinned bookmark${n !== 1 ? 's' : ''} (${n} new tab${n !== 1 ? 's' : ''})`,
            first: (cap, total) => `Open first ${cap} of ${total} pinned (${cap} new tabs)`,
        });
    }

    _openTagNameCompletionRows() {
        return this._getTagNameCompletionRows('').map((row) => ({
            ...row,
            shortcut: ':OPEN',
            completion: row.completion.replace(':tag ', ':open tag '),
        }));
    }

    _bookmarksWithTagOnPage(dashboard, tagQuery) {
        const q = this._normalizeTagQuery(tagQuery);
        if (!q) return [];
        return (dashboard.bookmarks || []).filter((bookmark) => (
            bookmark
            && String(bookmark.url || '').trim()
            && (bookmark.tags || []).some((tag) => String(tag).toLowerCase() === q)
        ));
    }

    _openTagRows(dashboard, tagQuery) {
        const tagName = this._normalizeTagQuery(tagQuery);
        if (!tagName) {
            return this._openTagNameCompletionRows();
        }

        const bookmarks = this._bookmarksWithTagOnPage(dashboard, tagName);
        if (bookmarks.length === 0) {
            return [{
                name: this._t('commands.openTagEmpty', 'No bookmarks with tag “{tag}” on this page')
                    .replace('{tag}', tagName),
                shortcut: ':OPEN',
                type: 'command',
                action: () => ({ refresh: false }),
            }];
        }

        return this._buildOpenTabRows(bookmarks, {
            all: (n) => `Open ${n} bookmark${n !== 1 ? 's' : ''} with #${tagName} (${n} new tab${n !== 1 ? 's' : ''})`,
            first: (cap, total) => `Open first ${cap} of ${total} with #${tagName} (${cap} new tabs)`,
        });
    }

    _bookmarksInCategoryOnPage(dashboard, categoryQuery) {
        const q = String(categoryQuery || '').trim().toLowerCase();
        if (!q) return [];
        return (dashboard.bookmarks || []).filter((bookmark) => {
            if (!bookmark || !String(bookmark.url || '').trim()) return false;
            const category = String(bookmark.category || '').trim().toLowerCase();
            return category === q || category.includes(q);
        });
    }

    _openCategoryCompletionRows(dashboard) {
        return this._getVisiblePageCategories().map((category) => ({
            name: category.name,
            shortcut: ':OPEN',
            completion: `:open category ${category.name} `,
            type: 'command-completion',
            meta: String(category.index),
        }));
    }

    _openCategoryRows(dashboard, categoryQuery) {
        const query = String(categoryQuery || '').trim();
        if (!query) {
            return this._openCategoryCompletionRows(dashboard);
        }

        const categories = this._getVisiblePageCategories();
        const exactCategory = categories.find((category) => (
            String(category.name || '').toLowerCase() === query.toLowerCase()
            || String(category.id || '').toLowerCase() === query.toLowerCase()
        ));
        const categoryName = exactCategory?.name || query;
        const bookmarks = exactCategory
            ? (dashboard.bookmarks || []).filter((bookmark) => (
                bookmark
                && String(bookmark.url || '').trim()
                && String(bookmark.category || '').trim().toLowerCase()
                    === String(exactCategory.name || '').trim().toLowerCase()
            ))
            : this._bookmarksInCategoryOnPage(dashboard, query);

        if (bookmarks.length === 0) {
            return [{
                name: this._t('commands.openCategoryEmpty', 'No bookmarks in “{name}” on this page')
                    .replace('{name}', categoryName),
                shortcut: ':OPEN',
                type: 'command',
                action: () => ({ refresh: false }),
            }];
        }

        return this._buildOpenTabRows(bookmarks, {
            all: (n) => `Open ${n} in “${categoryName}” (${n} new tab${n !== 1 ? 's' : ''})`,
            first: (cap, total) => `Open first ${cap} of ${total} in “${categoryName}” (${cap} new tabs)`,
        });
    }

    handleOpenCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];
        const scope = (args[0] || '').toLowerCase();

        if (!scope) {
            const completions = [
                { name: '', shortcut: ':OPEN', completion: ':open all ', type: 'command-completion' },
                { name: '', shortcut: ':OPEN', completion: ':open pinned ', type: 'command-completion' },
                { name: '', shortcut: ':OPEN', completion: ':open tag ', type: 'command-completion' },
                { name: '', shortcut: ':OPEN', completion: ':open category ', type: 'command-completion' },
                { name: '', shortcut: ':OPEN', completion: ':open last ', type: 'command-completion' },
                { name: '', shortcut: ':OPEN', completion: ':open last 5 ', type: 'command-completion' },
            ];
            return completions;
        }

        if (scope === 'tag') {
            return this._openTagRows(dashboard, args.slice(1).join(' ').trim());
        }

        if (scope === 'category' || scope === 'cat') {
            return this._openCategoryRows(dashboard, args.slice(1).join(' ').trim());
        }

        if (scope === 'pinned' || scope === 'pin') {
            if (args[1]) return [];
            return this._openPinnedRows(dashboard);
        }

        if (scope === 'all') {
            if (args[1]) return [];
            return this._openAllRows(dashboard);
        }

        if (scope === 'last' || scope === 'recent') {
            const count = this._parseOpenLastCount(args[1]);
            const rows = this._openLastRows(dashboard, count);
            if (!args[1] && rows.length > 0) {
                rows.push(
                    { name: '', shortcut: ':OPEN', completion: ':open last 3 ', type: 'command-completion' },
                    { name: '', shortcut: ':OPEN', completion: ':open last 10 ', type: 'command-completion' }
                );
            }
            return rows;
        }

        if ('all'.startsWith(scope) && scope !== 'all') {
            return [{ name: '', shortcut: ':OPEN', completion: ':open all ', type: 'command-completion' }];
        }
        if ('pinned'.startsWith(scope) && scope !== 'pinned') {
            return [{ name: '', shortcut: ':OPEN', completion: ':open pinned ', type: 'command-completion' }];
        }
        if ('tag'.startsWith(scope) && scope !== 'tag') {
            return [{ name: '', shortcut: ':OPEN', completion: ':open tag ', type: 'command-completion' }];
        }
        if (('category'.startsWith(scope) && scope !== 'category') || ('cat'.startsWith(scope) && scope !== 'cat')) {
            return [{ name: '', shortcut: ':OPEN', completion: ':open category ', type: 'command-completion' }];
        }
        if ('last'.startsWith(scope) && scope !== 'last') {
            return [
                { name: '', shortcut: ':OPEN', completion: ':open last ', type: 'command-completion' },
                { name: '', shortcut: ':OPEN', completion: ':open last 5 ', type: 'command-completion' },
            ];
        }
        if ('recent'.startsWith(scope) && scope !== 'recent') {
            return [
                { name: '', shortcut: ':OPEN', completion: ':open recent 5 ', type: 'command-completion' },
            ];
        }

        return [];
    }

    // ─── persist helper ───────────────────────────────────────────────────────

    async _persistBookmarkField(bookmark, updates) {
        const dash = window.dashboardInstance;
        if (!dash) return;
        const pageId = Number(bookmark.pageId || bookmark.pageID || dash.currentPageId);
        if (!pageId) return;
        try {
            const res = await fetch(`/api/bookmarks?page=${pageId}`);
            if (!res.ok) return;
            const bookmarks = await res.json();
            const idx = bookmarks.findIndex(b => b.url === bookmark.url && b.name === bookmark.name);
            if (idx >= 0) Object.assign(bookmarks[idx], updates);
            await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bookmarks)
            });
            if (dash.bookmarks && Number(dash.currentPageId) === pageId) {
                const localIdx = dash.bookmarks.findIndex(b => b.url === bookmark.url && b.name === bookmark.name);
                if (localIdx >= 0) Object.assign(dash.bookmarks[localIdx], updates);
            }
            if (typeof dash.renderDashboard === 'function') dash.renderDashboard();
        } catch (e) {
            // ignore
        }
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

    handleHistoryCommand(args) {
        const dashboard = window.dashboardInstance;
        const searchComponent = dashboard?.searchComponent;
        if (!searchComponent) {
            return [];
        }

        const sub = (args[0] || '').toLowerCase();
        if (sub === 'clear') {
            return [{
                name: this.language?.t('dashboard.searchHistoryClear') || 'Clear search history',
                shortcut: ':HISTORY',
                stateId: 'history:clear',
                action: () => {
                    searchComponent.searchHistory = [];
                    searchComponent.saveSearchHistory();
                    return { stateId: 'history:clear' };
                },
                type: 'command',
            }];
        }

        const history = Array.isArray(searchComponent.searchHistory) ? searchComponent.searchHistory : [];
        if (history.length === 0) {
            return [{
                name: this.language?.t('dashboard.noRecentSearches') || 'No recent searches',
                shortcut: ':HISTORY',
                action: () => false,
                type: 'command',
            }];
        }

        return history.map((entry) => ({
            name: entry,
            shortcut: ':HISTORY',
            completion: entry,
            type: 'history',
        }));
    }

    handleSortCommand(args, fullQuery) {
        const method = (args[0] || '').toLowerCase();
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const categoryId = window.DashboardCategorySort?.resolveFocusedCategoryId?.(dashboard) ?? '';
        const categoryLabel = window.DashboardCategorySort?.resolveCategoryDisplayName?.(dashboard, categoryId) || '';
        const current = window.DashboardCategorySort?.getCategorySortMode?.(
            dashboard,
            { id: categoryId }
        ) || 'order';
        const validMethods = ['order', 'az', 'recent'];

        if (!method) {
            return validMethods.map((sortMethod) => ({
                name: this._markCurrent(
                    this._formatSortPaletteLabel(sortMethod, categoryLabel),
                    sortMethod === current
                ),
                shortcut: ':SORT',
                stateId: `sort:${sortMethod}`,
                completion: `:sort ${sortMethod} `,
                type: 'command',
                action: () => this.applySort(dashboard, sortMethod, categoryId),
            }));
        }

        const matches = validMethods.filter((entry) => entry.startsWith(method));
        if (matches.length === 0) {
            return [];
        }

        return matches.map((sortMethod) => ({
            name: this._markCurrent(
                this._formatSortPaletteLabel(sortMethod, categoryLabel),
                sortMethod === current
            ),
            shortcut: ':SORT',
            stateId: `sort:${sortMethod}`,
            type: 'command',
            action: () => this.applySort(dashboard, sortMethod, categoryId),
        }));
    }

    applySort(dashboard, method, categoryId) {
        const normalized = window.DashboardCategorySort?.normalizeSortMode?.(method) || 'order';
        const current = window.DashboardCategorySort?.getCategorySortMode?.(
            dashboard,
            { id: categoryId }
        ) || 'order';
        const next = normalized === current && normalized !== 'order' ? 'order' : normalized;
        window.DashboardCategorySort?.setCategorySortMode?.(dashboard, categoryId, next);
        if (typeof dashboard.renderDashboard === 'function') {
            dashboard.renderDashboard();
        }
        return this._paletteRefresh(`sort:${next}`);
    }

    handleLayoutVersionCommand(args) {
        const versionQuery = (args[0] || '').toLowerCase();
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const versions = window.LayoutVersionUtils
            ? window.LayoutVersionUtils.getLayoutVersions()
            : ['classic', 'modern', 'glass'];

        const currentVersion = window.LayoutVersionUtils
            ? window.LayoutVersionUtils.normalizeLayoutVersion(dashboard.settings.layoutVersion)
            : (dashboard.settings.layoutVersion || 'classic');

        if (!versionQuery) {
            return versions.map((version) => ({
                name: this._markCurrent(version, version === currentVersion),
                shortcut: ':LAYOUTVERSION',
                stateId: `layoutversion:${version}`,
                action: () => this.applyLayoutVersion(dashboard, version),
                type: 'command'
            }));
        }

        if (versionQuery === 'toggle') {
            const order = ['classic', 'modern', 'glass'];
            const index = order.indexOf(currentVersion);
            const next = order[(index + 1) % order.length];
            return [{
                name: `Toggle to ${next}`,
                shortcut: ':LAYOUTVERSION',
                stateId: `layoutversion:${next}`,
                action: () => this.applyLayoutVersion(dashboard, next),
                type: 'command'
            }];
        }

        const matches = versions.filter((version) => version.startsWith(versionQuery));
        if (matches.length === 0) return [];

        return matches.map((version) => ({
            name: this._markCurrent(version, version === currentVersion),
            shortcut: ':LAYOUTVERSION',
            stateId: `layoutversion:${version}`,
            action: () => this.applyLayoutVersion(dashboard, version),
            type: 'command'
        }));
    }

    handleLayoutCommand(args, fullQuery) {
        const layout = (args[0] || '').toLowerCase();
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const presets = window.LayoutUtils ? window.LayoutUtils.getLayoutPresets() : ['default', 'compact', 'cards', 'terminal', 'masonry', 'list', 'widgets'];
        const currentPreset = dashboard.settings.layoutPreset || 'default';
        if (!layout) {
            return presets.map((preset) => ({
                name: this._markCurrent(preset, preset === currentPreset),
                shortcut: ':LAYOUT',
                stateId: `layout:${preset}`,
                action: () => this.applyLayoutPreset(dashboard, preset),
                type: 'command'
            }));
        }

        const matches = presets.filter((preset) => preset.startsWith(layout));
        if (matches.length === 0) return [];

        return matches.map((preset) => ({
            name: this._markCurrent(preset, preset === currentPreset),
            shortcut: ':LAYOUT',
            stateId: `layout:${preset}`,
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
        const currentDensity = dashboard.settings.densityMode || 'compact';
        if (!density) {
            return densityModes.map((mode) => ({
                name: this._markCurrent(mode, mode === currentDensity),
                shortcut: ':DENSITY',
                stateId: `density:${mode}`,
                action: () => this.applyDensityMode(dashboard, mode),
                type: 'command'
            }));
        }

        const matches = densityModes.filter((mode) => mode.startsWith(density));
        if (matches.length === 0) return [];

        return matches.map((mode) => ({
            name: this._markCurrent(mode, mode === currentDensity),
            shortcut: ':DENSITY',
            stateId: `density:${mode}`,
            action: () => this.applyDensityMode(dashboard, mode),
            type: 'command'
        }));
    }

    handleButtonBarCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];

        const t = (key, fb) => (this.language?.t(key) && this.language.t(key) !== key ? this.language.t(key) : fb);
        const positions = [
            { value: 'bottom',       label: t('config.buttonBarPositionCmdBottom', 'bottom — centered (default)') },
            { value: 'bottom-right', label: t('config.buttonBarPositionCmdBottomRight', 'bottom-right — corner dock') },
            { value: 'bottom-left',  label: t('config.buttonBarPositionCmdBottomLeft', 'bottom-left — corner dock') },
            { value: 'side-left',    label: t('config.buttonBarPositionCmdSideLeft', 'side-left — vertical rail') },
        ];

        const current = dashboard.settings.buttonBarPosition || 'bottom';
        const arg = (args[0] || '').toLowerCase();

        if (!arg) {
            return positions.map(p => ({
                name: this._markCurrent(p.label, p.value === current),
                shortcut: ':BUTTONBAR',
                stateId: `buttonbar:${p.value}`,
                action: () => this.applyButtonBarPosition(dashboard, p.value),
                type: 'command'
            }));
        }

        const matches = positions.filter(p => p.value.startsWith(arg) || p.label.toLowerCase().includes(arg));
        if (matches.length === 0) return [];

        return matches.map(p => ({
            name: this._markCurrent(p.label, p.value === current),
            shortcut: ':BUTTONBAR',
            stateId: `buttonbar:${p.value}`,
            action: () => this.applyButtonBarPosition(dashboard, p.value),
            type: 'command'
        }));
    }

    handleButtonsCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];

        const buttons = {
            add: 'showAddBookmarkButton',
            commands: 'showCommandsButton',
            recent: 'showRecentButton',
            finders: 'showFindersButton',
            cheatsheet: 'showCheatSheetButton',
            search: 'showSearchButton',
            health: 'showHealthDashboard',
            tagcloud: 'showTagCloudButton',
        };

        const buttonAliases = {
            'tag-cloud': 'tagcloud',
            tags: 'tagcloud',
        };

        const buttonName = buttonAliases[(args[0] || '').toLowerCase()] || (args[0] || '').toLowerCase();
        const stateArg = (args[1] || '').toLowerCase();

        if (!buttonName) {
            return Object.keys(buttons).map((name) => this._buildButtonRow(name, buttons[name], dashboard));
        }

        const matchingButtons = Object.keys(buttons).filter((name) => name.startsWith(buttonName));
        if (matchingButtons.length === 0) return [];

        const explicitState = stateArg === 'on' ? true : stateArg === 'off' ? false : null;

        return matchingButtons.map((name) => this._buildButtonRow(name, buttons[name], dashboard, explicitState));
    }

    handleTipsCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const stateArg = (args[0] || '').toLowerCase();
        const enabled = dashboard.settings.showTips === true;
        const apply = (value) => this.setTipsVisibility(dashboard, value);

        if (!stateArg) {
            return this._buildOnOffRows({ prefix: 'tips', shortcut: ':TIPS', enabled, apply });
        }

        if (stateArg === 'on' || 'on'.startsWith(stateArg)) {
            return [{
                name: `on (${enabled ? 'current' : 'off'})`,
                shortcut: ':TIPS',
                stateId: 'tips:on',
                type: 'command',
                action: () => apply(true),
            }];
        }
        if (stateArg === 'off' || 'off'.startsWith(stateArg)) {
            return [{
                name: `off (${enabled ? 'on' : 'current'})`,
                shortcut: ':TIPS',
                stateId: 'tips:off',
                type: 'command',
                action: () => apply(false),
            }];
        }

        return [];
    }

    handleFaviconCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const stateArg = (args[0] || '').toLowerCase();
        const enabled = dashboard.settings.showIcons !== false;
        const apply = (value) => this.setFaviconVisibility(dashboard, value);

        if (!stateArg) {
            return this._buildOnOffRows({ prefix: 'favicons', shortcut: ':FAVICONS', enabled, apply });
        }

        if (stateArg === 'on' || 'on'.startsWith(stateArg)) {
            return [{
                name: `on (${enabled ? 'current' : 'off'})`,
                shortcut: ':FAVICONS',
                stateId: 'favicons:on',
                type: 'command',
                action: () => apply(true),
            }];
        }
        if (stateArg === 'off' || 'off'.startsWith(stateArg)) {
            return [{
                name: `off (${enabled ? 'on' : 'current'})`,
                shortcut: ':FAVICONS',
                stateId: 'favicons:off',
                type: 'command',
                action: () => apply(false),
            }];
        }

        return [];
    }

    handlePreviewCardsCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const stateArg = (args[0] || '').toLowerCase();
        const enabled = dashboard.settings.showLinkPreviewCards === true;
        const apply = (value) => this.setPreviewCardsVisibility(dashboard, value);

        if (!stateArg) {
            return this._buildOnOffRows({ prefix: 'preview', shortcut: ':PREVIEW', enabled, apply });
        }

        if (stateArg === 'on' || 'on'.startsWith(stateArg)) {
            return [{
                name: `on (${enabled ? 'current' : 'off'})`,
                shortcut: ':PREVIEW',
                stateId: 'preview:on',
                type: 'command',
                action: () => apply(true),
            }];
        }
        if (stateArg === 'off' || 'off'.startsWith(stateArg)) {
            return [{
                name: `off (${enabled ? 'on' : 'current'})`,
                shortcut: ':PREVIEW',
                stateId: 'preview:off',
                type: 'command',
                action: () => apply(false),
            }];
        }

        return [];
    }

    handlePackedColumnsCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const stateArg = (args[0] || '').toLowerCase();
        const enabled = dashboard.settings.packedColumns === true;
        const apply = (value) => this.setPackedColumnsVisibility(dashboard, value);

        if (!stateArg) {
            return this._buildOnOffRows({ prefix: 'packed', shortcut: ':PACKED', enabled, apply });
        }

        if (stateArg === 'on' || 'on'.startsWith(stateArg)) {
            return [{
                name: `on (${enabled ? 'current' : 'off'})`,
                shortcut: ':PACKED',
                stateId: 'packed:on',
                type: 'command',
                action: () => apply(true),
            }];
        }
        if (stateArg === 'off' || 'off'.startsWith(stateArg)) {
            return [{
                name: `off (${enabled ? 'on' : 'current'})`,
                shortcut: ':PACKED',
                stateId: 'packed:off',
                type: 'command',
                action: () => apply(false),
            }];
        }

        return [];
    }

    applyLayoutVersion(dashboard, version) {
        if (window.LayoutVersionUtils) {
            window.LayoutVersionUtils.applyLayoutVersion(dashboard.settings, version, {
                syncDashboard: true,
                saveDashboard: true
            });
        } else {
            const normalized = (version || 'classic').toLowerCase().trim();
            const nextVersion = ['classic', 'modern', 'glass'].includes(normalized) ? normalized : 'classic';
            dashboard.settings.layoutVersion = nextVersion;
            document.documentElement.setAttribute('data-layout-version', nextVersion);
            document.body.setAttribute('data-layout-version', nextVersion);
            if (typeof dashboard.setupDOM === 'function') {
                dashboard.setupDOM();
            }
            if (typeof dashboard.saveSettings === 'function') {
                dashboard.saveSettings();
            }
        }
        const applied = window.LayoutVersionUtils
            ? window.LayoutVersionUtils.normalizeLayoutVersion(dashboard.settings.layoutVersion)
            : (dashboard.settings.layoutVersion || 'classic');
        return this._paletteRefresh(`layoutversion:${applied}`);
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
        return this._paletteRefresh(`layout:${dashboard.settings.layoutPreset || preset}`);
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

        return this._paletteRefresh(`density:${densityMode}`);
    }

    applyButtonBarPosition(dashboard, position) {
        const valid = ['bottom', 'bottom-left', 'bottom-right', 'side-left'];
        const applied = valid.includes(position) ? position : 'bottom';
        dashboard.settings.buttonBarPosition = applied;
        if (typeof dashboard.setupDOM === 'function') {
            dashboard.setupDOM();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return this._paletteRefresh(`buttonbar:${applied}`);
    }

    toggleButtonVisibility(dashboard, settingKey, buttonId) {
        const nextValue = dashboard.settings[settingKey] === false;
        return this.setButtonVisibility(dashboard, settingKey, nextValue, buttonId);
    }

    setButtonVisibility(dashboard, settingKey, enabled, buttonId = settingKey) {
        dashboard.settings[settingKey] = enabled;
        if (typeof dashboard.setupDOM === 'function') {
            dashboard.setupDOM();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return this._paletteRefresh(`buttons:${buttonId}`);
    }

    setTipsVisibility(dashboard, enabled) {
        dashboard.settings.showTips = enabled;
        window.TipsPolicy?.onUserPreference?.(enabled);
        if (typeof dashboard.setupDOM === 'function') {
            dashboard.setupDOM();
        }
        if (typeof dashboard.initializeButtonTipsRotation === 'function') {
            dashboard.initializeButtonTipsRotation();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return this._paletteRefresh(enabled ? 'tips:on' : 'tips:off');
    }

    setFaviconVisibility(dashboard, enabled) {
        dashboard.settings.showIcons = enabled;
        if (typeof dashboard.setupDOM === 'function') {
            dashboard.setupDOM();
        }
        if (typeof dashboard.renderDashboard === 'function') {
            dashboard.renderDashboard();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return this._paletteRefresh(enabled ? 'favicons:on' : 'favicons:off');
    }

    setPreviewCardsVisibility(dashboard, enabled) {
        dashboard.settings.showLinkPreviewCards = enabled;
        if (!enabled && typeof dashboard.dismissBookmarkPreviewInteractions === 'function') {
            dashboard.dismissBookmarkPreviewInteractions();
        }
        if (typeof dashboard.setupDOM === 'function') {
            dashboard.setupDOM();
        }
        if (typeof dashboard.renderDashboard === 'function') {
            dashboard.renderDashboard();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return this._paletteRefresh(enabled ? 'preview:on' : 'preview:off');
    }

    setPackedColumnsVisibility(dashboard, enabled) {
        dashboard.settings.packedColumns = enabled;
        if (typeof dashboard.setupDOM === 'function') {
            dashboard.setupDOM();
        }
        if (typeof dashboard.renderDashboard === 'function') {
            dashboard.renderDashboard();
        }
        if (typeof dashboard.saveSettings === 'function') {
            dashboard.saveSettings();
        }
        return this._paletteRefresh(enabled ? 'packed:on' : 'packed:off');
    }

    handleGotoCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard || !dashboard.searchComponent) {
            return [];
        }
        const scope = (args[0] || '').toLowerCase();

        if (scope === 'config') {
            const section = (args[1] || '').toLowerCase();
            if (!section) {
                return [
                    {
                        name: this._t('commands.gotoConfig', 'Open config'),
                        shortcut: ':GOTO',
                        type: 'command',
                        action: () => {
                            this._closeCommandPalette();
                            window.location.href = '/config';
                            return { navigate: true };
                        },
                    },
                    ...this._CONFIG_SECTIONS.map((entry) => ({
                        name: this._t(entry.labelKey, entry.fallback),
                        shortcut: ':GOTO',
                        completion: `:goto config ${entry.id} `,
                        type: 'command-completion',
                    })),
                ];
            }
            const exact = this._CONFIG_SECTIONS.find((entry) => entry.id === section);
            const matches = exact
                ? [exact]
                : this._CONFIG_SECTIONS.filter((entry) => entry.id.startsWith(section) || entry.id.includes(section));
            if (matches.length === 0) return [];
            return matches.map((entry) => ({
                name: this._t(entry.labelKey, entry.fallback),
                shortcut: ':GOTO',
                type: 'command',
                action: () => {
                    this._closeCommandPalette();
                    window.location.href = `/config#${entry.id}`;
                    return { navigate: true };
                },
            }));
        }

        if (scope === 'stats') {
            return [{
                name: this._t('commands.gotoStats', 'Open config — stats'),
                shortcut: ':GOTO',
                type: 'command',
                action: () => {
                    this._closeCommandPalette();
                    window.location.href = '/config#stats';
                    return { navigate: true };
                },
            }];
        }

        if (scope === 'health') {
            return [{
                name: this._t('commands.gotoHealth', 'Open health page'),
                shortcut: ':GOTO',
                type: 'command',
                action: () => {
                    this._closeCommandPalette();
                    window.location.href = '/health';
                    return { navigate: true };
                },
            }];
        }

        // Direct URL/domain navigation: :goto <url-or-domain>
        const rawTarget = args.join(' ').trim();
        if (rawTarget && rawTarget !== 'all' && !('all'.startsWith(rawTarget))) {
            const isUrl = /^https?:\/\//i.test(rawTarget);
            const isDomain = /^[a-z0-9-]+\.[a-z]{2,}/i.test(rawTarget);
            if (isUrl || isDomain) {
                const href = isUrl ? rawTarget : `https://${rawTarget}`;
                const openInNewTab = dashboard.settings?.openInNewTab !== false;
                return [{
                    name: `Navigate to ${rawTarget}`,
                    shortcut: ':GOTO',
                    type: 'command',
                    action: () => {
                        if (openInNewTab) {
                            window.open(href, '_blank', 'noopener,noreferrer');
                            return { refresh: false };
                        }
                        window.location.href = href;
                        return { navigate: true };
                    }
                }];
            }
        }

        if (scope === 'all') {
            const withUrl = (dashboard.allBookmarks || []).filter((b) => b && String(b.url || '').trim());
            if (withUrl.length === 0) {
                return [{
                    name: 'No bookmarks across pages',
                    shortcut: ':GOTO',
                    type: 'command',
                    action: () => {
                        dashboard.showNotification('Nothing to open.', 'info');
                        return { refresh: false };
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
                    return { refresh: false };
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
                        return { refresh: false };
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
                        return { refresh: false };
                    }
                    const pick = pool[Math.floor(Math.random() * pool.length)];
                    dashboard.searchComponent.openBookmark(pick);
                    return { refresh: false };
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
            rows.push(
                { name: '', shortcut: ':GOTO', completion: ':goto config ', type: 'command-completion' },
                { name: '', shortcut: ':GOTO', completion: ':goto stats ', type: 'command-completion' },
                { name: '', shortcut: ':GOTO', completion: ':goto health ', type: 'command-completion' },
            );
            return rows;
        }
        if ('config'.startsWith(scope) && scope !== 'config') {
            return [{ name: '', shortcut: ':GOTO', completion: ':goto config ', type: 'command-completion' }];
        }
        if ('stats'.startsWith(scope) && scope !== 'stats') {
            return [{ name: '', shortcut: ':GOTO', completion: ':goto stats ', type: 'command-completion' }];
        }
        if ('health'.startsWith(scope) && scope !== 'health') {
            return [{ name: '', shortcut: ':GOTO', completion: ':goto health ', type: 'command-completion' }];
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

    getStaleBookmarkPaletteRows(dashboard, days) {
        const stale = typeof dashboard.getStaleBookmarksList === 'function'
            ? dashboard.getStaleBookmarksList(days)
            : [];
        const windowLabel = days ? `${days} days` : '30 days';
        if (stale.length === 0) {
            return [{
                name: `No stale bookmarks in the last ${windowLabel}`,
                shortcut: ':STALE',
                type: 'command',
                action: () => true
            }];
        }
        const cap = 45;
        const rows = stale.slice(0, cap).map((bookmark, i) => ({
            name: bookmark.name,
            shortcut: bookmark.shortcut && String(bookmark.shortcut).trim()
                ? String(bookmark.shortcut).trim()
                : `⌛${i + 1}`,
            bookmark,
            type: 'bookmark'
        }));
        if (stale.length > cap) {
            rows.push({
                name: `Showing ${cap} of ${stale.length} — visit health page for full list`,
                shortcut: '→',
                type: 'command',
                action: () => {
                    window.location.href = this.buildHealthPageUrl({ filter: 'stale' });
                    return { navigate: true };
                }
            });
        }
        return rows;
    }

    handleStaleCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }
        const a0 = (args[0] || '').toLowerCase();

        // :stale <days> — numeric custom window
        const parsedDays = a0 ? parseInt(a0, 10) : NaN;
        if (!isNaN(parsedDays) && parsedDays > 0) {
            // If user typed a number, show list with that custom window
            return this.getStaleBookmarkPaletteRows(dashboard, parsedDays);
        }

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
                    return { refresh: false };
                }
            },
            {
                name: '',
                shortcut: ':STALE',
                completion: ':stale list ',
                type: 'command-completion'
            },
            {
                name: '',
                shortcut: ':STALE',
                completion: ':stale 30 ',
                type: 'command-completion'
            }
        ];
    }

    buildHealthPageUrl(options = {}) {
        const filters = ['all', 'broken', 'duplicate', 'shortcut-conflict', 'unchecked', 'stale', 'unused', 'missing-preview', 'healthy'];
        const params = new URLSearchParams();
        const filter = (options.filter || 'all').toLowerCase();
        if (filter && filter !== 'all' && filters.includes(filter)) {
            params.set('filter', filter);
        }
        if (options.page != null && String(options.page).trim() !== '' && String(options.page) !== 'all') {
            params.set('page', String(options.page));
        }
        if (options.sort) {
            params.set('sort', options.sort);
        }
        if (options.query) {
            params.set('q', options.query);
        }
        if (options.refresh) {
            params.set('refresh', '1');
        }
        const qs = params.toString();
        return qs ? `/health?${qs}` : '/health';
    }

    _handleHealthPageCommand(dashboard, pageArgs) {
        const pages = dashboard?.pages || [];
        const pageQuery = (pageArgs[0] || '').trim();

        if (!pageQuery) {
            if (pages.length === 0) return [];
            return pages.map((page, index) => ({
                name: page.name || `Page ${index + 1}`,
                shortcut: ':HEALTH',
                meta: String(index + 1),
                type: 'command',
                action: () => {
                    this._closeCommandPalette();
                    window.location.href = this.buildHealthPageUrl({ page: page.id });
                    return { navigate: true };
                },
            }));
        }

        const parsed = parseInt(pageQuery, 10);
        if (Number.isFinite(parsed) && parsed >= 1 && parsed <= pages.length && String(parsed) === pageQuery) {
            const page = pages[parsed - 1];
            return [{
                name: page.name || `Page ${parsed}`,
                shortcut: ':HEALTH',
                type: 'command',
                action: () => {
                    this._closeCommandPalette();
                    window.location.href = this.buildHealthPageUrl({ page: page.id });
                    return { navigate: true };
                },
            }];
        }

        const q = pageQuery.toLowerCase();
        const matches = pages.filter((page) => {
            const name = String(page.name || '').toLowerCase();
            return name.includes(q) || String(page.id) === pageQuery;
        });
        if (matches.length === 0) return [];

        return matches.map((page) => ({
            name: page.name || `Page ${page.id}`,
            shortcut: ':HEALTH',
            type: 'command',
            action: () => {
                this._closeCommandPalette();
                window.location.href = this.buildHealthPageUrl({ page: page.id });
                return { navigate: true };
            },
        }));
    }

    handleHealthCommand(args, fullQuery) {
        const filters = [
            { id: 'broken', label: 'broken bookmarks' },
            { id: 'duplicate', label: 'duplicate URLs' },
            { id: 'shortcut-conflict', label: 'shortcut conflicts' },
            { id: 'unchecked', label: 'unchecked status' },
            { id: 'stale', label: 'stale bookmarks' },
            { id: 'unused', label: 'unused bookmarks' },
            { id: 'missing-preview', label: 'missing previews' },
            { id: 'healthy', label: 'healthy bookmarks' },
            { id: 'all', label: 'all bookmarks' },
        ];
        const sub = (args[0] || '').toLowerCase().trim();

        if (sub === 'page' || 'page'.startsWith(sub) && sub !== 'page' && sub.length > 0) {
            if (sub === 'page') {
                return this._handleHealthPageCommand(dashboard, args.slice(1));
            }
            return [{
                name: '',
                shortcut: ':HEALTH',
                completion: ':health page ',
                type: 'command-completion',
            }];
        }

        if (sub === 'refresh' || sub === 'retest') {
            return [{
                name: 'Open health and re-scan all bookmarks',
                shortcut: ':HEALTH',
                type: 'command',
                action: () => {
                    window.location.href = this.buildHealthPageUrl({ refresh: true });
                    return { navigate: true };
                }
            }];
        }

        if (!sub) {
            const rows = [{
                name: 'Open health page',
                shortcut: ':HEALTH',
                type: 'command',
                action: () => {
                    window.location.href = this.buildHealthPageUrl();
                    return { navigate: true };
                }
            }];
            filters.forEach(({ id, label }) => {
                if (id === 'all') return;
                rows.push({
                    name: `Open health — ${label}`,
                    shortcut: ':HEALTH',
                    type: 'command',
                    action: () => {
                        window.location.href = this.buildHealthPageUrl({ filter: id });
                        return { navigate: true };
                    }
                });
            });
            rows.push({
                name: '',
                shortcut: ':HEALTH',
                completion: ':health broken ',
                type: 'command-completion'
            });
            rows.push({
                name: '',
                shortcut: ':HEALTH',
                completion: ':health page ',
                type: 'command-completion'
            });
            return rows;
        }

        const exact = filters.find((entry) => entry.id === sub);
        if (exact) {
            return [{
                name: `Open health — ${exact.label}`,
                shortcut: ':HEALTH',
                type: 'command',
                action: () => {
                    window.location.href = this.buildHealthPageUrl({ filter: exact.id });
                    return { navigate: true };
                }
            }];
        }

        const partial = filters.filter((entry) => entry.id.startsWith(sub));
        if (partial.length > 0) {
            return partial.map((entry) => ({
                name: `Open health — ${entry.label}`,
                shortcut: ':HEALTH',
                completion: `:health ${entry.id} `,
                type: 'command',
                action: () => {
                    window.location.href = this.buildHealthPageUrl({ filter: entry.id });
                    return { navigate: true };
                }
            }));
        }

        if ('refresh'.startsWith(sub) || 'retest'.startsWith(sub)) {
            return [{
                name: '',
                shortcut: ':HEALTH',
                completion: ':health refresh ',
                type: 'command-completion'
            }];
        }

        return [];
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
                    return { navigate: true };
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
                    return { refresh: false };
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
                        return { refresh: false };
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
                return { refresh: false };
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

    handleDarkCommand(args) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];
        const enabled = dashboard.settings.autoDarkMode === true;
        const apply = (value) => this.setAutoDarkMode(dashboard, value);
        return this._handleSimpleToggle(args, { shortcut: ':DARK', prefix: 'dark', enabled, apply });
    }

    handleTitleCommand(args) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];
        const enabled = dashboard.settings.showTitle !== false;
        const apply = (value) => this.setTitleVisibility(dashboard, value);
        return this._handleSimpleToggle(args, { shortcut: ':TITLE', prefix: 'title', enabled, apply });
    }

    handleAnimationsCommand(args) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];
        const enabled = dashboard.settings.animationsEnabled !== false;
        const apply = (value) => this.setAnimationsEnabled(dashboard, value);
        return this._handleSimpleToggle(args, { shortcut: ':ANIMATIONS', prefix: 'animations', enabled, apply });
    }

    handleStatusCommand(args) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];
        const enabled = dashboard.settings.showStatus !== false;
        const apply = (value) => this.setStatusVisibility(dashboard, value);
        return this._handleSimpleToggle(args, { shortcut: ':STATUS', prefix: 'status', enabled, apply });
    }

    _handleSimpleToggle(args, { shortcut, prefix, enabled, apply }) {
        const stateArg = (args[0] || '').toLowerCase();
        if (!stateArg) {
            return this._buildOnOffRows({ prefix, shortcut, enabled, apply });
        }
        if (stateArg === 'on' || 'on'.startsWith(stateArg)) {
            return [{
                name: `on (${enabled ? 'current' : this._stateOnOff(false)})`,
                shortcut,
                stateId: `${prefix}:on`,
                type: 'command',
                action: () => apply(true),
            }];
        }
        if (stateArg === 'off' || 'off'.startsWith(stateArg)) {
            return [{
                name: `off (${enabled ? this._stateOnOff(true) : 'current'})`,
                shortcut,
                stateId: `${prefix}:off`,
                type: 'command',
                action: () => apply(false),
            }];
        }
        return [];
    }

    handleLangCommand(args) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];

        const query = (args[0] || '').toLowerCase();
        const current = String(dashboard.settings.language || 'en').toLowerCase();

        if (!query) {
            return this._LANG_OPTIONS.map((entry) => ({
                name: this._markCurrent(this._t(entry.labelKey, entry.fallback), entry.id === current),
                shortcut: ':LANG',
                stateId: `lang:${entry.id}`,
                completion: `:lang ${entry.id} `,
                type: 'command',
                action: () => this._applyLanguage(dashboard, entry.id),
            }));
        }

        const exact = this._LANG_OPTIONS.find((entry) => entry.id === query);
        if (exact) {
            return [{
                name: this._t(exact.labelKey, exact.fallback),
                shortcut: ':LANG',
                stateId: `lang:${exact.id}`,
                type: 'command',
                action: () => this._applyLanguage(dashboard, exact.id),
            }];
        }

        const matches = this._LANG_OPTIONS.filter((entry) => entry.id.startsWith(query));
        if (matches.length === 0) return [];

        return matches.map((entry) => ({
            name: this._markCurrent(this._t(entry.labelKey, entry.fallback), entry.id === current),
            shortcut: ':LANG',
            stateId: `lang:${entry.id}`,
            type: 'command',
            action: () => this._applyLanguage(dashboard, entry.id),
        }));
    }

    handleOpacityCommand(args) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];

        const query = (args[0] || '').toLowerCase();
        const current = Number(dashboard.settings.backgroundOpacity ?? 1);

        if (!query) {
            return this._OPACITY_PRESETS.map((value) => {
                const label = `${Math.round(value * 100)}%`;
                return {
                    name: this._markCurrent(label, Math.abs(value - current) < 0.001),
                    shortcut: ':OPACITY',
                    stateId: `opacity:${value}`,
                    completion: `:opacity ${Math.round(value * 100)} `,
                    type: 'command',
                    action: () => this.setBackgroundOpacity(dashboard, value),
                };
            });
        }

        const parsed = parseInt(query.replace('%', ''), 10);
        if (Number.isFinite(parsed) && parsed >= 65 && parsed <= 100) {
            const value = parsed / 100;
            return [{
                name: `${parsed}%`,
                shortcut: ':OPACITY',
                stateId: `opacity:${value}`,
                type: 'command',
                action: () => this.setBackgroundOpacity(dashboard, value),
            }];
        }

        return [];
    }

    handleCollectionsCommand(args) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];

        const collectionId = (args[0] || '').toLowerCase();
        const stateArg = (args[1] || '').toLowerCase();

        if (!collectionId) {
            return this._SMART_COLLECTIONS.map((entry) => {
                const enabled = this._smartCollectionEnabled(dashboard.settings, entry);
                const label = this._t(entry.labelKey, entry.fallback);
                return {
                    name: `${label} (${this._stateOnOff(enabled)})`,
                    shortcut: ':COLLECTIONS',
                    stateId: `collections:${entry.id}`,
                    type: 'command',
                    action: () => this.setSmartCollectionVisibility(dashboard, entry, !enabled),
                };
            });
        }

        const entry = this._SMART_COLLECTIONS.find((item) => (
            item.id === collectionId || item.id.startsWith(collectionId)
        ));
        if (!entry) return [];

        const enabled = this._smartCollectionEnabled(dashboard.settings, entry);
        const label = this._t(entry.labelKey, entry.fallback);

        if (!stateArg) {
            return this._buildOnOffRows({
                prefix: `collections:${entry.id}`,
                shortcut: ':COLLECTIONS',
                enabled,
                apply: (value) => this.setSmartCollectionVisibility(dashboard, entry, value),
            }).map((row) => ({
                ...row,
                name: `${label} — ${row.name}`,
            }));
        }

        if (stateArg === 'on' || 'on'.startsWith(stateArg)) {
            return [{
                name: `${label} — on (${enabled ? 'current' : 'off'})`,
                shortcut: ':COLLECTIONS',
                stateId: `collections:${entry.id}:on`,
                type: 'command',
                action: () => this.setSmartCollectionVisibility(dashboard, entry, true),
            }];
        }
        if (stateArg === 'off' || 'off'.startsWith(stateArg)) {
            return [{
                name: `${label} — off (${enabled ? 'on' : 'current'})`,
                shortcut: ':COLLECTIONS',
                stateId: `collections:${entry.id}:off`,
                type: 'command',
                action: () => this.setSmartCollectionVisibility(dashboard, entry, false),
            }];
        }

        return [];
    }

    handleBackupCommand(args, fullQuery) {
        return [{
            name: this._t('commands.backupLabel', 'Open config — backups'),
            shortcut: ':BACKUP',
            type: 'command',
            action: () => {
                this._closeCommandPalette();
                window.location.href = '/config#backups';
                return { navigate: true };
            },
        }];
    }

    handleMetadataCommand(args) {
        const sub = (args[0] || '').toLowerCase();

        if (!sub) {
            return [
                {
                    name: this._t('commands.metadataHealth', 'Open health — missing previews'),
                    shortcut: ':METADATA',
                    type: 'command',
                    action: () => {
                        this._closeCommandPalette();
                        window.location.href = this.buildHealthPageUrl({ filter: 'missing-preview' });
                        return { navigate: true };
                    },
                },
                {
                    name: this._t('commands.metadataConfig', 'Open config — bookmarks'),
                    shortcut: ':METADATA',
                    type: 'command',
                    action: () => {
                        this._closeCommandPalette();
                        window.location.href = '/config#bookmarks';
                        return { navigate: true };
                    },
                },
                {
                    name: '',
                    shortcut: ':METADATA',
                    completion: ':metadata health ',
                    type: 'command-completion',
                },
            ];
        }

        if (sub === 'health' || 'health'.startsWith(sub)) {
            if (sub !== 'health') {
                return [{ name: '', shortcut: ':METADATA', completion: ':metadata health ', type: 'command-completion' }];
            }
            return [{
                name: this._t('commands.metadataHealth', 'Open health — missing previews'),
                shortcut: ':METADATA',
                type: 'command',
                action: () => {
                    this._closeCommandPalette();
                    window.location.href = this.buildHealthPageUrl({ filter: 'missing-preview' });
                    return { navigate: true };
                },
            }];
        }

        if (sub === 'config' || 'config'.startsWith(sub)) {
            if (sub !== 'config') {
                return [{ name: '', shortcut: ':METADATA', completion: ':metadata config ', type: 'command-completion' }];
            }
            return [{
                name: this._t('commands.metadataConfig', 'Open config — bookmarks'),
                shortcut: ':METADATA',
                type: 'command',
                action: () => {
                    this._closeCommandPalette();
                    window.location.href = '/config#bookmarks';
                    return { navigate: true };
                },
            }];
        }

        return [];
    }

    handleTourCommand() {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];

        return [{
            name: this._t('commands.tourStart', 'Start feature tour'),
            shortcut: ':TOUR',
            type: 'command',
            action: () => this._runOverlayAction(() => dashboard.startFeatureTour?.()),
        }];
    }

    handlePromoCommand(args) {
        const registry = window.DashboardPromoRegistry;
        const entries = registry?.entries || [];
        const sub = (args[0] || '').toLowerCase();

        if (!sub) {
            const rows = entries.map((entry) => ({
                name: this._t('commands.promoReset', 'Reset promo — {id}').replace('{id}', entry.id),
                shortcut: ':PROMO',
                stateId: `promo:${entry.id}`,
                completion: `:promo ${entry.id} `,
                type: 'command',
                action: () => {
                    registry?.clearById?.(entry.id);
                    return { stateId: `promo:${entry.id}` };
                },
            }));
            rows.push({
                name: this._t('commands.promoResetAll', 'Reset all promos'),
                shortcut: ':PROMO',
                stateId: 'promo:all',
                type: 'command',
                action: () => {
                    registry?.clearAll?.();
                    return { stateId: 'promo:all' };
                },
            });
            return rows;
        }

        if (sub === 'all') {
            return [{
                name: this._t('commands.promoResetAll', 'Reset all promos'),
                shortcut: ':PROMO',
                type: 'command',
                action: () => {
                    registry?.clearAll?.();
                    return { stateId: 'promo:all' };
                },
            }];
        }

        const match = entries.find((entry) => entry.id === sub || entry.id.startsWith(sub));
        if (!match) return [];

        return [{
            name: this._t('commands.promoReset', 'Reset promo — {id}').replace('{id}', match.id),
            shortcut: ':PROMO',
            type: 'command',
            action: () => {
                registry?.clearById?.(match.id);
                return { stateId: `promo:${match.id}` };
            },
        }];
    }

    handleFilterCommand(args) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];

        const query = args.join(' ').trim();
        const active = dashboard.normalizeTagFilters?.(dashboard._tagFilters) || dashboard._tagFilters || [];

        if (!query) {
            const rows = [];
            if (active.length > 0) {
                rows.push({
                    name: this._t('commands.filterClearActive', 'Clear tag filter — {tags}')
                        .replace('{tags}', active.map((tag) => `#${tag}`).join(', ')),
                    shortcut: ':FILTER',
                    stateId: 'filter:clear',
                    type: 'command',
                    action: () => {
                        this._closeCommandPalette();
                        dashboard.clearTagFilter?.();
                        return { refresh: false };
                    },
                });
            }
            rows.push({
                name: this._t('commands.filterClear', 'Clear tag filter'),
                shortcut: ':FILTER',
                completion: ':filter clear ',
                type: 'command-completion',
            });
            rows.push(...this._getTagNameCompletionRows('').map((row) => ({
                ...row,
                shortcut: ':FILTER',
                completion: row.completion.replace(':tag ', ':filter '),
            })));
            return rows;
        }

        if (query.toLowerCase() === 'clear') {
            return [{
                name: this._t('commands.filterClear', 'Clear tag filter'),
                shortcut: ':FILTER',
                stateId: 'filter:clear',
                type: 'command',
                action: () => {
                    this._closeCommandPalette();
                    dashboard.clearTagFilter?.();
                    return { refresh: false };
                },
            }];
        }

        const tag = this._normalizeTagQuery(query);
        if (!tag) return [];

        return [{
            name: this._t('commands.filterApply', 'Filter by #{tag}').replace('{tag}', tag),
            shortcut: ':FILTER',
            stateId: `filter:${tag}`,
            type: 'command',
            action: () => {
                this._closeCommandPalette();
                return dashboard.setTagFilters?.([tag]).then(() => ({ refresh: false }));
            },
        }];
    }

    handleExportCommand() {
        return [{
            name: this._t('commands.exportLabel', 'Download backup (.zip)'),
            shortcut: ':EXPORT',
            type: 'command',
            action: () => this._downloadBackup(),
        }];
    }

    /**
     * Handle the :find command
     * Filters bookmark tiles on the current page live; Escape clears the filter.
     * @param {Array} args - Arguments after 'find'
     * @returns {Array} Single action row or prompt
     */
    handleFindCommand(args) {
        const query = args.join(' ').trim();
        const t = (key, fb) => this.language ? (this.language.t(key) || fb) : fb;
        const dashboard = window.dashboardInstance;
        const activeFilter = String(dashboard?._findFilter || '').trim();

        if (!query) {
            const rows = [{
                name: t('dashboard.findCommandHint', 'Type text to highlight matching bookmarks on this page'),
                shortcut: ':FIND',
                type: 'command-completion',
                completion: ':find '
            }];
            if (activeFilter) {
                rows.unshift({
                    name: t('commands.findClearActive', 'Clear find filter — “{query}”').replace('{query}', activeFilter),
                    shortcut: ':FIND',
                    stateId: 'find:clear',
                    type: 'command',
                    action: () => {
                        document.dispatchEvent(new CustomEvent('nextdash:find', { detail: { query: '' } }));
                        return { stateId: 'find:clear' };
                    },
                });
            }
            rows.push({
                name: t('commands.findClear', 'Clear find filter'),
                shortcut: ':FIND',
                stateId: 'find:clear',
                type: 'command-completion',
                completion: ':find clear ',
            });
            return rows;
        }

        if (query.toLowerCase() === 'clear') {
            return [{
                name: t('commands.findClear', 'Clear find filter'),
                shortcut: ':FIND',
                stateId: 'find:clear',
                type: 'command',
                action: () => {
                    document.dispatchEvent(new CustomEvent('nextdash:find', { detail: { query: '' } }));
                    return { stateId: 'find:clear' };
                },
            }];
        }

        return [{
            name: `"${query}"`,
            shortcut: ':FIND',
            stateId: 'find',
            action: () => {
                document.dispatchEvent(new CustomEvent('nextdash:find', { detail: { query } }));
                return { stateId: 'find' };
            },
            type: 'command'
        }];
    }
}

// Export for use in other modules
window.SearchCommandsComponent = SearchCommandsComponent;