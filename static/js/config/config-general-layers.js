/**
 * General tab: Essentials / Advanced / Show all layers
 */
class ConfigGeneralLayers {
    constructor() {
        this.root = null;
        this.toolbar = null;
        this.layer = 'essentials';
        this._syncSmartMasterFromChildren = null;
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
        if (!this.root || !this.toolbar) return;

        this.wireThemeColorsLink();
        if (!this._handlersWired) {
            this.setupLayerSwitcher();
            this.setupExpandCollapseAll();
            this.setupLayerJumps();
            this.setupSmartCollectionsMaster();
            this.setupSmartCollectionLabelPropagation();
            this.setupNavClicks();
            this._handlersWired = true;
        }
        this.refreshCheckboxTreeSymbols();
        this.wireStatusEssentialsLinks();
        this.initScrollspy();
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

    // ── Sections index / chip nav (shell: .config-split-layout, same pattern as Stats/Help) ──

    setupNavClicks() {
        if (!this.root || this.root.dataset.navClicksBound === '1') return;
        this.root.dataset.navClicksBound = '1';
        const handler = (e) => {
            const a = e.target.closest('a[data-nav-panel]');
            if (!a) return;
            e.preventDefault();
            const panelId = a.getAttribute('data-nav-panel');
            const card = this.root.querySelector(`[data-general-panel="${panelId}"]`);
            const isOpen = Boolean(card)
                && !card.hidden
                && card.dataset.mobilePanelHidden !== 'true'
                && !card.classList.contains('is-collapsed');
            if (isOpen && this.isPanelInViewport(card)) {
                this.collapsePanel(panelId);
                return;
            }
            this.collapseOtherPanels(panelId);
            this.scrollToPanel(panelId, { switchLayer: true });
        };
        document.querySelector('.general-index')?.addEventListener('click', handler);
        document.getElementById('general-chip-nav')?.addEventListener('click', handler);
    }

    /**
     * Whether a section's heading is genuinely visible near the top of the viewport (vs. open
     * but scrolled mostly or fully out of view, where a silent collapse would look like nothing happened).
     */
    isPanelInViewport(card) {
        const rect = card.getBoundingClientRect();
        const vh = window.innerHeight || document.documentElement.clientHeight;
        return rect.top > -40 && rect.top < vh * 0.6;
    }

    /** Click a quick link a second time while its section is open and in view: collapse it again. */
    collapsePanel(panelId) {
        const card = this.root?.querySelector(`[data-general-panel="${panelId}"]`);
        if (!card) return;
        card.classList.add('is-collapsed');
        const title = card.querySelector('.section-title');
        if (title) title.setAttribute('aria-expanded', 'false');
        window.configManager?._persistGeneralPanelState?.();
        window.configManager?.syncResetPanelGuard?.();
        this.syncActiveNavFromOpenPanel();
    }

    /**
     * Highlight the nav link for whichever section is currently open (accordion guarantees at
     * most one). Called right after any accordion state change instead of relying solely on the
     * scrollspy IntersectionObserver, which may not re-fire when the open section was already
     * inside its trigger zone before the change (e.g. no real scroll distance to cross).
     */
    syncActiveNavFromOpenPanel() {
        const open = this.root?.querySelector(
            '.general-content .general-card[data-general-panel]:not([hidden]):not(.is-collapsed)'
        );
        this.setActiveNavSection(open ? open.getAttribute('data-general-panel') : null);
    }

    /** Navigating to a section via a quick link: collapse every other open section first (accordion). */
    collapseOtherPanels(exceptPanelId) {
        if (!this.root) return;
        this.root.querySelectorAll('.general-card[data-general-panel]').forEach((card) => {
            const panelId = card.getAttribute('data-general-panel');
            if (panelId === exceptPanelId || panelId === 'reset') return;
            if (card.hidden || card.classList.contains('is-collapsed')) return;
            card.classList.add('is-collapsed');
            const title = card.querySelector('.section-title');
            if (title) title.setAttribute('aria-expanded', 'false');
        });
        window.configManager?._persistGeneralPanelState?.();
        window.configManager?.syncResetPanelGuard?.();
    }

    buildChipNav() {
        const host = document.getElementById('general-chip-nav');
        const indexLinks = document.querySelectorAll('.general-index-list a');
        if (!host || !indexLinks.length) return;
        host.textContent = '';
        indexLinks.forEach((link) => {
            const panelId = link.getAttribute('data-nav-panel');
            const li = link.closest('li');
            const card = panelId ? this.root?.querySelector(`[data-general-panel="${panelId}"]`) : null;
            const visible = Boolean(card) && !card.hidden && card.dataset.mobilePanelHidden !== 'true';
            if (li) li.hidden = !visible;
            if (!visible) return;
            const a = document.createElement('a');
            a.href = link.getAttribute('href') || '#';
            a.textContent = link.textContent;
            a.className = link.classList.contains('general-index-danger-link')
                ? 'general-chip general-index-danger-link'
                : 'general-chip';
            a.dataset.navPanel = panelId || '';
            if (link.classList.contains('is-active')) a.classList.add('is-active');
            host.appendChild(a);
        });
    }

    setActiveNavSection(panelId) {
        document.querySelectorAll('.general-index-list a, #general-chip-nav a').forEach((a) => {
            a.classList.toggle('is-active', a.getAttribute('data-nav-panel') === panelId);
        });
    }

    initScrollspy() {
        if (this._scrollspyObs) {
            this._scrollspyObs.disconnect();
            this._scrollspyObs = null;
        }

        this.buildChipNav();

        const sections = this.root?.querySelectorAll('.general-content .general-card[id]:not([hidden])');
        const links = document.querySelectorAll('.general-index-list a, #general-chip-nav a');
        if (!sections?.length || !links.length || !('IntersectionObserver' in window)) return;

        const obs = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    this.setActiveNavSection(entry.target.getAttribute('data-general-panel'));
                }
            });
        }, { rootMargin: '-10% 0px -70% 0px', threshold: 0 });

        sections.forEach((s) => obs.observe(s));
        this._scrollspyObs = obs;
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

    syncSmartCollectionsSummaryCount() {
        const el = document.getElementById('smart-collections-enabled-summary');
        if (!el) return;
        const total = this.smartCheckboxIds.length;
        const on = this.smartCheckboxIds.filter((id) => document.getElementById(id)?.checked).length;
        const tpl = this.t('smartCollectionsEnabledCount', '{count} of {total} enabled');
        el.textContent = tpl.replace('{count}', String(on)).replace('{total}', String(total));
        el.hidden = total === 0;
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

    setupLayerSwitcher() {
        const buttons = this.toolbar.querySelectorAll('[data-general-layer]');
        buttons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const layer = btn.getAttribute('data-general-layer');
                this.applyLayer(layer, { updateHash: true, persist: true });
            });
        });

        this.setupLayerToolbarA11y(buttons);
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

    setupLayerToolbarA11y(layerButtons) {
        const focusables = Array.from(layerButtons);

        const syncTabIndex = (activeEl) => {
            focusables.forEach((el) => {
                el.setAttribute('tabindex', el === activeEl ? '0' : '-1');
            });
        };

        this._toolbarFocusables = focusables;
        this.syncToolbarTabIndex = syncTabIndex;

        const initial = focusables.find((btn) => btn.classList.contains('is-active')) || focusables[0];
        if (initial) syncTabIndex(initial);

        layerButtons.forEach((btn) => {
            btn.addEventListener('click', () => syncTabIndex(btn));
        });

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

    /**
     * The chosen layer lives in settings.json (configGeneralLayer) rather than
     * localStorage, so it follows the user across browsers like every other
     * preference. An empty value means "never chosen" — that is what makes the
     * first ever visit land on Essentials.
     */
    static isValidLayer(v) {
        return v === 'essentials' || v === 'advanced' || v === 'all';
    }

    hasLayerPreference() {
        return ConfigGeneralLayers.isValidLayer(window.configManager?.settingsData?.configGeneralLayer);
    }

    getStoredLayer() {
        const v = window.configManager?.settingsData?.configGeneralLayer;
        return ConfigGeneralLayers.isValidLayer(v) ? v : 'essentials';
    }

    persistLayerPreference(layer) {
        const normalized = ConfigGeneralLayers.isValidLayer(layer) && layer !== 'essentials'
            ? layer
            : 'essentials';
        const mgr = window.configManager;
        if (!mgr?.settingsData) return;
        if (mgr.settingsData.configGeneralLayer === normalized) return;
        mgr.settingsData.configGeneralLayer = normalized;
        // Switching layers is navigation, not an edit, so save straight away
        // instead of marking the form dirty.
        mgr.settings?.saveSettingsToServer?.(mgr.settingsData);
    }

    isMobileGeneralLocked() {
        return Boolean(
            window.MobileExperience?.isPhoneLayout?.()
            && document.getElementById('general-layer-toolbar')?.hidden
        );
    }

    scheduleLayerSideEffects({ layerChanged = false } = {}) {
        if (layerChanged || this._lastObservedLayer !== this.layer) {
            this._lastObservedLayer = this.layer;
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
        }
        if (!this.root) return;

        if (this.isMobileGeneralLocked()) {
            if (scrollPanel) {
                this.scrollToPanel(scrollPanel, { switchLayer: false });
            }
            return;
        }

        const prevLayer = this.layer;
        const nextLayer = layer === 'advanced' || layer === 'all' ? layer : 'essentials';
        const preserveScroll = prevLayer !== nextLayer && !scrollPanel;
        const scrollAnchor = preserveScroll
            ? (document.getElementById('general-layer-toolbar') || document.querySelector('.general-tab-surface'))
            : null;
        const anchorTopBefore = scrollAnchor?.getBoundingClientRect().top ?? null;

        this.layer = nextLayer;
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

        const bulkBar = document.getElementById('general-panels-bulk-actions');
        if (bulkBar) bulkBar.hidden = this.layer !== 'all';

        this.toolbar.querySelectorAll('[data-general-layer]').forEach((btn) => {
            const active = btn.getAttribute('data-general-layer') === this.layer;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        const layerBtns = Array.from(this.toolbar.querySelectorAll('[data-general-layer]'));
        const activeToolbarEl = layerBtns.find((b) => b.getAttribute('data-general-layer') === this.layer) || layerBtns[0];
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

        // Restore the saved collapse state first: it runs over every panel, so
        // expanding the deep-linked one before this would immediately be undone.
        window.configManager?.refreshGeneralPanelExpandState?.();

        if (scrollPanel) {
            this.scrollToPanel(scrollPanel, { switchLayer: true });
        }

        if (preserveScroll && scrollAnchor && anchorTopBefore !== null) {
            this.preserveScrollAnchor(scrollAnchor, anchorTopBefore);
        }

        window.configManager?.ui?.updateBreadcrumb?.(
            'general',
            this.getBreadcrumbSubsection()
        );
        this.initScrollspy();
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

        // A layer spelled out in the URL is an explicit request — honour it even
        // when the user has no stored preference yet. Without this, a deep link
        // like #general/advanced/privacy silently lands on Essentials, where the
        // panel it points at is not rendered at all.
        if (!this.hasLayerPreference() && layer === null) {
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
            // Remembered so refreshGeneralPanelExpandState() — which sweeps every
            // panel back to its saved state — leaves this one open.
            this.deepLinkedPanel = panelId;
            const title = card.querySelector('.section-title');
            if (title) {
                title.setAttribute('aria-expanded', 'true');
            }
            window.configManager?._persistGeneralPanelState?.();
            window.configManager?.syncResetPanelGuard?.();
        }
        this.syncActiveNavFromOpenPanel();
        const tourActive = document.body.hasAttribute('data-config-general-tour-active');
        card.scrollIntoView({ behavior: tourActive ? 'auto' : 'smooth', block: 'start' });
    }

    preserveScrollAnchor(anchor, topBefore) {
        const fix = () => {
            const delta = anchor.getBoundingClientRect().top - topBefore;
            if (Math.abs(delta) > 0.5) {
                window.scrollBy({ top: delta, left: 0, behavior: 'auto' });
            }
        };
        fix();
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => requestAnimationFrame(fix));
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
