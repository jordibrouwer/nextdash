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
    /** Set when the mobile info banner was shown and dismissed (persists across sessions). */
    const BANNER_SEEN_KEY = 'nextdash-mobile-banner-seen-v1';
    const DEVICE_SUGGEST_KEY = 'nextdash-mobile-device-suggest-done';

    function isPhoneLayout() {
        return typeof window.matchMedia === 'function'
            && window.matchMedia('(max-width: 768px)').matches;
    }

    function isPortraitTablet() {
        return window.matchMedia('(max-width: 991px) and (orientation: portrait)').matches;
    }

    function isMobileLayout() {
        if (typeof window.matchMedia !== 'function') return false;
        if (isPhoneLayout()) return true;
        if (isPortraitTablet()) return true;
        if (
            window.matchMedia('(hover: none) and (pointer: coarse)').matches
            && window.matchMedia('(max-width: 991px)').matches
        ) {
            return true;
        }
        return false;
    }

    function t(key, fallback) {
        const lang = window.dashboardInstance?.language || window.configManager?.language;
        if (lang?.t) {
            const v = lang.t(key);
            if (v && v !== key) return v;
        }
        return fallback;
    }

    function translateBanner(el) {
        if (!el) return;
        const textEl = el.querySelector('[data-mobile-banner-text]');
        const dismissBtn = el.querySelector('[data-mobile-banner-dismiss]');
        const deviceBtn = el.querySelector('[data-mobile-device-suggest]');
        const isConfig = el.dataset.mobileBannerContext === 'config';
        const textKey = isConfig ? 'config.mobileExperienceBanner' : 'dashboard.mobileExperienceBanner';
        if (textEl) textEl.innerHTML = t(textKey, textEl.innerHTML);
        if (dismissBtn) {
            dismissBtn.setAttribute('aria-label', t('dashboard.mobileExperienceDismiss', 'Dismiss'));
        }
        if (deviceBtn) {
            deviceBtn.textContent = t('dashboard.mobileDeviceSpecificSuggest', 'Use device-specific settings');
        }
    }

    function isBannerSeen() {
        try {
            return localStorage.getItem(BANNER_SEEN_KEY) === '1';
        } catch {
            return false;
        }
    }

    function markBannerSeen() {
        try {
            localStorage.setItem(BANNER_SEEN_KEY, '1');
        } catch { /* ignore */ }
        removeBanners();
    }

    function dismissBanner() {
        markBannerSeen();
    }

    function shouldSuggestDeviceSpecific() {
        if (!isMobileLayout()) return false;
        try {
            if (localStorage.getItem('deviceSpecificSettings') === 'true') return false;
            if (localStorage.getItem(DEVICE_SUGGEST_KEY) === '1') return false;
        } catch {
            return false;
        }
        return true;
    }

    function enableDeviceSpecificSuggest() {
        try {
            localStorage.setItem('deviceSpecificSettings', 'true');
            localStorage.setItem(DEVICE_SUGGEST_KEY, '1');
        } catch { /* ignore */ }
        const msg = t(
            'dashboard.mobileDeviceSpecificEnabled',
            'Device-specific settings enabled for this phone. Open config to adjust and save.'
        );
        if (window.AppNotification?.show) {
            window.AppNotification.show(msg, 'success');
        }
        document.querySelectorAll('[data-mobile-device-suggest]').forEach((btn) => {
            btn.hidden = true;
        });
    }

    function createBannerMarkup(context) {
        const wrap = document.createElement('div');
        wrap.id = context === 'config' ? 'mobile-experience-banner-config' : 'mobile-experience-banner';
        wrap.className = 'mobile-experience-banner';
        wrap.setAttribute('role', 'status');
        wrap.dataset.mobileBannerContext = context;
        wrap.innerHTML = `
            <p class="mobile-experience-banner-text" data-mobile-banner-text></p>
            <div class="mobile-experience-banner-actions">
                <button type="button" class="btn btn-secondary btn-small" data-mobile-device-suggest hidden></button>
                <button type="button" class="mobile-experience-banner-dismiss" data-mobile-banner-dismiss aria-label="Dismiss">&times;</button>
            </div>
        `;
        return wrap;
    }

    function installBanner(context, anchor) {
        if (!isMobileLayout() || isBannerSeen() || !anchor) return null;
        const existing = document.getElementById(
            context === 'config' ? 'mobile-experience-banner-config' : 'mobile-experience-banner'
        );
        if (existing) return existing;

        const banner = createBannerMarkup(context);
        anchor.insertAdjacentElement('afterbegin', banner);
        translateBanner(banner);

        banner.querySelector('[data-mobile-banner-dismiss]')?.addEventListener('click', dismissBanner);

        const deviceBtn = banner.querySelector('[data-mobile-device-suggest]');
        if (deviceBtn && shouldSuggestDeviceSpecific()) {
            deviceBtn.hidden = false;
            deviceBtn.addEventListener('click', enableDeviceSpecificSuggest);
        }

        return banner;
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
        const themePanel = layers.root.querySelector('[data-general-panel="basics-core"]');
        const mobileOrder = ['localization', 'basics-core', 'layout'];
        const mobileFrag = document.createDocumentFragment();
        mobileOrder.forEach((id) => {
            const el = layers.root.querySelector(`[data-general-panel="${id}"]`);
            if (el) mobileFrag.appendChild(el);
        });
        if (mobileFrag.childNodes.length) {
            layers.root.prepend(mobileFrag);
        } else if (themePanel) {
            layers.root.prepend(themePanel);
        }
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
        window.ConfigSettingsSearch?.relocateForLayout?.();
    }

    function removeBanners() {
        document.querySelectorAll('.mobile-experience-banner').forEach((el) => el.remove());
    }

    function syncBannersForLayout() {
        if (!isMobileLayout() || isBannerSeen()) {
            removeBanners();
            return;
        }
        const dashAnchor = document.querySelector('.section-content .container');
        if (dashAnchor) installBanner('dashboard', dashAnchor);
        const configAnchor = document.getElementById('config-breadcrumb') || document.getElementById('config-main');
        if (configAnchor) installBanner('config', configAnchor);
        document.querySelectorAll('.mobile-experience-banner').forEach(translateBanner);
    }

    function refreshBanners() {
        syncBannersForLayout();
    }

    let resizeTimer = null;
    let dashboardWasStacked = null;

    function syncDashboardColumnLayout() {
        const dash = window.dashboardInstance;
        if (!dash || typeof dash.shouldStackDashboardCategories !== 'function') {
            return;
        }
        const stacked = dash.shouldStackDashboardCategories();
        if (dashboardWasStacked === null) {
            dashboardWasStacked = stacked;
        }
        if (stacked !== dashboardWasStacked) {
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
        syncBannersForLayout();
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
        if (dash && typeof dash.initializeButtonTipsRotation === 'function') {
            dash.initializeButtonTipsRotation();
        }
        if (dash && typeof dash.refreshAddBookmarkToolbarLabel === 'function') {
            dash.refreshAddBookmarkToolbarLabel();
        }
        window.DashboardTagCloud?.syncFromSettings?.();
        if (window.configManager?.language?.applyTranslations) {
            window.configManager.language.applyTranslations();
        }
    }

    function initDashboard() {
        applyBodyFlag();
        syncDashboardColumnLayout();
        installBanner('dashboard', document.querySelector('.section-content .container'));

        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(onLayoutChange, 120);
        });
    }

    function initConfig() {
        applyBodyFlag();
        applyConfigTabGuard();
        const main = document.getElementById('config-main');
        const breadcrumb = document.getElementById('config-breadcrumb');
        installBanner('config', breadcrumb || main);

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
        refreshBannerTranslations() {
            document.querySelectorAll('.mobile-experience-banner').forEach(translateBanner);
        },
    };
})();
