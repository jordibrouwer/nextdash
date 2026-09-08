/**
 * The calendar widget: what is coming up, from the ICS feed set in Behavior
 * → Date & weather. One feed for the whole install, so this asks nothing of
 * its own besides how far ahead to look and how many rows to show.
 */
(function () {
    'use strict';

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    function say(body, className, text) {
        body.replaceChildren();
        const line = document.createElement('p');
        line.className = className;
        line.textContent = text;
        body.appendChild(line);
    }

    /**
     * One answer per page, held for as long as the server's own cache TTL
     * would anyway -- a repaint should not be a round trip.
     */
    async function load(dash, widget, pageId) {
        dash._widgetCalendar = dash._widgetCalendar || {};
        const key = `${pageId}:${widget.id}`;
        const held = dash._widgetCalendar[key];
        if (held && held.until > Date.now()) return held.result;
        try {
            const res = await fetch(`/api/widgets/calendar?pageId=${encodeURIComponent(pageId)}`
                + `&id=${encodeURIComponent(widget.id)}`);
            if (!res.ok) return null;
            const result = await res.json();
            // Five minutes: short enough that adding an event shows up soon,
            // long enough that a repaint never asks again for it.
            dash._widgetCalendar[key] = { result, until: Date.now() + 5 * 60 * 1000 };
            return result;
        } catch (error) {
            return null;
        }
    }

    function rowLabel(dash, event) {
        const locale = dash?.settings?.language || document.documentElement.getAttribute('data-lang') || 'en';
        const start = new Date(event.start);
        if (event.allDay) {
            try {
                return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(start);
            } catch (error) {
                return start.toDateString();
            }
        }
        const time = window.NextDashClock?.formatTime?.(start, dash.settings) || '';
        let day;
        try {
            day = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(start);
        } catch (error) {
            day = '';
        }
        const today = new Date();
        const isToday = start.toDateString() === today.toDateString();
        const dayText = isToday ? label(dash, 'dashboard.widgetCalendarToday', 'Today') : day;
        return time ? `${dayText} ${time}` : dayText;
    }

    async function render(body, widget, dash) {
        const pageId = Number(dash?.currentPageId) || Number(dash?.pages?.[0]?.id) || 1;
        say(body, 'dashboard-widget-waiting', label(dash, 'dashboard.widgetCalendarWaiting', 'Checking…'));

        const result = await load(dash, widget, pageId);
        if (!result) {
            say(body, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetCalendarUnavailable', 'Could not read the calendar feed.'));
            return;
        }
        if (result.error === 'no calendar feed set') {
            say(body, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetCalendarSetFeed', 'Set a calendar feed URL in Config.'));
            return;
        }
        if (result.error) {
            say(body, 'dashboard-widget-empty', String(result.error));
            return;
        }

        const events = Array.isArray(result.events) ? result.events : [];
        if (!events.length) {
            const days = Math.max(1, Number(widget?.config?.daysAhead) || 14);
            say(body, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetCalendarNone', 'No events in the next {n} days.').replace('{n}', String(days)));
            return;
        }

        const list = document.createElement('div');
        list.className = 'dashboard-widget-rows';
        events.forEach((event) => {
            const row = document.createElement('div');
            row.className = 'dashboard-widget-row';
            const name = document.createElement('span');
            name.className = 'dashboard-widget-row-name';
            name.textContent = String(event.title || '');
            const detail = document.createElement('span');
            detail.className = 'dashboard-widget-row-detail';
            detail.textContent = rowLabel(dash, event);
            row.append(name, detail);
            list.appendChild(row);
        });
        body.replaceChildren();
        body.appendChild(list);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.calendar = render;
})();
