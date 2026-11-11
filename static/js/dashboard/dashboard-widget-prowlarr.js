/**
 * The Prowlarr widget: how the indexers are doing, on the shared media tile.
 *
 * The server sends `result.indexers` (a line of totals, the indexers and what needs
 * attention); this file draws it on the shared media tile, which fetches,
 * refreshes and words the loading and error lines.
 *
 * Each topic is optional (`config.topics`). One tile, two shapes: the narrow
 * body shows one topic at a time behind small tabs, the wide body puts the
 * topics side by side. Both are built and the panel's container query shows
 * the one that fits, so nothing is refetched when the window is dragged.
 *
 * A click opens the page in Prowlarr, or a small card first
 * (`config.click: detail`). Unknown is not zero: a topic the server could not
 * read is not drawn, and the tile says so in one line.
 */
(function () {
    'use strict';

    const Tile = window.DashboardMediaTile;
    if (!Tile) return;

    const TOPICS = ['indexers', 'issues', 'totals'];
    const BODY_TOPICS = ['indexers', 'issues'];
    const FALLBACK_ROWS = 5;
    const MAX_ROWS = 20;

    const WORDS = {
        period: ['dashboard.widgetProwlarrPeriod', 'last {n} days'],
        periodOne: ['dashboard.widgetProwlarrPeriodOne', 'last 24 hours'],
        figIndexers: ['dashboard.widgetProwlarrFigIndexers', 'indexers on'],
        figQueries: ['dashboard.widgetProwlarrFigQueries', 'queries'],
        figGrabs: ['dashboard.widgetProwlarrFigGrabs', 'grabs'],
        figFailed: ['dashboard.widgetProwlarrFigFailed', 'failed'],
        tabIndexers: ['dashboard.widgetProwlarrTabIndexers', 'Indexers'],
        tabIssues: ['dashboard.widgetProwlarrTabIssues', 'Attention'],
        titleIndexers: ['dashboard.widgetProwlarrTitleIndexers', 'Indexers'],
        titleIssues: ['dashboard.widgetProwlarrTitleIssues', 'Needs attention'],
        queries: ['dashboard.widgetProwlarrQueries', '{n} queries'],
        grabs: ['dashboard.widgetProwlarrGrabs', '{n} grabs'],
        failed: ['dashboard.widgetProwlarrFailedCount', '{n} failed'],
        avg: ['dashboard.widgetProwlarrAvg', '{n} ms'],
        paused: ['dashboard.widgetProwlarrPaused', 'paused'],
        pausedUntil: ['dashboard.widgetProwlarrPausedUntil', '{name} is paused until {time}'],
        torrent: ['dashboard.widgetProwlarrTorrent', 'torrent'],
        usenet: ['dashboard.widgetProwlarrUsenet', 'usenet'],
        levelError: ['dashboard.widgetProwlarrLevelError', 'error'],
        levelWarning: ['dashboard.widgetProwlarrLevelWarning', 'warning'],
        noneIndexers: ['dashboard.widgetProwlarrNoneIndexers', 'No indexers are on.'],
        noneIssues: ['dashboard.widgetProwlarrNoneIssues', 'All clear.'],
        nothing: ['dashboard.widgetProwlarrNothing', 'Nothing to show.'],
        noTopics: ['dashboard.widgetProwlarrNoTopics', 'Choose what to show in this widget’s settings.'],
        partial: ['dashboard.widgetProwlarrPartial', 'Part of this could not be read just now. It is tried again shortly.'],
        notSetUp: ['dashboard.widgetMediaNotSetUp', 'Connect {name} in this widget’s settings.'],
    };

    const picked = new Map();

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = String(text);
        return node;
    }

    function num(value) {
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    }

    function compact(value) {
        const n = num(value);
        if (n === null) return '';
        return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
    }

    function topicsOf(widget) {
        const list = widget?.config?.topics;
        return Array.isArray(list) ? list.filter((t) => TOPICS.includes(t)) : TOPICS.slice();
    }

    function limit(widget) {
        const rows = window.DashboardWidgetUtils?.rowLimit?.(widget, FALLBACK_ROWS) || FALLBACK_ROWS;
        return Math.min(rows, MAX_ROWS);
    }

    function say(dash, widget, key, values) {
        return Tile.say(dash, widget, key, values);
    }

    /* ---- one line of a list ---- */

    function rowButton(dash, widget, entry, build, details) {
        const row = el('button', 'pw-row');
        row.type = 'button';
        build(row);
        const open = widget?.config?.click !== 'detail';
        window.DashboardWidgetUtils?.bindRowAction(row, dash, {
            labelKey: open ? 'widgetActionMediaOpen' : 'widgetActionMediaDetails',
            labelFallback: open ? 'Open in Prowlarr' : 'Show details',
            href: entry.openUrl,
            run: () => (open ? Tile.go(dash, widget, entry.openUrl) : openCard(dash, widget, entry, details, row)),
        });
        if (!open) row.setAttribute('aria-haspopup', 'dialog');
        return row;
    }

    function count(value) {
        const n = num(value);
        return n === null ? '' : n.toLocaleString();
    }

    function periodText(dash, widget, days) {
        return days === 1 ? say(dash, widget, 'periodOne') : say(dash, widget, 'period', { n: days });
    }

    function untilText(ms) {
        try {
            return new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
        } catch (err) {
            return '';
        }
    }

    function chip(text, bad) {
        return el('span', bad ? 'pw-chip pw-chip--bad' : 'pw-chip', text);
    }

    function indexerRow(dash, widget, entry) {
        const facts = [
            say(dash, widget, entry.protocol === 'usenet' ? 'usenet' : 'torrent'),
            entry.noStats ? '' : say(dash, widget, 'queries', { n: compact(entry.queries) || '0' }),
            entry.noStats ? '' : say(dash, widget, 'grabs', { n: compact(entry.grabs) || '0' }),
            entry.avgMs > 0 ? say(dash, widget, 'avg', { n: count(entry.avgMs) }) : '',
        ].filter(Boolean);
        return rowButton(dash, widget, { title: entry.name, openUrl: entry.openUrl }, (row) => {
            const text = el('span', 'pw-text');
            text.appendChild(el('span', 'pw-title', entry.name));
            text.appendChild(el('span', 'pw-sub', facts.join(' · ')));
            const side = el('span', 'pw-side');
            if (entry.paused) side.appendChild(chip(say(dash, widget, 'paused'), true));
            else if (!entry.noStats && entry.failed > 0) side.appendChild(chip(say(dash, widget, 'failed', { n: count(entry.failed) }), true));
            row.append(text, side);
        }, facts);
    }

    function issueRow(dash, widget, entry) {
        const text = entry.until
            ? say(dash, widget, 'pausedUntil', { name: entry.text, time: untilText(entry.until) })
            : entry.text;
        return rowButton(dash, widget, { title: text, openUrl: entry.openUrl }, (row) => {
            const body = el('span', 'pw-text');
            body.appendChild(el('span', 'pw-title pw-title--wrap', text));
            row.append(body, chip(say(dash, widget, entry.level === 'error' ? 'levelError' : 'levelWarning'), entry.level === 'error'));
        }, [text]);
    }

    /* ---- the blocks ---- */

    function block(topic, dash, widget, data, rows) {
        const box = el('span', 'pw-block');
        box.dataset.topic = topic;
        let lines = [];
        if (topic === 'indexers') {
            lines = (data.indexers || []).slice(0, rows).map((entry) => indexerRow(dash, widget, entry));
        } else if (topic === 'issues') {
            lines = (data.issues || []).slice(0, rows).map((entry) => issueRow(dash, widget, entry));
        }
        box.appendChild(el('span', 'pw-block-title', say(dash, widget, `title${topic[0].toUpperCase()}${topic.slice(1)}`)));
        if (!lines.length) box.appendChild(el('span', 'pw-empty', say(dash, widget, topic === 'issues' ? 'noneIssues' : 'noneIndexers')));
        lines.forEach((line) => box.appendChild(line));
        return box;
    }

    function totalsBar(dash, widget, data) {
        const totals = data.totals;
        if (!totals) return null;
        const bar = el('span', 'pw-totals');
        const figure = (value, label, bad) => {
            const box = el('span', bad ? 'pw-figure pw-figure--bad' : 'pw-figure');
            box.append(el('span', 'pw-figure-value', value), el('span', 'pw-figure-label', label));
            return box;
        };
        bar.appendChild(figure(`${count(totals.enabled)}/${count(totals.total)}`, say(dash, widget, 'figIndexers')));
        // A count the server could not read is a dash, never a zero.
        const shown = (value) => (num(value) === null ? '–' : (compact(value) || '0'));
        bar.appendChild(figure(shown(totals.queries), say(dash, widget, 'figQueries')));
        bar.appendChild(figure(shown(totals.grabs), say(dash, widget, 'figGrabs')));
        bar.appendChild(figure(shown(totals.failed), say(dash, widget, 'figFailed'), totals.failed > 0));
        return bar;
    }

    function tabs(dash, widget, topics, current, redraw) {
        const row = el('span', 'pw-tabs');
        row.setAttribute('role', 'tablist');
        topics.forEach((topic) => {
            const tab = el('button', 'pw-tab', say(dash, widget, `tab${topic[0].toUpperCase()}${topic.slice(1)}`));
            tab.type = 'button';
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', topic === current ? 'true' : 'false');
            tab.addEventListener('click', () => {
                picked.set(widget.id, topic);
                redraw();
            });
            row.appendChild(tab);
        });
        return row;
    }

    /* ---- the card a click opens, when the click is "details" ---- */

    function openCard(dash, widget, entry, details, returnTo) {
        const dialog = el('dialog', 'media-detail pw-detail');
        dialog.setAttribute('aria-label', entry.title || 'Prowlarr');
        dialog.appendChild(el('h3', 'media-detail-title', entry.title));
        const facts = (details || []).filter(Boolean).join(' · ');
        if (facts) dialog.appendChild(el('p', 'media-meta', facts));

        const actions = el('div', 'media-detail-actions');
        const open = el('button', 'media-detail-btn media-detail-btn--primary', say(dash, widget, 'open'));
        open.type = 'button';
        const close = el('button', 'media-detail-btn', say(dash, widget, 'close'));
        close.type = 'button';
        actions.append(open, close);
        dialog.appendChild(actions);

        const shut = () => {
            if (dialog.open) dialog.close();
            dialog.remove();
            returnTo?.focus?.({ preventScroll: true });
        };
        open.addEventListener('click', () => {
            shut();
            Tile.go(dash, widget, entry.openUrl);
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
        const data = result?.indexers;
        if (!data) {
            wrap.appendChild(el('p', 'dashboard-widget-empty', say(dash, widget, 'nothing')));
            return;
        }
        const wanted = topicsOf(widget);
        const bodyTopics = BODY_TOPICS.filter((t) => wanted.includes(t));
        const showTotals = wanted.includes('totals') && data.totals;
        if (!bodyTopics.length && !showTotals) {
            wrap.appendChild(el('p', 'dashboard-widget-empty', say(dash, widget, 'noTopics')));
            return;
        }
        const rows = limit(widget);
        const tile = el('div', 'pw-tile');

        const head = el('span', 'pw-head');
        head.append(el('span', 'pw-name', 'Prowlarr'),
            el('span', 'pw-period', periodText(dash, widget, Number(data.days) || 7)));
        tile.appendChild(head);
        if (showTotals) tile.appendChild(totalsBar(dash, widget, data));

        if (bodyTopics.length) {
            const redraw = () => {
                if (wrap.parentNode) {
                    wrap.replaceChildren();
                    draw(wrap, dash, widget, items, result);
                }
            };
            const current = bodyTopics.includes(picked.get(widget.id)) ? picked.get(widget.id) : bodyTopics[0];

            const narrow = el('span', 'pw-body dashboard-widget-narrow-only');
            if (bodyTopics.length > 1) narrow.appendChild(tabs(dash, widget, bodyTopics, current, redraw));
            narrow.appendChild(block(current, dash, widget, data, rows));

            const wide = el('span', 'pw-body pw-body--grid dashboard-widget-wide-only');
            wide.dataset.topics = String(bodyTopics.length);
            bodyTopics.forEach((topic) => wide.appendChild(block(topic, dash, widget, data, rows)));
            tile.append(narrow, wide);
        }
        if (result.partial) {
            tile.appendChild(el('span', 'pw-foot', say(dash, widget, 'partial')));
        }
        wrap.appendChild(tile);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    const render = Tile.register({ id: 'prowlarr', name: 'Prowlarr', words: WORDS, art: false, keepOrder: true, minTtl: 60, ttl: 300, draw });
    if (render) window.DashboardWidgets.prowlarr = render;

    // The drawing on its own, for a test that hands it an answer and a width.
    window.DashboardProwlarr = { draw };
})();
