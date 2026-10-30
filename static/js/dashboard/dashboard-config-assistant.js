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

    /** The panel on the Settings tab: switch, provider, a write-only key, limits. */
    renderAssistantPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        const provider = ['anthropic', 'openai', 'compatible'].includes(s.aiProvider) ? s.aiProvider : 'anthropic';
        const demo = global.DemoLock?.on === true;
        const opt = (value, label) => `<option value="${value}" ${provider === value ? 'selected' : ''}>${esc(label)}</option>`;
        const num = (key) => (Number(s[key]) > 0 ? Number(s[key]) : '');
        const body = `
                <p class="config-panel-note">${esc(this.t('config.assistantNote',
                    'Ask questions about your bookmarks and let the assistant propose changes you approve one by one. Your questions and the bookmark data it looks up go to the provider you pick below.'))}</p>
                <label class="config-toggle">
                    <input type="checkbox" data-ai-setting="aiEnabled" ${s.aiEnabled === true ? 'checked' : ''}>
                    <span>${esc(this.t('config.assistantEnabled', 'Turn the assistant on'))}</span>
                </label>
                <div class="config-field">
                    <label class="config-field-label" for="config-ai-provider">${esc(this.t('config.assistantProvider', 'Provider'))}</label>
                    <select id="config-ai-provider" class="config-select" data-ai-setting="aiProvider">
                        ${opt('anthropic', 'Claude')}${opt('openai', 'OpenAI')}${opt('compatible', this.t('config.assistantProviderCompatible', 'OpenAI-compatible (Ollama, LM Studio…)'))}
                    </select>
                </div>
                <div class="config-field">
                    <label class="config-field-label" for="config-ai-key">${esc(this.t('config.assistantKey', 'API key'))}</label>
                    <input type="password" id="config-ai-key" class="config-text" data-ai-key autocomplete="off" spellcheck="false">
                    <p class="config-field-hint">${esc(this.t('config.assistantKeyNote',
                        'Stored on this server and never shown again. Keyless servers on your own network can leave it empty.'))}</p>
                </div>
                <p class="config-field-hint" data-ai-key-state></p>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-ai-action="save-key">${esc(this.t('config.assistantKeySave', 'Save key'))}</button>
                    <button type="button" class="config-btn config-btn--danger" data-ai-action="remove-key" hidden>${esc(this.t('config.assistantKeyRemove', 'Remove key'))}</button>
                </div>
                ${provider === 'compatible' ? `
                <div class="config-field">
                    <label class="config-field-label" for="config-ai-url">${esc(this.t('config.assistantBaseURL', 'Server address'))}</label>
                    <input type="url" id="config-ai-url" class="config-text" data-ai-setting="aiBaseURL" autocomplete="off" spellcheck="false"
                        placeholder="http://localhost:11434/v1" value="${esc(s.aiBaseURL || '')}">
                </div>` : ''}
                <div class="config-field">
                    <label class="config-field-label" for="config-ai-model">${esc(this.t('config.assistantModel', 'Model'))}</label>
                    <input type="text" id="config-ai-model" class="config-text" data-ai-setting="aiModel" autocomplete="off" spellcheck="false"
                        placeholder="${esc(AI_DEFAULT_MODELS[provider] || '')}" value="${esc(s.aiModel || '')}">
                </div>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-ai-action="test">${esc(this.t('config.assistantTest', 'Test connection'))}</button>
                </div>
                <p class="config-field-hint" data-ai-test-state role="status"></p>
                <div class="config-field">
                    <label class="config-field-label" for="config-ai-history-max">${esc(this.t('config.assistantHistoryMax', 'Conversations to keep'))}</label>
                    <input type="number" min="1" id="config-ai-history-max" class="config-text" data-ai-setting="aiHistoryMax" placeholder="50" value="${num('aiHistoryMax')}">
                </div>
                <div class="config-field">
                    <label class="config-field-label" for="config-ai-history-days">${esc(this.t('config.assistantHistoryDays', 'Days to keep them'))}</label>
                    <input type="number" min="1" id="config-ai-history-days" class="config-text" data-ai-setting="aiHistoryDays" placeholder="90" value="${num('aiHistoryDays')}">
                </div>
                <div class="config-actions">
                    <button type="button" class="config-btn config-btn--danger" data-ai-action="delete-all">${esc(this.t('config.assistantDeleteAll', 'Delete all conversations'))}</button>
                </div>`;
        return `
            <div class="config-panel" data-ai-panel>
                <h3 class="config-panel-title">${esc(this.t('config.assistantTitle', 'AI Assistant'))}</h3>
                ${demo ? `<div>${global.DemoLock.chip('privacy')}</div><fieldset class="config-demo-lock" disabled>${body}</fieldset>` : body}
            </div>`;
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
        if (global.DemoLock?.on === true) return;
        const provider = () => this.dash.settings?.aiProvider || 'anthropic';
        const input = panel.querySelector('[data-ai-key]');
        const keyState = panel.querySelector('[data-ai-key-state]');
        const removeBtn = panel.querySelector('[data-ai-action="remove-key"]');
        const testState = panel.querySelector('[data-ai-test-state]');
        const showKey = (keySet) => {
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
                if (input) input.value = '';
                showKey(body?.keySet);
            } catch (err) {
                this.notify(this.t('config.assistantKeyFailed', 'The key could not be saved: {reason}').replace('{reason}', err.message), 'error');
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
