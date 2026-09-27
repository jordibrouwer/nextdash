/**
 * Config -> Inbox.
 *
 * What lands in the inbox and how the Inbox view looks. The settings are
 * schema panels (behaviorSchema, section 'inbox'), drawn, filtered, reset and
 * saved the way Behavior's are; this file adds the preview above them: two of
 * the reader's own inbox items, drawn by the Inbox's own row renderer, and the
 * head of its side panel -- redrawn on every change, as Bookmarks -> View's is.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    /** Stand-ins for an inbox with fewer than two items in it. */
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
        return `
            <p class="config-view-intro">${esc(this.t('config.inboxIntro',
                'What lands in the inbox, and how the Inbox view looks. Every change applies immediately and is saved.'))}</p>
            <div class="config-tabpage">
                <div class="config-tabpage-main config-inbox-section" id="config-inbox-body">
                    ${this.renderInboxBody()}
                </div>
            </div>
        `;
    },

    renderInboxBody() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <div class="config-bm-view-bar">
                <a class="config-btn config-btn--small" href="#inbox" data-inbox-open-view>${esc(this.t('config.inboxOpenView', 'Open the Inbox'))} ↗</a>
            </div>
            ${this.renderInboxViewPreview()}
            ${this.renderControlPanels(this.panelsFor('inbox', 'general'), 'behavior')}`;
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
            if (mod && !Array.isArray(mod.items)) mod.items = [];
            if (mod && !mod.items.length && typeof mod.fetchItems === 'function') await mod.fetchItems();
        } catch {
            mod = null;
        }
        // A newer paint has started since: this one's rows would be stale.
        if (token !== this._inboxPreviewToken || !rowsHost.isConnected || !mod) return;
        const own = (mod.activeItems?.() || mod.items || []).slice(0, 2);
        const items = own.length >= 2 ? own : sampleItems();
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
