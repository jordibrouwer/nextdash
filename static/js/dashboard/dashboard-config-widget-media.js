/**
 * Config → Widgets: the panel every media tile shares (Jellyfin, Sonarr, Radarr).
 *
 * The key is an ordinary widget credential, in the header the service reads,
 * filed by the same Save that files every other widget's key, so it never
 * comes back to the browser. Connect asks the server to try the address and
 * the key on screen; a service that has choices to offer (Jellyfin's users and
 * libraries) draws them from that answer. Those choices are plain widget
 * settings and go through the same draft as every other box.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    const Config = global.DashboardConfig;

    /*
     * What differs per service. The keys under `words` are the ones Jellyfin
     * shipped with in v1.19.4; a later service falls back to the shared
     * config.widgetMedia* keys with its name filled in.
     */
    Config.MEDIA_SERVICES = {
        jellyfin: {
            id: 'jellyfin',
            name: 'Jellyfin',
            header: 'X-Emby-Token',
            placeholder: 'http://jellyfin.local:8096',
            words: {
                server: ['config.widgetJellyfinServer', 'Address'],
                key: ['config.widgetJellyfinKey', 'API key'],
                keyWhere: ['config.widgetJellyfinKeyWhere', 'Dashboard → API Keys in Jellyfin'],
                connect: ['config.widgetJellyfinConnect', 'Connect'],
                connecting: ['config.widgetJellyfinConnecting', 'Connecting…'],
                connected: ['config.widgetJellyfinConnected', 'Connected to {name} ({version}).'],
                'key refused': ['config.widgetJellyfinErrorKey', 'Jellyfin refused that key.'],
                'address not allowed': ['config.widgetJellyfinErrorAddress',
                    'That address is on your local network; allow local addresses first.'],
                'not set up': ['config.widgetJellyfinErrorNotSetUp', 'Fill in the address and the key first.'],
                unreachable: ['config.widgetJellyfinErrorUnreachable', 'Jellyfin could not be reached.'],
            },
            choices(panel, widget, index, setup, config, esc) {
                const id = (name) => `widget-${index}-media-${name}`;
                const userId = String(config.userId || '');
                const none = `<option value="" ${userId ? '' : 'selected'}>${esc(panel.t(
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
                return `
                    <div class="config-widget-field">
                        <label for="${id('user')}">${esc(panel.t('config.widgetJellyfinUser', 'Read as'))}</label>
                        <select id="${id('user')}" class="config-select" data-widget-setting="userId"
                            data-widget-index="${index}" data-widget-kind="text">${users}</select>
                        <span class="config-widget-note">${esc(panel.t('config.widgetJellyfinUserNote',
                            'Optional. A user brings what they may see and what they have watched; without one, nothing is known about watching and "Hide what was watched" does nothing.'))}</span>
                    </div>
                    <div class="config-widget-field">
                        <span class="config-widget-field-label">${esc(panel.t('config.widgetJellyfinLibraries', 'Libraries'))}</span>
                        <div class="config-widget-checkset">${libraries}</div>
                    </div>`;
            },
            // A user is optional: the key alone lists every library. One that
            // no longer exists is dropped rather than kept as a choice nobody
            // can see.
            connected(draft, answer) {
                const users = answer.users || [];
                if (draft.config.userId && !users.some((user) => user.id === draft.config.userId)) {
                    delete draft.config.userId;
                }
            },
        },
    };

    // Sonarr and Radarr: a key and an address, nothing to choose after Connect.
    [['sonarr', 'Sonarr', 'http://sonarr.local:8989'], ['radarr', 'Radarr', 'http://radarr.local:7878']]
        .forEach(([id, name, placeholder]) => {
            Config.MEDIA_SERVICES[id] = { id, name, header: 'X-Api-Key', placeholder, words: {} };
        });

    const SHARED_WORDS = {
        server: ['config.widgetMediaServer', 'Address'],
        key: ['config.widgetMediaKey', 'API key'],
        keyWhere: ['config.widgetMediaKeyWhere', 'Settings → General → API Key in {name}'],
        connect: ['config.widgetMediaConnect', 'Connect'],
        connecting: ['config.widgetMediaConnecting', 'Connecting…'],
        connected: ['config.widgetMediaConnected', 'Connected to {name} ({version}).'],
        'key refused': ['config.widgetMediaErrorKey', '{name} refused that key.'],
        'address not allowed': ['config.widgetMediaErrorAddress',
            'That address is on your local network; allow local addresses first.'],
        'not set up': ['config.widgetMediaErrorNotSetUp', 'Fill in the address and the key first.'],
        unreachable: ['config.widgetMediaErrorUnreachable', '{name} could not be reached.'],
    };

    Object.assign(Config.prototype, {

    mediaWord(service, key, name = service.name) {
        const [i18n, fallback] = service.words?.[key] || SHARED_WORDS[key] || SHARED_WORDS.unreachable;
        return this.t(i18n, fallback).replace('{name}', name);
    },

    /** The panel's answer from Connect, per widget, for as long as config is open. */
    mediaSetupFor(block) {
        this._mediaSetup = this._mediaSetup || {};
        return this._mediaSetup[block?.id] || null;
    },

    /** The sign-in is always an API key in one header; there is nothing to pick. */
    ensureMediaAuth(index, service) {
        const draft = this.widgetDraft(index);
        if (!draft) return;
        if (draft.auth?.kind !== 'header' || draft.auth?.headerName !== service.header) {
            draft.auth = { kind: 'header', headerName: service.header, secret: draft.auth?.secret || '' };
        }
    },

    renderMediaSettings(widget, index, rows, service) {
        const esc = (v) => this.dash.escapeHtml(v);
        this.ensureMediaAuth(index, service);
        const draft = this.widgetDraft(index);
        const config = draft?.config || widget.config || {};
        const keyIsSaved = draft?.auth?.saved === true;
        const setup = this.mediaSetupFor(widget);
        const id = (name) => `widget-${index}-media-${name}`;

        let status = '';
        if (setup?.error) {
            status = this.mediaWord(service, setup.error);
        } else if (setup) {
            // The server's own name ("Home"), not the product's.
            status = this.mediaWord(service, 'connected', setup.serverName || service.name)
                .replace('{version}', setup.version || '');
        }

        let choices = '';
        if (setup && !setup.error && typeof service.choices === 'function') {
            choices = service.choices(this, widget, index, setup, config, esc);
        } else if (!setup && keyIsSaved && config.server) {
            // A saved widget opens with its choices already on screen: asked
            // once per widget and session, with the key the server holds.
            // Only once the reader has opened it: a wide config shows the first
            // widget by default, and that alone must not reach out to a server.
            this._mediaAsked = this._mediaAsked || {};
            if (this.widgetIsChosen(widget) && !this._mediaAsked[widget.id]) {
                this._mediaAsked[widget.id] = true;
                setTimeout(() => void this.connectMedia(index), 0);
            }
        }

        return `<div class="config-widget-settings-body is-custom is-media is-${esc(service.id)}">
            <div class="config-custom-group">
                <h4 class="config-custom-group-title">${esc(service.name)}</h4>
                <div class="config-custom-grid">
                    <div class="config-widget-field">
                        <label for="${id('server')}">${esc(this.mediaWord(service, 'server'))}</label>
                        <input type="text" id="${id('server')}" class="config-text" maxlength="2000"
                            data-widget-setting="server" data-widget-index="${index}" data-widget-kind="text"
                            value="${esc(config.server || '')}" placeholder="${esc(service.placeholder || '')}">
                    </div>
                    <div class="config-widget-field">
                        <label for="${id('key')}">${esc(this.mediaWord(service, 'key'))}</label>
                        <input type="password" id="${id('key')}" class="config-text" autocomplete="off"
                            spellcheck="false" maxlength="1024"
                            data-widget-auth="secret" data-widget-index="${index}"
                            placeholder="${esc(keyIsSaved
                                ? this.t('config.widgetAuthKept', 'Set — type to replace')
                                : this.mediaWord(service, 'keyWhere'))}">
                    </div>
                </div>
                <div class="config-widget-field">
                    <button type="button" class="config-btn config-btn--small"
                        data-media-connect="${index}">${esc(this.mediaWord(service, 'connect'))}</button>
                    <span class="config-widget-note" data-media-status role="status">${esc(status)}</span>
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

    async connectMedia(index) {
        const block = (this._widgetBlocks || [])[index];
        const service = Config.MEDIA_SERVICES[block?.type];
        const draft = this.widgetDraft(index);
        if (!block || !draft || !service) return;
        this.ensureMediaAuth(index, service);
        const secret = String(draft.auth?.secret || '').trim();
        const payload = { server: String(draft.config?.server || '') };
        if (secret) payload.draftCredential = { headers: { [service.header]: secret } };
        else payload.credentialId = block.config?.credentialId || this.widgetCredentialId(block);

        const status = document.querySelector(`[data-media-connect="${index}"]`)
            ?.parentElement?.querySelector('[data-media-status]');
        if (status) status.textContent = this.mediaWord(service, 'connecting');
        let answer;
        try {
            const res = await this.writeFetch(`/api/widgets/${service.id}/setup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            answer = res.ok ? await res.json() : { error: 'unreachable' };
        } catch (_error) {
            answer = { error: 'unreachable' };
        }
        this._mediaSetup = this._mediaSetup || {};
        this._mediaSetup[block.id] = answer;
        if (!answer.error) service.connected?.(draft, answer);

        this.repaintWidgetsBody();
        // The redraw empties the key box and the draft still holds what was
        // typed; put it back, or the reader sees nothing where a key is.
        const box = document.querySelector(`[data-widget-auth="secret"][data-widget-index="${index}"]`);
        if (box && secret) box.value = secret;
        this.refreshWidgetSaveBar?.(index);
    },

    });

    global.DashboardConfigMediaReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
