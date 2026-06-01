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

    getDefaultBindings() {
        return {
            'search': { key: '/', description: 'Open search', category: 'Dashboard' },
            'commands': { key: ':', description: 'Open command mode', category: 'Dashboard' },
            'finders': { key: '?', description: 'Open finders', category: 'Dashboard' },
            'cheatsheet': { key: '!', description: 'Open keyboard cheat sheet', category: 'Dashboard' },
            'recent': { key: '*', description: 'Open/close recent bookmarks', category: 'Dashboard' },
            'edit': { key: ';', description: 'Open inline edit', category: 'Dashboard' },
            'navigation-up': { key: 'ArrowUp', description: 'Move up through bookmarks', category: 'Navigation' },
            'navigation-down': { key: 'ArrowDown', description: 'Move down through bookmarks', category: 'Navigation' },
            'navigation-left': { key: 'ArrowLeft', description: 'Move left through bookmarks', category: 'Navigation' },
            'navigation-right': { key: 'ArrowRight', description: 'Move right through bookmarks', category: 'Navigation' },
            'select': { key: 'Enter', description: 'Open selected bookmark', category: 'Navigation' },
            'page-1': { key: '1', description: 'Go to page 1', category: 'Pages' },
            'page-2': { key: '2', description: 'Go to page 2', category: 'Pages' },
            'page-3': { key: '3', description: 'Go to page 3', category: 'Pages' },
            'page-4': { key: '4', description: 'Go to page 4', category: 'Pages' },
            'page-5': { key: '5', description: 'Go to page 5', category: 'Pages' },
            'page-6': { key: '6', description: 'Go to page 6', category: 'Pages' },
            'page-7': { key: '7', description: 'Go to page 7', category: 'Pages' },
            'page-8': { key: '8', description: 'Go to page 8', category: 'Pages' },
            'page-9': { key: '9', description: 'Go to page 9', category: 'Pages' }
        };
    }

    getFixedBookmarkBindings() {
        return [
            {
                keys: ['&'],
                descriptionKey: 'config.keyboardQuickAddDesc',
                descriptionFallback: 'Quick-add omnibox — type name | url | shortcut in one line'
            },
            {
                keys: ['+', 'Ctrl+Shift+A'],
                descriptionKey: 'config.keyboardNewBookmarkModalDesc',
                descriptionFallback: 'Full new-bookmark modal (+ on dashboard; Ctrl+Shift+A anywhere)'
            },
            {
                keys: [':new'],
                descriptionKey: 'config.keyboardCommandNewDesc',
                descriptionFallback: 'Open new-bookmark modal from command mode (same as + / Ctrl+Shift+A)'
            }
        ];
    }

    getEffectiveKey(bindingId) {
        return this.customBindings[bindingId] || this.defaultBindings[bindingId]?.key || '';
    }

    refresh(manager) {
        this.lastManager = manager;
        this.customBindings = { ...manager.settingsData?.customKeyBindings } || {};
        
        const container = document.getElementById('keyboard-bindings-container');
        if (!container) return;

        container.innerHTML = '';

        this.renderFixedBookmarkSection(container);

        // Group bindings by category
        const categories = new Map();
        Object.entries(this.defaultBindings).forEach(([id, binding]) => {
            if (!categories.has(binding.category)) {
                categories.set(binding.category, []);
            }
            categories.get(binding.category).push({ id, ...binding });
        });

        // Render each category
        categories.forEach((bindings, category) => {
            const section = document.createElement('section');
            section.className = 'keyboard-section';
            
            const title = document.createElement('h4');
            title.className = 'keyboard-section-title';
            title.textContent = category;
            section.appendChild(title);

            const list = document.createElement('div');
            list.className = 'keyboard-bindings-list';

            bindings.forEach(binding => {
                const row = document.createElement('div');
                row.className = 'keyboard-binding-row';

                const descDiv = document.createElement('div');
                descDiv.className = 'binding-description';
                descDiv.textContent = binding.description;

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
                editBtn.textContent = this.t('config.keyboardEdit') || 'Rebind';
                editBtn.addEventListener('click', () => {
                    this.startListeningForKey(binding.id, keySpan, editBtn);
                });

                const resetBtn = document.createElement('button');
                resetBtn.type = 'button';
                resetBtn.className = 'btn btn-secondary btn-small binding-reset-btn';
                resetBtn.textContent = this.t('config.keyboardReset') || 'Reset';
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
                list.appendChild(row);
            });

            section.appendChild(list);
            container.appendChild(section);
        });

        // Add reset all button
        const resetAllSection = document.createElement('div');
        resetAllSection.className = 'keyboard-reset-all-section';
        
        const resetAllBtn = document.createElement('button');
        resetAllBtn.type = 'button';
        resetAllBtn.className = 'btn btn-danger btn-small';
        resetAllBtn.textContent = this.t('config.keyboardResetAll') || 'Reset all to defaults';
        resetAllBtn.addEventListener('click', () => {
            if (confirm(this.t('config.keyboardResetAllConfirm') || 'Reset all keyboard shortcuts to defaults?')) {
                this.customBindings = {};
                this.refresh(manager);
                this.markDirty();
            }
        });
        
        resetAllSection.appendChild(resetAllBtn);
        container.appendChild(resetAllSection);
    }

    renderFixedBookmarkSection(container) {
        const section = document.createElement('section');
        section.className = 'keyboard-section keyboard-section--fixed';

        const title = document.createElement('h4');
        title.className = 'keyboard-section-title';
        title.textContent = this.t('config.keyboardSectionBookmarks') || 'Bookmarks';
        section.appendChild(title);

        const note = document.createElement('p');
        note.className = 'keyboard-fixed-note';
        note.textContent = this.t('config.keyboardFixedNote')
            || 'Default shortcuts for adding bookmarks. These match the dashboard cheat sheet and are not rebindable here yet.';
        section.appendChild(note);

        const list = document.createElement('div');
        list.className = 'keyboard-bindings-list';

        this.getFixedBookmarkBindings().forEach((binding) => {
            const row = document.createElement('div');
            row.className = 'keyboard-binding-row keyboard-binding-row--fixed';

            const descDiv = document.createElement('div');
            descDiv.className = 'binding-description';
            descDiv.textContent = this.t(binding.descriptionKey) || binding.descriptionFallback;

            const keyDiv = document.createElement('div');
            keyDiv.className = 'binding-key-display binding-key-display--fixed';

            binding.keys.forEach((key, index) => {
                if (index > 0) {
                    const sep = document.createElement('span');
                    sep.className = 'binding-key-sep';
                    sep.textContent = this.t('config.keyboardKeyOr') || 'or';
                    keyDiv.appendChild(sep);
                }
                const keySpan = document.createElement('span');
                keySpan.className = 'binding-key binding-key--fixed';
                keySpan.textContent = this.formatKeyForDisplay(key);
                keyDiv.appendChild(keySpan);
            });

            const badge = document.createElement('span');
            badge.className = 'binding-fixed-badge';
            badge.textContent = this.t('config.keyboardDefaultBadge') || 'Default';
            keyDiv.appendChild(badge);

            row.appendChild(descDiv);
            row.appendChild(keyDiv);
            list.appendChild(row);
        });

        section.appendChild(list);
        container.appendChild(section);
    }

    startListeningForKey(bindingId, keySpan, editBtn) {
        if (this.isListening) {
            this.stopListening();
        }

        this.isListening = true;
        this.listeningFor = bindingId;

        editBtn.disabled = true;
        editBtn.textContent = this.t('config.keyboardListening') || 'Press a key...';
        editBtn.classList.add('listening');

        const handleKeyDown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const key = this.normalizeKey(e);
            
            if (key === 'Escape') {
                // Cancel rebinding
                this.stopListening();
                editBtn.disabled = false;
                editBtn.textContent = this.t('config.keyboardEdit') || 'Rebind';
                editBtn.classList.remove('listening');
                return;
            }

            if (!key) {
                return; // Invalid key
            }

            // Check if key is already bound
            const existing = Object.entries(this.customBindings).find(([, v]) => v === key);
            if (existing) {
                alert(this.t('config.keyboardAlreadyBound') || `Key already bound to "${existing[0]}". Please choose another.`);
                return;
            }

            // Apply binding
            this.customBindings[bindingId] = key;
            keySpan.textContent = this.formatKeyForDisplay(key);
            keySpan.classList.add('custom');

            // Show reset button
            const resetBtn = editBtn.nextElementSibling;
            if (resetBtn && resetBtn.classList.contains('binding-reset-btn')) {
                resetBtn.style.display = 'inline-block';
            }

            this.stopListening();
            editBtn.disabled = false;
            editBtn.textContent = this.t('config.keyboardEdit') || 'Rebind';
            editBtn.classList.remove('listening');

            // Remove listener
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
        // Map common keys
        const keyMap = {
            '/': '/',
            ':': ':',
            '?': '?',
            '!': '!',
            '*': '*',
            ';': ';',
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
            '9': '9'
        };

        const key = e.key;
        
        // Allow single character keys and mapped keys
        if (keyMap[key]) {
            return keyMap[key];
        }

        // Reject modifier-only or control keys
        if (['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Backspace', 'Delete', 'CapsLock'].includes(key)) {
            return null;
        }

        // Allow printable single characters (letters, numbers, symbols)
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
            '/': '/',
            ':': ':',
            '?': '?',
            '!': '!',
            '*': '*',
            ';': ';',
            '+': '+',
            '&': '&',
            ':new': ':new',
            'Ctrl+Shift+A': 'Ctrl+Shift+A'
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
            customKeyBindings: Object.keys(this.customBindings).length > 0 ? this.customBindings : {}
        };
    }
}

window.ConfigKeyboard = ConfigKeyboard;
