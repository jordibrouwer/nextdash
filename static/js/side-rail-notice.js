/**
 * One-time invitation to try the side rail.
 *
 * The button bar can dock as a vertical rail down the left edge instead of
 * floating center-bottom. It is a large visual change that nobody discovers by
 * reading a settings list, so it is offered once, in place, with a button that
 * applies it there and then.
 *
 * Deliberately a single ask, matching the analytics notice next to it: dismiss
 * it without trying and it never returns. The "seen" flag lives in
 * DiscoverabilityState (persisted server-side), so the answer follows the user
 * across devices rather than living in one browser's localStorage.
 *
 * Trying it does not close the card — it swaps to a follow-up telling you where
 * to switch it back off, because a change this large with no visible way back is
 * how you lose someone's trust.
 */
(function initSideRailNotice(global) {
    'use strict';

    const PROMO_ID = 'side-rail-try-v1';
    const SHOW_DELAY_MS = 7000;
    const RETRY_MS = 1500;
    const MAX_ATTEMPTS = 20;

    let cardEl = null;
    let pending = null;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const value = lang.t(key);
        return value && value !== key ? value : fallback;
    }

    function escape(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function hasAnswered() {
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(PROMO_ID) === true;
    }

    /** Records the answer; each user is asked once, ever. */
    function markAnswered() {
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    /**
     * The same corner etiquette the analytics notice follows: never over a
     * modal, never during onboarding, and never on top of another card.
     */
    function shouldShow() {
        const d = dash();
        if (!d?.settings) return false;
        if (cardEl) return false;
        if (hasAnswered()) return false;
        // Already using it — nothing to offer.
        if (d.settings.buttonBarPosition === 'side-left') return false;
        if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (d.onboardingStartedInSession) return false;
        if (d.settings.onboardingCompleted === false) return false;
        // Config, health and inbox are hash routes on this page; only interrupt
        // the bookmarks view.
        if (d.activeView && d.activeView !== 'bookmarks') return false;
        if (document.querySelector('.quickstart-card:not(.side-rail-notice-card)')) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        if (document.querySelector('.whats-new-modal')) return false;
        if (document.body.classList.contains('bookmark-inline-edit-active')) return false;
        return true;
    }

    function teardown() {
        const el = cardEl;
        if (!el) return;
        cardEl = null;
        el.classList.remove('show');
        setTimeout(() => { if (el.isConnected) el.remove(); }, 260);
    }

    /** Dismissed without trying — a real answer, so it does not come back. */
    function dismiss() {
        markAnswered();
        teardown();
    }

    /**
     * Apply the side rail immediately.
     *
     * setupDOM writes the position onto <body> as data-button-position and the
     * rest is CSS, so the bar moves without a reload — the same path Config →
     * Appearance → Layout and `:buttonbar` use.
     */
    function tryIt() {
        const d = dash();
        if (!d?.settings) return;
        markAnswered();
        d.settings.buttonBarPosition = 'side-left';
        d.setupDOM?.();
        void d.saveSettings?.();
        showApplied();
    }

    /** Swap the card's body for the "here is how to undo it" follow-up. */
    function showApplied() {
        const el = cardEl;
        if (!el) return;
        el.classList.add('is-applied');
        const title = el.querySelector('.quickstart-title');
        if (title) title.textContent = t('dashboard.sideRailNoticeAppliedTitle', 'Side rail is on');
        const body = el.querySelector('.side-rail-notice-text');
        if (body) {
            body.textContent = t('dashboard.sideRailNoticeAppliedBody',
                'The buttons now sit in a rail down the left edge. Not for you? Switch back under Config → Appearance → Layout, where you can pick any of the five positions.');
        }
        // Whoever just tried the rail is the person most likely to move it again,
        // so name the command that does it without opening config at all. The
        // hint sits below the buttons: useful once, never in the way.
        const hint = el.querySelector('.side-rail-notice-hint');
        if (hint) {
            hint.innerHTML = `${escape(t('dashboard.sideRailNoticeCommandHint', 'Or switch position any time with'))} <kbd>:buttonbar</kbd>`;
            hint.hidden = false;
        }
        const actions = el.querySelector('.side-rail-notice-actions');
        if (actions) {
            actions.innerHTML = `
                <button type="button" class="quickstart-btn quickstart-btn-ghost" data-sr-action="open-layout">${escape(t('dashboard.sideRailNoticeOpenLayout', 'Open Layout settings'))}</button>
                <button type="button" class="quickstart-btn quickstart-btn-primary" data-sr-action="done">${escape(t('dashboard.sideRailNoticeDone', 'Got it'))}</button>`;
            actions.querySelector('[data-sr-action="open-layout"]')?.addEventListener('click', openLayoutSettings);
            actions.querySelector('[data-sr-action="done"]')?.addEventListener('click', teardown);
        }
    }

    function openLayoutSettings() {
        const d = dash();
        teardown();
        if (d?.config?.openConfigView) {
            d.config.appearanceTab = 'layout';
            void d.config.openConfigView('appearance');
            return;
        }
        global.location.hash = 'config/appearance/layout';
    }

    /** @returns {boolean} whether the card was actually put on screen. */
    function render() {
        if (!shouldShow()) return false;

        const el = document.createElement('div');
        el.className = 'quickstart-card side-rail-notice-card';
        el.setAttribute('role', 'complementary');
        el.setAttribute('aria-label', t('dashboard.sideRailNoticeTitle', 'Try the side rail'));
        el.innerHTML = `
            <div class="quickstart-stripe"></div>
            <div class="quickstart-inner">
                <div class="quickstart-head">
                    <p class="quickstart-title">${escape(t('dashboard.sideRailNoticeTitle', 'Try the side rail'))}</p>
                    <button type="button" class="quickstart-close" data-sr-action="dismiss"
                            aria-label="${escape(t('dashboard.sideRailNoticeDismiss', 'Dismiss'))}">×</button>
                </div>
                <p class="side-rail-notice-text">${escape(t('dashboard.sideRailNoticeBody',
                    'The add, search, commands, and finders buttons can dock as a vertical rail down the left edge instead of floating at the bottom — handy on wide screens, and it keeps the space under your bookmarks clear.'))}</p>
                <div class="side-rail-notice-actions">
                    <button type="button" class="quickstart-btn quickstart-btn-primary" data-sr-action="try">${escape(t('dashboard.sideRailNoticeTry', 'Try it'))}</button>
                    <button type="button" class="quickstart-btn quickstart-btn-ghost" data-sr-action="dismiss">${escape(t('dashboard.sideRailNoticeNoThanks', 'No thanks'))}</button>
                </div>
                <p class="side-rail-notice-hint" hidden></p>
            </div>`;

        el.querySelectorAll('[data-sr-action="dismiss"]').forEach((btn) => {
            btn.addEventListener('click', dismiss);
        });
        el.querySelector('[data-sr-action="try"]')?.addEventListener('click', tryIt);

        document.body.appendChild(el);
        cardEl = el;
        requestAnimationFrame(() => el.classList.add('show'));
        return true;
    }

    /**
     * Poll briefly after load: the corner may be busy with the quick start, the
     * release notes, or the analytics notice, and this is worth waiting for
     * rather than burning the single chance to offer it.
     */
    function autoStart() {
        let attempts = 0;
        const tick = () => {
            attempts += 1;
            if (cardEl || hasAnswered()) return;
            if (render()) return;
            if (attempts < MAX_ATTEMPTS) {
                pending = setTimeout(tick, RETRY_MS);
            }
        };
        pending = setTimeout(tick, SHOW_DELAY_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoStart, { once: true });
    } else {
        autoStart();
    }

    global.DashboardSideRailNotice = {
        render,
        shouldShow,
        dismiss,
        tryIt,
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
