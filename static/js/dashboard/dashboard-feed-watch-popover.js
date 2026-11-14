/**
 * Watched news under the row: click the bookmark, read the headlines.
 *
 * A row with news does not open its site straight away, on a phone or a
 * desktop: the first click opens a small popover under it with up to six
 * headlines, newest first. A click on a headline opens that article and reads
 * only that one; "+n more" says how many did not fit and shows them in the same
 * popover, up to ten; what is left after that opens the bookmark, and so does
 * the bar on top. A click anywhere else closes it. The head has a Reader
 * button for the paper on that site, and the new-tab gestures
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
    const MAX_EXPANDED = 10;  // the server keeps ten full items per feed
    const MARGIN = 12;
    const GAP = 8;
    const WIDTH = 360;
    const WIDE = 640;         // two columns
    const COLUMN = 260;       // the narrowest a column may be

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

    /**
     * The row the popover belongs to wears a ring while it is open, so the two
     * read as one thing: the bookmark, and the news that came with it.
     */
    let pointerEl = null;

    /**
     * The pointer from the popover to its badge: a small diamond of its own on
     * the page rather than a corner of the popover, because the popover scrolls
     * and clips whatever sticks out of it. It points from whichever edge faces
     * the badge, below, above or beside, and nods when the popover was offered.
     */
    function placePointer(el, badge) {
        if (!el?.isConnected || !badge?.isConnected) { removePointer(); return; }
        if (!pointerEl?.isConnected) {
            pointerEl = document.createElement('span');
            pointerEl.className = 'feed-pop-pointer';
            pointerEl.setAttribute('aria-hidden', 'true');
            document.body.appendChild(pointerEl);
        }
        const pop = el.getBoundingClientRect();
        const b = badge.getBoundingClientRect();
        const size = 14;
        let dir = 'up';
        let x = Math.min(Math.max(pop.left + 16, b.left + b.width / 2), pop.right - 16) - size / 2;
        let y = pop.top - size / 2;
        if (el.classList.contains('is-side')) {
            dir = el.classList.contains('is-left') ? 'right' : 'left';
            x = dir === 'left' ? pop.left - size / 2 : pop.right - size / 2;
            y = Math.min(Math.max(pop.top + 16, b.top + b.height / 2), pop.bottom - 16) - size / 2;
        } else if (el.classList.contains('is-above')) {
            dir = 'down';
            y = pop.bottom - size / 2;
        }
        pointerEl.dataset.dir = dir;
        pointerEl.classList.toggle('is-offer', el.classList.contains('is-offer'));
        pointerEl.style.left = `${Math.round(x)}px`;
        pointerEl.style.top = `${Math.round(y)}px`;
    }

    function removePointer({ animate = false } = {}) {
        const el = pointerEl;
        pointerEl = null;
        if (!el) return;
        if (!animate || still()) { el.remove(); return; }
        el.classList.add('is-closing');
        global.setTimeout(() => el.remove(), 200);
    }

    function anchor(badge, on) {
        const link = badge?.closest?.('.bookmark-link') || badge?.closest?.('a');
        if (link) link.classList.toggle('feed-pop-anchor', on);
    }

    // Whichever way it closes, the reader lands where they were: on the badge.
    function close() {
        if (!popover) return;
        const { el, badge } = popover;
        badge?.setAttribute('aria-expanded', 'false');
        anchor(badge, false);
        removePointer({ animate: true });
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
        global.setTimeout(finish, 260);
        // The way it grew, backwards: it folds back into the row it came out of
        // (the transform origin is the pointer, set when it was placed).
        el.style.animation = 'feed-news-pop-shrink 210ms cubic-bezier(0.4, 0, 0.9, 0.3) forwards';
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
        if (popover) layout(popover.el, popover.badge);
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
        anchor(badge, true);
        layout(popover.el, badge);
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

    /**
     * Where the popover goes and what shape it takes, decided by measuring. The
     * first of these that holds every headline without a scrollbar wins:
     * one column with pictures under the row (or over it), the same without
     * pictures and a line per headline, two such columns side by side, one
     * column beside the row; and when nothing fits, the compact column on the
     * roomier side, scrolling. A phone has no room for the two in the middle.
     * It all happens before the browser paints, so the reader only ever sees
     * the answer.
     */
    function layout(el, badge) {
        layoutPopover(el, badge);
        placePointer(el, badge);
    }

    function layoutPopover(el, badge) {
        const rect = badge.getBoundingClientRect();
        const row = (badge.closest('a') || badge).getBoundingClientRect();
        const vw = global.innerWidth;
        const vh = global.innerHeight;
        const phone = Boolean(global.isPhoneDevice?.()) || isTouch();
        const narrow = Math.min(WIDTH, vw - MARGIN * 2);
        const wide = Math.min(WIDE, vw - MARGIN * 2);
        const below = vh - rect.bottom - GAP - MARGIN;
        const above = rect.top - GAP - MARGIN;
        const tall = vh - MARGIN * 2;
        const count = el.querySelectorAll('.feed-news-pop-list > li').length;
        el.style.setProperty('--feed-pop-rows', String(Math.ceil(count / 2)));
        // The height a shape needs, read with nothing holding it in.
        const need = (shape, width) => {
            el.classList.toggle('is-compact', shape !== 'full');
            el.classList.toggle('is-two-cols', shape === 'two');
            el.style.width = `${width}px`;
            el.style.maxHeight = 'none';
            return el.offsetHeight;
        };
        const vertical = (height) => (height <= below ? 'below' : height <= above ? 'above' : '');
        let shape = 'full';
        let width = narrow;
        let height = need(shape, width);
        let where = vertical(height);
        if (!where) {
            shape = 'compact';
            height = need(shape, width);
            where = vertical(height);
        }
        if (!where && !phone && wide >= COLUMN * 2) {
            height = need('two', wide);
            where = vertical(height);
            if (where) { shape = 'two'; width = wide; } else height = need(shape, width);
        }
        let side = '';
        if (!where && !phone && height <= tall) {
            if (vw - row.right - GAP - MARGIN >= width) side = 'right';
            else if (row.left - GAP - MARGIN >= width) side = 'left';
        }
        if (!where && !side) where = below >= above ? 'below' : 'above';
        // Whatever was measured last is not necessarily the answer.
        need(shape, width);
        el.classList.toggle('is-side', Boolean(side));
        el.classList.toggle('is-left', side === 'left');
        el.classList.toggle('is-above', where === 'above');
        if (side) {
            el.style.maxHeight = '';
            const middle = (row.top + row.bottom) / 2;
            const top = Math.min(Math.max(MARGIN, middle - height / 2), vh - MARGIN - height);
            el.style.top = `${top}px`;
            el.style.left = `${side === 'right' ? row.right + GAP : row.left - GAP - width}px`;
            // The pointer sits beside the row, wherever the popover landed.
            const arrow = Math.min(Math.max(12, middle - top - 5), height - 22);
            el.style.setProperty('--feed-pop-arrow-y', `${arrow}px`);
            el.classList.remove('is-arrowless');
            el.style.transformOrigin = `${side === 'right' ? 'left' : 'right'} ${arrow + 5}px`;
            return;
        }
        const room = Math.max(120, where === 'below' ? below : above);
        el.style.maxHeight = `${room}px`;
        const left = Math.min(Math.max(MARGIN, rect.right - width), vw - width - MARGIN);
        el.style.left = `${left}px`;
        const used = Math.min(height, room);
        el.style.top = `${where === 'below' ? rect.bottom + GAP : rect.top - GAP - used}px`;
        // The pointer sits under the badge, wherever the popover landed; when
        // the badge is past the popover's edge there is nothing to point at.
        const centre = rect.left + rect.width / 2 - left - 6;
        const arrow = Math.min(Math.max(16, centre), width - 28);
        el.style.setProperty('--feed-pop-arrow', `${arrow}px`);
        el.classList.toggle('is-arrowless', centre < 0 || centre > width);
        // It grows out of the row: from the edge next to it, at the arrow.
        el.style.transformOrigin = `${arrow + 5}px ${where === 'below' ? 'top' : 'bottom'}`;
    }

    function openBookmark(bookmark) {
        const d = dash();
        d.recordBookmarkOpened?.(bookmark, undefined, 'feed-popover');
        global.openUrl(bookmark.url, d.settings);
    }

    /**
     * The popover for a bookmark. `items` are its unread headlines, newest first;
     * the first six show, "+n more" brings in the rest up to ten, and `waiting`
     * is what the entry counts (more than were loaded, sometimes).
     */
    function build(bookmark, items, waiting, offer = false) {
        const esc = (v) => global.NextDashHtml.escapeHtml(String(v ?? ''));
        const el = document.createElement('div');
        // The surface every menu in the app wears, so the active theme's edges,
        // depth and drop apply to it without a copy of them here.
        el.className = `move-popover feed-news-pop${offer ? ' is-offer' : ''}`;
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'false');
        el.setAttribute('aria-labelledby', 'feed-news-pop-name');
        const count = Number(dash()?.feedWatch?.watchFor(bookmark)?.newCount) || items.length;
        // The feed's name with its separator, so the compact line can drop both.
        const row = (item, i) => `<li><button type="button" class="feed-news-pop-item" data-pop-item="${i}">`
            + (item.image ? `<img class="feed-news-pop-thumb" src="${esc(item.image)}" alt="" decoding="async">` : '')
            + `<span class="feed-news-pop-text"><span class="feed-news-pop-title">${esc(item.title)}</span>`
            + `<span class="feed-news-pop-meta">${item.feedTitle ? `<span class="feed-news-pop-feed">${esc(item.feedTitle)} · </span>` : ''}`
            + `<span class="feed-news-pop-ago">${esc(ago(item.publishedAt || item.foundAt))}</span></span></span>`
            + `</button></li>`;
        // The line under the headlines: more to show here, or only on the site.
        const footer = (shown) => {
            const left = Math.max(0, waiting - shown);
            if (!left) return '';
            if (shown < Math.min(items.length, MAX_EXPANDED)) {
                return `<button type="button" class="feed-news-pop-more" data-pop-more aria-expanded="false">${esc(t('dashboard.feedWatchPopoverMore', '+{n} more', { n: left }))}</button>`;
            }
            return `<button type="button" class="feed-news-pop-more" data-pop-more-site>${esc(t('dashboard.feedWatchPopoverMoreOpenSite', '+{n} more · Open site', { n: left }))}</button>`;
        };
        let shown = Math.min(items.length, MAX_ITEMS);
        el.innerHTML = `<div class="feed-news-pop-head">`
            + `<button type="button" class="feed-news-pop-site" data-pop-site aria-label="${esc(t('dashboard.feedWatchPopoverOpenSite', 'Open {name}', { name: bookmark.name || bookmark.url }))}">`
            // The feed mark in front of the site's name: this is that site's feed.
            + `<svg class="feed-news-pop-glyph" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 5a14 14 0 0 1 14 14M5 11a8 8 0 0 1 8 8"/><circle cx="6" cy="18" r="1.4" fill="currentColor"/></svg>`
            + `<span class="feed-news-pop-name" id="feed-news-pop-name">${esc(bookmark.name || bookmark.url)}</span>`
            + `<span class="feed-news-pop-count">${esc(t('dashboard.feedWatchNewCount', '{n} new', { n: count }))}</span></button>`
            // Every unread headline of this site is read at once, without opening any.
            + `<button type="button" class="feed-news-pop-markread" data-pop-markread>${esc(t('dashboard.feedWatchPopoverMarkRead', 'Mark read'))}</button>`
            // The paper on this site alone, on a phone too.
            + `<button type="button" class="feed-news-pop-reader" data-pop-reader aria-label="${esc(t('dashboard.feedWatchPopoverReaderLabel', 'Open the reader for {name}', { name: bookmark.name || bookmark.url }))}">${esc(t('dashboard.feedWatchPopoverReader', 'Reader'))}</button>`
            + `<button type="button" class="feed-news-pop-close" data-pop-close aria-label="${esc(t('dashboard.close', 'Close'))}">×</button></div>`
            + (offer ? `<p class="feed-news-pop-offer">${esc(t('dashboard.feedWatchOffer', 'Watching this feed now. Here are its latest posts.'))}</p>` : '')
            + `<ul class="feed-news-pop-list">` + items.slice(0, shown).map(row).join('') + `</ul>`
            + footer(shown);
        // The rest of the headlines, in the same popover: it stays open, takes
        // the shape the longer list needs, and the cursor lands on the first
        // newcomer.
        const expand = (button) => {
            button.setAttribute('aria-expanded', 'true');
            const from = shown;
            shown = Math.min(items.length, MAX_EXPANDED);
            el.querySelector('.feed-news-pop-list').insertAdjacentHTML('beforeend', items.slice(from, shown).map((item, i) => row(item, from + i)).join(''));
            const next = footer(shown);
            if (next) button.outerHTML = next; else button.remove();
            if (popover?.el === el) layout(el, popover.badge);
            const first = el.querySelector(`[data-pop-item="${from}"]`);
            first?.focus({ preventScroll: true });
            first?.scrollIntoView({ block: 'nearest' });
        };
        el.addEventListener('click', (event) => {
            event.stopPropagation();
            if (event.target.closest('[data-pop-close]')) { close(); return; }
            if (event.target.closest('[data-pop-markread]')) {
                dash()?.feedWatch?.markSeen(bookmark);
                close();
                return;
            }
            if (event.target.closest('[data-pop-reader]')) {
                const focusKey = dash()?.feedWatch?.key(bookmark.url);
                close();
                void global.FeedWatchNews?.open({ focusKey, source: 'button' });
                return;
            }
            // The bar on top is the way on to the site itself, and so is what is
            // left once the popover holds all it can.
            if (event.target.closest('[data-pop-site], [data-pop-more-site]')) { openBookmark(bookmark); close(); return; }
            const moreButton = event.target.closest('[data-pop-more]');
            if (moreButton) { expand(moreButton); return; }
            const itemButton = event.target.closest('[data-pop-item]');
            if (!itemButton) return;
            const d = dash();
            const item = items[Number(itemButton.dataset.popItem)];
            if (item?.link) global.openUrl(item.link, d.settings);
            // Only the headline that was opened is read; the others stay new.
            if (item?.id && item.feedUrl) void d.feedWatch.markItems(bookmark.url, item.feedUrl, [item.id], true);
            else d.feedWatch.markSeen(bookmark);
            close();
        });
        return el;
    }

    /** Open (or close) the popover under a row's badge. */
    async function toggle(bookmark, badge, options = {}) {
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
        // What the entry counts, not what was loaded: more may be waiting.
        const waiting = Number(watch.watchFor(bookmark)?.newCount) || items.length;
        const el = build(bookmark, items, waiting, options.offer === true);
        document.body.appendChild(el);
        badge.setAttribute('aria-expanded', 'true');
        anchor(badge, true);
        const same = [...document.querySelectorAll('.bookmark-news-badge.is-tappable')]
            .filter((b) => b.closest('a')?.href === badge.closest('a')?.href);
        popover = { el, badge, key, bookmark, copy: Math.max(0, same.indexOf(badge)) };
        layout(el, badge);
        el.style.animation = still() ? 'none'
            : options.offer ? 'feed-news-pop-grow 340ms cubic-bezier(0.2, 1.25, 0.3, 1) both'
            : 'feed-news-pop-grow 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both';
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

    /**
     * Offer the popover for a bookmark without anyone tapping its badge: a feed
     * has just been added, and the entries it holds are news (the server seeds
     * the ten newest). Waits for the row to be drawn with its badge; when the
     * bookmark is not on this page there is no badge to point at and nothing
     * opens (the news paper is never opened unasked). Never opens the site
     * itself either: with no news waiting it does nothing.
     */
    async function openFor(bookmark) {
        const watch = dash()?.feedWatch;
        if (!watch || !bookmark?.url) return false;
        let target = '';
        try { target = new URL(bookmark.url, global.location.href).href; } catch { return false; }
        for (let tries = 0; tries < 40; tries += 1) {
            if (Number(watch.watchFor(bookmark)?.newCount) > 0) {
                // The bookmark's own place first: the same bookmark may also sit in
                // a smart collection (Today, Recent), which is a view of it.
                const copies = [...document.querySelectorAll('.bookmark-news-badge.is-tappable')]
                    .filter((b) => b.isConnected && b.closest('a')?.href === target);
                const badge = copies.find((b) => !String(b.closest('.bookmark-link')?.getAttribute('data-category-id') || '').startsWith('__smart'))
                    || copies[0];
                if (badge) {
                    // Only when it is off screen, and before the popover exists: a scroll
                    // while it is open closes it.
                    const box = badge.getBoundingClientRect();
                    if (box.top < 0 || box.bottom > global.innerHeight) {
                        badge.closest('a')?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
                        await new Promise((resolve) => global.requestAnimationFrame(() => global.requestAnimationFrame(resolve)));
                    }
                    await toggle(bookmark, badge, { offer: true });
                    return true;
                }
            }
            await new Promise((resolve) => global.setTimeout(resolve, 120));
        }
        return false;
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

    global.FeedWatchPopover = { isTouch, attach, close, openFor, isOpen: () => popover !== null || opening };
})(window);
