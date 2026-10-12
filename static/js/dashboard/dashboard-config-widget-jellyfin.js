/**
 * Config → Widgets: the Jellyfin panel.
 *
 * The key is an ordinary widget credential (X-Emby-Token), filed by the same
 * Save that files every other widget's key, so it never comes back to the
 * browser. Connect asks the server to try the address and the key on screen,
 * and the answer -- who can be read as, which libraries exist -- fills the
 * choices below it. Those choices are plain widget settings and go through the
 * same draft as every other box.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    const HEADER = 'X-Emby-Token';

    Object.assign(global.DashboardConfig.prototype, {

    /** The panel's answer from Connect, per widget, for as long as config is open. */
    jellyfinSetupFor(block) {
        this._jellyfinSetup = this._jellyfinSetup || {};
        return this._jellyfinSetup[block?.id] || null;
    },

    /** The sign-in is always an API key in one header; there is nothing to pick. */
    ensureJellyfinAuth(index) {
        const draft = this.widgetDraft(index);
        if (!draft) return;
        if (draft.auth?.kind !== 'header' || draft.auth?.headerName !== HEADER) {
            draft.auth = { kind: 'header', headerName: HEADER, secret: draft.auth?.secret || '' };
        }
    },

    renderJellyfinSettings(widget, index, rows) {
        const esc = (v) => this.dash.escapeHtml(v);
        this.ensureJellyfinAuth(index);
        const draft = this.widgetDraft(index);
        const config = draft?.config || widget.config || {};
        const keyIsSaved = draft?.auth?.saved === true;
        const setup = this.jellyfinSetupFor(widget);
        const id = (name) => `widget-${index}-jellyfin-${name}`;

        const errorWords = {
            'key refused': ['config.widgetJellyfinErrorKey', 'Jellyfin refused that key.'],
            'address not allowed': ['config.widgetJellyfinErrorAddress',
                'That address is on your local network; allow local addresses first.'],
            'not set up': ['config.widgetJellyfinErrorNotSetUp', 'Fill in the address and the key first.'],
        };
        let status = '';
        if (setup?.error) {
            status = this.t(...(errorWords[setup.error]
                || ['config.widgetJellyfinErrorUnreachable', 'Jellyfin could not be reached.']));
        } else if (setup) {
            status = this.t('config.widgetJellyfinConnected', 'Connected to {name} ({version}).')
                .replace('{name}', setup.serverName || 'Jellyfin').replace('{version}', setup.version || '');
        }

        let choices = '';
        if (setup && !setup.error) {
            const userId = String(config.userId || '');
            const none = `<option value="" ${userId ? '' : 'selected'}>${esc(this.t(
                'config.widgetJellyfinNoUser', 'No one — the newest of everything'))}</option>`;
            const users = none + (setup.users || []).map((user) => `<option value="${esc(user.id)}" ${
                user.id === userId ? 'selected' : ''}>${esc(user.name)}</option>`).join('');
            const chosen = Array.isArray(config.libraries) ? config.libraries : null;
            const libraries = (setup.libraries || []).map((lib) => `
                <label class="config-toggle config-toggle--inline">
                    <input type="checkbox" data-widget-setting="libraries" data-widget-index="${index}"
                        data-widget-kind="checkset" value="${esc(lib.id)}"
                        ${!chosen || chosen.includes(lib.id) ? 'checked' : ''}>
                    <span>${esc(lib.name)}</span>
                </label>`).join('');
            choices = `
                <div class="config-widget-field">
                    <label for="${id('user')}">${esc(this.t('config.widgetJellyfinUser', 'Read as'))}</label>
                    <select id="${id('user')}" class="config-select" data-widget-setting="userId"
                        data-widget-index="${index}" data-widget-kind="text">${users}</select>
                    <span class="config-widget-note">${esc(this.t('config.widgetJellyfinUserNote',
                        'Optional. A user brings what they may see and what they have watched; without one, nothing is known about watching and "Hide what was watched" does nothing.'))}</span>
                </div>
                <div class="config-widget-field">
                    <span class="config-widget-field-label">${esc(this.t('config.widgetJellyfinLibraries', 'Libraries'))}</span>
                    <div class="config-widget-checkset">${libraries}</div>
                </div>`;
        } else if (!setup && keyIsSaved && config.server) {
            // A saved widget opens with its choices already on screen: asked
            // once per widget and session, with the key the server holds.
            // Only once the reader has opened it: a wide config shows the first
            // widget by default, and that alone must not reach out to a server.
            this._jellyfinAsked = this._jellyfinAsked || {};
            if (this.widgetIsChosen(widget) && !this._jellyfinAsked[widget.id]) {
                this._jellyfinAsked[widget.id] = true;
                setTimeout(() => void this.connectJellyfin(index), 0);
            }
        }

        return `<div class="config-widget-settings-body is-custom is-jellyfin">
            <div class="config-custom-group">
                <h4 class="config-custom-group-title">Jellyfin</h4>
                <div class="config-custom-grid">
                    <div class="config-widget-field">
                        <label for="${id('server')}">${esc(this.t('config.widgetJellyfinServer', 'Address'))}</label>
                        <input type="text" id="${id('server')}" class="config-text" maxlength="2000"
                            data-widget-setting="server" data-widget-index="${index}" data-widget-kind="text"
                            value="${esc(config.server || '')}" placeholder="http://jellyfin.local:8096">
                    </div>
                    <div class="config-widget-field">
                        <label for="${id('key')}">${esc(this.t('config.widgetJellyfinKey', 'API key'))}</label>
                        <input type="password" id="${id('key')}" class="config-text" autocomplete="off"
                            spellcheck="false" maxlength="1024"
                            data-widget-auth="secret" data-widget-index="${index}"
                            placeholder="${esc(keyIsSaved
                                ? this.t('config.widgetAuthKept', 'Set — type to replace')
                                : this.t('config.widgetJellyfinKeyWhere', 'Dashboard → API Keys in Jellyfin'))}">
                    </div>
                </div>
                <div class="config-widget-field">
                    <button type="button" class="config-btn config-btn--small"
                        data-jellyfin-connect="${index}">${esc(this.t('config.widgetJellyfinConnect', 'Connect'))}</button>
                    <span class="config-widget-note" data-jellyfin-status role="status">${esc(status)}</span>
                </div>
                ${choices}
            </div>
            <div class="config-custom-group">
                <h4 class="config-custom-group-title">${esc(this.t('config.widgetCustomOnTheGrid', 'On the dashboard'))}</h4>
                <div class="config-custom-grid">${this.renderWidgetPage(widget, index)}${
                    this.renderWidgetWidth(widget, index)}${rows}</div>
            </div>
            ${this.renderWidgetSaveBar(index)}
        </div>`;
    },

    async connectJellyfin(index) {
        const block = (this._widgetBlocks || [])[index];
        const draft = this.widgetDraft(index);
        if (!block || !draft) return;
        this.ensureJellyfinAuth(index);
        const secret = String(draft.auth?.secret || '').trim();
        const payload = { server: String(draft.config?.server || '') };
        if (secret) payload.draftCredential = { headers: { [HEADER]: secret } };
        else payload.credentialId = block.config?.credentialId || this.widgetCredentialId(block);

        const status = document.querySelector(`[data-jellyfin-connect="${index}"]`)
            ?.parentElement?.querySelector('[data-jellyfin-status]');
        if (status) status.textContent = this.t('config.widgetJellyfinConnecting', 'Connecting…');
        let answer;
        try {
            const res = await this.writeFetch('/api/widgets/jellyfin/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            answer = res.ok ? await res.json() : { error: 'unreachable' };
        } catch (_error) {
            answer = { error: 'unreachable' };
        }
        this._jellyfinSetup = this._jellyfinSetup || {};
        this._jellyfinSetup[block.id] = answer;

        // A user is optional: the key alone lists every library. One that no
        // longer exists is dropped rather than kept as a choice nobody can see.
        const users = answer.users || [];
        if (!answer.error && draft.config.userId && !users.some((user) => user.id === draft.config.userId)) {
            delete draft.config.userId;
        }
        this.repaintWidgetsBody();
        // The redraw empties the key box and the draft still holds what was
        // typed; put it back, or the reader sees nothing where a key is.
        const box = document.querySelector(`[data-widget-auth="secret"][data-widget-index="${index}"]`);
        if (box && secret) box.value = secret;
        this.refreshWidgetSaveBar?.(index);
    },

    });

    global.DashboardConfigJellyfinReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
