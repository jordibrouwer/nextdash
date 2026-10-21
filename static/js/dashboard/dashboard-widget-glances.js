/**
 * The Glances widget: how one machine is doing, from its Glances server.
 *
 * The answer carries `meters` rather than titles and posters, so the tile
 * draws it itself (register's `draw`) on the shared media tile: the fetching,
 * the refresh and the loading and error lines are the tile's.
 *
 * One tile, two shapes. The terse and the fuller form are both built, and the
 * panel's container query shows the one that fits (narrow-only / wide-only),
 * so nothing is refetched when the window is dragged.
 *
 *   narrow   host and uptime, bars for cpu, ram and disk (the fullest
 *            filesystem), and one line with temperature, load and download
 *   wide     host, uptime and system on top; cpu, ram, swap and load on the
 *            left; filesystems, network and temperature sensors on the right;
 *            the last stretch of CPU underneath when the server sent it
 *
 * Unknown is not zero: a reading the server did not send is drawn as a dash,
 * never as a bar at nought, which would read as "fine".
 */
(function () {
    'use strict';

    const Tile = window.DashboardMediaTile;
    if (!Tile) return;

    // The same limits the server uses for its own tones.
    const LIMITS = { cpu: [80, 90], mem: [80, 90], swap: [80, 90], disk: [80, 90], temp: [70, 85] };
    // What each shape draws while the widget has no `meters` choice of its own (an empty list is no choice).
    const NARROW_DEFAULT = ['cpu', 'mem', 'disk', 'temp', 'load', 'net'];
    const WIDE_DEFAULT = ['cpu', 'mem', 'swap', 'load', 'disk', 'net', 'temp'];
    const KNOWN = ['cpu', 'mem', 'swap', 'load', 'disk', 'net', 'temp'];
    const FALLBACK_ROWS = 6;
    const DASH = '–';

    const WORDS = {
        meterCpu: ['dashboard.widgetGlancesCpu', 'cpu'],
        meterMem: ['dashboard.widgetGlancesMem', 'ram'],
        meterSwap: ['dashboard.widgetGlancesSwap', 'swap'],
        meterDisk: ['dashboard.widgetGlancesDisk', 'disk'],
        meterTemp: ['dashboard.widgetGlancesTemp', 'temp'],
        meterLoad: ['dashboard.widgetGlancesLoad', 'load'],
        meterNet: ['dashboard.widgetGlancesNet', 'net'],
        upFor: ['dashboard.widgetGlancesUpFor', 'up {time}'],
        sparkLabel: ['dashboard.widgetGlancesSparkLabel', 'CPU over the last stretch'],
        loginRefused: ['dashboard.widgetGlancesLoginRefused', 'Glances refused that login.'],
        needsGlances4: ['dashboard.widgetGlancesNeedsV4', 'This tile needs Glances 4.'],
        notAvailable: ['dashboard.widgetGlancesNotAvailable', 'Glances has no data for this tile.'],
        nothing: ['dashboard.widgetGlancesNothing', 'No readings to show.'],
    };

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = String(text);
        return node;
    }

    /** A finite number or null: Number(null) is 0, which is exactly the bug to avoid. */
    function num(value) {
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    }

    function limit(widget) {
        return window.DashboardWidgetUtils?.rowLimit?.(widget, FALLBACK_ROWS) || FALLBACK_ROWS;
    }

    /** Whether a shape draws a figure: the widget's own choice, else that shape's usual set. */
    function shows(widget, key, wide) {
        const list = widget?.config?.meters;
        // A stored list is honoured in both shapes, but the terse one has a fixed
        // set of parts: swap is only ever drawn wide.
        if (Array.isArray(list) && list.length) {
            return list.includes(key) && (wide || NARROW_DEFAULT.includes(key));
        }
        return (wide ? WIDE_DEFAULT : NARROW_DEFAULT).includes(key);
    }

    /** Hides a part from the shape that does not draw it. */
    function forShapes(node, narrow, wide) {
        if (narrow && !wide) node.classList.add('dashboard-widget-narrow-only');
        if (wide && !narrow) node.classList.add('dashboard-widget-wide-only');
        return node;
    }

    function word(dash, widget, key) {
        return Tile.say(dash, widget, `meter${key[0].toUpperCase()}${key.slice(1)}`);
    }

    function pctText(value) {
        return `${Math.round(value)}%`;
    }

    function tempText(value) {
        return `${Math.round(value)}°`;
    }

    function toneOf(key, value) {
        const limits = LIMITS[key];
        return limits ? Tile.meterTone(value, limits[0], limits[1]) : '';
    }

    /** A sensor's own warn and crit when the machine reports them, else the usual 70 and 85. */
    function sensorTone(sensor) {
        const value = num(sensor?.value);
        if (value === null) return '';
        const warn = num(sensor.warn) ?? LIMITS.temp[0];
        const bad = num(sensor.crit) ?? LIMITS.temp[1];
        return Tile.meterTone(value, warn, bad);
    }

    function toned(className, text, tone) {
        const node = el('span', className, text);
        if (tone && tone !== 'good') node.dataset.tone = tone;
        return node;
    }

    function uptimeText(dash, widget, seconds) {
        const total = num(seconds);
        if (total === null || total <= 0) return '';
        const minutes = Math.floor(total / 60);
        let time;
        if (minutes < 60) time = Tile.say(dash, widget, 'minutesAgo', { n: Math.max(1, minutes) });
        else if (minutes < 60 * 24) time = Tile.say(dash, widget, 'hoursAgo', { n: Math.floor(minutes / 60) });
        else time = Tile.say(dash, widget, 'daysAgo', { n: Math.floor(minutes / 60 / 24) });
        return Tile.say(dash, widget, 'upFor', { time });
    }

    function rateText(dash, widget, bytes) {
        const n = num(bytes);
        return n === null ? DASH : Tile.say(dash, widget, 'perSecond', { size: Tile.formatBytes(n) });
    }

    function loadText(load) {
        const list = (Array.isArray(load) ? load : []).filter((v) => num(v) !== null);
        return list.length ? list.map((v) => v.toFixed(1)).join(' ') : DASH;
    }

    /** The fullest filesystem, the one number the terse form has room for. */
    function fullest(meters) {
        const pcts = (Array.isArray(meters.fs) ? meters.fs : []).map((f) => num(f?.pct)).filter((v) => v !== null);
        if (pcts.length) return Math.max(...pcts);
        return num(meters.disk);
    }

    /** One row: its label, a bar when there is a reading, and the number or a dash. */
    function barRow(dash, widget, key, value, text, tone) {
        const row = el('div', 'glances-bar');
        row.dataset.meter = key;
        row.appendChild(el('span', 'glances-label', word(dash, widget, key)));
        const bar = value === null ? null : Tile.meterBar(value, LIMITS[key]?.[0] ?? 80, LIMITS[key]?.[1] ?? 90);
        if (bar) row.appendChild(bar);
        else row.appendChild(el('span', 'glances-nobar'));
        row.appendChild(toned('glances-value', value === null && !text ? DASH : text, tone));
        return row;
    }

    /** The last stretch of CPU as small bars. A flat, quiet stretch stays low rather than filling the box. */
    function sparkline(dash, widget, values) {
        const series = (Array.isArray(values) ? values : []).filter((v) => num(v) !== null);
        if (series.length < 2) return null;
        const peak = Math.max(10, ...series);
        const figure = Tile.wideOnly(el('figure', 'glances-spark'));
        const bars = el('span', 'glances-spark-bars');
        bars.setAttribute('role', 'img');
        bars.setAttribute('aria-label', Tile.say(dash, widget, 'sparkLabel'));
        series.forEach((v) => {
            const bar = el('span', 'glances-spark-bar');
            bar.style.height = `${Math.max(3, Math.round((v / peak) * 100))}%`;
            bars.appendChild(bar);
        });
        figure.appendChild(bars);
        return figure;
    }

    /** Where a click goes: the details view for this widget, or the Glances server itself. */
    function head(dash, widget, item, meters) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'media-row glances-head';
        button.dataset.mediaItem = String(item.id || '');
        const text = el('span', 'media-row-text');
        text.appendChild(el('span', 'media-title', meters.host || item.title || ''));
        const sub = el('span', 'media-meta');
        const up = uptimeText(dash, widget, meters.uptime);
        if (up) sub.appendChild(el('span', '', up));
        if (meters.os) sub.appendChild(Tile.wideOnly(el('span', '', `${up ? ' · ' : ''}${meters.os}`)));
        text.appendChild(sub);
        button.appendChild(text);

        const detail = widget?.config?.click !== 'open';
        const service = 'Glances';
        window.DashboardWidgetUtils?.bindRowAction(button, dash, {
            labelKey: detail ? 'widgetActionMediaDetails' : 'widgetActionMediaOpen',
            labelFallback: detail ? 'Show details' : `Open in ${service}`,
            href: detail ? '' : item.openUrl,
            run: () => {
                if (detail) {
                    const pageId = Number(dash?.currentPageId) || Number(dash?.pages?.[0]?.id) || 1;
                    window.location.hash = `#glances/overview?w=${encodeURIComponent(widget.id)}&p=${pageId}`;
                    return;
                }
                if (!item.openUrl) return;
                if (Tile.targetFor(dash, widget) === '_blank') window.open(item.openUrl, '_blank', 'noopener,noreferrer');
                else window.location.href = item.openUrl;
            },
        });
        return button;
    }

    function draw(wrap, dash, widget, items) {
        const item = items[0];
        const meters = item?.meters;
        if (!item || !meters) {
            wrap.appendChild(el('p', 'dashboard-widget-empty', Tile.say(dash, widget, 'nothing')));
            return;
        }
        wrap.appendChild(head(dash, widget, item, meters));
        // A machine that is not up says so and shows nothing else.
        if (meters.status && meters.status !== 'up') {
            wrap.appendChild(el('p', 'glances-state', Tile.say(dash, widget, 'unreachable')));
            return;
        }

        const body = el('div', 'glances-body');
        const left = el('div', 'glances-meters');
        const right = forShapes(el('div', 'glances-side'), false, true);

        // Percentage bars; swap and cpu/mem draw in whichever shape selects them.
        ['cpu', 'mem', 'swap'].forEach((key) => {
            const narrow = shows(widget, key, false);
            const wide = shows(widget, key, true);
            if (!narrow && !wide) return;
            const value = num(meters[key]);
            left.appendChild(forShapes(barRow(dash, widget, key, value,
                value === null ? DASH : pctText(value), value === null ? '' : toneOf(key, value)), narrow, wide));
        });
        // Load: a row of its own on the wide form; the terse form has it in its line.
        if (shows(widget, 'load', true)) {
            const row = barRow(dash, widget, 'load', null, loadText(meters.load), '');
            left.appendChild(forShapes(row, false, true));
        }
        // Disk: the fullest filesystem as a bar when narrow; every filesystem when wide.
        if (shows(widget, 'disk', false)) {
            const value = fullest(meters);
            left.appendChild(forShapes(barRow(dash, widget, 'disk', value,
                value === null ? DASH : pctText(value), value === null ? '' : toneOf('disk', value)), true, false));
        }
        body.appendChild(left);

        // The terse line: temperature, load and download, each a dash when unknown.
        const parts = [];
        if (shows(widget, 'temp', false)) {
            const t = num(meters.temp);
            parts.push(`${word(dash, widget, 'temp')} ${t === null ? DASH : tempText(t)}`);
        }
        if (shows(widget, 'load', false)) {
            const load = Array.isArray(meters.load) ? meters.load.find((v) => num(v) !== null) : undefined;
            parts.push(`${word(dash, widget, 'load')} ${num(load) === null ? DASH : load.toFixed(1)}`);
        }
        if (shows(widget, 'net', false)) {
            parts.push(`↓ ${rateText(dash, widget, meters.net)}`);
        }
        if (parts.length) body.appendChild(forShapes(el('p', 'glances-line', parts.join(' · ')), true, false));

        // Right block of the wide form.
        if (shows(widget, 'disk', true)) {
            const fs = (Array.isArray(meters.fs) ? meters.fs : []).filter((f) => num(f?.pct) !== null)
                .sort((a, b) => b.pct - a.pct).slice(0, limit(widget));
            if (fs.length) {
                const list = el('div', 'glances-fss');
                fs.forEach((f) => {
                    const row = el('div', 'glances-fs');
                    row.append(el('span', 'glances-label', f.name),
                        Tile.meterBar(f.pct, LIMITS.disk[0], LIMITS.disk[1]),
                        toned('glances-value', pctText(f.pct), toneOf('disk', f.pct)));
                    list.appendChild(row);
                });
                right.appendChild(list);
            }
        }
        if (shows(widget, 'net', true)) {
            right.appendChild(el('span', 'glances-net',
                `↓ ${rateText(dash, widget, meters.net)}  ↑ ${rateText(dash, widget, meters.netUp)}`));
        }
        if (shows(widget, 'temp', true)) {
            const temps = (Array.isArray(meters.temps) ? meters.temps : []).filter((s) => num(s?.value) !== null)
                .sort((a, b) => b.value - a.value).slice(0, limit(widget));
            if (temps.length) {
                const list = el('div', 'glances-temps');
                temps.forEach((s) => {
                    const row = toned('glances-temp', '', sensorTone(s));
                    row.append(el('span', 'glances-label', s.name), el('span', 'glances-value', tempText(s.value)));
                    list.appendChild(row);
                });
                right.appendChild(list);
            }
        }
        if (right.childNodes.length) body.appendChild(right);
        wrap.appendChild(body);

        const spark = sparkline(dash, widget, meters.spark);
        if (spark) wrap.appendChild(spark);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    const render = Tile.register({
        id: 'glances',
        name: 'Glances',
        words: WORDS,
        art: false,
        keepOrder: true,
        minTtl: 10,
        ttl: 30,
        draw,
    });
    if (render) window.DashboardWidgets.glances = render;

    // The drawing on its own, for a test that hands it an answer and a width.
    window.DashboardGlances = { draw, LIMITS };
})();
