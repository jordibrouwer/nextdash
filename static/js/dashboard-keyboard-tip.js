/**
 * Occasional keyboard tips.
 *
 * Shows one cheat-sheet tip as a toast. The tips themselves are not a new list:
 * they are the same translated strings Config → Help renders, read from
 * window.ConfigHelpTips, so the two can never drift apart.
 *
 * What actually limits the frequency is DiscoverabilityState.tipsAllowedNow(),
 * held server-side: at most one tip in any 24 hours, across reloads, tabs and
 * devices. `shownThisLoad` below is only a within-page-load guard so the auto-start timer and a manual call cannot both
 * fire; it is not the rate limit and resets on every reload.
 *
 * Deliberately conservative. v2026.07.17 removed every tour, spotlight and promo
 * balloon, so this only earns its place by staying rare and easy to switch off:
 * one tip per 24 hours at most, each tip once ever, never over a modal or during
 * onboarding, and a single toggle in Config → General.
 */
(function initKeyboardTip(global) {
    'use strict';

    const SHOW_DELAY_MS = 6000;
    const RETRY_MS = 1500;
    const MAX_RETRIES = 20;

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

    /** Tip ids in catalog order, flattened out of the Config → Help groups. */
    function allTipIds() {
        const groups = global.ConfigHelpTips?.TIP_GROUPS;
        if (!Array.isArray(groups)) return [];
        return groups.flatMap((g) => (Array.isArray(g.tips) ? g.tips : []));
    }

    function tipText(id) {
        const lang = dash()?.language;
        if (!lang?.t) return '';
        const full = `config.${id}`;
        const value = lang.t(full);
        return value && value !== full ? value : '';
    }

    function pickTip() {
        const state = global.DiscoverabilityState;
        const ids = allTipIds().filter((id) => tipText(id));
        if (!ids.length) return null;
        const unseen = state?.hasSeenTip
            ? ids.filter((id) => !state.hasSeenTip(id))
            : ids;
        if (!unseen.length) return null;
        return unseen[Math.floor(Math.random() * unseen.length)];
    }

    function shouldShow() {
        const d = dash();
        if (!d || shownThisLoad) return false;
        if (d.settings?.enableSessionTips === false) return false;
        // No tips in the public demo: the bar and the tour already speak.
        if (global.DemoLock?.on) return false;
        // The block-move intro (animation and card) has the screen until it is answered.
        if (document.body.classList.contains('is-block-move-intro')) return false;

        // Whether unprompted UI may take the screen is one shared question,
        // answered by dashboard-promos.js for every module that asks it. A tip
        // does compete with the start guide bar, so it does not take the
        // what's-new prompt's exemption.
        if (typeof d.promos?.canShowUnpromptedUi === 'function') {
            if (!d.promos.canShowUnpromptedUi()) return false;
        } else {
            // promos is part of the same bundle, so this only happens if the tip
            // timer fires mid-construction. Falling back to the same checks
            // rather than showing regardless: the point of the gate is that an
            // unprompted toast never lands on top of something else.
            if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
            if (document.body.classList.contains('bookmark-inline-edit-active')) return false;
            if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
            if (document.querySelector('.quickstart-card')) return false;
        }

        return global.DiscoverabilityState?.tipsAllowedNow?.() !== false;
    }

    function show() {
        const d = dash();
        // Guard here as well as in attempt(): show() is the public entry point and
        // the auto-start timer can still be pending when something else calls it.
        if (shownThisLoad) return false;
        const id = pickTip();
        if (!id) return false;
        const html = tipText(id);
        if (!html) return false;

        const label = t('sessionTipLabel', 'Tip');
        // Tip strings are our own translated markup (they contain <code>), never
        // user input, so inserting them as HTML is safe here.
        const message = `<strong class="app-notification-tip-label">${label}</strong> ${html}`;

        const opts = {
            duration: 12000,
            actionLabel: t('sessionTipAction', 'Cheat sheet'),
            onAction: () => {
                if (typeof d.showKeyboardCheatSheet === 'function') {
                    d.showKeyboardCheatSheet();
                }
            },
            allowHtml: true,
        };

        // 'promo', not 'info': this is an unprompted tip on a 12s timer, and
        // AppNotification lets a real notification take the slot from a promo
        // rather than queue behind it. Sent as 'info' it held the queue, so a
        // confirmation for something the user had just done — a delete and its
        // Undo — waited out the tip and effectively never appeared.
        if (global.AppNotification?.show) {
            global.AppNotification.show(message, 'promo', opts);
        } else {
            return false;
        }

        shownThisLoad = true;
        clearTimeout(timer);
        timer = null;
        global.DiscoverabilityState?.markTipSeen?.(id);
        global.DiscoverabilityState?.noteTipShown?.();
        global.nextdashTrack?.('tip:shown', { tip: id });
        return true;
    }

    function attempt() {
        if (shownThisLoad) return;
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

    function autoStart() {
        clearTimeout(timer);
        retries = 0;
        timer = setTimeout(attempt, SHOW_DELAY_MS);
    }

    global.DashboardKeyboardTip = { autoStart, attempt, show, shouldShow, pickTip };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoStart, { once: true });
    } else {
        autoStart();
    }
}(typeof window !== 'undefined' ? window : globalThis));
