/**
 * Config quick-add: wraps SearchCommandNew (the full & / :new modal) so it
 * works from the config page. Only two things differ from the dashboard version:
 *  1. Notifications go through config UI toasts, not dashboardInstance.
 *  2. After a successful save, the config bookmarks list is refreshed.
 */
class ConfigQuickAdd {
    constructor(configManager) {
        this.manager = configManager;
        this._delegate = null;
    }

    _build() {
        if (typeof SearchCommandNew === 'undefined') return null;

        const delegate = new SearchCommandNew(this.manager.language || null);
        const mgr = this.manager;

        // Route notifications through the config toast
        delegate.notify = (message, type = 'error') => {
            mgr.ui.showNotification(message, type);
        };

        // Wrap createBookmark to detect a successful save and refresh the config list.
        // We track whether a successful response was received so we only refresh on success.
        const origCreate = delegate.createBookmark.bind(delegate);
        const origClose = delegate.closeModal.bind(delegate);

        delegate.createBookmark = async function () {
            let savedPageId = null;

            // Temporarily intercept closeModal — it's only called inside createBookmark on success
            delegate.closeModal = function () {
                const pageEl = document.getElementById('new-bookmark-page');
                savedPageId = pageEl ? Number(pageEl.value) : Number(mgr.currentPageId);
                origClose();
            };

            await origCreate();

            // Restore original closeModal
            delegate.closeModal = origClose;

            // If savedPageId was captured, a successful save+close happened
            if (savedPageId !== null && Number(savedPageId) === Number(mgr.currentPageId)) {
                try {
                    const newData = await mgr.data.loadBookmarksByPage(savedPageId);
                    mgr.bookmarksData = newData;
                    mgr.refreshBookmarksList({ skipFlush: true });
                } catch { /* ignore */ }
            }
        };

        return delegate;
    }

    open() {
        if (!this._delegate) {
            this._delegate = this._build();
        }
        if (!this._delegate) return;

        // Refresh context with latest data before opening
        const pages = (this.manager.pagesData || []).filter(p => !p.archived);
        this._delegate.setContext(
            this.manager.currentPageId || 1,
            this.manager.bookmarksPageCategories || [],
            pages
        );

        this._delegate.openModal();
    }
}

window.ConfigQuickAdd = ConfigQuickAdd;
