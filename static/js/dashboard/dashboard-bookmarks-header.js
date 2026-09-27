/**
 * The Bookmarks view's band: Work through as its one button, the rest of
 * what Health's header offered and the view's own actions in one Collection
 * menu, and an ⓘ.
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
            const help = esc(t('config.bmHelpTitle', 'How the Bookmarks view works'));
            const unchecked = this.uncheckedBookmarks?.().length || 0;
            const item = (attrs, label, key = '') => `<button type="button" role="menuitem" ${attrs}><span>${esc(label)}</span>${key ? `<kbd>${esc(key)}</kbd>` : ''}</button>`;
            const heading = (label) => `<div class="config-bm-header-menu-h" role="presentation">${esc(label)}</div>`;
            const look = healthOn ? [
                item('data-bm-open-health-modal', t('config.bmHealthModalTitle', 'Collection health'), 'h'),
                item('data-bm-rot-report', t('dashboard.healthRot', 'Rot report')),
            ] : [];
            // What the Health view's toolbar did to the whole collection, each
            // offered only while it has something to act on.
            const health = healthOn ? this._bmHealthModule : null;
            const count = (fn) => { try { return Number(fn()) || 0; } catch { return 0; } };
            const broken = health ? count(() => health.brokenCount()) : 0;
            const noPreview = health ? count(() => health.filterCount('missing-preview')) : 0;
            const dupes = health ? count(() => health.duplicateGroups().length) : 0;
            const checked = health ? count(() => health.checkedCount()) : 0;
            const organise = [
                item('data-bm-open-structure', t('config.bmStructureButton', 'Pages & categories'), '⇧P'),
                dupes ? item('data-bm-header-action="merge"', `${t('dashboard.mergeDuplicateGroup', 'Merge duplicate group')}…`, String(dupes)) : '',
                unchecked ? item('data-bm-header-action="checking"', `${t('config.bmCheckingTitle', 'Turn on checking')}…`, String(unchecked)) : '',
            ];
            const checks = health ? [
                item('data-bm-header-action="retest"', t('dashboard.healthRetest', 'Retest all')),
                broken ? item('data-bm-header-action="open-broken"', `${t('dashboard.openBrokenLinks', 'Open broken links')}…`, String(broken)) : '',
                noPreview ? item('data-bm-header-action="fetch-previews"', `${t('dashboard.healthFetchPreviews', 'Fetch previews')}…`, String(noPreview)) : '',
                checked ? item('data-bm-header-action="check-off"', `${t('dashboard.healthCheckOff', 'Checking off')}…`) : '',
            ] : [];
            const rest = [
                item('data-bm-export', t('config.bmExportCsv', 'Export CSV')),
                healthOn ? item('data-bm-header-action="refresh"', t('config.bmKeyRefreshReport', 'refresh report').replace(/^./, (c) => c.toUpperCase()), '⇧R') : '',
                healthOn ? item('data-bm-header-action="settings"', t('config.bmHealthSettings', 'Health settings')) : '',
            ];
            // Work through is what the view is worked with; the rest is looked
            // at now and then, so it waits in one menu rather than a row of
            // equal buttons.
            return `
                ${healthOn ? `<button type="button" class="lvs-action lvs-action--primary" data-bm-work-through
                        title="${esc(t('config.bmWorkThroughHint', 'Go through this list one bookmark at a time'))}">${esc(t('dashboard.healthFocus', 'Work through'))}<kbd>f</kbd></button>` : ''}
                <span class="config-bm-header-more">
                    <button type="button" class="lvs-action" data-bm-header-more aria-haspopup="menu" aria-expanded="false">${esc(t('config.bmCollectionMenu', 'Collection'))} <span aria-hidden="true">▾</span></button>
                    <div class="config-structure-menu config-bm-header-menu" role="menu" data-bm-header-menu hidden>
                        ${look.length ? heading(t('config.bmMenuLookAt', 'Look at')) + look.join('') + '<hr>' : ''}
                        ${heading(t('config.bmMenuOrganise', 'Organise'))}${organise.join('')}<hr>
                        ${checks.length ? heading(t('config.bmMenuChecks', 'Checks')) + checks.join('') + '<hr>' : ''}
                        ${rest.join('')}
                    </div>
                </span>
                <button type="button" class="lvs-action view-help-btn" data-bm-help aria-haspopup="dialog" title="${help}" aria-label="${help}">ℹ</button>`;
        },

        /** Clicks in the band; true when one was taken. */
        handleLibraryHeaderClick(e) {
            const on = (sel) => e.target.closest(sel);
            if (on('[data-bm-header-menu] [role="menuitem"]')) this.closeLibraryHeaderMenu();
            if (on('[data-bm-work-through]')) this.startLibraryWorkThrough();
            else if (on('[data-bm-rot-report]')) this._bmHealthModule?.showRotReport?.();
            else if (on('[data-bm-export]')) this.bulkExportCsv?.(this.visibleBookmarks());
            else if (on('[data-bm-help]')) this.showLibraryExplainer();
            else if (on('[data-bm-header-more]')) {
                const button = on('[data-bm-header-more]');
                const menu = button.parentElement?.querySelector('[data-bm-header-menu]');
                if (menu?.hidden) this.openLibraryHeaderMenu(button, menu);
                else this.closeLibraryHeaderMenu();
            } else if (on('[data-bm-header-action]')) {
                const action = on('[data-bm-header-action]').getAttribute('data-bm-header-action');
                if (action === 'refresh') void this.refreshBmHealth?.({ refresh: true });
                else if (action === 'checking') this.openCheckingModal?.();
                else if (action === 'settings') void this._bmHealthModule?.openStatusHealthSettings?.();
                else void this.runLibraryCollectionAction(action);
            } else {
                return false;
            }
            return true;
        },

        /**
         * The collection-wide tools the Health view's toolbar carried, run by
         * Health's own methods. Each reloads the report, and the view hears of
         * it (onReportLoaded); what they change on the bookmarks themselves
         * is read back here.
         */
        async runLibraryCollectionAction(action) {
            const health = this._bmHealthModule;
            if (!health) return;
            if (action === 'merge') {
                const groups = (health.duplicateGroups() || []).filter((g) => (g?.bookmarks || []).length > 1);
                // One group is merged at once; more, and the list shows them,
                // each with its own Merge in the side panel's ⋯.
                if (groups.length > 1) {
                    if (this.bmCleanupFilter !== 'duplicate') this.toggleRailFilter('cleanup', 'duplicate');
                    return;
                }
                if (groups.length === 1) await health.mergeDuplicateGroup(groups[0]);
            } else if (action === 'retest') {
                await health.retestAll();
            } else if (action === 'open-broken') {
                await health.openBrokenLinks();
            } else if (action === 'fetch-previews') {
                await health.fetchMissingPreviews();
            } else if (action === 'check-off') {
                await health.disableAllChecking();
            } else {
                return;
            }
            await this.dash.loadAllBookmarks?.();
            this.invalidateVisibleBookmarks?.();
            this.repaintBookmarksList?.();
        },

        /** Open until a pick, Escape or a click anywhere else. */
        openLibraryHeaderMenu(button, menu) {
            this.closeLibraryHeaderMenu();
            // Drawn afresh on each opening: its counts are the report's now,
            // not the one the band was drawn with.
            const fresh = document.createElement('div');
            fresh.innerHTML = this.renderLibraryHeaderActions();
            const items = fresh.querySelector('[data-bm-header-menu]');
            if (items) menu.innerHTML = items.innerHTML;
            menu.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            const away = (e) => {
                if (e.type === 'keydown') {
                    if (e.key !== 'Escape') return;
                    // Escape is the menu's alone while it is open.
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    this.closeLibraryHeaderMenu();
                    button.focus();
                } else if (!e.target.closest?.('.config-bm-header-more')) {
                    this.closeLibraryHeaderMenu();
                }
            };
            document.addEventListener('pointerdown', away, true);
            window.addEventListener('keydown', away, true);
            this._libHeaderMenuAway = away;
        },

        closeLibraryHeaderMenu() {
            document.querySelectorAll('[data-bm-header-menu]').forEach((m) => { m.hidden = true; });
            document.querySelectorAll('[data-bm-header-more]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
            if (this._libHeaderMenuAway) {
                document.removeEventListener('pointerdown', this._libHeaderMenuAway, true);
                window.removeEventListener('keydown', this._libHeaderMenuAway, true);
                this._libHeaderMenuAway = null;
            }
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
