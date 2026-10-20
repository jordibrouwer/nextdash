/**
 * The Beszel widgets: how the machines are doing, from a Beszel hub.
 *
 *   beszel            every system, one line each
 *   beszel-system     one system in full, with its last hour of CPU
 *   beszel-attention  only what needs a look, or one line saying nothing does
 *   beszel-storage    the disks of every system, fullest first
 *
 * The answers carry `meters` rather than titles and posters, so each type
 * draws its own answer (register's `draw`) on the shared media tile: the
 * fetching, the refresh, where a click goes and the loading and error lines
 * are the tile's.
 *
 * One tile, two shapes. The terse and the fuller form are both built, and the
 * panel's container query shows the one that fits (narrow-only / wide-only),
 * so a two-column widget on a one-column dashboard reads as the one-column
 * version and nothing is refetched when the window is dragged.
 *
 * Two rules the whole file keeps. A value the server did not send is not
 * drawn -- unknown is not zero, and a bar at nought reads as "fine". And a
 * system that is not up shows its state and nothing else: Beszel keeps the
 * last readings of a machine that went down, and they are not today's.
 */
(function () {
    'use strict';

    const Tile = window.DashboardMediaTile;
    if (!Tile) return;

    // The same limits the server uses for the reason it gives in "attention".
    const LIMITS = { cpu: [80, 90], mem: [80, 90], disk: [80, 90], gpu: [80, 90], temp: [70, 85] };
    const BARS = ['cpu', 'mem', 'disk', 'gpu'];
    const KNOWN = ['cpu', 'mem', 'disk', 'temp', 'gpu', 'net', 'load'];
    const DEFAULT_METERS = ['cpu', 'mem', 'disk', 'temp'];
    // The tile's own default of six lines, as for every media tile.
    const FALLBACK_ROWS = 6;

    const WORDS = {
        statusDown: ['dashboard.widgetBeszelDown', 'down'],
        statusDownAgo: ['dashboard.widgetBeszelDownAgo', 'down · {ago}'],
        statusPaused: ['dashboard.widgetBeszelPaused', 'paused'],
        statusPending: ['dashboard.widgetBeszelPending', 'pending'],
        meterCpu: ['dashboard.widgetBeszelCpu', 'cpu'],
        meterMem: ['dashboard.widgetBeszelMem', 'mem'],
        meterDisk: ['dashboard.widgetBeszelDisk', 'disk'],
        meterTemp: ['dashboard.widgetBeszelTemp', 'temp'],
        meterGpu: ['dashboard.widgetBeszelGpu', 'gpu'],
        meterNet: ['dashboard.widgetBeszelNet', 'net'],
        meterLoad: ['dashboard.widgetBeszelLoad', 'load'],
        uptime: ['dashboard.widgetBeszelUptime', 'up'],
        upFor: ['dashboard.widgetBeszelUpFor', 'up {time}'],
        lastHour: ['dashboard.widgetBeszelLastHour', 'last hour'],
        sparkLabel: ['dashboard.widgetBeszelSparkLabel', 'CPU over the last hour'],
        allFine: ['dashboard.widgetBeszelAllFine', 'All {n} systems fine'],
        allFineOne: ['dashboard.widgetBeszelAllFineOne', 'The system is fine'],
        countUp: ['dashboard.widgetBeszelCountUp', '{n} up'],
        countDown: ['dashboard.widgetBeszelCountDown', '{n} down'],
        countPaused: ['dashboard.widgetBeszelCountPaused', '{n} paused'],
        countPending: ['dashboard.widgetBeszelCountPending', '{n} pending'],
        nothing: ['dashboard.widgetBeszelNothing', 'No systems to show.'],
        noSystems: ['dashboard.widgetBeszelNoSystems', 'This Beszel has no systems yet.'],
        systemGone: ['dashboard.widgetBeszelSystemGone', 'That system is gone. Choose again in the settings.'],
        noDisks: ['dashboard.widgetBeszelNoDisks', 'No disks to show.'],
        refused: ['dashboard.widgetBeszelRefused', '{name} refused the sign-in.'],
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

    /** The meters this widget draws: its own choice, else the usual four. */
    function chosen(widget) {
        const list = widget?.config?.meters;
        if (!Array.isArray(list)) return DEFAULT_METERS;
        return list.filter((key) => KNOWN.includes(key));
    }

    function isUp(item) {
        return item?.meters?.status === 'up';
    }

    function valueText(key, value) {
        return key === 'temp' ? `${Math.round(value)}°` : `${Math.round(value)}%`;
    }

    function toneOf(key, value) {
        const limits = LIMITS[key];
        return limits ? Tile.meterTone(value, limits[0], limits[1]) : '';
    }

    function meterWord(dash, widget, key) {
        return Tile.say(dash, widget, `meter${key[0].toUpperCase()}${key.slice(1)}`);
    }

    /** "down · 14m", "paused", "pending": the whole of what a system that is not up says. */
    function statusText(dash, widget, item) {
        const status = item?.meters?.status;
        if (status === 'down') {
            return Number(item.when) > 0
                ? Tile.say(dash, widget, 'statusDownAgo', { ago: Tile.agoText(dash, widget, item.when) })
                : Tile.say(dash, widget, 'statusDown');
        }
        if (status === 'paused') return Tile.say(dash, widget, 'statusPaused');
        if (status === 'pending') return Tile.say(dash, widget, 'statusPending');
        return '';
    }

    /** Just the state, without how long: the terse form. */
    function statusWord(dash, widget, item) {
        const status = item?.meters?.status;
        return status === 'down' || status === 'paused' || status === 'pending'
            ? Tile.say(dash, widget, `status${status[0].toUpperCase()}${status.slice(1)}`) : '';
    }

    /** The worst tone among everything the system reported, for its dot. */
    function worstTone(item) {
        let worst = '';
        Object.keys(LIMITS).forEach((key) => {
            const tone = toneOf(key, num(item?.meters?.[key]));
            if (tone === 'bad' || (tone === 'warn' && worst !== 'bad')) worst = tone;
        });
        return worst;
    }

    function dot(item) {
        const status = item?.meters?.status || 'up';
        const mark = el('span', 'beszel-dot');
        mark.dataset.state = status;
        if (status === 'up') {
            const tone = worstTone(item);
            if (tone) mark.dataset.tone = tone;
        }
        mark.setAttribute('aria-hidden', 'true');
        return mark;
    }

    /** How long a machine has been up, in the tile's own short ago words. */
    function uptimeText(dash, widget, seconds) {
        const total = num(seconds);
        if (total === null || total < 0) return '';
        const minutes = Math.floor(total / 60);
        let time;
        if (minutes < 60) time = Tile.say(dash, widget, 'minutesAgo', { n: Math.max(1, minutes) });
        else if (minutes < 60 * 24) time = Tile.say(dash, widget, 'hoursAgo', { n: Math.floor(minutes / 60) });
        else time = Tile.say(dash, widget, 'daysAgo', { n: Math.floor(minutes / 60 / 24) });
        return time;
    }

    function netText(dash, widget, bytes) {
        const n = num(bytes);
        return n === null ? '' : Tile.say(dash, widget, 'perSecond', { size: Tile.formatBytes(n) });
    }

    function loadText(load) {
        const list = (Array.isArray(load) ? load : []).filter((v) => num(v) !== null);
        return list.length ? list.map((v) => v.toFixed(1)).join(' ') : '';
    }

    /**
     * The one figure the terse form shows: the meter closest to its limit
     * among those the widget draws ("disk 88%"). With no percentage drawn it
     * falls back to the network or the load, and with none of those to nothing.
     */
    function heaviest(dash, widget, item) {
        const selected = chosen(widget);
        let best = null;
        [...BARS, 'temp'].filter((key) => selected.includes(key)).forEach((key) => {
            const value = num(item.meters?.[key]);
            if (value === null) return;
            const score = value / LIMITS[key][0];
            if (!best || score > best.score) best = { key, value, score };
        });
        if (best) {
            return { text: `${meterWord(dash, widget, best.key)} ${valueText(best.key, best.value)}`,
                tone: toneOf(best.key, best.value) };
        }
        if (selected.includes('net') && netText(dash, widget, item.meters?.net)) {
            return { text: netText(dash, widget, item.meters.net), tone: '' };
        }
        if (selected.includes('load') && loadText(item.meters?.load)) {
            return { text: `${meterWord(dash, widget, 'load')} ${loadText(item.meters.load)}`, tone: '' };
        }
        return null;
    }

    function toned(className, text, tone) {
        const node = el('span', className, text);
        if (tone && tone !== 'good') node.dataset.tone = tone;
        return node;
    }

    function empty(wrap, dash, widget, key = 'nothing') {
        wrap.appendChild(el('p', 'dashboard-widget-empty', Tile.say(dash, widget, key)));
    }

    /** A meter's bar and its number in one cell; an empty cell keeps the column. */
    function barCell(key, value) {
        const cell = Tile.wideOnly(el('span', 'beszel-cell beszel-cell--bar'));
        if (value === null) return cell;
        const bar = Tile.meterBar(value, LIMITS[key][0], LIMITS[key][1]);
        cell.append(bar, toned('beszel-value', valueText(key, value), toneOf(key, value)));
        return cell;
    }

    function textCell(text, tone) {
        const cell = Tile.wideOnly(el('span', 'beszel-cell', text));
        if (tone && tone !== 'good') cell.dataset.tone = tone;
        return cell;
    }

    /* ---- beszel: every system, one line each ---- */

    function drawSystems(wrap, dash, widget, items) {
        if (!items.length) return empty(wrap, dash, widget);
        const selected = chosen(widget);
        const bars = BARS.filter((key) => selected.includes(key));
        const texts = ['temp', 'net', 'load'].filter((key) => selected.includes(key));
        const list = el('div', 'beszel-list');
        // Name and state take two columns, the rest one each, plus uptime.
        list.style.setProperty('--beszel-cols', String(bars.length + texts.length + 1));

        const head = el('div', 'beszel-row beszel-head dashboard-widget-wide-only');
        head.setAttribute('aria-hidden', 'true');
        head.append(el('span'), el('span'));
        [...bars, ...texts].forEach((key) => head.appendChild(el('span', 'beszel-cell', meterWord(dash, widget, key))));
        head.appendChild(el('span', 'beszel-cell', Tile.say(dash, widget, 'uptime')));
        list.appendChild(head);

        items.slice(0, limit(widget)).forEach((item) => {
            const row = Tile.itemButton(dash, widget, item, 'media-row beszel-row');
            row.append(dot(item), el('span', 'media-title beszel-name', item.title));
            if (!isUp(item)) {
                row.append(
                    el('span', 'beszel-cell beszel-state dashboard-widget-narrow-only', statusWord(dash, widget, item)),
                    Tile.wideOnly(el('span', 'beszel-cell beszel-state beszel-cell--span', statusText(dash, widget, item))),
                );
                list.appendChild(row);
                return;
            }
            const worst = heaviest(dash, widget, item);
            const terse = worst ? toned('beszel-cell beszel-cell--end dashboard-widget-narrow-only', worst.text, worst.tone)
                : el('span', 'beszel-cell dashboard-widget-narrow-only');
            row.appendChild(terse);
            bars.forEach((key) => row.appendChild(barCell(key, num(item.meters[key]))));
            texts.forEach((key) => {
                if (key === 'temp') {
                    const value = num(item.meters.temp);
                    row.appendChild(textCell(value === null ? '' : valueText('temp', value),
                        value === null ? '' : toneOf('temp', value)));
                } else if (key === 'net') {
                    row.appendChild(textCell(netText(dash, widget, item.meters.net)));
                } else {
                    row.appendChild(textCell(loadText(item.meters.load)));
                }
            });
            row.appendChild(textCell(uptimeText(dash, widget, item.meters.uptime)));
            list.appendChild(row);
        });
        wrap.appendChild(list);
    }

    /* ---- beszel-system: one system in full ---- */

    function meterLine(dash, widget, key, value) {
        const line = el('span', 'beszel-line');
        line.append(
            el('span', 'beszel-label', meterWord(dash, widget, key)),
            Tile.meterBar(value, LIMITS[key][0], LIMITS[key][1]),
            toned('beszel-value', valueText(key, value), toneOf(key, value)),
        );
        return line;
    }

    /** The last hour of CPU as small bars. A flat, quiet hour stays low rather than filling the box. */
    function sparkline(dash, widget, values) {
        const series = values.filter((v) => num(v) !== null);
        if (series.length < 2) return null;
        const peak = Math.max(10, ...series);
        const figure = el('figure', 'beszel-spark');
        const bars = el('span', 'beszel-spark-bars');
        bars.setAttribute('role', 'img');
        bars.setAttribute('aria-label', Tile.say(dash, widget, 'sparkLabel'));
        series.forEach((v) => {
            const bar = el('span', 'beszel-spark-bar');
            bar.style.height = `${Math.max(3, Math.round((v / peak) * 100))}%`;
            bars.appendChild(bar);
        });
        figure.append(bars, el('figcaption', 'media-meta', Tile.say(dash, widget, 'lastHour')));
        return figure;
    }

    function drawSystem(wrap, dash, widget, items) {
        const item = items[0];
        if (!item) return empty(wrap, dash, widget);
        const meters = item.meters || {};
        const selected = chosen(widget);

        const head = Tile.itemButton(dash, widget, item, 'media-row beszel-sys-head');
        const text = el('span', 'media-row-text');
        text.appendChild(el('span', 'media-title', item.title));
        const sub = el('span', 'media-meta');
        sub.append(el('span', '', item.subtitle || ''));
        const up = isUp(item) ? uptimeText(dash, widget, meters.uptime) : '';
        if (up) {
            sub.appendChild(Tile.wideOnly(el('span', '',
                ` · ${Tile.say(dash, widget, 'upFor', { time: up })}`)));
        }
        text.appendChild(sub);
        head.append(dot(item), text);
        wrap.appendChild(head);

        if (!isUp(item)) {
            wrap.appendChild(el('p', 'beszel-state', statusText(dash, widget, item)));
            return;
        }

        const body = el('div', 'beszel-sys');
        const left = el('div', 'beszel-sys-meters');
        BARS.filter((key) => selected.includes(key)).forEach((key) => {
            const value = num(meters[key]);
            if (value !== null) left.appendChild(meterLine(dash, widget, key, value));
        });
        const temp = num(meters.temp);
        if (selected.includes('temp') && temp !== null) {
            const line = Tile.wideOnly(el('span', 'beszel-line beszel-line--text'));
            line.append(el('span', 'beszel-label', meterWord(dash, widget, 'temp')),
                toned('beszel-value', valueText('temp', temp), toneOf('temp', temp)));
            left.appendChild(line);
        }
        // The terse form keeps temperature and uptime on one footer line.
        const foot = [selected.includes('temp') && temp !== null ? valueText('temp', temp) : '',
            up ? Tile.say(dash, widget, 'upFor', { time: up }) : ''].filter(Boolean).join(' · ');
        if (foot) left.appendChild(el('span', 'beszel-foot dashboard-widget-narrow-only', foot));
        body.appendChild(left);

        const side = Tile.wideOnly(el('div', 'beszel-sys-side'));
        if (selected.includes('cpu') && Array.isArray(meters.spark)) {
            const spark = sparkline(dash, widget, meters.spark);
            if (spark) side.appendChild(spark);
        }
        const facts = [];
        if (selected.includes('load') && loadText(meters.load)) {
            facts.push(`${meterWord(dash, widget, 'load')} ${loadText(meters.load)}`);
        }
        if (selected.includes('net') && netText(dash, widget, meters.net)) {
            facts.push(`${meterWord(dash, widget, 'net')} ${netText(dash, widget, meters.net)}`);
        }
        if (facts.length) side.appendChild(el('span', 'media-meta beszel-facts', facts.join(' · ')));
        if (side.childNodes.length) body.appendChild(side);
        wrap.appendChild(body);
    }

    /* ---- beszel-attention: only what needs a look ---- */

    function drawAttention(wrap, dash, widget, items, result) {
        const counts = result?.counts || {};
        const total = ['up', 'down', 'paused', 'pending'].reduce((sum, key) => sum + (num(counts[key]) || 0), 0);
        if (!items.length) {
            if (!total) return empty(wrap, dash, widget);
            const line = el('p', 'beszel-fine');
            const mark = el('span', 'beszel-dot');
            mark.dataset.state = 'up';
            mark.setAttribute('aria-hidden', 'true');
            line.append(mark, Tile.say(dash, widget, total === 1 ? 'allFineOne' : 'allFine', { n: total }));
            wrap.appendChild(line);
            return;
        }

        const tally = el('p', 'beszel-counts');
        [['up', 'countUp', ''], ['down', 'countDown', 'bad'],
            ['paused', 'countPaused', ''], ['pending', 'countPending', '']].forEach(([key, word, tone]) => {
            const n = num(counts[key]) || 0;
            // Up and down always; the rarer two only when there is one.
            if (!n && key !== 'up' && key !== 'down') return;
            const chip = el('span', 'beszel-count', Tile.say(dash, widget, word, { n }));
            if (n && tone) chip.dataset.tone = tone;
            tally.appendChild(chip);
        });
        if (tally.childNodes.length) wrap.appendChild(tally);

        const list = el('div', 'beszel-list beszel-list--attention');
        items.slice(0, limit(widget)).forEach((item) => {
            const row = Tile.itemButton(dash, widget, item, 'media-row beszel-row beszel-row--attention');
            row.append(dot(item), el('span', 'media-title beszel-name', item.title));
            const up = isUp(item);
            // A system that is up is here for a meter over its limit; the
            // server says which. One that is not up says only its state.
            const reason = up ? (item.subtitle || '') : statusWord(dash, widget, item);
            row.appendChild(Tile.wideOnly(el('span', 'beszel-cell beszel-reason', reason)));
            const since = !up && Number(item.when) > 0 ? Tile.agoText(dash, widget, item.when) : '';
            row.appendChild(Tile.wideOnly(el('span', 'beszel-cell beszel-since', since)));
            list.appendChild(row);
        });
        wrap.appendChild(list);
    }

    /* ---- beszel-storage: the disks of every system ---- */

    /**
     * How full one disk is. The server puts it in meters.disk; the filesystem
     * list and `progress` are read too, so a differently shaped answer still
     * draws rather than vanishing. null is not drawn.
     */
    function fullness(item) {
        const direct = num(item.meters?.disk);
        if (direct !== null) return direct;
        const fs = Array.isArray(item.meters?.fs) ? num(item.meters.fs[0]?.pct) : null;
        if (fs !== null) return fs;
        const progress = num(item.progress);
        return progress === null ? null : progress * 100;
    }

    function diskLine(dash, widget, item, label, pct) {
        const row = Tile.itemButton(dash, widget, item, 'media-row beszel-disk');
        row.dataset.beszelDisk = String(item.id || '');
        row.append(el('span', 'media-title beszel-name', label),
            Tile.meterBar(pct, LIMITS.disk[0], LIMITS.disk[1]),
            toned('beszel-value', valueText('disk', pct), toneOf('disk', pct)));
        return row;
    }

    function drawStorage(wrap, dash, widget, items) {
        const disks = items.filter((item) => item.meters?.status === undefined || isUp(item))
            .map((item) => ({ item, pct: fullness(item) })).filter((entry) => entry.pct !== null)
            .slice(0, limit(widget));
        if (!disks.length) return empty(wrap, dash, widget, 'noDisks');

        // One column: fullest first, every line says whose disk it is.
        const flat = el('div', 'beszel-disks dashboard-widget-narrow-only');
        disks.forEach(({ item, pct }) => {
            flat.appendChild(diskLine(dash, widget, item, [item.title, item.subtitle].filter(Boolean).join(' '), pct));
        });

        // Two columns: a block per system, in the order its fullest disk set.
        const groups = new Map();
        disks.forEach((entry) => {
            const key = String(entry.item.id || '').split(':')[0] || entry.item.title;
            if (!groups.has(key)) groups.set(key, { title: entry.item.title, disks: [] });
            groups.get(key).disks.push(entry);
        });
        const grouped = Tile.wideOnly(el('div', 'beszel-groups'));
        groups.forEach((group) => {
            const block = el('div', 'beszel-group');
            block.appendChild(el('p', 'beszel-group-title', group.title));
            group.disks.forEach(({ item, pct }) => {
                block.appendChild(diskLine(dash, widget, item, item.subtitle || item.title, pct));
            });
            grouped.appendChild(block);
        });
        wrap.append(flat, grouped);
    }

    /* ---- registration ---- */

    const DRAWS = {
        beszel: drawSystems,
        'beszel-system': drawSystem,
        'beszel-attention': drawAttention,
        'beszel-storage': drawStorage,
    };

    window.DashboardWidgets = window.DashboardWidgets || {};
    Object.entries(DRAWS).forEach(([id, draw]) => {
        const render = Tile.register({
            id,
            name: 'Beszel',
            words: WORDS,
            art: false,
            keepOrder: true,
            minTtl: 30,
            ttl: 60,
            draw,
        });
        if (render) window.DashboardWidgets[id] = render;
    });

    // The drawing on its own, for a test that hands it an answer and a width.
    window.DashboardBeszel = { draw: DRAWS, LIMITS };
})();
