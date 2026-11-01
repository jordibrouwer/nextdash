/**
 * The news window: what watched feeds published, as one paper.
 *
 * A panel in the app's own modal, not a page of its own. It opens on a front
 * page with a section per site, the site with the newest unread item first;
 * opened for one bookmark (the hover card) it is the same paper with only that
 * site's section. Each item carries a dot while it is unread and a toggle to
 * mark it read or unread; a site and the whole paper can be marked read at once.
 * An article opens from the front page with arrows beneath it, and opening one
 * marks that item read, nothing else.
 *
 * Buttons in the header switch how an article is laid out: one column, two
 * columns (the article large, the others beside it) or a newspaper; the choice
 * is the feedWatchNewsView setting, which Config offers too. A thin bar under
 * the header runs down with the time the news stays open; when it runs out the
 * panel closes itself. That is only so for news the window opened. Opened by
 * hand (the News button, or a push after the window ran out) the panel stays
 * until it is closed and has no bar.
 *
 * The summary arrives as HTML the server has already reduced to a handful of
 * tags, which is the only reason it is inserted as markup. Titles and names
 * always go through the escaper.
 */
(function (global) {
    'use strict';

    const VIEWS = ['single', 'wide', 'paper'];
    const WIDE_QUERY = '(min-width: 721px)';
    // When the paper was last opened by hand, so coming back to the tab does
    // not open it again for news already read in this window.
    const BY_HAND_KEY = 'nextdash.feedWatchPaperByHand';

    let state = null;   // { fresh, earlier, order, focusKey, index, mode, timer, timed }

    function dash() { return global.dashboardInstance; }

    function t(key, fallback, vars) {
        let text = fallback;
        const lang = dash()?.language;
        if (lang?.t) {
            const value = lang.t(key);
            if (value && value !== key) text = value;
        }
        if (vars) {
            Object.keys(vars).forEach((name) => {
                text = text.replace(`{${name}}`, () => String(vars[name]));
            });
        }
        return text;
    }

    const esc = (value) => global.NextDashHtml.escapeHtml(String(value ?? ''));

    function canBeWide() {
        return global.matchMedia ? global.matchMedia(WIDE_QUERY).matches : true;
    }

    /**
     * How an article is laid out: one column, two columns in the app's style, or
     * a newspaper front page. The reader's choice (Config, or the buttons in the
     * header); a narrow screen only has the one column.
     */
    function currentView() {
        const chosen = dash()?.settings?.feedWatchNewsView;
        // The paper is the default and stays so on a narrow screen too: its
        // columns fold into one, the look does not change.
        return VIEWS.includes(chosen) ? chosen : 'paper';
    }

    const VIEW_ICONS = {
        single: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="4" y="2" width="8" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
        wide: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="2" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9.5 2v12" stroke="currentColor" stroke-width="1.4"/></svg>',
        paper: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 3.5h12M2 6.5h7M2 9.5h7M2 12.5h7M11 6.5h3M11 9.5h3M11 12.5h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    };

    function viewLabel(view) {
        if (view === 'wide') return t('dashboard.feedWatchViewWide', 'Two columns');
        if (view === 'paper') return t('dashboard.feedWatchViewPaper', 'Newspaper');
        return t('dashboard.feedWatchViewSingle', 'One column');
    }

    function chooseView(view) {
        const d = dash();
        if (!d || !VIEWS.includes(view)) return;
        d.settings.feedWatchNewsView = view;
        void d.saveSettings?.({ keys: ['feedWatchNewsView'] });
        render();
    }

    function ago(timestamp) {
        const at = Number(timestamp) || 0;
        if (!at) return '';
        const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
        if (minutes < 1) return t('dashboard.previewAgoNow', 'just now');
        if (minutes < 60) return t('dashboard.previewAgoMinutes', '{count} min ago', { count: minutes });
        const hours = Math.round(minutes / 60);
        if (hours < 24) return t('dashboard.previewAgoHours', '{count} h ago', { count: hours });
        return t('dashboard.previewAgoDays', '{count} d ago', { count: Math.round(hours / 24) });
    }

    function plainLead(html, max = 150) {
        const probe = document.createElement('div');
        probe.innerHTML = String(html || '');
        const text = (probe.textContent || '').replace(/\s+/g, ' ').trim();
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    }

    function minutesLeft() {
        const watch = dash()?.feedWatch;
        return Math.max(1, Math.ceil((watch?.windowRemainingMs?.() || 0) / 60000));
    }

    /** Earlier entries have no read state; a stored item is unread unless the server says otherwise. */
    const isUnread = (item) => !item.earlier && item.unread !== false;

    function siteKeyOf(item) {
        return item.bookmarkKey || item.key || dash()?.feedWatch?.key(item.bookmarkUrl) || '';
    }

    function bookmarkOf(item) {
        const d = dash();
        const key = siteKeyOf(item);
        return (d?.allBookmarks || []).find((b) => d.feedWatch.key(b.url) === key) || null;
    }

    function siteNameOf(item) {
        if (item.bookmarkName) return item.bookmarkName;
        const bookmark = bookmarkOf(item);
        if (bookmark?.name) return bookmark.name;
        try { return new URL(item.bookmarkUrl).hostname; } catch { return item.feedTitle || ''; }
    }

    /** Newer first: when it was found, then when it was published, as the server sorts. */
    function newerFirst(a, b) {
        return ((Number(b.foundAt) || 0) - (Number(a.foundAt) || 0))
            || ((Number(b.publishedAt) || 0) - (Number(a.publishedAt) || 0));
    }

    /**
     * The order of the sections, fixed when the paper opens: sites with unread
     * news first, by their newest unread item, then the rest by their newest
     * item. Fixed so marking things read does not move a section from under the
     * pointer.
     */
    function sectionOrder(fresh) {
        const newest = new Map();
        fresh.slice().sort(newerFirst).forEach((item) => {
            const key = siteKeyOf(item);
            const seen = newest.get(key);
            if (!seen) newest.set(key, { unread: isUnread(item) ? item : null, any: item });
            else if (!seen.unread && isUnread(item)) seen.unread = item;
        });
        return [...newest.entries()]
            .sort(([, a], [, b]) => {
                if (!!a.unread !== !!b.unread) return a.unread ? -1 : 1;
                return newerFirst(a.unread || a.any, b.unread || b.any);
            })
            .map(([key]) => key);
    }

    function sections() {
        if (!state) return [];
        const byKey = new Map(state.order.map((key) => [key, []]));
        state.fresh.forEach((item) => {
            const key = siteKeyOf(item);
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key).push(item);
        });
        return [...byKey.entries()].filter(([, items]) => items.length).map(([key, items]) => {
            const sorted = items.slice().sort(newerFirst);
            return { key, name: siteNameOf(sorted[0]), url: sorted[0].bookmarkUrl, items: sorted, unread: sorted.filter(isUnread).length };
        });
    }

    /**
     * What is listed, in the order of the paper: each site's items, then the
     * feeds' earlier entries. The arrows walk this list.
     */
    function listed() {
        if (!state) return [];
        const fresh = sections().flatMap((section) => section.items);
        // One column is one article at a time: the new ones, no front page and
        // no earlier entries.
        if (currentView() !== 'single') return [...fresh, ...state.earlier];
        // Walking one by one, the unread come first and every site is mixed in
        // by time, so no single site fills the first screens.
        // The order is fixed when the news opens: reading an item must not move it.
        return fresh.slice().sort((a, b) => (Number(b.openUnread) - Number(a.openUnread)) || newerFirst(a, b));
    }

    function unreadCount() {
        return state ? state.fresh.filter(isUnread).length : 0;
    }

    function articleHtml(item, { large }) {
        const image = item.image
            ? `<img class="feed-news-image" src="${esc(item.image)}" alt="" decoding="async">`
            : '';
        const link = item.link
            ? `<a class="feed-news-link" href="${esc(item.link)}"${window.opensInNewTabUnlessPhone(dash()?.settings) ? ' target="_blank" rel="noopener noreferrer"' : ''} data-feed-news-article>${esc(item.title)}</a>`
            : esc(item.title);
        return `<article class="feed-news-article${large ? ' is-large' : ''}">${image}`
            + `<div class="feed-news-time">${esc([item.feedTitle, ago(item.publishedAt || item.foundAt)].filter(Boolean).join(' · '))}</div>`
            + `<h3 class="feed-news-title">${link}</h3>`
            + (item.summary ? `<div class="feed-news-summary">${item.summary}</div>` : '')
            + `</article>`;
    }

    // A tick marks an item read; a dot makes it unread again.
    const TOGGLE_ICONS = {
        read: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        unread: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="3.5" fill="currentColor"/></svg>',
    };

    function toggleLabel(item) {
        return isUnread(item) ? t('dashboard.feedWatchMarkRead', 'Mark read') : t('dashboard.feedWatchMarkUnread', 'Mark unread');
    }

    /** One headline on the front page; `i` is its place in listed(). */
    function entryHtml(entry, i) {
        const readable = !entry.earlier;
        const unread = isUnread(entry);
        const button = `<button type="button" class="feed-news-entry" data-feed-news-pick="${i}">`
            + (entry.image ? `<img class="feed-news-entry-image" src="${esc(entry.image)}" alt="" decoding="async">` : '')
            + `<span class="feed-news-entry-text"><span class="feed-news-entry-title">${esc(entry.title)}</span>`
            + `<span class="feed-news-entry-meta">${esc([entry.earlier ? siteNameOf(entry) : entry.feedTitle, ago(entry.publishedAt || entry.foundAt)].filter(Boolean).join(' · '))}</span>`
            + (entry.summary ? `<span class="feed-news-entry-lead">${esc(plainLead(entry.summary))}</span>` : '')
            + `</span></button>`;
        if (!readable) return `<div class="feed-news-item is-earlier">${button}</div>`;
        const label = toggleLabel(entry);
        return `<div class="feed-news-item ${unread ? 'is-unread' : 'is-read'}">`
            + `<span class="feed-news-dot" role="img" aria-label="${esc(unread ? t('dashboard.feedWatchUnread', 'Unread') : t('dashboard.feedWatchRead', 'Read'))}"></span>`
            + button
            + `<button type="button" class="feed-news-toggle" data-feed-news-toggle="${i}" aria-label="${esc(label)}" title="${esc(label)}">${TOGGLE_ICONS[unread ? 'read' : 'unread']}<span class="feed-news-toggle-label">${esc(label)}</span></button>`
            + `</div>`;
    }

    function headHtml({ title, chip, chipAttr = '', extra = '', switcher, closeButton }) {
        return `<div class="feed-news-head">`
            + `<span class="feed-news-site">${esc(title)}</span>`
            // The controls sit together at the top right, whatever the width.
            + `<span class="feed-news-tools"><span class="feed-news-chip"${chipAttr}>${esc(chip)}</span>`
            + extra + switcher + closeButton + `</span></div>`;
    }

    function render() {
        const root = document.querySelector('[data-feed-news]');
        if (!root || !state) return;
        const watch = dash()?.feedWatch;
        const view = currentView();
        const wide = view !== 'single';
        const paper = view === 'paper';
        const panel = root.closest('.modal');
        if (panel) {
            panel.classList.toggle('is-wide', wide);
            panel.classList.toggle('is-paper', paper);
            panel.style.maxWidth = wide ? 'min(960px, 92vw)' : '';
            panel.style.width = wide ? 'min(960px, 92vw)' : '';
        }
        const items = listed();
        if (state.index >= items.length) state.index = 0;
        if (!items.length) state.mode = 'index';
        else if (view === 'single') state.mode = 'article';
        const total = items.length;
        const timed = Boolean(state.timed);
        const windowMs = watch?.windowMs() || 1;
        const remaining = watch?.windowRemainingMs?.() || 0;
        const pct = Math.max(0, Math.min(100, (remaining / windowMs) * 100));
        const left = t('dashboard.feedWatchClosesIn', 'Closes in {minutes} min', { minutes: minutesLeft() });
        const caption = timed ? `<span class="feed-news-left" data-feed-news-left>${esc(left)}</span>` : '';

        const mast = paper
            ? `<div class="feed-news-mast"><span>${esc(t('dashboard.feedWatchNews', 'News'))}</span>`
                + `<span>${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</span></div>`
            : '';
        // All three layouts stay on offer on a narrow screen: two columns fold
        // into one there, the look of the layout stays.
        const switcher = `<span class="feed-news-views" role="group" aria-label="${esc(t('dashboard.feedWatchView', 'View'))}">`
            + VIEWS.map((v) => `<button type="button" class="feed-news-view" data-feed-news-view="${v}" aria-pressed="${v === view}" aria-label="${esc(viewLabel(v))}" title="${esc(viewLabel(v))}">${VIEW_ICONS[v]}</button>`).join('')
            + `</span>`;

        const bar = !timed ? '' : `<div class="feed-news-bar" role="progressbar" aria-label="${esc(left)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct}%"></i></div>`;
        const closeButton = `<button type="button" class="feed-news-close" data-feed-news-close aria-label="${esc(t('dashboard.close', 'Close'))}">×</button>`;

        // The front page: a section per site, then the feeds' earlier entries.
        if (state.mode === 'index') {
            const unread = unreadCount();
            // Mark all read belongs to the paper of every site; one site's
            // paper has its own button in the section.
            const markAll = !state.focusKey && unread > 0
                ? `<button type="button" class="modal-button feed-news-mark" data-feed-news-mark-all><span class="modal-button-name">${esc(t('dashboard.feedWatchMarkAllRead', 'Mark all read'))}</span></button>`
                : '';
            let i = 0;
            const blocks = sections().map((section) => {
                const rows = section.items.map((item) => entryHtml(item, i++)).join('');
                const count = section.unread > 0
                    ? `<span class="feed-news-section-count">${esc(t('dashboard.feedWatchUnreadCount', '{n} unread', { n: section.unread }))}</span>`
                    + `<button type="button" class="modal-button feed-news-mark" data-feed-news-mark-site="${esc(section.key)}"><span class="modal-button-name">${esc(t('dashboard.feedWatchMarkSiteRead', 'Mark site read'))}</span></button>`
                    : '';
                return `<section class="feed-news-section" data-feed-news-section="${esc(section.key)}">`
                    + `<div class="feed-news-section-head"><h3 class="feed-news-section-name">${esc(section.name)}</h3>${count}</div>`
                    + `<div class="feed-news-index${wide ? ' is-wide' : ''}">${rows}</div></section>`;
            }).join('');
            const earlier = state.earlier.length
                ? `<section class="feed-news-section is-earlier"><div class="feed-news-index-head">${esc(t('dashboard.feedWatchEarlier', 'Earlier from the feeds'))}</div>`
                    + `<div class="feed-news-index${wide ? ' is-wide' : ''}">${state.earlier.map((entry) => entryHtml(entry, i++)).join('')}</div></section>`
                : '';
            const empty = unread === 0
                ? `<p class="feed-news-empty">${esc(t('dashboard.feedWatchNothing', 'Nothing new from the feeds you watch'))}</p>`
                : '';
            root.innerHTML = mast
                + headHtml({ title: t('dashboard.feedWatchNews', 'News'), chip: t('dashboard.feedWatchUnreadCount', '{n} unread', { n: unread }), extra: markAll, switcher, closeButton })
                + bar
                + `<div class="feed-news-body"><div class="feed-news-paper">${empty}${blocks}${earlier}</div></div>`
                + `<div class="feed-news-foot">${caption}${legendHtml()}</div>`;
            return;
        }

        const item = items[state.index];
        const earlierHead = `<div class="feed-news-side-head">${esc(t('dashboard.feedWatchEarlier', 'Earlier from the feeds'))}</div>`;
        let earlierShown = false;
        const side = wide
            ? `<div class="feed-news-side" role="list">${items.map((other, i) => (i === state.index ? '' :
                (other.earlier && !earlierShown ? (earlierShown = true, earlierHead) : '') + `<button type="button" class="feed-news-card${isUnread(other) ? ' is-unread' : ''}" role="listitem" data-feed-news-pick="${i}">`
                + (other.image ? `<img class="feed-news-card-image" src="${esc(other.image)}" alt="">` : '')
                + `<span class="feed-news-card-text"><span class="feed-news-card-title">${esc(other.title)}</span>`
                + `<span class="feed-news-card-time">${esc([siteNameOf(other), ago(other.publishedAt || other.foundAt)].filter(Boolean).join(' · '))}</span></span>`
                + `</button>`)).join('')}</div>`
            : '';
        const toggle = item.earlier
            ? ''
            : `<button type="button" class="modal-button feed-news-mark" data-feed-news-toggle="${state.index}"><span class="modal-button-name">${esc(toggleLabel(item))}</span></button>`;

        root.innerHTML = mast
            + headHtml({
                title: siteNameOf(item),
                chip: t('dashboard.feedWatchCounter', '{n} of {total}', { n: state.index + 1, total }),
                chipAttr: ' data-feed-news-chip',
                switcher,
                closeButton,
            })
            + bar
            + `<div class="feed-news-body${wide ? ' is-wide' : ''}">`
            + `<div class="feed-news-main">${articleHtml(item, { large: wide })}</div>${side}</div>`
            + `<div class="feed-news-foot">`
            + (total > 1 && view !== 'single' ? `<button type="button" class="modal-button" data-feed-news-index><span class="modal-button-name">${esc(t('dashboard.feedWatchIndex', 'Index'))}</span></button>` : '')
            + `<button type="button" class="modal-button" data-feed-news-step="-1" aria-label="${esc(t('dashboard.feedWatchPrev', 'Previous'))}"><span class="modal-button-name">‹</span></button>`
            + `<button type="button" class="modal-button" data-feed-news-step="1" aria-label="${esc(t('dashboard.feedWatchNext', 'Next'))}"><span class="modal-button-name">›</span></button>`
            + caption
            + toggle
            + `<button type="button" class="modal-button feed-news-open" data-feed-news-open><span class="modal-button-name">${esc(t('dashboard.feedWatchOpenPage', 'Open page'))}</span></button>`
            + legendHtml()
            + `</div>`;
    }

    /** Update only the bar and its caption, so the 1-second tick never rebuilds the article. */
    function tick() {
        const root = document.querySelector('[data-feed-news]');
        const watch = dash()?.feedWatch;
        if (!root || !state || !watch) return;
        // Only news the window opened is on its clock.
        if (!state.timed) return;
        const phase = watch.windowPhase();
        if (phase === 'closed') { close(); return; }
        // Everything was marked read: there is no window left to count down.
        if (phase === 'none') { state.timed = false; render(); return; }
        const windowMs = watch.windowMs();
        const pct = Math.max(0, Math.min(100, (watch.windowRemainingMs() / windowMs) * 100));
        const bar = root.querySelector('.feed-news-bar');
        if (!bar) return;
        const left = t('dashboard.feedWatchClosesIn', 'Closes in {minutes} min', { minutes: minutesLeft() });
        bar.firstElementChild.style.width = `${pct}%`;
        bar.setAttribute('aria-label', left);
        bar.setAttribute('aria-valuenow', String(Math.round(pct)));
        const caption = root.querySelector('[data-feed-news-left]');
        if (caption) caption.textContent = left;
    }

    /**
     * Mark one item read or unread: the dot follows at once, the store and the
     * server after it.
     */
    function markItem(item, read) {
        if (!item || item.earlier || isUnread(item) === !read) return;
        item.unread = !read;
        void dash()?.feedWatch?.markItems?.(item.bookmarkUrl, item.feedUrl, [item.id], read);
    }

    /** Reading an article is what makes it read. */
    function showArticle(index) {
        state.index = index;
        state.mode = 'article';
        markItem(listed()[index], true);
        render();
    }

    function step(delta) {
        const items = listed();
        if (!items.length) return;
        showArticle((state.index + delta + items.length) % items.length);
    }

    function openBookmarkOf(item) {
        const d = dash();
        const bookmark = bookmarkOf(item);
        const url = item.bookmarkUrl || bookmark?.url;
        if (!url) return;
        if (bookmark) d.recordBookmarkOpened?.(bookmark, undefined, 'feed-news');
        window.openUrl(url, d.settings);
    }

    /** Rebuilding the panel loses focus; put it back on the same control. */
    function renderKeepingFocus(attribute, value) {
        render();
        if (!attribute) return;
        const again = document.querySelector(`[data-feed-news] [${attribute}="${CSS.escape(String(value))}"]`)
            || document.querySelector('[data-feed-news] [data-feed-news-close]');
        again?.focus({ preventScroll: true });
    }

    /** Keys the paper's own reading keys leave alone: typing, another modal, a chord. */
    function readingKeysFree(event) {
        if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false;
        const target = event.target;
        if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return false;
        // Another modal on top of this one owns the keyboard.
        return !target?.closest?.('.modal') || Boolean(target.closest('.feed-news-modal'));
    }

    /** j / k on the front page: the highlighted row is the focused one, so Enter opens it. */
    function moveRow(delta) {
        const rows = [...document.querySelectorAll('[data-feed-news] [data-feed-news-pick]')];
        if (!rows.length) return;
        const at = rows.indexOf(document.activeElement);
        const next = at < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + delta));
        rows[next].focus();
    }

    function legendHtml() {
        return `<p class="feed-news-keys" aria-hidden="true">`
            + `<span><kbd>j / k</kbd> ${esc(t('dashboard.feedWatchKeyMove', 'next / previous'))}</span>`
            + `<span><kbd>Esc</kbd> ${esc(t('dashboard.feedWatchKeyEsc', 'close'))}</span></p>`;
    }

    function onKey(event) {
        if (!state || !document.querySelector('[data-feed-news]')) return;
        if ((event.key === 'j' || event.key === 'k') && readingKeysFree(event)) {
            event.preventDefault();
            const delta = event.key === 'j' ? 1 : -1;
            if (state.mode === 'article') step(delta);
            else moveRow(delta);
            return;
        }
        // Esc is the window's own: it closes at once, from the front page and from
        // an article alike. The Index button is the way back to the front page.
        if (event.key === 'ArrowRight' && state.mode === 'article') {
            event.preventDefault();
            step(1);
        } else if (event.key === 'ArrowLeft' && state.mode === 'article') {
            event.preventDefault();
            step(-1);
        }
    }

    function onClick(event) {
        const root = event.target.closest('[data-feed-news]');
        if (!root || !state) return;
        const target = event.target;
        const watch = dash()?.feedWatch;
        const stepButton = target.closest('[data-feed-news-step]');
        if (stepButton) { step(Number(stepButton.dataset.feedNewsStep)); return; }
        const toggle = target.closest('[data-feed-news-toggle]');
        if (toggle) {
            const item = listed()[Number(toggle.dataset.feedNewsToggle)];
            if (item) markItem(item, isUnread(item));
            renderKeepingFocus('data-feed-news-toggle', toggle.dataset.feedNewsToggle);
            return;
        }
        const site = target.closest('[data-feed-news-mark-site]');
        if (site) {
            const key = site.dataset.feedNewsMarkSite;
            const section = sections().find((s) => s.key === key);
            section?.items.forEach((item) => { item.unread = false; });
            if (section?.url) watch?.markSiteRead?.(section.url);
            renderKeepingFocus('data-feed-news-close', '');
            return;
        }
        if (target.closest('[data-feed-news-mark-all]')) {
            state.fresh.forEach((item) => { item.unread = false; });
            void watch?.markAllRead?.();
            renderKeepingFocus('data-feed-news-close', '');
            return;
        }
        const pick = target.closest('[data-feed-news-pick]');
        if (pick) { showArticle(Number(pick.dataset.feedNewsPick) || 0); return; }
        if (target.closest('[data-feed-news-index]')) { state.mode = 'index'; render(); return; }
        const viewButton = target.closest('[data-feed-news-view]');
        if (viewButton) { chooseView(viewButton.dataset.feedNewsView); return; }
        if (target.closest('[data-feed-news-close]')) { close(); return; }
        if (target.closest('[data-feed-news-open]')) {
            const item = listed()[state.index];
            if (item) openBookmarkOf(item);
            return;
        }
        if (target.closest('[data-feed-news-article]')) {
            // The link opens itself in a new tab; only this item is read.
            markItem(listed()[state.index], true);
        }
    }

    /**
     * @param {{focusKey?: string, focusItemId?: string, source?: string}} [options]
     *   focusKey: one site's paper. source: 'button' (the News button: no clock)
     *   or 'return' (coming back to the tab); anything else is the window's news.
     */
    async function open({ focusKey = '', focusItemId = '', source = '' } = {}) {
        const watch = dash()?.feedWatch;
        if (!watch) return;
        if (source !== 'return') {
            try { localStorage.setItem(BY_HAND_KEY, String(Date.now())); } catch { /* no storage */ }
        }
        const { items: fresh, earlier } = await watch.news(focusKey);
        const order = sectionOrder(fresh);
        const fill = (target) => {
            fresh.forEach((item) => { item.openUnread = isUnread(item); });
            target.fresh = fresh;
            target.earlier = earlier;
            target.order = order;
            target.focusKey = focusKey;
            const everything = listed();
            target.index = focusItemId ? Math.max(0, everything.findIndex((i) => i.id === focusItemId)) : 0;
            // Several items open on the front page; one asked for by item, or a
            // single one, opens on the article.
            // The newspaper opens on its front page; the two-column and one-column
            // layouts open on an article, the others beside it or one at a time.
            target.mode = everything.length > 1 && !focusItemId && currentView() === 'paper' ? 'index' : 'article';
        };
        // Already showing (a push landed on ?news=1 and the toast was clicked
        // too): refill it in place. Showing the panel again would replace the
        // one on screen and run its close handler on the new state.
        if (state && document.querySelector('[data-feed-news]')) {
            fill(state);
            render();
            return;
        }
        const phase = watch.windowPhase();
        state = { timed: source !== 'button' && (phase === 'open' || phase === 'pending') };
        fill(state);

        global.AppModal.show({
            title: t('dashboard.feedWatchNews', 'News'),
            htmlMessage: '<div class="feed-news" data-feed-news></div>',
            showCancel: false,
            modalClass: 'feed-news-modal',
            initialFocusSelector: '[data-feed-news-open], [data-feed-news-close]',
            onHide: () => {
                clearInterval(state?.timer);
                document.removeEventListener('click', onClick, true);
                global.removeEventListener('keydown', onKey, true);
                state = null;
            },
        });
        render();
        document.addEventListener('click', onClick, true);
        global.addEventListener('keydown', onKey, true);
        state.timer = setInterval(tick, 1000);
    }

    function close() {
        if (state) global.AppModal.hide();
    }

    /* The News button beside What's new: shown once a feed is watched, with
       the number of unread items. */
    function unreadTotal(watch) {
        return Number(watch?.unreadTotal?.() ?? watch?.totalNew?.()) || 0;
    }

    function syncButton() {
        const button = document.getElementById('feed-news-btn');
        const watch = dash()?.feedWatch;
        if (!button || !watch) return;
        const watched = (watch.byKey?.size || 0) > 0;
        const unread = unreadTotal(watch);
        button.hidden = !watched;
        button.dataset.unread = String(unread);
        const count = button.querySelector('[data-feed-news-btn-count]');
        if (count) count.textContent = unread > 0 ? String(unread) : '';
        const label = unread > 0
            ? t('dashboard.feedWatchNewsUnread', 'News, {n} unread', { n: unread })
            : t('dashboard.feedWatchNews', 'News');
        button.setAttribute('aria-label', label);
        button.dataset.tooltip = label.toLowerCase();
    }

    /** Another window is up (a modal, search, the cheat sheet): never cover it. */
    function somethingElseOpen() {
        return Boolean(global.ScrollLock?.isLocked?.() || document.querySelector('.modal-overlay.show'));
    }

    /**
     * Coming back to a tab whose title shows a count opens the paper, once per
     * return: not over another window, and not when the paper was opened by
     * hand within the last window.
     */
    function onReturn() {
        if (document.visibilityState !== 'visible' || state) return;
        const watch = dash()?.feedWatch;
        if (!watch || !(unreadTotal(watch) > 0)) return;
        // A muted feed counts but never calls: only news from a loud feed brings the paper back.
        if (!((watch.sitesWithNews?.({ loud: true }) ?? 1) > 0)) return;
        const phase = watch.windowPhase();
        if (phase !== 'open' && phase !== 'pending') return;
        if (somethingElseOpen()) return;
        let byHand = 0;
        try { byHand = Number(localStorage.getItem(BY_HAND_KEY)) || 0; } catch { /* no storage */ }
        if (Date.now() - byHand < watch.windowMs()) return;
        void open({ source: 'return' });
    }

    document.getElementById('feed-news-btn')?.addEventListener('click', () => { void open({ source: 'button' }); });
    document.addEventListener('feedwatch:changed', syncButton);
    document.addEventListener('visibilitychange', onReturn);

    global.FeedWatchNews = { open, close, isOpen: () => state !== null };
})(window);
