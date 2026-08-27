/**
 * The pieces every listing widget needs, in one place.
 *
 * Six tiles cut their list to a row count someone chose, and each of them was
 * cutting it silently: five rows shown out of twelve looked exactly like five
 * rows out of five. The number of rows is a setting about what you want to
 * *see*, so what falls outside it has to be visible too — otherwise the tile
 * quietly answers a different question than the one it appears to answer.
 */
(function () {
    'use strict';

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    /**
     * A row saying what did not fit, appended only when something did not.
     *
     * Clickable when the caller says where the rest lives, because a count you
     * cannot reach is a smaller version of the same problem.
     */
    function appendOverflowRow(list, dash, hiddenCount, onOpen) {
        if (!list || !Number.isFinite(hiddenCount) || hiddenCount <= 0) return;
        const row = document.createElement(onOpen ? 'button' : 'div');
        if (onOpen) row.type = 'button';
        row.className = 'dashboard-widget-row dashboard-widget-row--more';

        const name = document.createElement('span');
        name.className = 'dashboard-widget-row-name';
        name.textContent = label(dash, 'dashboard.widgetMore', '{n} more')
            .replace('{n}', String(hiddenCount));

        row.appendChild(name);
        if (onOpen) row.addEventListener('click', onOpen);
        list.appendChild(row);
    }

    /** The row count a widget was given, within the bounds the server enforces. */
    function rowLimit(widget, fallback) {
        const raw = Number(widget?.config?.rows);
        if (!Number.isFinite(raw)) return fallback;
        return Math.min(Math.max(Math.trunc(raw), 1), 20);
    }

    /*
     * Open the health view on one filter.
     *
     * The tiles called dash.health.openWithFilter(), which does not exist —
     * ?.() swallowed that silently, so every figure on the health widget was a
     * button that did nothing. The filter travels the way the header badge
     * already sends it, as ?hv_filter=, which restoreViewState reads when the
     * view opens; setting the filter on the module directly would work only
     * once it happened to be loaded.
     *
     * The key must be one restoreViewState accepts, or the view opens on its
     * default and the click reads as having gone to the wrong place.
     */
    const HEALTH_FILTERS = new Set([
        'all', 'broken', 'content', 'duplicate', 'shortcut-conflict', 'orphaned-category',
        'unchecked', 'stale', 'unused', 'missing-preview', 'certificates', 'healthy', 'monitored',
    ]);

    function openHealthFiltered(dash, filter) {
        const key = HEALTH_FILTERS.has(String(filter)) ? String(filter) : 'all';
        try {
            const url = new URL(window.location.href);
            url.searchParams.set('hv_filter', key);
            url.hash = '#health';
            // replaceState, not a navigation: the view is opened in place, and
            // a pushState here would put an entry in history for something the
            // view records itself once it settles.
            window.history.replaceState(window.history.state, '', url);
        } catch (_error) {
            // A URL that cannot be built is no reason not to open the view.
        }
        const opened = dash?.health?.openHealthView?.();
        if (opened && typeof opened.catch === 'function') opened.catch(() => {});
        return !!opened;
    }

    /*
     * Open a config section on one of its tabs.
     *
     * The tab travels through the hash rather than through an argument,
     * because openConfigView takes a section and reads the tab from the
     * address -- and it only does so when the hash already names the section
     * it is opening. Written first for that reason; setting the property
     * afterwards would be overwritten by the render that follows.
     */
    function openConfigTab(dash, section, tab) {
        const config = dash?.config;
        if (typeof config?.openConfigView !== 'function') {
            dash?.showView?.('config');
            return false;
        }
        if (tab) {
            try {
                const url = new URL(window.location.href);
                url.hash = `#config/${section}/${tab}`;
                // replaceState, not a navigation: config records where it
                // settled itself, and a pushState here would leave a history
                // entry for a screen that has not been drawn yet.
                window.history.replaceState(window.history.state, '', url);
            } catch (_error) {
                // A hash that cannot be written is no reason not to open the
                // section; it opens on its remembered tab instead.
            }
        }
        const opened = config.openConfigView(section);
        if (opened && typeof opened.catch === 'function') opened.catch(() => {});
        return true;
    }

    /** fetch() carrying the write token when this install has one. */
    function authFetch(url, init) {
        const send = typeof window.nextDashFetch === 'function' ? window.nextDashFetch : fetch;
        return send(url, init);
    }

    /*
     * A widget's own layout container.
     *
     * The width a widget is drawn at is not the width it asked for: the grid
     * narrows a two-column widget back to one when the dashboard is showing
     * one, and a phone never shows two at all. So the layout answers to a
     * container query on what actually happened rather than to config.columns,
     * which only records the request.
     *
     * Scoped to this element rather than to .dashboard-widget-body, so the
     * nine tiles that shipped before this keep the box they were built in.
     */
    function panel(body) {
        body.replaceChildren();
        const wrap = document.createElement('div');
        wrap.className = 'dashboard-widget-panel';
        body.appendChild(wrap);
        return wrap;
    }

    /*
     * A figure, what it counts, and a tone for what it means.
     *
     * Tone by meaning and never by size, following the health widget: nought
     * broken is the best news a dashboard can carry and still belongs in the
     * broken row. Two across a narrow tile, four across a wide one.
     */
    function statGrid(stats) {
        const grid = document.createElement('div');
        grid.className = 'dashboard-widget-stats';
        const cells = (stats || []).filter(Boolean);
        // Four abreast is only worth offering when there are four; three
        // figures across a wide tile would leave a gap where a fourth is not.
        if (cells.length >= 4 && cells.length % 4 === 0) {
            grid.classList.add('dashboard-widget-stats--wide');
        }
        cells.forEach((stat) => {
            const cell = document.createElement(stat.onOpen ? 'button' : 'div');
            if (stat.onOpen) cell.type = 'button';
            cell.className = 'dashboard-widget-stat';
            if (stat.tone) cell.classList.add(`dashboard-widget-stat--${stat.tone}`);
            /*
             * Nought is marked so the stylesheet can quieten it.
             *
             * Decided here rather than in CSS because CSS cannot read a value.
             * What it buys is the tile's whole legibility: a readout of "0
             * kept, 4 lost, 0 died" was three figures in alarm colours, and
             * the reader had to check each one to find the single number that
             * wanted them.
             */
            if (Number(stat.value) === 0) cell.classList.add('is-quiet');

            const value = document.createElement('span');
            value.className = 'dashboard-widget-stat-value';
            value.textContent = String(stat.value ?? '—');

            const name = document.createElement('span');
            name.className = 'dashboard-widget-stat-label';
            name.textContent = String(stat.label || '');

            if (stat.title) cell.title = stat.title;
            cell.append(value, name);
            if (stat.onOpen) cell.addEventListener('click', stat.onOpen);
            grid.appendChild(cell);
        });
        return grid;
    }

    /*
     * A proportion as a bar.
     *
     * Beside the figure, never instead of it: a bar says how full something is
     * at a glance and cannot say of what, and "42 of 118" is the part someone
     * repeats to themselves.
     */
    function meter(done, total, tone) {
        const wrap = document.createElement('div');
        wrap.className = 'dashboard-widget-meter';
        const fill = document.createElement('span');
        fill.className = `dashboard-widget-meter-fill dashboard-widget-meter-fill--${tone || 'good'}`;
        const share = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
        fill.style.width = `${Math.round(share * 100)}%`;
        wrap.appendChild(fill);
        return wrap;
    }

    /** The headline figure with its qualifier — the qualifier is load-bearing. */
    function headline(value, note) {
        const head = document.createElement('div');
        head.className = 'dashboard-widget-headline';
        const figure = document.createElement('span');
        figure.className = 'dashboard-widget-headline-value';
        figure.textContent = String(value);
        head.appendChild(figure);
        if (note) {
            const qualifier = document.createElement('span');
            qualifier.className = 'dashboard-widget-headline-note';
            qualifier.textContent = String(note);
            head.appendChild(qualifier);
        }
        return head;
    }

    /** A quiet closing line: what the tile assumed, or what happens next. */
    function footnote(text, tone) {
        const line = document.createElement('p');
        line.className = 'dashboard-widget-footnote';
        if (tone) line.classList.add(`dashboard-widget-footnote--${tone}`);
        line.textContent = String(text);
        return line;
    }

    /*
     * A list of rows that becomes two columns when there is room.
     *
     * The second column of a wide widget is otherwise white space beside a
     * single file of short rows -- and a row is a name and a figure, which is
     * exactly the shape that pairs.
     */
    function rowList(wide) {
        const list = document.createElement('div');
        list.className = wide === false
            ? 'dashboard-widget-rows'
            : 'dashboard-widget-rows dashboard-widget-rows--pairs';
        return list;
    }

    /** One row: a name, and optionally the figure or verdict beside it. */
    function row(name, detail, tone, onOpen) {
        const element = document.createElement(onOpen ? 'button' : 'div');
        if (onOpen) element.type = 'button';
        element.className = 'dashboard-widget-row';
        if (tone) element.classList.add(`dashboard-widget-row--${tone}`);

        const title = document.createElement('span');
        title.className = 'dashboard-widget-row-name';
        title.textContent = String(name || '');
        title.title = String(name || '');
        element.appendChild(title);

        if (detail) {
            const side = document.createElement('span');
            side.className = 'dashboard-widget-row-detail';
            side.textContent = String(detail);
            element.appendChild(side);
        }
        if (onOpen) element.addEventListener('click', onOpen);
        return element;
    }

    /** A short line where a figure would be, for waiting and for nothing-to-say. */
    function say(parent, className, text) {
        const line = document.createElement('p');
        line.className = className;
        line.textContent = String(text);
        parent.appendChild(line);
        return line;
    }

    const DAY_MS = 24 * 60 * 60 * 1000;

    /** Whole days between a timestamp and now; negative means still to come. */
    function daysSince(timestamp) {
        const value = Number(timestamp) || 0;
        if (!value) return null;
        return Math.floor((Date.now() - value) / DAY_MS);
    }

    /** A size in the unit a person would say it in. */
    function bytes(size) {
        const value = Number(size) || 0;
        if (value < 1024) return `${value} B`;
        const units = ['kB', 'MB', 'GB'];
        let scaled = value / 1024;
        let unit = 0;
        while (scaled >= 1024 && unit < units.length - 1) {
            scaled /= 1024;
            unit += 1;
        }
        return `${scaled < 10 ? scaled.toFixed(1) : Math.round(scaled)} ${units[unit]}`;
    }

    /** The hostname, for a detail column that would otherwise repeat the name. */
    function host(url) {
        try {
            return new URL(String(url)).hostname.replace(/^www\./, '');
        } catch (_error) {
            return '';
        }
    }

    /*
     * The bookmarks the dashboard has already loaded, or null while it has not.
     *
     * null and [] are different answers -- one means "ask again in a moment"
     * and the other means "there are none" -- and a tile that showed nought for
     * the first would be wrong for exactly as long as anyone was looking.
     */
    function bookmarksOf(dash) {
        const all = dash?.allBookmarks || dash?.bookmarks || null;
        return Array.isArray(all) ? all : null;
    }

    /** Whether a bookmark is on the page a widget was pointed at. 0 means all. */
    function onPage(bookmark, pageId) {
        return !pageId || Number(bookmark?.pageId) === Number(pageId);
    }

    /** A bookmark whose last check failed. Empty lastError is what reachable means. */
    function isBroken(bookmark) {
        return String(bookmark?.lastError || '').trim() !== '';
    }

    window.DashboardWidgetUtils = {
        appendOverflowRow, rowLimit, label, openHealthFiltered, openConfigTab, authFetch,
        panel, statGrid, meter, headline, footnote, rowList, row, say,
        daysSince, bytes, host, bookmarksOf, onPage, isBroken, DAY_MS,
    };
})();
