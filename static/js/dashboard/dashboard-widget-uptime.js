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

    /*
     * Response time over the last day, for the rows that ask for it.
     *
     * Not part of the facts every page load carries: that payload is one
     * letter per check and should stay so. When a tile asks for latency it
     * reads each shown row's own history (at most twenty rows), once, and
     * keeps the answer for five minutes. A row with no timed check in the day
     * simply shows no line.
     */
    const LATENCY_KEEP_MS = 5 * 60 * 1000;

    function latencyFor(dash, url) {
        dash._widgetLatency = dash._widgetLatency || new Map();
        const held = dash._widgetLatency.get(url);
        // The promise is kept, not the answer: a tile that is drawn again while
        // the history is on its way asks for the same one, not another.
        if (held && held.until > Date.now()) return held.promise;
        const promise = readLatency(url);
        dash._widgetLatency.set(url, { promise, until: Date.now() + LATENCY_KEEP_MS });
        return promise;
    }

    async function readLatency(url) {
        let value = null;
        try {
            const send = typeof window.nextDashFetch === 'function' ? window.nextDashFetch : fetch;
            const res = await send(`/api/health/history?url=${encodeURIComponent(url)}`);
            if (res.ok) {
                const data = await res.json();
                const since = Date.now() - 24 * 3600 * 1000;
                const timed = (data.samples || []).filter((s) => s.t >= since && s.u && s.p > 0);
                if (timed.length >= 2) {
                    // 24 steps of the day, each the mean of its checks; an empty hour is skipped.
                    const buckets = new Map();
                    timed.forEach((s) => {
                        const slot = Math.min(23, Math.floor((s.t - since) / (3600 * 1000)));
                        const cell = buckets.get(slot) || { sum: 0, n: 0 };
                        cell.sum += s.p;
                        cell.n += 1;
                        buckets.set(slot, cell);
                    });
                    const points = [...buckets.entries()].sort((a, b) => a[0] - b[0])
                        .map(([slot, cell]) => ({ slot, ms: cell.sum / cell.n }));
                    value = { points, last: timed[timed.length - 1].p };
                }
            }
        } catch (_error) {
            value = null;
        }
        return value;
    }

    /** The line itself: a small SVG, hours across and milliseconds up. */
    function latencyLine(latency) {
        const NS = 'http://www.w3.org/2000/svg';
        const wrap = document.createElement('span');
        wrap.className = 'dashboard-widget-latency';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 48 14');
        svg.setAttribute('aria-hidden', 'true');
        const peak = Math.max(...latency.points.map((p) => p.ms), 1);
        const floor = Math.min(...latency.points.map((p) => p.ms));
        const span = Math.max(peak - floor, peak * 0.2, 1);
        const path = document.createElementNS(NS, 'polyline');
        path.setAttribute('points', latency.points
            .map((p) => `${((p.slot / 23) * 46 + 1).toFixed(1)},${(12.5 - ((p.ms - floor) / span) * 11).toFixed(1)}`).join(' '));
        path.setAttribute('class', 'dashboard-widget-latency-line');
        svg.appendChild(path);
        const text = document.createElement('span');
        text.className = 'dashboard-widget-latency-last';
        text.textContent = `${Math.round(latency.last)} ms`;
        wrap.append(svg, text);
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
        const utils = window.DashboardWidgetUtils;
        // The container-query root the blocks below answer to: the summary
        // figures and the second file of rows appear with the width the tile
        // was actually given, not with the columns it asked for.
        const wrap = utils?.panel ? utils.panel(body) : (body.replaceChildren(), body);
        const rows = rowsFrom(dash);
        if (!rows) {
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            // Neither report has arrived yet — the badge's request is in flight
            // on a load this early, and the tile redraws when it lands.
            waiting.textContent = label(dash, 'dashboard.widgetUptimeWaiting', 'Checking…');
            wrap.appendChild(waiting);
            return;
        }

        const config = widget?.config || {};
        const maxRows = Math.min(Math.max(Number(config.rows) || 5, 1), 20);
        const downOnly = config.downOnly === true;
        const wantSpark = config.sparkline !== false;
        const wantLatency = config.latency === true;
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
            wrap.appendChild(empty);
            return;
        }

        /*
         * What the rows cannot say between them, for a tile drawn wide.
         *
         * A file of percentages answers "how is this one doing"; these answer
         * "how is the watch doing" -- how many are watched at all, how many
         * are down right now, and the average across the week that a single
         * worst row hides.
         */
        const up = shown.filter((row) => Number(row.uptime7d?.samples) > 0);
        const average = up.length
            ? up.reduce((sum, row) => sum + Number(row.uptime7d.ratio), 0) / up.length
            : null;
        const downNow = shown.filter((row) => row.down).length;
        const summary = utils?.statGrid?.([
            { value: String(shown.length), label: label(dash, 'dashboard.widgetUptimeWatchedLabel', 'watched') },
            {
                value: String(downNow),
                label: label(dash, 'dashboard.widgetUptimeDownLabel', 'down now'),
                tone: downNow > 0 ? 'bad' : undefined,
            },
            {
                value: average === null ? '—' : `${(average * 100).toFixed(1)}%`,
                label: label(dash, 'dashboard.widgetUptimeAverageLabel', '7-day average'),
            },
        ]);
        if (summary) {
            summary.classList.add('dashboard-widget-wide-only');
            wrap.appendChild(summary);
        }

        // Two files of rows once the tile is wide: a row here is a host with a
        // percentage beside it, which is the shape that pairs.
        const list = utils?.rowList?.() || document.createElement('div');
        if (!list.className) list.className = 'dashboard-widget-rows dashboard-widget-rows--pairs';

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
            if (wantLatency && !row.down) {
                void latencyFor(dash, row.url).then((latency) => {
                    // The tile may have been drawn again while the history came in.
                    if (latency && button.isConnected) button.appendChild(latencyLine(latency));
                });
            }
            /*
             * A monitored row stands for a bookmark, so it carries its address.
             *
             * Clicking still opens Health on the monitored list -- that is what
             * the tile is for -- but the menu can now offer the site itself, and
             * Ctrl/Cmd+Enter opens it from the keyboard the way it does on a
             * bookmark row.
             */
            window.DashboardWidgetUtils?.bindRowAction(button, dash, {
                labelKey: 'widgetActionOpenHealth',
                labelFallback: 'Open in Bookmarks',
                href: row.url,
                run: () => {
                    window.DashboardWidgetUtils?.openHealthFiltered(dash, 'monitored');
                },
            });
            list.appendChild(button);
        });

        // What did not fit is stated rather than dropped: five rows out of
        // twelve otherwise looks exactly like five out of five.
        utils?.appendOverflowRow(
            list, dash, shown.length - maxRows, () => { window.DashboardWidgetUtils?.openHealthFiltered(dash, 'monitored'); });
        wrap.appendChild(list);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.uptime = render;
    window.DashboardWidgetUptime = { latencyFor, latencyLine };
})();
