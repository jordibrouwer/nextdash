/**
 * Finders Module — create, render, remove, reorder (drag + keyboard), filter, validation hints.
 */

class ConfigFinders {
    constructor(t) {
        this.t = typeof t === 'function' ? t : (k) => k;
        this.finderReorder = null;
        this._filterQuery = '';
        this.lastManager = null;
    }

    static escapeAttr(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
    }

    static normalizeFinders(finders, generateId) {
        const list = Array.isArray(finders) ? finders : [];
        const usedIds = new Set();
        list.forEach((finder, index) => {
            if (!finder || typeof finder !== 'object') return;
            let id = String(finder.id || '').trim();
            if (!id || usedIds.has(id)) {
                const base = typeof generateId === 'function'
                    ? generateId(`finder-${finder.shortcut || finder.name || index + 1}`)
                    : `finder-${index + 1}`;
                id = base;
                let n = 2;
                while (usedIds.has(id)) {
                    id = `${base}-${n}`;
                    n += 1;
                }
                finder.id = id;
            }
            usedIds.add(finder.id);
            finder.name = String(finder.name || '');
            finder.searchUrl = String(finder.searchUrl || '');
            finder.shortcut = String(finder.shortcut || '').toLowerCase().replace(/[^a-z]/g, '');
            finder.tags = Array.isArray(finder.tags) ? finder.tags : [];
            finder.useCount = Number(finder.useCount || 0);
            finder.lastUsed = Number(finder.lastUsed || 0);
        });
        return list;
    }

    refresh(manager) {
        this.lastManager = manager;
        this._bindFilterInput();
        this.render(manager?.findersData, manager);
    }

    clearFilter() {
        this._filterQuery = '';
        const input = document.getElementById('finders-filter-input');
        const clearBtn = document.getElementById('finders-filter-clear');
        if (input) {
            input.value = '';
        }
        if (clearBtn) {
            clearBtn.hidden = true;
        }
    }

    _bindFilterInput() {
        const input = document.getElementById('finders-filter-input');
        if (!input || input.dataset.findersFilterBound === '1') return;
        input.dataset.findersFilterBound = '1';
        const clearBtn = document.getElementById('finders-filter-clear');
        const syncClear = () => {
            if (clearBtn) clearBtn.hidden = !input.value;
        };
        input.addEventListener('input', () => {
            this._filterQuery = String(input.value || '').trim().toLowerCase();
            syncClear();
            this.render(this.lastManager?.findersData, this.lastManager);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && input.value) {
                e.preventDefault();
                input.value = '';
                this._filterQuery = '';
                syncClear();
                this.render(this.lastManager?.findersData, this.lastManager);
            }
        });
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                input.value = '';
                this._filterQuery = '';
                clearBtn.hidden = true;
                input.focus();
                this.render(this.lastManager?.findersData, this.lastManager);
            });
        }
    }

    _finderMatchesFilter(finder) {
        if (!this._filterQuery) return true;
        const q = this._filterQuery;
        const name = String(finder?.name || '').toLowerCase();
        const shortcut = String(finder?.shortcut || '').toLowerCase();
        const url = String(finder?.searchUrl || '').toLowerCase();
        const tags = Array.isArray(finder?.tags) ? finder.tags.join(' ').toLowerCase() : '';
        return name.includes(q) || shortcut.includes(q) || url.includes(q) || tags.includes(q);
    }

    _getDuplicateShortcuts(manager) {
        if (typeof manager?.getDuplicateFinderShortcutSet === 'function') {
            return manager.getDuplicateFinderShortcutSet();
        }
        return new Set();
    }

    _formatFinderUsage(finder) {
        const useCount = Number(finder?.useCount || 0);
        const lastUsed = Number(finder?.lastUsed || 0);
        const never = this.t('config.never') || 'never';
        let lastLabel = never;
        let fullLast = this.t('config.finderNeverUsed') || 'Not used yet';

        if (lastUsed > 0) {
            const date = new Date(lastUsed);
            if (!Number.isNaN(date.getTime())) {
                lastLabel = date.toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                });
                fullLast = date.toLocaleString();
            }
        }

        const text = (this.t('config.finderStatsLabel') || 'uses {count} · last {lastUsed}')
            .replace('{count}', String(useCount))
            .replace('{lastUsed}', lastLabel);

        return { text, title: fullLast };
    }

    updateFieldWarnings(manager) {
        const duplicateShortcuts = this._getDuplicateShortcuts(manager);
        const dupHint = this.t('config.finderDuplicateShortcutHint') || 'Another finder uses this shortcut.';
        const urlHint = this.t('config.finderUrlMissingPlaceholderHint') || 'Add %s where the search query should go.';

        document.querySelectorAll('.finder-item[data-finder-id]').forEach((el) => {
            const finder = el._finderRef;
            if (!finder) return;

            const shortcutInput = el.querySelector('input[data-field="shortcut"]');
            const urlInput = el.querySelector('input[data-field="searchUrl"]');

            if (shortcutInput) {
                const shortcut = String(finder.shortcut || '').trim().toUpperCase();
                const hasDup = shortcut && duplicateShortcuts.has(shortcut);
                shortcutInput.classList.toggle('field-warning', hasDup);
                shortcutInput.title = hasDup ? dupHint : '';
            }

            if (urlInput) {
                const url = String(finder.searchUrl || '').trim();
                const missingPlaceholder = url.length > 0 && !url.includes('%s');
                urlInput.classList.toggle('field-warning', missingPlaceholder);
                urlInput.title = missingPlaceholder ? urlHint : '';
            }
        });
    }

    _destroyFinderReorder() {
        if (!this.finderReorder) return;
        this.finderReorder.destroy();
        this.finderReorder = null;
    }

    render(finders, manager) {
        const container = document.getElementById('finders-list');
        if (!container) return;

        const list = Array.isArray(finders) ? finders : [];
        const duplicateShortcuts = this._getDuplicateShortcuts(manager);

        this._destroyFinderReorder();
        container.innerHTML = '';

        if (list.length === 0) {
            const hint = document.createElement('p');
            hint.className = 'finders-list-empty-hint config-empty-state config-empty-state--inlist';
            hint.setAttribute('role', 'status');
            hint.textContent = this.t('config.findersListEmptyHint')
                || 'No finders yet. Click + Add finder to create a shortcut to an external search site.';
            container.appendChild(hint);
            return;
        }

        const filtered = list.filter((finder) => this._finderMatchesFilter(finder));

        if (filtered.length === 0) {
            const hint = document.createElement('p');
            hint.className = 'finders-filter-empty-hint config-empty-state config-empty-state--inlist';
            hint.setAttribute('role', 'status');
            hint.textContent = this.t('config.findersFilterEmpty') || 'No finders match your filter.';
            container.appendChild(hint);
            return;
        }

        filtered.forEach((finder, index) => {
            container.appendChild(this.createFinderElement(finder, index, duplicateShortcuts));
        });

        if (manager && !this._filterQuery) {
            this.initReorder(list, (newFinders) => {
                manager.handleFindersReordered?.(newFinders);
            }, container);
        }
    }

    createFinderElement(finder, index, duplicateShortcuts = new Set()) {
        const div = document.createElement('div');
        div.className = 'finder-item js-item is-idle';
        div.setAttribute('data-finder-index', String(index));
        div.setAttribute('data-finder-id', String(finder.id));
        div.tabIndex = 0;
        div._finderRef = finder;

        const dragLabel = this.t('config.dragToReorder') || 'Drag to reorder';
        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle js-drag-handle';
        dragHandle.title = dragLabel;
        dragHandle.setAttribute('aria-label', dragLabel);
        dragHandle.textContent = '⠿';

        const safeId = String(finder.id).replace(/[^a-zA-Z0-9_-]/g, '_');
        const nameId = `finder-name-${safeId}`;
        const urlId = `finder-url-${safeId}`;
        const shortcutId = `finder-shortcut-${safeId}`;
        const tagsId = `finder-tags-${safeId}`;

        const nameLabel = document.createElement('label');
        nameLabel.className = 'visually-hidden';
        nameLabel.setAttribute('for', nameId);
        nameLabel.textContent = this.t('config.finderColName') || 'Name';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = nameId;
        nameInput.name = nameId;
        nameInput.value = finder.name || '';
        nameInput.placeholder = this.t('config.finderNamePlaceholder') || 'Finder name';
        nameInput.dataset.field = 'name';
        nameInput.dataset.finderId = finder.id;
        nameInput.setAttribute('aria-label', nameLabel.textContent);

        const urlLabel = document.createElement('label');
        urlLabel.className = 'visually-hidden';
        urlLabel.setAttribute('for', urlId);
        urlLabel.textContent = this.t('config.finderColUrl') || 'Search URL';

        const urlInput = document.createElement('input');
        urlInput.type = 'text';
        urlInput.id = urlId;
        urlInput.name = urlId;
        urlInput.value = finder.searchUrl || '';
        urlInput.placeholder = this.t('config.finderUrlPlaceholder') || 'https://example.com/?q=%s';
        urlInput.dataset.field = 'searchUrl';
        urlInput.dataset.finderId = finder.id;
        urlInput.setAttribute('aria-label', urlLabel.textContent);
        urlInput.inputMode = 'url';
        urlInput.autocomplete = 'off';
        urlInput.spellcheck = false;

        const shortcutLabel = document.createElement('label');
        shortcutLabel.className = 'visually-hidden';
        shortcutLabel.setAttribute('for', shortcutId);
        shortcutLabel.textContent = this.t('config.finderColShortcut') || 'Shortcut';

        const shortcutInput = document.createElement('input');
        shortcutInput.type = 'text';
        shortcutInput.id = shortcutId;
        shortcutInput.name = shortcutId;
        shortcutInput.value = finder.shortcut || '';
        shortcutInput.placeholder = this.t('config.finderShortcutPlaceholder') || 'Shortcut';
        shortcutInput.maxLength = 10;
        shortcutInput.dataset.field = 'shortcut';
        shortcutInput.dataset.finderId = finder.id;
        shortcutInput.className = 'finder-shortcut-input';
        shortcutInput.setAttribute('aria-label', shortcutLabel.textContent);

        const tagsLabel = document.createElement('label');
        tagsLabel.className = 'visually-hidden';
        tagsLabel.setAttribute('for', tagsId);
        tagsLabel.textContent = this.t('config.finderColTags') || 'Tags';

        const tagsValue = Array.isArray(finder.tags) ? finder.tags.join(', ') : '';
        const tagsInput = document.createElement('input');
        tagsInput.type = 'text';
        tagsInput.id = tagsId;
        tagsInput.name = tagsId;
        tagsInput.value = tagsValue;
        tagsInput.placeholder = this.t('config.finderTagsPlaceholder') || 'Tags (comma separated)';
        tagsInput.dataset.field = 'tags';
        tagsInput.dataset.finderId = finder.id;
        tagsInput.setAttribute('aria-label', tagsLabel.textContent);

        const usage = this._formatFinderUsage(finder);
        const usageTitle = this.t('config.finderUsageTitle') || 'Finder usage';

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-danger';
        removeBtn.textContent = this.t('config.remove') || 'Remove';
        removeBtn.addEventListener('click', () => {
            window.configManager?.removeFinderById?.(finder.id);
        });

        const applyWarnings = () => {
            const shortcut = String(finder.shortcut || '').trim().toUpperCase();
            const hasDup = shortcut && duplicateShortcuts.has(shortcut);
            shortcutInput.classList.toggle('field-warning', hasDup);
            shortcutInput.title = hasDup
                ? (this.t('config.finderDuplicateShortcutHint') || 'Another finder uses this shortcut.')
                : '';

            const url = String(finder.searchUrl || '').trim();
            const missingPlaceholder = url.length > 0 && !url.includes('%s');
            urlInput.classList.toggle('field-warning', missingPlaceholder);
            urlInput.title = missingPlaceholder
                ? (this.t('config.finderUrlMissingPlaceholderHint') || 'Add %s where the search query should go.')
                : '';
        };

        const onFieldInput = (e) => {
            const field = e.target.getAttribute('data-field');
            if (field === 'shortcut') {
                e.target.value = e.target.value.toLowerCase().replace(/[^a-z]/g, '');
                finder.shortcut = e.target.value;
            } else if (field === 'tags') {
                const raw = e.target.value || '';
                finder.tags = raw
                    .split(',')
                    .map((tag) => tag.trim().toLowerCase())
                    .filter(Boolean)
                    .filter((tag, idx, arr) => arr.indexOf(tag) === idx);
            } else {
                finder[field] = e.target.value;
            }
            window.configManager?.scheduleFinderValidationRefresh?.();
        };

        [nameInput, urlInput, shortcutInput, tagsInput].forEach((input) => {
            input.addEventListener('input', onFieldInput);
        });

        applyWarnings();

        div.addEventListener('keydown', (e) => {
            if (e.target !== div && e.target !== dragHandle) return;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                window.configManager?.moveFinderById?.(
                    finder.id,
                    e.key === 'ArrowUp' ? 'up' : 'down'
                );
            }
        });

        const row = document.createElement('div');
        row.className = 'finder-item-row';

        const actions = document.createElement('span');
        actions.className = 'finder-item-actions';
        actions.appendChild(removeBtn);

        row.appendChild(dragHandle);
        row.appendChild(nameLabel);
        row.appendChild(nameInput);
        row.appendChild(urlLabel);
        row.appendChild(urlInput);
        row.appendChild(shortcutLabel);
        row.appendChild(shortcutInput);
        row.appendChild(tagsLabel);
        row.appendChild(tagsInput);
        row.appendChild(actions);

        const meta = document.createElement('div');
        meta.className = 'finder-item-meta';
        meta.setAttribute('role', 'status');
        meta.textContent = usage.text;
        meta.title = `${usageTitle}: ${usage.title}`;

        div.appendChild(row);
        div.appendChild(meta);

        return div;
    }

    syncFinderIndices() {
        const container = document.getElementById('finders-list');
        if (!container) return;
        container.querySelectorAll('.finder-item[data-finder-id]').forEach((el, index) => {
            el.setAttribute('data-finder-index', String(index));
        });
    }

    initReorder(finders, onReorder, container = document.getElementById('finders-list')) {
        if (this._filterQuery || !container) {
            this._destroyFinderReorder();
            return;
        }

        this._destroyFinderReorder();

        this.finderReorder = new DragReorder({
            container,
            itemSelector: '.finder-item',
            handleSelector: '.js-drag-handle',
            onReorder: (newOrder) => {
                const newFinders = [];
                newOrder.forEach((item) => {
                    const finder = item.element._finderRef;
                    if (finder) newFinders.push(finder);
                });
                this.syncFinderIndices();
                onReorder(newFinders);
            }
        });
    }

    add(finders, generateId) {
        if (!Array.isArray(finders)) {
            console.error('ConfigFinders.add: finders must be an array');
            return null;
        }
        const id = typeof generateId === 'function'
            ? generateId(`finder-${finders.length + 1}`)
            : `finder-${Date.now().toString(36)}`;
        const newFinder = {
            id,
            name: `${this.t('config.newFinderPrefix') || 'Finder'} ${finders.length + 1}`,
            searchUrl: 'https://example.com/?q=%s',
            shortcut: '',
            tags: [],
            useCount: 0,
            lastUsed: 0
        };
        finders.push(newFinder);
        return newFinder;
    }

    async removeById(finders, finderId) {
        const index = finders.findIndex((f) => f.id === finderId);
        if (index < 0) return false;

        const confirmed = await window.AppModal.danger({
            title: this.t('config.removeFinderTitle') || 'Remove finder',
            message: this.t('config.removeFinderMessage') || 'Are you sure you want to remove this finder?',
            confirmText: this.t('config.remove') || 'Remove',
            cancelText: this.t('config.cancel') || 'Cancel'
        });

        if (!confirmed) return false;

        finders.splice(index, 1);
        return true;
    }

    /** @deprecated use removeById */
    async remove(finders, index) {
        const finder = finders[index];
        if (!finder?.id) {
            finders.splice(index, 1);
            return true;
        }
        return this.removeById(finders, finder.id);
    }
}

window.ConfigFinders = ConfigFinders;

/**
 * Finders orchestration — add/remove, reorder, validation.
 */
class ConfigFindersController {
    constructor(config) {
        this.config = config;
    }

    get c() {
        return this.config;
    }

    handleFindersReordered(newFinders) {
        this.c.findersData = newFinders;
        this.c.finders.syncFinderIndices?.();
        this.c.markDirty();
        clearTimeout(this.c._finderReorderPersistTimer);
        this.c._finderReorderPersistTimer = setTimeout(() => {
            void this.c.persistFindersChanges({ silent: true, eventType: 'finder-reordered' });
        }, 600);
    }

    scheduleFinderValidationRefresh() {
        clearTimeout(this.c._finderValidationTimer);
        this.c._finderValidationTimer = setTimeout(() => {
            this.c.finders?.updateFieldWarnings?.(this.c);
        }, 150);
    }

    validateFindersData(finders = this.c.findersData) {
        const list = Array.isArray(finders) ? finders : [];
        const shortcuts = new Map();
        for (let i = 0; i < list.length; i += 1) {
            const shortcut = String(list[i]?.shortcut || '').trim().toUpperCase();
            if (!shortcut) continue;
            if (shortcuts.has(shortcut)) {
                return this.c.language.t('config.finderDuplicateShortcutSaveError')
                    || 'Two or more finders share the same shortcut. Each shortcut must be unique.';
            }
            shortcuts.set(shortcut, i);
        }
        return null;
    }

    moveFinderById(finderId, direction) {
        const index = this.c.findersData.findIndex((f) => f.id === finderId);
        if (index < 0) return;
        const swap = direction === 'up' ? index - 1 : index + 1;
        if (swap < 0 || swap >= this.c.findersData.length) return;
        const order = [...this.c.findersData];
        [order[index], order[swap]] = [order[swap], order[index]];
        this.c.findersData = order;
        this.c.finders.refresh(this.c);
        const focusEl = document.querySelector(`.finder-item[data-finder-id="${finderId}"]`);
        focusEl?.focus?.();
        this.c.handleFindersReordered(this.c.findersData);
    }

    async addFinder() {
        try {
            if (!this.c.finders || typeof this.c.finders.add !== 'function') {
                this.c.ui.showNotification(
                    this.c.language.t('config.findersModuleUnavailable') || 'Finders could not load. Refresh the page and try again.',
                    'error'
                );
                return;
            }
    
            this.c.cancelPendingFindersTabReload();
            if (!Array.isArray(this.c.findersData)) {
                this.c.findersData = [];
            } else if (!Object.isExtensible(this.c.findersData)) {
                this.c.findersData = [...this.c.findersData];
            }
    
            this.c.finders.clearFilter?.();
    
            const newFinder = this.c.finders.add(this.c.findersData, this.c.generateId.bind(this.c));
            if (!newFinder) {
                this.c.ui.showNotification(
                    this.c.language.t('config.finderAddFailed') || 'Could not add finder. Refresh the page and try again.',
                    'error'
                );
                return;
            }
    
            this.c.finders.refresh(this.c);
            this.c.markDirty();
    
            requestAnimationFrame(() => {
                document.querySelector(`.finder-item[data-finder-id="${newFinder.id}"] input[data-field="name"]`)?.focus?.();
                document.querySelector(`.finder-item[data-finder-id="${newFinder.id}"]`)?.scrollIntoView?.({ block: 'nearest' });
            });
    
            try {
                await this.c.persistFindersChanges({
                    silent: true,
                    eventType: 'finder-added',
                    skipUiRefresh: true
                });
            } catch (error) {
                console.warn('Finder added in UI; background save failed:', error);
            }
        } catch (error) {
            console.error('addFinder failed:', error);
            this.c.ui.showNotification(
                this.c.language.t('config.finderAddFailed') || 'Could not add finder. Refresh the page and try again.',
                'error'
            );
        }
    }

    async removeFinder(index) {
        const finder = this.c.findersData[index];
        if (!finder?.id) return;
        await this.c.removeFinderById(finder.id);
    }

    async removeFinderById(finderId) {
        const undoSnapshot = this.c.captureUndoSnapshot();
        const removed = await this.c.finders.removeById(this.c.findersData, finderId);
        if (!removed) return;
    
        try {
            await this.c.persistFindersChanges({ silent: true, eventType: 'finder-removed' });
            this.c.showUndoNotification(
                this.c.language.t('config.finderRemoved') || 'Finder removed.',
                undoSnapshot,
                { persistFinders: true }
            );
        } catch (error) {
            this.c.restoreUndoSnapshot(undoSnapshot);
            this.c.undoSnapshot = null;
            this.c.ui.showNotification(
                this.c.language.t('config.finderRemoveFailed') || 'Failed to remove finder. Changes reverted.',
                'error'
            );
        }
    }

    installPublicMethods() {
        const c = this.config;
        for (const name of ['handleFindersReordered', 'scheduleFinderValidationRefresh', 'validateFindersData', 'moveFinderById', 'addFinder', 'removeFinder', 'removeFinderById']) {
            c[name] = (...args) => this[name](...args);
        }
    }
}

window.ConfigFindersController = ConfigFindersController;
