/**
 * "When was this last opened?" as a short label plus a precise tooltip.
 *
 * Deliberately not the inbox's formatRelativeTime, which counts days forever
 * ("94d ago"). That reads fine for a triage queue measured in days, but a
 * bookmark's last open is often months back, where a day count stops being
 * something you can picture and a date is what you actually want.
 *
 * The scale therefore narrows as it goes: minutes while it is still happening,
 * named days either side of today, a day count for the past week, then dates.
 * The exact timestamp always survives in the tooltip, so nothing is lost by
 * rounding the label.
 */
(function (global) {
    'use strict';

    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;

    /** Midnight at the start of the day `date` falls in, in local time. */
    function startOfDay(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    /**
     * Whole days between two moments, counted by calendar day rather than by
     * elapsed hours: 23:59 yesterday to 00:01 today is "yesterday", not "0d".
     */
    function calendarDaysBetween(then, now) {
        return Math.round((startOfDay(now) - startOfDay(then)) / DAY);
    }

    /**
     * @param {number} timestamp   Unix milliseconds; 0 or missing means never.
     * @param {object} [options]
     * @param {(key: string, fallback: string, params?: object) => string} [options.t]
     *        Translator; falls back to the English text when absent.
     * @param {string} [options.locale]  BCP-47 tag for the date formats.
     * @param {number} [options.now]     Injectable clock, for tests.
     * @returns {{label: string, title: string, never: boolean}}
     */
    function formatLastOpened(timestamp, options = {}) {
        const t = typeof options.t === 'function'
            ? options.t
            : (key, fallback, params) => interpolate(fallback, params);
        const value = Number(timestamp || 0);
        const now = Number(options.now) || Date.now();

        if (!value || value <= 0) {
            const label = t('dashboard.healthNeverOpened', 'never opened');
            return { label, title: label, never: true };
        }

        const locale = options.locale || document.documentElement.lang || undefined;
        const date = new Date(value);
        const title = formatFullDate(date, locale);
        const diff = now - value;

        // A clock skew or a bookmark opened "in the future" would otherwise fall
        // through to a negative minute count.
        if (diff < MINUTE) {
            return { label: t('dashboard.healthOpenedJustNow', 'just opened'), title, never: false };
        }
        if (diff < HOUR) {
            const count = Math.floor(diff / MINUTE);
            return { label: t('dashboard.healthOpenedMinutes', '{count}m ago', { count }), title, never: false };
        }

        const days = calendarDaysBetween(date, new Date(now));
        if (days <= 0) {
            // Same calendar day. Hours read better than "today" while it is still
            // recent enough to remember doing it.
            const hours = Math.floor(diff / HOUR);
            return {
                label: hours < 1
                    ? t('dashboard.healthOpenedToday', 'today')
                    : t('dashboard.healthOpenedHours', '{count}h ago', { count: hours }),
                title,
                never: false,
            };
        }
        if (days === 1) {
            return { label: t('dashboard.healthOpenedYesterday', 'yesterday'), title, never: false };
        }
        if (days < 7) {
            return { label: t('dashboard.healthOpenedDays', '{count}d ago', { count: days }), title, never: false };
        }

        // Beyond a week a date is more use than a count. The year is dropped
        // within the last twelve months, where it is redundant.
        const withinAYear = days < 365;
        return {
            label: withinAYear ? formatDayMonth(date, locale) : formatMonthYear(date, locale),
            title,
            never: false,
        };
    }

    function formatFullDate(date, locale) {
        try {
            return new Intl.DateTimeFormat(locale, {
                dateStyle: 'full',
                timeStyle: 'short',
            }).format(date);
        } catch {
            return date.toLocaleString();
        }
    }

    function formatDayMonth(date, locale) {
        try {
            return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date);
        } catch {
            return date.toLocaleDateString();
        }
    }

    function formatMonthYear(date, locale) {
        try {
            return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(date);
        } catch {
            return date.toLocaleDateString();
        }
    }

    /** Minimal {placeholder} substitution for the untranslated fallbacks. */
    function interpolate(text, params) {
        if (!params) return text;
        return Object.entries(params).reduce(
            (out, [key, val]) => out.replace(new RegExp(`\\{${key}\\}`, 'g'), String(val)),
            String(text)
        );
    }

    global.formatLastOpened = formatLastOpened;
}(typeof window !== 'undefined' ? window : globalThis));
