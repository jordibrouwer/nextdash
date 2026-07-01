/**
 * Config "Keyboard" tab: interactive keyboard shortcut rebinding
 */
class ConfigKeyboard {
    constructor(t) {
        this.t = typeof t === 'function' ? t : (k) => k;
        this.lastManager = null;
        this.customBindings = {}; // Local copy of custom keybindings
        this.isListening = false;
        this.listeningFor = null;
        this.defaultBindings = this.getDefaultBindings();
    }

    label(key, fallback) {
        const value = this.t(key);
        return value && value !== key ? value : fallback;
    }

    getDefaultBindings() {
        return {
            'search': {
                key: '>',
                descriptionKey: 'config.keyboardSearchDesc',
                description: 'Open regular search',
                categoryKey: 'config.keyboardCategoryDashboard',
                category: 'Dashboard',
            },
            'commands': {
                key: ':',
                descriptionKey: 'config.keyboardCommandsDesc',
                description: 'Open command palette',
                categoryKey: 'config.keyboardCategoryDashboard',
                category: 'Dashboard',
            },
            'finders': {
                key: '?',
                descriptionKey: 'config.keyboardFindersDesc',
                description: 'Open finders',
                categoryKey: 'config.keyboardCategoryDashboard',
                category: 'Dashboard',
            },
            'cheatsheet': {
                key: '!',
                descriptionKey: 'config.keyboardCheatsheetDesc',
                description: 'Open keyboard cheat sheet',
                categoryKey: 'config.keyboardCategoryDashboard',
                category: 'Dashboard',
            },
            'recent': {
                key: '*',
                descriptionKey: 'config.keyboardRecentDesc',
                description: 'Open recent bookmarks panel',
                categoryKey: 'config.keyboardCategoryDashboard',
                category: 'Dashboard',
            },
            'page-overview': {
                key: ',',
                descriptionKey: 'config.keyboardPageOverviewDesc',
                description: 'Open page overview with bookmark counts',
                categoryKey: 'config.keyboardCategoryDashboard',
                category: 'Dashboard',
            },
            'global-search': {
                key: '@',
                descriptionKey: 'config.keyboardGlobalSearchDesc',
                description: 'Global fuzzy search across all pages',
                categoryKey: 'config.keyboardCategoryDashboard',
                category: 'Dashboard',
            },
            'tag-cloud': {
                key: '/',
                descriptionKey: 'config.keyboardTagCloudDesc',
                description: 'Open tag word cloud (desktop, when enabled)',
                categoryKey: 'config.keyboardCategoryDashboard',
                category: 'Dashboard',
            },
            'edit': {
                key: ';',
                descriptionKey: 'config.keyboardEditDesc',
                description: 'Inline-edit selected bookmark',
                categoryKey: 'config.keyboardCategoryBookmarks',
                category: 'Bookmarks',
            },
            'navigation-up': {
                key: 'ArrowUp',
                descriptionKey: 'config.keyboardNavUpDesc',
                description: 'Move up through bookmarks',
                categoryKey: 'config.keyboardCategoryNavigation',
                category: 'Navigation',
            },
            'navigation-down': {
                key: 'ArrowDown',
                descriptionKey: 'config.keyboardNavDownDesc',
                description: 'Move down through bookmarks',
                categoryKey: 'config.keyboardCategoryNavigation',
                category: 'Navigation',
            },
            'navigation-left': {
                key: 'ArrowLeft',
                descriptionKey: 'config.keyboardNavLeftDesc',
                description: 'Move left through bookmarks',
                categoryKey: 'config.keyboardCategoryNavigation',
                category: 'Navigation',
            },
            'navigation-right': {
                key: 'ArrowRight',
                descriptionKey: 'config.keyboardNavRightDesc',
                description: 'Move right through bookmarks',
                categoryKey: 'config.keyboardCategoryNavigation',
                category: 'Navigation',
            },
            'select': {
                key: 'Enter',
                descriptionKey: 'config.keyboardSelectDesc',
                description: 'Open selected bookmark',
                categoryKey: 'config.keyboardCategoryNavigation',
                category: 'Navigation',
            },
            'page-1': { key: '1', descriptionKey: 'config.keyboardPage1Desc', description: 'Go to page 1', categoryKey: 'config.keyboardCategoryPages', category: 'Pages' },
            'page-2': { key: '2', descriptionKey: 'config.keyboardPage2Desc', description: 'Go to page 2', categoryKey: 'config.keyboardCategoryPages', category: 'Pages' },
            'page-3': { key: '3', descriptionKey: 'config.keyboardPage3Desc', description: 'Go to page 3', categoryKey: 'config.keyboardCategoryPages', category: 'Pages' },
            'page-4': { key: '4', descriptionKey: 'config.keyboardPage4Desc', description: 'Go to page 4', categoryKey: 'config.keyboardCategoryPages', category: 'Pages' },
            'page-5': { key: '5', descriptionKey: 'config.keyboardPage5Desc', description: 'Go to page 5', categoryKey: 'config.keyboardCategoryPages', category: 'Pages' },
            'page-6': { key: '6', descriptionKey: 'config.keyboardPage6Desc', description: 'Go to page 6', categoryKey: 'config.keyboardCategoryPages', category: 'Pages' },
            'page-7': { key: '7', descriptionKey: 'config.keyboardPage7Desc', description: 'Go to page 7', categoryKey: 'config.keyboardCategoryPages', category: 'Pages' },
            'page-8': { key: '8', descriptionKey: 'config.keyboardPage8Desc', description: 'Go to page 8', categoryKey: 'config.keyboardCategoryPages', category: 'Pages' },
            'page-9': { key: '9', descriptionKey: 'config.keyboardPage9Desc', description: 'Go to page 9', categoryKey: 'config.keyboardCategoryPages', category: 'Pages' },
        };
    }

    getFixedBindingGroups() {
        return [
            {
                titleKey: 'config.keyboardSectionBookmarks',
                titleFallback: 'Bookmarks',
                noteKey: 'config.keyboardFixedNote',
                noteFallback: 'Default shortcuts for adding bookmarks. These match the dashboard cheat sheet and are not rebindable here yet.',
                bindings: [
                    {
                        keys: ['&'],
                        descriptionKey: 'config.keyboardQuickAddDesc',
                        descriptionFallback: 'Quick-add omnibox — type name | url | shortcut in one line',
                    },
                    {
                        keys: ['+', 'Ctrl+Shift+A'],
                        descriptionKey: 'config.keyboardNewBookmarkModalDesc',
                        descriptionFallback: 'Full new-bookmark modal (+ on dashboard; Ctrl+Shift+A anywhere)',
                    },
                    {
                        keys: [':new'],
                        descriptionKey: 'config.keyboardCommandNewDesc',
                        descriptionFallback: 'Open new-bookmark modal from command mode (same as + / Ctrl+Shift+A)',
                    },
                    {
                        keys: ['Ctrl+V'],
                        descriptionKey: 'config.keyboardPasteUrlDesc',
                        descriptionFallback: 'Paste a URL on the dashboard to open the new-bookmark modal pre-filled',
                    },
                ],
            },
            {
                titleKey: 'config.keyboardSectionQuickActions',
                titleFallback: 'Quick actions (row selected)',
                noteKey: 'config.keyboardFixedNoteQuickActions',
                noteFallback: 'Requires a keyboard-selected bookmark row. Esc close restores highlight on the same row.',
                bindings: [
                    {
                        keys: ['Shift+M'],
                        descriptionKey: 'config.keyboardQuickMoveDesc',
                        descriptionFallback: 'Quick-move — choose category or page',
                    },
                    {
                        keys: ['Shift+T'],
                        descriptionKey: 'config.keyboardQuickTagDesc',
                        descriptionFallback: 'Quick-tag popover — toggle tags; Enter/Space advances to next',
                    },
                    {
                        keys: ['Shift+D'],
                        descriptionKey: 'config.keyboardQuickDeleteDesc',
                        descriptionFallback: 'Quick-delete — confirm in popover; undo in toast',
                    },
                    {
                        keys: ['Ctrl+C'],
                        descriptionKey: 'config.keyboardCopyUrlDesc',
                        descriptionFallback: 'Copy URL of focused bookmark (row flashes green)',
                    },
                    {
                        keys: ['['],
                        descriptionKey: 'config.keyboardPreviewDesc',
                        descriptionFallback: 'Toggle hover preview card on focused bookmark',
                    },
                    {
                        keys: ['Delete'],
                        descriptionKey: 'config.keyboardDeleteDesc',
                        descriptionFallback: 'Delete focused bookmark (confirmation dialog)',
                    },
                ],
            },
            {
                titleKey: 'config.keyboardSectionGridNav',
                titleFallback: 'Grid navigation',
                noteKey: 'config.keyboardFixedNoteGridNav',
                noteFallback: 'Quick tap G opens bookmark shortcuts starting with G; hold G (~300 ms) or press G then a digit / P / second G for category jump. Not rebindable here yet.',
                bindings: [
                    {
                        keys: ['G + 1–9'],
                        descriptionKey: 'config.keyboardGJumpDesc',
                        descriptionFallback: 'Jump to first bookmark in nth category or smart collection (hold G or G then digit)',
                    },
                    {
                        keys: ['G + P'],
                        descriptionKey: 'config.keyboardGPinnedDesc',
                        descriptionFallback: 'Jump to first pinned bookmark on the page',
                    },
                    {
                        keys: ['G G'],
                        descriptionKey: 'config.keyboardGGDesc',
                        descriptionFallback: 'Jump to the first bookmark on the page',
                    },
                    {
                        keys: ['Shift+←', 'Shift+→'],
                        descriptionKey: 'config.keyboardShiftPageDesc',
                        descriptionFallback: 'Previous / next dashboard page',
                    },
                    {
                        keys: ['Home', 'End'],
                        descriptionKey: 'config.keyboardHomeEndDesc',
                        descriptionFallback: 'First / last bookmark in focused category',
                    },
                    {
                        keys: ['Ctrl+Home', 'Ctrl+End'],
                        descriptionKey: 'config.keyboardCtrlHomeEndDesc',
                        descriptionFallback: 'First / last bookmark on the page',
                    },
                    {
                        keys: ['Page Up', 'Page Down'],
                        descriptionKey: 'config.keyboardPageScrollDesc',
                        descriptionFallback: 'Jump one screen up / down through bookmarks',
                    },
                    {
                        keys: ['Tab', 'Shift+Tab'],
                        descriptionKey: 'config.keyboardTabLinearDesc',
                        descriptionFallback: 'Step linearly through bookmarks when a row is selected',
                    },
                    {
                        keys: ['F1'],
                        descriptionKey: 'config.keyboardF1Desc',
                        descriptionFallback: 'Open keyboard cheat sheet (alias for !)',
                    },
                ],
            },
            {
                titleKey: 'config.keyboardSectionConfigTabBar',
                titleFallback: 'Config tab bar',
                noteKey: 'config.keyboardFixedNoteConfigTabBar',
                noteFallback: 'On the config page when focus is not in an input or modal. Tabs are grouped: System, Dashboard, Extras, Help.',
                bindings: [
                    {
                        keys: ['1–9'],
                        descriptionKey: 'config.keyboardConfigTab1to9Desc',
                        descriptionFallback: 'Jump to the Nth visible config tab',
                    },
                    {
                        keys: ['←', '→'],
                        descriptionKey: 'config.keyboardConfigTabArrowsDesc',
                        descriptionFallback: 'Previous / next tab; crosses into the next group at group edges',
                    },
                    {
                        keys: ['Alt+←', 'Alt+→'],
                        descriptionKey: 'config.keyboardConfigTabGroupJumpDesc',
                        descriptionFallback: 'Jump to first tab of previous / next tab group',
                    },
                    {
                        keys: ['S'],
                        descriptionKey: 'config.keyboardConfigSaveDesc',
                        descriptionFallback: 'Save config changes',
                    },
                    {
                        keys: ['Ctrl+Shift+K', 'Cmd+Shift+K'],
                        descriptionKey: 'config.keyboardConfigSettingsSearchDesc',
                        descriptionFallback: 'Find settings, tabs, and help sections',
                    },
                    {
                        keys: ['Ctrl+K', 'Cmd+K'],
                        descriptionKey: 'config.keyboardConfigPaletteDesc',
                        descriptionFallback: 'Quick actions palette (save, open dashboard, tour resets)',
                    },
                    {
                        keys: ['Alt+↑', 'Alt+↓'],
                        descriptionKey: 'config.keyboardConfigReorderDesc',
                        descriptionFallback: 'Reorder selected bookmark on the Bookmarks tab',
                    },
                ],
            },
        ];
    }

    getEffectiveKey(bindingId) {
        return this.customBindings[bindingId] || this.defaultBindings[bindingId]?.key || '';
    }

    bindingDescription(binding) {
        if (binding.descriptionKey) {
            return this.label(binding.descriptionKey, binding.description || '');
        }
        if (binding.descriptionFallback) {
            return this.label(binding.descriptionKey, binding.descriptionFallback);
        }
        return binding.description || '';
    }

    categoryLabel(categoryKey, fallback) {
        return this.label(categoryKey, fallback);
    }

    getFixedKeySet() {
        const keys = new Set();
        this.getFixedBindingGroups().forEach((group) => {
            group.bindings.forEach((binding) => {
                (binding.keys || []).forEach((key) => {
                    const normalized = String(key || '').trim();
                    if (normalized) {
                        keys.add(normalized);
                    }
                });
            });
        });
        return keys;
    }

    findKeyConflict(bindingId, key) {
        const normalized = String(key || '').trim();
        if (!normalized) {
            return null;
        }

        const customConflict = Object.entries(this.customBindings).find(
            ([id, bound]) => id !== bindingId && bound === normalized,
        );
        if (customConflict) {
            const desc = this.bindingDescription(this.defaultBindings[customConflict[0]] || {});
            return this.label('config.keyboardConflictCustom', 'Key already bound to "{name}". Choose another.')
                .replace('{name}', desc || customConflict[0]);
        }

        const defaultConflict = Object.entries(this.defaultBindings).find(
            ([id, binding]) => id !== bindingId && binding.key === normalized,
        );
        if (defaultConflict) {
            return this.label('config.keyboardConflictDefault', 'Key is the default for "{name}". Choose another.')
                .replace('{name}', this.bindingDescription(defaultConflict[1]));
        }

        if (this.getFixedKeySet().has(normalized)) {
            return this.label(
                'config.keyboardConflictFixed',
                'Key is reserved for a fixed dashboard shortcut (cheat sheet). Choose another.',
            );
        }

        return null;
    }

    exportPreset() {
        const payload = {
            version: 1,
            type: 'nextdash-keyboard-preset',
            customKeyBindings: { ...this.customBindings },
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'nextdash-keyboard-preset.json';
        anchor.click();
        URL.revokeObjectURL(url);
    }

    importPresetFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const parsed = JSON.parse(String(reader.result || ''));
                    const bindings = parsed?.customKeyBindings && typeof parsed.customKeyBindings === 'object'
                        ? parsed.customKeyBindings
                        : parsed;
                    if (!bindings || typeof bindings !== 'object') {
                        reject(new Error('invalid'));
                        return;
                    }
                    const next = {};
                    Object.entries(bindings).forEach(([id, boundKey]) => {
                        if (!this.defaultBindings[id] || typeof boundKey !== 'string') {
                            return;
                        }
                        const conflict = this.findKeyConflict(id, boundKey);
                        if (!conflict) {
                            next[id] = boundKey;
                        }
                    });
                    this.customBindings = next;
                    if (this.lastManager) {
                        this.refresh(this.lastManager);
                    }
                    this.markDirty();
                    resolve(Object.keys(next).length);
                } catch {
                    reject(new Error('invalid'));
                }
            };
            reader.onerror = () => reject(new Error('read'));
            reader.readAsText(file);
        });
    }

    renderPresetToolbar(toolbar, manager) {
        toolbar.innerHTML = '';

        const tools = document.createElement('div');
        tools.className = 'config-tab-toolbar-tools keyboard-preset-toolbar';

        const exportBtn = document.createElement('button');
        exportBtn.type = 'button';
        exportBtn.className = 'btn btn-secondary btn-small';
        exportBtn.textContent = this.label('config.keyboardExportPreset', 'Export keyboard preset');
        exportBtn.addEventListener('click', () => this.exportPreset());

        const importLabel = document.createElement('label');
        importLabel.className = 'btn btn-secondary btn-small keyboard-import-label';
        importLabel.textContent = this.label('config.keyboardImportPreset', 'Import keyboard preset');

        const importInput = document.createElement('input');
        importInput.type = 'file';
        importInput.accept = 'application/json,.json';
        importInput.hidden = true;
        importInput.addEventListener('change', async () => {
            const file = importInput.files?.[0];
            importInput.value = '';
            if (!file) {
                return;
            }
            try {
                await this.importPresetFile(file);
                window.ConfigSettingsSearch?.refreshIndex?.();
            } catch {
                alert(this.label('config.keyboardImportInvalid', 'Could not import keyboard preset — invalid file.'));
            }
        });
        importLabel.appendChild(importInput);

        tools.appendChild(exportBtn);
        tools.appendChild(importLabel);
        toolbar.appendChild(tools);

        const resetAllBtn = document.createElement('button');
        resetAllBtn.type = 'button';
        resetAllBtn.className = 'btn btn-danger btn-small keyboard-reset-all-btn';
        resetAllBtn.textContent = this.label('config.keyboardResetAll', 'Reset all to defaults');
        resetAllBtn.addEventListener('click', () => {
            if (confirm(this.label('config.keyboardResetAllConfirm', 'Reset all keyboard shortcuts to defaults?'))) {
                this.customBindings = {};
                this.refresh(manager);
                this.markDirty();
            }
        });
        toolbar.appendChild(resetAllBtn);
    }

    renderSectionHeader(container, title) {
        const header = document.createElement('div');
        header.className = 'keyboard-section-header';
        header.textContent = title;
        container.appendChild(header);
        return header;
    }

    renderSectionNote(container, text) {
        if (!text) {
            return;
        }
        const note = document.createElement('p');
        note.className = 'keyboard-section-note';
        note.textContent = text;
        container.appendChild(note);
    }

    renderRebindableRow(container, binding) {
        const row = document.createElement('div');
        row.className = 'keyboard-binding-row';
        row.setAttribute('role', 'listitem');

        const descDiv = document.createElement('div');
        descDiv.className = 'binding-description';
        descDiv.textContent = this.bindingDescription(binding);

        const keyDiv = document.createElement('div');
        keyDiv.className = 'binding-key-display';

        const currentKey = this.getEffectiveKey(binding.id);
        const isCustom = this.customBindings[binding.id] !== undefined;

        const keySpan = document.createElement('span');
        keySpan.className = `binding-key ${isCustom ? 'custom' : ''}`;
        keySpan.textContent = this.formatKeyForDisplay(currentKey);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn btn-secondary btn-small binding-edit-btn';
        editBtn.textContent = this.label('config.keyboardEdit', 'Rebind');
        editBtn.addEventListener('click', () => {
            this.startListeningForKey(binding.id, keySpan, editBtn);
        });

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'btn btn-secondary btn-small binding-reset-btn';
        resetBtn.textContent = this.label('config.keyboardReset', 'Reset');
        resetBtn.style.display = isCustom ? 'inline-block' : 'none';
        resetBtn.addEventListener('click', () => {
            delete this.customBindings[binding.id];
            keySpan.textContent = this.formatKeyForDisplay(binding.key);
            keySpan.classList.remove('custom');
            resetBtn.style.display = 'none';
            this.markDirty();
        });

        keyDiv.appendChild(keySpan);
        keyDiv.appendChild(editBtn);
        keyDiv.appendChild(resetBtn);

        row.appendChild(descDiv);
        row.appendChild(keyDiv);
        container.appendChild(row);
    }

    refresh(manager) {
        this.lastManager = manager;
        this.customBindings = { ...manager.settingsData?.customKeyBindings } || {};

        const toolbar = document.getElementById('keyboard-toolbar');
        const container = document.getElementById('keyboard-bindings-container');
        if (!toolbar || !container) return;

        this.renderPresetToolbar(toolbar, manager);
        container.innerHTML = '';

        this.getFixedBindingGroups().forEach((group) => {
            this.renderFixedSection(container, group);
        });

        const categories = new Map();
        Object.entries(this.defaultBindings).forEach(([id, binding]) => {
            const categoryName = this.categoryLabel(binding.categoryKey, binding.category);
            if (!categories.has(categoryName)) {
                categories.set(categoryName, []);
            }
            categories.get(categoryName).push({ id, ...binding });
        });

        categories.forEach((bindings, category) => {
            this.renderSectionHeader(container, category);
            bindings.forEach((binding) => {
                this.renderRebindableRow(container, binding);
            });
        });
    }

    renderFixedSection(container, group) {
        this.renderSectionHeader(
            container,
            this.label(group.titleKey, group.titleFallback),
        );

        if (group.noteKey) {
            this.renderSectionNote(
                container,
                this.label(group.noteKey, group.noteFallback || ''),
            );
        }

        group.bindings.forEach((binding) => {
            const row = document.createElement('div');
            row.className = 'keyboard-binding-row keyboard-binding-row--fixed';
            row.setAttribute('role', 'listitem');
            row.dataset.settingsSearchTitle = this.label(binding.descriptionKey, binding.descriptionFallback);

            const descDiv = document.createElement('div');
            descDiv.className = 'binding-description';
            descDiv.textContent = this.label(binding.descriptionKey, binding.descriptionFallback);

            const keyDiv = document.createElement('div');
            keyDiv.className = 'binding-key-display binding-key-display--fixed';

            binding.keys.forEach((key, index) => {
                if (index > 0) {
                    const sep = document.createElement('span');
                    sep.className = 'binding-key-sep';
                    sep.textContent = this.label('config.keyboardKeyOr', 'or');
                    keyDiv.appendChild(sep);
                }
                const keySpan = document.createElement('span');
                keySpan.className = 'binding-key binding-key--fixed';
                keySpan.textContent = this.formatKeyForDisplay(key);
                keyDiv.appendChild(keySpan);
            });

            const badge = document.createElement('span');
            badge.className = 'binding-fixed-badge';
            badge.textContent = this.label('config.keyboardDefaultBadge', 'Default');
            keyDiv.appendChild(badge);

            row.appendChild(descDiv);
            row.appendChild(keyDiv);
            container.appendChild(row);
        });
    }

    startListeningForKey(bindingId, keySpan, editBtn) {
        if (this.isListening) {
            this.stopListening();
        }

        this.isListening = true;
        this.listeningFor = bindingId;

        editBtn.disabled = true;
        editBtn.textContent = this.label('config.keyboardListening', 'Press a key...');
        editBtn.classList.add('listening');

        const handleKeyDown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const key = this.normalizeKey(e);

            if (key === 'Escape') {
                this.stopListening();
                editBtn.disabled = false;
                editBtn.textContent = this.label('config.keyboardEdit', 'Rebind');
                editBtn.classList.remove('listening');
                return;
            }

            if (!key) {
                return;
            }

            const existing = Object.entries(this.customBindings).find(([, v]) => v === key);
            const conflict = this.findKeyConflict(bindingId, key);
            if (conflict) {
                alert(conflict);
                return;
            }
            if (existing) {
                alert(this.label('config.keyboardAlreadyBound', 'Key already bound to another shortcut. Please choose another.'));
                return;
            }

            this.customBindings[bindingId] = key;
            keySpan.textContent = this.formatKeyForDisplay(key);
            keySpan.classList.add('custom');

            const resetBtn = editBtn.nextElementSibling;
            if (resetBtn && resetBtn.classList.contains('binding-reset-btn')) {
                resetBtn.style.display = 'inline-block';
            }

            this.stopListening();
            editBtn.disabled = false;
            editBtn.textContent = this.label('config.keyboardEdit', 'Rebind');
            editBtn.classList.remove('listening');

            document.removeEventListener('keydown', handleKeyDown);

            this.markDirty();
        };

        document.addEventListener('keydown', handleKeyDown);
    }

    stopListening() {
        this.isListening = false;
        this.listeningFor = null;
    }

    normalizeKey(e) {
        const keyMap = {
            '>': '>',
            '/': '/',
            ':': ':',
            '?': '?',
            '!': '!',
            '*': '*',
            ';': ';',
            ',': ',',
            '@': '@',
            '[': '[',
            'Enter': 'Enter',
            'Escape': 'Escape',
            'ArrowUp': 'ArrowUp',
            'ArrowDown': 'ArrowDown',
            'ArrowLeft': 'ArrowLeft',
            'ArrowRight': 'ArrowRight',
            ' ': 'Space',
            '1': '1',
            '2': '2',
            '3': '3',
            '4': '4',
            '5': '5',
            '6': '6',
            '7': '7',
            '8': '8',
            '9': '9',
        };

        const key = e.key;

        if (keyMap[key]) {
            return keyMap[key];
        }

        if (['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Backspace', 'Delete', 'CapsLock'].includes(key)) {
            return null;
        }

        if (key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            return key;
        }

        return null;
    }

    formatKeyForDisplay(key) {
        const displayMap = {
            'ArrowUp': '↑',
            'ArrowDown': '↓',
            'ArrowLeft': '←',
            'ArrowRight': '→',
            'Enter': '↵',
            'Space': '⎵',
            '>': '>',
            '/': '/',
            ':': ':',
            '?': '?',
            '!': '!',
            '*': '*',
            ';': ';',
            ',': ',',
            '@': '@',
            '[': '[',
            '+': '+',
            '&': '&',
            ':new': ':new',
            'Ctrl+Shift+A': 'Ctrl+Shift+A',
            'Ctrl+C': 'Ctrl+C',
            'Ctrl+V': 'Ctrl+V',
            'Ctrl+Home': 'Ctrl+Home',
            'Ctrl+End': 'Ctrl+End',
            'Shift+M': 'Shift+M',
            'Shift+D': 'Shift+D',
            'Shift+T': 'Shift+T',
            'Shift+←': 'Shift+←',
            'Shift+→': 'Shift+→',
            'Shift+Tab': 'Shift+Tab',
            'G + 1–9': 'G + 1–9',
            'G + P': 'G + P',
            'G G': 'G G',
            'Page Up': 'Page Up',
            'Page Down': 'Page Down',
            'Home': 'Home',
            'End': 'End',
            'Tab': 'Tab',
            'Delete': 'Delete',
            'F1': 'F1',
        };

        if (displayMap[key]) {
            return displayMap[key];
        }

        if (key.includes('+')) {
            return key;
        }

        return key.toUpperCase();
    }

    markDirty() {
        if (this.lastManager && typeof this.lastManager.markDirty === 'function') {
            this.lastManager.markDirty();
        }
    }

    getSaveData() {
        return {
            customKeyBindings: Object.keys(this.customBindings).length > 0 ? this.customBindings : {},
        };
    }
}

window.ConfigKeyboard = ConfigKeyboard;
