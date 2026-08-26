/**
 * The unchecked widget: the blind spots.
 *
 * The health widget reports what the checks found, which says nothing at all
 * about what they never looked at. A collection can read as entirely healthy
 * because two thirds of it is not being checked — and that is the more
 * dangerous of the two states, because it looks like the good one.
 *
 * Three different silences, kept apart because they call for different answers:
 * never checked at all, checked once and long ago, and checking deliberately
 * switched off. Nothing here fetches; all three are fields on the bookmark.
 */
(function () {
    'use strict';

    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    function render(body, widget, dash) {
        const u = U();
        const all = u.bookmarksOf(dash);
        if (!all) {
            body.replaceChildren();
            u.say(body, 'dashboard-widget-waiting',
                label(dash, 'dashboard.widgetUncheckedWaiting', 'Loading…'));
            return;
        }

        const config = widget?.config || {};
        const pageId = Number(config.pageId) || 0;
        const staleDays = Math.min(Math.max(Number(config.staleDays) || 30, 1), 730);
        // Off is a choice someone made, not a gap someone missed, so whether it
        // counts towards the headline is the reader's to decide.
        const includeDisabled = config.includeDisabled === true;
        const maxRows = u.rowLimit(widget, 5);
        const cutoff = Date.now() - staleDays * u.DAY_MS;

        const scope = all.filter((bookmark) => u.onPage(bookmark, pageId));
        if (!scope.length) {
            const panel = u.panel(body);
            u.say(panel, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetUncheckedNoBookmarks', 'No bookmarks on this page.'));
            return;
        }

        const watched = (bookmark) => bookmark?.checkStatus === true;
        const never = scope.filter((bookmark) => watched(bookmark) && !Number(bookmark?.lastChecked));
        const stale = scope.filter((bookmark) => watched(bookmark)
            && Number(bookmark?.lastChecked) > 0
            && Number(bookmark.lastChecked) < cutoff);
        const off = scope.filter((bookmark) => !watched(bookmark));
        const monitored = scope.filter((bookmark) => bookmark?.monitor === true).length;

        const blind = never.length + stale.length + (includeDisabled ? off.length : 0);

        const panel = u.panel(body);
        panel.appendChild(u.headline(blind, blind === 0
            ? label(dash, 'dashboard.widgetUncheckedAllSeen', 'everything has been looked at')
            : label(dash, 'dashboard.widgetUncheckedBlind', 'not seen in the last {n}d')
                .replace('{n}', String(staleDays))));

        /*
         * The bar measures what is being watched, not what is wrong.
         *
         * Inverted on purpose: the figure above counts the gaps, and a bar
         * that filled as the gaps grew would be a progress bar for bad news.
         */
        const covered = scope.length - blind;
        const share = covered / scope.length;
        panel.appendChild(u.meter(covered, scope.length,
            share >= 0.9 ? 'good' : share >= 0.6 ? 'warn' : 'bad'));

        panel.appendChild(u.statGrid([
            {
                value: never.length,
                label: label(dash, 'dashboard.widgetUncheckedNever', 'never'),
                tone: never.length ? 'warn' : null,
                title: label(dash, 'dashboard.widgetUncheckedNeverAbout',
                    'Checking is on, but no check has run yet.'),
                onOpen: () => u.openHealthFiltered(dash, 'unchecked'),
            },
            {
                value: stale.length,
                label: label(dash, 'dashboard.widgetUncheckedStale', 'stale'),
                tone: stale.length ? 'warn' : null,
                title: label(dash, 'dashboard.widgetUncheckedStaleAbout',
                    'Last checked more than {n} days ago.').replace('{n}', String(staleDays)),
                onOpen: () => u.openHealthFiltered(dash, 'stale'),
            },
            {
                value: off.length,
                label: label(dash, 'dashboard.widgetUncheckedOff', 'not watched'),
                title: label(dash, 'dashboard.widgetUncheckedOffAbout',
                    'Checking is switched off for these.'),
                onOpen: () => u.openHealthFiltered(dash, 'unchecked'),
            },
            {
                value: monitored,
                label: label(dash, 'dashboard.widgetUncheckedMonitored', 'monitored'),
                tone: 'good',
                title: label(dash, 'dashboard.widgetUncheckedMonitoredAbout',
                    'On the faster tier, with uptime history.'),
                onOpen: () => u.openHealthFiltered(dash, 'monitored'),
            },
        ]));

        // Never before stale, and within each the one waiting longest first —
        // the order someone would work the list in.
        const candidates = [
            ...never,
            ...stale.sort((a, b) => Number(a.lastChecked) - Number(b.lastChecked)),
            ...(includeDisabled ? off : []),
        ];

        if (!candidates.length) {
            panel.appendChild(u.footnote(label(dash, 'dashboard.widgetUncheckedNothing',
                'Every bookmark here has been checked recently.'), 'good'));
            return;
        }

        const list = u.rowList();
        candidates.slice(0, maxRows).forEach((bookmark) => {
            const last = Number(bookmark?.lastChecked) || 0;
            const days = u.daysSince(last);
            const detail = !bookmark?.checkStatus
                ? label(dash, 'dashboard.widgetUncheckedRowOff', 'off')
                : !last
                    ? label(dash, 'dashboard.widgetUncheckedRowNever', 'never')
                    : label(dash, 'dashboard.widgetUncheckedRowDays', '{n}d ago')
                        .replace('{n}', String(days));
            list.appendChild(u.row(
                bookmark?.name || bookmark?.url || '',
                detail,
                bookmark?.checkStatus ? 'warn' : null,
                () => u.openHealthFiltered(dash, last ? 'stale' : 'unchecked')));
        });
        u.appendOverflowRow(list, dash, candidates.length - maxRows,
            () => u.openHealthFiltered(dash, 'unchecked'));
        panel.appendChild(list);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.unchecked = render;
})();
