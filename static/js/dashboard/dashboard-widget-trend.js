/**
 * The health trend widget: the health view's summary tile, on the dashboard.
 *
 * It used to be one number and a line of broken links. The health view already
 * answers "how is the collection doing" with a small block -- the score, its
 * direction with a line under it, what is broken, the fleet's last day and how
 * fresh all of that is -- and a tile that says it differently on the dashboard
 * is a second answer to believe. So this draws the same block, from the same
 * figures.
 *
 * Not filterable by page or tag. The trend is the collection's, and a filtered
 * line would answer a question nobody asked while looking exactly like the one
 * that answers the real one.
 *
 * Where the figures come from: the score, the counts and the fleet's last day
 * from the badge's own request (dash.healthSummary and HealthFacts), the line
 * from /api/health/trend. Nothing here fetches the full report.
 */
(function () {
    'use strict';

    const SVG = 'http://www.w3.org/2000/svg';

    function label(dash, key, fallback, vars) {
        const value = dash?.language?.t?.(key);
        let text = value && value !== key ? value : fallback;
        Object.entries(vars || {}).forEach(([name, v]) => {
            text = text.replace(`{${name}}`, String(v));
        });
        return text;
    }

    /*
     * Every recorded day, once.
     *
     * The route takes no window — checked, rather than assumed: it answers with
     * whatever it has recorded, so sending ?days= would look like a filter and
     * be ignored. The window is applied here instead, and one fetch serves every
     * trend tile on the page whatever each is set to.
     */
    async function load(dash) {
        if (dash._widgetTrend) return dash._widgetTrend;
        try {
            const res = await fetch('/api/health/trend');
            if (!res.ok) return null;
            const data = await res.json();
            dash._widgetTrend = Array.isArray(data?.points) ? data.points : [];
            return dash._widgetTrend;
        } catch (_error) {
            return null;
        }
    }

    /** A day's healthy share, as the health view's default series reads it. */
    function healthyPercent(point) {
        const total = Number(point?.n) || 0;
        if (!total) return null;
        return Math.round(((Number(point?.h) || 0) / total) * 100);
    }

    function scoreTone(pct) {
        if (pct >= 90) return 'good';
        return pct >= 70 ? 'warn' : 'bad';
    }

    /** Uptime as the health view prints it: never a rounded-up 100%. */
    function formatUptime(window) {
        if (!window || !window.samples) return null;
        const pct = window.ratio * 100;
        const rounded = pct >= 99.95 && window.ratio < 1 ? 99.9 : pct;
        return `${rounded.toFixed(rounded >= 99.95 || rounded % 1 === 0 ? 0 : 1)}%`;
    }

    function ageText(dash, generatedAt) {
        if (!generatedAt) return '';
        const age = Math.max(0, Date.now() - generatedAt);
        if (age < 60_000) return label(dash, 'dashboard.healthSummaryJustNow', 'just now');
        const minutes = Math.floor(age / 60_000);
        if (minutes < 60) return label(dash, 'dashboard.healthDurationMinutes', '{minutes}m', { minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return label(dash, 'dashboard.healthDurationHoursMinutes', '{hours}h {minutes}m',
                { hours, minutes: minutes % 60 });
        }
        return label(dash, 'dashboard.healthDurationDaysHours', '{days}d {hours}h',
            { days: Math.floor(hours / 24), hours: hours % 24 });
    }

    /*
     * The line, the way the rail draws it: a fixed 0-100 axis, so a two-point
     * move looks like a two-point move, a break for a day with nothing
     * recorded, and a dot on today.
     */
    function sparkline(values, aria) {
        const w = 160;
        const h = 32;
        const pad = 2;
        const step = w / Math.max(1, values.length - 1);
        const y = (v) => (h - pad - (v / 100) * (h - pad * 2)).toFixed(1);

        const svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('class', 'dashboard-widget-trend-line');
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', aria);

        let run = [];
        const flush = () => {
            if (run.length > 1) {
                const line = document.createElementNS(SVG, 'polyline');
                line.setAttribute('points', run.join(' '));
                line.setAttribute('fill', 'none');
                line.setAttribute('stroke', 'currentColor');
                line.setAttribute('stroke-width', '1.5');
                line.setAttribute('stroke-linejoin', 'round');
                line.setAttribute('stroke-linecap', 'round');
                svg.appendChild(line);
            }
            run = [];
        };
        values.forEach((v, i) => {
            if (v === null) { flush(); return; }
            run.push(`${(i * step).toFixed(1)},${y(v)}`);
        });
        flush();

        const last = values.reduce((acc, v, i) => (v === null ? acc : i), -1);
        if (last >= 0) {
            const dot = document.createElementNS(SVG, 'circle');
            dot.setAttribute('cx', (last * step).toFixed(1));
            dot.setAttribute('cy', y(values[last]));
            dot.setAttribute('r', '2');
            dot.setAttribute('fill', 'currentColor');
            svg.appendChild(dot);
        }
        return svg;
    }

    function row(dash, { key, name, value, tone, filter, extra, changeClass }) {
        const clickable = Boolean(filter);
        const el = document.createElement(clickable ? 'button' : 'div');
        if (clickable) el.type = 'button';
        el.className = ['dashboard-widget-trend-row', tone ? `is-${tone}` : ''].filter(Boolean).join(' ');
        el.dataset.trendRow = key;

        const nameEl = document.createElement('span');
        nameEl.className = 'dashboard-widget-trend-label';
        nameEl.textContent = name;
        const valueEl = document.createElement('span');
        valueEl.className = ['dashboard-widget-trend-value', changeClass || ''].filter(Boolean).join(' ');
        valueEl.textContent = value;
        el.append(nameEl, valueEl);

        if (extra) {
            const holder = document.createElement('div');
            holder.className = 'dashboard-widget-trend-extra';
            holder.append(...[].concat(extra));
            el.appendChild(holder);
        }
        if (clickable) {
            window.DashboardWidgetUtils?.bindRowAction(el, dash, {
                labelFallback: label(dash, 'dashboard.widgetActionOpenHealthFilter', 'Open Health — {name}', { name }),
                run: () => window.DashboardWidgetUtils?.openHealthFiltered(dash, filter),
            });
        }
        return el;
    }

    async function render(body, widget, dash) {
        /*
         * Only the latest draw lands.
         *
         * A tile is drawn on load and again when the badge's report arrives,
         * and both wait on the trend fetch. Emptying before the wait meant each
         * appended its own block after it -- two identical tiles, one under the
         * other. The body is emptied after the wait, by the newest draw only.
         */
        const token = Symbol('trend-render');
        body._trendRender = token;
        const days = Math.min(Math.max(Number(widget?.config?.days) || 30, 7), 90);
        const all = await load(dash);
        if (body._trendRender !== token) return;
        body.replaceChildren();
        const summary = dash?.healthSummary || null;

        if (!summary && !all) {
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            waiting.textContent = label(dash, 'dashboard.widgetTrendWaiting', 'Loading…');
            body.appendChild(waiting);
            return;
        }

        // Newest last, so the window is the tail.
        const points = Array.isArray(all) ? all.slice(-days) : [];
        const latest = points[points.length - 1];
        const rows = [];

        // Score: the healthy share, from the badge's report when it is in, and
        // from today's recorded day until then.
        const total = Number(summary?.totalBookmarks) || Number(latest?.n) || 0;
        const healthy = summary ? Number(summary.healthyCount) || 0 : Number(latest?.h) || 0;
        const pct = total ? Math.round((healthy / total) * 100) : 100;
        rows.push(row(dash, {
            key: 'score',
            name: label(dash, 'dashboard.healthScoreTotal', 'Score'),
            value: `${pct}%`,
            tone: scoreTone(pct),
            filter: 'all',
        }));

        // Trend: the direction since the start of the window, the line under it,
        // and the sentence that says it in words.
        const values = points.map(healthyPercent);
        const known = values.filter((v) => v !== null);
        if (known.length >= 2) {
            const delta = known[known.length - 1] - known[0];
            const arrow = delta === 0 ? '–' : `${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}`;
            const sentence = document.createElement('p');
            sentence.className = 'dashboard-widget-trend-note';
            sentence.textContent = delta === 0
                ? label(dash, 'dashboard.healthTrendFlat', 'unchanged over {days} days', { days: points.length })
                : label(dash, delta > 0 ? 'dashboard.healthTrendUp' : 'dashboard.healthTrendDown',
                    delta > 0 ? 'up {points} points over {days} days' : 'down {points} points over {days} days',
                    { points: Math.abs(delta), days: points.length });
            const extra = known.length >= 3
                ? [sparkline(values, label(dash, 'dashboard.healthTrendChartLabel',
                    'Healthy bookmarks over the last {days} days, from {first}% to {last}%',
                    { days: points.length, first: known[0], last: known[known.length - 1] })), sentence]
                : [sentence];
            rows.push(row(dash, {
                key: 'trend',
                name: label(dash, 'dashboard.healthTileTrend', 'Trend'),
                value: arrow,
                // Up is good news here: this is the healthy share, not a count
                // of what is wrong.
                changeClass: `dashboard-widget-trend-change ${delta > 0 ? 'is-better' : delta < 0 ? 'is-worse' : 'is-level'}`,
                extra,
            }));
        } else {
            const early = document.createElement('p');
            early.className = 'dashboard-widget-trend-note';
            // One day is not a trend, and saying so beats drawing a dot.
            early.textContent = label(dash, 'dashboard.widgetTrendTooEarly',
                'Not enough history yet — a trend needs a few days.');
            rows.push(row(dash, {
                key: 'trend', name: label(dash, 'dashboard.healthTileTrend', 'Trend'), value: '–', extra: early,
            }));
        }

        // What needs doing, only while there is some.
        const broken = summary ? Number(summary.brokenCount) || 0 : Number(latest?.b) || 0;
        if (broken > 0) {
            rows.push(row(dash, {
                key: 'broken', name: label(dash, 'dashboard.healthFilterBroken', 'Broken'),
                value: String(broken), tone: 'bad', filter: 'broken',
            }));
        }
        const down = summary ? Number(summary.monitorDownCount) || 0 : Number(latest?.d) || 0;
        if (down > 0) {
            rows.push(row(dash, {
                key: 'down', name: label(dash, 'dashboard.widgetHealthDownNow', 'Monitors down'),
                value: String(down), tone: 'bad', filter: 'monitored',
            }));
        }

        // The fleet's last day, while there is a fleet.
        const monitored = summary ? Number(summary.monitoredCount) || 0 : Number(latest?.m) || 0;
        if (monitored > 0) {
            const uptime = formatUptime(window.HealthFacts?.fleetUptime24h?.());
            rows.push(row(dash, {
                key: 'uptime',
                name: label(dash, 'dashboard.healthUptime24h', 'Uptime 24h'),
                value: uptime || label(dash, 'dashboard.healthStatsNoData', 'no data'),
                tone: uptime ? (down > 0 ? 'bad' : 'good') : '',
                filter: 'monitored',
            }));
        }

        rows.push(row(dash, {
            key: 'healthy',
            name: label(dash, 'dashboard.widgetTrendHealthy', 'Healthy'),
            value: label(dash, 'dashboard.widgetTrendOfTotal', '{n} of {total}', { n: healthy, total }),
            filter: 'healthy',
        }));

        const updated = ageText(dash, window.HealthFacts?.generatedAt || 0);
        if (updated) {
            rows.push(row(dash, {
                key: 'age', name: label(dash, 'dashboard.healthSummaryUpdated', 'Updated'), value: updated,
            }));
        }

        /*
         * Score and trend are the reading; the rest is the detail behind it.
         *
         * A narrow tile carries the two, a wide one carries all of them in two
         * files -- the trend row keeps the full width, because the line under
         * it is drawn to be read across the tile rather than down half of it.
         */
        rows.forEach((item) => {
            const key = item.dataset.trendRow;
            if (key !== 'score' && key !== 'trend') item.classList.add('dashboard-widget-wide-only');
        });

        const utils = window.DashboardWidgetUtils;
        const wrap = utils?.panel ? utils.panel(body) : body;
        const block = document.createElement('div');
        block.className = 'dashboard-widget-trend';
        block.append(...rows);
        wrap.appendChild(block);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.trend = render;
})();
