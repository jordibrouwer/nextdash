/**
 * Mobile / compact layout: simplified dashboard and config on small viewports.
 */
(function () {
    'use strict';

    const MOBILE_FOOTER_BUTTONS = ['search'];
    const MOBILE_CONFIG_TABS = ['general', 'help'];
    const MOBILE_GENERAL_PANELS = ['localization', 'basics-core', 'layout'];
    /** Set when the mobile info banner was shown and dismissed (persists across sessions). */
    const BANNER_SEEN_KEY = 'nextdash-mobile-banner-seen-v1';
    const DEVICE_SUGGEST_KEY = 'nextdash-mobile-device-suggest-done';

    function isPortraitTablet() {
        return window.matchMedia('(max-width: 991px) and (orientation: portrait)').matches;
    }

    function isMobileLayout() {
        if (typeof window.matchMedia !== 'function') return false;
        if (window.matchMedia('(max-width: 768px)').matches) return true;
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
        const on = isMobileLayout();
        document.body.dataset.mobileLayout = on ? 'true' : 'false';
        document.body.dataset.mobileHidePreviews = on ? 'true' : 'false';
        document.documentElement.classList.toggle('mobile-layout-active', on);
        return on;
    }

    function applyConfigTabGuard() {
        if (!isMobileLayout()) return;
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (!hash) return;
        let tab = hash.split('/')[0];
        if (hash.startsWith('colors')) tab = 'colors';
        if (tab && !MOBILE_CONFIG_TABS.includes(tab)) {
            const next = `${window.location.pathname}${window.location.search}#general`;
            if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== next) {
                window.location.replace(next);
            }
        }
    }

    function applyConfigGeneralPanels(layers) {
        if (!isMobileLayout() || !layers?.root) return;
        layers.applyLayer('essentials', { updateHash: false });
        layers.root.querySelectorAll('[data-general-panel]').forEach((card) => {
            const id = card.getAttribute('data-general-panel');
            card.dataset.mobilePanelHidden = MOBILE_GENERAL_PANELS.includes(id) ? 'false' : 'true';
        });
        const themePanel = layers.root.querySelector('[data-general-panel="basics-core"]');
        if (themePanel) {
            layers.root.prepend(themePanel);
        }
        const toolbar = document.getElementById('general-layer-toolbar');
        if (toolbar) toolbar.hidden = true;
        const showAll = document.getElementById('general-layer-show-all');
        if (showAll) showAll.hidden = true;
        const introAdv = document.getElementById('general-layer-intro-advanced');
        if (introAdv) introAdv.hidden = true;
        if (layers.advancedNav) layers.advancedNav.hidden = true;
    }

    function clearConfigGeneralPanels(layers) {
        if (!layers?.root) return;
        layers.root.querySelectorAll('[data-general-panel]').forEach((card) => {
            delete card.dataset.mobilePanelHidden;
        });
        const toolbar = document.getElementById('general-layer-toolbar');
        if (toolbar) toolbar.hidden = false;
        const showAll = document.getElementById('general-layer-show-all');
        if (showAll) showAll.hidden = false;
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
        const nowMobile = applyBodyFlag();
        syncBannersForLayout();
        syncDashboardColumnLayout();

        if (window.configManager?.generalLayers) {
            if (nowMobile) {
                applyConfigGeneralPanels(window.configManager.generalLayers);
            } else if (wasMobile && !nowMobile) {
                clearConfigGeneralPanels(window.configManager.generalLayers);
                window.configManager.generalLayers.applyLayer(
                    window.configManager.generalLayers.getStoredLayer(),
                    { updateHash: false }
                );
            }
        }

        if (nowMobile) {
            applyConfigTabGuard();
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
    }

    window.MobileExperience = {
        MOBILE_FOOTER_BUTTONS,
        MOBILE_CONFIG_TABS,
        MOBILE_GENERAL_PANELS,
        isMobileLayout,
        isPortraitTablet,
        shouldSkipHeavyUi() {
            // Interactive tours / multi-step wizards on desktop-width layouts only.
            return isMobileLayout();
        },
        shouldShowDiscoverabilityUi() {
            // Rotating tips, spotlights, discoverability queue, and promo banners.
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
