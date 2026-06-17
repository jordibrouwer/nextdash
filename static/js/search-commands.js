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

        // Command groups (order matters — shown collapsed by default)
        this.commandGroups = [
            {
                id: 'bookmarks',
                label: 'Bookmarks',
                commands: ['new', 'remove', 'note', 'pin', 'tag', 'save', 'saved', 'history', 'sort', 'open', 'stale', 'duplicates', 'goto', 'find']
            },
            {
                id: 'view',
                label: 'View',
                commands: ['theme', 'layoutversion', 'layout', 'density', 'columns', 'fontsize', 'packed', 'preview', 'favicons', 'buttonbar']
            },
            {
                id: 'dashboard',
                label: 'Dashboard',
                commands: ['buttons', 'tips', 'health']
            }
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
            'tag': this.handleTagCommand.bind(this),
            'open': this.handleOpenCommand.bind(this),
            'find': this.handleFindCommand.bind(this),
            'health': this.handleHealthCommand.bind(this)
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
        if (this.removeCommandHandler) {
            this.removeCommandHandler.resetState();
        }
        this.expandedGroups.clear();
        this.contextBookmark = null;
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
        const bookmarkContextCmds = new Set(['remove', 'note']);
        const ctxName = this.contextBookmark ? this.contextBookmark.name : null;

        const result = [];
        for (const group of this.commandGroups) {
            const isExpanded = this.expandedGroups.has(group.id);
            result.push({
                type: 'command-group-header',
                groupId: group.id,
                label: group.label,
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
            name: label,
            shortcut: isUnpin ? ':UNPIN' : ':PIN',
            type: 'command',
            action: () => {
                ctx.pinned = willPin;
                this._persistBookmarkField(ctx, { pinned: willPin });
                const toast = willPin
                    ? this._t('commands.pinnedToast', 'Pinned "{name}".').replace('{name}', name)
                    : this._t('commands.unpinnedToast', 'Unpinned "{name}".').replace('{name}', name);
                dashboard.showNotification(toast, 'success');
                return true;
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
            type: 'command',
            action: () => {
                ctx.tags = newTags;
                this._persistBookmarkField(ctx, { tags: newTags });
                dashboard.showNotification(
                    remove
                        ? this._t('commands.tagRemovedToast', 'Tag "#{tag}" removed.').replace('{tag}', tagName)
                        : this._t('commands.tagAddedToast', 'Tag "#{tag}" added.').replace('{tag}', tagName),
                    'success'
                );
                return true;
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
            return true;
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

    handleOpenCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) return [];
        const scope = (args[0] || '').toLowerCase();

        if (!scope) {
            return [
                { name: '', shortcut: ':OPEN', completion: ':open all ', type: 'command-completion' },
                { name: '', shortcut: ':OPEN', completion: ':open last ', type: 'command-completion' },
                { name: '', shortcut: ':OPEN', completion: ':open last 5 ', type: 'command-completion' },
            ];
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
                action: () => {
                    searchComponent.searchHistory = [];
                    searchComponent.saveSearchHistory();
                    if (typeof searchComponent.updateSearch === 'function') {
                        searchComponent.updateSearch();
                    }
                    return true;
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

    handleLayoutVersionCommand(args) {
        const versionQuery = (args[0] || '').toLowerCase();
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const versions = window.LayoutVersionUtils
            ? window.LayoutVersionUtils.getLayoutVersions()
            : ['classic', 'modern', 'glass'];

        if (!versionQuery) {
            return versions.map((version) => ({
                name: version,
                shortcut: ':LAYOUTVERSION',
                action: () => this.applyLayoutVersion(dashboard, version),
                type: 'command'
            }));
        }

        if (versionQuery === 'toggle') {
            const current = window.LayoutVersionUtils
                ? window.LayoutVersionUtils.normalizeLayoutVersion(dashboard.settings.layoutVersion)
                : 'classic';
            const order = ['classic', 'modern', 'glass'];
            const index = order.indexOf(current);
            const next = order[(index + 1) % order.length];
            return [{
                name: `Toggle to ${next}`,
                shortcut: ':LAYOUTVERSION',
                action: () => this.applyLayoutVersion(dashboard, next),
                type: 'command'
            }];
        }

        const matches = versions.filter((version) => version.startsWith(versionQuery));
        if (matches.length === 0) return [];

        return matches.map((version) => ({
            name: version,
            shortcut: ':LAYOUTVERSION',
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
                name: p.label + (p.value === current ? ' ✓' : ''),
                shortcut: ':BUTTONBAR',
                action: () => this.applyButtonBarPosition(dashboard, p.value),
                type: 'command'
            }));
        }

        const matches = positions.filter(p => p.value.startsWith(arg) || p.label.toLowerCase().includes(arg));
        if (matches.length === 0) return [];

        return matches.map(p => ({
            name: p.label + (p.value === current ? ' ✓' : ''),
            shortcut: ':BUTTONBAR',
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

    handleFaviconCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const stateArg = (args[0] || '').toLowerCase();
        const explicitState = stateArg === 'on' ? true : stateArg === 'off' ? false : null;
        const enabled = dashboard.settings.showIcons !== false;

        const actions = [];
        if (!stateArg || 'on'.startsWith(stateArg)) {
            actions.push({
                name: `on (${enabled ? 'current' : 'off'})`,
                shortcut: ':FAVICONS',
                action: () => this.setFaviconVisibility(dashboard, true),
                type: 'command'
            });
        }
        if (!stateArg || 'off'.startsWith(stateArg)) {
            actions.push({
                name: `off (${enabled ? 'on' : 'current'})`,
                shortcut: ':FAVICONS',
                action: () => this.setFaviconVisibility(dashboard, false),
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
            name: explicitState ? 'Favicons enabled' : 'Favicons disabled',
            shortcut: ':FAVICONS',
            action: () => this.setFaviconVisibility(dashboard, explicitState),
            type: 'command'
        }];
    }

    handlePreviewCardsCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const stateArg = (args[0] || '').toLowerCase();
        const explicitState = stateArg === 'on' ? true : stateArg === 'off' ? false : null;
        const enabled = dashboard.settings.showLinkPreviewCards === true;

        const actions = [];
        if (!stateArg || 'on'.startsWith(stateArg)) {
            actions.push({
                name: `on (${enabled ? 'current' : 'off'})`,
                shortcut: ':PREVIEW',
                action: () => this.setPreviewCardsVisibility(dashboard, true),
                type: 'command'
            });
        }
        if (!stateArg || 'off'.startsWith(stateArg)) {
            actions.push({
                name: `off (${enabled ? 'on' : 'current'})`,
                shortcut: ':PREVIEW',
                action: () => this.setPreviewCardsVisibility(dashboard, false),
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
            name: explicitState ? 'Preview cards enabled' : 'Preview cards disabled',
            shortcut: ':PREVIEW',
            action: () => this.setPreviewCardsVisibility(dashboard, explicitState),
            type: 'command'
        }];
    }

    handlePackedColumnsCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard) {
            return [];
        }

        const stateArg = (args[0] || '').toLowerCase();
        const explicitState = stateArg === 'on' ? true : stateArg === 'off' ? false : null;
        const enabled = dashboard.settings.packedColumns === true;

        const actions = [];
        if (!stateArg || 'on'.startsWith(stateArg)) {
            actions.push({
                name: `on (${enabled ? 'current' : 'off'})`,
                shortcut: ':PACKED',
                action: () => this.setPackedColumnsVisibility(dashboard, true),
                type: 'command'
            });
        }
        if (!stateArg || 'off'.startsWith(stateArg)) {
            actions.push({
                name: `off (${enabled ? 'on' : 'current'})`,
                shortcut: ':PACKED',
                action: () => this.setPackedColumnsVisibility(dashboard, false),
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
            name: explicitState ? 'Tight column stack on' : 'Tight column stack off',
            shortcut: ':PACKED',
            action: () => this.setPackedColumnsVisibility(dashboard, explicitState),
            type: 'command'
        }];
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
        return false;
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

    applyButtonBarPosition(dashboard, position) {
        const valid = ['bottom', 'bottom-left', 'bottom-right', 'side-left'];
        dashboard.settings.buttonBarPosition = valid.includes(position) ? position : 'bottom';
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
        return false;
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
        if (typeof dashboard.showNotification === 'function') {
            dashboard.showNotification(enabled ? 'Favicons on.' : 'Favicons off.', 'success');
        }
        return false;
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
        if (typeof dashboard.showNotification === 'function') {
            dashboard.showNotification(enabled ? 'Preview cards on.' : 'Preview cards off.', 'success');
        }
        return false;
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
        if (typeof dashboard.showNotification === 'function') {
            const _on = this.language ? this.language.t('config.packedColumnsSavedOn') : null;
            const _off = this.language ? this.language.t('config.packedColumnsSavedOff') : null;
            const onMsg = (_on && _on !== 'config.packedColumnsSavedOn') ? _on : 'Tight columns on — saved.';
            const offMsg = (_off && _off !== 'config.packedColumnsSavedOff') ? _off : 'Tight columns off — saved.';
            dashboard.showNotification(enabled ? onMsg : offMsg, 'success');
        }
        return false;
    }

    handleGotoCommand(args, fullQuery) {
        const dashboard = window.dashboardInstance;
        if (!dashboard || !dashboard.searchComponent) {
            return [];
        }
        const scope = (args[0] || '').toLowerCase();

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
                        } else {
                            window.location.href = href;
                        }
                        return true;
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
                    return true;
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
                    return true;
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

        if (sub === 'refresh' || sub === 'retest') {
            return [{
                name: 'Open health and re-scan all bookmarks',
                shortcut: ':HEALTH',
                type: 'command',
                action: () => {
                    window.location.href = this.buildHealthPageUrl({ refresh: true });
                    return true;
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
                    return true;
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
                        return true;
                    }
                });
            });
            rows.push({
                name: '',
                shortcut: ':HEALTH',
                completion: ':health broken ',
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
                    return true;
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
                    return true;
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

    /**
     * Handle the :find command
     * Filters bookmark tiles on the current page live; Escape clears the filter.
     * @param {Array} args - Arguments after 'find'
     * @returns {Array} Single action row or prompt
     */
    handleFindCommand(args) {
        const query = args.join(' ').trim();
        const t = (key, fb) => this.language ? (this.language.t(key) || fb) : fb;

        if (!query) {
            return [{
                name: t('dashboard.findCommandHint', 'Type text to highlight matching bookmarks on this page'),
                shortcut: ':FIND',
                type: 'command-completion',
                completion: ':find '
            }];
        }

        return [{
            name: `"${query}"`,
            shortcut: ':FIND',
            action: () => {
                document.dispatchEvent(new CustomEvent('nextdash:find', { detail: { query } }));
                return false;
            },
            type: 'command'
        }];
    }
}

// Export for use in other modules
window.SearchCommandsComponent = SearchCommandsComponent;