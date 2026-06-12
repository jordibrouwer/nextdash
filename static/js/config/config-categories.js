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

        container.innerHTML = '';

        const list = Array.isArray(categories) ? categories : [];
        if (list.length === 0) {
            const hint = document.createElement('li');
            hint.className = 'categories-list-empty-hint';
            hint.setAttribute('role', 'listitem');
            hint.textContent = this.t('config.categoriesListEmptyHint') || 'No categories on this page yet. Add one to organise bookmarks.';
            container.appendChild(hint);
            return;
        }

        list.forEach((category, index) => {
            container.appendChild(
                this.createCategoryElement(category, index, getBookmarkCount)
            );
        });
    }

    createCategoryElement(category, index, getBookmarkCount) {
        const li = document.createElement('li');
        li.className = 'category-item js-item is-idle';
        li.setAttribute('role', 'listitem');
        li.setAttribute('data-category-index', String(index));
        li.setAttribute('data-category-id', String(category.id));
        li.tabIndex = 0;

        if (!category.originalId) {
            category.originalId = category.id;
        }

        li._categoryRef = category;

        const safeId = String(category.id).replace(/[^a-zA-Z0-9_-]/g, '_');
        const iconId = `category-icon-${safeId}`;
        const nameId = `category-name-${safeId}`;
        const iconLabelId = `category-icon-label-${safeId}`;
        const nameLabelId = `category-name-label-${safeId}`;

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

        const count = typeof getBookmarkCount === 'function' ? getBookmarkCount(category.id) : 0;
        const countBadge = document.createElement('span');
        countBadge.className = 'category-bookmark-count';
        const countTpl = this.t('config.categoryBookmarkCount') || '{count} bookmarks';
        countBadge.textContent = countTpl.replace('{count}', String(count));
        countBadge.title = countBadge.textContent;

        const actions = document.createElement('span');
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

        li.appendChild(dragHandle);
        li.appendChild(iconLabel);
        li.appendChild(iconInput);
        li.appendChild(nameLabel);
        li.appendChild(nameInput);
        li.appendChild(countBadge);
        li.appendChild(actions);

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
