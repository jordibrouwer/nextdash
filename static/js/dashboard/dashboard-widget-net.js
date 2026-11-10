/**
 * The Network tests widget: a few of the network checks on bookmarks, in one
 * of three looks.
 *
 * The widget runs nothing. It reads what the monitor loop already measured
 * (GET /api/net/dashboard?checks=id,id: newest state, the last day as a strip)
 * through the shared media tile, which fetches on the widget's own TTL (60 s),
 * keeps the last answer for a moment and words the loading and error lines.
 *
 * Looks, chosen in the settings (`look`, default "rows"):
 *   rows       bookmark, a badge per check, the last response time
 *   tiles      one large value per check (ms, days left, the answer)
 *   heartbeat  a strip of the last 24 hours per check, with the current value
 *
 * How many columns there are comes from the width of the tile itself
 * (auto-fill grids), so a two-column widget on a one-column dashboard reads
 * as the one-column version. Rows are buttons that open the bookmark's Tests
 * tab. A check that no longer exists is said to be gone, not an error.
 */
(function () {
    'use strict';

    const Tile = window.DashboardMediaTile;
    if (!Tile) return;

    const LOOKS = ['rows', 'tiles', 'heartbeat'];
    const FALLBACK_ROWS = 12;
    const SEVERITY = { down: 5, warn: 4, slow: 3, unknown: 2, ok: 1, off: 0 };

    const WORDS = {
        none: ['dashboard.widgetNetNone', 'No checks chosen yet. Choose some in this widget’s settings.'],
        off: ['dashboard.widgetNetOff', 'Network checks are switched off in Config.'],
        gone: ['dashboard.widgetNetGone', 'check removed'],
        summaryProblems: ['dashboard.widgetNetProblems', '{n} with problems'],
        summaryFine: ['dashboard.widgetNetFine', 'all fine'],
        more: ['dashboard.widgetNetMore', '+{n} more'],
        checks: ['dashboard.widgetNetChecks', '{n} checks'],
        updated: ['dashboard.widgetNetUpdated', 'updated {time}'],
        sinceTime: ['dashboard.widgetNetSince', 'since {time}'],
        noResult: ['dashboard.widgetNetNoResult', 'no result yet'],
        notScheduled: ['dashboard.widgetNetNotScheduled', 'not scheduled'],
        down: ['dashboard.widgetNetDown', 'down'],
        beatLabel: ['dashboard.widgetNetBeatLabel', 'Last 24 hours'],
        openTests: ['dashboard.widgetNetOpenTests', 'Open its tests'],
        days: ['dashboard.widgetNetDays', '{n} d'],
    };

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = String(text);
        return node;
    }

    const model = () => window.NetChecksModel;
    const lookOf = (widget) => (LOOKS.includes(widget?.config?.look) ? widget.config.look : 'rows');
    const sortOf = (widget) => (widget?.config?.sort === 'name' ? 'name' : 'problems');

    function t(dash, key, fallback) {
        const v = dash?.language?.t?.(key);
        return v && v !== key ? v : fallback;
    }

    function stateOf(row) {
        return row.gone ? 'gone' : model().badgeState(row);
    }

    function isProblem(state) {
        return state === 'down' || state === 'warn' || state === 'slow';
    }

    function sorted(items, widget) {
        const list = items.map((row, i) => ({ row, i, state: stateOf(row) }));
        const name = (r) => `${r.row.name || ''} ${r.row.label || ''}`.toLowerCase();
        list.sort((a, b) => {
            if (a.state === 'gone' || b.state === 'gone') return (a.state === 'gone') - (b.state === 'gone') || a.i - b.i;
            if (sortOf(widget) === 'problems') {
                const diff = (SEVERITY[b.state] || 0) - (SEVERITY[a.state] || 0);
                if (diff) return diff;
            }
            return name(a).localeCompare(name(b)) || a.i - b.i;
        });
        return list;
    }

    /** The one value a check is summed up by: response time, days left, or what it found. */
    function valueOf(dash, widget, row, state) {
        if (state === 'gone') return '';
        if (state === 'off') return Tile.say(dash, widget, 'notScheduled');
        if (state === 'unknown') return Tile.say(dash, widget, 'noResult');
        if (state === 'paused') return t(dash, 'nettools.statePaused', 'Not measured');
        const s = row.state || {};
        if (state === 'down') return Tile.say(dash, widget, 'down');
        if (row.type === 'tls' && Number.isFinite(s.secondary)) return Tile.say(dash, widget, 'days', { n: s.secondary });
        if (row.type === 'json' && s.detail) return s.detail;
        if (row.type === 'dns') return s.detail || 'ok';
        return s.ms > 0 ? `${s.ms} ms` : (s.detail || 'ok');
    }

    function sinceText(dash, widget, row) {
        if (!row.downSince) return '';
        const time = new Date(row.downSince).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return Tile.say(dash, widget, 'sinceTime', { time });
    }

    function describe(dash, widget, row, state) {
        if (state === 'gone') return Tile.say(dash, widget, 'gone');
        const M = model();
        const parts = [`${row.name || row.url}: ${row.label || M.typeName(row.type)}`, M.stateLabel(state, (k, f) => t(dash, k, f))];
        if (row.state?.detail) parts.push(row.state.detail);
        return parts.join(' · ');
    }

    function openRow(dash, row) {
        void dash.config?.openLibraryOnBookmark?.(row.pageId, row.url, { tab: 'tests', focusRow: true });
    }

    /** A row is one button; a removed check is plain text, there is nowhere to go. */
    function rowShell(dash, widget, row, state, className) {
        const node = el(state === 'gone' ? 'div' : 'button', className);
        node.dataset.netCheck = row.checkId;
        node.dataset.state = state;
        node.setAttribute('aria-label', describe(dash, widget, row, state));
        node.title = describe(dash, widget, row, state);
        if (state !== 'gone') {
            node.type = 'button';
            window.DashboardWidgetUtils?.bindRowAction(node, dash, {
                labelKey: 'widgetActionNetOpen',
                labelFallback: Tile.say(dash, widget, 'openTests'),
                run: () => openRow(dash, row),
            });
        }
        return node;
    }

    function badge(row, state) {
        const b = el('span', 'netw-badge');
        b.dataset.state = state;
        const dot = el('i');
        dot.setAttribute('aria-hidden', 'true');
        b.append(dot, model().typeName(row.type));
        return b;
    }

    function rowsLook(dash, widget, list) {
        const grid = el('div', 'netw-rows');
        list.forEach(({ row, state }) => {
            const node = rowShell(dash, widget, row, state, 'netw-row');
            node.appendChild(el('span', 'netw-name', row.gone ? Tile.say(dash, widget, 'gone') : (row.name || row.url)));
            if (!row.gone) {
                node.appendChild(badge(row, state));
                const value = el('span', 'netw-value', valueOf(dash, widget, row, state));
                value.dataset.state = state;
                node.appendChild(value);
            }
            grid.appendChild(node);
        });
        return grid;
    }

    function tilesLook(dash, widget, list) {
        const grid = el('div', 'netw-tiles');
        list.forEach(({ row, state }) => {
            const node = rowShell(dash, widget, row, state, 'netw-tile');
            const head = el('span', 'netw-tile-head');
            head.appendChild(el('span', 'netw-tile-type', row.gone ? '' : (row.label || model().typeName(row.type))));
            const dot = el('i', 'netw-dot');
            dot.dataset.state = state;
            dot.setAttribute('aria-hidden', 'true');
            head.appendChild(dot);
            node.appendChild(head);
            node.appendChild(el('span', 'netw-tile-value', row.gone ? '—' : valueOf(dash, widget, row, state)));
            node.appendChild(el('span', 'netw-tile-name', row.gone ? Tile.say(dash, widget, 'gone') : (row.name || row.url)));
            if (!row.gone) {
                const detail = state === 'down' ? sinceText(dash, widget, row) : (row.state?.detail || '');
                if (detail) node.appendChild(el('span', 'netw-tile-detail', detail));
            }
            grid.appendChild(node);
        });
        return grid;
    }

    function heartbeatLook(dash, widget, list) {
        const grid = el('div', 'netw-beats');
        list.forEach(({ row, state }) => {
            const node = rowShell(dash, widget, row, state, 'netw-beat');
            const head = el('span', 'netw-beat-head');
            head.appendChild(el('span', 'netw-name', row.gone ? Tile.say(dash, widget, 'gone') : (row.name || row.url)));
            if (!row.gone) {
                head.appendChild(el('span', 'netw-beat-type', row.label || model().typeName(row.type)));
                const value = el('span', 'netw-value', valueOf(dash, widget, row, state));
                value.dataset.state = state;
                head.appendChild(value);
            }
            node.appendChild(head);
            if (!row.gone) {
                const strip = el('span', 'netw-strip');
                strip.setAttribute('role', 'img');
                strip.setAttribute('aria-label', Tile.say(dash, widget, 'beatLabel'));
                const beat = Array.isArray(row.beat) && row.beat.length ? row.beat : [];
                beat.forEach((s) => {
                    const slice = el('i');
                    slice.dataset.beat = s;
                    strip.appendChild(slice);
                });
                node.appendChild(strip);
            }
            grid.appendChild(node);
        });
        return grid;
    }

    function foot(dash, widget, list, result) {
        const problems = list.filter((x) => isProblem(x.state)).length;
        const line = el('div', 'netw-foot');
        const dot = el('i', 'netw-dot');
        dot.dataset.state = problems ? 'down' : 'ok';
        dot.setAttribute('aria-hidden', 'true');
        line.appendChild(dot);
        line.appendChild(el('span', '', problems
            ? Tile.say(dash, widget, 'summaryProblems', { n: problems })
            : Tile.say(dash, widget, 'summaryFine')));
        if (result.fetchedAt) {
            const time = new Date(result.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            line.appendChild(el('span', 'netw-foot-time', Tile.say(dash, widget, 'updated', { time })));
        }
        return line;
    }

    function draw(wrap, dash, widget, items, result) {
        const chosen = Array.isArray(widget?.config?.checks) ? widget.config.checks : [];
        if (result.enabled === false) {
            wrap.appendChild(el('p', 'dashboard-widget-empty', Tile.say(dash, widget, 'off')));
            return;
        }
        if (!chosen.length || !items.length) {
            wrap.appendChild(el('p', 'dashboard-widget-empty', Tile.say(dash, widget, 'none')));
            return;
        }
        const all = sorted(items, widget);
        const max = window.DashboardWidgetUtils?.rowLimit?.(widget, FALLBACK_ROWS) || FALLBACK_ROWS;
        const shown = all.slice(0, max);
        const look = lookOf(widget);
        const body = look === 'tiles' ? tilesLook(dash, widget, shown)
            : look === 'heartbeat' ? heartbeatLook(dash, widget, shown)
                : rowsLook(dash, widget, shown);
        wrap.dataset.netLook = look;
        wrap.appendChild(body);
        if (all.length > shown.length) {
            wrap.appendChild(el('p', 'netw-more', Tile.say(dash, widget, 'more', { n: all.length - shown.length })));
        }
        wrap.appendChild(foot(dash, widget, all, result));
    }

    function endpoint(widget) {
        const ids = Array.isArray(widget?.config?.checks) ? widget.config.checks : [];
        return `/api/net/dashboard?checks=${encodeURIComponent(ids.join(','))}`;
    }

    const render = Tile.register({ id: 'nettests', name: 'Network tests', words: WORDS, art: false, keepOrder: true,
        minTtl: 30, ttl: 60, endpoint, draw });

    function ensureModel() {
        if (model()) return Promise.resolve();
        const load = window.LazyScript?.loadScriptOnce;
        return load ? load('js/shared/net-checks-model.js', 'netChecksModel', () => Boolean(model())).catch(() => {}) : Promise.resolve();
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.nettests = async (body, widget, dash) => {
        await ensureModel();
        if (!model()) return;
        return render(body, widget, dash);
    };

    // The drawing on its own, for a test that hands it an answer.
    window.DashboardNetWidget = { draw };
})();
