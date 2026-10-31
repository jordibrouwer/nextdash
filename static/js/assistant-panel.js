/**
 * The assistant panel: a modal built like the command palette. The question
 * field is the prompt row at the top; under it the conversations on the left
 * and the thread on the right. `:ask` and `=` open it.
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

    /*
     * Answers as text: a small, safe subset of Markdown, built from DOM nodes.
     *
     * Paragraphs and line breaks, **bold**, *italic* and _italic_, `code`,
     * fenced code blocks, - and * bullet lists, 1. numbered lists and # headings
     * (as bold lines). A link is [label](#hash) and only for the hashes the app
     * itself routes: #config, #config/<section>, #config/<section>/<tab> and a
     * page number. Everything else, links to other addresses and any HTML
     * included, stays on the page as the characters it was sent as. Rendered
     * again from the whole text on every chunk, so a marker that is not closed
     * yet is just text until the closing one arrives.
     */
    const LINK_HASH = /^#(config(\/[a-z0-9-]+){0,2}|[0-9]{1,3})$/;

    function linkEl(label, hash) {
        return el('a', { class: 'assistant-link', href: hash, 'data-ai-link': hash }, label);
    }

    function inlineNodes(src) {
        const out = [];
        let buf = '';
        const flush = () => { if (buf) { out.push(document.createTextNode(buf)); buf = ''; } };
        const isSpace = (ch) => ch === undefined || /\s/.test(ch);
        const isWord = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
        let i = 0;
        while (i < src.length) {
            const c = src[i];
            if (c === '`') {
                const end = src.indexOf('`', i + 1);
                if (end > i + 1) {
                    flush();
                    out.push(el('code', null, src.slice(i + 1, end)));
                    i = end + 1;
                    continue;
                }
            } else if (c === '[') {
                const m = /^\[([^\]]{1,120})\]\((#[^)\s]{1,60})\)/.exec(src.slice(i));
                if (m && LINK_HASH.test(m[2])) {
                    flush();
                    out.push(linkEl(m[1], m[2]));
                    i += m[0].length;
                    continue;
                }
            } else if (c === '*' && src[i + 1] === '*' && !isSpace(src[i + 2])) {
                const end = src.indexOf('**', i + 2);
                if (end > i + 2 && !isSpace(src[end - 1])) {
                    flush();
                    out.push(el('strong', null, ...inlineNodes(src.slice(i + 2, end))));
                    i = end + 2;
                    continue;
                }
            } else if ((c === '*' || c === '_') && src[i + 1] !== c && !isSpace(src[i + 1]) && !(c === '_' && isWord(src[i - 1]))) {
                let end = i + 1;
                for (;;) {
                    end = src.indexOf(c, end + 1);
                    if (end < 0) break;
                    if (src[end + 1] === c || src[end - 1] === c) { end += 1; continue; }
                    if (isSpace(src[end - 1]) || (c === '_' && isWord(src[end + 1]))) continue;
                    break;
                }
                if (end > i + 1) {
                    flush();
                    out.push(el('em', null, ...inlineNodes(src.slice(i + 1, end))));
                    i = end + 1;
                    continue;
                }
            }
            buf += c;
            i += 1;
        }
        flush();
        return out;
    }

    /** The text of an answer as a fragment of block elements. */
    function renderMarkdown(text) {
        const frag = document.createDocumentFragment();
        const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
        let para = [];
        let list = null;
        const endPara = () => {
            if (!para.length) return;
            const p = el('p', null);
            para.forEach((line, n) => {
                if (n) p.append(document.createElement('br'));
                p.append(...inlineNodes(line));
            });
            frag.append(p);
            para = [];
        };
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            if (/^\s*```/.test(line)) {
                endPara();
                list = null;
                const code = [];
                // An unclosed fence (the answer is still arriving) is a code block so far.
                for (i += 1; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i += 1) code.push(lines[i]);
                frag.append(el('pre', { class: 'assistant-code' }, el('code', null, code.join('\n'))));
                continue;
            }
            if (!line.trim()) { endPara(); list = null; continue; }
            const heading = /^\s{0,3}#{1,6}\s+(\S.*)$/.exec(line);
            if (heading) {
                endPara();
                list = null;
                frag.append(el('p', { class: 'assistant-md-heading' }, el('strong', null, ...inlineNodes(heading[1].trim()))));
                continue;
            }
            const item = /^\s*([-*]|\d{1,3}[.)])\s+(\S.*)$/.exec(line);
            if (item) {
                endPara();
                const tag = /\d/.test(item[1]) ? 'ol' : 'ul';
                if (!list || list.tag !== tag) {
                    const node = document.createElement(tag);
                    if (tag === 'ol' && parseInt(item[1], 10) > 1) node.setAttribute('start', String(parseInt(item[1], 10)));
                    list = { tag, node };
                    frag.append(node);
                }
                list.node.append(el('li', null, ...inlineNodes(item[2].trim())));
                continue;
            }
            if (list && /^\s{2,}\S/.test(line)) {
                const li = list.node.lastElementChild;
                li.append(document.createElement('br'), ...inlineNodes(line.trim()));
                continue;
            }
            list = null;
            para.push(line.trimEnd());
        }
        endPara();
        return frag;
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
        docs: ['statusDocs', 'Looking in the manual…'],
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
        // Narrow ("3m ago"): it is the shortcut column of a row, not a sentence.
        try { rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, { numeric: 'auto', style: 'narrow' }); } catch { return ''; }
        if (abs < 60) return rtf.format(diff, 'second');
        if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
        if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
        return rtf.format(Math.round(diff / 86400), 'day');
    }

    function argumentValue(value) {
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch { return String(value); }
    }

    /** The question field grows with its text up to this many lines. */
    const INPUT_MAX_LINES = 5;

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
            /** Which row of the left column the arrow keys are on: -1 none, 0 "New conversation", 1.. a conversation. */
            this.selected = -1;
            /*
             * One number per time the panel is opened. Everything that awaits the
             * server checks it afterwards: a panel closed (and perhaps opened
             * again) in the meantime is not the one the answer was for, so the
             * answer is dropped instead of painted into the new one.
             */
            this.generation = 0;
            /** While the first open reads the status and the list: the request the panel is to show once it has them. */
            this.loading = null;
            this.pending = null;
            this.keyHandler = (event) => this.onKey(event);
            this.resizeHandler = () => this.fitInput();
        }

        isOpen() { return Boolean(this.overlay); }

        /**
         * Opens the panel, or brings an open one to what is asked: a question to
         * send, a conversation to show, or just the field. A second call while
         * the first is still reading the status takes its place (the last ask
         * wins) rather than being lost against a status that is not there yet.
         */
        async open({ question, conversationId } = {}) {
            const request = { text: String(question || '').trim(), conversationId: conversationId || '' };
            if (this.overlay) {
                if (this.loading) {
                    this.pending = request;
                    this.focusInput();
                    return this.loading;
                }
                return this.show(request);
            }
            this.returnFocus = document.activeElement;
            this.status = null;
            this.selected = -1;
            this.confirmingDeleteAll = false;
            this.deletingAll = false;
            this.deleteAllError = '';
            this.newConversation();
            this.build();
            const generation = this.generation;
            this.pending = request;
            const loading = Promise.all([this.loadStatus(), this.loadList()]);
            this.loading = loading;
            await loading;
            if (generation !== this.generation) return undefined;
            this.loading = null;
            const next = this.pending;
            this.pending = null;
            this.renderSide();
            return this.show(next);
        }

        /** What an open, loaded panel does with one request. Focus ends in the field either way. */
        async show({ text, conversationId }) {
            const generation = this.generation;
            if (!this.ready()) {
                this.renderThread();
            } else if (text) {
                this.newConversation();
                this.renderSide();
                await this.send(text);
            } else if (conversationId) {
                await this.select(conversationId);
            } else {
                this.renderThread();
            }
            if (generation === this.generation) this.focusInput();
        }

        ready() { return this.status?.ready === true; }

        close() {
            if (!this.overlay) return;
            this.generation += 1;
            this.loading = null;
            this.pending = null;
            this.abortStream();
            clearTimeout(this.searchTimer);
            document.removeEventListener('keydown', this.keyHandler, true);
            global.removeEventListener('resize', this.resizeHandler);
            if (this.lock != null) { global.ScrollLock?.release?.(this.lock); this.lock = null; }
            this.overlay.remove();
            this.overlay = null;
            this.panel = null;
            const back = this.returnFocus;
            this.returnFocus = null;
            if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
        }

        // ---- Frame ---------------------------------------------------------

        /*
         * The palette's layout: the prompt row first, across the whole panel,
         * with the mode pill on its left (the palette's own .search-prompt and
         * .search-prefix, so every material draws both alike); under it the
         * conversations on the left, as the palette's rail, and the thread on
         * the right. The close button comes last in the document, so Tab runs
         * field, Send, rows, row actions, close; the grid puts it back at the
         * end of the prompt row.
         */
        build() {
            this.overlay = el('div', { class: 'assistant-overlay' });
            this.panel = el('section', {
                class: 'assistant-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'assistant-title',
            });
            const prompt = el('form', { class: 'search-prompt assistant-prompt', 'data-ai-compose': true },
                el('span', { class: 'search-prefix assistant-badge', 'data-mode': 'assistant', id: 'assistant-title' }, t('title', 'AI Assistant')),
                el('textarea', {
                    class: 'assistant-input', 'data-ai-input': true, rows: 1,
                    placeholder: t('inputPlaceholder', 'Ask about your bookmarks'), 'aria-label': t('inputLabel', 'Your question'),
                }),
                el('button', {
                    type: 'submit', class: 'assistant-send', 'data-ai-send': true,
                    'aria-label': t('send', 'Send'), title: t('send', 'Send'),
                }, el('span', { 'aria-hidden': 'true' }, '↵')));
            const side = el('aside', { class: 'assistant-side' },
                el('input', {
                    type: 'search', class: 'assistant-search', 'data-ai-search': true,
                    placeholder: t('searchPlaceholder', 'Search conversations'), 'aria-label': t('searchLabel', 'Search conversations'),
                }),
                el('ul', { class: 'assistant-list', 'data-ai-list': true }),
                el('div', { class: 'assistant-side-foot', 'data-ai-side-foot': true }));
            const body = el('div', { class: 'assistant-body' },
                side,
                el('div', { class: 'assistant-thread', 'data-ai-thread': true, role: 'log', 'aria-live': 'polite' }));
            const close = el('button', {
                type: 'button', class: 'assistant-close', 'data-ai-close': true, 'aria-label': t('close', 'Close'), title: t('close', 'Close'),
            }, '×');
            this.panel.append(prompt, body, close);
            this.overlay.append(this.panel);

            this.overlay.addEventListener('mousedown', (event) => { if (event.target === this.overlay) this.close(); });
            this.panel.addEventListener('click', (event) => this.onClick(event));
            prompt.addEventListener('submit', (event) => {
                event.preventDefault();
                void this.submitInput();
            });
            const input = this.panel.querySelector('[data-ai-input]');
            input.addEventListener('keydown', (event) => this.onInputKey(event));
            input.addEventListener('input', () => this.fitInput());
            this.panel.querySelector('[data-ai-list]').addEventListener('keydown', (event) => this.onListKey(event));
            this.panel.querySelector('[data-ai-search]').addEventListener('input', () => {
                // At once, not after the list: Delete all goes while the list is filtered.
                this.renderFoot();
                clearTimeout(this.searchTimer);
                const generation = this.generation;
                this.searchTimer = setTimeout(async () => {
                    await this.loadList();
                    if (generation === this.generation) this.renderSide();
                }, SEARCH_DEBOUNCE_MS);
            });

            document.body.appendChild(this.overlay);
            this.lock = global.ScrollLock?.acquire?.('assistant-panel') ?? null;
            document.addEventListener('keydown', this.keyHandler, true);
            global.addEventListener('resize', this.resizeHandler);
            /*
             * Shown at once rather than a frame later. The overlay is
             * visibility:hidden until it has .show, and a hidden field cannot
             * take focus: with the class waiting for a frame, the focus below
             * went nowhere, and when the answer came back before that frame
             * every later focus missed too. One style read first, so the fade
             * still has a painted start to run from.
             */
            void this.overlay.offsetWidth;
            this.overlay.classList.add('show');
            const overlay = this.overlay;
            overlay.addEventListener('transitionend', (event) => {
                if (event.target === overlay && this.overlay === overlay) this.keepFocus();
            }, { once: true });
            this.fitInput();
            this.focusInput();
        }

        onKey(event) {
            if (!this.panel) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                // An open Delete all question goes first; the next Escape closes the panel.
                if (this.confirmingDeleteAll && !this.deletingAll) {
                    this.cancelDeleteAll();
                    return;
                }
                this.close();
                return;
            }
            if (event.key === 'Tab') global.FocusTrapUtils?.trapTabKey?.(event, this.panel);
        }

        /** The question field: Enter sends, Shift+Enter is a new line, the arrows walk the rows while it is empty. */
        onInputKey(event) {
            const input = event.currentTarget;
            const empty = !input.value.trim();
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && (empty || event.altKey)
                    && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                this.moveSelection(event.key === 'ArrowDown' ? 1 : -1);
                return;
            }
            // keyCode 229 too: Safari ends a composition with an Enter whose isComposing is false.
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                if (empty && this.selected >= 0) this.activateSelected();
                else void this.submitInput();
            }
        }

        /** On a row itself the arrows move between rows, as in the palette. */
        onListKey(event) {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            const rows = this.rowEls();
            const at = rows.findIndex((row) => row.contains(event.target));
            if (at < 0) return;
            event.preventDefault();
            const next = Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)));
            this.selected = next;
            this.paintSelection();
            rows[next].querySelector('[data-ai-open], [data-ai-new]')?.focus({ preventScroll: true });
        }

        rowEls() { return [...(this.panel?.querySelectorAll('[data-ai-list] > li') || [])]; }

        moveSelection(step) {
            const count = this.rowEls().length;
            if (!count) return;
            this.selected = this.selected < 0
                ? (step > 0 ? 0 : count - 1)
                : Math.max(0, Math.min(count - 1, this.selected + step));
            this.paintSelection();
        }

        paintSelection() {
            this.rowEls().forEach((row, index) => {
                row.classList.toggle('is-selected', index === this.selected);
                if (index === this.selected) row.scrollIntoView?.({ block: 'nearest' });
            });
        }

        activateSelected() {
            const row = this.rowEls()[this.selected];
            if (!row) return;
            if (row.hasAttribute('data-ai-conv')) void this.openConversation(row.getAttribute('data-ai-conv'));
            else this.startNew();
        }

        startNew() {
            this.newConversation();
            this.renderSide();
            this.renderThread();
            this.focusInput();
        }

        async openConversation(id) {
            const generation = this.generation;
            await this.select(id);
            if (generation === this.generation) this.focusInput();
        }

        /** A link in an answer: close the panel and go there, the way a hash link does. */
        followLink(hash) {
            if (!LINK_HASH.test(hash)) return;
            this.close();
            setTimeout(() => {
                if (global.location.hash === hash) global.dispatchEvent(new HashChangeEvent('hashchange'));
                else global.location.hash = hash;
            }, 0);
        }

        onClick(event) {
            const link = event.target.closest('a[data-ai-link]');
            if (link && this.panel.contains(link)) {
                event.preventDefault();
                this.followLink(link.getAttribute('data-ai-link'));
                return;
            }
            const target = event.target.closest('button');
            if (!target || !this.panel.contains(target)) {
                // The arguments of a change are one line; a click on them shows them whole.
                const main = event.target.closest('.assistant-proposal-main');
                if (main && this.panel.contains(main)) main.classList.toggle('is-expanded');
                return;
            }
            if (target.hasAttribute('data-ai-close')) { this.close(); return; }
            if (target.hasAttribute('data-ai-new')) { this.selected = 0; this.startNew(); return; }
            if (target.hasAttribute('data-ai-delete-all')) {
                this.confirmingDeleteAll = true;
                this.deleteAllError = '';
                this.renderFoot();
                this.panel.querySelector('[data-ai-delete-all-cancel]')?.focus({ preventScroll: true });
                return;
            }
            if (target.hasAttribute('data-ai-delete-all-cancel')) { this.cancelDeleteAll(); return; }
            if (target.hasAttribute('data-ai-delete-all-confirm')) { void this.removeAll(); return; }
            if (target.hasAttribute('data-ai-setup')) {
                this.close();
                global.dashboardInstance?.config?.openAssistantFold?.();
                return;
            }
            const row = target.closest('[data-ai-conv]');
            if (row && target.hasAttribute('data-ai-delete')) { void this.remove(row.getAttribute('data-ai-conv')); return; }
            if (row && target.hasAttribute('data-ai-open')) {
                this.selected = this.rowEls().indexOf(row);
                void this.openConversation(row.getAttribute('data-ai-conv'));
                return;
            }
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

        /** Where the keyboard belongs: the question field, or the setup button when the assistant cannot answer. */
        focusTarget() {
            if (!this.panel) return null;
            const setup = this.panel.querySelector('[data-ai-setup]');
            if (setup) return setup;
            return this.panel.querySelector('[data-ai-input]');
        }

        /**
         * Puts the keyboard in the field, now and once more on the next frame:
         * whatever closed on the way here (the palette gives focus back to the
         * page as it goes) may still move it after this call. The second pass
         * only acts when focus has left the panel, so a row the reader moved to
         * in that frame keeps it.
         */
        focusInput() {
            const target = this.focusTarget();
            if (!target) return;
            target.focus({ preventScroll: true });
            requestAnimationFrame(() => this.keepFocus());
        }

        keepFocus() {
            if (!this.panel) return;
            const active = document.activeElement;
            if (active && active !== document.body && this.panel.contains(active)) return;
            this.focusTarget()?.focus({ preventScroll: true });
        }

        /** One row that grows with the question, up to a few lines; then it scrolls. */
        fitInput() {
            const input = this.panel?.querySelector('[data-ai-input]');
            if (!input) return;
            input.style.height = 'auto';
            const cs = getComputedStyle(input);
            const line = parseFloat(cs.lineHeight) || 20;
            const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
            const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
            const max = line * INPUT_MAX_LINES + padY;
            // box-sizing is border-box (assistant.css): scrollHeight is content and padding.
            input.style.height = `${Math.min(input.scrollHeight, max) + border}px`;
            input.style.overflowY = input.scrollHeight > max + 1 ? 'auto' : 'hidden';
        }

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
            const generation = this.generation;
            // A later pick wins over one still on its way: only the last asked is painted.
            const ticket = (this.selectTicket = (this.selectTicket || 0) + 1);
            const stale = () => generation !== this.generation || ticket !== this.selectTicket;
            let conv = null;
            try {
                const res = await api(`/api/ai/conversations/${encodeURIComponent(id)}`, { cache: 'no-store' });
                if (!res.ok) throw new Error(String(res.status));
                conv = await res.json();
            } catch {
                conv = null;
            }
            if (stale()) return;
            if (conv) {
                this.convId = conv.id;
                this.messages = (conv.messages || []).map((m) => ({ ...m, proposals: m.proposals || [] }));
            } else {
                this.newConversation();
                this.messages = [{ role: 'error', text: t('gone', 'That conversation no longer exists.') }];
                await this.loadList();
                if (stale()) return;
            }
            this.renderSide();
            this.renderThread();
        }

        async remove(id) {
            if (!id) return;
            if (id === this.convId) this.abortStream();
            const generation = this.generation;
            try {
                const res = await api(`/api/ai/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
                if (!res.ok && res.status !== 404) throw new Error(String(res.status));
            } catch {
                return;
            }
            if (generation !== this.generation) return;
            if (id === this.convId) this.newConversation();
            await this.loadList();
            if (generation !== this.generation) return;
            this.renderSide();
            this.renderThread();
            this.focusInput();
        }

        /** Every conversation at once, after the confirm in the foot of the column. */
        async removeAll() {
            if (this.deletingAll) return;
            const generation = this.generation;
            // The answer on its way is let go only once the delete went through:
            // a refused one leaves the thread as it was.
            this.deletingAll = true;
            this.renderFoot();
            let res = null;
            try {
                res = await api('/api/ai/conversations', { method: 'DELETE' });
            } catch { /* handled below */ }
            this.deletingAll = false;
            if (generation !== this.generation) return;
            if (!res?.ok) {
                this.deleteAllError = res?.status === 401
                    ? t('needsTokenDelete', 'Deleting needs the write token.')
                    : t('deleteAllFailed', 'The conversations could not be deleted.');
                this.renderFoot();
                this.panel?.querySelector('[data-ai-delete-all-cancel]')?.focus({ preventScroll: true });
                return;
            }
            this.confirmingDeleteAll = false;
            this.deleteAllError = '';
            this.selected = -1;
            this.newConversation();
            await this.loadList();
            if (generation !== this.generation) return;
            this.renderSide();
            this.renderThread();
            this.focusInput();
        }

        cancelDeleteAll() {
            this.confirmingDeleteAll = false;
            this.renderFoot();
            this.focusInput();
        }

        // ---- Rendering -----------------------------------------------------

        /**
         * The foot of the column: "Delete all" while there is something to
         * delete, or its confirm. Not while the list is filtered: it would
         * delete everything while showing only what matches.
         */
        renderFoot() {
            const foot = this.panel?.querySelector('[data-ai-side-foot]');
            if (!foot) return;
            const query = this.panel.querySelector('[data-ai-search]')?.value.trim();
            const count = this.conversations.length;
            if (query && !this.deletingAll) this.confirmingDeleteAll = false;
            if ((!count || query) && !this.confirmingDeleteAll) { foot.replaceChildren(); return; }
            if (!this.confirmingDeleteAll) {
                foot.replaceChildren(...[
                    el('button', { type: 'button', class: 'assistant-action assistant-delete-all', 'data-ai-delete-all': true },
                        t('deleteAll', 'Delete all')),
                    this.deleteAllError ? el('p', { class: 'assistant-error', role: 'alert' }, this.deleteAllError) : null,
                ].filter(Boolean));
                return;
            }
            const question = t('deleteAllConfirm', 'Delete all {n} conversations?', { n: count });
            foot.replaceChildren(...[
                el('span', { class: 'assistant-side-foot-text' }, question),
                el('button', {
                    type: 'button', class: 'assistant-action', 'data-ai-delete-all-confirm': true, disabled: Boolean(this.deletingAll),
                }, t('delete', 'Delete')),
                el('button', {
                    type: 'button', class: 'assistant-action assistant-skip', 'data-ai-delete-all-cancel': true, disabled: Boolean(this.deletingAll),
                }, t('cancel', 'Cancel')),
                this.deleteAllError ? el('p', { class: 'assistant-error', role: 'alert' }, this.deleteAllError) : null,
            ].filter(Boolean));
        }

        renderSide() {
            const list = this.panel?.querySelector('[data-ai-list]');
            if (!list) return;
            // The first row starts a new conversation, as the palette's top row is the one Enter takes.
            const fresh = el('li', { class: `assistant-conv assistant-conv--new${this.convId ? '' : ' is-active'}` },
                el('button', { type: 'button', class: 'assistant-conv-open', 'data-ai-new': true },
                    el('span', { class: 'assistant-conv-title' }, t('newConversation', 'New conversation')),
                    el('span', { class: 'assistant-conv-time', 'aria-hidden': 'true' }, '+')));
            list.replaceChildren(fresh, ...this.conversations.map((c) => {
                const title = c.title || t('untitled', 'Untitled');
                const open = el('button', { type: 'button', class: 'assistant-conv-open', 'data-ai-open': true, title },
                    el('span', { class: 'assistant-conv-title' }, title),
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
            if (this.selected >= list.children.length) this.selected = list.children.length - 1;
            this.paintSelection();
            this.renderFoot();
        }

        threadEl() { return this.panel?.querySelector('[data-ai-thread]'); }

        renderThread() {
            const thread = this.threadEl();
            if (!thread) return;
            if (!this.ready()) {
                const [key, fallback] = NOT_READY[this.status?.reason] || NOT_READY.off;
                thread.replaceChildren(el('div', { class: 'assistant-empty', 'data-ai-empty': true },
                    el('p', null, t(key, fallback)),
                    el('button', { type: 'button', class: 'assistant-action assistant-setup', 'data-ai-setup': true }, t('setup', 'Set it up in Config'))));
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
            // The question as the line it was typed on: the prompt's mark, then the text.
            if (m.role === 'user') {
                return el('div', { class: 'assistant-msg assistant-msg--user' },
                    el('span', { class: 'assistant-msg-mark', 'aria-hidden': 'true' }, '›'), el('p', null, m.text));
            }
            const node = el('div', { class: 'assistant-msg assistant-msg--assistant', 'data-ai-message': m.id || '' });
            const body = el('div', { class: 'assistant-text', 'data-ai-text': true });
            body.append(renderMarkdown(m.text));
            node.append(body);
            if (m.status) node.append(el('p', { class: 'assistant-status', 'data-ai-status': true, role: 'status' }, m.status));
            if (m.cut) node.append(el('p', { class: 'assistant-error', role: 'alert' }, t('cutOff', 'The answer was cut off.')));
            const proposals = m.proposals || [];
            if (proposals.length) {
                const box = el('div', { class: 'assistant-proposals' });
                const pending = proposals.filter((p) => p.status === 'pending' && !p.destructive);
                const pendingAll = proposals.filter((p) => p.status === 'pending');
                // "Apply all" heads the list, as a row action of the list itself.
                if (pendingAll.length >= 2 && pending.length) {
                    box.append(el('div', { class: 'assistant-proposals-head' },
                        el('button', { type: 'button', class: 'assistant-action assistant-apply-all', 'data-ai-apply-all': true },
                            t('applyAll', 'Apply all'))));
                }
                proposals.forEach((p) => box.append(this.cardEl(p)));
                if (m.applyError) box.append(el('p', { class: 'assistant-error', role: 'alert' }, m.applyError));
                node.append(box);
            }
            if (m.id) node.append(el('p', { class: 'assistant-meta' }, this.metaText(m)));
            return node;
        }

        /**
         * A change as one row of the palette: what it does and why on the
         * first line, its arguments on a short second one (cut to the width,
         * whole on hover and on a click), Apply and Skip at the right edge.
         */
        cardEl(p) {
            const card = el('div', {
                class: `assistant-proposal${p.destructive ? ' is-destructive' : ''}`,
                'data-ai-proposal': p.id, 'data-status': p.status, 'data-destructive': p.destructive ? 'true' : false,
            });
            const main = el('div', { class: 'assistant-proposal-main' });
            main.append(el('p', { class: 'assistant-proposal-line' },
                el('span', { class: 'assistant-proposal-title' }, toolWords(p)),
                p.destructive ? el('span', { class: 'assistant-proposal-flag' }, t('destructive', 'Destructive')) : null,
                p.reason ? el('span', { class: 'assistant-proposal-reason', title: p.reason }, p.reason) : null));
            const args = p.arguments && typeof p.arguments === 'object' ? Object.entries(p.arguments) : [];
            if (args.length) {
                const whole = args.map(([key, value]) => `${key}: ${argumentValue(value)}`).join('  ·  ');
                main.append(el('dl', { class: 'assistant-proposal-args', title: whole },
                    args.flatMap(([key, value]) => [el('dt', null, key), el('dd', null, argumentValue(value))])));
            }
            if (p.status === 'failed' && p.error) {
                main.append(el('p', { class: 'assistant-error', role: 'alert', 'data-ai-proposal-error': true }, p.error));
            }
            const actions = el('div', { class: 'assistant-proposal-actions' });
            if (p.status === 'applied') {
                actions.append(el('span', { class: 'assistant-done', 'data-ai-done': true }, t('done', 'Done')));
            } else if (p.status === 'skipped') {
                actions.append(el('span', { class: 'assistant-skipped' }, t('skipped', 'Skipped')));
            } else if (p.status === 'applying') {
                actions.append(el('span', { class: 'assistant-skipped', role: 'status' }, t('applying', 'Applying…')));
            } else {
                actions.append(
                    el('button', { type: 'button', class: 'assistant-action assistant-apply', 'data-ai-apply': true }, t('apply', 'Apply')),
                    el('button', { type: 'button', class: 'assistant-action assistant-skip', 'data-ai-skip': true }, t('skip', 'Skip')));
            }
            card.append(main, actions);
            return card;
        }

        // ---- Asking --------------------------------------------------------

        async submitInput() {
            const input = this.panel?.querySelector('[data-ai-input]');
            const text = input?.value.trim();
            if (!text || this.busy || !this.ready()) return;
            input.value = '';
            this.fitInput();
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
                if (input && !input.value) { input.value = question; this.fitInput(); }
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
            node.querySelector('[data-ai-text]').replaceChildren(renderMarkdown(live.text));
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
            if (res?.status === 409 && await this.refreshProposal(proposal)
                && ['applied', 'skipped'].includes(proposal.status)) return;
            proposal.status = 'failed';
            proposal.error = res ? this.applyFailure(res, body) : t('applyFailed', 'The change could not be made.');
        }

        async applyOne(id) {
            const found = this.findProposal(id);
            if (!found || ['applying', 'applied', 'skipped'].includes(found.proposal.status)) return;
            const { message, proposal } = found;
            const generation = this.generation;
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
            if (proposal.status === 'applied') this.refreshDashboard();
            this.afterProposal(generation);
        }

        /** A change settled: the thread shows it, and the keyboard goes back to the field. */
        afterProposal(generation) {
            if (generation !== this.generation) return;
            this.renderThread();
            this.focusInput();
        }

        /** The dashboard behind the panel reads the change now, not on the next focus. */
        refreshDashboard() {
            try {
                global.dashboardInstance?.data?.refreshIfDataRevisionChanged?.()?.catch?.(() => {});
            } catch { /* the dashboard catches up on the next focus */ }
        }

        async skipOne(id) {
            const found = this.findProposal(id);
            if (!found || ['applying', 'applied', 'skipped'].includes(found.proposal.status)) return;
            const { proposal } = found;
            const generation = this.generation;
            proposal.status = 'applying';
            this.renderThread();
            let res = null;
            let body = null;
            try {
                res = await api(`/api/ai/proposals/${encodeURIComponent(id)}/skip`, { method: 'POST' });
                body = await res.json().catch(() => null);
            } catch { /* handled below */ }
            await this.settleOne(proposal, res, body);
            this.afterProposal(generation);
        }

        async applyAll(messageId) {
            const message = this.messages.find((m) => m.id && m.id === messageId);
            if (!message) return;
            // Destructive ones are never in this call: they need their own click.
            const chosen = (message.proposals || []).filter((p) => p.status === 'pending' && !p.destructive);
            const ids = chosen.map((p) => p.id);
            if (!ids.length) return;
            const generation = this.generation;
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
            if (chosen.some((p) => p.status === 'applied')) this.refreshDashboard();
            this.afterProposal(generation);
        }
    }

    const panel = new AssistantPanel();
    global.AssistantPanel = {
        open: (options) => panel.open(options),
        close: () => panel.close(),
        isOpen: () => panel.isOpen(),
    };
})(window);
