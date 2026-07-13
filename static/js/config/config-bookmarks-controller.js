/**
 * Bookmarks tab orchestration — page loads, list refresh, structure workspace, validation.
 */
class ConfigBookmarksController {
    constructor(config) {
        this.config = config;
    }

    get c() {
        return this.config;
    }

    async saveBookmarksPage(pageId, bookmarks) {
        if (Array.isArray(bookmarks)) {
            this.c.bookmarkStore.setPage(pageId, bookmarks);
        }
        await this.c.bookmarkStore.persistPage(pageId, (fn) => this.c.withRetry(fn));
    }

    async loadPageBookmarks(pageId) {
        try {
            // Normalize once with a numeric fallback so a non-numeric selector value
            // (e.g. an empty <select>) never puts NaN into currentPageId; the rest of
            // the controller reads currentPageId back as Number(...) || 1.
            const pid = Number(pageId) || Number(this.c.currentPageId) || 1;
            this.c.currentPageId = pid;
            await this.c.bookmarkStore.loadPage(pid);
            this.c.bookmarksPageCategories = (await this.c.data.loadCategoriesByPage(pid)).map(cat => ({ ...cat }));
            this.c.currentBookmarksCategoryFilter = this.c.getLastCategoryFilterForPage(this.c.currentPageId);

            if (this.c.bookmarks) {
                this.c.bookmarks.activeDetailIndex = null;
                this.c.bookmarks.setDetailPanelMode?.('empty');
            }

            this.refreshBookmarksFilterOptions();
            this.refreshBookmarksList({ skipFlush: true });
            this.syncBookmarksPageSelectorUI(this.c.currentPageId);
        } catch (error) {
            this.c.ui.showErrorWithReload(this.c.language.t('config.errorLoadingBookmarks'));
        }
    }

    async consumeHealthPendingBookmark() {
        let raw = null;
        try {
            raw = sessionStorage.getItem('nextdash_health_open_bookmark');
            if (!raw) return;
            sessionStorage.removeItem('nextdash_health_open_bookmark');
        } catch (e) {
            return;
        }

        let pending = null;
        try {
            pending = JSON.parse(raw);
        } catch (e) {
            return;
        }

        const pageId = Number(pending?.pageId);
        if (!Number.isFinite(pageId)) return;

        if (this.c.ui?.switchToTab) {
            this.c.ui.switchToTab('bookmarks');
        }
        window.location.hash = '#bookmarks';

        if (Number(this.c.currentPageId) !== pageId) {
            await this.loadPageBookmarks(pageId);
        }

        let idx = Number(pending?.index);
        if (!Number.isFinite(idx) || !this.c.bookmarksData?.[idx]) {
            const url = String(pending?.url || '').trim().toLowerCase();
            idx = (this.c.bookmarksData || []).findIndex(
                (bm) => String(bm?.url || '').trim().toLowerCase() === url
            );
        }

        if (idx >= 0 && this.c.bookmarks?.openDetailPanel) {
            this.c.bookmarks.openDetailPanel(idx, this.c.bookmarksData, this.c.bookmarksPageCategories);
            requestAnimationFrame(() => {
                document.querySelector(`[data-bookmark-index="${idx}"]`)?.scrollIntoView({ block: 'nearest' });
            });
        }
    }

    getResolvedBookmarksPageId() {
        const mem = Number(this.c.currentPageId);
        if (
            Number.isFinite(mem) &&
            mem >= 1 &&
            this.c.getVisiblePages().some((p) => Number(p.id) === mem)
        ) {
            return mem;
        }
        const sel = document.getElementById('page-selector');
        if (sel && sel.options && sel.selectedIndex >= 0) {
            const raw = sel.options[sel.selectedIndex]?.value ?? sel.value;
            const v = parseInt(String(raw), 10);
            if (Number.isFinite(v) && v >= 1 && this.c.getVisiblePages().some((p) => Number(p.id) === v)) {
                return v;
            }
        }
        return 1;
    }

    syncBookmarksPageSelectorUI(pageId) {
        const sel = document.getElementById('page-selector');
        if (!sel || !sel.options?.length) {
            return;
        }
        const want = String(Number(pageId));
        for (let i = 0; i < sel.options.length; i++) {
            if (String(sel.options[i].value) === want) {
                sel.selectedIndex = i;
                sel.__customSelectInstance?.refresh?.();
                return;
            }
        }
    }

    async refreshSmartCollectionCounters() {
        try {
            const res = await fetch('/api/bookmarks?all=true');
            if (!res.ok) return;
            const allBookmarks = await res.json();
            const list = Array.isArray(allBookmarks) ? allBookmarks : [];
            const now = Date.now();
            const weekMs = 7 * 24 * 60 * 60 * 1000;
            const staleMs = 30 * 24 * 60 * 60 * 1000;

            const recentCount = list.filter((bookmark) => {
                const lastOpened = Number(bookmark?.lastOpened || 0);
                return lastOpened > 0 && (now - lastOpened) <= weekMs;
            }).length;
            const staleCount = list.filter((bookmark) => {
                const lastOpened = Number(bookmark?.lastOpened || 0);
                return lastOpened === 0 || (now - lastOpened) > staleMs;
            }).length;
            const mostUsedCount = list.filter((bookmark) => Number(bookmark?.openCount || 0) > 0).length;
            const todayCount = list.length;

            const setBadge = (id, count) => {
                const el = document.getElementById(id);
                if (el) el.textContent = String(count);
            };
            setBadge('smart-recent-count-badge', recentCount);
            setBadge('smart-today-count-badge', todayCount);
            setBadge('smart-stale-count-badge', staleCount);
            setBadge('smart-most-used-count-badge', mostUsedCount);
        } catch (error) {
            // Keep config functional even if counters fail.
        }
    }

    addBookmark() {
        const filterValue = this.c.currentBookmarksCategoryFilter || '__all__';
        let preferredCategory = '';
        if (filterValue !== '__all__' && filterValue !== '__none__' && !String(filterValue).startsWith('__')) {
            preferredCategory = filterValue;
        } else {
            preferredCategory = this.c.getLastUsedCategoryIdForPage(this.c.currentPageId) || '';
        }
        const newBookmark = this.c.bookmarks.add(this.c.bookmarksData, { preferredCategory });
        this.warnDuplicateUrl(newBookmark.url);
        const newIndex = this.c.bookmarksData.length - 1;
        this.refreshBookmarksList({ focusIndex: newIndex });
        if (typeof this.c.bookmarks.openDetailPanel === 'function') {
            this.c.bookmarks.openDetailPanel(newIndex, this.c.bookmarksData, this.c.bookmarksPageCategories);
        }
        if (this.c.settingsData.faviconRefreshPolicy === 'on-save' && typeof this.c.bookmarks._refreshDetailMeta === 'function') {
            this.c.bookmarks._refreshDetailMeta(newIndex, newBookmark);
        }
        this.c.markDirty();
    }

    async removeBookmark(index) {
        const undoSnapshot = this.c.captureUndoSnapshot();
        const removed = await this.c.bookmarks.remove(this.c.bookmarksData, index);
        if (removed) {
            if (this.c.bookmarks.activeDetailIndex === index) {
                this.c.bookmarks.activeDetailIndex = null;
                this.c.bookmarks.setDetailPanelMode?.('empty');
            }
            this.refreshBookmarksList();
            try {
                const saveBookmarksPageId = this.getResolvedBookmarksPageId();
                this.c.currentPageId = saveBookmarksPageId;
                await this.saveBookmarksPage(saveBookmarksPageId, this.c.bookmarksData);
                this.c.showUndoNotification('Bookmark removed.', undoSnapshot);
                this.c.markDirty();
            } catch (error) {
                this.c.restoreUndoSnapshot(undoSnapshot);
                this.c.undoSnapshot = null;
                this.c.ui.showNotification('Failed to remove bookmark. Changes reverted.', 'error');
            }
        }
    }

    async moveBookmark(index) {
        const bookmark = this.c.bookmarksData[index];
        if (!bookmark) return;

        const pageOptions = this.c.pagesData
            .map(page => {
                const isCurrent = Number(page.id) === Number(this.c.currentPageId);
                return `<button class="modal-page-btn ${isCurrent ? 'current' : ''}" ${isCurrent ? 'disabled' : `onclick="window.tempMoveBookmark(${index}, ${page.id})"`}>${page.name}${isCurrent ? ' (current)' : ''}</button>`;
            })
            .join('');

        const html = `
            <p>${this.c.language.t('config.moveBookmarkMessage')}</p>
            <div class="modal-page-list">
                ${pageOptions}
            </div>
        `;

        window.tempMoveBookmark = async (idx, pid) => {
            await this.doMoveBookmark(idx, pid);
            AppModal.hide();
        };

        await window.AppModal.confirm({
            title: this.c.language.t('config.moveBookmarkTitle'),
            htmlMessage: html,
            confirmText: this.c.language.t('config.cancel'),
            showCancel: false,
            onConfirm: () => {}
        });

        delete window.tempMoveBookmark;
    }

    async doMoveBookmark(index, newPageId, targetCategory) {
        const bookmark = this.c.bookmarksData[index];
        if (!bookmark) return;

        const sourcePageId = this.getResolvedBookmarksPageId();

        if (Number(newPageId) === Number(sourcePageId)) {
            this.c.ui.showNotification(this.c.language.t('config.bookmarkAlreadyHere'), 'info');
            return;
        }

        try {
            this.c.bookmarksData.splice(index, 1);
            const newPageBookmarks = await this.c.data.loadBookmarksByPage(newPageId);
            const movedBookmark = { ...bookmark, category: targetCategory || '' };
            newPageBookmarks.push(movedBookmark);

            await this.saveBookmarksPage(sourcePageId, this.c.bookmarksData);
            await this.saveBookmarksPage(newPageId, newPageBookmarks);

            this.refreshBookmarksList();
            this.c.ui.showNotification(this.c.language.t('config.bookmarkMoved'), 'success');
        } catch (error) {
            console.error('Error moving bookmark:', error);
            this.c.ui.showNotification(this.c.language.t('config.errorMovingBookmark'), 'error');
        }
    }

    async bulkMoveBookmarksToPage(newPageId, targetCategory = '') {
        const currentPageId = Number(this.c.currentPageId) || 1;
        if (newPageId === currentPageId) {
            this.c.ui.showNotification(this.c.language.t('config.bookmarkAlreadyHere'), 'info');
            return;
        }

        const selectedIndexes = this.c.bookmarks.getSelectedIndexes();
        if (!Array.isArray(selectedIndexes) || selectedIndexes.length === 0) {
            this.c.ui.showNotification(this.c.language.t('config.selectBookmarksFirst') || 'Select bookmarks first.', 'info');
            return;
        }

        const selectedSet = new Set(selectedIndexes);
        const bookmarksToMove = selectedIndexes
            .map((index) => this.c.bookmarksData[index])
            .filter(Boolean);

        if (bookmarksToMove.length === 0) {
            this.c.ui.showNotification('No bookmarks selected.', 'info');
            return;
        }

        const remainingBookmarks = this.c.bookmarksData.filter((_, index) => !selectedSet.has(index));

        try {
            const targetBookmarks = await this.c.data.loadBookmarksByPage(newPageId);
            const movedBookmarks = bookmarksToMove.map((bookmark) => ({ ...bookmark, category: targetCategory }));
            const updatedTargetBookmarks = [...targetBookmarks, ...movedBookmarks];

            await this.saveBookmarksPage(currentPageId, remainingBookmarks);
            await this.saveBookmarksPage(newPageId, updatedTargetBookmarks);

            this.c.bookmarksData = remainingBookmarks;
            this.c.bookmarks.clearSelection();
            this.refreshBookmarksList({ skipFlush: true });
            this.c.ui.showNotification(`${movedBookmarks.length} bookmark(s) moved to page.`, 'success');
        } catch (error) {
            console.error('Error moving bookmarks to page:', error);
            this.c.ui.showNotification(this.c.language.t('config.errorMovingBookmark') || 'Failed to move bookmarks.', 'error');
        }
    }

    refreshPageDropdowns() {
        const visiblePages = this.c.getVisiblePages();
        this.c.currentPageId = this.c.resolvePageId(this.c.currentPageId, visiblePages);
        this.c.currentCategoriesPageId = this.c.resolvePageId(this.c.currentCategoriesPageId, visiblePages);

        this.c.pages.renderPageSelector(visiblePages, this.c.currentPageId);
        const pageSel = document.getElementById('page-selector');
        if (pageSel && pageSel.__customSelectInstance) {
            pageSel.__customSelectInstance.refresh();
        }

        const catSel = document.getElementById('categories-page-selector');
        if (catSel) {
            const wantCatPage = Number(this.c.currentCategoriesPageId);
            catSel.innerHTML = '';
            let catMatched = false;
            visiblePages.forEach(page => {
                const opt = document.createElement('option');
                opt.value = page.id;
                opt.textContent = page.name;
                if (Number.isFinite(wantCatPage) && Number(page.id) === wantCatPage) {
                    opt.selected = true;
                    catMatched = true;
                }
                catSel.appendChild(opt);
            });
            if (catMatched) {
                catSel.value = String(wantCatPage);
            } else if (catSel.options.length > 0) {
                catSel.value = catSel.options[0].value;
                this.c.currentCategoriesPageId = Number(catSel.value);
            }
            catSel.__customSelectInstance?.refresh?.();
        }

        if (this.c.settings && typeof this.c.settings.populateSmartPageSelectors === 'function') {
            this.c.settings.populateSmartPageSelectors(this.c.pagesData, this.c.settingsData);
        }
    }

    refreshBookmarksFilterOptions() {
        const filterSelect = document.getElementById('bookmarks-category-filter');
        if (!filterSelect) {
            return;
        }

        const previousValue = this.c.currentBookmarksCategoryFilter || filterSelect.value || '__all__';
        const options = [];

        options.push({ value: '__all__', label: this.c.language.t('config.allCategories') || 'All categories' });
        options.push({ value: '__none__', label: this.c.language.t('config.noCategory') || 'No category' });
        options.push({ value: '__missing_icon__', label: this.c.language.t('config.filterMissingFavicon') || 'Missing favicon' });
        options.push({ value: '__icon_failed__', label: this.c.language.t('config.filterFaviconFailed') || 'Favicon failed' });

        this.c.bookmarksPageCategories.forEach((category) => {
            options.push({ value: category.id, label: category.name });
        });

        filterSelect.innerHTML = '';
        options.forEach((optionData) => {
            const option = document.createElement('option');
            option.value = optionData.value;
            option.textContent = optionData.label;
            filterSelect.appendChild(option);
        });

        const isStillValid = options.some((option) => option.value === previousValue);
        this.c.currentBookmarksCategoryFilter = isStillValid ? previousValue : '__all__';
        filterSelect.value = this.c.currentBookmarksCategoryFilter;

        const bulkPageSelect = document.getElementById('bulk-page-select');
        if (bulkPageSelect) {
            const currentPageId = Number(this.c.currentPageId) || 1;
            const previousPage = bulkPageSelect.value;
            bulkPageSelect.innerHTML = '';
            const currentSuffix = this.c.language.t('config.currentPageShort') || 'current';

            this.c.getVisiblePages().forEach((page) => {
                const option = document.createElement('option');
                option.value = String(page.id);
                option.textContent = Number(page.id) === currentPageId
                    ? `${page.name} (${currentSuffix})`
                    : page.name;
                bulkPageSelect.appendChild(option);
            });

            const restoredPageId = this.c.getVisiblePages().some((page) => String(page.id) === previousPage)
                ? Number(previousPage)
                : currentPageId;
            bulkPageSelect.value = String(restoredPageId);
            void this.populateBulkMoveCategorySelect(restoredPageId);
        }
    }

    async populateBulkMoveCategorySelect(pageId) {
        const bulkMoveCategorySelect = document.getElementById('bulk-move-category-select');
        if (!bulkMoveCategorySelect) return;

        const targetPageId = Number(pageId) || 0;
        bulkMoveCategorySelect.innerHTML = '';
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = this.c.language.t('config.noCategory') || 'No category';
        bulkMoveCategorySelect.appendChild(emptyOpt);

        if (!targetPageId) {
            bulkMoveCategorySelect.disabled = true;
            return;
        }

        const currentPageId = Number(this.c.currentPageId) || 1;
        const cats = targetPageId === currentPageId
            ? (this.c.bookmarksPageCategories || [])
            : await fetch(`/api/categories?page=${targetPageId}`).then((r) => (r.ok ? r.json() : [])).catch(() => []);

        (Array.isArray(cats) ? cats : []).forEach((cat) => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.name;
            bulkMoveCategorySelect.appendChild(opt);
        });
        bulkMoveCategorySelect.disabled = false;
    }

    refreshBookmarksList(options = {}) {
        this.c.bookmarks.render(this.c.bookmarksData, this.c.bookmarksPageCategories, {
            filterCategory: this.c.currentBookmarksCategoryFilter,
            sortOrder: this.c.currentBookmarksSort || 'default',
            searchQuery: this.c.currentBookmarksSearch || '',
            skipFlush: options.skipFlush === true
        });
        this.validateBookmarkConflicts({ showToast: false });

        this.c.bookmarks.initReorder(this.c.bookmarksData, (newBookmarks, meta = {}) => {
            this.c.bookmarksData = newBookmarks;
            this.refreshBookmarksList({ ...meta, skipFlush: true });
            this.c.markDirty();
        }, {
            filterCategory: this.c.currentBookmarksCategoryFilter
        });

        if (typeof options.focusIndex === 'number') {
            const focusElement = document.querySelector(`[data-bookmark-index="${options.focusIndex}"] input`);
            if (focusElement) {
                focusElement.focus();
            }
        }

        if (typeof options.highlightIndex === 'number') {
            const highlightElement = document.querySelector(`[data-bookmark-index="${options.highlightIndex}"]`);
            if (highlightElement) {
                highlightElement.classList.add('reorder-highlight');
                setTimeout(() => {
                    highlightElement.classList.remove('reorder-highlight');
                }, 700);
            }
        }

        const activeIdx = this.c.bookmarks?.activeDetailIndex;
        if (typeof activeIdx === 'number' && this.c.bookmarksData[activeIdx]) {
            this.c.bookmarks.setDetailPanelMode?.('editing');
        }

        this.renderStructureWorkspace();
    }

    renderStructureWorkspace() {
        const pagesList = document.getElementById('structure-pages-list');
        const categoriesList = document.getElementById('structure-categories-list');
        const contextLabel = document.getElementById('structure-context-label');
        const archivedList = document.getElementById('structure-archived-pages-list');
        if (!pagesList || !categoriesList || !archivedList) {
            return;
        }

        pagesList.innerHTML = '';
        this.c.getVisiblePages().forEach((page) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `structure-list-item${Number(page.id) === Number(this.c.currentPageId) ? ' is-active' : ''}`;
            button.textContent = page.name;
            button.addEventListener('click', async () => {
                const targetPageId = Number(page.id);
                const flushed = await this.c.flushCategoriesPageBeforeSwitch();
                if (!flushed) {
                    this.c.syncCategoriesPageSelectorUI(this.c.currentCategoriesPageId);
                    return;
                }
                this.c.currentPageId = targetPageId;
                this.c.currentCategoriesPageId = targetPageId;
                this.c.saveLastCategoriesPageId(targetPageId);
                this.syncBookmarksPageSelectorUI(targetPageId);
                this.c.syncCategoriesPageSelectorUI(targetPageId);
                await this.loadPageBookmarks(targetPageId);
                await this.c.loadPageCategories(targetPageId);
                this.renderStructureWorkspace();
            });
            pagesList.appendChild(button);
        });
        archivedList.innerHTML = '';
        this.c.pagesData.filter((page) => this.c.isPageArchived(page.id)).forEach((page) => {
            const wrap = document.createElement('div');
            wrap.className = 'structure-list-item';
            wrap.textContent = page.name;
            const restoreButton = document.createElement('button');
            restoreButton.type = 'button';
            restoreButton.className = 'btn btn-secondary btn-small';
            restoreButton.textContent = this.c.language.t('config.restore') || 'Restore';
            restoreButton.style.float = 'right';
            restoreButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.c.restoreArchivedPage(page.id);
            });
            wrap.appendChild(restoreButton);
            archivedList.appendChild(wrap);
        });

        categoriesList.innerHTML = '';
        const categoryItems = Array.isArray(this.c.bookmarksPageCategories) ? this.c.bookmarksPageCategories : [];
        categoryItems.forEach((category) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `structure-list-item${this.c.currentBookmarksCategoryFilter === category.id ? ' is-active' : ''}`;
            button.textContent = category.name;
            button.addEventListener('click', () => {
                this.c.currentBookmarksCategoryFilter = category.id;
                this.c.saveLastCategoryFilterForPage(this.c.currentPageId, category.id);
                this.c.saveLastUsedCategoryIdForPage(this.c.currentPageId, category.id);
                const filterSelect = document.getElementById('bookmarks-category-filter');
                if (filterSelect) filterSelect.value = category.id;
                this.refreshBookmarksList();
            });
            categoriesList.appendChild(button);
        });

        if (contextLabel) {
            const activePage = this.c.getVisiblePages().find((page) => Number(page.id) === Number(this.c.currentPageId));
            const activeCategory = categoryItems.find((category) => category.id === this.c.currentBookmarksCategoryFilter);
            const categoryLabel = activeCategory
                ? activeCategory.name
                : (this.c.currentBookmarksCategoryFilter === '__all__'
                    ? (this.c.language.t('config.allCategories') || 'All categories')
                    : (this.c.language.t('config.noCategory') || 'No category'));
            const contextTpl = this.c.language.t('config.structureContextLabel') || 'Context: {page} / {category}';
            contextLabel.textContent = contextTpl
                .replace('{page}', activePage ? activePage.name : (this.c.language.t('config.page') || 'page'))
                .replace('{category}', categoryLabel);
        }
    }

    async preparePaletteBookmarksContext() {
        this.c.ensureBookmarksTabActive();
        const pageId = Number(this.c.currentPageId) || 1;
        await this.loadPageBookmarks(pageId);
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    warnDuplicateUrl(url) {
        const normalized = (url || '').trim().toLowerCase();
        if (!normalized) return;

        const duplicate = this.c.bookmarksData.some((bookmark, index) => {
            if (index === this.c.bookmarksData.length - 1) return false;
            return (bookmark.url || '').trim().toLowerCase() === normalized;
        });

        if (duplicate) {
            this.c.ui.showNotification('Duplicate URL detected for the new bookmark.', 'warning');
        }
    }

    findDuplicateBookmarkUrls(bookmarks) {
        const seen = new Set();
        const duplicates = new Set();

        bookmarks.forEach((bookmark) => {
            const url = (bookmark.url || '').trim().toLowerCase();
            if (!url) {
                return;
            }

            if (seen.has(url)) {
                duplicates.add(url);
            } else {
                seen.add(url);
            }
        });

        return Array.from(duplicates);
    }

    getDuplicateFinderShortcutSet() {
        const finderShortcuts = (Array.isArray(this.c.findersData) ? this.c.findersData : [])
            .map((finder) => String(finder?.shortcut || '').trim().toUpperCase())
            .filter(Boolean);
        const counts = new Map();
        finderShortcuts.forEach((shortcut) => {
            counts.set(shortcut, (counts.get(shortcut) || 0) + 1);
        });
        return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([shortcut]) => shortcut));
    }

    validateBookmarkConflicts(options = {}) {
        const urlMap = new Map();
        const shortcutMap = new Map();
        const normalizedUrlByIndex = new Map();
        const normalizedShortcutByIndex = new Map();

        this.c.bookmarksData.forEach((bookmark, index) => {
            const normalizedUrl = (bookmark?.url || '').trim().toLowerCase();
            const normalizedShortcut = (bookmark?.shortcut || '').trim().toUpperCase();
            normalizedUrlByIndex.set(index, normalizedUrl);
            normalizedShortcutByIndex.set(index, normalizedShortcut);

            if (normalizedUrl) {
                const list = urlMap.get(normalizedUrl) || [];
                list.push(index);
                urlMap.set(normalizedUrl, list);
            }
            if (normalizedShortcut) {
                const list = shortcutMap.get(normalizedShortcut) || [];
                list.push(index);
                shortcutMap.set(normalizedShortcut, list);
            }
        });

        const duplicateUrlIndexes = new Set();
        const duplicateShortcutIndexes = new Set();
        const finderConflictIndexes = new Set();
        urlMap.forEach((indexes) => {
            if (indexes.length > 1) {
                indexes.forEach((idx) => duplicateUrlIndexes.add(idx));
            }
        });
        shortcutMap.forEach((indexes) => {
            if (indexes.length > 1) {
                indexes.forEach((idx) => duplicateShortcutIndexes.add(idx));
            }
        });

        const finderShortcutSet = new Set(
            (Array.isArray(this.c.findersData) ? this.c.findersData : [])
                .map((finder) => String(finder?.shortcut || '').trim().toUpperCase())
                .filter(Boolean)
        );
        normalizedShortcutByIndex.forEach((shortcut, index) => {
            if (shortcut && finderShortcutSet.has(shortcut)) {
                finderConflictIndexes.add(index);
            }
        });

        this.c.bookmarksData.forEach((_, index) => {
            const urlInput = document.getElementById(`bookmark-url-${index}`);
            const shortcutInput = document.getElementById(`bookmark-shortcut-${index}`);
            if (urlInput) {
                urlInput.classList.toggle('field-conflict', duplicateUrlIndexes.has(index));
            }
            if (shortcutInput) {
                const hasBlockingShortcutConflict = duplicateShortcutIndexes.has(index);
                shortcutInput.classList.toggle('field-conflict', hasBlockingShortcutConflict);
                const hasFinderWarning = finderConflictIndexes.has(index);
                shortcutInput.classList.toggle('field-warning', hasFinderWarning && !hasBlockingShortcutConflict);
                if (hasBlockingShortcutConflict) {
                    shortcutInput.title = this.c.language?.t('config.shortcutUniqueHint')
                        || 'Shortcut must be unique within this page.';
                } else if (hasFinderWarning) {
                    shortcutInput.title = this.c.language?.t('config.shortcutFinderHint')
                        || 'Shortcut matches a finder shortcut.';
                } else {
                    shortcutInput.removeAttribute('title');
                }
            }
        });

        const activeIdx = this.c.bookmarks?.activeDetailIndex ?? -1;
        if (activeIdx >= 0) {
            const detailUrl = document.getElementById('detail-url');
            const detailUrlMsg = document.getElementById('detail-url-conflict-msg');
            const detailShortcut = document.getElementById('detail-shortcut');
            const detailShortcutMsg = document.getElementById('detail-shortcut-conflict-msg');
            if (detailUrl) {
                const urlVal = detailUrl.value.trim().toLowerCase();
                const isDupUrl = Boolean(urlVal) && duplicateUrlIndexes.has(activeIdx);
                detailUrl.classList.toggle('field-conflict', isDupUrl);
                if (detailUrlMsg) detailUrlMsg.hidden = !isDupUrl;
            }
            if (detailShortcut) {
                const scVal = detailShortcut.value.trim().toUpperCase();
                const hasBlockingShortcutConflict = Boolean(scVal) && duplicateShortcutIndexes.has(activeIdx);
                const hasFinderWarning = Boolean(scVal) && finderConflictIndexes.has(activeIdx);
                detailShortcut.classList.toggle('field-conflict', hasBlockingShortcutConflict);
                detailShortcut.classList.toggle('field-warning', hasFinderWarning && !hasBlockingShortcutConflict);
                if (detailShortcutMsg) detailShortcutMsg.hidden = !hasBlockingShortcutConflict;
                if (hasBlockingShortcutConflict) {
                    detailShortcut.title = this.c.language?.t('config.shortcutUniqueHint')
                        || 'Shortcut must be unique within this page.';
                } else if (hasFinderWarning) {
                    detailShortcut.title = this.c.language?.t('config.shortcutFinderHint')
                        || 'Shortcut matches a finder shortcut.';
                } else {
                    detailShortcut.removeAttribute('title');
                }
            }
        }

        const hasConflicts = duplicateUrlIndexes.size > 0 || duplicateShortcutIndexes.size > 0;
        if (hasConflicts && options.showToast) {
            this.c.ui.showNotification(
                `Fix conflicts first: ${duplicateUrlIndexes.size} duplicate URL(s), ${duplicateShortcutIndexes.size} duplicate shortcut(s) on this page.`,
                'warning'
            );
        }
        if (!hasConflicts && finderConflictIndexes.size > 0 && options.showToast) {
            const duplicateFinderShortcuts = this.getDuplicateFinderShortcutSet();
            const severity = duplicateFinderShortcuts.size > 0 ? 'warning' : 'info';
            this.c.ui.showNotification(
                `Shortcut warning: ${finderConflictIndexes.size} bookmark shortcut(s) overlap with finder shortcuts.`,
                severity
            );
        }

        const saveButtons = this.c.getSaveButtons();
        saveButtons.forEach((saveBtn) => {
            saveBtn.disabled = hasConflicts;
        });

        return {
            hasConflicts,
            duplicateUrlCount: duplicateUrlIndexes.size,
            duplicateShortcutCount: duplicateShortcutIndexes.size,
            finderShortcutConflictCount: finderConflictIndexes.size
        };
    }

    installPublicMethods() {
        const c = this.config;
        for (const name of [
            'saveBookmarksPage', 'loadPageBookmarks', 'consumeHealthPendingBookmark',
            'getResolvedBookmarksPageId', 'syncBookmarksPageSelectorUI', 'refreshSmartCollectionCounters',
            'addBookmark', 'removeBookmark', 'moveBookmark', 'doMoveBookmark', 'bulkMoveBookmarksToPage',
            'refreshPageDropdowns', 'refreshBookmarksFilterOptions', 'populateBulkMoveCategorySelect',
            'refreshBookmarksList', 'renderStructureWorkspace', 'preparePaletteBookmarksContext',
            'warnDuplicateUrl', 'findDuplicateBookmarkUrls', 'getDuplicateFinderShortcutSet', 'validateBookmarkConflicts',
        ]) {
            c[name] = (...args) => this[name](...args);
        }
    }
}

window.ConfigBookmarksController = ConfigBookmarksController;
