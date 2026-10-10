/**
 * Config -> Status page.
 *
 * The owner side of the read-only page for the people who use the services:
 * whether it is on, its link (a secret path) and who may open it, and the
 * title and notice at the top. The groups and the maintenance windows are
 * filled into [data-sp-groups] and [data-sp-maint] by their own files.
 *
 * State lives in this.statusPage = { config, path, sources, loadError }, and
 * the groups card adds docker = { answered, containers }.
 * Saves are debounced PUTs of the whole config, like Finders.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    const SAVE_DELAY_MS = 400;
    const HELP_ID = 'status-page-share'; // DashboardConfig.helpPanelId('config.helpStatusPageShareTitle')

    Object.assign(global.DashboardConfig.prototype, {

    renderStatusPageSection() {
        const esc = (v) => this.dash.escapeHtml(v);
        const t = (key, fallback) => esc(this.t(`config.${key}`, fallback));
        const active = this.statusPageTab || 'all';
        const tabs = global.DashboardConfig.STATUS_PAGE_TABS.map((tab) => {
            const on = tab === active;
            return `<button type="button" class="config-subtab${on ? ' is-active' : ''}" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" aria-controls="config-status-page-body" data-sp-tab="${esc(tab)}">${esc(this.statusPageTabLabel(tab))}</button>`;
        }).join('');
        // A card is on its own tab, and on All.
        const shown = (panel) => (active === 'all' || active === panel ? '' : ' hidden');
        return `
            <p class="config-view-intro">${t('statusPageIntro',
                'A read-only page for the people who use your services. Only people with the link can open it.')}</p>
            <div class="config-subtabs" role="tablist">${tabs}</div>
            <div class="config-tabpage">
                <div class="config-tabpage-main" id="config-status-page-body" role="tabpanel" tabindex="0">
                    <p class="config-note config-note--warn" data-sp-load-error role="status" hidden></p>
                    <div class="config-panel status-page-about" data-sp-about>
                        <p>${t('statusPageAbout1',
                            'The status page answers “does it work?” for the people who use your services, at home and over the internet, without access to this dashboard. They see your groups, each service’s state, since when one is down, planned maintenance and 30 days of history, in their own language and in light or dark. It refreshes itself every minute.')}</p>
                        <p>${t('statusPageAbout2',
                            'They never see error details, container images or internal addresses, unless you switch on Link for a service. Set it up from top to bottom: turn it on and share the link, give it a title, make groups of services, and link your maintenance windows. Everything saves as you go.')}
                            <a class="config-link-btn" href="#config/help/monitoring">${t('statusPageAboutHelp', 'More in Help')}</a></p>
                    </div>
                    <div class="config-panel" data-sp-link-card data-sp-panel="link"${shown('link')}>
                        ${this.statusPageCardTitle('link', this.t('config.statusPageLinkTitle', 'Link and access'))}
                        <label class="config-toggle">
                            <input type="checkbox" data-sp-enabled disabled>
                            <span>${t('statusPageEnabled', 'Turn the status page on')}</span>
                        </label>
                        <p class="config-field-hint" data-sp-off-note>${t('statusPageOffNote', 'Turn the page on to get its link.')}</p>
                        <div class="status-page-link-row" data-sp-link-row hidden>
                            <code class="status-page-link" data-sp-link></code>
                            <div class="config-actions">
                                <button type="button" class="config-btn config-btn--small" data-sp-copy>${t('statusPageCopy', 'Copy')}</button>
                                <a class="config-btn config-btn--small" data-sp-open target="_blank" rel="noopener noreferrer" href="#">${t('statusPageOpen', 'Open')}</a>
                                <button type="button" class="config-btn config-btn--small" data-sp-new-link>${t('statusPageNewLink', 'New link…')}</button>
                            </div>
                            <div class="status-page-qr" data-sp-qr></div>
                        </div>
                        <label class="config-toggle">
                            <input type="checkbox" data-sp-lan disabled>
                            <span>${t('statusPageLan', 'Only from the home network')}</span>
                        </label>
                        <p class="config-field-hint">${t('statusPageLanHint',
                            'Visitors from outside your home network, or through a proxy nextDash does not trust, get a page-not-found.')}</p>
                        <p class="config-field-hint" data-sp-share-hint>
                            ${t('statusPageShareHintA', 'Sharing over the internet? Let your reverse proxy pass only')}
                            <code>/s/</code> ${t('statusPageShareHintAnd', 'and')} <code>/static/status/</code>
                            ${t('statusPageShareHintB', 'to nextDash. nextDash has no login, so opening the whole app to the internet lets anyone read your dashboard.')}
                            <a class="config-link-btn" href="#config/help/monitoring/${esc(HELP_ID)}">${t('statusPageShareHintLink', 'How to set it up')}</a><br>
                            ${t('statusPageProxyHintA', 'Behind a proxy, add it to')} <code>NEXTDASH_TRUSTED_PROXIES</code>
                            ${t('statusPageProxyHintB', 'so “Only from the home network” and the rate limit see each visitor.')}
                        </p>
                    </div>
                    <div class="config-panel" data-sp-top-card data-sp-panel="top"${shown('top')}>
                        ${this.statusPageCardTitle('top', this.t('config.statusPageTopTitle', 'Top of the page'))}
                        <div class="config-field">
                            <label class="config-field-label" for="config-sp-title">${t('statusPageTitleLabel', 'Title')}</label>
                            <input type="text" id="config-sp-title" class="config-text" data-sp-title maxlength="120"
                                   autocomplete="off" placeholder="${t('statusPageTitlePlaceholder', 'Service status')}" disabled>
                        </div>
                        <div class="config-field">
                            <label class="config-field-label" for="config-sp-notice">${t('statusPageNoticeLabel', 'Notice')}</label>
                            <input type="text" id="config-sp-notice" class="config-text" data-sp-notice maxlength="500"
                                   autocomplete="off" placeholder="${t('statusPageNoticePlaceholder', 'Optional, shown under the title')}" disabled>
                        </div>
                    </div>
                    <div data-sp-groups data-sp-panel="groups"${shown('groups')}></div>
                    <div data-sp-maint data-sp-panel="maintenance"${shown('maintenance')}></div>
                </div>
            </div>
        `;
    },

    /** Show the cards of the chosen tab; All shows every card. */
    showStatusPageTab(root) {
        const tab = this.statusPageTab || 'all';
        root.querySelectorAll('[data-sp-panel]').forEach((panel) => {
            panel.hidden = !(tab === 'all' || panel.getAttribute('data-sp-panel') === tab);
        });
    },

    statusPageTabLabel(tab) {
        const map = {
            all: ['config.statusPageTabAll', 'All'],
            link: ['config.statusPageTabLink', 'Link and access'],
            top: ['config.statusPageTabTop', 'Top of the page'],
            groups: ['config.statusPageTabGroups', 'Groups and services'],
            maintenance: ['config.statusPageTabMaintenance', 'Maintenance'],
        };
        const [key, fallback] = map[tab] || [tab, tab];
        return this.t(key, fallback);
    },

    /**
     * A card's title with its ℹ button. One place for all four, so the cards
     * drawn by their own functions get the same button; it opens the same
     * "Got it" modal as every other ℹ in Config.
     */
    statusPageCardTitle(card, title) {
        const esc = (v) => this.dash.escapeHtml(v);
        const more = this.t('config.settingInfoAria', 'More info');
        return `<h3 class="config-panel-title status-page-card-title">${esc(title)}
                <button type="button" class="config-info-btn" data-sp-info="${esc(card)}" aria-haspopup="dialog" aria-label="${esc(more)}" title="${esc(more)}">ℹ</button></h3>`;
    },

    /** The ℹ modal of one card, as openFieldInfo shows a setting's. */
    openStatusPageInfo(card) {
        const info = {
            link: ['statusPageInfoLink', 'Turning the page on makes a secret link. Anyone who has it can open the page, so sharing the link is sharing the page. New link… makes a fresh one and the old link stops at once. Only from the home network refuses visitors from outside your own network, and visitors through a proxy you have not named in NEXTDASH_TRUSTED_PROXIES.'],
            top: ['statusPageInfoTop', 'The title and the notice are the first things a visitor reads. Under them the page adds one line for everything: all services working, or how many have a problem. Leave the notice empty to hide it.'],
            groups: ['statusPageInfoGroups', 'A service is a monitored bookmark, a container, or both; the worse of the two counts. A bookmark linked to a container in the Containers view is offered as one service. The public name is all a visitor sees of it. Link shows its address on the page, Speed its response time. A source that is gone is marked missing and shows as Unknown.'],
            maintenance: ['statusPageInfoMaintenance', 'Tick the groups a maintenance window belongs to. Those groups show Planned maintenance up to a week ahead, and blue instead of red while the window is open: a stop inside it does not count as an outage. Alerts are not affected. The windows themselves are set in Behavior → Status & alerts.'],
        };
        const titles = {
            link: ['statusPageLinkTitle', 'Link and access'],
            top: ['statusPageTopTitle', 'Top of the page'],
            groups: ['statusPageGroupsTitle', 'Groups and services'],
            maintenance: ['statusPageMaintTitle', 'Maintenance shown on the page'],
        };
        if (!info[card] || !global.AppModal?.alert) return;
        const [key, fallback] = info[card];
        const [titleKey, titleFallback] = titles[card];
        global.AppModal.alert({
            title: this.t(`config.${titleKey}`, titleFallback),
            htmlMessage: this.dash.escapeHtml(this.t(`config.${key}`, fallback)).replace(/\n/g, '<br>'),
            confirmText: this.t('config.gotIt', 'Got it'),
        });
    },

    statusPageLink() {
        const path = this.statusPage?.path || '';
        return path ? `${location.origin}${path}` : '';
    },

    /** Debounced PUT of the whole config; bound while the section is open. */
    saveStatusPageSoon() {
        this.statusPageSave?.();
    },

    async bindStatusPageSection(container) {
        const root = container.querySelector('#config-status-page-body');
        if (!root) return;

        // Tabs show and hide the cards rather than redraw them: every card is
        // bound once, and a half-typed title survives a switch of tab.
        if (container.querySelector('[data-sp-tab]')) {
            this.bindSubTabStrip(container, 'data-sp-tab', (tab) => {
                if (tab === this.statusPageTab) return;
                this.statusPageTab = tab;
                this.restoreConfigHash();
                this.showStatusPageTab(root);
                this.syncSubTabStrip('data-sp-tab', this.statusPageTab);
            });
        }
        root.addEventListener('click', (e) => {
            const btn = e.target.closest?.('[data-sp-info]');
            if (!btn) return;
            e.preventDefault();
            this.openStatusPageInfo(btn.getAttribute('data-sp-info'));
        });
        const q = (sel) => root.querySelector(sel);
        const t = (key, fallback) => this.t(`config.${key}`, fallback);
        this.statusPage = { config: null, path: '', sources: { monitors: [] }, loadError: '' };
        let timer = 0;
        let saving = Promise.resolve();
        let qrFor = '';

        const paintLink = () => {
            const sp = this.statusPage;
            const link = this.statusPageLink();
            const on = !!sp.config?.enabled && !!link;
            q('[data-sp-link-row]').hidden = !on;
            q('[data-sp-off-note]').hidden = on;
            q('[data-sp-link]').textContent = on ? link : '';
            q('[data-sp-open]').setAttribute('href', on ? link : '#');
            const qr = q('[data-sp-qr]');
            if (!on) {
                qr.innerHTML = '';
                qrFor = '';
            } else if (qrFor !== link) {
                qrFor = link;
                void Promise.resolve(global.BookmarkQR?.svg?.(link)).then((svg) => {
                    if (svg && qrFor === link && root.isConnected) qr.innerHTML = svg;
                }).catch(() => { if (qrFor === link) qr.innerHTML = ''; });
            }
            const err = q('[data-sp-load-error]');
            err.hidden = !sp.loadError;
            err.textContent = sp.loadError
                ? `${t('statusPageLoadError', 'The saved status page settings could not be read:')} ${sp.loadError}`
                : '';
        };

        const adopt = (body, withConfig) => {
            const sp = this.statusPage;
            const groupsBefore = JSON.stringify(sp.config?.groups || []);
            if (withConfig && body.config) sp.config = body.config;
            sp.path = typeof body.path === 'string' ? body.path : '';
            sp.loadError = typeof body.loadError === 'string' ? body.loadError : '';
            paintLink();
            // The server named or dropped something: show what it kept.
            if (withConfig && body.config && JSON.stringify(sp.config.groups || []) !== groupsBefore) {
                this.paintStatusPageGroups?.({ fromServer: true });
            }
        };

        const send = async () => {
            const res = await global.nextDashFetch('/api/status-page', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.statusPage.config),
            });
            if (!res.ok) throw new Error(String(res.status));
            const body = await res.json();
            // Typing since this save started is newer than the answer.
            adopt(body, !timer);
        };

        this.statusPageSave = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                timer = 0;
                saving = saving.then(send).catch(() => {
                    const err = q('[data-sp-load-error]');
                    if (!err || !root.isConnected) return;
                    err.hidden = false;
                    err.textContent = t('statusPageSaveFailed', 'Could not save the status page settings.');
                });
            }, SAVE_DELAY_MS);
        };

        const enabled = q('[data-sp-enabled]');
        const lan = q('[data-sp-lan]');
        const title = q('[data-sp-title]');
        const notice = q('[data-sp-notice]');
        enabled.addEventListener('change', () => {
            this.statusPage.config.enabled = enabled.checked;
            this.saveStatusPageSoon();
        });
        lan.addEventListener('change', () => {
            this.statusPage.config.lanOnly = lan.checked;
            this.saveStatusPageSoon();
        });
        title.addEventListener('input', () => {
            this.statusPage.config.title = title.value;
            this.saveStatusPageSoon();
        });
        notice.addEventListener('input', () => {
            this.statusPage.config.notice = notice.value;
            this.saveStatusPageSoon();
        });

        const copy = q('[data-sp-copy]');
        let copiedTimer = 0;
        copy.addEventListener('click', async () => {
            const link = this.statusPageLink();
            if (!link) return;
            let ok = false;
            try {
                await navigator.clipboard.writeText(link);
                ok = true;
            } catch {
                const range = document.createRange();
                range.selectNodeContents(q('[data-sp-link]'));
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
            if (!ok) return;
            copy.textContent = t('statusPageCopied', 'Copied');
            clearTimeout(copiedTimer);
            copiedTimer = setTimeout(() => { copy.textContent = t('statusPageCopy', 'Copy'); }, 1500);
        });

        q('[data-sp-new-link]').addEventListener('click', async () => {
            const ok = await this.confirmAction(
                t('statusPageNewLinkConfirm', 'Anyone with the current link loses access.'),
                { confirmLabel: t('statusPageNewLinkBtn', 'New link'), danger: true }
            );
            if (!ok) return;
            try {
                const res = await global.nextDashFetch('/api/status-page/token', { method: 'POST' });
                if (!res.ok) throw new Error(String(res.status));
                const body = await res.json();
                this.statusPage.path = typeof body.path === 'string' ? body.path : '';
                paintLink();
            } catch {
                const err = q('[data-sp-load-error]');
                err.hidden = false;
                err.textContent = t('statusPageNewLinkFailed', 'Could not make a new link.');
            }
        });

        try {
            const res = await global.nextDashFetch('/api/status-page', { cache: 'no-store' });
            if (!res.ok) throw new Error(String(res.status));
            const body = await res.json();
            if (!root.isConnected) return;
            adopt(body, true);
        } catch {
            if (!root.isConnected) return;
            // Saving now would overwrite what is stored with blanks: stay shut.
            const err = q('[data-sp-load-error]');
            err.hidden = false;
            err.textContent = t('statusPageLoadFailed', 'Could not read the status page settings. Reload to try again.');
            return;
        }
        const cfg = this.statusPage.config || {};
        enabled.checked = !!cfg.enabled;
        lan.checked = !!cfg.lanOnly;
        title.value = cfg.title || '';
        notice.value = cfg.notice || '';
        [enabled, lan, title, notice].forEach((el) => { el.disabled = false; });
        paintLink();
        await this.bindStatusPageGroups(root);
        this.bindStatusPageMaintenance(root);
    },


    /* ── Groups and services ────────────────────────────────────────── */

    /**
     * The groups card. Everything reads this.statusPage.config afresh: a
     * save's reply replaces the object, so no row keeps a reference to it.
     * A service is a monitored bookmark, a container, or both; a bookmark
     * the Containers view links to a container is offered as one service,
     * and that pairing is written into the service when it is added.
     */
    async bindStatusPageGroups(root) {
        const host = root.querySelector('[data-sp-groups]');
        if (!host) return;
        const d = this.dash;
        const esc = (v) => d.escapeHtml(v);
        const t = (key, fallback) => this.t(`config.${key}`, fallback);
        const sp = this.statusPage;
        sp.docker = { answered: false, containers: [] };
        let sourcesLoaded = false;
        let picker = null; // { groupId, serviceId, kind, query, active, opener }
        let renaming = '';
        let renameFresh = false;

        const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
        const groups = () => {
            if (!Array.isArray(sp.config.groups)) sp.config.groups = [];
            sp.config.groups.forEach((g) => { if (!Array.isArray(g.services)) g.services = []; });
            return sp.config.groups;
        };
        const groupOf = (id) => groups().find((g) => g.id === id) || null;
        const serviceOf = (id) => {
            for (const g of groups()) {
                const s = g.services.find((x) => x.id === id);
                if (s) return { group: g, service: s };
            }
            return null;
        };

        /** Health's canonical form of an address, enough to compare two. */
        const urlKey = (raw) => {
            const s = String(raw || '').trim();
            try {
                const u = new URL(s);
                const path = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
                return `${u.protocol}//${u.host}${path}${u.search}`;
            } catch {
                return s.toLowerCase().replace(/#.*$/, '').replace(/\/+$/, '');
            }
        };
        const hostOf = (raw) => {
            try { return new URL(String(raw || '').trim()).host; } catch { return String(raw || ''); }
        };
        const monitors = () => (Array.isArray(sp.sources?.monitors) ? sp.sources.monitors : []);
        const monitorFor = (url) => {
            const key = urlKey(url);
            return monitors().find((m) => urlKey(m.url) === key) || null;
        };

        /*
         * Pairs by the Containers view's own rule: the bookmark it links each
         * container to, kept only when that bookmark is a monitor.
         */
        const pairs = () => {
            const index = global.DockerSearchIndex;
            if (!sp.docker.answered || !index?.bookmarkFor) return [];
            const out = [];
            sp.docker.containers.forEach((c) => {
                const hit = index.bookmarkFor(c, d.allBookmarks || []);
                const m = hit?.bookmark ? monitorFor(hit.bookmark.url) : null;
                if (m) out.push({ monitor: m, container: c });
            });
            return out;
        };
        const containerPairedWith = (url) => {
            const key = urlKey(url);
            return pairs().find((p) => urlKey(p.monitor.url) === key)?.container || null;
        };
        const monitorPairedWith = (name) => pairs().find((p) => p.container.name === name)?.monitor || null;

        /* Painting */

        const chip = (svc, kind, sources) => {
            if (kind === 'monitor') {
                if (!svc.monitorUrl) {
                    return `<button type="button" class="status-page-chip status-page-chip--add" data-sp-add-source="monitor">${esc(t('statusPageAddMonitor', '+ monitor'))}</button>`;
                }
                const m = monitorFor(svc.monitorUrl);
                const missing = sourcesLoaded && !m;
                return `<span class="status-page-chip${missing ? ' is-missing' : ''}" data-sp-chip="monitor" title="${esc(svc.monitorUrl)}">
                        <span aria-hidden="true">◉</span> <span class="status-page-chip-name">${esc(m?.name || hostOf(svc.monitorUrl))}</span>
                        <span class="status-page-chip-meta">${esc(missing ? t('statusPageMissing', 'missing') : hostOf(svc.monitorUrl))}</span>
                        ${sources > 1 ? `<button type="button" class="status-page-chip-clear" data-sp-chip-clear aria-label="${esc(t('statusPageDropMonitor', 'Drop the monitor'))}">✕</button>` : ''}
                    </span>`;
            }
            if (!svc.container) {
                return `<button type="button" class="status-page-chip status-page-chip--add" data-sp-add-source="container">${esc(t('statusPageAddContainer', '+ container'))}</button>`;
            }
            const missing = sp.docker.answered && !sp.docker.containers.some((c) => c.name === svc.container);
            return `<span class="status-page-chip${missing ? ' is-missing' : ''}" data-sp-chip="container">
                    <span aria-hidden="true">▣</span> <span class="status-page-chip-name">${esc(svc.container)}</span>
                    ${missing ? `<span class="status-page-chip-meta">${esc(t('statusPageMissing', 'missing'))}</span>` : ''}
                    ${sources > 1 ? `<button type="button" class="status-page-chip-clear" data-sp-chip-clear aria-label="${esc(t('statusPageDropContainer', 'Drop the container'))}">✕</button>` : ''}
                </span>`;
        };

        const serviceRow = (svc) => {
            const sources = (svc.monitorUrl ? 1 : 0) + (svc.container ? 1 : 0);
            return `
                <div class="status-page-service" data-sp-service="${esc(svc.id)}" tabindex="0">
                    <span class="config-structure-grip status-page-grip" data-sp-grip draggable="true" tabindex="0" role="button"
                          title="${esc(t('statusPageDragService', 'Drag to reorder, or Alt+↑/↓'))}"
                          aria-label="${esc(t('statusPageMoveService', 'Move service'))}">⠿</span>
                    <input type="text" class="config-text status-page-service-name" data-sp-service-name maxlength="120"
                           autocomplete="off" value="${esc(svc.name || '')}" aria-label="${esc(t('statusPageServiceName', 'Public name'))}">
                    <span class="status-page-chips">${chip(svc, 'monitor', sources)}${chip(svc, 'container', sources)}</span>
                    <label class="status-page-check"><input type="checkbox" data-sp-show-link${svc.showLink ? ' checked' : ''}> ${esc(t('statusPageShowLink', 'Link'))}</label>
                    <label class="status-page-check"><input type="checkbox" data-sp-show-speed${svc.showSpeed ? ' checked' : ''}> ${esc(t('statusPageShowSpeed', 'Speed'))}</label>
                    <button type="button" class="config-btn config-btn--small status-page-remove" data-sp-service-remove
                            aria-label="${esc(t('statusPageRemoveService', 'Remove service'))}" title="${esc(t('statusPageRemoveService', 'Remove service'))}">✕</button>
                </div>`;
        };

        const groupBlock = (g) => {
            const n = g.services.length;
            const count = n === 1 ? t('statusPageOneService', '1 service') : t('statusPageServices', '{n} services').replace('{n}', String(n));
            const isRenaming = renaming === g.id;
            return `
                <section class="status-page-group" data-sp-group="${esc(g.id)}">
                    <header class="status-page-group-head">
                        <span class="config-structure-grip status-page-grip" data-sp-grip draggable="true" tabindex="0" role="button"
                              title="${esc(t('statusPageDragGroup', 'Drag to reorder, or Alt+↑/↓'))}"
                              aria-label="${esc(t('statusPageMoveGroup', 'Move group'))}">⠿</span>
                        <strong class="status-page-group-name" data-sp-group-name${isRenaming ? ' hidden' : ''}>${esc(g.name || '')}</strong>
                        ${isRenaming ? `<input type="text" class="config-text status-page-group-rename" data-sp-group-rename-input maxlength="80"
                              autocomplete="off" value="${esc(g.name || '')}" aria-label="${esc(t('statusPageGroupName', 'Group name'))}">` : ''}
                        <span class="status-page-group-count">${esc(count)}</span>
                        <span class="config-actions status-page-group-actions">
                            <button type="button" class="config-btn config-btn--small" data-sp-group-rename>${esc(t('statusPageRename', 'Rename'))}</button>
                            <button type="button" class="config-btn config-btn--small" data-sp-group-delete>${esc(t('statusPageDelete', 'Delete'))}</button>
                        </span>
                    </header>
                    <div class="status-page-services" data-sp-service-list>${g.services.map(serviceRow).join('')}</div>
                    <button type="button" class="status-page-add-service" data-sp-add-service>${esc(t('statusPageAddService', '+ Add service'))}</button>
                    ${picker?.groupId === g.id ? pickerBlock() : ''}
                </section>`;
        };

        const pickerItems = () => {
            const q = String(picker?.query || '').trim().toLowerCase();
            const has = (...parts) => !q || parts.some((p) => String(p || '').toLowerCase().includes(q));
            const kind = picker?.kind || 'all';
            const items = [];
            if (kind === 'all') {
                pairs().forEach((p) => {
                    if (has(p.monitor.name, p.monitor.url, p.container.name)) items.push({ type: 'pair', monitor: p.monitor, container: p.container });
                });
            }
            if (kind !== 'container') {
                monitors().forEach((m) => { if (has(m.name, m.url, m.page)) items.push({ type: 'monitor', monitor: m }); });
            }
            if (kind !== 'monitor') {
                sp.docker.containers.forEach((c) => { if (has(c.name, c.image, c.state)) items.push({ type: 'container', container: c }); });
            }
            return items;
        };

        const itemHtml = (item, i) => {
            const active = i === picker.active;
            let label;
            let meta;
            if (item.type === 'pair') {
                label = `◉ ${item.monitor.name || hostOf(item.monitor.url)} + ▣ ${item.container.name}`;
                meta = t('statusPageLinked', 'linked');
            } else if (item.type === 'monitor') {
                label = `◉ ${item.monitor.name || hostOf(item.monitor.url)}`;
                meta = `${t('statusPageMonitor', 'monitor')} · ${item.monitor.page || hostOf(item.monitor.url)}`;
            } else {
                label = `▣ ${item.container.name}`;
                meta = `${t('statusPageContainer', 'container')} · ${item.container.state || ''}`;
            }
            return `<li class="status-page-picker-item${active ? ' is-active' : ''}" role="option" aria-selected="${active}"
                        data-sp-picker-item data-index="${i}"${item.type === 'pair' ? ' data-sp-pair' : ''}>
                        <span class="status-page-picker-label">${esc(label)}</span>
                        <span class="status-page-picker-meta">— ${esc(meta)}</span>
                    </li>`;
        };

        const pickerListHtml = () => {
            const items = pickerItems();
            if (picker.active >= items.length) picker.active = Math.max(0, items.length - 1);
            if (!items.length) {
                return `<li class="status-page-picker-empty">${esc(t('statusPagePickerEmpty', 'Nothing matches.'))}</li>`;
            }
            return items.map(itemHtml).join('');
        };

        const pickerBlock = () => {
            const placeholder = picker.kind === 'monitor'
                ? t('statusPagePickerMonitors', 'Search monitors…')
                : picker.kind === 'container'
                    ? t('statusPagePickerContainers', 'Search containers…')
                    : t('statusPagePickerSearch', 'Search monitors and containers…');
            return `
                <div class="status-page-picker" data-sp-picker role="dialog" aria-label="${esc(t('statusPagePickerTitle', 'Add a source'))}">
                    <input type="search" class="config-text" data-sp-picker-search autocomplete="off"
                           placeholder="${esc(placeholder)}" value="${esc(picker.query || '')}"
                           role="combobox" aria-expanded="true" aria-controls="status-page-picker-list">
                    <ul class="status-page-picker-list" id="status-page-picker-list" role="listbox" data-sp-picker-list>${pickerListHtml()}</ul>
                    ${picker.kind === 'container' ? '' : `<p class="config-field-hint">${esc(t('statusPagePickerHint',
                        'Only monitored bookmarks are listed: a bookmark without monitoring has no history to show.'))}</p>`}
                </div>`;
        };

        /** Where focus was, by hook, so a repaint can put it back. */
        const focusKey = () => {
            const el = document.activeElement;
            if (!el || !host.contains(el)) return null;
            const attr = [...el.attributes].map((a) => a.name).find((n) => n.startsWith('data-sp-') && n !== 'data-sp-service' && n !== 'data-sp-group');
            return {
                service: el.closest('[data-sp-service]')?.getAttribute('data-sp-service') || '',
                group: el.closest('[data-sp-group]')?.getAttribute('data-sp-group') || '',
                attr: el.hasAttribute('data-sp-service') ? '' : attr || '',
                self: el.hasAttribute('data-sp-service'),
            };
        };
        const restoreFocus = (key) => {
            if (!key) return;
            let scope = host;
            if (key.service) scope = host.querySelector(`[data-sp-service="${CSS.escape(key.service)}"]`);
            else if (key.group) scope = host.querySelector(`[data-sp-group="${CSS.escape(key.group)}"]`);
            if (!scope) return;
            const el = key.self ? scope : (key.attr ? scope.querySelector(`[${key.attr}]`) : null);
            if (!el) return;
            if (key.service && key.attr === 'data-sp-grip') {
                scope.querySelector('[data-sp-grip]')?.focus();
                return;
            }
            if (key.group && !key.service && key.attr === 'data-sp-grip') {
                scope.querySelector('.status-page-group-head [data-sp-grip]')?.focus();
                return;
            }
            el.focus();
        };

        const paint = ({ fromServer = false } = {}) => {
            if (!host.isConnected || !sp.config) return;
            // A field being typed in keeps its own value; the next keystroke
            // writes it back anyway.
            const el = document.activeElement;
            if (fromServer && el && host.contains(el) && el.matches('input[type="text"], input[type="search"]')) return;
            const focus = focusKey();
            const list = groups();
            host.innerHTML = `
                <div class="config-panel" data-sp-groups-card>
                    ${this.statusPageCardTitle('groups', t('statusPageGroupsTitle', 'Groups and services'))}
                    <p class="config-field-hint">${esc(t('statusPageGroupsHint',
                        'A service can combine a monitored bookmark and a container; the worse of the two counts. Drag ⠿ to order services and groups.'))}</p>
                    <div class="status-page-groups" data-sp-group-list>
                        ${list.length ? list.map(groupBlock).join('') : `<p class="config-field-hint">${esc(t('statusPageNoGroups', 'No groups yet. Add one to put services on the page.'))}</p>`}
                    </div>
                    <button type="button" class="config-btn config-btn--small" data-sp-add-group>${esc(t('statusPageAddGroup', '+ Add group'))}</button>
                </div>`;
            restoreFocus(focus);
            this.paintStatusPageMaintenance?.();
        };
        this.paintStatusPageGroups = paint;

        const paintPickerList = () => {
            const list = host.querySelector('[data-sp-picker-list]');
            if (list) list.innerHTML = pickerListHtml();
            list?.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' });
        };

        const changed = () => {
            paint();
            this.saveStatusPageSoon();
        };

        /* Picker */

        const onPickerKey = (e) => {
            if (!picker) return;
            const box = host.querySelector('[data-sp-picker]');
            if (!box) return;
            if (e.key === 'Escape') {
                // On window, capturing: Config's own Escape is on document and
                // would close the view underneath the picker.
                e.preventDefault();
                e.stopImmediatePropagation();
                closePicker(true);
                return;
            }
            const search = box.querySelector('[data-sp-picker-search]');
            const typing = e.target?.matches?.('input, textarea, select, [contenteditable="true"]');
            if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                search?.focus();
                search?.select();
                return;
            }
            if (!box.contains(e.target)) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopImmediatePropagation();
                const n = pickerItems().length;
                if (!n) return;
                picker.active = (picker.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
                paintPickerList();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopImmediatePropagation();
                const item = pickerItems()[picker.active];
                if (item) pick(item);
            }
        };
        const onPickerPointer = (e) => {
            if (!picker) return;
            const box = host.querySelector('[data-sp-picker]');
            if (box?.contains(e.target)) return;
            if (e.target.closest?.('[data-sp-add-service], [data-sp-add-source]')) return;
            closePicker(false);
        };

        const openPicker = (groupId, serviceId, kind, opener) => {
            picker = { groupId, serviceId, kind, query: '', active: 0, opener: opener ? focusKeyFor(opener) : null };
            global.addEventListener('keydown', onPickerKey, true);
            global.addEventListener('pointerdown', onPickerPointer, true);
            paint();
            host.querySelector('[data-sp-picker-search]')?.focus();
            void loadDocker().then(() => { if (picker) paintPickerList(); });
        };
        const focusKeyFor = (el) => ({
            service: el.closest('[data-sp-service]')?.getAttribute('data-sp-service') || '',
            group: el.closest('[data-sp-group]')?.getAttribute('data-sp-group') || '',
            attr: el.hasAttribute('data-sp-add-service') ? 'data-sp-add-service' : 'data-sp-service-name',
            self: false,
        });
        const closePicker = (refocus) => {
            if (!picker) return;
            const opener = picker.opener;
            picker = null;
            global.removeEventListener('keydown', onPickerKey, true);
            global.removeEventListener('pointerdown', onPickerPointer, true);
            paint();
            if (refocus && opener) restoreFocus(opener);
        };

        const pick = (item) => {
            const { groupId, serviceId, kind } = picker;
            const opener = picker.opener;
            let focusId = serviceId;
            if (serviceId) {
                const found = serviceOf(serviceId);
                if (found) {
                    if (kind === 'monitor' && item.monitor) found.service.monitorUrl = item.monitor.url;
                    if (kind === 'container' && item.container) found.service.container = item.container.name;
                }
            } else {
                const g = groupOf(groupId);
                if (!g) return closePicker(false);
                let monitor = item.monitor || null;
                let container = item.container || null;
                // One side picked; the Containers view's link fills the other.
                if (item.type === 'monitor') container = containerPairedWith(monitor.url);
                if (item.type === 'container') monitor = monitorPairedWith(container.name);
                const svc = {
                    id: newId('s'),
                    name: monitor?.name || container?.name || '',
                    monitorUrl: monitor?.url || '',
                    container: container?.name || '',
                    showLink: false,
                    showSpeed: false,
                };
                g.services.push(svc);
                focusId = svc.id;
            }
            picker = null;
            global.removeEventListener('keydown', onPickerKey, true);
            global.removeEventListener('pointerdown', onPickerPointer, true);
            changed();
            const row = focusId && host.querySelector(`[data-sp-service="${CSS.escape(focusId)}"] [data-sp-service-name]`);
            if (row) row.focus();
            else if (opener) restoreFocus(opener);
        };

        /* Sources */

        let dockerLoad = null;
        const loadDocker = () => {
            if (dockerLoad) return dockerLoad;
            dockerLoad = (async () => {
                const index = global.DockerSearchIndex;
                if (!index?.status || !index?.refresh) return;
                try {
                    const st = await index.status();
                    if (!st?.socket || index.enabled?.() === false) return;
                    await index.refresh();
                    if (!d.allBookmarks?.length) await d.deferredLoadAllBookmarks?.();
                    sp.docker = { answered: true, containers: (index.containers?.() || []).filter((c) => c && c.name) };
                } catch {
                    sp.docker = { answered: false, containers: [] };
                }
            })().finally(() => {
                // A list half a minute old is the cache's own rule; ask again
                // next time the picker opens.
                setTimeout(() => { dockerLoad = null; }, 0);
            });
            return dockerLoad;
        };

        try {
            const res = await global.nextDashFetch('/api/status-page/sources', { cache: 'no-store' });
            if (!res.ok) throw new Error(String(res.status));
            const body = await res.json();
            sp.sources = { monitors: Array.isArray(body?.monitors) ? body.monitors : [] };
            sourcesLoaded = true;
        } catch {
            sp.sources = { monitors: [] };
        }
        if (!host.isConnected) return;
        paint();
        void loadDocker().then(() => { if (host.isConnected && sp.docker.answered) paint(); });

        /* Moving */

        const moveService = (id, delta) => {
            const found = serviceOf(id);
            if (!found) return false;
            const list = groups();
            const gi = list.indexOf(found.group);
            const si = found.group.services.indexOf(found.service);
            const to = si + delta;
            if (to >= 0 && to < found.group.services.length) {
                found.group.services.splice(si, 1);
                found.group.services.splice(to, 0, found.service);
                return true;
            }
            // Past the end of its group: into the next one.
            const next = list[gi + delta];
            if (!next) return false;
            found.group.services.splice(si, 1);
            if (delta > 0) next.services.unshift(found.service);
            else next.services.push(found.service);
            return true;
        };
        const moveGroup = (id, delta) => {
            const list = groups();
            const i = list.findIndex((g) => g.id === id);
            const to = i + delta;
            if (i < 0 || to < 0 || to >= list.length) return false;
            const [g] = list.splice(i, 1);
            list.splice(to, 0, g);
            return true;
        };
        const dropService = (id, groupId, beforeId) => {
            const found = serviceOf(id);
            const target = groupOf(groupId);
            if (!found || !target || id === beforeId) return false;
            found.group.services.splice(found.group.services.indexOf(found.service), 1);
            const at = beforeId ? target.services.findIndex((s) => s.id === beforeId) : -1;
            if (at < 0) target.services.push(found.service);
            else target.services.splice(at, 0, found.service);
            return true;
        };
        const dropGroup = (id, beforeId) => {
            const list = groups();
            const from = list.findIndex((g) => g.id === id);
            if (from < 0 || id === beforeId) return false;
            const [g] = list.splice(from, 1);
            const at = beforeId ? list.findIndex((x) => x.id === beforeId) : -1;
            if (at < 0) list.push(g);
            else list.splice(at, 0, g);
            return true;
        };

        /* Group rename */

        const startRename = (groupId, fresh = false) => {
            renaming = groupId;
            renameFresh = fresh;
            paint();
            const input = host.querySelector('[data-sp-group-rename-input]');
            input?.focus();
            input?.select();
        };
        const finishRename = (save) => {
            if (!renaming) return;
            const g = groupOf(renaming);
            const input = host.querySelector('[data-sp-group-rename-input]');
            const value = String(input?.value || '').trim();
            const id = renaming;
            renaming = '';
            if (save && g && value && value !== g.name) {
                g.name = value;
                this.saveStatusPageSoon();
            } else if (renameFresh && g) {
                // A new group is saved as "New group" when its name is kept.
                this.saveStatusPageSoon();
            }
            renameFresh = false;
            paint();
            host.querySelector(`[data-sp-group="${CSS.escape(id)}"] [data-sp-group-rename]`)?.focus();
        };

        /* Events: delegated, since every repaint replaces the rows. */

        host.addEventListener('click', async (e) => {
            const el = e.target.closest('button, [data-sp-picker-item]');
            if (!el || !host.contains(el)) return;
            const groupEl = el.closest('[data-sp-group]');
            const groupId = groupEl?.getAttribute('data-sp-group') || '';
            const serviceId = el.closest('[data-sp-service]')?.getAttribute('data-sp-service') || '';
            if (el.hasAttribute('data-sp-picker-item')) {
                const item = pickerItems()[Number(el.getAttribute('data-index'))];
                if (item) pick(item);
                return;
            }
            if (el.hasAttribute('data-sp-add-group')) {
                const g = { id: newId('g'), name: t('statusPageNewGroup', 'New group'), services: [] };
                groups().push(g);
                this.saveStatusPageSoon();
                startRename(g.id, true);
                return;
            }
            if (el.hasAttribute('data-sp-group-rename')) {
                if (renaming === groupId) finishRename(true);
                else startRename(groupId);
                return;
            }
            if (el.hasAttribute('data-sp-group-delete')) {
                const g = groupOf(groupId);
                if (!g) return;
                if (g.services.length) {
                    const ok = await this.confirmAction(
                        t('statusPageDeleteGroupConfirm', 'Delete this group and its services from the page?'),
                        { confirmLabel: t('statusPageDelete', 'Delete'), danger: true }
                    );
                    if (!ok) return;
                }
                // A save's reply may have replaced the config while the
                // question was up: find the group again by its id.
                const list = groups();
                const at = list.findIndex((x) => x.id === groupId);
                if (at >= 0) list.splice(at, 1);
                if (picker?.groupId === groupId) closePicker(false);
                changed();
                return;
            }
            if (el.hasAttribute('data-sp-add-service')) {
                if (picker && picker.groupId === groupId && !picker.serviceId) closePicker(true);
                else openPicker(groupId, '', 'all', el);
                return;
            }
            if (el.hasAttribute('data-sp-add-source')) {
                openPicker(groupId, serviceId, el.getAttribute('data-sp-add-source'), el);
                return;
            }
            if (el.hasAttribute('data-sp-chip-clear')) {
                const found = serviceOf(serviceId);
                const kind = el.closest('[data-sp-chip]')?.getAttribute('data-sp-chip');
                if (!found) return;
                const s = found.service;
                // A service keeps at least one source.
                if (!s.monitorUrl || !s.container) return;
                if (kind === 'monitor') s.monitorUrl = '';
                if (kind === 'container') s.container = '';
                changed();
                host.querySelector(`[data-sp-service="${CSS.escape(serviceId)}"] [data-sp-add-source="${kind}"]`)?.focus();
                return;
            }
            if (el.hasAttribute('data-sp-service-remove')) {
                const found = serviceOf(serviceId);
                if (!found) return;
                const list = found.group.services;
                const at = list.indexOf(found.service);
                list.splice(at, 1);
                changed();
                const rows = host.querySelectorAll(`[data-sp-group="${CSS.escape(groupId)}"] [data-sp-service]`);
                (rows[Math.min(at, rows.length - 1)] || host.querySelector(`[data-sp-group="${CSS.escape(groupId)}"] [data-sp-add-service]`))?.focus();
            }
        });

        host.addEventListener('input', (e) => {
            const el = e.target;
            if (el.matches('[data-sp-picker-search]')) {
                if (!picker) return;
                picker.query = el.value;
                picker.active = 0;
                paintPickerList();
                return;
            }
            if (el.matches('[data-sp-service-name]')) {
                const found = serviceOf(el.closest('[data-sp-service]')?.getAttribute('data-sp-service'));
                if (!found) return;
                found.service.name = el.value;
                this.saveStatusPageSoon();
            }
        });

        host.addEventListener('change', (e) => {
            const el = e.target;
            const found = serviceOf(el.closest('[data-sp-service]')?.getAttribute('data-sp-service'));
            if (!found) return;
            if (el.matches('[data-sp-show-link]')) found.service.showLink = el.checked;
            else if (el.matches('[data-sp-show-speed]')) found.service.showSpeed = el.checked;
            else return;
            this.saveStatusPageSoon();
        });

        host.addEventListener('mousemove', (e) => {
            const item = e.target.closest?.('[data-sp-picker-item]');
            if (!item || !picker) return;
            const i = Number(item.getAttribute('data-index'));
            if (i === picker.active) return;
            picker.active = i;
            host.querySelectorAll('[data-sp-picker-item]').forEach((li) => {
                const on = Number(li.getAttribute('data-index')) === i;
                li.classList.toggle('is-active', on);
                li.setAttribute('aria-selected', String(on));
            });
        });

        host.addEventListener('focusout', (e) => {
            if (!renaming || !e.target.matches('[data-sp-group-rename-input]')) return;
            // Clicking Rename again finishes through the click handler.
            if (e.relatedTarget?.closest?.('[data-sp-group-rename]')) return;
            finishRename(true);
        });

        host.addEventListener('keydown', (e) => {
            const el = e.target;
            if (el.matches('[data-sp-group-rename-input]')) {
                if (e.key === 'Enter') { e.preventDefault(); finishRename(true); }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishRename(false); }
                return;
            }
            if (el.matches('[data-sp-grip]') && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                e.stopPropagation();
                const delta = e.key === 'ArrowDown' ? 1 : -1;
                const serviceId = el.closest('[data-sp-service]')?.getAttribute('data-sp-service');
                const groupId = el.closest('[data-sp-group]')?.getAttribute('data-sp-group');
                const moved = serviceId ? moveService(serviceId, delta) : moveGroup(groupId, delta);
                if (moved) changed();
                return;
            }
            if (el.matches('[data-sp-service]') && !e.altKey && !e.ctrlKey && !e.metaKey) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    e.stopPropagation();
                    const rows = [...host.querySelectorAll('[data-sp-service]')];
                    const i = rows.indexOf(el) + (e.key === 'ArrowDown' ? 1 : -1);
                    rows[i]?.focus();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    const input = el.querySelector('[data-sp-service-name]');
                    input?.focus();
                    input?.select();
                }
                return;
            }
            if (el.matches('[data-sp-service-name]') && (e.key === 'Enter' || e.key === 'Escape')) {
                // Out of the field, back on the row (Config table convention).
                e.preventDefault();
                e.stopPropagation();
                el.closest('[data-sp-service]')?.focus();
            }
        });

        /* Drag: grips, the way Pages and categories reorders pages. */

        let dragged = null; // { kind: 'service'|'group', id, el }
        const clearMarks = () => host.querySelectorAll('.is-drop-before, .is-drop-after, .is-drop-into')
            .forEach((x) => x.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-into'));
        const dropTarget = (e) => {
            if (!dragged) return null;
            if (dragged.kind === 'group') {
                const g = e.target.closest?.('[data-sp-group]');
                if (!g || g === dragged.el) return null;
                const box = g.getBoundingClientRect();
                return { el: g, after: e.clientY > box.top + box.height / 2 };
            }
            const row = e.target.closest?.('[data-sp-service]');
            if (row) {
                if (row === dragged.el) return null;
                const box = row.getBoundingClientRect();
                return { el: row, after: e.clientY > box.top + box.height / 2 };
            }
            const g = e.target.closest?.('[data-sp-group]');
            return g ? { el: g, into: true } : null;
        };
        host.addEventListener('dragstart', (e) => {
            const grip = e.target.closest?.('[data-sp-grip]');
            if (!grip) return;
            const row = grip.closest('[data-sp-service]');
            const el = row || grip.closest('[data-sp-group]');
            if (!el) return;
            dragged = row
                ? { kind: 'service', id: row.getAttribute('data-sp-service'), el }
                : { kind: 'group', id: el.getAttribute('data-sp-group'), el };
            el.classList.add('is-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', dragged.kind);
            if (row) e.dataTransfer.setDragImage?.(row, 16, 16);
        });
        host.addEventListener('dragover', (e) => {
            const target = dropTarget(e);
            if (!target) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            clearMarks();
            target.el.classList.add(target.into ? 'is-drop-into' : target.after ? 'is-drop-after' : 'is-drop-before');
        });
        host.addEventListener('dragleave', (e) => {
            if (!host.contains(e.relatedTarget)) clearMarks();
        });
        host.addEventListener('dragend', () => {
            dragged?.el.classList.remove('is-dragging');
            dragged = null;
            clearMarks();
        });
        host.addEventListener('drop', (e) => {
            const target = dropTarget(e);
            const source = dragged;
            source?.el.classList.remove('is-dragging');
            dragged = null;
            clearMarks();
            if (!source || !target) return;
            e.preventDefault();
            let moved = false;
            if (source.kind === 'group') {
                const next = target.after ? target.el.nextElementSibling : target.el;
                moved = dropGroup(source.id, next?.getAttribute?.('data-sp-group') || '');
            } else if (target.into) {
                moved = dropService(source.id, target.el.getAttribute('data-sp-group'), '');
            } else {
                const groupId = target.el.closest('[data-sp-group]').getAttribute('data-sp-group');
                const next = target.after ? target.el.nextElementSibling : target.el;
                const beforeId = next?.getAttribute?.('data-sp-service') || '';
                moved = beforeId === source.id ? false : dropService(source.id, groupId, beforeId);
            }
            if (moved) changed();
        });
    },


    /* ── Maintenance shown on the page ──────────────────────────────── */

    /**
     * One row per maintenance window with a checkbox per group. The windows
     * themselves are edited in Config → Behavior → Status & alerts; here only
     * their statusGroups change. The card repaints when the groups change.
     */
    bindStatusPageMaintenance(root) {
        const host = root.querySelector('[data-sp-maint]');
        if (!host) return;
        const d = this.dash;
        const esc = (v) => d.escapeHtml(v);
        const t = (key, fallback) => this.t(`config.${key}`, fallback);
        let sig = '';
        let saving = Promise.resolve();

        const windows = () => (Array.isArray(d.settings?.maintenanceWindows) ? d.settings.maintenanceWindows : []);
        const groups = () => (Array.isArray(this.statusPage?.config?.groups) ? this.statusPage.config.groups : []);

        const windowLabel = (w, names) => {
            const days = Array.isArray(w.days) ? w.days : [];
            const dayText = days.length === 0 || days.length === 7
                ? t('statusPageMaintDaily', 'Daily')
                : days.map((n) => names[n]?.short || '').filter(Boolean).join(', ');
            const time = `${w.start || '?'}–${w.end || '?'}`;
            return `${dayText} ${time}${w.label ? ` · ${w.label}` : ''}`;
        };

        const paint = () => {
            if (!host.isConnected || !this.statusPage?.config) return;
            const list = groups();
            const ids = new Set(list.map((g) => g.id));
            // The server drops a deleted group from the windows when the page
            // is saved; do the same to the local copy.
            windows().forEach((w) => {
                if (Array.isArray(w.statusGroups)) {
                    const kept = w.statusGroups.filter((id) => ids.has(id));
                    if (kept.length !== w.statusGroups.length) {
                        if (kept.length) w.statusGroups = kept;
                        else delete w.statusGroups;
                    }
                }
            });
            const names = this.maintenanceDayNames();
            const ws = windows();
            const rows = ws.map((w, i) => `
                <div class="status-page-maint-row" data-sp-maint-row="${i}">
                    <strong class="status-page-maint-name">${esc(windowLabel(w, names))}</strong>
                    <span class="status-page-maint-groups">${list.map((g) => `
                        <label class="status-page-check"><input type="checkbox" data-sp-maint-group="${esc(g.id)}"${Array.isArray(w.statusGroups) && w.statusGroups.includes(g.id) ? ' checked' : ''}> ${esc(g.name || '')}</label>`).join('')}
                    </span>
                </div>`).join('');
            host.innerHTML = `
                <div class="config-panel" data-sp-maint-card>
                    ${this.statusPageCardTitle('maintenance', t('statusPageMaintTitle', 'Maintenance shown on the page'))}
                    <p class="config-field-hint">${esc(t('statusPageMaintHint',
                        'Windows are set in Config → Behavior → Status & alerts. Ticked groups show “Planned maintenance” ahead of time and blue instead of red during it. Alerts are not affected.'))}</p>
                    ${ws.length ? rows : `<p class="config-field-hint">${esc(t('statusPageMaintEmpty', 'No maintenance windows yet.'))}</p>`}
                    ${ws.length && !list.length ? `<p class="config-field-hint">${esc(t('statusPageMaintNoGroups', 'Add a group above to link a window to it.'))}</p>` : ''}
                </div>`;
        };

        // Called by every groups repaint; only a change of groups repaints here.
        this.paintStatusPageMaintenance = () => {
            const next = JSON.stringify(groups().map((g) => [g.id, g.name]));
            if (next === sig && host.firstElementChild) return;
            sig = next;
            paint();
        };

        host.addEventListener('change', (e) => {
            const box = e.target.closest?.('[data-sp-maint-group]');
            if (!box) return;
            const i = Number(box.closest('[data-sp-maint-row]')?.getAttribute('data-sp-maint-row'));
            const w = windows()[i];
            if (!w) return;
            const id = box.getAttribute('data-sp-maint-group');
            const set = new Set(Array.isArray(w.statusGroups) ? w.statusGroups : []);
            if (box.checked) set.add(id); else set.delete(id);
            if (set.size) w.statusGroups = [...set]; else delete w.statusGroups;
            const body = JSON.stringify({ maintenanceWindows: windows() });
            saving = saving.then(async () => {
                const res = await global.nextDashFetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                });
                if (!res.ok) throw new Error(String(res.status));
            }).catch(() => {
                const err = root.querySelector('[data-sp-load-error]');
                if (!err || !root.isConnected) return;
                err.hidden = false;
                err.textContent = t('statusPageMaintSaveFailed', 'Could not save the maintenance windows.');
            });
        });

        this.paintStatusPageMaintenance();
    },

    });

    global.DashboardConfigStatusPageReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
