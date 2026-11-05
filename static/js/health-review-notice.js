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
 * It is offered as a quiet row in the notifications bell, not in the corner.
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

    /**
     * The bell row: how many links are worth a session, or null when the offer
     * is off, done for today, held by the weekly digest, or below the line.
     */
    async function reviewState() {
        /*
         * A switch of its own, in Behavior → General.
         *
         * Until now the only way to stop this offer was to switch off link
         * checking, which is a far heavier thing to give up than the
         * offer: the checking is the feature, the offer is the reminder.
         * Default on, so an install that never answered keeps what it has.
         */
        if (dash()?.settings?.enableHealthReviewNotice === false) return null;
        // "Done for today" at the end of a session still means what it says.
        if (isDoneToday()) return null;
        if (dash()?.health?.isEnabled?.() === false) return null;
        // The weekly digest offers the same links; on its day it goes first.
        if (await global.DigestNotice?.holdsTheWeek?.()) return null;
        const counts = await reviewCounts();
        if (!counts || counts.total < MIN_TO_OFFER) return null;
        lastCounts = counts;
        const detail = describeCounts(counts);
        const title = t('dashboard.healthReviewNoticeTitle', '{count} links to review', { count: counts.total });
        return { count: counts.total, text: detail ? `${title}: ${detail}` : title };
    }

    const card = global.NoticeCard.define({
        id: 'health-review-notice',
        title: () => t('dashboard.healthReviewNoticeTitle', '{count} links to review',
            { count: Math.min(SESSION_SIZE, lastCounts?.total || SESSION_SIZE) }),
        bell: {
            kind: 'quiet',
            group: 'cleanup',
            icon: '\u{1FA7A}',
            no: 'state',
            state: reviewState,
            actions: [
                {
                    label: () => t('dashboard.healthReviewNoticeStart', 'Start'),
                    primary: true,
                    onClick: () => { void start(); },
                },
            ],
        },
    });

    /*
     * The second row: the last link check is old and nothing is going to run
     * another.
     *
     * Background re-checks are on by default, so this only meets an install
     * that switched them off. Switching them off is a fine answer; what it
     * leaves is a Health view quietly going out of date, and the way to learn
     * that was to open it. So once the newest check is over a week old the
     * bell says so, and offers the two ways out: check now, or let the
     * server do it every day. Turning it on is an explicit write, never a
     * migration of the stored false.
     */
    const RECHECK_STALE_DAYS = 7;
    const DAY_MS = 24 * 60 * 60 * 1000;

    function recheckTrack(action) {
        global.nextdashTrack?.('health-recheck-offer', { action });
    }

    let lastCheckAgeDays = RECHECK_STALE_DAYS;

    /** Whole days and time of the newest check, or null when the offer has no ground. */
    async function staleCheck() {
        const summary = await global.HealthBadgeUtils?.fetchBookmarkHealthSummary?.();
        if (!summary || !(Number(summary.monitoredCount) > 0)) return null;
        const at = Number(summary.lastCheckedAt) || 0;
        if (!at) return null;
        const days = Math.floor((Date.now() - at) / DAY_MS);
        return days >= RECHECK_STALE_DAYS ? { days, at } : null;
    }

    async function recheckNow() {
        const fetcher = typeof global.nextDashFetch === 'function' ? global.nextDashFetch : global.fetch;
        try {
            await fetcher('/api/health/retest-all?scope=all', { method: 'POST' });
            await dash()?.updateHealthBadge?.();
            // The newest check is new now, so the row has nothing left to say.
            void global.NotificationBell?.refreshAll?.();
        } catch {
            /* the health view reports a failed check itself */
        }
    }

    async function recheckEveryDay() {
        const d = dash();
        if (!d?.settings) return;
        d.settings.healthAutoRecheckEnabled = true;
        d.settings.healthAutoRecheckIntervalHours = 24;
        try { await d.saveSettings?.({ keys: ['healthAutoRecheckEnabled', 'healthAutoRecheckIntervalHours'] }); } catch { /* the setting stays visible in Behavior */ }
    }

    /**
     * The bell row: how many days since the newest check, once that is a week
     * or more. The date of that check is the row's id, so "No" holds until a
     * newer check has come and gone stale again.
     */
    async function recheckState() {
        const settings = dash()?.settings;
        if (settings?.enableHealthRecheckNotice === false) return null;
        if (settings?.healthAutoRecheckEnabled !== false) return null;
        if (dash()?.health?.isEnabled?.() === false) return null;
        const stale = await staleCheck();
        if (!stale) return null;
        lastCheckAgeDays = stale.days;
        return {
            count: stale.days,
            ids: [new Date(stale.at).toISOString().slice(0, 10)],
            text: t('dashboard.healthRecheckOfferTitle', 'Last link check was {days} days ago', { days: stale.days }),
        };
    }

    const recheckCard = global.NoticeCard.define({
        id: 'health-recheck-offer',
        title: () => t('dashboard.healthRecheckOfferTitle', 'Last link check was {days} days ago',
            { days: lastCheckAgeDays }),
        bell: {
            kind: 'quiet',
            group: 'cleanup',
            icon: '\u{1F50E}',
            no: 'state',
            state: recheckState,
            actions: [
                {
                    label: () => t('dashboard.healthRecheckOfferNow', 'Re-check now'),
                    primary: true,
                    onClick: () => { recheckTrack('now'); void recheckNow(); },
                },
                {
                    label: () => t('dashboard.healthRecheckOfferEveryDay', 'Every day'),
                    onClick: () => {
                        recheckTrack('auto');
                        // Turning the daily check on makes the row's own gate false.
                        void recheckEveryDay().then(() => global.NotificationBell?.refreshAll?.());
                    },
                },
            ],
        },
    });

    global.HealthRecheckOffer = {
        STALE_DAYS: RECHECK_STALE_DAYS,
        state: recheckState,
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
        state: reviewState,
    };
}(typeof window !== 'undefined' ? window : globalThis));
