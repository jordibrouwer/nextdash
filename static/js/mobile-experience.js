/**
 * Mobile / compact layout: simplified dashboard and config on small viewports.
 */
(function () {
    'use strict';

    const MOBILE_FOOTER_BUTTONS = ['search'];
    const MOBILE_CONFIG_TABS = ['general', 'help', 'colors', 'keyboard'];
    /** Hash-deep-link tabs allowed on phone with a blocking card instead of redirecting to General. */
    const MOBILE_PHONE_CONTEXT_TABS = ['bookmarks'];
    const MOBILE_GENERAL_PANELS = ['localization', 'basics-core', 'layout'];

    /**
     * A touch device without a hover-capable pointer — a phone or tablet, never a
     * desktop with a mouse. Width alone is not enough: narrowing a desktop window
     * would otherwise switch the app to the mobile layout, which is wrong (and was
     * especially easy to trigger, since a narrow window is usually taller than it
     * is wide and so matched the portrait-tablet rule).
     */
    function isTouchDevice() {
        return typeof window.matchMedia === 'function'
            && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    }

    function isPhoneLayout() {
        return isTouchDevice()
            && window.matchMedia('(max-width: 768px)').matches;
    }

    function isPortraitTablet() {
        return isTouchDevice()
            && window.matchMedia('(max-width: 991px) and (orientation: portrait)').matches;
    }

    function isMobileLayout() {
        if (typeof window.matchMedia !== 'function') return false;
        if (!isTouchDevice()) return false;
        return window.matchMedia('(max-width: 991px)').matches;
    }

    function applyBodyFlag() {
        const phone = isPhoneLayout();
        const touch = isMobileLayout();
        document.body.dataset.phoneLayout = phone ? 'true' : 'false';
        // Dashboard chrome (footer, header) — phone width only; tablets keep desktop toolbar.
        document.body.dataset.mobileLayout = phone ? 'true' : 'false';
        document.body.dataset.touchLayout = touch ? 'true' : 'false';
        document.body.dataset.mobileHidePreviews = touch ? 'true' : 'false';
        document.documentElement.classList.toggle('mobile-layout-active', phone);
        document.documentElement.classList.toggle('phone-layout-active', phone);
        document.documentElement.classList.toggle('touch-layout-active', touch);
        return phone;
    }

    function applyConfigTabGuard() {
        if (!isPhoneLayout()) return;
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (!hash) return;
        let tab = hash.split('/')[0];
        if (hash.startsWith('colors')) tab = 'colors';
        if (MOBILE_PHONE_CONTEXT_TABS.includes(tab)) {
            window.configManager?.ui?.switchToTab?.(tab);
            return;
        }
        if (tab && !MOBILE_CONFIG_TABS.includes(tab)) {
            const next = `${window.location.pathname}${window.location.search}#general`;
            if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== next) {
                window.location.replace(next);
            }
        }
    }

    function applyConfigGeneralPanels(layers) {
        if (!isPhoneLayout() || !layers?.root) return;
        layers.applyLayer('essentials', { updateHash: false });
        layers.root.querySelectorAll('[data-general-panel]').forEach((card) => {
            const id = card.getAttribute('data-general-panel');
            card.dataset.mobilePanelHidden = MOBILE_GENERAL_PANELS.includes(id) ? 'false' : 'true';
        });
        const content = layers.root.querySelector('.general-content') || layers.root;
        const themePanel = content.querySelector('[data-general-panel="basics-core"]');
        const mobileOrder = ['localization', 'basics-core', 'layout'];
        const mobileFrag = document.createDocumentFragment();
        mobileOrder.forEach((id) => {
            const el = content.querySelector(`[data-general-panel="${id}"]`);
            if (el) mobileFrag.appendChild(el);
        });
        if (mobileFrag.childNodes.length) {
            content.prepend(mobileFrag);
        } else if (themePanel) {
            content.prepend(themePanel);
        }
        layers.buildChipNav?.();
        const toolbar = document.getElementById('general-layer-toolbar');
        if (toolbar) toolbar.hidden = true;
        const introAdv = document.getElementById('general-layer-intro-advanced');
        if (introAdv) introAdv.hidden = true;
        const introEss = document.getElementById('general-layer-intro-essentials');
        if (introEss) introEss.hidden = true;
        const introAll = document.getElementById('general-layer-intro-all');
        if (introAll) introAll.hidden = true;
        const tabIntro = document.querySelector('[data-tab-content="general"] .config-tab-intro');
        if (tabIntro) tabIntro.hidden = true;
        const mobileIntro = document.getElementById('general-layer-intro-mobile');
        if (mobileIntro) mobileIntro.hidden = false;
        const bulkBar = document.getElementById('general-panels-bulk-actions');
        if (bulkBar) bulkBar.hidden = true;
        const mobileSearchHost = document.getElementById('general-mobile-settings-search-host');
        if (mobileSearchHost) mobileSearchHost.hidden = false;
        const themeEditorLink = document.querySelector('.general-appearance-actions');
        if (themeEditorLink) themeEditorLink.hidden = true;
        window.ConfigSettingsSearch?.relocateForLayout?.();
    }

    function clearConfigGeneralPanels(layers) {
        if (!layers?.root) return;
        layers.root.querySelectorAll('[data-general-panel]').forEach((card) => {
            delete card.dataset.mobilePanelHidden;
        });
        const toolbar = document.getElementById('general-layer-toolbar');
        if (toolbar) toolbar.hidden = false;
        const mobileIntro = document.getElementById('general-layer-intro-mobile');
        if (mobileIntro) mobileIntro.hidden = true;
        const tabIntro = document.querySelector('[data-tab-content="general"] .config-tab-intro');
        if (tabIntro) tabIntro.hidden = false;
        const mobileSearchHost = document.getElementById('general-mobile-settings-search-host');
        if (mobileSearchHost) mobileSearchHost.hidden = true;
        const themeEditorLink = document.querySelector('.general-appearance-actions');
        if (themeEditorLink) themeEditorLink.hidden = false;
        layers.buildChipNav?.();
        window.ConfigSettingsSearch?.relocateForLayout?.();
    }

    let resizeTimer = null;
    let dashboardWasStacked = null;

    function syncDashboardColumnLayout() {
        const dash = window.dashboardInstance;
        if (!dash || typeof dash.shouldStackDashboardCategories !== 'function') {
            return;
        }
        // Only the bookmark grid has columns to re-sync. Inbox, Bookmarks and config
        // own the same container and lay themselves out with their own CSS, so
        // both branches below would wreck them: renderDashboard() paints the grid
        // over the view, and syncDashboardGridLayout() rewrites the container's
        // class outright — dropping inbox-layout and leaving the
        // view's children strewn across grid cells until the next navigation.
        if (typeof dash.isBookmarksView === 'function' && !dash.isBookmarksView()) {
            return;
        }
        const stacked = dash.shouldStackDashboardCategories();
        if (dashboardWasStacked === null) {
            dashboardWasStacked = stacked;
        }
        // The number of columns that fit changed: packed columns are built
        // one block per column, so only a fresh render moves the categories.
        // Read off the grid itself, so a resize before the first check counts.
        const shown = /\bcolumns-(\d+)\b/.exec(document.getElementById('dashboard-layout')?.className || '');
        const refit = shown && Number(shown[1]) !== Number(dash.getEffectiveColumnsPerRow?.());
        if (stacked !== dashboardWasStacked || refit) {
            dashboardWasStacked = stacked;
            if (typeof dash.renderDashboard === 'function') {
                dash.renderDashboard({ animate: false });
            }
            return;
        }
        if (typeof dash.syncDashboardGridLayout === 'function') {
            dash.syncDashboardGridLayout();
        }
    }

    function onLayoutChange() {
        const wasMobile = document.body.dataset.mobileLayout === 'true';
        const wasPhone = document.body.dataset.phoneLayout === 'true';
        const nowMobile = applyBodyFlag();
        const nowPhone = isPhoneLayout();
        syncDashboardColumnLayout();

        if (window.configManager?.generalLayers) {
            if (nowPhone) {
                applyConfigGeneralPanels(window.configManager.generalLayers);
            } else if (wasPhone) {
                clearConfigGeneralPanels(window.configManager.generalLayers);
                const gl = window.configManager.generalLayers;
                gl.applyLayer(gl.getStoredLayer(), { updateHash: false });
            }
        }

        window.configManager?.colorsEditor?.applyReadonlyMode?.();

        if (nowPhone) {
            applyConfigTabGuard();
        }
        window.ConfigTabGroups?.syncGroupVisibility?.();
        window.ConfigTabGroups?.updateActiveGroup?.(window.configManager?.ui?._currentTab);
        window.ConfigSettingsSearch?.relocateForLayout?.();
        window.ConfigSettingsSearch?.syncMobileLayout?.();
        window.ConfigTabGroups?.syncGroupVisibility?.();
        window.ConfigTabGroups?.updateActiveGroup?.(window.configManager?.ui?._currentTab);

        if (!nowMobile && wasMobile && window.configManager) {
            window.ConfigSettingsSearch?.init?.(window.configManager.language);
            window.ConfigSettingsSearch?.schedulePromoWhenIdle?.();
        }

        const dash = window.dashboardInstance;
        if (dash && typeof dash.refreshAddBookmarkToolbarLabel === 'function') {
            dash.refreshAddBookmarkToolbarLabel();
        }
        window.DashboardTagCloud?.syncFromSettings?.();
        dash?.gridFilter?.syncPinned?.();
        if (window.configManager?.language?.applyTranslations) {
            window.configManager.language.applyTranslations();
        }
    }

    function initDashboard() {
        applyBodyFlag();
        syncDashboardColumnLayout();

        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(onLayoutChange, 120);
        });
    }

    function initConfig() {
        applyBodyFlag();
        applyConfigTabGuard();

        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(onLayoutChange, 120);
        });
        window.addEventListener('hashchange', applyConfigTabGuard);
        window.ConfigTabGroups?.syncGroupVisibility?.();
        window.ConfigTabGroups?.updateActiveGroup?.(window.configManager?.ui?._currentTab);
    }

    window.MobileExperience = {
        MOBILE_FOOTER_BUTTONS,
        MOBILE_CONFIG_TABS,
        MOBILE_PHONE_CONTEXT_TABS,
        MOBILE_GENERAL_PANELS,
        isMobileLayout,
        isPhoneLayout,
        isPortraitTablet,
        shouldSkipHeavyUi() {
            // Interactive tours / multi-step wizards on desktop-width layouts only.
            return isMobileLayout();
        },
        shouldShowDiscoverabilityUi() {
            // Rotating tips, spotlights, and promo banners.
            return !isMobileLayout();
        },
        applyConfigGeneralPanels,
        applyConfigTabGuard,
        applyBodyFlag,
        initDashboard,
        initConfig,
    };
})();
