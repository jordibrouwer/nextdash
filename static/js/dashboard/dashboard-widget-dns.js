/**
 * The DNS blocker widgets: AdGuard Home and Pi-hole, one tile.
 *
 * The server sends `result.dns` (queries, blocked, a day by the hour, top
 * lists); this file draws it on the shared media tile, which fetches,
 * refreshes and words the loading and error lines.
 *
 * Four looks, chosen in the settings (default "pulse"):
 *   pulse    one big blocked percentage and the last day as a strip
 *   leaders  the top blocked domains and clients as lists with bars
 *   tiles    four figures and the hourly chart
 *   mix      pulse on top, the lists below (two columns only)
 *
 * One tile, two shapes: the terse and the fuller form are both built and the
 * panel's container query shows the one that fits, so nothing is refetched
 * when the window is dragged. A click opens a card with the top ten lists and
 * a button to the service (or goes straight there, setting `click: open`).
 *
 * Unknown is not zero: a figure the server did not send is not drawn, and
 * nought queries has no percentage.
 */
(function () {
    'use strict';

    const Tile = window.DashboardMediaTile;
    if (!Tile) return;

    const LOOKS = ['pulse', 'leaders', 'tiles', 'mix'];
    const ALL_PARTS = ['figures', 'chart', 'blocked', 'clients', 'protection', 'types', 'upstreams'];
    const FALLBACK_ROWS = 5;
    const SLICE_COLOURS = ['a', 'b', 'c', 'd'];

    const WORDS = {
        protectionOn: ['dashboard.widgetDnsProtectionOn', 'protection on'],
        protectionOff: ['dashboard.widgetDnsProtectionOff', 'protection off'],
        blockingOn: ['dashboard.widgetDnsBlockingOn', 'blocking on'],
        blockingOff: ['dashboard.widgetDnsBlockingOff', 'blocking off'],
        blocked: ['dashboard.widgetDnsBlocked', 'blocked'],
        blockedOf: ['dashboard.widgetDnsBlockedOf', 'blocked · {blocked} of {queries}'],
        queries: ['dashboard.widgetDnsQueries', 'queries'],
        ratio: ['dashboard.widgetDnsRatio', 'ratio'],
        avg: ['dashboard.widgetDnsAvg', 'avg'],
        avgFoot: ['dashboard.widgetDnsAvgFoot', 'avg {n} ms'],
        gravity: ['dashboard.widgetDnsGravity', '{n} domains on lists'],
        topBlocked: ['dashboard.widgetDnsTopBlocked', 'Top blocked'],
        topClients: ['dashboard.widgetDnsTopClients', 'Top clients'],
        queryTypes: ['dashboard.widgetDnsQueryTypes', 'Query types'],
        upstreams: ['dashboard.widgetDnsUpstreams', 'Upstreams'],
        lastDay: ['dashboard.widgetDnsLastDay', 'last 24 h'],
        chartLabel: ['dashboard.widgetDnsChartLabel', 'Queries per hour, blocked part marked'],
        noQueries: ['dashboard.widgetDnsNoQueries', 'No queries yet.'],
        nothing: ['dashboard.widgetDnsNothing', 'Nothing to show.'],
        detailTitle: ['dashboard.widgetDnsDetailTitle', '{name} · top 10'],
        none: ['dashboard.widgetDnsNone', 'Nothing in the last day.'],
    };

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = String(text);
        return node;
    }

    function num(value) {
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    }

    function count(value) {
        const n = num(value);
        return n === null ? '' : n.toLocaleString();
    }

    /** 18.4k for the small tiles: a figure that has to fit beside three others. */
    function compact(value) {
        const n = num(value);
        if (n === null) return '';
        return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
    }

    function percent(value) {
        const n = num(value);
        return n === null ? '' : `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
    }

    function limit(widget) {
        const rows = window.DashboardWidgetUtils?.rowLimit?.(widget, FALLBACK_ROWS) || FALLBACK_ROWS;
        return Math.min(rows, 10);
    }

    function lookOf(widget) {
        const look = widget?.config?.look;
        return LOOKS.includes(look) ? look : 'pulse';
    }

    function partsOf(widget) {
        const list = widget?.config?.parts;
        return Array.isArray(list) ? list.filter((p) => ALL_PARTS.includes(p)) : ALL_PARTS;
    }

    /** Protection is a state only when the server said so; null draws nothing. */
    function protectionText(dash, widget, dns) {
        if (typeof dns.protection !== 'boolean') return '';
        const word = dns.service === 'pihole' ? 'blocking' : 'protection';
        return Tile.say(dash, widget, `${word}${dns.protection ? 'On' : 'Off'}`);
    }

    function header(dash, widget, dns, parts) {
        const head = el('span', 'dns-head');
        if (parts.includes('protection') && typeof dns.protection === 'boolean') {
            const dot = el('span', 'dns-dot');
            dot.dataset.state = dns.protection ? 'on' : 'off';
            dot.setAttribute('aria-hidden', 'true');
            head.appendChild(dot);
        }
        head.appendChild(el('span', 'dns-name', serviceName(dns)));
        if (parts.includes('protection')) {
            const text = protectionText(dash, widget, dns);
            if (text) {
                const state = el('span', 'dns-state', text);
                if (dns.protection === false) state.dataset.tone = 'warn';
                head.appendChild(Tile.wideOnly(state));
            }
        }
        return head;
    }

    function serviceName(dns) {
        return dns.service === 'pihole' ? 'Pi-hole' : 'AdGuard Home';
    }

    function bigPct(dash, widget, dns) {
        const box = el('span', 'dns-pct');
        if (num(dns.blockedPct) === null) {
            box.appendChild(el('span', 'dns-sub', Tile.say(dash, widget, 'noQueries')));
            return box;
        }
        box.append(el('span', 'dns-big', percent(dns.blockedPct)),
            el('span', 'dns-sub', Tile.say(dash, widget, 'blockedOf',
                { blocked: count(dns.blocked), queries: count(dns.queries) })));
        return box;
    }

    /** The last day: a bar per hour as tall as its queries, the blocked part marked. */
    function strip(dash, widget, dns, tall) {
        const hours = Array.isArray(dns.hourly) ? dns.hourly.filter((h) => num(h?.q) !== null) : [];
        if (!hours.length) return null;
        const peak = Math.max(1, ...hours.map((h) => h.q));
        const bars = el('span', `dns-strip${tall ? ' dns-strip--tall' : ''}`);
        bars.setAttribute('role', 'img');
        bars.setAttribute('aria-label', Tile.say(dash, widget, 'chartLabel'));
        hours.forEach((hour) => {
            const bar = el('span', 'dns-bar');
            bar.style.height = hour.q > 0 ? `${Math.max(4, Math.round((hour.q / peak) * 100))}%` : '0';
            const cut = num(hour.b) !== null && hour.q > 0 ? Math.min(1, hour.b / hour.q) : 0;
            const inner = el('span', 'dns-bar-blocked');
            inner.style.height = `${Math.round(cut * 100)}%`;
            bar.appendChild(inner);
            bars.appendChild(bar);
        });
        return bars;
    }

    function foot(dash, widget, dns) {
        const bits = [];
        if (num(dns.avgMs) !== null) bits.push(Tile.say(dash, widget, 'avgFoot', { n: dns.avgMs }));
        if (num(dns.gravity) !== null) bits.push(Tile.say(dash, widget, 'gravity', { n: compact(dns.gravity) }));
        return bits.length ? el('span', 'dns-foot', bits.join(' · ')) : null;
    }

    /** A titled list; with `bars` each line carries a bar relative to the first. */
    function list(title, entries, max, { bars = false, tone = '' } = {}) {
        const box = el('span', 'dns-list');
        if (title) box.appendChild(el('span', 'dns-list-title', title));
        const top = Math.max(1, ...entries.map((e) => num(e.count) || 0));
        entries.slice(0, max).forEach((entry) => {
            const row = el('span', 'dns-row');
            row.appendChild(el('span', 'dns-row-name', entry.name));
            if (bars) {
                const bar = el('span', 'dns-row-bar');
                bar.style.setProperty('--p', String(Math.min(1, (entry.count || 0) / top)));
                if (tone) bar.dataset.tone = tone;
                row.appendChild(bar);
            }
            row.appendChild(el('span', 'dns-row-count', compact(entry.count)));
            box.appendChild(row);
        });
        return box;
    }

    function entries(value) {
        return Array.isArray(value) ? value.filter((e) => e && typeof e.name === 'string') : [];
    }

    function queryTypes(dash, widget, dns) {
        const types = entries(dns.queryTypes);
        const total = types.reduce((sum, t) => sum + (num(t.count) || 0), 0);
        if (!total) return null;
        const box = el('span', 'dns-types');
        box.appendChild(el('span', 'dns-list-title', Tile.say(dash, widget, 'queryTypes')));
        const bar = el('span', 'dns-stack');
        const legend = [];
        types.slice(0, 4).forEach((t, i) => {
            const slice = el('span', 'dns-slice');
            slice.dataset.slice = SLICE_COLOURS[i];
            slice.style.flexGrow = String(t.count);
            bar.appendChild(slice);
            legend.push(`${t.name} ${Math.round((t.count / total) * 100)}%`);
        });
        box.append(bar, el('span', 'dns-foot', legend.join(' · ')));
        return box;
    }

    function upstreams(dash, widget, dns) {
        const rows = Array.isArray(dns.upstreams) ? dns.upstreams : [];
        if (!rows.length) return null;
        const box = el('span', 'dns-list');
        box.appendChild(el('span', 'dns-list-title', Tile.say(dash, widget, 'upstreams')));
        rows.slice(0, 3).forEach((u) => {
            const row = el('span', 'dns-row');
            const figures = [num(u.pct) !== null ? percent(u.pct) : '', num(u.ms) !== null ? `${u.ms} ms` : '']
                .filter(Boolean).join(' · ');
            row.append(el('span', 'dns-row-name', u.name), el('span', 'dns-row-count', figures));
            box.appendChild(row);
        });
        return box;
    }

    function figureTile(label, value, tone) {
        const box = el('span', 'dns-figure');
        const big = el('span', 'dns-figure-value', value);
        if (tone) big.dataset.tone = tone;
        box.append(big, el('span', 'dns-figure-label', label));
        return box;
    }

    function figures(dash, widget, dns) {
        const grid = el('span', 'dns-figures');
        grid.appendChild(figureTile(Tile.say(dash, widget, 'queries'), compact(dns.queries)));
        grid.appendChild(figureTile(Tile.say(dash, widget, 'blocked'), compact(dns.blocked), 'bad'));
        if (num(dns.blockedPct) !== null) grid.appendChild(figureTile(Tile.say(dash, widget, 'ratio'), percent(dns.blockedPct)));
        if (num(dns.avgMs) !== null) grid.appendChild(figureTile(Tile.say(dash, widget, 'avg'), `${dns.avgMs} ms`));
        return grid;
    }

    function append(parent, ...nodes) {
        nodes.filter(Boolean).forEach((node) => parent.appendChild(node));
        return parent;
    }

    /** The lists a look shows, in the two-column form. */
    function listColumns(dash, widget, dns, parts, rows, bars) {
        const cols = el('span', 'dns-cols');
        const left = el('span', 'dns-col');
        const right = el('span', 'dns-col');
        if (parts.includes('blocked') && entries(dns.topBlocked).length) {
            left.appendChild(list(Tile.say(dash, widget, 'topBlocked'), entries(dns.topBlocked), rows, { bars, tone: 'bad' }));
        }
        if (parts.includes('clients') && entries(dns.topClients).length) {
            right.appendChild(list(Tile.say(dash, widget, 'topClients'), entries(dns.topClients), rows, { bars }));
        }
        if (parts.includes('types')) append(left, queryTypes(dash, widget, dns));
        if (parts.includes('upstreams')) append(right, upstreams(dash, widget, dns));
        if (left.childNodes.length) cols.appendChild(left);
        if (right.childNodes.length) cols.appendChild(right);
        return cols.childNodes.length ? cols : null;
    }

    function pulseNarrow(dash, widget, dns, parts) {
        const box = el('span', 'dns-body');
        if (parts.includes('figures')) box.appendChild(bigPct(dash, widget, dns));
        if (parts.includes('chart')) append(box, strip(dash, widget, dns, false));
        if (parts.includes('figures')) append(box, foot(dash, widget, dns));
        return box;
    }

    function pulseWide(dash, widget, dns, parts, rows) {
        const box = el('span', 'dns-body dns-body--split');
        const left = el('span', 'dns-col');
        if (parts.includes('figures')) left.appendChild(bigPct(dash, widget, dns));
        if (parts.includes('chart')) append(left, strip(dash, widget, dns, true));
        if (parts.includes('figures')) append(left, foot(dash, widget, dns));
        const right = el('span', 'dns-col');
        if (parts.includes('blocked') && entries(dns.topBlocked).length) {
            right.appendChild(list(Tile.say(dash, widget, 'topBlocked'), entries(dns.topBlocked), Math.min(rows, 3)));
        }
        if (parts.includes('clients') && entries(dns.topClients).length) {
            right.appendChild(list(Tile.say(dash, widget, 'topClients'), entries(dns.topClients), Math.min(rows, 3)));
        }
        if (parts.includes('types')) append(right, queryTypes(dash, widget, dns));
        if (parts.includes('upstreams')) append(right, upstreams(dash, widget, dns));
        if (left.childNodes.length) box.appendChild(left);
        if (right.childNodes.length) box.appendChild(right);
        return box;
    }

    function leadersNarrow(dash, widget, dns, parts, rows) {
        const box = el('span', 'dns-body');
        const blocked = parts.includes('blocked') ? entries(dns.topBlocked) : [];
        const clients = parts.includes('clients') ? entries(dns.topClients) : [];
        // The one list that is on; blocked first when both are.
        const chosen = blocked.length ? blocked : clients;
        if (chosen.length) box.appendChild(list('', chosen, rows, { bars: true, tone: blocked.length ? 'bad' : '' }));
        else if (parts.includes('figures')) box.appendChild(bigPct(dash, widget, dns));
        return box;
    }

    function tilesNarrow(dash, widget, dns, parts) {
        const box = el('span', 'dns-body');
        if (parts.includes('figures')) box.appendChild(figures(dash, widget, dns));
        else if (parts.includes('chart')) append(box, strip(dash, widget, dns, false));
        return box;
    }

    function tilesWide(dash, widget, dns, parts) {
        const box = el('span', 'dns-body dns-body--split');
        if (parts.includes('figures')) box.appendChild(figures(dash, widget, dns));
        if (parts.includes('chart')) {
            const side = el('span', 'dns-col');
            append(side, strip(dash, widget, dns, true), el('span', 'dns-foot', Tile.say(dash, widget, 'lastDay')));
            box.appendChild(side);
        }
        return box;
    }

    function mixWide(dash, widget, dns, parts, rows) {
        const box = el('span', 'dns-body');
        const top = el('span', 'dns-body dns-body--split');
        const left = el('span', 'dns-col');
        if (parts.includes('figures')) append(left, bigPct(dash, widget, dns), foot(dash, widget, dns));
        const right = el('span', 'dns-col');
        if (parts.includes('chart')) append(right, strip(dash, widget, dns, true));
        if (left.childNodes.length) top.appendChild(left);
        if (right.childNodes.length) top.appendChild(right);
        if (top.childNodes.length) box.appendChild(top);
        append(box, listColumns(dash, widget, dns, parts, Math.min(rows, 4), true));
        return box;
    }

    /** The wide body of a look. Narrow bodies are pulse's, leaders' or tiles'. */
    function wideBody(look, dash, widget, dns, parts, rows) {
        if (look === 'leaders') {
            return listColumns(dash, widget, dns, parts, rows, true) || pulseWide(dash, widget, dns, parts, rows);
        }
        if (look === 'tiles') return tilesWide(dash, widget, dns, parts);
        if (look === 'mix') return mixWide(dash, widget, dns, parts, rows);
        return pulseWide(dash, widget, dns, parts, rows);
    }

    function narrowBody(look, dash, widget, dns, parts, rows) {
        if (look === 'leaders') return leadersNarrow(dash, widget, dns, parts, rows);
        if (look === 'tiles') return tilesNarrow(dash, widget, dns, parts);
        return pulseNarrow(dash, widget, dns, parts);
    }

    /** The narrow header carries the percentage on the right for the lists. */
    function narrowHeadExtra(look, dash, widget, dns, head) {
        if (look === 'leaders' && num(dns.blockedPct) !== null) {
            head.appendChild(el('span', 'dns-head-pct', `${percent(dns.blockedPct)} ${Tile.say(dash, widget, 'blocked')}`));
        }
    }

    /* ---- the card a click opens ---- */

    function openCard(dash, widget, dns, returnTo) {
        const dialog = el('dialog', 'media-detail dns-detail');
        dialog.setAttribute('aria-label', serviceName(dns));
        dialog.appendChild(el('h3', 'media-detail-title', Tile.say(dash, widget, 'detailTitle', { name: serviceName(dns) })));
        const facts = [
            num(dns.queries) !== null ? `${count(dns.queries)} ${Tile.say(dash, widget, 'queries')}` : '',
            num(dns.blockedPct) !== null ? `${percent(dns.blockedPct)} ${Tile.say(dash, widget, 'blocked')}` : '',
            protectionText(dash, widget, dns),
        ].filter(Boolean).join(' · ');
        if (facts) dialog.appendChild(el('p', 'media-meta', facts));

        const cols = el('div', 'dns-detail-cols');
        const blocked = entries(dns.topBlocked);
        const clients = entries(dns.topClients);
        const section = (title, rows, tone) => {
            const box = el('div', 'dns-detail-col');
            box.appendChild(el('p', 'dns-list-title', title));
            if (!rows.length) box.appendChild(el('p', 'dns-foot', Tile.say(dash, widget, 'none')));
            else box.appendChild(list('', rows, 10, { bars: true, tone }));
            return box;
        };
        cols.append(section(Tile.say(dash, widget, 'topBlocked'), blocked, 'bad'),
            section(Tile.say(dash, widget, 'topClients'), clients, ''));
        dialog.appendChild(cols);

        const actions = el('div', 'media-detail-actions');
        const open = el('button', 'media-detail-btn media-detail-btn--primary', Tile.say(dash, widget, 'open'));
        open.type = 'button';
        open.dataset.mediaOpen = '';
        const close = el('button', 'media-detail-btn', Tile.say(dash, widget, 'close'));
        close.type = 'button';
        close.dataset.mediaClose = '';
        actions.append(open, close);
        dialog.appendChild(actions);

        const shut = () => {
            if (dialog.open) dialog.close();
            dialog.remove();
            returnTo?.focus?.({ preventScroll: true });
        };
        open.addEventListener('click', () => {
            shut();
            Tile.go(dash, widget, dns.openUrl);
        });
        close.addEventListener('click', shut);
        dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            shut();
        });
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) shut();
        });
        document.body.appendChild(dialog);
        dialog.showModal();
        open.focus();
    }

    /* ---- drawing ---- */

    function draw(wrap, dash, widget, items, result) {
        const dns = result?.dns;
        if (!dns) {
            wrap.appendChild(el('p', 'dashboard-widget-empty', Tile.say(dash, widget, 'nothing')));
            return;
        }
        const look = lookOf(widget);
        const parts = partsOf(widget);
        const rows = limit(widget);

        const tile = el('button', 'dns-tile');
        tile.type = 'button';
        tile.dataset.dnsLook = look;
        tile.dataset.dnsService = dns.service;
        const head = header(dash, widget, dns, parts);
        narrowHeadExtra(look, dash, widget, dns, head);
        tile.appendChild(head);

        const narrow = narrowBody(look, dash, widget, dns, parts, rows);
        narrow.classList.add('dashboard-widget-narrow-only');
        const wide = wideBody(look, dash, widget, dns, parts, rows);
        wide.classList.add('dashboard-widget-wide-only');
        tile.append(narrow, wide);

        // Detail is the default: the top ten first, the service one button away.
        const open = widget?.config?.click === 'open';
        const labelKey = open ? 'widgetActionMediaOpen' : 'widgetActionMediaDetails';
        window.DashboardWidgetUtils?.bindRowAction(tile, dash, {
            labelKey,
            labelFallback: open ? `Open in ${serviceName(dns)}` : 'Show details',
            href: dns.openUrl,
            run: () => (open ? Tile.go(dash, widget, dns.openUrl) : openCard(dash, widget, dns, tile)),
        });
        // A short name: the spans inside would read as one very long label.
        const summary = [serviceName(dns), num(dns.blockedPct) !== null ? `${percent(dns.blockedPct)} ${Tile.say(dash, widget, 'blocked')}` : '',
            protectionText(dash, widget, dns)].filter(Boolean).join(', ');
        tile.setAttribute('aria-label', summary);
        if (!open) tile.setAttribute('aria-haspopup', 'dialog');
        wrap.appendChild(tile);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    [['adguard', 'AdGuard Home'], ['pihole', 'Pi-hole']].forEach(([id, name]) => {
        const render = Tile.register({ id, name, words: WORDS, art: false, keepOrder: true, minTtl: 30, ttl: 60, draw });
        if (render) window.DashboardWidgets[id] = render;
    });

    // The drawing on its own, for a test that hands it an answer and a width.
    window.DashboardDns = { draw };
})();
