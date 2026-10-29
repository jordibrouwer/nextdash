/**
 * When the weekly digest's corner card shows.
 *
 * Pure rules, kept apart from the card so they can be tested without a
 * browser: the state goes in, the answer comes out, and the caller keeps the
 * state where it likes (digest-notice.js writes it to localStorage).
 *
 *   - Fresh: the card shows on every load until "Got it".
 *   - Snooze: hidden until the next local midnight, then back, still unseen.
 *   - "Got it": the card comes back once on each of the next two days, then
 *     not until the next digest.
 *   - A reader who closed the digest window gets no reminders.
 *
 * A day is a local calendar day.
 */
(function (global) {
    'use strict';

    const REMINDER_DAYS = 2;

    function dayNumber(ms) {
        const d = new Date(ms);
        return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    }

    function nextMidnight(ms) {
        const d = new Date(ms);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    }

    function initial(generatedAt) {
        return { generatedAt, seenAt: 0, snoozedUntil: 0, remindersDone: 0, windowClosed: false };
    }

    /** The stored state when it belongs to this digest, a fresh one when it does not. */
    function forSnapshot(stored, generatedAt) {
        if (stored && stored.generatedAt === generatedAt) return stored;
        return initial(generatedAt);
    }

    /** Days since "Got it", 0 on the day itself. */
    function daysSinceSeen(s, now) {
        return dayNumber(now) - dayNumber(s.seenAt);
    }

    function shouldShow(s, now) {
        if (s.snoozedUntil && now < s.snoozedUntil) return false;
        if (!s.seenAt) return true;
        if (s.windowClosed) return false;
        const since = daysSinceSeen(s, now);
        return since >= 1 && since <= REMINDER_DAYS && s.remindersDone < since;
    }

    function snooze(s, now) {
        return { ...s, snoozedUntil: nextMidnight(now) };
    }

    function gotIt(s, now) {
        // Pressing it again on a reminder must not start the reminders over:
        // the first press fixes the two days.
        if (s.seenAt) return { ...s, snoozedUntil: 0 };
        return { ...s, seenAt: now, snoozedUntil: 0, remindersDone: 0 };
    }

    function closeWindow(s) {
        return { ...s, windowClosed: true };
    }

    /** The card was drawn: a reminder day is used up, so a reload the same day stays quiet. */
    function shown(s, now) {
        if (!s.seenAt) return s;
        const since = daysSinceSeen(s, now);
        if (since < 1) return s;
        return { ...s, remindersDone: Math.max(s.remindersDone, Math.min(since, REMINDER_DAYS)) };
    }

    global.DigestCardState = { initial, forSnapshot, shouldShow, snooze, gotIt, closeWindow, shown };
})(window);
