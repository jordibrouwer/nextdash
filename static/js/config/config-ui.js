/**
 * UI Helper Functions
 * Handles tabs, number inputs, and notifications
 */

const CONFIG_GENERAL_HASH_KEY = 'nextdash:config-general-hash';

class ConfigUI {
    constructor() {
        this.notificationTimeout = null;
        this._breadcrumbObserver = null;
        this._currentTab = 'general';
        this.initTabs();
        this.initNumberInputControls();
    }

    _saveGeneralHash(hash) {
        if (!/^#general(\/|$)/.test(hash || '')) return;
        try {
            sessionStorage.setItem(CONFIG_GENERAL_HASH_KEY, hash);
        } catch { /* ignore */ }
    }

    _restoreGeneralHash() {
        try {
            const layerKey = 'nextdash-config-general-layer';
            const storedLayer = localStorage.getItem(layerKey);
            const hasLayerPreference = storedLayer === 'essentials'
                || storedLayer === 'advanced'
                || storedLayer === 'all';
            if (!hasLayerPreference) {
                return '#general';
            }
            const saved = sessionStorage.getItem(CONFIG_GENERAL_HASH_KEY);
            if (saved && /^#general(\/|$)/.test(saved)) return saved;
        } catch { /* ignore */ }
        return '#general';
    }

    _colorsTabHash() {
        const sub = (() => {
            try { return sessionStorage.getItem('nextdash:colors-subtab') || 'custom'; } catch (_) { return 'custom'; }
        })();
        return sub === 'custom' ? '#colors' : `#colors/${sub}`;
    }

    /**
     * Initialize tab switching functionality
     */
    initTabs() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabContents = document.querySelectorAll('.tab-content');
        const tabsContainer = document.querySelector('.config-controls-wrapper .tabs');

        if (tabsContainer) {
            tabsContainer.setAttribute('role', 'tablist');
        }

        tabButtons.forEach((button) => {
            const targetTab = button.getAttribute('data-tab');
            if (!targetTab) return;
            button.setAttribute('role', 'tab');
            button.setAttribute('type', 'button');
            const panelId = `config-tab-panel-${targetTab}`;
            const targetContent = document.querySelector(`[data-tab-content="${targetTab}"]`);
            if (targetContent) {
                targetContent.id = panelId;
                targetContent.setAttribute('role', 'tabpanel');
                button.setAttribute('aria-controls', panelId);
            }
        });

        // Function to switch to a specific tab
        const switchToTab = async (targetTab) => {
            const previousTab = this._currentTab;
            if (previousTab === 'categories' && targetTab !== 'categories') {
                const allowed = await window.configManager?.guardCategoriesTabLeave?.(targetTab);
                if (allowed === false) {
                    return false;
                }
            }
            if (previousTab === 'colors' && targetTab !== 'colors') {
                window.configManager?.colorsEditor?.clearPreviewStyle?.();
            }
            tabButtons.forEach(btn => {
                btn.classList.remove('active');
                btn.setAttribute('aria-selected', 'false');
            });
            tabContents.forEach(content => content.classList.remove('active'));

            // Add active class to target button and corresponding content
            const targetButton = document.querySelector(`.tab-button[data-tab="${targetTab}"]`);
            const targetContent = document.querySelector(`[data-tab-content="${targetTab}"]`);
            if (targetButton) {
                targetButton.classList.add('active');
                targetButton.setAttribute('aria-selected', 'true');
                this._scrollTabIntoView(targetButton);
            }
            if (targetContent) {
                targetContent.classList.add('active');
            }

            this._currentTab = targetTab;
            const generalSub = targetTab === 'general' && window.configManager?.generalLayers
                ? window.configManager.generalLayers.getBreadcrumbSubsection()
                : null;
            this.updateBreadcrumb(targetTab, generalSub);
            this.initBreadcrumbObserver(targetTab);

            // Update URL hash (preserve general layer subpaths across tab switches)
            if (targetTab === 'colors') {
                const sub = (() => {
                    try { return sessionStorage.getItem('nextdash:colors-subtab') || 'custom'; } catch (_) { return 'custom'; }
                })();
                window.location.hash = sub === 'custom' ? '#colors' : `#colors/${sub}`;
            } else if (targetTab === 'general') {
                if (!/^#general(\/|$)/.test(window.location.hash)) {
                    const restored = this._restoreGeneralHash();
                    window.location.hash = restored;
                    window.configManager?.generalLayers?.applyHash?.(restored);
                }
            } else {
                if (previousTab === 'general' && /^#general(\/|$)/.test(window.location.hash)) {
                    this._saveGeneralHash(window.location.hash);
                }
                window.location.hash = `#${targetTab}`;
            }
            
            // Keep the selected page when switching tabs; only refresh custom-select chrome.
            // (Previously this reset to pagesData[0] whenever value !== first page, which
            // forced page 1 and saved new bookmarks to the wrong file.)
            const mgr = window.configManager;
            if (mgr) {
                if (targetTab === 'bookmarks' || targetTab === 'categories') {
                    mgr.refreshCustomSelects();
                    mgr.refreshPageDropdowns();
                } else if (targetTab === 'pages') {
                    mgr.renderPagesTab();
                    if (mgr._configPagesTourActive || mgr._configPagesTourStarting) {
                        // keep tour running; list refresh only
                    } else if (typeof mgr.onConfigPagesTabOpened === 'function') {
                        void mgr.onConfigPagesTabOpened();
                    }
                }
                if (targetTab === 'categories') {
                    if (typeof mgr.onConfigCategoriesTabOpened === 'function') {
                        void mgr.onConfigCategoriesTabOpened();
                    } else {
                        void mgr.syncCategoriesTabToCurrentPage?.();
                    }
                } else if (targetTab === 'stats' && mgr.stats) {
                    mgr.stats.refresh(mgr);
                    window.ConfigSettingsSearch?.refreshIndex?.();
                } else if (targetTab === 'keyboard' && mgr.keyboard) {
                    mgr.keyboard.refresh(mgr);
                    window.ConfigSettingsSearch?.refreshIndex?.();
                } else if (targetTab === 'tags') {
                    if (mgr._configTagsTourActive || mgr._configTagsTourStarting) {
                        mgr.tags?.refresh(mgr);
                    } else if (typeof mgr.onConfigTagsTabOpened === 'function') {
                        void mgr.onConfigTagsTabOpened();
                    } else {
                        void mgr.reloadTagsTabData?.();
                    }
                } else if (targetTab === 'collections' && mgr.collections) {
                    if (!mgr._configCollectionsTourActive && !mgr._configCollectionsTourStarting) {
                        mgr.collections.refresh(mgr);
                    }
                    if (
                        !mgr._configCollectionsTourActive &&
                        !mgr._configCollectionsTourStarting &&
                        typeof mgr.onConfigCollectionsTabOpened === 'function'
                    ) {
                        void mgr.onConfigCollectionsTabOpened();
                    }
                } else if (targetTab === 'colors') {
                    void mgr.ensureColorsEditor?.().then(() => {
                        mgr.colorsEditor?.applyReadonlyMode?.();
                        mgr.colorsEditor?.reloadIfStale?.();
                        window.ConfigSettingsSearch?.refreshIndex?.();
                    });
                    if (
                        !mgr._configThemeTourActive &&
                        !mgr._configThemeTourStarting &&
                        typeof mgr.onConfigColorsTabOpened === 'function'
                    ) {
                        void mgr.onConfigColorsTabOpened();
                    }
                }
                if (
                    targetTab === 'general' &&
                    !mgr._configGeneralTourActive &&
                    !mgr._configGeneralTourStarting &&
                    !mgr._configThemeTourActive &&
                    !mgr._configThemeTourStarting
                ) {
                    mgr.scheduleConfigGeneralTour?.();
                    window.ConfigSettingsSearch?.schedulePromoWhenIdle?.();
                }
                if (
                    targetTab === 'colors' &&
                    !mgr._configThemeTourActive &&
                    !mgr._configThemeTourStarting
                ) {
                    mgr.scheduleConfigThemeTour?.();
                }
                if (
                    targetTab === 'bookmarks' &&
                    !mgr._configBookmarksTourActive &&
                    !mgr._configBookmarksTourStarting &&
                    !mgr._configTagsTourActive &&
                    !mgr._configTagsTourStarting &&
                    !mgr._configPagesTourActive &&
                    !mgr._configPagesTourStarting &&
                    !mgr._configCollectionsTourActive &&
                    !mgr._configCollectionsTourStarting
                ) {
                    mgr.scheduleConfigBookmarksTour?.();
                }
                if (targetTab === 'finders') {
                    if (mgr._configFindersTourActive || mgr._configFindersTourStarting) {
                        mgr.finders?.refresh(mgr);
                    } else if (typeof mgr.onConfigFindersTabOpened === 'function') {
                        void mgr.onConfigFindersTabOpened();
                    } else {
                        void mgr.reloadFindersTabData?.();
                    }
                }
                if (
                    targetTab === 'stats' &&
                    !mgr._configStatsTourActive &&
                    !mgr._configStatsTourStarting
                ) {
                    mgr.scheduleConfigStatsTour?.();
                }
            }
            return true;
        };

    const validTabs = ['general', 'colors', 'pages', 'categories', 'tags', 'bookmarks', 'finders', 'collections', 'backups', 'keyboard', 'stats', 'help'];

    const getAllowedTabs = () => {
        if (window.MobileExperience?.isPhoneLayout?.()) {
            return window.MobileExperience.MOBILE_CONFIG_TABS;
        }
        return validTabs;
    };

    const resolveTabFromHash = (hashRaw) => {
        const hash = (hashRaw || '').replace(/^#/, '');
        const allowed = getAllowedTabs();
        if (allowed.includes(hash)) return hash;
        if (hash.startsWith('colors') && allowed.includes('colors')) return 'colors';
        if (hash.startsWith('general') && allowed.includes('general')) return 'general';
        if (window.MobileExperience?.isPhoneLayout?.() && allowed.includes('general')) return 'general';
        if (validTabs.includes(hash)) return null;
        if (hash.startsWith('colors')) return allowed.includes('colors') ? 'colors' : (allowed[0] || 'general');
        if (hash.startsWith('general')) return allowed.includes('general') ? 'general' : (allowed[0] || 'general');
        return null;
    };

    // Check initial hash and switch to corresponding tab
    const initialHash = window.location.hash.substring(1);
    const initialTab = resolveTabFromHash(initialHash);
    switchToTab(initialTab || 'general');
    if (initialTab === 'general' && window.configManager?.generalLayers) {
        window.configManager.generalLayers.applyHash(window.location.hash);
    }
    if (initialTab === 'colors') {
        window.configManager?.ensureColorsEditor?.();
    }

    window.addEventListener('hashchange', async () => {
        const hash = window.location.hash.substring(1);
        const tab = resolveTabFromHash(hash);
        if (tab) {
            if (tab !== this._currentTab) {
                if (typeof configManager?.guardColorsTabLeave === 'function') {
                    const allowed = await configManager.guardColorsTabLeave(tab);
                    if (!allowed) {
                        history.replaceState(null, '', this._colorsTabHash());
                        return;
                    }
                }
                const switched = await switchToTab(tab);
                if (!switched) {
                    history.replaceState(null, '', `#${this._currentTab}`);
                    return;
                }
            }
            if (tab === 'general' && window.configManager?.generalLayers) {
                window.configManager.generalLayers.applyHash(window.location.hash);
                window.ConfigSettingsSearch?.schedulePromoWhenIdle?.();
            }
            if (tab === 'colors' && window.configManager?.colorsEditor) {
                const subMatch = hash.match(/^colors(?:\/(dark|light|custom|builtin))?$/);
                const sub = subMatch?.[1] || 'custom';
                window.configManager.colorsEditor.switchSubTab(sub, { updateHash: false });
            }
        }
    });

        tabButtons.forEach(button => {
            button.addEventListener('click', async () => {
                if (window.ConfigTourRuntime?.hasActiveConfigTour?.()) {
                    return;
                }
                const targetTab = button.getAttribute('data-tab');
                if (!getAllowedTabs().includes(targetTab)) return;
                if (targetTab === this._currentTab) return;
                if (typeof configManager?.guardColorsTabLeave === 'function') {
                    const allowed = await configManager.guardColorsTabLeave(targetTab);
                    if (!allowed) return;
                }
                const switched = await switchToTab(targetTab);
                if (!switched) return;
                this._scrollTabIntoView(button);
            });
        });

        this.switchToTab = switchToTab;

        const configTabKeyAllowed = () => {
            if (window.ConfigTourRuntime?.shouldBlockConfigShortcuts?.()) {
                return false;
            }
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
            if (document.activeElement?.isContentEditable) return false;
            if (document.querySelector('#app-modal .modal.show')) return false;
            return true;
        };

        const getVisibleTabButtons = () => Array.from(document.querySelectorAll('.tab-button:not([hidden])'))
            .filter((btn) => {
                const tab = btn.getAttribute('data-tab');
                return tab && getAllowedTabs().includes(tab);
            });

        // 1–9: jump to the Nth visible tab (no modifiers, no form focus, no modal open)
        document.addEventListener('keydown', (e) => {
            if (e.key < '1' || e.key > '9') return;
            if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            if (!configTabKeyAllowed()) return;
            const visible = getVisibleTabButtons();
            const btn = visible[parseInt(e.key, 10) - 1];
            if (!btn) return;
            e.preventDefault();
            btn.click();
        });

        // ←/→: previous / next visible tab (same guards as 1–9)
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            if (!configTabKeyAllowed()) return;
            const visible = getVisibleTabButtons();
            if (visible.length < 2) return;
            const currentIdx = visible.findIndex((btn) => btn.getAttribute('data-tab') === this._currentTab);
            let nextIdx;
            if (currentIdx < 0) {
                nextIdx = e.key === 'ArrowRight' ? 0 : visible.length - 1;
            } else if (e.key === 'ArrowRight') {
                nextIdx = (currentIdx + 1) % visible.length;
            } else {
                nextIdx = (currentIdx - 1 + visible.length) % visible.length;
            }
            e.preventDefault();
            visible[nextIdx].click();
        });

        // Fade mask: toggle is-scrolled-end on wrapper when tabs are fully scrolled
        const tabBar = document.querySelector('.config-controls-wrapper .tabs');
        const tabWrapper = document.querySelector('.tabs-scroll-wrapper');
        if (tabBar && tabWrapper) {
            const updateMask = () => {
                const atEnd = tabBar.scrollLeft + tabBar.clientWidth >= tabBar.scrollWidth - 2;
                tabWrapper.classList.toggle('is-scrolled-end', atEnd);
            };
            tabBar.addEventListener('scroll', updateMask, { passive: true });
            window.addEventListener('resize', updateMask, { passive: true });
            requestAnimationFrame(updateMask);
        }
    }

    _scrollTabIntoView(button) {
        if (!button) return;
        const tabBar = button.closest('.tabs');
        if (!tabBar) return;
        const btnLeft = button.offsetLeft;
        const btnRight = btnLeft + button.offsetWidth;
        const barLeft = tabBar.scrollLeft;
        const barRight = barLeft + tabBar.clientWidth;
        if (btnLeft < barLeft) {
            tabBar.scrollTo({ left: btnLeft - 8, behavior: 'smooth' });
        } else if (btnRight > barRight) {
            tabBar.scrollTo({ left: btnRight - tabBar.clientWidth + 8, behavior: 'smooth' });
        }
    }

    /**
     * Initialize number input controls (up/down buttons)
     */
    initNumberInputControls() {
        const upButtons = document.querySelectorAll('.number-input-up');
        const downButtons = document.querySelectorAll('.number-input-down');

        upButtons.forEach(button => {
            button.addEventListener('click', () => {
                const inputId = button.getAttribute('data-input');
                const input = document.getElementById(inputId);
                if (input) {
                    const currentValue = parseInt(input.value) || 0;
                    const max = parseInt(input.max) || Infinity;
                    if (currentValue < max) {
                        input.value = currentValue + 1;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            });
        });

        downButtons.forEach(button => {
            button.addEventListener('click', () => {
                const inputId = button.getAttribute('data-input');
                const input = document.getElementById(inputId);
                if (input) {
                    const currentValue = parseInt(input.value) || 0;
                    const min = parseInt(input.min) || -Infinity;
                    if (currentValue > min) {
                        input.value = currentValue - 1;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            });
        });
    }

    /**
     * Show notification message
     * @param {string} message - The message to display
     * @param {string} type - Type of notification ('success' or 'error')
     */
    showNotification(message, type = 'success', options = {}) {
        if (!window.AppNotification) return;
        window.AppNotification.show(message, type, options);
    }

    hideNotification() {
        window.AppNotification?.hide();
    }

    replaceNotification(message, type = 'success', options = {}) {
        if (window.AppNotification?.replace) {
            window.AppNotification.replace(message, type, options);
            return;
        }
        this.hideNotification();
        this.showNotification(message, type, options);
    }

    showErrorWithReload(message, options = {}) {
        if (window.AppNotification?.showErrorWithReload) {
            window.AppNotification.showErrorWithReload(message, options);
            return;
        }
        this.showNotification(message, 'error', options);
    }

    updateBreadcrumb(tab, subsection, panelTitle) {
        const el = document.getElementById('config-breadcrumb');
        if (!el) return;
        const sep = `<span class="config-breadcrumb-sep">/</span>`;
        const tabLabel = this._breadcrumbTabLabel(tab);
        let html = `config${sep}${tabLabel}`;
        if (tab === 'colors') {
            const sub = (() => {
                try { return sessionStorage.getItem('nextdash:colors-subtab') || 'custom'; } catch (_) { return 'custom'; }
            })();
            if (sub && sub !== 'custom') {
                const subLabel = window.configManager?.language?.t(
                    sub === 'dark' ? 'dashboard.darkTheme' : 'dashboard.lightTheme'
                ) || sub;
                html += `${sep}<span class="config-breadcrumb-sub">${subLabel}</span>`;
            }
        } else if (subsection) {
            html += `${sep}<span class="config-breadcrumb-sub">${subsection}</span>`;
        }
        if (panelTitle) {
            html += `${sep}<span class="config-breadcrumb-sub">${panelTitle}</span>`;
        }
        el.innerHTML = html;
    }

    _breadcrumbTabLabel(tab) {
        const lang = window.configManager?.language;
        const keys = {
            general: 'config.generalTab',
            colors: 'config.colorsTab',
            pages: 'config.pagesTab',
            categories: 'config.categoriesTab',
            tags: 'config.tagsTab',
            bookmarks: 'config.bookmarksTab',
            finders: 'config.findersTab',
            collections: 'config.collectionsTab',
            backups: 'config.backupsTab',
            keyboard: 'config.keyboardTab',
            stats: 'config.statsTab',
            help: 'config.aboutTab'
        };
        const key = keys[tab];
        if (key && lang?.t) {
            const label = lang.t(key);
            if (label && label !== key) return label;
        }
        return tab;
    }

    initBreadcrumbObserver(tab) {
        if (this._breadcrumbObserver) {
            this._breadcrumbObserver.disconnect();
            this._breadcrumbObserver = null;
        }
        if (tab !== 'general') return;

        const layerMode = document.querySelector('[data-tab-content="general"] > div')?.dataset?.generalLayer || 'essentials';
        const panels = [...document.querySelectorAll('[data-general-panel]')].filter((p) => {
            if (layerMode === 'all') return true;
            return (p.dataset.configTier || 'advanced') === layerMode && !p.hidden;
        });
        if (!panels.length || typeof IntersectionObserver === 'undefined') return;

        const visibleRatios = new Map();

        this._breadcrumbObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                visibleRatios.set(entry.target, entry.intersectionRatio);
            });

            let topPanel = null;
            let topRatio = 0;
            visibleRatios.forEach((ratio, el) => {
                if (ratio > topRatio) {
                    topRatio = ratio;
                    topPanel = el;
                }
            });

            const panelTitle = topPanel
                ? (topPanel.querySelector('.section-title') || {}).textContent || null
                : null;
            const layerSub = window.configManager?.generalLayers?.getBreadcrumbSubsection?.() || null;

            if (this._currentTab === 'general') {
                this.updateBreadcrumb('general', layerSub, panelTitle);
            }
        }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0] });

        panels.forEach(p => this._breadcrumbObserver.observe(p));
    }

    /**
     * Update status options visibility based on showStatus setting
     * @param {boolean} showStatus - Whether status is enabled
     */
    updateStatusOptionsVisibility(showStatus) {
        if (window.configManager?.settings?.updateStatusOptionsVisibility) {
            window.configManager.settings.updateStatusOptionsVisibility(showStatus);
        }
    }
}

// Export for use in other modules
window.ConfigUI = ConfigUI;
