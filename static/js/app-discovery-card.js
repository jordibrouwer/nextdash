/**
 * The "x apps found" card: the web apps nextDash found among the containers
 * on this server, offered once, grouped by kind, all ticked. Add puts the
 * ticked ones on the page in a category per kind; Close leaves them in the
 * Containers view.
 *
 * On a fresh install it takes the place of the "What do you run?" card, and
 * hands over to it when the first look through the containers finds nothing
 * (onDone('none')). On an install that is already set up it shows once, on
 * main, for the containers that have no bookmark yet.
 */
(function (global) {
    'use strict';

    const MAIN_PAGE_ID = 1;
    // Bars that belong to the grid and sit right above it; the card stays above them.
    const GRID_BARS = '#grid-filter-bar, .multi-select-toolbar';
    const POLL_MS = 3000;

    function t(key, fallback, params) {
        const lang = global.dashboardInstance?.language;
        let text = fallback;
        if (lang?.t) {
            const full = `discovery.${key}`;
            const value = lang.t(full);
            if (value && value !== full) text = value;
        }
        return params
            ? Object.entries(params).reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)), String(text))
            : text;
    }

    const esc = (value) => global.NextDashHtml.escapeHtml(String(value ?? ''));

    /** "Documents & photos" -> "documents-photos", for the translation key. */
    const kindSlug = (kind) => String(kind || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    /** The kind as the reader sees it; also the category name Add stores. */
    function kindLabel(kind) {
        return t(`kind.${kindSlug(kind)}`, kind || 'Apps');
    }

    /** Where an app lives, shortened for the row: no scheme, no trailing slash. */
    function shortAddress(url) {
        return String(url || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }

    /**
     * The browser's own matching, over again: the links set by hand and the
     * host address can differ per device, and the copy here is the one the
     * reader sees. The app's address stands in for the container's web UI.
     */
    function withoutBookmark(apps, dash) {
        const index = global.DockerSearchIndex;
        if (!index?.bookmarkFor) return apps;
        const all = dash?.allBookmarks || [];
        return apps.filter((app) => !index.bookmarkFor({ name: app.name, webui: app.url, ports: [] }, all));
    }

    async function getDiscovery() {
        const res = await fetch('/api/discovery', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
    }

    function post(path, body) {
        const api = typeof global.nextDashFetch === 'function' ? global.nextDashFetch : fetch;
        return api(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
        });
    }

    class AppDiscoveryCard {
        constructor(dash, { onDone } = {}) {
            this.dash = dash;
            this.onDone = typeof onDone === 'function' ? onDone : () => {};
            this.el = null;
            this.apps = [];
            this.unticked = new Set();
            this.looking = false;
            this.busy = false;
            this.pollTimer = null;
            this.pageTimer = null;
            this.keyHandler = (event) => {
                if (event.key !== 'Escape' || !this.el || this.el.hidden || this.busy) return;
                if (this.dash?.isModalOpen?.()) return;
                this.close();
            };
        }

        /** Whether the answer from /api/discovery is worth a card at all. */
        static wanted(info) {
            if (!info || !info.enabled || info.cardDone) return false;
            return info.running === true || (info.docker === true && (info.apps || []).length > 0);
        }

        async show(info) {
            let data = info;
            if (!data) {
                try {
                    data = await getDiscovery();
                } catch {
                    this.onDone('none');
                    return;
                }
            }
            if (!AppDiscoveryCard.wanted(data)) { this.onDone('none'); return; }
            document.addEventListener('keydown', this.keyHandler);
            // Only on main, as the template card: it follows the reader there
            // and back without being answered by a page switch.
            this.pageTimer = setInterval(() => this.place(), 500);
            this.update(data);
        }

        update(data) {
            if (data.running) {
                this.looking = true;
                this.render();
                clearTimeout(this.pollTimer);
                this.pollTimer = setTimeout(() => this.poll(), POLL_MS);
                return;
            }
            this.looking = false;
            this.apps = data.enabled && data.docker ? withoutBookmark(data.apps || [], this.dash) : [];
            if (!this.apps.length) {
                // Nothing to offer after all: the template card takes over.
                this.teardown();
                this.onDone('none');
                return;
            }
            this.render();
        }

        async poll() {
            if (!this.el) return;
            try {
                this.update(await getDiscovery());
            } catch {
                this.pollTimer = setTimeout(() => this.poll(), POLL_MS);
            }
        }

        place() {
            if (!this.el) return;
            const grid = document.getElementById('dashboard-layout');
            let anchor = grid;
            while (anchor?.previousElementSibling
                && anchor.previousElementSibling !== this.el
                && anchor.previousElementSibling.matches(GRID_BARS)) {
                anchor = anchor.previousElementSibling;
            }
            if (anchor && this.el.nextElementSibling !== anchor) anchor.before(this.el);
            const onMain = Number(this.dash?.currentPageId) === MAIN_PAGE_ID && this.dash?.activeView !== 'config';
            this.el.hidden = !onMain;
        }

        render() {
            if (!this.el) {
                this.el = document.createElement('section');
                this.el.className = 'first-start-card app-discovery-card';
                this.el.setAttribute('data-app-discovery-card', '');
                this.el.setAttribute('aria-label', t('card.label', 'Apps found on this server'));
                this.el.addEventListener('click', (event) => this.onClick(event));
                this.el.addEventListener('change', (event) => this.onChange(event));
            }
            this.el.innerHTML = `<div class="first-start-stripe"></div>${this.looking ? this.lookingHtml() : this.listHtml()}`;
            this.place();
        }

        headHtml(title) {
            return `<div class="first-start-head">
                <p class="first-start-title">// ${esc(title)}</p>
                <button type="button" class="first-start-close" data-ad-close aria-label="${esc(t('card.close', 'Close'))}">×</button>
            </div>`;
        }

        lookingHtml() {
            return `<div class="first-start-inner">
                ${this.headHtml(t('card.lookingTitle', 'apps on this server'))}
                <p class="app-discovery-looking" data-ad-looking role="status"><span class="app-discovery-spin" aria-hidden="true"></span>${esc(t('card.looking', 'Looking for apps…'))}</p>
            </div>`;
        }

        listHtml() {
            const groups = new Map();
            this.apps.forEach((app) => {
                const kind = app.kind || 'Apps';
                if (!groups.has(kind)) groups.set(kind, []);
                groups.get(kind).push(app);
            });
            const rows = [...groups.entries()].map(([kind, apps]) => `
                <div class="app-discovery-kind">${esc(kindLabel(kind))}</div>
                ${apps.map((app) => this.rowHtml(app)).join('')}`).join('');
            const ticked = this.apps.length - this.unticked.size;
            const title = this.apps.length === 1
                ? t('card.foundOne', '1 app found')
                : t('card.found', '{count} apps found', { count: this.apps.length });
            const add = ticked === 1
                ? t('card.addOne', 'Add 1 app')
                : t('card.add', 'Add {count} apps', { count: ticked });
            return `<div class="first-start-inner">
                ${this.headHtml(title)}
                <p class="first-start-sub">${esc(t('card.intro', 'Running on this server. Tick the ones you want on this page.'))}</p>
                <div class="app-discovery-groups">${rows}</div>
                <p class="first-start-error" data-ad-error role="alert" hidden></p>
                <div class="first-start-actions">
                    <button type="button" class="first-start-apply" data-ad-add ${ticked ? '' : 'disabled'}>${esc(add)}</button>
                    <button type="button" class="first-start-back" data-ad-close>${esc(t('card.closeButton', 'Close'))}</button>
                </div>
                <p class="first-start-note">${esc(t('card.note', 'Added to this page, grouped by kind, each with a status check. Unticked apps stay in the Containers view.'))}</p>
            </div>`;
        }

        rowHtml(app) {
            const name = app.displayName || app.name;
            const icon = app.iconUrl
                ? `<img class="app-discovery-icon" src="${esc(app.iconUrl)}" alt="" loading="lazy">`
                : `<span class="app-discovery-icon app-discovery-icon--letter" aria-hidden="true">${esc(String(name).charAt(0).toUpperCase())}</span>`;
            return `<label class="app-discovery-row" data-ad-app="${esc(app.name)}">
                <input type="checkbox" data-ad-tick="${esc(app.name)}" ${this.unticked.has(app.name) ? '' : 'checked'}>
                ${icon}
                <span class="app-discovery-text">
                    <span class="app-discovery-name">${esc(name)}</span>
                    <span class="app-discovery-address">${esc(shortAddress(app.url))}</span>
                </span>
            </label>`;
        }

        onChange(event) {
            const name = event.target.getAttribute?.('data-ad-tick');
            if (name == null) return;
            if (event.target.checked) this.unticked.delete(name);
            else this.unticked.add(name);
            const ticked = this.apps.length - this.unticked.size;
            const button = this.el.querySelector('[data-ad-add]');
            if (button) {
                button.disabled = ticked === 0;
                button.textContent = ticked === 1
                    ? t('card.addOne', 'Add 1 app')
                    : t('card.add', 'Add {count} apps', { count: ticked });
            }
        }

        onClick(event) {
            const target = event.target.closest('button');
            if (!target || this.busy) return;
            if (target.hasAttribute('data-ad-close')) { this.close(); return; }
            if (target.hasAttribute('data-ad-add')) this.add();
        }

        showError(message) {
            const error = this.el?.querySelector('[data-ad-error]');
            if (!error) return;
            error.textContent = message;
            error.hidden = false;
        }

        async add() {
            const chosen = this.apps.filter((app) => !this.unticked.has(app.name));
            if (!chosen.length || this.busy) return;
            this.busy = true;
            const button = this.el.querySelector('[data-ad-add]');
            if (button) button.disabled = true;
            const pageId = Number(this.dash?.currentPageId) || MAIN_PAGE_ID;
            try {
                const res = await post('/api/discovery/add', {
                    pageId,
                    apps: chosen.map((app) => ({ name: app.name, category: kindLabel(app.kind) })),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
            } catch {
                this.busy = false;
                if (button) button.disabled = false;
                this.showError(t('card.addError', 'Could not add the apps'));
                return;
            }
            global.nextdashTrack?.('discovery:add', { count: chosen.length });
            await this.showPage(pageId);
            this.finish('added');
        }

        async close() {
            if (this.busy) return;
            this.busy = true;
            try { await post('/api/discovery/close'); } catch { /* the card still goes */ }
            if (this.dash?.settings) this.dash.settings.discoveryCardDone = true;
            this.finish('closed');
        }

        /** Bring the new bookmarks on screen without a reload. */
        async showPage(pageId) {
            const d = this.dash;
            if (d?.settings) d.settings.discoveryCardDone = true;
            try {
                const res = await fetch('/api/settings', { cache: 'no-store' });
                if (res.ok && d) {
                    const fresh = await res.json();
                    if (d.settings && fresh?.dockerBookmarkLinks) d.settings.dockerBookmarkLinks = fresh.dockerBookmarkLinks;
                }
            } catch { /* the links catch up on the next load */ }
            d?.data?.invalidatePageDataCache?.(pageId);
            await d?.data?.loadAllBookmarks?.();
            await d?.loadPageBookmarks?.(pageId, { forceFetch: true, skipInlineEditConfirm: true });
            void d?.data?.fetchAndStoreDataRevision?.();
        }

        finish(result) {
            this.teardown();
            this.onDone(result);
        }

        teardown() {
            document.removeEventListener('keydown', this.keyHandler);
            clearInterval(this.pageTimer);
            clearTimeout(this.pollTimer);
            this.el?.remove();
            this.el = null;
        }
    }

    AppDiscoveryCard.kindLabel = kindLabel;
    AppDiscoveryCard.getDiscovery = getDiscovery;
    global.AppDiscoveryCard = AppDiscoveryCard;
})(window);
