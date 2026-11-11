/**
 * The Bazarr widget: which subtitles are missing and which came in lately, on
 * the shared media tile.
 *
 * The server sends `result.subs` (a line of totals, what is missing and what
 * was fetched); this file draws it on the shared media tile, which fetches,
 * refreshes and words the loading and error lines.
 *
 * Each topic is optional (`config.topics`). One tile, two shapes: the narrow
 * body shows one topic at a time behind small tabs, the wide body puts the
 * topics side by side. Both are built and the panel's container query shows
 * the one that fits, so nothing is refetched when the window is dragged.
 *
 * A click opens the title in Bazarr, or a small card first
 * (`config.click: detail`). Unknown is not zero: a topic the server could not
 * read is not drawn, and the tile says so in one line.
 */
(function () {
    'use strict';

    const Tile = window.DashboardMediaTile;
    if (!Tile) return;

    const TOPICS = ['missing', 'recent', 'totals'];
    const BODY_TOPICS = ['missing', 'recent'];
    const FALLBACK_ROWS = 5;
    const MAX_ROWS = 20;

    const WORDS = {
        figMovies: ['dashboard.widgetBazarrFigMovies', 'movies missing'],
        figEpisodes: ['dashboard.widgetBazarrFigEpisodes', 'episodes missing'],
        figProviders: ['dashboard.widgetBazarrFigProviders', 'provider issues'],
        tabMissing: ['dashboard.widgetBazarrTabMissing', 'Missing'],
        tabRecent: ['dashboard.widgetBazarrTabRecent', 'Fetched'],
        titleMissing: ['dashboard.widgetBazarrTitleMissing', 'Missing subtitles'],
        titleRecent: ['dashboard.widgetBazarrTitleRecent', 'Recently fetched'],
        upgraded: ['dashboard.widgetBazarrUpgraded', 'upgraded'],
        noneMissing: ['dashboard.widgetBazarrNoneMissing', 'Every subtitle is in.'],
        noneRecent: ['dashboard.widgetBazarrNoneRecent', 'Nothing fetched lately.'],
        nothing: ['dashboard.widgetBazarrNothing', 'Nothing to show.'],
        noTopics: ['dashboard.widgetBazarrNoTopics', 'Choose what to show in this widget’s settings.'],
        partial: ['dashboard.widgetBazarrPartial', 'Part of this could not be read just now. It is tried again shortly.'],
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
        const row = el('button', 'bz-row');
        row.type = 'button';
        build(row);
        const open = widget?.config?.click !== 'detail';
        window.DashboardWidgetUtils?.bindRowAction(row, dash, {
            labelKey: open ? 'widgetActionMediaOpen' : 'widgetActionMediaDetails',
            labelFallback: open ? 'Open in Bazarr' : 'Show details',
            href: entry.openUrl,
            run: () => (open ? Tile.go(dash, widget, entry.openUrl) : openCard(dash, widget, entry, details, row)),
        });
        if (!open) row.setAttribute('aria-haspopup', 'dialog');
        return row;
    }

    function chips(languages) {
        const box = el('span', 'bz-langs');
        (languages || []).forEach((code) => box.appendChild(el('span', 'bz-lang', code)));
        return box;
    }

    function missingRow(dash, widget, entry) {
        const languages = Array.isArray(entry.languages) ? entry.languages : [];
        return rowButton(dash, widget, entry, (row) => {
            const text = el('span', 'bz-text');
            text.appendChild(el('span', 'bz-title', entry.title));
            if (entry.subtitle) text.appendChild(el('span', 'bz-sub', entry.subtitle));
            row.append(text, chips(languages));
        }, [entry.subtitle, languages.join(', ')]);
    }

    function recentRow(dash, widget, entry) {
        const meta = [entry.provider, entry.score, entry.upgrade ? say(dash, widget, 'upgraded') : '',
            entry.at ? Tile.agoText(dash, widget, entry.at) : ''].filter(Boolean);
        return rowButton(dash, widget, entry, (row) => {
            const text = el('span', 'bz-text');
            text.appendChild(el('span', 'bz-title', entry.title));
            const sub = [entry.subtitle, meta.join(' · ')].filter(Boolean).join(' — ');
            if (sub) text.appendChild(el('span', 'bz-sub', sub));
            row.append(text, chips(entry.language ? [entry.language] : []));
        }, [entry.subtitle, entry.language, ...meta]);
    }

    /* ---- the blocks ---- */

    function block(topic, dash, widget, subs, rows) {
        const box = el('span', 'bz-block');
        box.dataset.topic = topic;
        let lines = [];
        if (topic === 'missing') {
            lines = (subs.missing || []).slice(0, rows).map((entry) => missingRow(dash, widget, entry));
        } else if (topic === 'recent') {
            lines = (subs.recent || []).slice(0, rows).map((entry) => recentRow(dash, widget, entry));
        }
        box.appendChild(el('span', 'bz-block-title', say(dash, widget, `title${topic[0].toUpperCase()}${topic.slice(1)}`)));
        if (!lines.length) box.appendChild(el('span', 'bz-empty', say(dash, widget, topic === 'missing' ? 'noneMissing' : 'noneRecent')));
        lines.forEach((line) => box.appendChild(line));
        return box;
    }

    function totalsBar(dash, widget, subs) {
        const totals = subs.totals;
        if (!totals) return null;
        const bar = el('span', 'bz-totals');
        const figure = (value, label, bad) => {
            const box = el('span', bad ? 'bz-figure bz-figure--bad' : 'bz-figure');
            box.append(el('span', 'bz-figure-value', value), el('span', 'bz-figure-label', label));
            return box;
        };
        bar.appendChild(figure(compact(totals.missingMovies) || '0', say(dash, widget, 'figMovies')));
        bar.appendChild(figure(compact(totals.missingEpisodes) || '0', say(dash, widget, 'figEpisodes')));
        bar.appendChild(figure(compact(totals.providerIssues) || '0', say(dash, widget, 'figProviders'), totals.providerIssues > 0));
        return bar;
    }

    function tabs(dash, widget, topics, current, redraw) {
        const row = el('span', 'bz-tabs');
        row.setAttribute('role', 'tablist');
        topics.forEach((topic) => {
            const tab = el('button', 'bz-tab', say(dash, widget, `tab${topic[0].toUpperCase()}${topic.slice(1)}`));
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
        const dialog = el('dialog', 'media-detail bz-detail');
        dialog.setAttribute('aria-label', entry.title || 'Bazarr');
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
        const subs = result?.subs;
        if (!subs) {
            wrap.appendChild(el('p', 'dashboard-widget-empty', say(dash, widget, 'nothing')));
            return;
        }
        const wanted = topicsOf(widget);
        const bodyTopics = BODY_TOPICS.filter((t) => wanted.includes(t));
        const showTotals = wanted.includes('totals') && subs.totals;
        if (!bodyTopics.length && !showTotals) {
            wrap.appendChild(el('p', 'dashboard-widget-empty', say(dash, widget, 'noTopics')));
            return;
        }
        const rows = limit(widget);
        const tile = el('div', 'bz-tile');

        const head = el('span', 'bz-head');
        head.appendChild(el('span', 'bz-name', 'Bazarr'));
        tile.appendChild(head);
        if (showTotals) tile.appendChild(totalsBar(dash, widget, subs));

        if (bodyTopics.length) {
            const redraw = () => {
                if (wrap.parentNode) {
                    wrap.replaceChildren();
                    draw(wrap, dash, widget, items, result);
                }
            };
            const current = bodyTopics.includes(picked.get(widget.id)) ? picked.get(widget.id) : bodyTopics[0];

            const narrow = el('span', 'bz-body dashboard-widget-narrow-only');
            if (bodyTopics.length > 1) narrow.appendChild(tabs(dash, widget, bodyTopics, current, redraw));
            narrow.appendChild(block(current, dash, widget, subs, rows));

            const wide = el('span', 'bz-body bz-body--grid dashboard-widget-wide-only');
            wide.dataset.topics = String(bodyTopics.length);
            bodyTopics.forEach((topic) => wide.appendChild(block(topic, dash, widget, subs, rows)));
            tile.append(narrow, wide);
        }
        if (result.partial) {
            tile.appendChild(el('span', 'bz-foot', say(dash, widget, 'partial')));
        }
        wrap.appendChild(tile);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    const render = Tile.register({ id: 'bazarr', name: 'Bazarr', words: WORDS, art: false, keepOrder: true, minTtl: 60, ttl: 300, draw });
    if (render) window.DashboardWidgets.bazarr = render;

    // The drawing on its own, for a test that hands it an answer and a width.
    window.DashboardBazarr = { draw };
})();
