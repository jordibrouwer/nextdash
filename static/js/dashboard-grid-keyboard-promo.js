/**
 * One-time promo for first keyboard arrow selection on the bookmark grid.
 */
(function initDashboardGridKeyboardPromo(global) {
    const PROMO_CONFIRMED_KEY = 'nextdash:dashboard-grid-keyboard-promo-confirmed-v1';
    const CLICK_SHIELD_MS = 600;

    let promoEl = null;
    let anchorEl = null;
    let suppressUnderlyingClicksUntil = 0;
    let boundReposition = null;
    let boundPromoKeydown = null;

    function readConfirmedFromStorage() {
        try {
            return localStorage.getItem(PROMO_CONFIRMED_KEY) === '1';
        } catch {
            return false;
        }
    }

    function markConfirmedInStorage() {
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
        if (global.DashboardSmartCollectionPromo?.isPromoOpen?.()) return true;
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
        anchorEl = null;
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
        const closeBtn = wrap.querySelector('.dashboard-grid-kbd-promo-close');

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

            const closeBtn = promoEl?.querySelector('.dashboard-grid-kbd-promo-close');
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
        const closeBtn = promoEl?.querySelector('.dashboard-grid-kbd-promo-close');
        closeBtn?.focus({ preventScroll: true });
    }

    function buildPromoElement() {
        const title = t('gridKeyboardPromoTitle', 'Keyboard navigation');
        const body = t(
            'gridKeyboardPromoBody',
            '<kbd>Enter</kbd> open · <kbd>;</kbd> inline edit · <kbd>G</kbd> then <kbd>1</kbd>–<kbd>9</kbd> for categories & smart collections · drag the left strip to reorder · long-press a row to edit on touch'
        );
        const closeLabel = t('gridKeyboardPromoDismiss', 'Got it');

        const wrap = document.createElement('div');
        wrap.className = 'dashboard-grid-kbd-promo';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'false');
        wrap.setAttribute('aria-label', title);
        wrap.innerHTML = `
            <div class="dashboard-grid-kbd-promo-balloon">
                <span class="dashboard-grid-kbd-promo-tail" aria-hidden="true"></span>
                <p class="dashboard-grid-kbd-promo-title"></p>
                <div class="dashboard-grid-kbd-promo-text"></div>
                <div class="dashboard-grid-kbd-promo-actions">
                    <button type="button" class="dashboard-grid-kbd-promo-close"></button>
                </div>
            </div>`;
        wrap.querySelector('.dashboard-grid-kbd-promo-title').textContent = title;
        wrap.querySelector('.dashboard-grid-kbd-promo-text').innerHTML = body;
        wrap.querySelector('.dashboard-grid-kbd-promo-close').textContent = closeLabel;
        attachPromoButtonHandlers(wrap);
        return wrap;
    }

    function positionPromo() {
        if (!promoEl || !anchorEl?.isConnected) {
            return;
        }

        const rect = anchorEl.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) {
            return;
        }

        promoEl.style.visibility = 'hidden';
        promoEl.style.display = 'block';
        promoEl.style.right = 'auto';
        promoEl.style.bottom = 'auto';

        const balloon = promoEl.querySelector('.dashboard-grid-kbd-promo-balloon');
        const balloonRect = balloon?.getBoundingClientRect();
        const initialWidth = balloonRect?.width || 280;
        const height = balloonRect?.height || 120;
        const placement = global.DashboardPromoPlacement.positionBesideAnchor(rect, initialWidth, height);

        promoEl.style.width = `${Math.round(placement.width)}px`;
        promoEl.style.maxWidth = `${Math.round(placement.width)}px`;
        promoEl.classList.remove(
            'dashboard-grid-kbd-promo--above',
            'dashboard-grid-kbd-promo--beside-right',
            'dashboard-grid-kbd-promo--beside-left'
        );
        promoEl.classList.add(
            placement.placeRight
                ? 'dashboard-grid-kbd-promo--beside-right'
                : 'dashboard-grid-kbd-promo--beside-left'
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

    function showPromoForAnchor(element) {
        if (!canOfferPromo() || isPromoDeferred() || !(element instanceof HTMLElement)) {
            return;
        }

        removePromoFromDom();
        anchorEl = element;
        promoEl = buildPromoElement();
        document.body.appendChild(promoEl);
        bindReposition();
        bindPromoKeydown();
        requestAnimationFrame(() => {
            positionPromo();
            focusCloseButton();
        });
    }

    function onFirstArrowSelection(element) {
        if (!canOfferPromo() || promoEl?.isConnected) {
            return;
        }
        showPromoForAnchor(element);
    }

    function onSelectionAnchorChanged(element) {
        if (!isPromoOpen() || !(element instanceof HTMLElement)) {
            return;
        }
        anchorEl = element;
        positionPromo();
    }

    global.DashboardGridKeyboardPromo = {
        onFirstArrowSelection,
        onSelectionAnchorChanged,
        isPromoOpen,
        confirmPromo,
        dismissPopover,
        hasSeenPromo: isPromoSuppressed,
        isPromoSuppressed,
        shouldBlockUnderlyingClick,
        dismissPromo: confirmPromo,
        clearPromoSeen() {
            removePromoFromDom();
            try {
                localStorage.removeItem(PROMO_CONFIRMED_KEY);
            } catch {
                // Ignore storage errors.
            }
        },
    };
}(window));
