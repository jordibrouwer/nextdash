/**
 * The neglected widget: the bookmarks you stopped opening.
 *
 * The graveyard question in reverse. Health asks which link died; this asks
 * which one you let go — and those are different bookmarks, since a page can
 * answer 200 for years while nobody visits it.
 *
 * "Neglected" is a judgement, not a field, which is why this one has the most
 * settings. A bookmark saved yesterday is not neglected for having no opens,
 * and a reference you need once a year is not neglected in month eleven. The
 * tile therefore says which threshold it used rather than leaving the reader to
 * guess why a row is on it.
 */
(function () {
    'use strict';

    const DAY = 24 * 60 * 60 * 1000;

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    function render(body, widget, dash) {
        body.replaceChildren();
        const bookmarks = dash.allBookmarks || dash.bookmarks || null;
        if (!Array.isArray(bookmarks)) {
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            waiting.textContent = label(dash, 'dashboard.widgetNeglectedWaiting', 'Loading…');
            body.appendChild(waiting);
            return;
        }

        const config = widget?.config || {};
        const sinceDays = Math.min(Math.max(Number(config.sinceDays) || 180, 7), 730);
        const maxRows = Math.min(Math.max(Number(config.rows) || 5, 1), 20);
        const includeNever = config.includeNeverOpened !== false;
        const tags = Array.isArray(config.tags) ? config.tags : null;
        const pageId = Number(config.pageId) || 0;
        const cutoff = Date.now() - sinceDays * DAY;

        const candidates = bookmarks.filter((bookmark) => {
            if (pageId && Number(bookmark?.pageId) !== pageId) return false;
            if (tags?.length) {
                const own = Array.isArray(bookmark?.tags) ? bookmark.tags : [];
                if (!own.some((tag) => tags.includes(tag))) return false;
            }
            const lastOpened = Number(bookmark?.lastOpened) || 0;
            if (!lastOpened) {
                if (!includeNever) return false;
                /*
                 * Never opened is only neglect once there has been time to open
                 * it: a bookmark saved this morning would otherwise head the
                 * list on the day it was added. Judged on when it was saved,
                 * against the same window.
                 */
                const added = Number(bookmark?.createdAt) || 0;
                return added > 0 && added < cutoff;
            }
            return lastOpened < cutoff;
        });

        if (!candidates.length) {
            const empty = document.createElement('p');
            empty.className = 'dashboard-widget-empty';
            empty.textContent = label(dash, 'dashboard.widgetNeglectedNone',
                'Nothing has been sitting untouched for {n} days.').replace('{n}', String(sinceDays));
            body.appendChild(empty);
            return;
        }

        // Longest untouched first. Never-opened sorts by how long it has been
        // waiting since it was saved, which is the same question asked of a
        // bookmark that has no visits to date from.
        const age = (bookmark) => Number(bookmark?.lastOpened) || Number(bookmark?.createdAt) || 0;
        const sorted = [...candidates].sort((a, b) => age(a) - age(b));

        const head = document.createElement('div');
        head.className = 'dashboard-widget-headline';
        const count = document.createElement('span');
        count.className = 'dashboard-widget-headline-value';
        count.textContent = String(candidates.length);
        const note = document.createElement('span');
        note.className = 'dashboard-widget-headline-note';
        // The threshold is on screen, because the number means nothing without
        // it: "eleven neglected" is a different claim at 30 days than at 365.
        note.textContent = label(dash, 'dashboard.widgetNeglectedSince', 'untouched {n}d+')
            .replace('{n}', String(sinceDays));
        head.append(count, note);
        body.appendChild(head);

        const list = document.createElement('div');
        list.className = 'dashboard-widget-rows';
        sorted.slice(0, maxRows).forEach((bookmark) => {
            const row = document.createElement('a');
            row.className = 'dashboard-widget-row';
            row.href = String(bookmark?.url || '#');
            row.rel = 'noopener noreferrer';

            const name = document.createElement('span');
            name.className = 'dashboard-widget-row-name';
            name.textContent = String(bookmark?.name || bookmark?.url || '');

            const detail = document.createElement('span');
            detail.className = 'dashboard-widget-row-detail';
            const opened = Number(bookmark?.lastOpened) || 0;
            detail.textContent = opened
                ? label(dash, 'dashboard.widgetNeglectedDays', '{n}d')
                    .replace('{n}', String(Math.floor((Date.now() - opened) / DAY)))
                : label(dash, 'dashboard.widgetNeglectedNever', 'never');

            row.append(name, detail);
            list.appendChild(row);
        });
        // What did not fit is stated rather than dropped: five rows out of
        // twelve otherwise looks exactly like five out of five.
        window.DashboardWidgetUtils?.appendOverflowRow(
            list, dash, sorted.length - maxRows, null);
        body.appendChild(list);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.neglected = render;
})();
