/**
 * When the weekly digest's corner card shows.
 *
 * Pure rules, kept apart from the card so they can be tested without a
 * browser: the state goes in, the answer comes out, and the caller keeps the
 * state where it likes (digest-notice.js writes it to localStorage).
 *
 *   - Fresh: the card shows on every load until it is answered.
 *   - "Got it", the x and reading the digest all end it: the card does not
 *     come back until the next digest.
 *
 * State written by older versions carries extra fields (snooze, reminders);
 * they are ignored, and a seenAt for the same digest counts as seen.
 */
(function (global) {
    'use strict';

    function initial(generatedAt) {
        return { generatedAt, seenAt: 0 };
    }

    /** The stored state when it belongs to this digest, a fresh one when it does not. */
    function forSnapshot(stored, generatedAt) {
        if (stored && stored.generatedAt === generatedAt) return stored;
        return initial(generatedAt);
    }

    function shouldShow(s) {
        return !s.seenAt;
    }

    function gotIt(s, now) {
        // Pressing it again keeps the first moment.
        if (s.seenAt) return s;
        return { ...s, seenAt: now };
    }

    global.DigestCardState = { initial, forSnapshot, shouldShow, gotIt };
})(window);
