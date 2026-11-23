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

    /**
     * Fallback for the count-mode log cap when settings have not been read yet.
     *
     * Must stay equal to serverLogDefaultMaxEntries in log_buffer.go: this is
     * the number the panel and the tile show, and a value the server would not
     * apply makes the log look like it keeps more than it does.
     */
    global.DashboardConfig.SERVER_LOG_DEFAULT_MAX_ENTRIES = 1000;

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

    /**
     * Recording with the refresh off is the one combination that looks broken:
     * the server is collecting, the view is not asking for it, and nothing
     * arrives until Refresh is pressed. Say so, and say where the setting is.
     */
    serverLogManualNote() {
        return this.t('config.logManualRefreshNote',
            'Recording, but this view does not update by itself. Press ↻ for the newest lines, or pick an interval under Refresh in ⚙ Log settings to have them appear on their own.');
    },

    /** Show that note only while recording with no interval armed. */
    syncServerLogRefreshNote() {
        const note = document.querySelector('[data-log-refresh-note]');
        if (!note) return;
        note.hidden = !(this.dash.settings?.serverLogEnabled === true && !this.logRefreshSeconds);
    },

    /** Summary tiles above the log, in the same shape the other tabs use. */
    renderServerLogTiles() {
        const stats = this._logStats || { total: 0, warn: 0, error: 0 };
        const dropped = this._logDropped || 0;
        const retention = Number(this.dash.settings?.serverLogRetentionHours) || 0;

        // Three zeros say nothing a line of text below does not: the tiles
        // come with the first line.
        if (!stats.total && !stats.warn && !stats.error) return '';

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
                ? this.t('config.logEmptyStopped', 'Not collecting. Switch on Record server log above to start.')
                : this.t('config.logEmpty', 'Nothing logged yet.');
            return `<p class="config-panel-empty">${esc(empty)}</p>`;
        }

        return lines.map((line, i) => {
            const time = line.time ? this.formatLogTime(line.time) : '';
            const source = line.source
                ? `<span class="config-log-source">${esc(line.source)}</span>`
                : '';
            // The server's own sequence, not a count of what is on screen: a
            // filter hides lines without renumbering the ones it keeps, so the
            // number beside a line is the same number in the file, in a copy,
            // and in what someone reads back to you over the phone.
            const seq = Number.isFinite(line.seq) ? line.seq + 1 : i + 1;
            return `<div class="config-log-line config-log-line--${esc(line.level || 'info')}">`
                + `<span class="config-log-seq">${esc(String(seq))}</span>`
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
    },

    /** Wire the Logs section's strip and hand the rest to whichever tab is up. */
    bindLogsActions(container) {
        this.bindSubTabStrip(container, 'data-logs-tab', (tab) => {
            if (tab === this.logsTab) return;
            // Leaving Server logs must take its timer with it, same as every
            // other polling view in config.
            if (this.logsTab === 'server') this.stopServerLogTimer();
            this.logsTab = tab;
            this.restoreConfigHash();
            const body = document.getElementById('config-logs-body');
            if (body) {
                body.innerHTML = this.renderLogsTab();
                this.bindLogsTabContent(body);
            }
            this.syncSubTabStrip('data-logs-tab', this.logsTab);
        });
        this.bindLogsTabContent(container);
    },

    /** The binding half of renderLogsTab(): whichever of the two tabs is up. */
    bindLogsTabContent(container) {
        // Every call means a fresh #config-log-settings-popover just landed in
        // the DOM (hidden), so any older popover's close() is stale — holding
        // onto it would make Escape try to act on a detached element instead
        // of closing config.
        this._logSettingsPopoverClose = null;
        if (this.logsTab === 'trail') {
            this.bindActivityTrailControls(container);
            return;
        }
        this.bindServerLogControls(container);
        this.bindLogSettingsPopover(container);
        void this.loadServerLog({ reset: true });
        this.updateServerLogTimer();
    },

    /** Wire the log tab's controls. Called with the freshly rendered body. */
    bindServerLogControls(container) {
        const selects = container.querySelectorAll('[data-log-select]');
        selects.forEach((sel) => {
            sel.addEventListener('change', () => {
                const kind = sel.getAttribute('data-log-select');
                const value = sel.value;
                if (kind === 'interval') {
                    this.logRefreshSeconds = Number(value) || 0;
                    this.syncServerLogRefreshNote();
                    this.updateServerLogTimer();
                    return;
                }
                if (kind === 'retention') {
                    this.dash.settings.serverLogRetentionHours = Number(value) || 0;
                    // The server prunes on save, so pull a fresh window rather
                    // than leaving expired lines on screen -- after the save,
                    // or the read comes back before the prune.
                    void this.saveSettingsWithFeedback().then(() => this.loadServerLog({ reset: true }));
                    return;
                }
                if (kind === 'maxEntries') {
                    this.dash.settings.serverLogMaxEntries = Number(value)
                        || DashboardConfig.SERVER_LOG_DEFAULT_MAX_ENTRIES;
                    void this.saveSettingsWithFeedback().then(() => this.loadServerLog({ reset: true }));
                    return;
                }
                if (kind === 'mode') {
                    this.dash.settings.serverLogRetentionMode = value === 'count' ? 'count' : 'time';
                    void this.saveSettingsWithFeedback();
                    // Which control is live, and the hint under them, both follow
                    // the mode — so the panel is rebuilt rather than left showing
                    // the other mode's state. The rebuild re-binds, which reloads
                    // the lines and re-arms the interval on its own.
                    this.repaintDbTabBody();
                    return;
                }
                if (kind === 'detail') {
                    this.dash.settings.serverLogLevel = value;
                    void this.saveSettingsWithFeedback();
                    // The note under the display filter reads the floor, so it
                    // is the one thing that has to follow. Updated in place
                    // rather than repainted, to keep the focus on the select.
                    const floorNote = container.querySelector('[data-log-floor-note]');
                    if (floorNote) floorNote.textContent = this.serverLogFloorNote();
                    // Says what docker logs is doing differently as of now.
                    // The point of this control is that it acts at once, and a
                    // line that changes under your hand shows that better than
                    // a sentence promising it.
                    const liveNote = container.querySelector('[data-log-detail-live]');
                    if (liveNote) liveNote.textContent = this.serverLogLiveNote();
                    return;
                }
                if (kind === 'level') {
                    this.logLevelFilter = value;
                    // Toggled rather than repainted: rebuilding the panel to
                    // show one line of explanation would take the focus off the
                    // select the user just used.
                    const note = container.querySelector('[data-log-activity-note]');
                    if (note) note.hidden = value !== 'activity';
                    void this.loadServerLog({ reset: true });
                }
            });
        });

        const search = container.querySelector('[data-log-search]');
        if (search) {
            let debounce = null;
            search.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(() => {
                    this.logQuery = search.value.trim();
                    void this.loadServerLog({ reset: true });
                }, 250);
            });
        }

        const follow = container.querySelector('[data-log-toggle="follow"]');
        if (follow) {
            follow.addEventListener('change', () => {
                this.logFollow = follow.checked;
                if (this.logFollow) {
                    const out = document.querySelector('[data-log-output]');
                    if (out) out.scrollTop = out.scrollHeight;
                }
            });
        }

        const capture = container.querySelector('[data-log-toggle="capture"]');
        if (capture) {
            capture.addEventListener('click', () => {
                const on = capture.getAttribute('aria-pressed') !== 'true';
                capture.setAttribute('aria-pressed', on ? 'true' : 'false');
                capture.classList.toggle('is-active', on);
                this.dash.settings.serverLogEnabled = on;
                void this.saveSettingsWithFeedback();
                this.notify(on
                    ? this.t('config.logCaptureStarted', 'Collecting the server log.')
                    : this.t('config.logCaptureStopped', 'Stopped collecting the server log.'), 'success');
                // Turning it on should show something without waiting for the
                // interval; turning it off should stop the polling that would
                // now return nothing new.
                this.syncServerLogRefreshNote();
                if (on) {
                    void this.loadServerLog({ reset: true });
                } else {
                    this.stopServerLogTimer();
                    const sel = container.querySelector('[data-log-select="interval"]');
                    if (sel) sel.value = '0';
                    this.logRefreshSeconds = 0;
                    this.syncServerLogRefreshNote();
                    // The empty state reads differently when collecting is off,
                    // and it is chosen at paint time — so repaint now rather
                    // than leaving the wrong message until the tab is reopened.
                    this.repaintServerLog();
                }
            });
        }

        container.querySelectorAll('[data-log-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                void this.handleServerLogAction(btn.getAttribute('data-log-action'));
            });
        });
    },

    /** Clock time for a log line, on the reader's own clock like every other. */
    formatLogTime(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return window.NextDashClock.formatTime(d, this.dash.settings, { seconds: true });
    },

    async handleServerLogAction(action) {
        switch (action) {
            case 'refresh':
                await this.loadServerLog({ reset: true });
                break;
            case 'copy': {
                const text = (this._logLines || [])
                    .map((l) => [l.time, l.level, l.source, l.message].filter(Boolean).join(' '))
                    .join('\n');
                try {
                    await navigator.clipboard.writeText(text);
                    this.notify(this.t('config.logCopied', 'Log copied.'), 'success');
                } catch {
                    this.notify(this.t('config.logCopyFailed', 'Could not copy the log.'), 'error');
                }
                break;
            }
            case 'download': {
                // A navigation cannot carry the write token, and the route
                // wants it: with one set, the whole view became "Unauthorized".
                const stamp = new Date().toISOString().replace(/\..+/, '').replace(/[:T]/g, '-');
                void this.downloadViaBlob('/api/logs/download', `nextdash-server-${stamp}.log`,
                    'config.logDownloadFailed', 'Could not download the log.');
                break;
            }
            case 'clear': {
                const ok = await this.confirmAction(
                    this.t('config.logClearConfirm', 'Delete every stored log line? The file on disk goes too, and this cannot be undone.'),
                    { confirmLabel: this.t('config.logClearOk', 'Clear log') }
                );
                if (!ok) break;
                try {
                    const res = await this.writeFetch('/api/logs', { method: 'DELETE' });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    this.notify(this.t('config.logCleared', 'Log cleared.'), 'success');
                } catch {
                    this.notify(this.t('config.logClearFailed', 'Could not clear the log.'), 'error');
                }
                // Either way, resync: the sequence numbers restart from the
                // server's side of the clear.
                await this.loadServerLog({ reset: true });
                break;
            }
            default:
                break;
        }
    },

    /**
     * Fetch log lines.
     *
     * `reset` asks for the whole window again — needed whenever the filter
     * changes, since lines already skipped by the server would otherwise never
     * be requested. A plain poll passes the highest sequence seen instead, so
     * a 2s interval costs one small empty response when nothing happens.
     */
    async loadServerLog({ reset = false } = {}) {
        // A poll while one is on its way would ask from the same position and
        // append the same lines twice; a reset goes ahead and outranks it.
        if (!reset && this._logLoading) return;
        if (reset) {
            this._logSince = -1;
            this._logLines = [];
        }
        this._logLoading = true;
        // Only the newest request's answer counts: one that lands after a
        // filter change was read under the old filter, from an old position.
        const request = (this._logRequest = (this._logRequest || 0) + 1);
        const stale = () => request !== this._logRequest;

        const params = new URLSearchParams();
        if (this._logSince >= 0) params.set('since', String(this._logSince));
        if (this.logLevelFilter) params.set('level', this.logLevelFilter);
        if (this.logQuery) params.set('q', this.logQuery);

        try {
            const res = await this.writeFetch(`/api/logs?${params.toString()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (stale()) return;

            // A clear (in any tab) or a restart starts a new run of sequence
            // numbers, which the numbers alone cannot show: cleared lines
            // stayed here, and lines replayed at boot came in twice.
            if (data.epoch && this._logEpoch && data.epoch !== this._logEpoch) {
                this._logEpoch = data.epoch;
                return await this.loadServerLog({ reset: true });
            }
            if (data.epoch) this._logEpoch = data.epoch;

            const incoming = Array.isArray(data.entries) ? data.entries : [];
            this._logLines = this._logLines.concat(incoming);
            // The buffer is capped server-side; keeping the same cap here stops
            // a long-running tab from growing without bound.
            const cap = Number(data.capacity) || 2000;
            if (this._logLines.length > cap) {
                this._logLines = this._logLines.slice(-cap);
            }
            // A clear from another tab restarts the server's numbering below
            // where we were, which would leave this view polling for sequences
            // that will never come. Detect the rewind and drop what we hold, so
            // the next poll asks for the whole window again.
            const nextSeq = Number.isFinite(data.nextSeq) ? data.nextSeq : null;
            if (nextSeq !== null && nextSeq - 1 < this._logSince) {
                this._logSince = -1;
                this._logLines = [];
            } else if (nextSeq !== null) {
                this._logSince = nextSeq - 1;
            }
            this._logStats = data.stats || null;
            this._logDropped = Number(data.dropped) || 0;
        } catch (err) {
            if (stale()) return;
            this.notify(this.t('config.logLoadFailed', 'Could not read the server log.'), 'error');
        } finally {
            if (!stale()) this._logLoading = false;
        }
        this.repaintServerLog();
    },

    /**
     * What the server is doing, without shell access to the container.
     *
     * Only the shell renders here; the lines themselves are painted by
     * repaintServerLog() so a refresh does not rebuild the controls under the
     * user's cursor (and does not lose focus in the search box).
     */
    renderDataLogs() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};

        const intervalOptions = [
            [0, this.t('config.logIntervalOff', 'Off')],
            [2, this.t('config.logInterval2s', 'Every 2 seconds')],
            [5, this.t('config.logInterval5s', 'Every 5 seconds')],
            [15, this.t('config.logInterval15s', 'Every 15 seconds')],
            [30, this.t('config.logInterval30s', 'Every 30 seconds')],
        ].map(([v, label]) => `<option value="${v}" ${v === this.logRefreshSeconds ? 'selected' : ''}>${esc(label)}</option>`).join('');

        // Exactly one cap applies. The other control stays visible but disabled,
        // so it is clear the choice exists and equally clear it is not in force.
        const byCount = s.serverLogRetentionMode === 'count';

        const retention = Number(s.serverLogRetentionHours) || 0;
        const retentionOptions = [
            [1, this.t('config.logRetention1h', '1 hour')],
            [2, this.t('config.logRetention2h', '2 hours')],
            [4, this.t('config.logRetention4h', '4 hours')],
            [12, this.t('config.logRetention12h', '12 hours')],
            [24, this.t('config.logRetention24h', '24 hours')],
            [168, this.t('config.logRetention7d', '7 days')],
            [720, this.t('config.logRetention30d', '30 days')],
            [0, this.t('config.logRetentionForever', 'Until cleared')],
        ].map(([v, label]) => `<option value="${v}" ${v === retention ? 'selected' : ''}>${esc(label)}</option>`).join('');

        const maxEntries = Number(s.serverLogMaxEntries) || DashboardConfig.SERVER_LOG_DEFAULT_MAX_ENTRIES;
        const entryOptions = [100, 500, 1000, 2500, 5000]
            .map((v) => `<option value="${v}" ${v === maxEntries ? 'selected' : ''}>`
                + `${esc(this.t('config.logMaxEntriesValue', '{n} entries').replace('{n}', v.toLocaleString()))}</option>`)
            .join('');

        const modeOptions = [
            ['time', this.t('config.logRetentionModeTime', 'By age')],
            ['count', this.t('config.logRetentionModeCount', 'By number of entries')],
        ].map(([v, label]) => `<option value="${esc(v)}" ${(v === 'count') === byCount ? 'selected' : ''}>${esc(label)}</option>`).join('');

        /*
         * The detail level and the display filter are different questions, and
         * conflating them is how "why do I see nothing" got two possible
         * answers. This one decides what the server records at all; the filter
         * below only searches what was recorded.
         */
        const detail = String(s.serverLogLevel || 'info');
        const detailOptions = [
            ['warn', this.t('config.logDetailQuiet', 'Quiet — problems only')],
            ['info', this.t('config.logDetailNormal', 'Normal — what the server did')],
            ['debug', this.t('config.logDetailVerbose', 'Verbose — every step')],
        ].map(([v, label]) => `<option value="${esc(v)}" ${v === detail ? 'selected' : ''}>${esc(label)}</option>`).join('');

        const levelOptions = [
            ['', this.t('config.logLevelAll', 'Everything')],
            ['warn', this.t('config.logLevelWarn', 'Warnings & errors')],
            ['error', this.t('config.logLevelError', 'Errors only')],
            // Not a severity: activity lines are what someone did — a bookmark
            // saved, a page added — and they have always been in here, mixed
            // in with the requests. Finding them meant knowing to type
            // "activity" into the search box.
            ['activity', this.t('config.logLevelActivity', 'Activity only')],
        ].map(([v, label]) => `<option value="${esc(v)}" ${v === this.logLevelFilter ? 'selected' : ''}>${esc(label)}</option>`).join('');

        /*
         * Recording sits in the toolbar, not behind the gear. It decides
         * whether anything below exists at all — the empty state tells you to
         * switch it on — so the switch belongs where you are already looking.
         * Everything behind the gear is a preference about a log that is
         * already being written.
         */
        return `
            <p class="config-view-intro">${esc(this.t('config.logsIntro', 'What the server has been doing. Lines are kept in memory and in a rotating file, and mirrored to the container log as before.'))}</p>

            <div class="config-tiles" role="list" id="config-log-tiles">${this.renderServerLogTiles()}</div>

            <div class="config-panel config-log-main">
                <h3 class="config-panel-title">${esc(this.t('config.logsPanelTitle', 'Server log'))}</h3>

                <div class="config-log-toolbar">
                    <label class="config-log-toolbar-item">
                        <span class="config-field-label">${esc(this.t('config.logLevelLabel', 'Show'))}</span>
                        <select class="config-select" data-log-select="level">${levelOptions}</select>
                    </label>
                    <label class="config-log-toolbar-item config-log-toolbar-search">
                        <span class="config-field-label sr-only">${esc(this.t('config.logSearchLabel', 'Search'))}</span>
                        <input type="search" class="config-text" data-log-search
                            placeholder="${esc(this.t('config.logSearchPlaceholder', 'Filter lines…'))}"
                            value="${esc(this.logQuery || '')}">
                    </label>
                    <label class="config-toggle config-log-toolbar-item">
                        <input type="checkbox" data-log-toggle="follow" ${this.logFollow ? 'checked' : ''}>
                        <span>${esc(this.t('config.logFollowLabel', 'Follow'))}</span>
                    </label>
                    <div class="config-log-toolbar-actions">
                        <button type="button" class="config-btn config-log-record${s.serverLogEnabled ? ' is-active' : ''}"
                                data-log-toggle="capture" aria-pressed="${s.serverLogEnabled ? 'true' : 'false'}"
                                aria-label="${esc(this.t('config.logRecordLabel', 'Record server log'))}"
                                title="${esc(this.t('config.logCaptureHint', 'Off by default. While this is off nothing is collected and the log costs nothing; what has already been collected is kept.'))}">${esc(this.t('config.logRecordLabel', 'Record server log'))}</button>
                        <button type="button" class="config-btn config-icon-btn" data-log-action="refresh"
                                title="${esc(this.t('config.logRefreshNow', 'Refresh now'))}" aria-label="${esc(this.t('config.logRefreshNow', 'Refresh now'))}">↻</button>
                        <button type="button" class="config-btn" data-log-action="copy">${esc(this.t('config.logCopy', 'Copy'))}</button>
                        <button type="button" class="config-btn" data-log-action="download">${esc(this.t('config.logDownload', 'Download'))}</button>
                        <button type="button" class="config-btn config-btn--danger" data-log-action="clear">${esc(this.t('config.logClear', 'Clear'))}</button>
                        <button type="button" class="config-btn config-icon-btn" data-log-settings-toggle
                                aria-haspopup="true" aria-expanded="false" aria-controls="config-log-settings-popover"
                                title="${esc(this.t('config.logsSettingsTitle', 'Log settings'))}"
                                aria-label="${esc(this.t('config.logsSettingsTitle', 'Log settings'))}">⚙</button>
                    </div>
                </div>

                <p class="config-panel-note" data-log-floor-note>${esc(this.serverLogFloorNote())}</p>
                <p class="config-panel-note config-log-manual-note" data-log-refresh-note
                   ${s.serverLogEnabled && !this.logRefreshSeconds ? '' : 'hidden'}>${esc(this.serverLogManualNote())}</p>
                <p class="config-panel-note" data-log-activity-note ${this.logLevelFilter === 'activity' ? '' : 'hidden'}>${esc(this.t('config.logActivityHint',
                    'What was done — bookmarks saved, pages added, checks run — mixed into the same log as the requests. Pick Activity only to read just those, or turn categories on and off with NEXTDASH_ACTIVITY_LOG.'))}</p>

                <div class="config-log-view" data-log-output>${this.renderServerLogLines()}</div>

                <div class="move-popover config-log-settings-popover" id="config-log-settings-popover"
                     role="dialog" aria-label="${esc(this.t('config.logsSettingsTitle', 'Log settings'))}" hidden>
                    <h4 class="move-popover-header">${esc(this.t('config.logsSettingsTitle', 'Log settings'))}</h4>
                    <div class="config-log-settings-body">
                        <div class="config-log-settings-col">
                        <div class="config-field">
                            <span class="config-field-label">${esc(this.t('config.logRefreshLabel', 'Refresh'))}</span>
                            <select class="config-select" data-log-select="interval">${intervalOptions}</select>
                        </div>
                        <div class="config-field">
                            <span class="config-field-label">${esc(this.t('config.logDetailLabel', 'Detail level'))}</span>
                            <select class="config-select" data-log-select="detail">${detailOptions}</select>
                        </div>
                        <p class="config-panel-note">${esc(this.t('config.logDetailHint', 'What the server writes at all — to this log and to the container log (docker logs). Takes effect immediately, on the very next line: no restart, and nothing to change in your compose file. What is not written costs nothing.'))}</p>
                        <p class="config-panel-note config-log-live-note" data-log-detail-live>${esc(this.serverLogLiveNote())}</p>
                        </div>
                        <div class="config-log-settings-col">
                        <div class="config-field">
                            <span class="config-field-label">${esc(this.t('config.logRetentionModeLabel', 'Limit the log'))}</span>
                            <select class="config-select" data-log-select="mode">${modeOptions}</select>
                        </div>
                        <div class="config-field">
                            <span class="config-field-label">${esc(this.t('config.logRetentionLabel', 'Keep entries for'))}</span>
                            <select class="config-select" data-log-select="retention" ${byCount ? 'disabled' : ''}>${retentionOptions}</select>
                        </div>
                        <div class="config-field">
                            <span class="config-field-label">${esc(this.t('config.logMaxEntriesLabel', 'Keep at most'))}</span>
                            <select class="config-select" data-log-select="maxEntries" ${byCount ? '' : 'disabled'}>${entryOptions}</select>
                        </div>
                        <p class="config-panel-note">${esc(byCount
                            ? this.t('config.logRetentionHintCount', 'Only the newest entries are kept; older ones drop off as new lines arrive. Age is not considered in this mode.')
                            : this.t('config.logRetentionHint', 'Older lines are dropped automatically. The newest lines are always kept, whatever the age limit.'))}</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Rebuild the current section's tab body in place, keeping the tab strip.
     *
     * Same shape as the tab-switch repaint: only the body is replaced, because
     * rebuilding the strip would drop the button that was just clicked. Shared
     * by Data & backups and Logs, the two sections whose panels use it — each
     * has its own body id and render/bind pair.
     */
    repaintDbTabBody() {
        if (this.inSection('logs')) {
            const body = document.getElementById('config-logs-body');
            if (!body) return;
            body.innerHTML = this.renderLogsTab();
            this.bindLogsTabContent(body);
            return;
        }
        if (!this.inSection('data-backups')) return;
        const body = document.getElementById('config-db-body');
        if (!body) return;
        body.innerHTML = this.renderDbTab();
        this.bindDataBackupsActions(body);
    },

    /**
     * Repaint the lines and tiles only.
     *
     * Deliberately not a full re-render: the controls must keep their state,
     * and re-creating the search box on every poll would drop focus mid-typing.
     */
    repaintServerLog() {
        if (this.section !== 'logs' || this.logsTab !== 'server') return;

        const tiles = document.getElementById('config-log-tiles');
        if (tiles) tiles.innerHTML = this.renderServerLogTiles();

        const out = document.querySelector('[data-log-output]');
        if (!out) return;
        // Whether the view was already at the bottom decides if follow applies,
        // so a user who scrolled up to read something is not yanked away.
        const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
        out.innerHTML = this.renderServerLogLines();
        if (this.logFollow && atBottom) {
            out.scrollTop = out.scrollHeight;
        }
    },

    /** Arm or disarm the refresh interval to match logRefreshSeconds. */
    updateServerLogTimer() {
        this.stopServerLogTimer();
        if (!this.logRefreshSeconds) return;
        this._logTimer = setInterval(() => {
            // Belt and braces: if a repaint ever loses the teardown, the timer
            // stops itself rather than polling behind a closed config view.
            if (this.section !== 'logs' || this.logsTab !== 'server') {
                this.stopServerLogTimer();
                return;
            }
            if (document.hidden) return;
            void this.loadServerLog();
        }, this.logRefreshSeconds * 1000);
    }

    });

    global.DashboardConfigLogsReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
