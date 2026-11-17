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
    const RETRY_WAITS = [1, 2, 4, 8, 15];
    const RECREATE_WAIT = 1200;

    // The inline reader (the stack panel's tab) keeps its own choices: narrow, so
    // no timestamps and no wrapping until asked for.
    const INLINE_KEY = `${PREFS_KEY}.inline`;

    function readPrefs(inline = false) {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(inline ? INLINE_KEY : PREFS_KEY) || 'null'); } catch { saved = null; }
        return {
            stream: ['all', 'out', 'err'].includes(saved?.stream) ? saved.stream : 'all',
            tail: TAILS.includes(saved?.tail) ? saved.tail : 500,
            timestamps: inline ? saved?.timestamps === true : saved?.timestamps !== false,
            wrap: inline ? saved?.wrap === true : saved?.wrap !== false,
        };
    }

    function sinceFrom(t) {
        const ms = Date.parse(t);
        if (!Number.isFinite(ms)) return '';
        const frac = (/\.(\d+)Z$/.exec(t)?.[1] || '').padEnd(9, '0').slice(0, 9);
        return `${Math.floor(ms / 1000)}.${frac}`;
    }

    /** A timestamp with its fraction padded to nine digits: comparable as text. */
    function timeKey(t) {
        const m = /^(.*?)(?:\.(\d+))?Z$/.exec(String(t || ''));
        return m ? `${m[1]}.${(m[2] || '').padEnd(9, '0').slice(0, 9)}Z` : String(t || '');
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

    class DockerLogView {
        /**
         * opts: { name, url(since, tail), services?, keys?, onEscape?, onOpenWindow? }
         */
        constructor(view, opts) {
            this.view = view;
            this.opts = opts;
            this.name = opts.name;
            this.stack = Array.isArray(opts.services);
            this.services = this.stack ? [...opts.services] : [];
            this.compact = Boolean(opts.compact);
            this.prefs = readPrefs(this.compact);
            this.els = null;
            this.lines = [];
            this.pending = [];
            this.frame = 0;
            this.following = true;
            this.newSince = 0;
            this.query = '';
            this.filterOnly = false;
            this.only = null;
            this.matches = [];
            this.matchIndex = -1;
            this.abort = null;
            this.timer = null;
            this.ended = false;
            this.held = false;
            this.note = '';
            this.dead = new Set();
            this.lastKey = '';
            this.atLast = new Set();
        }

        t(key, fallback, params) { return this.view.t(`dashboard.${key}`, fallback, params); }

        savePrefs() { try { localStorage.setItem(this.compact ? INLINE_KEY : PREFS_KEY, JSON.stringify(this.prefs)); } catch { /* window only */ } }

        destroy() {
            this.abort?.abort();
            this.abort = null;
            clearTimeout(this.timer);
            this.timer = null;
            if (this.frame) cancelAnimationFrame(this.frame);
            this.frame = 0;
            this.els = null;
        }

        button(attr, label, { pressed = null, cls = '' } = {}) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `docker-logs-btn${cls ? ` ${cls}` : ''}`;
            b.setAttribute(attr, typeof pressed === 'string' ? pressed : '');
            if (typeof pressed === 'boolean') b.setAttribute('aria-pressed', String(pressed));
            b.textContent = label;
            return b;
        }

        svcColor(service) {
            const i = Math.max(0, this.services.indexOf(service));
            return `var(--docker-svc-${(i % 4) + 1})`;
        }

        chip(service, label) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'docker-logs-chip';
            b.setAttribute('data-logs-service', service);
            b.setAttribute('aria-pressed', String((service || null) === this.only));
            if (service) {
                const sw = document.createElement('span');
                sw.className = 'docker-logs-chip-sw';
                sw.style.background = this.svcColor(service);
                b.appendChild(sw);
            }
            b.append(label);
            return b;
        }

        /** Returns { bar, main, foot, chips }; els.follow goes in the window head, or first in the bar. */
        build({ followInBar = false } = {}) {
            const follow = this.button('data-logs-follow', '', { cls: 'docker-logs-follow' });
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
            tail.setAttribute('aria-label', this.stack
                ? this.t('dockerLogsTailLabelStack', 'Lines to start with, per container')
                : this.t('dockerLogsTailLabel', 'Lines to start with'));
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
            let chips = null;
            let hold = null;
            let win = null;
            if (this.stack) {
                chips = document.createElement('div');
                chips.className = 'docker-logs-chips';
                chips.setAttribute('role', 'group');
                chips.setAttribute('aria-label', this.t('dockerLogsServices', 'Services'));
                chips.appendChild(this.chip('', this.t('dockerComposeLogAll', 'All')));
                this.services.forEach((s) => chips.appendChild(this.chip(s, s)));
                hold = this.button('data-logs-hold', this.t('dockerLogsPause', 'Pause'), { pressed: false });
                hold.title = this.t('dockerLogsPauseHint', 'Stop adding new lines; they wait and come in on Resume');
            }
            if (this.opts.onOpenWindow) win = this.button('data-logs-window', this.t('dockerLogsOpenWindow', 'Open logs window'));
            let options = null;
            let optionsToggle = null;
            let head = null;
            if (this.compact) {
                // Narrow: search, the pause and follow buttons and two icons on one row; the rest sits behind "⋯".
                if (win) {
                    // A labelled button on its own line above the chips, where it is seen.
                    win.textContent = `⤢ ${this.t('dockerLogsOpenWindow', 'Open logs window')}`;
                    win.classList.add('docker-logs-open');
                    win.title = this.t('dockerLogsOpenWindowTip', 'Open these logs in a large window');
                    head = document.createElement('div');
                    head.className = 'docker-logs-viewhead';
                    const label = document.createElement('span');
                    label.textContent = this.t('dockerComposeLogLabel', 'Logs of every service');
                    head.append(label, win);
                }
                optionsToggle = this.button('data-logs-options-toggle', '⋯', { pressed: false, cls: 'docker-logs-icon' });
                optionsToggle.title = this.t('dockerLogsOptions', 'More options');
                optionsToggle.setAttribute('aria-label', optionsToggle.title);
                options = document.createElement('div');
                options.className = 'docker-logs-options';
                options.setAttribute('data-logs-options', '');
                options.hidden = true;
                options.append(follow, filter, seg, tail, times, wrap, copy, download);
                const row = document.createElement('div');
                row.className = 'docker-logs-barrow';
                row.append(search, count, ...(hold ? [hold] : []), optionsToggle);
                bar.classList.add('docker-logs-bar--compact');
                bar.append(row, options);
            } else {
                bar.append(...(followInBar ? [follow] : []), ...(hold ? [hold] : []), search, filter, count, seg, tail, times, wrap, copy, download, ...(win ? [win] : []));
            }

            const main = document.createElement('div');
            main.className = 'docker-logs-main';
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
            main.append(body, jump, ended);

            const foot = document.createElement('footer');
            foot.className = 'docker-logs-foot';
            const total = document.createElement('span');
            total.setAttribute('data-logs-total', '');
            let status = null;
            if (this.stack) {
                status = document.createElement('span');
                status.className = 'docker-logs-status';
                status.setAttribute('data-logs-status', '');
                status.setAttribute('role', 'status');
            }
            const keys = document.createElement('span');
            keys.className = 'docker-logs-keys';
            const legend = [['/', this.t('dockerLogsKeySearch', 'search')], ['f', this.t('dockerLogsKeyFollow', 'follow')]];
            if (this.compact) {
                // One quiet line: "/ search · f follow · p pause".
                keys.classList.add('docker-logs-keys--line');
                keys.textContent = `/ ${this.t('dockerLogsKeySearch', 'search')} · f ${this.t('dockerLogsKeyFollow', 'follow')}${this.stack ? ` · p ${this.t('dockerLogsKeyPause', 'pause')}` : ''}`;
                legend.length = 0;
            }
            if (!this.compact) {
                if (this.stack) legend.push(['p', this.t('dockerLogsKeyPause', 'pause')]);
                legend.push(['Enter', this.t('dockerLogsKeyNext', 'next match')], ...(this.opts.keys || []));
            }
            legend.forEach(([k, label]) => {
                const item = document.createElement('span');
                const kbd = document.createElement('kbd');
                kbd.textContent = k;
                item.append(kbd, ` ${label}`);
                keys.appendChild(item);
            });
            const left = document.createElement('span');
            left.className = 'docker-logs-foot-left';
            left.append(...(status ? [status] : []), total);
            foot.append(status ? left : total, keys);

            this.els = { follow, hold, win, options, optionsToggle, chips, search, filter, count, seg, tail, times, wrap, copy, download, body, jump, ended, endedText, resume, total, status };
            this.applyLook();
            this.bind();
            this.syncStatus();
            return { bar, main, foot, chips, head };
        }

        bind() {
            const els = this.els;
            els.follow.addEventListener('click', () => (this.following ? this.pause() : this.jumpToLatest()));
            els.jump.addEventListener('click', () => this.jumpToLatest());
            els.resume.addEventListener('click', () => this.resume());
            els.hold?.addEventListener('click', () => this.setHeld(!this.held));
            els.optionsToggle?.addEventListener('click', () => {
                els.options.hidden = !els.options.hidden;
                els.optionsToggle.setAttribute('aria-pressed', String(!els.options.hidden));
                if (this.following) this.scrollToEnd();
            });
            els.win?.addEventListener('click', () => this.opts.onOpenWindow());
            els.chips?.addEventListener('click', (e) => {
                const c = e.target.closest('[data-logs-service]');
                if (c) this.setOnly(c.getAttribute('data-logs-service'));
            });
            els.body.addEventListener('scroll', () => this.onScroll(), { passive: true });
            els.search.addEventListener('input', () => { this.query = els.search.value; this.refreshMatches({ reset: true }); });
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
            els.tail.addEventListener('change', () => { this.prefs.tail = Number(els.tail.value) || 500; this.savePrefs(); this.restart(); });
            els.times.addEventListener('click', () => { this.prefs.timestamps = !this.prefs.timestamps; this.savePrefs(); this.applyLook(); });
            els.wrap.addEventListener('click', () => { this.prefs.wrap = !this.prefs.wrap; this.savePrefs(); this.applyLook(); });
            els.copy.addEventListener('click', () => void this.copy());
            els.download.addEventListener('click', () => this.download());
        }

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

        /** The host's keydown; true when the key was the reader's. */
        onKey(e) {
            const els = this.els;
            if (!els) return false;
            const inSearch = e.target === els.search;
            const typing = inSearch || e.target === els.tail;
            const take = () => { e.preventDefault(); e.stopPropagation(); return true; };
            if (e.key === 'Escape') {
                if (inSearch && els.search.value) {
                    els.search.value = '';
                    this.query = '';
                    this.refreshMatches({ reset: true });
                    return take();
                }
                if (!this.opts.onEscape) return false;
                take();
                this.opts.onEscape();
                return true;
            }
            if (e.key === 'Enter' && (inSearch || !typing) && this.matches.length
                && (inSearch || !e.target.closest?.('button, a, select'))) {
                take();
                this.stepMatch(e.shiftKey ? -1 : 1);
                return true;
            }
            if (typing || e.metaKey || e.ctrlKey || e.altKey) return false;
            if (e.key === '/') { take(); els.search.focus(); els.search.select(); return true; }
            if (e.key === 'f') { take(); if (this.following) this.pause(); else this.jumpToLatest(); return true; }
            if (e.key === 'p' && this.stack) { take(); this.setHeld(!this.held); return true; }
            return false;
        }

        restart() {
            this.abort?.abort();
            clearTimeout(this.timer);
            this.timer = null;
            this.lines.forEach((l) => l.el?.remove());
            this.lines = [];
            this.pending = [];
            this.lastKey = '';
            this.atLast = new Set();
            this.newSince = 0;
            this.following = true;
            this.refreshMatches({ reset: true });
            this.connect();
        }

        resumeSince() {
            const last = [...this.lines, ...this.pending].reverse().find((l) => timeKey(l.t) === this.lastKey);
            return last ? sinceFrom(last.t) : '';
        }

        resume() {
            clearTimeout(this.timer);
            this.timer = null;
            this.dead = new Set();
            this.connect(this.resumeSince());
        }

        async connect(since = '', attempt = 0) {
            this.abort?.abort();
            clearTimeout(this.timer);
            this.timer = null;
            const abort = new AbortController();
            this.abort = abort;
            this.ended = false;
            this.note = attempt ? this.t('dockerComposeLogRetrying', 'Reconnecting…') : this.t('dockerComposeLogConnecting', 'Connecting…');
            this.syncStatus();
            const lastKey = since ? this.lastKey : '';
            const seenAtLast = new Set(since ? this.atLast : []);
            let res;
            try {
                const fetcher = typeof window.nextDashFetch === 'function' ? window.nextDashFetch : fetch;
                res = await fetcher(this.opts.url(since, this.prefs.tail), { signal: abort.signal, cache: 'no-store' });
            } catch {
                res = null;
            }
            if (abort.signal.aborted || this.abort !== abort) return;
            if (!res || !res.ok || !res.body) {
                const status = res?.status;
                if (this.stack && status !== 401 && status !== 404) { this.retry(attempt); return; }
                this.onEnded(status === 401
                    ? this.t('dockerLogsNeedsToken', 'Reading logs needs the write token.')
                    : this.t('dockerLogsUnreachable', 'The log could not be reached.'));
                return;
            }
            this.note = '';
            this.syncStatus();
            const conn = { got: new Set(), ended: new Set(), restart: false };
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            try {
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (abort.signal.aborted) return;
                    buffer += decoder.decode(value, { stream: true });
                    let nl = buffer.indexOf('\n');
                    while (nl >= 0) {
                        const raw = buffer.slice(0, nl).trim();
                        buffer = buffer.slice(nl + 1);
                        nl = buffer.indexOf('\n');
                        if (!raw) continue;
                        let line;
                        try { line = JSON.parse(raw); } catch { continue; }
                        const c = String(line.container || line.service || '');
                        if (line.s === 'end') { this.onEndMarker(c, conn, abort); continue; }
                        attempt = 0;
                        this.dead.delete(c);
                        conn.got.add(c);
                        if (lastKey) {
                            const k = timeKey(line.t);
                            if (k < lastKey || (k === lastKey && seenAtLast.delete(`${c}|${line.m}`))) continue;
                        }
                        this.queue(line);
                    }
                }
            } catch {
                // Aborted, or the connection dropped.
            }
            if (abort.signal.aborted || this.abort !== abort) return;
            if (conn.restart) return;
            if (conn.ended.size) {
                this.onEnded(this.t('dockerComposeLogAllStopped', 'Every container has stopped. Reconnect when they run again.'));
                return;
            }
            if (this.stack) { this.retry(attempt); return; }
            this.onEnded(this.t('dockerLogsEnded', 'The stream ended — the container stopped, or the connection closed.'));
        }

        onEndMarker(c, conn, abort) {
            conn.ended.add(c);
            if (!conn.got.has(c)) { this.dead.add(c); this.syncStatus(); return; }
            conn.restart = true;
            if (this.timer) return;
            this.note = this.t('dockerComposeLogRestarting', 'A container stopped or was recreated. Reconnecting…');
            this.syncStatus();
            this.timer = setTimeout(() => {
                this.timer = null;
                if (this.abort !== abort || !this.els) return;
                this.connect(this.resumeSince());
            }, RECREATE_WAIT);
        }

        retry(attempt) {
            if (attempt >= RETRY_WAITS.length) {
                this.onEnded(this.t('dockerComposeLogGaveUp', 'Disconnected: the log could not be reached again.'));
                return;
            }
            const secs = RETRY_WAITS[attempt];
            this.note = this.t('dockerComposeLogRetryIn', 'Disconnected. Trying again in {s} s.', { s: secs });
            this.syncStatus();
            const abort = this.abort;
            this.timer = setTimeout(() => {
                this.timer = null;
                if (this.abort !== abort || !this.els) return;
                this.connect(this.resumeSince(), attempt + 1);
            }, secs * 1000);
        }

        onEnded(text) {
            this.ended = true;
            this.note = '';
            if (!this.els) return;
            this.els.endedText.textContent = text;
            this.syncStatus();
        }

        queue(line) {
            const l = {
                t: String(line.t || ''),
                s: line.s === 'err' ? 'err' : 'out',
                m: String(line.m ?? ''),
                service: String(line.service || ''),
                container: String(line.container || line.service || ''),
            };
            const k = timeKey(l.t);
            if (k > this.lastKey) { this.lastKey = k; this.atLast = new Set(); }
            if (k === this.lastKey) this.atLast.add(`${l.container}|${l.m}`);
            this.pending.push(l);
            if (this.held) {
                if (this.pending.length > MAX_LINES) this.pending.splice(0, this.pending.length - MAX_LINES);
                this.syncStatus();
                return;
            }
            if (!this.frame) this.frame = requestAnimationFrame(() => this.flush());
        }

        flush() {
            this.frame = 0;
            const els = this.els;
            if (!els || !this.pending.length || this.held) return;
            const batch = this.pending;
            this.pending = [];
            const frag = document.createDocumentFragment();
            batch.forEach((l) => { l.el = this.lineEl(l); frag.appendChild(l.el); this.lines.push(l); });
            els.body.appendChild(frag);
            const over = this.lines.length - MAX_LINES;
            if (over > 0) this.lines.splice(0, over).forEach((l) => l.el.remove());
            if (this.following) this.scrollToEnd();
            else this.newSince += batch.length;
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
            row.appendChild(time);
            if (this.stack) {
                if (l.service && !this.services.includes(l.service)) this.addService(l.service);
                row.setAttribute('data-service', l.service);
                const tag = document.createElement('span');
                tag.className = 'docker-logs-svc';
                tag.style.color = this.svcColor(l.service);
                tag.textContent = l.service;
                tag.title = l.container;
                row.appendChild(tag);
            }
            const text = document.createElement('span');
            text.className = 'docker-logs-text';
            row.appendChild(text);
            this.paintText(text, l.m);
            row.hidden = !this.visible(l);
            return row;
        }

        addService(name) {
            this.services.push(name);
            this.els?.chips?.appendChild(this.chip(name, name));
        }

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
            if (this._programmatic) { this._programmatic = false; if (atEnd) return; }
            if (atEnd && !this.following) { this.following = true; this.newSince = 0; this.syncStatus(); }
            else if (!atEnd && this.following) this.pause();
        }

        pause() { this.following = false; this.syncStatus(); }

        jumpToLatest() { this.following = true; this.newSince = 0; this.scrollToEnd(); this.syncStatus(); }

        setHeld(held) {
            this.held = held;
            if (!held && this.pending.length && !this.frame) this.frame = requestAnimationFrame(() => this.flush());
            this.syncStatus();
        }

        syncStatus() {
            const els = this.els;
            if (!els) return;
            let label;
            if (this.ended) label = this.t('dockerLogsStatusEnded', 'Stream ended');
            else if (this.following) label = `● ${this.t('dockerLogsFollowing', 'Following')}`;
            else if (this.stack) label = this.newSince ? this.t('dockerLogsFollowNew', 'Follow · {count} new', { count: this.newSince }) : this.t('dockerLogsFollow', 'Follow');
            else if (this.newSince) label = this.t('dockerLogsPausedNew', 'Paused · {count} new', { count: this.newSince });
            else label = this.t('dockerLogsPaused', 'Paused');
            els.follow.textContent = label;
            els.follow.setAttribute('data-state', this.ended ? 'ended' : (this.following ? 'following' : 'paused'));
            els.follow.disabled = this.ended;
            els.jump.hidden = this.following || this.ended;
            els.ended.hidden = !this.ended;
            els.total.textContent = this.t('dockerLogsLineCount', '{count} lines', { count: this.lines.length });
            if (els.hold) {
                els.hold.textContent = this.held ? this.t('dockerLogsResume', 'Resume') : this.t('dockerLogsPause', 'Pause');
                els.hold.setAttribute('aria-pressed', String(this.held));
            }
            if (els.status) {
                let state;
                let text;
                if (this.ended) { state = 'ended'; text = this.t('dockerLogsStatusEnded', 'Stream ended'); }
                else if (this.held) { state = 'paused'; text = this.t('dockerLogsHeld', 'Paused · {count} waiting', { count: this.pending.length }); }
                else if (this.note) { state = 'connecting'; text = this.note; }
                else { state = 'live'; text = `● ${this.t('dockerLogsLive', 'Live')}`; }
                const dead = [...this.dead];
                if (dead.length && !this.ended) text += ` · ${this.t('dockerComposeLogStopped', 'stopped: {names}', { names: dead.join(', ') })}`;
                els.status.textContent = text;
                els.status.setAttribute('data-state', state);
            }
        }

        setOnly(service) {
            this.only = service || null;
            this.els?.chips?.querySelectorAll('[data-logs-service]').forEach((c) => {
                c.setAttribute('aria-pressed', String((c.getAttribute('data-logs-service') || null) === this.only));
            });
            this.refreshMatches({ reset: true });
            if (this.following) this.scrollToEnd();
        }

        visible(l) {
            if (this.prefs.stream !== 'all' && l.s !== this.prefs.stream) return false;
            if (this.only !== null && l.service !== this.only) return false;
            if (this.filterOnly && this.query && !l.m.toLowerCase().includes(this.query.toLowerCase())) return false;
            return true;
        }

        applyVisibility() { this.lines.forEach((l) => { l.el.hidden = !this.visible(l); }); }

        paintText(span, text) {
            span.replaceChildren();
            const q = this.query.toLowerCase();
            if (!q) { span.textContent = text; return; }
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
                if ((l.painted || '') !== q || reset) {
                    this.paintText(l.el.querySelector('.docker-logs-text'), l.m);
                    l.painted = q;
                }
                l.el.classList.remove('is-current');
            });
            this.applyVisibility();
            this.matches = q ? this.lines.filter((l) => !l.el.hidden && l.m.toLowerCase().includes(q)) : [];
            if (!this.matches.length) this.matchIndex = -1;
            else if (reset || !current) { this.matchIndex = 0; this.showMatch(); }
            else { this.matchIndex = Math.max(0, this.matches.indexOf(current)); current.el.classList.add('is-current'); }
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
            this.els.count.textContent = this.t('dockerLogsMatchOf', '{index} of {count}', { index: this.matchIndex + 1, count: this.matches.length });
        }

        showMatch() {
            this.lines.forEach((l) => l.el.classList.remove('is-current'));
            const m = this.matches[this.matchIndex];
            if (!m) return;
            m.el.classList.add('is-current');
            if (this.following) this.pause();
            // Centred inside the log box only, never by scrolling the page or panel.
            const body = this.els.body;
            body.scrollTop = Math.max(0, m.el.offsetTop - body.offsetTop - (body.clientHeight - m.el.offsetHeight) / 2);
        }

        lineText(l, withTime) {
            return `${withTime ? `${l.t} ` : ''}${this.stack ? `${l.service} ` : ''}[${l.s}] ${l.m}`;
        }

        async copy() {
            const text = this.lines.filter((l) => !l.el.hidden).map((l) => this.lineText(l, this.prefs.timestamps)).join('\n');
            try {
                await navigator.clipboard.writeText(text);
                window.nextdashTrack?.('docker:logs-copy');
                this.view.dash?.showNotification?.(this.t('dockerLogsCopied', 'Lines copied'), 'success', { duration: 2000 });
            } catch {
                this.view.dash?.showNotification?.(this.t('dockerLogsCopyFailed', 'The browser did not allow copying.'), 'error');
            }
        }

        download() {
            window.nextdashTrack?.('docker:logs-download');
            const text = [...this.lines, ...this.pending].map((l) => this.lineText(l, true)).join('\n');
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

    class DockerLogsModal {
        static current = null;

        static isOpen() { return Boolean(DockerLogsModal.current?.dialog?.open); }

        constructor(view) {
            this.view = view;
            this.dialog = null;
            this.reader = null;
            this.name = '';
        }

        t(key, fallback, params) { return this.view.t(`dashboard.${key}`, fallback, params); }

        open(container) {
            const name = typeof container === 'string' ? container : container?.name;
            if (!name) return;
            const summary = typeof container === 'string' ? { name } : container;
            this.show({
                name,
                badge: summary.state || '',
                state: summary.state || '',
                url: (since, tail) => {
                    const q = new URLSearchParams({ tail: String(tail) });
                    if (since) q.set('since', since);
                    return dockerHostURL(`/api/docker/containers/${encodeURIComponent(name)}/logs/stream?${q}`);
                },
            });
        }

        openStack({ project, services, url }) {
            if (!project) return;
            this.show({ name: project, badge: this.t('dockerLogsStackBadge', 'Stack'), state: 'stack', services: services || [], url });
        }

        show({ name, badge: badgeText, state, services, url }) {
            DockerLogsModal.current?.close({ restoreFocus: false });
            DockerLogsModal.current = this;
            this.name = name;
            this.returnFocus = document.activeElement;
            const dialog = document.createElement('dialog');
            dialog.className = 'docker-logs-modal';
            dialog.setAttribute('data-docker-logs-modal', '');
            dialog.setAttribute('data-logs-view', '');
            dialog.setAttribute('aria-label', this.t('dockerLogsTitle', 'Logs of {name}', { name }));
            const head = document.createElement('header');
            head.className = 'docker-logs-head';
            const title = document.createElement('h2');
            title.className = 'docker-logs-modal-title';
            title.textContent = name;
            const badge = document.createElement('span');
            badge.className = 'docker-logs-badge';
            badge.setAttribute('data-state', state);
            badge.textContent = badgeText;
            const spacer = document.createElement('span');
            spacer.className = 'docker-logs-spacer';
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'docker-logs-btn docker-logs-close';
            close.setAttribute('data-logs-close', '');
            close.textContent = '✕';
            close.setAttribute('aria-label', this.t('dockerLogsClose', 'Close'));
            this.reader = new DockerLogView(this.view, {
                name, url, services,
                keys: [['Esc', this.t('dockerLogsKeyClose', 'close')]],
                onEscape: () => this.close(),
            });
            const { bar, main, foot, chips } = this.reader.build();
            head.append(title, badge, spacer, this.reader.els.follow, close);
            dialog.append(head, ...(chips ? [chips] : []), bar, main, foot);
            this.dialog = dialog;
            close.addEventListener('click', () => this.close());
            dialog.addEventListener('click', (e) => { if (e.target === dialog) this.close(); });
            dialog.addEventListener('cancel', (e) => { e.preventDefault(); this.close(); });
            dialog.addEventListener('keydown', (e) => {
                if (!this.reader?.onKey(e) && e.key === 'Escape') { e.preventDefault(); this.close(); }
            });
            document.body.appendChild(dialog);
            dialog.showModal();
            this.scrollLock = window.ScrollLock?.acquire?.('docker-logs-modal');
            window.EscapeOwner?.registerOwner?.('docker-logs-modal', {
                isOpen: () => DockerLogsModal.isOpen(),
                handleEscape: () => DockerLogsModal.current?.close(),
            });
            window.FocusTrapUtils?.syncDashboardInert?.();
            this.reader.els.body.focus({ preventScroll: true });
            this.reader.connect();
        }

        close({ restoreFocus = true } = {}) {
            this.reader?.destroy();
            this.reader = null;
            if (this.scrollLock) window.ScrollLock?.release?.(this.scrollLock);
            this.scrollLock = null;
            if (this.dialog?.open) this.dialog.close();
            this.dialog?.remove();
            this.dialog = null;
            if (DockerLogsModal.current === this) DockerLogsModal.current = null;
            window.FocusTrapUtils?.syncDashboardInert?.();
            if (restoreFocus && this.returnFocus?.isConnected) this.returnFocus.focus?.({ preventScroll: true });
        }
    }

    window.DockerLogView = DockerLogView;
    window.DockerLogsModal = DockerLogsModal;
})();
