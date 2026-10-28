/**
 * Config → Widgets: the Add wizard's shell.
 *
 * Adding a widget used to land on "whichever page the list happens to show",
 * which on the all-pages view was no page at all. The picker now names the
 * page itself, and only when there is a choice to make. The helpers here are
 * the questions the wizard asks: what kind of widget needs a connection
 * step, which pages exist, and which one is the sensible default.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    Object.assign(global.DashboardConfig.prototype, {
        /*
         * What the wizard does for a kind: 'media' when it connects to a
         * service first, 'custom' for the Custom widget, null for the rest.
         * Beszel, Home Assistant, Unraid and Glances stay null for now -- their
         * connection lives in their own settings panel.
         */
        widgetWizardKind(type) {
            if (type === 'custom') return 'custom';
            return global.DashboardConfig.MEDIA_SERVICES?.[type] ? 'media' : null;
        },

        widgetWizardPages() {
            const pages = Array.isArray(this.dash.pages) ? this.dash.pages : [];
            return pages.map((p) => ({ id: Number(p.id), name: String(p.name || p.id) }));
        },

        /** The page the list shows, else the one on screen, else the first. */
        widgetWizardDefaultPage() {
            if (typeof this._widgetPageId === 'number') return this._widgetPageId;
            const pages = this.widgetWizardPages();
            const current = this.dash.currentPageId ?? pages[0]?.id;
            return Number(current);
        },

        /*
         * The page choice, drawn only when there is one to make. On the
         * all-pages view the list's own page means nothing, so the select
         * starts on the page being looked at.
         */
        widgetWizardPageSelect() {
            const pages = this.widgetWizardPages();
            if (pages.length < 2) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            // A choice already made survives the preview being redrawn for
            // another kind; it is forgotten when the picker opens afresh.
            const remembered = pages.some((p) => p.id === this._widgetWizardPageId)
                ? this._widgetWizardPageId : null;
            const chosen = remembered ?? (this.isAllPagesView()
                ? Number(this.dash.currentPageId ?? pages[0].id)
                : this.widgetWizardDefaultPage());
            return `<label class="config-widget-wizard-page">
                <span>${esc(this.t('config.widgetsAddOnPage', 'On page'))}</span>
                <select class="config-select" data-widget-wizard-page>${pages.map((p) =>
                    `<option value="${esc(p.id)}"${p.id === chosen ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
            </label>`;
        },
    });

    global.DashboardConfigWidgetWizardReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
