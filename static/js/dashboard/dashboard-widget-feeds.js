/**
 * The feeds widget: what has published, and what has gone quiet.
 *
 * The second half is the point. A feed that fails five rounds in a row is
 * retired and skipped on every poll after that — so it produces no items and no
 * error, and nothing anywhere says why the site you followed stopped appearing.
 * That state lived only in the state file until the feed response started
 * carrying it.
 */
(function () {
    'use strict';

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    /** The feed map the dashboard already fetches, or one request if not. */
    async function load(dash) {
        if (dash.feedFreshness) return dash.feedFreshness;
        if (dash._widgetFeeds) return dash._widgetFeeds;
        try {
            const res = await fetch('/api/feeds');
            if (!res.ok) return null;
            const data = await res.json();
            dash._widgetFeeds = data?.feeds || {};
            return dash._widgetFeeds;
        } catch (_error) {
            return null;
        }
    }

    function hostOf(url) {
        try {
            return new URL(String(url)).hostname.replace(/^www\./, '');
        } catch (_error) {
            return String(url || '');
        }
    }

    async function render(body, widget, dash) {
        const utils = window.DashboardWidgetUtils;
        // The container-query root: the summary and the second file of rows
        // answer to the width this tile was actually drawn at.
        const wrap = utils?.panel ? utils.panel(body) : (body.replaceChildren(), body);
        const feeds = await load(dash);
        if (!feeds) {
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            waiting.textContent = label(dash, 'dashboard.widgetFeedsWaiting', 'Loading…');
            wrap.appendChild(waiting);
            return;
        }

        const config = widget?.config || {};
        const rows = Math.min(Math.max(Number(config.rows) || 5, 1), 20);
        const freshOnly = config.freshOnly === true;
        const showRetired = config.showRetired !== false;

        const entries = Object.values(feeds);
        const retired = showRetired ? entries.filter((feed) => feed?.retired) : [];
        const fresh = entries
            .filter((feed) => !feed?.retired && (!freshOnly || Number(feed?.newCount) > 0))
            .sort((a, b) => (Number(b?.newCount) || 0) - (Number(a?.newCount) || 0));

        if (!retired.length && !fresh.length) {
            const empty = document.createElement('p');
            empty.className = 'dashboard-widget-empty';
            empty.textContent = freshOnly
                ? label(dash, 'dashboard.widgetFeedsNothingNew', 'Nothing new in your feeds.')
                : label(dash, 'dashboard.widgetFeedsNone', 'No feeds are being followed.');
            wrap.appendChild(empty);
            return;
        }

        /*
         * The state of the whole set, for a tile drawn wide.
         *
         * The rows say which feeds have something new; these say how many
         * items are waiting altogether, how many feeds are being followed at
         * all, and how many have stopped -- the last being the figure nobody
         * goes looking for until the reading has been dry for a week.
         */
        const items = entries.reduce((sum, feed) => sum + (Number(feed?.newCount) || 0), 0);
        const stopped = entries.filter((feed) => feed?.retired).length;
        const summary = utils?.statGrid?.([
            { value: String(items), label: label(dash, 'dashboard.widgetFeedsItemsLabel', 'new items') },
            { value: String(entries.length), label: label(dash, 'dashboard.widgetFeedsFollowedLabel', 'followed') },
            {
                value: String(stopped),
                label: label(dash, 'dashboard.widgetFeedsStoppedLabel', 'stopped'),
                tone: stopped > 0 ? 'warn' : undefined,
            },
        ]);
        if (summary) {
            summary.classList.add('dashboard-widget-wide-only');
            wrap.appendChild(summary);
        }

        // Two files of rows once the tile is wide: a feed is a host with a
        // count beside it, which is the shape that pairs.
        const list = utils?.rowList?.() || document.createElement('div');
        if (!list.className) list.className = 'dashboard-widget-rows dashboard-widget-rows--pairs';

        // Retired first: "this stopped working" outranks "this has three new
        // items", and it is the half nobody can see anywhere else.
        retired.slice(0, rows).forEach((feed) => {
            const row = document.createElement('div');
            row.className = 'dashboard-widget-row dashboard-widget-row--bad';
            const name = document.createElement('span');
            name.className = 'dashboard-widget-row-name';
            name.textContent = hostOf(feed?.feedUrl);
            const detail = document.createElement('span');
            detail.className = 'dashboard-widget-row-detail';
            detail.textContent = label(dash, 'dashboard.widgetFeedsRetired', 'stopped');
            detail.title = label(dash, 'dashboard.widgetFeedsRetiredHint',
                'This feed failed repeatedly and is no longer checked.');
            row.append(name, detail);
            list.appendChild(row);
        });

        const freshRoom = Math.max(rows - retired.length, 0);
        fresh.slice(0, freshRoom).forEach((feed) => {
            const count = Number(feed?.newCount) || 0;
            const row = document.createElement('div');
            row.className = 'dashboard-widget-row';
            const name = document.createElement('span');
            name.className = 'dashboard-widget-row-name';
            name.textContent = hostOf(feed?.feedUrl);
            const detail = document.createElement('span');
            detail.className = 'dashboard-widget-row-detail';
            detail.textContent = count > 0
                ? label(dash, 'dashboard.widgetFeedsNew', 'new').replace('{n}', String(count))
                : '—';
            row.append(name, detail);
            list.appendChild(row);
        });

        // Both halves count toward what did not fit: a retired feed pushed off
        // the tile is exactly the one worth knowing about.
        window.DashboardWidgetUtils?.appendOverflowRow(list, dash,
            Math.max(retired.length - rows, 0) + Math.max(fresh.length - freshRoom, 0), null);

        wrap.appendChild(list);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.feeds = render;
})();
