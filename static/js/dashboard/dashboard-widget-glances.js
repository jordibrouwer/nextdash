/**
 * Glances: one host on the dashboard, from nextDash's own record of it.
 *
 * The tile asks nothing of the host: it reads the last readings nextDash
 * recorded (/api/glances/hosts), and, for the graph look, the last hour of the
 * processor (/api/glances/history). It opens the Glances page on that host.
 *
 * Two looks. Meters: how the host is, then processor, memory and the fullest
 * disk as bars. Graph: the processor as a number with its last hour behind it.
 * A host that does not answer says so and since when, and never prints the
 * numbers it had before it went away.
 */
(function () {
    'use strict';

    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    async function readJSON(url) {
        try {
            const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
            return res.ok ? await res.json() : null;
        } catch {
            return null;
        }
    }

    /** Tone by the lines Config → Glances sets (80 and 90 until the page has told them). */
    function tone(dash, kind, value) {
        const limits = dash?.glancesStatus?.thresholds || {};
        const warn = Number.isFinite(limits[`${kind}Warn`]) ? limits[`${kind}Warn`] : 80;
        const bad = Number.isFinite(limits[`${kind}Bad`]) ? limits[`${kind}Bad`] : 90;
        if (value >= bad) return 'bad';
        if (value >= warn) return 'warn';
        return 'good';
    }

    function percent(value) {
        return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}%` : '–';
    }

    /** The last hour as a line: the points are [time, value], drawn to fill the width. */
    function sparkline(points) {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'dashboard-widget-glances-spark');
        svg.setAttribute('viewBox', '0 0 200 40');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('aria-hidden', 'true');
        const clean = (points || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (clean.length < 2) return svg;
        const from = clean[0][0];
        const to = clean[clean.length - 1][0];
        const span = Math.max(1, to - from);
        const d = clean.map(([t, v], i) => `${i ? 'L' : 'M'}${(((t - from) / span) * 200).toFixed(1)},${(38 - (Math.min(100, Math.max(0, v)) / 100) * 36).toFixed(1)}`).join(' ');
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', 'dashboard-widget-glances-spark-line');
        svg.appendChild(path);
        return svg;
    }

    function status(dash, row) {
        const level = row.configured && !row.paused ? row.level : 'unknown';
        return {
            ok: ['dashboard.glancesHostStatusOk', 'Healthy'],
            warn: ['dashboard.glancesHostStatusWarn', 'Warning'],
            bad: ['dashboard.glancesHostStatusBad', 'Critical'],
        }[level] || ['dashboard.glancesHostStatusUnknown', 'Unknown'];
    }

    function opener(dash, host) {
        const link = document.createElement('a');
        link.className = 'dashboard-widget-glances-open';
        link.href = `#glances/overview${host ? `?host=${encodeURIComponent(host)}` : ''}`;
        link.textContent = `${label(dash, 'dashboard.widgetGlancesOpen', 'Open Glances')} ↗`;
        return link;
    }

    async function render(body, widget, dash) {
        const u = U();
        const config = widget?.config || {};
        const host = String(config.host || '');
        const panel = u.panel(body);
        const answer = await readJSON('/api/glances/hosts');
        const rows = answer && Array.isArray(answer.hosts) ? answer.hosts : [];
        const row = rows.find((r) => r.id === host) || (host ? null : rows[0]);
        if (!row) {
            u.say(panel, 'dashboard-widget-empty', rows.length
                ? label(dash, 'dashboard.widgetGlancesHostGone', 'This host is not in Config → Glances.')
                : label(dash, 'dashboard.widgetGlancesNotSetUp', 'Glances is not set up yet. Add a host in Config → Glances.'));
            return;
        }

        const [statusKey, statusFallback] = status(dash, row);
        panel.appendChild(u.headline(row.name, label(dash, statusKey, statusFallback)));
        panel.classList.add(`dashboard-widget-glances--${row.configured && !row.paused ? row.level : 'unknown'}`);

        if (!row.configured) {
            u.say(panel, 'dashboard-widget-empty', label(dash, 'dashboard.glancesHostNoAddressShort', 'No address yet'));
        } else if (row.paused) {
            u.say(panel, 'dashboard-widget-empty', label(dash, 'dashboard.glancesHostPaused', 'Connection off'));
        } else if (!row.at) {
            u.say(panel, 'dashboard-widget-empty', label(dash, 'dashboard.glancesHostWaiting', 'Waiting for the first reading'));
        } else if (!row.ok && row.level === 'unknown') {
            // The numbers it had are from before it went away: none are shown.
            u.say(panel, 'dashboard-widget-empty', row.lastOk
                ? label(dash, 'dashboard.glancesHostAway', 'Not answering since {time}').replace('{time}', new Date(row.lastOk).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
                : label(dash, 'dashboard.glancesHostAwayNow', 'Not answering'));
        } else if (config.style === 'graph') {
            panel.appendChild(u.headline(percent(row.cpu), label(dash, 'dashboard.glancesChartCpu', 'Processor')));
            const history = await readJSON(`/api/glances/history?series=cpu&since=${Date.now() - 3600 * 1000}${host ? `&host=${encodeURIComponent(host)}` : ''}`);
            panel.appendChild(sparkline(history?.series?.cpu));
            panel.appendChild(u.footnote(label(dash, 'dashboard.widgetGlancesLastHour', 'last hour')));
        } else {
            [
                [label(dash, 'dashboard.glancesChartCpu', 'Processor'), row.cpu, 'cpu'],
                [label(dash, 'dashboard.glancesChartMem', 'Memory'), row.mem, 'mem'],
                [label(dash, 'dashboard.glancesHostsDisk', 'Fullest disk'), row.disk, 'disk'],
            ].forEach(([name, value, kind]) => {
                const t = typeof value === 'number' ? tone(dash, kind, value) : '';
                panel.appendChild(u.row(name, percent(value), t));
                if (t) panel.appendChild(u.meter(value, 100, t));
            });
        }
        panel.appendChild(opener(dash, host));
        const age = u.asOf(dash, row.at, { intervalMs: Math.max(u.refreshMs(widget, dash), row.every || 0) });
        if (age) panel.appendChild(age);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.glances = render;
}());
