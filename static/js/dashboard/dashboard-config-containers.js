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

    Object.assign(global.DashboardConfig.prototype, {

    renderContainersSection() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <p class="config-view-intro">${esc(this.t('config.containersIntro',
                'The Containers view: what it can reach, how often it looks, and what it leaves out. Every change applies immediately and is saved.'))}</p>
            <div class="config-tabpage">
                <div class="config-tabpage-main" id="config-containers-body">
                    ${this.renderContainersStatusPanel()}
                    ${this.renderControlPanels(this.panelsFor('containers', 'general'), 'behavior')}
                    ${this.renderContainersHiddenPanel()}
                    ${this.renderContainersTokenPanel()}
                </div>
            </div>
        `;
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
                    <input type="text" id="config-docker-hide-input" class="config-text" list="config-docker-hide-names"
                           autocomplete="off" spellcheck="false"
                           placeholder="${esc(this.t('config.dockerHidePlaceholder', 'Container name'))}">
                    <datalist id="config-docker-hide-names"></datalist>
                    <button type="button" class="config-btn" data-docker-hide-add>${esc(this.t('config.dockerHideAdd', 'Hide'))}</button>
                </div>
            </div>`;
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
        void this.fillContainersStatus(container);
        this.bindContainersHidden(container);
        this.bindContainersToken(container);
    },

    async fillContainersStatus(container) {
        let status = null;
        try {
            const res = await fetch('/api/docker/status');
            status = res.ok ? await res.json() : null;
        } catch {
            status = null;
        }
        const panel = container.querySelector('[data-docker-status-panel]');
        if (!panel || !panel.isConnected) return;
        const set = (key, text, tone) => {
            const el = panel.querySelector(`[data-docker-state="${key}"]`);
            if (!el) return;
            el.textContent = text;
            el.setAttribute('data-tone', tone);
        };
        const t = (k, f) => this.t(k, f);
        const socket = status?.socket === true;
        const denied = status?.reason === 'docker-socket-denied';
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
