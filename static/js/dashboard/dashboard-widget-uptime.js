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
    function sparkline(buckets) {
        const wrap = document.createElement('span');
        wrap.className = 'dashboard-widget-spark';
        const shown = buckets.slice(-24);
        shown.forEach((bucket) => {
            const tick = document.createElement('span');
            // up, down or degraded, as health_uptime.go sets them; a bucket
            // with no samples carries no state at all and stays neutral.
            const state = String(bucket?.state || 'empty');
            tick.className = `dashboard-widget-spark-tick dashboard-widget-spark-tick--${state}`;
            wrap.appendChild(tick);
        });
        return wrap;
    }

    /**
     * The rows, from whichever report is in hand.
     *
     * The badge's ?view=facts response carries uptime over 30 days per row but
     * no heartbeat and no incidents; the full report carries monitorStats. Both
     * are read, and what is missing is simply not drawn.
     */
    function rowsFrom(dash) {
        const report = dash.healthReport || dash.health?.report || null;
        if (report?.issues) {
            return report.issues.filter((issue) => issue?.monitor).map((issue) => ({
                url: issue.url,
                stats: issue.monitorStats || null,
                down: Boolean(issue.monitorStats?.downSince),
            }));
        }
        return null;
    }

    function render(body, widget, dash) {
        body.replaceChildren();
        const rows = rowsFrom(dash);
        if (!rows) {
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            // The full report is loaded when the health view is opened; the
            // dashboard's own request is the lighter facts shape.
            waiting.textContent = label(dash, 'dashboard.widgetUptimeWaiting', 'Open Health once to fill this in.');
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
            return (a.stats?.uptime7d?.ratio ?? 1) - (b.stats?.uptime7d?.ratio ?? 1);
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
            const window7d = row.stats?.uptime7d;
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
            if (wantSpark && Array.isArray(row.stats?.heartbeat) && row.stats.heartbeat.length) {
                button.appendChild(sparkline(row.stats.heartbeat));
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
