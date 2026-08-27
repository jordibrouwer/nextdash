/**
 * One-time invitation to open the theme browser.
 *
 * There are over two hundred themes and a browser built to make choosing one
 * pleasant — a grid of families, a search field, a light/dark switch per card,
 * favourites, and a live preview on the real dashboard as you move through it.
 * None of that is discoverable from the dashboard: it is three clicks deep,
 * behind Config → Appearance → Browse, and someone who never goes looking never
 * learns their dashboard can look like anything else.
 *
 * So the card does not describe it — it opens it. The browser previews on the
 * page behind it, so "try it" and "look at it" are the same gesture, and
 * closing without picking leaves the theme exactly as it was.
 *
 * Trying it does not close the card. It swaps to a follow-up naming where the
 * browser lives, because someone who has just changed their whole colour scheme
 * is the person most likely to want to change it again — the same shape the
 * side-rail invitation next to it uses.
 *
 * The card itself (markup, transition, corner etiquette, retry loop) comes from
 * NoticeCard; only the parts below are specific to this invitation.
 */
(function initThemeBrowserNotice(global) {
    'use strict';

    const PROMO_ID = 'theme-browser-try-v1';
    // Later than the side-rail card's seven seconds. Both are one-time asks and
    // the corner only holds one, so the queue decides which lands first rather
    // than the two racing; this one waits because a colour scheme is a bigger
    // thing to be asked about than where four buttons sit.
    const SHOW_DELAY_MS = 12000;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const value = lang.t(key);
        return value && value !== key ? value : fallback;
    }

    const escape = window.NextDashHtml.escapeHtml;

    function hasAnswered() {
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(PROMO_ID) === true;
    }

    /** Records the answer; each user is asked once, ever. */
    function markAnswered() {
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    /**
     * Swap the card's body for the "here is where it lives" follow-up.
     *
     * Shown whether or not a theme was picked: the browser is where you go to
     * change your mind either way, and someone who closed it without choosing
     * still now knows it exists.
     */
    function showOpened(card) {
        const el = card.element;
        if (!el) return;
        el.classList.add('is-applied');
        const title = el.querySelector('.quickstart-title');
        if (title) title.textContent = t('dashboard.themeBrowserNoticeOpenedTitle', 'Change it whenever you like');
        const body = el.querySelector('.notice-card-text');
        if (body) {
            body.textContent = t('dashboard.themeBrowserNoticeOpenedBody',
                'The browser lives under Config → Appearance → Browse, and every theme comes as a light and a dark half. Nothing is saved until you pick one.');
        }
        const actions = el.querySelector('.notice-card-actions');
        if (actions) {
            actions.innerHTML = `
                <p class="theme-browser-notice-hint">${escape(t('dashboard.themeBrowserNoticeCommandHint', 'Or switch theme without leaving the page with'))} <kbd>:theme</kbd></p>
                <button type="button" class="quickstart-btn quickstart-btn-ghost" data-tb-action="open-appearance">${escape(t('dashboard.themeBrowserNoticeOpenAppearance', 'Open appearance settings'))}</button>
                <button type="button" class="quickstart-btn quickstart-btn-primary" data-tb-action="done">${escape(t('dashboard.themeBrowserNoticeDone', 'Got it'))}</button>`;
            actions.querySelector('[data-tb-action="open-appearance"]')
                ?.addEventListener('click', () => openAppearance(card));
            actions.querySelector('[data-tb-action="done"]')?.addEventListener('click', () => card.close());
        }
    }

    function openAppearance(card) {
        const d = dash();
        card.close();
        if (d?.config?.openConfigView) {
            d.config.appearanceTab = 'general';
            void d.config.openConfigView('appearance');
            return;
        }
        global.location.hash = 'config/appearance';
    }

    /**
     * Open the browser itself, from here.
     *
     * openThemeBrowser is config's own — it fetches the colour document and the
     * theme list, then hands both to ThemeBrowser with the preview, favourite
     * and pick callbacks already wired. Reached through the config loader's
     * proxy, which fetches the module first, so this works on a page where
     * config has never been opened.
     */
    function tryIt(card) {
        const d = dash();
        markAnswered();
        showOpened(card);
        if (!d?.config?.openThemeBrowser) {
            global.location.hash = 'config/appearance';
            return;
        }
        void Promise.resolve(d.config.openThemeBrowser()).catch(() => {
            // The module or the colour document did not arrive. The settings
            // screen is the same destination by a slower road.
            global.location.hash = 'config/appearance';
        });
    }

    const card = global.NoticeCard.define({
        id: 'theme-browser-notice',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.themeBrowserNoticeTitle', 'Your dashboard can look like anything'),
        body: () => t('dashboard.themeBrowserNoticeBody',
            'Over two hundred themes, as a grid you can search rather than a list you have to scroll. Each one previews on this page while you look at it, and nothing is saved until you choose — so it costs nothing to find out.'),
        dismissLabel: () => t('dashboard.themeBrowserNoticeDismiss', 'Dismiss'),
        // The × and "No thanks" are the same answer here, as on the side-rail
        // card, so both reach it through one selector.
        dismissName: 'dismiss',
        /*
         * Asked once, and of everyone.
         *
         * The first draft skipped anyone not still on the packaged default, on
         * the theory that changing your theme means you found the browser. It
         * does not: `:theme`, the Appearance dropdown and the setup card all
         * change the theme without ever showing the grid, the search field, the
         * favourites or the live preview — which are the whole reason to
         * mention it. That gate hid the invitation from precisely the readers
         * who like themes enough to have picked one.
         *
         * There is no honest test for "has seen the browser", so there is no
         * gate beyond the one every card has.
         */
        canShow: () => !hasAnswered(),
        onDismiss: markAnswered,
        actionAttr: 'data-tb-action',
        actions: [
            {
                name: 'try',
                label: () => t('dashboard.themeBrowserNoticeTry', 'Browse themes'),
                primary: true,
                onClick: tryIt,
            },
            {
                // Dismissed without looking — a real answer, so it does not come back.
                name: 'dismiss',
                label: () => t('dashboard.themeBrowserNoticeNoThanks', 'No thanks'),
                onClick: (c) => { markAnswered(); c.close(); },
            },
        ],
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardThemeBrowserNotice = {
        render: card.renderSync,
        shouldShow: card.shouldShowSync,
        dismiss: () => { markAnswered(); card.close(); },
        tryIt: () => tryIt(card),
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
