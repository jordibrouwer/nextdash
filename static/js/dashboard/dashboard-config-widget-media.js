/**
 * Config → Widgets: the panel every media tile shares (Jellyfin, Sonarr, Radarr,
 * Seerr, qBittorrent, SABnzbd).
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

    /*
     * Seerr: whose requests to show is chosen from the users Connect lists.
     *
     * Its key is base64 and ends in "==" -- the part a double-click to copy
     * leaves behind, and without it Seerr answers 403 as to a wrong key. The
     * padding is put back here, because a key that is base64 apart from its
     * padding can only mean that.
     */
    Config.MEDIA_SERVICES.seerr = {
        id: 'seerr',
        name: 'Seerr',
        header: 'X-Api-Key',
        placeholder: 'http://seerr.local:5055',
        words: {
            keyWhere: ['config.widgetSeerrKeyWhere', 'Settings → General → API Key in Seerr, with the == at the end'],
        },
        normalizeKey(key) {
            if (!/^[A-Za-z0-9+/]+$/.test(key) || key.length % 4 === 0) return key;
            return key + '='.repeat(4 - (key.length % 4));
        },
        choices(panel, widget, index, setup, config, esc) {
            const chosen = String(config.requestedBy || '');
            const everyone = `<option value="" ${chosen ? '' : 'selected'}>${esc(panel.t(
                'config.widgetSeerrEveryone', 'Everyone'))}</option>`;
            const users = everyone + (setup.users || []).map((user) => `<option value="${esc(user.id)}" ${
                user.id === chosen ? 'selected' : ''}>${esc(user.name)}</option>`).join('');
            return `
                <div class="config-widget-field">
                    <label for="widget-${index}-media-requester">${esc(panel.t('config.widgetSeerrRequestedBy', 'Requested by'))}</label>
                    <select id="widget-${index}-media-requester" class="config-select" data-widget-setting="requestedBy"
                        data-widget-index="${index}" data-widget-kind="text">${users}</select>
                </div>`;
        },
        connected(draft, answer) {
            const users = answer.users || [];
            if (draft.config.requestedBy && !users.some((user) => user.id === draft.config.requestedBy)) {
                delete draft.config.requestedBy;
            }
        },
    };

    /*
     * qBittorrent signs in with a username and password, the way every version
     * does; 5.2 and later can take an API key instead, sent as a Bearer header.
     * The category is chosen from the ones Connect lists.
     */
    Config.MEDIA_SERVICES.qbittorrent = {
        id: 'qbittorrent',
        name: 'qBittorrent',
        placeholder: 'http://qbittorrent.local:8080',
        authModes: {
            login: { kind: 'session', session: {
                loginPath: '/api/v2/auth/login', userField: 'username', passField: 'password', referer: true } },
            key: { kind: 'header', headerName: 'Authorization' },
        },
        words: {
            keyWhere: ['config.widgetQbittorrentKeyWhere', 'Options → WebUI → API key in qBittorrent 5.2 or later'],
            'key refused': ['config.widgetQbittorrentErrorSignIn', 'qBittorrent refused that sign-in.'],
        },
        // The key alone is what qBittorrent shows; the header wants the scheme.
        normalizeKey(key, auth) {
            if (auth?.kind !== 'header' || !key || /^Bearer\s/i.test(key)) return key;
            return `Bearer ${key}`;
        },
        choices(panel, widget, index, setup, config, esc) {
            const chosen = String(config.category || '');
            const all = `<option value="" ${chosen ? '' : 'selected'}>${esc(panel.t(
                'config.widgetQbittorrentAllCategories', 'All categories'))}</option>`;
            const options = all + (setup.categories || []).map((c) => `<option value="${esc(c.id)}" ${
                c.id === chosen ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
            return `
                <div class="config-widget-field">
                    <label for="widget-${index}-media-category">${esc(panel.t('config.widgetQbittorrentCategory', 'Category'))}</label>
                    <select id="widget-${index}-media-category" class="config-select" data-widget-setting="category"
                        data-widget-index="${index}" data-widget-kind="text">${options}</select>
                </div>`;
        },
        // A category that no longer exists is dropped rather than kept as a
        // filter that shows nothing.
        connected(draft, answer) {
            const categories = answer.categories || [];
            if (draft.config.category && !categories.some((c) => c.id === draft.config.category)) {
                delete draft.config.category;
            }
        },
    };

    // SABnzbd takes its key in the address only; the server fills it in.
    Config.MEDIA_SERVICES.sabnzbd = {
        id: 'sabnzbd',
        name: 'SABnzbd',
        placeholder: 'http://sabnzbd.local:8080',
        auth: { kind: 'query', queryName: 'apikey' },
        words: {
            keyWhere: ['config.widgetSabnzbdKeyWhere', 'Config → General → API Key in SABnzbd'],
        },
    };

    /*
     * Home Assistant: a long-lived token, and the entities chosen from the
     * list Connect brings -- searched on the left, in the reader's own order
     * on the right.
     */
    const HA_MAX = 60;
    const HA_VISIBLE = 200;
    Config.MEDIA_SERVICES.homeassistant = {
        id: 'homeassistant',
        name: 'Home Assistant',
        header: 'Authorization',
        placeholder: 'http://homeassistant.local:8123',
        words: {
            key: ['config.widgetHomeAssistantKey', 'Long-lived access token'],
            keyWhere: ['config.widgetHomeAssistantKeyWhere',
                'Profile → Security → Long-lived access tokens in Home Assistant'],
            'key refused': ['config.widgetHomeAssistantErrorKey', 'Home Assistant refused that token.'],
        },
        normalizeKey(key) {
            if (!key || /^Bearer\s/i.test(key)) return key;
            return `Bearer ${key}`;
        },
        choices(panel, widget, index, setup, config, esc) {
            const chosen = Array.isArray(config.entities) ? config.entities : [];
            return `
                <div class="config-widget-field config-ha-picker" data-ha-picker="${index}">
                    <div class="config-ha-search">
                        <span class="config-widget-field-label">${esc(panel.t('config.widgetHomeAssistantFind', 'Find'))}</span>
                        <input type="search" class="config-text" data-ha-search data-widget-index="${index}"
                            aria-label="${esc(panel.t('config.widgetHomeAssistantFind', 'Find'))}"
                            placeholder="${esc(panel.t('config.widgetHomeAssistantFindHint', 'Name or id'))}">
                        <div class="config-ha-chips" data-ha-chips="${index}">${panel.haChipsHtml(index, setup, esc)}</div>
                        <div class="config-ha-results" data-ha-results="${index}">${panel.haResultsHtml(index, setup, chosen, esc)}</div>
                    </div>
                    <div class="config-ha-chosen">
                        <span class="config-widget-field-label" data-ha-count="${index}">${esc(panel.haCountText(chosen))}</span>
                        <ol class="config-ha-list" data-ha-list="${index}">${panel.haChosenHtml(index, setup, chosen, esc)}</ol>
                    </div>
                </div>`;
        },
    };

    const SHARED_WORDS = {
        server: ['config.widgetMediaServer', 'Address'],
        key: ['config.widgetMediaKey', 'API key'],
        keyWhere: ['config.widgetMediaKeyWhere', 'Settings → General → API Key in {name}'],
        user: ['config.widgetMediaUser', 'Username'],
        password: ['config.widgetMediaPassword', 'Password'],
        signIn: ['config.widgetMediaSignIn', 'Sign in with'],
        modeLogin: ['config.widgetMediaModeLogin', 'Username and password'],
        modeKey: ['config.widgetMediaModeKey', 'API key'],
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

    haCountText(chosen) {
        return this.t('config.widgetHomeAssistantChosen', 'In the tile ({n} of {max})')
            .replace('{n}', String(chosen.length)).replace('{max}', String(HA_MAX));
    },

    haFilterState(index) {
        this._haFilter = this._haFilter || {};
        this._haFilter[index] = this._haFilter[index] || { query: '', domain: '' };
        return this._haFilter[index];
    },

    haChipsHtml(index, setup, esc) {
        const counts = {};
        (setup.entities || []).forEach((e) => { counts[e.domain] = (counts[e.domain] || 0) + 1; });
        const current = this.haFilterState(index).domain;
        const domains = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 10);
        return ['', ...domains].map((domain) => `<button type="button" class="config-chip${
            domain === current ? ' is-active' : ''}" data-ha-chip="${esc(domain)}" data-widget-index="${index}"
            aria-pressed="${domain === current}">${esc(domain || this.t('config.widgetHomeAssistantAll', 'All'))}</button>`).join('');
    },

    haResultsHtml(index, setup, chosen, esc) {
        const { query, domain } = this.haFilterState(index);
        const q = query.trim().toLowerCase();
        const matches = (setup.entities || []).filter((e) => (!domain || e.domain === domain)
            && (!q || e.name.toLowerCase().includes(q) || e.id.includes(q)));
        const full = chosen.length >= HA_MAX;
        const rows = matches.slice(0, HA_VISIBLE).map((e) => {
            const on = chosen.includes(e.id);
            return `<label class="config-toggle config-toggle--inline config-ha-result">
                <input type="checkbox" data-ha-pick="${esc(e.id)}" data-widget-index="${index}"
                    ${on ? 'checked' : ''} ${!on && full ? 'disabled' : ''}>
                <span>${esc(e.name)}</span><span class="config-ha-id">${esc(e.id)}</span>
            </label>`;
        }).join('');
        const more = matches.length > HA_VISIBLE
            ? `<p class="config-widget-note">${esc(this.t('config.widgetHomeAssistantMore',
                '{n} more — search to narrow it down.').replace('{n}', String(matches.length - HA_VISIBLE)))}</p>` : '';
        return rows + more;
    },

    haChosenHtml(index, setup, chosen, esc) {
        const names = new Map((setup.entities || []).map((e) => [e.id, e.name]));
        return chosen.map((id, at) => {
            const known = names.has(id);
            const name = known ? names.get(id) : `${id} (${this.t('config.widgetHomeAssistantNotFound', 'not found')})`;
            return `<li class="config-ha-item${known ? '' : ' is-missing'}">
                <span data-ha-chosen="${esc(id)}">${esc(name)}</span>
                <button type="button" class="config-btn config-btn--icon" data-ha-move="${esc(id)}" data-ha-dir="up"
                    data-widget-index="${index}" ${at === 0 ? 'disabled' : ''}
                    aria-label="${esc(this.t('config.widgetHomeAssistantUp', 'Move up'))}">↑</button>
                <button type="button" class="config-btn config-btn--icon" data-ha-move="${esc(id)}" data-ha-dir="down"
                    data-widget-index="${index}" ${at === chosen.length - 1 ? 'disabled' : ''}
                    aria-label="${esc(this.t('config.widgetHomeAssistantDown', 'Move down'))}">↓</button>
                <button type="button" class="config-btn config-btn--icon" data-ha-remove="${esc(id)}"
                    data-widget-index="${index}" aria-label="${esc(this.t('config.widgetHomeAssistantRemove', 'Remove'))}">✕</button>
            </li>`;
        }).join('');
    },

    /** Redraws the picker's parts in place: the search box keeps its focus. */
    haRepaint(index, { results = true, chips = false } = {}) {
        const block = (this._widgetBlocks || [])[index];
        const draft = this.widgetDraft(index);
        const setup = this.mediaSetupFor(block) || {};
        const esc = (v) => this.dash.escapeHtml(v);
        const chosen = Array.isArray(draft?.config?.entities) ? draft.config.entities : [];
        const at = (name) => document.querySelector(`[data-${name}="${index}"]`);
        if (results && at('ha-results')) at('ha-results').innerHTML = this.haResultsHtml(index, setup, chosen, esc);
        if (chips && at('ha-chips')) at('ha-chips').innerHTML = this.haChipsHtml(index, setup, esc);
        if (at('ha-list')) at('ha-list').innerHTML = this.haChosenHtml(index, setup, chosen, esc);
        if (at('ha-count')) at('ha-count').textContent = this.haCountText(chosen);
        this.refreshWidgetSaveBar?.(index);
    },

    haChange(index, change) {
        const draft = this.widgetDraft(index);
        if (!draft) return;
        const list = Array.isArray(draft.config.entities) ? [...draft.config.entities] : [];
        draft.config.entities = change(list).slice(0, HA_MAX);
    },

    /** One listener for the picker's boxes and buttons, bound once per panel. */
    bindHomeAssistantPicker() {
        if (this._haBound) return;
        this._haBound = true;
        const indexOf = (el) => Number(el.getAttribute('data-widget-index'));
        document.addEventListener('input', (event) => {
            const box = event.target.closest?.('[data-ha-search]');
            if (!box) return;
            const index = indexOf(box);
            this.haFilterState(index).query = box.value;
            this.haRepaint(index);
        });
        document.addEventListener('change', (event) => {
            const pick = event.target.closest?.('[data-ha-pick]');
            if (!pick) return;
            const index = indexOf(pick);
            const id = pick.getAttribute('data-ha-pick');
            this.haChange(index, (list) => (pick.checked
                ? (list.includes(id) ? list : [...list, id])
                : list.filter((x) => x !== id)));
            this.haRepaint(index);
        });
        document.addEventListener('click', (event) => {
            const chip = event.target.closest?.('[data-ha-chip]');
            const move = event.target.closest?.('[data-ha-move]');
            const remove = event.target.closest?.('[data-ha-remove]');
            if (chip) {
                const index = indexOf(chip);
                this.haFilterState(index).domain = chip.getAttribute('data-ha-chip');
                this.haRepaint(index, { chips: true });
            } else if (move) {
                const index = indexOf(move);
                const id = move.getAttribute('data-ha-move');
                const step = move.getAttribute('data-ha-dir') === 'up' ? -1 : 1;
                this.haChange(index, (list) => {
                    const from = list.indexOf(id);
                    const to = from + step;
                    if (from < 0 || to < 0 || to >= list.length) return list;
                    [list[from], list[to]] = [list[to], list[from]];
                    return list;
                });
                this.haRepaint(index, { results: false });
                document.querySelector(`[data-ha-move="${CSS.escape(id)}"][data-ha-dir="${step < 0 ? 'up' : 'down'}"]`)?.focus();
            } else if (remove) {
                const index = indexOf(remove);
                const id = remove.getAttribute('data-ha-remove');
                this.haChange(index, (list) => list.filter((x) => x !== id));
                this.haRepaint(index);
            }
        });
    },

    mediaWord(service, key, name = service.name) {
        const [i18n, fallback] = service.words?.[key] || SHARED_WORDS[key] || SHARED_WORDS.unreachable;
        return this.t(i18n, fallback).replace('{name}', name);
    },

    /** The panel's answer from Connect, per widget, for as long as config is open. */
    mediaSetupFor(block) {
        this._mediaSetup = this._mediaSetup || {};
        return this._mediaSetup[block?.id] || null;
    },

    /*
     * How this service signs in: a key in a header (most), a key in the
     * address (SABnzbd), or a username and password (qBittorrent, which also
     * takes a key from 5.2 -- the reader picks).
     */
    mediaAuthShape(service, auth) {
        if (service.authModes) {
            const mode = auth?.kind === 'header' ? 'key' : 'login';
            return service.authModes[mode];
        }
        return service.auth || { kind: 'header', headerName: service.header };
    },

    ensureMediaAuth(index, service) {
        const draft = this.widgetDraft(index);
        if (!draft) return;
        const want = this.mediaAuthShape(service, draft.auth);
        const auth = draft.auth || {};
        const same = auth.kind === want.kind
            && (!want.headerName || auth.headerName === want.headerName)
            && (!want.queryName || auth.queryName === want.queryName);
        if (same) {
            // A stored sign-in comes back without where to sign in.
            if (want.session && !auth.session) draft.auth = { ...auth, session: want.session };
            return;
        }
        draft.auth = { ...want, secret: auth.secret || '', basicUser: auth.basicUser || '' };
    },

    /** qBittorrent: from username and password to a key, or back. */
    setMediaAuthMode(index, mode) {
        const block = (this._widgetBlocks || [])[index];
        const service = Config.MEDIA_SERVICES[block?.type];
        const draft = this.widgetDraft(index);
        const shape = service?.authModes?.[mode];
        if (!draft || !shape) return;
        // What was typed for one is never sent as the other.
        draft.auth = { ...shape, secret: '', basicUser: '' };
        this.repaintWidgetsBody();
        this.refreshWidgetSaveBar?.(index);
    },

    mediaAuthFields(service, index, draft, keyIsSaved, esc) {
        const id = (name) => `widget-${index}-media-${name}`;
        const auth = draft?.auth || {};
        const kept = this.t('config.widgetAuthKept', 'Set — type to replace');
        let mode = '';
        if (service.authModes) {
            const current = auth.kind === 'header' ? 'key' : 'login';
            mode = `
                <div class="config-widget-field">
                    <label for="${id('auth')}">${esc(this.mediaWord(service, 'signIn'))}</label>
                    <select id="${id('auth')}" class="config-select" data-media-auth data-widget-index="${index}">
                        <option value="login" ${current === 'login' ? 'selected' : ''}>${esc(this.mediaWord(service, 'modeLogin'))}</option>
                        <option value="key" ${current === 'key' ? 'selected' : ''}>${esc(this.mediaWord(service, 'modeKey'))}</option>
                    </select>
                </div>`;
        }
        if (auth.kind === 'session') {
            return `${mode}
                <div class="config-widget-field">
                    <label for="${id('user')}">${esc(this.mediaWord(service, 'user'))}</label>
                    <input type="text" id="${id('user')}" class="config-text" autocomplete="off" spellcheck="false"
                        maxlength="200" data-widget-auth="basicUser" data-widget-index="${index}"
                        value="${esc(auth.basicUser || '')}">
                </div>
                <div class="config-widget-field">
                    <label for="${id('key')}">${esc(this.mediaWord(service, 'password'))}</label>
                    <input type="password" id="${id('key')}" class="config-text" autocomplete="off"
                        spellcheck="false" maxlength="1024" data-widget-auth="secret" data-widget-index="${index}"
                        placeholder="${esc(keyIsSaved ? kept : '')}">
                </div>`;
        }
        return `${mode}
            <div class="config-widget-field">
                <label for="${id('key')}">${esc(this.mediaWord(service, 'key'))}</label>
                <input type="password" id="${id('key')}" class="config-text" autocomplete="off"
                    spellcheck="false" maxlength="1024"
                    data-widget-auth="secret" data-widget-index="${index}"
                    placeholder="${esc(keyIsSaved ? kept : this.mediaWord(service, 'keyWhere'))}">
            </div>`;
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
        if (service.id === 'homeassistant') this.bindHomeAssistantPicker();
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
                    ${this.mediaAuthFields(service, index, draft, keyIsSaved, esc)}
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
        const auth = draft.auth || {};
        if (secret && auth.kind === 'session') {
            payload.draftCredential = { session: {
                ...(auth.session || {}), user: String(auth.basicUser || '').trim(), password: secret } };
        } else if (secret && auth.kind === 'query') {
            payload.draftCredential = { query: { [auth.queryName]: secret } };
        } else if (secret) {
            payload.draftCredential = { headers: { [auth.headerName || service.header]: secret } };
        } else payload.credentialId = block.config?.credentialId || this.widgetCredentialId(block);

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
