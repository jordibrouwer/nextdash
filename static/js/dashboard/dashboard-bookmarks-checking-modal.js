/**
 * Turning checking on for the bookmarks nothing checks.
 *
 * A bookmark with checking off is only found broken when someone clicks it.
 * The toolbar counts them, and this modal puts them under checking in one go:
 * how often (Periodic or Monitor), which of them (all, the list as it stands,
 * or chosen pages), leaving out what the server cannot reach anyway -- home
 * network addresses -- and, if asked, checking them straight away instead of
 * waiting for the next sweep.
 *
 * The write is the bulk panel's own (mutateSelected with bulkMutation), so it
 * saves the same way and can be undone the same way.
 *
 * Loaded after the workbench, by ensureBookmarkRenderers.
 */
(function (global) {
    'use strict';
    if (typeof global.DashboardConfig !== 'function') return;

    const isOff = (b) => (global.CheckMode?.of?.(b) || 'off') === 'off';

    /**
     * Addresses on the reader's own network: private and link-local IPv4,
     * Tailscale's 100.64/10, and the names only a home network resolves. The
     * server often cannot see them the way a browser at home can, and checked
     * from there they would read as broken.
     */
    function isHomeAddress(url) {
        let host;
        try {
            host = new URL(String(url || '')).hostname.toLowerCase();
        } catch {
            return false;
        }
        if (!host) return false;
        if (host === 'localhost' || !host.includes('.')) return true;
        if (/\.(local|lan|home\.arpa|internal|ts\.net)$/.test(host)) return true;
        const ip = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
        if (!ip) return false;
        const [a, b] = [Number(ip[1]), Number(ip[2])];
        return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
            || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
    }

    Object.assign(global.DashboardConfig.prototype, {
        uncheckedBookmarks() {
            return (this.configBookmarkPool?.() || this.dash.allBookmarks || []).filter(isOff);
        },

        renderEnableCheckingButton() {
            // The Bookmarks view's: Config's toolbar shares its row with the
            // panel column and has no room left for it.
            if (!this.standalone) return '';
            const n = this.uncheckedBookmarks().length;
            if (!n) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            return `<button type="button" class="config-btn config-btn--small config-bm-enable-checking" data-bm-enable-checking
                        title="${esc(this.t('config.bmCheckingButtonTitle', 'Turn on checking for the bookmarks nothing checks'))}">${esc(
                this.t('config.bmCheckingButton', 'Check {n} unchecked…').replace('{n}', String(n)))}</button>`;
        },

        /** What the modal would act on, for its choices as they stand. */
        checkingTargets(state) {
            let list = state.scope === 'shown'
                ? (this.visibleBookmarks?.() || []).filter(isOff)
                : this.uncheckedBookmarks();
            if (state.scope === 'pages') list = list.filter((b) => state.pages.has(String(b.pageId)));
            if (state.excludeHome) list = list.filter((b) => !isHomeAddress(b.url));
            if (state.excludeNever) list = list.filter((b) => Number(b.openCount) > 0);
            return list;
        },

        openCheckingModal() {
            if (this._checkingOverlay?.isConnected) return;
            const all = this.uncheckedBookmarks();
            if (!all.length) return;
            const state = {
                mode: 'periodic',
                interval: global.CheckMode?.DEFAULT_INTERVAL_MINUTES || 15,
                scope: 'all',
                pages: new Set(all.map((b) => String(b.pageId))),
                excludeHome: true,
                excludeNever: false,
                checkNow: true,
            };
            this._checkingState = state;
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay config-checking-overlay show';
            overlay.setAttribute('data-checking-modal', '');
            document.body.appendChild(overlay);
            this._checkingOverlay = overlay;
            this.renderCheckingModal();

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay || e.target.closest('[data-checking-cancel]')) {
                    this.closeCheckingModal();
                    return;
                }
                const mode = e.target.closest('[data-checking-mode]');
                if (mode) {
                    state.mode = mode.getAttribute('data-checking-mode');
                    this.renderCheckingModal();
                    return;
                }
                if (e.target.closest('[data-checking-apply]')) void this.applyCheckingModal();
            });
            overlay.addEventListener('change', (e) => {
                const el = e.target;
                if (el.matches('[data-checking-scope]')) state.scope = el.getAttribute('data-checking-scope');
                else if (el.matches('[data-checking-page]')) {
                    const id = el.getAttribute('data-checking-page');
                    if (el.checked) state.pages.add(id);
                    else state.pages.delete(id);
                    state.scope = 'pages';
                } else if (el.matches('[data-checking-home]')) state.excludeHome = el.checked;
                else if (el.matches('[data-checking-never]')) state.excludeNever = el.checked;
                else if (el.matches('[data-checking-now]')) state.checkNow = el.checked;
                else if (el.matches('[data-checking-interval]')) state.interval = Number(el.value) || state.interval;
                this.renderCheckingModal();
            });
            this._checkingKeys = (e) => {
                if (e.key !== 'Escape' || !this._checkingOverlay?.isConnected) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                this.closeCheckingModal();
            };
            document.addEventListener('keydown', this._checkingKeys, true);
            requestAnimationFrame(() => overlay.querySelector('[data-checking-mode][aria-pressed="true"]')?.focus());
        },

        /** Redraw the modal's body from its state: every choice changes the count. */
        renderCheckingModal() {
            const overlay = this._checkingOverlay;
            const state = this._checkingState;
            if (!overlay || !state) return;
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(`config.${key}`, fallback);
            const all = this.uncheckedBookmarks();
            const shown = (this.visibleBookmarks?.() || []).filter(isOff).length;
            const home = all.filter((b) => isHomeAddress(b.url)).length;
            const never = all.filter((b) => !(Number(b.openCount) > 0)).length;
            const targets = this.checkingTargets(state);
            const focused = document.activeElement && overlay.contains(document.activeElement)
                ? document.activeElement.getAttribute('data-checking-mode') || document.activeElement.getAttribute('data-checking-scope')
                : null;

            const mode = (name, label, body) => `<button type="button" class="config-checking-mode${state.mode === name ? ' is-on' : ''}"
                    data-checking-mode="${name}" aria-pressed="${state.mode === name ? 'true' : 'false'}">
                    <b>${esc(label)}</b><span>${esc(body)}</span></button>`;
            const radio = (value, label) => `<label class="config-checking-opt">
                    <input type="radio" name="config-checking-scope" data-checking-scope="${value}"${state.scope === value ? ' checked' : ''}>
                    <span>${label}</span></label>`;
            const check = (attr, on, label) => `<label class="config-checking-opt">
                    <input type="checkbox" ${attr}${on ? ' checked' : ''}><span>${label}</span></label>`;
            const pages = (this.dash.pages || []).map((p) => {
                const n = all.filter((b) => String(b.pageId) === String(p.id)).length;
                if (!n) return '';
                return `<label class="config-checking-page"><input type="checkbox" data-checking-page="${esc(p.id)}"${
                    state.pages.has(String(p.id)) ? ' checked' : ''}> ${esc(p.name || p.id)} <span>${n}</span></label>`;
            }).join('');
            const intervals = global.CheckMode?.INTERVAL_CHOICES || [5, 15, 60, 360, 1440];
            const interval = state.mode === 'monitor' ? `<label class="config-checking-interval">${esc(t('bmFieldInterval', 'Interval'))}
                    <select class="config-select" data-checking-interval>${intervals.map((m) =>
                        `<option value="${m}"${Number(state.interval) === m ? ' selected' : ''}>${esc(global.CheckMode?.intervalLabel?.(m) || `${m} min`)}</option>`).join('')}</select></label>` : '';
            const summary = state.mode === 'monitor'
                ? t('bmCheckingSummaryMonitor', '{n} bookmarks will be monitored.')
                : t('bmCheckingSummaryPeriodic', '{n} bookmarks will be checked about once a day.');

            overlay.innerHTML = `
                <div class="modal config-checking-modal" role="dialog" aria-modal="true" aria-labelledby="config-checking-title">
                    <div class="modal-header config-structure-head">
                        <span class="modal-title" id="config-checking-title">${esc(t('bmCheckingTitle', 'Turn on checking'))}</span>
                        <button type="button" class="config-structure-close" data-checking-cancel aria-label="${esc(t('bmCloseDetails', 'Close'))}">×</button>
                    </div>
                    <p class="config-checking-lead">${esc(t('bmCheckingLead', '{n} bookmarks are not checked, so a broken one only shows up when it is clicked.').replace('{n}', String(all.length)))}</p>
                    <section><h3>${esc(t('bmCheckingHowOften', 'How often'))}</h3>
                        <div class="config-checking-modes">
                            ${mode('periodic', t('bmCheckingPeriodic', 'Periodic'), t('bmCheckingPeriodicBody', 'About once a day. Catches breakage and redirects. No uptime history. Light on the sites and on this server.'))}
                            ${mode('monitor', t('bmCheckingMonitor', 'Monitor'), t('bmCheckingMonitorBody', 'Every few minutes to once a day. Uptime, heartbeat and outage history, and alerts. Meant for your own services.'))}
                        </div>
                        ${interval}
                    </section>
                    <section><h3>${esc(t('bmCheckingWhich', 'Which bookmarks'))}</h3>
                        ${radio('all', esc(t('bmCheckingAll', 'All {n} unchecked').replace('{n}', String(all.length))))}
                        ${radio('shown', esc(t('bmCheckingShown', 'Only the {n} the list shows now').replace('{n}', String(shown))))}
                        ${radio('pages', esc(t('bmCheckingPages', 'Pick pages')))}
                        <div class="config-checking-pages">${pages}</div>
                        ${check('data-checking-home', state.excludeHome, `${esc(t('bmCheckingHome', 'Leave out addresses on your own network ({n})').replace('{n}', String(home)))}
                            <small>${esc(t('bmCheckingHomeHint', 'They are often only reachable from inside, and would show as broken from the server.'))}</small>`)}
                        ${check('data-checking-never', state.excludeNever, esc(t('bmCheckingNever', 'Leave out bookmarks never opened ({n})').replace('{n}', String(never))))}
                    </section>
                    <section><h3>${esc(t('bmCheckingNowTitle', 'Right away'))}</h3>
                        ${check('data-checking-now', state.checkNow, esc(t('bmCheckingNow', 'Check them now, instead of waiting for the next sweep')))}
                    </section>
                    <p class="config-checking-summary" data-checking-summary>${esc(summary.replace('{n}', String(targets.length)))}
                        ${esc(t('bmCheckingUndo', 'It can be undone right after, and turned off per bookmark in its panel.'))}</p>
                    <p class="config-checking-note">${esc(t('bmCheckingPrivacy', 'Checks go from this server to each site: the site sees a request from nextDash, not from your browser.'))}</p>
                    <div class="config-checking-foot">
                        <button type="button" class="config-btn config-btn--small" data-checking-cancel>${esc(t('cancel', 'Cancel'))}</button>
                        <button type="button" class="config-btn config-btn--primary config-btn--small" data-checking-apply${targets.length ? '' : ' disabled'}>${esc(
                            t('bmCheckingApply', 'Turn on checking for {n}').replace('{n}', String(targets.length)))}</button>
                    </div>
                </div>`;
            if (focused) overlay.querySelector(`[data-checking-mode="${focused}"], [data-checking-scope="${focused}"]`)?.focus();
        },

        closeCheckingModal() {
            if (this._checkingKeys) document.removeEventListener('keydown', this._checkingKeys, true);
            this._checkingKeys = null;
            this._checkingOverlay?.remove();
            this._checkingOverlay = null;
            this._checkingState = null;
        },

        async applyCheckingModal() {
            const state = this._checkingState;
            if (!state) return;
            const targets = this.checkingTargets(state);
            if (!targets.length) return;
            const assign = (b, mode) => global.CheckMode.assign(b, mode, mode === 'monitor' ? state.interval : undefined);
            const mutate = global.BookmarkWorkbenchModel.bulkMutation({ checkMode: state.mode }, assign);
            const checkNow = state.checkNow;
            this.closeCheckingModal();
            try {
                const snapshots = await this.mutateSelected(targets, mutate);
                this.notify(this.t('config.bmCheckingDone', 'Checking turned on for {n} bookmarks.').replace('{n}', String(targets.length)), 'success', {
                    undoCallback: this.bulkUndo(snapshots, 'config.bmBulkUndone', 'Changes put back.',
                        'config.bulkUndoFailed', 'Could not undo that.'),
                    duration: 8000,
                });
            } catch {
                this.notify(this.t('config.bulkActionError', 'Could not apply the bulk action.'), 'error');
                await this.refreshBookmarksAfterWrite?.();
                return;
            }
            if (this.isActiveView() && this.section === 'bookmarks') this.render();
            // Asked for now: the server runs the checks again rather than at
            // its next sweep, and the colours follow when the report lands.
            if (checkNow) void this.refreshBmHealth?.({ refresh: true });
        },
    });

    global.DashboardBookmarksCheckingModalReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
