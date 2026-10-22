/**
 * One-time invitation to try Berry, the default theme for new installs.
 *
 * Someone who already has a dashboard keeps the theme they have; this asks once
 * whether to switch. "Try Berry" always applies the dark half, whatever
 * theme they are on now, then offers to go back; "Not interested" is a final answer.
 *
 * The card itself (markup, transition, corner etiquette, retry loop) comes from
 * NoticeCard.
 */
(function initBerryThemeNotice(global) {
    'use strict';

    const PROMO_ID = 'berry-theme-try-v1';
    const DARK = 'look-berry-dark';
    // After the theme browser invitation; the corner holds one card at a time.
    const SHOW_DELAY_MS = 16000;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const value = lang.t(key);
        return value && value !== key ? value : fallback;
    }

    function hasAnswered() {
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(PROMO_ID) === true;
    }

    function markAnswered() {
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    function currentTheme() {
        return String(dash()?.settings?.theme || '');
    }

    const escape = window.NextDashHtml.escapeHtml;

    /**
     * Switch, and keep the card: it turns into "Go back" and "Keep Berry",
     * so trying it costs one click to undo. `previous` is the theme the reader
     * had, as stored.
     */
    function tryIt(card) {
        markAnswered();
        const d = dash();
        const previous = currentTheme();
        void d?.config?.setTheme?.(DARK);
        const el = card.element;
        if (!el) return;
        el.classList.add('is-applied');
        const title = el.querySelector('.quickstart-title');
        if (title) title.textContent = t('dashboard.berryNoticeAppliedTitle', 'Berry is on');
        const body = el.querySelector('.notice-card-text');
        if (body) body.textContent = t('dashboard.berryNoticeAppliedBody', 'Not what you expected? Go back to the theme you had.');
        const actions = el.querySelector('.notice-card-actions');
        if (!actions) return;
        actions.innerHTML = `
            <button type="button" class="quickstart-btn quickstart-btn-ghost" data-ct-action="back">${escape(t('dashboard.berryNoticeBack', 'Go back'))}</button>
            <button type="button" class="quickstart-btn quickstart-btn-primary" data-ct-action="keep">${escape(t('dashboard.berryNoticeKeep', 'Keep Berry'))}</button>`;
        actions.querySelector('[data-ct-action="back"]')?.addEventListener('click', () => {
            card.close();
            if (previous) void dash()?.config?.setTheme?.(previous);
        });
        actions.querySelector('[data-ct-action="keep"]')?.addEventListener('click', () => card.close());
    }

    const card = global.NoticeCard.define({
        id: 'berry-theme-notice',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.berryNoticeTitle', 'Try the new default theme?'),
        body: () => t('dashboard.berryNoticeBody',
            'New installs start on Berry, with lime and raspberry light spilling in from the edge of the frame. Switch to it now, and change back any time under Config → Appearance.'),
        dismissLabel: () => t('dashboard.berryNoticeDismiss', 'Dismiss'),
        dismissName: 'dismiss',
        // Already on Berry, or a random theme rotating, means nothing to offer.
        canShow: () => {
            if (hasAnswered()) return false;
            if (/^look-berry-(dark|light)$/.test(currentTheme())) return false;
            const mode = dash()?.settings?.randomThemeMode;
            return !mode || mode === 'off';
        },
        onDismiss: markAnswered,
        actionAttr: 'data-ct-action',
        actions: [
            {
                name: 'try',
                label: () => t('dashboard.berryNoticeTry', 'Try Berry'),
                primary: true,
                onClick: tryIt,
            },
            {
                name: 'dismiss',
                label: () => t('dashboard.berryNoticeNo', 'Not interested'),
                onClick: (c) => { markAnswered(); c.close(); },
            },
        ],
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardBerryNotice = {
        render: card.renderSync,
        shouldShow: card.shouldShowSync,
        dismiss: () => { markAnswered(); card.close(); },
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
