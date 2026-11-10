/**
 * The Jellystat widget: who watched what, on the shared media tile.
 *
 * The server sends `result.stats` (a line of totals, the recent plays, the
 * most viewed items and the most active people); this file draws it on the
 * shared media tile, which fetches, refreshes and words the loading and error
 * lines.
 *
 * Each topic is optional (`config.topics`). One tile, two shapes: the narrow
 * body shows one topic at a time behind small tabs, the wide body puts the
 * topics side by side. Both are built and the panel's container query shows
 * the one that fits, so nothing is refetched when the window is dragged.
 *
 * A click opens the item in Jellystat, or a small card first
 * (`config.click: detail`). Unknown is not zero: a topic the server could not
 * read is not drawn, and the tile says so in one line.
 */
(function () {
    'use strict';

    const Tile = window.DashboardMediaTile;
    if (!Tile) return;

    const TOPICS = ['activity', 'items', 'users', 'totals'];
    const BODY_TOPICS = ['activity', 'items', 'users'];
    const FALLBACK_ROWS = 5;
    const MAX_ROWS = 10;

    const WORDS = {
        period: ['dashboard.widgetJellystatPeriod', 'last {n} days'],
        periodOne: ['dashboard.widgetJellystatPeriodOne', 'last 24 hours'],
        plays: ['dashboard.widgetJellystatPlays', 'plays'],
        watched: ['dashboard.widgetJellystatWatched', 'watched'],
        tabActivity: ['dashboard.widgetJellystatTabActivity', 'Recent'],
        tabItems: ['dashboard.widgetJellystatTabItems', 'Most viewed'],
        tabUsers: ['dashboard.widgetJellystatTabUsers', 'People'],
        titleActivity: ['dashboard.widgetJellystatTitleActivity', 'Recent plays'],
        titleItems: ['dashboard.widgetJellystatTitleItems', 'Most viewed'],
        titleUsers: ['dashboard.widgetJellystatTitleUsers', 'Most active'],
        playsCount: ['dashboard.widgetJellystatPlaysCount', '{n} plays'],
        playsOne: ['dashboard.widgetJellystatPlaysOne', '1 play'],
        direct: ['dashboard.widgetJellystatDirect', 'direct'],
        transcode: ['dashboard.widgetJellystatTranscode', 'transcoded'],
        kindMovie: ['dashboard.widgetJellystatKindMovie', 'film'],
        kindSeries: ['dashboard.widgetJellystatKindSeries', 'series'],
        kindMusic: ['dashboard.widgetJellystatKindMusic', 'music'],
        none: ['dashboard.widgetJellystatNone', 'Nothing played in this period.'],
        nothing: ['dashboard.widgetJellystatNothing', 'Nothing to show.'],
        noTopics: ['dashboard.widgetJellystatNoTopics', 'Choose what to show in this widget’s settings.'],
        partial: ['dashboard.widgetJellystatPartial', 'Part of this could not be read just now. It is tried again shortly.'],
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

    function count(value) {
        const n = num(value);
        return n === null ? '' : n.toLocaleString();
    }

    function compact(value) {
        const n = num(value);
        if (n === null) return '';
        return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
    }

    /** 12600 → "3h 30m"; under an hour "45m"; nothing for none. */
    function duration(seconds) {
        const total = num(seconds);
        if (total === null || total <= 0) return '';
        const minutes = Math.round(total / 60);
        if (minutes < 60) return `${Math.max(1, minutes)}m`;
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        if (hours < 100) return rest ? `${hours}h ${rest}m` : `${hours}h`;
        return `${hours.toLocaleString()}h`;
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

    function playsText(dash, widget, n) {
        return n === 1 ? say(dash, widget, 'playsOne') : say(dash, widget, 'playsCount', { n: count(n) });
    }

    function periodText(dash, widget, days) {
        return days === 1 ? say(dash, widget, 'periodOne') : say(dash, widget, 'period', { n: days });
    }

    /* ---- one line of a list ---- */

    function thumb(url) {
        const box = el('span', 'js-thumb');
        box.setAttribute('aria-hidden', 'true');
        if (url) {
            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.src = url;
            img.addEventListener('error', () => img.remove());
            box.appendChild(img);
        }
        return box;
    }

    function rowButton(dash, widget, entry, build, details) {
        const row = el('button', 'js-row');
        row.type = 'button';
        build(row);
        const open = widget?.config?.click !== 'detail';
        window.DashboardWidgetUtils?.bindRowAction(row, dash, {
            labelKey: open ? 'widgetActionMediaOpen' : 'widgetActionMediaDetails',
            labelFallback: open ? 'Open in Jellystat' : 'Show details',
            href: entry.openUrl,
            run: () => (open ? Tile.go(dash, widget, entry.openUrl) : openCard(dash, widget, entry, details, row)),
        });
        if (!open) row.setAttribute('aria-haspopup', 'dialog');
        return row;
    }

    function activityRow(dash, widget, play) {
        const details = [
            play.who,
            play.device,
            play.method === 'Transcode' ? say(dash, widget, 'transcode')
                : (play.method ? say(dash, widget, 'direct') : ''),
            duration(play.seconds),
            play.at ? Tile.agoText(dash, widget, play.at) : '',
        ].filter(Boolean);
        return rowButton(dash, widget, { title: play.title, subtitle: play.subtitle, openUrl: play.openUrl }, (row) => {
            const text = el('span', 'js-text');
            text.appendChild(el('span', 'js-title', play.title));
            const meta = [play.subtitle, [play.who, play.at ? Tile.agoText(dash, widget, play.at) : ''].filter(Boolean).join(' · ')]
                .filter(Boolean).join(' — ');
            if (meta) text.appendChild(el('span', 'js-sub', meta));
            row.append(thumb(play.poster), text);
        }, details);
    }

    function barRow(dash, widget, entry, peak, thumbUrl, sub) {
        return rowButton(dash, widget, entry, (row) => {
            const text = el('span', 'js-text');
            text.appendChild(el('span', 'js-title', entry.title));
            if (sub) text.appendChild(el('span', 'js-sub', sub));
            const bar = el('span', 'js-bar');
            bar.style.setProperty('--p', String(peak > 0 ? Math.min(1, entry.plays / peak) : 0));
            text.appendChild(bar);
            if (thumbUrl) row.appendChild(thumb(thumbUrl));
            row.append(text, el('span', 'js-count', compact(entry.plays)));
        }, [playsText(dash, widget, entry.plays), duration(entry.seconds)].filter(Boolean));
    }

    function itemRow(dash, widget, item, peak) {
        const kind = say(dash, widget, `kind${item.kind === 'movie' ? 'Movie' : item.kind === 'music' ? 'Music' : 'Series'}`);
        return barRow(dash, widget, { title: item.title, plays: item.plays, seconds: item.seconds, openUrl: item.openUrl },
            peak, item.poster, kind);
    }

    function personRow(dash, widget, person, peak) {
        return barRow(dash, widget, { title: person.name, plays: person.plays, openUrl: person.openUrl }, peak, '', '');
    }

    /* ---- the blocks ---- */

    function block(topic, dash, widget, stats, rows) {
        const box = el('span', 'js-block');
        box.dataset.topic = topic;
        let lines = [];
        if (topic === 'activity') {
            lines = (stats.activity || []).slice(0, rows).map((play) => activityRow(dash, widget, play));
        } else if (topic === 'items') {
            const items = (stats.items || []).slice(0, rows);
            const peak = Math.max(1, ...items.map((i) => num(i.plays) || 0));
            lines = items.map((item) => itemRow(dash, widget, item, peak));
        } else if (topic === 'users') {
            const people = (stats.users || []).slice(0, rows);
            const peak = Math.max(1, ...people.map((p) => num(p.plays) || 0));
            lines = people.map((person) => personRow(dash, widget, person, peak));
        }
        box.appendChild(el('span', 'js-block-title', say(dash, widget, `title${topic[0].toUpperCase()}${topic.slice(1)}`)));
        if (!lines.length) box.appendChild(el('span', 'js-empty', say(dash, widget, 'none')));
        lines.forEach((line) => box.appendChild(line));
        return box;
    }

    function totalsBar(dash, widget, stats) {
        const totals = stats.totals;
        if (!totals) return null;
        const bar = el('span', 'js-totals');
        const figure = (value, label) => {
            const box = el('span', 'js-figure');
            box.append(el('span', 'js-figure-value', value), el('span', 'js-figure-label', label));
            return box;
        };
        bar.appendChild(figure(compact(totals.plays) || '0', say(dash, widget, 'plays')));
        bar.appendChild(figure(duration(totals.seconds) || '0m', say(dash, widget, 'watched')));
        return bar;
    }

    function tabs(dash, widget, topics, current, redraw) {
        const row = el('span', 'js-tabs');
        row.setAttribute('role', 'tablist');
        topics.forEach((topic) => {
            const tab = el('button', 'js-tab', say(dash, widget, `tab${topic[0].toUpperCase()}${topic.slice(1)}`));
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
        const dialog = el('dialog', 'media-detail js-detail');
        dialog.setAttribute('aria-label', entry.title || 'Jellystat');
        dialog.appendChild(el('h3', 'media-detail-title', entry.title));
        if (entry.subtitle) dialog.appendChild(el('p', 'media-meta', entry.subtitle));
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
        const stats = result?.stats;
        if (!stats) {
            wrap.appendChild(el('p', 'dashboard-widget-empty', say(dash, widget, 'nothing')));
            return;
        }
        const wanted = topicsOf(widget);
        const bodyTopics = BODY_TOPICS.filter((t) => wanted.includes(t));
        const showTotals = wanted.includes('totals') && stats.totals;
        if (!bodyTopics.length && !showTotals) {
            wrap.appendChild(el('p', 'dashboard-widget-empty', say(dash, widget, 'noTopics')));
            return;
        }
        const rows = limit(widget);
        const tile = el('div', 'js-tile');

        const head = el('span', 'js-head');
        head.append(el('span', 'js-name', 'Jellystat'),
            el('span', 'js-period', periodText(dash, widget, Number(stats.days) || 30)));
        tile.appendChild(head);
        if (showTotals) tile.appendChild(totalsBar(dash, widget, stats));

        if (bodyTopics.length) {
            const redraw = () => {
                const parent = wrap.parentNode;
                if (parent) {
                    wrap.replaceChildren();
                    draw(wrap, dash, widget, items, result);
                }
            };
            const current = bodyTopics.includes(picked.get(widget.id)) ? picked.get(widget.id) : bodyTopics[0];

            const narrow = el('span', 'js-body dashboard-widget-narrow-only');
            if (bodyTopics.length > 1) narrow.appendChild(tabs(dash, widget, bodyTopics, current, redraw));
            narrow.appendChild(block(current, dash, widget, stats, rows));

            const wide = el('span', 'js-body js-body--grid dashboard-widget-wide-only');
            wide.dataset.topics = String(bodyTopics.length);
            bodyTopics.forEach((topic) => wide.appendChild(block(topic, dash, widget, stats, rows)));
            tile.append(narrow, wide);
        }
        if (stats.partial || result.partial) {
            tile.appendChild(el('span', 'js-foot', say(dash, widget, 'partial')));
        }
        wrap.appendChild(tile);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    const render = Tile.register({ id: 'jellystat', name: 'Jellystat', words: WORDS, art: false, keepOrder: true, minTtl: 60, ttl: 300, draw });
    if (render) window.DashboardWidgets.jellystat = render;

    // The drawing on its own, for a test that hands it an answer and a width.
    window.DashboardJellystat = { draw };
})();
