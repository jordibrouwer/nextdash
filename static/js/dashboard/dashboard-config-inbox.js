/**
 * Config -> Inbox.
 *
 * What lands in the inbox and how the Inbox view looks. The settings are
 * schema panels (behaviorSchema, section 'inbox'), drawn, filtered, reset and
 * saved the way Behavior's are; this file adds the preview above them: two
 * example items, drawn by the Inbox's own row renderer, and the
 * head of its side panel -- redrawn on every change, as Bookmarks -> View's is.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    /**
     * The preview's two rows: always these, never the reader's own items. The
     * preview shows the settings, and a neutral pair says that better than
     * whatever happens to be at the top of the inbox.
     */
    function sampleItems() {
        const now = Date.now();
        return [
            {
                id: 'preview-1', url: 'https://example.com/blog/builds', domain: 'example.com',
                title: 'How we cut our build time in half', addedAt: now - 2 * 3600000,
            },
            {
                id: 'preview-2', url: 'https://news.example.org/weekly', domain: 'news.example.org',
                title: 'Weekly reading list', note: 'For the weekend', addedAt: now - 3 * 86400000, readAt: now - 86400000,
            },
        ];
    }

    Object.assign(global.DashboardConfig.prototype, {

    renderInboxSection() {
        const esc = (v) => this.dash.escapeHtml(v);
        const tabs = global.DashboardConfig.INBOX_TABS.map((tab) => {
            const active = tab === this.inboxTab;
            return `<button type="button" class="config-subtab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" aria-controls="config-inbox-body" data-inbox-tab="${esc(tab)}">${esc(this.inboxTabLabel(tab))}</button>`;
        }).join('');
        return `
            <p class="config-view-intro">${esc(this.t('config.inboxIntro',
                'What lands in the inbox, and how the Inbox view looks. Every change applies immediately and is saved.'))}</p>
            <div class="config-subtabs" role="tablist">${tabs}</div>
            <div class="config-tabpage">
                <div class="config-tabpage-main">
                    <div class="config-inbox-section" id="config-inbox-body" role="tabpanel" tabindex="0">
                        ${this.renderInboxBody()}
                    </div>
                    <div data-filter-elsewhere-host>${this.renderFilterElsewhere('inbox')}</div>
                </div>
            </div>
        `;
    },

    inboxTabLabel(tab) {
        const map = {
            collecting: ['config.inboxTabCollecting', 'Collecting'],
            list: ['config.inboxTabList', 'List'],
            panel: ['config.inboxTabPanel', 'Panel & clicks'],
            icon: ['config.inboxTabIcon', 'Header icon'],
        };
        const [key, fallback] = map[tab] || [tab, tab];
        return this.t(key, fallback);
    },

    /**
     * One tab's panels. The preview stands above the two tabs whose settings
     * it shows -- the rows and the side panel -- and not above what is
     * collected or the header icon, which it has nothing to say about.
     */
    renderInboxBody() {
        const esc = (v) => this.dash.escapeHtml(v);
        const tab = this.inboxTab;
        const withPreview = (tab === 'list' || tab === 'panel') && !this.changedOnly
            && !String(this.settingsFilter || '').trim();
        return `
            <div class="config-bm-view-bar">
                <a class="config-btn config-btn--small" href="#inbox" data-inbox-open-view>${esc(this.t('config.inboxOpenView', 'Open the Inbox'))} ↗</a>
            </div>
            ${withPreview ? this.renderInboxViewPreview() : ''}
            ${this.renderControlPanels(this.panelsFor('inbox', tab), 'behavior')}`;
    },

    /** Redraw the body for the tab now chosen, the strip left as it is. */
    repaintInboxBody() {
        const body = document.getElementById('config-inbox-body');
        if (!body) return;
        body.innerHTML = this.renderInboxBody();
        this.bindControlPanels(body, 'behavior');
        this.bindInboxSection(body);
        this.labelSettingsControls?.();
        this.repaintFilterElsewhere('inbox');
    },

    /**
     * The frame of the preview. The rows arrive in bindInboxSection: they are
     * the Inbox's own, and its module loads on demand.
     */
    renderInboxViewPreview() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        const wide = s.inboxViewPanelWidth === 'wide';
        return `
            <section class="config-panel config-inbox-view-preview" aria-hidden="true" inert data-inbox-view-preview>
                <h3 class="config-panel-title">${esc(this.t('config.bmViewPreview', 'Preview'))}</h3>
                <div class="config-bm-view-preview-body">
                    <div class="config-inbox-view-preview-list" data-inbox-preview-rows></div>
                    <div class="config-bm-view-preview-panel config-inbox-view-preview-panel${wide ? ' is-wide' : ''}" data-inbox-preview-panel></div>
                </div>
            </section>`;
    },

    bindInboxSection(root) {
        const scope = root || document;
        // The strip is outside the body: bound when the whole section is, not
        // again on every repaint of the body.
        if (scope.querySelector('[data-inbox-tab]')) {
            this.bindSubTabStrip(scope, 'data-inbox-tab', (tab) => {
                if (tab === this.inboxTab) return;
                this.inboxTab = tab;
                this.restoreConfigHash();
                this.repaintInboxBody();
                this.syncSubTabStrip('data-inbox-tab', this.inboxTab);
            });
            this.bindFilterElsewhere?.(scope);
        }
        scope.querySelector('[data-inbox-open-view]')?.addEventListener('click', (e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            void this.dash.inbox?.openInboxView?.();
        });
        void this.fillInboxViewPreview(scope);
    },

    /** Two rows, the key legend where the setting puts it, and the panel's head. */
    async fillInboxViewPreview(scope) {
        const rowsHost = scope.querySelector('[data-inbox-preview-rows]');
        const panelHost = scope.querySelector('[data-inbox-preview-panel]');
        if (!rowsHost) return;
        const token = (this._inboxPreviewToken || 0) + 1;
        this._inboxPreviewToken = token;
        let mod = null;
        try {
            await global.ViewStyles?.ensureViewStyles?.();
            mod = await this.dash.inbox?.load?.();
        } catch {
            mod = null;
        }
        // A newer paint has started since: this one's rows would be stale.
        if (token !== this._inboxPreviewToken || !rowsHost.isConnected || !mod) return;
        const items = sampleItems();
        const rows = items.map((item) => {
            try {
                return mod.createItemElement(item);
            } catch {
                return null;
            }
        }).filter(Boolean);
        rowsHost.innerHTML = '';
        const legendAt = this.dash.settings?.inboxViewKeyLegend || 'below';
        const legend = legendAt !== 'off' && typeof mod.renderLegend === 'function' ? mod.renderLegend() : null;
        if (legend && legendAt === 'above') rowsHost.appendChild(legend);
        rows.forEach((row) => rowsHost.appendChild(row));
        if (legend && legendAt === 'below') rowsHost.appendChild(legend);
        if (panelHost) {
            const esc = (v) => this.dash.escapeHtml(v);
            const first = items[0];
            const title = first.previewTitle || first.title || first.domain || first.url;
            panelHost.innerHTML = `
                <header class="config-bm-panel-head config-bm-panel-head--single">
                    <div class="config-bm-panel-heading">
                        <span class="config-bm-panel-title">${esc(title)}</span>
                    </div>
                    <span class="config-bm-panel-url">${esc(first.url || '')}</span>
                </header>
                <div class="config-inbox-view-preview-actions">
                    <span class="config-btn config-btn--small config-btn--primary">${esc(this.t('dashboard.inboxPromote', 'Promote'))}</span>
                    <span class="config-btn config-btn--small">${esc(this.t('dashboard.inboxKeep', 'Keep'))}</span>
                    <span class="config-btn config-btn--small">${esc(this.t('dashboard.inboxSnooze', 'Snooze'))}</span>
                </div>`;
        }
    },
    });

    global.DashboardConfigInboxReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
