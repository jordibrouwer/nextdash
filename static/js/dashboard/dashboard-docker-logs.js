/**
 * The logs window: one container's log, followed live, over most of the page.
 *
 * The drawer's Logs tab stays the quick look (a fixed tail and Refresh); this
 * is where a log is read. It follows /api/docker/containers/<name>/logs/stream,
 * an NDJSON body that stays open while the container runs, read with fetch()
 * and a stream reader -- EventSource cannot send the write token's header.
 *
 * A native <dialog> shown with showModal(): the page behind goes inert and
 * focus stays inside without a hand-written trap. The view's own keys stand
 * aside while it is open (isModalOpen counts it), and Escape closes it.
 *
 * Log text is untrusted: every line reaches the page through textContent and
 * nodes built by hand, never innerHTML.
 */
(function () {
    const PREFS_KEY = 'nextdash.docker.logs';
    const MAX_LINES = 5000;
    const TAILS = [100, 200, 500, 1000];

    function readPrefs() {
        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
        } catch {
            saved = null;
        }
        return {
            stream: ['all', 'out', 'err'].includes(saved?.stream) ? saved.stream : 'all',
            tail: TAILS.includes(saved?.tail) ? saved.tail : 500,
            timestamps: saved?.timestamps !== false,
            wrap: saved?.wrap !== false,
        };
    }

    /** "2026-09-29T10:00:02.123456789Z" -> "1790676002.123456789", what ?since= takes. */
    function sinceFrom(t) {
        const ms = Date.parse(t);
        if (!Number.isFinite(ms)) return '';
        const frac = (/\.(\d+)Z$/.exec(t)?.[1] || '').padEnd(9, '0').slice(0, 9);
        return `${Math.floor(ms / 1000)}.${frac}`;
    }

    function localTime(t) {
        const ms = Date.parse(t);
        if (!Number.isFinite(ms)) return '';
        return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }

    function fileStamp(d) {
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    }

    class DockerLogsModal {
        /** The one open window, if any: the view and isModalOpen ask this. */
        static current = null;

        static isOpen() {
            return Boolean(DockerLogsModal.current?.dialog?.open);
        }

        constructor(view) {
            this.view = view;
            this.prefs = readPrefs();
            this.dialog = null;
            this.els = null;
            this.name = '';
            this.lines = [];        // { t, s, m, el }
            this.pending = [];
            this.frame = 0;
            this.following = true;
            this.newSince = 0;
            this.query = '';
            this.filterOnly = false;
            this.matches = [];
            this.matchIndex = -1;
            this.abort = null;
            this.ended = false;
        }

        t(key, fallback, params) {
            return this.view.t(`dashboard.${key}`, fallback, params);
        }

        savePrefs() {
            try {
                localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
            } catch {
                // Storage unavailable -- the choices hold for this window only.
            }
        }

        /* ── Opening and closing ─────────────────────────────────────────── */

        open(container) {
            const name = typeof container === 'string' ? container : container?.name;
            if (!name) return;
            DockerLogsModal.current?.close({ restoreFocus: false });
            DockerLogsModal.current = this;
            this.name = name;
            this.returnFocus = document.activeElement;
            this.build(typeof container === 'string' ? { name } : container);
            document.body.appendChild(this.dialog);
            this.dialog.showModal();
            this.scrollLock = window.ScrollLock?.acquire?.('docker-logs-modal');
            window.EscapeOwner?.registerOwner?.('docker-logs-modal', {
                isOpen: () => DockerLogsModal.isOpen(),
                handleEscape: () => DockerLogsModal.current?.close(),
            });
            window.FocusTrapUtils?.syncDashboardInert?.();
            this.els.body.focus({ preventScroll: true });
            this.connect();
        }

        close({ restoreFocus = true } = {}) {
            this.abort?.abort();
            this.abort = null;
            if (this.frame) cancelAnimationFrame(this.frame);
            this.frame = 0;
            if (this.scrollLock) window.ScrollLock?.release?.(this.scrollLock);
            this.scrollLock = null;
            if (this.dialog?.open) this.dialog.close();
            this.dialog?.remove();
            this.dialog = null;
            this.els = null;
            if (DockerLogsModal.current === this) DockerLogsModal.current = null;
            window.FocusTrapUtils?.syncDashboardInert?.();
            if (restoreFocus && this.returnFocus?.isConnected) this.returnFocus.focus?.({ preventScroll: true });
        }

        /* ── Building ────────────────────────────────────────────────────── */

        button(attr, label, { pressed = null, cls = '' } = {}) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `docker-logs-btn${cls ? ` ${cls}` : ''}`;
            b.setAttribute(attr, typeof pressed === 'string' ? pressed : '');
            if (typeof pressed === 'boolean') b.setAttribute('aria-pressed', String(pressed));
            b.textContent = label;
            return b;
        }

        build(summary) {
            const dialog = document.createElement('dialog');
            dialog.className = 'docker-logs-modal';
            dialog.setAttribute('data-docker-logs-modal', '');
            dialog.setAttribute('aria-label', this.t('dockerLogsTitle', 'Logs of {name}', { name: this.name }));

            const head = document.createElement('header');
            head.className = 'docker-logs-head';
            const title = document.createElement('h2');
            title.className = 'docker-logs-modal-title';
            title.textContent = this.name;
            const badge = document.createElement('span');
            badge.className = 'docker-logs-badge';
            badge.setAttribute('data-state', summary.state || '');
            badge.textContent = summary.state || '';
            const spacer = document.createElement('span');
            spacer.className = 'docker-logs-spacer';
            const follow = this.button('data-logs-follow', '', { cls: 'docker-logs-follow' });
            const close = this.button('data-logs-close', '✕', { cls: 'docker-logs-close' });
            close.setAttribute('aria-label', this.t('dockerLogsClose', 'Close'));
            head.append(title, badge, spacer, follow, close);

            const bar = document.createElement('div');
            bar.className = 'docker-logs-bar';
            const search = document.createElement('input');
            search.type = 'search';
            search.className = 'docker-logs-search';
            search.setAttribute('data-logs-search', '');
            search.placeholder = this.t('dockerLogsSearch', 'Search the log');
            search.setAttribute('aria-label', search.placeholder);
            search.spellcheck = false;
            search.autocomplete = 'off';
            const filter = this.button('data-logs-filter', this.t('dockerLogsFilter', 'Filter'), { pressed: false });
            filter.title = this.t('dockerLogsFilterHint', 'Show only lines that match');
            const count = document.createElement('span');
            count.className = 'docker-logs-count';
            count.setAttribute('data-logs-count', '');
            count.setAttribute('aria-live', 'polite');

            const seg = document.createElement('span');
            seg.className = 'docker-logs-seg';
            seg.setAttribute('role', 'group');
            seg.setAttribute('aria-label', this.t('dockerLogsStream', 'Stream'));
            [['all', this.t('dockerLogsStreamAll', 'All')], ['out', 'stdout'], ['err', 'stderr']].forEach(([key, label]) => {
                seg.appendChild(this.button('data-logs-stream', label, { pressed: key }));
            });

            const tail = document.createElement('select');
            tail.className = 'docker-logs-tail';
            tail.setAttribute('data-logs-tail', '');
            tail.setAttribute('aria-label', this.t('dockerLogsTailLabel', 'Lines to start with'));
            TAILS.forEach((n) => {
                const o = document.createElement('option');
                o.value = String(n);
                o.textContent = this.t('dockerLogsLast', 'Last {count}', { count: n });
                tail.appendChild(o);
            });
            tail.value = String(this.prefs.tail);

            const times = this.button('data-logs-timestamps', this.t('dockerLogsTimestamps', 'Timestamps'), { pressed: this.prefs.timestamps });
            const wrap = this.button('data-logs-wrap', this.t('dockerLogsWrap', 'Wrap'), { pressed: this.prefs.wrap });
            const copy = this.button('data-logs-copy', this.t('dockerLogsCopy', 'Copy'));
            copy.title = this.t('dockerLogsCopyHint', 'Copy the lines shown');
            const download = this.button('data-logs-download', this.t('dockerLogsDownload', 'Download'));
            download.title = this.t('dockerLogsDownloadHint', 'Save the loaded lines as a .log file');
            bar.append(search, filter, count, seg, tail, times, wrap, copy, download);

            const wrapBody = document.createElement('div');
            wrapBody.className = 'docker-logs-main';
            const body = document.createElement('div');
            body.className = 'docker-logs-body';
            body.setAttribute('data-logs-body', '');
            body.tabIndex = 0;
            body.setAttribute('role', 'log');
            const jump = this.button('data-logs-jump', `↓ ${this.t('dockerLogsJump', 'Jump to latest')}`, { cls: 'docker-logs-jump' });
            jump.hidden = true;
            const ended = document.createElement('div');
            ended.className = 'docker-logs-ended';
            ended.setAttribute('data-logs-ended', '');
            ended.hidden = true;
            const endedText = document.createElement('span');
            endedText.setAttribute('data-logs-ended-text', '');
            const resume = this.button('data-logs-resume', this.t('dockerLogsResume', 'Resume'));
            ended.append(endedText, resume);
            wrapBody.append(body, jump, ended);

            const foot = document.createElement('footer');
            foot.className = 'docker-logs-foot';
            const total = document.createElement('span');
            total.setAttribute('data-logs-total', '');
            const keys = document.createElement('span');
            keys.className = 'docker-logs-keys';
            [['/', this.t('dockerLogsKeySearch', 'search')], ['f', this.t('dockerLogsKeyFollow', 'follow')],
                ['Enter', this.t('dockerLogsKeyNext', 'next match')], ['Esc', this.t('dockerLogsKeyClose', 'close')]].forEach(([k, label]) => {
                const item = document.createElement('span');
                const kbd = document.createElement('kbd');
                kbd.textContent = k;
                item.append(kbd, ` ${label}`);
                keys.appendChild(item);
            });
            foot.append(total, keys);

            dialog.append(head, bar, wrapBody, foot);
            this.dialog = dialog;
            this.els = { head, follow, close, search, filter, count, seg, tail, times, wrap, copy, download, body, jump, ended, endedText, resume, total };
            this.lines = [];
            this.pending = [];
            this.following = true;
            this.newSince = 0;
            this.query = '';
            this.filterOnly = false;
            this.matches = [];
            this.matchIndex = -1;
            this.ended = false;
            this.applyLook();
            this.bind();
            this.syncStatus();
        }

        bind() {
            const els = this.els;
            els.close.addEventListener('click', () => this.close());
            // A click on the backdrop (the dialog box itself, outside the panel's
            // children) closes it, as the app's own modals do.
            this.dialog.addEventListener('click', (e) => {
                if (e.target === this.dialog) this.close();
            });
            // Escape: ours to handle, not the dialog's own cancel, so the stream
            // is let go and the page's lock released in one place.
            this.dialog.addEventListener('cancel', (e) => {
                e.preventDefault();
                this.close();
            });
            this.dialog.addEventListener('keydown', (e) => this.onKey(e));
            els.follow.addEventListener('click', () => (this.following ? this.pause() : this.jumpToLatest()));
            els.jump.addEventListener('click', () => this.jumpToLatest());
            els.resume.addEventListener('click', () => this.resume());
            els.body.addEventListener('scroll', () => this.onScroll(), { passive: true });
            els.search.addEventListener('input', () => {
                this.query = els.search.value;
                this.refreshMatches({ reset: true });
            });
            els.filter.addEventListener('click', () => {
                this.filterOnly = !this.filterOnly;
                els.filter.setAttribute('aria-pressed', String(this.filterOnly));
                this.applyVisibility();
            });
            els.seg.addEventListener('click', (e) => {
                const b = e.target.closest('[data-logs-stream]');
                if (!b) return;
                this.prefs.stream = b.getAttribute('data-logs-stream');
                this.savePrefs();
                this.applyLook();
                this.applyVisibility();
                this.refreshMatches({ reset: true });
            });
            els.tail.addEventListener('change', () => {
                this.prefs.tail = Number(els.tail.value) || 500;
                this.savePrefs();
                this.restart();
            });
            els.times.addEventListener('click', () => {
                this.prefs.timestamps = !this.prefs.timestamps;
                this.savePrefs();
                this.applyLook();
            });
            els.wrap.addEventListener('click', () => {
                this.prefs.wrap = !this.prefs.wrap;
                this.savePrefs();
                this.applyLook();
            });
            els.copy.addEventListener('click', () => void this.copy());
            els.download.addEventListener('click', () => this.download());
        }

        /** Pressed states and the body's classes, from prefs. */
        applyLook() {
            const els = this.els;
            els.seg.querySelectorAll('[data-logs-stream]').forEach((b) => {
                b.setAttribute('aria-pressed', String(b.getAttribute('data-logs-stream') === this.prefs.stream));
            });
            els.times.setAttribute('aria-pressed', String(this.prefs.timestamps));
            els.wrap.setAttribute('aria-pressed', String(this.prefs.wrap));
            els.body.classList.toggle('is-no-time', !this.prefs.timestamps);
            els.body.classList.toggle('is-no-wrap', !this.prefs.wrap);
        }

        /* ── Keys ────────────────────────────────────────────────────────── */

        onKey(e) {
            const els = this.els;
            if (!els) return;
            const inSearch = e.target === els.search;
            const typing = inSearch || e.target === els.tail;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (inSearch && els.search.value) {
                    els.search.value = '';
                    this.query = '';
                    this.refreshMatches({ reset: true });
                    return;
                }
                this.close();
                return;
            }
            if (e.key === 'Enter' && (inSearch || !typing) && this.matches.length) {
                e.preventDefault();
                this.stepMatch(e.shiftKey ? -1 : 1);
                return;
            }
            if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === '/') {
                e.preventDefault();
                els.search.focus();
                els.search.select();
            } else if (e.key === 'f') {
                e.preventDefault();
                if (this.following) this.pause();
                else this.jumpToLatest();
            }
        }

        /* ── The stream ──────────────────────────────────────────────────── */

        streamUrl(since) {
            const q = new URLSearchParams({ tail: String(this.prefs.tail) });
            if (since) q.set('since', since);
            return `/api/docker/containers/${encodeURIComponent(this.name)}/logs/stream?${q}`;
        }

        restart() {
            this.abort?.abort();
            this.lines.forEach((l) => l.el?.remove());
            this.lines = [];
            this.pending = [];
            this.newSince = 0;
            this.following = true;
            this.refreshMatches({ reset: true });
            this.connect();
        }

        resume() {
            const last = this.lines[this.lines.length - 1] || this.pending[this.pending.length - 1];
            this.connect(last ? sinceFrom(last.t) : '');
        }

        async connect(since = '') {
            this.abort?.abort();
            const abort = new AbortController();
            this.abort = abort;
            this.ended = false;
            this.syncStatus();
            // since is inclusive: what the daemon sends again for that moment is
            // already on screen, so it is skipped once, by timestamp and text.
            const lastT = since ? (this.lines[this.lines.length - 1]?.t || '') : '';
            const seenAtLast = new Set(since ? this.lines.filter((l) => l.t === lastT).map((l) => l.m) : []);
            let res;
            try {
                const fetcher = typeof window.nextDashFetch === 'function' ? window.nextDashFetch : fetch;
                res = await fetcher(this.streamUrl(since), { signal: abort.signal, cache: 'no-store' });
            } catch {
                if (!abort.signal.aborted) this.onEnded(this.t('dockerLogsUnreachable', 'The log could not be reached.'));
                return;
            }
            if (!res.ok || !res.body) {
                if (!abort.signal.aborted) {
                    this.onEnded(res.status === 401
                        ? this.t('dockerLogsNeedsToken', 'Reading logs needs the write token.')
                        : this.t('dockerLogsUnreachable', 'The log could not be reached.'));
                }
                return;
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            try {
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    let nl = buffer.indexOf('\n');
                    while (nl >= 0) {
                        const raw = buffer.slice(0, nl).trim();
                        buffer = buffer.slice(nl + 1);
                        nl = buffer.indexOf('\n');
                        if (!raw) continue; // the heartbeat
                        let line;
                        try {
                            line = JSON.parse(raw);
                        } catch {
                            continue;
                        }
                        if (lastT && (line.t < lastT || (line.t === lastT && seenAtLast.delete(line.m)))) continue;
                        this.queue(line);
                    }
                }
            } catch {
                // Aborted, or the connection dropped: both end the same way below.
            }
            if (abort.signal.aborted || this.abort !== abort) return;
            this.onEnded(this.t('dockerLogsEnded', 'The stream ended — the container stopped, or the connection closed.'));
        }

        onEnded(text) {
            this.ended = true;
            if (!this.els) return;
            this.els.endedText.textContent = text;
            this.syncStatus();
        }

        queue(line) {
            this.pending.push({ t: String(line.t || ''), s: line.s === 'err' ? 'err' : 'out', m: String(line.m ?? '') });
            if (!this.frame) this.frame = requestAnimationFrame(() => this.flush());
        }

        /** New lines reach the page once per frame, however fast they arrive. */
        flush() {
            this.frame = 0;
            const els = this.els;
            if (!els || !this.pending.length) return;
            const batch = this.pending;
            this.pending = [];
            const frag = document.createDocumentFragment();
            batch.forEach((l) => {
                l.el = this.lineEl(l);
                frag.appendChild(l.el);
                this.lines.push(l);
            });
            els.body.appendChild(frag);
            // A long session keeps the newest lines only.
            const over = this.lines.length - MAX_LINES;
            if (over > 0) this.lines.splice(0, over).forEach((l) => l.el.remove());
            if (this.following) {
                this.scrollToEnd();
            } else {
                this.newSince += batch.length;
            }
            if (this.query) this.refreshMatches({ reset: false });
            this.syncStatus();
        }

        lineEl(l) {
            const row = document.createElement('div');
            row.className = 'docker-logs-line';
            row.setAttribute('data-logs-line', '');
            row.setAttribute('data-stream', l.s);
            const time = document.createElement('span');
            time.className = 'docker-logs-time';
            time.textContent = localTime(l.t);
            time.title = l.t;
            const text = document.createElement('span');
            text.className = 'docker-logs-text';
            row.append(time, text);
            this.paintText(text, l.m);
            row.hidden = !this.visible(l);
            return row;
        }

        /* ── Following ───────────────────────────────────────────────────── */

        scrollToEnd() {
            const body = this.els?.body;
            if (!body) return;
            this._programmatic = true;
            body.scrollTop = body.scrollHeight;
        }

        onScroll() {
            const body = this.els?.body;
            if (!body) return;
            const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
            if (this._programmatic) {
                this._programmatic = false;
                if (atEnd) return;
            }
            if (atEnd && !this.following) {
                this.following = true;
                this.newSince = 0;
                this.syncStatus();
            } else if (!atEnd && this.following) {
                this.pause();
            }
        }

        pause() {
            this.following = false;
            this.syncStatus();
        }

        jumpToLatest() {
            this.following = true;
            this.newSince = 0;
            this.scrollToEnd();
            this.syncStatus();
        }

        syncStatus() {
            const els = this.els;
            if (!els) return;
            let label;
            if (this.ended) label = this.t('dockerLogsStatusEnded', 'Stream ended');
            else if (this.following) label = `● ${this.t('dockerLogsFollowing', 'Following')}`;
            else if (this.newSince) label = this.t('dockerLogsPausedNew', 'Paused · {count} new', { count: this.newSince });
            else label = this.t('dockerLogsPaused', 'Paused');
            els.follow.textContent = label;
            els.follow.setAttribute('data-state', this.ended ? 'ended' : (this.following ? 'following' : 'paused'));
            els.follow.disabled = this.ended;
            els.jump.hidden = this.following || this.ended;
            els.ended.hidden = !this.ended;
            els.total.textContent = this.t('dockerLogsLineCount', '{count} lines', { count: this.lines.length });
        }

        /* ── Search and filters ──────────────────────────────────────────── */

        visible(l) {
            if (this.prefs.stream !== 'all' && l.s !== this.prefs.stream) return false;
            if (this.filterOnly && this.query && !l.m.toLowerCase().includes(this.query.toLowerCase())) return false;
            return true;
        }

        applyVisibility() {
            this.lines.forEach((l) => { l.el.hidden = !this.visible(l); });
        }

        /** The line's text with every match of the query in a <mark>. */
        paintText(span, text) {
            span.replaceChildren();
            const q = this.query.toLowerCase();
            if (!q) {
                span.textContent = text;
                return;
            }
            const lower = text.toLowerCase();
            let at = 0;
            let i = lower.indexOf(q);
            while (i >= 0) {
                span.append(text.slice(at, i));
                const mark = document.createElement('mark');
                mark.textContent = text.slice(i, i + q.length);
                span.appendChild(mark);
                at = i + q.length;
                i = lower.indexOf(q, at);
            }
            span.append(text.slice(at));
        }

        refreshMatches({ reset }) {
            const els = this.els;
            if (!els) return;
            const q = this.query.toLowerCase();
            const current = this.matches[this.matchIndex];
            this.lines.forEach((l) => {
                const had = l.painted || '';
                if (had !== q || reset) {
                    this.paintText(l.el.querySelector('.docker-logs-text'), l.m);
                    l.painted = q;
                }
                l.el.classList.remove('is-current');
            });
            this.applyVisibility();
            this.matches = q ? this.lines.filter((l) => !l.el.hidden && l.m.toLowerCase().includes(q)) : [];
            if (!this.matches.length) {
                this.matchIndex = -1;
            } else if (reset || !current) {
                this.matchIndex = 0;
                this.showMatch();
            } else {
                this.matchIndex = Math.max(0, this.matches.indexOf(current));
                current.el.classList.add('is-current');
            }
            els.count.textContent = q
                ? (this.matches.length
                    ? this.t('dockerLogsMatchOf', '{index} of {count}', { index: this.matchIndex + 1, count: this.matches.length })
                    : this.t('dockerLogsNoMatch', 'No matches'))
                : '';
        }

        stepMatch(delta) {
            if (!this.matches.length) return;
            this.matchIndex = (this.matchIndex + delta + this.matches.length) % this.matches.length;
            this.showMatch();
            this.els.count.textContent = this.t('dockerLogsMatchOf', '{index} of {count}',
                { index: this.matchIndex + 1, count: this.matches.length });
        }

        /** The current match on screen, which pauses the follow like a scroll up would. */
        showMatch() {
            this.lines.forEach((l) => l.el.classList.remove('is-current'));
            const m = this.matches[this.matchIndex];
            if (!m) return;
            m.el.classList.add('is-current');
            if (this.following) this.pause();
            m.el.scrollIntoView({ block: 'center' });
        }

        /* ── Copy and download ───────────────────────────────────────────── */

        lineText(l) {
            return `${this.prefs.timestamps ? `${l.t} ` : ''}[${l.s}] ${l.m}`;
        }

        async copy() {
            const text = this.lines.filter((l) => !l.el.hidden).map((l) => this.lineText(l)).join('\n');
            try {
                await navigator.clipboard.writeText(text);
                this.view.dash?.showNotification?.(this.t('dockerLogsCopied', 'Lines copied'), 'success', { duration: 2000 });
            } catch {
                this.view.dash?.showNotification?.(this.t('dockerLogsCopyFailed', 'The browser did not allow copying.'), 'error');
            }
        }

        download() {
            const text = this.lines.map((l) => `${l.t} [${l.s}] ${l.m}`).join('\n');
            const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.name}-${fileStamp(new Date())}.log`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    }

    window.DockerLogsModal = DockerLogsModal;
})();
