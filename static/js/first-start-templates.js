/**
 * First-start card: "What do you run?"
 *
 * A fresh install opens on starter links nobody runs a self-hosted dashboard
 * for. This card, at the top of main and before the quick-start checklist,
 * offers the three bundled templates -- Homelab, Media server, Developer --
 * filled in on one server address, or keeps the starter links.
 *
 * Part of the page, not a corner card: it sits above the blocks and the page
 * under it keeps working. Answering it (a template, Keep, ✕ or Esc) records
 * settings.quickStart.templatePicked, and QuickStart carries on with the
 * checklist. The server decides whether the template replaces main (still
 * the seed) or comes as a new page; the sentence under the button says which.
 */
(function (global) {
    'use strict';

    const MAIN_PAGE_ID = 1;
    const SERVER = '{server}';

    function t(key, fallback, params) {
        const lang = global.dashboardInstance?.language;
        let text = fallback;
        if (lang?.t) {
            const full = `firstStart.${key}`;
            const value = lang.t(full);
            if (value && value !== full) text = value;
        }
        return params
            ? Object.entries(params).reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)), String(text))
            : text;
    }

    const esc = (value) => global.NextDashHtml.escapeHtml(String(value ?? ''));

    const ICONS = { homelab: '⌂', 'media-server': '▶', developer: '</>' };

    /**
     * A variable's Default filled with the one server address. Mirrors
     * expandTemplateDefault in bundled_templates.go: a typed scheme or port
     * wins, a Default without {server} stands as it is, and an address with a
     * path, a query or a user name gives nothing.
     */
    function expandDefault(def, server) {
        def = String(def || '').trim();
        if (!def) return '';
        if (!def.includes(SERVER)) return def.replace(/\/+$/, '');
        server = String(server || '').trim().replace(/\/+$/, '');
        if (!server) return '';
        let scheme = '';
        const at = server.indexOf('://');
        if (at >= 0) {
            scheme = server.slice(0, at).toLowerCase();
            server = server.slice(at + 3);
        }
        if (/[/?#@\s]/.test(server) || (scheme && scheme !== 'http' && scheme !== 'https')) return '';
        let typed;
        let base;
        try {
            typed = new URL(`http://${server}`);
            base = new URL(def.replace(SERVER, 'server.invalid'));
        } catch {
            return '';
        }
        if (!typed.hostname) return '';
        const port = typed.port || base.port;
        return `${scheme || base.protocol.replace(':', '')}://${typed.hostname}${port ? `:${port}` : ''}`;
    }

    class FirstStartTemplates {
        constructor(dash, { onDone } = {}) {
            this.dash = dash;
            this.onDone = typeof onDone === 'function' ? onDone : () => {};
            this.el = null;
            this.list = [];
            this.replacesMain = true;
            this.chosen = null;
            this.server = '';
            this.edited = {};
            this.moreOpen = false;
            this.busy = false;
            this.keyHandler = (event) => {
                if (event.key !== 'Escape' || !this.el || this.el.hidden) return;
                if (this.dash?.isModalOpen?.()) return;
                // Esc in the open card goes back to the tiles first.
                if (this.chosen) { this.chosen = null; this.render(); return; }
                this.finish('keep');
            };
            this.pageTimer = null;
        }

        async show() {
            try {
                const res = await fetch('/api/page-templates/bundled');
                if (!res.ok) throw new Error(String(res.status));
                const data = await res.json();
                this.list = Array.isArray(data.templates) ? data.templates : [];
                this.replacesMain = data.replacesMain === true;
            } catch {
                // Nothing to offer is no reason to hold up the checklist.
                this.onDone();
                return;
            }
            if (!this.list.length) { this.onDone(); return; }
            this.render();
            document.addEventListener('keydown', this.keyHandler);
            // Only on main: the card is about that page, and follows the reader
            // there and back without being answered by a page switch.
            this.pageTimer = setInterval(() => this.place(), 500);
        }

        /** Keep the card above main's blocks, and out of sight elsewhere. */
        place() {
            if (!this.el) return;
            const grid = document.getElementById('dashboard-layout');
            if (grid && this.el.nextElementSibling !== grid) grid.before(this.el);
            const onMain = Number(this.dash?.currentPageId) === MAIN_PAGE_ID && this.dash?.activeView !== 'config';
            this.el.hidden = !onMain;
        }

        render() {
            if (!this.el) {
                this.el = document.createElement('section');
                this.el.className = 'first-start-card';
                this.el.setAttribute('aria-label', t('label', 'Choose a starting page'));
                this.el.addEventListener('click', (event) => this.onClick(event));
                this.el.addEventListener('input', (event) => this.onInput(event));
                this.el.addEventListener('submit', (event) => { event.preventDefault(); this.apply(); });
            }
            this.el.innerHTML = `<div class="first-start-stripe"></div>${this.chosen ? this.openHtml() : this.tilesHtml()}`;
            this.place();
            if (this.chosen) this.el.querySelector('[data-fs-server]')?.focus({ preventScroll: true });
        }

        tilesHtml() {
            const tiles = this.list.map((tpl) => `
                <button type="button" class="first-start-tile" data-fs-pick="${esc(tpl.id)}">
                    <span class="first-start-tile-name"><span class="first-start-tile-icon" aria-hidden="true">${esc(ICONS[tpl.id] || tpl.icon || '')}</span> ${esc(tpl.name)}</span>
                    <span class="first-start-tile-services">${esc(tpl.services.slice(0, 3).join(', '))} …</span>
                    <span class="first-start-tile-count">${esc(t('links', '{count} links', { count: tpl.links }))}</span>
                </button>`).join('');
            return `
                <div class="first-start-inner">
                    <div class="first-start-head">
                        <p class="first-start-title">// ${esc(t('title', 'what do you run?'))}</p>
                        <button type="button" class="first-start-close" data-fs-keep aria-label="${esc(t('close', 'Keep these links'))}">×</button>
                    </div>
                    <p class="first-start-sub">${esc(t('intro', 'Pick a starting page. Your services, on your own address.'))}</p>
                    <div class="first-start-tiles">
                        ${tiles}
                        <button type="button" class="first-start-tile first-start-tile--keep" data-fs-keep>
                            <span class="first-start-tile-name"><span class="first-start-tile-icon" aria-hidden="true">○</span> ${esc(t('keep', 'Keep these links'))}</span>
                            <span class="first-start-tile-services">${esc(t('keepHint', 'The starter page as it is'))}</span>
                        </button>
                    </div>
                </div>`;
        }

        valueFor(variable) {
            if (Object.prototype.hasOwnProperty.call(this.edited, variable.key)) return this.edited[variable.key];
            return expandDefault(variable.default, this.server);
        }

        openHtml() {
            const tpl = this.chosen;
            const rows = (tpl.variables || []).map((variable) => `
                <label class="first-start-svc-name" for="fs-var-${esc(variable.key)}">${esc(variable.label)}</label>
                <input id="fs-var-${esc(variable.key)}" class="first-start-input" type="text" spellcheck="false" autocomplete="off"
                    data-fs-var="${esc(variable.key)}" value="${esc(this.valueFor(variable))}">`).join('');
            const note = this.replacesMain
                ? t('replaces', 'Replaces the starter links on this page.')
                : t('adds', 'Adds a new page; this one stays as it is.');
            return `
                <form class="first-start-inner" novalidate>
                    <div class="first-start-head">
                        <p class="first-start-title">// ${esc(tpl.name.toLowerCase())}</p>
                        <button type="button" class="first-start-close" data-fs-keep aria-label="${esc(t('close', 'Keep these links'))}">×</button>
                    </div>
                    <p class="first-start-sub">${esc(tpl.services.join(', '))}</p>
                    <div class="first-start-row">
                        <label for="fs-server">${esc(t('where', 'Where do these run?'))}</label>
                        <input id="fs-server" class="first-start-input" type="text" spellcheck="false" autocomplete="off"
                            data-fs-server placeholder="${esc(t('serverPlaceholder', '192.168.1.10 or nas.local'))}" value="${esc(this.server)}">
                        <button type="button" class="first-start-more" data-fs-more aria-expanded="${this.moreOpen}">${esc(t('more', 'More'))} ${this.moreOpen ? '▾' : '▸'}</button>
                    </div>
                    <div class="first-start-svcs" ${this.moreOpen ? '' : 'hidden'}>${rows}</div>
                    <p class="first-start-error" data-fs-error role="alert" hidden></p>
                    <div class="first-start-actions">
                        <button type="submit" class="first-start-apply">${esc(t('apply', 'Set up the page'))}</button>
                        <button type="button" class="first-start-back" data-fs-back>${esc(t('back', 'Back'))}</button>
                    </div>
                    <p class="first-start-note">${esc(note)}</p>
                </form>`;
        }

        onClick(event) {
            const target = event.target.closest('button');
            if (!target || this.busy) return;
            if (target.hasAttribute('data-fs-keep')) { this.finish('keep'); return; }
            if (target.hasAttribute('data-fs-back')) { this.chosen = null; this.render(); return; }
            if (target.hasAttribute('data-fs-more')) {
                this.moreOpen = !this.moreOpen;
                const svcs = this.el.querySelector('.first-start-svcs');
                if (svcs) svcs.hidden = !this.moreOpen;
                target.setAttribute('aria-expanded', String(this.moreOpen));
                target.textContent = `${t('more', 'More')} ${this.moreOpen ? '▾' : '▸'}`;
                return;
            }
            const pick = target.getAttribute('data-fs-pick');
            if (pick) {
                this.chosen = this.list.find((tpl) => tpl.id === pick) || null;
                this.edited = {};
                this.render();
            }
        }

        onInput(event) {
            const input = event.target;
            const error = this.el.querySelector('[data-fs-error]');
            if (error) error.hidden = true;
            if (input.hasAttribute('data-fs-server')) {
                this.server = input.value;
                // Every service not edited by hand follows the server address.
                (this.chosen?.variables || []).forEach((variable) => {
                    if (Object.prototype.hasOwnProperty.call(this.edited, variable.key)) return;
                    const field = this.el.querySelector(`[data-fs-var="${CSS.escape(variable.key)}"]`);
                    if (field) field.value = this.valueFor(variable);
                });
                return;
            }
            const key = input.getAttribute('data-fs-var');
            if (key) this.edited[key] = input.value;
        }

        showError(message) {
            const error = this.el?.querySelector('[data-fs-error]');
            if (!error) return;
            error.textContent = message;
            error.hidden = false;
        }

        async apply() {
            if (!this.chosen || this.busy) return;
            const needsServer = (this.chosen.variables || []).some((variable) =>
                String(variable.default || '').includes(SERVER) && !String(this.edited[variable.key] || '').trim());
            if (needsServer && !expandDefault(`http://${SERVER}`, this.server)) {
                this.showError(t('serverMissing', 'Enter an address like 192.168.1.10 or nas.local'));
                this.el.querySelector('[data-fs-server]')?.focus();
                return;
            }
            this.busy = true;
            const button = this.el.querySelector('.first-start-apply');
            if (button) button.disabled = true;
            const values = {};
            Object.entries(this.edited).forEach(([key, value]) => {
                if (String(value).trim()) values[key] = String(value).trim();
            });
            let answer = null;
            try {
                const api = typeof global.nextDashFetch === 'function' ? global.nextDashFetch : fetch;
                const res = await api('/api/onboarding/template', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: this.chosen.id, server: this.server.trim(), values }),
                });
                answer = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(answer?.error || `HTTP ${res.status}`);
            } catch (error) {
                this.busy = false;
                if (button) button.disabled = false;
                this.showError(String(error?.message || '').startsWith('HTTP')
                    ? t('applyError', 'Could not set up the page')
                    : error.message);
                return;
            }
            window.nextdashTrack?.('first-start:template', { template: this.chosen.id, replaced: answer.replaced === true });
            await this.showPage(Number(answer.result?.pageId) || MAIN_PAGE_ID);
            this.finish(this.chosen.id);
        }

        /** Bring the new or rewritten page on screen without a reload. */
        async showPage(pageId) {
            const d = this.dash;
            try {
                const res = await fetch('/api/pages');
                if (res.ok) d.pages = await res.json();
            } catch { /* the list catches up on the next revision check */ }
            d.pageNav?.renderPageNavigation?.();
            d.data?.invalidatePageDataCache?.(pageId);
            await d.data?.loadAllBookmarks?.();
            await d.loadPageBookmarks?.(pageId, { forceFetch: true, skipInlineEditConfirm: true });
            void d.data?.fetchAndStoreDataRevision?.();
        }

        finish(picked) {
            const d = this.dash;
            if (!d.settings) d.settings = {};
            if (!d.settings.quickStart || typeof d.settings.quickStart !== 'object') d.settings.quickStart = {};
            d.settings.quickStart.templatePicked = picked;
            Promise.resolve(d.saveSettings?.()).catch(() => {});
            this.teardown();
            this.onDone(picked);
        }

        teardown() {
            document.removeEventListener('keydown', this.keyHandler);
            clearInterval(this.pageTimer);
            this.el?.remove();
            this.el = null;
        }
    }

    FirstStartTemplates.expandDefault = expandDefault;
    global.FirstStartTemplates = FirstStartTemplates;
})(window);
