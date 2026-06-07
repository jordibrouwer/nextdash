/**
 * Config: global settings search across all tabs and General panels.
 */
(function () {
    'use strict';

    const HIGHLIGHT_CLASS = 'config-settings-search-highlight';
    const MAX_RESULTS = 12;

    let language = null;
    let index = [];
    let indexReady = false;
    let activeIndex = -1;

    function t(key, fallback) {
        if (!language?.t) return fallback;
        const fullKey = `config.${key}`;
        const value = language.t(fullKey);
        return value !== fullKey ? value : fallback;
    }

    function getTabLabel(tabId) {
        const btn = document.querySelector(`.tab-button[data-tab="${tabId}"]`);
        if (btn) return (btn.textContent || '').trim();
        if (tabId === 'keyboard') return t('keyboardTab', 'keyboard');
        return tabId;
    }

    function textOf(el) {
        if (!el) return '';
        return (el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function addEntry(entries, seen, entry) {
        const key = `${entry.tab}|${entry.generalPanel || ''}|${entry.title}|${entry.targetId || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        entries.push({
            ...entry,
            searchText: `${entry.title} ${entry.subtitle || ''} ${entry.extra || ''}`.toLowerCase(),
        });
    }

    function indexGeneralTab(entries, seen) {
        const tabLabel = getTabLabel('general');
        document.querySelectorAll('#general-advanced-nav [data-advanced-nav]').forEach((link) => {
            const panelId = link.getAttribute('data-advanced-nav');
            const title = textOf(link);
            if (!panelId || !title) return;
            addEntry(entries, seen, {
                tab: 'general',
                tabLabel,
                title,
                subtitle: `${tabLabel} › ${t('generalLayerAdvanced', 'Advanced')}`,
                generalPanel: panelId,
                targetEl: link,
            });
        });

        document.querySelectorAll('[data-tab-content="general"] [data-general-panel]').forEach((panel) => {
            const panelId = panel.getAttribute('data-general-panel');
            if (!panelId) return;

            const sectionTitle = panel.querySelector('.section-title');
            const sectionName = textOf(sectionTitle) || panelId;
            addEntry(entries, seen, {
                tab: 'general',
                tabLabel,
                title: sectionName,
                subtitle: `${tabLabel} › ${sectionName}`,
                generalPanel: panelId,
                targetEl: sectionTitle || panel,
            });

            panel.querySelectorAll('label[for]').forEach((label) => {
                const labelText = textOf(label);
                if (!labelText || labelText.length < 2) return;
                const forId = label.getAttribute('for');
                const target = forId ? document.getElementById(forId) : label;
                addEntry(entries, seen, {
                    tab: 'general',
                    tabLabel,
                    title: labelText,
                    subtitle: `${tabLabel} › ${sectionName}`,
                    generalPanel: panelId,
                    targetEl: target || label,
                    extra: sectionName,
                });
            });
        });
    }

    function indexTabContent(tabId, entries, seen) {
        const root = document.querySelector(`[data-tab-content="${tabId}"]`);
        if (!root) return;
        const tabLabel = getTabLabel(tabId);

        root.querySelectorAll('.section-title').forEach((titleEl) => {
            const title = textOf(titleEl);
            if (!title) return;
            const panel = titleEl.closest('[data-general-panel]');
            addEntry(entries, seen, {
                tab: tabId,
                tabLabel,
                title,
                subtitle: tabLabel,
                generalPanel: panel?.getAttribute('data-general-panel') || null,
                targetEl: titleEl,
            });
        });

        root.querySelectorAll('label[for]').forEach((label) => {
            if (label.closest('[data-tab-content="general"]')) return;
            const labelText = textOf(label);
            if (!labelText || labelText.length < 2) return;
            const forId = label.getAttribute('for');
            const target = forId ? document.getElementById(forId) : label;
            addEntry(entries, seen, {
                tab: tabId,
                tabLabel,
                title: labelText,
                subtitle: tabLabel,
                targetEl: target || label,
            });
        });

        root.querySelectorAll('.help-block').forEach((block) => {
            const titleEl = block.querySelector('.section-title');
            const title = textOf(titleEl);
            if (!title) return;
            addEntry(entries, seen, {
                tab: tabId,
                tabLabel,
                title,
                subtitle: tabLabel,
                helpBlockId: block.id || null,
                targetEl: block,
            });
        });

        if (tabId === 'stats') {
            root.querySelectorAll('#stats-index a').forEach((link) => {
                const title = textOf(link);
                if (!title) return;
                const targetId = (link.getAttribute('href') || '').replace(/^#/, '');
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title,
                    subtitle: tabLabel,
                    targetId,
                    targetEl: targetId ? document.getElementById(targetId) || link : link,
                });
            });
            root.querySelectorAll('h4.stats-subtitle').forEach((titleEl) => {
                const title = textOf(titleEl);
                if (!title) return;
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title,
                    subtitle: tabLabel,
                    targetEl: titleEl,
                });
            });
        }

        if (tabId === 'colors') {
            root.querySelectorAll('.colors-tab-button').forEach((btn) => {
                const title = textOf(btn);
                if (!title) return;
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title,
                    subtitle: tabLabel,
                    targetEl: btn,
                });
            });
            root.querySelectorAll('.color-group h3').forEach((titleEl) => {
                const title = textOf(titleEl);
                if (!title) return;
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title,
                    subtitle: tabLabel,
                    targetEl: titleEl,
                });
            });
        }

        root.querySelectorAll('.structure-column-header h3').forEach((titleEl) => {
            const title = textOf(titleEl);
            if (!title) return;
            addEntry(entries, seen, {
                tab: tabId,
                tabLabel,
                title,
                subtitle: tabLabel,
                targetEl: titleEl,
            });
        });
    }

    function indexKeyboardTab(entries, seen) {
        const tabLabel = t('keyboardTab', 'keyboard');
        addEntry(entries, seen, {
            tab: 'keyboard',
            tabLabel,
            title: t('keyboardIntro', 'Customize keyboard shortcuts.'),
            subtitle: tabLabel,
            targetEl: document.querySelector('[data-tab-content="keyboard"]'),
        });

        document.querySelectorAll('#keyboard-bindings-container .keyboard-binding-row').forEach((row) => {
            const desc = row.querySelector('.binding-description');
            const keyEl = row.querySelector('.binding-key');
            const title = textOf(desc);
            if (!title) return;
            const keyLabel = textOf(keyEl);
            addEntry(entries, seen, {
                tab: 'keyboard',
                tabLabel,
                title,
                subtitle: keyLabel ? `${tabLabel} › ${keyLabel}` : tabLabel,
                targetEl: row,
                extra: keyLabel,
            });
        });
    }

    function indexTabs(entries, seen) {
        document.querySelectorAll('.tab-button[data-tab]').forEach((btn) => {
            const tabId = btn.getAttribute('data-tab');
            const title = textOf(btn);
            if (!tabId || !title) return;
            addEntry(entries, seen, {
                tab: tabId,
                tabLabel: title,
                title,
                subtitle: t('settingsSearchTabEntry', 'Tab'),
                targetEl: btn,
            });
        });
    }

    function buildIndex() {
        const entries = [];
        const seen = new Set();
        indexTabs(entries, seen);
        indexGeneralTab(entries, seen);
        ['pages', 'categories', 'tags', 'bookmarks', 'finders', 'collections', 'backups', 'stats', 'colors', 'help'].forEach((tabId) => {
            indexTabContent(tabId, entries, seen);
        });
        indexKeyboardTab(entries, seen);
        index = entries;
        indexReady = true;
    }

    function clearHighlight() {
        document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
            el.classList.remove(HIGHLIGHT_CLASS);
        });
    }

    function highlightElement(el) {
        if (!el) return;
        clearHighlight();
        const target = el.closest?.('[data-general-panel]') || el.closest?.('.help-block') || el;
        target.classList.add(HIGHLIGHT_CLASS);
        setTimeout(() => target.classList.remove(HIGHLIGHT_CLASS), 2400);
    }

    async function navigateTo(item) {
        const mgr = window.configManager;
        if (!mgr?.ui?.switchToTab) return;

        clearHighlight();

        if (item.tab === 'general') {
            mgr.ui.switchToTab('general');
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            if (item.generalPanel && mgr.generalLayers) {
                mgr.generalLayers.scrollToPanel(item.generalPanel, { switchLayer: true });
            }
        } else {
            mgr.ui.switchToTab(item.tab);
            if (item.tab === 'keyboard' && mgr.keyboard) {
                mgr.keyboard.refresh(mgr);
            } else if (item.tab === 'colors' && mgr.ensureColorsEditor) {
                await mgr.ensureColorsEditor();
            } else if (item.tab === 'stats' && mgr.stats) {
                mgr.stats.refresh(mgr);
            }
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }

        let scrollTarget = item.targetEl;
        if (item.helpBlockId) {
            scrollTarget = document.getElementById(item.helpBlockId) || scrollTarget;
        }
        if (scrollTarget?.isConnected) {
            scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
            highlightElement(scrollTarget);
        }
    }

    function scoreItem(item, query) {
        const title = item.title.toLowerCase();
        const text = item.searchText;
        if (title === query) return 100;
        if (title.startsWith(query)) return 80;
        if (title.includes(query)) return 60;
        if (text.includes(query)) return 40;
        return 0;
    }

    function search(query) {
        const q = query.toLowerCase().trim();
        if (!q) return [];
        return index
            .map((item) => ({ item, score: scoreItem(item, q) }))
            .filter((row) => row.score > 0)
            .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
            .slice(0, MAX_RESULTS)
            .map((row) => row.item);
    }

    function renderResults(resultsEl, emptyEl, inputEl, matches) {
        if (!resultsEl) return;
        resultsEl.innerHTML = '';
        activeIndex = -1;

        if (!matches.length) {
            resultsEl.hidden = true;
            if (emptyEl) emptyEl.hidden = !(inputEl?.value || '').trim();
            inputEl?.setAttribute('aria-expanded', 'false');
            return;
        }

        if (emptyEl) emptyEl.hidden = true;
        resultsEl.hidden = false;
        inputEl?.setAttribute('aria-expanded', 'true');

        matches.forEach((item, idx) => {
            const li = document.createElement('li');
            li.setAttribute('role', 'option');
            li.className = 'config-settings-search-result';
            li.dataset.index = String(idx);
            li.innerHTML = `
                <span class="config-settings-search-result-title"></span>
                <span class="config-settings-search-result-sub"></span>
            `;
            li.querySelector('.config-settings-search-result-title').textContent = item.title;
            li.querySelector('.config-settings-search-result-sub').textContent = item.subtitle || item.tabLabel;
            li.addEventListener('mousedown', (e) => e.preventDefault());
            li.addEventListener('click', () => {
                void navigateTo(item);
                if (inputEl) {
                    inputEl.value = '';
                    renderResults(resultsEl, emptyEl, inputEl, []);
                    inputEl.blur();
                }
            });
            resultsEl.appendChild(li);
        });
    }

    function setActiveResult(resultsEl, nextIndex) {
        const items = resultsEl ? [...resultsEl.querySelectorAll('.config-settings-search-result')] : [];
        if (!items.length) return null;
        activeIndex = Math.max(0, Math.min(nextIndex, items.length - 1));
        items.forEach((el, i) => el.classList.toggle('is-active', i === activeIndex));
        items[activeIndex]?.scrollIntoView({ block: 'nearest' });
        return items[activeIndex];
    }

    function focusSearch() {
        if (window.MobileExperience?.isMobileLayout?.()) return false;
        const inputEl = document.getElementById('config-settings-search-input');
        if (!inputEl) return false;
        if (!indexReady) buildIndex();
        inputEl.focus({ preventScroll: true });
        inputEl.select?.();
        return true;
    }

    function init(lang) {
        language = lang;
        const inputEl = document.getElementById('config-settings-search-input');
        const resultsEl = document.getElementById('config-settings-search-results');
        const emptyEl = document.getElementById('config-settings-search-empty');
        const rootEl = document.querySelector('.config-settings-search');
        if (!inputEl || !resultsEl) return;

        if (window.MobileExperience?.isMobileLayout?.()) {
            if (rootEl) rootEl.hidden = true;
            return;
        }

        const placeholder = t('settingsSearchPlaceholder', 'Find settings, tabs, help…');
        const shortcutHint = t('settingsSearchShortcut', 'Navigate — Ctrl+Shift+K · Actions Ctrl+K');
        inputEl.placeholder = placeholder;
        inputEl.setAttribute('aria-label', t('settingsSearchLabel', 'Find settings'));
        inputEl.title = shortcutHint;
        if (emptyEl) {
            emptyEl.textContent = t('settingsSearchNoResults', 'No settings match your search.');
        }

        const ensureIndex = () => {
            if (!indexReady) buildIndex();
        };

        inputEl.addEventListener('focus', ensureIndex);
        inputEl.addEventListener('input', () => {
            ensureIndex();
            renderResults(resultsEl, emptyEl, inputEl, search(inputEl.value));
        });

        inputEl.addEventListener('keydown', (e) => {
            const items = [...resultsEl.querySelectorAll('.config-settings-search-result')];
            if (e.key === 'ArrowDown' && items.length) {
                e.preventDefault();
                setActiveResult(resultsEl, activeIndex + 1);
                return;
            }
            if (e.key === 'ArrowUp' && items.length) {
                e.preventDefault();
                setActiveResult(resultsEl, activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
                return;
            }
            if (e.key === 'Enter') {
                const active = items[activeIndex] || items[0];
                if (active) {
                    e.preventDefault();
                    active.click();
                }
                return;
            }
            if (e.key === 'Escape') {
                inputEl.value = '';
                renderResults(resultsEl, emptyEl, inputEl, []);
                resultsEl.hidden = true;
                inputEl.blur();
            }
        });

        document.addEventListener('click', (e) => {
            if (!rootEl?.contains(e.target)) {
                renderResults(resultsEl, emptyEl, inputEl, inputEl.value ? search(inputEl.value) : []);
                if (!inputEl.value.trim()) resultsEl.hidden = true;
            }
        });
    }

    function refreshIndex() {
        indexReady = false;
        buildIndex();
    }

    window.ConfigSettingsSearch = {
        init,
        focusSearch,
        refreshIndex,
        rebuildIndex: buildIndex,
    };
})();
