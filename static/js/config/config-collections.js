/**
 * Collections Module
 * Manage user-defined dynamic collections (tag/category/shortcut rules).
 */
class ConfigCollections {
    constructor(t) {
        this.t = typeof t === 'function' ? t : (k) => k;
        this.lastManager = null;
        this._editingId = null; // id of collection being edited, or null for new
    }

    // ── Public API ────────────────────────────────────────────────────────────

    refresh(manager) {
        this.lastManager = manager;
        this._render();
    }

    // ── Render list ───────────────────────────────────────────────────────────

    _render() {
        const manager = this.lastManager;
        if (!manager) return;

        const list = document.getElementById('collections-list');
        const emptyState = document.getElementById('collections-empty-state');
        const editPanel = document.getElementById('collections-edit-panel');
        if (!list) return;

        const collections = this._getCollections(manager);

        list.innerHTML = '';
        list.hidden = false;
        if (editPanel) editPanel.hidden = true;
        this._editingId = null;

        if (collections.length === 0) {
            if (emptyState) emptyState.hidden = false;
        } else {
            if (emptyState) emptyState.hidden = true;
            collections.forEach(col => list.appendChild(this._createRow(col, manager)));
        }
    }

    _createRow(col, manager) {
        const row = document.createElement('div');
        row.className = 'collection-item js-item is-idle';
        row.dataset.id = col.id;

        const inner = document.createElement('div');
        inner.className = 'collection-item-row';

        const handle = document.createElement('span');
        handle.className = 'drag-handle collection-drag-handle';
        handle.textContent = '⠿';
        handle.setAttribute('aria-hidden', 'true');
        inner.appendChild(handle);

        const icon = document.createElement('span');
        icon.className = 'collection-item-icon';
        icon.textContent = col.icon || '▤';
        inner.appendChild(icon);

        const name = document.createElement('span');
        name.className = 'collection-item-name';
        name.textContent = col.name;
        inner.appendChild(name);

        const logic = document.createElement('span');
        logic.className = 'collection-item-logic';
        logic.textContent = (col.logic || 'and').toUpperCase();
        inner.appendChild(logic);

        const ruleCount = document.createElement('span');
        ruleCount.className = 'collection-item-rules';
        const n = (col.rules || []).length;
        ruleCount.textContent = n === 1
            ? this.t('config.collectionRuleCountOne', '1 rule')
            : this.t('config.collectionRuleCount', '{count} rules').replace('{count}', String(n));
        inner.appendChild(ruleCount);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn btn-secondary btn-small';
        editBtn.textContent = this.t('config.collectionEditBtn', 'Edit');
        editBtn.addEventListener('click', () => this._openEdit(col, manager));
        inner.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.textContent = '×';
        deleteBtn.title = this.t('config.collectionDeleteTitle', 'Delete collection');
        deleteBtn.addEventListener('click', () => this._deleteCollection(col, manager));
        inner.appendChild(deleteBtn);

        row.appendChild(inner);
        return row;
    }

    // ── Edit panel ────────────────────────────────────────────────────────────

    _openEdit(col, manager) {
        this._editingId = col ? col.id : null;
        const panel = document.getElementById('collections-edit-panel');
        const list = document.getElementById('collections-list');
        const emptyState = document.getElementById('collections-empty-state');
        if (!panel) return;

        if (list) list.hidden = true;
        if (emptyState) emptyState.hidden = true;
        panel.hidden = false;

        const titleEl = panel.querySelector('#col-edit-title');
        if (titleEl) {
            titleEl.textContent = col
                ? this.t('config.collectionEditTitle', 'Edit collection')
                : this.t('config.collectionEditNewTitle', 'New collection');
        }

        // Name
        const nameInput = panel.querySelector('#col-edit-name');
        if (nameInput) nameInput.value = col ? col.name : '';

        // Icon
        const iconInput = panel.querySelector('#col-edit-icon');
        if (iconInput) iconInput.value = col ? (col.icon || '') : '';

        // Logic
        const logicSelect = panel.querySelector('#col-edit-logic');
        if (logicSelect) logicSelect.value = col ? (col.logic || 'and') : 'and';

        // Rules
        const rulesContainer = panel.querySelector('#col-edit-rules');
        if (rulesContainer) {
            rulesContainer.innerHTML = '';
            const rules = col ? (col.rules || []) : [];
            if (rules.length === 0) {
                this._addRuleRow(rulesContainer, manager);
            } else {
                rules.forEach(rule => this._addRuleRow(rulesContainer, manager, rule));
            }
        }

        // Save button
        const saveBtn = panel.querySelector('#col-edit-save');
        if (saveBtn) {
            saveBtn.onclick = () => this._saveEdit(manager);
        }

        // Cancel button
        const cancelBtn = panel.querySelector('#col-edit-cancel');
        if (cancelBtn) {
            cancelBtn.onclick = () => this._render();
        }

        // Add rule button
        const addRuleBtn = panel.querySelector('#col-edit-add-rule');
        if (addRuleBtn) {
            addRuleBtn.onclick = () => {
                if (rulesContainer) this._addRuleRow(rulesContainer, manager);
            };
        }
    }

    _addRuleRow(container, manager, rule = null) {
        const row = document.createElement('div');
        row.className = 'col-rule-row';

        const fieldSel = document.createElement('select');
        fieldSel.className = 'col-rule-field bookmark-detail-select';
        [
            ['tag', this.t('config.collectionRuleFieldTag', 'Tag')],
            ['category', this.t('config.collectionRuleFieldCategory', 'Category')],
            ['shortcut', this.t('config.collectionRuleFieldShortcut', 'Shortcut')],
        ].forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            fieldSel.appendChild(opt);
        });
        if (rule) fieldSel.value = rule.field || 'tag';
        row.appendChild(fieldSel);

        const opSel = document.createElement('select');
        opSel.className = 'col-rule-op bookmark-detail-select';
        [
            ['includes', this.t('config.collectionRuleOpIncludes', 'includes')],
            ['excludes', this.t('config.collectionRuleOpExcludes', 'excludes')],
        ].forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            opSel.appendChild(opt);
        });
        if (rule) opSel.value = rule.operator || 'includes';
        row.appendChild(opSel);

        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.className = 'col-rule-value bookmark-detail-input';
        valInput.placeholder = this.t('config.collectionRuleValuePlaceholder', 'value');
        valInput.value = rule ? (rule.value || '') : '';
        row.appendChild(valInput);

        // Autocomplete on value input based on field
        this._attachRuleAutocomplete(valInput, fieldSel, manager);
        fieldSel.addEventListener('change', () => this._attachRuleAutocomplete(valInput, fieldSel, manager));

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-danger col-rule-remove';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
            row.remove();
        });
        row.appendChild(removeBtn);

        container.appendChild(row);
    }

    _attachRuleAutocomplete(input, fieldSel, manager) {
        TagAutocomplete.detach(input);
        TagAutocomplete.attach(input, () => {
            const field = fieldSel.value;
            const all = manager.allBookmarksData ?? [];
            if (field === 'tag') {
                const tags = new Set();
                all.forEach(bm => (bm.tags || []).forEach(t => tags.add(t)));
                return [...tags];
            }
            if (field === 'category') {
                return [...new Set(all.map(bm => bm.category).filter(Boolean))];
            }
            if (field === 'shortcut') {
                return [...new Set(all.map(bm => bm.shortcut).filter(Boolean))];
            }
            return [];
        });
    }

    async _saveEdit(manager) {
        const panel = document.getElementById('collections-edit-panel');
        if (!panel) return;

        const nameInput = panel.querySelector('#col-edit-name');
        const name = (nameInput?.value || '').trim();
        if (!name) {
            if (nameInput) { nameInput.focus(); nameInput.classList.add('input-error'); }
            return;
        }
        if (nameInput) nameInput.classList.remove('input-error');

        const icon = (panel.querySelector('#col-edit-icon')?.value || '').trim();
        const logic = panel.querySelector('#col-edit-logic')?.value || 'and';

        const rules = [];
        panel.querySelectorAll('.col-rule-row').forEach(row => {
            const field = row.querySelector('.col-rule-field')?.value || 'tag';
            const operator = row.querySelector('.col-rule-op')?.value || 'includes';
            const value = (row.querySelector('.col-rule-value')?.value || '').trim().toLowerCase();
            if (value) rules.push({ field, operator, value });
        });

        if (rules.length === 0) {
            const firstValue = panel.querySelector('.col-rule-value');
            if (firstValue) { firstValue.focus(); firstValue.classList.add('input-error'); }
            return;
        }

        const collections = this._getCollections(manager);
        const existing = this._editingId ? collections.find(c => c.id === this._editingId) : null;

        const updated = {
            id: existing ? existing.id : this._generateId(name),
            name,
            icon,
            logic,
            rules
        };

        if (existing) {
            const idx = collections.indexOf(existing);
            collections[idx] = updated;
        } else {
            collections.push(updated);
        }

        manager.settingsData.collections = collections;
        this.lastManager = manager;
        this._render();
        await this._saveToServer(manager);
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async _deleteCollection(col, manager) {
        const confirmed = await window.AppModal.danger({
            title: `Delete "${col.name}"?`,
            message: 'This collection will no longer appear on the dashboard. Bookmarks are not affected.',
            confirmText: 'Delete',
            cancelText: 'Cancel'
        });
        if (!confirmed) return;
        const collections = this._getCollections(manager).filter(c => c.id !== col.id);
        manager.settingsData.collections = collections;
        this.lastManager = manager;
        this._render();
        await this._saveToServer(manager);
    }

    async _saveToServer(manager) {
        if (manager.settings && typeof manager.settings.saveSettingsToServer === 'function') {
            await manager.settings.saveSettingsToServer(manager.settingsData);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _getCollections(manager) {
        if (!Array.isArray(manager.settingsData?.collections)) {
            manager.settingsData.collections = [];
        }
        return manager.settingsData.collections;
    }

    _generateId(name) {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.random().toString(36).slice(2, 7);
    }
}

window.ConfigCollections = ConfigCollections;
