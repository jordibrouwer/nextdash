/**
 * One-time promo for first G+digit or GG category/bookmark jump.
 */
(function initDashboardGJumpPromo(global) {
    const PROMO_CONFIRMED_KEY = 'nextdash:dashboard-g-jump-promo-confirmed-v1';
    const CLICK_SHIELD_MS = 600;

    let promoEl = null;
    let anchorEl = null;
    let suppressUnderlyingClicksUntil = 0;
    let boundReposition = null;
    let boundPromoKeydown = null;
    let pendingChordHoldAnchor = null;
    let deferredRetryTimer = null;
    let deferredRetryStartedAt = 0;

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
        } catch { /* ignore */ }
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
        if (global.DashboardSmartCollectionPromo?.isPromoOpen?.()) return true;
        if (global.DashboardFeaturePromos?.isAnyOpen?.()) return true;
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
        const closeBtn = wrap.querySelector('.dashboard-g-jump-promo-close');
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
            const closeBtn = promoEl?.querySelector('.dashboard-g-jump-promo-close');
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
        promoEl?.querySelector('.dashboard-g-jump-promo-close')?.focus({ preventScroll: true });
    }

    function buildPromoElement() {
        const title = t('gJumpPromoTitle', 'Jump with G');
        const body = t(
            'gJumpPromoBody',
            'Hold <kbd>G</kbd> (~300&nbsp;ms) — then <kbd>1</kbd>–<kbd>9</kbd> jumps to a category or smart collection · quick tap <kbd>G</kbd> opens shortcuts starting with G · <kbd>G</kbd><kbd>G</kbd> jumps to the first bookmark'
        );
        const closeLabel = t('gJumpPromoDismiss', 'Got it');

        const wrap = document.createElement('div');
        wrap.className = 'dashboard-g-jump-promo';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'false');
        wrap.setAttribute('aria-label', title);
        wrap.innerHTML = `
            <div class="dashboard-g-jump-promo-balloon">
                <span class="dashboard-g-jump-promo-tail" aria-hidden="true"></span>
                <p class="dashboard-g-jump-promo-title"></p>
                <div class="dashboard-g-jump-promo-text"></div>
                <div class="dashboard-g-jump-promo-actions">
                    <button type="button" class="dashboard-g-jump-promo-close"></button>
                </div>
            </div>`;
        wrap.querySelector('.dashboard-g-jump-promo-title').textContent = title;
        wrap.querySelector('.dashboard-g-jump-promo-text').innerHTML = body;
        wrap.querySelector('.dashboard-g-jump-promo-close').textContent = closeLabel;
        attachPromoButtonHandlers(wrap);
        return wrap;
    }

    function getAnchorRect() {
        if (!(anchorEl instanceof HTMLElement) || !anchorEl.isConnected) {
            return null;
        }
        const category = anchorEl.closest?.('.category[data-category-id]');
        const titleEl = category?.querySelector('.category-title') || anchorEl;
        const rect = titleEl.getBoundingClientRect();
        if (rect.width < 1 && rect.height < 1) {
            return anchorEl.getBoundingClientRect();
        }
        return rect;
    }

    function positionPromo() {
        if (!promoEl) return;
        const anchorRect = getAnchorRect();
        if (!anchorRect || (anchorRect.width < 1 && anchorRect.height < 1)) {
            return;
        }

        promoEl.style.visibility = 'hidden';
        promoEl.style.display = 'block';
        promoEl.style.right = 'auto';
        promoEl.style.bottom = 'auto';

        const balloon = promoEl.querySelector('.dashboard-g-jump-promo-balloon');
        const balloonRect = balloon?.getBoundingClientRect();
        const initialWidth = balloonRect?.width || 280;
        const height = balloonRect?.height || 120;
        const placement = global.DashboardPromoPlacement.positionBesideAnchor(anchorRect, initialWidth, height);

        promoEl.style.width = `${Math.round(placement.width)}px`;
        promoEl.style.maxWidth = `${Math.round(placement.width)}px`;
        promoEl.classList.remove(
            'dashboard-g-jump-promo--beside-right',
            'dashboard-g-jump-promo--beside-left'
        );
        promoEl.classList.add(
            placement.placeRight
                ? 'dashboard-g-jump-promo--beside-right'
                : 'dashboard-g-jump-promo--beside-left'
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

    function clearDeferredChordHoldRetry() {
        pendingChordHoldAnchor = null;
        if (deferredRetryTimer) {
            clearInterval(deferredRetryTimer);
            deferredRetryTimer = null;
        }
        deferredRetryStartedAt = 0;
    }

    function scheduleDeferredChordHoldRetry() {
        if (!pendingChordHoldAnchor || deferredRetryTimer) {
            return;
        }
        deferredRetryStartedAt = Date.now();
        deferredRetryTimer = setInterval(() => {
            if (!pendingChordHoldAnchor) {
                clearDeferredChordHoldRetry();
                return;
            }
            if (Date.now() - deferredRetryStartedAt > 30000) {
                clearDeferredChordHoldRetry();
                return;
            }
            if (isPromoDeferred()) {
                return;
            }
            const anchor = pendingChordHoldAnchor;
            clearDeferredChordHoldRetry();
            showPromoForAnchor(anchor);
        }, 400);
    }

    function showPromoForAnchor(element) {
        if (global.DashboardPromoRegistry?.areDiscoverabilityPromosPaused?.()) {
            return false;
        }
        if (!canOfferPromo() || isPromoDeferred() || !(element instanceof HTMLElement)) {
            return false;
        }
        if (isPromoOpen()) {
            return true;
        }

        global.DashboardPromoRegistry?.dismissCompetingBalloonPromos?.('gJump');
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
        return true;
    }

    function onFirstCategoryJump(categoryEl) {
        if (!categoryEl || categoryEl.getAttribute('data-smart-collection') === 'true') {
            return false;
        }
        const anchor = categoryEl.querySelector('.bookmark-link[data-bookmark-index]') || categoryEl;
        return showPromoForAnchor(anchor);
    }

    function onFirstGgJump(bookmarkEl) {
        return showPromoForAnchor(bookmarkEl);
    }

    /** First time chord mode activates (hold G ~300 ms) — hint before G+digit / GG. */
    function onFirstChordHold(anchorEl) {
        if (!(anchorEl instanceof HTMLElement)) {
            return false;
        }
        if (isPromoDeferred()) {
            pendingChordHoldAnchor = anchorEl;
            scheduleDeferredChordHoldRetry();
            return false;
        }
        clearDeferredChordHoldRetry();
        return showPromoForAnchor(anchorEl);
    }

    global.DashboardGJumpPromo = {
        onFirstCategoryJump,
        onFirstGgJump,
        onFirstChordHold,
        isPromoOpen,
        confirmPromo,
        dismissPopover,
        hasSeenPromo: isPromoSuppressed,
        isPromoSuppressed,
        shouldBlockUnderlyingClick,
        dismissPromo: confirmPromo,
        clearPromoSeen() {
            removePromoFromDom();
            clearDeferredChordHoldRetry();
            global.DiscoverabilityState?.clearStorageKey?.(PROMO_CONFIRMED_KEY);
            try {
                localStorage.removeItem(PROMO_CONFIRMED_KEY);
            } catch { /* ignore */ }
        },
    };
}(window));
