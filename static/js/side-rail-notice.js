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
 *
 * The card itself (markup, transition, corner etiquette, retry loop) comes from
 * NoticeCard; only the parts below are specific to this invitation.
 */
(function initSideRailNotice(global) {
    'use strict';

    const PROMO_ID = 'side-rail-try-v1';
    const SHOW_DELAY_MS = 7000;

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

    function openLayoutSettings(card) {
        const d = dash();
        card.close();
        if (d?.config?.openConfigView) {
            d.config.appearanceTab = 'layout';
            void d.config.openConfigView('appearance');
            return;
        }
        global.location.hash = 'config/appearance/layout';
    }

    /**
     * Swap the card's body for the "here is how to undo it" follow-up.
     *
     * Whoever just tried the rail is the person most likely to move it again, so
     * the command that does it is named without opening config at all.
     */
    function showApplied(card) {
        const el = card.element;
        if (!el) return;
        el.classList.add('is-applied');
        const title = el.querySelector('.quickstart-title');
        if (title) title.textContent = t('dashboard.sideRailNoticeAppliedTitle', 'Side rail is on');
        const body = el.querySelector('.notice-card-text');
        if (body) {
            body.textContent = t('dashboard.sideRailNoticeAppliedBody',
                'The buttons now sit in a rail down the left edge. Not for you? Switch back under Config → Appearance → Layout, where you can pick any of the five positions.');
        }
        const actions = el.querySelector('.notice-card-actions');
        if (actions) {
            actions.innerHTML = `
                <p class="side-rail-notice-hint">${escape(t('dashboard.sideRailNoticeCommandHint', 'Or switch position any time with'))} <kbd>:buttonbar</kbd></p>
                <button type="button" class="quickstart-btn quickstart-btn-ghost" data-sr-action="open-layout">${escape(t('dashboard.sideRailNoticeOpenLayout', 'Open Layout settings'))}</button>
                <button type="button" class="quickstart-btn quickstart-btn-primary" data-sr-action="done">${escape(t('dashboard.sideRailNoticeDone', 'Got it'))}</button>`;
            actions.querySelector('[data-sr-action="open-layout"]')?.addEventListener('click', () => openLayoutSettings(card));
            actions.querySelector('[data-sr-action="done"]')?.addEventListener('click', () => card.close());
        }
    }

    /**
     * Apply the side rail immediately.
     *
     * setupDOM writes the position onto <body> as data-button-position and the
     * rest is CSS, so the bar moves without a reload — the same path Config →
     * Appearance → Layout and `:buttonbar` use.
     */
    function tryIt(card) {
        const d = dash();
        if (!d?.settings) return;
        markAnswered();
        d.settings.buttonBarPosition = 'side-left';
        d.setupDOM?.();
        void d.saveSettings?.();
        showApplied(card);
    }

    const card = global.NoticeCard.define({
        id: 'side-rail-notice',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.sideRailNoticeTitle', 'Try the side rail'),
        body: () => t('dashboard.sideRailNoticeBody',
            'The add, search, commands, and finders buttons can dock as a vertical rail down the left edge instead of floating at the bottom — handy on wide screens, and it keeps the space under your bookmarks clear.'),
        dismissLabel: () => t('dashboard.sideRailNoticeDismiss', 'Dismiss'),
        // The × and "No thanks" are the same answer here, and existing tests
        // click them through one selector.
        dismissName: 'dismiss',
        canShow: () => {
            if (hasAnswered()) return false;
            // Already using it — nothing to offer.
            return dash()?.settings?.buttonBarPosition !== 'side-left';
        },
        onDismiss: markAnswered,
        actionAttr: 'data-sr-action',
        actions: [
            {
                name: 'try',
                label: () => t('dashboard.sideRailNoticeTry', 'Try it'),
                primary: true,
                onClick: tryIt,
            },
            {
                // Dismissed without trying — a real answer, so it does not come back.
                name: 'dismiss',
                label: () => t('dashboard.sideRailNoticeNoThanks', 'No thanks'),
                onClick: (c) => { markAnswered(); c.close(); },
            },
        ],
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardSideRailNotice = {
        // The sync variants: existing callers and tests treat both results as
        // plain booleans, and this card's gating is synchronous.
        render: card.renderSync,
        shouldShow: card.shouldShowSync,
        dismiss: () => { markAnswered(); card.close(); },
        tryIt: () => tryIt(card),
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
