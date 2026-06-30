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

    _bookmarkUrlKey(url) {
        return String(url || '').trim().toLowerCase();
    }

    _resolveTargetPageId() {
        const pageEl = document.getElementById('new-bookmark-page');
        const fromModal = pageEl ? Number(pageEl.value) : NaN;
        if (Number.isFinite(fromModal) && fromModal >= 1) {
            return fromModal;
        }
        const mgr = this.manager;
        return Number(mgr.getResolvedBookmarksPageId?.() ?? mgr.currentPageId) || 1;
    }

    _clearBookmarksSearchUi(mgr) {
        mgr.currentBookmarksSearch = '';
        const searchEl = document.getElementById('bookmarks-search');
        if (searchEl) {
            searchEl.value = '';
        }
        const clearEl = document.getElementById('bookmarks-search-clear');
        if (clearEl) {
            clearEl.hidden = true;
        }
    }

    _ensureBookmarkVisibleInFilter(mgr, bookmark, viewingPageId) {
        const newCategory = String(bookmark?.category || '').trim();
        const filter = mgr.currentBookmarksCategoryFilter || '__all__';
        const isNamedCategoryFilter = filter !== '__all__'
            && filter !== '__none__'
            && filter !== '__missing_icon__'
            && filter !== '__icon_failed__'
            && !String(filter).startsWith('__');
        if (isNamedCategoryFilter && filter !== newCategory) {
            mgr.currentBookmarksCategoryFilter = newCategory || '__all__';
            mgr.saveLastCategoryFilterForPage?.(viewingPageId, mgr.currentBookmarksCategoryFilter);
            const filterSelect = document.getElementById('bookmarks-category-filter');
            if (filterSelect) {
                filterSelect.value = mgr.currentBookmarksCategoryFilter;
            }
            return;
        }
        if (filter === '__none__' && newCategory) {
            mgr.currentBookmarksCategoryFilter = '__all__';
            mgr.saveLastCategoryFilterForPage?.(viewingPageId, '__all__');
            const filterSelect = document.getElementById('bookmarks-category-filter');
            if (filterSelect) {
                filterSelect.value = '__all__';
            }
        }
    }

    async _applyBookmarkAfterSave(pageId, bookmark) {
        const mgr = this.manager;
        const pid = Number(pageId);
        if (!Number.isFinite(pid) || pid < 1 || !bookmark) {
            return;
        }

        const urlKey = this._bookmarkUrlKey(bookmark.url);
        let listIndex = -1;

        if (mgr.bookmarkStore) {
            const list = mgr.bookmarkStore.getPage(pid);
            listIndex = list.findIndex((bm) => this._bookmarkUrlKey(bm.url) === urlKey);
            if (listIndex < 0) {
                list.push({ ...bookmark, pageId: pid });
                listIndex = list.length - 1;
            }
        } else if (pid === Number(mgr.currentPageId) && Array.isArray(mgr.bookmarksData)) {
            listIndex = mgr.bookmarksData.findIndex((bm) => this._bookmarkUrlKey(bm.url) === urlKey);
            if (listIndex < 0) {
                mgr.bookmarksData.push({ ...bookmark, pageId: pid });
                listIndex = mgr.bookmarksData.length - 1;
            }
        }

        const viewingPageId = Number(mgr.getResolvedBookmarksPageId?.() ?? mgr.currentPageId);
        if (pid !== viewingPageId) {
            return;
        }

        mgr.currentPageId = viewingPageId;
        this._clearBookmarksSearchUi(mgr);
        this._ensureBookmarkVisibleInFilter(mgr, bookmark, viewingPageId);

        mgr.refreshBookmarksList({
            skipFlush: true,
            focusIndex: listIndex,
            highlightIndex: listIndex,
        });
        mgr.markDirty?.();

        if (mgr.bookmarkStore) {
            try {
                await mgr.bookmarkStore.loadPage(pid);
                if (pid === viewingPageId) {
                    const synced = mgr.bookmarkStore.getPage(pid);
                    const syncedIndex = synced.findIndex((bm) => this._bookmarkUrlKey(bm.url) === urlKey);
                    mgr.refreshBookmarksList({
                        skipFlush: true,
                        focusIndex: syncedIndex >= 0 ? syncedIndex : synced.length - 1,
                        highlightIndex: syncedIndex >= 0 ? syncedIndex : synced.length - 1,
                    });
                }
            } catch (error) {
                console.warn('Could not resync bookmarks after quick add:', error);
            }
        }
    }

    _build() {
        if (typeof SearchCommandNew === 'undefined') return null;

        const delegate = new SearchCommandNew(this.manager.language || null);
        const mgr = this.manager;
        const quickAdd = this;

        delegate.notify = (message, type = 'error') => {
            mgr.ui.showNotification(message, type);
        };

        const origCreate = delegate.createBookmark.bind(delegate);

        delegate.createBookmark = async function () {
            const result = await origCreate();
            if (result?.ok) {
                await quickAdd._applyBookmarkAfterSave(result.pageId, result.bookmark);
            }
            return result;
        };

        return delegate;
    }

    open() {
        this._delegate = this._build();
        if (!this._delegate) return;

        if (!this.manager?.bookmarkStore) {
            console.warn('ConfigQuickAdd: config manager is not wired correctly');
            return;
        }

        const viewingPageId = this.manager.getResolvedBookmarksPageId?.()
            ?? this.manager.currentPageId
            ?? 1;
        const pages = (this.manager.pagesData || []).filter((p) => !this.manager.isPageArchived?.(p.id));
        this._delegate.setContext(
            viewingPageId,
            this.manager.bookmarksPageCategories || [],
            pages
        );

        this._delegate.openModal();
    }
}

window.ConfigQuickAdd = ConfigQuickAdd;
