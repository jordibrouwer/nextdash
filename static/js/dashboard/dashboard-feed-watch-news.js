/**
 * The news window: what watched feeds published, one article at a time.
 *
 * A panel in the app's own modal, not a page of its own. One article is read at
 * a time with arrows beneath it. Buttons in the header switch to two columns (the
 * article large, the others beside it) or to a newspaper front page; the choice
 * is the feedWatchNewsView setting, which Config offers too. A thin bar under the
 * header runs down with the
 * time the news stays open; when it runs out the panel closes itself. That is
 * only so for news the window opened. Opened by hand (a push, a bookmark's card)
 * after the window ran out, the panel stays until it is closed and has no bar.
 *
 * The summary arrives as HTML the server has already reduced to a handful of
 * tags, which is the only reason it is inserted as markup. Titles and names
 * always go through the escaper.
 */
(function (global) {
    'use strict';

    const VIEWS = ['single', 'wide', 'paper'];
    const WIDE_QUERY = '(min-width: 721px)';

    let state = null;   // { items, index, wide, timer, timed }

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
        const view = VIEWS.includes(chosen) ? chosen : 'paper';
        return canBeWide() ? view : 'single';
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

    function articleHtml(item, { large }) {
        const image = item.image
            ? `<img class="feed-news-image" src="${esc(item.image)}" alt="" decoding="async">`
            : '';
        const link = item.link
            ? `<a class="feed-news-link" href="${esc(item.link)}" target="_blank" rel="noopener noreferrer" data-feed-news-article>${esc(item.title)}</a>`
            : esc(item.title);
        return `<article class="feed-news-article${large ? ' is-large' : ''}">${image}`
            + `<div class="feed-news-time">${esc([item.feedTitle, ago(item.publishedAt || item.foundAt)].filter(Boolean).join(' · '))}</div>`
            + `<h3 class="feed-news-title">${link}</h3>`
            + (item.summary ? `<div class="feed-news-summary">${item.summary}</div>` : '')
            + `</article>`;
    }

    /**
     * What is listed. One column stays with the new articles; the newspaper and
     * two-column views add the feeds' earlier entries after them.
     */
    function listed() {
        if (!state) return [];
        return currentView() === 'single' ? state.fresh : [...state.fresh, ...state.earlier];
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
        // One column has no index: it is the article, as it was.
        if (!wide) state.mode = 'article';
        if (!items.length) {
            root.innerHTML = `<p class="feed-news-empty">${esc(t('dashboard.feedWatchNothing', 'Nothing new from the feeds you watch'))}</p>`;
            return;
        }
        const item = items[state.index];
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
        const switcher = canBeWide()
            ? `<span class="feed-news-views" role="group" aria-label="${esc(t('dashboard.feedWatchView', 'View'))}">`
                + VIEWS.map((v) => `<button type="button" class="feed-news-view" data-feed-news-view="${v}" aria-pressed="${v === view}" aria-label="${esc(viewLabel(v))}" title="${esc(viewLabel(v))}">${VIEW_ICONS[v]}</button>`).join('')
                + `</span>`
            : '';

        const bar = !timed ? '' : `<div class="feed-news-bar" role="progressbar" aria-label="${esc(left)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct}%"></i></div>`;
        const closeButton = `<button type="button" class="feed-news-close" data-feed-news-close aria-label="${esc(t('dashboard.close', 'Close'))}">×</button>`;

        // The index: every item of the feeds you watch, headline by headline.
        if (state.mode === 'index' && total > 1) {
            let indexEarlierShown = false;
            const entries = items.map((entry, i) => (entry.earlier && !indexEarlierShown ? (indexEarlierShown = true, `<div class="feed-news-index-head">${esc(t('dashboard.feedWatchEarlier', 'Earlier from the feeds'))}</div>`) : '') + `<button type="button" class="feed-news-entry" data-feed-news-pick="${i}">`
                + (entry.image ? `<img class="feed-news-entry-image" src="${esc(entry.image)}" alt="" decoding="async">` : '')
                + `<span class="feed-news-entry-text"><span class="feed-news-entry-title">${esc(entry.title)}</span>`
                + `<span class="feed-news-entry-meta">${esc([entry.bookmarkName || entry.feedTitle, ago(entry.publishedAt || entry.foundAt)].filter(Boolean).join(' · '))}</span>`
                + (entry.summary ? `<span class="feed-news-entry-lead">${esc(plainLead(entry.summary))}</span>` : '')
                + `</span></button>`).join('');
            root.innerHTML = mast + `<div class="feed-news-head">`
                + `<span class="feed-news-site">${esc(t('dashboard.feedWatchNews', 'News'))}</span>`
                + `<span class="feed-news-chip">${esc(t('dashboard.feedWatchNewCount', '{n} new', { n: state.newCount ?? total }))}</span>`
                + switcher + closeButton + `</div>` + bar
                + `<div class="feed-news-body"><div class="feed-news-index${wide ? ' is-wide' : ''}">${entries}</div></div>`
                + (timed ? `<div class="feed-news-foot">${caption}</div>` : '');
            return;
        }

        const earlierHead = `<div class="feed-news-side-head">${esc(t('dashboard.feedWatchEarlier', 'Earlier from the feeds'))}</div>`;
        let earlierShown = false;
        const side = wide
            ? `<div class="feed-news-side" role="list">${items.map((other, i) => (i === state.index ? '' :
                (other.earlier && !earlierShown ? (earlierShown = true, earlierHead) : '') + `<button type="button" class="feed-news-card" role="listitem" data-feed-news-pick="${i}">`
                + (other.image ? `<img class="feed-news-card-image" src="${esc(other.image)}" alt="">` : '')
                + `<span class="feed-news-card-text"><span class="feed-news-card-title">${esc(other.title)}</span>`
                + `<span class="feed-news-card-time">${esc([other.bookmarkName, ago(other.publishedAt || other.foundAt)].filter(Boolean).join(' · '))}</span></span>`
                + `</button>`)).join('')}</div>`
            : '';

        root.innerHTML = mast + `<div class="feed-news-head">`
            + `<span class="feed-news-site">${esc(item.bookmarkName || item.feedTitle || '')}</span>`
            + `<span class="feed-news-chip" data-feed-news-chip>${esc(t('dashboard.feedWatchCounter', '{n} of {total}', { n: state.index + 1, total }))}</span>`
            + switcher
            + closeButton
            + `</div>`
            + bar
            + `<div class="feed-news-body${wide ? ' is-wide' : ''}">`
            + `<div class="feed-news-main">${articleHtml(item, { large: wide })}</div>${side}</div>`
            + `<div class="feed-news-foot">`
            + (total > 1 && wide ? `<button type="button" class="modal-button" data-feed-news-index><span class="modal-button-name">${esc(t('dashboard.feedWatchIndex', 'Index'))}</span></button>` : '')
            + `<button type="button" class="modal-button" data-feed-news-step="-1" aria-label="${esc(t('dashboard.feedWatchPrev', 'Previous'))}"><span class="modal-button-name">‹</span></button>`
            + `<button type="button" class="modal-button" data-feed-news-step="1" aria-label="${esc(t('dashboard.feedWatchNext', 'Next'))}"><span class="modal-button-name">›</span></button>`
            + caption
            + `<button type="button" class="modal-button feed-news-open" data-feed-news-open><span class="modal-button-name">${esc(t('dashboard.feedWatchOpenPage', 'Open page'))}</span></button>`
            + `</div>`;
    }

    /** Update only the bar and its caption, so the 1-second tick never rebuilds the article. */
    function tick() {
        const root = document.querySelector('[data-feed-news]');
        const watch = dash()?.feedWatch;
        if (!root || !state || !watch) return;
        // Only news the window opened is on its clock.
        if (!state.timed) return;
        if (watch.windowPhase() === 'closed') { close(); return; }
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

    function step(delta) {
        const items = listed();
        if (!items.length) return;
        state.index = (state.index + delta + items.length) % items.length;
        render();
    }

    function openBookmarkOf(item) {
        const d = dash();
        const bookmark = (d?.allBookmarks || []).find((b) => d.feedWatch.key(b.url) === item.bookmarkKey);
        const url = item.bookmarkUrl || bookmark?.url;
        if (!url) return;
        if (bookmark) d.recordBookmarkOpened?.(bookmark, undefined, 'feed-news');
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    function onKey(event) {
        if (!state || !document.querySelector('[data-feed-news]')) return;
        if (event.key === 'Escape' && state.mode === 'article' && currentView() !== 'single' && listed().length > 1) {
            // From an article, Esc goes back to the index; from the index it closes.
            event.preventDefault();
            event.stopImmediatePropagation();
            state.mode = 'index';
            render();
        } else if (event.key === 'ArrowRight' && state.mode === 'article') {
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
        const stepButton = target.closest('[data-feed-news-step]');
        if (stepButton) { step(Number(stepButton.dataset.feedNewsStep)); return; }
        const pick = target.closest('[data-feed-news-pick]');
        if (pick) { state.index = Number(pick.dataset.feedNewsPick) || 0; state.mode = 'article'; render(); return; }
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
            // The link opens itself in a new tab; the bookmark is marked read.
            const item = listed()[state.index];
            const bookmark = (dash()?.allBookmarks || []).find((b) => dash().feedWatch.key(b.url) === item?.bookmarkKey);
            if (bookmark) dash().feedWatch.markSeen(bookmark);
        }
    }

    /**
     * @param {{focusKey?: string, focusItemId?: string}} [options]
     */
    async function open({ focusKey = '', focusItemId = '' } = {}) {
        const watch = dash()?.feedWatch;
        if (!watch) return;
        const { items: fresh, earlier } = await watch.news(focusKey);
        const newCount = fresh.length;
        const everything = currentView() === 'single' ? fresh : [...fresh, ...earlier];
        const start = focusItemId ? Math.max(0, everything.findIndex((i) => i.id === focusItemId)) : 0;
        const startMode = currentView() !== 'single' && everything.length > 1 && !focusItemId ? 'index' : 'article';
        // Already showing (a push landed on ?news=1 and the toast was clicked
        // too): refill it in place. Showing the panel again would replace the
        // one on screen and run its close handler on the new state.
        if (state && document.querySelector('[data-feed-news]')) {
            state.fresh = fresh;
            state.earlier = earlier;
            state.newCount = newCount;
            state.index = start;
            state.mode = startMode;
            render();
            return;
        }
        // A feed with several items opens on its index; one asked for by item, or a
        // single one, opens on the article.
        const phase = watch.windowPhase();
        state = { fresh, earlier, newCount, index: start, mode: startMode, timed: phase === 'open' || phase === 'pending' };

        global.AppModal.show({
            title: t('dashboard.feedWatchNews', 'News'),
            htmlMessage: '<div class="feed-news" data-feed-news></div>',
            showCancel: false,
            modalClass: 'feed-news-modal',
            initialFocusSelector: '[data-feed-news-open]',
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

    global.FeedWatchNews = { open, close, isOpen: () => state !== null };
})(window);
