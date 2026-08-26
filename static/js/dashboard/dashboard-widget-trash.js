/**
 * The trash widget: what is waiting to be deleted for good, and when.
 *
 * The trash empties itself on a timer, and until now that timer was written
 * down in one place nobody visits. A deletion nobody was told about is not
 * really a deletion someone agreed to — so this tile is about the date, not
 * about the count.
 *
 * Reads /api/trash through the token-carrying fetch, since the route is behind
 * the same gate the rest of the destructive surface is.
 */
(function () {
    'use strict';

    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    /**
     * One answer per dashboard, kept until something clears it.
     *
     * The trash changes when someone deletes something, and that path already
     * calls forgetWidgetCaches — so re-fetching per repaint would be a request
     * for a figure that cannot have moved.
     */
    async function load(dash) {
        if (dash._widgetTrash) return dash._widgetTrash;
        try {
            const res = await U().authFetch('/api/trash');
            if (!res.ok) {
                // 401 is a different fact from a broken route: this install has
                // a write token and this browser is not carrying it.
                dash._widgetTrash = { denied: res.status === 401 || res.status === 403 };
                return dash._widgetTrash;
            }
            dash._widgetTrash = await res.json();
            return dash._widgetTrash;
        } catch (_error) {
            return null;
        }
    }

    /** What the entry was, whichever of the three payloads it carries. */
    function nameOf(item) {
        const kind = String(item?.kind || 'bookmark');
        if (kind === 'page') return item?.trashedPage?.page?.name || '';
        if (kind === 'category') return item?.trashedCategory?.category?.name || '';
        return item?.bookmark?.name || item?.bookmark?.url || '';
    }

    function countOf(items, kind) {
        return items.filter((item) => {
            const own = String(item?.kind || 'bookmark');
            // An entry written before Kind existed has none, and it is a
            // bookmark — trash.go says as much where it declines to migrate.
            return own === kind || (kind === 'bookmark' && own === '');
        }).length;
    }

    function draw(body, widget, dash, data) {
        const u = U();
        const panel = u.panel(body);

        if (data?.denied) {
            u.say(panel, 'dashboard-widget-empty', label(dash, 'dashboard.widgetTrashDenied',
                'This dashboard is not signed in for that.'));
            return;
        }

        const items = Array.isArray(data?.items) ? data.items : [];
        const retention = Math.max(Number(data?.retentionDays) || 30, 1);
        const config = widget?.config || {};
        const warnDays = Math.min(Math.max(Number(config.warnDays) || 7, 1), 30);
        const maxRows = u.rowLimit(widget, 5);
        const open = () => u.openConfigTab(dash, 'data-backups', 'trash');

        if (!items.length) {
            u.say(panel, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetTrashEmpty', 'The trash is empty.'));
            return;
        }

        // Oldest first: retention deletes from that end, so the top of this
        // list is also the next thing to disappear.
        const sorted = [...items].sort((a, b) =>
            (Number(a?.deletedAt) || 0) - (Number(b?.deletedAt) || 0));
        const leftFor = (item) => {
            const age = u.daysSince(item?.deletedAt);
            return age === null ? null : retention - age;
        };
        const soonest = leftFor(sorted[0]);
        const urgent = sorted.filter((item) => {
            const left = leftFor(item);
            return left !== null && left <= warnDays;
        }).length;

        panel.appendChild(u.headline(items.length, soonest === null
            ? label(dash, 'dashboard.widgetTrashUndated', 'waiting')
            : soonest <= 0
                ? label(dash, 'dashboard.widgetTrashLeavingNow', 'the oldest goes at the next sweep')
                : label(dash, 'dashboard.widgetTrashOldest', 'the oldest goes in {n}d')
                    .replace('{n}', String(soonest))));

        panel.appendChild(u.statGrid([
            {
                value: countOf(items, 'bookmark'),
                label: label(dash, 'dashboard.widgetTrashBookmarks', 'bookmarks'),
            },
            {
                value: countOf(items, 'category'),
                label: label(dash, 'dashboard.widgetTrashCategories', 'categories'),
            },
            {
                value: countOf(items, 'page'),
                label: label(dash, 'dashboard.widgetTrashPages', 'pages'),
            },
            {
                value: urgent,
                label: label(dash, 'dashboard.widgetTrashGoingSoon', 'going soon'),
                tone: urgent ? 'warn' : null,
                title: label(dash, 'dashboard.widgetTrashGoingSoonAbout',
                    'Leaving within {n} days.').replace('{n}', String(warnDays)),
                onOpen: open,
            },
        ]));

        const list = u.rowList();
        sorted.slice(0, maxRows).forEach((item) => {
            const left = leftFor(item);
            const detail = left === null
                ? ''
                : left <= 0
                    ? label(dash, 'dashboard.widgetTrashDue', 'due')
                    : label(dash, 'dashboard.widgetTrashDaysLeft', '{n}d left')
                        .replace('{n}', String(left));
            list.appendChild(u.row(
                nameOf(item) || label(dash, 'dashboard.widgetTrashUnnamed', 'Untitled'),
                detail,
                left !== null && left <= warnDays ? 'warn' : null,
                open));
        });
        u.appendOverflowRow(list, dash, sorted.length - maxRows, open);
        panel.appendChild(list);

        panel.appendChild(u.footnote(label(dash, 'dashboard.widgetTrashRetention',
            'Kept for {n} days, then removed for good.').replace('{n}', String(retention))));
    }

    async function render(body, widget, dash) {
        const u = U();
        body.replaceChildren();
        u.say(body, 'dashboard-widget-waiting', label(dash, 'dashboard.widgetTrashLoading', 'Loading…'));

        const data = await load(dash);
        if (!data) {
            body.replaceChildren();
            u.say(body, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetTrashUnreachable', 'Could not read the trash.'));
            return;
        }
        draw(body, widget, dash, data);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.trash = render;
})();
