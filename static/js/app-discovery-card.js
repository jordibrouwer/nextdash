/**
 * The "x apps found" card: the web apps nextDash found among the containers
 * on this server, offered once, grouped by kind, all ticked.
 *
 * It opens in the middle of the screen with the dashboard dimmed behind it,
 * and only when nothing else asks for attention: What's new, a tour, a dialog
 * or a corner card goes first, and while the card is up those wait for it.
 * The card says what Add does and what happens afterwards.
 *
 * On a fresh install it takes the place of the "What do you run?" card, and
 * hands over to it when the first look through the containers finds nothing
 * (onDone('none')). On an install that is already set up it shows once, for
 * the containers that have no bookmark yet.
 *
 * After Add the new categories are at the top of the page; the page scrolls
 * to them, they light up, and a notice says what was added, with Undo.
 */
(function (global) {
    'use strict';

    const POLL_MS = 3000;
    const TURN_MS = 1000;

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

    /** Whether the one-time dashboard tour is still to come. */
    function tourPending(dash) {
        if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (dash.settings?.enableSessionTips === false) return false;
        const id = global.DashboardPromos?.DASHBOARD_TOUR_TIP_ID;
        return Boolean(id) && global.DiscoverabilityState?.hasSeenTip?.(id) !== true;
    }

    /**
     * Whether it is the card's turn. It comes last: after the onboarding (the
     * starting-page card and the quick-start checklist), after What's new and
     * the dashboard tour, and after every corner card that is up or still on
     * its way -- and never while a dialog or form is open.
     */
    async function turnIsFree(dash) {
        if (!dash?.settings) return false;
        if (dash.settings.onboardingCompleted !== true) return false;
        if (document.querySelector('.first-start-card, .quickstart-card')) return false;
        if (tourPending(dash)) return false;
        if (global.NoticeCard?.busy && (await global.NoticeCard.busy())) return false;
        if (global.DemoLock?.on) return false;
        if (dash.activeView && dash.activeView !== 'bookmarks') return false;
        if (typeof dash.isModalOpen === 'function' && dash.isModalOpen()) return false;
        // What's new, and the tour of what changed (tutorials open in #app-modal).
        if (document.querySelector('.whats-new-modal, .changes-tour-dim')) return false;
        // What's new for a release not read yet goes first: it opens a moment
        // after load, and the card would otherwise take the screen before it.
        // Only where What's new can show at all (not during the first run).
        if (dash.settings.onboardingCompleted && !dash.onboardingStartedInSession
            && dash.promos?.shouldShowWhatsNewPrompt?.() === true) return false;
        if (document.querySelector('.quickstart-card.notice-card, [data-holds-corner]')) return false;
        if (document.body.classList.contains('is-block-move-intro')) return false;
        if (document.body.classList.contains('bookmark-inline-edit-active')) return false;
        return true;
    }

    // ---- The notice after Add --------------------------------------------------

    let lastAdd = null;
    let addedNotice = null;

    function addedNoticeCard() {
        if (addedNotice || !global.NoticeCard?.define) return addedNotice;
        addedNotice = global.NoticeCard.define({
            id: 'app-discovery-added',
            essential: true,
            showDelayMs: 0,
            title: () => {
                const n = lastAdd?.added.length || 0;
                return n === 1
                    ? t('added.titleOne', '{name} added to {page}', { name: lastAdd.added[0].name, page: lastAdd.page })
                    : t('added.title', '{count} apps added to {page}', { count: n, page: lastAdd?.page || '' });
            },
            body: () => {
                const groups = new Map();
                (lastAdd?.added || []).forEach((a) => {
                    if (!groups.has(a.category)) groups.set(a.category, []);
                    groups.get(a.category).push(a.name);
                });
                const where = [...groups.entries()].map(([cat, names]) => `${cat}: ${names.join(', ')}`).join(' · ');
                const later = t('added.later', 'Each has a status check. A new container later is added the same way, with a notice like this one.');
                const starter = lastAdd?.replaced ? ` ${t('added.replaced', 'The starter links are gone; Undo brings them back.')}` : '';
                return `${where}. ${later}${starter}`;
            },
            dismissLabel: () => t('added.close', 'Close'),
            canShow: () => Boolean(lastAdd?.added.length),
            actionAttr: 'data-app-discovery-added-action',
            actions: [
                { name: 'show', label: () => t('added.show', 'Show'), primary: true, onClick: () => highlightCategories(lastAdd?.categories || []) },
                { name: 'undo', label: () => t('added.undo', 'Undo'), onClick: (card) => void undoAdd(card) },
                { name: 'done', label: () => t('added.done', 'Done'), onClick: (card) => { card.close(); finishAdded(); } },
            ],
            onDismiss: () => finishAdded(),
        });
        return addedNotice;
    }

    /** Scroll to the new categories and let them light up. */
    function highlightCategories(ids) {
        const els = ids
            .map((id) => document.querySelector(`#dashboard-layout .category[data-category-id="${CSS.escape(String(id))}"]`))
            .filter(Boolean);
        if (!els.length) return;
        els[0].scrollIntoView({ behavior: global.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        els.forEach((el) => {
            el.classList.remove('app-discovery-new');
            // Restart the animation when Show is pressed again.
            void el.offsetWidth;
            el.classList.add('app-discovery-new');
            setTimeout(() => el.classList.remove('app-discovery-new'), 3600);
        });
    }

    async function undoAdd(card) {
        const d = global.dashboardInstance;
        try {
            const res = await post('/api/discovery/undo-add');
            if (!res.ok) throw new Error(String(res.status));
        } catch {
            card.showError(t('added.undoFailed', 'Could not take it back'));
            return;
        }
        global.nextdashTrack?.('discovery:undo-add');
        const pageId = lastAdd?.pageId || Number(d?.currentPageId) || 1;
        card.close();
        await reloadPage(d, pageId);
        finishAdded();
    }

    /** The notice is done with. */
    function finishAdded() {
        lastAdd = null;
    }

    async function reloadPage(d, pageId) {
        try {
            const res = await fetch('/api/settings', { cache: 'no-store' });
            if (res.ok && d?.settings) {
                const fresh = await res.json();
                d.settings.dockerBookmarkLinks = fresh?.dockerBookmarkLinks || {};
            }
        } catch { /* the links catch up on the next load */ }
        try {
            const res = await fetch('/api/pages', { cache: 'no-store' });
            if (res.ok && d) d.pages = await res.json();
        } catch { /* the list catches up on the next revision check */ }
        d?.data?.invalidatePageDataCache?.(pageId);
        await d?.data?.loadAllBookmarks?.();
        await d?.loadPageBookmarks?.(pageId, { forceFetch: true, skipInlineEditConfirm: true });
        void d?.data?.fetchAndStoreDataRevision?.();
    }

    // ---- The card ----------------------------------------------------------------

    class AppDiscoveryCard {
        constructor(dash, { onDone } = {}) {
            this.dash = dash;
            this.onDone = typeof onDone === 'function' ? onDone : () => {};
            this.overlay = null;
            this.el = null;
            this.apps = [];
            this.unticked = new Set();
            this.replace = false;
            this.replacesStarter = false;
            this.looking = false;
            this.busy = false;
            this.pollTimer = null;
            this.turnTimer = null;
            this.lock = null;
            this.keyHandler = (event) => {
                if (!this.overlay || this.busy) return;
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    this.close();
                } else if (event.key === 'Tab') {
                    this.trapFocus(event);
                }
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
            this.pending = data;
            this.waitForTurn();
        }

        /** Open once nothing else holds the reader's attention. */
        async waitForTurn() {
            clearTimeout(this.turnTimer);
            if (!(await turnIsFree(this.dash)) || !this.pending) {
                if (this.pending) this.turnTimer = setTimeout(() => this.waitForTurn(), TURN_MS);
                return;
            }
            const data = this.pending;
            this.pending = null;
            this.update(data);
        }

        update(data) {
            this.replacesStarter = data.replacesStarter === true;
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
            if (!this.overlay) return;
            try {
                this.update(await getDiscovery());
            } catch {
                this.pollTimer = setTimeout(() => this.poll(), POLL_MS);
            }
        }

        open() {
            if (this.overlay) return;
            this.overlay = document.createElement('div');
            this.overlay.className = 'app-discovery-overlay';
            this.overlay.setAttribute('data-app-discovery-overlay', '');
            this.el = document.createElement('section');
            this.el.className = 'app-discovery-card';
            this.el.setAttribute('data-app-discovery-card', '');
            this.el.setAttribute('role', 'dialog');
            this.el.setAttribute('aria-modal', 'true');
            this.el.setAttribute('aria-labelledby', 'app-discovery-title');
            this.el.addEventListener('click', (event) => this.onClick(event));
            this.el.addEventListener('change', (event) => this.onChange(event));
            this.overlay.appendChild(this.el);
            document.body.appendChild(this.overlay);
            this.lock = global.ScrollLock?.acquire?.('app-discovery-card') ?? null;
            document.addEventListener('keydown', this.keyHandler, true);
            requestAnimationFrame(() => this.overlay?.classList.add('show'));
        }

        render() {
            const first = !this.overlay;
            this.open();
            this.el.innerHTML = this.looking ? this.lookingHtml() : this.listHtml();
            if (first || !this.el.contains(document.activeElement)) {
                (this.el.querySelector('[data-ad-add]') || this.el.querySelector('[data-ad-close]'))?.focus({ preventScroll: true });
            }
        }

        headHtml(kicker, title) {
            return `<div class="app-discovery-head">
                <span class="app-discovery-badge" aria-hidden="true">◎</span>
                <div class="app-discovery-heading">
                    <p class="app-discovery-kicker">${esc(kicker)}</p>
                    <h2 class="app-discovery-title" id="app-discovery-title">${esc(title)}</h2>
                </div>
                <button type="button" class="app-discovery-x" data-ad-close aria-label="${esc(t('card.close', 'Close'))}">×</button>
            </div>`;
        }

        lookingHtml() {
            return `<div class="app-discovery-stripe"></div><div class="app-discovery-inner">
                ${this.headHtml(t('card.kicker', 'Found on this server'), t('card.lookingTitle', 'Looking for apps…'))}
                <p class="app-discovery-looking" data-ad-looking role="status"><span class="app-discovery-spin" aria-hidden="true"></span>${esc(t('card.looking', 'Looking for apps… nextDash is checking which containers have a web page.'))}</p>
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
            const title = this.apps.length === 1
                ? t('card.foundOne', '1 app is running here')
                : t('card.found', '{count} apps are running here', { count: this.apps.length });
            const showReplace = this.replacesStarter && Number(this.dash?.currentPageId) === 1;
            return `<div class="app-discovery-stripe"></div><div class="app-discovery-inner">
                ${this.headHtml(t('card.kicker', 'Found on this server'), title)}
                <div class="app-discovery-info">
                    <p><b>${esc(t('card.infoAddLead', 'Add'))}</b> ${esc(t('card.infoAdd', 'puts the ticked apps on this page:'))}</p>
                    <ol>
                        <li>${esc(t('card.infoTop', 'one category per kind, at the top of the page;'))}</li>
                        <li>${esc(t('card.infoEach', 'each with its icon, a status check and a link to its container.'))}</li>
                    </ol>
                    <p><b>${esc(t('card.infoLaterLead', 'After that'))}</b>, ${esc(t('card.infoLater', 'a new container with a web page is added the same way, with a notice to undo it. Config → Containers changes that, or turns it off.'))}</p>
                </div>
                <div class="app-discovery-groups">${rows}</div>
                ${showReplace ? `<label class="app-discovery-replace">
                    <input type="checkbox" data-ad-replace ${this.replace ? 'checked' : ''}>
                    <span>${esc(t('card.replace', 'Replace the starter links on this page'))}
                        <small>${esc(t('card.replaceHint', 'This page still holds the links nextDash starts with. Undo brings them back.'))}</small></span>
                </label>` : ''}
                <p class="app-discovery-error" data-ad-error role="alert" hidden></p>
                <div class="app-discovery-actions">
                    <button type="button" class="app-discovery-add" data-ad-add>${esc(this.addLabel())}</button>
                    <button type="button" class="app-discovery-later" data-ad-close>${esc(t('card.notNow', 'Not now'))}</button>
                </div>
                <p class="app-discovery-note">${esc(t('card.note', 'Not now adds nothing; the apps stay in the Containers view.'))}</p>
            </div>`;
        }

        addLabel() {
            const ticked = this.apps.length - this.unticked.size;
            return ticked === 1 ? t('card.addOne', 'Add 1 app') : t('card.add', 'Add {count} apps', { count: ticked });
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
            const target = event.target;
            if (target.hasAttribute?.('data-ad-replace')) { this.replace = target.checked; return; }
            const name = target.getAttribute?.('data-ad-tick');
            if (name == null) return;
            if (target.checked) this.unticked.delete(name);
            else this.unticked.add(name);
            const button = this.el.querySelector('[data-ad-add]');
            if (button) {
                button.disabled = this.apps.length - this.unticked.size === 0;
                button.textContent = this.addLabel();
            }
        }

        onClick(event) {
            const target = event.target.closest('button');
            if (!target || this.busy) return;
            if (target.hasAttribute('data-ad-close')) { this.close(); return; }
            if (target.hasAttribute('data-ad-add')) this.add();
        }

        trapFocus(event) {
            const items = [...this.el.querySelectorAll('button, input')].filter((el) => !el.disabled);
            if (!items.length) return;
            const firstEl = items[0];
            const lastEl = items[items.length - 1];
            if (event.shiftKey && document.activeElement === firstEl) {
                event.preventDefault();
                lastEl.focus();
            } else if (!event.shiftKey && document.activeElement === lastEl) {
                event.preventDefault();
                firstEl.focus();
            }
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
            const d = this.dash;
            const pageId = Number(d?.currentPageId) || 1;
            let answer;
            try {
                const res = await post('/api/discovery/add', {
                    pageId,
                    replaceStarter: this.replace === true,
                    apps: chosen.map((app) => ({ name: app.name, category: kindLabel(app.kind) })),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                answer = await res.json();
            } catch {
                this.busy = false;
                if (button) button.disabled = false;
                this.showError(t('card.addError', 'Could not add the apps'));
                return;
            }
            global.nextdashTrack?.('discovery:add', { count: chosen.length, replaced: answer?.replaced === true });
            if (d?.settings) d.settings.discoveryCardDone = true;
            const added = Array.isArray(answer?.added) ? answer.added : [];
            // The page first, then the quick start: its next step names an app
            // that has to be on the page already.
            this.teardown();
            await reloadPage(d, pageId);
            const page = (d?.pages || []).find((p) => Number(p.id) === pageId);
            const categories = (d?.categories || [])
                .filter((c) => added.some((a) => a.category === c.name))
                .map((c) => c.id);
            lastAdd = { added, categories, pageId, page: page?.name || 'this page', replaced: answer?.replaced === true };
            highlightCategories(categories);
            // The notice first, then the quick start, which waits for the
            // corner to be free (renderChecklistWhenFree).
            await addedNoticeCard()?.render();
            this.onDone('added', added);
        }

        async close() {
            if (this.busy) return;
            this.busy = true;
            try { await post('/api/discovery/close'); } catch { /* the card still goes */ }
            if (this.dash?.settings) this.dash.settings.discoveryCardDone = true;
            this.finish('closed');
        }

        finish(result, added) {
            this.teardown();
            this.onDone(result, added || []);
        }

        teardown() {
            document.removeEventListener('keydown', this.keyHandler, true);
            clearTimeout(this.pollTimer);
            clearTimeout(this.turnTimer);
            if (this.lock != null) {
                global.ScrollLock?.release?.(this.lock);
                this.lock = null;
            }
            this.overlay?.remove();
            this.overlay = null;
            this.el = null;
            // Whatever waited for the card -- a corner card -- may come now.
            global.NoticeCard?.wakeQueue?.();
        }
    }

    AppDiscoveryCard.kindLabel = kindLabel;
    AppDiscoveryCard.getDiscovery = getDiscovery;
    global.AppDiscoveryCard = AppDiscoveryCard;
})(window);
