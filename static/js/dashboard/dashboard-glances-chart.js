/**
 * Glances page: the graphs the Overview and History share.
 *
 * Inline SVG, no library. A chart is one or more series of [unix ms, value]
 * points from nextDash's own record of the host; the x axis is time, so a gap
 * (the host did not answer) is a gap in the line and never a slope down to
 * zero. Nothing is drawn for a series with fewer than two points.
 *
 * Every graph has its own range -- the last minute, hour, six, twelve or
 * twenty-four hours -- chosen on that graph and remembered, so one part of the
 * page can look back a day while another watches the last minute.
 */
(function () {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const W = 300;
    const STORE = 'nextdash:glances-ranges-v1';
    const MAX_LINES = 4;

    const RANGES = [
        { id: '1m', ms: 60 * 1000, label: ['dashboard.glancesRange1m', '1 min'] },
        { id: '1h', ms: 3600 * 1000, label: ['dashboard.glancesRange1h', '1 hour'] },
        { id: '6h', ms: 6 * 3600 * 1000, label: ['dashboard.glancesRange6h', '6 hours'] },
        { id: '12h', ms: 12 * 3600 * 1000, label: ['dashboard.glancesRange12h', '12 hours'] },
        { id: '24h', ms: 24 * 3600 * 1000, label: ['dashboard.glancesRange24h', '24 hours'] },
        { id: '7d', ms: 7 * 24 * 3600 * 1000, label: ['dashboard.glancesRange7d', '7 days'] },
        { id: '30d', ms: 30 * 24 * 3600 * 1000, label: ['dashboard.glancesRange30d', '30 days'] },
    ];

    /**
     * What each graph is made of: which recorded series it draws, how a value
     * prints, and its scale. `names` picks series out of what the record holds.
     */
    const GROUPS = [
        { id: 'cpu', label: ['dashboard.glancesChartCpu', 'Processor'], match: (n) => n === 'cpu', percent: true,
            compare: true, incidents: ['cpu'] },
        { id: 'memory', label: ['dashboard.glancesChartMem', 'Memory'], match: (n) => n === 'mem' || n === 'swap', percent: true,
            compare: true, incidents: ['mem', 'swap'], name: (n) => (n === 'mem' ? 'RAM' : 'Swap') },
        // What the memory is made of: programs at the bottom, cache above, free on top; the layers make a hundred.
        { id: 'memparts', label: ['dashboard.glancesChartMemParts', 'Memory: programs, cache, free'],
            match: (n) => n.startsWith('memc:'), percent: true, stacked: true, incidents: ['mem'],
            order: ['memc:used', 'memc:cache', 'memc:free'],
            name: (n, t) => ({
                'memc:used': t('dashboard.glancesMemUsed', 'Programs'),
                'memc:cache': t('dashboard.glancesMemCache', 'Cache'),
                'memc:free': t('dashboard.glancesMemFree', 'Free'),
            }[n] || n) },
        { id: 'load', label: ['dashboard.glancesChartLoad', 'Load'], match: (n) => /^load(1|5|15)$/.test(n), fixed: 2,
            name: (n) => `${n.slice(4)} min` },
        { id: 'network', label: ['dashboard.glancesChartNetwork', 'Network'], match: (n) => n.startsWith('net:'), rate: true, compare: true,
            name: (n) => n.slice(4).replace(':rx', ' ↓').replace(':tx', ' ↑') },
        { id: 'diskio', label: ['dashboard.glancesChartDiskio', 'Disk activity'], match: (n) => n.startsWith('disk:'), rate: true,
            name: (n) => n.slice(5).replace(':read', ' read').replace(':write', ' write') },
        { id: 'disks', label: ['dashboard.glancesChartDisks', 'Disk usage'], match: (n) => n.startsWith('fs:'), percent: true, incidents: ['disk'],
            name: (n) => n.slice(3) },
        { id: 'temps', label: ['dashboard.glancesChartTemps', 'Temperatures'], match: (n) => n.startsWith('temp:'), unit: '°', incidents: ['temp'],
            name: (n) => n.slice(5) },
    ];

    const DAY = 24 * 3600 * 1000;
    const COMPARE_STORE = 'nextdash:glances-compare-v1';
    const INCIDENT_LABELS = {
        down: ['dashboard.glancesInsKindDown', 'Host not answering'],
        cpu: ['dashboard.glancesInsKindCpu', 'Processor'],
        mem: ['dashboard.glancesInsKindMem', 'Memory'],
        swap: ['dashboard.glancesInsKindSwap', 'Swap'],
        disk: ['dashboard.glancesInsKindDisk', 'Disk'],
        temp: ['dashboard.glancesInsKindTemp', 'Temperature'],
    };

    function svgEl(tag, attrs) {
        const node = document.createElementNS(SVG_NS, tag);
        Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, String(v)));
        return node;
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    /** [[t, v], ...] -> { t, v } with finite numbers only, oldest first. */
    function clean(points) {
        if (!Array.isArray(points)) return [];
        return points
            .map((p) => (Array.isArray(p) ? { t: Number(p[0]), v: Number(p[1]) } : null))
            .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v))
            .sort((a, b) => a.t - b.t);
    }

    /** The time between points that a gap has to exceed: three typical steps. */
    function gapLimit(points) {
        if (points.length < 3) return Infinity;
        const steps = [];
        for (let i = 1; i < points.length; i += 1) steps.push(points[i].t - points[i - 1].t);
        steps.sort((a, b) => a - b);
        const median = steps[Math.floor(steps.length / 2)] || 0;
        return median > 0 ? median * 3 : Infinity;
    }

    /**
     * Draw series into one svg.
     *   series:  [{ name, points, ghost?, ref? }]; a ghost is a dashed line that
     *            borrows the colour of series `ref` (yesterday behind today)
     *   max:     fixed top of the scale (100 for a percentage); else the largest value
     *   height:  viewBox height (default 60)
     *   area:    fill under a lone series
     *   stacked: the series are layers on top of each other, in the order given
     * Returns { svg, peak, from, to } or null when nothing has two points.
     */
    function draw({ series, max = null, height = 60, area = true, stacked = false }) {
        const H = height;
        const drawn = (series || [])
            .map((s) => ({
                name: s.name, ghost: Boolean(s.ghost), ref: s.ref ?? 0,
                pts: s.points && s.points.length && s.points[0] && !Array.isArray(s.points[0]) ? s.points : clean(s.points),
            }))
            .filter((s) => s.pts.length >= 2);
        if (!drawn.length) return null;
        const solid = drawn.filter((s) => !s.ghost);
        if (!solid.length) return null;

        const all = drawn.flatMap((s) => s.pts);
        const from = Math.min(...all.map((p) => p.t));
        const to = Math.max(...all.map((p) => p.t));
        // Layers add up: the scale is the tallest stack, not the tallest layer.
        let cumulative = null;
        let times = [];
        if (stacked) {
            const byTime = new Map();
            solid.forEach((s, i) => s.pts.forEach((p) => {
                if (!byTime.has(p.t)) byTime.set(p.t, new Array(solid.length).fill(0));
                byTime.get(p.t)[i] = p.v;
            }));
            times = [...byTime.keys()].sort((a, b) => a - b);
            cumulative = times.map((t) => {
                let run = 0;
                return byTime.get(t).map((v) => { run += v; return run; });
            });
        }
        const peak = stacked ? Math.max(...cumulative.map((c) => c[c.length - 1])) : Math.max(...all.map((p) => p.v));
        const top = max !== null ? max : (peak > 0 ? peak : 1);
        const span = to - from || 1;
        const x = (t) => (((t - from) / span) * W).toFixed(1);
        const y = (v) => (H - (Math.max(0, Math.min(top, v)) / top) * H).toFixed(1);

        const svg = svgEl('svg', {
            viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false',
        });
        if (stacked) {
            solid.forEach((s, i) => {
                const upper = times.map((t, k) => `${x(t)},${y(cumulative[k][i])}`);
                const lower = times.map((t, k) => `${x(t)},${y(i > 0 ? cumulative[k][i - 1] : 0)}`).reverse();
                svg.appendChild(svgEl('polygon', { class: `glances-chart-layer glances-chart-layer--${i}`, points: [...upper, ...lower].join(' ') }));
            });
            return { svg, peak, from, to };
        }
        drawn.forEach((s, i) => {
            const limit = gapLimit(s.pts);
            // A run of points ends at a gap; each run is its own line.
            const runs = [];
            let run = [];
            s.pts.forEach((p, n) => {
                if (n > 0 && p.t - s.pts[n - 1].t > limit) {
                    runs.push(run);
                    run = [];
                }
                run.push(p);
            });
            runs.push(run);
            runs.filter((r) => r.length >= 2).forEach((r) => {
                const line = r.map((p) => `${x(p.t)},${y(p.v)}`).join(' ');
                if (!s.ghost && solid.length === 1 && area) {
                    svg.appendChild(svgEl('polygon', {
                        class: 'glances-chart-area',
                        points: `${x(r[0].t)},${H} ${line} ${x(r[r.length - 1].t)},${H}`,
                    }));
                }
                svg.appendChild(svgEl('polyline', {
                    class: `glances-chart-line glances-chart-line--${s.ghost ? s.ref : solid.indexOf(s)}${s.ghost ? ' glances-chart-line--ghost' : ''}`,
                    points: line, 'vector-effect': 'non-scaling-stroke',
                }));
            });
        });
        return { svg, peak, from, to };
    }

    /** "last 24 h" / "last 35 min" from the points themselves, never assumed. */
    function spanLabel(from, to, t) {
        const seconds = Math.max(1, Math.round((to - from) / 1000));
        if (seconds < 120) return t('dashboard.glancesHistorySpanSeconds', 'last {seconds} s', { seconds });
        const minutes = Math.round(seconds / 60);
        if (minutes >= 3 * 24 * 60) {
            return t('dashboard.glancesHistorySpanDays', 'last {days} days', { days: Math.round(minutes / 1440) });
        }
        return minutes >= 120
            ? t('dashboard.glancesHistorySpanHours', 'last {hours} h', { hours: Math.round(minutes / 60) })
            : t('dashboard.glancesHistorySpanMinutes', 'last {minutes} min', { minutes });
    }

    /* ── Ranges: one per graph, remembered ──────────────────────────────── */

    function readRanges() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORE) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    function rangeFor(chartId, fallback = '1h') {
        const id = readRanges()[chartId];
        return RANGES.some((r) => r.id === id) ? id : fallback;
    }

    function setRange(chartId, rangeId) {
        if (!RANGES.some((r) => r.id === rangeId)) return;
        try {
            localStorage.setItem(STORE, JSON.stringify({ ...readRanges(), [chartId]: rangeId }));
        } catch { /* a private window: the range lasts until the page is left */ }
        memory[chartId] = rangeId;
        fresh[chartId] = true;
    }

    /** Charts whose range just changed: their next drawing announces it. */
    const fresh = {};

    const memory = {};

    function readCompare() {
        try {
            const parsed = JSON.parse(localStorage.getItem(COMPARE_STORE) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    function compareOn(chartId) {
        return readCompare()[chartId] === true;
    }

    function setCompare(chartId, on) {
        try {
            localStorage.setItem(COMPARE_STORE, JSON.stringify({ ...readCompare(), [chartId]: Boolean(on) }));
        } catch { /* a private window: the choice lasts until the page is left */ }
        compareMemory[chartId] = Boolean(on);
    }

    const compareMemory = {};

    /** Yesterday behind today only makes sense for a window of a day or less. */
    function compareAllowed(def) {
        const range = RANGES.find((r) => r.id === currentRange(def.id));
        return Boolean(def.compare && range && range.ms <= DAY);
    }

    function compareActive(def) {
        return compareAllowed(def) && (compareMemory[def.id] ?? compareOn(def.id));
    }

    /** The range a graph shows right now: this session's choice, else the remembered one. */
    function currentRange(chartId) {
        return memory[chartId] || rangeFor(chartId);
    }

    /** One range longer (+1) or shorter (-1) for a graph; false at either end. */
    function stepRange(chartId, direction) {
        const at = RANGES.findIndex((r) => r.id === currentRange(chartId));
        const next = RANGES[at + direction];
        if (!next) return false;
        setRange(chartId, next.id);
        return true;
    }

    function sinceFor(chartId) {
        const range = RANGES.find((r) => r.id === currentRange(chartId)) || RANGES[1];
        return Date.now() - range.ms;
    }

    /** The dropdown that picks a graph's range. */
    function rangeBar(chartId, t, onPick) {
        const wrap = el('label', 'glances-range-pick');
        wrap.setAttribute('data-glances-ranges-for', chartId);
        const select = el('select', 'config-select glances-range-select');
        select.setAttribute('data-glances-range-select', chartId);
        select.setAttribute('aria-label', t('dashboard.glancesRangeLabel', 'Range'));
        RANGES.forEach((r) => {
            const option = el('option', '', t(r.label[0], r.label[1]));
            option.value = r.id;
            select.appendChild(option);
        });
        select.value = currentRange(chartId);
        select.addEventListener('change', () => {
            if (currentRange(chartId) === select.value) return;
            setRange(chartId, select.value);
            onPick(select.value);
        });
        wrap.appendChild(select);
        return wrap;
    }

    /* ── Groups: which series a graph draws ─────────────────────────────── */

    function group(id) {
        return GROUPS.find((g) => g.id === id) || null;
    }

    /** The recorded series a group draws: the named ones present in the record. */
    function namesFor(def, allNames) {
        return (allNames || []).filter(def.match);
    }

    /** The history question for one group at its own range, or '' when it has no series yet. */
    function pathFor(def, allNames) {
        const names = namesFor(def, allNames);
        if (!names.length) return '';
        return `history?series=${names.map(encodeURIComponent).join(',')}&since=${sinceFor(def.id)}`;
    }

    /**
     * The question for the same window a day earlier, or '' when the graph is not
     * comparing. `ghost=1` keeps its answer apart from today's in the page's cache.
     */
    function ghostPathFor(def, allNames) {
        if (!compareActive(def)) return '';
        const names = namesFor(def, allNames);
        if (!names.length) return '';
        const range = RANGES.find((r) => r.id === currentRange(def.id));
        const now = Date.now();
        return `history?series=${names.map(encodeURIComponent).join(',')}&since=${now - range.ms - DAY}&until=${now - DAY}&ghost=1`;
    }

    function format(def, value) {
        if (def.percent) return `${Math.round(value)}%`;
        if (def.bytes) return window.DashboardGlances.formatBytes(value);
        if (def.rate) return `${window.DashboardGlances.formatBytes(value)}/s`;
        if (def.unit) return `${Math.round(value)}${def.unit}`;
        return value.toFixed(def.fixed ?? 1);
    }

    /** last, lowest, average and highest of the points a group drew. */
    function stats(points) {
        const values = points.map((p) => p.v);
        if (!values.length) return null;
        return {
            last: values[values.length - 1],
            min: Math.min(...values),
            avg: values.reduce((a, b) => a + b, 0) / values.length,
            max: Math.max(...values),
        };
    }

    /**
     * One graph with its own range bar, the line(s), what they were called and
     * four figures from the points drawn. `answer` is the history reply for this
     * group's question; a group with nothing to draw gives null.
     */
    function panel(view, def, answer, { onRange, height = 70, ghost = null } = {}) {
        const t = (k, f, p) => view.t(k, f, p);
        const series = answer && answer.series && typeof answer.series === 'object' ? answer.series : {};
        const found = Object.keys(series).filter(def.match)
            .map((name) => ({ name, label: def.name ? def.name(name, t) : name, points: clean(series[name]) }))
            .filter((s) => s.points.length >= 2)
            .sort(def.order
                ? (a, b) => def.order.indexOf(a.name) - def.order.indexOf(b.name)
                : (a, b) => Math.max(...b.points.map((p) => p.v)) - Math.max(...a.points.map((p) => p.v)))
            .slice(0, MAX_LINES);

        const figure = el('figure', 'glances-chart');
        figure.setAttribute('data-glances-chart', def.id);
        const head = el('figcaption', 'glances-chart-caption');
        const titleRow = el('span', 'glances-chart-title', t(def.label[0], def.label[1]));
        const titleInfo = window.DashboardGlancesInfo?.button(view, `chart-${def.id}`);
        if (titleInfo) titleRow.appendChild(titleInfo);
        head.appendChild(titleRow);
        const controls = el('span', 'glances-chart-controls');
        if (compareAllowed(def)) {
            const label = el('label', 'glances-compare');
            const box = el('input');
            box.type = 'checkbox';
            box.checked = compareActive(def);
            box.setAttribute('data-glances-compare', def.id);
            box.addEventListener('change', () => {
                setCompare(def.id, box.checked);
                (onRange || (() => {}))();
            });
            label.append(box, el('span', '', t('dashboard.glancesCompareYesterday', 'Yesterday')));
            controls.appendChild(label);
            const yesterdayInfo = window.DashboardGlancesInfo?.button(view, 'yesterday');
            if (yesterdayInfo) controls.appendChild(yesterdayInfo);
        }
        controls.appendChild(rangeBar(def.id, t, onRange || (() => {})));
        head.appendChild(controls);
        figure.appendChild(head);

        // Yesterday behind today: the same series a day earlier, moved forward a day, dashed.
        const ghostSeries = [];
        if (!def.stacked && compareActive(def) && ghost && ghost.series) {
            found.slice(0, 2).forEach((s, i) => {
                const earlier = clean(ghost.series[s.name]);
                if (earlier.length >= 2) ghostSeries.push({ name: `${s.name}:ghost`, ghost: true, ref: i, points: earlier.map((p) => ({ t: p.t + DAY, v: p.v })) });
            });
        }
        const drawn = found.length
            ? draw({ series: [...found, ...ghostSeries], max: def.percent ? 100 : null, height, stacked: Boolean(def.stacked) })
            : null;
        if (!drawn) {
            figure.appendChild(el('p', 'glances-note glances-chart-empty', t('dashboard.glancesChartEmpty', 'Not enough data for this range yet.')));
            return figure;
        }
        const plot = el('div', 'glances-chart-plot');
        plot.setAttribute('data-glances-plot', def.id);
        plot.appendChild(drawn.svg);
        const top = def.percent ? 100 : (drawn.peak > 0 ? drawn.peak : 1);
        // What went past a red line in this window, as bands behind the lines.
        const kinds = ['down', ...(def.incidents || [])];
        const bands = el('div', 'glances-incident-layer');
        bands.setAttribute('aria-hidden', 'true');
        (answer && Array.isArray(answer.incidents) ? answer.incidents : []).filter((i) => kinds.includes(i.kind)).forEach((i) => {
            const begin = Math.max(i.start, drawn.from);
            const finish = Math.min(i.end || Date.now(), drawn.to);
            if (finish <= begin) return;
            const band = el('i', 'glances-chart-incident');
            band.setAttribute('data-glances-incident', i.kind);
            band.style.left = `${(((begin - drawn.from) / (drawn.to - drawn.from)) * 100).toFixed(2)}%`;
            band.style.width = `${Math.max(0.6, ((finish - begin) / (drawn.to - drawn.from)) * 100).toFixed(2)}%`;
            const what = INCIDENT_LABELS[i.kind] ? t(INCIDENT_LABELS[i.kind][0], INCIDENT_LABELS[i.kind][1]) : i.kind;
            band.title = `${what}${i.subject ? ` · ${i.subject}` : ''} · ${new Date(i.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${i.end ? '' : ` · ${t('dashboard.glancesInsOngoing', 'ongoing')}`}`;
            bands.appendChild(band);
        });
        // Moments a container started again, from the Containers view's timeline.
        (answer && Array.isArray(answer.restarts) ? answer.restarts : []).forEach((at) => {
            if (!(at >= drawn.from && at <= drawn.to)) return;
            const mark = el('i', 'glances-chart-restart');
            mark.setAttribute('data-glances-restart', String(at));
            mark.style.left = `${(((at - drawn.from) / (drawn.to - drawn.from)) * 100).toFixed(2)}%`;
            mark.title = t('dashboard.glancesRestartedAt', 'Restarted {time}', { time: new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
            bands.appendChild(mark);
        });
        plot.insertBefore(bands, drawn.svg);
        const range = RANGES.find((r) => r.id === currentRange(def.id)) || RANGES[1];
        // y axis: the value at the top, the middle and the bottom of the plot.
        const yAxis = el('div', 'glances-axis-y');
        yAxis.setAttribute('data-glances-axis', 'y');
        [top, top / 2, 0].forEach((v) => yAxis.appendChild(el('span', 'glances-axis-tick', format(def, v))));
        // x axis: five moments from the oldest point drawn to the newest.
        const xAxis = el('div', 'glances-axis-x');
        xAxis.setAttribute('data-glances-axis', 'x');
        const longRange = range.ms > 24 * 3600 * 1000;
        const longFormat = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
        const shortFormat = range.ms <= 3600 * 1000 ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' };
        for (let i = 0; i < 5; i += 1) {
            const at = drawn.from + ((drawn.to - drawn.from) * i) / 4;
            // The ones between the ends give way first when the graph is narrow.
            xAxis.appendChild(el('span', `glances-axis-tick${i % 2 ? ' glances-axis-tick--minor' : ''}`, new Date(at).toLocaleString([], longRange ? longFormat : shortFormat)));
        }
        const frame = el('div', 'glances-chart-frame');
        frame.append(yAxis, plot, el('span', 'glances-axis-corner'), xAxis);
        if (fresh[def.id]) {
            fresh[def.id] = false;
            frame.classList.add('glances-chart-frame--fresh');
        }
        const cross = el('div', 'glances-crosshair');
        cross.hidden = true;
        plot.appendChild(cross);
        // The reading under the pointer: the nearest point of every line, and when.
        plot.addEventListener('pointermove', (e) => {
            const rect = plot.getBoundingClientRect();
            if (!rect.width || !view.tipCard) return;
            const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const at = drawn.from + fraction * (drawn.to - drawn.from);
            const rows = found.map((s) => {
                let best = null;
                s.points.forEach((p) => { if (!best || Math.abs(p.t - at) < Math.abs(best.t - at)) best = p; });
                return best ? [s.label, format(def, best.v)] : null;
            }).filter(Boolean);
            cross.style.left = `${(fraction * 100).toFixed(1)}%`;
            cross.hidden = false;
            const when = new Date(at).toLocaleString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', day: 'numeric', month: 'short' });
            view.tipCard.showAt(window.DashboardGlancesTip.rows(when, rows), e.clientX, e.clientY);
        });
        plot.addEventListener('pointerleave', () => {
            cross.hidden = true;
            view.tipCard?.hide();
        });
        figure.appendChild(frame);
        const axes = el('p', 'glances-chart-span');
        axes.append(el('strong', 'glances-chart-range', t(range.label[0], range.label[1])), document.createTextNode(` · ${t('dashboard.glancesAxisX', 'x: time')} · ${t('dashboard.glancesAxisY', 'y: value')} · ${Chart.spanLabel(drawn.from, drawn.to, t)}`));
        figure.appendChild(axes);
        if (found.length > 1 || ghostSeries.length) {
            const legend = el('p', 'glances-chart-legend');
            found.forEach((s, i) => {
                const item = el('span', 'glances-legend-item');
                const swatch = el('i', `glances-swatch glances-swatch--${i}`);
                swatch.setAttribute('aria-hidden', 'true');
                item.append(swatch, document.createTextNode(s.label));
                legend.appendChild(item);
            });
            if (ghostSeries.length) {
                const item = el('span', 'glances-legend-item');
                const swatch = el('i', 'glances-swatch glances-swatch--ghost');
                swatch.setAttribute('aria-hidden', 'true');
                item.append(swatch, document.createTextNode(t('dashboard.glancesCompareYesterday', 'Yesterday')));
                legend.appendChild(item);
            }
            figure.appendChild(legend);
        }
        // The four figures come from the first (busiest) series.
        const s = stats(found[0].points);
        if (s) {
            const row = el('dl', 'glances-chart-stats');
            [['dashboard.glancesStatLast', 'Now', s.last], ['dashboard.glancesStatMin', 'Low', s.min],
                ['dashboard.glancesStatAvg', 'Average', s.avg], ['dashboard.glancesStatMax', 'High', s.max]]
                .forEach(([key, fallback, value]) => {
                    const cell = el('div', 'glances-chart-stat');
                    cell.append(el('dt', '', t(key, fallback)), el('dd', '', format(def, value)));
                    row.appendChild(cell);
                });
            figure.appendChild(row);
        }
        return figure;
    }

    /**
     * Redraw a container's graphs without dropping the focus: the range buttons
     * are rebuilt every beat, and a keyboard user on one would lose their place.
     */
    function keepFocus(container, build) {
        const active = document.activeElement;
        let selector = null;
        if (active && container.contains(active) && active.hasAttribute('data-glances-range-select')) {
            selector = `[data-glances-range-select="${CSS.escape(active.getAttribute('data-glances-range-select'))}"]`;
        }
        build();
        if (selector) container.querySelector(selector)?.focus({ preventScroll: true });
    }

    const Chart = {
        draw, spanLabel, clean, el, svgEl, keepFocus,
        RANGES, GROUPS, group, namesFor, pathFor, ghostPathFor, compareActive, panel, rangeBar, rangeFor, setRange, currentRange, stepRange, sinceFor, format, stats,
    };
    window.DashboardGlancesChart = Chart;
}());
