/**
 * Glances view, History: one small line chart per plugin from Glances' own
 * history (cpu, mem, memswap, load, network, diskio), in the style of the
 * overview's cpu chart.
 *
 * The time span in each caption is computed from the timestamps in the
 * answer, never assumed. A series with fewer than two points draws nothing,
 * and a plugin with no usable series gets no chart at all.
 */
(function () {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const POINTS = 60;
    const MAX_SERIES = 4;

    /**
     * What each plugin draws: its caption, the series keys to prefer (else every
     * series in the answer), whether it is a percentage, and how to print a value.
     */
    const PLUGINS = [
        { id: 'cpu', label: ['dashboard.glancesChartCpu', 'CPU'], keys: ['total'], percent: true },
        { id: 'mem', label: ['dashboard.glancesChartMem', 'RAM'], keys: ['percent'], percent: true },
        { id: 'memswap', label: ['dashboard.glancesChartSwap', 'Swap'], keys: ['percent'], percent: true },
        { id: 'load', label: ['dashboard.glancesChartLoad', 'Load'], keys: ['min1', 'min5', 'min15'] },
        { id: 'network', label: ['dashboard.glancesChartNetwork', 'Network'], rate: true },
        { id: 'diskio', label: ['dashboard.glancesChartDiskio', 'Disk I/O'], rate: true },
    ];

    function el(tag, className, content) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (content !== undefined) node.textContent = content;
        return node;
    }

    function svgEl(tag, attrs) {
        const node = document.createElementNS(SVG_NS, tag);
        Object.entries(attrs).forEach(([k, val]) => node.setAttribute(k, val));
        return node;
    }

    /** [[timestamp, number], ...] -> points with a time and a value; others dropped. */
    function points(series) {
        const G = window.DashboardGlances;
        if (!Array.isArray(series)) return [];
        return series
            .map((p) => (Array.isArray(p) ? { at: Date.parse(p[0]), value: G.num(p[1]) } : null))
            .filter((p) => p && p.value !== null);
    }

    class GlancesHistory {
        constructor(view) {
            this.view = view;
        }

        /** Only the plugins the host runs. */
        endpoints() {
            const plugins = this.view.plugins;
            return PLUGINS.filter((p) => !plugins || plugins.has(p.id)).map((p) => `${p.id}/history/${POINTS}`);
        }

        render(container, data) {
            const G = window.DashboardGlances;
            const charts = [];
            PLUGINS.forEach((def) => {
                const body = G.usable(data[`${def.id}/history/${POINTS}`]);
                if (!body || typeof body !== 'object' || Array.isArray(body)) return;
                const chart = this.chart(def, body);
                if (chart) charts.push(chart);
            });
            if (!charts.length) {
                const empty = el('p', 'glances-note', this.view.t('dashboard.glancesHistoryEmpty', 'Glances has no history yet.'));
                empty.setAttribute('data-glances-history-empty', '');
                container.replaceChildren(empty);
                return;
            }
            const grid = el('div', 'glances-charts');
            grid.append(...charts);
            container.replaceChildren(grid);
        }

        /** The series to draw: preferred keys, else the rate series, else all; at least two points each. */
        series(def, body) {
            let keys = Object.keys(body);
            if (def.keys) {
                const wanted = def.keys.filter((k) => Array.isArray(body[k]));
                if (wanted.length) keys = wanted;
            } else if (def.rate) {
                const rates = keys.filter((k) => /rate/.test(k));
                if (rates.length) keys = rates;
            }
            return keys
                .map((key) => ({ key, pts: points(body[key]) }))
                .filter((s) => s.pts.length >= 2)
                .slice(0, MAX_SERIES);
        }

        format(def, value) {
            const G = window.DashboardGlances;
            if (def.percent) return `${Math.round(value)}%`;
            if (def.rate) return `${G.formatBytes(value)}/s`;
            return value.toFixed(2);
        }

        chart(def, body) {
            const v = this.view;
            const series = this.series(def, body);
            if (!series.length) return null;

            const W = 300;
            const H = 60;
            const all = series.flatMap((s) => s.pts);
            const top = def.percent ? 100 : Math.max(...all.map((p) => p.value), 0);
            const scale = top > 0 ? top : 1;
            const y = (value) => (H - (Math.max(0, Math.min(scale, value)) / scale) * H).toFixed(1);

            const svg = svgEl('svg', {
                viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false',
            });
            series.forEach((s, i) => {
                const step = W / (s.pts.length - 1);
                const line = s.pts.map((p, n) => `${(n * step).toFixed(1)},${y(p.value)}`).join(' ');
                if (series.length === 1) {
                    svg.appendChild(svgEl('polygon', { class: 'glances-chart-area', points: `0,${H} ${line} ${W},${H}` }));
                }
                svg.appendChild(svgEl('polyline', {
                    class: `glances-chart-line glances-chart-line--${i}`, points: line, 'vector-effect': 'non-scaling-stroke',
                }));
            });

            // The span comes from the answer's own timestamps.
            const times = all.map((p) => p.at).filter((t) => Number.isFinite(t));
            const name = v.t(def.label[0], def.label[1]);
            let caption = name;
            if (times.length >= 2) {
                const minutes = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 60000));
                caption = minutes >= 120
                    ? v.t('dashboard.glancesHistorySpanHours', '{name}, last {hours} h', { name, hours: Math.round(minutes / 60) })
                    : v.t('dashboard.glancesHistorySpanMinutes', '{name}, last {minutes} min', { name, minutes });
            }

            const figure = el('figure', 'glances-chart');
            figure.setAttribute('data-glances-chart', def.id);
            const peak = Math.max(...all.map((p) => p.value));
            const head = el('figcaption', 'glances-chart-caption');
            head.append(
                el('span', '', caption),
                el('span', 'glances-chart-peak', v.t('dashboard.glancesHistoryPeak', 'max {value}', { value: this.format(def, peak) })),
            );
            figure.append(head, svg);
            if (series.length > 1) {
                const legend = el('p', 'glances-chart-legend', series.map((s) => s.key).join(' · '));
                figure.appendChild(legend);
            }
            return figure;
        }
    }

    window.DashboardGlancesSections.register({
        id: 'history',
        label: 'History',
        labelKey: 'dashboard.glancesSectionHistory',
        order: 60,
        plugin: 'cpu',
        Section: GlancesHistory,
    });
}());
