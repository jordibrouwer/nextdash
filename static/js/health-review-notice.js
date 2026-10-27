/**
 * Ten links, two minutes — the cleanup as an offer rather than a chore.
 *
 * Work through (`f`) is the best thing in the health view, and it is reachable
 * only from a health filter, by someone who already decided to do maintenance.
 * That is backwards: the decision is the hard part, not the work. So the same
 * mechanic is offered from the dashboard, in the corner the app already uses for
 * invitations, with the size of the job stated up front — "10 links to review:
 * 4 broken, 3 never opened, 3 you have not opened in a year".
 *
 * Bounded and finishable is the whole design. A session takes ten, ends, counts
 * what was dealt with, and can be declared done for the day. A number that never
 * ends is a number people learn to ignore; the Inbox already understands this
 * ("oldest-first is how a backlog actually clears") and this is the same
 * understanding applied to the bookmarks themselves.
 */
(function initHealthReviewNotice(global) {
    'use strict';

    const SESSION_SIZE = 10;
    // Below this the offer is noise: four stale links are not a session, and
    // asking about them teaches people to dismiss the card.
    const MIN_TO_OFFER = 5;
    const DONE_KEY = 'nextdashHealthReviewDoneOn';
    // Deliberately a separate key from DONE_KEY rather than a far-future value
    // in it: isDoneToday() is exported and read at the end of a focus session,
    // where it has to keep meaning exactly "done for today".
    const SNOOZE_KEY = 'nextdashHealthReviewSnoozeUntil';
    const SNOOZE_DAYS = 30;
    const SHOW_DELAY_MS = 9000;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback, vars) {
        const language = dash()?.language;
        let text = fallback;
        if (language && typeof language.t === 'function') {
            const value = language.t(key);
            if (value && value !== key) text = value;
        }
        if (!vars) return text;
        return Object.entries(vars).reduce(
            (acc, [name, value]) => acc.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
            text
        );
    }

    /** Today, in the local day the reader is actually living in. */
    function todayKey() {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${now.getFullYear()}-${month}-${day}`;
    }

    function isDoneToday() {
        try {
            return global.localStorage?.getItem(DONE_KEY) === todayKey();
        } catch {
            // Private browsing, storage disabled: offering the session again is
            // a smaller failure than never offering it.
            return false;
        }
    }

    function markDoneToday() {
        try {
            global.localStorage?.setItem(DONE_KEY, todayKey());
        } catch {
            /* nothing to fall back to, and nothing worth breaking over */
        }
    }

    /**
     * A month of quiet, for someone who is not going to do this now.
     *
     * "Not today" expires overnight, which is right for a postponement and
     * wrong for a decision. Nothing here touches a bookmark: this is only about
     * whether the corner asks. Muting what a bookmark *reports* is the health
     * view's own per-flag ignore, which is a different thing entirely.
     */
    function isSnoozed() {
        try {
            const until = Number(global.localStorage?.getItem(SNOOZE_KEY));
            return Number.isFinite(until) && until > Date.now();
        } catch {
            // Same reasoning as isDoneToday: asking again is the smaller failure.
            return false;
        }
    }

    function remindInThirtyDays() {
        try {
            const until = Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000;
            global.localStorage?.setItem(SNOOZE_KEY, String(until));
        } catch {
            /* nothing to fall back to, and nothing worth breaking over */
        }
    }

    /**
     * The counts behind the offer.
     *
     * Read from the health summary the badge already fetches, so opening the
     * dashboard does not cost a second report build. Only conditions a card can
     * act on are counted — the same four a session is made of.
     */
    async function reviewCounts() {
        const summary = await global.HealthBadgeUtils?.fetchBookmarkHealthSummary?.();
        if (!summary) return null;
        const counts = {
            broken: Number(summary.brokenCount) || 0,
            content: Number(summary.contentCount) || 0,
            unused: Number(summary.unusedCount) || 0,
            stale: Number(summary.staleCount) || 0,
        };
        // Sum, not total rows: a bookmark can be both never opened and broken,
        // so this is an upper bound on the session. The session itself takes ten
        // rows whatever their flags, and says so.
        counts.total = counts.broken + counts.content + counts.unused + counts.stale;
        return counts;
    }

    let lastCounts = null;

    /** "4 broken, 3 never opened, 3 not opened in a year" — only what is there. */
    function describeCounts(counts) {
        const parts = [];
        if (counts.broken) {
            parts.push(t('dashboard.healthReviewPartBroken', '{count} broken', { count: counts.broken }));
        }
        if (counts.content) {
            parts.push(t('dashboard.healthReviewPartContent', '{count} changed', { count: counts.content }));
        }
        if (counts.unused) {
            parts.push(t('dashboard.healthReviewPartUnused', '{count} never opened', { count: counts.unused }));
        }
        if (counts.stale) {
            parts.push(t('dashboard.healthReviewPartStale', '{count} not opened in a year', { count: counts.stale }));
        }
        return parts.join(', ');
    }

    /**
     * Open the Bookmarks view and start the session there: Escape lands on
     * the list the card was taken from, and the rows behind the card are the
     * ones being worked through.
     */
    async function start({ limit = SESSION_SIZE } = {}) {
        const d = dash();
        if (!d?.config) return false;
        history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}#bookmarks`);
        await d.config.openLibraryView();
        const config = d.config.instance || d.config;
        // The queue is built from the report, which the view fetches as it opens.
        await config.refreshBmHealth?.();
        return Boolean(config.startLibraryReviewSession?.({ limit }));
    }

    const card = global.NoticeCard.define({
        id: 'health-review-notice',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.healthReviewNoticeTitle', '{count} links to review',
            { count: Math.min(SESSION_SIZE, lastCounts?.total || SESSION_SIZE) }),
        body: () => {
            const detail = lastCounts ? describeCounts(lastCounts) : '';
            const lead = t('dashboard.healthReviewNoticeBody',
                'Two minutes, one at a time: re-check it, open it, or let it go.');
            return detail ? `${detail}. ${lead}` : lead;
        },
        dismissLabel: () => t('dashboard.healthReviewNoticeDismiss', 'Not today'),
        dismissName: 'later',
        canShow: async () => {
            /*
             * A switch of its own, in Behavior → General.
             *
             * Until now the only way to stop this card was to switch off link
             * checking, which is a far heavier thing to give up than the
             * offer: the checking is the feature, the card is the reminder.
             * Default on, so an install that never answered keeps what it has.
             */
            if (dash()?.settings?.enableHealthReviewNotice === false) return false;
            if (isDoneToday()) return false;
            if (isSnoozed()) return false;
            if (dash()?.health?.isEnabled?.() === false) return false;
            // The weekly digest offers the same links; on its day it goes first.
            if (await global.DigestNotice?.holdsTheWeek?.()) return false;
            const counts = await reviewCounts();
            if (!counts || counts.total < MIN_TO_OFFER) return false;
            lastCounts = counts;
            return true;
        },
        // The × and "Not today" are the same answer: not now, ask again tomorrow.
        onDismiss: markDoneToday,
        actionAttr: 'data-health-review-action',
        actions: [
            {
                name: 'start',
                label: () => t('dashboard.healthReviewNoticeStart', 'Start'),
                primary: true,
                onClick: (handle) => {
                    handle.close();
                    void start();
                },
            },
            {
                name: 'later',
                label: () => t('dashboard.healthReviewNoticeLater', 'Not today'),
                onClick: (handle) => { markDoneToday(); handle.close(); },
            },
            // Not "Ignore": in this app that word means a bookmark's health
            // condition stops being reported. This only postpones the offer.
            {
                name: 'remind',
                quiet: true,
                label: () => t('dashboard.healthReviewNoticeRemindLater', 'Remind me in 30 days'),
                onClick: (handle) => { remindInThirtyDays(); handle.close(); },
            },
        ],
    });

    /*
     * The second card: the last link check is old and nothing is going to run
     * another.
     *
     * Background re-checks are on by default, so this only meets an install
     * that switched them off. Switching them off is a fine answer; what it
     * leaves is a Health view quietly going out of date, and the way to learn
     * that was to open it. So once the newest check is over a week old the
     * corner says so, and offers the two ways out: check now, or let the
     * server do it every day. Turning it on is an explicit write, never a
     * migration of the stored false.
     */
    const RECHECK_STALE_DAYS = 7;
    const RECHECK_DONE_KEY = 'nextdashHealthRecheckOfferDoneOn';
    const RECHECK_SNOOZE_KEY = 'nextdashHealthRecheckOfferSnoozeUntil';
    const DAY_MS = 24 * 60 * 60 * 1000;

    function recheckTrack(action) {
        global.nextdashTrack?.('health-recheck-offer', { action });
    }

    function recheckDoneToday() {
        try { return global.localStorage?.getItem(RECHECK_DONE_KEY) === todayKey(); } catch { return false; }
    }

    function recheckSnoozed() {
        try {
            const until = Number(global.localStorage?.getItem(RECHECK_SNOOZE_KEY));
            return Number.isFinite(until) && until > Date.now();
        } catch { return false; }
    }

    let lastCheckAgeDays = RECHECK_STALE_DAYS;

    /** Whole days since the newest check, or null when the offer has no ground. */
    async function staleCheckDays() {
        const summary = await global.HealthBadgeUtils?.fetchBookmarkHealthSummary?.();
        if (!summary || !(Number(summary.monitoredCount) > 0)) return null;
        const at = Number(summary.lastCheckedAt) || 0;
        if (!at) return null;
        const days = Math.floor((Date.now() - at) / DAY_MS);
        return days >= RECHECK_STALE_DAYS ? days : null;
    }

    async function recheckNow() {
        const fetcher = typeof global.nextDashFetch === 'function' ? global.nextDashFetch : global.fetch;
        try {
            await fetcher('/api/health/retest-all?scope=all', { method: 'POST' });
            await dash()?.updateHealthBadge?.();
        } catch {
            /* the health view reports a failed check itself; the card has closed */
        }
    }

    async function recheckEveryDay() {
        const d = dash();
        if (!d?.settings) return;
        d.settings.healthAutoRecheckEnabled = true;
        d.settings.healthAutoRecheckIntervalHours = 24;
        try { await d.saveSettings?.(); } catch { /* the setting stays visible in Behavior */ }
    }

    const recheckCard = global.NoticeCard.define({
        id: 'health-recheck-offer',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.healthRecheckOfferTitle', 'Last link check was {days} days ago',
            { days: lastCheckAgeDays }),
        body: () => t('dashboard.healthRecheckOfferBody',
            'Re-check your links now, or let nextDash re-check them every day.'),
        dismissLabel: () => t('dashboard.healthRecheckOfferLater', 'Not now'),
        dismissName: 'later',
        canShow: async () => {
            const settings = dash()?.settings;
            if (settings?.enableHealthRecheckNotice === false) return false;
            if (settings?.healthAutoRecheckEnabled !== false) return false;
            if (recheckDoneToday() || recheckSnoozed()) return false;
            if (dash()?.health?.isEnabled?.() === false) return false;
            // One health card at a time; the review offer goes first.
            if (document.querySelector('.health-review-notice-card')) return false;
            const days = await staleCheckDays();
            if (days === null) return false;
            lastCheckAgeDays = days;
            return true;
        },
        onShown: () => recheckTrack('shown'),
        onDismiss: () => { markRecheckDone(); recheckTrack('later'); },
        actionAttr: 'data-health-recheck-action',
        actions: [
            {
                name: 'now',
                label: () => t('dashboard.healthRecheckOfferNow', 'Re-check now'),
                primary: true,
                onClick: (handle) => { recheckTrack('now'); handle.close(); void recheckNow(); },
            },
            {
                name: 'auto',
                label: () => t('dashboard.healthRecheckOfferEveryDay', 'Every day'),
                onClick: (handle) => { recheckTrack('auto'); handle.close(); void recheckEveryDay(); },
            },
            {
                name: 'later',
                label: () => t('dashboard.healthRecheckOfferLater', 'Not now'),
                onClick: (handle) => { markRecheckDone(); recheckTrack('later'); handle.close(); },
            },
            {
                name: 'remind',
                quiet: true,
                label: () => t('dashboard.healthRecheckOfferRemind', 'Remind me in 30 days'),
                onClick: (handle) => {
                    try { global.localStorage?.setItem(RECHECK_SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * DAY_MS)); } catch { /* storage off */ }
                    recheckTrack('remind');
                    handle.close();
                },
            },
        ],
    });

    function markRecheckDone() {
        try { global.localStorage?.setItem(RECHECK_DONE_KEY, todayKey()); } catch { /* storage off */ }
    }

    global.HealthRecheckOffer = {
        STALE_DAYS: RECHECK_STALE_DAYS,
        render: recheckCard.render,
        shouldShow: recheckCard.shouldShow,
        isSnoozed: recheckSnoozed,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
        document.addEventListener('DOMContentLoaded', recheckCard.autoStart, { once: true });
    } else {
        card.autoStart();
        recheckCard.autoStart();
    }

    global.HealthReviewSession = {
        SESSION_SIZE,
        MIN_TO_OFFER,
        start,
        reviewCounts,
        describeCounts,
        isDoneToday,
        markDoneToday,
        isSnoozed,
        remindInThirtyDays,
        render: card.render,
        shouldShow: card.shouldShow,
    };
}(typeof window !== 'undefined' ? window : globalThis));
