/**
 * The RSS widget: the latest articles from the feeds this tile names.
 *
 * The feeds widget reports on feeds; this one reads from them. Every row is
 * one article: its headline on a single line, its own address behind it, and
 * whatever the feed said about it in a preview that appears on hover or on
 * keyboard focus.
 *
 * Rows are buttons rather than anchors on purpose. Keyboard navigation walks
 * the buttons inside a widget body (see _isNavigableWidgetElement in
 * keyboard-navigation.js), so an <a> would be a row the arrow keys skip --
 * and bindRowAction's data-widget-href gives back everything an anchor was
 * for: Ctrl/Cmd+Enter opens a new tab, and the row menu offers the same.
 */
(function () {
    'use strict';

    const EXPANDED_KEY = 'expandedOverflowWidgets';

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    function say(body, className, text) {
        body.replaceChildren();
        const line = document.createElement('p');
        line.className = className;
        line.textContent = text;
        body.appendChild(line);
    }

    /*
     * Which tiles the reader has opened up, kept the way categories keep it.
     *
     * A category remembers being expanded across a reload, and a tile that
     * forgot would collapse itself every morning on a dashboard someone
     * deliberately opened up.
     */
    function expandedIds() {
        try {
            const raw = JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]');
            return new Set(Array.isArray(raw) ? raw.map(String) : []);
        } catch (error) {
            return new Set();
        }
    }

    function setExpanded(id, expanded) {
        const ids = expandedIds();
        if (expanded) ids.add(String(id)); else ids.delete(String(id));
        try {
            localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids]));
        } catch (error) {
            // A browser refusing storage still expands the tile; it just does
            // not remember it next time.
        }
    }

    /** One answer per widget, so a repaint is not a round trip. */
    async function load(dash, widget, pageId) {
        dash._widgetRss = dash._widgetRss || {};
        const key = `${pageId}:${widget.id}`;
        const held = dash._widgetRss[key];
        if (held && held.until > Date.now()) return held.result;
        try {
            const res = await fetch(`/api/widgets/rss?pageId=${encodeURIComponent(pageId)}`
                + `&id=${encodeURIComponent(widget.id)}`);
            if (!res.ok) return null;
            const result = await res.json();
            dash._widgetRss[key] = { result, until: Date.now() + 5 * 60 * 1000 };
            return result;
        } catch (error) {
            return null;
        }
    }

    function whenText(dash, item) {
        const at = Number(item?.publishedAt) || 0;
        if (!at) return '';
        const days = Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000));
        if (days <= 0) return label(dash, 'dashboard.widgetRssToday', 'today');
        return label(dash, 'dashboard.widgetRssDaysAgo', '{n}d').replace('{n}', String(days));
    }

    /** What the preview says: the feed's own words, with where and when. */
    function previewText(dash, item) {
        const parts = [String(item?.title || '').trim()];
        const summary = String(item?.summary || '').trim();
        if (summary) parts.push(summary);
        const meta = [String(item?.source || '').trim(), whenText(dash, item)]
            .filter(Boolean).join(' · ');
        if (meta) parts.push(meta);
        return parts.filter(Boolean).join('\n\n');
    }

    function openItem(dash, link) {
        if (dash?.settings?.openInNewTab) {
            window.open(link, '_blank', 'noopener,noreferrer');
            return;
        }
        window.location.href = link;
    }

    function buildRow(dash, item) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'dashboard-widget-row';

        const name = document.createElement('span');
        // The shared row class is what truncates a long headline to one line
        // with an ellipsis; the preview carries the whole of it.
        name.className = 'dashboard-widget-row-name';
        name.textContent = String(item.title || '');

        const when = document.createElement('span');
        when.className = 'dashboard-widget-row-detail';
        when.textContent = whenText(dash, item);

        row.append(name, when);
        window.DashboardWidgetUtils?.bindRowAction(row, dash, {
            labelKey: 'widgetActionOpenArticle',
            labelFallback: 'Open article',
            href: item.link,
            run: () => openItem(dash, item.link),
        });
        window.DashboardSmartWhyPopover?.attach?.(row, previewText(dash, item));
        return row;
    }

    /*
     * Draw the rows this tile is showing right now.
     *
     * Separate from the fetch so that expanding is a redraw and not a second
     * request: the items are already here, and the whole of the difference is
     * how many of them are on screen.
     */
    function draw(body, widget, dash, items, { focusToggle = false } = {}) {
        const rows = window.DashboardWidgetUtils?.rowLimit?.(widget, 5) || 5;
        const expanded = expandedIds().has(String(widget.id));
        const shown = expanded ? items : items.slice(0, rows);

        body.replaceChildren();
        const list = document.createElement('div');
        list.className = 'dashboard-widget-rows';
        shown.forEach((item) => list.appendChild(buildRow(dash, item)));

        const hidden = items.length - shown.length;
        if (hidden > 0 || expanded) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'dashboard-widget-row dashboard-widget-row--more';
            const text = document.createElement('span');
            text.className = 'dashboard-widget-row-name';
            text.textContent = expanded
                ? label(dash, 'dashboard.categoryShowLess', 'show less')
                : label(dash, 'dashboard.widgetMore', '{n} more').replace('{n}', String(hidden));
            toggle.appendChild(text);
            window.DashboardWidgetUtils?.bindRowAction(toggle, dash, {
                labelKey: expanded ? 'widgetActionShowLess' : 'widgetActionOpenAll',
                labelFallback: expanded ? 'Show less' : 'Show all',
                run: () => {
                    setExpanded(widget.id, !expanded);
                    // Keeping the focus on the toggle is what makes this
                    // usable from the keyboard: without it the redraw drops
                    // the reader back to the top of the grid.
                    draw(body, widget, dash, items, { focusToggle: true });
                },
            });
            list.appendChild(toggle);
            body.appendChild(list);
            if (focusToggle) toggle.focus({ preventScroll: true });
            return;
        }
        body.appendChild(list);
    }

    async function render(body, widget, dash) {
        const pageId = Number(dash?.currentPageId) || Number(dash?.pages?.[0]?.id) || 1;
        say(body, 'dashboard-widget-waiting', label(dash, 'dashboard.widgetRssWaiting', 'Loading…'));

        const result = await load(dash, widget, pageId);
        if (!result) {
            say(body, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetRssUnreachable', 'Could not read those feeds.'));
            return;
        }
        if (result.error === 'no feeds set') {
            say(body, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetRssNoFeeds', 'Add a feed address in this widget’s settings.'));
            return;
        }
        if (result.error) {
            say(body, 'dashboard-widget-empty', String(result.error));
            return;
        }

        const items = Array.isArray(result.items) ? result.items : [];
        if (!items.length) {
            say(body, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetRssNothing', 'Nothing published yet.'));
            return;
        }
        draw(body, widget, dash, items);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.rss = render;
})();
