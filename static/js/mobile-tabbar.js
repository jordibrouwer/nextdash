/**
 * The phone's bottom tab bar, its Status and More screens, and the two start
 * screens (mobile-experience.css has the look).
 *
 * Phone layout only (MobileExperience.isPhoneLayout): a tablet and a desktop
 * never get any of this. The bar replaces the old footer, which held search and
 * add. Home is the grid; Search opens the search overlay; Inbox is the Inbox
 * view; Status and More are screens of their own, drawn in place of the grid.
 *
 * Home opens with one of two heads, chosen per device by `mobileHome`:
 *   search  a big search field, the state of things as one line
 *   status  "is everything fine?" first, search compact below it
 */
(function () {
    'use strict';

    const BAR_ID = 'mobile-tabbar';
    const PANEL_ID = 'mobile-panel';
    const HOME_ID = 'mobile-home';
    const CERT_WARN_DAYS = 14;

    let panel = null; // null | 'status' | 'more'
    let quiet = null; // last answer of /api/notify/quiet
    let timer = null;
    let observer = null;

    function dash() { return window.dashboardInstance || null; }

    function isPhone() { return window.MobileExperience?.isPhoneLayout?.() === true; }

    function esc(value) {
        const html = window.NextDashHtml;
        return html?.escapeHtml ? html.escapeHtml(String(value ?? '')) : String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    }

    function t(key, fallback, vars) {
        let text = fallback;
        const value = dash()?.language?.t?.(key);
        if (value && value !== key) text = value;
        return vars ? Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), text) : text;
    }

    const ICON = {
        home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8M5 10v10h14V10"/></svg>',
        search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
        inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5"/></svg>',
        status: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
        more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    };

    // ── what the counters and the Status screen read ─────────────────────

    function inboxCount() {
        const d = dash();
        return d?.inbox?.isEnabled?.() ? Number(d.inbox.unreadCount?.() || 0) : 0;
    }

    /** Monitored bookmarks, each with a state: bad (down), warn (certificate near its end), ok. */
    function services() {
        const d = dash();
        const facts = window.HealthFacts;
        const now = Date.now();
        const seen = new Set();
        const out = [];
        (d?.allBookmarks || d?.bookmarks || []).forEach((b) => {
            if (!b?.monitor) return;
            const key = facts?.keyFor?.(b.url) || b.url;
            if (seen.has(key)) return;
            seen.add(key);
            const f = facts?.get?.(b.url) || null;
            let state = 'ok';
            let detail = f?.uptime24h != null
                ? t('mobile.status.uptime', '{pct}% up in 24 h', { pct: (f.uptime24h * 100).toFixed(f.uptime24h >= 0.999 ? 1 : 0) })
                : t('mobile.status.noSamples', 'No checks yet');
            if (f?.downSince > 0) {
                state = 'bad';
                detail = f.lastError || t('mobile.status.down', 'Not responding');
            } else if (f?.certExpiresAt && f.certExpiresAt - now < CERT_WARN_DAYS * 864e5) {
                state = 'warn';
                const days = Math.max(0, Math.ceil((f.certExpiresAt - now) / 864e5));
                detail = t('mobile.status.cert', 'Certificate expires in {days} days', { days });
            }
            out.push({ name: String(b.title || b.name || b.url || ''), url: b.url, state, detail });
        });
        const rank = { bad: 0, warn: 1, ok: 2 };
        return out.sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name));
    }

    /** What the Status tab counts: services down plus those whose own expectation failed. */
    function statusCount() {
        const s = dash()?.healthSummary;
        return Number(s?.monitorDownCount || 0) + Number(s?.contentCount || 0);
    }

    function pausedUntil() {
        const until = Number(quiet?.pausedUntil || 0);
        return until > Date.now() ? until : 0;
    }

    function clock(ms) {
        try {
            return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (_e) {
            return '';
        }
    }

    // ── the bar ──────────────────────────────────────────────────────────

    function activeTab() {
        if (panel === 'guide') return 'more';
        if (panel) return panel;
        const view = dash()?.activeView;
        if (view === 'inbox') return 'inbox';
        if (view === 'bookmarks') return 'home';
        return '';
    }

    function badge(n) {
        return n > 0 ? `<span class="mobile-tab-badge">${n > 99 ? '99+' : n}</span>` : '';
    }

    function renderBar() {
        let bar = document.getElementById(BAR_ID);
        if (!bar) {
            bar = document.createElement('nav');
            bar.id = BAR_ID;
            bar.className = 'mobile-tabbar';
            bar.addEventListener('click', onBarClick);
            document.body.appendChild(bar);
        }
        bar.setAttribute('aria-label', t('mobile.tabs.label', 'Main navigation'));
        const current = activeTab();
        const tabs = [
            ['home', t('mobile.tabs.home', 'Home'), 0],
            ['search', t('mobile.tabs.search', 'Search'), 0],
            ...(dash()?.inbox?.isEnabled?.() ? [['inbox', t('mobile.tabs.inbox', 'Inbox'), inboxCount()]] : []),
            ['status', t('mobile.tabs.status', 'Status'), statusCount()],
            ['more', t('mobile.tabs.more', 'More'), 0],
        ];
        bar.style.setProperty('--mobile-tab-count', String(tabs.length));
        bar.innerHTML = tabs.map(([id, label, n]) => `
            <button type="button" data-tab="${id}"${current === id ? ' aria-current="page"' : ''}>
                <span class="mobile-tab-icon">${ICON[id]}${badge(n)}</span>
                <span class="mobile-tab-label">${esc(label)}</span>
            </button>`).join('');
    }

    /** The footer's add button went with the footer; this brings it back on the grid. */
    function renderFab() {
        let fab = document.getElementById('mobile-fab');
        const shown = isPhone() && !panel && dash()?.activeView === 'bookmarks';
        if (!shown) {
            fab?.remove();
            return;
        }
        if (fab) return;
        fab = document.createElement('button');
        fab.type = 'button';
        fab.id = 'mobile-fab';
        fab.className = 'mobile-fab';
        fab.textContent = '+';
        fab.setAttribute('aria-label', t('dashboard.tooltipAddBookmark', 'Add bookmark'));
        fab.addEventListener('click', () => document.getElementById('quick-add-toolbar-btn')?.click());
        document.body.appendChild(fab);
    }

    async function onBarClick(event) {
        const button = event.target.closest('button[data-tab]');
        if (!button) return;
        const d = dash();
        if (!d) return;
        const tab = button.getAttribute('data-tab');
        if (tab === 'search') {
            closePanel();
            document.getElementById('search-button')?.click();
            return;
        }
        if (tab === 'status' || tab === 'more') {
            if (d.activeView !== 'bookmarks') await goHome();
            openPanel(tab);
            return;
        }
        closePanel();
        if (tab === 'inbox') {
            await d.inbox?.openInboxView?.();
        } else {
            await goHome();
        }
        sync();
    }

    /** Back to the grid from any other view. */
    async function goHome() {
        const d = dash();
        if (!d) return;
        if (d.activeView !== 'bookmarks') await d.pageNav?.requestPageNavigation?.(d.currentPageId);
    }

    // ── the two screens ──────────────────────────────────────────────────

    function openPanel(name) {
        panel = name;
        if (name === 'status') void refreshQuiet();
        renderPanel();
        sync();
        window.scrollTo?.(0, 0);
    }

    function closePanel() {
        if (!panel) return;
        panel = null;
        document.getElementById(PANEL_ID)?.remove();
        sync();
    }

    /** News from watched feeds: the News button is a desktop control, so the phone gets it here. */
    function newsCard() {
        const watch = dash()?.feedWatch;
        if (!watch || !window.FeedWatchNews?.open) return '';
        const watched = [...(watch.byKey?.values?.() || [])].some((entry) => (entry.feeds || [])
            .some((f) => f.paused !== true && f.retired !== true));
        if (!watched) return '';
        const unread = Number(watch.unreadTotal?.() ?? watch.totalNew?.()) || 0;
        return `<div class="mobile-card">
            <h3 class="mobile-card-title">${esc(t('mobile.news.title', 'Watched feeds'))}</h3>
            <p class="mobile-note">${esc(unread > 0
                ? t('mobile.news.unread', '{n} unread from the feeds you watch.', { n: unread })
                : t('mobile.news.none', 'Nothing new from the feeds you watch.'))}</p>
            <button type="button" class="mobile-btn mobile-btn--ghost" data-open-news>${esc(t('mobile.news.open', 'Open the news'))}</button>
        </div>`;
    }

    function statusScreen() {
        const list = services();
        const bad = list.filter((s) => s.state === 'bad').length;
        const warn = list.filter((s) => s.state === 'warn').length;
        const until = pausedUntil();
        const rows = list.length
            ? list.map((s) => `
                <div class="mobile-row" data-status-row data-bookmark-url="${esc(s.url)}">
                    <i class="mobile-dot mobile-dot--${s.state}" aria-hidden="true"></i>
                    <div class="mobile-row-text"><b>${esc(s.name)}</b><small>${esc(s.detail)}</small></div>
                </div>`).join('')
            : `<p class="mobile-note">${esc(t('mobile.status.none', 'No monitored services yet. Turn on monitoring on a bookmark and it shows up here.'))}</p>`;
        const summary = bad || warn
            ? t('mobile.status.summaryBad', '{n} need attention', { n: bad + warn })
            : t('mobile.status.summaryOk', 'Everything is fine');
        return `
            <h2 class="mobile-h">${esc(t('mobile.tabs.status', 'Status'))}</h2>
            <p class="mobile-lede">${esc(list.length ? summary : '')}</p>
            <div class="mobile-card">${rows}</div>
            ${newsCard()}
            <div class="mobile-card">
                <h3 class="mobile-card-title">${esc(t('mobile.pause.title', 'Notifications'))}</h3>
                ${until
                    ? `<p class="mobile-note">${esc(t('mobile.pause.until', 'Paused until {time}. They are held and summed up afterwards.', { time: clock(until) }))}</p>
                       <button type="button" class="mobile-btn" data-pause="off">${esc(t('mobile.pause.resume', 'Resume notifications'))}</button>`
                    : `<div class="mobile-btn-row">
                           <button type="button" class="mobile-btn mobile-btn--ghost" data-pause="hour">${esc(t('mobile.pause.hour', 'Pause for 1 hour'))}</button>
                           <button type="button" class="mobile-btn mobile-btn--ghost" data-pause="tomorrow">${esc(t('mobile.pause.tomorrow', 'Until tomorrow'))}</button>
                       </div>`}
            </div>`;
    }

    function isDarkNow() {
        const theme = String(dash()?.settings?.theme || 'dark');
        return !(theme.endsWith('-light') || theme === 'light');
    }

    function moreScreen() {
        const d = dash();
        const s = d?.settings || {};
        const sw = (key, label, on) => `
            <div class="mobile-toggle"><span>${esc(label)}</span>
                <button type="button" class="mobile-switch" role="switch" data-toggle="${key}" aria-checked="${on}" aria-label="${esc(label)}"></button></div>`;
        const home = s.mobileHome === 'status' ? 'status' : 'search';
        return `
            <h2 class="mobile-h">${esc(t('mobile.tabs.more', 'More'))}</h2>
            <div class="mobile-card">
                <h3 class="mobile-card-title">${esc(t('mobile.more.quick', 'Quick settings'))}</h3>
                ${sw('dark', t('mobile.more.dark', 'Dark mode'), isDarkNow())}
                ${sw('compact', t('mobile.more.compact', 'Compact widgets'), s.densityMode === 'compact' || s.densityMode === 'dense')}
                ${sw('pause', t('mobile.more.pause', 'Pause notifications'), pausedUntil() > 0)}
            </div>
            <div class="mobile-card">
                <h3 class="mobile-card-title">${esc(t('mobile.more.home', 'Start screen'))}</h3>
                <div class="mobile-seg" role="group" aria-label="${esc(t('mobile.more.home', 'Start screen'))}">
                    <button type="button" data-home="search" aria-pressed="${home === 'search'}">${esc(t('mobile.more.homeSearch', 'Search first'))}</button>
                    <button type="button" data-home="status" aria-pressed="${home === 'status'}">${esc(t('mobile.more.homeStatus', 'Status first'))}</button>
                </div>
            </div>
            <div class="mobile-card">
                <button type="button" class="mobile-btn mobile-btn--ghost" data-open-guide>${esc(t('mobile.guide.title', 'What works on a phone'))}</button>
            </div>
            <div class="mobile-card">
                <h3 class="mobile-card-title">${esc(t('mobile.more.desktopTitle', 'Only on desktop'))}</h3>
                <p class="mobile-note">${esc(t('mobile.more.desktopText', 'Structure, container management, data and backups. Send yourself the link and open it on a computer.'))}</p>
                <button type="button" class="mobile-btn mobile-btn--ghost" data-share-desktop>${esc(t('mobile.more.send', 'Send the link to myself'))}</button>
            </div>`;
    }

    /** The phone's cheat sheet: what works here, and what needs a desktop. */
    function guideScreen() {
        const list = (items) => `<ul class="mobile-guide-list">${items.map(([name, text]) => `<li><b>${esc(name)}</b><span>${esc(text)}</span></li>`).join('')}</ul>`;
        const here = [
            [t('mobile.guide.search', 'Search'), t('mobile.guide.searchText', 'The Search tab finds bookmarks, runs commands (start with :), finders (!), tags (#) and recents (*).')],
            [t('mobile.guide.pages', 'Pages'), t('mobile.guide.pagesText', 'Swipe left or right on a page to go to the next or previous one.')],
            [t('mobile.guide.menu', 'Bookmark menu'), t('mobile.guide.menuText', 'Press and hold a bookmark for its menu: edit, tags, move, watch its feed.')],
            [t('mobile.guide.inbox', 'Inbox'), t('mobile.guide.inboxText', 'Read, keep, or file the links that arrived. The + button adds a bookmark.')],
            [t('mobile.guide.status', 'Status'), t('mobile.guide.statusText', 'See which monitored services are fine, read the news from feeds you watch, and pause notifications for an hour or until tomorrow.')],
            [t('mobile.guide.more', 'More'), t('mobile.guide.moreText', 'Dark mode, compact widgets, the start screen, and this guide.')],
            [t('mobile.guide.visibility', 'Per block'), t('mobile.guide.visibilityText', 'A block can be set to show on the phone only, or on the desktop only.')],
        ];
        const desktop = [
            [t('mobile.guide.quickstart', 'The quick start'), t('mobile.guide.quickstartText', 'Go through it once on a computer.')],
            [t('mobile.guide.edit', 'Editing the dashboard'), t('mobile.guide.editText', 'Edit mode, moving blocks, categories and widgets, and choosing where a block shows.')],
            [t('mobile.guide.config', 'Most of Config'), t('mobile.guide.configText', 'Structure, themes and the theme studio, containers, data and backups, integrations.')],
            [t('mobile.guide.keys', 'Keyboard shortcuts'), t('mobile.guide.keysText', 'Shortcuts, the finder shortcuts and the full cheat sheet need a keyboard.')],
            [t('mobile.guide.assistant', 'The assistant'), t('mobile.guide.assistantText', 'Open nextDash on a computer to use it.')],
        ];
        return `
            <button type="button" class="mobile-back" data-back-more>&larr; ${esc(t('mobile.tabs.more', 'More'))}</button>
            <h2 class="mobile-h">${esc(t('mobile.guide.title', 'What works on a phone'))}</h2>
            <div class="mobile-card"><h3 class="mobile-card-title">${esc(t('mobile.guide.here', 'On your phone'))}</h3>${list(here)}</div>
            <div class="mobile-card"><h3 class="mobile-card-title">${esc(t('mobile.guide.desktop', 'Needs a desktop'))}</h3>${list(desktop)}</div>`;
    }

    function renderPanel() {
        if (!panel) return;
        let el = document.getElementById(PANEL_ID);
        if (!el) {
            el = document.createElement('section');
            el.id = PANEL_ID;
            el.className = 'mobile-panel';
            el.addEventListener('click', onPanelClick);
            const layout = document.getElementById('dashboard-layout');
            if (layout?.parentNode) layout.parentNode.insertBefore(el, layout);
            else document.body.appendChild(el);
        }
        el.setAttribute('aria-label', panel === 'status' ? t('mobile.tabs.status', 'Status') : t('mobile.tabs.more', 'More'));
        el.innerHTML = panel === 'status' ? statusScreen() : panel === 'guide' ? guideScreen() : moreScreen();
        // A press and hold on a service opens the bookmark's short menu.
        if (panel === 'status') el.querySelectorAll('.mobile-row[data-bookmark-url]').forEach((r) => dash()?.contextMenu?.bindRow?.(r));
    }

    async function postPause(mode) {
        const fetcher = typeof window.nextDashFetch === 'function' ? window.nextDashFetch : fetch;
        const headers = { 'Content-Type': 'application/json' };
        if (typeof window.nextDashWriteHeaders === 'function') Object.assign(headers, window.nextDashWriteHeaders());
        try {
            const res = await fetcher('/api/notify/pause', { method: 'POST', headers, body: JSON.stringify({ mode }) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            quiet = { ...(quiet || {}), pausedUntil: Number(body.pausedUntil) || 0 };
            return true;
        } catch (_e) {
            dash()?.showErrorNotification?.(t('mobile.pause.failed', 'Could not change the pause.'));
            return false;
        }
    }

    async function refreshQuiet() {
        try {
            const res = await fetch('/api/notify/quiet', { cache: 'no-store' });
            if (res.ok) quiet = await res.json();
        } catch (_e) { /* the screen shows no pause */ }
        if (panel) renderPanel();
    }

    async function setDark(on) {
        const d = dash();
        try {
            const cfg = await d.config.load();
            cfg.setQuickMode(on ? 'dark' : 'light');
        } catch (_e) {
            d?.showErrorNotification?.(t('mobile.more.darkFailed', 'Could not switch the theme.'));
        }
    }

    async function setCompact(on) {
        const d = dash();
        d.settings.densityMode = on ? 'compact' : 'auto';
        d.setupDOM?.();
        await d.saveSettings?.();
    }

    async function setHome(value) {
        const d = dash();
        d.settings.mobileHome = value === 'status' ? 'status' : 'search';
        // Device-specific mode keeps it in this browser; otherwise it is saved like any setting.
        await d.saveSettings?.();
        renderHome();
    }

    async function shareDesktopLink() {
        const url = `${window.location.origin}/#structure`;
        const title = t('mobile.more.shareTitle', 'nextDash on desktop');
        try {
            if (navigator.share) {
                await navigator.share({ title, url });
                return;
            }
            await navigator.clipboard.writeText(url);
            dash()?.showNotification?.(t('mobile.more.copied', 'Link copied.'), 'success');
        } catch (_e) { /* the share sheet was dismissed */ }
    }

    async function onPanelClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const pause = target.closest('[data-pause]');
        if (pause) {
            if (await postPause(pause.getAttribute('data-pause'))) renderPanel();
            return;
        }
        const toggle = target.closest('[data-toggle]');
        if (toggle) {
            const key = toggle.getAttribute('data-toggle');
            const on = toggle.getAttribute('aria-checked') !== 'true';
            toggle.setAttribute('aria-checked', String(on));
            if (key === 'dark') await setDark(on);
            else if (key === 'compact') await setCompact(on);
            else if (key === 'pause') await postPause(on ? 'hour' : 'off');
            renderPanel();
            return;
        }
        const home = target.closest('[data-home]');
        if (home) {
            await setHome(home.getAttribute('data-home'));
            renderPanel();
            return;
        }
        if (target.closest('[data-open-news]')) { void window.FeedWatchNews?.open?.({ source: 'button' }); return; }
        if (target.closest('[data-open-guide]')) { openPanel('guide'); return; }
        if (target.closest('[data-back-more]')) { openPanel('more'); return; }
        if (target.closest('[data-share-desktop]')) await shareDesktopLink();
    }

    // ── the start screen ─────────────────────────────────────────────────

    function homeShown() {
        const d = dash();
        return isPhone() && !panel && d?.activeView === 'bookmarks';
    }

    function statusLine() {
        const list = services();
        const attention = list.filter((s) => s.state !== 'ok').length;
        const ok = list.length - attention;
        return { list, attention, ok };
    }

    /** The bookmarks opened last, newest first, as a row of links. */
    function recentChips(limit = 4) {
        const d = dash();
        const seen = new Set();
        const list = (d?.allBookmarks || [])
            .filter((b) => b?.url && Number(b.lastOpened) > 0)
            .sort((a, b) => Number(b.lastOpened) - Number(a.lastOpened))
            .filter((b) => (seen.has(b.url) ? false : seen.add(b.url)))
            .slice(0, limit);
        if (!list.length) return '';
        const target = d?.settings?.openLinksNewTabMobile === true ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<nav class="mobile-chips mobile-recent" aria-label="${esc(t('mobile.home.recent', 'Recently opened'))}">${list.map((b) => {
            let href = '';
            try {
                const u = new URL(b.url, window.location.href);
                if (/^https?:$/.test(u.protocol)) href = u.href;
            } catch (_e) { /* not a link */ }
            return href ? `<a class="mobile-chip" href="${esc(href)}"${target}>${esc(String(b.title || b.name || b.url))}</a>` : '';
        }).join('')}</nav>`;
    }

    /** The quick start waits for a desktop: say so, in the page, where a toast would be hidden. */
    function quickStartNotice() {
        const qs = dash()?.quickStart;
        if (!qs?.shouldStart?.()) return '';
        return `<div class="mobile-notice" role="note">
            <b>${esc(t('mobile.quickstart.title', 'Finish the quick start on a desktop first'))}</b>
            <span>${esc(t('mobile.quickstart.text', 'The quick start has choices and first steps that need a bigger screen. Open nextDash on a computer, go through it once, and this phone is ready.'))}</span>
        </div>`;
    }

    function renderHome() {
        const layout = document.getElementById('dashboard-layout');
        let el = document.getElementById(HOME_ID);
        if (!homeShown() || !layout?.parentNode) {
            el?.remove();
            return;
        }
        if (!el) {
            el = document.createElement('section');
            el.id = HOME_ID;
            el.className = 'mobile-home';
            el.addEventListener('click', (e) => {
                if (e.target.closest('[data-home-search]')) document.getElementById('search-button')?.click();
                else if (e.target.closest('[data-home-status]')) openPanel('status');
            });
        }
        if (el.nextElementSibling !== layout) layout.parentNode.insertBefore(el, layout);
        const variant = dash()?.settings?.mobileHome === 'status' ? 'status' : 'search';
        el.setAttribute('data-variant', variant);
        const { list, attention, ok } = statusLine();
        const searchLabel = t('mobile.home.search', 'Search bookmarks, actions, services');
        const pill = list.length
            ? `<button type="button" class="mobile-pill mobile-pill--${attention ? 'warn' : 'ok'}" data-home-status>${esc(attention
                ? t('mobile.home.attention', '{n} need attention', { n: attention })
                : t('mobile.home.fine', 'All services fine'))}</button>`
            : '';
        if (variant === 'search') {
            el.innerHTML = `
                ${quickStartNotice()}
                <button type="button" class="mobile-search mobile-search--big" data-home-search>${ICON.search}<span>${esc(searchLabel)}</span></button>
                ${recentChips()}
                ${pill}`;
            return;
        }
        const pct = list.length ? Math.round((ok / list.length) * 100) : 100;
        el.innerHTML = quickStartNotice() + (list.length
            ? `<button type="button" class="mobile-statuscard" data-home-status>
                   <small>${esc(t('mobile.home.services', 'Services'))}</small>
                   <b>${esc(t('mobile.home.count', '{ok} of {total} fine', { ok, total: list.length }))}</b>
                   <span class="mobile-meter" aria-hidden="true"><i class="is-ok" style="width:${pct}%"></i><i class="is-warn" style="width:${100 - pct}%"></i></span>
               </button>
               <button type="button" class="mobile-search" data-home-search>${ICON.search}<span>${esc(t('mobile.tabs.search', 'Search'))}</span></button>`
            : `<button type="button" class="mobile-search mobile-search--big" data-home-search>${ICON.search}<span>${esc(searchLabel)}</span></button>`);
    }

    // ── the first time swiping between pages is possible ─────────────────

    const SWIPE_HINT_ID = 'mobile-page-swipe-hint-v1';
    let swipeHintTimer = null;

    function closeSwipeHint() {
        clearTimeout(swipeHintTimer);
        swipeHintTimer = null;
        document.getElementById('mobile-swipe-hint')?.remove();
        document.removeEventListener('nextdash:page-switched', closeSwipeHint);
    }

    /** One popover under the page name, once: with more than one page, a swipe changes it. */
    function maybeShowSwipeHint() {
        const d = dash();
        if (!isPhone() || panel || d?.activeView !== 'bookmarks') return;
        if (!(d.pages?.length > 1)) return;
        if (window.DiscoverabilityState?.hasSeenSettingPromo?.(SWIPE_HINT_ID)) return;
        if (document.getElementById('mobile-swipe-hint') || swipeHintTimer) return;
        // Not over the quick-start card, nor while the search sheet is open.
        if (document.querySelector('#mobile-home .mobile-notice, #shortcut-search.show')) return;
        swipeHintTimer = setTimeout(() => {
            swipeHintTimer = null;
            const title = document.querySelector('.title');
            if (!isPhone() || panel || !title || d.activeView !== 'bookmarks') return;
            window.DiscoverabilityState?.markSettingPromoSeen?.(SWIPE_HINT_ID);
            const rect = title.getBoundingClientRect();
            const pop = document.createElement('div');
            pop.id = 'mobile-swipe-hint';
            pop.className = 'mobile-swipe-hint';
            pop.setAttribute('role', 'status');
            pop.innerHTML = `<b>${esc(t('mobile.swipe.title', 'Swipe to change page'))}</b><span>${esc(t('mobile.swipe.text', 'Swipe left or right anywhere on the page to go to the next or previous page.'))}</span>`;
            pop.style.top = `${Math.round(rect.bottom + 10)}px`;
            pop.style.right = `${Math.max(8, Math.round(window.innerWidth - rect.right))}px`;
            pop.addEventListener('click', closeSwipeHint);
            document.body.appendChild(pop);
            document.addEventListener('nextdash:page-switched', closeSwipeHint);
            setTimeout(closeSwipeHint, 9000);
        }, 1800);
    }

    // ── wiring ───────────────────────────────────────────────────────────

    function sync() {
        const phone = isPhone();
        document.body.toggleAttribute('data-mobile-tabbar', phone);
        if (!phone) {
            panel = null;
            document.getElementById(BAR_ID)?.remove();
            document.getElementById(PANEL_ID)?.remove();
            document.getElementById(HOME_ID)?.remove();
            document.getElementById('mobile-fab')?.remove();
            document.body.removeAttribute('data-mobile-panel');
            stopTimer();
            return;
        }
        // A phone has no Escape: the palette gets a close button of its own.
        const close = document.getElementById('search-close-mobile');
        if (close) {
            close.hidden = !phone;
            if (!close.dataset.bound) {
                close.dataset.bound = '1';
                close.addEventListener('click', () => dash()?.searchComponent?.closeSearch?.());
            }
        }
        const field = document.getElementById('search-input-mobile');
        if (field) field.setAttribute('placeholder', t('mobile.search.placeholder', 'Search, or start with : ! # for more'));
        if (panel) document.body.setAttribute('data-mobile-panel', panel);
        else document.body.removeAttribute('data-mobile-panel');
        renderBar();
        renderHome();
        renderFab();
        if (panel) renderPanel();
        startTimer();
        maybeShowSwipeHint();
    }

    function startTimer() {
        if (timer) return;
        // Counters read what the page already holds; a cheap look now and then keeps them true.
        timer = setInterval(() => { if (isPhone()) { renderBar(); if (panel === 'status') renderPanel(); renderHome(); } }, 15000);
    }

    function stopTimer() {
        clearInterval(timer);
        timer = null;
    }

    function init() {
        sync();
        if (observer) return;
        // Any route to another view (a link, a key, the header) moves the highlight.
        observer = new MutationObserver(() => {
            if (!isPhone()) return;
            if (panel && dash()?.activeView !== 'bookmarks') panel = null;
            sync();
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-active-view'] });
        // Counters change when the Inbox or the health report do.
        const inboxBadge = document.getElementById('page-inbox-badge');
        if (inboxBadge) new MutationObserver(() => { if (isPhone()) renderBar(); }).observe(inboxBadge, { childList: true, attributes: true, characterData: true, subtree: true });
        document.addEventListener('visibilitychange', () => { if (!document.hidden && isPhone()) { renderBar(); renderHome(); } });
        // The grid is rebuilt by renders; the head goes back above it.
        const layout = document.getElementById('dashboard-layout');
        if (layout) new MutationObserver(() => { if (isPhone() && homeShown() && !document.getElementById(HOME_ID)) renderHome(); }).observe(layout.parentNode, { childList: true });
    }

    // Starts once the dashboard exists and has its page navigation.
    function whenReady() {
        let tries = 0;
        const wait = setInterval(() => {
            tries += 1;
            if (dash()?.pageNav && dash()?.inbox) {
                clearInterval(wait);
                init();
            } else if (tries > 100) {
                clearInterval(wait);
            }
        }, 200);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', whenReady);
    else whenReady();

    /** The phone's cheat sheet, from anywhere: the :cheat command, Config -> Help, a key hint. */
    async function openGuide() {
        const d = dash();
        if (!d) return;
        d.searchComponent?.closeSearch?.();
        if (d.activeView !== 'bookmarks') await goHome();
        openPanel('guide');
    }

    window.MobileTabbar = { openGuide, init, sync, openPanel, closePanel, services, statusCount };
})();
