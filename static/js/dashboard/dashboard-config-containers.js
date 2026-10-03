/**
 * Config -> Containers.
 *
 * The settings themselves are schema panels (behaviorSchema, section
 * 'containers'), so they are drawn, filtered, reset and saved the way Behavior's
 * are. This file adds the three parts a schema cannot describe: the connection
 * as the server sees it, the list of containers kept out of sight, and the
 * GitHub token -- a secret, stored on the server and never sent back.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    const SOCKET_SNIPPET = 'volumes:\n'
        + '  - /var/run/docker.sock:/var/run/docker.sock:ro\n'
        + 'environment:\n'
        + '  - NEXTDASH_DOCKER_SOCKET=/var/run/docker.sock';

    // The rule the server keeps (normalizeDockerHostAddress in docker_settings.go).
    const HOST_NAME = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
    const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;

    /**
     * What a typed host address will become: empty, fine as it is, fixable
     * (a URL or host:port whose host is fine), or not an address at all.
     */
    global.DashboardConfig.checkDockerHost = function checkDockerHost(raw) {
        const value = String(raw || '').trim();
        if (!value) return { state: 'empty' };
        const bare = value.replace(/^\[|\]$/g, '');
        // IPv6 has two colons at least; one is a host with a port.
        if ((bare.match(/:/g) || []).length >= 2 && /^[0-9a-f:.]+$/i.test(bare)) return { state: 'ok', host: `[${bare}]` };
        if (IPV4.test(value) || HOST_NAME.test(value)) return { state: 'ok', host: value };
        try {
            const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`);
            const host = url.hostname;
            if (host && (IPV4.test(host) || HOST_NAME.test(host) || host.startsWith('['))) return { state: 'fixable', host };
        } catch {
            // Not a URL either.
        }
        return { state: 'bad' };
    };

    Object.assign(global.DashboardConfig.prototype, {

    renderContainersSection() {
        const esc = (v) => this.dash.escapeHtml(v);
        const tabs = global.DashboardConfig.CONTAINERS_TABS.map((tab) => {
            const active = tab === this.containersTab;
            return `<button type="button" class="config-subtab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" aria-controls="config-containers-body" data-containers-tab="${esc(tab)}">${esc(this.containersTabLabel(tab))}</button>`;
        }).join('');
        return `
            <p class="config-view-intro">${esc(this.t('config.containersIntro',
                'The Containers view: what it can reach, how often it looks, and what it leaves out. Every change applies immediately and is saved.'))}</p>
            <div class="config-subtabs" role="tablist">${tabs}</div>
            <div class="config-tabpage">
                <div class="config-tabpage-main" id="config-containers-body" role="tabpanel" tabindex="0">
                    ${this.renderContainersBody()}
                </div>
            </div>
        `;
    },

    containersTabLabel(tab) {
        const map = {
            connection: ['config.containersTabConnection', 'Connection'],
            view: ['config.containersTabView', 'View'],
            updates: ['config.containersTabUpdates', 'Updates'],
            alerts: ['config.containersTabAlerts', 'Alerts'],
        };
        const [key, fallback] = map[tab] || [tab, tab];
        return this.t(key, fallback);
    },

    /**
     * One tab's panels. The schema panels carry their tab; the hand-built
     * ones (socket status, hidden and muted lists, the GitHub token)
     * are placed here, in the order each tab reads best.
     */
    renderContainersBody() {
        const tab = this.containersTab;
        const schema = () => this.renderControlPanels(this.panelsFor('containers', tab), 'behavior');
        switch (tab) {
            case 'view':
                return `${schema()}${this.renderContainersHiddenPanel()}`;
            case 'updates':
                return `${schema()}${this.renderContainersTokenPanel()}`;
            case 'alerts':
                return `${schema()}${this.renderContainersMutedPanel()}`;
            default:
                return `${this.renderContainersStatusPanel()}${schema()}`;
        }
    },

    /** Redraw the body for the tab now chosen, the strip left as it is. */
    repaintContainersBody() {
        const body = document.getElementById('config-containers-body');
        if (!body) return;
        body.innerHTML = this.renderContainersBody();
        this.bindControlPanels(body, 'behavior');
        this.bindContainersPanels(body);
        this.labelSettingsControls?.();
    },

    /** Filled from /api/docker/status once the section is on screen. */
    renderContainersStatusPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        const row = (key, label) => `
            <div class="config-field">
                <span class="config-field-label">${esc(label)}</span>
                <span class="config-docker-state" data-docker-state="${esc(key)}">…</span>
            </div>`;
        return `
            <div class="config-panel" data-docker-status-panel>
                <h3 class="config-panel-title">${esc(this.t('config.containersGroupConnection', 'Connection'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.containersGroupConnectionNote',
                    'Set by the container, not here: these follow the environment variables nextDash was started with.'))}</p>
                ${row('socket', this.t('config.dockerStatusSocket', 'Docker socket'))}
                ${row('control', this.t('config.dockerStatusActions', 'Actions'))}
                ${row('token', this.t('config.dockerStatusWriteToken', 'Write token'))}
                ${row('self', this.t('config.dockerStatusSelf', 'This container'))}
                <div data-docker-status-help hidden></div>
            </div>`;
    },

    renderContainersHiddenPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        const names = Array.isArray(this.dash.settings?.dockerHiddenContainers)
            ? this.dash.settings.dockerHiddenContainers : [];
        const chips = names.map((name) => `
            <span class="config-docker-chip">
                <span>${esc(name)}</span>
                <button type="button" class="config-docker-chip-remove" data-docker-unhide="${esc(name)}"
                        aria-label="${esc(this.t('config.dockerUnhideLabel', 'Show {name} again').replace('{name}', name))}">×</button>
            </span>`).join('');
        const empty = names.length ? '' : `<p class="config-field-hint">${esc(this.t('config.dockerHiddenNone', 'Nothing is hidden.'))}</p>`;
        return `
            <div class="config-panel" data-docker-hidden-panel>
                <h3 class="config-panel-title">${esc(this.t('config.containersGroupHidden', 'Hidden containers'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.containersGroupHiddenNote',
                    'Kept out of the view, search and the widget count. They keep running; nextDash just stops showing them.'))}</p>
                <div class="config-docker-chips">${chips}</div>
                ${empty}
                <div class="config-field">
                    <label class="config-field-label" for="config-docker-hide-input">${esc(this.t('config.dockerHideLabel', 'Hide a container'))}</label>
                    <span class="config-docker-hide-row">
                        <input type="text" id="config-docker-hide-input" class="config-text" list="config-docker-hide-names"
                               autocomplete="off" spellcheck="false"
                               placeholder="${esc(this.t('config.dockerHidePlaceholder', 'Container name'))}">
                        <datalist id="config-docker-hide-names"></datalist>
                        <button type="button" class="config-btn" data-docker-hide-add>${esc(this.t('config.dockerHideAdd', 'Hide'))}</button>
                    </span>
                </div>
            </div>`;
    },

    /**
     * Where notices would go, a warning when nothing would receive them, and
     * the containers that are muted. A container is muted from its row menu
     * or its drawer; here it is only let back in.
     */
    renderContainersMutedPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        const names = Array.isArray(s.dockerNotifyMuted) ? s.dockerNotifyMuted : [];
        const webhook = Boolean(String(s.monitorNotifyUrl || '').trim())
            || (s.monitorNotifyPreset === 'pushover' && s.monitorNotifyPushoverToken && s.monitorNotifyPushoverUserKey);
        const push = s.pushNotifyEnabled === true && s.pushNotifyContainers === true;
        const where = [
            webhook ? this.t('config.dockerNotifyToWebhook', 'the alert webhook') : '',
            push ? this.t('config.dockerNotifyToPush', 'browser notifications') : '',
        ].filter(Boolean);
        const receiver = where.length
            ? `<p class="config-field-hint" data-docker-notify-receiver>${esc(this.t('config.dockerNotifyGoesTo', 'Notices go to {where}.').replace('{where}', where.join(' + ')))}</p>`
            : `<p class="config-field-hint config-field-hint--warn" data-docker-notify-receiver data-none>${esc(this.t('config.dockerNotifyNoReceiver',
                'Nothing receives them yet: set a webhook under Behavior → Status → Downtime alerts, or switch on browser notifications with Containers.'))}</p>`;
        const chips = names.map((name) => `
            <span class="config-docker-chip">
                <span>${esc(name)}</span>
                <button type="button" class="config-docker-chip-remove" data-docker-unmute="${esc(name)}"
                        aria-label="${esc(this.t('config.dockerUnmuteLabel', 'Notify about {name} again').replace('{name}', name))}">×</button>
            </span>`).join('');
        const empty = names.length ? '' : `<p class="config-field-hint">${esc(this.t('config.dockerMutedNone', 'No container is muted. Mute one from its row menu or its drawer.'))}</p>`;
        return `
            <div class="config-panel" data-docker-muted-panel>
                <h3 class="config-panel-title">${esc(this.t('config.containersGroupMuted', 'Muted containers'))}</h3>
                ${receiver}
                <div class="config-docker-chips">${chips}</div>
                ${empty}
            </div>`;
    },

    bindContainersMuted(container) {
        const panel = container.querySelector('[data-docker-muted-panel]');
        if (!panel) return;
        panel.querySelectorAll('[data-docker-unmute]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const name = btn.getAttribute('data-docker-unmute');
                const names = (this.dash.settings?.dockerNotifyMuted || []).filter((n) => n !== name);
                await this.setBehavior('dockerNotifyMuted', names, '');
                const fresh = document.createElement('div');
                fresh.innerHTML = this.renderContainersMutedPanel();
                panel.replaceWith(fresh.firstElementChild);
                this.bindContainersMuted(container);
            });
        });
    },

    renderContainersTokenPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <div class="config-panel" data-docker-token-panel>
                <h3 class="config-panel-title">${esc(this.t('config.containersGroupGitHub', 'GitHub'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.containersGroupGitHubNote',
                    "Optional. What's new reads release notes from GitHub, which allows 60 requests an hour without a token and 5000 with one. A token with no scopes is enough."))}</p>
                <div class="config-field">
                    <label class="config-field-label" for="config-docker-github-token">${esc(this.t('config.dockerGitHubTokenLabel', 'Access token'))}</label>
                    <input type="password" id="config-docker-github-token" class="config-text" autocomplete="off" spellcheck="false"
                           placeholder="ghp_…">
                </div>
                <p class="config-field-hint" data-docker-token-state></p>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-docker-token-action="save">${esc(this.t('config.dockerGitHubTokenSave', 'Save token'))}</button>
                    <button type="button" class="config-btn config-btn--danger" data-docker-token-action="remove" hidden>${esc(this.t('config.dockerGitHubTokenRemove', 'Remove token'))}</button>
                </div>
            </div>`;
    },

    bindContainersSection(container) {
        // The strip is outside the body: bound when the whole section is, not
        // again on every repaint of the body.
        if (container.querySelector('[data-containers-tab]')) {
            this.bindSubTabStrip(container, 'data-containers-tab', (tab) => {
                if (tab === this.containersTab) return;
                this.containersTab = tab;
                this.restoreConfigHash();
                this.repaintContainersBody();
                this.syncSubTabStrip('data-containers-tab', this.containersTab);
            });
        }
        this.bindContainersPanels(container);
    },

    /** Each panel binds only when it is on screen; the others are absent on this tab. */
    bindContainersPanels(container) {
        // The socket answer also colours the switch on the View tab.
        if (container.querySelector('[data-docker-status-panel], [data-behavior-field="dockerViewEnabled"]')) {
            void this.fillContainersStatus(container);
        }
        this.bindContainersHostCheck(container);
        this.bindContainersHidden(container);
        this.bindContainersMuted(container);
        this.bindContainersToken(container);
    },

    /*
     * The host address, checked as it is typed. The server keeps a bare host
     * only -- a name or an IP -- and drops anything else, so a pasted
     * http://tower:8080 used to vanish on save without a word. The line under
     * the field says where port 8080 would go, and a full address is cut down
     * to its host before it is saved.
     */
    bindContainersHostCheck(container) {
        const input = container.querySelector('[data-behavior-field="dockerHostAddress"]');
        const row = input?.closest('.config-field-row, .config-field');
        if (!input || !row) return;
        const line = document.createElement('p');
        line.className = 'config-field-check';
        line.setAttribute('data-docker-host-check', '');
        line.setAttribute('aria-live', 'polite');
        row.after(line);
        // Config's t() takes no parameters; the tokens are filled here.
        const fill = (text, params) => Object.entries(params || {})
            .reduce((out, [k, v]) => out.split(`{${k}}`).join(v), text);
        const paint = () => {
            const check = global.DashboardConfig.checkDockerHost(input.value);
            const example = (host) => `http://${host}:8080`;
            line.dataset.state = check.state;
            line.textContent = {
                empty: () => fill(this.t('config.dockerHostCheckEmpty', 'Empty: port 8080 opens {url}, the address this dashboard is open on.'),
                    { url: example(global.location.hostname) }),
                ok: () => fill(this.t('config.dockerHostCheckOk', '✓ Port 8080 opens {url}.'), { url: example(check.host) }),
                fixable: () => fill(this.t('config.dockerHostCheckFixable', 'Only the address, without http:// or a port: {host} is what will be saved.'),
                    { host: check.host }),
                bad: () => this.t('config.dockerHostCheckBad', 'Not an address: use a name or an IP, such as 192.168.1.10 or tower.local.'),
            }[check.state]();
        };
        input.addEventListener('input', paint);
        // Capture on the section, so the host is in the field before the save
        // reads it. The section outlives a tab switch and the field does not,
        // so the listener is added once per section and finds today's field
        // (and its line) through the event; added per visit to View, it piled
        // up one listener each time.
        input._dockerHostPaint = paint;
        if (!container._dockerHostChangeBound) {
            container._dockerHostChangeBound = true;
            container.addEventListener('change', (e) => {
                const field = e.target;
                if (!field?.matches?.('[data-behavior-field="dockerHostAddress"]')) return;
                const check = global.DashboardConfig.checkDockerHost(field.value);
                if (check.state === 'fixable') field.value = check.host;
                field._dockerHostPaint?.();
            }, true);
        }
        paint();
    },

    async fillContainersStatus(container) {
        let status = null;
        try {
            const res = await fetch('/api/docker/status');
            status = res.ok ? await res.json() : null;
        } catch {
            status = null;
        }
        if (!container.isConnected) return;
        const t = (k, f) => this.t(k, f);
        const socket = status?.socket === true;
        const denied = status?.reason === 'docker-socket-denied';
        this.markDockerViewSwitch(container, socket, denied);
        const panel = container.querySelector('[data-docker-status-panel]');
        if (!panel || !panel.isConnected) return;
        const set = (key, text, tone) => {
            const el = panel.querySelector(`[data-docker-state="${key}"]`);
            if (!el) return;
            el.textContent = text;
            el.setAttribute('data-tone', tone);
        };
        if (socket) set('socket', t('config.dockerStatusConnected', 'Connected'), 'good');
        else if (denied) set('socket', t('config.dockerStatusDenied', 'No access to the socket'), 'bad');
        else set('socket', t('config.dockerStatusMissing', 'Not connected'), 'bad');

        set('control', status?.control
            ? t('config.dockerStatusActionsOn', 'On')
            : t('config.dockerStatusActionsOff', 'Off — set NEXTDASH_DOCKER_CONTROL=1'),
        status?.control ? 'good' : 'muted');

        // A token matters once actions are on: without one, anyone who can
        // reach the dashboard can stop containers.
        if (status?.writeToken) set('token', t('config.dockerStatusTokenSet', 'Set'), 'good');
        else set('token', status?.control
            ? t('config.dockerStatusTokenMissingRisk', 'Not set — anyone who can reach nextDash can manage containers')
            : t('config.dockerStatusTokenMissing', 'Not set'), status?.control ? 'warn' : 'muted');

        if (status?.selfName) set('self', status.selfName, 'good');
        else set('self', socket
            ? t('config.dockerStatusSelfUnknown', 'Not recognised — nextDash may not run in Docker')
            : '—', 'muted');

        const help = panel.querySelector('[data-docker-status-help]');
        if (!help) return;
        help.replaceChildren();
        help.hidden = socket;
        if (socket) return;
        const hint = document.createElement('p');
        hint.className = 'config-field-hint';
        hint.textContent = denied
            ? t('config.dockerStatusDeniedHelp',
                'The socket is mounted, but the nextdash user may not open it. Recreate the container with this version, which joins the socket\'s group, or set NEXTDASH_RUN_AS_ROOT=1.')
            : t('config.dockerStatusMissingHelp',
                'Mount the Docker socket and set NEXTDASH_DOCKER_SOCKET. On Unraid: a Path row for /var/run/docker.sock and a Variable row for NEXTDASH_DOCKER_SOCKET.');
        help.appendChild(hint);
        if (!denied) {
            const pre = document.createElement('pre');
            pre.className = 'config-docker-snippet';
            pre.textContent = SOCKET_SNIPPET;
            help.appendChild(pre);
        }
        help.appendChild(this.dockerSetupHelpButton());
    },

    /**
     * The view switch works either way, but with no socket the view has
     * nothing to show and its header icon stays away -- a switch that is on
     * and seems to do nothing. So, under it, say why and where the setup is
     * explained. Gone again once the socket answers.
     */
    markDockerViewSwitch(container, socket, denied) {
        container.querySelector('[data-docker-view-note]')?.remove();
        if (socket) return;
        const field = container.querySelector('[data-behavior-field="dockerViewEnabled"]')?.closest('.config-field-row, .config-field');
        if (!field) return;
        const t = (k, f) => this.t(k, f);
        const note = document.createElement('div');
        note.className = 'config-docker-view-note';
        note.setAttribute('data-docker-view-note', '');
        const text = document.createElement('p');
        text.className = 'config-field-hint';
        text.textContent = denied
            ? t('config.dockerViewNoAccess',
                'The Docker socket is mounted, but nextDash may not open it, so the Containers view has nothing to show and its header icon stays hidden. This is usually the case that needs NEXTDASH_RUN_AS_ROOT=1.')
            : t('config.dockerViewNoSocket',
                'The Docker socket is not connected, so the Containers view has nothing to show and its header icon stays hidden. It needs the socket mounted and NEXTDASH_DOCKER_SOCKET set in your compose file or Unraid template.');
        note.append(text, this.dockerSetupHelpButton());
        field.after(note);
    },

    /** Help → Containers → the setup panel, scrolled to. */
    dockerSetupHelpButton() {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'config-btn config-btn--small';
        button.setAttribute('data-docker-setup-help', '');
        button.textContent = this.t('config.dockerSetupHelpButton', 'How to connect it');
        button.addEventListener('click', () => { void this.openContainersSetupHelp(); });
        return button;
    },

    async openContainersSetupHelp() {
        this.helpQuery = '';
        this.helpTab = 'containers';
        await this.openConfigView('help');
        window.location.hash = 'config/help/containers/containers-setup';
        // After the body is in the DOM, or there is nothing to scroll to.
        setTimeout(() => this.openHelpPanelFromHash(), 60);
    },

    bindContainersHidden(container) {
        const panel = container.querySelector('[data-docker-hidden-panel]');
        if (!panel) return;
        const input = panel.querySelector('#config-docker-hide-input');
        const list = () => (Array.isArray(this.dash.settings?.dockerHiddenContainers)
            ? [...this.dash.settings.dockerHiddenContainers] : []);
        const save = async (names) => {
            await this.setBehavior('dockerHiddenContainers', names, '');
            window.DockerSearchIndex?.invalidate?.();
            const fresh = document.createElement('div');
            fresh.innerHTML = this.renderContainersHiddenPanel();
            panel.replaceWith(fresh.firstElementChild);
            this.bindContainersHidden(container);
            container.querySelector('#config-docker-hide-input')?.focus();
        };
        const add = () => {
            const name = String(input?.value || '').trim().replace(/^\//, '');
            if (!name) return;
            const names = list();
            if (!names.includes(name)) names.push(name);
            void save(names);
        };
        panel.querySelector('[data-docker-hide-add]')?.addEventListener('click', add);
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                add();
            }
        });
        panel.querySelectorAll('[data-docker-unhide]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const name = btn.getAttribute('data-docker-unhide');
                void save(list().filter((n) => n !== name));
            });
        });
        // Offered names: what runs now, minus what is already hidden.
        const datalist = panel.querySelector('#config-docker-hide-names');
        if (datalist) {
            void fetch('/api/docker/containers').then((r) => (r.ok ? r.json() : null)).then((body) => {
                if (!datalist.isConnected) return;
                const hidden = new Set(list());
                (body?.containers || []).map((c) => c.name).filter((n) => !hidden.has(n)).sort()
                    .forEach((name) => {
                        const option = document.createElement('option');
                        option.value = name;
                        datalist.appendChild(option);
                    });
            }).catch(() => {});
        }
    },

    bindContainersToken(container) {
        const panel = container.querySelector('[data-docker-token-panel]');
        if (!panel) return;
        const input = panel.querySelector('#config-docker-github-token');
        const state = panel.querySelector('[data-docker-token-state]');
        const removeBtn = panel.querySelector('[data-docker-token-action="remove"]');
        const show = (isSet) => {
            if (state) {
                state.textContent = isSet
                    ? this.t('config.dockerGitHubTokenIsSet', 'A token is saved. It is never shown again.')
                    : this.t('config.dockerGitHubTokenNotSet', 'No token saved.');
            }
            if (removeBtn) removeBtn.hidden = !isSet;
        };
        void fetch('/api/docker/github-token').then((r) => (r.ok ? r.json() : null))
            .then((body) => { if (panel.isConnected) show(body?.set === true); }).catch(() => {});

        const send = async (method, token) => {
            const res = await window.nextDashFetch('/api/docker/github-token', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: method === 'PUT' ? JSON.stringify({ token }) : undefined,
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(text.trim() || String(res.status));
            }
            return res.json();
        };
        panel.querySelector('[data-docker-token-action="save"]')?.addEventListener('click', async () => {
            const token = String(input?.value || '').trim();
            if (!token) {
                input?.focus();
                return;
            }
            try {
                const body = await send('PUT', token);
                if (input) input.value = '';
                show(body?.set === true);
                this.notify(this.t('config.dockerGitHubTokenSaved', 'Token saved.'), 'success');
            } catch (err) {
                this.notify(this.t('config.dockerGitHubTokenFailed', 'The token could not be saved: {reason}')
                    .replace('{reason}', err.message), 'error');
            }
        });
        removeBtn?.addEventListener('click', async () => {
            try {
                await send('DELETE');
                show(false);
                this.notify(this.t('config.dockerGitHubTokenRemoved', 'Token removed.'), 'success');
            } catch (err) {
                this.notify(this.t('config.dockerGitHubTokenFailed', 'The token could not be saved: {reason}')
                    .replace('{reason}', err.message), 'error');
            }
        });
    },

    });

    global.DashboardConfigContainersReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
