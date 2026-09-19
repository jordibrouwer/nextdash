/**
 * Config → Logs: the server log and the activity trail.
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

    /*
     * The two channels the server records when nobody has chosen.
     *
     * Named here rather than written out at each use, because three places
     * depend on them agreeing: the checkboxes when the setting is empty, the
     * reset button, and the test that says what "default" means. The server
     * has the same pair in loadActivityLogConfig.
     */
    global.DashboardConfig.ACTIVITY_CHANNEL_DEFAULTS = ['mutate', 'status'];

    Object.assign(global.DashboardConfig.prototype, {


    /**
     * Its own top-level section now, a real tab strip: Server logs (the
     * viewer and its settings) and Activity trail (which channels are kept).
     * They used to be two panels stacked in one tab; two tabs keeps either
     * one from crowding the other.
     */
    renderLogsSection() {
        const esc = (v) => this.dash.escapeHtml(v);
        const tabs = DashboardConfig.LOGS_TABS.map((tab) => {
            const active = tab === this.logsTab;
            return `<button type="button" class="config-subtab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" aria-controls="config-logs-body" data-logs-tab="${esc(tab)}">${esc(this.logsTabLabel(tab))}</button>`;
        }).join('');
        return `
            <p class="config-view-intro">${esc(this.t('config.logsSectionIntro', 'What the server has been doing.'))}</p>
            <div class="config-subtabs" role="tablist">${tabs}</div>
            <div id="config-logs-body" role="tabpanel" tabindex="0">${this.renderLogsTab()}</div>
        `;
    },

    /** Which sub-tab of Logs is showing. */
    renderLogsTab() {
        if (this.logsTab === 'trail') {
            return this.renderActivityTrail();
        }
        return this.renderDataLogs();
    },

    /**
     * Activity trail: the three channel groups as cards side by side, with the
     * reset action once at the bottom rather than per card — resetting puts
     * every group back at once, so one button for all three is the honest
     * shape.
     */
    renderActivityTrail() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};

        const activeChannels = Array.isArray(s.activityChannels) && s.activityChannels.length
            ? s.activityChannels.map((c) => String(c).toLowerCase())
            : DashboardConfig.ACTIVITY_CHANNEL_DEFAULTS.slice();
        // Same rule the ↺ follows elsewhere in config: offered only when there
        // is something to undo, so it is not a permanent button that usually
        // does nothing.
        const channelsAtDefault = this.activityChannelsAreDefault(activeChannels);
        /*
         * Grouped by what each channel actually records, not alphabetically:
         * Changes is everything the server itself writes or does in the
         * background (mutations, imports, backups, health/security events —
         * whatever is not a thing the *person* did just now); Usage is the
         * person's own actions (opening a link, searching, a shortcut, nav,
         * loading the dashboard); Client is the one channel the browser
         * reports rather than the server.
         */
        const channelLabels = {
            mutate: this.t('config.logChannelMutate', 'Changes'),
            status: this.t('config.logChannelStatus', 'Check results'),
            security: this.t('config.logChannelSecurity', 'Refused access'),
            health: this.t('config.logChannelHealth', 'Health rounds'),
            sources: this.t('config.logChannelSources', 'Imports'),
            feeds: this.t('config.logChannelFeeds', 'Feed polls'),
            archive: this.t('config.logChannelArchive', 'Saved copies'),
            backup: this.t('config.logChannelBackup', 'Backups'),
            store: this.t('config.logChannelStore', 'Failed writes'),
            widgets: this.t('config.logChannelWidgets', 'Widget requests'),
            notify: this.t('config.logChannelNotify', 'Alerts sent'),
            open: this.t('config.logChannelOpen', 'Bookmarks opened'),
            search: this.t('config.logChannelSearch', 'Searches'),
            keys: this.t('config.logChannelKeys', 'Keyboard shortcuts'),
            nav: this.t('config.logChannelNav', 'Navigation'),
            session: this.t('config.logChannelSession', 'Dashboard loads'),
            clienterror: this.t('config.logChannelClientError', 'Browser errors'),
        };
        const channelBox = (key) => `
                    <label class="config-toggle">
                        <input type="checkbox" data-activity-channel="${esc(key)}" ${activeChannels.includes(key) ? 'checked' : ''}>
                        <span>${esc(channelLabels[key] || key)}</span>
                    </label>`;

        // A level inside the open channel, not a channel of its own: twelve
        // checkboxes is already near what a person will read, and this is a
        // question of how much one of them carries, not whether it fires.
        const openDetailLevel = ['off', 'basic', 'full'].includes(String(s.activityOpenDetail || '').toLowerCase())
            ? String(s.activityOpenDetail).toLowerCase()
            : 'basic';
        const openDetailOptions = [
            ['off', this.t('config.openDetailOff', 'Off — just the open')],
            ['basic', this.t('config.openDetailBasic', 'Basic — how it was opened')],
            ['full', this.t('config.openDetailFull', 'Full — plus result rank and timing')],
        ].map(([v, label]) => `<option value="${esc(v)}" ${v === openDetailLevel ? 'selected' : ''}>${esc(label)}</option>`).join('');
        // Sits right under the Bookmarks opened checkbox rather than after the
        // whole list: it only means anything in relation to that one channel.
        const openDetailField = `
                    <div class="config-field">
                        <span class="config-field-label">${esc(this.t('config.openDetailLabel', 'Open detail'))}</span>
                        <select class="config-select" data-activity-open-detail ${activeChannels.includes('open') ? '' : 'disabled'}>${openDetailOptions}</select>
                    </div>
                    <p class="config-panel-note">${esc(this.t('config.openDetailHint', 'How much an open record carries, once Bookmarks opened is on. Basic is the default: which surface and gesture opened it. Full adds where in the results it was and how long you waited.'))}</p>`;
        const changesBoxes = ['mutate', 'status', 'security', 'health', 'sources', 'feeds', 'archive', 'backup', 'store', 'widgets', 'notify']
            .map(channelBox).join('');
        const usageBoxes = ['open', 'search', 'keys', 'nav', 'session']
            .map((key) => channelBox(key) + (key === 'open' ? openDetailField : '')).join('');
        const clientBoxes = ['clienterror'].map(channelBox).join('');

        const resetButton = channelsAtDefault ? '' : `
                <button type="button" class="config-btn" data-activity-reset
                        title="${esc(this.t('config.logChannelsResetTitle', 'Record the two channels nextDash records by default'))}">${esc(this.t('config.panelResetAll', 'Reset panel'))}</button>`;

        return `
            <p class="config-view-intro">${esc(this.t('config.logChannelsHint', 'A machine-readable record of what happened, kept apart from the readable lines above. Pick what belongs in it.'))}</p>

            <div class="config-log-trail-grid">
                <div class="config-panel config-log-trail-card">
                    <h3 class="config-panel-title">${esc(this.t('config.logChannelGroupChanges', 'Changes'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.logChannelGroupChangesNote', 'What the server itself wrote or did in the background.'))}</p>
                    ${changesBoxes}
                </div>
                <div class="config-panel config-log-trail-card">
                    <h3 class="config-panel-title">${esc(this.t('config.logChannelGroupUsage', 'Usage'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.logChannelGroupUsageNote', 'What the person at the dashboard did.'))}</p>
                    ${usageBoxes}
                </div>
                <div class="config-panel config-log-trail-card">
                    <h3 class="config-panel-title">${esc(this.t('config.logChannelGroupClient', 'Client'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.logChannelGroupClientNote', 'What the browser itself reported.'))}</p>
                    ${clientBoxes}
                </div>
            </div>

            <div class="config-log-trail-footer" data-log-trail-footer>${resetButton}</div>
        `;
    },

    /*
     * Reset panel puts the trail back to the two channels nextDash records by
     * default. Bound separately from the rest of the panel because the button
     * comes and goes with the value, so a freshly inserted one has to be bound
     * again rather than relying on the panel's own one-time pass.
     */
    bindActivityResetButton(container) {
        const button = container.querySelector('[data-activity-reset]');
        if (!button || button.dataset.bound === '1') return;
        button.dataset.bound = '1';
        button.addEventListener('click', () => {
            this.dash.settings.activityChannels = DashboardConfig.ACTIVITY_CHANNEL_DEFAULTS.slice();
            void this.saveSettingsWithFeedback();
            // Twelve boxes change at once and the button itself goes away, so
            // the panel is rebuilt rather than patched. Nothing worth keeping
            // the focus on: the button the user clicked is what disappears.
            this.repaintDbTabBody();
        });
    },

    /*
     * Put Reset panel on screen, or take it away.
     *
     * The button exists only while the channels differ from the defaults, so
     * this adds and removes it rather than showing and hiding it. Done in place
     * so the checkbox the user just clicked keeps the focus — repainting the
     * whole tab body would take it away mid-click. Lives in the tab's footer
     * now that Activity trail is three cards rather than one panel with a
     * title to hang the button on.
     */
    syncActivityResetButton(container, channels) {
        const footer = container.querySelector('[data-log-trail-footer]');
        if (!footer) return;
        const existing = footer.querySelector('[data-activity-reset]');
        if (this.activityChannelsAreDefault(channels)) {
            existing?.remove();
            return;
        }
        if (existing) return;
        const esc = (v) => this.dash.escapeHtml(v);
        footer.insertAdjacentHTML('beforeend', `<button type="button"
                        class="config-btn" data-activity-reset
                        title="${esc(this.t('config.logChannelsResetTitle', 'Record the two channels nextDash records by default'))}">${esc(this.t('config.panelResetAll', 'Reset panel'))}</button>`);
        this.bindActivityResetButton(container);
    },

    /** Whether a channel list is the default pair, in any order. */
    activityChannelsAreDefault(channels) {
        const chosen = [...new Set((channels || []).map((c) => String(c).toLowerCase()))].sort();
        const defaults = [...DashboardConfig.ACTIVITY_CHANNEL_DEFAULTS].sort();
        return chosen.length === defaults.length && chosen.every((c, i) => c === defaults[i]);
    },

    /*
     * What the floor is, said under the display filter.
     *
     * The two controls are easy to confuse — one decides what exists, the other
     * decides what is shown — and someone who filtered for Everything and still
     * sees nothing has been given no way to tell which one is the reason.
     */
    /*
     * What the container log is doing right now, in the present tense.
     *
     * The setting acts on the next line written, with no restart, and that is
     * the thing readers do not expect from a log level — so it is said as a
     * fact about the running server rather than as a promise about the future.
     */
    serverLogLiveNote() {
        const level = String(this.dash.settings?.serverLogLevel || 'info');
        if (level === 'debug') {
            return this.t('config.logDetailLiveVerbose',
                'docker logs is now showing every step, from the next line onwards.');
        }
        if (level === 'warn' || level === 'error') {
            return this.t('config.logDetailLiveQuiet',
                'docker logs is now showing problems only, from the next line onwards.');
        }
        return this.t('config.logDetailLiveNormal',
            'docker logs is now showing what the server does, from the next line onwards.');
    },

    serverLogFloorNote() {
        const level = String(this.dash.settings?.serverLogLevel || 'info');
        if (level === 'debug') {
            return this.t('config.logFloorVerbose', 'Recording at Verbose — every step is kept.');
        }
        if (level === 'warn' || level === 'error') {
            return this.t('config.logFloorQuiet', 'Recording at Quiet — only problems are kept, so this list will be short.');
        }
        return this.t('config.logFloorNormal', 'Recording at Normal — debug lines are not kept.');
    },

    /** Summary tiles above the log, in the same shape the other tabs use. */
    renderServerLogTiles() {
        const stats = this._logStats || { total: 0, warn: 0, error: 0 };
        const dropped = this._logDropped || 0;
        const retention = Number(this.dash.settings?.serverLogRetentionHours) || 0;

        return [
            {
                label: this.t('config.logTileLines', 'Lines'),
                value: stats.total,
                tone: 'accent',
                detail: dropped > 0
                    ? this.t('config.logTileDropped', '{n} older lines dropped').replace('{n}', String(dropped))
                    : (this.dash.settings?.serverLogRetentionMode === 'count'
                        ? this.t('config.logTileMaxEntries', 'Newest {n} kept')
                            .replace('{n}', Number(this.dash.settings?.serverLogMaxEntries
                                || DashboardConfig.SERVER_LOG_DEFAULT_MAX_ENTRIES).toLocaleString())
                        : this.t('config.logTileRetention', 'Kept for {span}').replace('{span}', this.logRetentionLabel(retention))),
            },
            {
                label: this.t('config.logTileWarnings', 'Warnings'),
                value: stats.warn,
                tone: stats.warn > 0 ? 'warn' : 'neutral',
            },
            {
                label: this.t('config.logTileErrors', 'Errors'),
                value: stats.error,
                tone: stats.error > 0 ? 'crit' : 'good',
            },
        ].map((t) => this.renderTile(t)).join('');
    },

    /** Human span for the retention tile. */
    logRetentionLabel(hours) {
        if (!hours) return this.t('config.logRetentionForever', 'Until cleared');
        if (hours % 24 === 0) {
            const days = hours / 24;
            return days === 1
                ? this.t('config.logRetention24h', '24 hours')
                : this.t('config.logRetentionDays', '{n} days').replace('{n}', String(days));
        }
        return hours === 1
            ? this.t('config.logRetention1h', '1 hour')
            : this.t('config.logRetentionHours', '{n} hours').replace('{n}', String(hours));
    },

    /** The log lines themselves. */
    renderServerLogLines() {
        const esc = (v) => this.dash.escapeHtml(v);
        const lines = this._logLines || [];

        if (this._logLoading && lines.length === 0) {
            return `<p class="config-view-loading">${esc(this.t('config.logLoading', 'Loading…'))}</p>`;
        }
        if (lines.length === 0) {
            // "Nothing logged yet" would read as a fault when the reason is
            // simply that collecting is switched off.
            const empty = this.dash.settings?.serverLogEnabled === false
                ? this.t('config.logEmptyStopped', 'Not collecting. Switch on Collect server log above to start.')
                : this.t('config.logEmpty', 'Nothing logged yet.');
            return `<p class="config-panel-empty">${esc(empty)}</p>`;
        }

        return lines.map((line) => {
            const time = line.time ? this.formatLogTime(line.time) : '';
            const source = line.source
                ? `<span class="config-log-source">${esc(line.source)}</span>`
                : '';
            return `<div class="config-log-line config-log-line--${esc(line.level || 'info')}">`
                + `<span class="config-log-time">${esc(time)}</span>`
                + source
                + `<span class="config-log-message">${esc(line.message)}</span>`
                + `</div>`;
        }).join('');
    },

    /**
     * The gear at the end of the Server logs toolbar: a small popover holding
     * the settings that used to be their own panel. Wears the app's one menu
     * surface (.move-popover) rather than a new one, and follows the same
     * contract every popover in config keeps — Escape and an outside click
     * both close it, and closing returns focus to the button that opened it.
     *
     * Escape itself is handled by setupEscapeShortcut() above, not a listener
     * here: that handler is on document in the capture phase and registers
     * long before this popover ever opens, so a listener added here would
     * never see the key first — the same reasoning as the theme picker and
     * the bookmark row menu, which take Escape the same explicit way.
     */
    bindLogSettingsPopover(container) {
        const toggle = container.querySelector('[data-log-settings-toggle]');
        const pop = container.querySelector('#config-log-settings-popover');
        if (!toggle || !pop || toggle.dataset.bound === '1') return;
        toggle.dataset.bound = '1';

        /*
         * Under the gear, right edges lined up, and inside the window.
         *
         * The popover is position: fixed, but it lives inside the config
         * panel, and a panel drawn with depth or glass carries a transform or
         * a backdrop-filter -- which makes it, not the window, what "fixed"
         * is measured from. Coordinates taken from getBoundingClientRect()
         * then landed shifted by wherever that panel sits: far below and to
         * the right of the gear, and past the window's edge. So the offset of
         * that frame is measured first and taken off.
         *
         * Below the gear when it fits, above when that fits, otherwise wherever
         * the whole of it is on screen. Left is clamped to the window either
         * way. It only scrolls when it is taller than the window itself.
         */
        const MARGIN = 8;
        const GAP = 6;
        const position = () => {
            const rect = toggle.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            pop.style.maxHeight = '';
            pop.style.overflowY = '';
            const popW = Math.min(pop.offsetWidth || 280, vw - MARGIN * 2);
            let popH = pop.offsetHeight || 200;

            // The sticky header band covers the top of the window, so what is
            // under it is not on screen: the popover's ceiling is the band's
            // bottom edge, not the window's.
            const band = document.querySelector('.config-view-head.lvs-header, .lvs-header');
            const bandBottom = band ? band.getBoundingClientRect().bottom : 0;
            const ceiling = Math.max(MARGIN, bandBottom + GAP);

            const below = vh - rect.bottom - GAP - MARGIN;
            const above = rect.top - GAP - ceiling;
            let top;
            if (popH <= below) {
                top = rect.bottom + GAP;
            } else if (popH <= above) {
                top = rect.top - GAP - popH;
            } else if (popH <= vh - MARGIN - ceiling) {
                // Fits under the band but not on either side of the gear: the
                // whole popover on screen beats keeping the gear uncovered.
                top = vh - popH - MARGIN;
            } else if (popH <= vh - MARGIN * 2) {
                // Only fits by reaching over the band. It draws above it
                // (config-view.css lifts the panel while it is open).
                top = vh - popH - MARGIN;
            } else {
                // Taller than the window itself -- only on a very small
                // screen. The one case left that has to scroll.
                popH = vh - MARGIN * 2;
                pop.style.maxHeight = `${Math.round(popH)}px`;
                pop.style.overflowY = 'auto';
                top = MARGIN;
            }
            top = Math.max(popH <= vh - MARGIN - ceiling ? ceiling : MARGIN, Math.min(top, vh - popH - MARGIN));
            const left = Math.max(MARGIN, Math.min(rect.right - popW, vw - popW - MARGIN));

            // Where "fixed 0,0" really is: a zero-size probe beside the
            // popover shares its containing block. Measured on the probe
            // rather than the popover, whose opening animation scales it and
            // would skew the reading by a few percent of its width.
            const probe = document.createElement('div');
            probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none';
            pop.parentNode.insertBefore(probe, pop);
            const origin = probe.getBoundingClientRect();
            probe.remove();
            pop.style.left = `${Math.round(left - origin.left)}px`;
            pop.style.top = `${Math.round(top - origin.top)}px`;
        };

        let onOutside = null;
        /*
         * Placed again whenever its own size changes: the live note under the
         * detail level fills in after the popover opens, and a popover set
         * above the gear from its first height then floated clear of it.
         */
        const resizeWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
            if (!pop.hidden) position();
        }) : null;
        const close = () => {
            if (pop.hidden) return;
            pop.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
            document.removeEventListener('click', onOutside, true);
            window.removeEventListener('resize', position);
            window.removeEventListener('scroll', position, true);
            resizeWatch?.disconnect();
            if (this._logSettingsPopoverClose === close) this._logSettingsPopoverClose = null;
            toggle.focus({ preventScroll: true });
        };
        /*
         * Room under the gear before anything else.
         *
         * When the popover fits neither under nor over the gear, the page is
         * scrolled just far enough for it to fit under -- the log below the
         * toolbar is long, so there nearly always is room. Only when the page
         * cannot scroll that far does the popover fall back to wherever it is
         * wholly on screen.
         */
        const makeRoom = () => {
            const rect = toggle.getBoundingClientRect();
            const popH = pop.offsetHeight;
            const vh = window.innerHeight;
            const below = vh - rect.bottom - GAP - MARGIN;
            if (popH <= below) return;
            const band = document.querySelector('.config-view-head.lvs-header, .lvs-header');
            const ceiling = Math.max(MARGIN, (band ? band.getBoundingClientRect().bottom : 0) + GAP);
            if (popH <= rect.top - GAP - ceiling) return;
            const need = popH - below;
            const room = document.documentElement.scrollHeight - vh - window.scrollY;
            // Not so far that the gear itself goes under the band.
            const limit = rect.top - ceiling;
            if (room >= need && limit >= need) window.scrollBy({ top: need, behavior: 'instant' });
        };
        const open = () => {
            pop.hidden = false;
            toggle.setAttribute('aria-expanded', 'true');
            makeRoom();
            position();
            onOutside = (e) => {
                if (pop.contains(e.target) || toggle.contains(e.target)) return;
                close();
            };
            // Bound on the next tick, or the very click that opens the popover
            // closes it again.
            setTimeout(() => document.addEventListener('click', onOutside, true), 0);
            window.addEventListener('resize', position);
            window.addEventListener('scroll', position, true);
            resizeWatch?.observe(pop);
            this._logSettingsPopoverClose = close;
        };

        toggle.addEventListener('click', () => {
            if (pop.hidden) open(); else close();
        });
    },

    /** Wire the Activity trail tab: the three channel cards and the reset. */
    bindActivityTrailControls(container) {
        container.querySelectorAll('[data-activity-channel]').forEach((box) => {
            box.addEventListener('change', () => {
                const chosen = Array.from(container.querySelectorAll('[data-activity-channel]'))
                    .filter((input) => input.checked)
                    .map((input) => input.dataset.activityChannel);
                /*
                 * An empty list would mean "the environment decides" to the
                 * server, which is not what unticking everything looks like it
                 * means. 'none' is a channel nothing writes to, so it records
                 * the choice as made.
                 */
                this.dash.settings.activityChannels = chosen.length ? chosen : ['none'];
                void this.saveSettingsWithFeedback();
                // Reset appears the moment the list leaves the defaults and
                // goes again when it returns. Rebuilt rather than toggled,
                // because the button is only in the DOM when it has something
                // to do — the same rule the other panels follow.
                this.syncActivityResetButton(container, chosen);
                // The level only means anything once opens are actually being
                // recorded, so it stays greyed out until that box is ticked —
                // it is not cleared, so the choice is still there if Open goes
                // back on.
                const openDetailSelect = container.querySelector('[data-activity-open-detail]');
                if (openDetailSelect) openDetailSelect.disabled = !chosen.includes('open');
            });
        });

        this.bindActivityResetButton(container);

        const openDetailSelect = container.querySelector('[data-activity-open-detail]');
        if (openDetailSelect) {
            openDetailSelect.addEventListener('change', () => {
                this.dash.settings.activityOpenDetail = openDetailSelect.value;
                void this.saveSettingsWithFeedback();
            });
        }
    }

    });

    global.DashboardConfigLogsReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
