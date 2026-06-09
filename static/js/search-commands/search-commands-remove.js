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
    async removeBookmark(bookmark) {
        const dash = window.dashboardInstance;
        const currentPageId = dash ? dash.currentPageId : 1;

        // Snapshot the full bookmark list before deleting so undo can restore it.
        let snapshotBeforeDelete = null;
        try {
            const snapRes = await fetch(`/api/bookmarks?page=${currentPageId}`);
            if (snapRes.ok) snapshotBeforeDelete = await snapRes.json();
        } catch (_) { /* proceed without snapshot */ }

        try {
            const response = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/bookmarks', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: currentPageId, bookmark })
            });

            if (!response.ok) {
                console.error('Failed to delete bookmark');
                return;
            }

            this.confirmationBookmark = null;

            if (dash) {
                await dash.loadAllBookmarks();
                await dash.loadPageBookmarks(currentPageId);
            }

            const undoCallback = snapshotBeforeDelete ? async () => {
                try {
                    const restoreRes = await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)(`/api/bookmarks?page=${currentPageId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(snapshotBeforeDelete)
                    });
                    if (restoreRes.ok && dash) {
                        await dash.loadAllBookmarks();
                        await dash.loadPageBookmarks(currentPageId);
                        dash.showNotification(
                            (this.language ? this.language.t('others.undone') : null) || 'Undone.',
                            'success'
                        );
                    }
                } catch (_) { /* silent */ }
            } : null;

            const deletedName = bookmark.name || bookmark.url || 'Bookmark';
            const message = `"${deletedName}" verwijderd`;
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