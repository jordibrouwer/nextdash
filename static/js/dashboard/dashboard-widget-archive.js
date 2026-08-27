/**
 * The archive widget: how much of the collection outlives the pages it points at.
 *
 * This release learned to keep a copy of a page and never said how many pages
 * have one. The figure that matters is not the count of copies, though — it is
 * the links that are already broken and have nothing to fall back on. Those are
 * the ones where the page is not merely unreachable but gone, and where the
 * only remaining move was to have made a copy earlier.
 *
 * Nothing here fetches. archiveSnapshotUrl, archiveDiedAt and lastError are
 * fields on the bookmark itself, so this counts what the dashboard already
 * loaded rather than asking a second time for numbers it is holding.
 */
(function () {
    'use strict';

    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    function hasCopy(bookmark) {
        return String(bookmark?.archiveSnapshotUrl || '').trim() !== '';
    }

    function render(body, widget, dash) {
        const u = U();
        const all = u.bookmarksOf(dash);
        if (!all) {
            body.replaceChildren();
            u.say(body, 'dashboard-widget-waiting',
                label(dash, 'dashboard.widgetArchiveWaiting', 'Loading…'));
            return;
        }

        const config = widget?.config || {};
        const pageId = Number(config.pageId) || 0;
        const brokenOnly = config.brokenOnly === true;
        const maxRows = u.rowLimit(widget, 5);

        const scope = all.filter((bookmark) => u.onPage(bookmark, pageId));
        /*
         * What the coverage is a coverage *of*.
         *
         * Off, the question is "how much of my collection is preserved"; on, it
         * is "of the links that already died, how many did I keep" — a far
         * harsher and far more interesting number, and one that reads as
         * catastrophic on the first tile if it were the default.
         */
        const subject = brokenOnly ? scope.filter(u.isBroken) : scope;
        // Every figure below is of the subject, not of the page: with brokenOnly
        // on, a tile that counted its rows over the whole page and its headline
        // over the broken ones would be two tiles wearing one heading.
        const kept = subject.filter(hasCopy).length;
        const atRisk = subject.filter((bookmark) => u.isBroken(bookmark) && !hasCopy(bookmark));
        const died = subject.filter((bookmark) => Number(bookmark?.archiveDiedAt) > 0).length;

        const panel = u.panel(body);

        if (!subject.length) {
            u.say(panel, 'dashboard-widget-empty', brokenOnly
                ? label(dash, 'dashboard.widgetArchiveNoneBroken', 'Nothing is broken here.')
                : label(dash, 'dashboard.widgetArchiveNoBookmarks', 'No bookmarks on this page.'));
            return;
        }

        panel.appendChild(u.headline(
            `${kept} / ${subject.length}`,
            brokenOnly
                ? label(dash, 'dashboard.widgetArchiveKeptOfBroken', 'broken links with a copy kept')
                : label(dash, 'dashboard.widgetArchiveKeptOfAll', 'bookmarks with a copy kept')));

        /*
         * The bar is coloured by how bad the gap is, not by how full it is.
         *
         * A collection with a tenth of its pages preserved is not "10% good",
         * it is a collection one outage away from losing the rest — and the
         * threshold where that stops being true is somewhere around half.
         */
        const share = kept / subject.length;
        panel.appendChild(u.meter(kept, subject.length,
            share >= 0.75 ? 'good' : share >= 0.4 ? 'warn' : 'bad'));

        panel.appendChild(u.statGrid([
            {
                value: kept,
                label: label(dash, 'dashboard.widgetArchiveKept', 'kept'),
                tone: 'good',
            },
            {
                // The number this tile exists for: broken, and nothing to fall
                // back on.
                value: atRisk.length,
                label: label(dash, 'dashboard.widgetArchiveAtRisk', 'lost'),
                tone: atRisk.length ? 'bad' : 'good',
                title: label(dash, 'dashboard.widgetArchiveAtRiskAbout',
                    'Broken, and no copy was ever kept.'),
                onOpen: () => u.openHealthFiltered(dash, 'broken'),
            },
            {
                value: died,
                label: label(dash, 'dashboard.widgetArchiveDied', 'died'),
                tone: died ? 'warn' : null,
                title: label(dash, 'dashboard.widgetArchiveDiedAbout',
                    'The date the web index last saw the page.'),
            },
            {
                value: subject.length - kept,
                label: label(dash, 'dashboard.widgetArchiveNoCopy', 'no copy'),
                tone: null,
            },
        ]));

        /*
         * One list, not two: everything the figures counted, without a copy,
         * worst first.
         *
         * Broken-and-uncopied heads it because that is the finding; the rest
         * follow because they are the same list one outage earlier, and
         * splitting them into two headings would make the tile argue with
         * itself about which one the reader should act on.
         */
        const missing = subject.filter((bookmark) => !hasCopy(bookmark));
        if (!missing.length) {
            panel.appendChild(u.footnote(label(dash, 'dashboard.widgetArchiveAllKept',
                'Every bookmark here has a copy.'), 'good'));
            return;
        }

        const ranked = [...missing].sort((a, b) => {
            const brokenA = u.isBroken(a) ? 0 : 1;
            const brokenB = u.isBroken(b) ? 0 : 1;
            if (brokenA !== brokenB) return brokenA - brokenB;
            // Among the broken, longest broken first — that is the one whose
            // page is least likely to still be out there to capture.
            return (Number(a?.brokenSince) || Number(a?.createdAt) || 0)
                - (Number(b?.brokenSince) || Number(b?.createdAt) || 0);
        });

        const list = u.rowList();
        ranked.slice(0, maxRows).forEach((bookmark) => {
            const broken = u.isBroken(bookmark);
            const days = u.daysSince(bookmark?.brokenSince);
            const detail = broken
                ? (days && days > 0
                    ? label(dash, 'dashboard.widgetArchiveBrokenDays', 'broken {n}d')
                        .replace('{n}', String(days))
                    : label(dash, 'dashboard.widgetArchiveBroken', 'broken'))
                : u.host(bookmark?.url);
            list.appendChild(u.row(
                bookmark?.name || bookmark?.url || '',
                detail,
                broken ? 'bad' : null,
                () => u.openHealthFiltered(dash, broken ? 'broken' : 'all')));
        });
        u.appendOverflowRow(list, dash, ranked.length - maxRows,
            () => u.openHealthFiltered(dash, 'broken'));
        panel.appendChild(list);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.archive = render;
})();
