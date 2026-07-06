/**
 * One-time promo for first navigation to a smart collection (G+key or Tab).
 */
(function initDashboardSmartCollectionPromo(global) {
    const PROMO_CONFIRMED_KEY = 'nextdash:dashboard-smart-collection-promo-confirmed-v1';
    const CLICK_SHIELD_MS = 600;

    let promoEl = null;
    let categoryEl = null;
    let suppressUnderlyingClicksUntil = 0;
    let boundReposition = null;
    let boundPromoKeydown = null;
    let boundFocusIn = null;

    function readConfirmedFromStorage() {
        if (global.DiscoverabilityState?.isStorageKeyConfirmed?.(PROMO_CONFIRMED_KEY)) {
            return true;
        }
        try {
            return localStorage.getItem(PROMO_CONFIRMED_KEY) === '1';
        } catch {
            return false;
        }
    }

    function markConfirmedInStorage() {
        global.DiscoverabilityState?.markStorageKeyConfirmed?.(PROMO_CONFIRMED_KEY);
        try {
            localStorage.setItem(PROMO_CONFIRMED_KEY, '1');
        } catch {
            // Ignore storage errors.
        }
    }

    function isPromoSuppressed() {
        return readConfirmedFromStorage();
    }

    function shouldBlockUnderlyingClick() {
        return Date.now() < suppressUnderlyingClicksUntil;
    }

    function blockUnderlyingClicksBriefly() {
        suppressUnderlyingClicksUntil = Date.now() + CLICK_SHIELD_MS;
    }

    function isDesktopDiscoverability() {
        return global.MobileExperience?.shouldShowDiscoverabilityUi?.() !== false;
    }

    function canOfferPromo() {
        return !isPromoSuppressed() && isDesktopDiscoverability();
    }

    function t(key, fallback) {
        const fullKey = `dashboard.${key}`;
        const value = global.dashboardInstance?.language?.t?.(fullKey);
        return value && value !== fullKey ? value : fallback;
    }

    function isPromoDeferred() {
        if (document.body.classList.contains('loading')) return true;
        if (global.DashboardTagCloud?.modalOpen) return true;
        if (document.querySelector('.feature-spotlight.show')) return true;
        const overlay = document.getElementById('app-modal');
        if (overlay?.classList.contains('show')) return true;
        if (document.querySelector('.onboarding-overlay, .feature-tour-overlay')) return true;
        if (global.dashboardInstance?.searchComponent?.isActive?.()) return true;
        if (global.DashboardGridKeyboardPromo?.isPromoOpen?.()) return true;
        if (global.DashboardGJumpPromo?.isPromoOpen?.()) return true;
        if (document.querySelector('.dashboard-search-promo')) return true;
        if (global.DashboardFeaturePromos?.isAnyOpen?.()) return true;
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
        document.removeEventListener('keydown', boundPromoKeydown, true);
        boundPromoKeydown = null;
    }

    function removePromoFromDom() {
        unbindReposition();
        unbindPromoKeydown();
        promoEl?.remove();
        promoEl = null;
        categoryEl = null;
    }

    function isPromoOpen() {
        return promoEl?.isConnected === true;
    }

    function dismissPopover() {
        blockUnderlyingClicksBriefly();
        removePromoFromDom();
    }

    function confirmPromo() {
        if (isPromoSuppressed()) {
            dismissPopover();
            return;
        }
        blockUnderlyingClicksBriefly();
        markConfirmedInStorage();
        removePromoFromDom();
    }

    function attachPromoButtonHandlers(wrap) {
        const closeBtn = wrap.querySelector('.dashboard-smart-collection-promo-close');

        closeBtn?.addEventListener('mousedown', (event) => {
            stopPromoEvent(event);
        }, true);
        closeBtn?.addEventListener('click', (event) => {
            stopPromoEvent(event);
            confirmPromo();
        }, true);
    }

    function bindPromoKeydown() {
        if (boundPromoKeydown) return;
        boundPromoKeydown = (event) => {
            if (!isPromoOpen()) return;

            const closeBtn = promoEl?.querySelector('.dashboard-smart-collection-promo-close');
            if (!closeBtn) return;

            if (event.key === 'Escape') {
                stopPromoEvent(event);
                confirmPromo();
                return;
            }

            if (event.key === 'Enter' && document.activeElement === closeBtn) {
                stopPromoEvent(event);
                confirmPromo();
            }
        };
        document.addEventListener('keydown', boundPromoKeydown, true);
    }

    function focusCloseButton() {
        const closeBtn = promoEl?.querySelector('.dashboard-smart-collection-promo-close');
        closeBtn?.focus({ preventScroll: true });
    }

    function buildPromoElement() {
        const title = t('smartCollectionPromoTitle', 'Smart collection');
        const body = t(
            'smartCollectionPromoBody',
            'This list updates automatically. Inline edit with <kbd>;</kbd> still works — bookmarks stay in their real category.'
        );
        const closeLabel = t('smartCollectionPromoDismiss', 'Got it');

        const wrap = document.createElement('div');
        wrap.className = 'dashboard-smart-collection-promo';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'false');
        wrap.setAttribute('aria-label', title);
        wrap.innerHTML = `
            <div class="dashboard-smart-collection-promo-balloon">
                <span class="dashboard-smart-collection-promo-tail" aria-hidden="true"></span>
                <p class="dashboard-smart-collection-promo-title"></p>
                <div class="dashboard-smart-collection-promo-text"></div>
                <div class="dashboard-smart-collection-promo-actions">
                    <button type="button" class="dashboard-smart-collection-promo-close"></button>
                </div>
            </div>`;
        wrap.querySelector('.dashboard-smart-collection-promo-title').textContent = title;
        wrap.querySelector('.dashboard-smart-collection-promo-text').innerHTML = body;
        wrap.querySelector('.dashboard-smart-collection-promo-close').textContent = closeLabel;
        attachPromoButtonHandlers(wrap);
        return wrap;
    }

    function getAnchorRect() {
        if (!(categoryEl instanceof HTMLElement) || !categoryEl.isConnected) {
            return null;
        }

        const titleEl = categoryEl.querySelector('.category-title') || categoryEl;
        const titleRect = titleEl.getBoundingClientRect();
        if (titleRect.width < 1 && titleRect.height < 1) {
            return null;
        }

        const pageNav = document.getElementById('page-navigation');
        const pageNavRect = pageNav?.getBoundingClientRect();
        if (pageNavRect && pageNavRect.height > 0 && titleRect.top <= pageNavRect.bottom + 32) {
            return pageNavRect;
        }

        return titleRect;
    }

    function positionPromo() {
        if (!promoEl) {
            return;
        }

        const anchorRect = getAnchorRect();
        if (!anchorRect) {
            return;
        }

        promoEl.style.visibility = 'hidden';
        promoEl.style.display = 'block';
        promoEl.style.right = 'auto';
        promoEl.style.bottom = 'auto';

        const balloon = promoEl.querySelector('.dashboard-smart-collection-promo-balloon');
        const balloonRect = balloon?.getBoundingClientRect();
        const initialWidth = balloonRect?.width || 280;
        const height = balloonRect?.height || 120;
        const placement = global.DashboardPromoPlacement.positionBesideAnchor(anchorRect, initialWidth, height);

        promoEl.style.width = `${Math.round(placement.width)}px`;
        promoEl.style.maxWidth = `${Math.round(placement.width)}px`;
        promoEl.classList.remove(
            'dashboard-smart-collection-promo--above',
            'dashboard-smart-collection-promo--beside-right',
            'dashboard-smart-collection-promo--beside-left'
        );
        promoEl.classList.add(
            placement.placeRight
                ? 'dashboard-smart-collection-promo--beside-right'
                : 'dashboard-smart-collection-promo--beside-left'
        );
        promoEl.style.left = `${Math.round(placement.left)}px`;
        promoEl.style.top = `${Math.round(placement.top)}px`;
        promoEl.style.visibility = 'visible';
    }

    function bindReposition() {
        if (boundReposition) return;
        boundReposition = () => positionPromo();
        window.addEventListener('scroll', boundReposition, true);
        window.addEventListener('resize', boundReposition);
    }

    function showPromoForCategory(element) {
        if (global.DashboardPromoRegistry?.areDiscoverabilityPromosPaused?.()) {
            return;
        }
        if (!canOfferPromo() || isPromoDeferred() || !(element instanceof HTMLElement)) {
            return;
        }
        if (element.getAttribute('data-smart-collection') !== 'true') {
            return;
        }
        if (isPromoOpen()) {
            return;
        }

        global.DashboardPromoRegistry?.dismissCompetingBalloonPromos?.('smartCollection');
        removePromoFromDom();
        categoryEl = element;
        promoEl = buildPromoElement();
        document.body.appendChild(promoEl);
        bindReposition();
        bindPromoKeydown();
        requestAnimationFrame(() => {
            positionPromo();
            focusCloseButton();
        });
    }

    function onFirstNavigation(element) {
        showPromoForCategory(element);
    }

    function bindFocusListener() {
        if (boundFocusIn) return;
        const layout = document.getElementById('dashboard-layout');
        if (!layout) return;

        boundFocusIn = (event) => {
            if (!canOfferPromo() || isPromoOpen()) return;
            const title = event.target.closest?.('.smart-collection-title');
            if (!title) return;
            const category = title.closest('.category[data-smart-collection="true"]');
            if (!category) return;
            if (event.target !== title && !title.contains(event.target)) return;
            showPromoForCategory(category);
        };
        layout.addEventListener('focusin', boundFocusIn, true);
    }

    bindFocusListener();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindFocusListener, { once: true });
    }

    global.DashboardSmartCollectionPromo = {
        onFirstNavigation,
        isPromoOpen,
        confirmPromo,
        dismissPopover,
        hasSeenPromo: isPromoSuppressed,
        isPromoSuppressed,
        shouldBlockUnderlyingClick,
        dismissPromo: confirmPromo,
        clearPromoSeen() {
            removePromoFromDom();
            global.DiscoverabilityState?.clearStorageKey?.(PROMO_CONFIRMED_KEY);
            try {
                localStorage.removeItem(PROMO_CONFIRMED_KEY);
            } catch {
                // Ignore storage errors.
            }
        },
    };
}(window));
