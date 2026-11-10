/**
 * Network checks, inside the bookmark panel's Health tab.
 *
 * One card per check -- its name and state, the uptime strip, the last
 * result, and for a failure the block that says what to do -- and a form to
 * add or change one in three short parts (type, what to check, planning), with
 * what the check will do written beside it as the reader types.
 *
 * Checks are the server's: they travel only through PUT /api/net/checks, and
 * always as the bookmark's whole list (a check left out is deleted). The
 * page save never carries them, so a tab loaded before a check was added
 * cannot take it away. What the panel shows of a check's last result is read
 * from the history, never stored on the check.
 *
 * The list reads one bulk answer (GET /api/net/checks without a query) into
 * an index by bookmark: the badges behind a row's name, the rail's
 * "Check type" group and its filter all look in it, so no row asks for
 * anything of its own.
 *
 * Loaded after the Health part, by ensureBookmarkRenderers.
 */
(function (global) {
    'use strict';
    if (typeof global.DashboardConfig !== 'function') return;

    const model = () => global.NetChecksModel;

    Object.assign(global.DashboardConfig.prototype, {
        /** Whether the section is drawn at all: the install's switch for network checks. */
        bmNetEnabled() {
            return this.dash.settings?.netToolsEnabled !== false && Boolean(model());
        },

        bmNetT(key, fallback) {
            return this.t(key, fallback);
        },

        /** The state kept for the bookmark the panel shows; a different bookmark starts clean. */
        bmNetState(b) {
            const key = `${b?.pageId}\u0000${b?.url}`;
            if (this._bmNet?.key !== key) {
                this._bmNet = { key, status: 'idle', checks: [], error: '', editing: null, saving: false };
            }
            return this._bmNet;
        },

        /** The section: its body is drawn by renderBmNetBody and swapped in place when something changes. */
        renderBmNetChecks(b) {
            if (!this.bmNetEnabled()) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            return `<section class="net-checks" data-bm-net aria-label="${esc(this.bmNetT('nettools.sectionTitle', 'Checks'))}">${this.renderBmNetBody(b)}</section>`;
        },

        renderBmNetBody(b) {
            const esc = (v) => this.dash.escapeHtml(v);
            const st = this.bmNetState(b);
            const caps = this._bmNetCaps;
            const canAdd = Boolean(caps?.typesBuilt?.length) && st.checks.length < model().MAX_CHECKS_PER_BOOKMARK;
            const cards = st.checks.map((c) => this.renderBmNetCard(b, c)).join('');
            const empty = st.status === 'ready' && !st.checks.length && !st.editing
                ? `<p class="config-bm-panel-muted net-empty">${esc(this.bmNetT('nettools.empty', 'No checks yet. A check tests one thing about this bookmark, on a schedule.'))}</p>`
                : '';
            const loading = st.status === 'loading' && !st.checks.length
                ? `<p class="config-bm-panel-muted" role="status">${esc(this.bmNetT('nettools.loading', 'Loading checks...'))}</p>`
                : '';
            const failed = st.status === 'error'
                ? `<p class="net-inline-error" role="status">${esc(this.bmNetT('nettools.loadFailed', 'Could not read the checks.'))}</p>`
                : '';
            const note = st.error && !st.editing ? `<p class="net-inline-error" role="status" data-net-error>${esc(st.error)}</p>` : '';
            const form = st.editing ? this.renderBmNetCheckForm(b) : '';
            const add = !st.editing && canAdd
                ? `<button type="button" class="config-btn config-btn--small" data-net-action="add">${esc(this.bmNetT('nettools.addCheck', 'Add check'))}</button>`
                : '';
            return `
                <h3 class="net-checks-title">${esc(this.bmNetT('nettools.sectionTitle', 'Checks'))}</h3>
                ${loading}${failed}${empty}${note}
                <div class="net-card-list">${cards}</div>
                ${form}
                ${add ? `<div class="net-checks-foot">${add}</div>` : ''}`;
        },

        /** One check as a card (mockup c1). */
        renderBmNetCard(b, check) {
            const esc = (v) => this.dash.escapeHtml(v);
            const M = model();
            const health = this._bmHealthModule;
            const t = (k, f) => this.bmNetT(k, f);
            const state = M.badgeState(check);
            const name = M.labelFor(check, b);
            const stats = check.stats || null;
            const last = check.state || null;
            const uptime = health?.formatUptime?.(stats?.uptime24h) || '';
            const ms = last && last.ok && Number(last.ms) > 0 ? `${Math.round(last.ms)} ms` : '';
            const cadence = check.enabled === true
                ? t('nettools.every', 'Every {interval}').replace('{interval}', M.intervalWords(M.intervalMinutes(check, b), t))
                : t('nettools.stateOff', 'Not scheduled');
            const meta = [cadence, ms].filter(Boolean).join(' · ');
            const viaTcp = last?.viaTcp ? `<span class="net-via">${esc(t('nettools.viaTcp', 'via TCP'))}</span>` : '';
            const strip = check.enabled === true && health && stats?.heartbeat?.length
                ? `<div class="health-monitor-strip net-card-strip">${health.renderHeartbeat(stats)}${health.renderSparkline(stats, { w: 120, h: 22 })}</div>`
                : '';
            const downFor = Number(stats?.downSince) > 0 && health
                ? `<p class="net-card-line is-bad">${esc(t('nettools.downFor', 'Down for {duration}').replace('{duration}', health.formatDuration(Date.now() - Number(stats.downSince))))}</p>`
                : '';
            const detail = last?.detail ? `<p class="net-card-line">${esc(last.detail)}</p>` : '';
            const block = last && !last.ok ? this.renderBmNetErrorBlock(b, check) : '';
            const muteLabel = check.muted ? t('nettools.unmute', 'Unmute') : t('nettools.mute', 'Mute');
            return `
                <article class="net-card" data-net-card="${esc(check.id)}" data-state="${state}" aria-label="${esc(`${name}: ${M.stateLabel(state, t)}`)}">
                    <div class="net-card-head">
                        <span class="net-badge" data-state="${state}">${esc(name)}</span>
                        <span class="net-card-state">${esc(M.stateLabel(state, t))}</span>${viaTcp}
                        <span class="net-card-meta">${esc(meta)}</span>
                        ${uptime ? `<b class="net-card-uptime" data-state="${state}">${esc(uptime)}</b>` : ''}
                    </div>
                    ${strip}${downFor}${detail}${block}
                    <div class="net-card-actions">
                        <button type="button" class="config-btn config-btn--small" data-net-action="edit" data-net-id="${esc(check.id)}">${esc(t('nettools.edit', 'Edit'))}</button>
                        <button type="button" class="config-btn config-btn--small${check.muted ? ' is-active' : ''}" data-net-action="mute" data-net-id="${esc(check.id)}"
                                aria-pressed="${check.muted === true}" title="${esc(t('nettools.muteTitle', 'Silence the alerts of this check. Its history is still kept.'))}">${esc(muteLabel)}</button>
                    </div>
                </article>`;
        },

        /** The block under a failed check: what happened and the one thing to do (mockup g1). */
        renderBmNetErrorBlock(b, check) {
            const esc = (v) => this.dash.escapeHtml(v);
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const target = M.targetOf(check, b);
            const block = M.errorBlock({
                class: check.state?.class, host: target.host, port: target.port,
                timeoutSec: check.timeoutSec || 5,
            }, t);
            if (!block) return '';
            const buttons = {
                copy: () => `<button type="button" class="config-btn config-btn--small" data-net-action="copy" data-net-snippet="${esc(block.snippet || '')}">${esc(t('nettools.copy', 'Copy'))}</button>`,
                allowLocal: () => `<button type="button" class="config-btn config-btn--small" data-net-action="allow-local">${esc(t('nettools.openAllowLocal', 'Open the "Allow local bookmarks" setting'))}</button>`,
            };
            return `
                <div class="net-error is-${block.tone}" role="status" data-net-error-class="${esc(block.cls)}">
                    <b class="net-error-title">${esc(block.title)}</b>
                    <p>${esc(block.body)}</p>
                    ${block.snippet ? `<pre class="net-error-code">${esc(block.snippet)}</pre>` : ''}
                    ${block.note ? `<p class="net-error-note">${esc(block.note)}</p>` : ''}
                    ${block.actions.length ? `<div class="net-error-actions">${block.actions.map((a) => buttons[a]?.() || '').join('')}</div>` : ''}
                </div>`;
        },

        /* ── The form ────────────────────────────────────────────────────── */

        /** A form draft from a stored check (or a blank one): text fields as typed, planning as one choice. */
        bmNetDraftFrom(check) {
            // The server leaves `enabled` out of a check that is off.
            const planning = check.enabled !== true ? 'off' : (Number(check.intervalMinutes) > 0 ? 'own' : 'bookmark');
            const text = (n) => (Number(n) > 0 ? String(n) : '');
            return {
                type: check.type, label: check.label || '', host: check.host || '',
                port: text(check.port), count: text(check.count), maxLossPct: text(check.maxLossPct), maxMs: text(check.maxMs),
                planning, intervalMinutes: Number(check.intervalMinutes) || 0, timeoutSec: Number(check.timeoutSec) || 0,
                muted: check.muted === true,
            };
        },

        /** The check a draft stands for, in the shape PUT /api/net/checks takes. */
        bmNetCheckFromDraft(draft, id, b) {
            const num = (v) => (String(v).trim() === '' ? 0 : Number(v));
            const interval = draft.planning === 'own'
                ? (Number(draft.intervalMinutes) || global.CheckMode?.intervalOf?.(b) || 15)
                : 0;
            return {
                id: id || '', type: draft.type, label: String(draft.label || '').trim(), host: String(draft.host || '').trim(),
                port: num(draft.port), count: num(draft.count), maxLossPct: num(draft.maxLossPct), maxMs: num(draft.maxMs),
                enabled: draft.planning !== 'off', intervalMinutes: interval, timeoutSec: Number(draft.timeoutSec) || 0,
                muted: draft.muted === true,
            };
        },

        renderBmNetCheckForm(b) {
            const esc = (v) => this.dash.escapeHtml(v);
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const st = this.bmNetState(b);
            const ed = st.editing;
            const d = ed.draft;
            const caps = this._bmNetCaps || {};
            const errors = ed.errors || {};
            const field = (name, label, control, hint = '') => `
                <label class="config-bm-field${errors[name] ? ' is-error' : ''}" data-net-field-wrap="${name}">
                    <span class="config-bm-field-label">${esc(label)}</span>
                    ${control}
                    <span class="config-bm-field-status" role="status">${esc(errors[name] || '')}</span>
                    ${hint ? `<span class="config-bm-panel-muted">${esc(hint)}</span>` : ''}
                </label>`;
            const input = (name, value, type = 'text', extra = '') =>
                `<input class="config-text" type="${type}" data-net-field="${name}" value="${esc(value ?? '')}" ${extra}>`;
            const tiles = (caps.typesBuilt || []).map((type) => `
                <button type="button" class="net-tile${d.type === type ? ' is-selected' : ''}" data-net-action="type" data-net-type="${type}" aria-pressed="${d.type === type}">
                    <b>${esc(M.typeName(type))}</b><span>${esc(M.typeHint(type, t))}</span>
                </button>`).join('');
            const target = M.targetOf({ type: d.type, host: d.host, port: Number(d.port) || 0 }, b);
            let params = '';
            if (d.type === 'tcp') {
                params = `<div class="net-fields">
                    ${field('port', t('nettools.fieldPort', 'Port'), input('port', d.port, 'number', `min="1" max="65535" placeholder="${esc(String(target.port || ''))}"`),
                        t('nettools.fieldPortHint', 'Empty uses the port of the bookmark address.'))}
                    ${field('maxMs', t('nettools.fieldSlow', 'Slow from (ms)'), input('maxMs', d.maxMs, 'number', 'min="0" max="60000" placeholder="-"'))}
                </div>`;
            } else if (d.type === 'ping') {
                params = `<div class="net-fields">
                    ${field('count', t('nettools.fieldPackets', 'Packets'), input('count', d.count, 'number', 'min="1" max="10" placeholder="4"'))}
                    ${field('maxLossPct', t('nettools.fieldLoss', 'Down from loss (%)'), input('maxLossPct', d.maxLossPct, 'number', 'min="1" max="100" placeholder="50"'))}
                    ${field('maxMs', t('nettools.fieldSlow', 'Slow from (ms)'), input('maxMs', d.maxMs, 'number', 'min="0" max="60000" placeholder="-"'))}
                </div>`;
            }
            const custom = caps.allowCustomHost
                ? field('host', t('nettools.fieldHost', 'Host'), input('host', d.host, 'text', `spellcheck="false" placeholder="${esc(M.hostOf(b))}"`),
                    t('nettools.fieldHostHint', 'Empty checks the host of the bookmark address.'))
                : '';
            const label = field('label', t('nettools.fieldLabel', 'Name'), input('label', d.label, 'text', `maxlength="60" placeholder="${esc(M.labelFor({ type: d.type, port: Number(d.port) || 0, host: d.host }, b))}"`));
            const plan = (value, text) => `<button type="button" class="config-btn config-btn--small${d.planning === value ? ' is-active' : ''}" data-net-action="planning"
                    data-net-planning="${value}" aria-pressed="${d.planning === value}">${esc(text)}</button>`;
            const intervals = (global.CheckMode?.INTERVAL_CHOICES || [5, 15, 30, 60, 360, 1440]);
            const intervalOptions = intervals.map((m) => `<option value="${m}"${Number(d.intervalMinutes || global.CheckMode?.intervalOf?.(b)) === m ? ' selected' : ''}>${esc(M.intervalWords(m, t))}</option>`).join('');
            const timeoutOptions = [[0, t('nettools.timeoutDefault', 'Default')], [5, '5 s'], [10, '10 s']]
                .map(([v, text]) => `<option value="${v}"${Number(d.timeoutSec) === v ? ' selected' : ''}>${esc(text)}</option>`).join('');
            const exp = this.renderBmNetExplain(b);
            const deleting = ed.id
                ? (ed.confirmDelete
                    ? `<button type="button" class="config-btn config-btn--small config-btn--danger" data-net-action="delete-confirm">${esc(t('nettools.deleteConfirm', 'Delete it for good'))}</button>`
                    : `<button type="button" class="config-btn config-btn--small config-btn--danger" data-net-action="delete">${esc(t('nettools.delete', 'Delete check'))}</button>`)
                : '';
            return `
                <form class="net-form" data-net-form novalidate aria-label="${esc(ed.id ? t('nettools.formEdit', 'Change check') : t('nettools.formAdd', 'Add check'))}">
                    <div class="net-form-head"><b>${esc(ed.id ? t('nettools.formEdit', 'Change check') : t('nettools.formAdd', 'Add check'))}</b></div>
                    <fieldset class="net-step"><legend>${esc(t('nettools.step1', '1 · Type'))}</legend>
                        <div class="net-tiles">${tiles}</div>
                    </fieldset>
                    <fieldset class="net-step"><legend>${esc(t('nettools.step2', '2 · What to check'))}</legend>
                        ${params}${custom}${label}
                    </fieldset>
                    <fieldset class="net-step"><legend>${esc(t('nettools.step3', '3 · Planning and alerts'))}</legend>
                        <div class="net-planning" role="group" aria-label="${esc(t('nettools.planning', 'Planning'))}">
                            ${plan('bookmark', t('nettools.planBookmark', 'Like the bookmark'))}${plan('own', t('nettools.planOwn', 'Own'))}${plan('off', t('nettools.planOff', 'Off'))}
                        </div>
                        <div class="net-fields">
                            ${d.planning === 'own' ? field('intervalMinutes', t('nettools.fieldInterval', 'Interval'),
                                `<select class="config-select" data-net-field="intervalMinutes">${intervalOptions}</select>`) : ''}
                            ${field('timeoutSec', t('nettools.fieldTimeout', 'Time-out'), `<select class="config-select" data-net-field="timeoutSec">${timeoutOptions}</select>`)}
                        </div>
                        <label class="config-toggle net-mute"><input type="checkbox" data-net-field="muted"${d.muted ? ' checked' : ''}> ${esc(t('nettools.muteSwitch', 'Mute alerts for this check'))}</label>
                    </fieldset>
                    <div class="net-explain" data-net-explain aria-live="polite">${exp}</div>
                    ${ed.serverError ? `<p class="net-inline-error" role="status" data-net-error>${esc(ed.serverError)}</p>` : ''}
                    <div class="net-form-foot">
                        <button type="submit" class="config-btn config-btn--primary config-btn--small" data-net-action="save"${st.saving ? ' disabled' : ''}>${esc(t('nettools.save', 'Save'))}</button>
                        <button type="button" class="config-btn config-btn--small" data-net-action="cancel">${esc(t('nettools.cancel', 'Cancel'))}</button>
                        <span class="net-form-sp"></span>
                        ${deleting}
                    </div>
                </form>`;
        },

        /** What the check being written will do, in words; redrawn on every keystroke. */
        renderBmNetExplain(b) {
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (k, f) => this.bmNetT(k, f);
            const ed = this.bmNetState(b).editing;
            if (!ed) return '';
            const check = this.bmNetCheckFromDraft(ed.draft, ed.id, b);
            const caps = { ...(this._bmNetCaps || {}), notifyRetries: this.dash.settings?.monitorNotifyRetries };
            const ex = model().explain(check, b, caps, t);
            const warn = ex.warnings.map((w) => `
                <div class="net-error is-warn" role="status"><b class="net-error-title">${esc(w.title)}</b><p>${esc(w.body)}</p></div>`).join('');
            return `
                <span class="config-bm-field-label">${esc(t('nettools.explainTitle', 'What this does'))}</span>
                <p class="net-explain-summary">${esc(ex.summary)}</p>
                <ul class="net-explain-list">${ex.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
                ${warn}`;
        },

        /* ── Loading and saving ──────────────────────────────────────────── */

        /** Swap the section's body in place; the rest of the panel is left alone. */
        paintBmNet(b) {
            const panel = this._libPanel || document.getElementById('config-bm-panel');
            const root = panel?.querySelector('[data-bm-net]');
            if (!root) return;
            const key = `${b?.pageId}\u0000${b?.url}`;
            if (this._bmNet?.key !== key) return;
            root.innerHTML = this.renderBmNetBody(b);
        },

        /** Read the bookmark's checks and what network checks can do here, then draw. */
        async loadBmNetChecks(b) {
            const st = this.bmNetState(b);
            if (st.status === 'loading') return;
            st.status = 'loading';
            const url = `/api/net/checks?pageId=${encodeURIComponent(b.pageId)}&url=${encodeURIComponent(b.url)}`;
            try {
                const [capsRes, listRes] = await Promise.all([
                    this._bmNetCaps ? null : global.fetch('/api/net/capabilities', { cache: 'no-store' }),
                    global.fetch(url, { cache: 'no-store' }),
                ]);
                if (capsRes) {
                    if (!capsRes.ok) throw new Error('capabilities');
                    this._bmNetCaps = await capsRes.json();
                }
                if (!listRes.ok) throw new Error('checks');
                const body = await listRes.json();
                if (this._bmNet !== st) return;
                st.checks = Array.isArray(body.checks) ? body.checks : [];
                st.status = 'ready';
            } catch {
                if (this._bmNet !== st) return;
                st.status = 'error';
            }
            this.paintBmNet(b);
        },

        /** The list as PUT takes it: stored fields only, never the derived state. */
        bmNetPlainChecks(list) {
            return list.map((c) => {
                const { state, stats, display, ...stored } = c; // eslint-disable-line no-unused-vars
                return stored;
            });
        },

        /** PUT the whole list. Returns true when it was stored; the message is left in the state otherwise. */
        async saveBmNetChecks(b, list) {
            const st = this.bmNetState(b);
            st.saving = true;
            let message = '';
            try {
                const res = await global.nextDashFetch('/api/net/checks', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pageId: b.pageId, url: b.url, checks: this.bmNetPlainChecks(list) }),
                });
                if (res.ok) {
                    const body = await res.json();
                    st.checks = Array.isArray(body.checks) ? body.checks : [];
                    st.saving = false;
                    // The caps carry the ICMP state and the scheduled count.
                    void this.refreshBmNetCaps();
                    // The rows' badges and the rail's counts follow the change.
                    void this.loadBmNetIndex({ force: true });
                    return true;
                }
                const err = await res.json().catch(() => ({}));
                message = err.error || this.bmNetT('nettools.saveFailed', 'Could not save the checks.');
            } catch {
                message = this.bmNetT('nettools.saveFailed', 'Could not save the checks.');
            }
            st.saving = false;
            if (st.editing) st.editing.serverError = message;
            else st.error = message;
            return false;
        },

        async refreshBmNetCaps() {
            try {
                const res = await global.fetch('/api/net/capabilities', { cache: 'no-store' });
                if (res.ok) this._bmNetCaps = await res.json();
            } catch {
                // The next load asks again.
            }
        },

        /* ── The list: badges and the rail's "Check type" ────────────────── */

        bmNetIndexKey(b) {
            return `${b?.pageId}\u0000${b?.url}`;
        },

        /** A bookmark's checks from the install-wide index; a map lookup, never a request. */
        bmNetItems(b) {
            return this._bmNetIndex?.byKey.get(this.bmNetIndexKey(b)) || [];
        },

        /** Whether a bookmark falls under one of the rail's Check type entries. */
        bmNetMatches(b, key) {
            return model().railKeys(this.bmNetItems(b)).includes(key);
        },

        bmNetKeys(b) {
            return model().railKeys(this.bmNetItems(b));
        },

        /** Kicked when the list is bound: one bulk request, never one per row. */
        startBmNet() {
            void this.loadBmNetIndex({ maxAgeMs: 30000 });
        },

        /**
         * The install's checks in one request, indexed by bookmark. `force`
         * asks again even if the index is fresh (after a save, after the
         * health report is read anew); a load already under way is waited for
         * rather than raced.
         */
        async loadBmNetIndex({ maxAgeMs = 0, force = false } = {}) {
            if (!this.bmNetEnabled()) return;
            if (this._bmNetIndexLoading) {
                await this._bmNetIndexLoading;
                if (!force) return;
            }
            if (!force && maxAgeMs && this._bmNetIndex && Date.now() - this._bmNetIndex.at < maxAgeMs) return;
            this._bmNetIndexLoading = (async () => {
                try {
                    const [listRes, capsRes] = await Promise.all([
                        global.fetch('/api/net/checks', { cache: 'no-store' }),
                        this._bmNetCaps ? null : global.fetch('/api/net/capabilities', { cache: 'no-store' }),
                    ]);
                    if (!listRes.ok) return;
                    if (capsRes?.ok) this._bmNetCaps = await capsRes.json();
                    const body = await listRes.json();
                    const byKey = new Map();
                    (Array.isArray(body.items) ? body.items : []).forEach((item) => {
                        const key = `${item.pageId}\u0000${item.url}`;
                        if (!byKey.has(key)) byKey.set(key, []);
                        byKey.get(key).push(item);
                    });
                    this._bmNetIndex = { byKey, total: (body.items || []).length, at: Date.now() };
                    this._bmNetGen = (this._bmNetGen || 0) + 1;
                    this.invalidateVisibleBookmarks?.();
                    this.repaintBmNetDependents();
                } catch {
                    // The badges stay as they were; the next open asks again.
                }
            })();
            try {
                await this._bmNetIndexLoading;
            } finally {
                this._bmNetIndexLoading = null;
            }
        },

        /**
         * What draws from the index: the rail's counts always, the rows only
         * while a Check type filter decides which rows there are. Otherwise
         * the badges are set on the rows already drawn, so no row is swapped
         * from under a pointer.
         */
        repaintBmNetDependents() {
            if (this.section !== 'bookmarks' || !this.isActiveView?.()) return;
            this.repaintWorkbenchRail?.();
            if (this.bmCheckFilter) this.repaintBookmarksList?.();
            else this.syncWorkbenchRowsNet();
        },

        /** The badges behind a row's name: scheduled checks, three at most, then "+n". */
        workbenchNetBadges(b) {
            if (!this._bmNetIndex || !this.bmNetEnabled()) return '';
            const items = this.bmNetItems(b);
            if (!items.length) return '';
            const M = model();
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (k, f) => this.bmNetT(k, f);
            const { shown, more } = M.badgeSlice(items, 3);
            if (!shown.length) return '';
            const describe = (c) => {
                const state = M.badgeState(c);
                const parts = [`${c.label || M.typeName(c.type)}: ${M.stateLabel(state, t)}`];
                if (c.state?.detail) parts.push(c.state.detail);
                return parts.join(' · ');
            };
            const badges = shown.map((c) => {
                const text = describe(c);
                return `<span class="net-tb" data-state="${M.badgeState(c)}" data-net-badge="${esc(c.checkId)}" role="img" title="${esc(text)}" aria-label="${esc(text)}"><i aria-hidden="true"></i>${esc(M.typeName(c.type))}</span>`;
            }).join('');
            const rest = more.length
                ? `<span class="net-tb net-tb--more" data-state="off" role="img" title="${esc(more.map(describe).join('\n'))}" aria-label="${esc(more.map(describe).join(', '))}">+${more.length}</span>`
                : '';
            return `<span class="config-bm-nets" data-bm-nets>${badges}${rest}</span>`;
        },

        /** Set the badges on the rows already drawn (the index landed or changed). */
        syncWorkbenchRowsNet() {
            const byKey = new Map();
            [...(this.dash.allBookmarks || []), ...(this.dash.unsortedBookmarks || [])].forEach((b) => {
                const key = this.bookmarkKey(b);
                if (!byKey.has(key)) byKey.set(key, b);
            });
            document.querySelectorAll('#config-bm-list .config-bm-row').forEach((row) => {
                const b = byKey.get(this.bookmarkRowKey(row)) || null;
                const name = row.querySelector('.config-bm-name');
                if (!b || !name) return;
                const html = this.workbenchNetBadges(b);
                const current = name.querySelector('[data-bm-nets]');
                if ((current?.outerHTML || '') === html) return;
                if (current) current.remove();
                if (!html) return;
                const anchor = name.querySelector('.config-bm-ctr') || name.querySelector('.config-bm-title');
                anchor?.insertAdjacentHTML('afterend', html);
            });
        },

        bmCheckFilterLabel(key) {
            const t = (k, f) => this.bmNetT(k, f);
            const name = key === 'any' ? t('nettools.railAny', 'Has checks')
                : key === 'down' ? t('nettools.railDown', 'Check down')
                    : model().typeName(key);
            return t('nettools.railToken', 'Check type: {name}').replace('{name}', name);
        },

        /** The rail's group: has checks, one entry per built type, check down. Empty until the install has a check. */
        renderBmNetRailEntries(entry, counts) {
            if (!this._bmNetIndex || !this.bmNetEnabled()) return '';
            if (!this._bmNetIndex.total && !this.bmCheckFilter) return '';
            const t = (k, f) => this.bmNetT(k, f);
            const M = model();
            const types = this._bmNetCaps?.typesBuilt || [];
            const own = (key) => counts.check?.get(key) || 0;
            const on = (key) => this.bmCheckFilter === key;
            return [
                entry('check', 'any', t('nettools.railAny', 'Has checks'), own('any'), on('any')),
                ...types.map((type) => entry('check', type, M.typeName(type), own(type), on(type))),
                entry('check', 'down', t('nettools.railDown', 'Check down'), own('down'), on('down'),
                    '<span class="config-bm-health-dot is-broken" aria-hidden="true"></span>'),
            ].join('');
        },

        /* ── Events ──────────────────────────────────────────────────────── */

        bindBmNetChecks(panel, b) {
            const root = panel?.querySelector('[data-bm-net]');
            if (!root || !b) return;
            const st = this.bmNetState(b);
            if (st.status === 'idle' || st.status === 'error') void this.loadBmNetChecks(b);
            root.addEventListener('click', (event) => {
                const btn = event.target.closest('[data-net-action]');
                if (!btn || !root.contains(btn)) return;
                const action = btn.getAttribute('data-net-action');
                if (action === 'save') return; // the form's submit does it
                event.preventDefault();
                void this.runBmNetAction(b, action, btn);
            });
            root.addEventListener('submit', (event) => {
                event.preventDefault();
                void this.runBmNetAction(b, 'save', null);
            });
            const onField = (event) => {
                const el = event.target.closest('[data-net-field]');
                const ed = this.bmNetState(b).editing;
                if (!el || !ed) return;
                const name = el.getAttribute('data-net-field');
                ed.draft[name] = el.type === 'checkbox' ? el.checked : el.value;
                if (name === 'intervalMinutes' || name === 'timeoutSec') ed.draft[name] = Number(el.value) || 0;
                const wrap = el.closest('[data-net-field-wrap]');
                if (wrap && ed.errors?.[name]) {
                    delete ed.errors[name];
                    wrap.classList.remove('is-error');
                    const status = wrap.querySelector('.config-bm-field-status');
                    if (status) status.textContent = '';
                }
                const explain = root.querySelector('[data-net-explain]');
                if (explain) explain.innerHTML = this.renderBmNetExplain(b);
            };
            root.addEventListener('input', onField);
            root.addEventListener('change', onField);
            root.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape' || !this.bmNetState(b).editing) return;
                event.preventDefault();
                event.stopPropagation();
                this.bmNetState(b).editing = null;
                this.paintBmNet(b);
            });
        },

        async runBmNetAction(b, action, btn) {
            const st = this.bmNetState(b);
            const M = model();
            const id = btn?.getAttribute('data-net-id') || '';
            if (action === 'add') {
                const type = this._bmNetCaps?.typesBuilt?.[0] || 'tcp';
                st.error = '';
                st.editing = { id: '', draft: this.bmNetDraftFrom(M.blankCheck(type)), errors: {}, serverError: '', confirmDelete: false };
                this.paintBmNet(b);
                this.focusBmNetForm(b);
            } else if (action === 'edit') {
                const check = st.checks.find((c) => c.id === id);
                if (!check) return;
                st.error = '';
                st.editing = { id, draft: this.bmNetDraftFrom(check), errors: {}, serverError: '', confirmDelete: false };
                this.paintBmNet(b);
                this.focusBmNetForm(b);
            } else if (action === 'cancel') {
                st.editing = null;
                this.paintBmNet(b);
            } else if (action === 'type') {
                const type = btn.getAttribute('data-net-type');
                const ed = st.editing;
                if (!ed || ed.draft.type === type) return;
                // What the old type asked for does not carry over to the new one.
                const keep = { label: ed.draft.label, host: ed.draft.host, planning: ed.draft.planning, intervalMinutes: ed.draft.intervalMinutes, timeoutSec: ed.draft.timeoutSec, muted: ed.draft.muted };
                ed.draft = { ...this.bmNetDraftFrom(M.blankCheck(type)), ...keep };
                ed.errors = {};
                this.paintBmNet(b);
            } else if (action === 'planning') {
                const ed = st.editing;
                if (!ed) return;
                ed.draft.planning = btn.getAttribute('data-net-planning');
                if (ed.draft.planning === 'own' && !ed.draft.intervalMinutes) ed.draft.intervalMinutes = global.CheckMode?.intervalOf?.(b) || 15;
                this.paintBmNet(b);
            } else if (action === 'save') {
                await this.submitBmNetForm(b);
            } else if (action === 'delete') {
                if (!st.editing) return;
                st.editing.confirmDelete = true;
                this.paintBmNet(b);
            } else if (action === 'delete-confirm') {
                if (!st.editing || st.saving) return;
                const list = st.checks.filter((c) => c.id !== st.editing.id);
                if (await this.saveBmNetChecks(b, list)) st.editing = null;
                this.paintBmNet(b);
            } else if (action === 'mute') {
                if (st.saving) return;
                st.error = '';
                const list = st.checks.map((c) => (c.id === id ? { ...c, muted: c.muted !== true } : c));
                await this.saveBmNetChecks(b, list);
                this.paintBmNet(b);
            } else if (action === 'copy') {
                try {
                    await global.navigator.clipboard.writeText(btn.getAttribute('data-net-snippet') || '');
                    this.notify(this.bmNetT('nettools.copied', 'Copied.'), 'success');
                } catch {
                    this.notify(this.bmNetT('nettools.copyFailed', 'Could not copy.'), 'error');
                }
            } else if (action === 'allow-local') {
                this.behaviorTab = 'general';
                void this.openConfigView?.('behavior');
            }
        },

        async submitBmNetForm(b) {
            const st = this.bmNetState(b);
            const ed = st.editing;
            if (!ed || st.saving) return;
            const t = (k, f) => this.bmNetT(k, f);
            const check = this.bmNetCheckFromDraft(ed.draft, ed.id, b);
            const verdict = model().validate(check, this._bmNetCaps, t);
            // The text boxes hold what was typed: a non-number is caught here.
            ['port', 'count', 'maxLossPct', 'maxMs'].forEach((name) => {
                if (Number.isNaN(check[name])) verdict.errors[name] = t('nettools.errNumber', 'Use a whole number.');
            });
            ed.errors = verdict.errors;
            ed.serverError = '';
            if (!verdict.ok || Object.keys(ed.errors).length) {
                this.paintBmNet(b);
                this.focusBmNetForm(b, '.is-error input, .is-error select');
                return;
            }
            const stored = model().pickForType(check);
            const list = ed.id
                ? st.checks.map((c) => (c.id === ed.id ? { ...c, ...this.bmNetClear(c), ...stored } : c))
                : [...st.checks, stored];
            const saved = await this.saveBmNetChecks(b, list);
            if (saved) st.editing = null;
            this.paintBmNet(b);
        },

        /** Fields a stored check may carry that the form owns: cleared so a removed value really goes. */
        bmNetClear(c) {
            return { label: '', host: '', port: 0, count: 0, maxLossPct: 0, maxMs: 0, intervalMinutes: 0, timeoutSec: 0, muted: false, enabled: c.enabled };
        },

        focusBmNetForm(b, selector = 'input, select, button') {
            const panel = this._libPanel || document.getElementById('config-bm-panel');
            const form = panel?.querySelector('[data-net-form]');
            const target = form?.querySelector(selector) || form;
            target?.focus?.({ preventScroll: false });
            form?.scrollIntoView?.({ block: 'nearest' });
        },
    });

    global.DashboardConfigBookmarksNetReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
