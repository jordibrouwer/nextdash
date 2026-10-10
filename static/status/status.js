(function () {
    'use strict';

    var root = document.querySelector('[data-status-root]');
    if (!root) return;
    var body = root.querySelector('[data-status-body]');
    var updatedEl = root.querySelector('[data-status-updated]');
    var dataURL = root.getAttribute('data-status-data');
    var lang = document.documentElement.lang || undefined;
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var REFRESH_MS = 60000;

    var strings = {};
    try {
        strings = JSON.parse(document.getElementById('status-strings').textContent) || {};
    } catch (e) {
        strings = {};
    }

    // JSON state -> css class, mapped once.
    var STATE_CLASS = { operational: 'ok', degraded: 'warn', down: 'down', maintenance: 'maint', unknown: 'unk' };

    var lastOk = 0;
    var failed = false;
    var timer = 0;
    var loading = false;

    function fmt(str, vars) {
        return String(str || '').replace(/\{(n|total|time|ago)\}/g, function (m, k) {
            return vars && vars[k] !== undefined ? String(vars[k]) : m;
        });
    }

    function str(key) {
        return strings[key] || '';
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function svgEl(tag, attrs) {
        var node = document.createElementNS(SVG_NS, tag);
        Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
        return node;
    }

    function stateWord(state) {
        return str(STATE_CLASS[state] ? state : 'unknown');
    }

    var dateShort = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });
    // Day bars are UTC days (as the health history keeps them): read in the
    // visitor's zone, a bar west of UTC would carry the day before's date.
    var dayDate = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    var timeShort = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' });
    var dateTime = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    function relative(ms) {
        var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
        if (s < 5) return str('justNow');
        if (s < 60) return fmt(str('secondsAgo'), { n: s });
        var m = Math.floor(s / 60);
        if (m < 60) return fmt(str('minutesAgo'), { n: m });
        var h = Math.floor(m / 60);
        if (h < 24) return fmt(str('hoursAgo'), { n: h });
        return fmt(str('daysAgoN'), { n: Math.floor(h / 24) });
    }

    function sameDay(a, b) {
        return new Date(a).toDateString() === new Date(b).toDateString();
    }

    function sinceText(svc) {
        if (svc.reason === 'restarting') return str('restarting');
        if (svc.reason === 'stale' && svc.lastCheck) return fmt(str('lastCheck'), { ago: relative(svc.lastCheck) });
        if (svc.since && (svc.state === 'down' || svc.state === 'degraded')) {
            var when = sameDay(svc.since, Date.now()) ? timeShort.format(svc.since) : dateShort.format(svc.since);
            return fmt(str(svc.state === 'down' ? 'downSince' : 'degradedSince'), { time: when });
        }
        return '';
    }

    function icon(problem) {
        var svg = svgEl('svg', { width: '22', height: '22', viewBox: '0 0 22 22', 'aria-hidden': 'true' });
        svg.appendChild(svgEl('circle', { cx: '11', cy: '11', r: '10', fill: 'none', stroke: '#fff', 'stroke-width': '2' }));
        if (problem) {
            svg.appendChild(svgEl('path', { d: 'M11 6v6M11 15v1', stroke: '#fff', 'stroke-width': '2.2', 'stroke-linecap': 'round' }));
        } else {
            svg.appendChild(svgEl('path', { d: 'M6.5 11.5l3 3 6-6.5', fill: 'none', stroke: '#fff', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        }
        return svg;
    }

    function sparkline(values) {
        var svg = svgEl('svg', { 'class': 'spark', viewBox: '0 0 56 16', 'aria-hidden': 'true' });
        var min = Math.min.apply(null, values);
        var max = Math.max.apply(null, values);
        var span = max - min || 1;
        var pts = values.map(function (v, i) {
            var x = values.length > 1 ? (i * 56) / (values.length - 1) : 0;
            var y = values.length > 1 && max !== min ? 14 - ((v - min) / span) * 12 : 8;
            return x.toFixed(1) + ',' + y.toFixed(1);
        });
        svg.appendChild(svgEl('polyline', { points: pts.join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        return svg;
    }

    function renderBars(days) {
        var bars = el('div', 'bars');
        bars.setAttribute('role', 'img');
        bars.setAttribute('aria-label', str('last30'));
        (days || []).forEach(function (day) {
            var state = STATE_CLASS[day.s] ? day.s : 'unknown';
            var bar = el('span', STATE_CLASS[state]);
            bar.setAttribute('data-state', state);
            var word = state === 'operational' ? str('noProblems') : state === 'unknown' ? str('noData') : stateWord(state);
            bar.title = dayDate.format(day.d) + ' · ' + word;
            bars.appendChild(bar);
        });
        return bars;
    }

    function renderService(svc) {
        var state = STATE_CLASS[svc.state] ? svc.state : 'unknown';
        var row = el('div', 'sp-row');
        row.setAttribute('data-status-service', '');
        row.setAttribute('data-state', state);

        var line = el('div', 'sp-line1');
        var name = svc.name || str('unnamed');
        if (svc.url) {
            var a = el('a', 'sp-name', name);
            a.href = svc.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            line.appendChild(a);
        } else {
            line.appendChild(el('span', 'sp-name', name));
        }
        line.appendChild(el('span', 'pill ' + STATE_CLASS[state], stateWord(state)));
        var since = sinceText(svc);
        if (since) {
            var s = el('span', 'sp-since', since);
            s.setAttribute('data-status-since', '');
            line.appendChild(s);
        }
        if (svc.ms || (svc.spark && svc.spark.length)) {
            var ms = el('span', 'sp-ms');
            if (svc.spark && svc.spark.length) ms.appendChild(sparkline(svc.spark));
            if (svc.ms) {
                var m = el('span', '', svc.ms + ' ms');
                m.setAttribute('data-status-ms', '');
                ms.appendChild(m);
            }
            line.appendChild(ms);
        }
        row.appendChild(line);

        row.appendChild(renderBars(svc.days));
        var axis = el('div', 'bars-axis');
        axis.appendChild(el('span', '', str('daysAgo')));
        var up = el('span', '', typeof svc.uptime === 'number' ? (svc.uptime * 100).toFixed(2) + '%' : '');
        up.setAttribute('data-status-uptime', '');
        axis.appendChild(up);
        axis.appendChild(el('span', '', str('today')));
        row.appendChild(axis);
        return row;
    }

    function renderGroup(group) {
        var sec = el('section', 'sp-group');
        sec.setAttribute('data-status-group', '');
        var h = el('h3');
        h.appendChild(el('span', '', group.name));
        h.appendChild(el('span', '', fmt(str('working'), { n: group.working, total: group.total })));
        sec.appendChild(h);
        (group.services || []).forEach(function (svc) { sec.appendChild(renderService(svc)); });
        return sec;
    }

    function renderMaintenance(m) {
        var box = el('div', 'sp-maint');
        box.setAttribute('data-status-maint', '');
        if (m.active) {
            box.appendChild(el('b', '', str('maintenanceNow')));
        } else {
            box.appendChild(el('b', '', str('plannedMaintenance')));
            // An end on the same day needs only its time: "Sat 11 Oct, 02:00–04:00".
            var sameDay = new Date(m.start).toDateString() === new Date(m.end).toDateString();
            var endText = sameDay ? timeShort.format(m.end) : dateTime.format(m.end);
            box.appendChild(document.createTextNode(' · ' + dateTime.format(m.start) + '–' + endText));
        }
        var bits = [];
        if (m.label) bits.push(m.label);
        if (m.groups && m.groups.length) bits.push(m.groups.join(', '));
        if (bits.length) box.appendChild(document.createTextNode(' · ' + bits.join(' · ')));
        return box;
    }

    function renderLegend() {
        var foot = el('div', 'sp-foot');
        var legend = el('div', 'sp-legend');
        legend.setAttribute('data-status-legend', '');
        [['ok', 'legendWorking'], ['warn', 'degraded'], ['down', 'down'], ['maint', 'maintenance']].forEach(function (p) {
            var item = el('span');
            item.appendChild(el('i', p[0]));
            item.appendChild(document.createTextNode(str(p[1])));
            legend.appendChild(item);
        });
        foot.appendChild(legend);
        foot.appendChild(el('span', '', str('refreshes')));
        return foot;
    }

    function render(snap) {
        var frag = document.createDocumentFragment();

        var problems = snap.problems || 0;
        var cls = snap.anyDown ? 'down' : problems ? 'warn' : 'ok';
        var text = problems === 0 ? str('allWorking') : problems === 1 ? str('oneProblem') : fmt(str('manyProblems'), { n: problems });
        var total = el('div', 'sp-total ' + cls);
        total.setAttribute('data-status-overall', '');
        total.setAttribute('role', 'status');
        total.appendChild(icon(cls !== 'ok'));
        total.appendChild(document.createTextNode(text));
        frag.appendChild(total);

        (snap.maintenance || []).forEach(function (m) { frag.appendChild(renderMaintenance(m)); });
        (snap.groups || []).forEach(function (g) { frag.appendChild(renderGroup(g)); });
        frag.appendChild(renderLegend());

        body.replaceChildren(frag);
    }

    function paintUpdated() {
        if (!updatedEl) return;
        if (failed) {
            updatedEl.textContent = str('loadFailed');
        } else if (lastOk) {
            updatedEl.textContent = fmt(str('updated'), { ago: relative(lastOk) });
        }
    }

    function schedule() {
        clearTimeout(timer);
        timer = 0;
        if (document.hidden) return;
        timer = setTimeout(load, REFRESH_MS);
    }

    function load() {
        clearTimeout(timer);
        timer = 0;
        if (loading) return Promise.resolve();
        loading = true;
        return fetch(dataURL, { cache: 'no-store' })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (snap) {
                render(snap);
                lastOk = Date.now();
                failed = false;
            })
            .catch(function () {
                failed = true;
            })
            .then(function () {
                loading = false;
                paintUpdated();
                schedule();
            });
    }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            clearTimeout(timer);
            timer = 0;
        } else {
            load();
        }
    });

    setInterval(paintUpdated, 1000);
    load();
})();
