/**
 * Response-time trends of network checks: the sparkline beside a check and the
 * spec of the chart in the Tests tab.
 *
 * The server does the counting (internal/app/nettool_trend.go). A sparkline is
 * the last day as 24 values: a mean in ms, 0 where no check ran and -1 where
 * every check in the slice failed. A chart is the points of GET /api/net/trend.
 * Nothing here talks to the network; the chart itself is drawn by NdChart.
 */
(function (global) {
    'use strict';

    const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** "412 ms", "2.4 s". */
    function formatMs(ms) {
        const v = Number(ms) || 0;
        return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s` : `${Math.round(v)} ms`;
    }

    /** The sparkline is worth drawing when two slices were measured. */
    function hasSpark(values) {
        return Array.isArray(values) && values.filter((v) => v > 0).length >= 2;
    }

    /**
     * The last day as an inline SVG. values: server slices; opts: width, height,
     * maxMs (the check's slow threshold, drawn when it is near the line),
     * label (the accessible name, ending in the newest value).
     */
    function sparkSvg(values, opts = {}) {
        if (!hasSpark(values)) return '';
        const w = opts.width || 96;
        const h = opts.height || 24;
        const pad = 3;
        const n = values.length;
        const valid = values.filter((v) => v > 0);
        const top = Math.max(...valid);
        const thr = Number(opts.maxMs) > 0 && opts.maxMs <= top * 2.5 ? Number(opts.maxMs) : 0;
        const max = Math.max(top, thr) * 1.08;
        const x = (i) => pad + ((w - 2 * pad) * i) / Math.max(1, n - 1);
        const y = (v) => h - pad - ((h - 2 * pad) * v) / max;
        let path = '';
        let marks = '';
        let last = -1;
        for (let i = 0; i < n; i += 1) {
            const v = values[i];
            if (v > 0) {
                const alone = !(values[i - 1] > 0) && !(values[i + 1] > 0);
                if (alone) marks += `<circle class="net-spark-pt" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="1.4"/>`;
                path += `${values[i - 1] > 0 ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
                last = i;
            } else if (v < 0) {
                marks += `<circle class="net-spark-fail" cx="${x(i).toFixed(1)}" cy="${h - pad - 1}" r="1.8"/>`;
            }
        }
        const line = thr
            ? `<line class="net-spark-thr" x1="0" x2="${w}" y1="${y(thr).toFixed(1)}" y2="${y(thr).toFixed(1)}"/>`
            : '';
        const slow = thr && values[last] > thr ? ' is-slow' : '';
        const end = last >= 0 ? `<circle class="net-spark-end${slow}" cx="${x(last).toFixed(1)}" cy="${y(values[last]).toFixed(1)}" r="2.2"/>` : '';
        const label = opts.label ? `${opts.label} ${formatMs(values[last])}` : '';
        return `<svg class="net-spark${opts.cls ? ` ${esc(opts.cls)}` : ''}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}" data-net-spark>${line}<path class="net-spark-line" d="${path}"/>${marks}${end}</svg>`;
    }

    /** The newest measured slice of a sparkline: the figure beside it. */
    function lastValue(values) {
        if (!Array.isArray(values)) return 0;
        for (let i = values.length - 1; i >= 0; i -= 1) if (values[i] > 0) return values[i];
        return 0;
    }

    /**
     * How far the newest slice is from the day's usual: "+130%" or "", and only
     * when it is worth a word (a third or more, and 20 ms or more).
     */
    function deltaPercent(values) {
        const valid = (values || []).filter((v) => v > 0);
        if (valid.length < 4) return 0;
        const latest = valid[valid.length - 1];
        const rest = valid.slice(0, -1).sort((a, b) => a - b);
        const norm = rest[Math.floor(rest.length / 2)];
        if (!norm || Math.abs(latest - norm) < 20) return 0;
        const pct = Math.round(((latest - norm) / norm) * 100);
        return Math.abs(pct) >= 33 ? pct : 0;
    }

    /**
     * The chart of one range for NdChart.chart: the mean as a line with its
     * fill, the slowest in each stretch as a dashed line, the slow threshold as
     * a dashed line across, and a mark on the floor wherever a check failed.
     * data is the answer of /api/net/trend; t(key, english) writes a word.
     */
    function chartSpec(data, t) {
        const say = t || ((k, f) => f);
        const pts = Array.isArray(data?.points) ? data.points : [];
        const x = pts.map((p) => (p.t + p.w / 2) / 1000);
        const avg = pts.map((p) => (p.a > 0 ? p.a : null));
        const series = [{ label: say('nettrend.average', 'Average'), values: avg, color: '--accent-primary', format: formatMs }];
        if (pts.some((p) => p.x > p.a && p.a > 0)) {
            series.push({ label: say('nettrend.slowest', 'Slowest'), values: pts.map((p) => (p.x > 0 ? p.x : null)), color: '--text-muted', dash: [4, 4], fill: false, width: 1, format: formatMs });
        }
        const thr = Number(data?.maxMs) || 0;
        const peak = Math.max(0, ...pts.map((p) => p.x || p.a || 0));
        if (thr > 0 && thr <= Math.max(peak, 1) * 3) {
            series.push({ label: say('nettrend.limit', 'Limit'), values: pts.map(() => thr), color: '--accent-warning', dash: [6, 4], fill: false, width: 1, format: formatMs });
        }
        if (pts.some((p) => p.f > 0)) {
            series.push({ label: say('nettrend.failed', 'Failed'), values: pts.map((p) => (p.f > 0 ? 0 : null)), color: '--accent-error', fill: false, points: true, width: 1, format: (v) => (v === 0 ? say('nettrend.yes', 'yes') : '') });
        }
        const top = Math.max(peak, thr > 0 && thr <= peak * 3 ? thr : 0, 1);
        return {
            x,
            series,
            format: { x: data?.range === '24h' ? 'time' : 'day', y: formatMs },
            text: (i) => {
                const p = pts[i];
                const when = new Date(p.t).toLocaleString([], p.w >= 86400000
                    ? { weekday: 'short', day: 'numeric', month: 'short' }
                    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                const bits = [when];
                if (p.a > 0) bits.push(`${formatMs(p.a)} ${say('nettrend.avgShort', 'avg')}`);
                if (p.x > p.a && p.a > 0) bits.push(`${formatMs(p.x)} ${say('nettrend.peakShort', 'peak')}`);
                if (p.f > 0) bits.push(`${p.f} ${say('nettrend.failedShort', 'failed')}`);
                return bits.join(' · ');
            },
            scales: { y: { range: () => [0, top * 1.15] } },
            summary: say('nettrend.summary', 'Response time, {count} points, average {avg}').replace('{count}', String(pts.length)).replace('{avg}', formatMs(data?.avg || 0)),
            height: 190,
            axisWidth: 52,
        };
    }

    global.NetTrend = { sparkSvg, hasSpark, lastValue, deltaPercent, formatMs, chartSpec };
})(typeof window !== 'undefined' ? window : globalThis);
