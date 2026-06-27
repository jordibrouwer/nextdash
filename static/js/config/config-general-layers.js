/**
 * General tab: Essentials / Advanced / Show all layers
 */
class ConfigGeneralLayers {
    constructor() {
        this.storageKey = 'nextdash-config-general-layer';
        this.root = null;
        this.toolbar = null;
        this.advancedNav = null;
        this.advancedNavWrap = null;
        this.layer = 'essentials';
        this._syncSmartMasterFromChildren = null;
        this._navObserver = null;
        this._smartSyncing = false;
        this._handlersWired = false;
        this._refreshIndexTimer = null;
        this._lastObservedLayer = null;

        this.smartCheckboxIds = [
            'show-smart-today-collection-checkbox',
            'show-smart-recent-collection-checkbox',
            'show-smart-stale-collection-checkbox',
            'show-smart-most-used-collection-checkbox',
            'show-tag-collections-checkbox',
        ];
    }

    t(key, fallback) {
        const lang = window.configManager?.language;
        if (!lang || typeof lang.t !== 'function') return fallback;
        const full = `config.${key}`;
        const v = lang.t(full);
        return v !== full ? v : fallback;
    }

    init() {
        this.root = document.querySelector('.general-layout');
        this.toolbar = document.getElementById('general-layer-toolbar');
        this.advancedNav = document.getElementById('general-advanced-nav');
        this.advancedNavWrap = document.getElementById('general-advanced-nav-wrap');
        if (!this.root || !this.toolbar) return;

        this.restructurePanels();
        if (!this._handlersWired) {
            this.setupLayerSwitcher();
            this.setupExpandCollapseAll();
            this.setupLayerJumps();
            this.setupSmartCollectionsMaster();
            this.setupSmartCollectionLabelPropagation();
            this.setupAdvancedNav();
            this._handlersWired = true;
        }
        this.refreshCheckboxTreeSymbols();
        this.wireStatusEssentialsLinks();
    }

    syncLayerFromUrlOrStorage() {
        if (window.MobileExperience?.isPhoneLayout?.()) {
            this.applyLayer('essentials', { updateHash: false });
            window.MobileExperience?.applyConfigGeneralPanels?.(this);
            return;
        }

        const hash = window.location.hash;
        const raw = (hash || '').replace(/^#/, '');
        if (!raw.startsWith('general')) {
            this.applyLayer(this.getStoredLayer(), { updateHash: true });
            return;
        }

        const rest = raw.slice('general'.length).replace(/^\//, '');
        const parts = rest ? rest.split('/') : [];
        if (parts.length === 0) {
            this.applyLayer(this.getStoredLayer(), { updateHash: true });
            return;
        }

        this.applyHash(hash);
    }

    restructurePanels() {
        if (this.root.dataset.layersReady === '1') return;

        this.splitBasicsPanel();
        this.injectAppearanceEssentialsActions(this.root.querySelector('[data-general-panel="basics-core"]'));
        this.wireThemeColorsLink();
        this.createBookmarksEssentialsPanel();
        this.createSmartCollectionsSummary();
        this.createStatusEssentialsSummary();
        this.splitAdvancedGeneralPanel();
        this.assignPanelTiers();
        this.reorderPanels();
        this.refreshCheckboxTreeSymbols();
        this.root.dataset.layersReady = '1';
    }

    /**
     * Set ├── / └── on consecutive .checkbox-tree-child runs so nesting reads clearly.
     */
    refreshCheckboxTreeSymbols(scope = this.root) {
        if (!scope) return;
        scope.querySelectorAll('.checkbox-tree').forEach((tree) => {
            const items = [...tree.children].filter(
                (el) => el.classList && el.classList.contains('checkbox-tree-item')
            );
            let run = [];
            const flush = () => {
                run.forEach((item, index) => {
                    const sym = item.querySelector('.tree-symbol');
                    if (sym) sym.textContent = index === run.length - 1 ? '└──' : '├──';
                });
                run = [];
            };
            items.forEach((item) => {
                if (item.classList.contains('checkbox-tree-child')) {
                    run.push(item);
                } else {
                    flush();
                }
            });
            flush();
        });
    }

    splitBasicsPanel() {
        const basics = this.root.querySelector('[data-general-panel="basics"]');
        if (!basics || this.root.querySelector('[data-general-panel="basics-core"]')) return;

        const core = document.createElement('section');
        core.className = 'general-card';
        core.dataset.generalPanel = 'basics-core';
        core.dataset.configTier = 'essentials';
        core.innerHTML = `
            <h3 class="section-title" data-i18n="config.generalAppearanceTitle">Appearance & Style</h3>
            <p class="general-card-intro" data-i18n="config.generalEssentialsAppearanceIntro">Theme, font size, favicon styling, animations, and tips.</p>
        `;

        const advanced = document.createElement('section');
        advanced.className = 'general-card';
        advanced.dataset.generalPanel = 'appearance-advanced';
        advanced.dataset.configTier = 'advanced';
        advanced.innerHTML = `
            <h3 class="section-title" data-i18n="config.generalAppearanceAdvancedTitle">Appearance — fine-tuning</h3>
            <p class="general-card-intro" data-i18n="config.generalAppearanceAdvancedIntro">Background and fonts.</p>
        `;

        const moveToCore = [];
        const moveToAdvanced = [];
        basics.querySelectorAll('.form-group, .checkbox-tree').forEach((el) => {
            const isCore = Boolean(
                el.querySelector('#theme-select, #auto-dark-mode-checkbox, .font-size-selector, #animations-enabled-checkbox, #theme-iconstyling-enable, #show-tips-checkbox')
            );
            if (isCore) moveToCore.push(el);
            else moveToAdvanced.push(el);
        });
        moveToCore.forEach((el) => core.appendChild(el));
        moveToAdvanced.forEach((el) => advanced.appendChild(el));

        basics.replaceWith(core, advanced);
        this.injectAppearanceEssentialsActions(core);
    }

    injectAppearanceEssentialsActions(core) {
        if (!core || core.querySelector('#general-theme-colors-link')) return;
        const row = document.createElement('p');
        row.className = 'general-card-intro general-appearance-actions';
        row.innerHTML = '<a href="#colors" id="general-theme-colors-link" class="btn btn-secondary btn-small" data-i18n="config.openThemeColorsLink">Open theme editor →</a>';
        if (window.MobileExperience?.isPhoneLayout?.()) {
            row.hidden = true;
        }
        const intro = core.querySelector('.general-card-intro');
        if (intro) intro.after(row);
        else core.querySelector('.section-title')?.after(row);
        this.wireThemeColorsLink();
    }

    wireThemeColorsLink() {
        const link = document.getElementById('general-theme-colors-link');
        if (!link || link.dataset.colorsNavBound === '1') return;
        link.dataset.colorsNavBound = '1';
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const mgr = window.configManager;
            if (!mgr) return;

            if (window.MobileExperience?.isPhoneLayout?.()) {
                const lang = mgr.language;
                const linkLabel = this.t('openThemeColorsLink', 'Open theme editor →').replace(/\s*→\s*$/, '').trim();
                const namedKey = 'config.generalPanelMobileHiddenNamed';
                const namedTpl = lang?.t?.(namedKey);
                const msg = namedTpl && namedTpl !== namedKey
                    ? namedTpl.replace('{name}', linkLabel)
                    : this.t('generalPanelMobileHidden', 'This section is only available on a wider screen.');
                mgr.ui?.showNotification?.(msg, 'info');
                return;
            }

            if (mgr.isDirty) {
                const ok = await mgr.confirmLeaveWithUnsavedChanges();
                if (!ok) return;
            }
            if (mgr.hasUnsavedColorChanges?.()) {
                const ok = await mgr.colorsEditor?.confirmLeave?.();
                if (!ok) return;
            }
            mgr.ui?.switchToTab?.('colors');
            window.location.hash = '#colors';
            await mgr.ensureColorsEditor?.();
        });
    }

    syncGeneralCardsA11y(scope = this.root) {
        if (!scope) return;
        scope.querySelectorAll('.general-card[data-general-panel]').forEach((card) => {
            const title = card.querySelector('.section-title');
            if (!title) return;
            const expanded = !card.classList.contains('is-collapsed');
            title.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            const panelId = card.getAttribute('data-general-panel');
            if (panelId) {
                title.setAttribute('aria-controls', `general-panel-body-${panelId}`);
            }
        });
    }

    createBookmarksEssentialsPanel() {
        if (this.root.querySelector('[data-general-panel="bookmarks-essentials"]')) return;

        const display = this.root.querySelector('[data-general-panel="bookmarks-display"]');
        if (!display) return;

        const essentials = document.createElement('section');
        essentials.className = 'general-card';
        essentials.dataset.generalPanel = 'bookmarks-essentials';
        essentials.dataset.configTier = 'essentials';
        essentials.innerHTML = `
            <h3 class="section-title" data-i18n="config.generalBookmarksEssentialsTitle">Bookmarks</h3>
            <p class="general-card-intro" data-i18n="config.generalBookmarksEssentialsIntro">Everyday bookmark display and navigation.</p>
            <p class="general-card-intro general-card-intro-hint" data-i18n="config.generalBookmarksEssentialsAdvancedHint">Pin icons, link previews, category collapse, and more are under Advanced → Bookmarks.</p>
        `;

        const tree = document.createElement('div');
        tree.className = 'checkbox-tree';

        const iconsItem = display.querySelector('#show-icons-checkbox')?.closest('.checkbox-tree-item');
        if (iconsItem) tree.appendChild(iconsItem);

        ['new-tab-checkbox', 'paste-url-quick-add-checkbox', 'hide-empty-categories-checkbox'].forEach((id) => {
            const item = display.querySelector(`#${id}`)?.closest('.checkbox-tree-item');
            if (item) tree.appendChild(item);
        });
        const pageTabsItem = display.querySelector('#show-page-tabs-checkbox')?.closest('.checkbox-tree-item');
        if (pageTabsItem) tree.appendChild(pageTabsItem);
        const pageNamesItem = display.querySelector('#show-page-names-in-tabs-checkbox')?.closest('.checkbox-tree-item');
        if (pageNamesItem) tree.appendChild(pageNamesItem);

        if (tree.children.length > 0) essentials.appendChild(tree);
        this.refreshCheckboxTreeSymbols(tree);

        display.parentNode.insertBefore(essentials, display);
    }

    createSmartCollectionsSummary() {
        if (this.root.querySelector('[data-general-panel="smart-collections-summary"]')) return;

        const full = this.root.querySelector('[data-general-panel="smart-collections"]');
        if (!full) return;

        const summary = document.createElement('section');
        summary.className = 'general-card general-card-compact';
        summary.dataset.generalPanel = 'smart-collections-summary';
        summary.dataset.configTier = 'essentials';
        summary.innerHTML = `
            <h3 class="section-title" data-i18n="config.generalSmartCollectionsTitle">Smart Collections</h3>
            <p id="smart-collections-enabled-summary" class="smart-collections-enabled-summary" aria-live="polite"></p>
            <div class="checkbox-tree">
                <div class="checkbox-tree-item">
                    <label class="checkbox-label">
                        <input type="checkbox" id="enable-smart-collections-master" aria-describedby="smart-collections-master-hint">
                        <span class="checkbox-text" data-i18n="config.enableSmartCollections">Enable smart collections</span>
                        <button type="button" id="enable-smart-collections-info-btn" class="info-button" data-i18n-aria="config.enableSmartCollectionsInfoTitle" aria-label="Smart collections information">ℹ</button>
                    </label>
                </div>
                <div class="checkbox-tree-item checkbox-tree-child checkbox-tree-action-row smart-collections-action-row">
                    <span class="tree-symbol">└──</span>
                    <div class="config-advanced-action-row">
                        <p id="smart-collections-master-hint" class="config-advanced-action-text" data-i18n="config.enableSmartCollectionsHint">Turns smart collections on or off. Configure each collection in Advanced.</p>
                        <div class="config-advanced-action-actions">
                            <button type="button" class="btn btn-secondary btn-small general-layer-jump" data-jump-panel="smart-collections" data-i18n="config.configureSmartCollections">Configure in Advanced →</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        full.parentNode.insertBefore(summary, full);
        if (full.dataset.configTier !== 'advanced') {
            full.dataset.configTier = 'advanced';
        }
        this.syncSmartCollectionsSummaryCount();
    }

    syncSmartCollectionsSummaryCount() {
        const el = document.getElementById('smart-collections-enabled-summary');
        if (!el) return;
        const total = this.smartCheckboxIds.length;
        const on = this.smartCheckboxIds.filter((id) => document.getElementById(id)?.checked).length;
        const tpl = this.t('smartCollectionsEnabledCount', '{count} of {total} enabled');
        el.textContent = tpl.replace('{count}', String(on)).replace('{total}', String(total));
        el.hidden = total === 0;
    }

    createStatusEssentialsSummary() {
        if (this.root.querySelector('[data-general-panel="status-essentials-summary"]')) return;

        const full = this.root.querySelector('[data-general-panel="status"]');
        if (!full) return;

        const summary = document.createElement('section');
        summary.className = 'general-card general-card-compact';
        summary.dataset.generalPanel = 'status-essentials-summary';
        summary.dataset.configTier = 'essentials';
        summary.innerHTML = `
            <h3 class="section-title" data-i18n="config.statusEssentialsTitle">Status monitoring</h3>
            <p id="status-essentials-summary-line" class="status-essentials-summary-line" aria-live="polite"></p>
            <div class="checkbox-tree">
                <div class="checkbox-tree-item" id="status-essentials-toggle-slot"></div>
                <div class="checkbox-tree-item checkbox-tree-child checkbox-tree-action-row">
                    <span class="tree-symbol">└──</span>
                    <div class="config-advanced-action-row">
                        <p class="config-advanced-action-text" data-i18n="config.statusEssentialsHint">Per-bookmark checks (as in onboarding) live under Bookmarks. Health shows issues across all pages. Advanced: retries, colors, and ping.</p>
                        <div class="config-advanced-action-actions">
                            <a href="/health" id="status-essentials-health-link" class="btn btn-secondary btn-small status-essentials-health-link" hidden data-i18n="config.statusEssentialsOpenHealth">Health →</a>
                            <button type="button" class="btn btn-secondary btn-small general-layer-jump" data-jump-panel="status" data-i18n="config.configureStatusAdvanced">Advanced settings →</button>
                            <a href="#bookmarks" id="status-essentials-bookmarks-link" class="btn btn-secondary btn-small" data-i18n="config.manageBookmarkStatusChecks">Bookmark checks →</a>
                        </div>
                    </div>
                </div>
            </div>
        `;

        full.parentNode.insertBefore(summary, full);

        const toggleSlot = summary.querySelector('#status-essentials-toggle-slot');
        const showStatusItem = full.querySelector('#show-status-checkbox')?.closest('.checkbox-tree-item');
        if (toggleSlot && showStatusItem) {
            toggleSlot.replaceWith(showStatusItem);
        }

        if (full.dataset.configTier !== 'advanced') {
            full.dataset.configTier = 'advanced';
        }
        this.wireStatusEssentialsLinks();
    }

    wireStatusEssentialsLinks() {
        const bookmarksLink = document.getElementById('status-essentials-bookmarks-link');
        if (!bookmarksLink || bookmarksLink.dataset.bound === '1') return;
        bookmarksLink.dataset.bound = '1';
        bookmarksLink.addEventListener('click', async (e) => {
            e.preventDefault();
            const mgr = window.configManager;
            if (!mgr) return;
            if (mgr.isDirty) {
                const ok = await mgr.confirmLeaveWithUnsavedChanges();
                if (!ok) return;
            }
            mgr.ui?.switchToTab?.('bookmarks');
            window.location.hash = '#bookmarks';
        });
    }

    splitAdvancedGeneralPanel() {
        const old = this.root.querySelector('[data-general-panel="advanced-general"]');
        if (!old || this.root.querySelector('[data-general-panel="search-input"]')) return;

        const search = document.createElement('section');
        search.className = 'general-card';
        search.dataset.generalPanel = 'search-input';
        search.dataset.configTier = 'advanced';
        search.innerHTML = `
            <h3 class="section-title" data-i18n="config.generalSearchInputTitle">Search & input</h3>
            <p class="general-card-intro" data-i18n="config.generalSearchInputIntro">Search overlay behavior and suggestions.</p>
        `;

        const system = document.createElement('section');
        system.className = 'general-card';
        system.dataset.generalPanel = 'system-tools';
        system.dataset.configTier = 'advanced';
        system.innerHTML = `
            <h3 class="section-title" data-i18n="config.generalSystemToolsTitle">System & tools</h3>
            <p class="general-card-intro" data-i18n="config.generalSystemToolsIntro">Launcher mode, device settings, tours, and maintenance.</p>
        `;

        const searchIds = new Set([
            'keep-search-open-when-empty-checkbox',
            'interleave-mode-checkbox',
            'show-search-flow-banner-checkbox',
            'enable-fuzzy-suggestions-checkbox',
            'fuzzy-suggestions-start-with-checkbox',
            'include-finders-in-search-checkbox',
        ]);

        [...old.querySelectorAll('.checkbox-tree-item')].forEach((item) => {
            const input = item.querySelector('input[type="checkbox"]');
            const target = input && searchIds.has(input.id) ? search : system;
            target.appendChild(item);
        });

        old.replaceWith(search, system);
    }

    assignPanelTiers() {
        const tierMap = {
            'basics-core': 'essentials',
            localization: 'essentials',
            layout: 'essentials',
            'bookmarks-essentials': 'essentials',
            'smart-collections-summary': 'essentials',
            'status-essentials-summary': 'essentials',
            'search-buttons': 'essentials',
            'appearance-advanced': 'advanced',
            'bookmarks-display': 'advanced',
            'smart-collections': 'advanced',
            status: 'advanced',
            branding: 'advanced',
            'search-input': 'advanced',
            'system-tools': 'advanced',
            reset: 'advanced',
        };
        this.root.querySelectorAll('[data-general-panel]').forEach((card) => {
            const id = card.getAttribute('data-general-panel');
            if (tierMap[id]) card.dataset.configTier = tierMap[id];
        });
    }

    reorderPanels() {
        const order = [
            'localization',
            'basics-core',
            'layout',
            'bookmarks-essentials',
            'smart-collections-summary',
            'status-essentials-summary',
            'search-buttons',
            'appearance-advanced',
            'bookmarks-display',
            'smart-collections',
            'status',
            'branding',
            'search-input',
            'system-tools',
            'reset',
        ];
        const frag = document.createDocumentFragment();
        order.forEach((id) => {
            const el = this.root.querySelector(`[data-general-panel="${id}"]`);
            if (el) frag.appendChild(el);
        });
        this.root.appendChild(frag);
    }

    setupLayerSwitcher() {
        const buttons = this.toolbar.querySelectorAll('[data-general-layer]');
        buttons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const layer = btn.getAttribute('data-general-layer');
                this.applyLayer(layer, { updateHash: true, persist: true });
            });
        });

        const showAllLink = document.getElementById('general-layer-show-all');
        if (showAllLink) {
            showAllLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.applyLayer('all', { updateHash: true, persist: true });
            });
        }

        this.setupLayerToolbarA11y(buttons, showAllLink);
    }

    setupExpandCollapseAll() {
        const bar = document.getElementById('general-panels-bulk-actions');
        const expandBtn = document.getElementById('general-expand-all-btn');
        const collapseBtn = document.getElementById('general-collapse-all-btn');
        if (!bar || !expandBtn || !collapseBtn) return;

        const visibleCards = () => [...this.root.querySelectorAll('[data-general-panel]')].filter((card) => !card.hidden);

        expandBtn.addEventListener('click', () => {
            visibleCards().forEach((card) => {
                if (card.getAttribute('data-general-panel') === 'reset') return;
                card.classList.remove('is-collapsed');
            });
            this.syncGeneralCardsA11y();
            window.configManager?._persistGeneralPanelState?.();
            window.configManager?.syncResetPanelGuard?.();
        });

        collapseBtn.addEventListener('click', () => {
            visibleCards().forEach((card) => {
                card.classList.add('is-collapsed');
            });
            this.syncGeneralCardsA11y();
            window.configManager?._persistGeneralPanelState?.();
            window.configManager?.syncResetPanelGuard?.();
        });
    }

    setupLayerToolbarA11y(layerButtons, showAllLink) {
        const layerBtnList = Array.from(layerButtons);
        const focusables = [...layerBtnList];
        if (showAllLink) focusables.push(showAllLink);

        const syncTabIndex = (activeEl) => {
            focusables.forEach((el) => {
                el.setAttribute('tabindex', el === activeEl ? '0' : '-1');
            });
        };

        this._toolbarFocusables = focusables;
        this.syncToolbarTabIndex = syncTabIndex;

        const initial = layerBtnList.find((btn) => btn.classList.contains('is-active')) || layerBtnList[0];
        if (this.layer === 'all' && showAllLink) syncTabIndex(showAllLink);
        else if (initial) syncTabIndex(initial);

        layerBtnList.forEach((btn) => {
            btn.addEventListener('click', () => syncTabIndex(btn));
        });
        if (showAllLink) {
            showAllLink.addEventListener('click', () => syncTabIndex(showAllLink));
        }

        this.toolbar.addEventListener('keydown', (e) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            const current = document.activeElement;
            if (!focusables.includes(current)) return;
            e.preventDefault();
            let idx = focusables.indexOf(current);
            if (e.key === 'ArrowRight') idx = (idx + 1) % focusables.length;
            else if (e.key === 'ArrowLeft') idx = (idx - 1 + focusables.length) % focusables.length;
            else if (e.key === 'Home') idx = 0;
            else if (e.key === 'End') idx = focusables.length - 1;
            focusables[idx].focus();
            syncTabIndex(focusables[idx]);
        });
    }

    hasLayerPreference() {
        try {
            const v = localStorage.getItem(this.storageKey);
            return v === 'essentials' || v === 'advanced' || v === 'all';
        } catch {
            return false;
        }
    }

    getStoredLayer() {
        if (!this.hasLayerPreference()) {
            return 'essentials';
        }
        try {
            const v = localStorage.getItem(this.storageKey);
            if (v === 'essentials' || v === 'advanced' || v === 'all') return v;
        } catch { /* ignore */ }
        return 'essentials';
    }

    persistLayerPreference(layer) {
        const normalized = layer === 'advanced' || layer === 'all' ? layer : 'essentials';
        try {
            localStorage.setItem(this.storageKey, normalized);
        } catch { /* ignore */ }
    }

    isMobileGeneralLocked() {
        return Boolean(
            window.MobileExperience?.isPhoneLayout?.()
            && document.getElementById('general-layer-toolbar')?.hidden
        );
    }

    syncAdvancedNavVisibility() {
        if (!this.advancedNav || !this.root) return;

        this.advancedNav.querySelectorAll('[data-advanced-nav]').forEach((link) => {
            const panelId = link.getAttribute('data-advanced-nav');
            const card = this.root.querySelector(`[data-general-panel="${panelId}"]`);
            const tier = link.getAttribute('data-nav-tier') || card?.dataset.configTier || 'advanced';
            let visible = false;
            if (this.layer === 'all') visible = true;
            else if (this.layer === 'advanced') visible = tier === 'advanced';
            link.hidden = !visible;
        });
        this.syncAdvancedNavDivider();
    }

    syncAdvancedNavDivider() {
        if (!this.advancedNav) return;
        this.advancedNav.querySelectorAll('.general-advanced-nav-divider').forEach((el) => el.remove());
        if (this.layer !== 'all') return;

        const links = [...this.advancedNav.querySelectorAll('[data-advanced-nav]')].filter((link) => !link.hidden);
        const firstAdvanced = links.find((link) => {
            const tier = link.getAttribute('data-nav-tier')
                || this.root.querySelector(`[data-general-panel="${link.getAttribute('data-advanced-nav')}"]`)?.dataset.configTier
                || 'advanced';
            return tier === 'advanced';
        });
        if (!firstAdvanced) return;

        const divider = document.createElement('span');
        divider.className = 'general-advanced-nav-divider';
        divider.setAttribute('role', 'separator');
        divider.textContent = this.t('advancedNavSectionBreak', 'Advanced sections');
        firstAdvanced.before(divider);
    }

    setAdvancedNavActive(panelId) {
        if (!this.advancedNav) return;
        this.advancedNav.querySelectorAll('[data-advanced-nav]').forEach((link) => {
            const active = link.getAttribute('data-advanced-nav') === panelId;
            link.classList.toggle('is-active', active);
            if (active) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        });
    }

    scheduleLayerSideEffects({ layerChanged = false } = {}) {
        if (layerChanged || this._lastObservedLayer !== this.layer) {
            this._lastObservedLayer = this.layer;
            this.refreshAdvancedNavObserver();
            window.configManager?.ui?.initBreadcrumbObserver?.('general');
        }

        if (!layerChanged) return;

        clearTimeout(this._refreshIndexTimer);
        this._refreshIndexTimer = setTimeout(() => {
            window.ConfigSettingsSearch?.refreshIndex?.();
        }, 120);
    }

    applyLayer(layer, { updateHash = true, scrollPanel = null, persist = false } = {}) {
        if (!this.root) {
            this.root = document.querySelector('.general-layout');
            this.toolbar = this.toolbar || document.getElementById('general-layer-toolbar');
            this.advancedNav = this.advancedNav || document.getElementById('general-advanced-nav');
            this.advancedNavWrap = this.advancedNavWrap || document.getElementById('general-advanced-nav-wrap');
        }
        if (!this.root) return;

        if (this.isMobileGeneralLocked()) {
            if (scrollPanel) {
                this.scrollToPanel(scrollPanel, { switchLayer: false });
            }
            return;
        }

        const prevLayer = this.layer;
        this.layer = layer === 'advanced' || layer === 'all' ? layer : 'essentials';
        if (persist) {
            this.persistLayerPreference(this.layer);
        }

        const tabWrap = document.querySelector('[data-tab-content="general"] > div');
        if (tabWrap) {
            tabWrap.classList.toggle('general-layer-mode-all', this.layer === 'all');
            tabWrap.dataset.generalLayer = this.layer;
        }

        this.root.querySelectorAll('[data-general-panel]').forEach((card) => {
            if (this.layer === 'all') {
                card.hidden = false;
                return;
            }
            const tier = card.dataset.configTier || 'advanced';
            card.hidden = tier !== this.layer;
        });

        const introEss = document.getElementById('general-layer-intro-essentials');
        const introAdv = document.getElementById('general-layer-intro-advanced');
        const introAll = document.getElementById('general-layer-intro-all');
        if (introEss) introEss.hidden = this.layer !== 'essentials';
        if (introAdv) introAdv.hidden = this.layer !== 'advanced';
        if (introAll) introAll.hidden = this.layer !== 'all';

        const showNav = this.layer === 'advanced' || this.layer === 'all';
        if (this.advancedNavWrap) this.advancedNavWrap.hidden = !showNav;
        else if (this.advancedNav) this.advancedNav.hidden = !showNav;
        this.syncAdvancedNavVisibility();

        const bulkBar = document.getElementById('general-panels-bulk-actions');
        if (bulkBar) bulkBar.hidden = this.layer !== 'all';

        this.toolbar.querySelectorAll('[data-general-layer]').forEach((btn) => {
            const active = btn.getAttribute('data-general-layer') === this.layer;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        const showAllLink = document.getElementById('general-layer-show-all');
        if (showAllLink) {
            showAllLink.classList.toggle('is-active', this.layer === 'all');
            showAllLink.setAttribute('aria-pressed', this.layer === 'all' ? 'true' : 'false');
        }

        const layerBtns = Array.from(this.toolbar.querySelectorAll('[data-general-layer]'));
        const activeToolbarEl = this.layer === 'all'
            ? showAllLink
            : layerBtns.find((b) => b.getAttribute('data-general-layer') === this.layer) || layerBtns[0];
        if (activeToolbarEl) this.syncToolbarTabIndex?.(activeToolbarEl);

        if (updateHash) {
            const panelPart = scrollPanel ? `/${scrollPanel}` : '';
            const hash = this.layer === 'essentials' ? `#general${panelPart}` : `#general/${this.layer}${panelPart}`;
            if (window.location.hash !== hash) {
                window.history.replaceState(null, '', hash);
            }
            try {
                sessionStorage.setItem('nextdash:config-general-hash', hash);
            } catch { /* ignore */ }
        }

        if (scrollPanel) {
            this.scrollToPanel(scrollPanel, { switchLayer: true });
        }

        window.configManager?.refreshGeneralPanelExpandState?.();

        window.configManager?.ui?.updateBreadcrumb?.(
            'general',
            this.getBreadcrumbSubsection()
        );
        this.scheduleLayerSideEffects({ layerChanged: prevLayer !== this.layer });
    }

    getBreadcrumbSubsection() {
        if (this.layer === 'essentials') return this.t('generalLayerEssentials', 'Essentials');
        if (this.layer === 'advanced') return this.t('generalLayerAdvanced', 'Advanced');
        return this.t('generalLayerAll', 'All sections');
    }

    applyHash(hash) {
        const raw = (hash || '').replace(/^#/, '');
        if (!raw.startsWith('general')) return;

        if (window.MobileExperience?.isPhoneLayout?.()) {
            const mobilePanels = new Set(window.MobileExperience.MOBILE_GENERAL_PANELS || []);
            const rest = raw.slice('general'.length).replace(/^\//, '');
            const parts = rest ? rest.split('/') : [];
            let panel = null;
            if (parts[0] === 'advanced' || parts[0] === 'all') {
                panel = parts[1] || null;
            } else if (parts[0]) {
                panel = parts[0];
            }
            if (panel && mobilePanels.has(panel)) {
                this.scrollToPanel(panel, { switchLayer: false });
            }
            return;
        }

        const rest = raw.slice('general'.length).replace(/^\//, '');
        const parts = rest ? rest.split('/') : [];
        let layer = null;
        let panel = null;

        if (parts[0] === 'advanced' || parts[0] === 'all') {
            layer = parts[0];
            panel = parts[1] || null;
        } else if (parts[0]) {
            panel = parts[0];
        }

        if (layer === null && panel === null) {
            this.applyLayer(this.getStoredLayer(), { updateHash: true });
            return;
        }

        if (!this.hasLayerPreference()) {
            if (panel) {
                this.applyLayer('essentials', { updateHash: true });
                this.scrollToPanel(panel, { switchLayer: false });
            } else {
                this.applyLayer('essentials', { updateHash: true });
            }
            return;
        }

        if (layer !== null) {
            this.applyLayer(layer, { updateHash: false, scrollPanel: panel });
        } else if (panel) {
            this.scrollToPanel(panel, { switchLayer: true });
        }
    }

    scrollToPanel(panelId, { switchLayer = false } = {}) {
        if (!this.root) return;
        const card = this.root.querySelector(`[data-general-panel="${panelId}"]`);
        if (!card) return;

        if (card.dataset.mobilePanelHidden === 'true') {
            const ui = window.configManager?.ui;
            const lang = window.configManager?.language;
            const sectionName = card.querySelector('.section-title')?.textContent?.trim() || panelId;
            const namedKey = 'config.generalPanelMobileHiddenNamed';
            const namedTpl = lang?.t(namedKey);
            const msg = namedTpl && namedTpl !== namedKey
                ? namedTpl.replace('{name}', sectionName)
                : (lang?.t('config.generalPanelMobileHidden')
                    || 'This section is only available on a wider screen.');
            ui?.showNotification?.(msg, 'info');
            return;
        }

        if (switchLayer && this.hasLayerPreference()) {
            const tier = card.dataset.configTier || 'advanced';
            if (this.layer !== 'all' && tier !== this.layer) {
                this.applyLayer(tier, { updateHash: false, scrollPanel: panelId });
                return;
            }
        }

        if (panelId !== 'reset') {
            card.classList.remove('is-collapsed');
            const title = card.querySelector('.section-title');
            if (title) {
                title.setAttribute('aria-expanded', 'true');
            }
            window.configManager?._persistGeneralPanelState?.();
            window.configManager?.syncResetPanelGuard?.();
        }
        const tourActive = document.body.hasAttribute('data-config-general-tour-active');
        card.scrollIntoView({ behavior: tourActive ? 'auto' : 'smooth', block: 'start' });
        if (this.layer === 'advanced' || this.layer === 'all') {
            this.setAdvancedNavActive(panelId);
        }
    }

    setupSmartCollectionsMaster() {
        const master = document.getElementById('enable-smart-collections-master');
        if (!master) return;

        const syncMasterFromChildren = () => {
            if (this._smartSyncing) return;
            const anyOn = this.smartCheckboxIds.some((id) => document.getElementById(id)?.checked);
            const allOn = this.smartCheckboxIds.every((id) => document.getElementById(id)?.checked);
            master.checked = anyOn;
            master.indeterminate = anyOn && !allOn;
            if (master.indeterminate) {
                master.setAttribute('aria-checked', 'mixed');
            } else {
                master.removeAttribute('aria-checked');
            }
            this.syncSmartCollectionsSummaryCount();
        };

        const applyMasterToChildren = (enabled) => {
            this._smartSyncing = true;
            this.smartCheckboxIds.forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.checked = enabled;
            });
            this._smartSyncing = false;
            syncMasterFromChildren();
        };

        master.addEventListener('change', () => {
            applyMasterToChildren(master.checked);
            if (master.checked) {
                const today = document.getElementById('show-smart-today-collection-checkbox');
                if (today && !this.smartCheckboxIds.some((id) => id !== 'show-smart-today-collection-checkbox' && document.getElementById(id)?.checked)) {
                    today.checked = true;
                }
            }
            this.smartCheckboxIds.forEach((id) => {
                document.getElementById(id)?.dispatchEvent(new Event('change', { bubbles: true }));
            });
        });

        this.smartCheckboxIds.forEach((id) => {
            document.getElementById(id)?.addEventListener('change', syncMasterFromChildren);
        });

        syncMasterFromChildren();
        this._syncSmartMasterFromChildren = syncMasterFromChildren;
    }

    setupLayerJumps() {
        if (!this.root || this.root.dataset.layerJumpsBound === '1') return;
        this.root.dataset.layerJumpsBound = '1';

        this.root.querySelectorAll('.general-layer-jump').forEach((btn) => {
            btn.addEventListener('click', () => {
                const panel = btn.getAttribute('data-jump-panel');
                const card = panel ? this.root.querySelector(`[data-general-panel="${panel}"]`) : null;
                if (card?.dataset.mobilePanelHidden === 'true') {
                    const sectionName = card.querySelector('.section-title')?.textContent?.trim() || panel;
                    const lang = window.configManager?.language;
                    const namedKey = 'config.generalPanelMobileHiddenNamed';
                    const namedTpl = lang?.t(namedKey);
                    const msg = namedTpl && namedTpl !== namedKey
                        ? namedTpl.replace('{name}', sectionName)
                        : this.t('generalPanelMobileHidden', 'This section is only available on a wider screen.');
                    window.configManager?.ui?.showNotification?.(msg, 'info');
                    return;
                }
                if (this.layer === 'advanced') {
                    this.scrollToPanel(panel, { switchLayer: false });
                    return;
                }
                this.applyLayer('advanced', { updateHash: true, scrollPanel: panel, persist: true });
                const msg = this.t('generalLayerJumpToast', 'Switched to Advanced');
                window.configManager?.ui?.showNotification?.(msg, 'info');
            });
        });
    }

    syncSmartCollectionsMasterFromChildren() {
        this._syncSmartMasterFromChildren?.();
        this.syncSmartCollectionsSummaryCount();
    }

    setupSmartCollectionLabelPropagation() {
        this.root.querySelectorAll('.smart-collection-toggle').forEach((label) => {
            label.addEventListener('click', (e) => e.stopPropagation());
        });
    }

    setupAdvancedNav() {
        if (!this.advancedNav) return;

        this.advancedNav.querySelectorAll('[data-advanced-nav]').forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const panel = link.getAttribute('data-advanced-nav');
                this.scrollToPanel(panel, { switchLayer: true });
            });
        });

        this.refreshAdvancedNavObserver();
    }

    refreshAdvancedNavObserver() {
        if (!this.advancedNav || !this.root) return;

        if (this._navObserver) {
            this._navObserver.disconnect();
            this._navObserver = null;
        }

        if (this.layer !== 'advanced' && this.layer !== 'all') return;
        if (typeof IntersectionObserver === 'undefined') return;

        const rootMargin = this.layer === 'all'
            ? '-10% 0px -60% 0px'
            : '-20% 0px -55% 0px';

        this._navObserver = new IntersectionObserver((entries) => {
            if (this.layer !== 'advanced' && this.layer !== 'all') return;
            let best = null;
            let bestRatio = 0;
            entries.forEach((entry) => {
                if (!entry.isIntersecting || entry.intersectionRatio <= bestRatio) return;
                bestRatio = entry.intersectionRatio;
                best = entry.target;
            });
            if (!best) return;
            const id = best.getAttribute('data-general-panel');
            this.setAdvancedNavActive(id);
        }, { rootMargin, threshold: [0, 0.1, 0.25, 0.5, 0.75] });

        this.root.querySelectorAll('[data-general-panel]').forEach((panel) => {
            if (panel.hidden) return;
            this._navObserver.observe(panel);
        });
    }

    /** Called from config command palette / search */
    goToLayer(layer, panelId = null) {
        if (window.configManager?.ui) {
            const ui = window.configManager.ui;
            if (ui._currentTab !== 'general') {
                const btn = document.querySelector('.tab-button[data-tab="general"]');
                btn?.click();
            }
        }
        this.applyLayer(layer, { updateHash: true, scrollPanel: panelId, persist: true });
    }
}

window.ConfigGeneralLayers = ConfigGeneralLayers;
