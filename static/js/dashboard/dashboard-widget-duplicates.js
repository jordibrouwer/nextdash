/**
 * The duplicates widget: the same address, stored more than once.
 *
 * The server already works this out for the health view — canonicalising each
 * URL and grouping what collides — so this reads that answer rather than
 * counting again. Two tallies of the same thing that disagree is worse than one
 * tally, and the tile on the dashboard is the one that would be believed.
 *
 * Counted by group and by copies, because those are different sizes of the same
 * problem: four groups of two is a tidy-up, one group of nine is an import that
 * ran twice.
 */
(function () {
    'use strict';

    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    async function load(dash) {
        if (dash._widgetDuplicates) return dash._widgetDuplicates;
        try {
            const res = await fetch('/api/duplicates');
            if (!res.ok) return null;
            const data = await res.json();
            dash._widgetDuplicates = Array.isArray(data?.duplicateUrls) ? data.duplicateUrls : [];
            return dash._widgetDuplicates;
        } catch (_error) {
            return null;
        }
    }

    /**
     * An address as a person recognises it.
     *
     * The scheme is noise here — every row has one and none of them is the
     * reason the row is on the list — and a bare hostname would make ten
     * different pages on one site read as ten identical rows.
     */
    function prettyURL(url) {
        const raw = String(url || '');
        try {
            const parsed = new URL(raw);
            const path = parsed.pathname === '/' ? '' : parsed.pathname;
            return `${parsed.hostname.replace(/^www\./, '')}${path}${parsed.search}`;
        } catch (_error) {
            return raw.replace(/^https?:\/\//, '');
        }
    }

    function draw(body, widget, dash, groups) {
        const u = U();
        const panel = u.panel(body);
        const config = widget?.config || {};
        const minCount = Math.min(Math.max(Number(config.minCount) || 2, 2), 20);
        const maxRows = u.rowLimit(widget, 5);
        const open = () => u.openHealthFiltered(dash, 'duplicate');

        const found = groups
            .map((group) => ({
                url: String(group?.url || ''),
                refs: Array.isArray(group?.bookmarks) ? group.bookmarks : [],
            }))
            .filter((group) => group.refs.length >= minCount)
            .sort((a, b) => b.refs.length - a.refs.length);

        if (!found.length) {
            u.say(panel, 'dashboard-widget-empty', minCount > 2
                ? label(dash, 'dashboard.widgetDuplicatesNoneAt',
                    'No address is stored {n} times or more.').replace('{n}', String(minCount))
                : label(dash, 'dashboard.widgetDuplicatesNone', 'No address is stored twice.'));
            return;
        }

        // What could go, rather than what is there: one of each group is the
        // copy you are keeping, and it is not part of the problem.
        const spare = found.reduce((total, group) => total + group.refs.length - 1, 0);
        const pages = new Set();
        found.forEach((group) => group.refs.forEach((ref) => pages.add(Number(ref?.pageId) || 0)));

        panel.appendChild(u.headline(found.length,
            found.length === 1
                ? label(dash, 'dashboard.widgetDuplicatesOne', 'address stored more than once')
                : label(dash, 'dashboard.widgetDuplicatesMany', 'addresses stored more than once')));

        panel.appendChild(u.statGrid([
            {
                value: spare,
                label: label(dash, 'dashboard.widgetDuplicatesSpare', 'could go'),
                tone: 'warn',
                title: label(dash, 'dashboard.widgetDuplicatesSpareAbout',
                    'Copies beyond the first in each group.'),
                onOpen: open,
            },
            {
                value: pages.size,
                label: label(dash, 'dashboard.widgetDuplicatesPages', 'pages'),
                title: label(dash, 'dashboard.widgetDuplicatesPagesAbout',
                    'How many pages the copies are spread across.'),
            },
            {
                value: found[0].refs.length,
                label: label(dash, 'dashboard.widgetDuplicatesWorst', 'worst group'),
                tone: found[0].refs.length > 2 ? 'warn' : null,
            },
        ], { dash, labelKey: 'widgetActionOpenHealth', labelFallback: 'Open Health' }));

        const list = u.rowList();
        found.slice(0, maxRows).forEach((group) => {
            list.appendChild(u.row(
                prettyURL(group.url),
                `×${group.refs.length}`,
                'warn',
                open,
                { dash, labelKey: 'widgetActionOpenHealth', labelFallback: 'Open Health' }));
        });
        u.appendOverflowRow(list, dash, found.length - maxRows, open);
        panel.appendChild(list);
    }

    async function render(body, widget, dash) {
        const u = U();
        body.replaceChildren();
        u.say(body, 'dashboard-widget-waiting',
            label(dash, 'dashboard.widgetDuplicatesWaiting', 'Loading…'));

        const groups = await load(dash);
        if (!groups) {
            body.replaceChildren();
            u.say(body, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetDuplicatesUnreachable', 'Could not check for duplicates.'));
            return;
        }
        draw(body, widget, dash, groups);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.duplicates = render;
})();
