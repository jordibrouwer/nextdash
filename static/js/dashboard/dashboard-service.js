'use strict';
/**
 * The Service overview (#service): one screen for one service.
 *
 * A service is not stored. It is a bookmark (the anchor), the container the
 * browser matched to it (DockerSearchIndex.bookmarkFor / containersFor, which
 * need the hostname only the browser knows) and what GET /api/service gathers
 * for that address: health history, network checks, watched feeds, the
 * container's state and one merged timeline.
 *
 * Four things are fetched by the page itself, never by GET /api/service, and
 * each only when it is asked for or in view: the logs (after the strip is
 * opened), the GitHub releases (after a click on the button), the stats of the
 * container (while its section is on screen and the tab is visible) and the
 * note, which is written back with the Bookmarks panel's own PATCH.
 *
 * Nothing reaches outside nextDash on its own: opening the page, and the live
 * refresh, never ask for /changelog. Logs, env and healthcheck output are not
 * in the aggregate at all.
 */
(function () {
    const VIEW = 'service';
    const POLL_MS = 30_000;
    const LIVE_COALESCE_MS = 1000;
    const STATS_MS = 10_000;
    const STATS_KEEP = 400;
    // How long another host's container list is reused: a poll is 30 s, an event may come sooner.
    const REMOTE_LIST_MS = 15_000;
    const REMOTE_TIMEOUT_MS = 4000;

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null && text !== '') node.textContent = String(text);
        return node;
    }

    function button(label, cls, onClick, attrs = {}) {
        const b = el('button', cls, label);
        b.type = 'button';
        Object.entries(attrs).forEach(([k, v]) => b.setAttribute(k, v));
        b.addEventListener('click', onClick);
        return b;
    }

    const isWeb = (url) => /^https?:\/\//i.test(String(url || ''));

    class DashboardService {
        constructor(dash) {
            this.dash = dash;
            this._open = false;
            this.pop = null;
            this._prevUrl = '';
            this._pushed = false;
            this._swallow = false;
            this._routeClose = false;
            // Our own confirm dialog takes the shared modal shell for a moment:
            // the page is put aside (not closed) and comes back after the answer.
            this._confirming = false;
            this._suspended = null;
            this._backWait = null;
            this.ref = null;
            this.data = null;
            this.error = false;
            this.cameFrom = null;
            this.chosenContainer = '';
            this.chosenHost = '';
            this.siblings = [];
            this._hostsMeta = null;
            this._remoteLists = new Map();
            this.current = null;
            this._seq = 0;
            this._poll = null;
            this._liveTimer = null;
            this._onLive = null;
            this._keyHandler = null;
            // What outlives a repaint: the log reader, the note being typed in,
            // the releases once asked for and the stats poll.
            this._wrap = null;
            this._logs = null;
            this._noteNode = null;
            this._changes = null;
            this._stats = null;
            this._statsObserver = null;
            this._statsVisible = false;
        }

        t(key, fallback, params) {
            const raw = this.dash.language?.t?.(`service.${key}`);
            let text = raw && raw !== `service.${key}` ? raw : fallback;
            if (params) {
                Object.entries(params).forEach(([k, v]) => { text = text.replaceAll(`{${k}}`, String(v)); });
            }
            return text;
        }

        /** True while the popover is up. */
        isActiveView() {
            return this._open;
        }

        /* ── Address ─────────────────────────────────────────────────────── */

        hashFor(ref) {
            const q = new URLSearchParams();
            if (ref.url) {
                q.set('url', ref.url);
                if (ref.page) q.set('page', String(ref.page));
            } else if (ref.container) {
                q.set('container', ref.container);
                if (ref.host) q.set('host', ref.host);
            }
            return `#service?${q.toString()}`;
        }

        /** { url, page, container, host } from "service?url=…&page=…". */
        static parseHash(hash) {
            const raw = String(hash || '').replace(/^#/, '');
            const q = new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '');
            return {
                url: q.get('url') || '',
                page: Number(q.get('page')) || 0,
                container: q.get('container') || '',
                host: q.get('host') || '',
            };
        }

        static isServiceHash(hash) {
            const raw = String(hash || '').replace(/^#/, '');
            return raw === 'service' || raw.startsWith('service?');
        }

        /**
         * The popover's address. Opening pushes one entry, so Back closes it;
         * switching to another service while it is open replaces that entry
         * and never stacks more.
         */
        writeHash({ push }) {
            const hash = this.hashFor(this.ref);
            if (window.location.hash === hash) return;
            const url = `${window.location.pathname}${window.location.search}${hash}`;
            if (push && !this._pushed && window.DashboardHistory?.pushLocation?.(url)) {
                this._pushed = true;
                return;
            }
            history.replaceState(history.state, '', url);
        }

        /* ── Open and close ──────────────────────────────────────────────── */

        async openServiceView(options = {}) {
            const d = this.dash;
            const ref = {
                url: String(options.url || '').trim(),
                page: Number(options.page) || 0,
                container: String(options.container || '').trim(),
                host: String(options.host || '').trim(),
            };
            if (!ref.url && !ref.container) return false;
            if (typeof window.AppModal?.show !== 'function') return false;
            if (this._open) {
                return this.showRef(ref, { fromHash: options.fromHash });
            }
            // A popover is not a navigation: an inline edit under it is left as it is.
            this.cameFrom = d.activeView;
            // What the address was before: closing puts it back.
            const here = `${window.location.pathname}${window.location.search}`;
            this._prevUrl = window.DashboardService.isServiceHash(window.location.hash)
                ? here : `${here}${window.location.hash}`;
            // An address that already is one of our own history entries (a Forward
            // onto it) is closed the way a pushed one is: with Back.
            this._pushed = Boolean(options.fromHash && window.DashboardHistory?.isOwnEntry?.(history.state));
            this._opener = document.activeElement;
            this._open = true;
            this.ref = ref;
            this.chosenContainer = ref.container;
            this.chosenHost = ref.host;
            this.data = null;
            this.error = false;
            this.current = null;
            window.nextdashTrack?.('view:service');
            this.showShell();
            if (!options.fromHash) this.writeHash({ push: true });
            this.paint();
            this.startRefreshing();
            await this.load();
            return true;
        }

        showShell() {
            window.AppModal.show({
                title: this.t('title', 'Service overview'),
                htmlMessage: '',
                showCancel: false,
                confirmText: this.t('close', 'Close'),
                modalClass: 'service-modal',
                initialFocusSelector: '[data-service-close]',
                onHide: (info) => this.afterHide(info),
            });
        }

        /** Back after our own confirm dialog: the same page, the same history entry. */
        async resume() {
            const s = this._suspended;
            this._suspended = null;
            if (!s || this._open) return;
            // Someone navigated away meanwhile (Back while the question was up): nothing to come back to.
            if (window.location.hash !== s.hash) return;
            this.cameFrom = s.cameFrom;
            this._prevUrl = s.prevUrl;
            this._pushed = s.pushed;
            this._opener = s.opener;
            this.ref = s.ref;
            this.chosenContainer = s.chosenContainer;
            this.chosenHost = s.chosenHost;
            this._open = true;
            this.data = null;
            this.error = false;
            this.showShell();
            this.paint();
            this.startRefreshing();
            await this.load();
        }

        /** Another service while the popover is open: a link in "also on", or a new address. */
        async showRef(ref, { fromHash = false } = {}) {
            this.ref = ref;
            this.chosenContainer = ref.container;
            this.chosenHost = ref.host;
            this.data = null;
            this.error = false;
            this.current = null;
            if (!fromHash) this.writeHash({ push: false });
            this.paint();
            this.pop?.scroll.scrollTo({ top: 0 });
            await this.load();
            return true;
        }

        /** Esc, the backdrop and the close button all end up in AppModal.hide(), then afterHide. */
        closeServiceView() {
            if (!this._open) return false;
            window.AppModal.hide();
            return true;
        }

        /** Back (or a hash that is not ours) closed it: the address is already right. */
        closeFromRoute() {
            if (!this._open) return false;
            this._routeClose = true;
            window.AppModal.hide();
            return true;
        }

        /** True once after a close that walked history itself: the route that follows is not news. */
        consumeSwallow() {
            const was = this._swallow;
            this._swallow = false;
            return was;
        }

        /**
         * Closes, and resolves once the history step that follows has landed, so
         * a caller that navigates next (Container panel) writes its address on
         * the entry we returned to, not on the one that is about to go.
         */
        async closeAndSettle() {
            this._backWait = null;
            if (!this.closeServiceView()) return;
            if (this._backWait) await this._backWait;
        }

        afterHide(info) {
            if (!this._open) return;
            if (info?.reason === 'replaced' && this._confirming) {
                // Our own confirm dialog took the shell: put the page aside, keep its history entry.
                this._suspended = {
                    ref: this.ref, cameFrom: this.cameFrom, prevUrl: this._prevUrl, pushed: this._pushed,
                    opener: this._opener, chosenContainer: this.chosenContainer, chosenHost: this.chosenHost,
                    hash: window.location.hash,
                };
                this.teardown();
                return;
            }
            const fromRoute = this._routeClose;
            this._routeClose = false;
            this.teardown();
            // The history step below can redraw what the opener sat in: when it is
            // still there afterwards and nothing else holds focus, it gets it back.
            const opener = this._opener;
            const where = this.openerSelector(opener);
            this._opener = null;
            setTimeout(() => {
                if (document.querySelector('#app-modal.show')) return;
                const idle = !document.activeElement || document.activeElement === document.body;
                // Redrawn meanwhile (the panel repaints after a route): the same control, found again.
                const target = opener?.isConnected ? opener : (where ? document.querySelector(where) : null);
                if (idle && target) target.focus({ preventScroll: true });
            }, 150);
            if (fromRoute) return;
            if (this._pushed && window.DashboardService.isServiceHash(window.location.hash)) {
                // Our own entry goes the way it came: Back, and the route it fires is swallowed.
                // Only while it is still the entry on top: if the app wrote another address
                // meanwhile (a page that loaded late), history is left as it is.
                this._pushed = false;
                this._swallow = true;
                setTimeout(() => { this._swallow = false; }, 600);
                this._backWait = new Promise((resolve) => {
                    const done = () => { window.removeEventListener('popstate', done); clearTimeout(timer); resolve(); };
                    const timer = setTimeout(done, 600);
                    window.addEventListener('popstate', done);
                });
                history.back();
            } else if (window.DashboardService.isServiceHash(window.location.hash)) {
                history.replaceState(history.state, '', this._prevUrl || `${window.location.pathname}${window.location.search}`);
            }
        }

        /** A selector that finds the opener's twin if its node is replaced: an id, else its first data attribute under an id'd parent. */
        openerSelector(node) {
            if (!node?.getAttribute) return '';
            if (node.id) return `#${CSS.escape(node.id)}`;
            const attr = [...node.attributes].find((a) => a.name.startsWith('data-'));
            if (!attr) return '';
            const root = node.closest('[id]');
            return `${root ? `#${CSS.escape(root.id)} ` : ''}[${attr.name}="${CSS.escape(attr.value)}"]`;
        }

        /** Everything the popover started: polls, listeners, the log stream, the stats. */
        teardown() {
            this._open = false;
            this.stopRefreshing();
            this.disposeLive();
            this._seq += 1;
            this.pop = null;
            this.data = null;
        }

        /** Another view, or the grid, took over (kept for the loader's onLeave). */
        onLeave() {
            if (this._open) this.closeFromRoute();
        }

        /* ── Refreshing: the live channel's ping, and a poll under it ────── */

        startRefreshing() {
            this.stopRefreshing();
            // The channel says "health changed" and carries nothing; a second
            // of pings is one refetch. It is 404 in the demo, where the poll
            // below is all there is.
            // Only the service is fetched again; who it is (the bookmark, the
            // container) was settled on open and is asked again only when a
            // container changed state.
            const schedule = (again) => {
                this._liveAgain = this._liveAgain || again;
                clearTimeout(this._liveTimer);
                this._liveTimer = setTimeout(() => {
                    const resolveAgain = this._liveAgain;
                    this._liveAgain = false;
                    if (this.isActiveView() && document.visibilityState === 'visible') void this.load({ silent: true, resolve: resolveAgain });
                }, LIVE_COALESCE_MS);
            };
            this._onLiveHealth = () => schedule(false);
            this._onLive = () => schedule(true);
            window.addEventListener('livechannel:health', this._onLiveHealth);
            // A container changed state: the same coalesced refetch, and who it is is asked again.
            window.addEventListener('livechannel:docker', this._onLive);
            this._poll = setInterval(() => {
                if (this.isActiveView() && document.visibilityState === 'visible') void this.load({ silent: true, resolve: false });
            }, POLL_MS);
        }

        stopRefreshing() {
            if (this._onLive) {
                window.removeEventListener('livechannel:health', this._onLiveHealth);
                window.removeEventListener('livechannel:docker', this._onLive);
            }
            this._onLive = null;
            this._onLiveHealth = null;
            this._liveAgain = false;
            clearInterval(this._poll);
            clearTimeout(this._liveTimer);
            clearTimeout(this._renderTimer);
            this._poll = null;
            this._liveTimer = null;
        }

        /* ── Who is this: the bookmark and its container ─────────────────── */

        async resolve() {
            const d = this.dash;
            const index = window.DockerSearchIndex;
            let list = [];
            if (index?.enabled?.()) {
                try {
                    const status = await index.status();
                    if (status?.socket) list = (await index.refresh()) || [];
                } catch { list = []; }
            }
            // Every page's bookmarks, read without touching the dashboard: the
            // shell's own loader redraws the grid and re-routes to the page,
            // which a popover over another view must not do.
            // The kept (Unsorted) bookmarks are held apart from allBookmarks, and
            // the server finds a container's bookmark among them too.
            let all = [...(Array.isArray(d.allBookmarks) ? d.allBookmarks : []), ...(Array.isArray(d.unsortedBookmarks) ? d.unsortedBookmarks : [])];
            if (!all.length) {
                try {
                    const res = await fetch('/api/bookmarks?all=true');
                    const rows = res.ok ? await res.json() : [];
                    all = Array.isArray(rows) ? rows : [];
                } catch { /* the page's own bookmarks still count */ }
            }
            let { url, page, container, host } = this.ref;
            let bookmark = null;
            if (url) {
                const same = (b) => b && b.url === url;
                const here = (d.bookmarks || []).find((b) => same(b) && (!page || Number(b.pageId ?? d.currentPageId) === page));
                bookmark = here
                    || all.find((b) => same(b) && (!page || Number(b.pageId) === page))
                    || all.find(same) || null;
            } else if (container && host) {
                // A container on another Docker host: its own list, its own key.
                const c = (await this.remoteContainers(host)).find((x) => x.name === container);
                const hit = c && index?.bookmarkFor ? index.bookmarkFor(c, all) : null;
                if (hit) {
                    bookmark = hit.bookmark;
                    url = bookmark.url;
                    page = Number(bookmark.pageId) || 0;
                }
            } else if (container && index?.bookmarkFor) {
                const c = list.find((x) => x.name === container);
                const hit = c ? index.bookmarkFor(c, all) : null;
                if (hit) {
                    bookmark = hit.bookmark;
                    url = bookmark.url;
                    page = Number(bookmark.pageId) || 0;
                }
            }
            const local = bookmark && index?.containersFor
                ? index.containersFor(bookmark, all).map((c) => ({ name: c.name, host: '' })) : [];
            let found = local;
            if (bookmark && index?.bookmarkFor && (host || !local.length)) {
                // Containers on other hosts that belong to this bookmark: asked for
                // only when it has none here (or the page is about one there), so a
                // one-host install, and a bookmark with its container at home,
                // never leave this machine.
                found = local.concat(await this.remoteSiblings(bookmark, all));
            }
            this.siblings = found;
            // A chip (or the address) names one; else the first the match found.
            const want = this.chosenContainer ? { name: this.chosenContainer, host: this.chosenHost || '' } : null;
            const pick = (want && found.find((c) => c.name === want.name && c.host === want.host)) || want || found[0] || null;
            container = pick?.name || '';
            host = pick?.host || '';
            return { url, page, container, host };
        }

        /* ── Other Docker hosts: the list of one, the hosts that exist ───── */

        /** The remote hosts from Config, with the address a container there answers on. */
        async loadHostsMeta() {
            if (this._hostsMeta && Date.now() - this._hostsMeta.at < 60_000) return this._hostsMeta.hosts;
            let hosts = [];
            try {
                const res = await fetch('/api/docker/hosts', { cache: 'no-store' });
                const body = res.ok ? await res.json() : null;
                hosts = Array.isArray(body?.hosts) ? body.hosts : [];
            } catch { hosts = []; }
            this._hostsMeta = { at: Date.now(), hosts };
            return hosts;
        }

        /** The bare host part of "address:port", the way the Containers view derives it. */
        hostAddressOf(meta) {
            const address = String(meta?.address || '');
            const at = address.lastIndexOf(':');
            return at > 0 ? address.slice(0, at) : address;
        }

        hostName(id) {
            if (!id) return this.t('hostLocal', 'local');
            const meta = (this._hostsMeta?.hosts || []).find((h) => h.id === id);
            return meta?.name || id;
        }

        /** One remote host's containers, marked with who they run on (hostId, hostAddress). */
        async remoteContainers(hostId) {
            const hit = this._remoteLists.get(hostId);
            if (hit && Date.now() - hit.at < REMOTE_LIST_MS) return hit.list;
            const hosts = await this.loadHostsMeta();
            const meta = hosts.find((h) => h.id === hostId);
            let list = [];
            if (meta) {
                try {
                    const res = await fetch(`/api/docker/containers?host=${encodeURIComponent(hostId)}`, { cache: 'no-store', signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) });
                    const body = res.ok ? await res.json() : null;
                    const address = this.hostAddressOf(meta);
                    list = (Array.isArray(body?.containers) ? body.containers : []).map((c) => ({ ...c, hostId, hostAddress: address }));
                } catch { list = []; }
            }
            this._remoteLists.set(hostId, { at: Date.now(), list });
            return list;
        }

        /** The containers on other hosts whose bookmark is this one. */
        async remoteSiblings(bookmark, all) {
            const index = window.DockerSearchIndex;
            if (index?.enabled?.() === false) return [];
            const hosts = await this.loadHostsMeta();
            if (!hosts.length) return [];
            const lists = await Promise.all(hosts.map((h) => this.remoteContainers(h.id)));
            const out = [];
            lists.flat().forEach((c) => {
                const hit = index.bookmarkFor(c, all);
                if (hit && String(hit.bookmark.url).trim() === String(bookmark.url).trim()) out.push({ name: c.name, host: c.hostId });
            });
            return out;
        }

        /** Adds ?host= for a container on another host; this host's requests stay as they were. */
        hostUrl(url, host) {
            const id = host ?? this.current?.host ?? '';
            return id ? `${url}${url.includes('?') ? '&' : '?'}host=${encodeURIComponent(id)}` : url;
        }

        async load({ silent = false, resolve = true } = {}) {
            const seq = ++this._seq;
            let query;
            try {
                // A plain refresh reuses who this is; only opening, another
                // container chip and a container event work it out again.
                const who = resolve || !this.current ? await this.resolve() : this.current;
                query = new URLSearchParams();
                if (who.url) query.set('url', who.url);
                if (who.page) query.set('page', String(who.page));
                if (who.container) query.set('container', who.container);
                if (who.host) query.set('host', who.host);
                this.current = who;
                const res = await fetch(`/api/service?${query.toString()}`, { cache: 'no-store' });
                if (!res.ok) throw new Error(`service HTTP ${res.status}`);
                const data = await res.json();
                if (seq !== this._seq || !this.isActiveView()) return;
                this.data = data;
                this.error = false;
            } catch (err) {
                if (seq !== this._seq || !this.isActiveView()) return;
                // A poll that fails leaves what is on screen; only a page that
                // has nothing yet says so.
                if (silent && this.data) return;
                this.error = true;
                console.warn('Service overview:', err);
            }
            this.paint();
        }

        /* ── Painting ────────────────────────────────────────────────────── */

        /** The popover's own furniture, built once into the app modal's body and title bar. */
        mountPopover() {
            const textEl = document.getElementById('modal-text');
            if (!textEl) return null;
            if (this.pop && textEl.contains(this.pop.root)) return this.pop;
            const root = el('div', 'service-view service-pop');
            root.setAttribute('data-service-root', '');
            const scroll = el('div', 'service-pop-scroll');
            scroll.tabIndex = -1;
            root.append(scroll);
            // Esc inside the log reader is the reader's (search, follow), not the popover's.
            root.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && e.target.closest?.('[data-logs-view]')) e.stopPropagation();
            });
            textEl.replaceChildren(root);
            // One compact title bar: the name on the left (the dialog's label),
            // the actions beside it (a second row when narrow), Esc and a close button at the end.
            const bar = document.getElementById('modal-title')?.parentElement;
            const actions = el('div', 'service-bar-actions');
            actions.setAttribute('data-modal-header-extra', '');
            const end = el('span', 'service-bar-end');
            end.setAttribute('data-modal-header-extra', '');
            const hint = el('kbd', 'service-esc-hint', 'Esc');
            hint.setAttribute('aria-hidden', 'true');
            const close = button('', 'service-close', () => this.closeServiceView(), {
                'data-service-close': '',
                'aria-label': this.t('close', 'Close'),
                title: this.t('closeTitle', 'Close (Esc)'),
            });
            close.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';
            end.append(hint, close);
            bar?.append(actions, end);
            // The sheet's grabber on a phone (a plain bar; the close button is the way out).
            const grab = el('span', 'service-grabber');
            grab.setAttribute('data-modal-header-extra', '');
            grab.setAttribute('aria-hidden', 'true');
            bar?.prepend(grab);
            this.pop = { root, actions, scroll };
            return this.pop;
        }

        paint() {
            if (!this._open) return;
            const pop = this.mountPopover();
            if (!pop) return;
            const data = this.data;
            if (!data) {
                this.disposeLive();
                this.paintHeader(pop, null);
                pop.scroll.replaceChildren(el('p', 'service-empty', this.error
                    ? this.t('loadFailed', 'Could not load this service.')
                    : this.t('loading', 'Loading…')));
                if (this.error) {
                    pop.scroll.appendChild(button(this.t('retry', 'Try again'), 'config-btn config-btn--small',
                        () => { this.error = false; this.paint(); void this.load(); }, { 'data-service-retry': '' }));
                }
                return;
            }
            this.paintHeader(pop, data);
            const container = this.sectionContainer(data);
            const logs = this.sectionLogs(data);
            // The sections that hold something a repaint must not undo (the
            // log, the note being typed in) stay in the page; the rest is
            // replaced in place around them.
            let wrap = this._wrap;
            if (!wrap || !pop.scroll.contains(wrap)) {
                wrap = el('div', 'service-wrap');
                const grid = el('div', 'service-grid');
                grid.append(el('div', 'service-col'), el('div', 'service-col'));
                wrap.append(grid);
                this._wrap = wrap;
                pop.scroll.replaceChildren(wrap);
            }
            const grid = wrap.querySelector('.service-grid');
            const [leftCol, rightCol] = grid.children;
            let left = [this.sectionHealth(data), this.sectionTimeline(data)].filter(Boolean);
            let right = [container, this.sectionReleases(data), this.sectionNote(data), this.sectionSetup(data)].filter(Boolean);
            // Only what has something to show: with nothing on the left, the right fills the width.
            if (!left.length) { left = right; right = []; }
            grid.classList.toggle('is-single', !right.length);
            this.syncChildren(leftCol, left);
            this.syncChildren(rightCol, right);
            this.syncChildren(wrap, [this.buildHero(data), this.buildKpis(data), ...this.buildSubline(data), grid, logs]);
            this.watchContainer(data, container);
        }

        /** Makes `parent`'s children be `wanted`, in order, without moving a node that is already in place. */
        syncChildren(parent, wanted) {
            const list = wanted.filter(Boolean);
            [...parent.children].forEach((child) => { if (!list.includes(child)) child.remove(); });
            let ref = parent.firstChild;
            list.forEach((node) => {
                if (node === ref) ref = ref.nextSibling;
                else parent.insertBefore(node, ref);
            });
        }

        displayName(data) {
            return data.bookmark?.name || data.container?.name || this.current?.container || this.current?.url || this.t('title', 'Service overview');
        }

        /** The title bar: the name over its address and the view it sits over, then the actions. */
        paintHeader(pop, data) {
            const b = data?.bookmark;
            const c = data?.container;
            const title = document.getElementById('modal-title');
            const url = b?.found ? b.url : (this.current?.url || '');
            const sub = el('span', 'service-sub');
            if (url && isWeb(url)) {
                const a = el('a', 'service-url', url);
                a.href = url;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                sub.appendChild(a);
            } else if (url) {
                sub.appendChild(el('span', 'service-url', url));
            }
            const over = this.overLabel();
            if (over) sub.appendChild(el('span', 'service-over', over));
            const id = el('span', 'service-id');
            id.append(el('span', 'service-name', data ? this.displayName(data) : this.t('title', 'Service overview')));
            if (sub.childNodes.length) id.appendChild(sub);
            title?.replaceChildren(this.buildIcon(b, c), id);
            pop.actions.replaceChildren(...this.buildActions(data));
            pop.actions.hidden = !pop.actions.childNodes.length;
        }

        /** "over Containers": which view this popover sits on. Only said where it helps. */
        overLabel() {
            const d = this.dash;
            const view = { docker: ['dashboard.dockerView', 'Containers'], library: ['dashboard.libraryView', 'Bookmarks'] }[this.cameFrom];
            if (!view) return '';
            const raw = d.language?.t?.(view[0]);
            return this.t('over', 'over {view}', { view: raw && raw !== view[0] ? raw : view[1] });
        }

        buildIcon(b, c) {
            const box = el('span', 'service-icon');
            box.setAttribute('aria-hidden', 'true');
            const name = (b?.name || c?.name || '?').trim();
            const letter = () => el('span', 'service-icon-letter', (name[0] || '?').toUpperCase());
            if (b?.icon) {
                const img = el('img', 'service-icon-img');
                img.alt = '';
                img.src = /^(https?:|data:|\/)/i.test(String(b.icon)) ? b.icon : `/data/icons/${encodeURIComponent(b.icon)}`;
                img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
                box.appendChild(img);
                return box;
            }
            box.appendChild(letter());
            return box;
        }

        /** Open, Edit bookmark, Container panel, Re-check; control actions last. */
        buildActions(data) {
            const out = [];
            const small = 'config-btn config-btn--small';
            if (!data) return out;
            const b = data.bookmark;
            const c = data.container;
            if (b?.found && isWeb(b.url)) {
                out.push(button(this.t('open', 'Open'), `${small} config-btn--primary`, () => this.openAddress(b.url), { 'data-service-action': 'open' }));
                out.push(button(this.t('editBookmark', 'Edit bookmark'), small, () => this.editBookmark(b), { 'data-service-action': 'edit' }));
            }
            if (c) {
                out.push(button(this.t('containerPanel', 'Container panel'), small,
                    () => void this.openInContainers(c.name, data.host || ''), { 'data-service-action': 'container-panel' }));
            }
            if (b?.found) {
                out.push(button(this.t('recheck', 'Re-check'), small, () => void this.recheck(b), { 'data-service-action': 'recheck' }));
            }
            // Acting on a container needs Allow actions, and never reaches the
            // container nextDash itself runs in. DockerSearchIndex.allowedActions
            // is the one rule the drawer and the palette use as well.
            // Not on another host: start, stop, restart and update are driven from
            // that host's tab in Containers ("Container panel"), where the host
            // is part of every request.
            if (c && data.control && !c.self && !data.self && !data.host) {
                const wanted = ['start', 'restart', 'stop', 'update'];
                // The container's own host decides, not the tab the Containers view happens to show.
                const allowed = window.DockerSearchIndex?.allowedActions?.({ ...c, hostId: data.host || 'local' }, data.control) || [];
                wanted.filter((a) => allowed.includes(a)).forEach((action) => {
                    out.push(button(this.actionLabel(action), small, () => void this.runAction(action, c.name),
                        { 'data-service-control': action }));
                });
            }
            return out;
        }

        /**
         * Containers view, on this container. The popover closes first and the
         * history step that closing takes is waited for, so the address the
         * view writes is the one that stays.
         */
        async openInContainers(name, host, section) {
            await this.closeAndSettle();
            void this.dash.docker?.openDockerView?.({ select: name, host, section });
        }

        actionLabel(action) {
            return {
                start: this.t('actionStart', 'Start'),
                restart: this.t('actionRestart', 'Restart'),
                stop: this.t('actionStop', 'Stop'),
                update: this.t('actionUpdate', 'Update'),
            }[action] || action;
        }

        openAddress(url) {
            if (isWeb(url)) window.open(url, '_blank', 'noopener,noreferrer');
        }

        editBookmark(b) {
            const d = this.dash;
            const same = (x) => x && x.url === b.url && Number(x.pageId ?? d.currentPageId) === Number(b.pageId);
            const row = (d.bookmarks || []).find(same) || (d.allBookmarks || []).find(same) || (d.unsortedBookmarks || []).find(same);
            if (!row) return;
            // The form is a modal of its own; the popover steps aside for it.
            this.closeServiceView();
            d.openBookmarkFormModal?.({ mode: 'edit', bookmark: row, source: 'service' });
        }

        async recheck(b) {
            const d = this.dash;
            const outcome = await d.health?.recheckIssue?.({ url: b.url, pageId: b.pageId, index: b.index }, { silent: true });
            if (outcome === 'ok') {
                d.showNotification?.(this.t('rechecked', 'Checked again'), 'success', { duration: 2000 });
            } else if (outcome && outcome.rateLimited) {
                d.showNotification?.(this.t('recheckLimited', 'Too many checks at once. Try again in a moment.'), 'info', { duration: 3000 });
            } else {
                d.showNotification?.(this.t('recheckFailed', 'Could not re-check this bookmark'), 'error', { duration: 3000 });
            }
            d.updateHealthBadge?.();
            void this.load({ silent: true, resolve: false });
        }

        /**
         * Start, Stop, Restart, Update. The confirm question (Update always,
         * Stop and Restart when Config asks for it) is the app modal too and
         * takes the shell this page sits in: the page is put aside while it is
         * up and comes back, on the same history entry, once it is answered.
         */
        async runAction(action, name) {
            this._confirming = true;
            try {
                await this.dash.docker?.runAction?.(action, name);
            } finally {
                this._confirming = false;
                window.DockerSearchIndex?.invalidate?.();
                if (this._suspended) await this.resume();
                else void this.load({ silent: true, resolve: false });
            }
        }

        /* ── The status hero, the key figures, and the lines under them ──── */

        tone(kind) { return `service-pill service-pill--${kind}`; }

        pill(kind, text, key) {
            const p = el('span', this.tone(kind));
            p.setAttribute('data-service-pill', key);
            p.append(el('i', 'service-pill-dot'), document.createTextNode(text));
            return p;
        }

        /** Is something watching this bookmark: a monitor, a mode that checks, or a network check. */
        isChecked(data) {
            const b = data.bookmark;
            if (!b?.found) return false;
            return b.checkMode !== 'off' || (b.monitor && b.monitor.totalChecks > 0) || data.checks.length > 0;
        }

        /** The state in one sentence and the facts under it, from what the page already has. */
        heroOf(data) {
            const b = data.bookmark;
            const c = data.container;
            const m = b?.monitor;
            const found = Boolean(b?.found);
            const webDown = found && b.checkMode !== 'off' && ((b.brokenSince > 0) || (m && m.downSince > 0));
            const downSince = (m && m.downSince > 0 ? m.downSince : 0) || (b?.brokenSince > 0 ? b.brokenSince : 0);
            const state = String(c?.state || '');
            const unhealthy = Boolean(c) && (c.health === 'unhealthy' || c.healthStatus === 'unhealthy');
            const ctrDown = Boolean(c) && !['running', 'paused', 'restarting'].includes(state);
            const ctrWarn = Boolean(c) && ['paused', 'restarting'].includes(state);
            const failing = data.checks.filter((k) => k.known && !k.ok && !k.paused).length;
            const parts = [];
            if (found && b.checkMode !== 'off') {
                if (webDown) {
                    parts.push(downSince ? this.t('heroWebDownFor', 'Web down for {ago}', { ago: this.ago(downSince) }) : this.t('pillWebDown', 'Web down'));
                } else {
                    const up = this.t('pillWebUp', 'Web up');
                    parts.push(m && m.uptime30d?.samples > 0 ? `${up} · ${this.pct(m.uptime30d.ratio)}` : up);
                }
            } else if (found) {
                parts.push(this.t('pillWebUnchecked', 'Web not checked'));
            }
            if (c) {
                parts.push(unhealthy ? this.t('pillUnhealthy', 'Container unhealthy') : `${this.t('pillContainer', 'Container')} ${state}`);
            }
            if (data.checks.length) {
                parts.push(failing
                    ? this.t('pillChecksFailing', '{n} of {total} checks failing', { n: failing, total: data.checks.length })
                    : this.t('pillChecksPassing', '{n} checks passing', { n: data.checks.length }));
            }
            if (c?.update?.status === 'available') parts.push(this.t('pillUpdate', 'Update available'));
            let tone = 'ok';
            let headline = this.t('heroOk', 'All good');
            if (webDown) {
                tone = 'bad';
                headline = downSince ? this.t('heroIncidentSince', 'Incident since {when}', { when: this.when(downSince) }) : this.t('heroIncident', 'Incident');
            } else if (ctrDown || unhealthy) {
                tone = 'bad';
                headline = unhealthy ? this.t('pillUnhealthy', 'Container unhealthy') : this.t('heroContainerDown', 'Container {state}', { state });
            } else if (failing) {
                tone = 'bad';
                headline = this.t('heroChecksFailing', 'Checks failing');
            } else if (ctrWarn) {
                tone = 'warn';
                headline = this.t('heroContainerDown', 'Container {state}', { state });
            } else if (!this.isChecked(data) && !c) {
                tone = 'off';
                headline = this.t('heroNotMonitored', 'Not monitored yet');
                parts.length = 0;
                parts.push(found
                    ? this.t('heroBare', 'Only a bookmark so far: no check, container or feed is linked')
                    : this.t('heroNothing', 'Nothing is linked to this yet'));
            } else if (!this.isChecked(data) && c && state === 'running') {
                headline = this.t('heroContainerRunning', 'Container running');
                // The headline already says it; the line under it carries the rest.
                const same = `${this.t('pillContainer', 'Container')} ${state}`;
                const rest = parts.filter((p) => p !== same);
                parts.length = 0;
                parts.push(...rest);
                if (c?.startedAt) parts.unshift(this.t('heroUpFor', 'Up {ago}', { ago: this.ago(this.startedMs(c.startedAt)) }));
            } else if (c?.update?.status === 'available' && !webDown) {
                tone = 'warn';
                headline = this.t('heroUpdate', 'Update available');
            }
            return { tone, headline, detail: parts.join(' · ') };
        }

        buildHero(data) {
            const h = this.heroOf(data);
            const box = el('div', 'service-hero');
            box.setAttribute('data-service-hero', '');
            box.setAttribute('data-tone', h.tone);
            const dot = el('i', 'service-hero-dot');
            dot.setAttribute('aria-hidden', 'true');
            const text = el('div', 'service-hero-text');
            const head = el('strong', '', h.headline);
            head.setAttribute('data-service-headline', '');
            const detail = el('span', '', h.detail);
            detail.setAttribute('data-service-detail', '');
            text.append(head, detail);
            box.append(dot, text);
            return box;
        }

        /** Key figures, only when there is monitor data: uptime, response, certificate, load. */
        buildKpis(data) {
            const b = data.bookmark;
            const m = b?.monitor;
            if (!b?.found || !(b.checkMode === 'monitor' || (m && m.totalChecks > 0))) return null;
            const row = el('div', 'service-kpis');
            row.setAttribute('data-service-kpis', '');
            const kpi = (label, value, key, warn) => {
                const box = el('div', `service-kpi${warn ? ' is-warn' : ''}`);
                box.setAttribute('data-service-kpi', key);
                box.append(el('span', '', label), el('strong', '', value));
                return box;
            };
            const win = (w) => (w && w.samples > 0 ? this.pct(w.ratio) : '—');
            const degraded = (b.brokenSince > 0) || (m?.downSince > 0) || (m?.uptime24h?.samples > 0 && m.uptime24h.ratio < 0.99);
            row.appendChild(degraded
                ? kpi(this.t('uptime24h', 'Uptime 24h'), win(m?.uptime24h), 'uptime', true)
                : kpi(this.t('uptime30dFull', 'Uptime 30d'), win(m?.uptime30d), 'uptime'));
            row.appendChild(kpi(this.t('response', 'Response'), m?.lastPingMs ? `${m.lastPingMs} ms` : '—', 'response'));
            if (b.certificate?.expiresAt) {
                const days = Math.floor((b.certificate.expiresAt - Date.now()) / 86400000);
                row.appendChild(kpi(this.t('certificate', 'Certificate'), days >= 0
                    ? this.t('certDays', '{n} d', { n: days }) : this.t('certExpired', 'expired'), 'certificate', days < 14));
            }
            const st = this._stats;
            if (data.container?.state === 'running' && st && st.cpu != null && Number.isFinite(st.cpu)) {
                row.appendChild(kpi('CPU', `${st.cpu.toFixed(1)}%`, 'cpu'));
                if (Number.isFinite(st.memUsed) && st.memLimit > 0) {
                    row.appendChild(kpi(this.t('memory', 'Memory'), `${Math.round((st.memUsed / st.memLimit) * 100)}%`, 'memory'));
                }
            }
            return row;
        }

        /** More than one container for this bookmark, and the same address on other pages. */
        buildSubline(data) {
            const out = [];
            if (this.siblings.length > 1) {
                const chips = el('div', 'service-chips');
                chips.appendChild(el('span', 'service-chips-label', this.t('containers', 'Containers')));
                this.siblings.forEach((sib) => {
                    const active = sib.name === (data.container?.name || this.current?.container) && sib.host === (data.host || this.current?.host || '');
                    // Two containers of one name on two machines are told apart by the machine.
                    const label = sib.host ? `${sib.name} · ${this.hostName(sib.host)}` : sib.name;
                    const chip = button(label, `service-chip${active ? ' is-active' : ''}`, () => {
                        this.chosenContainer = sib.name;
                        this.chosenHost = sib.host;
                        void this.load();
                    }, { 'data-service-container': sib.name, 'data-service-container-host': sib.host, 'aria-pressed': String(active) });
                    chips.appendChild(chip);
                });
                out.push(chips);
            }
            const also = data.bookmark?.also || [];
            if (also.length) {
                const line = el('p', 'service-also');
                line.appendChild(document.createTextNode(`${this.t('alsoOn', 'Also on')} `));
                also.forEach((a, i) => {
                    if (i) line.appendChild(document.createTextNode(', '));
                    line.appendChild(button(a.pageName || String(a.pageId), 'service-link',
                        () => void this.showRef({ url: data.bookmark.url, page: a.pageId, container: '', host: '' }),
                        { 'data-service-also': String(a.pageId) }));
                });
                line.appendChild(document.createTextNode(` · ${this.t('alsoNote', 'name and note come from the copy you came from')}`));
                out.push(line);
            }
            return out;
        }

        /* ── Sections ────────────────────────────────────────────────────── */

        section(key, title, actions = []) {
            const sec = el('section', 'service-sec');
            sec.setAttribute('data-service-section', key);
            sec.id = `service-sec-${key}`;
            const h = el('h3', 'service-sec-title');
            h.appendChild(el('span', '', title));
            actions.forEach((a) => h.appendChild(a));
            sec.appendChild(h);
            return sec;
        }

        pct(ratio) {
            if (!Number.isFinite(ratio)) return '—';
            const v = Math.round(ratio * 10000) / 100;
            return `${v}%`;
        }

        when(ms) {
            if (!ms) return '';
            const date = new Date(ms);
            const now = new Date();
            const lang = document.documentElement.lang || undefined;
            try {
                if (date.toDateString() === now.toDateString()) {
                    return date.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
                }
                if (now - date < 6 * 86400000) {
                    return date.toLocaleString(lang, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
                }
                return date.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
            } catch {
                return date.toISOString().slice(0, 16).replace('T', ' ');
            }
        }

        /** The Docker list gives startedAt in seconds; every other time on this page is in milliseconds. */
        startedMs(v) {
            const n = Number(v) || 0;
            return n > 0 && n < 1e11 ? n * 1000 : n;
        }

        ago(ms) {
            if (!ms) return '';
            const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
            if (mins < 1) return this.t('agoNow', 'just now');
            if (mins < 60) return this.t('agoMinutes', '{n} min', { n: mins });
            const hours = Math.round(mins / 60);
            if (hours < 48) return this.t('agoHours', '{n} h', { n: hours });
            return this.t('agoDays', '{n} days', { n: Math.round(hours / 24) });
        }

        /** Health: the 30 days and the checks. Not shown (the setup card offers it) when nothing is watching. */
        sectionHealth(data) {
            const b = data.bookmark;
            if (!b?.found || !this.isChecked(data)) return null;
            const sec = this.section('health', this.t('sectionHealth', 'Health'));
            const monitored = b.checkMode === 'monitor' || (b.monitor && b.monitor.totalChecks > 0);
            if (monitored) sec.append(...this.healthBody(data));
            else sec.appendChild(this.lastCheckLine(b));
            sec.appendChild(this.checksList(data));
            return sec;
        }

        lastCheckLine(b) {
            const line = el('p', 'service-muted');
            const bits = [];
            if (b.lastChecked) bits.push(this.t('lastChecked', 'Last checked {when}', { when: this.ago(b.lastChecked) }));
            if (b.lastError) bits.push(b.lastError);
            line.textContent = bits.join(' · ') || this.t('notCheckedYet', 'Not checked yet');
            return line;
        }

        async turnOnChecking(b) {
            const outcome = await window.CheckMode?.apply?.({ pageId: b.pageId, index: b.index, url: b.url, mode: 'monitor', name: b.name });
            if (outcome === 'changed') {
                this.dash.updateHealthBadge?.();
                void this.load({ silent: true, resolve: false });
            }
        }

        healthBody(data) {
            const b = data.bookmark;
            const m = b.monitor;
            const strip = this.dayStrip(data.days);
            const axis = el('div', 'service-axis');
            axis.append(el('span', '', this.t('days30', '30 days ago')), el('span', '', this.t('today', 'today')));
            const win = (w) => (w && w.samples > 0 ? this.pct(w.ratio) : '—');
            const stats = el('p', 'service-muted service-windows');
            stats.textContent = `${this.t('uptime24h', 'Uptime 24h')} ${win(m?.uptime24h)} · ${this.t('uptime7d', '7 d')} ${win(m?.uptime7d)} · ${this.t('uptime30d', '30 d')} ${win(m?.uptime30d)}`;
            const out = [strip, axis, stats];
            if (b.lastError && (b.brokenSince > 0 || m?.downSince > 0)) out.push(el('p', 'service-muted', b.lastError));
            return out;
        }

        /** One bar per day for 30 days; a day without checks stays empty. */
        dayStrip(days) {
            const strip = el('div', 'service-bars');
            strip.setAttribute('role', 'img');
            strip.setAttribute('aria-label', this.t('barsLabel', 'Uptime per day, last 30 days'));
            const byDay = new Map((days || []).map((d) => [d.d, d]));
            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);
            for (let i = 29; i >= 0; i -= 1) {
                const start = today.getTime() - i * 86400000;
                const d = byDay.get(start);
                const bar = el('b');
                let tone = 'none';
                if (d && d.n > 0) {
                    const ratio = d.u / d.n;
                    tone = ratio >= 0.995 ? 'ok' : (ratio >= 0.9 ? 'warn' : 'bad');
                    bar.title = `${new Date(start).toISOString().slice(0, 10)}: ${this.pct(ratio)} (${d.n})`;
                } else {
                    bar.title = new Date(start).toISOString().slice(0, 10);
                }
                bar.setAttribute('data-tone', tone);
                strip.appendChild(bar);
            }
            return strip;
        }

        checksList(data) {
            const list = el('ul', 'service-checks');
            if (!data.checks.length) return list;
            data.checks.forEach((k) => {
                const li = el('li');
                li.setAttribute('data-service-check', k.id);
                const left = el('span', 'service-check-left');
                const tone = !k.known ? 'none' : (k.paused ? 'none' : (!k.ok ? 'bad' : (k.warn ? 'warn' : 'ok')));
                const dot = el('i', 'service-dot');
                dot.setAttribute('data-tone', tone);
                const text = el('span');
                text.append(el('span', '', k.label), el('small', '', k.type));
                left.append(dot, text);
                const right = el('small', 'service-check-right');
                if (!k.known) right.textContent = this.t('checkNotRun', 'not run yet');
                else if (k.ok && k.ms) right.textContent = `${k.ms} ms`;
                else if (!k.ok && k.since) right.textContent = this.t('checkSince', 'since {when}', { when: this.when(k.since) });
                li.append(left, right);
                list.appendChild(li);
            });
            return list;
        }

        sectionContainer(data) {
            const c = data.container;
            if (!c) return null;
            const link = button(this.t('openInContainers', 'Open in Containers'), 'service-link',
                () => void this.openInContainers(c.name, data.host || ''), { 'data-service-action': 'open-in-containers' });
            const sec = this.section('container', this.t('sectionContainer', 'Container'), [link]);
            const kv = el('dl', 'service-kv');
            const row = (label, valueNode) => {
                const dd = el('dd');
                if (typeof valueNode === 'string') dd.textContent = valueNode; else dd.appendChild(valueNode);
                kv.append(el('dt', '', label), dd);
            };
            const state = String(c.state || '');
            const unhealthy = c.health === 'unhealthy' || c.healthStatus === 'unhealthy';
            const kind = state === 'running' ? (unhealthy ? 'bad' : 'ok') : (state === 'paused' || state === 'restarting' ? 'warn' : 'bad');
            row(this.t('state', 'State'), this.pill(kind, unhealthy ? `${state} · ${this.t('unhealthy', 'unhealthy')}` : state, 'state'));
            row(this.t('image', 'Image'), c.image || '');
            if (c.version) row(this.t('version', 'Version'), c.version);
            if (c.startedAt) {
                const startedMs = this.startedMs(c.startedAt);
                row(this.t('since', 'Since'), `${this.ago(startedMs)} · ${this.when(startedMs)}`);
            }
            const ports = (c.ports || []).filter((p) => p && p.public).map((p) => `${p.public}→${p.private}`);
            if (ports.length) row(this.t('ports', 'Ports'), ports.join(', '));
            row(this.t('host', 'Host'), this.hostName(data.host || ''));
            if (state === 'running') row(this.t('load', 'Load'), this.statsRow(c));
            if (c.restarts > 0) row(this.t('restarts', 'Restarts, 24 h'), String(c.restarts));
            if (c.update?.status === 'available') row(this.t('update', 'Update'), this.t('updateAvailable', 'available'));
            sec.appendChild(kv);
            return sec;
        }

        sectionTimeline(data) {
            // Nothing happened yet: no card, unless it has to say why a remote host's history is short.
            if (!data.timeline.length && !data.timelinePartial) return null;
            const sec = this.section('timeline', this.t('sectionTimeline', 'Timeline'));
            if (!data.timeline.length) {
                this.appendTimelineHint(sec, data);
                return sec;
            }
            const list = el('ul', 'service-tl');
            data.timeline.forEach((item) => {
                const li = el('li');
                li.setAttribute('data-service-event', `${item.source}:${item.kind}`);
                const time = el('time', '', this.when(item.at));
                time.dateTime = new Date(item.at).toISOString();
                const pin = el('i', 'service-pin');
                pin.setAttribute('data-tone', this.eventTone(item));
                const body = el('div');
                body.append(el('p', '', this.eventText(item)), el('span', 'service-src', this.sourceLabel(item.source)));
                li.append(time, pin, body);
                list.appendChild(li);
            });
            sec.appendChild(list);
            this.appendTimelineHint(sec, data);
            return sec;
        }

        /** The container's own history (start, stop, crash, updates) is kept for this host only. */
        appendTimelineHint(sec, data) {
            if (!data.timelinePartial) return;
            const hint = el('p', 'service-hint', this.t('timelineLocalOnly', 'Timeline only for this host: the container history on {host} is not kept here.', { host: this.hostName(data.host || '') }));
            hint.setAttribute('data-service-timeline-partial', data.timelinePartial);
            sec.appendChild(hint);
        }

        eventTone(item) {
            if (['down', 'crash', 'unhealthy', 'restart-loop'].includes(item.kind)) return 'bad';
            if (['up', 'start', 'healthy', 'unpause'].includes(item.kind)) return 'ok';
            if (['stop', 'exit', 'pause', 'update', 'rollback'].includes(item.kind)) return 'warn';
            return 'info';
        }

        sourceLabel(source) {
            return {
                docker: this.t('srcContainer', 'container'),
                update: this.t('srcUpdate', 'update'),
                health: this.t('srcWeb', 'web'),
                check: this.t('srcCheck', 'check'),
                release: this.t('srcFeed', 'feed'),
            }[source] || source;
        }

        eventText(item) {
            const detail = item.detail ? ` — ${item.detail}` : '';
            if (item.source === 'health') {
                return item.kind === 'down'
                    ? `${this.t('evWebDown', 'Web down')}${detail}`
                    : `${this.t('evWebUp', 'Web back up')}${detail}`;
            }
            if (item.source === 'check') {
                return item.kind === 'down'
                    ? `${this.t('evCheckDown', 'Check failing')}${detail ? ` — ${item.detail}` : ''}`
                    : `${this.t('evCheckUp', 'Check passing again')}${detail ? ` — ${item.detail}` : ''}`;
            }
            if (item.source === 'release') return `${this.t('evRelease', 'New release')} — ${item.detail}`;
            const words = {
                start: this.t('evStart', 'Container started'),
                stop: this.t('evStop', 'Container stopped'),
                exit: this.t('evExit', 'Container exited'),
                crash: this.t('evCrash', 'Container crashed'),
                unhealthy: this.t('evUnhealthy', 'Container unhealthy'),
                healthy: this.t('evHealthy', 'Container healthy again'),
                pause: this.t('evPause', 'Container paused'),
                unpause: this.t('evUnpause', 'Container resumed'),
                update: this.t('evUpdate', 'Updated'),
                rollback: this.t('evRollback', 'Rolled back'),
                'restart-loop': this.t('evLoop', 'Restart loop'),
            };
            return `${words[item.kind] || item.kind}${detail}`;
        }

        /* ── Releases: the feeds at once, GitHub after a click ───────────── */

        /** The labels the drawer's Changes renderer asks for (dashboard.*). */
        dashT(key, fallback, params) {
            const raw = this.dash.language?.t?.(`dashboard.${key}`);
            let text = raw && raw !== `dashboard.${key}` ? raw : fallback;
            if (params) Object.entries(params).forEach(([k, v]) => { text = text.replaceAll(`{${k}}`, String(v)); });
            return text;
        }

        sectionReleases(data) {
            const c = data.container;
            const sec = this.section('releases', this.t('sectionReleases', 'Releases'));
            const items = [];
            (data.watches || []).forEach((w) => (w.items || []).forEach((it) => items.push({ ...it, feed: w.title || w.feedUrl })));
            items.sort((a, z) => (z.publishedAt || z.foundAt || 0) - (a.publishedAt || a.foundAt || 0));
            // No feed and no container: nothing to show (the setup card offers a feed).
            if (!items.length && !c) return null;
            if (items.length) {
                const list = el('ul', 'service-rel');
                items.slice(0, 5).forEach((it) => {
                    const li = el('li');
                    li.append(el('span', 'service-rel-tag', it.title), el('small', '', `${it.feed} · ${this.when(it.publishedAt || it.foundAt)}`));
                    list.appendChild(li);
                });
                sec.appendChild(list);
            }
            // The image's own source: asked for on a click, never on arrival.
            if (c) sec.appendChild(this.githubBlock(c.name, data.host || ''));
            return sec;
        }

        githubBlock(name, hostId) {
            if (this._changes?.name !== name || this._changes.hostId !== hostId) this._changes = { name, hostId, status: 'idle', data: null, shown: false };
            const state = this._changes;
            const box = el('div', 'service-gh');
            box.setAttribute('data-service-github', state.status);
            const label = state.status === 'loading' ? this.t('githubLoading', 'Loading…')
                : (state.status === 'done' && state.shown ? this.t('githubHide', 'Hide releases from GitHub')
                    : this.t('githubShow', 'Show releases from GitHub'));
            const btn = button(label, 'config-btn config-btn--small', () => void this.toggleGithub(name, hostId), { 'data-service-action': 'github-releases' });
            btn.disabled = state.status === 'loading';
            box.appendChild(btn);
            if (state.status === 'done' && state.shown) {
                const list = el('div', 'docker-changes service-changes');
                list.setAttribute('data-service-changes', '');
                if (state.data) {
                    window.DockerDrawer.renderChanges(list, state.data, { t: (k, f) => this.dashT(k, f), summary: this.data?.container });
                } else {
                    list.appendChild(el('p', 'docker-changes-empty', this.t('githubUnreachable', 'Could not reach GitHub from nextDash. Try again later.')));
                }
                box.appendChild(list);
            }
            return box;
        }

        async toggleGithub(name, hostId) {
            const state = this._changes;
            if (!state || state.name !== name || state.hostId !== hostId || state.status === 'loading') return;
            if (state.status === 'done') {
                state.shown = !state.shown;
                this.paint();
                return;
            }
            state.status = 'loading';
            this.paint();
            let data = null;
            try {
                if (typeof window.DockerDrawer?.renderChanges !== 'function') {
                    await window.LazyScript.loadScriptOnce('js/dashboard/dashboard-docker-drawer.js', 'dashboardDockerDrawer',
                        () => typeof window.DockerDrawer === 'function');
                }
                // The drawer's own request: the server caches the answer a day
                // and says why it has none (rate limit, token turned down).
                const res = await fetch(this.hostUrl(`/api/docker/containers/${encodeURIComponent(name)}/changelog`, hostId));
                if (res.ok) data = await res.json();
            } catch { data = null; }
            if (this._changes !== state) return;
            state.status = 'done';
            state.shown = true;
            state.data = data;
            this.paint();
        }

        /* ── Not set up yet: everything missing, as rows in one card ─────── */

        sectionSetup(data) {
            const b = data.bookmark;
            const c = data.container;
            const rows = [];
            const small = 'config-btn config-btn--small';
            if (!b?.found) {
                if (c) {
                    rows.push(['bookmark', this.t('setupBookmark', 'Link the bookmark that opens this container.'),
                        button(this.t('setupBookmarkBtn', 'Link a bookmark'), small, () => void this.openInContainers(c.name, data.host || '', 'bookmark'), { 'data-service-action': 'link-bookmark' })]);
                }
            } else {
                if (b.checkMode === 'off' && !(b.monitor && b.monitor.totalChecks > 0) && !data.checks.length) {
                    rows.push(['checking', this.t('setupChecking', 'Have nextDash watch whether this address answers.'),
                        button(this.t('turnOnChecking', 'Turn on checking'), small, () => void this.turnOnChecking(b), { 'data-service-action': 'turn-on-checking' })]);
                }
                if (!c && data.docker?.available) {
                    rows.push(['container', this.t('setupContainer', 'Link the container this runs in.'),
                        button(this.t('setupContainerBtn', 'Choose a container'), small, () => void this.chooseContainer(), { 'data-service-action': 'choose-container' })]);
                }
                if (!(data.watches || []).some((w) => (w.items || []).length)) {
                    rows.push(['feed', this.t('setupFeed', 'Follow this project\'s releases as a feed.'),
                        button(this.t('setupFeedBtn', 'Follow a feed'), small, () => void this.followFeed(), { 'data-service-action': 'follow-feed' })]);
                }
            }
            if (!rows.length) return null;
            const sec = el('section', 'service-setup');
            sec.setAttribute('data-service-section', 'setup');
            sec.appendChild(el('h3', 'service-setup-title', this.t('setupTitle', 'Not set up yet')));
            rows.forEach(([key, text, btn]) => {
                const row = el('div', 'service-setup-row');
                row.setAttribute('data-service-setup', key);
                row.append(el('span', '', text), btn);
                sec.appendChild(row);
            });
            return sec;
        }

        async chooseContainer() {
            await this.closeAndSettle();
            void this.dash.docker?.openDockerView?.({});
        }

        async followFeed() {
            await this.closeAndSettle();
            void this.dash.config?.openConfigView?.('feed-watch');
        }

        /* ── Note: the bookmark's own, saved the way the Bookmarks panel saves it ── */

        sectionNote(data) {
            const b = data.bookmark;
            // A container without a bookmark has no note of its own to keep.
            if (!b?.found) { this._noteNode = null; return null; }
            const key = `${b.pageId}::${b.url}`;
            const keep = this._noteNode;
            if (keep && keep.key === key && keep.sec.isConnected) {
                const { ta } = keep;
                // Followed to what is stored, unless it is being typed in.
                if (document.activeElement !== ta && ta.value === ta.dataset.original
                    && ta.value !== String(b.note || '')) {
                    ta.value = String(b.note || '');
                    ta.dataset.original = ta.value;
                }
                keep.ref = { pageId: b.pageId, index: b.index, url: b.url };
                return keep.sec;
            }
            const sec = this.section('note', this.t('sectionNote', 'Note'));
            const ta = el('textarea', 'config-text service-note-input');
            ta.rows = 3;
            ta.value = String(b.note || '');
            ta.dataset.original = ta.value;
            ta.setAttribute('data-service-note', '');
            ta.placeholder = this.t('emptyNote', 'No note yet.');
            ta.setAttribute('aria-label', this.t('sectionNote', 'Note'));
            const status = el('span', 'service-note-status');
            status.setAttribute('role', 'status');
            sec.append(ta, status);
            const node = { key, sec, ta, status, ref: { pageId: b.pageId, index: b.index, url: b.url } };
            // Text saves on leaving the field, as in the panel; Escape goes back
            // to what is stored without saving.
            ta.addEventListener('blur', () => void this.commitNote(node));
            ta.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Escape') {
                    e.preventDefault();
                    ta.value = ta.dataset.original;
                    status.textContent = '';
                    status.classList.remove('is-error');
                    ta.blur();
                }
            });
            this._noteNode = node;
            return sec;
        }

        async commitNote(node) {
            const { ta, status } = node;
            const value = ta.value;
            if (value === ta.dataset.original) return;
            status.textContent = '';
            status.classList.remove('is-error');
            const ok = await this.saveNote(node.ref, value);
            if (!ok) {
                status.textContent = this.t('noteNotSaved', 'Not saved — retry');
                status.classList.add('is-error');
                return;
            }
            // What was saved is what Escape goes back to from now on.
            ta.dataset.original = value;
            if (this.data?.bookmark && this._noteNode === node) this.data.bookmark.note = value;
        }

        /**
         * PATCH /api/bookmarks with the one field: the request the Bookmarks
         * panel makes (DashboardConfig.saveBookmarkFields / patchRows), by URL
         * and occurrence on its page so a duplicate row is not mistaken.
         */
        async saveNote(ref, value) {
            const d = this.dash;
            const canon = (u) => window.BookmarkUrlUtils?.canonicalBookmarkURLKey?.(String(u || '')) || String(u || '');
            try {
                const res = await fetch(`/api/bookmarks?page=${Number(ref.pageId)}`);
                if (!res.ok) return false;
                const list = await res.json();
                if (!Array.isArray(list)) return false;
                const key = canon(ref.url);
                let at = list[ref.index] && canon(list[ref.index].url) === key ? ref.index : list.findIndex((r) => canon(r.url) === key);
                if (at < 0) return false;
                const occurrence = list.slice(0, at).filter((r) => canon(r.url) === key).length;
                const write = typeof window.nextDashFetch === 'function' ? window.nextDashFetch : fetch;
                const out = await write('/api/bookmarks', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: Number(ref.pageId), updates: [{ url: list[at].url, occurrence, fields: { note: value } }] }),
                });
                if (!out.ok) return false;
                await d.data?.refreshAfterBookmarkMutation?.({ pageId: d.currentPageId, repaintActiveView: false });
                return true;
            } catch {
                return false;
            }
        }

        /* ── Logs: the shared reader, mounted once the strip is opened ───── */

        sectionLogs(data) {
            const c = data.container;
            if (!c) { this.disposeLogs(); return null; }
            if (this._logs?.name === c.name && this._logs.hostId === (data.host || '') && this._logs.sec.isConnected) return this._logs.sec;
            this.disposeLogs();
            const toggle = button(this.t('showLogs', 'Show logs'), 'service-link', () => void this.toggleLogs(), { 'data-service-action': 'open-logs', 'aria-expanded': 'false' });
            const sec = this.section('logs', `${this.t('sectionLogs', 'Logs')} · ${c.name}`, [toggle]);
            sec.classList.add('service-sec--logs');
            const host = el('div', 'service-logs-host');
            host.hidden = true;
            const idle = el('p', 'service-empty', this.t('emptyLogs', 'Logs load when you open this strip.'));
            sec.append(idle, host);
            this._logs = { name: c.name, hostId: data.host || '', sec, toggle, host, idle, reader: null, open: false };
            return sec;
        }

        async toggleLogs() {
            const logs = this._logs;
            if (!logs) return;
            if (logs.open) {
                logs.reader?.destroy();
                logs.reader = null;
                logs.open = false;
                logs.host.replaceChildren();
                logs.host.hidden = true;
                logs.idle.hidden = false;
                logs.idle.textContent = this.t('emptyLogs', 'Logs load when you open this strip.');
                logs.toggle.textContent = this.t('showLogs', 'Show logs');
                logs.toggle.setAttribute('aria-expanded', 'false');
                return;
            }
            logs.open = true;
            logs.toggle.textContent = this.t('hideLogs', 'Hide logs');
            logs.toggle.setAttribute('aria-expanded', 'true');
            logs.idle.hidden = true;
            logs.host.hidden = false;
            try {
                if (typeof window.DockerLogView !== 'function') {
                    await window.LazyScript.loadScriptOnce('js/dashboard/dashboard-docker-logs.js', 'dashboardDockerLogs',
                        () => typeof window.DockerLogView === 'function');
                }
            } catch {
                if (this._logs === logs) this.logsMessage(logs, this.t('logsUnavailable', 'The log reader could not be loaded.'));
                return;
            }
            if (this._logs !== logs || !logs.open) return;
            const { name, hostId } = logs;
            logs.reader = window.DockerLogView.mount(logs.host, {
                name,
                view: { t: (key, fallback, params) => this.dashT(key.replace(/^dashboard\./, ''), fallback, params) },
                url: (since, tail) => {
                    const q = new URLSearchParams({ tail: String(tail) });
                    if (since) q.set('since', since);
                    return this.hostUrl(`/api/docker/containers/${encodeURIComponent(name)}/logs/stream?${q}`, hostId);
                },
                // The reader's own wording says "needs the write token"; the page says it once, here.
                onNeedsToken: () => {
                    if (this._logs === logs) this.logsMessage(logs, this.t('logsNeedToken', 'Logs need the write token'));
                },
            });
        }

        /** The strip's empty state in place of the reader. */
        logsMessage(logs, text) {
            logs.reader?.destroy();
            logs.reader = null;
            logs.host.replaceChildren(el('p', 'service-empty', text));
            logs.host.querySelector('p').setAttribute('data-service-logs-message', '');
        }

        disposeLogs() {
            this._logs?.reader?.destroy();
            this._logs = null;
        }

        /* ── Stats: a sparkline while the section is in view ─────────────── */

        statsRow(c) {
            const box = el('div', 'service-load');
            box.setAttribute('data-service-stats', '');
            this.drawStats(box);
            return box;
        }

        /** After a paint: watch the new container section, and start or stop the poll. */
        watchContainer(data, section) {
            this._statsObserver?.disconnect();
            this._statsObserver = null;
            const c = data.container;
            if (!c || !section || c.state !== 'running') {
                this.stopStats();
                return;
            }
            if (this._stats?.name !== c.name || this._stats.hostId !== (data.host || '')) {
                this.stopStats();
                this._stats = { name: c.name, hostId: data.host || '', series: [], cpu: null, memUsed: null, memLimit: null, inflight: false, first: true, timer: null, last: 0 };
            }
            this._statsVisible = false;
            if (typeof IntersectionObserver === 'function') {
                this._statsObserver = new IntersectionObserver((entries) => {
                    const seen = entries.some((e) => e.isIntersecting);
                    this._statsVisible = seen;
                    if (seen) this.tickStats();
                });
                this._statsObserver.observe(section);
            } else {
                this._statsVisible = true;
            }
            if (!this._stats.timer) this._stats.timer = setInterval(() => this.tickStats(), STATS_MS);
            this.tickStats();
        }

        stopStats() {
            if (this._stats?.timer) clearInterval(this._stats.timer);
            this._stats = null;
        }

        async tickStats() {
            const st = this._stats;
            if (!st || st.inflight || !this._statsVisible || document.visibilityState !== 'visible' || !this.isActiveView()) return;
            if (Date.now() - st.last < STATS_MS - 500) return;
            st.inflight = true;
            try {
                // The first reading brings the sampler's last hour; after that
                // only the figures, one daemon call every ten seconds.
                const res = await fetch(this.hostUrl(`/api/docker/containers/${encodeURIComponent(st.name)}/stats${st.first ? '?history=1' : ''}`, st.hostId));
                if (!res.ok || this._stats !== st) return;
                const data = await res.json();
                if (st.first && Array.isArray(data.history)) {
                    st.series = data.history.map((p) => ({ t: p.t, cpu: Number(p.cpu) || 0 }));
                }
                st.first = false;
                st.last = Date.now();
                st.cpu = Number(data.cpuPercent);
                st.memUsed = Number(data.memoryUsed);
                st.memLimit = Number(data.memoryLimit);
                st.series.push({ t: Date.now(), cpu: Number.isFinite(st.cpu) ? st.cpu : 0 });
                if (st.series.length > STATS_KEEP) st.series.splice(0, st.series.length - STATS_KEEP);
                const box = this.pop?.scroll.querySelector('[data-service-stats]');
                if (box) this.drawStats(box);
                // The key figures carry the load too: repainted around what stays.
                const oldKpis = this.pop?.scroll.querySelector('[data-service-kpis]');
                const freshKpis = this.data ? this.buildKpis(this.data) : null;
                if (oldKpis && freshKpis) oldKpis.replaceWith(freshKpis);
            } catch { /* the next beat asks again */ } finally {
                st.inflight = false;
            }
        }

        drawStats(box) {
            const st = this._stats;
            if (!st || st.cpu == null) {
                box.replaceChildren(el('span', 'service-muted', this.t('statsWaiting', 'Reading…')));
                return;
            }
            const bytes = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GiB` : `${Math.round(n / 1024 ** 2)} MiB`);
            const text = el('span', 'service-load-text', this.t('statsLine', 'CPU {cpu}% · Memory {mem}', {
                cpu: Number.isFinite(st.cpu) ? st.cpu.toFixed(1) : '—',
                mem: Number.isFinite(st.memUsed) ? `${bytes(st.memUsed)}${st.memLimit > 0 ? ` / ${bytes(st.memLimit)}` : ''}` : '—',
            }));
            box.replaceChildren(this.spark(st.series), text);
        }

        /** CPU over the last hour as one line; with fewer than two points there is nothing to draw. */
        spark(series) {
            const W = 120;
            const H = 24;
            const ns = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(ns, 'svg');
            svg.setAttribute('class', 'service-spark');
            svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.setAttribute('role', 'img');
            svg.setAttribute('aria-label', this.t('sparkLabel', 'CPU, last hour'));
            const pts = series.filter((p) => p.t >= Date.now() - 3_600_000);
            if (pts.length < 2) return svg;
            const t0 = pts[0].t;
            const span = Math.max(1, pts[pts.length - 1].t - t0);
            const top = Math.max(1, ...pts.map((p) => p.cpu)) * 1.15;
            const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(((p.t - t0) / span) * W).toFixed(1)} ${(H - (p.cpu / top) * (H - 2)).toFixed(1)}`).join(' ');
            const line = document.createElementNS(ns, 'path');
            line.setAttribute('d', d);
            line.setAttribute('class', 'service-spark-line');
            line.setAttribute('vector-effect', 'non-scaling-stroke');
            svg.appendChild(line);
            return svg;
        }

        /** Everything the page started that outlives a paint: the log stream and the stats poll. */
        disposeLive() {
            this.disposeLogs();
            this.stopStats();
            this._statsObserver?.disconnect();
            this._statsObserver = null;
            this._noteNode = null;
            this._changes = null;
            this._wrap = null;
        }

        /* ── Keys ────────────────────────────────────────────────────────── */

        setupKeys() {
            if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler, true);
            this._keyHandler = (e) => {
                if (!this._open || !document.querySelector('#app-modal.show [data-service-root]')) return;
                const d = this.dash;
                if (d.searchComponent?.isActive?.()) return;
                if (document.querySelector('dialog[open], .bookmark-context-menu, .move-popover')) return;
                const active = document.activeElement;
                const tag = active?.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) return;
                if (active?.closest?.('[data-logs-view]')) return;
                if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
                // Escape is the app modal's own.
                if (e.key === 'o' && this.data?.bookmark?.found) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    this.openAddress(this.data.bookmark.url);
                }
            };
            document.addEventListener('keydown', this._keyHandler, true);
        }
    }

    window.DashboardService = DashboardService;
})();
