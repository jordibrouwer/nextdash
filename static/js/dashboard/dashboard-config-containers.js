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
            ${this.renderSectionTabNote('containers', this.containersTab)}
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
                return `${schema()}${this.renderContainersIgnoredPanel()}${this.renderContainersHiddenPanel()}`;
            case 'updates':
                return `${schema()}${this.renderContainersTokenPanel()}`;
            case 'alerts':
                return `${schema()}${this.renderContainersMutedPanel()}`;
            default:
                return `${this.renderContainersStatusPanel()}${this.renderContainersHostsPanel()}${schema()}`;
        }
    },

    /** Redraw the body for the tab now chosen, the strip left as it is. */
    repaintContainersBody() {
        const body = document.getElementById('config-containers-body');
        if (!body) return;
        body.innerHTML = this.renderContainersBody();
        this.syncSectionTabNote('containers', this.containersTab, body.closest('.config-tabpage')?.parentElement);
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
                ${row('compose', this.t('config.dockerStatusCompose', 'Compose files'))}
                <div data-docker-status-help hidden></div>
            </div>`;
    },

    /**
     * The apps turned down, one row each. The server keeps this list itself
     * (a stale page must not undo an Ignore), so Remove goes through its own
     * route instead of the settings save.
     */
    renderContainersIgnoredPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        const names = Array.isArray(this.dash.settings?.discoveryIgnored) ? this.dash.settings.discoveryIgnored : [];
        const rows = names.map((name) => `
            <div class="config-field">
                <span class="config-field-label">${esc(name)}</span>
                <button type="button" class="config-btn" data-discovery-unignore="${esc(name)}"
                        aria-label="${esc(this.t('config.discoveryUnignoreLabel', 'Suggest {name} again').replace('{name}', name))}">${esc(this.t('config.discoveryUnignore', 'Remove'))}</button>
            </div>`).join('');
        const empty = names.length ? '' : `<p class="config-field-hint">${esc(this.t('config.discoveryIgnoredNone', 'No app is ignored.'))}</p>`;
        return `
            <div class="config-panel" data-discovery-ignored-panel>
                <h3 class="config-panel-title">${esc(this.t('config.containersGroupIgnored', 'Ignored apps'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.containersGroupIgnoredNote', 'Never suggested again. Remove one to let nextDash notice it anew.'))}</p>
                ${rows}${empty}
            </div>`;
    },

    bindContainersIgnored(container) {
        const panel = container.querySelector('[data-discovery-ignored-panel]');
        if (!panel) return;
        panel.querySelectorAll('[data-discovery-unignore]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const name = btn.getAttribute('data-discovery-unignore');
                btn.disabled = true;
                try {
                    const res = await window.nextDashFetch('/api/discovery/unignore', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name }),
                    });
                    if (!res.ok) throw new Error(String(res.status));
                    const left = (this.dash.settings?.discoveryIgnored || []).filter((n) => n !== name);
                    this.dash.settings.discoveryIgnored = left;
                    const fresh = document.createElement('div');
                    fresh.innerHTML = this.renderContainersIgnoredPanel();
                    panel.replaceWith(fresh.firstElementChild);
                    this.bindContainersIgnored(container);
                } catch {
                    btn.disabled = false;
                    this.notify(this.t('config.discoveryUnignoreFailed', 'Could not remove it. Try again.'), 'error');
                }
            });
        });
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
                'Nothing receives them yet: set a webhook under Monitoring → Notifications → Downtime alerts, or switch on browser notifications with Containers.'))}</p>`;
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

    /**
     * The Docker hosts besides this one. Drawn empty here and filled from
     * /api/docker/hosts, which never sends a certificate back: a part that is
     * saved shows as "saved", and a field left empty on Edit keeps it.
     */
    renderContainersHostsPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <div class="config-panel" data-docker-hosts-panel>
                <div class="config-docker-hosts-head">
                    <h3 class="config-panel-title">${esc(this.t('config.dockerHostsTitle', 'Other Docker hosts'))}</h3>
                    <button type="button" class="config-btn config-btn--small" data-docker-host-add>${esc(this.t('config.dockerHostsAdd', 'Add a host'))}</button>
                </div>
                <p class="config-panel-note">${esc(this.t('config.dockerHostsNote',
                    'Containers on other machines show in the Containers view as a tab each. Reach a host through a Docker socket proxy (tcp) or the daemon\'s own TLS. Actions stay off for a host until you switch them on here.'))}</p>
                <div class="config-docker-hosts-list" data-docker-hosts-list></div>
                <div data-docker-hosts-form></div>
            </div>`;
    },

    dockerHostReasonText(reason) {
        const map = {
            refused: ['config.dockerHostRefused', 'The host refused the connection. Is the Docker API, or the socket proxy in front of it, listening on that port?'],
            timeout: ['config.dockerHostTimeout', 'The host did not answer in time.'],
            'tls-untrusted': ['config.dockerHostTlsUntrusted', 'The host\'s certificate is not signed by the CA saved for it.'],
            'tls-rejected': ['config.dockerHostTlsRejected', 'The host turned the client certificate down, or wants one.'],
            'wrong-protocol': ['config.dockerHostWrongProtocol', 'The host speaks plain HTTP. Use the tcp kind for it, not tls.'],
            'tls-config': ['config.dockerHostTlsConfig', 'The certificate settings are not valid.'],
            'containers-denied': ['config.dockerHostContainersDenied', 'The host answers, but does not allow listing containers. If a socket proxy is in front of it, switch CONTAINERS on there.'],
            denied: ['config.dockerHostDenied', 'The host answered, but refused this request.'],
            'not-docker': ['config.dockerHostNotDocker', 'Something answered, but it is not a Docker API.'],
        };
        const [key, fallback] = map[reason] || ['config.dockerHostUnreachable', 'The host cannot be reached.'];
        return this.t(key, fallback);
    },

    bindContainersHosts(container) {
        const panel = container.querySelector('[data-docker-hosts-panel]');
        if (!panel) return;
        const esc = (v) => this.dash.escapeHtml(v);
        const listEl = panel.querySelector('[data-docker-hosts-list]');
        const formEl = panel.querySelector('[data-docker-hosts-form]');
        const addBtn = panel.querySelector('[data-docker-host-add]');
        let hosts = [];
        let max = 4;

        const call = async (method, path, body) => {
            const res = await window.nextDashFetch(path, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const text = await res.text();
            let json = null;
            try { json = JSON.parse(text); } catch { /* a plain-text error */ }
            return { ok: res.ok, status: res.status, json, text: text.trim() };
        };

        const load = async () => {
            try {
                const res = await fetch('/api/docker/hosts', { cache: 'no-store' });
                const body = res.ok ? await res.json() : null;
                hosts = Array.isArray(body?.hosts) ? body.hosts : [];
                max = Number(body?.max) || 4;
            } catch {
                hosts = [];
            }
            if (!panel.isConnected) return;
            paintList();
        };

        const paintList = () => {
            if (addBtn) addBtn.hidden = hosts.length >= max;
            if (!hosts.length) {
                listEl.innerHTML = `<p class="config-field-hint">${esc(this.t('config.dockerHostsNone', 'No other host yet.'))}</p>`;
                return;
            }
            listEl.innerHTML = hosts.map((h) => {
                const certs = h.kind === 'tls'
                    ? [h.hasCA ? 'CA' : '', h.hasCert && h.hasKey ? this.t('config.dockerHostClientCert', 'client certificate') : '']
                        .filter(Boolean).join(' + ')
                    : '';
                return `
                <div class="config-docker-host" data-docker-host-row="${esc(h.id)}">
                    <div class="config-docker-host-name">
                        <strong>${esc(h.name)}</strong>
                        <span>${esc(h.kind)} · ${esc(h.address)}${certs ? ` · ${esc(certs)}` : ''}</span>
                        <span class="config-docker-host-result" data-docker-host-result="${esc(h.id)}" aria-live="polite"></span>
                    </div>
                    <label class="config-docker-host-actions">
                        <input type="checkbox" data-docker-host-actions="${esc(h.id)}" ${h.allowActions ? 'checked' : ''}>
                        ${esc(this.t('config.dockerHostAllowActions', 'Allow actions'))}
                    </label>
                    <div class="config-docker-host-buttons">
                        <button type="button" class="config-btn config-btn--small" data-docker-host-test="${esc(h.id)}">${esc(this.t('config.dockerHostTest', 'Test'))}</button>
                        <button type="button" class="config-btn config-btn--small" data-docker-host-edit="${esc(h.id)}">${esc(this.t('config.dockerHostEdit', 'Edit'))}</button>
                        <button type="button" class="config-btn config-btn--small config-btn--danger" data-docker-host-remove="${esc(h.id)}">${esc(this.t('config.dockerHostRemove', 'Remove'))}</button>
                    </div>
                </div>`;
            }).join('');
        };

        const showProbe = (el, probe) => {
            if (!el) return;
            el.dataset.state = probe.ok ? 'ok' : 'bad';
            el.textContent = probe.ok
                ? `✓ ${probe.version ? this.t('config.dockerHostReachableVersion', 'Docker {version}').replace('{version}', probe.version) : this.t('config.dockerHostReachable', 'Reachable')}`
                : this.dockerHostReasonText(probe.reason);
        };

        const closeForm = () => { formEl.innerHTML = ''; };

        const openForm = (host) => {
            const editing = Boolean(host);
            const h = host || { name: '', kind: 'tcp', address: '', allowActions: false };
            const secretHint = (isSet) => (isSet
                ? this.t('config.dockerHostPemKeep', 'Saved. Paste to replace, leave empty to keep.')
                : this.t('config.dockerHostPemEmpty', 'PEM'));
            formEl.innerHTML = `
                <form class="config-docker-host-form" data-docker-host-form novalidate>
                    <div class="config-field">
                        <label class="config-field-label" for="config-docker-host-name">${esc(this.t('config.dockerHostName', 'Name'))}</label>
                        <input type="text" id="config-docker-host-name" class="config-text" data-docker-host-field="name" maxlength="64"
                               autocomplete="off" value="${esc(h.name)}">
                    </div>
                    <div class="config-field">
                        <label class="config-field-label" for="config-docker-host-kind">${esc(this.t('config.dockerHostKind', 'Connection'))}</label>
                        <select id="config-docker-host-kind" class="config-select" data-docker-host-field="kind">
                            <option value="tcp" ${h.kind === 'tcp' ? 'selected' : ''}>${esc(this.t('config.dockerHostKindTcp', 'tcp (socket proxy)'))}</option>
                            <option value="tls" ${h.kind === 'tls' ? 'selected' : ''}>${esc(this.t('config.dockerHostKindTls', 'tls (certificates)'))}</option>
                        </select>
                    </div>
                    <div class="config-field">
                        <label class="config-field-label" for="config-docker-host-address">${esc(this.t('config.dockerHostAddress', 'Address'))}</label>
                        <input type="text" id="config-docker-host-address" class="config-text" data-docker-host-field="address"
                               autocomplete="off" spellcheck="false" placeholder="192.168.1.20:2375" value="${esc(h.address)}">
                    </div>
                    <div data-docker-host-tls ${h.kind === 'tls' ? '' : 'hidden'}>
                        ${[['ca', 'config.dockerHostCa', 'CA certificate', h.hasCA],
                            ['cert', 'config.dockerHostCert', 'Client certificate', h.hasCert],
                            ['key', 'config.dockerHostKey', 'Client key', h.hasKey]].map(([field, key, label, isSet]) => `
                        <div class="config-field">
                            <label class="config-field-label" for="config-docker-host-${field}">${esc(this.t(key, label))}</label>
                            <textarea id="config-docker-host-${field}" class="config-text" rows="3" spellcheck="false" autocomplete="off"
                                      data-docker-host-field="${field}" placeholder="${esc(secretHint(isSet))}"></textarea>
                            ${isSet ? `<label class="config-field-hint config-docker-host-clear">
                                <input type="checkbox" data-docker-host-clear="${field}">
                                ${esc(this.t('config.dockerHostPemClear', 'Remove the saved one'))}
                            </label>` : ''}
                        </div>`).join('')}
                    </div>
                    <div class="config-field">
                        <label class="config-docker-host-actions">
                            <input type="checkbox" data-docker-host-field="allowActions" ${h.allowActions ? 'checked' : ''}>
                            ${esc(this.t('config.dockerHostAllowActions', 'Allow actions'))}
                        </label>
                    </div>
                    <p class="config-field-hint" data-docker-host-error role="alert" hidden></p>
                    <div class="config-actions">
                        <button type="submit" class="config-btn config-btn--primary" data-docker-host-save>${esc(editing ? this.t('config.dockerHostSave', 'Save') : this.t('config.dockerHostAddSave', 'Add host'))}</button>
                        <button type="button" class="config-btn" data-docker-host-form-test>${esc(this.t('config.dockerHostTest', 'Test'))}</button>
                        <button type="button" class="config-btn" data-docker-host-cancel>${esc(this.t('config.dockerHostCancel', 'Cancel'))}</button>
                        <span class="config-docker-host-result" data-docker-host-form-result aria-live="polite"></span>
                    </div>
                </form>`;
            const form = formEl.querySelector('form');
            const field = (name) => form.querySelector(`[data-docker-host-field="${name}"]`);
            const errorEl = form.querySelector('[data-docker-host-error]');
            field('kind').addEventListener('change', () => {
                form.querySelector('[data-docker-host-tls]').hidden = field('kind').value !== 'tls';
            });
            // A pasted PEM is only sent when something was typed: empty keeps what is saved.
            const body = () => {
                const out = {
                    name: field('name').value, kind: field('kind').value, address: field('address').value,
                    allowActions: field('allowActions').checked,
                };
                if (out.kind === 'tls') {
                    ['ca', 'cert', 'key'].forEach((f) => {
                        // Typed replaces, ticked removes (an empty string), neither keeps.
                        if (field(f).value.trim()) out[f] = field(f).value;
                        else if (form.querySelector(`[data-docker-host-clear="${f}"]`)?.checked) out[f] = '';
                    });
                }
                return out;
            };
            form.querySelector('[data-docker-host-cancel]').addEventListener('click', closeForm);
            form.querySelector('[data-docker-host-form-test]').addEventListener('click', async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                const r = await call('POST', '/api/docker/hosts/test', { ...body(), ...(editing ? { id: host.id } : {}) });
                btn.disabled = false;
                if (r.ok && r.json) showProbe(form.querySelector('[data-docker-host-form-result]'), r.json);
                else {
                    errorEl.hidden = false;
                    errorEl.textContent = r.text || this.t('config.dockerHostFailed', 'That did not work. Try again.');
                }
            });
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                errorEl.hidden = true;
                const save = form.querySelector('[data-docker-host-save]');
                save.disabled = true;
                const r = editing
                    ? await call('PUT', `/api/docker/hosts/${encodeURIComponent(host.id)}`, body())
                    : await call('POST', '/api/docker/hosts', body());
                save.disabled = false;
                if (!r.ok) {
                    errorEl.hidden = false;
                    errorEl.textContent = r.text || this.t('config.dockerHostFailed', 'That did not work. Try again.');
                    return;
                }
                closeForm();
                await load();
            });
            field('name').focus();
        };

        addBtn?.addEventListener('click', () => openForm(null));

        // One listener on the list, so a repaint needs no rebinding.
        listEl.addEventListener('click', async (e) => {
            const target = e.target instanceof Element ? e.target : null;
            const id = (attr) => target?.closest(`[${attr}]`)?.getAttribute(attr);
            const testId = id('data-docker-host-test');
            if (testId) {
                const btn = target.closest('button');
                btn.disabled = true;
                const r = await call('POST', '/api/docker/hosts/test', { id: testId });
                btn.disabled = false;
                const out = listEl.querySelector(`[data-docker-host-result="${CSS.escape(testId)}"]`);
                if (r.ok && r.json) showProbe(out, r.json);
                else if (out) {
                    out.dataset.state = 'bad';
                    out.textContent = r.text || this.t('config.dockerHostFailed', 'That did not work. Try again.');
                }
                return;
            }
            const editId = id('data-docker-host-edit');
            if (editId) {
                openForm(hosts.find((h) => h.id === editId));
                return;
            }
            const removeId = id('data-docker-host-remove');
            if (removeId) {
                const h = hosts.find((x) => x.id === removeId);
                const message = this.t('config.dockerHostRemoveMessage', 'Its tab goes away and its certificates are deleted. The containers on that host are not touched.');
                const modal = global.AppModal;
                const ok = typeof modal?.confirm === 'function'
                    ? await modal.confirm({
                        title: this.t('config.dockerHostRemoveTitle', 'Remove {name}?').replace('{name}', h?.name || ''),
                        message,
                        confirmText: this.t('config.dockerHostRemove', 'Remove'),
                        cancelText: this.t('config.dockerHostCancel', 'Cancel'),
                    })
                    : global.confirm(message);
                if (!ok) return;
                const r = await call('DELETE', `/api/docker/hosts/${encodeURIComponent(removeId)}`);
                if (!r.ok) this.notify(r.text || this.t('config.dockerHostFailed', 'That did not work. Try again.'), 'error');
                closeForm();
                await load();
            }
        });
        listEl.addEventListener('change', async (e) => {
            const box = e.target instanceof Element ? e.target.closest('[data-docker-host-actions]') : null;
            if (!box) return;
            const h = hosts.find((x) => x.id === box.getAttribute('data-docker-host-actions'));
            if (!h) return;
            const r = await call('PUT', `/api/docker/hosts/${encodeURIComponent(h.id)}`, {
                name: h.name, kind: h.kind, address: h.address, allowActions: box.checked,
            });
            if (!r.ok) {
                box.checked = !box.checked;
                this.notify(r.text || this.t('config.dockerHostFailed', 'That did not work. Try again.'), 'error');
                return;
            }
            await load();
        });

        void load();
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
        this.bindContainersHosts(container);
        this.bindContainersHidden(container);
        this.bindContainersIgnored(container);
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

        // The folders the stack panel may read: NEXTDASH_COMPOSE_MAP as the server resolved it.
        const maps = Array.isArray(status?.compose?.map) ? status.compose.map : [];
        const rejected = Array.isArray(status?.compose?.rejected) ? status.compose.rejected : [];
        if (!socket) set('compose', '—', 'muted');
        else if (maps.length) {
            const list = maps.map((m) => `${m.host} → ${m.container}`).join(', ');
            const note = rejected.length ? ` · ${t('config.dockerStatusComposeRejected', 'ignored')}: ${rejected.join(', ')}` : '';
            set('compose', `${list}${note}`, rejected.length ? 'warn' : 'good');
        } else if (rejected.length) {
            set('compose', `${t('config.dockerStatusComposeRejectedAll', 'Not usable')}: ${rejected.join(', ')}`, 'warn');
        } else {
            set('compose', t('config.dockerStatusComposeNone', 'No folders mapped: stack files are not shown. Set NEXTDASH_COMPOSE_MAP and mount the folder.'), 'muted');
        }

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
                'Mount the Docker socket and set NEXTDASH_DOCKER_SOCKET. On Unraid, add a Path row and a Variable row.');
        help.appendChild(hint);
        if (!denied) {
            // Folded: the lines are for the one time you set it up, and the
            // status above is what you came to read.
            const fold = document.createElement('details');
            fold.className = 'config-docker-snippet-fold';
            const summary = document.createElement('summary');
            summary.textContent = t('config.dockerSnippetSummary', 'Compose lines');
            const pre = document.createElement('pre');
            pre.className = 'config-docker-snippet';
            pre.textContent = SOCKET_SNIPPET;
            fold.append(summary, pre);
            help.appendChild(fold);
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
