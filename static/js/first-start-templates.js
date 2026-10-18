/**
 * First-start card: "What do you want?"
 *
 * A fresh install opens on example links. This card, at the top of main and
 * before the quick-start checklist, asks whether to keep them or to start
 * with an empty page. The apps found on this server come later, at the end of
 * the onboarding (app-discovery-card.js).
 *
 * Part of the page, not a corner card: it sits above the blocks and the page
 * under it keeps working. Answering it (Keep, Start empty, ✕ or Esc) records
 * settings.quickStart.templatePicked, and QuickStart carries on with the
 * checklist.
 *
 * expandDefault stays here for the import dialog, which fills the bundled
 * templates from one server address.
 */
(function (global) {
    'use strict';

    const MAIN_PAGE_ID = 1;
    // Bars that belong to the grid and sit right above it; the card stays above them.
    const GRID_BARS = '#grid-filter-bar, .multi-select-toolbar';
    const SERVER = '{server}';
    // The manual, for a reader who wants it before choosing.
    const DOCS_URL = 'https://nextdash.cc/docs/';

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
            this.busy = false;
            this.keyHandler = (event) => {
                if (event.key !== 'Escape' || !this.el || this.el.hidden || this.busy) return;
                if (this.dash?.isModalOpen?.()) return;
                this.finish('keep');
            };
            this.pageTimer = null;
        }

        async show() {
            try {
                const res = await fetch('/api/page-templates/bundled');
                if (!res.ok) throw new Error(String(res.status));
                const data = await res.json();
                // Only main as it started can be emptied; anything else
                // somebody made is theirs, and there is nothing to ask.
                if (data.replacesMain !== true) { this.onDone(); return; }
            } catch {
                this.onDone();
                return;
            }
            this.render();
            document.addEventListener('keydown', this.keyHandler);
            // Only on main: the card is about that page, and follows the reader
            // there and back without being answered by a page switch.
            this.pageTimer = setInterval(() => this.place(), 500);
        }

        /**
         * Keep the card above main's blocks, and out of sight elsewhere.
         *
         * Above the grid's own bars too. The Shift+F filter and the selection
         * toolbar are inserted right before the grid, and this used to demand
         * that spot for itself: every 500ms it moved back under them, which
         * left the filter bar above the card, away from the rows it filters.
         */
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
                this.el.className = 'first-start-card';
                this.el.setAttribute('aria-label', t('label', 'Choose how to start'));
                this.el.addEventListener('click', (event) => this.onClick(event));
            }
            this.el.innerHTML = `<div class="first-start-stripe"></div>
                <div class="first-start-inner">
                    <div class="first-start-head">
                        <p class="first-start-title">// ${esc(t('titleWant', 'what do you want?'))}</p>
                        <button type="button" class="first-start-close" data-fs-keep aria-label="${esc(t('close', 'Keep these links'))}">×</button>
                    </div>
                    <p class="first-start-sub">${esc(t('introWant', 'This page starts with example links. Keep them to look around, or clear them and add your own.'))}</p>
                    <div class="first-start-tiles">
                        <button type="button" class="first-start-tile first-start-tile--keep" data-fs-keep>
                            <span class="first-start-tile-name"><span class="first-start-tile-icon" aria-hidden="true">○</span> ${esc(t('keepExamples', 'Keep these example links'))}</span>
                            <span class="first-start-tile-services">${esc(t('keepExamplesHint', 'The starter page as it is; remove them any time'))}</span>
                        </button>
                        <button type="button" class="first-start-tile" data-fs-empty>
                            <span class="first-start-tile-name"><span class="first-start-tile-icon" aria-hidden="true">＋</span> ${esc(t('startEmpty', 'Start with an empty page'))}</span>
                            <span class="first-start-tile-services">${esc(t('startEmptyHint', 'Remove the example links and add your own'))}</span>
                        </button>
                        <button type="button" class="first-start-tile" data-fs-manual>
                            <span class="first-start-tile-name"><span class="first-start-tile-icon" aria-hidden="true">?</span> ${esc(t('showManual', 'Show me the manual first'))}</span>
                            <span class="first-start-tile-services">${esc(t('showManualHint', 'Opens nextdash.cc/docs in a new window'))}</span>
                        </button>
                        <button type="button" class="first-start-tile" data-fs-studio>
                            <span class="first-start-tile-name"><span class="first-start-tile-icon" aria-hidden="true">✦</span> ${esc(t('openStudio', 'Open the theme studio'))}</span>
                            <span class="first-start-tile-services">${esc(t('openStudioHint', 'Experiment with the surface settings for a look of your own (Shift+A)'))}</span>
                        </button>
                    </div>
                    <p class="first-start-error" data-fs-error role="alert" hidden></p>
                </div>`;
            this.place();
        }

        onClick(event) {
            const target = event.target.closest('button');
            if (!target || this.busy) return;
            if (target.hasAttribute('data-fs-keep')) { this.finish('keep'); return; }
            // These two answer nothing: the card stays until the reader has chosen.
            if (target.hasAttribute('data-fs-manual')) {
                global.open(DOCS_URL, '_blank', 'noopener');
                return;
            }
            if (target.hasAttribute('data-fs-studio')) {
                void this.dash?.config?.openThemeBrowser?.();
                return;
            }
            if (target.hasAttribute('data-fs-empty')) void this.startEmpty();
        }

        showError(message) {
            const error = this.el?.querySelector('[data-fs-error]');
            if (!error) return;
            error.textContent = message;
            error.hidden = false;
        }

        async startEmpty() {
            this.busy = true;
            try {
                const api = typeof global.nextDashFetch === 'function' ? global.nextDashFetch : fetch;
                const res = await api('/api/onboarding/start-empty', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
            } catch {
                this.busy = false;
                this.showError(t('startEmptyError', 'Could not clear the page'));
                return;
            }
            global.nextdashTrack?.('first-start:empty');
            await this.showPage(MAIN_PAGE_ID);
            this.finish('empty');
        }

        /** Bring the emptied page on screen without a reload. */
        async showPage(pageId) {
            const d = this.dash;
            // Start empty can take the starter news page away: the tabs
            // follow, or page 2 stays in the header with nothing behind it.
            try {
                const res = await fetch('/api/pages', { cache: 'no-store' });
                if (res.ok) {
                    d.pages = await res.json();
                    d.pageNav?.renderPageNavigation?.();
                }
            } catch { /* the tabs catch up on the next revision check */ }
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
