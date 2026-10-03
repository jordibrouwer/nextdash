/**
 * Config -> Unraid.
 *
 * One connection for every Unraid widget: the server's address, its API key
 * (stored on the server, never sent back), the self-signed switch and whether
 * its alerts go out. A widget only says how it draws. Its own section, since
 * nothing else in config -- not the Containers view -- reads this server.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    Object.assign(global.DashboardConfig.prototype, {

    renderUnraidSection() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <p class="config-view-intro">${esc(this.t('config.unraidSectionIntro',
                'The Unraid server the Unraid widgets read. Every widget uses this one connection.'))}</p>
            <div class="config-tabpage">
                <div class="config-tabpage-main" id="config-unraid-body">
                    ${this.renderUnraidExplainer()}
                    ${this.renderUnraidPreview()}
                    ${this.renderUnraidPanel()}
                </div>
            </div>
        `;
    },

    /*
     * How it works: nextDash asks, the Unraid server answers -- drawn as two
     * boxes and a line with dots running from the server to the dashboard --
     * and the three things to do, each ticked off once it is done.
     */
    renderUnraidExplainer() {
        const esc = (v) => this.dash.escapeHtml(v);
        const t = (key, fallback) => esc(this.t(`config.${key}`, fallback));
        const step = (id, n, html) => `
            <li class="unraid-step" data-unraid-step="${id}">
                <span class="unraid-step-n" aria-hidden="true">${n}</span>
                <span class="unraid-step-text">${html}</span>
                <span class="config-sr-only" data-unraid-step-state></span>
            </li>`;
        return `
            <div class="config-panel unraid-explain" data-unraid-explain>
                <h3 class="config-panel-title">${t('unraidHowTitle', 'How it works')}</h3>
                <div class="unraid-flow" aria-hidden="true">
                    <div class="unraid-node"><span class="unraid-node-box">nextDash</span><span class="unraid-node-label">${t('unraidHowDashboard', 'dashboard')}</span></div>
                    <div class="unraid-wire">
                        <span class="unraid-wire-tag">${t('unraidHowCarries', 'array · parity · shares · VMs · UPS · alerts')}</span>
                        <span class="unraid-wire-run"><i></i></span>
                        <span class="unraid-wire-run"><i></i></span>
                        <span class="unraid-wire-run"><i></i></span>
                    </div>
                    <div class="unraid-node unraid-node--server"><span class="unraid-node-box">Unraid</span><span class="unraid-node-label" data-unraid-flow-address>${t('unraidHowServer', 'your server')}</span></div>
                </div>
                <p class="config-panel-note">${t('unraidHowNote',
                    'nextDash asks the server about once a minute and only reads: it never starts, stops or changes anything there.')}</p>
                <ol class="unraid-steps">
                    ${step('key', 1, `${t('unraidStepKey', 'In Unraid, make an API key with the role Viewer:')} <strong>Settings → Management Access → API Keys</strong>.`)}
                    ${step('connect', 2, t('unraidStepConnect', 'Fill in the address and the key below, test the connection and save.'))}
                    ${step('widgets', 3, `${t('unraidStepWidgets', 'Put Unraid widgets on a page.')} <button type="button" class="config-link-btn" data-unraid-goto-widgets>${t('unraidOpenTypes', 'Open Widgets → Types')}</button>`)}
                </ol>
            </div>`;
    },

    /*
     * What you get: the seven tiles in miniature, with example figures, each
     * a step from its own Add in Widgets -> Types. Decorative drawings beside
     * real buttons, so the drawings are hidden from assistive tech.
     */
    renderUnraidPreview() {
        const esc = (v) => this.dash.escapeHtml(v);
        const t = (key, fallback) => esc(this.t(`config.${key}`, fallback));
        const bar = (pct, tone = '') => `<span class="unraid-mini-bar${tone ? ` unraid-mini-bar--${tone}` : ''}"><i style="--fill:${pct}"></i></span>`;
        const row = (name, value, tone = '') => `<span class="unraid-mini-row"><span>${esc(name)}</span><span${tone ? ` class="unraid-mini-${tone}"` : ''}>${esc(value)}</span></span>`;
        const tile = (type, body) => `
            <div class="unraid-mini">
                <span class="unraid-mini-title">${esc(this.widgetTypeName(type))}</span>
                <span class="unraid-mini-body" aria-hidden="true">${body}</span>
                <button type="button" class="config-btn config-btn--small unraid-mini-add" data-unraid-add="${esc(type)}"
                        aria-label="${esc(this.t('config.widgetsAddNamed', 'Add {name}').replace('{name}', this.widgetTypeName(type)))}">${t('unraidMiniAdd', 'Add…')}</button>
            </div>`;
        return `
            <div class="config-panel unraid-preview" data-unraid-preview>
                <h3 class="config-panel-title">${t('unraidPreviewTitle', 'What you get')}</h3>
                <p class="config-panel-note">${t('unraidPreviewNote',
                    'Seven widgets read this server, shown here with example figures. Add opens Widgets → Types on that kind.')}</p>
                <div class="unraid-minis">
                    ${tile('unraid', `${row('array', 'started', 'good')}${row('alerts', '2 unread', 'warn')}`)}
                    ${tile('unraidArray', `${bar(0.74)}${row('disk1', '74%')}`)}
                    ${tile('unraidParity', `${bar(0.63)}${row('check', '63%')}`)}
                    ${tile('unraidShares', `${row('array', '44%')}${row('cache', '13%')}`)}
                    ${tile('unraidVms', `<span class="unraid-mini-row"><span><span class="unraid-mini-pulse"></span>home-assistant</span><span class="unraid-mini-good">on</span></span>`)}
                    ${tile('unraidUps', `${bar(1, 'good')}${row('battery', '100%')}`)}
                    ${tile('unraidNotifications', `${row('parity check', 'done')}${row('2 alerts', '', 'warn')}`)}
                </div>
                <p class="unraid-preview-foot">
                    <button type="button" class="config-btn config-btn--primary" data-unraid-goto-widgets>${t('unraidAllTypes', 'All widget types →')}</button>
                </p>
            </div>`;
    },

    /*
     * Widgets -> Types, scrolled to the Unraid group or to one kind in it,
     * whose Add then has the focus: one Enter from a widget on the page.
     */
    openUnraidWidgetTypes(type) {
        this.widgetsTab = 'types';
        this.selectSection('widgets');
        let tries = 0;
        const find = () => {
            const body = document.getElementById('config-widgets-body');
            if (!body) return null;
            if (type) return body.querySelector(`[data-widget-add="${CSS.escape(type)}"]`);
            return body.querySelector('[data-widget-add="unraid"]')?.closest('.config-widget-type-group') || null;
        };
        /*
         * The Widgets section draws, then repaints once its list has loaded --
         * which replaces the button that was just focused. So keep pointing
         * at the current one until it has stayed put for a few frames.
         */
        let pointed = null;
        let steady = 0;
        const tick = () => {
            const el = find();
            if (el && el !== pointed) {
                pointed = el;
                steady = 0;
                el.scrollIntoView({ block: 'center' });
                if (type) {
                    el.focus({ preventScroll: true });
                    const rowEl = el.closest('.config-widget-type-row');
                    rowEl?.classList.add('is-pointed');
                    setTimeout(() => rowEl?.classList.remove('is-pointed'), 2400);
                }
            } else if (el && type && document.activeElement !== el) {
                el.focus({ preventScroll: true });
            }
            steady = el ? steady + 1 : 0;
            if (steady < 20 && (tries += 1) < 120) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    },

    /** Tick off the three steps from what the server says. */
    async paintUnraidSteps(container, { keySet, saved }) {
        const explain = container.querySelector('[data-unraid-explain]');
        if (!explain) return;
        const mark = (id, done) => {
            const li = explain.querySelector(`[data-unraid-step="${id}"]`);
            if (!li) return;
            li.classList.toggle('is-done', !!done);
            const state = li.querySelector('[data-unraid-step-state]');
            if (state) state.textContent = done ? this.t('config.unraidStepDone', 'done') : '';
        };
        mark('key', keySet);
        const address = explain.querySelector('[data-unraid-flow-address]');
        if (address && saved?.baseUrl) address.textContent = saved.baseUrl.replace(/^https?:\/\//, '');
        let connected = false;
        if (keySet && saved?.baseUrl) {
            try {
                const res = await fetch('/api/unraid/area/info', { cache: 'no-store' });
                connected = res.ok && (await res.json())?.status === 'ok';
            } catch { /* stays open */ }
        }
        mark('connect', connected);
        explain.classList.toggle('is-connected', connected);
        let placed = false;
        const pages = Array.isArray(this.dash.pages) ? this.dash.pages : [];
        for (const page of pages) {
            try {
                const res = await fetch(`/api/pages/${encodeURIComponent(page.id)}/blocks`, { cache: 'no-store' });
                const body = res.ok ? await res.json() : null;
                if ((body?.widgets || []).some((w) => String(w?.type || '').startsWith('unraid'))) {
                    placed = true;
                    break;
                }
            } catch { /* a page that does not answer says nothing */ }
        }
        if (container.isConnected) mark('widgets', placed);
    },

    bindUnraidSection(container) {
        container.querySelectorAll('[data-unraid-goto-widgets]').forEach((btn) => {
            btn.addEventListener('click', () => this.openUnraidWidgetTypes());
        });
        container.querySelectorAll('[data-unraid-add]').forEach((btn) => {
            btn.addEventListener('click', () => this.openUnraidWidgetTypes(btn.getAttribute('data-unraid-add')));
        });
        return this.bindUnraidConnection(container);
    },

    /**
     * Unraid: one connection for every Unraid widget. Address, key and the
     * certificate switch live here; a widget only says how it draws.
     */
    renderUnraidPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        const t = (key, fallback) => esc(this.t(`config.${key}`, fallback));
        return `
            <div class="config-panel" data-unraid-section>
                <h3 class="config-panel-title">${t('unraidTitle', 'Unraid')}</h3>
                <p class="config-panel-note">${t('unraidIntro',
                    'The Unraid widgets read this server through its API (Unraid 7.2, or the Unraid Connect plugin). Make a key under Settings → Management Access → API Keys with the role Viewer: nextDash only reads.')}</p>
                <div class="config-field">
                    <label class="config-field-label" for="config-unraid-base-url">${t('unraidAddress', 'Address')}</label>
                    <input type="url" id="config-unraid-base-url" class="config-text" data-unraid-field="baseUrl"
                           autocomplete="off" spellcheck="false" placeholder="http://192.168.1.10">
                </div>
                <p class="config-field-hint" data-unraid-address-hint>${t('unraidAddressHint', 'A new address needs the key again.')}</p>
                <div class="config-field">
                    <label class="config-field-label" for="config-unraid-key">${t('unraidKey', 'API key')}</label>
                    <span class="config-secret-field">
                        <input type="password" id="config-unraid-key" class="config-text" data-unraid-field="key"
                               autocomplete="off" spellcheck="false">
                        <button type="button" class="config-secret-eye" data-unraid-reveal aria-pressed="false"
                                aria-controls="config-unraid-key" title="${t('unraidKeyShow', 'Show what is typed')}"
                                aria-label="${t('unraidKeyShow', 'Show what is typed')}">${this.secretEyeIcon(false)}</button>
                    </span>
                </div>
                <p class="config-field-check" data-state="fixable" data-unraid-key-warning hidden>${t('unraidKeyWarning',
                    'The address changed and no key is typed: the saved key is dropped, so type it again.')}</p>
                <label class="config-toggle">
                    <input type="checkbox" data-unraid-field="insecureTls">
                    <span>${t('unraidInsecureTls', 'Accept a self-signed certificate')}</span>
                </label>
                <label class="config-toggle">
                    <input type="checkbox" data-unraid-field="enabled" checked>
                    <span>${t('unraidEnabled', 'Read this server')}</span>
                </label>
                <label class="config-toggle">
                    <input type="checkbox" data-unraid-field="notify" checked>
                    <span>${t('unraidNotify', 'Send Unraid alerts through the alert channels')}</span>
                </label>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-unraid-test>${t('unraidTest', 'Test connection')}</button>
                    <button type="button" class="config-btn config-btn--primary" data-unraid-save>${t('unraidSave', 'Save')}</button>
                </div>
                <p class="config-field-hint" data-unraid-result aria-live="polite" style="white-space: pre-line"></p>
            </div>`;
    },

    async bindUnraidConnection(container) {
        const section = container.querySelector('[data-unraid-section]');
        if (!section) return;
        const field = (name) => section.querySelector(`[data-unraid-field="${name}"]`);
        const result = section.querySelector('[data-unraid-result]');
        const warning = section.querySelector('[data-unraid-key-warning]');
        const t = (key, fallback) => this.t(`config.${key}`, fallback);
        let current = null;
        let keySet = false;
        let suggested = '';
        // The server compares the address it keeps: scheme://host[:port].
        const same = (a, b) => String(a || '').trim().replace(/\/+$/, '').toLowerCase()
            === String(b || '').trim().replace(/\/+$/, '').toLowerCase();
        const paintWarning = () => {
            const typed = field('baseUrl').value;
            warning.hidden = !(keySet && current?.baseUrl && typed.trim() && !same(typed, current.baseUrl)
                && !field('key').value.trim());
        };
        const paintKey = () => {
            field('key').placeholder = keySet ? t('unraidKeySet', 'Set. Type to replace.') : '';
            paintWarning();
        };
        field('baseUrl').addEventListener('input', paintWarning);
        field('key').addEventListener('input', paintWarning);
        // Not before the saved server is known: a save then would overwrite it with blanks.
        const buttons = section.querySelectorAll('[data-unraid-test], [data-unraid-save]');
        buttons.forEach((btn) => { btn.disabled = true; });

        const eye = section.querySelector('[data-unraid-reveal]');
        eye.addEventListener('click', () => {
            const on = eye.getAttribute('aria-pressed') !== 'true';
            field('key').type = on ? 'text' : 'password';
            eye.setAttribute('aria-pressed', on ? 'true' : 'false');
            eye.innerHTML = this.secretEyeIcon(on);
            const label = on ? t('unraidKeyHide', 'Hide it again') : t('unraidKeyShow', 'Show what is typed');
            eye.setAttribute('aria-label', label);
            eye.setAttribute('title', label);
        });

        const payload = () => {
            const out = {
                server: {
                    id: current?.id || '',
                    name: current?.name || '',
                    baseUrl: field('baseUrl').value.trim() || suggested,
                    insecureTls: field('insecureTls').checked,
                    enabled: field('enabled').checked,
                    notify: field('notify').checked,
                },
            };
            const key = field('key').value.trim();
            if (key) out.key = key;
            return out;
        };
        const send = (url, method) => window.nextDashFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload()),
        });
        // What went wrong, in a line: a refused write token is told apart, the
        // rest says its status or what the server wrote.
        const failure = async (res, fallback) => {
            if (res.status === 401 || res.status === 403) {
                return t('unraidNotAllowed', 'Not allowed: the write token is missing or wrong.');
            }
            const text = String(await res.text().catch(() => '')).trim();
            const reason = text && text.length <= 200 && !text.startsWith('<') ? text : String(res.status);
            return `${fallback} (${reason})`;
        };
        // One request at a time: both buttons rest until it is answered.
        let loaded = false;
        let busy = false;
        const paintButtons = () => buttons.forEach((btn) => { btn.disabled = !loaded || busy; });
        const run = async (work) => {
            if (busy) return;
            busy = true;
            paintButtons();
            try { await work(); } finally { busy = false; paintButtons(); }
        };
        const areaName = { array: 'Array', parity: 'Parity', shares: 'Shares', vms: 'VMs', ups: 'UPS', notifications: 'Notifications' };
        const areaState = {
            ok: t('unraidAreaOk', 'yes'),
            forbidden: t('unraidAreaForbidden', 'not allowed'),
            unsupported: t('unraidAreaUnsupported', 'not in this version'),
        };

        section.querySelector('[data-unraid-test]').addEventListener('click', () => run(async () => {
            result.textContent = t('unraidTesting', 'Asking…');
            try {
                const res = await send('/api/unraid/test', 'POST');
                if (res.status === 401 || res.status === 403) {
                    result.textContent = await failure(res, '');
                    return;
                }
                const body = await res.json().catch(() => null);
                if (!body) {
                    result.textContent = await failure(res, t('unraidTestFailed', 'The server did not answer.'));
                    return;
                }
                if (!body.ok) {
                    result.textContent = body.error || t('unraidTestFailed', 'The server did not answer.');
                    return;
                }
                const info = body.info || {};
                const lines = [`${info.name || 'Unraid'} · Unraid ${info.unraid || '?'} · API ${info.api || '?'}`];
                lines.push(Object.entries(body.areas || {}).map(([a, s]) => `${areaName[a] || a}: ${areaState[s] || s}`).join(' · '));
                if (body.viewerIsEnough) lines.push(t('unraidViewerEnough', 'This key can do more than read. Viewer is enough for nextDash.'));
                result.textContent = lines.join('\n');
            } catch {
                result.textContent = t('unraidTestFailed', 'The server did not answer.');
            }
        }));

        section.querySelector('[data-unraid-save]').addEventListener('click', () => run(async () => {
            try {
                const res = await send('/api/unraid/settings', 'PUT');
                if (!res.ok) {
                    result.textContent = await failure(res, t('unraidSaveFailed', 'Could not save'));
                    return;
                }
                const body = await res.json();
                current = body.server || null;
                keySet = body.keySet === true;
                field('key').value = '';
                paintKey();
                result.textContent = t('unraidSaved', 'Saved. The Unraid widgets read this server now.');
                void this.paintUnraidSteps(container, { keySet, saved: current });
                delete this.dash._unraidBaseUrl; // the tiles learn the new address on their next beat
            } catch {
                result.textContent = t('unraidSaveFailed', 'Could not save') + '.';
            }
        }));

        try {
            const res = await fetch('/api/unraid/settings', { cache: 'no-store' });
            if (!res.ok) throw new Error(String(res.status));
            const body = await res.json();
            if (!body || typeof body !== 'object') throw new Error('shape');
            if (!section.isConnected) return;
            current = body.server || null;
            keySet = body.keySet === true;
            field('baseUrl').value = current?.baseUrl || '';
            suggested = String(body.suggestedBaseUrl || '');
            if (suggested) field('baseUrl').placeholder = suggested;
            field('insecureTls').checked = !!current?.insecureTls;
            field('enabled').checked = current ? current.enabled !== false : true;
            field('notify').checked = current ? current.notify !== false : true;
            loaded = true;
            void this.paintUnraidSteps(container, { keySet, saved: current });
        } catch {
            // Saving now would overwrite what is stored with blanks: stay shut.
            if (section.isConnected) result.textContent = t('unraidLoadFailed', 'Could not read the Unraid settings. Reload to try again.');
        }
        paintButtons();
        paintKey();
    },

    });

    global.DashboardConfigUnraidReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
