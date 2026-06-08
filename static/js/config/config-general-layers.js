/**
 * General tab: Essentials / Advanced / Show all layers
 */
class ConfigGeneralLayers {
    constructor() {
        this.storageKey = 'nextdash-config-general-layer';
        this.root = null;
        this.toolbar = null;
        this.advancedNav = null;
        this.layer = 'essentials';
        this._navObserver = null;
        this._smartSyncing = false;

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
        if (!this.root || !this.toolbar) return;

        this.restructurePanels();
        this.setupLayerSwitcher();
        this.setupSmartCollectionsMaster();
        this.setupSmartCollectionLabelPropagation();
        this.setupAdvancedNav();
        this.refreshCheckboxTreeSymbols();
        this.applyLayer(this.getStoredLayer(), { updateHash: false });
        this.applyHash(window.location.hash);
        window.addEventListener('hashchange', () => this.applyHash(window.location.hash));
        if (window.MobileExperience?.isMobileLayout?.()) {
            window.MobileExperience.applyConfigGeneralPanels(this);
        }
    }

    restructurePanels() {
        if (this.root.dataset.layersReady === '1') return;

        this.splitBasicsPanel();
        this.createBookmarksEssentialsPanel();
        this.createSmartCollectionsSummary();
        this.createStatusEssentialsSummary();
        this.splitAdvancedGeneralPanel();
        this.assignPanelTiers();
        this.reorderPanels();
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
        `;

        const sortGroup = display.querySelector('#sort-method-select')?.closest('.form-group');
        if (sortGroup) essentials.appendChild(sortGroup);

        const iconsItem = display.querySelector('#show-icons-checkbox')?.closest('.checkbox-tree-item');
        if (iconsItem) essentials.appendChild(iconsItem);

        ['new-tab-checkbox', 'paste-url-quick-add-checkbox', 'hide-empty-categories-checkbox', 'show-page-tabs-checkbox'].forEach((id) => {
            const item = display.querySelector(`#${id}`)?.closest('.checkbox-tree-item');
            if (item) essentials.appendChild(item);
        });
        const pageNamesItem = display.querySelector('#show-page-names-in-tabs-checkbox')?.closest('.checkbox-tree-item');
        if (pageNamesItem) essentials.appendChild(pageNamesItem);

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
                            <a href="#bookmarks" class="btn btn-secondary btn-small" data-i18n="config.manageBookmarkStatusChecks">Bookmark checks →</a>
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
            bookmarks: 'advanced',
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
                this.applyLayer(layer, { updateHash: true });
            });
        });

        const showAllLink = document.getElementById('general-layer-show-all');
        if (showAllLink) {
            showAllLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.applyLayer('all', { updateHash: true });
            });
        }
    }

    getStoredLayer() {
        try {
            const v = localStorage.getItem(this.storageKey);
            if (v === 'essentials' || v === 'advanced' || v === 'all') return v;
        } catch { /* ignore */ }
        return 'essentials';
    }

    applyLayer(layer, { updateHash = true, scrollPanel = null } = {}) {
        if (!this.root) {
            this.root = document.querySelector('.general-layout');
            this.toolbar = this.toolbar || document.getElementById('general-layer-toolbar');
            this.advancedNav = this.advancedNav || document.getElementById('general-advanced-nav');
        }
        if (!this.root) return;

        this.layer = layer === 'advanced' || layer === 'all' ? layer : 'essentials';
        try {
            localStorage.setItem(this.storageKey, this.layer);
        } catch { /* ignore */ }

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
        if (introEss) introEss.hidden = this.layer !== 'essentials';
        if (introAdv) introAdv.hidden = this.layer !== 'advanced';

        if (this.advancedNav) {
            this.advancedNav.hidden = this.layer !== 'advanced';
        }

        this.toolbar.querySelectorAll('[data-general-layer]').forEach((btn) => {
            const active = btn.getAttribute('data-general-layer') === this.layer;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        const showAllLink = document.getElementById('general-layer-show-all');
        if (showAllLink) showAllLink.classList.toggle('is-active', this.layer === 'all');

        if (updateHash) {
            const panelPart = scrollPanel ? `/${scrollPanel}` : '';
            const hash = this.layer === 'essentials' ? `#general${panelPart}` : `#general/${this.layer}${panelPart}`;
            if (window.location.hash !== hash) {
                window.history.replaceState(null, '', hash);
            }
        }

        if (scrollPanel) {
            this.scrollToPanel(scrollPanel, { switchLayer: true });
        }

        window.configManager?.ui?.updateBreadcrumb?.(
            'general',
            this.getBreadcrumbSubsection()
        );
        window.configManager?.ui?.initBreadcrumbObserver?.('general');
        window.ConfigSettingsSearch?.refreshIndex?.();
    }

    getBreadcrumbSubsection() {
        if (this.layer === 'essentials') return this.t('generalLayerEssentials', 'Essentials');
        if (this.layer === 'advanced') return this.t('generalLayerAdvanced', 'Advanced');
        return this.t('generalLayerAll', 'All sections');
    }

    applyHash(hash) {
        const raw = (hash || '').replace(/^#/, '');
        if (!raw.startsWith('general')) return;

        const rest = raw.slice('general'.length).replace(/^\//, '');
        const parts = rest ? rest.split('/') : [];
        let layer = 'essentials';
        let panel = null;

        if (parts[0] === 'advanced' || parts[0] === 'all') {
            layer = parts[0];
            panel = parts[1] || null;
        } else if (parts[0]) {
            panel = parts[0];
        }

        this.applyLayer(layer, { updateHash: false, scrollPanel: panel });
    }

    scrollToPanel(panelId, { switchLayer = false } = {}) {
        if (!this.root) return;
        const card = this.root.querySelector(`[data-general-panel="${panelId}"]`);
        if (!card) return;

        if (switchLayer) {
            const tier = card.dataset.configTier || 'advanced';
            if (this.layer !== 'all' && tier !== this.layer) {
                this.applyLayer(tier, { updateHash: false });
            }
        }

        card.classList.remove('is-collapsed');
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    setupSmartCollectionsMaster() {
        const master = document.getElementById('enable-smart-collections-master');
        if (!master) return;

        const syncMasterFromChildren = () => {
            if (this._smartSyncing) return;
            const anyOn = this.smartCheckboxIds.some((id) => document.getElementById(id)?.checked);
            master.checked = anyOn;
            master.indeterminate = anyOn && !this.smartCheckboxIds.every((id) => document.getElementById(id)?.checked);
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
        });

        this.smartCheckboxIds.forEach((id) => {
            document.getElementById(id)?.addEventListener('change', syncMasterFromChildren);
        });

        syncMasterFromChildren();

        this.root.querySelectorAll('.general-layer-jump').forEach((btn) => {
            btn.addEventListener('click', () => {
                const panel = btn.getAttribute('data-jump-panel');
                this.applyLayer('advanced', { updateHash: true, scrollPanel: panel });
            });
        });
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

        if (typeof IntersectionObserver === 'undefined') return;

        if (this._navObserver) this._navObserver.disconnect();

        this._navObserver = new IntersectionObserver((entries) => {
            if (this.layer !== 'advanced') return;
            let best = null;
            let bestRatio = 0;
            entries.forEach((entry) => {
                if (entry.intersectionRatio > bestRatio) {
                    bestRatio = entry.intersectionRatio;
                    best = entry.target;
                }
            });
            if (!best) return;
            const id = best.getAttribute('data-general-panel');
            this.advancedNav.querySelectorAll('[data-advanced-nav]').forEach((link) => {
                link.classList.toggle('is-active', link.getAttribute('data-advanced-nav') === id);
            });
        }, { rootMargin: '-20% 0px -55% 0px', threshold: [0, 0.1, 0.25, 0.5] });

        this.root.querySelectorAll('[data-config-tier="advanced"][data-general-panel]').forEach((panel) => {
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
        this.applyLayer(layer, { updateHash: true, scrollPanel: panelId });
    }
}

window.ConfigGeneralLayers = ConfigGeneralLayers;
