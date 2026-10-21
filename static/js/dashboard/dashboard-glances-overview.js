/**
 * Glances view, Overview: four number cards (cpu, ram, load, temperature) and
 * a cpu chart from Glances' own history. The full History section draws the
 * rest; this one stays a glance.
 *
 * Unknown is not zero: a reading the host did not send is a dash.
 */
(function () {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const HISTORY = 'cpu/history/60';

    /** Temperature tones when a sensor has no limits of its own -- the tile's. */
    const TEMP_WARN = 70;
    const TEMP_BAD = 85;

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    /** The hottest temperature sensor, or null. A fan speed is not a temperature. */
    function hottest(sensors) {
        const G = window.DashboardGlances;
        if (!Array.isArray(sensors)) return null;
        let best = null;
        sensors.forEach((s) => {
            if (!String(s?.type || '').startsWith('temperature')) return;
            const value = G.num(s.value);
            if (value === null) return;
            if (!best || value > best.value) {
                best = { value, label: String(s.label || ''), warn: G.num(s.warning), crit: G.num(s.critical) };
            }
        });
        return best;
    }

    function tempTone(t) {
        if (!t) return '';
        const warn = t.warn ?? TEMP_WARN;
        const bad = t.crit ?? TEMP_BAD;
        if (t.value >= bad) return 'bad';
        if (t.value >= warn) return 'warn';
        return '';
    }

    class GlancesOverview {
        constructor(view) {
            this.view = view;
        }

        endpoints() {
            return ['quicklook', 'mem', 'load', 'sensors', HISTORY];
        }

        render(container, data) {
            const G = window.DashboardGlances;
            const v = this.view;
            const quick = G.usable(data.quicklook) || {};
            const mem = G.usable(data.mem) || {};
            const load = G.usable(data.load) || {};
            const temp = hottest(G.usable(data.sensors));

            const cpu = G.num(quick.cpu);
            const ram = G.num(quick.mem) ?? G.num(mem.percent);
            const min1 = G.num(load.min1);
            const min5 = G.num(load.min5);
            const min15 = G.num(load.min15);
            const cores = G.num(load.cpucore);
            const pct = (n) => (n === null ? G.DASH : `${Math.round(n)}%`);
            const fixed = (n) => (n === null ? G.DASH : n.toFixed(2));

            const memUsed = G.num(mem.used);
            const memTotal = G.num(mem.total);
            const cards = [
                { key: 'cpu', label: v.t('dashboard.glancesCardCpu', 'CPU'), value: pct(cpu),
                    tone: G.tone(cpu), sub: typeof quick.cpu_name === 'string' ? quick.cpu_name : '' },
                { key: 'ram', label: v.t('dashboard.glancesCardRam', 'RAM'), value: pct(ram), tone: G.tone(ram),
                    sub: memUsed !== null && memTotal !== null ? `${G.formatBytes(memUsed)} / ${G.formatBytes(memTotal)}` : '' },
                { key: 'load', label: v.t('dashboard.glancesCardLoad', 'Load'), value: fixed(min1),
                    // Load is per machine, so it warns against the core count.
                    tone: min1 !== null && cores ? G.tone((min1 / cores) * 100) : '',
                    sub: min5 !== null || min15 !== null
                        ? v.t('dashboard.glancesCardLoadSub', '5 min {five} · 15 min {fifteen}', { five: fixed(min5), fifteen: fixed(min15) })
                        : '' },
                { key: 'temp', label: v.t('dashboard.glancesCardTemp', 'Temperature'),
                    value: temp ? `${Math.round(temp.value)}°` : G.DASH, tone: tempTone(temp), sub: temp ? temp.label : '' },
            ];

            const grid = el('div', 'glances-cards');
            cards.forEach((card) => {
                const box = el('div', 'glances-card');
                box.setAttribute('data-glances-card', card.key);
                if (card.tone) box.setAttribute('data-tone', card.tone);
                box.append(el('span', 'glances-card-label', card.label), el('span', 'glances-card-value', card.value));
                if (card.sub) box.appendChild(el('span', 'glances-card-sub', card.sub));
                grid.appendChild(box);
            });

            const parts = [grid];
            const chart = this.chart(data[HISTORY]);
            if (chart) parts.push(chart);
            container.replaceChildren(...parts);
        }

        /** A cpu line from Glances' history; nothing at all when it has none yet. */
        chart(answer) {
            const G = window.DashboardGlances;
            const body = G.usable(answer);
            const series = Array.isArray(body?.total) ? body.total : (Array.isArray(body?.cpu) ? body.cpu : null);
            if (!series) return null;
            const points = series
                .map((p) => (Array.isArray(p) ? { at: Date.parse(p[0]), value: G.num(p[1]) } : null))
                .filter((p) => p && p.value !== null);
            if (points.length < 2) return null;

            const W = 300;
            const H = 60;
            const step = W / (points.length - 1);
            const y = (value) => (H - (Math.max(0, Math.min(100, value)) / 100) * H).toFixed(1);
            const line = points.map((p, i) => `${(i * step).toFixed(1)},${y(p.value)}`).join(' ');

            const figure = el('figure', 'glances-chart');
            figure.setAttribute('data-glances-chart', 'cpu');
            const svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('focusable', 'false');
            const area = document.createElementNS(SVG_NS, 'polygon');
            area.setAttribute('class', 'glances-chart-area');
            area.setAttribute('points', `0,${H} ${line} ${W},${H}`);
            const path = document.createElementNS(SVG_NS, 'polyline');
            path.setAttribute('class', 'glances-chart-line');
            path.setAttribute('points', line);
            path.setAttribute('vector-effect', 'non-scaling-stroke');
            svg.append(area, path);

            // The span is read from the answer's own timestamps, never assumed.
            const first = points[0].at;
            const last = points[points.length - 1].at;
            const minutes = Number.isFinite(first) && Number.isFinite(last) ? Math.max(1, Math.round((last - first) / 60000)) : null;
            const caption = el('figcaption', 'glances-chart-caption', minutes
                ? this.view.t('dashboard.glancesChartCpuSpan', 'CPU, last {minutes} min', { minutes })
                : this.view.t('dashboard.glancesChartCpu', 'CPU'));
            figure.append(caption, svg);
            return figure;
        }
    }

    window.DashboardGlancesSections.register({
        id: 'overview',
        label: 'Overview',
        labelKey: 'dashboard.glancesSectionOverview',
        order: 10,
        plugin: 'quicklook',
        Section: GlancesOverview,
        /** The dot: cpu or ram at the warning line, or a temperature past its own. */
        badge(feed) {
            const G = window.DashboardGlances;
            const quick = G.usable(feed.quicklook) || {};
            const hot = tempTone(hottest(G.usable(feed.sensors)));
            return { warn: Boolean(G.tone(G.num(quick.cpu)) || G.tone(G.num(quick.mem)) || hot) };
        },
    });
}());
