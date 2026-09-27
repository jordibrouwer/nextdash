/**
 * The Bookmarks view's band: what Health's header offered -- Work through,
 * Rot report, a ⋯ of the rest and an ⓘ -- beside the view's own buttons.
 *
 * Work through is Health's own walk (DashboardHealthFocus), handed the list as
 * this view shows it rather than as the Health view would: a thin stand-in for
 * the Health module answers getFilteredIssues from the view, and leaves the
 * Health view's address and drawing alone, since that view is not open.
 *
 * Loaded after the workbench, by ensureBookmarkRenderers.
 */
(function (global) {
    'use strict';
    if (typeof global.DashboardConfig !== 'function') return;

    Object.assign(global.DashboardConfig.prototype, {
        renderLibraryHeaderActions() {
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(key, fallback);
            const healthOn = this.dash.settings?.healthViewEnabled !== false;
            const more = esc(t('dashboard.healthToolbarMore', 'More actions'));
            const help = esc(t('config.bmHelpTitle', 'How the Bookmarks view works'));
            return `
                ${healthOn ? `<button type="button" class="lvs-action lvs-action--primary" data-bm-work-through
                        title="${esc(t('config.bmWorkThroughHint', 'Go through this list one bookmark at a time'))}">${esc(t('dashboard.healthFocus', 'Work through'))}<kbd>f</kbd></button>
                <button type="button" class="lvs-action" data-bm-rot-report
                        title="${esc(t('dashboard.healthRotHint', 'What has gone, moved or been failing for a long time'))}">${esc(t('dashboard.healthRot', 'Rot report'))}</button>` : ''}
                <button type="button" class="lvs-action" data-bm-open-structure>${esc(t('config.bmStructureButton', 'Pages & categories'))}</button>
                ${healthOn ? `<button type="button" class="lvs-action" data-bm-open-health-modal>${esc(t('config.bmHealthModalTitle', 'Collection health'))}</button>` : ''}
                <button type="button" class="lvs-action" data-bm-export
                        title="${esc(t('config.bmExportHint', 'The list as it stands, as a CSV file'))}">${esc(t('config.bmExport', 'Export'))}</button>
                <span class="config-bm-header-more">
                    <button type="button" class="lvs-action lvs-action--overflow" data-bm-header-more aria-haspopup="menu" aria-expanded="false"
                            title="${more}" aria-label="${more}">⋯</button>
                    <div class="config-structure-menu config-bm-header-menu" role="menu" data-bm-header-menu hidden>
                        ${healthOn ? `<button type="button" role="menuitem" data-bm-header-action="refresh">${esc(t('config.bmKeyRefreshReport', 'refresh report').replace(/^./, (c) => c.toUpperCase()))} <kbd>⇧R</kbd></button>` : ''}
                        ${this.uncheckedBookmarks?.().length ? `<button type="button" role="menuitem" data-bm-header-action="checking">${esc(t('config.bmCheckingTitle', 'Turn on checking'))}…</button>` : ''}
                        ${healthOn ? `<button type="button" role="menuitem" data-bm-header-action="settings">${esc(t('config.bmHealthSettings', 'Health settings'))}</button>` : ''}
                    </div>
                </span>
                <button type="button" class="lvs-action view-help-btn" data-bm-help aria-haspopup="dialog" title="${help}" aria-label="${help}">ℹ</button>`;
        },

        /** Clicks in the band; true when one was taken. */
        handleLibraryHeaderClick(e) {
            const on = (sel) => e.target.closest(sel);
            if (on('[data-bm-work-through]')) this.startLibraryWorkThrough();
            else if (on('[data-bm-rot-report]')) this._bmHealthModule?.showRotReport?.();
            else if (on('[data-bm-export]')) this.bulkExportCsv?.(this.visibleBookmarks());
            else if (on('[data-bm-help]')) this.showLibraryExplainer();
            else if (on('[data-bm-header-more]')) {
                const button = on('[data-bm-header-more]');
                const menu = button.parentElement?.querySelector('[data-bm-header-menu]');
                if (menu) {
                    menu.hidden = !menu.hidden;
                    button.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
                }
            } else if (on('[data-bm-header-action]')) {
                const action = on('[data-bm-header-action]').getAttribute('data-bm-header-action');
                this.closeLibraryHeaderMenu();
                if (action === 'refresh') void this.refreshBmHealth?.({ refresh: true });
                else if (action === 'checking') this.openCheckingModal?.();
                else if (action === 'settings') void this._bmHealthModule?.openStatusHealthSettings?.();
            } else {
                return false;
            }
            return true;
        },

        closeLibraryHeaderMenu() {
            document.querySelectorAll('[data-bm-header-menu]').forEach((m) => { m.hidden = true; });
            document.querySelectorAll('[data-bm-header-more]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
        },

        /** Health's walk over the list as this view shows it. */
        startLibraryWorkThrough() {
            const health = this._bmHealthModule;
            const Focus = global.DashboardHealthFocus;
            if (!health || typeof Focus !== 'function') return;
            const issues = () => this.visibleBookmarks().map((b) => this.bmHealthIssue(b)).filter(Boolean);
            if (!issues().length) {
                this.notify(this.t('config.bmWorkThroughEmpty', 'Nothing in this list to work through.'), 'info');
                return;
            }
            const view = Object.create(health);
            view.getFilteredIssues = issues;
            // The Health view is not open: nothing of it to redraw or re-address.
            view.syncUrlState = () => {};
            view.render = () => {};
            view.closeDrawer = () => {};
            view.applyFilter = () => {};
            this._libFocus = new Focus(view);
            this._libFocus.open();
        },

        /** ⓘ: what the view is and how it is worked. */
        showLibraryExplainer() {
            if (typeof global.AppModal?.show !== 'function') return;
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(`config.${key}`, fallback);
            const row = (title, body) => `<div class="view-explain-row"><h4>${esc(title)}</h4><p>${esc(body)}</p></div>`;
            global.AppModal.show({
                title: t('bmHelpTitle', 'How the Bookmarks view works'),
                htmlMessage: `<div class="view-explain">
                    ${row(t('bmHelpListTitle', 'The list'), t('bmHelpList', 'Every bookmark, filtered from the rail on the left, grouped and sorted from the toolbar. Its colour is its state: red broken, amber worth a look, blue monitored, green checked and healthy, dashed grey not checked at all. The number at the end is its score.'))}
                    ${row(t('bmHelpPanelTitle', 'The side panel'), t('bmHelpPanel', 'Click a row to open it. Details is the bookmark itself, Health is its checks and score, Usage is how it is used. Switch with 1, 2 and 3 or [ and ].'))}
                    ${row(t('bmHelpKeysTitle', 'Keys'), t('bmHelpKeys', 'j and k move, x ticks, e edits, p re-checks, s shows the score, c the checking, f works through the list, h opens Collection health, Shift+P and Shift+C pages and categories, Shift+R refreshes the report.'))}
                    ${row(t('bmHelpWorkTitle', 'Work through'), t('bmHelpWork', 'Goes through the list as it is filtered, one bookmark at a time, with the actions for each at hand.'))}
                </div>`,
                confirmText: this.t('dashboard.healthExplainClose', 'Got it'),
                showCancel: false,
                modalClass: 'view-explain-modal',
                modalMaxWidth: 'min(34rem, calc(100vw - 2.5rem))',
            });
        },
    });

    global.DashboardBookmarksHeaderReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
