/**
 * Config -> Assistant.
 *
 * The settings of the in-app assistant: the switch, the provider, a
 * write-only key, the model, how long conversations are kept, and the button
 * that deletes them. One tab (Settings), drawn with the same tab row as the
 * other sections so the page does not shift when you walk down the rail.
 *
 * The key is write-only: it is sent to the server and cleared from the field,
 * and nothing here ever renders one back, only whether one is saved.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    /** Models the server falls back to; the field's placeholder, never sent. */
    const AI_DEFAULT_MODELS = { anthropic: 'claude-sonnet-5-5', openai: 'gpt-5.6-terra', compatible: '' };

    /** The four MCP switches the assistant follows: [setting, label key, English]. */
    const AI_GROUPS = [
        ['mcpBookmarksWrite', 'mcpGroupBookmarksWrite', 'Bookmarks: edit and delete'],
        ['mcpHealthInbox', 'mcpGroupHealthInbox', 'Health and Inbox: read'],
        ['mcpContainersRead', 'mcpGroupContainersRead', 'Containers: read'],
        ['mcpContainersControl', 'mcpGroupContainersControl', 'Containers: control'],
    ];

    Object.assign(global.DashboardConfig.prototype, {

    renderAssistantSection() {
        const esc = (v) => this.dash.escapeHtml(v);
        const active = this.assistantTab || 'settings';
        const tabs = global.DashboardConfig.ASSISTANT_TABS.map((tab) => {
            const on = tab === active;
            return `<button type="button" class="config-subtab${on ? ' is-active' : ''}" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" aria-controls="config-assistant-body" data-assistant-tab="${esc(tab)}">${esc(this.assistantTabLabel(tab))}</button>`;
        }).join('');
        return `
            <p class="config-view-intro">${esc(this.t('config.assistantIntro',
                'Ask about your bookmarks in plain words, with Claude, OpenAI or a server of your own.'))}</p>
            <div class="config-subtabs" role="tablist">${tabs}</div>
            <div class="config-tabpage">
                <div class="config-tabpage-main" id="config-assistant-body" role="tabpanel" tabindex="0">
                    ${this.renderAssistantPanel()}
                </div>
            </div>`;
    },

    assistantTabLabel(tab) {
        const map = {
            settings: ['config.assistantTabSettings', 'Settings'],
        };
        const [key, fallback] = map[tab] || [tab, tab];
        return this.t(key, fallback);
    },

    /** The ℹ of one field, drawn by the same helper every other page uses. */
    assistantInfo(field) {
        return `<span class="config-field-affordances">${this.renderFieldAffordances(field, undefined)}</span>`;
    },

    /**
     * The Settings tab: four panels, each a heading, one line, then its fields.
     * The wrapper keeps `data-ai-panel` so the page is still one thing to bind
     * and to redraw when the provider changes.
     */
    renderAssistantPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        const t = (key, fallback) => esc(this.t(`config.${key}`, fallback));
        const s = this.dash.settings || {};
        const provider = ['anthropic', 'openai', 'compatible'].includes(s.aiProvider) ? s.aiProvider : 'anthropic';
        const demo = global.DemoLock?.on === true;
        // The demo shows everything and changes nothing: the fields and the
        // action buttons are disabled one by one, because a disabled fieldset
        // would take the ℹ buttons down with them.
        const dis = demo ? ' disabled' : '';
        const opt = (value, label) => `<option value="${value}" ${provider === value ? 'selected' : ''}>${esc(label)}</option>`;
        const num = (key) => (Number(s[key]) > 0 ? Number(s[key]) : '');
        const providerHint = provider === 'compatible'
            ? t('assistantProviderHintCompatible', 'Needs a server address and a model. The key is optional.')
            : t('assistantProviderHintKey', 'Needs an API key. The model is optional.');
        const groups = AI_GROUPS.map(([key, labelKey, fallback]) => {
            const on = s[key] === true;
            return `<li class="config-ai-group${on ? ' is-on' : ''}" data-ai-group="${esc(key)}" data-ai-group-on="${on}">
                        <span class="config-ai-group-name">${t(labelKey, fallback)}</span>
                        <span class="config-ai-group-state">${on ? t('assistantGroupOn', 'On') : t('assistantGroupOff', 'Off')}</span>
                    </li>`;
        }).join('');
        return `
            <div class="config-ai-panels" data-ai-panel>
                ${demo ? `<div>${global.DemoLock.chip('privacy')}</div>` : ''}
                <div class="config-panel" data-ai-section="enable">
                    <h3 class="config-panel-title">${t('assistantPanelEnable', 'Turn it on')}</h3>
                    <p class="config-panel-note">${t('assistantNote',
                        'The assistant answers questions about your bookmarks, and about Health, the Inbox and your containers when you allow it, with a model you choose. It is off until you turn it on, and nothing is sent to the provider until you ask a question or press Test connection.')}</p>
                    <div class="config-field-row">
                        <label class="config-toggle">
                            <input type="checkbox" data-ai-setting="aiEnabled" ${s.aiEnabled === true ? 'checked' : ''}${dis}>
                            <span>${t('assistantEnabled', 'Turn the assistant on')}</span>
                        </label>
                        ${this.assistantInfo('aiEnabled')}
                    </div>
                    <p class="config-field-hint">${t('assistantEnabledHint', 'Open it with :ask in the command palette, or type = in the search bar.')}</p>
                </div>

                <div class="config-panel" data-ai-section="provider">
                    <h3 class="config-panel-title">${t('assistantPanelProvider', 'Provider')}</h3>
                    <p class="config-panel-note">${t('assistantProviderNote',
                        'Who answers. Your question and the bookmark data it looks up go to this provider.')}</p>
                    <div class="config-field">
                        <label class="config-field-label" for="config-ai-provider">${t('assistantProvider', 'Provider')}</label>
                        <select id="config-ai-provider" class="config-select" data-ai-setting="aiProvider"${dis}>
                            ${opt('anthropic', 'Claude')}${opt('openai', 'OpenAI')}${opt('compatible', this.t('config.assistantProviderCompatible', 'OpenAI-compatible (Ollama, LM Studio…)'))}
                        </select>
                        ${this.assistantInfo('aiProvider')}
                    </div>
                    <p class="config-field-hint">${providerHint}</p>
                    <div class="config-field">
                        <label class="config-field-label" for="config-ai-key">${t('assistantKey', 'API key')}</label>
                        <input type="password" id="config-ai-key" class="config-text" data-ai-key autocomplete="off" spellcheck="false"${dis}>
                        ${this.assistantInfo('aiKey')}
                    </div>
                    <p class="config-field-hint">${t('assistantKeyNote',
                        'Stored on this server and never shown again. Keyless servers on your own network can leave it empty.')}</p>
                    <div class="config-field-row config-ai-key-row">
                        <button type="button" class="config-btn" data-ai-action="save-key"${dis}>${t('assistantKeySave', 'Save key')}</button>
                        <button type="button" class="config-btn config-btn--danger" data-ai-action="remove-key" hidden${dis}>${t('assistantKeyRemove', 'Remove key')}</button>
                        <span class="config-field-hint" data-ai-key-state></span>
                    </div>
                    ${provider === 'compatible' ? `
                    <div class="config-field">
                        <label class="config-field-label" for="config-ai-url">${t('assistantBaseURL', 'Server address')}</label>
                        <input type="url" id="config-ai-url" class="config-text" data-ai-setting="aiBaseURL" autocomplete="off" spellcheck="false"
                            placeholder="http://ollama.lan:11434/v1" value="${esc(s.aiBaseURL || '')}"${dis}>
                        ${this.assistantInfo('aiBaseURL')}
                    </div>
                    <p class="config-field-hint">${t('assistantBaseURLHint', 'Starts with http:// or https://. Include the /v1 part if your server uses one.')}</p>` : ''}
                    <div class="config-field">
                        <label class="config-field-label" for="config-ai-model">${t('assistantModel', 'Model')}</label>
                        <input type="text" id="config-ai-model" class="config-text" data-ai-setting="aiModel" autocomplete="off" spellcheck="false"
                            placeholder="${esc(AI_DEFAULT_MODELS[provider] || '')}" value="${esc(s.aiModel || '')}"${dis}>
                        ${this.assistantInfo('aiModel')}
                    </div>
                    <p class="config-field-hint">${provider === 'compatible'
                        ? t('assistantModelHintCompatible', 'Required: this server has no default model.')
                        : t('assistantModelHint', 'Empty uses the default shown in the field.')}</p>
                    <div class="config-field-row">
                        <button type="button" class="config-btn" data-ai-action="test"${dis}>${t('assistantTest', 'Test connection')}</button>
                        ${this.assistantInfo('aiTest')}
                    </div>
                    <p class="config-field-hint" data-ai-ready-line></p>
                    <p class="config-field-hint" data-ai-test-state role="status"></p>
                </div>

                <div class="config-panel" data-ai-section="history">
                    <h3 class="config-panel-title">${t('assistantPanelHistory', 'Conversations')}</h3>
                    <p class="config-panel-note">${t('assistantHistoryNote',
                        'Conversations are kept on this server so you can reopen them from the assistant. Only the newest are kept and old ones expire.')}</p>
                    <div class="config-field">
                        <label class="config-field-label" for="config-ai-history-max">${t('assistantHistoryMax', 'Conversations to keep')}</label>
                        <input type="number" min="1" max="500" id="config-ai-history-max" class="config-text" data-ai-setting="aiHistoryMax" placeholder="50" value="${num('aiHistoryMax')}"${dis}>
                        ${this.assistantInfo('aiHistoryMax')}
                    </div>
                    <div class="config-field">
                        <label class="config-field-label" for="config-ai-history-days">${t('assistantHistoryDays', 'Days to keep them')}</label>
                        <input type="number" min="1" max="3650" id="config-ai-history-days" class="config-text" data-ai-setting="aiHistoryDays" placeholder="90" value="${num('aiHistoryDays')}"${dis}>
                        ${this.assistantInfo('aiHistoryDays')}
                    </div>
                    <div class="config-field-row">
                        <button type="button" class="config-btn config-btn--danger" data-ai-action="delete-all"${dis}>${t('assistantDeleteAll', 'Delete all conversations')}</button>
                        ${this.assistantInfo('aiDeleteAll')}
                    </div>
                </div>

                <div class="config-panel" data-ai-section="access">
                    <div class="config-ai-head">
                        <h3 class="config-panel-title">${t('assistantPanelAccess', 'What it can see and do')}</h3>
                        ${this.assistantInfo('aiAccess')}
                    </div>
                    <p class="config-panel-note">${t('assistantAccessNote',
                        'It looks things up by itself, following the MCP access switches below. It only proposes changes: each one appears under its answer and nothing happens until you press Apply.')}</p>
                    <ul class="config-ai-groups" aria-label="${t('assistantAccessGroups', 'MCP access switches')}">${groups}</ul>
                    <p class="config-field-hint">${t('assistantAccessToken',
                        'When a write token is set, asking, Test connection and Apply need it.')}</p>
                    <div class="config-actions">
                        <button type="button" class="config-btn" data-ai-action="open-mcp">${t('assistantOpenMcp', 'Open MCP access')}</button>
                    </div>
                </div>
            </div>`;
    },

    /** Config → Data & backups → Webhooks, with the MCP access fold open and in view. */
    async openMcpAccess() {
        this._openFolds = this._openFolds || new Set();
        this._openFolds.delete('!mcp');
        this._openFolds.add('mcp');
        this.dbTab = 'webhooks';
        await this.openConfigView('data-backups');
        const fold = document.querySelector('[data-fold="mcp"]');
        if (fold) {
            fold.open = true;
            fold.scrollIntoView({ block: 'start', behavior: document.body?.classList.contains('no-animations') ? 'instant' : 'smooth' });
        }
    },

    bindAssistantSection(container) {
        if (container.querySelector('[data-assistant-tab]')) {
            this.bindSubTabStrip(container, 'data-assistant-tab', (tab) => {
                if (tab === this.assistantTab) return;
                this.assistantTab = tab;
                this.restoreConfigHash();
                this.syncSubTabStrip('data-assistant-tab', this.assistantTab);
            });
        }
        this.bindAssistantPanel(container);
    },

    bindAssistantPanel(container) {
        const panel = container.querySelector('[data-ai-panel]');
        if (!panel || panel.dataset.bound === 'true') return;
        panel.dataset.bound = 'true';
        // Explanations and the jump read in the demo too.
        panel.querySelectorAll('[data-info-field]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openFieldInfo(btn.getAttribute('data-info-field'));
            });
        });
        panel.querySelector('[data-ai-action="open-mcp"]')?.addEventListener('click', () => { void this.openMcpAccess(); });
        if (global.DemoLock?.on === true) {
            const line = panel.querySelector('[data-ai-ready-line]');
            if (line) line.textContent = this.t('config.assistantReadyDemo', 'The assistant is not available in the demo.');
            return;
        }
        const provider = () => this.dash.settings?.aiProvider || 'anthropic';
        const input = panel.querySelector('[data-ai-key]');
        const keyState = panel.querySelector('[data-ai-key-state]');
        const removeBtn = panel.querySelector('[data-ai-action="remove-key"]');
        const testState = panel.querySelector('[data-ai-test-state]');
        const readyLine = panel.querySelector('[data-ai-ready-line]');
        let keys = null;
        // The same questions the server asks before it runs (aiReady), in its
        // order, so the line says what the Test button would answer.
        const paintReady = () => {
            if (!readyLine) return;
            const s = this.dash.settings || {};
            const p = provider();
            let key = '';
            if (!s.aiEnabled) key = 'off';
            else if (p !== 'compatible' && !keys) key = '';
            else if (p !== 'compatible' && keys[p] !== true) key = 'no-key';
            else if (p === 'compatible' && !/^https?:\/\/\S+$/i.test(String(s.aiBaseURL || '').trim())) key = 'no-address';
            else if (p === 'compatible' && !String(s.aiModel || '').trim()) key = 'no-model';
            else key = 'ready';
            const lines = {
                off: ['config.assistantReadyOff', 'Turn the assistant on to use it. You can fill this in first; nothing is used until then.'],
                'no-key': ['config.assistantReadyNoKey', 'No key is saved for this provider yet.'],
                'no-address': ['config.assistantReadyNoAddress', 'The server address is missing.'],
                'no-model': ['config.assistantReadyNoModel', 'The model name is missing.'],
                ready: ['config.assistantReadyOk', 'Ready: Test connection sends one small request.'],
            };
            readyLine.hidden = !lines[key];
            readyLine.textContent = lines[key] ? this.t(lines[key][0], lines[key][1]) : '';
        };
        const showKey = (keySet) => {
            if (keySet) keys = keySet;
            paintReady();
            const isSet = keySet?.[provider()] === true;
            if (keyState) {
                keyState.textContent = isSet
                    ? this.t('config.assistantKeyIsSet', 'Key saved.')
                    : this.t('config.assistantKeyNotSet', 'No key saved.');
            }
            if (removeBtn) removeBtn.hidden = !isSet;
        };
        const loadKeys = () => fetch('/api/ai/key', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
            .then((body) => { if (panel.isConnected && body) showKey(body.keySet); }).catch(() => {});
        void loadKeys();
        paintReady();

        const redraw = () => {
            panel.outerHTML = this.renderAssistantPanel();
            this.bindAssistantPanel(container);
            container.querySelector('[data-ai-setting="aiProvider"]')?.focus();
        };
        panel.querySelectorAll('[data-ai-setting]').forEach((el) => {
            el.addEventListener('change', () => {
                const key = el.getAttribute('data-ai-setting');
                const settings = this.dash.settings;
                if (!settings) return;
                if (el.type === 'checkbox') settings[key] = el.checked;
                else if (el.type === 'number') settings[key] = Math.max(0, Math.floor(Number(el.value)) || 0);
                else settings[key] = String(el.value || '').trim();
                void this.saveSettingsWithFeedback();
                if (key === 'aiProvider') redraw();
                else paintReady();
            });
        });

        const keyCall = async (method, body) => {
            const url = method === 'DELETE' ? `/api/ai/key?provider=${encodeURIComponent(provider())}` : '/api/ai/key';
            const res = await this.writeFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: method === 'PUT' ? JSON.stringify(body) : undefined,
            });
            if (!res.ok) throw new Error((await res.text().catch(() => '')).trim() || String(res.status));
            return res.json();
        };
        panel.querySelector('[data-ai-action="save-key"]')?.addEventListener('click', async () => {
            const key = String(input?.value || '').trim();
            if (!key) { input?.focus(); return; }
            try {
                const body = await keyCall('PUT', { provider: provider(), key });
                showKey(body?.keySet);
            } catch (err) {
                this.notify(this.t('config.assistantKeyFailed', 'The key could not be saved: {reason}').replace('{reason}', err.message), 'error');
            } finally {
                // Write-only: the field is emptied whether or not it was kept.
                if (input) input.value = '';
            }
        });
        removeBtn?.addEventListener('click', async () => {
            try { showKey((await keyCall('DELETE'))?.keySet); } catch (_e) { /* the state line stays as it was */ }
        });

        panel.querySelector('[data-ai-action="test"]')?.addEventListener('click', async () => {
            if (!testState) return;
            testState.textContent = '…';
            try {
                const res = await this.writeFetch('/api/ai/test', { method: 'POST' });
                const body = await res.json().catch(() => ({}));
                testState.textContent = body.ok
                    ? this.t('config.assistantTestOk', 'Working: {label}, model {model}.')
                        .replace('{label}', body.label || '').replace('{model}', body.model || '')
                    : this.t('config.assistantTestFailed', 'Not working: {reason}')
                        .replace('{reason}', body.error || body.reason || String(res.status));
            } catch (err) {
                testState.textContent = this.t('config.assistantTestFailed', 'Not working: {reason}').replace('{reason}', err.message);
            }
        });

        panel.querySelector('[data-ai-action="delete-all"]')?.addEventListener('click', async () => {
            const ok = await this.confirmAction(
                this.t('config.assistantDeleteConfirm', 'Delete every stored conversation with the assistant? This cannot be undone.'),
                { confirmLabel: this.t('config.assistantDeleteOk', 'Delete all'), danger: true });
            if (!ok) return;
            try {
                const res = await this.writeFetch('/api/ai/conversations', { method: 'DELETE' });
                if (!res.ok) throw new Error(String(res.status));
                this.notify(this.t('config.assistantDeleted', 'Conversations deleted.'), 'success');
            } catch (err) {
                this.notify(this.t('config.assistantDeleteFailed', 'The conversations could not be deleted: {reason}').replace('{reason}', err.message), 'error');
            }
        });
    },

    });

    global.DashboardConfigAssistantReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
