/**
 * Config → Help: the shell of the Help section, its tab strip, search and the capture panel.
 *
 * Moved out of dashboard-config.js verbatim: same methods, same prototype, same
 * order. Only the moment the file arrives has changed — it is fetched when this
 * section is opened rather than on every visit to any other one.
 *
 * The bodies are not re-indented. Several of them build markup from multi-line
 * template literals, and shifting every line four spaces to the right would
 * change the strings they produce.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    Object.assign(global.DashboardConfig.prototype, {

    /** Rebuild the bookmarklet when the token field changes, and copy on request. */
    bindCapturePanel(container) {
        const tokenInput = container.querySelector('[data-capture-token]');
        tokenInput?.addEventListener('input', () => {
            this._captureToken = tokenInput.value;
            const body = document.getElementById('config-view-body');
            if (body) {
                body.innerHTML = this.renderSection();
                this.bindHelp?.(body);
                // Focus returns to the field being typed in, which the repaint
                // replaced under the cursor.
                document.querySelector('[data-capture-token]')?.focus();
            }
        });
        container.querySelector('[data-capture-copy]')?.addEventListener('click', () => {
            const text = container.querySelector('[data-capture-bookmarklet]')?.value || '';
            if (!text) return;
            void navigator.clipboard?.writeText(text)
                .then(() => this.notify(this.t('config.helpCaptureCopied', 'Bookmarklet copied'), 'success'))
                .catch(() => this.notify(this.t('config.copyFailed', 'Could not copy'), 'error'));
        });
    },

    bindHelp(container) {
        this.bindCapturePanel(container);
        this.bindHelpTabStrip(container);
        this.bindHelpSearch(container);
        this.bindHelpActions(container);
    },

    /** The help search field, and the tab buttons on each result. */
    bindHelpSearch(container) {
        const field = container.querySelector('#config-help-search');
        if (!field) return;

        const repaint = () => {
            const body = document.getElementById('config-help-body');
            if (!body) return;
            const query = String(this.helpQuery || '').trim();
            body.innerHTML = query ? this.renderHelpSearchResults() : this.renderHelpBody();
            // Results carry panels lifted from every tab, so their buttons need
            // binding just as a freshly switched tab body does.
            this.bindHelpActions(body);
            this.bindHelpResultJumps(body);
            // The tab strip means nothing while results are showing; dim it
            // rather than remove it, so the way back is still where it was.
            container.querySelector('.config-subtabs')?.classList.toggle('is-muted', !!query);
        };

        let debounce = null;
        field.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                this.helpQuery = field.value;
                repaint();
            }, 200);
        });
        // Escape clears the query rather than closing config, matching the other
        // search fields — but only while there is something to clear.
        field.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !String(this.helpQuery || '').trim()) return;
            e.preventDefault();
            e.stopPropagation();
            this.helpQuery = '';
            field.value = '';
            repaint();
        });
    },

    bindHelpTabStrip(container) {
        this.bindSubTabStrip(container, 'data-help-tab', (tab) => this.switchHelpTab(tab));
        const toggle = container.querySelector('[data-help-more-toggle]');
        if (toggle && toggle.dataset.helpMoreBound !== '1') {
            toggle.dataset.helpMoreBound = '1';
            toggle.addEventListener('click', () => {
                if (this._helpMoreClose) this._helpMoreClose();
                else this.openHelpMoreMenu(toggle);
            });
        }
    },

    /** "Open this tab" on a search result. */
    /**
     * The topics past Basics, as a menu under "More topics".
     *
     * Built on open and dropped on close, and hung on the body rather than in
     * the strip: the strip scrolls sideways and clips what overflows it, and a
     * panel under Glass would make a fixed menu's coordinates its own.
     */
    openHelpMoreMenu(toggle) {
        const esc = (v) => this.dash.escapeHtml(v);
        const [, ...rest] = DashboardConfig.HELP_TAB_GROUPS;
        const menu = document.createElement('div');
        menu.className = 'move-popover config-help-more-menu';
        menu.id = 'config-help-more-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', this.t('config.helpMoreTopics', 'More topics'));
        menu.innerHTML = rest.map((group) => `
            <div class="move-popover-section-label" role="presentation">${esc(this.t(group.label[0], group.label[1]))}</div>
            ${group.tabs.map((tab) => `<button type="button" class="move-popover-item${tab === this.helpTab ? ' is-current' : ''}" role="menuitem" tabindex="-1" data-help-more="${esc(tab)}">${esc(this.helpTabLabel(tab))}</button>`).join('')}
        `).join('');
        document.body.appendChild(menu);
        const items = [...menu.querySelectorAll('[data-help-more]')];

        const MARGIN = 8;
        const position = () => {
            const rect = toggle.getBoundingClientRect();
            const width = menu.offsetWidth;
            const left = Math.min(Math.max(MARGIN, rect.left), window.innerWidth - width - MARGIN);
            menu.style.left = `${Math.round(left)}px`;
            menu.style.top = `${Math.round(rect.bottom + 4)}px`;
        };
        let onOutside = null;
        const close = ({ refocus = true } = {}) => {
            if (this._helpMoreClose !== close) return;
            this._helpMoreClose = null;
            menu.remove();
            toggle.setAttribute('aria-expanded', 'false');
            document.removeEventListener('click', onOutside, true);
            window.removeEventListener('resize', position);
            window.removeEventListener('scroll', position, true);
            if (refocus && toggle.isConnected) toggle.focus({ preventScroll: true });
        };
        onOutside = (e) => {
            if (menu.contains(e.target) || toggle.contains(e.target)) return;
            close({ refocus: false });
        };
        items.forEach((item, i) => {
            item.addEventListener('click', () => {
                close({ refocus: false });
                this.switchHelpTab(item.getAttribute('data-help-more'));
                document.querySelector(`[data-help-tab="${CSS.escape(this.helpTab)}"]`)?.focus();
            });
            item.addEventListener('keydown', (e) => {
                const last = items.length - 1;
                const next = { ArrowDown: i === last ? 0 : i + 1, ArrowUp: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
                if (next != null) {
                    e.preventDefault();
                    items[next].focus();
                } else if (e.key === 'Tab') {
                    close({ refocus: false });
                }
            });
        });

        toggle.setAttribute('aria-expanded', 'true');
        position();
        // Bound on the next tick, or the click that opened the menu closes it.
        setTimeout(() => document.addEventListener('click', onOutside, true), 0);
        window.addEventListener('resize', position);
        window.addEventListener('scroll', position, true);
        this._helpMoreClose = close;
        (items.find((item) => item.classList.contains('is-current')) || items[0])?.focus();
    },

    renderHelp() {
        // A full repaint replaces the menu's button; the menu goes with it.
        this._helpMoreClose?.({ refocus: false });
        this.ensureHelpProse();
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <!--
                The opening line is a direct child of the body so the shell
                lifts it onto the view band, the way every other section's is.
                Inside the header block it was invisible to that lift, which
                left Help the one section whose band carried no line and whose
                text stood above the tab strip instead of under it.
            -->
            <p class="config-view-intro">${esc(this.t('config.helpIntro', 'How nextDash works, what each part of config does, and where to go next.'))}</p>
            ${this.renderSectionTabStrip('help')}
            <!--
                The sheet and the search share the tab note's row rather than
                standing above the strip: a block above it put Help's tabs
                eighty pixels below every other section's, so walking through
                the rail moved the tabs under the pointer.
            -->
            <div class="config-help-header">
                ${this.renderSectionTabNote('help', this.helpTab)}
                <div class="config-help-header-aside">
                    ${this.renderCheatSheetPdfLink()}
                    <input type="search" class="config-text config-help-search" id="config-help-search"
                           placeholder="${esc(this.t('config.helpFilterPlaceholder', 'Search help…'))}"
                           aria-label="${esc(this.t('config.helpFilterLabel', 'Search help'))}"
                           value="${esc(this.helpQuery || '')}">
                </div>
            </div>
            <div id="config-help-body" role="tabpanel" tabindex="0">${this.renderHelpBody()}</div>
        `;
    },

    /**
     * Draw the Help strip again when the tab it should show has changed.
     *
     * The row holds Basics plus the open tab when that one lives in the menu,
     * so a switch to or from a menu topic changes which buttons the row has --
     * marking a different button active is not enough.
     */
    repaintHelpStripIfNeeded() {
        const strip = document.querySelector('.config-subtabs--more');
        if (!strip) return;
        const have = [...strip.querySelectorAll('[data-help-tab]')].map((b) => b.getAttribute('data-help-tab')).join(',');
        if (have === this.helpStripTabs().join(',')) return;
        const host = strip.parentElement;
        strip.outerHTML = this.renderSectionTabStrip('help');
        this.bindHelpTabStrip(host);
    },

    switchHelpTab(tab) {
        if (tab === this.helpTab) return;
        this.helpTab = tab;
        // Switching tabs by hand means the reader has stopped searching;
        // leaving the query on would show results instead of the tab
        // they just clicked.
        this.helpQuery = '';
        const field = document.getElementById('config-help-search');
        if (field) field.value = '';
        this.restoreConfigHash();
        const body = document.getElementById('config-help-body');
        if (!body) { this.render(); return; }
        body.innerHTML = this.renderHelpBody();
        this.syncSubTabStrip('data-help-tab', this.helpTab);
        this.syncSectionTabNote('help', this.helpTab, body.parentElement?.querySelector(':scope > .config-help-header'));
        // The new body carries its own action buttons.
        this.bindHelpActions(body);
    }

    });

    global.DashboardConfigHelpReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
