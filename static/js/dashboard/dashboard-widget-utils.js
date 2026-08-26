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

    window.DashboardWidgetUtils = { appendOverflowRow, rowLimit, label, openHealthFiltered };
})();
