/**
 * Watched news on a touch screen: tap the badge, read the headlines.
 *
 * A phone has no hover, so the card that shows the newest item on a desktop has
 * nothing to open it. The row keeps the same purple badge instead, and tapping
 * the badge opens a small popover under it with up to four headlines, newest
 * first. A tap on a headline opens that article and clears the badge; "+n more"
 * says how many did not fit and opens the bookmark. A tap anywhere else closes it.
 *
 * Touch is the media query and nothing else. dash.isCoarsePointer() also matches
 * a narrow desktop window, and the user agent is a guess; "no hover, coarse
 * pointer" is what the page is asking about.
 */
(function (global) {
    'use strict';

    const QUERY = '(hover: none) and (pointer: coarse)';
    const MAX_ITEMS = 4;
    const MARGIN = 12;
    const GAP = 8;

    let popover = null;   // { el, badge, key }

    function isTouch() {
        return Boolean(global.matchMedia && global.matchMedia(QUERY).matches);
    }

    function dash() { return global.dashboardInstance; }

    function t(key, fallback, vars) {
        let text = fallback;
        const lang = dash()?.language;
        if (lang?.t) {
            const value = lang.t(key);
            if (value && value !== key) text = value;
        }
        Object.keys(vars || {}).forEach((name) => {
            text = text.replace(`{${name}}`, () => String(vars[name]));
        });
        return text;
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

    // Whichever way it closes, the reader lands where they were: on the badge.
    function close() {
        if (!popover) return;
        const { badge } = popover;
        badge?.setAttribute('aria-expanded', 'false');
        popover.el.remove();
        document.removeEventListener('pointerdown', onOutside, true);
        document.removeEventListener('keydown', onKey, true);
        global.removeEventListener('resize', onResize);
        global.removeEventListener('scroll', onScroll, true);
        popover = null;
        global.FocusTrapUtils?.focusIfConnected?.(badge);
    }

    function onOutside(event) {
        if (!popover) return;
        if (popover.el.contains(event.target) || popover.badge?.contains(event.target)) return;
        close();
    }

    function onKey(event) {
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key === 'Tab' && popover) global.FocusTrapUtils?.trapTabKey?.(event, popover.el);
    }

    // The browser's own bars coming and going fire a resize on a phone; that is
    // a reason to place the popover again, not to take it away.
    function onResize() {
        if (popover) place(popover.el, popover.badge);
    }

    function onScroll(event) {
        // Scrolling the page moves the row away from the popover; scrolling the
        // popover itself is fine.
        if (popover && !popover.el.contains(event.target)) close();
    }

    function place(el, badge) {
        const rect = badge.getBoundingClientRect();
        const vw = global.innerWidth;
        const vh = global.innerHeight;
        const width = Math.min(360, vw - MARGIN * 2);
        el.style.width = `${width}px`;
        const left = Math.min(Math.max(MARGIN, rect.right - width), vw - width - MARGIN);
        el.style.left = `${left}px`;
        const height = el.getBoundingClientRect().height;
        const below = vh - rect.bottom - GAP - MARGIN;
        const above = rect.top - GAP - MARGIN;
        const showBelow = below >= Math.min(height, 240) || below >= above;
        const room = Math.max(120, showBelow ? below : above);
        el.style.maxHeight = `${room}px`;
        const used = Math.min(height, room);
        el.style.top = `${showBelow ? rect.bottom + GAP : rect.top - GAP - used}px`;
        // The pointer sits under the badge, wherever the popover landed.
        const arrow = Math.min(Math.max(16, rect.left + rect.width / 2 - left - 6), width - 28);
        el.style.setProperty('--feed-pop-arrow', `${arrow}px`);
        el.classList.toggle('is-above', !showBelow);
    }

    function openBookmark(bookmark) {
        const d = dash();
        d.recordBookmarkOpened?.(bookmark, undefined, 'feed-popover');
        global.open(bookmark.url, '_blank', 'noopener,noreferrer');
    }

    function build(bookmark, items, more) {
        const esc = (v) => global.NextDashHtml.escapeHtml(String(v ?? ''));
        const el = document.createElement('div');
        // The surface every menu in the app wears, so the active theme's edges,
        // depth and drop apply to it without a copy of them here.
        el.className = 'move-popover feed-news-pop';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'false');
        el.setAttribute('aria-labelledby', 'feed-news-pop-name');
        const count = Number(dash()?.feedWatch?.watchFor(bookmark)?.newCount) || items.length;
        el.innerHTML = `<div class="feed-news-pop-head"><span class="feed-news-pop-name" id="feed-news-pop-name">${esc(bookmark.name || bookmark.url)}</span>`
            + `<span class="feed-news-pop-count">${esc(t('dashboard.feedWatchNewCount', '{n} new', { n: count }))}</span>`
            + `<button type="button" class="feed-news-pop-close" data-pop-close aria-label="${esc(t('dashboard.close', 'Close'))}">×</button></div>`
            + `<ul class="feed-news-pop-list">` + items.map((item, i) => `<li><button type="button" class="feed-news-pop-item" data-pop-item="${i}">`
            + (item.image ? `<img class="feed-news-pop-thumb" src="${esc(item.image)}" alt="" decoding="async">` : '')
            + `<span class="feed-news-pop-text"><span class="feed-news-pop-title">${esc(item.title)}</span>`
            + `<span class="feed-news-pop-meta">${esc([item.feedTitle, ago(item.publishedAt || item.foundAt)].filter(Boolean).join(' · '))}</span></span>`
            + `</button></li>`).join('') + `</ul>`
            + (more > 0 ? `<button type="button" class="feed-news-pop-more" data-pop-more>${esc(t('dashboard.feedWatchPopoverMore', '+{n} more', { n: more }))}</button>` : '');
        el.addEventListener('click', (event) => {
            event.stopPropagation();
            if (event.target.closest('[data-pop-close]')) { close(); return; }
            const itemButton = event.target.closest('[data-pop-item]');
            const moreButton = event.target.closest('[data-pop-more]');
            if (!itemButton && !moreButton) return;
            const d = dash();
            if (itemButton) {
                const item = items[Number(itemButton.dataset.popItem)];
                if (item?.link) global.open(item.link, '_blank', 'noopener,noreferrer');
                // Only the headline that was opened is read; the others stay new.
                if (item?.id && item.feedUrl) void d.feedWatch.markItems(bookmark.url, item.feedUrl, [item.id], true);
                else d.feedWatch.markSeen(bookmark);
            } else {
                openBookmark(bookmark);
            }
            close();
        });
        return el;
    }

    /** Open (or close) the popover under a row's badge. */
    async function toggle(bookmark, badge) {
        if (popover && popover.badge === badge) { close(); return; }
        close();
        const watch = dash()?.feedWatch;
        if (!watch) return;
        const key = watch.key(bookmark.url);
        const news = await watch.news(key);
        const items = news.items.filter((item) => item.unread !== false);
        if (!items.length) return;
        const shown = items.slice(0, MAX_ITEMS);
        // What the entry counts, not what was loaded: more may be waiting.
        const waiting = Number(watch.watchFor(bookmark)?.newCount) || items.length;
        const el = build(bookmark, shown, Math.max(0, waiting - shown.length));
        document.body.appendChild(el);
        badge.setAttribute('aria-expanded', 'true');
        popover = { el, badge, key };
        place(el, badge);
        el.querySelector('.feed-news-pop-item')?.focus({ preventScroll: true });
        document.addEventListener('pointerdown', onOutside, true);
        document.addEventListener('keydown', onKey, true);
        global.addEventListener('resize', onResize);
        global.addEventListener('scroll', onScroll, true);
    }

    /**
     * Make a row's news badge a button on a touch screen. Called by the row
     * painter for every badge it draws.
     */
    function attach(badge, bookmark) {
        if (!isTouch()) return;
        badge.classList.add('is-tappable');
        badge.setAttribute('role', 'button');
        badge.setAttribute('tabindex', '0');
        badge.setAttribute('aria-haspopup', 'dialog');
        badge.setAttribute('aria-expanded', 'false');
        // Inside the row's link: without this the tap would open the bookmark.
        badge.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void toggle(bookmark, badge);
        });
    }

    // A phone turned sideways, or a keyboard attached, can change the answer.
    try {
        global.matchMedia?.(QUERY).addEventListener?.('change', () => {
            close();
            document.dispatchEvent(new CustomEvent('feedwatch:changed'));
        });
    } catch { /* no matchMedia */ }
    document.addEventListener('feedwatch:changed', () => {
        // The news the popover shows is gone (opened, or the window closed).
        if (popover && !(dash()?.feedWatch?.newsFor?.({ url: popover.key }))) {
            const stillThere = [...(dash()?.feedWatch?.byKey?.keys() || [])].includes(popover.key);
            if (!stillThere || !(Number(dash().feedWatch.byKey.get(popover.key)?.newCount) > 0)) close();
        }
    });

    global.FeedWatchPopover = { isTouch, attach, close, isOpen: () => popover !== null };
})(window);
