/**
 * Search Command: :remove
 * Removes bookmarks from the dashboard
 */

class SearchCommandRemove {
    constructor(language = null, updateQueryCallback = null) {
        this.language = language;
        this.updateQueryCallback = updateQueryCallback;
        this.currentBookmarks = [];
        this.allBookmarks = [];
        this.confirmationBookmark = null;
    }

    setLanguage(language) {
        this.language = language;
    }

    setBookmarks(currentBookmarks, allBookmarks) {
        this.currentBookmarks = currentBookmarks;
        this.allBookmarks = allBookmarks;
        this.resetState();
    }

    resetState() {
        this.confirmationBookmark = null;
    }

    handle(args, fullQuery) {
        // If confirmation bookmark exists but query doesn't match, reset
        if (this.confirmationBookmark && fullQuery !== ':remove ' + this.confirmationBookmark.name) {
            this.confirmationBookmark = null;
        }

        // If in confirmation mode, show Yes/No options
        if (this.confirmationBookmark) {
            return this.getConfirmationMatches();
        }

        // Parse query for current page mode (#) and fuzzy search
        const effectiveArgs = (args.length === 1 && args[0] === '') ? [] : args;
        const query = effectiveArgs.join(' ').toLowerCase();
        const isCurrentPageMode = query.includes('#');
        const bookmarksToSearch = isCurrentPageMode ? this.currentBookmarks : this.allBookmarks;
        const fuzzyQuery = isCurrentPageMode ? query.replace('#', '').trim() : query;

        return this.getBookmarkMatches(bookmarksToSearch, fuzzyQuery);
    }

    /**
     * Get confirmation matches (Yes/No)
     * @returns {Array} Confirmation options
     */
    getConfirmationMatches() {
        return [
            {
                name: this.language ? this.language.t('others.yes') : 'Yes',
                shortcut: ':remove',
                action: () => this.removeBookmark(this.confirmationBookmark),
                type: 'command'
            },
            {
                name: this.language ? this.language.t('others.no') : 'No',
                shortcut: ':remove',
                action: () => { this.confirmationBookmark = null; },
                type: 'command'
            }
        ];
    }

    /**
     * Get bookmark matches for fuzzy search
     * @param {Array} bookmarks - Bookmarks to search in
     * @param {string} fuzzyQuery - Search query
     * @returns {Array} Bookmark matches
     */
    getBookmarkMatches(bookmarks, fuzzyQuery) {
        if (fuzzyQuery === '') {
            // Show all bookmarks from selected scope
            return bookmarks.map(bookmark => ({
                name: bookmark.name,
                shortcut: ':remove',
                action: () => { 
                    this.confirmationBookmark = bookmark; 
                    if (this.updateQueryCallback) {
                        this.updateQueryCallback(':remove ' + bookmark.name);
                    }
                    return false; 
                },
                type: 'command'
            }));
        } else {
            // Show matching bookmarks using fuzzy search
            const matchingBookmarks = bookmarks.filter(bookmark =>
                this.fuzzyMatch(fuzzyQuery, bookmark.name)
            );

            return matchingBookmarks.map(bookmark => ({
                name: bookmark.name,
                shortcut: ':remove',
                action: () => { 
                    this.confirmationBookmark = bookmark; 
                    if (this.updateQueryCallback) {
                        this.updateQueryCallback(':remove ' + bookmark.name);
                    }
                    return false; 
                },
                type: 'command'
            }));
        }
    }

    /**
     * Fuzzy match: checks if query is contained in text (case-insensitive)
     * @param {string} query - The search query
     * @param {string} text - The text to search in
     * @returns {boolean} True if text contains query
     */
    fuzzyMatch(query, text) {
        query = query.toLowerCase();
        text = text.toLowerCase();
        return text.includes(query);
    }

    /**
     * Remove a bookmark from the current page, with undo toast.
     * @param {Object} bookmark - The bookmark to remove
     */
    /** A translation, or the English fallback when the key is missing (t() answers the key). */
    tr(key, fallback) {
        const value = this.language ? this.language.t(key) : null;
        return value && value !== key ? value : fallback;
    }

    async removeBookmark(bookmark) {
        const dash = window.dashboardInstance;
        // The bookmark's own page: the list offers every page, and deleting on
        // the page showing answered 404, or took the copy of the same address
        // that happened to be here.
        const currentPageId = Number(bookmark?.pageId ?? (dash ? dash.currentPageId : 1));

        // Where the row sat, so the trash can put it back in its place.
        let deletedIndex = -1;
        try {
            const snapRes = await fetch(`/api/bookmarks?page=${currentPageId}`);
            if (snapRes.ok) {
                const rows = await snapRes.json();
                deletedIndex = Array.isArray(rows) ? rows.findIndex((row) => row?.url === bookmark?.url) : -1;
            }
        } catch (_) { /* the trash then appends it */ }

        try {
            const response = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/bookmarks', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: currentPageId, bookmark })
            });

            if (!response.ok) {
                dash?.showErrorNotification?.(this.tr('commands.removeFailed', 'Could not remove the bookmark'));
                return;
            }

            this.confirmationBookmark = null;

            if (dash) {
                await dash.loadAllBookmarks();
                await dash.loadPageBookmarks(dash.currentPageId);
            }

            // Into the trash like every other delete: without it the bookmark
            // was gone for good once the toast closed. The undo restores that
            // one entry; posting the page as it was before overwrote every
            // change made to the page in the meantime.
            await window.DashboardTrash?.record(
                [{ pageId: currentPageId, index: deletedIndex, bookmark }],
                'command'
            );
            const undoCallback = window.DashboardTrash ? async () => {
                try {
                    if (await window.DashboardTrash.restoreEntries([{ pageId: currentPageId, bookmark }]) && dash) {
                        await dash.loadAllBookmarks();
                        await dash.loadPageBookmarks(dash.currentPageId);
                        dash.showNotification(
                            (this.language ? this.language.t('others.undone') : null) || 'Undone.',
                            'success'
                        );
                    }
                } catch (_) { /* still in the trash, to restore by hand */ }
            } : null;

            const deletedName = bookmark.name || bookmark.url || 'Bookmark';
            const message = this.tr('commands.removedBookmark', '"{name}" removed').replace('{name}', deletedName);
            if (dash) {
                dash.showNotification(message, 'success', { undoCallback, duration: 8000 });
            }
        } catch (error) {
            console.error('Error deleting bookmark:', error);
        }
    }
}

// Export for use in other modules
window.SearchCommandRemove = SearchCommandRemove;