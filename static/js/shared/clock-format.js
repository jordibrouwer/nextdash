/*
 * One clock for the whole app.
 *
 * There is a Time format setting — 12h or 24h, 24h by default — and until now
 * only the line above the bookmarks read it. Everywhere else asked Intl for
 * whatever the locale prefers, so an install set to 24h showed "It's 15:10" in
 * the header and "Worked out at 03:10 PM" in config Statistics on the same
 * screen.
 *
 * Built by hand rather than through Intl's hour12 option because the setting is
 * a choice, not a locale preference: Intl will still reorder or annotate the
 * result per locale, and the header has always printed a plain zero-padded
 * HH:MM. This keeps every clock in the app identical to that one.
 *
 * Loaded from the document head so the lazily fetched modules can reach it.
 */
(function (global) {
    'use strict';

    /**
     * HH:MM, or hh:MM AM/PM when the reader asked for a 12-hour clock.
     *
     * settings may be absent — a caller that has not loaded them yet gets the
     * documented default rather than a crash. `seconds` adds :SS, for the log
     * viewer, where the order of two lines in the same minute is the point.
     */
    function formatTime(date, settings, options) {
        const when = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
        const wantSeconds = !!(options && options.seconds);
        const hours24 = when.getHours();
        const minutes = String(when.getMinutes()).padStart(2, '0');
        const tail = wantSeconds ? `:${String(when.getSeconds()).padStart(2, '0')}` : '';

        if (settings && settings.timeFormat === '12h') {
            const period = hours24 >= 12 ? 'PM' : 'AM';
            const hours12 = hours24 % 12 || 12;
            return `${String(hours12).padStart(2, '0')}:${minutes}${tail} ${period}`;
        }
        return `${String(hours24).padStart(2, '0')}:${minutes}${tail}`;
    }

    global.NextDashClock = { formatTime };
})(window);
