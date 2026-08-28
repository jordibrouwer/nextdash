/**
 * The uptime widget: how well the monitored bookmarks have been answering.
 *
 * Only monitored bookmarks appear. The rest have no samples at all, and a row
 * reading "—" for every service you never asked to watch is noise, not data.
 *
 * Read from the health report the badge already fetched. Two tallies of the
 * same thing that disagree is worse than one tally, and this one sits on the
 * dashboard where it would be the one believed.
 */
(function () {
    'use strict';

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    function hostOf(url) {
        try {
            return new URL(String(url)).hostname.replace(/^www\./, '');
        } catch (_error) {
            return String(url || '');
        }
    }

    /*
     * A sparkline from the heartbeat buckets.
     *
     * Canvas rather than hand-built SVG paths: the bar is a dozen rectangles
     * whose only job is to show a shape, and it redraws whenever the report
     * does.
     */
    function sparkline(states) {
        const wrap = document.createElement('span');
        wrap.className = 'dashboard-widget-spark';
        states.slice(-24).forEach((state) => {
            const tick = document.createElement('span');
            // up, down or degraded, as health_uptime.go sets them; a bucket
            // with no samples carries no state at all and stays neutral.
            tick.className = `dashboard-widget-spark-tick dashboard-widget-spark-tick--${state || 'empty'}`;
            wrap.appendChild(tick);
        });
        return wrap;
    }

    /**
     * The rows, from whichever report is in hand.
     *
     * The full report is read first when it is there — it is the same data and
     * it is already parsed. It is only there once the health view has been
     * opened, though, and that used to be the whole story: a tile on the
     * dashboard said "Open Health once to fill this in" until the reader went
     * and did that, which is a chore invented by where the data happened to be
     * loaded. The `?view=facts` response the badge fetches on every load now
     * carries the same four things per monitored row, so the tile fills itself.
     */
    function rowsFrom(dash) {
        const report = dash.healthReport || dash.health?.report || null;
        if (report?.issues) {
            return report.issues.filter((issue) => issue?.monitor).map((issue) => ({
                url: issue.url,
                uptime7d: issue.monitorStats?.uptime7d || null,
                heartbeat: (issue.monitorStats?.heartbeat || []).map((bucket) => String(bucket?.state || 'empty')),
                down: Boolean(issue.monitorStats?.downSince),
            }));
        }
        return rowsFromFacts(dash);
    }

    /**
     * The same rows out of the facts store the badge fills.
     *
     * Read through the bookmarks rather than the store's own keys: the store is
     * keyed by canonical URL, and a row has to name the address the tile opens
     * and the host it prints.
     */
    function rowsFromFacts(dash) {
        const facts = window.HealthFacts;
        // updatedAt, not size: a collection where nothing is monitored has an
        // empty store and a perfectly good answer — "nothing is being
        // monitored" — while a store that has never been filled has none.
        if (!facts?.get || !facts.updatedAt) return null;
        const rows = [];
        (dash.allBookmarks || dash.bookmarks || []).forEach((bookmark) => {
            const entry = facts.get(bookmark?.url);
            if (!entry?.monitor) return;
            rows.push({
                url: bookmark.url,
                uptime7d: entry.uptime7dSamples > 0
                    ? { ratio: entry.uptime7d, samples: entry.uptime7dSamples }
                    : null,
                heartbeat: Array.isArray(entry.heartbeat) ? entry.heartbeat : [],
                down: Boolean(entry.downSince),
            });
        });
        return rows;
    }

    function render(body, widget, dash) {
        body.replaceChildren();
        const rows = rowsFrom(dash);
        if (!rows) {
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            // Neither report has arrived yet — the badge's request is in flight
            // on a load this early, and the tile redraws when it lands.
            waiting.textContent = label(dash, 'dashboard.widgetUptimeWaiting', 'Checking…');
            body.appendChild(waiting);
            return;
        }

        const config = widget?.config || {};
        const maxRows = Math.min(Math.max(Number(config.rows) || 5, 1), 20);
        const downOnly = config.downOnly === true;
        const wantSpark = config.sparkline !== false;
        const tags = Array.isArray(config.tags) ? config.tags : null;

        let shown = rows;
        if (downOnly) shown = shown.filter((row) => row.down);
        if (tags?.length) {
            const byUrl = new Map((dash.allBookmarks || dash.bookmarks || [])
                .map((bookmark) => [String(bookmark.url), bookmark]));
            shown = shown.filter((row) => {
                const bookmarkTags = byUrl.get(String(row.url))?.tags;
                return Array.isArray(bookmarkTags) && bookmarkTags.some((tag) => tags.includes(tag));
            });
        }
        // Worst first: a tile with room for five rows should spend them on the
        // five that need attention.
        shown = [...shown].sort((a, b) => {
            if (a.down !== b.down) return a.down ? -1 : 1;
            return (a.uptime7d?.ratio ?? 1) - (b.uptime7d?.ratio ?? 1);
        });

        if (!shown.length) {
            const empty = document.createElement('p');
            empty.className = 'dashboard-widget-empty';
            empty.textContent = downOnly
                ? label(dash, 'dashboard.widgetUptimeAllUp', 'Everything monitored is up.')
                : label(dash, 'dashboard.widgetUptimeNone', 'No bookmarks are being monitored.');
            body.appendChild(empty);
            return;
        }

        const list = document.createElement('div');
        list.className = 'dashboard-widget-rows';

        shown.slice(0, maxRows).forEach((row) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `dashboard-widget-row${row.down ? ' dashboard-widget-row--bad' : ''}`;

            const name = document.createElement('span');
            name.className = 'dashboard-widget-row-name';
            name.textContent = hostOf(row.url);

            const detail = document.createElement('span');
            detail.className = 'dashboard-widget-row-detail';
            const window7d = row.uptime7d;
            if (row.down) {
                detail.textContent = label(dash, 'dashboard.widgetUptimeDown', 'down');
            } else if (Number(window7d?.samples) > 0) {
                detail.textContent = `${(Number(window7d.ratio) * 100).toFixed(1)}%`;
            } else {
                // "No data" and "0% up" are different answers, and the samples
                // count is what tells them apart.
                detail.textContent = '—';
                detail.title = label(dash, 'dashboard.widgetUptimeNoSamples', 'Not checked often enough yet');
            }

            button.append(name, detail);
            if (wantSpark && row.heartbeat?.length) {
                button.appendChild(sparkline(row.heartbeat));
            }
            button.addEventListener('click', () => {
                window.DashboardWidgetUtils?.openHealthFiltered(dash, 'monitored');
            });
            list.appendChild(button);
        });

        // What did not fit is stated rather than dropped: five rows out of
        // twelve otherwise looks exactly like five out of five.
        window.DashboardWidgetUtils?.appendOverflowRow(
            list, dash, shown.length - maxRows, () => { window.DashboardWidgetUtils?.openHealthFiltered(dash, 'monitored'); });
        body.appendChild(list);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.uptime = render;
})();
