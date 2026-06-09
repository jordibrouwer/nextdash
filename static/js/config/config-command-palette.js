/**
 * Config quick-actions palette (Ctrl/Cmd+K) — actions only.
 * Find settings via ConfigSettingsSearch (Ctrl/Cmd+Shift+K).
 */
(function () {
    'use strict';

    const ACTION_DEFS = [
        {
            id: 'search-settings',
            labelKey: 'commandGoToSettingsSearch',
            fallback: 'Open settings search (Ctrl+Shift+K)',
            isBridge: true,
        },
        { id: 'add-page', labelKey: 'commandNewPage', fallback: 'New page' },
        { id: 'add-category', labelKey: 'commandNewCategory', fallback: 'New category' },
        { id: 'add-bookmark', labelKey: 'commandNewBookmark', fallback: 'New bookmark' },
        { id: 'refresh-favicon-selection', labelKey: 'commandRefreshFavicons', fallback: 'Refresh favicons' },
    ];

    function t(lang, key, fallback) {
        if (!lang?.t) return fallback;
        const fullKey = `config.${key}`;
        const value = lang.t(fullKey);
        return value !== fullKey ? value : fallback;
    }

    function getActions(lang) {
        return ACTION_DEFS.map((def) => ({
            id: def.id,
            isBridge: def.isBridge === true,
            label: t(lang, def.labelKey, def.fallback),
        }));
    }

    function filterActions(actions, query) {
        const q = query.toLowerCase().trim();
        if (!q) return actions;
        return actions.filter((action) => action.label.toLowerCase().includes(q) || action.id.includes(q));
    }

    function renderList(listEl, actions, onRun) {
        if (!listEl) return;
        listEl.innerHTML = '';
        actions.forEach((action, index) => {
            const li = document.createElement('li');
            li.className = 'config-command-palette-item';
            if (action.isBridge) li.classList.add('is-bridge');
            li.id = `config-command-palette-option-${index}`;
            li.dataset.actionId = action.id;
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
            li.tabIndex = -1;
            li.textContent = action.label;
            li.addEventListener('mousedown', (e) => e.preventDefault());
            li.addEventListener('click', () => onRun(action.id));
            listEl.appendChild(li);
        });
    }

    function setActiveItem(listEl, inputEl, nextIndex) {
        const items = listEl ? [...listEl.querySelectorAll('.config-command-palette-item')] : [];
        if (!items.length) return null;
        const index = Math.max(0, Math.min(nextIndex, items.length - 1));
        items.forEach((el, i) => {
            const active = i === index;
            el.classList.toggle('is-active', active);
            el.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        const activeEl = items[index];
        if (inputEl && activeEl?.id) {
            inputEl.setAttribute('aria-activedescendant', activeEl.id);
        } else if (inputEl) {
            inputEl.removeAttribute('aria-activedescendant');
        }
        activeEl?.scrollIntoView({ block: 'nearest' });
        return { index, item: activeEl };
    }

    function open(configManager) {
        if (!configManager || !window.AppModal) return;

        if (window.AppModal.modal?.classList.contains('show')
            && window.AppModal.modalPanel?.classList.contains('config-command-palette-modal')) {
            document.getElementById('config-command-palette-input')?.focus();
            return;
        }

        const lang = configManager.language;
        const allActions = getActions(lang);
        let activeIndex = 0;

        const html = `
            <div class="config-command-palette">
                <p class="config-command-palette-hint" data-i18n="config.commandPaletteHint">Quick actions — find any setting with Search settings (Ctrl+Shift+K).</p>
                <input
                    type="search"
                    id="config-command-palette-input"
                    class="config-command-palette-input"
                    autocomplete="off"
                    spellcheck="false"
                    aria-controls="config-command-palette-list"
                    aria-autocomplete="list"
                    role="combobox"
                    aria-expanded="true"
                >
                <ul id="config-command-palette-list" class="config-command-palette-list" role="listbox"></ul>
                <p id="config-command-palette-empty" class="config-command-palette-empty" hidden></p>
            </div>
        `;

        let paletteKeyHandler = null;
        let keysAttached = false;

        const detachPaletteKeys = () => {
            if (!keysAttached || !paletteKeyHandler) return;
            document.removeEventListener('keydown', paletteKeyHandler, true);
            keysAttached = false;
        };

        const runAction = async (actionId) => {
            window.AppModal.hide();
            // Let the modal finish closing before opening tabs / detail panels.
            await new Promise((resolve) => setTimeout(resolve, 0));
            await configManager.runPaletteAction?.(actionId);
        };

        window.AppModal.show({
            title: t(lang, 'commandPaletteTitle', 'Quick actions'),
            htmlMessage: html,
            confirmText: t(lang, 'close', 'Close'),
            showCancel: false,
            modalClass: 'config-command-palette-modal',
            initialFocusSelector: '#config-command-palette-input',
            onHide: detachPaletteKeys,
        });

        lang?.applyTranslations?.();

        const inputEl = document.getElementById('config-command-palette-input');
        const listEl = document.getElementById('config-command-palette-list');
        const emptyEl = document.getElementById('config-command-palette-empty');
        if (!inputEl || !listEl) return;

        inputEl.placeholder = t(lang, 'commandPaletteFilterPlaceholder', 'Filter actions…');
        inputEl.setAttribute('aria-haspopup', 'listbox');
        if (emptyEl) {
            emptyEl.textContent = t(lang, 'commandPaletteNoActions', 'No actions match your filter.');
        }

        const getItems = () => [...listEl.querySelectorAll('.config-command-palette-item')];

        const refresh = () => {
            const matches = filterActions(allActions, inputEl.value);
            if (!matches.length) {
                listEl.hidden = true;
                if (emptyEl) emptyEl.hidden = !inputEl.value.trim();
                activeIndex = 0;
                inputEl.removeAttribute('aria-activedescendant');
                return;
            }
            if (emptyEl) emptyEl.hidden = true;
            listEl.hidden = false;
            renderList(listEl, matches, runAction);
            if (activeIndex >= matches.length) {
                activeIndex = 0;
            }
            const active = setActiveItem(listEl, inputEl, activeIndex);
            activeIndex = active?.index ?? 0;
        };

        paletteKeyHandler = (e) => {
            if (!window.AppModal?.modal?.classList.contains('show')
                || !window.AppModal?.modalPanel?.classList.contains('config-command-palette-modal')) {
                detachPaletteKeys();
                return;
            }

            const items = getItems();

            if (e.key === 'ArrowDown' && items.length) {
                e.preventDefault();
                e.stopPropagation();
                const active = setActiveItem(listEl, inputEl, activeIndex + 1);
                activeIndex = active?.index ?? 0;
                return;
            }

            if (e.key === 'ArrowUp' && items.length) {
                e.preventDefault();
                e.stopPropagation();
                const active = setActiveItem(listEl, inputEl, activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
                activeIndex = active?.index ?? 0;
                return;
            }

            if (e.key === 'Enter') {
                if (e.target?.closest?.('.modal-button')) {
                    return;
                }
                const active = items[activeIndex] || items[0];
                if (active) {
                    e.preventDefault();
                    e.stopPropagation();
                    void runAction(active.dataset.actionId);
                }
                return;
            }

            if (e.key === 'Escape') {
                return;
            }
        };

        if (!keysAttached) {
            document.addEventListener('keydown', paletteKeyHandler, true);
            keysAttached = true;
        }

        inputEl.addEventListener('input', () => {
            activeIndex = 0;
            refresh();
        });

        refresh();
    }

    window.ConfigCommandPalette = {
        open,
        ACTION_DEFS,
    };
})();
