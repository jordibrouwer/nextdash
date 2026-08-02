/**
 * One-time themed toast: Shift+B opens the new-bookmark form.
 *
 * Waits until the tab is visible and focused, onboarding is done, and no other
 * toast or corner feature card is on screen — then shows once (server-backed via
 * discoverabilityState.seenTips). Respects enableSessionTips like keyboard tips.
 */
(function initShiftBAddBookmarkPromo(global) {
    'use strict';

    const PROMO_ID = 'promoShiftBAddBookmark';
    const INITIAL_DELAY_MS = 8000;
    const RETRY_MS = 1500;
    const MAX_RETRIES = 48;
    const TOAST_DURATION_MS = 14000;

    let shownThisLoad = false;
    let retries = 0;
    let timer = null;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const full = `dashboard.${key}`;
        const value = lang.t(full);
        return value && value !== full ? value : fallback;
    }

    function isAppActivelyUsed() {
        return document.visibilityState === 'visible' && document.hasFocus();
    }

    /** True when another toast, modal, or corner feature card owns attention. */
    function isOtherUiVisible() {
        if (document.querySelector('.quickstart-card')) return true;
        if (document.getElementById('app-modal')?.classList.contains('show')) return true;
        if (document.getElementById('bookmark-form-modal')?.classList.contains('show')) return true;
        if (document.getElementById('app-notification')?.classList.contains('show')) return true;
        if (document.body.classList.contains('bookmark-inline-edit-active')) return true;
        if (document.body.classList.contains('bookmark-form-modal-open')) return true;
        if (document.querySelector('.config-setting-promo.is-visible')) return true;
        const d = dash();
        if (d?.searchComponent?.isActive?.()) return true;
        return false;
    }

    function shouldShow() {
        const d = dash();
        if (!d?.settings || shownThisLoad) return false;
        if (global.DiscoverabilityState?.hasSeenTip?.(PROMO_ID)) return false;
        if (d.settings.enableSessionTips === false) return false;
        if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (d.onboardingStartedInSession) return false;
        if (!d.settings.onboardingCompleted) return false;
        if (d.activeView && d.activeView !== 'bookmarks') return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        if (!isAppActivelyUsed()) return false;
        if (isOtherUiVisible()) return false;
        return true;
    }

    function markSeen(options = {}) {
        global.DiscoverabilityState?.markTipSeen?.(PROMO_ID, options);
    }

    function show() {
        if (shownThisLoad || !shouldShow()) return false;

        const label = t('shiftBAddBookmarkPromoLabel', 'New shortcut');
        const body = t(
            'shiftBAddBookmarkPromo',
            'Press <code>Shift+B</code> to add a bookmark from anywhere on the dashboard.'
        );
        const message = `<strong class="app-notification-promo-label">${label}</strong> ${body}`;
        const opts = {
            duration: TOAST_DURATION_MS,
            allowHtml: true,
            actionLabel: t('shiftBAddBookmarkPromoAction', 'Add bookmark'),
            onAction: () => {
                dash()?.quickAddWidget?.open?.();
            },
        };

        if (!global.AppNotification?.show) return false;
        global.AppNotification.show(message, 'promo', opts);

        shownThisLoad = true;
        clearTimeout(timer);
        timer = null;
        markSeen();
        global.nextdashTrack?.('promo:shift-b-add-bookmark');
        return true;
    }

    function attempt() {
        if (shownThisLoad || global.DiscoverabilityState?.hasSeenTip?.(PROMO_ID)) return;
        if (!shouldShow()) {
            retries += 1;
            if (retries <= MAX_RETRIES) {
                timer = setTimeout(attempt, RETRY_MS);
            }
            return;
        }
        if (!show()) {
            retries += 1;
            if (retries <= MAX_RETRIES) {
                timer = setTimeout(attempt, RETRY_MS);
            }
        }
    }

    function schedule() {
        clearTimeout(timer);
        retries = 0;
        timer = setTimeout(attempt, INITIAL_DELAY_MS);
    }

    function onActivityChange() {
        if (shownThisLoad || global.DiscoverabilityState?.hasSeenTip?.(PROMO_ID)) return;
        if (!timer && retries === 0) {
            schedule();
            return;
        }
        if (shouldShow() && !shownThisLoad) {
            attempt();
        }
    }

    global.DashboardShiftBPromo = { schedule, attempt, show, shouldShow, markSeen, PROMO_ID };

    document.addEventListener('visibilitychange', onActivityChange);
    window.addEventListener('focus', onActivityChange, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', schedule, { once: true });
    } else {
        schedule();
    }
}(typeof window !== 'undefined' ? window : globalThis));
