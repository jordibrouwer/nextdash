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
     * Open the health view and start the session there.
     *
     * Deliberately through the health view rather than over the dashboard: the
     * session is health's own mechanic, Escape has to land somewhere that makes
     * sense, and the rows behind the card are the ones being worked through.
     */
    async function start({ limit = SESSION_SIZE } = {}) {
        const d = dash();
        if (!d?.health) return false;
        await d.health.openHealthView();
        const module = d.health._module || d.health;
        // The report is what the queue is built from, so a view opened before
        // its first load has nothing to offer yet.
        if (!module?.report) {
            await module?.loadAndRender?.({ refresh: false });
        }
        return Boolean(module?.focus?.openSession({ limit }));
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
            if (isDoneToday()) return false;
            if (dash()?.health?.isEnabled?.() === false) return false;
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
        ],
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.HealthReviewSession = {
        SESSION_SIZE,
        MIN_TO_OFFER,
        start,
        reviewCounts,
        describeCounts,
        isDoneToday,
        markDoneToday,
        render: card.render,
        shouldShow: card.shouldShow,
    };
}(typeof window !== 'undefined' ? window : globalThis));
