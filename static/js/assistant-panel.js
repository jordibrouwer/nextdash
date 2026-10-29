/**
 * The assistant panel: a modal with the conversations on the left and the
 * thread on the right. `:ask` opens it.
 *
 * Everything the model or the server says is put on the page as text, never as
 * HTML: answers, titles, errors and the arguments of a proposal. The question
 * goes to /api/ai/ask and nowhere else. Applying a proposal carries the write
 * token through nextDashFetch.
 *
 * Page scrolling is held by scroll-lock.js (the panel is aria-modal) and by a
 * ScrollLock token of its own; this file never writes body.style.overflow.
 */
(function (global) {
    'use strict';

    const SEARCH_DEBOUNCE_MS = 250;

    function t(key, fallback, params) {
        const lang = global.dashboardInstance?.language;
        let text = fallback;
        if (lang?.t) {
            const full = `assistant.${key}`;
            const value = lang.t(full);
            if (value && value !== full) text = value;
        }
        return params
            ? Object.entries(params).reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)), String(text))
            : text;
    }

    function api(path, options) {
        const fetcher = typeof global.nextDashFetch === 'function' ? global.nextDashFetch : fetch;
        return fetcher(path, options);
    }

    /** A small element builder; children are strings (text) or nodes. */
    function el(tag, attrs, ...children) {
        const node = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([name, value]) => {
            if (value === false || value == null) return;
            if (name === 'class') node.className = value;
            else node.setAttribute(name, value === true ? '' : String(value));
        });
        children.flat().forEach((child) => {
            if (child == null || child === false) return;
            node.append(child instanceof Node ? child : document.createTextNode(String(child)));
        });
        return node;
    }

    const NOT_READY = {
        off: ['notReadyOff', 'The assistant is off.'],
        'no-key': ['notReadyNoKey', 'No key is saved for this provider.'],
        'no-address': ['notReadyNoAddress', 'No server address is set for this provider.'],
        'no-model': ['notReadyNoModel', 'No model is set for this provider.'],
    };

    const TOOL_STATUS = {
        '': ['statusBookmarks', 'Looking at your bookmarks…'],
        healthInbox: ['statusHealth', 'Looking at Health and the Inbox…'],
        containersRead: ['statusContainers', 'Looking at your containers…'],
    };

    const TOOL_WORDS = {
        update_bookmark: ['toolUpdate', 'Change a bookmark'],
        move_bookmark: ['toolMove', 'Move a bookmark'],
        delete_bookmark: ['toolDelete', 'Delete a bookmark'],
        add_bookmark: ['toolAdd', 'Add a bookmark'],
        create_category: ['toolCreateCategory', 'Create a category'],
        rename_category: ['toolRenameCategory', 'Rename a category'],
    };

    function toolWords(proposal) {
        if (proposal.tool === 'container_action') {
            const action = String(proposal.arguments?.action || '');
            const verb = action ? action.charAt(0).toUpperCase() + action.slice(1) : t('toolContainerDefault', 'Run an action on');
            return t('toolContainer', '{action} a container', { action: verb });
        }
        const entry = TOOL_WORDS[proposal.tool];
        return entry ? t(entry[0], entry[1]) : String(proposal.tool || '');
    }

    function relativeTime(millis) {
        if (!millis) return '';
        const diff = Math.round((millis - Date.now()) / 1000);
        const abs = Math.abs(diff);
        let rtf;
        try { rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, { numeric: 'auto' }); } catch { return ''; }
        if (abs < 60) return rtf.format(diff, 'second');
        if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
        if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
        return rtf.format(Math.round(diff / 86400), 'day');
    }

    function argumentValue(value) {
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch { return String(value); }
    }

    class AssistantPanel {
        constructor() {
            this.overlay = null;
            this.panel = null;
            this.lock = null;
            this.returnFocus = null;
            this.status = null;
            this.conversations = [];
            this.convId = '';
            this.messages = [];
            this.busy = false;
            this.stream = null;
            this.searchTimer = 0;
            this.keyHandler = (event) => this.onKey(event);
        }

        isOpen() { return Boolean(this.overlay); }

        async open({ question } = {}) {
            const text = String(question || '').trim();
            if (this.overlay) {
                if (text) { this.newConversation(); await this.send(text); }
                return;
            }
            this.returnFocus = document.activeElement;
            this.status = null;
            this.newConversation();
            this.build();
            await Promise.all([this.loadStatus(), this.loadList()]);
            this.renderSide();
            if (!this.ready()) { this.renderThread(); return; }
            if (text) { this.newConversation(); await this.send(text); }
            else this.renderThread();
        }

        ready() { return this.status?.ready === true; }

        close() {
            if (!this.overlay) return;
            this.abortStream();
            clearTimeout(this.searchTimer);
            document.removeEventListener('keydown', this.keyHandler, true);
            if (this.lock != null) { global.ScrollLock?.release?.(this.lock); this.lock = null; }
            this.overlay.remove();
            this.overlay = null;
            this.panel = null;
            const back = this.returnFocus;
            this.returnFocus = null;
            if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
        }

        // ---- Frame ---------------------------------------------------------

        build() {
            this.overlay = el('div', { class: 'assistant-overlay' });
            this.panel = el('section', {
                class: 'assistant-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'assistant-title',
            });
            const side = el('aside', { class: 'assistant-side' },
                el('button', { type: 'button', class: 'assistant-new', 'data-ai-new': true }, t('newConversation', 'New conversation')),
                el('input', {
                    type: 'search', class: 'assistant-search', 'data-ai-search': true,
                    placeholder: t('searchPlaceholder', 'Search conversations'), 'aria-label': t('searchLabel', 'Search conversations'),
                }),
                el('ul', { class: 'assistant-list', 'data-ai-list': true }));
            const main = el('div', { class: 'assistant-main' },
                el('header', { class: 'assistant-head' },
                    el('h2', { class: 'assistant-title', id: 'assistant-title' }, t('title', 'Assistant')),
                    el('button', { type: 'button', class: 'assistant-close', 'data-ai-close': true, 'aria-label': t('close', 'Close') }, '×')),
                el('div', { class: 'assistant-thread', 'data-ai-thread': true, role: 'log', 'aria-live': 'polite' }),
                el('form', { class: 'assistant-compose', 'data-ai-compose': true },
                    el('textarea', {
                        class: 'assistant-input', 'data-ai-input': true, rows: 2,
                        placeholder: t('inputPlaceholder', 'Ask about your bookmarks'), 'aria-label': t('inputLabel', 'Your question'),
                    }),
                    el('button', { type: 'submit', class: 'assistant-send', 'data-ai-send': true }, t('send', 'Send'))));
            this.panel.append(side, main);
            this.overlay.append(this.panel);

            this.overlay.addEventListener('mousedown', (event) => { if (event.target === this.overlay) this.close(); });
            this.panel.addEventListener('click', (event) => this.onClick(event));
            this.panel.querySelector('[data-ai-compose]').addEventListener('submit', (event) => {
                event.preventDefault();
                void this.submitInput();
            });
            const input = this.panel.querySelector('[data-ai-input]');
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                    event.preventDefault();
                    void this.submitInput();
                }
            });
            this.panel.querySelector('[data-ai-search]').addEventListener('input', () => {
                clearTimeout(this.searchTimer);
                this.searchTimer = setTimeout(async () => { await this.loadList(); this.renderSide(); }, SEARCH_DEBOUNCE_MS);
            });

            document.body.appendChild(this.overlay);
            this.lock = global.ScrollLock?.acquire?.('assistant-panel') ?? null;
            document.addEventListener('keydown', this.keyHandler, true);
            requestAnimationFrame(() => this.overlay?.classList.add('show'));
            input.focus({ preventScroll: true });
        }

        onKey(event) {
            if (!this.panel) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.close();
                return;
            }
            if (event.key === 'Tab') global.FocusTrapUtils?.trapTabKey?.(event, this.panel);
        }

        onClick(event) {
            const target = event.target.closest('button');
            if (!target || !this.panel.contains(target)) return;
            if (target.hasAttribute('data-ai-close')) { this.close(); return; }
            if (target.hasAttribute('data-ai-new')) { this.newConversation(); this.renderSide(); this.renderThread(); this.focusInput(); return; }
            if (target.hasAttribute('data-ai-setup')) {
                this.close();
                global.dashboardInstance?.config?.openAssistantFold?.();
                return;
            }
            const row = target.closest('[data-ai-conv]');
            if (row && target.hasAttribute('data-ai-delete')) { void this.remove(row.getAttribute('data-ai-conv')); return; }
            if (row && target.hasAttribute('data-ai-open')) { void this.select(row.getAttribute('data-ai-conv')); return; }
            if (target.hasAttribute('data-ai-apply-all')) {
                void this.applyAll(target.closest('[data-ai-message]')?.getAttribute('data-ai-message'));
                return;
            }
            const card = target.closest('[data-ai-proposal]');
            if (card) {
                const id = card.getAttribute('data-ai-proposal');
                if (target.hasAttribute('data-ai-apply')) void this.applyOne(id);
                else if (target.hasAttribute('data-ai-skip')) void this.skipOne(id);
            }
        }

        focusInput() { this.panel?.querySelector('[data-ai-input]')?.focus({ preventScroll: true }); }

        // ---- Data ----------------------------------------------------------

        async loadStatus() {
            try {
                const res = await api('/api/ai/status', { cache: 'no-store' });
                this.status = res.ok ? await res.json() : { ready: false, reason: 'off' };
            } catch {
                this.status = { ready: false, reason: 'off' };
            }
        }

        async loadList() {
            const q = this.panel?.querySelector('[data-ai-search]')?.value.trim() || '';
            try {
                const res = await api(`/api/ai/conversations${q ? `?q=${encodeURIComponent(q)}` : ''}`, { cache: 'no-store' });
                const list = res.ok ? await res.json() : [];
                this.conversations = Array.isArray(list) ? list : [];
            } catch {
                this.conversations = [];
            }
        }

        /** Lets go of the request in flight; its events are ignored from here on. */
        abortStream() {
            const stream = this.stream;
            this.stream = null;
            this.busy = false;
            stream?.controller.abort();
            const send = this.panel?.querySelector('[data-ai-send]');
            if (send) send.disabled = false;
        }

        newConversation() {
            this.abortStream();
            this.convId = '';
            this.messages = [];
        }

        async select(id) {
            if (!id) return;
            this.abortStream();
            try {
                const res = await api(`/api/ai/conversations/${encodeURIComponent(id)}`, { cache: 'no-store' });
                if (!res.ok) throw new Error(String(res.status));
                const conv = await res.json();
                this.convId = conv.id;
                this.messages = (conv.messages || []).map((m) => ({ ...m, proposals: m.proposals || [] }));
            } catch {
                this.newConversation();
                this.messages = [{ role: 'error', text: t('gone', 'That conversation no longer exists.') }];
                await this.loadList();
            }
            this.renderSide();
            this.renderThread();
        }

        async remove(id) {
            if (!id) return;
            if (id === this.convId) this.abortStream();
            try {
                const res = await api(`/api/ai/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
                if (!res.ok && res.status !== 404) throw new Error(String(res.status));
            } catch {
                return;
            }
            if (id === this.convId) this.newConversation();
            await this.loadList();
            this.renderSide();
            this.renderThread();
        }

        // ---- Rendering -----------------------------------------------------

        renderSide() {
            const list = this.panel?.querySelector('[data-ai-list]');
            if (!list) return;
            list.replaceChildren(...this.conversations.map((c) => {
                const open = el('button', { type: 'button', class: 'assistant-conv-open', 'data-ai-open': true },
                    el('span', { class: 'assistant-conv-title' }, c.title || t('untitled', 'Untitled')),
                    el('span', { class: 'assistant-conv-time' }, relativeTime(c.updated)));
                const del = el('button', {
                    type: 'button', class: 'assistant-conv-delete', 'data-ai-delete': true,
                    'aria-label': t('deleteConversation', 'Delete conversation'), title: t('deleteConversation', 'Delete conversation'),
                }, '×');
                return el('li', {
                    class: `assistant-conv${c.id === this.convId ? ' is-active' : ''}`, 'data-ai-conv': c.id,
                    'aria-current': c.id === this.convId ? 'true' : false,
                }, open, del);
            }));
        }

        threadEl() { return this.panel?.querySelector('[data-ai-thread]'); }

        renderThread() {
            const thread = this.threadEl();
            if (!thread) return;
            if (!this.ready()) {
                const [key, fallback] = NOT_READY[this.status?.reason] || NOT_READY.off;
                thread.replaceChildren(el('div', { class: 'assistant-empty', 'data-ai-empty': true },
                    el('p', null, t(key, fallback)),
                    el('button', { type: 'button', class: 'assistant-setup', 'data-ai-setup': true }, t('setup', 'Set it up in Config'))));
                this.panel.querySelector('[data-ai-input]').disabled = true;
                this.panel.querySelector('[data-ai-send]').disabled = true;
                return;
            }
            if (!this.messages.length) {
                thread.replaceChildren(el('p', { class: 'assistant-hint' },
                    t('hint', 'Ask about your bookmarks, Health or containers. Changes it suggests wait for your click.')));
                return;
            }
            thread.replaceChildren(...this.messages.map((m) => this.messageEl(m)));
            thread.scrollTop = thread.scrollHeight;
        }

        metaText(m) {
            const label = this.status?.label || m.provider || '';
            const tokens = (Number(m.tokensIn) || 0) + (Number(m.tokensOut) || 0);
            return [label, m.model, t('tokens', '{n} tokens', { n: tokens.toLocaleString() })].filter(Boolean).join(' · ');
        }

        messageEl(m) {
            if (m.role === 'error') return el('p', { class: 'assistant-error', role: 'alert' }, m.text);
            if (m.role === 'user') return el('div', { class: 'assistant-msg assistant-msg--user' }, el('p', null, m.text));
            const node = el('div', { class: 'assistant-msg assistant-msg--assistant', 'data-ai-message': m.id || '' });
            const body = el('div', { class: 'assistant-text', 'data-ai-text': true }, m.text || '');
            node.append(body);
            if (m.status) node.append(el('p', { class: 'assistant-status', 'data-ai-status': true, role: 'status' }, m.status));
            if (m.cut) node.append(el('p', { class: 'assistant-error', role: 'alert' }, t('cutOff', 'The answer was cut off.')));
            const proposals = m.proposals || [];
            if (proposals.length) {
                const box = el('div', { class: 'assistant-proposals' });
                proposals.forEach((p) => box.append(this.cardEl(p)));
                const pending = proposals.filter((p) => p.status === 'pending' && !p.destructive);
                const pendingAll = proposals.filter((p) => p.status === 'pending');
                if (pendingAll.length >= 2 && pending.length) {
                    box.append(el('button', { type: 'button', class: 'assistant-apply-all', 'data-ai-apply-all': true },
                        t('applyAll', 'Apply all')));
                }
                if (m.applyError) box.append(el('p', { class: 'assistant-error', role: 'alert' }, m.applyError));
                node.append(box);
            }
            if (m.id) node.append(el('p', { class: 'assistant-meta' }, this.metaText(m)));
            return node;
        }

        cardEl(p) {
            const card = el('div', {
                class: `assistant-proposal${p.destructive ? ' is-destructive' : ''}`,
                'data-ai-proposal': p.id, 'data-status': p.status, 'data-destructive': p.destructive ? 'true' : false,
            });
            card.append(el('p', { class: 'assistant-proposal-title' }, toolWords(p),
                p.destructive ? el('span', { class: 'assistant-proposal-flag' }, t('destructive', 'Destructive')) : null));
            const args = p.arguments && typeof p.arguments === 'object' ? Object.entries(p.arguments) : [];
            if (args.length) {
                card.append(el('dl', { class: 'assistant-proposal-args' },
                    args.flatMap(([key, value]) => [el('dt', null, key), el('dd', null, argumentValue(value))])));
            }
            if (p.reason) card.append(el('p', { class: 'assistant-proposal-reason' }, p.reason));
            const actions = el('div', { class: 'assistant-proposal-actions' });
            if (p.status === 'applied') {
                actions.append(el('span', { class: 'assistant-done', 'data-ai-done': true }, t('done', 'Done')));
            } else if (p.status === 'skipped') {
                actions.append(el('span', { class: 'assistant-skipped' }, t('skipped', 'Skipped')));
            } else if (p.status === 'applying') {
                actions.append(el('span', { class: 'assistant-skipped', role: 'status' }, t('applying', 'Applying…')));
            } else {
                if (p.status === 'failed' && p.error) {
                    card.append(el('p', { class: 'assistant-error', role: 'alert', 'data-ai-proposal-error': true }, p.error));
                }
                actions.append(
                    el('button', { type: 'button', class: 'assistant-apply', 'data-ai-apply': true }, t('apply', 'Apply')),
                    el('button', { type: 'button', class: 'assistant-skip', 'data-ai-skip': true }, t('skip', 'Skip')));
            }
            card.append(actions);
            return card;
        }

        // ---- Asking --------------------------------------------------------

        async submitInput() {
            const input = this.panel?.querySelector('[data-ai-input]');
            const text = input?.value.trim();
            if (!text || this.busy || !this.ready()) return;
            input.value = '';
            await this.send(text);
        }

        async send(question) {
            if (this.busy || !this.panel || !this.ready()) return;
            const stream = { controller: new AbortController() };
            this.stream = stream;
            const current = () => this.stream === stream;
            this.busy = true;
            this.panel.querySelector('[data-ai-send]').disabled = true;
            this.messages = this.messages.filter((m) => m.role !== 'error');
            const asked = { role: 'user', text: question };
            this.messages.push(asked);
            const live = { role: 'assistant', text: '', status: t('thinking', 'Thinking…'), proposals: [] };
            this.messages.push(live);
            this.renderThread();
            this.focusInput();
            let finished = false;
            let failed = '';
            let broke = false;
            try {
                const res = await api('/api/ai/ask', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ conversationId: this.convId, question }),
                    signal: stream.controller.signal,
                });
                if (!current()) return;
                if (!res.ok) {
                    const body = await res.json().catch(() => null);
                    failed = body?.error || t('failed', 'The assistant could not answer.');
                } else {
                    await this.readStream(res, (ev) => {
                        if (!current()) return;
                        if (ev.type === 'start') {
                            if (ev.conversationId) this.convId = ev.conversationId;
                        } else if (ev.type === 'text') {
                            live.text += String(ev.text || '');
                            live.status = '';
                            this.paintLive(live);
                        } else if (ev.type === 'tool') {
                            const [key, fallback] = TOOL_STATUS[ev.group || ''] || TOOL_STATUS[''];
                            live.status = t(key, fallback);
                            this.paintLive(live);
                        } else if (ev.type === 'error') {
                            failed = String(ev.error || t('failed', 'The assistant could not answer.'));
                        } else if (ev.type === 'done') {
                            finished = true;
                            if (ev.conversation?.id) this.convId = ev.conversation.id;
                            const idx = this.messages.indexOf(live);
                            if (idx >= 0 && ev.message) {
                                this.messages[idx] = { ...ev.message, proposals: ev.message.proposals || [] };
                            }
                        }
                    });
                }
            } catch {
                if (!current()) return;
                // A read that breaks after some text is a cut answer; before any, a failure.
                if (live.text && !failed) broke = true;
                else failed = failed || t('failed', 'The assistant could not answer.');
            }
            if (!current()) return;
            this.stream = null;
            if (failed) {
                this.messages = this.messages.filter((m) => m !== live && m !== asked);
                this.messages.push({ role: 'error', text: failed });
                const input = this.panel?.querySelector('[data-ai-input]');
                if (input && !input.value) input.value = question;
            } else if (!finished || broke) {
                live.status = '';
                live.cut = true;
            }
            this.busy = false;
            if (!this.panel) return;
            this.panel.querySelector('[data-ai-send]').disabled = false;
            this.renderThread();
            this.focusInput();
            await this.loadList();
            if (current() || !this.stream) this.renderSide();
        }

        /** Updates the live message in place, so the page does not rebuild per token. */
        paintLive(live) {
            const nodes = this.threadEl()?.querySelectorAll('.assistant-msg--assistant');
            const node = nodes?.[nodes.length - 1];
            if (!node) return;
            node.querySelector('[data-ai-text]').textContent = live.text;
            let status = node.querySelector('[data-ai-status]');
            if (live.status) {
                if (!status) {
                    status = el('p', { class: 'assistant-status', 'data-ai-status': true, role: 'status' });
                    node.append(status);
                }
                status.textContent = live.status;
            } else status?.remove();
            const thread = this.threadEl();
            thread.scrollTop = thread.scrollHeight;
        }

        async readStream(res, onEvent) {
            const take = (line) => {
                if (!line.trim()) return;
                let ev = null;
                try { ev = JSON.parse(line); } catch { return; }
                onEvent(ev);
            };
            if (!res.body?.getReader) {
                String(await res.text()).split('\n').forEach(take);
                return;
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let at = buffer.indexOf('\n');
                while (at >= 0) {
                    take(buffer.slice(0, at));
                    buffer = buffer.slice(at + 1);
                    at = buffer.indexOf('\n');
                }
            }
            take(buffer);
        }

        // ---- Proposals -----------------------------------------------------

        findProposal(id) {
            for (const m of this.messages) {
                const p = (m.proposals || []).find((x) => x.id === id);
                if (p) return { message: m, proposal: p };
            }
            return null;
        }

        applyFailure(res, body) {
            if (res.status === 401) return t('needsToken', 'Applying needs the write token.');
            return body?.error || t('applyFailed', 'The change could not be made.');
        }

        /** The server's own copy of a proposal, for a repeat it refused. */
        async refreshProposal(proposal) {
            try {
                const res = await api(`/api/ai/conversations/${encodeURIComponent(this.convId)}`, { cache: 'no-store' });
                if (!res.ok) return false;
                const conv = await res.json();
                for (const m of conv.messages || []) {
                    const fresh = (m.proposals || []).find((x) => x.id === proposal.id);
                    if (fresh) { Object.assign(proposal, fresh); return true; }
                }
            } catch { /* handled by the caller */ }
            return false;
        }

        async settleOne(proposal, res, body) {
            if (res?.ok && body?.id) { Object.assign(proposal, body); return; }
            // A repeat the server refused: show what it holds, not a failure.
            if (res?.status === 409 && await this.refreshProposal(proposal)) return;
            proposal.status = 'failed';
            proposal.error = res ? this.applyFailure(res, body) : t('applyFailed', 'The change could not be made.');
        }

        async applyOne(id) {
            const found = this.findProposal(id);
            if (!found || ['applying', 'applied', 'skipped'].includes(found.proposal.status)) return;
            const { message, proposal } = found;
            message.applyError = '';
            proposal.status = 'applying';
            this.renderThread();
            let res = null;
            let body = null;
            try {
                res = await api(`/api/ai/proposals/${encodeURIComponent(id)}/apply`, { method: 'POST' });
                body = await res.json().catch(() => null);
            } catch { /* handled below */ }
            await this.settleOne(proposal, res, body);
            this.renderThread();
        }

        async skipOne(id) {
            const found = this.findProposal(id);
            if (!found || ['applying', 'applied', 'skipped'].includes(found.proposal.status)) return;
            const { proposal } = found;
            proposal.status = 'applying';
            this.renderThread();
            let res = null;
            let body = null;
            try {
                res = await api(`/api/ai/proposals/${encodeURIComponent(id)}/skip`, { method: 'POST' });
                body = await res.json().catch(() => null);
            } catch { /* handled below */ }
            await this.settleOne(proposal, res, body);
            this.renderThread();
        }

        async applyAll(messageId) {
            const message = this.messages.find((m) => m.id && m.id === messageId);
            if (!message) return;
            // Destructive ones are never in this call: they need their own click.
            const chosen = (message.proposals || []).filter((p) => p.status === 'pending' && !p.destructive);
            const ids = chosen.map((p) => p.id);
            if (!ids.length) return;
            message.applyError = '';
            chosen.forEach((p) => { p.status = 'applying'; });
            this.renderThread();
            let res = null;
            let body = null;
            try {
                res = await api('/api/ai/proposals/apply-all', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids }),
                });
                body = await res.json().catch(() => null);
            } catch { /* handled below */ }
            if (res?.ok && Array.isArray(body?.results)) {
                body.results.forEach((r) => {
                    const p = chosen.find((x) => x.id === r.id);
                    if (p) Object.assign(p, r);
                });
            } else {
                message.applyError = res ? this.applyFailure(res, body) : t('applyFailed', 'The change could not be made.');
            }
            // Whatever the answer did not settle is still waiting for a click.
            chosen.forEach((p) => { if (p.status === 'applying') p.status = 'pending'; });
            this.renderThread();
        }
    }

    const panel = new AssistantPanel();
    global.AssistantPanel = {
        open: (options) => panel.open(options),
        close: () => panel.close(),
        isOpen: () => panel.isOpen(),
    };
})(window);
