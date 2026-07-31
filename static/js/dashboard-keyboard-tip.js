/**
 * Occasional keyboard tips.
 *
 * Shows one cheat-sheet tip as a toast. The tips themselves are not a new list:
 * they are the same translated strings Config → Help renders, read from
 * window.ConfigHelpTips, so the two can never drift apart.
 *
 * What actually limits the frequency is TIP_GAP_MS, held server-side in
 * discoverabilityState.tipsNotBefore: after a tip, no other tip may appear for
 * several days, across reloads, tabs and devices. `shownThisLoad` below is only
 * a within-page-load guard so the auto-start timer and a manual call cannot both
 * fire; it is not the rate limit and resets on every reload.
 *
 * Deliberately conservative. v2026.07.17 removed every tour, spotlight and promo
 * balloon, so this only earns its place by staying rare and easy to switch off:
 * a multi-day gap between tips, each tip once ever, never over a modal or during
 * onboarding, and a single toggle in Config → General.
 */
(function initKeyboardTip(global) {
    'use strict';

    // The real rate limit: enough of a gap that a tip is a pleasant surprise
    // rather than a fixture. Persisted server-side, so it holds across devices.
    const TIP_GAP_MS = 3 * 24 * 60 * 60 * 1000;
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
        // Same gating as the other post-onboarding prompts: not during first run,
        // not on touch, not while something else owns the screen.
        if (d.promos?.canShowPostOnboardingPrompts?.() === false) return false;
        if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (document.body.classList.contains('bookmark-inline-edit-active')) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        // Never compete with the quick-start or analytics cards for attention.
        if (document.querySelector('.quickstart-card')) return false;

        const notBefore = Number(global.DiscoverabilityState?.getTipsNotBefore?.() || 0);
        if (notBefore && Date.now() < notBefore) return false;
        return true;
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

        if (global.AppNotification?.show) {
            global.AppNotification.show(message, 'info', opts);
        } else {
            return false;
        }

        shownThisLoad = true;
        clearTimeout(timer);
        timer = null;
        global.DiscoverabilityState?.markTipSeen?.(id);
        global.DiscoverabilityState?.setTipsNotBefore?.(Date.now() + TIP_GAP_MS);
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

    /**
     * One-time hint the first time config opens — separate from the occasional
     * dashboard tips so it never waits on tipsNotBefore.
     */
    function showConfigIntro() {
        const TIP_ID = 'tipConfigKeyboard';
        if (global.DiscoverabilityState?.hasSeenTip?.(TIP_ID)) return false;
        const d = dash();
        if (!d?.settings || d.settings.enableSessionTips === false) return false;
        if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        if (d.searchComponent?.isActive?.()) return false;

        const html = tipText(TIP_ID);
        if (!html) return false;

        const label = t('sessionTipLabel', 'Tip');
        const message = `<strong class="app-notification-tip-label">${label}</strong> ${html}`;
        const opts = {
            duration: 14000,
            actionLabel: t('sessionTipAction', 'Cheat sheet'),
            onAction: () => {
                if (typeof d.showKeyboardCheatSheet === 'function') {
                    d.showKeyboardCheatSheet();
                }
            },
            allowHtml: true,
        };

        if (!global.AppNotification?.show) return false;
        global.AppNotification.show(message, 'info', opts);
        global.DiscoverabilityState?.markTipSeen?.(TIP_ID);
        global.nextdashTrack?.('tip:shown', { tip: TIP_ID, context: 'config-intro' });
        return true;
    }

    global.DashboardKeyboardTip = { autoStart, attempt, show, shouldShow, pickTip, showConfigIntro };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoStart, { once: true });
    } else {
        autoStart();
    }
}(typeof window !== 'undefined' ? window : globalThis));
