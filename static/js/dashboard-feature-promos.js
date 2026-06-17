/**
 * One-time discoverability promos: inline edit, tag cloud, tag filter bulk, recent bookmarks, quick move, page overview.
 */
(function initDashboardFeaturePromos(global) {
    const CLICK_SHIELD_MS = 600;

    const PROMO_DEFS = {
        inlineEdit: {
            storageKey: 'nextdash:dashboard-inline-edit-promo-confirmed-v1',
            titleKey: 'inlineEditPromoTitle',
            titleFallback: 'Inline edit',
            bodyKey: 'inlineEditPromoBody',
            bodyFallback: '<kbd>Ctrl+Enter</kbd> save · <kbd>Esc</kbd> cancel · saves immediately — bookmark stays in its real category, also in smart collections',
            dismissKey: 'inlineEditPromoDismiss',
        },
        tagCloud: {
            storageKey: 'nextdash:dashboard-tag-cloud-promo-confirmed-v1',
            titleKey: 'tagCloudPromoTitle',
            titleFallback: 'Tag word cloud',
            bodyKey: 'tagCloudPromoBody',
            bodyFallback: 'Pick tags to filter the grid (any match). <kbd>↑</kbd>/<kbd>↓</kbd> move · <kbd>Enter</kbd> apply · bulk actions appear in the toolbar below',
            dismissKey: 'tagCloudPromoDismiss',
        },
        tagFilterBulk: {
            storageKey: 'nextdash:dashboard-tag-filter-bulk-promo-confirmed-v1',
            titleKey: 'tagFilterBulkPromoTitle',
            titleFallback: 'Tag filter actions',
            bodyKey: 'tagFilterBulkPromoBody',
            bodyFallback: 'Act on every match: open tabs, copy links, move, or delete. Clear filters with × on the chips or reopen <kbd>/</kbd> tag cloud.',
            dismissKey: 'tagFilterBulkPromoDismiss',
        },
        recentBookmarks: {
            storageKey: 'nextdash:dashboard-recent-bookmarks-promo-confirmed-v1',
            titleKey: 'recentBookmarksPromoTitle',
            titleFallback: 'Recent bookmarks',
            bodyKey: 'recentBookmarksPromoBody',
            bodyFallback: 'Opened with <kbd>*</kbd>. <kbd>↑</kbd>/<kbd>↓</kbd> navigate · <kbd>Enter</kbd> open · toolbar opens multiple tabs · <kbd>:open last</kbd> in command mode',
            dismissKey: 'recentBookmarksPromoDismiss',
        },
        previewCard: {
            storageKey: 'nextdash:dashboard-preview-card-promo-confirmed-v1',
            titleKey: 'previewCardPromoTitle',
            titleFallback: 'Preview card',
            bodyKey: 'previewCardPromoBody',
            bodyFallback: '<kbd>[</kbd> toggles this card on the selected bookmark · hover also works when enabled · use the clipboard icon to copy the URL',
            dismissKey: 'previewCardPromoDismiss',
        },
        quickAddOmnibox: {
            storageKey: 'nextdash:dashboard-quick-add-omnibox-promo-confirmed-v1',
            titleKey: 'quickAddOmniboxPromoTitle',
            titleFallback: 'Quick-add line',
            bodyKey: 'quickAddOmniboxPromoBody',
            bodyFallback: 'Opened with <kbd>&</kbd>. Type <kbd>name | url | shortcut</kbd> · <kbd>Enter</kbd> add · <kbd>Esc</kbd> cancel · paste a URL on the dashboard for another fast path',
            dismissKey: 'quickAddOmniboxPromoDismiss',
        },
        datePopover: {
            storageKey: 'nextdash:dashboard-date-popover-promo-confirmed-v1',
            titleKey: 'datePopoverPromoTitle',
            titleFallback: 'Week overview',
            bodyKey: 'datePopoverPromoBody',
            bodyFallback: 'Quick week view from the header date · add a calendar link in config for an <kbd>Open calendar</kbd> shortcut · <kbd>Esc</kbd> or click outside to close',
            dismissKey: 'datePopoverPromoDismiss',
        },
        weatherGeolocation: {
            storageKey: 'nextdash:dashboard-weather-geolocation-promo-confirmed-v1',
            titleKey: 'weatherGeolocationPromoTitle',
            titleFallback: 'Weather location blocked',
            bodyKey: 'weatherGeolocationPromoBody',
            bodyFallback: 'Browser location is off or denied. Allow location for this site via the lock icon in the address bar, or switch to a manual city in <a href="/config#general">Config → General → Date &amp; weather</a>.',
            dismissKey: 'weatherGeolocationPromoDismiss',
            linkKey: 'weatherGeolocationPromoLink',
            linkFallback: 'Open weather settings →',
            linkHref: '/config#general',
        },
        categoryCollapse: {
            storageKey: 'nextdash:dashboard-category-collapse-promo-confirmed-v1',
            titleKey: 'categoryCollapsePromoTitle',
            titleFallback: 'Collapse categories',
            bodyKey: 'categoryCollapsePromoBody',
            bodyFallback: '<kbd>Enter</kbd> or <kbd>Space</kbd> on a category header collapses or expands it · collapsed sections are skipped while navigating bookmarks',
            dismissKey: 'categoryCollapsePromoDismiss',
        },
        quickMove: {
            storageKey: 'nextdash:dashboard-quick-move-promo-confirmed-v1',
            titleKey: 'quickMovePromoTitle',
            titleFallback: 'Quick move',
            bodyKey: 'quickMovePromoBody',
            bodyFallback: '<kbd>Shift+M</kbd> opens this menu · <kbd>↑</kbd>/<kbd>↓</kbd> choose category or page · <kbd>Enter</kbd> confirm',
            dismissKey: 'quickMovePromoDismiss',
        },
        quickDelete: {
            storageKey: 'nextdash:dashboard-quick-delete-promo-confirmed-v1',
            titleKey: 'quickDeletePromoTitle',
            titleFallback: 'Quick delete',
            bodyKey: 'quickDeletePromoBody',
            bodyFallback: '<kbd>Shift+D</kbd> opens this menu · <kbd>↑</kbd>/<kbd>↓</kbd> choose · <kbd>Enter</kbd> delete · undo in the toast',
            dismissKey: 'quickDeletePromoDismiss',
        },
        pageOverview: {
            storageKey: 'nextdash:dashboard-page-overview-promo-confirmed-v1',
            titleKey: 'pageOverviewPromoTitle',
            titleFallback: 'Page overview',
            bodyKey: 'pageOverviewPromoBody',
            bodyFallback: '<kbd>↑</kbd>/<kbd>↓</kbd> or <kbd>Tab</kbd> move · <kbd>Enter</kbd> switch page · <kbd>1</kbd>–<kbd>9</kbd> jump · counts show bookmarks per page',
            dismissKey: 'pageOverviewPromoDismiss',
        },
        cheatsheet: {
            storageKey: 'nextdash:dashboard-cheatsheet-promo-confirmed-v1',
            titleKey: 'cheatsheetPromoTitle',
            titleFallback: 'Keyboard cheat sheet',
            bodyKey: 'cheatsheetPromoBody',
            bodyFallback: 'Opened with <kbd>!</kbd> or <kbd>F1</kbd> · filter shortcuts at the top · <kbd>Esc</kbd> closes · reopen anytime from the Help footer button',
            dismissKey: 'cheatsheetPromoDismiss',
        },
    };

    let openKind = null;
    let promoEl = null;
    let anchorEl = null;
    let suppressUnderlyingClicksUntil = 0;
    let boundReposition = null;
    let boundPromoKeydown = null;

    function t(key, fallback) {
        const fullKey = `dashboard.${key}`;
        const value = global.dashboardInstance?.language?.t?.(fullKey);
        return value && value !== fullKey ? value : fallback;
    }

    function isDesktopDiscoverability() {
        return global.MobileExperience?.shouldShowDiscoverabilityUi?.() !== false;
    }

    function readConfirmed(kind) {
        const def = PROMO_DEFS[kind];
        if (!def) return true;
        try {
            return localStorage.getItem(def.storageKey) === '1';
        } catch {
            return true;
        }
    }

    function markConfirmed(kind) {
        const def = PROMO_DEFS[kind];
        if (!def) return;
        try {
            localStorage.setItem(def.storageKey, '1');
        } catch {
            // Ignore storage errors.
        }
    }

    function shouldBlockUnderlyingClick() {
        return Date.now() < suppressUnderlyingClicksUntil;
    }

    function blockUnderlyingClicksBriefly() {
        suppressUnderlyingClicksUntil = Date.now() + CLICK_SHIELD_MS;
    }

    function isPromoDeferred(pendingKind) {
        if (document.body.classList.contains('loading')) return true;
        if (global.DashboardTagCloud?.modalOpen && pendingKind !== 'tagCloud') return true;
        if (document.getElementById('page-overview-overlay') && pendingKind !== 'pageOverview') return true;
        if (document.body.classList.contains('bookmark-inline-edit-active') && pendingKind !== 'inlineEdit') return true;
        if (document.getElementById('move-popover') && pendingKind !== 'quickMove') return true;
        if (document.getElementById('delete-popover') && pendingKind !== 'quickDelete') return true;
        if (document.body.classList.contains('preview-card-active') && pendingKind !== 'previewCard') return true;
        if (document.getElementById('omnibox-overlay') && pendingKind !== 'quickAddOmnibox') return true;
        if (document.getElementById('date-popover') && pendingKind !== 'datePopover') return true;
        if (document.querySelector('.feature-spotlight.show')) return true;
        const overlay = document.getElementById('app-modal');
        if (overlay?.classList.contains('show')) {
            const recentOpen = pendingKind === 'recentBookmarks'
                && global.dashboardInstance?.isRecentBookmarksModalOpen?.() === true;
            const cheatsheetOpen = pendingKind === 'cheatsheet'
                && overlay.querySelector('.keyboard-cheat-sheet-modal');
            if (!recentOpen && !cheatsheetOpen) return true;
        }
        if (document.querySelector('.onboarding-overlay, .feature-tour-overlay')) return true;
        if (global.dashboardInstance?.searchComponent?.isActive?.()) return true;
        if (global.DashboardGridKeyboardPromo?.isPromoOpen?.()) return true;
        if (global.DashboardGJumpPromo?.isPromoOpen?.()) return true;
        if (global.DashboardSmartCollectionPromo?.isPromoOpen?.()) return true;
        if (document.querySelector('.dashboard-search-promo')) return true;
        const isVisibleTourCard = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return el.getBoundingClientRect().width > 8;
        };
        return [...document.querySelectorAll('[class$="-tour-card"], .onboarding-card, .feature-tour-card')]
            .some(isVisibleTourCard);
    }

    function stopPromoEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    function unbindReposition() {
        if (!boundReposition) return;
        window.removeEventListener('scroll', boundReposition, true);
        window.removeEventListener('resize', boundReposition);
        boundReposition = null;
    }

    function unbindPromoKeydown() {
        if (!boundPromoKeydown) return;
        window.removeEventListener('keydown', boundPromoKeydown, true);
        boundPromoKeydown = null;
    }

    function removePromoFromDom() {
        unbindReposition();
        unbindPanelResize();
        unbindPromoKeydown();
        promoEl?.remove();
        promoEl = null;
        anchorEl = null;
        openKind = null;
    }

    function isAnyOpen() {
        return promoEl?.isConnected === true;
    }

    function isPromoOpen(kind) {
        return isAnyOpen() && openKind === kind;
    }

    function dismissOpen() {
        blockUnderlyingClicksBriefly();
        removePromoFromDom();
    }

    function confirmOpen() {
        if (!openKind || readConfirmed(openKind)) {
            dismissOpen();
            return;
        }
        blockUnderlyingClicksBriefly();
        markConfirmed(openKind);
        removePromoFromDom();
    }

    function attachPromoButtonHandlers(wrap) {
        const closeBtn = wrap.querySelector('.dashboard-feature-promo-close');
        closeBtn?.addEventListener('mousedown', (event) => {
            stopPromoEvent(event);
        }, true);
        closeBtn?.addEventListener('click', (event) => {
            stopPromoEvent(event);
            confirmOpen();
        }, true);
    }

    function bindPromoKeydown() {
        if (boundPromoKeydown) return;
        boundPromoKeydown = (event) => {
            if (!isAnyOpen()) return;
            const closeBtn = promoEl?.querySelector('.dashboard-feature-promo-close');
            if (!closeBtn) return;

            if (event.key === 'Escape') {
                stopPromoEvent(event);
                confirmOpen();
                return;
            }

            if (event.key === 'Tab') {
                if (document.activeElement !== closeBtn) {
                    stopPromoEvent(event);
                    closeBtn.focus({ preventScroll: true });
                }
                return;
            }

            if (event.key === 'Enter' && document.activeElement === closeBtn) {
                stopPromoEvent(event);
                confirmOpen();
            }
        };
        window.addEventListener('keydown', boundPromoKeydown, true);
    }

    function buildPromoElement(kind) {
        const def = PROMO_DEFS[kind];
        const title = t(def.titleKey, def.titleFallback);
        const body = t(def.bodyKey, def.bodyFallback);
        const closeLabel = t(def.dismissKey, 'Got it');

        const wrap = document.createElement('div');
        wrap.className = `dashboard-feature-promo dashboard-feature-promo--${kind}`;
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'false');
        wrap.setAttribute('aria-label', title);
        wrap.innerHTML = `
            <div class="dashboard-feature-promo-balloon">
                <span class="dashboard-feature-promo-tail" aria-hidden="true"></span>
                <p class="dashboard-feature-promo-title"></p>
                <div class="dashboard-feature-promo-text"></div>
                <div class="dashboard-feature-promo-actions">
                    <a class="dashboard-feature-promo-link hidden" href="#" target="_self" rel="noopener"></a>
                    <button type="button" class="dashboard-feature-promo-close"></button>
                </div>
            </div>`;
        wrap.querySelector('.dashboard-feature-promo-title').textContent = title;
        wrap.querySelector('.dashboard-feature-promo-text').innerHTML = body;
        const linkEl = wrap.querySelector('.dashboard-feature-promo-link');
        if (linkEl && def.linkHref) {
            linkEl.href = def.linkHref;
            linkEl.textContent = t(def.linkKey, def.linkFallback || 'Learn more →');
            linkEl.classList.remove('hidden');
        }
        wrap.querySelector('.dashboard-feature-promo-close').textContent = closeLabel;
        attachPromoButtonHandlers(wrap);
        return wrap;
    }

    function getPromoHost(kind) {
        if (kind === 'tagCloud') {
            return document.getElementById('dashboard-tag-cloud-wrap') || document.body;
        }
        if (kind === 'pageOverview') {
            return document.body;
        }
        return document.body;
    }

    function getTagCloudModalRect() {
        const modal = (anchorEl instanceof HTMLElement && anchorEl.id === 'tag-cloud-modal')
            ? anchorEl
            : document.getElementById('tag-cloud-modal');
        return modal?.getBoundingClientRect() || null;
    }

    let boundPanelResize = null;

    function unbindPanelResize() {
        if (!boundPanelResize) return;
        boundPanelResize.disconnect();
        boundPanelResize = null;
    }

    function getRecentBookmarksModalRect() {
        const panel = getRecentBookmarksModalElement();
        return panel?.getBoundingClientRect() || null;
    }

    function bindAnchorResize(getElement) {
        unbindPanelResize();
        const el = getElement();
        if (!el || typeof ResizeObserver === 'undefined') return;
        boundPanelResize = new ResizeObserver(() => reposition());
        boundPanelResize.observe(el);
    }

    function getPreviewCardElement() {
        if (anchorEl instanceof HTMLElement && anchorEl.classList.contains('bookmark-preview-card')) {
            return anchorEl;
        }
        return anchorEl?.closest?.('.bookmark-preview-card')
            || global.dashboardInstance?.previewCardElement
            || document.querySelector('.bookmark-preview-card.is-visible');
    }

    function getPreviewCardRect() {
        const card = getPreviewCardElement();
        if (!card?.classList.contains('is-visible')) return null;
        return card.getBoundingClientRect();
    }

    function getQuickAddOmniboxBoxElement() {
        if (anchorEl instanceof HTMLElement && anchorEl.classList.contains('omnibox-box')) {
            return anchorEl;
        }
        return anchorEl?.closest?.('.omnibox-box')
            || document.querySelector('#omnibox-overlay .omnibox-box');
    }

    function getQuickAddOmniboxBoxRect() {
        const box = getQuickAddOmniboxBoxElement();
        if (!box?.isConnected) return null;
        return box.getBoundingClientRect();
    }

    function getDatePopoverElement() {
        if (anchorEl instanceof HTMLElement && anchorEl.id === 'date-popover') {
            return anchorEl;
        }
        return anchorEl?.closest?.('#date-popover')
            || document.getElementById('date-popover');
    }

    function getDateElementRect() {
        const el = document.getElementById('date-element');
        return el?.getBoundingClientRect() || null;
    }

    function getDatePopoverRect() {
        const pop = getDatePopoverElement();
        if (!pop?.isConnected) return null;
        return pop.getBoundingClientRect();
    }

    function getCheatsheetModalElement() {
        if (anchorEl instanceof HTMLElement && anchorEl.classList.contains('keyboard-cheat-sheet-modal')) {
            return anchorEl;
        }
        return document.querySelector('#app-modal.show .keyboard-cheat-sheet-modal');
    }

    function getCheatsheetModalRect() {
        const panel = getCheatsheetModalElement();
        return panel?.getBoundingClientRect() || null;
    }

    function bindCheatsheetModalResize() {
        unbindPanelResize();
        const panel = getCheatsheetModalElement();
        if (!panel || typeof ResizeObserver === 'undefined') return;
        boundPanelResize = new ResizeObserver(() => reposition());
        boundPanelResize.observe(panel);
    }

    function getRecentBookmarksModalElement() {
        if (anchorEl instanceof HTMLElement && anchorEl.classList.contains('recent-bookmarks-modal')) {
            return anchorEl;
        }
        return anchorEl?.closest?.('.recent-bookmarks-modal')
            || document.querySelector('#app-modal .recent-bookmarks-modal');
    }

    function bindRecentBookmarksModalResize() {
        unbindPanelResize();
        const panel = getRecentBookmarksModalElement();
        if (!panel || typeof ResizeObserver === 'undefined') return;
        boundPanelResize = new ResizeObserver(() => reposition());
        boundPanelResize.observe(panel);
    }

    function getTagFilterBulkToolbarElement() {
        if (anchorEl instanceof HTMLElement && anchorEl.classList.contains('tag-filter-bulk-toolbar')) {
            return anchorEl;
        }
        return anchorEl?.closest?.('.tag-filter-bulk-toolbar')
            || document.querySelector('.tag-filter-bulk-toolbar');
    }

    function getTagFilterBulkToolbarRect() {
        const toolbar = getTagFilterBulkToolbarElement();
        if (!toolbar?.isConnected) return null;
        return toolbar.getBoundingClientRect();
    }

    function bindTagFilterBulkToolbarResize() {
        unbindPanelResize();
        const toolbar = getTagFilterBulkToolbarElement();
        if (!toolbar || typeof ResizeObserver === 'undefined') return;
        boundPanelResize = new ResizeObserver(() => reposition());
        boundPanelResize.observe(toolbar);
    }

    function getPageOverviewPanelElement() {
        if (anchorEl instanceof HTMLElement && anchorEl.classList.contains('page-overview-panel')) {
            return anchorEl;
        }
        return anchorEl?.closest?.('.page-overview-panel')
            || document.querySelector('#page-overview-overlay .page-overview-panel');
    }

    function getPageOverviewPanelRect() {
        const panel = getPageOverviewPanelElement();
        return panel?.getBoundingClientRect() || null;
    }

    function bindPageOverviewPanelResize() {
        unbindPanelResize();
        const panel = getPageOverviewPanelElement();
        if (!panel || typeof ResizeObserver === 'undefined') return;
        boundPanelResize = new ResizeObserver(() => reposition());
        boundPanelResize.observe(panel);
    }

    function getInlineEditFormElement() {
        if (anchorEl instanceof HTMLElement && anchorEl.classList.contains('bookmark-inline-form')) {
            return anchorEl;
        }
        return document.querySelector('.bookmark-inline-form');
    }

    function getInlineEditFormRect() {
        return getInlineEditFormElement()?.getBoundingClientRect() || null;
    }

    function bindInlineEditFormResize() {
        unbindPanelResize();
        const form = getInlineEditFormElement();
        if (!form || typeof ResizeObserver === 'undefined') return;
        boundPanelResize = new ResizeObserver(() => reposition());
        boundPanelResize.observe(form);
    }

    function measurePromoBalloon() {
        const balloon = promoEl?.querySelector('.dashboard-feature-promo-balloon');
        const balloonRect = balloon?.getBoundingClientRect();
        return {
            width: balloonRect?.width || 280,
            height: balloonRect?.height || 120,
        };
    }

    function applyBesidePlacement(anchorRect) {
        if (!promoEl || !anchorRect || (anchorRect.width < 1 && anchorRect.height < 1)) {
            return false;
        }

        promoEl.style.visibility = 'hidden';
        promoEl.style.display = 'block';
        promoEl.style.right = 'auto';
        promoEl.style.bottom = 'auto';

        const { width: initialWidth, height } = measurePromoBalloon();
        const placement = global.DashboardPromoPlacement.positionBesideAnchor(anchorRect, initialWidth, height);

        promoEl.style.width = `${Math.round(placement.width)}px`;
        promoEl.style.maxWidth = `${Math.round(placement.width)}px`;
        promoEl.classList.remove(
            'dashboard-feature-promo--above',
            'dashboard-feature-promo--below-anchor',
            'dashboard-feature-promo--beside-right',
            'dashboard-feature-promo--beside-left'
        );
        promoEl.classList.add(
            placement.placeRight
                ? 'dashboard-feature-promo--beside-right'
                : 'dashboard-feature-promo--beside-left'
        );
        promoEl.style.left = `${Math.round(placement.left)}px`;
        promoEl.style.top = `${Math.round(placement.top)}px`;
        promoEl.style.visibility = 'visible';
        return true;
    }

    function getAnchorRect() {
        if (!(anchorEl instanceof HTMLElement) || !anchorEl.isConnected) {
            return null;
        }
        const rect = anchorEl.getBoundingClientRect();
        if (rect.width < 1 && rect.height < 1) {
            return null;
        }
        return rect;
    }

    function positionPromo() {
        if (!promoEl) return;

        if (openKind === 'tagCloud') {
            applyBesidePlacement(getTagCloudModalRect());
            return;
        }

        if (openKind === 'pageOverview') {
            applyBesidePlacement(getPageOverviewPanelRect());
            return;
        }

        if (openKind === 'inlineEdit') {
            applyBesidePlacement(getInlineEditFormRect());
            return;
        }

        if (openKind === 'tagFilterBulk') {
            const rect = getTagFilterBulkToolbarRect();
            if (!rect) {
                dismissOpen();
                return;
            }
            applyBesidePlacement(rect);
            return;
        }

        if (openKind === 'recentBookmarks') {
            applyBesidePlacement(getRecentBookmarksModalRect());
            return;
        }

        if (openKind === 'previewCard') {
            const rect = getPreviewCardRect();
            if (!rect) {
                dismissOpen();
                return;
            }
            applyBesidePlacement(rect);
            return;
        }

        if (openKind === 'quickAddOmnibox') {
            const rect = getQuickAddOmniboxBoxRect();
            if (!rect) {
                dismissOpen();
                return;
            }
            applyBesidePlacement(rect);
            return;
        }

        if (openKind === 'datePopover') {
            const rect = getDatePopoverRect();
            if (!rect) {
                dismissOpen();
                return;
            }
            applyBesidePlacement(rect);
            return;
        }

        if (openKind === 'weatherGeolocation') {
            const rect = getDateElementRect();
            if (!rect) {
                dismissOpen();
                return;
            }
            applyBesidePlacement(rect);
            return;
        }

        if (openKind === 'cheatsheet') {
            const rect = getCheatsheetModalRect();
            if (!rect) {
                dismissOpen();
                return;
            }
            applyBesidePlacement(rect);
            return;
        }

        applyBesidePlacement(getAnchorRect());
    }

    function reposition() {
        if (isAnyOpen()) {
            positionPromo();
        }
    }

    function bindReposition() {
        if (boundReposition) return;
        boundReposition = () => positionPromo();
        window.addEventListener('scroll', boundReposition, true);
        window.addEventListener('resize', boundReposition);
    }

    function canShowKind(kind) {
        if (!PROMO_DEFS[kind] || readConfirmed(kind) || !isDesktopDiscoverability()) {
            return false;
        }
        if (kind === 'tagCloud') {
            return global.DashboardTagCloud?.isEligible?.() === true;
        }
        if (kind === 'tagFilterBulk') {
            return readConfirmed('tagCloud');
        }
        if (kind === 'previewCard') {
            return global.dashboardInstance?.settings?.showLinkPreviewCards === true;
        }
        if (kind === 'weatherGeolocation') {
            const settings = global.dashboardInstance?.settings;
            return settings?.showWeatherWithDate === true && settings?.weatherSource === 'browser';
        }
        return true;
    }

    function tryShow(kind, anchor) {
        if (!canShowKind(kind) || isPromoDeferred(kind) || !(anchor instanceof HTMLElement)) {
            return false;
        }
        if (isAnyOpen()) {
            return false;
        }

        removePromoFromDom();
        openKind = kind;
        anchorEl = anchor;
        promoEl = buildPromoElement(kind);
        getPromoHost(kind).appendChild(promoEl);
        bindReposition();
        bindPromoKeydown();
        if (kind === 'pageOverview') {
            bindPageOverviewPanelResize();
        }
        if (kind === 'inlineEdit') {
            bindInlineEditFormResize();
        }
        if (kind === 'tagFilterBulk') {
            bindTagFilterBulkToolbarResize();
        }
        if (kind === 'recentBookmarks') {
            bindRecentBookmarksModalResize();
        }
        if (kind === 'previewCard') {
            bindAnchorResize(getPreviewCardElement);
        }
        if (kind === 'quickAddOmnibox') {
            bindAnchorResize(getQuickAddOmniboxBoxElement);
        }
        if (kind === 'datePopover') {
            bindAnchorResize(getDatePopoverElement);
        }
        if (kind === 'cheatsheet') {
            bindCheatsheetModalResize();
        }
        const positionAfterLayout = () => {
            positionPromo();
            promoEl?.querySelector('.dashboard-feature-promo-close')?.focus({ preventScroll: true });
        };
        if (kind === 'tagCloud' || kind === 'pageOverview' || kind === 'inlineEdit'
            || kind === 'tagFilterBulk' || kind === 'recentBookmarks'
            || kind === 'previewCard' || kind === 'quickAddOmnibox' || kind === 'datePopover'
            || kind === 'categoryCollapse' || kind === 'cheatsheet') {
            requestAnimationFrame(() => requestAnimationFrame(() => {
                positionAfterLayout();
                if (kind === 'pageOverview' || kind === 'recentBookmarks' || kind === 'cheatsheet') {
                    setTimeout(positionAfterLayout, 180);
                }
                if (kind === 'inlineEdit' || kind === 'tagFilterBulk' || kind === 'previewCard'
                    || kind === 'quickAddOmnibox' || kind === 'datePopover' || kind === 'categoryCollapse') {
                    setTimeout(positionAfterLayout, 200);
                }
            }));
        } else {
            requestAnimationFrame(positionAfterLayout);
        }
        return true;
    }

    function tryShowDeferred(kind, anchor, delays = [0, 500, 1100]) {
        if (!(anchor instanceof HTMLElement)) return;
        delays.forEach((delayMs) => {
            if (delayMs === 0) {
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    tryShow(kind, anchor);
                }));
            } else {
                setTimeout(() => tryShow(kind, anchor), delayMs);
            }
        });
    }

    function clearPromoSeen(kind) {
        dismissOpen();
        const kinds = kind ? [kind] : Object.keys(PROMO_DEFS);
        kinds.forEach((entry) => {
            const def = PROMO_DEFS[entry];
            if (!def) return;
            try {
                localStorage.removeItem(def.storageKey);
            } catch {
                // Ignore storage errors.
            }
        });
    }

    global.DashboardFeaturePromos = {
        tryShow,
        tryShowDeferred,
        reposition,
        isAnyOpen,
        isPromoOpen,
        confirmOpen,
        dismissOpen,
        shouldBlockUnderlyingClick,
        clearPromoSeen,
        hasSeenPromo(kind) {
            return kind ? readConfirmed(kind) : Object.keys(PROMO_DEFS).every(readConfirmed);
        },
    };
}(window));
