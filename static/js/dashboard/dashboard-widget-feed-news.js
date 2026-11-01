/**
 * The Watch feeds news widget: the sites whose watched feeds have unread items.
 *
 * It fetches no feed of its own. The dashboard already holds the watch list
 * (dash.feedWatch) for the row badges and the paper, so this reads that and
 * repaints when it changes; the server's poll is the only clock. Only the
 * headlines layout asks for more, the unread items themselves, because the
 * watch list carries one headline per site and no pictures.
 *
 * Three layouts, one setting: a row per site (the default), the newest
 * headlines with their pictures, or a chip per site. Every way in leads to
 * the paper -- on one site, or all of them -- except a headline, which is the
 * article itself.
 */
(function () {
    'use strict';

    const LAYOUTS = ['list', 'headlines', 'chips'];
    const HEADLINES = 6;

    // Watch lists that have answered once: before that, an empty list means
    // "not asked yet", not "nothing watched".
    const ready = new WeakSet();
    // The unread items for the headlines layout, kept until the counts change.
    const headlines = { sig: '', items: null, asking: '' };
    // Items opened from this tile. The server is told, but a fetch that crossed
    // that write would otherwise put the headline straight back.
    const readHere = new Set();

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    function repaintAll(dash) {
        dash?.renderCore?.refreshWidgets?.('feed-news');
    }

    function ago(dash, timestamp) {
        const at = Number(timestamp) || 0;
        if (!at) return '';
        const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
        if (minutes < 1) return label(dash, 'dashboard.previewAgoNow', 'just now');
        if (minutes < 60) return label(dash, 'dashboard.previewAgoMinutes', '{count} min ago').replace('{count}', String(minutes));
        const hours = Math.round(minutes / 60);
        if (hours < 24) return label(dash, 'dashboard.previewAgoHours', '{count} h ago').replace('{count}', String(hours));
        return label(dash, 'dashboard.previewAgoDays', '{count} d ago').replace('{count}', String(Math.round(hours / 24)));
    }

    function bookmarkFor(dash, watch, key) {
        const list = dash.allBookmarks || dash.bookmarks || [];
        return list.find((bookmark) => watch.key(bookmark?.url) === key) || null;
    }

    function siteName(bookmark, key) {
        if (bookmark?.name) return String(bookmark.name);
        try { return new URL(key).hostname; } catch { return String(key || ''); }
    }

    /*
     * The sites with unread news, the newest news first.
     *
     * Ordered by when the news arrived, as the paper orders its sections, so
     * the first row here is the first section there.
     */
    function sitesWithNews(dash, watch) {
        const sites = [];
        watch.byKey.forEach((entry, key) => {
            const count = Number(entry?.newCount) || 0;
            if (count <= 0) return;
            const bookmark = bookmarkFor(dash, watch, key);
            sites.push({
                key,
                bookmark,
                name: siteName(bookmark, key),
                count,
                muted: entry.muted === true,
                newAt: Number(entry.newAt) || 0,
                newest: entry.newest || null,
            });
        });
        const stamp = (site) => Number(site.newest?.publishedAt) || Number(site.newest?.foundAt) || 0;
        return sites.sort((a, b) => (b.newAt - a.newAt) || (stamp(b) - stamp(a)));
    }

    /** The bookmark's icon, or its first letter: what its row on the dashboard shows. */
    function siteIcon(bookmark, name) {
        const slot = document.createElement('span');
        slot.className = 'feed-news-widget-icon';
        slot.setAttribute('aria-hidden', 'true');
        const letter = () => {
            const span = document.createElement('span');
            span.className = 'feed-news-widget-letter';
            span.textContent = (String(name).charAt(0) || '?').toUpperCase();
            return span;
        };
        const raw = String(bookmark?.icon || '').trim();
        if (raw) {
            // A bare filename lives under /data/icons/, as on the rows.
            const img = document.createElement('img');
            img.src = /^(https?:|data:|\/)/i.test(raw) ? raw : `/data/icons/${encodeURIComponent(raw)}`;
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.addEventListener('error', () => img.replaceWith(letter()));
            slot.appendChild(img);
            return slot;
        }
        const fallback = letter();
        slot.appendChild(fallback);
        if (bookmark?.url && window.IconSetAuto && bookmark.iconMode !== 'letter') {
            fallback.setAttribute('data-icon-auto-url', bookmark.url);
            window.IconSetAuto.queue(fallback);
        }
        return slot;
    }

    function openPaper(focusKey) {
        void window.FeedWatchNews?.open(focusKey ? { focusKey, source: 'button' } : { source: 'button' });
    }

    function countPill(count, muted) {
        const pill = document.createElement('span');
        pill.className = 'feed-news-widget-pill';
        if (muted) pill.classList.add('is-muted');
        pill.textContent = String(count);
        return pill;
    }

    /** "News" and the unread total, with whatever the layout adds on the right. */
    function header(dash, total, extra) {
        const head = document.createElement('div');
        head.className = 'feed-news-widget-head';
        const title = document.createElement('span');
        title.className = 'feed-news-widget-title';
        title.textContent = label(dash, 'dashboard.widgetFeedNewsHeading', 'News');
        const count = document.createElement('span');
        count.className = 'feed-news-widget-total';
        count.textContent = label(dash, 'dashboard.widgetFeedNewsCount', '{n} new').replace('{n}', String(total));
        head.append(title, count);
        if (extra) head.appendChild(extra);
        return head;
    }

    // A · a row per site.
    function drawList(dash, wrap, sites) {
        const list = document.createElement('div');
        list.className = 'dashboard-widget-rows feed-news-widget-rows';
        sites.forEach((site) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'dashboard-widget-row feed-news-widget-row';
            if (site.muted) row.classList.add('is-muted');
            row.dataset.feedNewsSite = site.key;

            const text = document.createElement('span');
            text.className = 'feed-news-widget-text';
            const name = document.createElement('span');
            name.className = 'feed-news-widget-name';
            name.textContent = site.name;
            text.appendChild(name);
            const title = String(site.newest?.title || '');
            if (title) {
                const line = document.createElement('span');
                line.className = 'feed-news-widget-headline';
                line.textContent = title;
                text.appendChild(line);
            }
            row.title = title ? `${site.name} — ${title}` : site.name;
            row.append(siteIcon(site.bookmark, site.name), text, countPill(site.count, site.muted));
            window.DashboardWidgetUtils?.bindRowAction(row, dash, {
                labelKey: 'widgetFeedNewsOpenSite',
                labelFallback: 'Read this site’s news',
                run: () => openPaper(site.key),
            });
            list.appendChild(row);
        });
        wrap.appendChild(list);
    }

    /** What the counts are now, so the headlines are asked for again only when they move. */
    function signature(sites) {
        return JSON.stringify(sites.map((site) => [site.key, site.count, site.newAt]));
    }

    // B · the newest headlines across the sites, with a picture each.
    function drawHeadlines(dash, watch, wrap, sites) {
        const sig = signature(sites);
        if (headlines.sig !== sig && headlines.asking !== sig) {
            headlines.asking = sig;
            void watch.news().then(({ items }) => {
                if (headlines.asking !== sig) return;
                headlines.sig = sig;
                headlines.items = items;
                repaintAll(dash);
            });
        }
        // The previous answer stays on screen while the next one is on its way.
        if (!headlines.items) {
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            waiting.textContent = label(dash, 'dashboard.widgetFeedNewsWaiting', 'Loading…');
            wrap.appendChild(waiting);
            return;
        }
        const stamp = (item) => Number(item.publishedAt) || Number(item.foundAt) || 0;
        const unread = headlines.items
            .filter((item) => item.unread !== false && !readHere.has(`${item.bookmarkKey}|${item.id}`)
                && sites.some((site) => site.key === item.bookmarkKey))
            .sort((a, b) => ((Number(b.foundAt) || 0) - (Number(a.foundAt) || 0)) || (stamp(b) - stamp(a)))
            .slice(0, HEADLINES);

        const list = document.createElement('div');
        list.className = 'dashboard-widget-rows feed-news-widget-rows';
        unread.forEach((item) => {
            const site = sites.find((entry) => entry.key === item.bookmarkKey);
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'dashboard-widget-row feed-news-widget-item';
            row.dataset.feedNewsItem = String(item.id);

            let picture;
            if (item.image) {
                picture = document.createElement('span');
                picture.className = 'feed-news-widget-icon feed-news-widget-picture';
                picture.setAttribute('aria-hidden', 'true');
                const img = document.createElement('img');
                img.src = String(item.image);
                img.alt = '';
                img.loading = 'lazy';
                img.decoding = 'async';
                img.addEventListener('error', () => picture.replaceWith(siteIcon(site?.bookmark, site?.name || '')));
                picture.appendChild(img);
            } else {
                picture = siteIcon(site?.bookmark, site?.name || '');
                picture.classList.add('feed-news-widget-picture');
            }

            const text = document.createElement('span');
            text.className = 'feed-news-widget-text';
            const title = document.createElement('span');
            title.className = 'feed-news-widget-item-title';
            title.textContent = String(item.title || '');
            const meta = document.createElement('span');
            meta.className = 'feed-news-widget-meta';
            meta.textContent = [site?.name || item.bookmarkName, ago(dash, stamp(item))].filter(Boolean).join(' · ');
            text.append(title, meta);
            row.title = String(item.title || '');
            row.append(picture, text);

            window.DashboardWidgetUtils?.bindRowAction(row, dash, {
                labelKey: 'widgetFeedNewsOpenArticle',
                labelFallback: 'Open the article',
                href: item.link || '',
                run: () => {
                    if (!item.link) {
                        void window.FeedWatchNews?.open({ focusKey: item.bookmarkKey, focusItemId: item.id, source: 'button' });
                        return;
                    }
                    window.openUrl(item.link, dash.settings);
                    readHere.add(`${item.bookmarkKey}|${item.id}`);
                    void watch.markItems(item.bookmarkUrl, item.feedUrl, [item.id], true);
                },
            });
            list.appendChild(row);
        });
        wrap.appendChild(list);
    }

    // C · a chip per site, and the one newest headline under them.
    function drawChips(dash, wrap, sites) {
        const chips = document.createElement('div');
        chips.className = 'feed-news-widget-chips';
        sites.forEach((site) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'feed-news-widget-chip';
            if (site.muted) chip.classList.add('is-muted');
            chip.dataset.feedNewsSite = site.key;
            const name = document.createElement('span');
            name.className = 'feed-news-widget-chip-name';
            name.textContent = site.name;
            const count = document.createElement('span');
            count.className = 'feed-news-widget-chip-count';
            count.textContent = String(site.count);
            chip.append(name, count);
            window.DashboardWidgetUtils?.bindRowAction(chip, dash, {
                labelKey: 'widgetFeedNewsOpenSite',
                labelFallback: 'Read this site’s news',
                run: () => openPaper(site.key),
            });
            chips.appendChild(chip);
        });
        wrap.appendChild(chips);

        const first = sites.find((site) => site.newest?.title);
        if (first) {
            const latest = document.createElement('p');
            latest.className = 'feed-news-widget-latest';
            const title = document.createElement('span');
            title.className = 'feed-news-widget-latest-title';
            title.textContent = String(first.newest.title);
            const from = document.createElement('span');
            from.className = 'feed-news-widget-meta';
            from.textContent = first.name;
            latest.append(title, from);
            wrap.appendChild(latest);
        }
    }

    function render(body, widget, dash) {
        const utils = window.DashboardWidgetUtils;
        const wrap = utils?.panel ? utils.panel(body) : (body.replaceChildren(), body);
        const watch = dash?.feedWatch;
        const layout = LAYOUTS.includes(widget?.config?.layout) ? widget.config.layout : 'list';
        wrap.classList.add('feed-news-widget', `feed-news-widget--${layout}`);

        if (watch && !ready.has(watch)) {
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            waiting.textContent = label(dash, 'dashboard.widgetFeedNewsWaiting', 'Loading…');
            wrap.appendChild(waiting);
            void watch.load().then(() => {
                ready.add(watch);
                repaintAll(dash);
            });
            return;
        }

        const watching = watch ? [...watch.byKey.values()].some((entry) => (entry?.feeds?.length || 0) > 0) : false;
        if (!watching) {
            const none = document.createElement('p');
            none.className = 'dashboard-widget-empty';
            none.textContent = label(dash, 'dashboard.widgetFeedNewsNoFeeds',
                'You do not watch any feed yet. Right-click a bookmark and choose Watch this feed…');
            wrap.appendChild(none);
            return;
        }

        const sites = sitesWithNews(dash, watch);
        if (!sites.length) {
            const empty = document.createElement('div');
            empty.className = 'feed-news-widget-empty';
            const line = document.createElement('p');
            line.className = 'dashboard-widget-empty';
            line.textContent = label(dash, 'dashboard.widgetFeedNewsNone', 'Nothing new from the feeds you watch');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'feed-news-widget-action';
            button.textContent = label(dash, 'dashboard.widgetFeedNewsOpenPaper', 'Open the paper');
            button.addEventListener('click', () => openPaper(''));
            empty.append(line, button);
            wrap.appendChild(empty);
            return;
        }

        let readAll = null;
        if (layout === 'headlines') {
            readAll = document.createElement('button');
            readAll.type = 'button';
            readAll.className = 'feed-news-widget-action feed-news-widget-readall';
            readAll.textContent = label(dash, 'dashboard.widgetFeedNewsReadAll', 'Read all');
            readAll.addEventListener('click', () => openPaper(''));
        }
        wrap.appendChild(header(dash, watch.unreadTotal(), readAll));

        if (layout === 'headlines') drawHeadlines(dash, watch, wrap, sites);
        else if (layout === 'chips') drawChips(dash, wrap, sites);
        else drawList(dash, wrap, sites);
    }

    // The watch list changed: a poll, a read, a mute. No clock of its own.
    document.addEventListener('feedwatch:changed', () => repaintAll(window.dashboardInstance));

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets['feed-news'] = render;
})();
