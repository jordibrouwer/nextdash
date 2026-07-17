/**
 * Config: global settings search across all tabs and General panels.
 */
(function () {
    'use strict';

    const HIGHLIGHT_CLASS = 'config-settings-search-highlight';
    const MAX_RESULTS = 12;
    const PROMO_STORAGE_KEY = 'nextdash:config-settings-search-promo-v1';
    /** Set only when the user actually dismissed a visible promo (avoids legacy false positives). */
    const PROMO_CONFIRMED_KEY = 'nextdash:config-settings-search-promo-confirmed-v1';
    const PROMO_GUIDED_FLOW_MAX_WAIT_MS = 45000;
    const PROMO_AUTO_RETRY_MS = [1500, 3500, 7000];

    let language = null;
    let index = [];
    let indexReady = false;
    let activeIndex = -1;
    let promoEl = null;
    let promoShowTimer = null;
    let promoAutoRetryTimers = [];
    let promoDismissed = false;
    let promoEverShown = false;
    let promoBlockedSince = 0;
    let listenersBound = false;
    let promoPageShowBound = false;
    let promoRepositionBound = null;

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

    function isMobileGeneralSearch() {
        return Boolean(window.MobileExperience?.isPhoneLayout?.());
    }

    function isMobileIndexedPanel(panel) {
        if (!isMobileGeneralSearch() || !panel) return true;
        const id = panel.getAttribute('data-general-panel');
        const allowed = window.MobileExperience?.MOBILE_GENERAL_PANELS || ['localization', 'basics-core', 'layout'];
        return allowed.includes(id);
    }

    function indexGeneralTab(entries, seen) {
        const tabLabel = getTabLabel('general');

        document.querySelectorAll('[data-tab-content="general"] [data-general-panel]').forEach((panel) => {
            const panelId = panel.getAttribute('data-general-panel');
            if (!panelId || !isMobileIndexedPanel(panel)) return;

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

            panel.querySelectorAll('label[for], label.checkbox-label').forEach((label) => {
                const textEl = label.querySelector('.checkbox-text');
                const labelText = textEl ? textOf(textEl) : textOf(label);
                if (!labelText || labelText.length < 2) return;
                const forId = label.getAttribute('for');
                const input = label.querySelector('input');
                const target = forId ? document.getElementById(forId) : (input || label);
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
            if (tabId === 'stats' && titleEl.closest('.stats-content')) return;
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
            const intro = root.querySelector('.stats-page-intro p');
            if (intro) {
                const title = textOf(intro);
                if (title) {
                    addEntry(entries, seen, {
                        tab: tabId,
                        tabLabel,
                        title,
                        subtitle: tabLabel,
                        targetEl: intro,
                    });
                }
            }
            const refreshBtn = document.getElementById('stats-refresh-btn');
            if (refreshBtn) {
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title: textOf(refreshBtn),
                    subtitle: tabLabel,
                    targetEl: refreshBtn,
                });
            }
            const exportBtn = document.getElementById('stats-export-csv-btn');
            if (exportBtn) {
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title: textOf(exportBtn),
                    subtitle: tabLabel,
                    targetEl: exportBtn,
                });
            }
            const filterLabel = document.querySelector('label[for="stats-filter-input"]');
            const filterInput = document.getElementById('stats-filter-input');
            if (filterLabel && filterInput) {
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title: textOf(filterLabel),
                    subtitle: tabLabel,
                    targetEl: filterInput,
                });
            }
            root.querySelectorAll('.stats-index a').forEach((link) => {
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

        if (tabId === 'categories') {
            const addBtn = document.getElementById('add-category-btn');
            if (addBtn) {
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title: textOf(addBtn),
                    subtitle: tabLabel,
                    targetEl: addBtn,
                });
            }
            const pageLabel = document.querySelector('label[for="categories-page-selector"]');
            if (pageLabel) {
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title: textOf(pageLabel),
                    subtitle: tabLabel,
                    targetEl: document.getElementById('categories-page-selector') || pageLabel,
                });
            }
            const mergeLabel = t('merge', 'Merge');
            addEntry(entries, seen, {
                tab: tabId,
                tabLabel,
                title: mergeLabel,
                subtitle: tabLabel,
                extra: t('categoriesIntro', 'Categories'),
                targetEl: root.querySelector('.simple-tab-intro') || root,
            });
        }

        if (tabId === 'pages') {
            const addBtn = document.getElementById('add-page-btn');
            if (addBtn) {
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title: textOf(addBtn),
                    subtitle: tabLabel,
                    targetEl: addBtn,
                });
            }
            const archiveLabel = t('archive', 'Archive');
            addEntry(entries, seen, {
                tab: tabId,
                tabLabel,
                title: archiveLabel,
                subtitle: tabLabel,
                extra: t('pagesIntro', 'Pages'),
                targetEl: root.querySelector('.simple-tab-intro') || root,
            });
        }

        if (tabId === 'finders') {
            const filterInput = document.getElementById('finders-filter-input');
            if (filterInput) {
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title: t('findersFilterLabel', 'Filter finders'),
                    subtitle: tabLabel,
                    targetEl: filterInput,
                });
            }
            const addBtn = document.getElementById('add-finder-btn');
            if (addBtn) {
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title: t('addFinder', '+ Add finder'),
                    subtitle: tabLabel,
                    extra: t('findersIntro', 'Finders'),
                    targetEl: addBtn,
                });
            }
        }

        if (tabId === 'backups') {
            const intro = root.querySelector('.backups-tab-intro');
            if (intro) {
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title: t('backupsIntro', 'Backups'),
                    subtitle: tabLabel,
                    targetEl: intro,
                });
            }
            [
                ['backup-btn', 'createBackup'],
                ['import-btn', 'selectImportFile'],
                ['browser-import-btn', 'browserImportBtn'],
                ['csv-export-btn', 'csvExportBtn'],
                ['settings-export-btn', 'settingsExportBtn'],
                ['settings-import-btn', 'settingsImportBtn'],
            ].forEach(([id, key]) => {
                const btn = document.getElementById(id);
                if (!btn) return;
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title: textOf(btn) || t(key, ''),
                    subtitle: tabLabel,
                    extra: t('backupsZipSectionTitle', 'ZIP Backup & Restore'),
                    targetEl: btn,
                });
            });
            root.querySelectorAll('.backups-action-label').forEach((labelEl) => {
                const title = textOf(labelEl);
                if (!title) return;
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title,
                    subtitle: tabLabel,
                    targetEl: labelEl.closest('.backups-action-item') || labelEl,
                });
            });
        }

        if (tabId === 'tags') {
            const filterInput = document.getElementById('tags-filter-input');
            if (filterInput) {
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title: t('tagsFilterLabel', 'Filter tags'),
                    subtitle: tabLabel,
                    targetEl: filterInput,
                });
            }
            const renameLabel = t('rename', 'Rename');
            addEntry(entries, seen, {
                tab: tabId,
                tabLabel,
                title: renameLabel,
                subtitle: tabLabel,
                extra: t('tagsTabIntro', 'Tags'),
                targetEl: document.getElementById('tags-list') || root,
            });
            const searchLabel = t('tagSearch', 'Search');
            addEntry(entries, seen, {
                tab: tabId,
                tabLabel,
                title: searchLabel,
                subtitle: tabLabel,
                extra: t('tagsTab', 'tags'),
                targetEl: document.getElementById('tags-cloud') || root,
            });
            const deleteLabel = t('tagDeleteLabel', 'Delete tag');
            addEntry(entries, seen, {
                tab: tabId,
                tabLabel,
                title: deleteLabel,
                subtitle: tabLabel,
                extra: t('tagsTabIntro', 'Tags'),
                targetEl: document.getElementById('tags-list') || root,
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
                    colorsSubTab: btn.getAttribute('data-colors-tab'),
                });
            });
            root.querySelectorAll('.color-group h3').forEach((titleEl) => {
                const title = textOf(titleEl);
                if (!title) return;
                const panel = titleEl.closest('[data-colors-tab-panel]');
                const colorsSubTab = panel?.getAttribute('data-colors-tab-panel') || null;
                addEntry(entries, seen, {
                    tab: tabId,
                    tabLabel,
                    title,
                    subtitle: tabLabel,
                    targetEl: titleEl,
                    colorsSubTab,
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

        const keyboard = window.configManager?.keyboard;
        if (keyboard && typeof keyboard.getFixedBindingGroups === 'function') {
            keyboard.getFixedBindingGroups().forEach((group) => {
                const sectionTitle = group.titleFallback || group.titleKey || '';
                addEntry(entries, seen, {
                    tab: 'keyboard',
                    tabLabel,
                    title: sectionTitle,
                    subtitle: `${tabLabel} › ${t('keyboardFixedSection', 'fixed shortcuts')}`,
                    targetEl: document.querySelector('[data-tab-content="keyboard"]'),
                    extra: sectionTitle,
                });
                group.bindings.forEach((binding) => {
                    const title = binding.descriptionFallback || binding.description || '';
                    const keys = (binding.keys || []).join(' ');
                    addEntry(entries, seen, {
                        tab: 'keyboard',
                        tabLabel,
                        title,
                        subtitle: keys ? `${tabLabel} › ${keys}` : tabLabel,
                        targetEl: document.querySelector('[data-tab-content="keyboard"]'),
                        extra: keys,
                    });
                });
            });
        }

        document.querySelectorAll('#keyboard-bindings-container .keyboard-binding-row').forEach((row) => {
            const desc = row.querySelector('.binding-description');
            const keyEls = row.querySelectorAll('.binding-key');
            const title = row.dataset.settingsSearchTitle || textOf(desc);
            if (!title) return;
            const keyLabel = Array.from(keyEls).map((el) => textOf(el)).filter(Boolean).join(' / ');
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
        if (isMobileGeneralSearch()) {
            indexGeneralTab(entries, seen);
        } else {
            indexTabs(entries, seen);
            indexGeneralTab(entries, seen);
            ['pages', 'categories', 'tags', 'bookmarks', 'finders', 'collections', 'backups', 'stats', 'colors', 'help'].forEach((tabId) => {
                indexTabContent(tabId, entries, seen);
            });
            indexKeyboardTab(entries, seen);
        }
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

            let scrollTarget = item.targetEl;
            if (item.helpBlockId) {
                scrollTarget = document.getElementById(item.helpBlockId) || scrollTarget;
            }
            let panelId = item.generalPanel;
            if (!panelId && scrollTarget?.isConnected) {
                panelId = scrollTarget.closest('[data-general-panel]')?.getAttribute('data-general-panel');
            }
            if (panelId && mgr.generalLayers) {
                mgr.generalLayers.scrollToPanel(panelId, { switchLayer: true });
            }
        } else {
            mgr.ui.switchToTab(item.tab);
            if (item.tab === 'keyboard' && mgr.keyboard) {
                mgr.keyboard.refresh(mgr);
            } else if (item.tab === 'colors' && mgr.ensureColorsEditor) {
                await mgr.ensureColorsEditor();
                if (item.colorsSubTab && mgr.colorsEditor?.switchSubTab) {
                    mgr.colorsEditor.switchSubTab(item.colorsSubTab, { updateHash: false });
                } else if (item.targetEl) {
                    const panel = item.targetEl.closest?.('[data-colors-tab-panel]');
                    const sub = panel?.getAttribute('data-colors-tab-panel');
                    if (sub && mgr.colorsEditor?.switchSubTab) {
                        mgr.colorsEditor.switchSubTab(sub, { updateHash: false });
                    }
                }
            } else if (item.tab === 'stats' && mgr.stats) {
                mgr.stats.refresh(mgr);
            }
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }

        let scrollTarget = item.targetEl;
        if (item.tab !== 'general') {
            if (item.helpBlockId) {
                scrollTarget = document.getElementById(item.helpBlockId) || scrollTarget;
            }
        } else if (item.helpBlockId) {
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

        const query = (inputEl?.value || '').trim();
        if (query) {
            dismissPromo(true, { blockSession: true });
        }

        if (!matches.length) {
            resultsEl.hidden = true;
            if (emptyEl) emptyEl.hidden = !query;
            inputEl?.setAttribute('aria-expanded', query ? 'true' : 'false');
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
        const inputEl = document.getElementById('config-settings-search-input');
        if (!inputEl) return false;
        if (!indexReady) buildIndex();
        inputEl.focus({ preventScroll: true });
        inputEl.select?.();
        return true;
    }

    function hasSeenPromo() {
        try {
            return localStorage.getItem(PROMO_CONFIRMED_KEY) === '1';
        } catch {
            return true;
        }
    }

    function markPromoSeen() {
        try {
            localStorage.setItem(PROMO_STORAGE_KEY, '1');
            localStorage.setItem(PROMO_CONFIRMED_KEY, '1');
        } catch {
            // Ignore storage errors.
        }
    }

    function clearPromoSeen() {
        try {
            localStorage.removeItem(PROMO_STORAGE_KEY);
            localStorage.removeItem(PROMO_CONFIRMED_KEY);
        } catch {
            // Ignore storage errors.
        }
    }

    function clearPromoAutoRetries() {
        promoAutoRetryTimers.forEach((id) => clearTimeout(id));
        promoAutoRetryTimers = [];
    }

    function armPromoAutoRetries() {
        if (hasSeenPromo() || promoEverShown) return;
        clearPromoAutoRetries();
        PROMO_AUTO_RETRY_MS.forEach((delayMs) => {
            const id = setTimeout(() => {
                if (!hasSeenPromo() && !promoEverShown) {
                    schedulePromoWhenIdle();
                }
            }, delayMs);
            promoAutoRetryTimers.push(id);
        });
    }

    function isWhatsNewModalOpen() {
        const overlay = document.getElementById('app-modal');
        if (!overlay?.classList.contains('show')) return false;
        return Boolean(overlay.querySelector('.modal.whats-new-modal'));
    }

    // Tours, spotlights and the guided-flow guard are gone; what's new is the only
    // remaining flow this promo must not talk over.
    function isGuidedFlowActive() {
        return isWhatsNewModalOpen();
    }

    function isPromoVisible() {
        return Boolean(
            promoEl?.isConnected ||
            document.querySelector('.config-settings-search-promo') ||
            document.querySelector('.config-settings-search')?.classList.contains('config-settings-search--promo')
        );
    }

    function unbindPromoReposition() {
        if (!promoRepositionBound) return;
        window.removeEventListener('scroll', promoRepositionBound, true);
        window.removeEventListener('resize', promoRepositionBound);
        promoRepositionBound = null;
    }

    function positionConfigSearchPromo(inputEl) {
        if (!promoEl || !inputEl?.isConnected || !window.DashboardPromoPlacement?.positionBesideAnchor) {
            return;
        }

        const rect = inputEl.getBoundingClientRect();
        if (rect.width < 1 && rect.height < 1) {
            return;
        }

        promoEl.style.visibility = 'hidden';
        promoEl.style.display = 'block';
        promoEl.style.right = 'auto';
        promoEl.style.bottom = 'auto';

        const balloon = promoEl.querySelector('.config-settings-search-promo-balloon');
        const balloonRect = balloon?.getBoundingClientRect();
        const initialWidth = balloonRect?.width || 300;
        const height = balloonRect?.height || 140;
        const placement = window.DashboardPromoPlacement.positionBesideAnchor(rect, initialWidth, height);

        promoEl.style.width = `${Math.round(placement.width)}px`;
        promoEl.style.maxWidth = `${Math.round(placement.width)}px`;
        promoEl.classList.remove(
            'config-settings-search-promo--beside-right',
            'config-settings-search-promo--beside-left'
        );
        promoEl.classList.add(
            placement.placeRight
                ? 'config-settings-search-promo--beside-right'
                : 'config-settings-search-promo--beside-left'
        );
        promoEl.style.left = `${Math.round(placement.left)}px`;
        // positionBesideAnchor centres the balloon on the anchor, so its top half
        // lands on the tab bar and swallows clicks on the tabs it covers. Keep it
        // level with the field or lower; it may hang below, never above.
        let top = Math.max(placement.top, rect.top);
        const maxTop = window.innerHeight - height - window.DashboardPromoPlacement.VIEWPORT_PAD;
        top = Math.min(top, Math.max(window.DashboardPromoPlacement.VIEWPORT_PAD, maxTop));
        promoEl.style.top = `${Math.round(top)}px`;

        // The tail is centred by default; once the balloon no longer lines up with
        // the field it has to follow the anchor instead of pointing at nothing.
        const tail = promoEl.querySelector('.config-settings-search-promo-tail');
        if (tail) {
            const anchorMid = rect.top + rect.height / 2;
            const offset = Math.min(Math.max(anchorMid - top, 14), Math.max(14, height - 14));
            tail.style.top = `${Math.round(offset)}px`;
        }
        promoEl.style.visibility = 'visible';
    }

    function bindPromoReposition(inputEl) {
        unbindPromoReposition();
        promoRepositionBound = () => positionConfigSearchPromo(inputEl);
        window.addEventListener('scroll', promoRepositionBound, true);
        window.addEventListener('resize', promoRepositionBound);
    }

    function dismissPromo(persist = true, { blockSession = null } = {}) {
        const wasVisible = isPromoVisible();
        clearTimeout(promoShowTimer);
        promoShowTimer = null;
        promoBlockedSince = 0;
        const shouldBlockSession = blockSession ?? wasVisible;
        if (shouldBlockSession) {
            promoDismissed = true;
        }
        if (persist && (wasVisible || blockSession === true)) {
            markPromoSeen();
        }
        unbindPromoReposition();
        promoEl?.remove();
        promoEl = null;
        const root = document.querySelector('.config-settings-search');
        root?.querySelector('.config-settings-search-promo-badge')?.remove();
        root?.classList.remove('config-settings-search--promo');
    }

    function buildPromoHtml() {
        const badge = t('settingsSearchPromoBadge', 'New');
        const title = t('settingsSearchPromoTitle', 'Settings search');
        const body = t(
            'settingsSearchPromoBody',
            'Find any setting, tab, or help section from the breadcrumb bar. Type a keyword and pick a result — or press Ctrl+Shift+K (Cmd+Shift+K on Mac). Ctrl+K opens quick actions only.'
        );
        const tryLabel = t('settingsSearchPromoTry', 'Try it');
        const closeLabel = t('settingsSearchPromoDismiss', 'Got it');
        const wrap = document.createElement('div');
        wrap.className = 'config-settings-search-promo';
        wrap.setAttribute('role', 'status');
        wrap.setAttribute('aria-live', 'polite');
        wrap.innerHTML = `
            <div class="config-settings-search-promo-balloon">
                <span class="config-settings-search-promo-tail" aria-hidden="true"></span>
                <p class="config-settings-search-promo-title"></p>
                <p class="config-settings-search-promo-text"></p>
                <div class="config-settings-search-promo-actions">
                    <button type="button" class="config-settings-search-promo-try"></button>
                    <button type="button" class="config-settings-search-promo-close"></button>
                </div>
            </div>`;
        wrap.querySelector('.config-settings-search-promo-title').textContent = title;
        wrap.querySelector('.config-settings-search-promo-text').innerHTML = body;
        wrap.querySelector('.config-settings-search-promo-try').textContent = tryLabel;
        wrap.querySelector('.config-settings-search-promo-close').textContent = closeLabel;
        return wrap;
    }

    function maybeShowPromo(rootEl, inputEl) {
        if (!rootEl || !inputEl || promoDismissed || hasSeenPromo()) return;
        if (window.MobileExperience?.isMobileLayout?.()) return;
        if (isGuidedFlowActive()) {
            if (isConfigTourActive()) {
                promoShowTimer = setTimeout(() => maybeShowPromo(rootEl, inputEl), 1200);
                return;
            }
            if (!promoBlockedSince) promoBlockedSince = Date.now();
            if (Date.now() - promoBlockedSince < PROMO_GUIDED_FLOW_MAX_WAIT_MS) {
                promoShowTimer = setTimeout(() => maybeShowPromo(rootEl, inputEl), 1200);
                return;
            }
        }

        promoBlockedSince = 0;

        if (isPromoVisible()) return;

        promoEverShown = true;
        rootEl.classList.add('config-settings-search--promo');

        const field = rootEl.querySelector('.config-settings-search-field');
        if (field && !field.querySelector('.config-settings-search-promo-badge')) {
            const badge = document.createElement('span');
            badge.className = 'config-settings-search-promo-badge';
            badge.textContent = t('settingsSearchPromoBadge', 'New');
            field.appendChild(badge);
        }

        promoEl = buildPromoHtml();
        document.body.appendChild(promoEl);
        bindPromoReposition(inputEl);
        requestAnimationFrame(() => positionConfigSearchPromo(inputEl));

        promoEl.querySelector('.config-settings-search-promo-try')?.addEventListener('click', () => {
            dismissPromo(true);
            focusSearch();
        });
        promoEl.querySelector('.config-settings-search-promo-close')?.addEventListener('click', () => {
            dismissPromo(true);
        });
    }

    function schedulePromo(rootEl, inputEl, delayMs = 900) {
        if (hasSeenPromo()) return;
        if (promoDismissed && promoEverShown) return;
        clearTimeout(promoShowTimer);
        promoShowTimer = setTimeout(() => maybeShowPromo(rootEl, inputEl), delayMs);
    }

    function ensureSearchVisible(rootEl) {
        if (!rootEl) return false;
        rootEl.hidden = false;
        rootEl.classList.toggle('config-settings-search--mobile', isMobileGeneralSearch());
        return true;
    }

    function relocateForLayout() {
        const search = document.querySelector('.config-settings-search');
        const mobileHost = document.getElementById('general-mobile-settings-search-host');
        const desktopAnchor = document.getElementById('config-settings-search-anchor');
        if (!search) return;
        if (isMobileGeneralSearch() && mobileHost) {
            mobileHost.appendChild(search);
            mobileHost.hidden = false;
        } else if (desktopAnchor) {
            desktopAnchor.appendChild(search);
            if (mobileHost) mobileHost.hidden = true;
        }
    }

    /** Adjust search for mobile (Essentials subset) vs desktop. */
    function syncMobileLayout({ rebuildIndex = true } = {}) {
        const rootEl = document.querySelector('.config-settings-search');
        if (!rootEl) return;
        relocateForLayout();
        const label = rootEl?.querySelector('.config-settings-search-label');
        if (label) {
            if (isMobileGeneralSearch()) {
                label.textContent = t('settingsSearchMobileHint', 'Search language, theme, and layout settings on this device.');
                label.setAttribute('data-i18n', 'config.settingsSearchMobileHint');
            } else {
                label.textContent = t('settingsSearchLabel', 'Search settings');
                label.setAttribute('data-i18n', 'config.settingsSearchLabel');
            }
        }
        if (isMobileGeneralSearch()) {
            ensureSearchVisible(rootEl);
            clearTimeout(promoShowTimer);
            promoShowTimer = null;
            clearPromoAutoRetries();
            dismissPromo(false, { blockSession: false });
            if (rebuildIndex) {
                indexReady = false;
                buildIndex();
            }
            return;
        }
        rootEl.classList.remove('config-settings-search--mobile');
        ensureSearchVisible(rootEl);
        if (rebuildIndex) {
            indexReady = false;
            buildIndex();
        }
    }

    /** Re-queue promo after config finishes loading or a guided tour ends. */
    function schedulePromoWhenIdle() {
        if (hasSeenPromo()) return;
        if (window.MobileExperience?.isMobileLayout?.()) return;
        const rootEl = document.querySelector('.config-settings-search');
        const inputEl = document.getElementById('config-settings-search-input');
        if (!rootEl || !inputEl || isMobileGeneralSearch() || !ensureSearchVisible(rootEl)) return;
        if (!promoEverShown) {
            promoDismissed = false;
        }
        promoBlockedSince = 0;
        schedulePromo(rootEl, inputEl);
        armPromoAutoRetries();
    }

    function bootPromoAutoStart() {
        if (hasSeenPromo() || window.MobileExperience?.isMobileLayout?.()) return;
        schedulePromoWhenIdle();
        if (!promoPageShowBound && typeof window !== 'undefined') {
            promoPageShowBound = true;
            window.addEventListener('pageshow', onPromoPageShow);
        }
    }

    function onPromoPageShow(event) {
        if (event.persisted && !hasSeenPromo() && !promoEverShown) {
            schedulePromoWhenIdle();
        }
    }

    function resetPromoSeen({ replay = true } = {}) {
        clearTimeout(promoShowTimer);
        promoShowTimer = null;
        clearPromoAutoRetries();
        promoDismissed = false;
        promoEverShown = false;
        promoBlockedSince = 0;
        clearPromoSeen();
        dismissPromo(false, { blockSession: false });
        if (replay) {
            schedulePromoWhenIdle();
        }
    }

    function init(lang) {
        language = lang;
        const inputEl = document.getElementById('config-settings-search-input');
        const resultsEl = document.getElementById('config-settings-search-results');
        const emptyEl = document.getElementById('config-settings-search-empty');
        const rootEl = document.querySelector('.config-settings-search');
        if (!inputEl || !resultsEl) return;

        ensureSearchVisible(rootEl);
        syncMobileLayout();

        if (listenersBound) return;
        listenersBound = true;

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

        inputEl.addEventListener('focus', () => {
            if (isPromoVisible()) {
                dismissPromo(true);
            }
            ensureIndex();
        });
        inputEl.addEventListener('input', () => {
            if (inputEl.value.trim()) {
                dismissPromo(true, { blockSession: true });
            } else if (isPromoVisible()) {
                dismissPromo(true);
            }
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
        schedulePromoWhenIdle,
        bootPromoAutoStart,
        resetPromoSeen,
        syncMobileLayout,
        relocateForLayout,
        PROMO_STORAGE_KEY,
        PROMO_CONFIRMED_KEY,
    };
})();
