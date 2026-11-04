/**
 * Occasional keyboard tips.
 *
 * One cheat-sheet tip at a time waits in the notifications bell (group Tips)
 * until it is read. The tips themselves are not a new list: they are the same
 * translated strings Config → Help renders, read from window.ConfigHelpTips,
 * so the two can never drift apart.
 *
 * What limits the frequency is DiscoverabilityState.tipsAllowedNow(), held
 * server-side: at most one tip in any 24 hours, across reloads, tabs and
 * devices. The clock starts when a tip is read, not when it appears, so the
 * next tip is offered only once the previous one is read and a day has passed.
 * The tip waiting in the bell is remembered in localStorage so a reload shows
 * the same one rather than drawing another.
 *
 * Deliberately conservative: each tip once ever, none during onboarding, and a
 * single toggle in Config → General (the row is then simply absent).
 */
(function initKeyboardTip(global) {
    'use strict';

    const CURRENT_KEY = 'nextdash-keyboard-tip-current';
    const ID_PREFIX = 'keyboard-tip:';
    const FIRST_TICK_MS = 4000;
    const TICK_EVERY_MS = 5 * 60 * 1000;

    let bellHandle = null;
    // The tip waiting in the bell, if any; null while none is offered.
    let current = null;

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

    /** The tip as plain text: the bell draws text, and the strings carry <code>. */
    function plainText(html) {
        const holder = document.createElement('template');
        holder.innerHTML = html;
        return holder.content.textContent.trim();
    }

    function bellIdOf(tipId) {
        return `${ID_PREFIX}${tipId}`;
    }

    /** Whether the person has already read this tip's row in the bell. */
    function wasRead(tipId) {
        return Boolean(global.DiscoverabilityState?.getBellRecord?.(bellIdOf(tipId))?.read);
    }

    function remembered() {
        try {
            return global.localStorage?.getItem(CURRENT_KEY) || null;
        } catch {
            return null;
        }
    }

    function remember(tipId) {
        try {
            if (tipId) global.localStorage?.setItem(CURRENT_KEY, tipId);
            else global.localStorage?.removeItem(CURRENT_KEY);
        } catch { /* a reload may then draw another tip: harmless */ }
    }

    /** Tips worth offering: written in this language, not seen, not read in the bell. */
    function candidates() {
        const state = global.DiscoverabilityState;
        return allTipIds().filter((id) => tipText(id)
            && !(state?.hasSeenTip && state.hasSeenTip(id))
            && !wasRead(id));
    }

    function pickTip() {
        const ids = candidates();
        if (!ids.length) return null;
        return ids[Math.floor(Math.random() * ids.length)];
    }

    /** Whether a new tip may be offered at all (not whether one is waiting). */
    function shouldShow() {
        const d = dash();
        if (!d) return false;
        if (d.settings?.enableSessionTips === false) return false;
        // No tips in the public demo: the bar and the tour already speak.
        if (global.DemoLock?.on) return false;
        // Rotating tips are not for phones, as before.
        if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        return global.DiscoverabilityState?.tipsAllowedNow?.() !== false;
    }

    /** The tip is read: count it as shown, the way the toast did, and let go of it. */
    function settle(tipId) {
        global.DiscoverabilityState?.markTipSeen?.(tipId);
        global.DiscoverabilityState?.noteTipShown?.();
        global.nextdashTrack?.('tip:shown', { tip: tipId });
        bellHandle?.unregister();
        bellHandle = null;
        current = null;
        remember(null);
    }

    function source(tipId) {
        return {
            id: bellIdOf(tipId),
            group: 'tips',
            kind: 'tip',
            icon: '\u2328\uFE0F',
            no: 'forever',
            // Switching the tips off in Config takes the row away at the next refresh.
            state: async () => (dash()?.settings?.enableSessionTips === false || global.DemoLock?.on
                ? null
                : { count: 1, text: plainText(tipText(tipId)) }),
            actions: [{
                label: () => t('sessionTipAction', 'Cheat sheet'),
                primary: true,
                marksRead: true,
                onClick: () => dash()?.showKeyboardCheatSheet?.(),
            }],
        };
    }

    /**
     * One look at the bell's tip: settle it if it was read, or put up the next
     * one when none is waiting and the 24 hours allow it. Returns the tip now
     * in the bell, or null.
     */
    function tick() {
        if (!global.NotificationBell || !allTipIds().length) return null;
        if (current && wasRead(current)) settle(current);
        if (!current) {
            const saved = remembered();
            let next = null;
            if (saved && candidates().includes(saved)) next = saved;
            else if (shouldShow()) next = pickTip();
            if (next) {
                current = next;
                remember(next);
                bellHandle = global.NotificationBell.register(source(next));
                void bellHandle.refresh();
            }
        }
        return current;
    }

    let ticker = null;

    function autoStart() {
        if (ticker) return;
        // Shortly after load, then whenever the page is looked at again.
        setTimeout(tick, FIRST_TICK_MS);
        ticker = setInterval(tick, TICK_EVERY_MS);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
    }

    global.DashboardKeyboardTip = { autoStart, shouldShow, pickTip, tick, current: () => current };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoStart, { once: true });
    } else {
        autoStart();
    }
}(typeof window !== 'undefined' ? window : globalThis));
