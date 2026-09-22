/**
 * The Unsorted widget: bookmarks kept from the inbox without a dashboard
 * category. Reads the same /api/unsorted endpoint the full view and the
 * Move to... popover use, so there is exactly one source of truth for "what
 * is in Unsorted" on the client.
 *
 * The order is a setting, because a pile of kept links is read three ways: the
 * newest first when you are catching up, one tag at a time when you are
 * looking for something, and at random when the point is to be reminded of
 * what you saved and forgot. The tile says which of the three it is showing --
 * a list of five links out of forty is otherwise the same picture whichever
 * rule chose them.
 */
(function () {
    'use strict';

    const SORTS = ['recent', 'random', 'tag'];

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    async function load(dash) {
        if (dash._widgetUnsorted) return dash._widgetUnsorted;
        try {
            const res = await fetch('/api/unsorted');
            if (!res.ok) return null;
            const data = await res.json();
            dash._widgetUnsorted = Array.isArray(data?.bookmarks) ? data.bookmarks : [];
            dash._unsortedPageId = data?.page?.id;
            return dash._widgetUnsorted;
        } catch (_error) {
            return null;
        }
    }

    function settings(widget) {
        const config = widget?.config || {};
        const sort = SORTS.includes(config.sort) ? config.sort : 'recent';
        // The tag arrives as the tags editor writes it -- a list -- while the
        // widget filters on one. Taking the first is what the editor's own
        // single-tag hint promises, rather than a second notion of "the tag".
        const tags = Array.isArray(config.tag) ? config.tag : (config.tag ? [config.tag] : []);
        const tag = String(tags[0] || '').trim();
        const rows = Math.min(Math.max(Number(config.rows) || 5, 1), 20);
        return { sort, tag, rows };
    }

    function tagsOf(bookmark) {
        return Array.isArray(bookmark?.tags) ? bookmark.tags.filter(Boolean) : [];
    }

    /*
     * The address under the name, short enough not to widen the column.
     *
     * The scheme and www. are noise on every row, and a long path pushes the
     * whole tile wider than the dashboard gave it. Cut in the middle rather
     * than at the end: the host says which site it is and the tail of a path
     * is usually the part that names the page, so an end-cut throws away the
     * half that was worth reading. CSS still clamps what is left, because a
     * narrow tile is narrower than any character count.
     */
    function shortUrl(url) {
        const raw = String(url || '');
        if (!raw) return '';
        let text = raw.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
        if (text.length > 44) text = `${text.slice(0, 28)}…${text.slice(-12)}`;
        return text;
    }

    /** A copy in a random order, Fisher-Yates, leaving the caller's list alone. */
    function shuffled(list) {
        const out = [...list];
        for (let i = out.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    }

    function byNewest(list) {
        return [...list].sort((a, b) => (Number(b?.createdAt) || 0) - (Number(a?.createdAt) || 0));
    }

    /*
     * Which rule is showing, in words, beside the shuffle for the one rule that
     * has anything to shuffle.
     *
     * Named rather than implied: "Most recent" and "Random" produce the same
     * shape of list, and a reader who cannot tell them apart cannot tell
     * whether the link missing from the tile is missing or merely not chosen.
     */
    function head(dash, { sort, tag }, onShuffle) {
        const line = document.createElement('div');
        line.className = 'dashboard-widget-kept-head';

        const name = document.createElement('span');
        name.className = 'dashboard-widget-kept-sort';
        if (sort === 'random') {
            name.textContent = label(dash, 'dashboard.widgetKeptSortRandom', 'Random');
        } else if (sort === 'tag' && tag) {
            name.textContent = label(dash, 'dashboard.widgetKeptSortOneTag', 'Tag: {tag}')
                .replace('{tag}', tag);
        } else if (sort === 'tag') {
            name.textContent = label(dash, 'dashboard.widgetKeptSortByTag', 'By tag');
        } else {
            name.textContent = label(dash, 'dashboard.widgetKeptSortRecent', 'Most recent');
        }
        line.appendChild(name);

        if (onShuffle) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'dashboard-widget-kept-shuffle';
            button.textContent = '↻';
            button.setAttribute('aria-label', label(dash, 'dashboard.widgetKeptShuffle', 'Shuffle'));
            button.title = label(dash, 'dashboard.widgetKeptShuffle', 'Shuffle');
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                onShuffle();
            });
            line.appendChild(button);
        }
        return line;
    }

    /** One row: the name, the address under it, and Kept behind the click. */
    function keptRow(dash, bookmark) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'dashboard-widget-row dashboard-widget-row--kept';

        const text = document.createElement('span');
        text.className = 'dashboard-widget-row-text';

        const name = document.createElement('span');
        name.className = 'dashboard-widget-row-name';
        name.textContent = String(bookmark?.name || bookmark?.url || '');
        name.title = String(bookmark?.name || bookmark?.url || '');
        text.appendChild(name);

        const url = shortUrl(bookmark?.url);
        if (url) {
            const under = document.createElement('span');
            under.className = 'dashboard-widget-row-url';
            under.textContent = url;
            under.title = String(bookmark?.url || '');
            text.appendChild(under);
        }
        row.appendChild(text);

        window.DashboardWidgetUtils?.bindRowAction(row, dash, {
            labelKey: 'widgetActionOpenUnsorted',
            labelFallback: 'Open Kept',
            run: () => { void dash.inbox?.openInboxView?.({ tab: 'kept' }); },
        });
        return row;
    }

    /*
     * The rows, grouped under their tags.
     *
     * A heading takes the whole width rather than a column of its own: two
     * columns of groups would have to be balanced by height, and a heading that
     * ends up at the foot of the left column with its rows at the head of the
     * right one is worse than no grouping at all. Untagged keeps a group
     * instead of being dropped -- it is the pile this widget exists for.
     */
    function grouped(dash, list) {
        const groups = new Map();
        list.forEach((bookmark) => {
            const own = tagsOf(bookmark);
            if (!own.length) {
                const key = '';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(bookmark);
                return;
            }
            own.forEach((tag) => {
                if (!groups.has(tag)) groups.set(tag, []);
                groups.get(tag).push(bookmark);
            });
        });

        const named = [...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
        // Untagged last: it is the leftovers, and leading with it would put the
        // least informative heading at the top of every tile.
        if (groups.has('')) named.push('');
        return named.map((tag) => [tag, groups.get(tag)]);
    }

    function render(body, widget, dash) {
        const bookmarks = dash._widgetUnsorted || [];
        const options = settings(widget);
        const utils = window.DashboardWidgetUtils;
        const wrap = utils?.panel ? utils.panel(body) : (body.replaceChildren(), body);

        const repaint = () => render(body, widget, dash);
        const filtered = options.sort === 'tag' && options.tag
            ? bookmarks.filter((bookmark) => tagsOf(bookmark).some(
                (tag) => tag.toLowerCase() === options.tag.toLowerCase()))
            : bookmarks;

        wrap.appendChild(head(dash, options, options.sort === 'random' ? repaint : null));

        if (!filtered.length) {
            const empty = document.createElement('p');
            empty.className = 'dashboard-widget-empty';
            empty.textContent = options.sort === 'tag' && options.tag
                ? label(dash, 'dashboard.widgetKeptNoneTagged', 'Nothing kept with that tag.')
                : label(dash, 'dashboard.widgetUnsortedEmpty', 'Nothing kept yet.');
            wrap.appendChild(empty);
            return;
        }

        const openKept = () => { void dash.inbox?.openInboxView?.({ tab: 'kept' }); };
        const list = utils?.rowList ? utils.rowList() : document.createElement('div');
        if (!utils?.rowList) list.className = 'dashboard-widget-rows dashboard-widget-rows--pairs';
        list.classList.add('dashboard-widget-rows--kept');

        if (options.sort === 'tag' && !options.tag) {
            /*
             * The limit counts links and not headings: a tile set to five rows
             * that spent three of them on tag names would be showing two links,
             * which is not what the number asked for.
             */
            let left = options.rows;
            let shown = 0;
            grouped(dash, byNewest(bookmarks)).forEach(([tag, rows]) => {
                if (left <= 0) return;
                const heading = document.createElement('p');
                heading.className = 'dashboard-widget-kept-group';
                heading.textContent = tag || label(dash, 'dashboard.widgetKeptNoTag', 'no tag');
                list.appendChild(heading);
                rows.slice(0, left).forEach((bookmark) => {
                    list.appendChild(keptRow(dash, bookmark));
                    shown += 1;
                });
                left -= Math.min(rows.length, left);
            });
            /*
             * Counted against the links themselves, not against the rows drawn:
             * a bookmark with two tags appears under both, and saying "3 more"
             * when there are none left would send the reader looking for links
             * that are already on the tile.
             */
            utils?.appendOverflowRow(list, dash, bookmarks.length - shown, openKept);
            wrap.appendChild(list);
            return;
        }

        const ordered = options.sort === 'random' ? shuffled(filtered) : byNewest(filtered);
        ordered.slice(0, options.rows).forEach((bookmark) => {
            list.appendChild(keptRow(dash, bookmark));
        });
        utils?.appendOverflowRow(list, dash, ordered.length - options.rows, openKept);
        wrap.appendChild(list);
    }

    async function renderUnsorted(body, widget, dash) {
        const bookmarks = await load(dash);
        if (!bookmarks) {
            body.replaceChildren();
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            waiting.textContent = label(dash, 'dashboard.widgetUnsortedWaiting', 'Loading…');
            body.appendChild(waiting);
            return;
        }
        render(body, widget, dash);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.unsorted = renderUnsorted;
})();
