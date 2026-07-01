/**
 * Categories Module — create, render, remove, merge, reorder (drag + keyboard).
 */

class ConfigCategories {
    constructor(t) {
        this.t = t;
        this.categoryReorder = null;
    }

    render(categories, generateId, getBookmarkCount) {
        const container = document.getElementById('categories-list');
        if (!container) return;

        const listPanel = document.getElementById('categories-list-panel');
        const header = listPanel?.querySelector('.categories-list-header');

        container.innerHTML = '';

        const list = Array.isArray(categories) ? categories : [];
        if (list.length === 0) {
            if (header) header.hidden = true;
            const hint = document.createElement('li');
            hint.className = 'categories-list-empty-hint config-empty-state config-empty-state--inlist';
            hint.setAttribute('role', 'listitem');
            hint.textContent = this.t('config.categoriesListEmptyHint') || 'No categories on this page yet. Add one to organise bookmarks.';
            container.appendChild(hint);
            return;
        }

        if (header) header.hidden = false;

        const counts = list.map((category) =>
            typeof getBookmarkCount === 'function' ? getBookmarkCount(category.id) : 0
        );
        const maxCount = counts.length ? Math.max(...counts) : 0;
        const minCount = counts.length ? Math.min(...counts) : maxCount;

        list.forEach((category, index) => {
            const count = counts[index];
            const scale =
                typeof ConfigTags !== 'undefined'
                    ? ConfigTags.scaleForCount(count, minCount, maxCount)
                    : maxCount <= 0
                      ? 0.5
                      : count / maxCount;
            const tierClass =
                typeof ConfigTags !== 'undefined'
                    ? ConfigTags.listTierClassForScale(scale)
                    : '';
            container.appendChild(
                this.createCategoryElement(category, index, count, scale, tierClass)
            );
        });
    }

    createCategoryElement(category, index, count, scale = 0.5, tierClass = '') {
        const li = document.createElement('li');
        li.className = `category-item js-item is-idle${tierClass ? ` ${tierClass}` : ''}`;
        li.setAttribute('role', 'listitem');
        li.setAttribute('data-category-index', String(index));
        li.setAttribute('data-category-id', String(category.id));
        li.tabIndex = 0;
        li.style.setProperty('--tag-popularity', scale.toFixed(3));

        if (!category.originalId) {
            category.originalId = category.id;
        }

        li._categoryRef = category;

        const safeId = String(category.id).replace(/[^a-zA-Z0-9_-]/g, '_');
        const iconId = `category-icon-${safeId}`;
        const nameId = `category-name-${safeId}`;
        const iconLabelId = `category-icon-label-${safeId}`;
        const nameLabelId = `category-name-label-${safeId}`;

        const row = document.createElement('div');
        row.className = 'category-item-row';

        const primary = document.createElement('div');
        primary.className = 'category-item-primary';

        const dragLabel = this.t('config.dragToReorder') || 'Drag to reorder';
        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle js-drag-handle';
        dragHandle.title = dragLabel;
        dragHandle.setAttribute('aria-label', dragLabel);
        dragHandle.textContent = '⠿';

        const iconLabel = document.createElement('label');
        iconLabel.className = 'visually-hidden';
        iconLabel.id = iconLabelId;
        iconLabel.setAttribute('for', iconId);
        iconLabel.textContent = this.t('config.categoryIconLabel') || 'Category icon';

        const iconInput = document.createElement('input');
        iconInput.type = 'text';
        iconInput.id = iconId;
        iconInput.name = iconId;
        iconInput.value = category.icon || '';
        iconInput.placeholder = this.t('config.categoryIconPlaceholder') || 'icon';
        iconInput.maxLength = 8;
        iconInput.className = 'category-icon-input';
        iconInput.dataset.categoryId = category.id;
        iconInput.dataset.field = 'icon';
        iconInput.setAttribute('aria-labelledby', iconLabelId);

        const nameLabel = document.createElement('label');
        nameLabel.className = 'visually-hidden';
        nameLabel.id = nameLabelId;
        nameLabel.setAttribute('for', nameId);
        nameLabel.textContent = this.t('config.categoryNameLabelShort') || 'Category name';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = nameId;
        nameInput.name = nameId;
        nameInput.value = category.name || '';
        nameInput.placeholder = this.t('config.categoryNamePlaceholder') || '';
        nameInput.dataset.categoryId = category.id;
        nameInput.dataset.field = 'name';
        nameInput.setAttribute('aria-labelledby', nameLabelId);

        primary.appendChild(dragHandle);
        primary.appendChild(iconLabel);
        primary.appendChild(iconInput);
        primary.appendChild(nameLabel);
        primary.appendChild(nameInput);
        row.appendChild(primary);

        const meta = document.createElement('div');
        meta.className = 'tag-item-meta';

        const popularity = document.createElement('div');
        popularity.className = 'tag-popularity';
        popularity.setAttribute('aria-hidden', 'true');
        const popularityBar = document.createElement('span');
        popularityBar.className = 'tag-popularity-bar';
        popularityBar.style.setProperty('--tag-fill', `${Math.round(scale * 100)}%`);
        popularity.appendChild(popularityBar);
        meta.appendChild(popularity);

        const countBadge = document.createElement('span');
        countBadge.className = 'tag-item-count';
        const countTpl = this.t('config.categoryBookmarkCount') || '{count} bookmarks';
        countBadge.textContent = countTpl.replace('{count}', String(count));
        countBadge.title = countBadge.textContent;
        meta.appendChild(countBadge);
        row.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'category-item-actions';

        const mergeBtn = document.createElement('button');
        mergeBtn.type = 'button';
        mergeBtn.className = 'btn btn-secondary btn-small';
        mergeBtn.textContent = this.t('config.merge') || 'Merge';
        mergeBtn.addEventListener('click', () => {
            window.configManager?.mergeCategoryById?.(category.id);
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-danger';
        removeBtn.textContent = this.t('config.remove') || 'Remove';
        removeBtn.addEventListener('click', () => {
            window.configManager?.removeCategoryById?.(category.id);
        });

        actions.appendChild(mergeBtn);
        actions.appendChild(removeBtn);
        row.appendChild(actions);
        li.appendChild(row);

        nameInput.addEventListener('input', (e) => {
            category.name = e.target.value;
        });

        iconInput.addEventListener('input', (e) => {
            category.icon = (e.target.value || '').trim();
        });

        li.addEventListener('keydown', (e) => {
            if (e.target !== li && e.target !== li.querySelector('.drag-handle')) return;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                window.configManager?.moveCategoryById?.(
                    category.id,
                    e.key === 'ArrowUp' ? 'up' : 'down'
                );
            }
        });

        return li;
    }

    syncCategoryIndices() {
        const container = document.getElementById('categories-list');
        if (!container) return;
        container.querySelectorAll('.category-item[data-category-id]').forEach((el, index) => {
            el.setAttribute('data-category-index', String(index));
        });
    }

    initReorder(categories, onReorder) {
        if (this.categoryReorder) {
            this.categoryReorder.destroy();
        }

        this.categoryReorder = new DragReorder({
            container: '#categories-list',
            itemSelector: '.category-item',
            handleSelector: '.js-drag-handle',
            onReorder: (newOrder) => {
                const newCategories = [];
                newOrder.forEach((item) => {
                    const category = item.element._categoryRef;
                    if (category) newCategories.push(category);
                });
                this.syncCategoryIndices();
                onReorder(newCategories);
            }
        });
    }

    add(categories, generateId, generateStableId) {
        if (!categories || !Array.isArray(categories)) {
            console.error('Categories must be an array');
            return null;
        }

        const prefix = this.t('config.newCategoryPrefix') || 'Category';
        const usedNames = new Set(
            categories.map((c) => String(c?.name || '').trim().toLowerCase()).filter(Boolean)
        );
        const usedIds = new Set(
            categories.map((c) => String(c?.id || '').trim()).filter(Boolean)
        );

        let n = categories.length + 1;
        let name = `${prefix} ${n}`;
        while (usedNames.has(name.toLowerCase())) {
            n += 1;
            name = `${prefix} ${n}`;
        }

        let id = '';
        if (typeof generateStableId === 'function') {
            do {
                id = generateStableId();
            } while (usedIds.has(id));
        } else if (typeof generateId === 'function') {
            id = generateId(name);
            let suffix = 2;
            const base = id;
            while (usedIds.has(id)) {
                id = `${base}-${suffix}`;
                suffix += 1;
            }
        } else {
            id = `cat_${Date.now().toString(36)}`;
        }

        const newCategory = {
            id,
            originalId: id,
            name,
            icon: ''
        };
        categories.push(newCategory);
        return newCategory;
    }

    removeById(categories, categoryId) {
        const index = categories.findIndex((c) => c.id === categoryId);
        if (index < 0) return -1;
        categories.splice(index, 1);
        return index;
    }

    async remove(categories, index, options = {}) {
        const confirmed = await window.AppModal.danger({
            title: this.t('config.removeCategoryTitle'),
            message: options.message || this.t('config.removeCategoryMessage'),
            confirmText: this.t('config.remove'),
            cancelText: this.t('config.cancel')
        });

        if (!confirmed) return false;

        categories.splice(index, 1);
        return true;
    }

    destroy() {
        if (this.categoryReorder) {
            this.categoryReorder.destroy();
            this.categoryReorder = null;
        }
    }
}

window.ConfigCategories = ConfigCategories;

/**
 * Categories orchestration — load, merge, remove, reorder, session prefs.
 */
class ConfigCategoriesController {
    constructor(config) {
        this.config = config;
    }

    get c() {
        return this.config;
    }

    _lastCategoryFilterStorageKey(pageId) {
        return `nextdash:config:last-category-filter:${Number(pageId) || 1}`;
    }

    _lastUsedCategoryStorageKey(pageId) {
        return `nextdash:config:last-used-category:${Number(pageId) || 1}`;
    }

    _lastCategoriesPageStorageKey() {
        return 'nextdash:config:last-categories-page';
    }

    getDefaultCategoriesPageId() {
        const visible = this.c.getVisiblePages();
        return visible.length > 0 ? Number(visible[0].id) : 1;
    }

    getLastCategoriesPageId() {
        try {
            const parsed = Number(sessionStorage.getItem(this.c._lastCategoriesPageStorageKey()));
            if (Number.isFinite(parsed) && parsed >= 1) {
                const visible = this.c.getVisiblePages();
                if (visible.some((page) => Number(page.id) === parsed)) {
                    return parsed;
                }
            }
        } catch {
            // ignore
        }
        return this.c.getDefaultCategoriesPageId();
    }

    saveLastCategoriesPageId(pageId) {
        const pid = Number(pageId);
        if (!Number.isFinite(pid) || pid < 1) return;
        try {
            sessionStorage.setItem(this.c._lastCategoriesPageStorageKey(), String(pid));
        } catch {
            // ignore
        }
    }

    getLastCategoryFilterForPage(pageId) {
        try {
            return sessionStorage.getItem(this.c._lastCategoryFilterStorageKey(pageId)) || '__all__';
        } catch {
            return '__all__';
        }
    }

    saveLastCategoryFilterForPage(pageId, value) {
        try {
            sessionStorage.setItem(this.c._lastCategoryFilterStorageKey(pageId), String(value || '__all__'));
        } catch {
            // ignore
        }
    }

    getLastUsedCategoryIdForPage(pageId) {
        try {
            return sessionStorage.getItem(this.c._lastUsedCategoryStorageKey(pageId)) || '';
        } catch {
            return '';
        }
    }

    saveLastUsedCategoryIdForPage(pageId, categoryId) {
        const id = String(categoryId || '').trim();
        if (!id) return;
        try {
            sessionStorage.setItem(this.c._lastUsedCategoryStorageKey(pageId), id);
        } catch {
            // ignore
        }
    }

    async loadPageCategories(pageId) {
        try {
            this.c.currentCategoriesPageId = parseInt(pageId, 10);
            this.c.categoriesData = (await this.c.data.loadCategoriesByPage(pageId)).map(cat => ({ ...cat }));
    
            const bookmarksForPage = Number(pageId) === Number(this.c.currentPageId)
                ? this.c.bookmarksData
                : await this.c.data.loadBookmarksByPage(pageId);
    
            if (this.c.categoriesData.length === 0 && this.c.bookmarksReferenceCategories(bookmarksForPage)) {
                this.c.categoriesData = this.c.rebuildCategoriesFromBookmarkRefs(bookmarksForPage);
                if (this.c.categoriesData.length > 0) {
                    try {
                        await this.c.data.saveCategoriesByPage(this.c.categoriesData, this.c.currentCategoriesPageId);
                        this.c.ui.showNotification(
                            this.c.language.t('config.categoriesRecovered') || 'Recovered missing categories from bookmark references.',
                            'success'
                        );
                    } catch (recoverErr) {
                        console.error('Failed to persist recovered categories:', recoverErr);
                    }
                }
            }
    
            const categoryIdMap = this.c.ensureStableCategoryIds(this.c.categoriesData);
            if (categoryIdMap.size > 0) {
                this.c.reassignBookmarkCategoriesFromMap(categoryIdMap, bookmarksForPage);
                if (Number(pageId) === Number(this.c.currentPageId)) {
                    this.c.bookmarksData = bookmarksForPage;
                }
                try {
                    await this.c.data.saveCategoriesByPage(this.c.categoriesData, this.c.currentCategoriesPageId);
                    await this.c.saveBookmarksPage(pageId, bookmarksForPage);
                } catch (stabilizeErr) {
                    console.error('Failed to persist stabilized category ids:', stabilizeErr);
                }
            }
    
            this.c.rebuildCategoryBookmarkCounts(bookmarksForPage);
            this.c.renderCategoriesList();
            this.c.categoriesListHydrated = true;
        } catch (error) {
            this.c.ui.showErrorWithReload(this.c.language.t('config.errorLoadingCategories'));
        }
    }

    rebuildCategoryBookmarkCounts(bookmarks) {
        this.c._categoryBookmarkCounts = {};
        (bookmarks || []).forEach((bookmark) => {
            const cat = String(bookmark?.category || '').trim();
            if (cat) {
                this.c._categoryBookmarkCounts[cat] = (this.c._categoryBookmarkCounts[cat] || 0) + 1;
            }
        });
    }

    getCategoryBookmarkCount(categoryId) {
        return this.c._categoryBookmarkCounts?.[categoryId] || 0;
    }

    renderCategoriesList() {
        this.c.categories.render(
            this.c.categoriesData,
            this.c.generateId.bind(this.c),
            (id) => this.c.getCategoryBookmarkCount(id)
        );
        this.c.categories.initReorder(
            this.c.categoriesData,
            (newCategories) => this.c.handleCategoriesReordered(newCategories)
        );
    }

    async getBookmarksForCategoriesPage(pageId = this.c.currentCategoriesPageId) {
        const pid = Number(pageId);
        if (Number(this.c.currentPageId) === pid) {
            return this.c.bookmarksData;
        }
        return this.c.withRetry(() => this.c.data.loadBookmarksByPage(pid));
    }

    async getBookmarksInCategory(categoryId, pageId = this.c.currentCategoriesPageId) {
        const bookmarks = await this.c.getBookmarksForCategoriesPage(pageId);
        return (bookmarks || []).filter((bookmark) => bookmark.category === categoryId);
    }

    async updateBookmarksOnCategoriesPage(updater) {
        const pageId = Number(this.c.currentCategoriesPageId);
        if (!Number.isFinite(pageId) || pageId < 1) return;
    
        if (Number(this.c.currentPageId) === pageId) {
            const next = updater([...this.c.bookmarksData]);
            this.c.bookmarksData = Array.isArray(next) ? next : this.c.bookmarksData;
            return;
        }
    
        const bookmarks = await this.c.getBookmarksForCategoriesPage(pageId);
        const next = updater([...(bookmarks || [])]);
        if (Array.isArray(next)) {
            await this.c.saveBookmarksPage(pageId, next);
        }
    }

    handleCategoriesReordered(newCategories) {
        this.c.categoriesData = newCategories;
        this.c.categories.syncCategoryIndices?.();
        this.c.markDirty();
        clearTimeout(this.c._categoryReorderPersistTimer);
        this.c._categoryReorderPersistTimer = setTimeout(() => {
            void this.c.persistCategoriesStructureAndRefresh({ eventType: 'category-reordered' });
        }, 600);
    }

    moveCategoryById(categoryId, direction) {
        const index = this.c.categoriesData.findIndex((c) => c.id === categoryId);
        if (index < 0) return;
        const swap = direction === 'up' ? index - 1 : index + 1;
        if (swap < 0 || swap >= this.c.categoriesData.length) return;
        const order = [...this.c.categoriesData];
        [order[index], order[swap]] = [order[swap], order[index]];
        this.c.categoriesData = order;
        this.c.renderCategoriesList();
        this.c.handleCategoriesReordered(this.c.categoriesData);
        const focusEl = document.querySelector(`.category-item[data-category-id="${categoryId}"]`);
        focusEl?.focus?.();
    }

    async addCategory() {
        if (!this.c.categoriesData) this.c.categoriesData = [];
    
        const categoriesPageId = Number(this.c.currentCategoriesPageId) || this.c.getDefaultCategoriesPageId();
    
        const newCategory = this.c.categories.add(
            this.c.categoriesData,
            this.c.generateId.bind(this.c),
            () => this.c.generateStableCategoryId()
        );
        if (!newCategory) return;
    
        this.c.renderCategoriesList();
        await this.c.persistCategoriesStructureAndRefresh({ eventType: 'category-added' });
        this.c.currentCategoriesPageId = categoriesPageId;
        this.c.saveLastCategoriesPageId(categoriesPageId);
        this.c.syncCategoriesPageSelectorUI(categoriesPageId);
        this.c.saveLastUsedCategoryIdForPage(categoriesPageId, newCategory.id);
        this.c.renderStructureWorkspace();
    
        requestAnimationFrame(() => {
            const row = document.querySelector(`.category-item[data-category-id="${newCategory.id}"]`);
            const nameInput = row?.querySelector('input[data-field="name"]');
            nameInput?.focus?.();
            nameInput?.select?.();
            row?.scrollIntoView?.({ block: 'nearest' });
        });
    }

    async removeCategory(index) {
        const category = this.c.categoriesData[index];
        if (!category) return;
        await this.c.removeCategoryById(category.id);
    }

    async removeCategoryById(categoryId) {
        const category = this.c.categoriesData.find((c) => c.id === categoryId);
        if (!category) return;
    
        const impactedBookmarks = await this.c.getBookmarksInCategory(category.id);
        let deleteMode = 'uncategorize';
        let moveTargetId = '';
        if (impactedBookmarks.length > 0) {
            const flow = await this.c.resolveCategoryDeleteFlow(category, impactedBookmarks.length);
            if (!flow || flow.action === 'cancel') {
                return;
            }
            deleteMode = flow.action;
            moveTargetId = flow.targetCategoryId || '';
        }
    
        const index = this.c.categoriesData.findIndex((c) => c.id === categoryId);
        if (index < 0) return;
    
        const undoSnapshot = this.c.captureUndoSnapshot();
        const removed = await this.c.categories.remove(this.c.categoriesData, index, {
            message: this.c.language.t('config.removeCategoryMessage')
        });
        if (!removed) return;
    
        await this.c.updateBookmarksOnCategoriesPage((bookmarks) => {
            if (deleteMode === 'move' && moveTargetId) {
                return bookmarks.map((bookmark) => (
                    bookmark.category === category.id
                        ? { ...bookmark, category: moveTargetId }
                        : bookmark
                ));
            }
            if (deleteMode === 'delete') {
                return bookmarks.filter((bookmark) => bookmark.category !== category.id);
            }
            return bookmarks.map((bookmark) => (
                bookmark.category === category.id
                    ? { ...bookmark, category: '' }
                    : bookmark
            ));
        });
    
        this.c.rebuildCategoryBookmarkCounts(await this.c.getBookmarksForCategoriesPage());
        this.c.renderCategoriesList();
        this.c.showUndoNotification(
            this.c.language.t('config.categoryRemoved'),
            undoSnapshot
        );
        await this.c.persistCategoriesStructureAndRefresh({ persistBookmarks: true, eventType: 'category-removed' });
        this.c.renderStructureWorkspace();
    }

    async resolveCategoryDeleteFlow(category, impactedCount) {
        const alternativeCategories = this.c.categoriesData.filter((item) => item.id !== category.id);
        if (alternativeCategories.length === 0) {
            const confirmed = await window.AppModal.confirm({
                title: this.c.language.t('config.deleteCategoryTitleShort') || 'Delete category',
                message: (this.c.language.t('config.deleteCategoryImpact') || '{count} bookmarks to uncategorized.').replace('{count}', String(impactedCount)),
                confirmText: this.c.language.t('config.continue') || 'Continue',
                cancelText: this.c.language.t('config.cancel')
            });
            return confirmed ? { action: 'uncategorize' } : { action: 'cancel' };
        }
    
        const optionsHtml = this.c._categorySelectOptionsHtml(alternativeCategories);
        const html = `
            <p>${(this.c.language.t('config.categoryDeleteInUse') || '{count} bookmarks in').replace('{count}', String(impactedCount))} <strong>${this.c._escHtml(category.name)}</strong>.</p>
            <p>${this.c.language.t('config.categoryDeleteChoose') || 'Choose action before delete:'}</p>
            <select id="category-delete-target-select" class="page-selector" style="max-width:100%;">
                ${optionsHtml}
            </select>
            <div style="display:flex; gap:0.5rem; margin-top:0.75rem; flex-wrap:wrap;">
                <button class="btn btn-primary btn-small" onclick="window.tempCategoryDeleteAction('move')">${this.c.language.t('config.moveToSelected') || 'Move selected'}</button>
                <button class="btn btn-secondary btn-small" onclick="window.tempCategoryDeleteAction('uncategorize')">${this.c.language.t('config.setUncategorized') || 'Set uncategorized'}</button>
                <button class="btn btn-danger btn-small" onclick="window.tempCategoryDeleteAction('delete')">${this.c.language.t('config.deleteBookmarksToo') || 'Delete bookmarks'}</button>
            </div>
        `;
    
        return new Promise((resolve) => {
            window.tempCategoryDeleteAction = (action) => {
                const selectEl = document.getElementById('category-delete-target-select');
                const targetCategoryId = selectEl ? selectEl.value : '';
                delete window.tempCategoryDeleteAction;
                window.AppModal.hide();
                resolve({ action, targetCategoryId });
            };
            window.AppModal.show({
                title: this.c.language.t('config.deleteCategoryTitleShort') || 'Delete category',
                htmlMessage: html,
                confirmText: this.c.language.t('config.cancel'),
                showCancel: false,
                onConfirm: () => {
                    delete window.tempCategoryDeleteAction;
                    resolve({ action: 'cancel' });
                }
            });
        });
    }

    async mergeCategory(index) {
        const sourceCategory = this.c.categoriesData[index];
        if (!sourceCategory) return;
        await this.c.mergeCategoryById(sourceCategory.id);
    }

    async mergeCategoryById(sourceCategoryId) {
        const sourceCategory = this.c.categoriesData.find((c) => c.id === sourceCategoryId);
        if (!sourceCategory) return;
    
        const targetCategories = this.c.categoriesData.filter((item) => item.id !== sourceCategory.id);
        if (targetCategories.length === 0) {
            this.c.ui.showNotification(this.c.language.t('config.mergeNeedSecondCategory') || 'Need second category.', 'info');
            return;
        }
    
        const sourceCount = this.c.getCategoryBookmarkCount(sourceCategory.id);
        const optionsHtml = this.c._categorySelectOptionsHtml(targetCategories);
        const impactLine = sourceCount > 0
            ? `<p>${(this.c.language.t('config.mergeCategoryImpact') || '{count} bookmarks will move.').replace('{count}', String(sourceCount))}</p>`
            : '';
        const html = `
            <p>${this.c.language.t('config.mergeIntoLabel') || 'Merge into'} <strong>${this.c._escHtml(sourceCategory.name)}</strong>:</p>
            ${impactLine}
            <select id="merge-category-target-select" class="page-selector" style="max-width:100%;">
                ${optionsHtml}
            </select>
        `;
        const confirmed = await window.AppModal.confirm({
            title: this.c.language.t('config.mergeCategoryTitleShort') || 'Merge category',
            htmlMessage: html,
            confirmText: this.c.language.t('config.merge') || 'Merge',
            cancelText: this.c.language.t('config.cancel')
        });
        if (!confirmed) return;
    
        const targetSelect = document.getElementById('merge-category-target-select');
        const targetId = targetSelect ? targetSelect.value : '';
        if (!targetId) return;
    
        const targetCategory = this.c.categoriesData.find((item) => item.id === targetId);
        if (!targetCategory) return;
    
        const index = this.c.categoriesData.findIndex((c) => c.id === sourceCategoryId);
        if (index < 0) return;
    
        const undoSnapshot = this.c.captureUndoSnapshot();
        await this.c.updateBookmarksOnCategoriesPage((bookmarks) =>
            bookmarks.map((bookmark) => (
                bookmark.category === sourceCategory.id
                    ? { ...bookmark, category: targetId }
                    : bookmark
            ))
        );
    
        this.c.categoriesData.splice(index, 1);
        this.c.rebuildCategoryBookmarkCounts(await this.c.getBookmarksForCategoriesPage());
        this.c.renderCategoriesList();
        const mergedText = (this.c.language.t('config.categoryMergedInto') || 'Merged into {name}.').replace('{name}', targetCategory.name);
        this.c.showUndoNotification(mergedText, undoSnapshot);
        await this.c.persistCategoriesStructureAndRefresh({ persistBookmarks: true, eventType: 'category-merged' });
        this.c.renderStructureWorkspace();
    }

    applyCategoryRenameWithConflictGuard(category, rawName, previousId) {
        const nextName = String(rawName || '').trim();
        const originalName = category.name || '';
        const currentId = category.id || '';
        const oldId = previousId || category.originalId || currentId;
        const normalizedNextName = nextName.toLowerCase();
        const hasDuplicate = this.c.categoriesData.some((item) => {
            if (item === category) return false;
            return String(item.name || '').trim().toLowerCase() === normalizedNextName;
        });
    
        if (!nextName || hasDuplicate) {
            const fallbackName = originalName || oldId || this.c.language.t('config.newCategoryPrefix');
            category.name = fallbackName;
            category.id = oldId;
            category.originalId = oldId;
            this.c.renderCategoriesList();
            this.c.ui.showNotification(
                this.c.language.t('config.categoryNameMustBeUnique'),
                'error'
            );
            return false;
        }
    
        category.name = nextName;
        category.id = oldId;
        category.originalId = oldId;
        return { oldId, newId: oldId };
    }

    reassignBookmarkCategoryIds(oldId, nextId) {
        if (!oldId || !nextId || oldId === nextId) {
            return;
        }
        this.c.bookmarksData.forEach((bookmark) => {
            if (bookmark.category === oldId) {
                bookmark.category = nextId;
            }
        });
    }

    syncCategoriesPageSelectorUI(pageId) {
        const sel = document.getElementById('categories-page-selector');
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

    getCategoriesFromDOM() {
        const categoriesList = document.getElementById('categories-list');
        if (!categoriesList) return null;
    
        const categoryItems = categoriesList.querySelectorAll('.category-item');
        const categories = [];
    
        categoryItems.forEach((item) => {
            const category = item._categoryRef;
            if (category) categories.push(category);
        });
    
        return categories;
    }

    bookmarksReferenceCategories(bookmarks) {
        if (!Array.isArray(bookmarks)) return false;
        return bookmarks.some((bookmark) => String(bookmark?.category || '').trim() !== '');
    }

    rebuildCategoriesFromBookmarkRefs(bookmarks) {
        if (!Array.isArray(bookmarks)) return [];
        const ids = [];
        const seen = new Set();
        bookmarks.forEach((bookmark) => {
            const id = String(bookmark?.category || '').trim();
            if (!id || seen.has(id)) return;
            seen.add(id);
            ids.push(id);
        });
        return ids.map((id) => ({
            id,
            originalId: id,
            name: this.c.formatRecoveredCategoryName(id),
            icon: ''
        }));
    }

    formatRecoveredCategoryName(categoryId) {
        const slug = String(categoryId || '').trim();
        if (!slug) return 'Category';
        if (slug.startsWith('cat_')) {
            return slug.slice(4).replace(/_/g, ' ') || slug;
        }
        return slug.replace(/-/g, ' ').replace(/_/g, ' ');
    }

    async getBookmarksForPage(pageId) {
        const pid = parseInt(pageId, 10);
        if (Number(pid) === Number(this.c.currentPageId)) {
            return this.c.bookmarksData;
        }
        return this.c.data.loadBookmarksByPage(pid);
    }

    async resolveCategoriesForSave(pageId) {
        const pid = parseInt(pageId, 10);
        if (!Number.isFinite(pid) || pid < 1) return null;
    
        const fromDom = this.c.getCategoriesFromDOM();
        const domMatchesPage = Number(this.c.currentCategoriesPageId) === pid;
        let categories = null;
    
        if (domMatchesPage && Array.isArray(fromDom) && fromDom.length > 0) {
            categories = fromDom.map((cat) => ({ ...cat }));
        } else if (domMatchesPage && Array.isArray(this.c.categoriesData) && this.c.categoriesData.length > 0) {
            categories = this.c.categoriesData.map((cat) => ({ ...cat }));
        } else if (domMatchesPage && this.c.categoriesListHydrated && Array.isArray(fromDom) && fromDom.length === 0) {
            categories = [];
        } else {
            return null;
        }
    
        if (categories.length === 0) {
            const bookmarks = await this.c.getBookmarksForPage(pid);
            if (this.c.bookmarksReferenceCategories(bookmarks)) {
                return null;
            }
        }
    
        return categories;
    }

    generateStableCategoryId() {
        return `cat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    }

    ensureStableCategoryIds(categories) {
        const idMap = new Map();
        if (!Array.isArray(categories)) {
            return idMap;
        }
        const usedIds = new Set();
        categories.forEach((category, index) => {
            if (!category) return;
            const previousId = String(category.id || '').trim();
            let stableId = previousId;
            if (!stableId || usedIds.has(stableId)) {
                stableId = this.c.generateStableCategoryId();
                while (usedIds.has(stableId)) {
                    stableId = this.c.generateStableCategoryId();
                }
            }
            usedIds.add(stableId);
            category.id = stableId;
            category.originalId = stableId;
    
            if (previousId && previousId !== stableId) {
                idMap.set(previousId, stableId);
            }
            if (!previousId) {
                const legacySlug = this.c.generateId(category.name || `category-${index + 1}`);
                if (legacySlug && legacySlug !== stableId && !idMap.has(legacySlug)) {
                    idMap.set(legacySlug, stableId);
                }
            }
        });
        return idMap;
    }

    reassignBookmarkCategoriesFromMap(idMap, bookmarks) {
        if (!(idMap instanceof Map) || idMap.size === 0 || !Array.isArray(bookmarks)) {
            return;
        }
        bookmarks.forEach((bookmark) => {
            const currentCategory = String(bookmark?.category || '').trim();
            if (currentCategory && idMap.has(currentCategory)) {
                bookmark.category = idMap.get(currentCategory);
            }
        });
    }

    async refreshCategoriesDependentUI() {
        const categoriesPageId = this.c.resolvePageId(
            this.c.currentCategoriesPageId,
            this.c.getVisiblePages()
        );
        this.c.currentCategoriesPageId = categoriesPageId;
    
        await this.c.loadPageCategories(categoriesPageId);
        this.c.syncCategoriesPageSelectorUI(categoriesPageId);
    
        if (Number(this.c.currentPageId) === categoriesPageId) {
            this.c.bookmarksPageCategories = this.c.categoriesData.map((cat) => ({ ...cat }));
            this.c.refreshBookmarksFilterOptions();
        }
    
        this.c.renderStructureWorkspace();
    }

    _escHtml(str) {
        return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    _categorySelectOptionsHtml(categories) {
        return categories
            .map((item) => `<option value="${this.c._escHtml(item.id)}">${this.c._escHtml(item.name)}</option>`)
            .join('');
    }

    installPublicMethods() {
        const c = this.config;
        for (const name of ['_lastCategoryFilterStorageKey', '_lastUsedCategoryStorageKey', '_lastCategoriesPageStorageKey', 'getDefaultCategoriesPageId', 'getLastCategoriesPageId', 'saveLastCategoriesPageId', 'getLastCategoryFilterForPage', 'saveLastCategoryFilterForPage', 'getLastUsedCategoryIdForPage', 'saveLastUsedCategoryIdForPage', 'loadPageCategories', 'rebuildCategoryBookmarkCounts', 'getCategoryBookmarkCount', 'renderCategoriesList', 'getBookmarksForCategoriesPage', 'getBookmarksInCategory', 'updateBookmarksOnCategoriesPage', 'handleCategoriesReordered', 'moveCategoryById', 'addCategory', 'removeCategory', 'removeCategoryById', 'resolveCategoryDeleteFlow', 'mergeCategory', 'mergeCategoryById', 'applyCategoryRenameWithConflictGuard', 'reassignBookmarkCategoryIds', 'syncCategoriesPageSelectorUI', 'getCategoriesFromDOM', 'bookmarksReferenceCategories', 'rebuildCategoriesFromBookmarkRefs', 'formatRecoveredCategoryName', 'getBookmarksForPage', 'resolveCategoriesForSave', 'generateStableCategoryId', 'ensureStableCategoryIds', 'reassignBookmarkCategoriesFromMap', 'refreshCategoriesDependentUI', '_escHtml', '_categorySelectOptionsHtml']) {
            c[name] = (...args) => this[name](...args);
        }
    }
}

window.ConfigCategoriesController = ConfigCategoriesController;
