/**
 * Charts over time, drawn with uPlot.
 *
 * Every chart that has axes, a hover or more than one series goes through
 * here, so each of them gets the same things once: the theme's colours (and a
 * redraw when the theme changes), its size from the box it sits in, a tooltip,
 * a drag to zoom, a cursor shared with the charts it belongs with -- and what a
 * canvas does not give by itself: a name, the arrow keys, a line that says the
 * value under the cursor, and a table of every point for a screen reader.
 *
 * A place hands over data, series and how to write a value; nothing else.
 * uPlot (MIT, static/vendor/uplot) is fetched the first time a chart is drawn.
 */
(function (global) {
    'use strict';

    const UPLOT = 'vendor/uplot/1.6.32/uPlot.iife.min.js';
    const TABLE_ROWS = 200;
    let loading = null;
    const live = new Set();
    const syncs = new Map();

    function load() {
        if (global.uPlot) return Promise.resolve(global.uPlot);
        if (!loading) {
            loading = global.LazyScript.loadScriptOnce(UPLOT, 'ndChartUplot', () => typeof global.uPlot === 'function')
                .then(() => global.uPlot)
                .catch((error) => {
                    loading = null;
                    throw error;
                });
        }
        return loading;
    }

    function cssVar(el, name) {
        return getComputedStyle(el).getPropertyValue(name).trim();
    }

    /** A colour as rgba at this alpha, whatever form the theme wrote it in. */
    function withAlpha(color, alpha) {
        const probe = document.createElement('span');
        probe.style.color = color;
        document.body.appendChild(probe);
        const rgb = getComputedStyle(probe).color;
        probe.remove();
        const m = rgb.match(/[\d.]+/g);
        return m ? `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${alpha})` : color;
    }

    function timeText(seconds, kind) {
        const d = new Date(seconds * 1000);
        if (kind === 'date') return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
        // On an axis the weekday makes every label too wide for its slot.
        if (kind === 'day') return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
        if (kind === 'datetime') return d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    /**
     * One line for a point: when, then each series' value. Tooltip, readout and
     * table say the same. A place whose series are one value split by colour
     * (bars by tone) says it in its own words through spec.text.
     */
    function pointText(spec, i) {
        if (typeof spec.text === 'function') return spec.text(i);
        const when = timeText(spec.x[i], spec.format?.x || 'time');
        const values = spec.series.map((s) => {
            const v = s.values[i];
            const shown = v == null ? '—' : (s.format || spec.format?.y || String)(v);
            return spec.series.length > 1 ? `${s.label} ${shown}` : shown;
        });
        return `${when} · ${values.join(' · ')}`;
    }

    /*
     * Every point as a table, for whoever cannot see the canvas. A long series
     * is summarised rather than read out in full: two hundred rows is already
     * more than anyone listens to, and the keys reach every point anyway.
     * The sr-only class sits on a wrapper: a table ignores height: 1px and
     * grows to its rows, which gave the surrounding dialog a long empty scroll.
     */
    function buildTable(spec) {
        const wrap = document.createElement('div');
        wrap.className = 'config-sr-only nd-chart-table-wrap';
        const table = document.createElement('table');
        table.className = 'nd-chart-table';
        wrap.appendChild(table);
        const caption = document.createElement('caption');
        caption.textContent = spec.summary || '';
        table.appendChild(caption);
        const n = spec.x.length;
        const step = Math.max(1, Math.ceil(n / TABLE_ROWS));
        const body = document.createElement('tbody');
        for (let i = 0; i < n; i += step) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.textContent = pointText(spec, Math.min(n - 1, i + step - 1));
            tr.appendChild(td);
            body.appendChild(tr);
        }
        table.appendChild(body);
        return wrap;
    }

    function syncFor(key) {
        if (!key || !global.uPlot) return null;
        if (!syncs.has(key)) syncs.set(key, global.uPlot.sync(key));
        return syncs.get(key);
    }

    /**
     * Draws a chart into host and returns { update(spec), destroy(), plot }.
     * spec: { x: [seconds], series: [{ label, values, color: '--var', fill, dash, width, scale, bars, format }],
     *         format: { x: 'time'|'date'|'datetime', y: fn, tick: fn }, text: (i) => string,
     *         scales, sync, summary, height, axisWidth }
     */
    function chart(host, spec) {
        const uPlot = global.uPlot;
        if (!uPlot) throw new Error('NdChart.load() first');

        const box = document.createElement('div');
        box.className = 'nd-chart';
        box.tabIndex = 0;
        box.setAttribute('role', 'group');
        const plotHost = document.createElement('div');
        plotHost.className = 'nd-chart-plot';
        const tip = document.createElement('div');
        tip.className = 'nd-chart-tip';
        tip.hidden = true;
        const readout = document.createElement('p');
        readout.className = 'nd-chart-readout';
        readout.setAttribute('aria-live', 'polite');
        box.append(plotHost, readout);
        host.replaceChildren(box);

        let current = spec;
        let plot = null;
        let index = -1;
        let zoomed = null;

        const options = () => {
            const muted = cssVar(box, '--text-muted') || cssVar(box, '--text-secondary');
            const grid = cssVar(box, '--border-secondary') || cssVar(box, '--border-primary');
            // Both axes drawn as a line, not only as labels: a chart reads as
            // a chart when its x and y are there to see.
            // In the muted text colour, so the axes stand out from the grid
            // lines behind them rather than being one more of them.
            const axisLine = muted;
            const axis = {
                stroke: muted, font: '11px ui-monospace, SFMono-Regular, Menlo, monospace',
                grid: { stroke: grid, width: 1 }, ticks: { show: true, stroke: axisLine, width: 1, size: 4 },
                border: { show: true, stroke: axisLine, width: 1 },
            };
            const scales = { ...(current.scales || {}), x: { time: true, ...(current.scales?.x || {}) } };
            const extraScales = [...new Set(current.series.map((s) => s.scale).filter((s) => s && s !== 'y'))];
            return {
                width: Math.max(80, plotHost.clientWidth || host.clientWidth || 300),
                height: current.height || 120,
                legend: { show: false },
                scales,
                cursor: {
                    drag: { x: true, y: false },
                    points: { size: 6 },
                    ...(current.sync ? { sync: { key: syncFor(current.sync).key, setSeries: false } } : {}),
                },
                axes: [
                    // Time labels take one line, not uPlot's roomy default:
                    // in a 96px drawer chart that default left five for the line.
                    { ...axis, grid: { show: false }, size: 22, gap: 3, space: 56,
                      // A label equal to the one before it says nothing: a
                      // few minutes of 30 s samples read 20:51, 20:51, 20:52.
                      values: (u, vals) => vals.map((v) => timeText(v, current.format?.x === 'time' ? 'time' : 'day'))
                          .map((label, i, all) => (i > 0 && label === all[i - 1] ? '' : label)),
                      show: current.axisX !== false },
                    { ...axis, size: current.axisWidth || 46,
                      values: (u, vals) => vals.map((v) => (current.format?.tick || current.format?.y || String)(v)) },
                    ...extraScales.map((scale) => ({ scale, show: false })),
                ],
                series: [{}, ...current.series.map((s) => {
                    const color = s.color?.startsWith('--') ? cssVar(box, s.color) : (s.color || cssVar(box, '--accent-primary'));
                    return {
                        label: s.label,
                        scale: s.scale || 'y',
                        stroke: s.bars ? color : color,
                        width: s.bars ? 0 : (s.width || 1.5),
                        dash: s.dash || undefined,
                        fill: s.bars ? withAlpha(color, 0.75) : (s.fill === false ? undefined : withAlpha(color, 0.16)),
                        paths: s.bars ? uPlot.paths.bars({ size: [0.7, 40] }) : undefined,
                        points: { show: false },
                    };
                })],
                hooks: {
                    setCursor: [(u) => {
                        const i = u.cursor.idx;
                        // Only the chart being pointed at says the value; the
                        // ones that follow it show the line and the point.
                        const pointed = plot?.over.matches(':hover');
                        if (i == null || !(pointed || document.activeElement === box)) {
                            tip.hidden = true;
                            return;
                        }
                        tip.hidden = false;
                        tip.textContent = pointText(current, i);
                        tip.style.left = `${u.cursor.left}px`;
                        tip.style.top = `${u.cursor.top}px`;
                    }],
                    setScale: [(u, key) => {
                        if (key !== 'x') return;
                        const n = current.x.length;
                        const full = n && u.scales.x.min <= current.x[0] && u.scales.x.max >= current.x[n - 1];
                        zoomed = full ? null : [u.scales.x.min, u.scales.x.max];
                    }],
                },
            };
        };

        const dataOf = (s) => [s.x, ...s.series.map((series) => series.values)];

        function draw() {
            plot?.destroy();
            if (current.sync) syncFor(current.sync);
            plot = new uPlot(options(), dataOf(current), plotHost);
            plot.over.appendChild(tip);
            plot.over.addEventListener('pointerleave', () => { tip.hidden = true; });
            if (current.sync) syncFor(current.sync).sub(plot);
            if (zoomed) plot.setScale('x', { min: zoomed[0], max: zoomed[1] });
            describe();
        }

        function describe() {
            box.setAttribute('aria-label', current.summary || '');
            box.querySelector('.nd-chart-table-wrap')?.remove();
            box.appendChild(buildTable(current));
        }

        function show(i) {
            const n = current.x.length;
            if (!n || !plot) return;
            index = Math.max(0, Math.min(n - 1, i));
            const firstSeries = current.series[0].values;
            plot.setCursor({
                left: plot.valToPos(current.x[index], 'x'),
                top: plot.valToPos(firstSeries[index] ?? 0, current.series[0].scale || 'y'),
            });
            readout.textContent = pointText(current, index);
        }

        function visibleRange() {
            const lo = current.x.findIndex((t) => t >= plot.scales.x.min);
            let hi = -1;
            for (let i = current.x.length - 1; i >= 0; i -= 1) {
                if (current.x[i] <= plot.scales.x.max) { hi = i; break; }
            }
            return [Math.max(0, lo), hi < 0 ? current.x.length - 1 : hi];
        }

        function zoom(factor) {
            const n = current.x.length;
            if (n < 2) return;
            const full = [current.x[0], current.x[n - 1]];
            if (!factor) {
                // Back to the chart's own range: bars keep the half slot either side.
                const range = current.scales?.x?.range;
                const [min, max] = typeof range === 'function' ? range(plot, full[0], full[1]) : full;
                plot.setScale('x', { min, max });
                return;
            }
            const mid = current.x[index >= 0 ? index : n - 1];
            const span = (plot.scales.x.max - plot.scales.x.min) * factor;
            const min = Math.max(full[0], mid - span / 2);
            const max = Math.min(full[1], min + span);
            plot.setScale('x', { min, max });
        }

        box.addEventListener('focus', () => show(index >= 0 ? index : current.x.length - 1));
        box.addEventListener('blur', () => { tip.hidden = true; readout.textContent = ''; });
        box.addEventListener('keydown', (e) => {
            const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
            if (step) show(index + step * (e.shiftKey ? 10 : 1));
            else if (e.key === 'Home') show(visibleRange()[0]);
            else if (e.key === 'End') show(visibleRange()[1]);
            else if (e.key === '+' || e.key === '=') { zoom(0.5); show(index); }
            else if (e.key === '-' || e.key === '_') { zoom(2); show(index); }
            else if (e.key === '0') { zoom(0); show(index); }
            else return;
            e.preventDefault();
            e.stopPropagation();
        });

        const resize = new ResizeObserver(() => {
            const width = plotHost.clientWidth;
            if (plot && width && Math.abs(width - plot.width) > 1) plot.setSize({ width, height: plot.height });
        });
        resize.observe(plotHost);

        const handle = {
            get plot() { return plot; },
            /** New data, same chart: a zoom someone made stays where they put it. */
            update(next) {
                const sameShape = next.series.length === current.series.length;
                current = { ...current, ...next };
                if (!plot || !sameShape) { draw(); return; }
                // New data every few seconds drops the cursor; someone still
                // pointing at the chart keeps theirs, and its tooltip.
                const pointer = plot.over.matches(':hover') && plot.cursor.left >= 0
                    ? { left: plot.cursor.left, top: plot.cursor.top } : null;
                plot.setData(dataOf(current), !zoomed);
                if (zoomed) plot.setScale('x', { min: zoomed[0], max: zoomed[1] });
                if (pointer) plot.setCursor(pointer);
                describe();
                if (document.activeElement === box && index >= 0) show(Math.min(index, current.x.length - 1));
            },
            redraw: draw,
            destroy() {
                resize.disconnect();
                if (current.sync) syncFor(current.sync)?.unsub(plot);
                plot?.destroy();
                plot = null;
                live.delete(handle);
            },
        };
        live.add(handle);
        draw();
        return handle;
    }

    // uPlot draws colours once; a theme change draws every live chart again.
    document.addEventListener('theme-changed', () => {
        live.forEach((handle) => {
            if (handle.plot && !document.contains(handle.plot.root)) handle.destroy();
            else handle.redraw();
        });
    });

    global.NdChart = { load, chart, pointText, timeText };
})(window);
