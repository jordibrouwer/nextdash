/**
 * Clock and Countdown: two widgets that need nothing but a clock.
 *
 * Both are drawn from their own settings and the browser's time, so there is
 * no service to ask, no cache and no error state to design: a zone the browser
 * does not know is said to be unknown, and a date that does not parse is said
 * to be missing. Each keeps one timer on its own body and drops it as soon as
 * the body leaves the page, so a widget closed or a grid drawn again leaves
 * nothing running.
 */
(function () {
    'use strict';

    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    /** One timer per body: drawn again, the old one goes first; gone from the page, it stops itself. */
    function keepTicking(body, everyMs, redraw) {
        if (body._ndTimeTimer) clearInterval(body._ndTimeTimer);
        body._ndTimeTimer = setInterval(() => {
            if (!body.isConnected) {
                clearInterval(body._ndTimeTimer);
                body._ndTimeTimer = null;
                return;
            }
            redraw();
        }, everyMs);
    }

    /* ---------- Clock ---------- */

    /** "London=Europe/London" → { name: 'London', zone: 'Europe/London' }; a bare zone names itself by its city. */
    function parseZone(entry) {
        const text = String(entry || '').trim();
        const at = text.indexOf('=');
        const zone = (at >= 0 ? text.slice(at + 1) : text).trim();
        const named = at >= 0 ? text.slice(0, at).trim() : '';
        const city = zone.split('/').pop().replace(/_/g, ' ');
        return { name: named || city || zone, zone };
    }

    function formatIn(zone, date, config) {
        const base = { hour: '2-digit', minute: '2-digit', hour12: config.hour12 === true };
        return new Intl.DateTimeFormat(undefined, zone ? { ...base, timeZone: zone } : base).format(date);
    }

    /** The calendar day in a zone as a comparable number, to say "tomorrow" or "yesterday". */
    function dayNumber(zone, date) {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(date);
        const get = (type) => Number(parts.find((p) => p.type === type)?.value);
        return Math.floor(Date.UTC(get('year'), get('month') - 1, get('day')) / 86400000);
    }

    function drawClock(body, widget, dash) {
        const u = U();
        const config = widget?.config || {};
        const panel = u.panel(body);
        const zones = (Array.isArray(config.zones) ? config.zones : []).map(parseZone).filter((z) => z.zone);
        const now = new Date();

        // Always the reader's own time first: a second place is read against it.
        const rows = [{ name: label(dash, 'dashboard.widgetClockHere', 'Here'), zone: '' }, ...zones];
        const list = u.rowList(false);
        rows.forEach((row) => {
            let text;
            let detail = '';
            let tone;
            try {
                text = formatIn(row.zone, now, config);
                const delta = dayNumber(row.zone, now) - dayNumber('', now);
                if (delta === 1) detail = label(dash, 'dashboard.widgetClockTomorrow', 'tomorrow');
                else if (delta === -1) detail = label(dash, 'dashboard.widgetClockYesterday', 'yesterday');
            } catch (_error) {
                text = label(dash, 'dashboard.widgetClockUnknownZone', 'unknown zone');
                tone = 'warn';
            }
            const el = u.row(row.name, detail ? `${text} · ${detail}` : text, tone);
            list.appendChild(el);
        });
        panel.appendChild(list);
        if (config.showDate === true) {
            panel.appendChild(u.footnote(new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(now)));
        }
        // On the minute, give or take: a tile that shows hours and minutes has
        // no use for a faster beat.
        keepTicking(body, 20000, () => drawClock(body, widget, dash));
    }

    /* ---------- Countdown ---------- */

    function targetOf(config) {
        const date = String(config.date || '');
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
        if (!m) return null;
        const time = /^(\d{2}):(\d{2})$/.exec(String(config.time || ''));
        // Local time: "my birthday" is midnight where the reader is.
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), time ? Number(time[1]) : 0, time ? Number(time[2]) : 0);
    }

    function drawCountdown(body, widget, dash) {
        const u = U();
        const config = widget?.config || {};
        const panel = u.panel(body);
        const target = targetOf(config);
        if (!target) {
            // A date that was cleared: the timer of the countdown it used to be goes too.
            if (body._ndTimeTimer) { clearInterval(body._ndTimeTimer); body._ndTimeTimer = null; }
            u.say(panel, 'dashboard-widget-empty', label(dash, 'dashboard.widgetCountdownNoDate',
                'Pick a date in this widget’s settings.'));
            return;
        }
        const now = new Date();
        const ms = target.getTime() - now.getTime();
        const past = ms < 0;
        const abs = Math.abs(ms);
        const days = Math.floor(abs / 86400000);
        const hours = Math.floor((abs % 86400000) / 3600000);
        const minutes = Math.floor((abs % 3600000) / 60000);
        const useTime = config.showTime === true || (config.time && days < 2);

        let figure;
        let unit;
        if (days >= 1 || !useTime) {
            // Calendar days, not 24-hour spans: the date is what was asked for, so the
            // day it falls on and today decide the figure (a clock change cannot move it).
            const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            const calendarDays = Math.round(Math.abs(startOf(target) - startOf(now)) / 86400000);
            figure = String(calendarDays);
            unit = calendarDays === 1
                ? label(dash, 'dashboard.widgetCountdownDay', 'day')
                : label(dash, 'dashboard.widgetCountdownDays', 'days');
        } else {
            figure = hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : String(minutes);
            unit = hours > 0 ? label(dash, 'dashboard.widgetCountdownHours', 'hours')
                : label(dash, 'dashboard.widgetCountdownMinutes', 'minutes');
        }
        const name = String(widget?.title || '').trim();
        const note = past
            ? label(dash, 'dashboard.widgetCountdownAgo', '{unit} ago').replace('{unit}', unit)
            : label(dash, 'dashboard.widgetCountdownLeft', '{unit} left').replace('{unit}', unit);
        panel.appendChild(u.headline(figure, note));
        const when = new Intl.DateTimeFormat(undefined, config.time
            ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(target);
        panel.appendChild(u.footnote(name ? `${name} · ${when}` : when));
        keepTicking(body, 60000, () => drawCountdown(body, widget, dash));
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.clock = drawClock;
    window.DashboardWidgets.countdown = drawCountdown;
    // For the tests: the arithmetic apart from the drawing.
    window.DashboardWidgetTime = { parseZone, targetOf, dayNumber };
}());
