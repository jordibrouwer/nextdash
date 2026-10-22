/**
 * Config -> Glances.
 *
 * The one Glances host nextDash shows as its Glances page: its address and optional
 * login, how often the page reads it, which parts of the Overview it draws,
 * when a reading turns yellow or red, and which mounts count as disks. Switched
 * on and with an address, the Glances page exists (an icon in the navigation and Shift+G); otherwise
 * nothing about Glances is on screen. The password is kept on the server and
 * never sent back.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    /** The Overview parts a reader can switch off, in the order the page draws them. */
    const BLOCKS = [
        ['system', 'config.glancesBlockSystem', 'Machine and uptime'],
        ['figures', 'config.glancesBlockFigures', 'Processor, memory, swap and load'],
        ['cores', 'config.glancesBlockCores', 'Processor per core'],
        ['temps', 'config.glancesBlockTemps', 'Temperatures'],
        ['network', 'config.glancesBlockNetwork', 'Network'],
        ['diskio', 'config.glancesBlockDiskio', 'Disk activity'],
        ['disks', 'config.glancesBlockDisks', 'Disks'],
        ['smart', 'config.glancesBlockSmart', 'Disk health (SMART)'],
        ['processes', 'config.glancesBlockProcesses', 'Top processes'],
        ['containers', 'config.glancesBlockContainers', 'Containers'],
        ['alerts', 'config.glancesBlockAlerts', 'Alerts'],
    ];

    /** [key, label key, fallback, unit] -- each has a Warn and a Bad value. */
    const LINES = [
        ['cpu', 'config.glancesLineCpu', 'Processor', '%'],
        ['mem', 'config.glancesLineMem', 'Memory', '%'],
        ['swap', 'config.glancesLineSwap', 'Swap', '%'],
        ['disk', 'config.glancesLineDisk', 'Disks', '%'],
        ['temp', 'config.glancesLineTemp', 'Temperature', '°C'],
    ];

    const REFRESH = [1, 2, 5, 10, 30, 60, 300, 900];

    /** The incidents that can send a notice when they open and close. */
    const NOTIFY = [
        ['down', 'config.glancesNotifyDown', 'The host stops answering'],
        ['cpu', 'config.glancesNotifyCpu', 'Processor goes past its red line'],
        ['mem', 'config.glancesNotifyMem', 'Memory or swap goes past its red line'],
        ['disk', 'config.glancesNotifyDisk', 'A disk goes past its red line'],
        ['temp', 'config.glancesNotifyTemp', 'A temperature goes past its red line'],
        ['full', 'config.glancesNotifyFull', 'A disk is on its way to full within a week'],
    ];

    Object.assign(global.DashboardConfig.prototype, {

    renderGlancesSection() {
        const esc = (v) => this.dash.escapeHtml(v);
        const t = (key, fallback) => esc(this.t(`config.${key}`, fallback));
        const blocks = BLOCKS.map(([id, key, fallback]) => `
            <label class="config-toggle">
                <input type="checkbox" data-glances-block="${esc(id)}" checked>
                <span>${esc(this.t(key, fallback))}</span>
            </label>`).join('');
        const notify = NOTIFY.map(([id, key, fallback]) => `
            <label class="config-toggle">
                <input type="checkbox" data-glances-notify="${esc(id)}">
                <span>${esc(this.t(key, fallback))}</span>
            </label>`).join('');
        const lines = LINES.map(([id, key, fallback, unit]) => `
            <div class="config-field config-field--inline">
                <span class="config-field-label">${esc(this.t(key, fallback))}</span>
                <label class="config-inline-field">${t('glancesWarn', 'Yellow from')}
                    <input type="number" class="config-text config-text--short" min="1" max="${unit === '%' ? 100 : 150}" step="1"
                           data-glances-line="${esc(id)}Warn"> ${esc(unit)}</label>
                <label class="config-inline-field">${t('glancesBad', 'Red from')}
                    <input type="number" class="config-text config-text--short" min="1" max="${unit === '%' ? 100 : 150}" step="1"
                           data-glances-line="${esc(id)}Bad"> ${esc(unit)}</label>
            </div>`).join('');
        const everyLabel = (s) => (s >= 60
            ? this.t('config.glancesEveryMinutes', 'Every {n} min').replace('{n}', String(s / 60))
            : this.t('config.glancesEverySeconds', 'Every {n} s').replace('{n}', String(s)));
        const refresh = REFRESH.map((s) => `<option value="${s}">${esc(everyLabel(s))}</option>`).join('');
        const tabs = global.DashboardConfig.GLANCES_TABS.map((tab) => {
            const on = tab === (this.glancesTab || 'connection');
            return `<button type="button" class="config-subtab${on ? ' is-active' : ''}" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" aria-controls="config-glances-panels" data-glances-tab="${esc(tab)}">${esc(this.glancesTabLabel(tab))}</button>`;
        }).join('');
        return `
            <p class="config-view-intro">${t('glancesIntro',
                'Show one Glances host as a page of its own: live statistics, graphs and processes. Glances 4 only; nextDash reads, it never changes anything there.')}</p>
            <div class="config-tabpage">
                <div class="config-tabpage-main" id="config-glances-body">
                    ${window.DemoLock?.unraidNote?.() || ''}
                    <div class="glances-hostbar" data-glances-hosts-panel>
                        <div class="config-actions" data-glances-host-tabs role="group" aria-label="${t('glancesHostsTitle', 'Hosts')}"></div>
                        <div class="config-actions" data-glances-host-actions>
                            <button type="button" class="config-btn" data-glances-host-add>${t('glancesHostAdd', 'Add a host')}</button>
                            <button type="button" class="config-btn config-btn--danger" data-glances-host-remove hidden>${t('glancesHostRemove', 'Remove this host…')}</button>
                        </div>
                        <span class="glances-hostbar-status" data-glances-bar-status aria-live="polite"></span>
                        <div class="config-field config-field--inline" data-glances-host-new hidden>
                            <label class="config-field-label" for="config-glances-host-new-name">${t('glancesHostName', 'Name')}</label>
                            <input type="text" id="config-glances-host-new-name" class="config-text" maxlength="40" autocomplete="off" data-glances-host-new-name>
                            <button type="button" class="config-btn config-btn--primary" data-glances-host-new-ok>${t('glancesHostCreate', 'Add')}</button>
                            <button type="button" class="config-btn" data-glances-host-new-cancel>${t('glancesHostCancel', 'Cancel')}</button>
                        </div>
                    </div>
                    <p class="config-panel-note glances-hostbar-note">${t('glancesHostsNote',
                            'nextDash can watch up to five machines. Each has its own address, login, record, incidents and notices; how the page looks and the yellow and red lines are shared.')}</p>

                    <div class="config-subtabs" role="tablist">${tabs}</div>
                    <div class="glances-tabbody" id="config-glances-panels" role="tabpanel" tabindex="0">
                    <div class="config-panel" data-glances-section data-glances-panel="connection"${this.glancesPanelHidden('connection')}>
                        <h3 class="config-panel-title">${t('glancesTabConnection', 'Connection')}<span class="glances-scope glances-scope--host">${t('glancesBadgeHost', 'This host')}</span></h3>
                        <label class="config-toggle">
                            <input type="checkbox" data-glances-field="enabled">
                            <span>${t('glancesEnabled', 'Show Glances in the navigation')}</span>
                        </label>
                        <p class="config-panel-note">${t('glancesEnabledNote',
                            'Adds a Glances icon to the main navigation, before Config; Shift+G opens it. Off, nothing about Glances runs or shows.')}</p>
                        <label class="config-toggle">
                            <input type="checkbox" role="switch" data-glances-field="connected">
                            <span>${t('glancesConnected', 'Connection to Glances')}</span>
                        </label>
                        <p class="config-panel-note" data-glances-connected-note>${t('glancesConnectedNote',
                            'On: nextDash reads the host. Off: the page and what was recorded stay, but nothing is read until you switch it on. The same switch is at the top of the Glances page.')}</p>
                        <div class="config-field">
                            <label class="config-field-label" for="config-glances-name">${t('glancesHostName', 'Name')}</label>
                            <input type="text" id="config-glances-name" class="config-text" data-glances-field="name" maxlength="40"
                                   autocomplete="off" placeholder="Glances">
                        </div>
                        <div class="config-field">
                            <label class="config-field-label" for="config-glances-server">${t('glancesAddress', 'Address')}</label>
                            <input type="url" id="config-glances-server" class="config-text" data-glances-field="server"
                                   autocomplete="off" spellcheck="false" placeholder="http://192.168.1.10:61208">
                        </div>
                        <div class="config-field">
                            <label class="config-field-label" for="config-glances-user">${t('glancesUser', 'Username (only if Glances has a password)')}</label>
                            <input type="text" id="config-glances-user" class="config-text" data-glances-field="user"
                                   autocomplete="off" spellcheck="false">
                        </div>
                        <div class="config-field">
                            <label class="config-field-label" for="config-glances-password">${t('glancesPassword', 'Password')}</label>
                            <input type="password" id="config-glances-password" class="config-text" data-glances-field="password"
                                   autocomplete="off" spellcheck="false">
                        </div>
                        <p class="config-field-hint">${t('glancesLoginHint',
                            'Leave both empty when Glances is open. The password is kept on the server and never shown again.')}</p>
                        <div class="config-actions">
                            <button type="button" class="config-btn" data-glances-connect>${t('glancesConnect', 'Test connection')}</button>
                            <button type="button" class="config-btn config-btn--primary" data-glances-open-page hidden>${t('glancesOpenPage', 'Open the Glances page')}</button>
                            <button type="button" class="config-btn" data-glances-clear-login hidden>${t('glancesClearLogin', 'Remove the login')}</button>
                        </div>
                        <p class="config-field-hint" data-glances-result aria-live="polite" style="white-space: pre-line"></p>
                    </div>

                    <div class="config-panel" data-glances-section data-glances-panel="page"${this.glancesPanelHidden('page')}>
                        <h3 class="config-panel-title">${t('glancesPageTitle', 'The page')}<span class="glances-scope glances-scope--all">${t('glancesBadgeAll', 'All hosts')}</span></h3>
                        <div class="config-field">
                            <label class="config-field-label" for="config-glances-refresh">${t('glancesRefresh', 'Refresh while the page is open')}</label>
                            <select id="config-glances-refresh" class="config-select" data-glances-field="refresh">${refresh}</select>
                        </div>
                        <p class="config-field-hint">${t('glancesRefreshHint',
                            'How often an open Glances page reads the host for the numbers you see. It is not how often the history is recorded: that is Record every, at the top of the Glances page, and it runs whether or not the page is open.')}</p>
                        <h4 class="config-panel-subtitle">${t('glancesBlocksTitle', 'Overview shows')}</h4>
                        <div class="config-checkset" data-glances-blocks>${blocks}</div>
                    </div>

                    <div class="config-panel" data-glances-section data-glances-panel="page"${this.glancesPanelHidden('page')}>
                        <h3 class="config-panel-title">${t('glancesColoursTitle', 'Yellow and red')}<span class="glances-scope glances-scope--all">${t('glancesBadgeAll', 'All hosts')}</span></h3>
                        <p class="config-panel-note">${t('glancesColoursNote',
                            'When a reading changes colour, and the dot on the Glances icon. A temperature sensor that reports limits of its own uses those.')}</p>
                        ${lines}
                    </div>

                    <div class="config-panel" data-glances-section data-glances-panel="page"${this.glancesPanelHidden('page')}>
                        <h3 class="config-panel-title">${t('glancesDisksTitle', 'Which disks count')}<span class="glances-scope glances-scope--host">${t('glancesBadgeHost', 'This host')}</span></h3>
                        <div class="config-field">
                            <label class="config-field-label" for="config-glances-strip">${t('glancesStrip', 'Remove this from every mount point')}</label>
                            <input type="text" id="config-glances-strip" class="config-text" data-glances-field="diskStrip"
                                   autocomplete="off" spellcheck="false" placeholder="/rootfs">
                        </div>
                        <p class="config-field-hint">${t('glancesStripHint',
                            'Glances in a container sees the host under a prefix such as /rootfs. Mounts outside it are the container\'s own and are hidden. Empty: no prefix.')}</p>
                        <div class="config-field">
                            <label class="config-field-label" for="config-glances-hide">${t('glancesHide', 'Hide mounts containing (one per line)')}</label>
                            <textarea id="config-glances-hide" class="config-text" rows="3" data-glances-field="diskHide"
                                      spellcheck="false" placeholder="/mnt/user"></textarea>
                        </div>
                        <p class="config-field-hint">${t('glancesHideHint',
                            'Docker storage, squashfs, tmpfs and similar are always hidden.')}</p>
                    </div>

                    <div class="config-panel" data-glances-section data-glances-panel="recording"${this.glancesPanelHidden('recording')}>
                        <h3 class="config-panel-title">${t('glancesAutoTitle', 'Processes and containers')}<span class="glances-scope glances-scope--host">${t('glancesBadgeHost', 'This host')}</span></h3>
                        <p class="config-panel-note">${t('glancesAutoNote',
                            'The history of a process or container is recorded when you switch it on in its side panel. Here nextDash can also record the busiest ones by itself.')}</p>
                        <div class="config-field">
                            <label class="config-field-label" for="config-glances-auto">${t('glancesAutoField', 'Record the busiest by itself')}</label>
                            <select id="config-glances-auto" class="config-select" data-glances-field="autoRecord">
                                <option value="0">${t('glancesAutoOff', 'Off')}</option>
                                <option value="3">${t('glancesAuto3', 'The 3 busiest containers and processes')}</option>
                                <option value="5">${t('glancesAuto5', 'The 5 busiest containers and processes')}</option>
                            </select>
                        </div>
                        <p class="config-field-hint">${t('glancesAutoHint',
                            'Which ones change with what is busy, so their lines have gaps where they were not. Those you chose yourself are always recorded. The host is read every beat while this is on.')}</p>
                    </div>

                    <div class="config-panel" data-glances-section data-glances-panel="recording"${this.glancesPanelHidden('recording')} data-glances-collected-panel>
                        <h3 class="config-panel-title">${t('glancesCollectedTitle', 'Collected data')}<span class="glances-scope glances-scope--host">${t('glancesBadgeHost', 'This host')}</span></h3>
                        <p class="config-panel-note">${t('glancesCollectedNote',
                            'nextDash records the host at the pace you set on the Glances page (30 seconds to start with) and keeps 30 days: processor, memory, disks, network, temperatures, incidents and, for the processes and containers you switch on, their own history. Nothing leaves this server.')}</p>
                        <p class="config-field-hint" data-glances-collected aria-live="polite"></p>
                        <div class="config-actions">
                            <a class="config-btn" data-glances-export href="/api/glances/history.csv?since=0" download="glances-history.csv">${t('glancesExport', 'Download as CSV')}</a>
                            <button type="button" class="config-btn config-btn--danger" data-glances-wipe disabled>${t('glancesWipe', 'Delete collected data')}</button>
                        </div>
                        <p class="config-field-hint" data-glances-wiped aria-live="polite"></p>
                    </div>

                    <div class="config-panel" data-glances-section data-glances-panel="notices"${this.glancesPanelHidden('notices')} data-glances-notify-panel>
                        <h3 class="config-panel-title">${t('glancesNotifyTitle', 'Notices')}<span class="glances-scope glances-scope--host">${t('glancesBadgeHost', 'This host')}</span></h3>
                        <p class="config-panel-note">${t('glancesNotifyNote',
                            'A notice goes out when such an incident has lasted a few readings, and another when it is over, not on every reading. They go to your alert channel, and to browser notifications when "Notify when a Glances host has an incident" is on in Config → Monitoring. All are off until you switch them on.')}</p>
                        <div class="config-checkset" data-glances-notifies>${notify}</div>
                    </div>

                    <div class="config-panel" data-glances-section data-glances-panel="advanced"${this.glancesPanelHidden('advanced')} data-glances-link-panel>
                        <h3 class="config-panel-title">${t('glancesLinkTitle', 'Containers')}<span class="glances-scope glances-scope--host">${t('glancesBadgeHost', 'This host')}</span></h3>
                        <p class="config-panel-note">${t('glancesLinkNote',
                            'When this Glances host is the machine whose Docker you manage in the Containers view, its containers are the same ones: each links to the other view, and the Containers view shows what Glances recorded about a container.')}</p>
                        <div class="config-field">
                            <label class="config-field-label" for="config-glances-dockerlink">${t('glancesLinkField', 'Same machine as the Containers view')}</label>
                            <select id="config-glances-dockerlink" class="config-select" data-glances-field="dockerLink">
                                <option value="auto">${t('glancesLinkAuto', 'Auto')}</option>
                                <option value="yes">${t('glancesLinkYes', 'Yes')}</option>
                                <option value="no">${t('glancesLinkNo', 'No')}</option>
                            </select>
                        </div>
                        <label class="config-toggle">
                            <input type="checkbox" data-glances-field="useForContainers">
                            <span>${t('glancesUseForContainers', 'Use Glances for the CPU, memory and network in the Containers view')}</span>
                        </label>
                        <p class="config-field-hint">${t('glancesUseForContainersHint',
                            'When this host is the Docker host, Glances already reads every container: one request instead of one per container. Containers Glances does not know are still read from Docker.')}</p>
                        <p class="config-field-hint" data-glances-link-state aria-live="polite"></p>
                        <p class="config-field-hint" data-glances-link-docker-host aria-live="polite"></p>
                        <details class="glances-link-lists" data-glances-link-lists hidden>
                            <summary>${t('glancesLinkWhat', 'What matched')}</summary>
                            <p class="config-field-hint" data-glances-link-only></p>
                        </details>
                    </div>

                    <div class="config-panel" data-glances-section data-glances-panel="advanced"${this.glancesPanelHidden('advanced')} data-glances-reset-panel>
                        <h3 class="config-panel-title">${t('glancesResetTitle', 'Reset Glances')}<span class="glances-scope glances-scope--all">${t('glancesBadgeAll', 'All hosts')}</span></h3>
                        <p class="config-panel-note">${t('glancesResetNote',
                            'Removes the address, the login, the thresholds and every choice, together with everything recorded. Show Glances and the connection go off, and the Glances icon leaves the navigation until you set it up again.')}</p>
                        <div class="config-actions">
                            <button type="button" class="config-btn config-btn--danger" data-glances-reset>${t('glancesReset', 'Reset Glances…')}</button>
                        </div>
                        <p class="config-field-hint" data-glances-reset-result aria-live="polite"></p>
                    </div>
                    </div>

                    <p class="config-field-hint" data-glances-saved aria-live="polite"></p>
                </div>
            </div>`;
    },

    glancesTabLabel(tab) {
        const map = {
            connection: ['config.glancesTabConnection', 'Connection'],
            page: ['config.glancesTabPage', 'Page'],
            recording: ['config.glancesTabRecording', 'Recording'],
            notices: ['config.glancesTabNotices', 'Notices'],
            advanced: ['config.glancesTabAdvanced', 'Advanced'],
        };
        const [key, fallback] = map[tab] || [tab, tab];
        return this.t(key, fallback);
    },

    /** ` hidden` for a panel that is not on the chosen tab. */
    glancesPanelHidden(tab) {
        return (this.glancesTab || 'connection') === tab ? '' : ' hidden';
    },

    /** Show the panels of the chosen tab without redrawing them: a half-typed address survives a switch. */
    showGlancesTab(container) {
        const tab = this.glancesTab || 'connection';
        container.querySelectorAll('[data-glances-panel]').forEach((panel) => {
            panel.hidden = panel.getAttribute('data-glances-panel') !== tab;
        });
    },

    async bindGlancesSection(container) {
        if (container.querySelector('[data-glances-tab]')) {
            this.bindSubTabStrip(container, 'data-glances-tab', (tab) => {
                if (tab === this.glancesTab) return;
                this.glancesTab = tab;
                this.restoreConfigHash();
                this.showGlancesTab(container);
                this.syncSubTabStrip('data-glances-tab', this.glancesTab);
            });
        }
        const root = container.querySelector('#config-glances-body');
        if (!root) return;
        const t = (key, fallback) => this.t(`config.${key}`, fallback);
        const field = (name) => root.querySelector(`[data-glances-field="${name}"]`);
        const result = root.querySelector('[data-glances-result]');
        const saved = root.querySelector('[data-glances-saved]');
        const connectBtn = root.querySelector('[data-glances-connect]');
        const clearBtn = root.querySelector('[data-glances-clear-login]');
        // The host being edited: '' until its settings have been read, then its id.
        const Host = window.DashboardGlancesHost;
        let hostId = '';
        const send = (url, method, body, host = hostId) => window.nextDashFetch(Host.url(url, host), {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });

        let current = null;
        let clearLogin = false;
        let busy = false;
        const paintButtons = () => {
            connectBtn.disabled = !current || busy;
        };

        const failure = async (res) => {
            if (res.status === 401 || res.status === 403) {
                return t('glancesNotAllowed', 'Not allowed: the write token is missing or wrong.');
            }
            const text = String(await res.text().catch(() => '')).trim();
            return text && text.length <= 200 && !text.startsWith('<') ? text : String(res.status);
        };

        const ERRORS = {
            'not set up': t('glancesErrNotSetUp', 'Fill in the address first.'),
            'address not allowed': t('glancesErrAddress', 'That address is not allowed here. Check the local-network setting.'),
            'login refused': t('glancesErrLogin', 'Glances refused that login.'),
            'needs Glances 4': t('glancesErrV4', 'Glances 4 is needed; this server answers like version 3.'),
            unreachable: t('glancesErrUnreachable', 'Glances could not be reached at that address.'),
        };

        // The connection is something a shown Glances has: with Show Glances off it
        // reads off and cannot be switched; switching Show Glances on brings back
        // the state it had.
        const syncConnection = (shown, paused) => {
            const box = field('connected');
            box.disabled = !shown;
            box.checked = shown && !paused;
        };

        // The hosts as buttons; the one being edited is pressed.
        const tabs = root.querySelector('[data-glances-host-tabs]');
        const removeBtn = root.querySelector('[data-glances-host-remove]');
        const addBtn = root.querySelector('[data-glances-host-add]');
        const newRow = root.querySelector('[data-glances-host-new]');
        const newName = root.querySelector('[data-glances-host-new-name]');
        let loadHost = async () => {};
        let settle = async () => {};
        // How the host being edited is, beside the hosts: the dot is the page's own verdict.
        const bar = root.querySelector('[data-glances-bar-status]');
        const paintBar = () => {
            const row = (this.dash.glancesStatus?.hosts || []).find((h) => h.id === hostId);
            if (!bar || !row) return;
            let key = ['glancesBarAway', 'Not answering'];
            let tone = 'bad';
            if (!row.configured) { key = ['glancesBarNoAddress', 'No address yet']; tone = 'muted'; }
            else if (row.paused) { key = ['glancesBarOff', 'Connection off']; tone = 'muted'; }
            else if (row.level === 'ok' || row.level === 'warn' || row.level === 'bad') { key = ['glancesBarConnected', 'Connected']; tone = 'good'; }
            bar.setAttribute('data-tone', tone);
            bar.textContent = t(key[0], key[1]);
        };
        const paintHosts = (hosts) => {
            tabs.replaceChildren(...hosts.map((h) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'config-btn';
                btn.textContent = h.name;
                btn.setAttribute('data-glances-host-tab', h.id);
                btn.setAttribute('aria-pressed', h.id === hostId ? 'true' : 'false');
                if (h.id === hostId) btn.classList.add('config-btn--primary');
                btn.addEventListener('click', () => { if (h.id !== hostId) void loadHost(h.id); });
                return btn;
            }));
            removeBtn.hidden = hosts.length < 2;
            addBtn.hidden = hosts.length >= 5;
            paintBar();
        };

        // `keepFocus`: the answer to a save comes back while someone may be typing in
        // another field; what they are typing in is left as it is.
        const paint = (cfg, { keepFocus = false } = {}) => {
            current = cfg;
            const focused = keepFocus ? document.activeElement : null;
            const put = (el, value) => { if (el !== focused) el.value = value; };
            field('enabled').checked = cfg.enabled === true;
            syncConnection(cfg.enabled === true, cfg.paused === true);
            hostId = cfg.id || hostId;
            const exportLink = root.querySelector('[data-glances-export]');
            if (exportLink) exportLink.href = Host.url('/api/glances/history.csv?since=0', hostId);
            put(field('name'), cfg.name || '');
            paintHosts(cfg.hosts || []);
            put(field('server'), cfg.server || '');
            put(field('user'), cfg.user || '');
            put(field('password'), '');
            field('password').placeholder = cfg.hasPassword ? t('glancesPasswordSet', 'Set. Type to replace.') : '';
            clearBtn.hidden = !(cfg.user || cfg.hasPassword);
            clearLogin = false;
            field('refresh').value = String(cfg.refresh || 2);
            field('dockerLink').value = cfg.dockerLink || 'auto';
            field('useForContainers').checked = cfg.keepDockerStats !== true;
            field('autoRecord').value = String(cfg.autoRecord || 0);
            const hidden = new Set(cfg.hiddenBlocks || []);
            root.querySelectorAll('[data-glances-block]').forEach((box) => {
                box.checked = !hidden.has(box.getAttribute('data-glances-block'));
            });
            const notifying = new Set(cfg.notify || []);
            root.querySelectorAll('[data-glances-notify]').forEach((box) => {
                box.checked = notifying.has(box.getAttribute('data-glances-notify'));
            });
            const th = cfg.thresholds || {};
            root.querySelectorAll('[data-glances-line]').forEach((input) => {
                put(input, th[input.getAttribute('data-glances-line')] ?? '');
            });
            put(field('diskStrip'), cfg.diskStrip ?? '');
            put(field('diskHide'), (cfg.diskHide || []).join('\n'));
            paintCollected(cfg.collected);
        };

        // Whether the Glances host and the Docker host are one machine, and what matched.
        const linkState = root.querySelector('[data-glances-link-state]');
        const linkLists = root.querySelector('[data-glances-link-lists]');
        const linkOnly = root.querySelector('[data-glances-link-only]');
        const paintLink = (a) => {
            if (!linkState) return;
            linkLists.hidden = true;
            if (!a) {
                linkState.textContent = '';
                return;
            }
            const host = a.glancesHost || a.dockerHost || '';
            const parts = {
                'same-name': t('glancesLinkSame', 'Detected: the same machine ({name}).').replace('{name}', host),
                chosen: t('glancesLinkChosen', 'Set by you: the same machine.'),
                'different-name': t('glancesLinkDifferent', 'Different machines: Glances says {glances}, Docker says {docker}. Nothing is linked. If they are one machine after all, choose Yes.')
                    .replace('{glances}', a.glancesHost || '?').replace('{docker}', a.dockerHost || '?'),
                unknown: t('glancesLinkUnknown', 'Could not tell which machine each is. Choose Yes or No.'),
                'no-docker': t('glancesLinkNoDocker', 'The Containers view has no Docker socket here, so there is nothing to link.'),
                off: t('glancesLinkOff', 'Not linked.'),
            };
            let text = parts[a.reason] || '';
            if (a.same && Array.isArray(a.matches)) {
                text += ` ${t('glancesLinkCounts', '{n} containers matched: {id} by id, {name} by name or port.')
                    .replace('{n}', String(a.matches.length)).replace('{id}', String(a.byId || 0)).replace('{name}', String(a.byName || 0))}`;
                linkLists.hidden = false;
                const g = (a.onlyGlances || []).join(', ') || '—';
                const d = (a.onlyDocker || []).join(', ') || '—';
                linkOnly.textContent = `${t('glancesLinkOnlyGlances', 'Only in Glances')}: ${g}. ${t('glancesLinkOnlyDocker', 'Only in the Containers view')}: ${d}.`;
            }
            linkState.textContent = text;
        };
        // Only one host is the Docker host: which one it is, said under this host's own link state.
        const dockerHostEl = root.querySelector('[data-glances-link-docker-host]');
        const paintDockerHost = (global) => {
            if (!dockerHostEl) return;
            dockerHostEl.textContent = '';
            const hosts = current?.hosts || [];
            if (!global || !global.same || !global.hostId || hosts.length < 2) return;
            const name = (hosts.find((h) => h.id === global.hostId) || {}).name || global.hostId;
            dockerHostEl.textContent = global.hostId === hostId
                ? t('glancesLinkIsDockerHost', 'This is the Docker host: the Containers view is linked to this host.')
                : t('glancesLinkOtherDockerHost', 'The Containers view is linked to {name}. Only one host can be the Docker host.').replace('{name}', name);
        };
        const refreshLink = async () => {
            if (!linkState) return;
            try {
                const [res, all] = await Promise.all([
                    fetch(Host.url('/api/glances/docker-link', hostId || ''), { credentials: 'same-origin', cache: 'no-store' }),
                    fetch('/api/glances/docker-link', { credentials: 'same-origin', cache: 'no-store' }),
                ]);
                paintLink(res.ok ? await res.json() : null);
                paintDockerHost(all.ok ? await all.json() : null);
            } catch {
                paintLink(null);
                paintDockerHost(null);
            }
        };

        const collectedEl = root.querySelector('[data-glances-collected]');
        const wipeBtn = root.querySelector('[data-glances-wipe]');
        const wipedEl = root.querySelector('[data-glances-wiped]');
        const paintCollected = (c) => {
            if (!collectedEl) return;
            const has = c && c.points > 0;
            wipeBtn.disabled = !has;
            if (!has) {
                collectedEl.textContent = t('glancesCollectedNone', 'Nothing recorded yet.');
                return;
            }
            const since = c.since ? new Date(c.since).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
            collectedEl.textContent = `${c.series} ${t('glancesCollectedSeries', 'series')} · ${c.points} ${t('glancesCollectedPoints', 'points')} · ${c.incidents || 0} ${t('glancesCollectedIncidents', 'incidents')}${since ? ` · ${t('glancesCollectedSince', 'since')} ${since}` : ''}`;
        };

        const payload = () => {
            const name = field('name').value.trim();
            const hiddenBlocks = [...root.querySelectorAll('[data-glances-block]')]
                .filter((box) => !box.checked).map((box) => box.getAttribute('data-glances-block'));
            const notify = [...root.querySelectorAll('[data-glances-notify]')]
                .filter((box) => box.checked).map((box) => box.getAttribute('data-glances-notify'));
            const thresholds = {};
            root.querySelectorAll('[data-glances-line]').forEach((input) => {
                thresholds[input.getAttribute('data-glances-line')] = Number(input.value) || 0;
            });
            const body = {
                name,
                enabled: field('enabled').checked,
                paused: field('connected').disabled ? current?.paused === true : !field('connected').checked,
                server: field('server').value.trim(),
                user: clearLogin ? '' : field('user').value.trim(),
                refresh: Number(field('refresh').value) || 2,
                dockerLink: field('dockerLink').value || 'auto',
                keepDockerStats: !field('useForContainers').checked,
                autoRecord: Number(field('autoRecord').value) || 0,
                hiddenBlocks,
                notify,
                thresholds,
                diskStrip: field('diskStrip').value.trim(),
                diskHide: field('diskHide').value.split('\n').map((s) => s.trim()).filter(Boolean),
            };
            if (clearLogin) body.clearLogin = true;
            const password = field('password').value;
            if (password) body.password = password;
            return body;
        };

        const run = async (work) => {
            if (busy) return;
            busy = true;
            paintButtons();
            try { await work(); } finally { busy = false; paintButtons(); }
        };

        wipeBtn?.addEventListener('click', async () => {
            const ok = await this.confirmAction(
                t('glancesWipeConfirm', 'Delete everything nextDash recorded about this host: all graphs, incidents and the history of processes and containers? This cannot be undone. Recording starts again at once.'),
                { confirmLabel: t('glancesWipeOk', 'Delete data') },
            );
            if (!ok) return;
            wipedEl.textContent = '';
            try {
                const res = await send('/api/glances/data', 'DELETE');
                if (!res.ok) {
                    wipedEl.textContent = `${t('glancesWipeFailed', 'Could not delete')} (${await failure(res)})`;
                    return;
                }
                paintCollected(await res.json());
                wipedEl.textContent = t('glancesWiped', 'Deleted.');
            } catch {
                wipedEl.textContent = `${t('glancesWipeFailed', 'Could not delete')}.`;
            }
        });

        field('enabled').addEventListener('change', () => {
            syncConnection(field('enabled').checked, current?.paused === true);
        });

        // Reset: the settings, the login and everything recorded, after a question.
        const resetBtn = root.querySelector('[data-glances-reset]');
        const resetResult = root.querySelector('[data-glances-reset-result]');
        resetBtn?.addEventListener('click', async () => {
            const ok = await this.confirmAction(
                t('glancesResetConfirm', 'Reset Glances? Every host, its address and login, the thresholds, every choice and everything recorded are removed, and Glances goes off. This cannot be undone.'),
                { confirmLabel: t('glancesResetOk', 'Reset') },
            );
            if (!ok) return;
            resetResult.textContent = '';
            try {
                const res = await send('/api/glances/config', 'DELETE', undefined, '');
                if (!res.ok) {
                    resetResult.textContent = `${t('glancesResetFailed', 'Could not reset')} (${await failure(res)})`;
                    return;
                }
                paint(await res.json());
                clearLogin = false;
                saved.textContent = '';
                result.textContent = '';
                wipedEl.textContent = '';
                resetResult.textContent = t('glancesResetDone', 'Glances is reset.');
                void this.dash.glancesStatus?.refresh?.({ force: true });
                this.dash.pageNav?.renderPageNavigation?.();
            } catch {
                resetResult.textContent = `${t('glancesResetFailed', 'Could not reset')}.`;
            }
        });

        // The connection switch applies at once, like the one on the Glances page.
        field('connected').addEventListener('change', async () => {
            const on = field('connected').checked;
            try {
                const res = await send('/api/glances/config', 'PUT', { paused: !on });
                if (!res.ok) throw new Error(await failure(res));
                const cfg = await res.json();
                if (current) current.paused = cfg.paused === true;
                saved.textContent = on ? t('glancesConnectedOn', 'Connected.') : t('glancesConnectedOff', 'Connection off.');
                void this.dash.glancesStatus?.refresh?.({ force: true });
            } catch (err) {
                field('connected').checked = !on;
                saved.textContent = `${t('glancesSaveFailed', 'Could not save')} (${err.message})`;
            }
        });

        clearBtn.addEventListener('click', () => {
            clearLogin = true;
            field('user').value = '';
            field('password').value = '';
            clearBtn.hidden = true;
            schedule(0);
        });

        const openBtn = root.querySelector('[data-glances-open-page]');
        // The page opens from here once it is on and has an address.
        const paintOpen = () => {
            if (openBtn) openBtn.hidden = !(current && current.enabled === true && current.server);
        };
        openBtn?.addEventListener('click', () => { void this.dash.glancesStatus?.openGlancesPage?.(); });

        const testConnection = () => run(async () => {
            result.textContent = t('glancesTesting', 'Asking…');
            try {
                const res = await send('/api/glances/connect', 'POST', {
                    server: field('server').value.trim(),
                    user: clearLogin ? '' : field('user').value.trim(),
                    password: field('password').value,
                });
                if (res.status === 401 || res.status === 403) {
                    result.textContent = await failure(res);
                    return;
                }
                const body = await res.json().catch(() => null);
                if (!body) {
                    result.textContent = ERRORS.unreachable;
                    return;
                }
                if (body.error) {
                    result.textContent = ERRORS[body.error] || ERRORS.unreachable;
                    return;
                }
                const count = Array.isArray(body.plugins) ? body.plugins.length : 0;
                result.textContent = `${body.connected || 'Glances'}${count ? ` · ${count} ${t('glancesPlugins', 'plugins')}` : ''}`;
            } catch {
                result.textContent = ERRORS.unreachable;
            }
        });
        connectBtn.addEventListener('click', () => { void testConnection(); });

        /*
         * Every change is kept as it is made, as the other settings are: a choice or
         * a checkbox at once, a text field when it is left. Saves go one at a time,
         * and what was changed while one was running goes after it.
         */
        let saveTimer = null;
        let pending = false;
        let fadeTimer = null;
        let saving = false;
        let again = false;
        const say = (text, stay = false) => {
            saved.textContent = text;
            clearTimeout(fadeTimer);
            if (text && !stay) fadeTimer = setTimeout(() => { if (saved.textContent === text) saved.textContent = ''; }, 2500);
        };
        const saveNow = async () => {
            if (!current) return;
            if (saving) {
                again = true;
                return;
            }
            const body = payload();
            // Glances cannot be shown without somewhere to look: at least one host needs an address.
            const elsewhere = (current.hosts || []).some((h) => h.id !== hostId && h.configured);
            if (body.enabled && !body.server && !elsewhere) {
                field('enabled').checked = false;
                syncConnection(false, current.paused === true);
                body.enabled = false;
                say(ERRORS['not set up'], true);
            }
            saving = true;
            try {
                const res = await send('/api/glances/config', 'PUT', body);
                if (!res.ok) {
                    say(`${t('glancesSaveFailed', 'Could not save')} (${await failure(res)})`, true);
                    return;
                }
                const cfg = await res.json();
                if (root.isConnected) {
                    paint(cfg, { keepFocus: true });
                    paintOpen();
                    if (!saved.textContent || saved.textContent === t('glancesSaved', 'Saved.')) say(t('glancesSaved', 'Saved.'));
                }
                // The Glances icon and its dot follow the new settings now.
                void this.dash.glancesStatus?.refresh?.({ force: true });
                this.dash.pageNav?.renderPageNavigation?.();
                void refreshLink();
            } catch {
                say(`${t('glancesSaveFailed', 'Could not save')}.`, true);
            } finally {
                saving = false;
                if (again) {
                    again = false;
                    schedule(0);
                }
            }
        };
        const schedule = (delay = 400) => {
            clearTimeout(saveTimer);
            pending = true;
            saveTimer = setTimeout(() => { pending = false; void saveNow(); }, delay);
        };
        // What was just typed is saved, for the host it was typed for, before another is loaded.
        settle = async () => {
            if (pending) {
                clearTimeout(saveTimer);
                pending = false;
                await saveNow();
            }
            while (saving) await new Promise((resolve) => setTimeout(resolve, 40));
        };
        // `change` fires at once for a checkbox or a choice and on leaving a text field.
        root.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.matches('[data-glances-field="connected"]')) return; // its own switch
            if (target.matches('[data-glances-field], [data-glances-block], [data-glances-line], [data-glances-notify]')) schedule();
            // The address or the login was just changed: try it, so a wrong one is said so at once.
            if (target.matches('[data-glances-field="server"], [data-glances-field="user"], [data-glances-field="password"]')
                && field('server').value.trim()) {
                void testConnection();
            }
        });

        // Read one host's settings into the form; '' is the first host.
        loadHost = async (id) => {
            await settle();
            try {
                const res = await send('/api/glances/config', 'GET', undefined, id);
                if (!res.ok) throw new Error(String(res.status));
                const cfg = await res.json();
                if (!cfg || typeof cfg !== 'object' || !root.isConnected) return;
                hostId = '';
                result.textContent = '';
                saved.textContent = '';
                wipedEl.textContent = '';
                paint(cfg);
                paintOpen();
                void refreshLink();
            } catch {
                // Saving now would overwrite what is stored with blanks: stay shut.
                if (root.isConnected) result.textContent = t('glancesLoadFailed', 'Could not read the Glances settings. Reload to try again.');
            }
        };

        addBtn.addEventListener('click', () => {
            newRow.hidden = false;
            newName.value = '';
            newName.focus();
        });
        root.querySelector('[data-glances-host-new-cancel]').addEventListener('click', () => { newRow.hidden = true; });
        const createHost = async () => {
            const name = newName.value.trim();
            if (!name) { newName.focus(); return; }
            await settle();
            try {
                const res = await send('/api/glances/config', 'PUT', { name }, 'new');
                if (!res.ok) throw new Error(await failure(res));
                const cfg = await res.json();
                newRow.hidden = true;
                hostId = '';
                paint(cfg);
                paintOpen();
                void refreshLink();
                say(t('glancesHostAdded', 'Host added. Fill in its address.'));
                void this.dash.glancesStatus?.refresh?.({ force: true });
                field('server').focus();
            } catch (err) {
                say(`${t('glancesSaveFailed', 'Could not save')} (${err.message})`, true);
            }
        };
        root.querySelector('[data-glances-host-new-ok]').addEventListener('click', () => { void createHost(); });
        newName.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') { event.preventDefault(); void createHost(); }
            if (event.key === 'Escape') { event.stopPropagation(); newRow.hidden = true; }
        });
        removeBtn.addEventListener('click', async () => {
            const ok = await this.confirmAction(
                t('glancesHostRemoveConfirm', 'Remove this host? Its address, login and everything recorded about it are deleted. This cannot be undone.'),
                { confirmLabel: t('glancesHostRemoveOk', 'Remove') },
            );
            if (!ok) return;
            try {
                const res = await window.nextDashFetch(`${Host.url('/api/glances/config', hostId)}&remove=1`, { method: 'DELETE' });
                if (!res.ok) throw new Error(await failure(res));
                if (Host.id === hostId) Host.set('');
                const cfg = await res.json();
                hostId = '';
                paint(cfg);
                paintOpen();
                void refreshLink();
                void this.dash.glancesStatus?.refresh?.({ force: true });
                say(t('glancesHostRemoved', 'Host removed.'));
            } catch (err) {
                say(`${t('glancesSaveFailed', 'Could not save')} (${err.message})`, true);
            }
        });

        await loadHost('');
        paintButtons();
    },

    });

    global.DashboardConfigGlancesReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
