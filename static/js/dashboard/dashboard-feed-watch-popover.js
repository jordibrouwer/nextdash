/**
 * Watched news under the row: click the bookmark, read the headlines.
 *
 * A row with news does not open its site straight away, on a phone or a
 * desktop: the first click opens a small popover under it with up to six
 * headlines, newest first. A click on a headline opens that article and reads
 * only that one; "+n more" says how many did not fit and opens the bookmark,
 * and so does the bar on top. A click anywhere else closes it. On a desktop the
 * head has a Reader button for the paper on that site, and the new-tab gestures
 * (a modifier or the middle button) still open the site itself.
 *
 * Touch is the media query and nothing else. dash.isCoarsePointer() also matches
 * a narrow desktop window, and the user agent is a guess; "no hover, coarse
 * pointer" is what the page is asking about.
 */
(function (global) {
    'use strict';

    const QUERY = '(hover: none) and (pointer: coarse)';
    const MAX_ITEMS = 6;
    const MARGIN = 12;
    const GAP = 8;

    let popover = null;   // { el, badge, key, bookmark }
    let opening = false;  // between the click and the news arriving
    let watcher = null;   // MutationObserver on the page, while a popover is open
    let resizer = null;   // ResizeObserver on the page, while a popover is open

    function isTouch() {
        return Boolean(global.matchMedia && global.matchMedia(QUERY).matches);
    }

    function dash() { return global.dashboardInstance; }

    // The reader's own wish, and the app's switch for its animations.
    function still() {
        return Boolean(global.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
            || Boolean(document.body?.classList.contains('no-animations'));
    }

    // A modifier or another button is a new tab, a new window or the menu: the
    // browser's own, and the site's.
    function plainClick(event) {
        return (event.button || 0) === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
    }

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
        const { el, badge } = popover;
        badge?.setAttribute('aria-expanded', 'false');
        fadeOut(el);
        watcher?.disconnect();
        resizer?.disconnect();
        watcher = null;
        resizer = null;
        document.removeEventListener('feedwatch:changed', onRendered);
        document.removeEventListener('pointerdown', onOutside, true);
        document.removeEventListener('keydown', onKey, true);
        global.removeEventListener('resize', onResize);
        global.removeEventListener('scroll', onScroll, true);
        popover = null;
        global.FocusTrapUtils?.focusIfConnected?.(badge);
    }

    /**
     * Out of the way at once, gone a moment later. The element stops being the
     * popover straight away (its class, role and ids go), so a quick reopen
     * finds one popover and not two; the inline animation beats the theme's.
     */
    function fadeOut(el) {
        el.classList.replace('feed-news-pop', 'feed-news-pop-closing');
        el.removeAttribute('role');
        el.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
        el.style.pointerEvents = 'none';
        if (still()) { el.remove(); return; }
        let gone = false;
        const finish = () => { if (!gone) { gone = true; el.remove(); } };
        el.addEventListener('animationend', finish, { once: true });
        global.setTimeout(finish, 150);
        el.style.animation = 'feed-news-pop-shrink 90ms ease-in forwards';
    }

    function onOutside(event) {
        if (!popover) return;
        // A tap on the row the popover belongs to is the row's own: it closes the
        // popover itself, and must not do it twice.
        if (popover.el.contains(event.target) || popover.badge?.closest('a')?.contains(event.target)) return;
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

    /**
     * The page under the popover moves: a picture loads, the news count changes
     * and the rows are drawn again. The popover is fixed to the screen, so it
     * finds its badge again (the old one may be gone) and sits under it, or goes
     * when the badge has.
     */
    function follow() {
        if (!popover) return;
        let { badge } = popover;
        if (!badge?.isConnected) {
            // The same bookmark can be on the page twice (in a recent list and in
            // its category): the popover goes back to the copy it was opened on.
            let target = '';
            try { target = new URL(popover.bookmark?.url, global.location.href).href; } catch { /* no address */ }
            const copies = [...document.querySelectorAll('.bookmark-news-badge.is-tappable')]
                .filter((b) => b.closest('a')?.href === target);
            badge = copies[Math.min(popover.copy || 0, copies.length - 1)] || null;
            if (!badge) { close(); return; }
            badge.setAttribute('aria-expanded', 'true');
            popover.badge = badge;
        }
        place(popover.el, badge);
    }

    function onRendered() {
        // The rows are drawn on the next frame after the event.
        global.requestAnimationFrame(() => global.requestAnimationFrame(follow));
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
        // The layout height: while it grows, the drawn box is still small.
        const height = el.offsetHeight;
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
        // It grows out of the row: from the edge next to it, at the arrow.
        el.style.transformOrigin = `${arrow + 5}px ${showBelow ? 'top' : 'bottom'}`;
    }

    function openBookmark(bookmark) {
        const d = dash();
        d.recordBookmarkOpened?.(bookmark, undefined, 'feed-popover');
        global.openUrl(bookmark.url, d.settings);
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
        el.innerHTML = `<div class="feed-news-pop-head">`
            + `<button type="button" class="feed-news-pop-site" data-pop-site aria-label="${esc(t('dashboard.feedWatchPopoverOpenSite', 'Open {name}', { name: bookmark.name || bookmark.url }))}">`
            + `<span class="feed-news-pop-name" id="feed-news-pop-name">${esc(bookmark.name || bookmark.url)}</span>`
            + `<span class="feed-news-pop-count">${esc(t('dashboard.feedWatchNewCount', '{n} new', { n: count }))}</span></button>`
            // The paper on this site alone; a phone reaches it from the toast.
            + (isTouch() ? '' : `<button type="button" class="feed-news-pop-reader" data-pop-reader aria-label="${esc(t('dashboard.feedWatchPopoverReaderLabel', 'Open the reader for {name}', { name: bookmark.name || bookmark.url }))}">${esc(t('dashboard.feedWatchPopoverReader', 'Reader'))}</button>`)
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
            if (event.target.closest('[data-pop-reader]')) {
                const focusKey = dash()?.feedWatch?.key(bookmark.url);
                close();
                void global.FeedWatchNews?.open({ focusKey, source: 'button' });
                return;
            }
            // The bar on top is the way on to the site itself.
            if (event.target.closest('[data-pop-site]')) { openBookmark(bookmark); close(); return; }
            const itemButton = event.target.closest('[data-pop-item]');
            const moreButton = event.target.closest('[data-pop-more]');
            if (!itemButton && !moreButton) return;
            const d = dash();
            if (itemButton) {
                const item = items[Number(itemButton.dataset.popItem)];
                if (item?.link) global.openUrl(item.link, d.settings);
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
        opening = true;
        let news;
        try { news = await watch.news(key); } finally { opening = false; }
        const items = news.items.filter((item) => item.unread !== false);
        // Counted but nothing left to show (read in the paper meanwhile): the
        // click was for the site, so it goes there rather than nowhere.
        if (!items.length) { openBookmark(bookmark); return; }
        const shown = items.slice(0, MAX_ITEMS);
        // What the entry counts, not what was loaded: more may be waiting.
        const waiting = Number(watch.watchFor(bookmark)?.newCount) || items.length;
        const el = build(bookmark, shown, Math.max(0, waiting - shown.length));
        document.body.appendChild(el);
        badge.setAttribute('aria-expanded', 'true');
        const same = [...document.querySelectorAll('.bookmark-news-badge.is-tappable')]
            .filter((b) => b.closest('a')?.href === badge.closest('a')?.href);
        popover = { el, badge, key, bookmark, copy: Math.max(0, same.indexOf(badge)) };
        place(el, badge);
        el.style.animation = still() ? 'none' : 'feed-news-pop-grow 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both';
        // A page that is still settling (pictures, a repaint) moves the row after
        // the first placement.
        let queued = false;
        const settle = () => {
            if (queued) return;
            queued = true;
            global.requestAnimationFrame(() => { queued = false; follow(); });
        };
        watcher = new global.MutationObserver(settle);
        watcher.observe(document.body, { childList: true, subtree: true });
        if (global.ResizeObserver) {
            resizer = new global.ResizeObserver(settle);
            resizer.observe(document.body);
        }
        document.addEventListener('feedwatch:changed', onRendered);
        el.querySelector('.feed-news-pop-item')?.focus({ preventScroll: true });
        document.addEventListener('pointerdown', onOutside, true);
        document.addEventListener('keydown', onKey, true);
        global.addEventListener('resize', onResize);
        global.addEventListener('scroll', onScroll, true);
    }

    /**
     * Make a row's news badge a button, and the row a way to the headlines.
     * Called by the row painter for every badge it draws.
     */
    function attach(badge, bookmark, openLink) {
        badge.classList.add('is-tappable');
        badge.setAttribute('role', 'button');
        badge.setAttribute('tabindex', '0');
        badge.setAttribute('aria-haspopup', 'dialog');
        badge.setAttribute('aria-expanded', 'false');
        // Inside the row's link: without this the tap would open the bookmark.
        badge.addEventListener('click', (event) => {
            if (!plainClick(event)) return;
            event.preventDefault();
            event.stopPropagation();
            // A touch sends a hover before the click, and the row's own preview
            // card would open under the headlines a moment later.
            const link = badge.closest('a');
            if (link) {
                link._previewHoverActive = false;
                clearTimeout(link._previewHoverTimer);
                link._previewHoverTimer = null;
            }
            try { dash()?.dismissBookmarkPreviewInteractions?.(); } catch { /* no card */ }
            void toggle(bookmark, badge);
        });
        // A button answers Enter and Space as well, and keeps them from the row.
        badge.addEventListener('keydown', (event) => {
            if ((event.key !== 'Enter' && event.key !== ' ') || event.ctrlKey || event.metaKey || event.altKey) return;
            event.preventDefault();
            event.stopPropagation();
            void toggle(bookmark, badge);
        });
        // A bookmark with news never opens its site straight from the row:
        // whatever part of the row is clicked or tapped, and Enter on it too,
        // the headlines come first, and the site is one click further, from the
        // bar on top. A new-tab gesture still goes straight to the site.
        if (openLink) {
            openLink.addEventListener('click', (event) => {
                if (!badge.isConnected || event.defaultPrevented || !plainClick(event)) return;
                // Open page on the hover card means the site itself.
                if (openLink._feedPopoverBypass) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                openLink._previewHoverActive = false;
                clearTimeout(openLink._previewHoverTimer);
                openLink._previewHoverTimer = null;
                try { dash()?.dismissBookmarkPreviewInteractions?.(); } catch { /* no card */ }
                void toggle(bookmark, badge);
            }, true);
        }
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

    global.FeedWatchPopover = { isTouch, attach, close, isOpen: () => popover !== null || opening };
})(window);
