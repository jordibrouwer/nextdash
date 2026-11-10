/**
 * Network checks: the data, the form and the events behind the bookmark
 * panel's Tests tab (the tab itself is drawn by dashboard-config-bookmarks-tests.js).
 *
 * A check is an accordion in that tab; its form (type, what to check,
 * planning) opens in the same accordion style, with what the check will do
 * written under it as the reader types. The Health tab keeps one line that
 * says how many checks there are and opens the Tests tab.
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

        /** The panel's dot and line for the bookmark it shows, after the index changed. */
        syncBmNetPanelOpen() {
            const panel = this._libPanel || document.getElementById('config-bm-panel');
            const b = panel?.dataset.bmPanelKey ? this.findBookmarkByKey(panel.dataset.bmPanelKey) : null;
            if (b) this.syncBmNetPanel(b);
        },

        /** The checks of the bookmark the panel shows: its own list once read, else the install-wide index. */
        bmNetList(b) {
            const st = this._bmNet;
            if (st && st.key === this.bmNetIndexKey(b) && st.status === 'ready') return st.checks;
            return this.bmNetItems(b);
        },

        /** A scheduled check of the bookmark is down: the dot on the Tests tab. */
        bmTestsTroubled(b) {
            if (!this.bmNetEnabled()) return false;
            return this.bmNetList(b).some((c) => model().badgeState(c) === 'down');
        },

        /** The Health tab's one line: how many checks, how many down, and the way to the Tests tab. */
        renderBmNetHealthLine(b) {
            if (!this.bmNetEnabled()) return '';
            const html = this.bmNetHealthLineHtml(b);
            return `<p class="config-bm-panel-muted net-health-line" data-bm-net-line${html ? '' : ' hidden'}>${html}</p>`;
        },

        bmNetHealthLineHtml(b) {
            const list = this.bmNetList(b);
            if (!list.length) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (k, f) => this.bmNetT(k, f);
            const down = list.filter((c) => model().badgeState(c) === 'down').length;
            const text = (list.length === 1 ? t('nettools.healthLineOne', '1 check · {m} down') : t('nettools.healthLine', '{n} checks · {m} down'))
                .replace('{n}', String(list.length)).replace('{m}', String(down));
            return `<span>${esc(text)}</span> <button type="button" class="config-btn config-btn--small" data-net-action="open-tests">${esc(t('nettools.openTests', 'Open Tests'))}</button>`;
        },

        /** What follows the checks outside the Tests pane: the tab's dot and the Health line. */
        syncBmNetPanel(b) {
            const panel = this._libPanel || document.getElementById('config-bm-panel');
            if (!panel || !b) return;
            const shown = panel.dataset.bmPanelKey ? this.findBookmarkByKey(panel.dataset.bmPanelKey) : null;
            if (!shown || shown.pageId !== b.pageId || shown.url !== b.url) return;
            const tab = panel.querySelector('[data-bm-tab-panel="tests"]');
            if (tab) {
                const dot = tab.querySelector('.config-bm-tab-dot');
                const troubled = this.bmTestsTroubled(b);
                if (troubled && !dot) {
                    tab.insertAdjacentHTML('beforeend', `<span class="config-bm-tab-dot" aria-label="${this.dash.escapeHtml(this.t('config.bmTabProblem', 'has a problem'))}"></span>`);
                } else if (!troubled && dot) dot.remove();
            }
            const line = panel.querySelector('[data-bm-net-line]');
            if (line) {
                const html = this.bmNetHealthLineHtml(b);
                line.innerHTML = html;
                line.hidden = !html;
            }
        },

        /** The block under a failed check: what happened and the one thing to do (mockup g1). */
        renderBmNetErrorBlock(b, check) {
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const target = M.targetOf(check, b);
            const block = M.errorBlock({
                class: check.state?.class, host: target.host, port: target.port,
                timeoutSec: check.timeoutSec || 5,
                type: check.type, record: check.record, expect: check.expect, detail: check.state?.detail,
                expectStatus: check.expectStatus, expectHeader: check.expectHeader,
                path: check.path, op: check.op,
            }, t);
            if (!block) return '';
            return this.renderNetBlockHtml(block, { retest: `data-net-action="retest" data-net-id="${this.dash.escapeHtml(check.id)}"` });
        },

        /**
         * A failure block (mockup g1) as HTML, for the cards and for the Tools
         * tab. `retest` is the attributes of the "Test again" button the block
         * offers, or empty where there is nothing to run again.
         */
        renderNetBlockHtml(block, { retest = '' } = {}) {
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (k, f) => this.bmNetT(k, f);
            const buttons = {
                copy: () => `<button type="button" class="config-btn config-btn--small" data-net-action="copy" data-net-snippet="${esc(block.snippet || '')}">${esc(t('nettools.copy', 'Copy'))}</button>`,
                allowLocal: () => `<button type="button" class="config-btn config-btn--small" data-net-action="allow-local">${esc(t('nettools.openAllowLocal', 'Open the "Allow local bookmarks" setting'))}</button>`,
                retest: () => (retest ? `<button type="button" class="config-btn config-btn--small" ${retest}>${esc(t('nettools.testAgain', 'Test again'))}</button>` : ''),
            };
            const actions = block.actions.map((a) => buttons[a]?.() || '').join('');
            return `
                <div class="net-error is-${block.tone}" role="status" data-net-error-class="${esc(block.cls)}">
                    <b class="net-error-title">${esc(block.title)}</b>
                    <p>${esc(block.body)}</p>
                    ${block.snippet ? `<pre class="net-error-code">${esc(block.snippet)}</pre>` : ''}
                    ${block.note ? `<p class="net-error-note">${esc(block.note)}</p>` : ''}
                    ${actions ? `<div class="net-error-actions">${actions}</div>` : ''}
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
                port: text(check.port), minDaysLeft: text(check.minDaysLeft), count: text(check.count), maxLossPct: text(check.maxLossPct), maxMs: text(check.maxMs),
                planning, intervalMinutes: Number(check.intervalMinutes) || 0, timeoutSec: Number(check.timeoutSec) || 0,
                muted: check.muted === true,
                record: check.record || 'A', resolver: check.resolver || '', expect: check.expect || '', watchDrift: check.watchDrift === true,
                endpoint: check.endpoint || '', expectStatus: check.expectStatus || '', expectHeader: check.expectHeader || '',
                path: check.path || '', op: check.op || 'eq', credentialId: check.credentialId || '',
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
                port: num(draft.port), minDaysLeft: num(draft.minDaysLeft), count: num(draft.count), maxLossPct: num(draft.maxLossPct), maxMs: num(draft.maxMs),
                enabled: draft.planning !== 'off', intervalMinutes: interval, timeoutSec: Number(draft.timeoutSec) || 0,
                muted: draft.muted === true,
                record: draft.record || 'A', resolver: model().DNS_RESOLVERS.includes(draft.resolver) ? draft.resolver : '', expect: String(draft.expect || '').trim(), watchDrift: draft.watchDrift === true,
                endpoint: String(draft.endpoint || '').trim(), expectStatus: String(draft.expectStatus || '').trim(), expectHeader: String(draft.expectHeader || '').trim(),
                path: String(draft.path || '').trim(), op: String(draft.op || 'eq'), credentialId: String(draft.credentialId || '').trim(),
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
            const typeOptions = M.toolTypes(caps).map((type) =>
                `<option value="${type}"${d.type === type ? ' selected' : ''}>${esc(M.typeName(type))}</option>`).join('');
            const target = M.targetOf({ type: d.type, host: d.host, port: Number(d.port) || 0 }, b);
            let params = '';
            if (d.type === 'tcp') {
                params = `${field('port', t('nettools.fieldPort', 'Port'), input('port', d.port, 'number', `min="1" max="65535" placeholder="${esc(String(target.port || ''))}"`),
                    t('nettools.fieldPortHint', 'Empty uses the port of the bookmark address.'))}
                    ${field('maxMs', t('nettools.fieldSlow', 'Slow from (ms)'), input('maxMs', d.maxMs, 'number', 'min="0" max="60000" placeholder="-"'))}`;
            } else if (d.type === 'ping') {
                params = `${field('count', t('nettools.fieldPackets', 'Packets'), input('count', d.count, 'number', 'min="1" max="10" placeholder="4"'))}
                    ${field('maxLossPct', t('nettools.fieldLoss', 'Down from loss (%)'), input('maxLossPct', d.maxLossPct, 'number', 'min="1" max="100" placeholder="50"'))}
                    ${field('maxMs', t('nettools.fieldSlow', 'Slow from (ms)'), input('maxMs', d.maxMs, 'number', 'min="0" max="60000" placeholder="-"'))}`;
            }
            if (d.type === 'tls') {
                params = `${field('port', t('nettools.fieldPort', 'Port'), input('port', d.port, 'number', `min="1" max="65535" placeholder="${esc(String(target.port || ''))}"`),
                    t('nettools.fieldTlsPortHint', 'Empty uses 443, or the port of an https bookmark address.'))}
                    ${field('minDaysLeft', t('nettools.fieldMinDays', 'Warn at or below (days)'), input('minDaysLeft', d.minDaysLeft, 'number', `min="1" max="120" placeholder="${esc(String(M.TLS_DEFAULT_MIN_DAYS))}"`),
                        t('nettools.fieldMinDaysHint', 'A valid certificate with fewer days left shows a warning and sends one expiry notice.'))}`;
            }
            if (d.type === 'http') {
                params = `${field('endpoint', t('nettools.fieldPath', 'Path'), input('endpoint', d.endpoint, 'text', `spellcheck="false" maxlength="200" placeholder="${esc(t('nettools.fieldPathPlaceholder', "The bookmark's own address"))}"`),
                    t('nettools.fieldPathHint', 'A path on the same host, such as /health. Empty requests the bookmark address.'))}
                    ${field('expectStatus', t('nettools.fieldExpectStatus', 'Expected status'), input('expectStatus', d.expectStatus, 'text', `spellcheck="false" maxlength="60" placeholder="${esc(M.HTTP_DEFAULT_STATUS)}"`),
                        t('nettools.fieldExpectStatusHint', 'Judged after the redirects. A list works: 200,301.'))}
                    ${field('expectHeader', t('nettools.fieldExpectHeader', 'Expected header'), input('expectHeader', d.expectHeader, 'text', `spellcheck="false" maxlength="200" placeholder="${esc(t('nettools.fieldExpectHeaderPlaceholder', 'Optional, like server: nginx'))}"`),
                        t('nettools.fieldExpectHeaderHint', 'The answer must have this header, and contain the text after the colon when there is one.'))}
                    ${field('maxMs', t('nettools.fieldSlowFirstByte', 'Slow from (ms to first byte)'), input('maxMs', d.maxMs, 'number', 'min="0" max="60000" placeholder="-"'))}`;
            }
            if (d.type === 'json') {
                const opLabels = { eq: t('nettools.opEqOption', 'is equal to'), ne: t('nettools.opNeOption', 'is not equal to'), gt: t('nettools.opGtOption', 'is more than'), lt: t('nettools.opLtOption', 'is less than'), contains: t('nettools.opContainsOption', 'contains'), exists: t('nettools.opExistsOption', 'exists') };
                const opOptions = M.JSON_OPS.map((op) => `<option value="${op}"${d.op === op ? ' selected' : ''}>${esc(opLabels[op])}</option>`).join('');
                const creds = this._bmNetCreds || null;
                const credOptions = [['', b.credentialId ? t('nettools.credBookmark', "The bookmark's own credential") : t('nettools.credNone', 'None')]]
                    .concat(Object.entries(creds || {}).sort((x, y) => String(x[1]).localeCompare(String(y[1]))))
                    .map(([id, label]) => `<option value="${esc(id)}"${d.credentialId === id ? ' selected' : ''}>${esc(label)}</option>`).join('');
                params = `${field('endpoint', t('nettools.fieldPath', 'Path'), input('endpoint', d.endpoint, 'text', `spellcheck="false" maxlength="200" placeholder="${esc(t('nettools.fieldPathPlaceholder', "The bookmark's own address"))}"`),
                    t('nettools.fieldJsonUrlHint', 'A path on the same host that answers with JSON, such as /api/health. Empty requests the bookmark address.'))}
                    ${field('path', t('nettools.fieldJsonPath', 'Value to look at'), input('path', d.path, 'text', `spellcheck="false" maxlength="200" placeholder="${esc(t('nettools.fieldJsonPathPlaceholder', 'db.state'))}"`),
                        t('nettools.fieldJsonPathHint', 'Dots for objects, [0] for a list position, [name=api] to pick an entry, a trailing # to count. A path that names a token, key, secret or password never shows its value.'))}
                    ${field('op', t('nettools.fieldJsonOp', 'Up when it'), `<select class="config-select" data-net-field="op">${opOptions}</select>`)}
                    ${d.op === 'exists' ? '' : field('expect', t('nettools.fieldJsonExpect', 'Expected value'), input('expect', d.expect, 'text', `spellcheck="false" maxlength="200" placeholder="${esc(t('nettools.fieldJsonExpectPlaceholder', 'ok'))}"`))}
                    ${field('credentialId', t('nettools.fieldCredential', 'Credential'), `<select class="config-select" data-net-field="credentialId">${credOptions}</select>`,
                        t('nettools.fieldCredentialHint', "Sent only to this bookmark's own host. Credentials are made in the bookmark's Health settings."))}`;
                if (!creds) void this.loadBmNetCredentials(b);
            }
            if (d.type === 'dns') {
                const recordOptions = M.DNS_RECORDS.map((r) => `<option value="${r}"${d.record === r ? ' selected' : ''}>${esc(r)}</option>`).join('');
                const watchOptions = [['on', t('nettools.driftOn', 'Tell me in the bell')], ['off', t('nettools.driftOff', 'Do not watch')]]
                    .map(([v, text]) => `<option value="${v}"${(d.watchDrift ? 'on' : 'off') === v ? ' selected' : ''}>${esc(text)}</option>`).join('');
                const resolverOptions = M.DNS_RESOLVERS.map((r) => `<option value="${r}"${(d.resolver || '') === r ? ' selected' : ''}>${esc(r || t('nettools.resolverOptSystem', 'System'))}</option>`).join('');
                params = `${field('record', t('nettools.fieldRecord', 'Record'), `<select class="config-select" data-net-field="record">${recordOptions}</select>`)}
                    ${field('resolver', t('nettools.fieldResolver', 'Resolver'), `<select class="config-select" data-net-field="resolver">${resolverOptions}</select>`,
                        M.resolverHint(d.resolver || '', t))}
                    ${field('expect', t('nettools.fieldExpect', 'Expected value'), input('expect', d.expect, 'text', `spellcheck="false" maxlength="255" placeholder="${esc(t('nettools.fieldExpectPlaceholder', 'Optional'))}"`),
                        t('nettools.fieldExpectHint', 'Down when none of the records is this value. A TXT record may contain it.'))}
                    ${field('watchDrift', t('nettools.fieldDrift', 'When the records change'), `<select class="config-select" data-net-field="watchDrift">${watchOptions}</select>`,
                        d.record === 'A' || d.record === 'AAAA' ? t('nettools.fieldDriftHintA', 'Off to begin with: A and AAAA often rotate behind a CDN.') : '')}`;
            }
            const custom = caps.allowCustomHost
                ? field('host', t('nettools.fieldHost', 'Host'), input('host', d.host, 'text', `spellcheck="false" placeholder="${esc(M.hostOf(b))}"`),
                    t('nettools.fieldHostHint', 'Empty checks the host of the bookmark address.'))
                : '';
            const label = field('label', t('nettools.fieldLabel', 'Name'), input('label', d.label, 'text', `maxlength="60" placeholder="${esc(M.labelFor({ type: d.type, port: Number(d.port) || 0, host: d.host }, b))}"`));
            // Planning is one choice: the bookmark's own schedule, an interval of its own, or none.
            const bookmarkMinutes = global.CheckMode?.intervalOf?.(b) || 15;
            const own = Number(d.intervalMinutes) || bookmarkMinutes;
            const every = (m) => t('nettools.every', 'Every {interval}').replace('{interval}', M.intervalWords(m, t));
            const intervals = [...new Set([...(global.CheckMode?.INTERVAL_CHOICES || [5, 15, 30, 60, 360, 1440]), own])].sort((x, y) => x - y);
            const planValue = d.planning === 'own' ? `own:${own}` : d.planning;
            const planOptions = [
                ['bookmark', `${t('nettools.planBookmark', 'Like the bookmark')} (${M.intervalWords(bookmarkMinutes, t)})`],
                ...intervals.map((m) => [`own:${m}`, every(m)]),
                ['off', t('nettools.planOff', 'Off')],
            ].map(([v, text]) => `<option value="${v}"${v === planValue ? ' selected' : ''}>${esc(text)}</option>`).join('');
            const timeoutOptions = [[0, t('nettools.timeoutDefault', 'Default')], [5, '5 s'], [10, '10 s']]
                .map(([v, text]) => `<option value="${v}"${Number(d.timeoutSec) === v ? ' selected' : ''}>${esc(text)}</option>`).join('');
            const alertOptions = [['on', t('nettools.alertsOn', 'Alerts on')], ['muted', t('nettools.alertsMuted', 'Muted')]]
                .map(([v, text]) => `<option value="${v}"${(d.muted ? 'muted' : 'on') === v ? ' selected' : ''}>${esc(text)}</option>`).join('');
            const exp = this.renderBmNetExplain(b);
            const deleting = ed.id
                ? (ed.confirmDelete
                    ? `<button type="button" class="config-btn config-btn--small config-btn--danger" data-net-action="delete-confirm">${esc(t('nettools.deleteConfirm', 'Delete it for good'))}</button>`
                    : `<button type="button" class="config-btn config-btn--small config-btn--danger" data-net-action="delete">${esc(t('nettools.delete', 'Delete check'))}</button>`)
                : '';
            return `
                <form class="net-form" data-net-form novalidate aria-label="${esc(ed.id ? t('nettools.formEdit', 'Change check') : t('nettools.formAdd', 'Add check'))}">
                    <div class="config-bm-panel-fields">
                        ${field('type', t('nettools.fieldType', 'Type'), `<select class="config-select" data-net-field="type">${typeOptions}</select>`)}
                        ${params}${custom}${label}
                        ${field('planning', t('nettools.fieldPlanning', 'Planning'), `<select class="config-select" data-net-field="planning">${planOptions}</select>`)}
                        ${field('timeoutSec', t('nettools.fieldTimeout', 'Time-out'), `<select class="config-select" data-net-field="timeoutSec">${timeoutOptions}</select>`)}
                        ${field('muted', t('nettools.fieldAlerts', 'Alerts'), `<select class="config-select" data-net-field="muted">${alertOptions}</select>`)}
                        <div class="net-explain" data-net-explain aria-live="polite">${exp}</div>
                        <div class="net-test" data-net-test>${this.renderBmNetFormTest(b)}</div>
                        ${ed.serverError ? `<p class="net-inline-error" role="status" data-net-error>${esc(ed.serverError)}</p>` : ''}
                    </div>
                    <div class="net-card-actions net-form-foot">
                        <button type="submit" class="config-btn config-btn--primary config-btn--small" data-net-action="save"${st.saving ? ' disabled' : ''}>${esc(t('nettools.save', 'Save'))}</button>
                        <button type="button" class="config-btn config-btn--small" data-net-action="cancel">${esc(t('nettools.cancel', 'Cancel'))}</button>
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
                <p class="config-bm-panel-muted net-explain-summary">${esc(ex.summary)}</p>
                <ul class="net-explain-list">${ex.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
                ${warn}`;
        },

        /**
         * "Test first", inside the form. A test never names a host or a port:
         * it runs the saved check, or the type against the bookmark's own
         * address. So it is offered only where that is what the form stands for;
         * a form with a target of its own says to save first.
         */
        renderBmNetFormTest(b) {
            const esc = (v) => this.dash.escapeHtml(v);
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const st = this.bmNetState(b);
            const ed = st.editing;
            const caps = this._bmNetCaps || {};
            if (!ed || !(caps.typesBuilt || []).includes(ed.draft.type)) return '';
            const stored = ed.id ? st.checks.find((c) => c.id === ed.id) : null;
            const draftHost = String(ed.draft.host || '').trim();
            const draftPort = Number(ed.draft.port) || 0;
            const canTest = stored
                ? draftHost === String(stored.host || '') && draftPort === (Number(stored.port) || 0)
                : !draftHost && !String(ed.draft.port || '').trim();
            if (!canTest) {
                return `<p class="config-bm-panel-muted" data-net-test-hint>${esc(t('nettools.testSaveFirst', 'Save first to test this host or port.'))}</p>`;
            }
            const test = ed.test || null;
            const running = test?.status === 'running';
            let result = '';
            if (running) {
                result = `<span class="config-bm-panel-muted" role="status">${esc(t('nettools.testing', 'Testing...'))}</span>`;
            } else if (test?.status === 'error') {
                result = `<p class="net-inline-error" role="status">${esc(test.error)}</p>`;
            } else if (test?.status === 'done') {
                const state = M.testState(test.res);
                const body = test.res.ok
                    ? `<span class="net-badge" data-state="${state}">${esc(M.stateLabel(state, t))}</span> <span data-net-test-summary>${esc(M.testSummary(test.res, t))}</span>`
                    : this.renderNetBlockHtml(M.testErrorBlock(test.res, t));
                result = `<div data-net-test-result>${body}</div>`;
            }
            return `
                <div class="net-test-row">
                    <button type="button" class="config-btn config-btn--small" data-net-action="form-test"${running ? ' disabled' : ''}>${esc(t('nettools.testFirst', 'Test first'))}</button>
                    <span class="config-bm-panel-muted">${esc(ed.draft.type === 'json'
                        ? t('nettools.testJsonHint', 'Tests what the form says, once. Nothing is saved.')
                        : (stored ? t('nettools.testSavedHint', 'Tests the saved check.') : t('nettools.testOneOffHint', 'Tests the bookmark address once. Nothing is saved.')))}</span>
                </div>
                ${result}`;
        },

        paintBmNetTest(b) {
            const panel = this._libPanel || document.getElementById('config-bm-panel');
            const root = panel?.querySelector('[data-net-test]');
            if (root && this._bmNet?.key === `${b?.pageId}\u0000${b?.url}`) root.innerHTML = this.renderBmNetFormTest(b);
        },

        /**
         * Run one test now: a stored check by its ID, or a type against the
         * bookmark's own address. Resolves to { ok, res } or { ok: false,
         * error } with a sentence for the reader; it never throws.
         */
        async runBmNetTest(b, { type = '', checkId = '', record = '', resolver = '', json = null } = {}) {
            const body = { pageId: b.pageId, url: b.url };
            if (checkId) body.checkId = checkId;
            else {
                body.type = type;
                if (type === 'dns') {
                    body.record = record || 'A';
                    if (resolver) body.resolver = resolver;
                }
                // A JSON test says what to look at; it still names no host or port.
                if (type === 'json' && json) {
                    body.path = json.path;
                    body.op = json.op;
                    if (json.expect) body.expect = json.expect;
                    if (json.endpoint) body.endpoint = json.endpoint;
                    if (json.credentialId) body.credentialId = json.credentialId;
                }
            }
            const t = (k, f) => this.bmNetT(k, f);
            try {
                const res = await global.nextDashFetch('/api/net/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if (res.ok) return { ok: true, res: await res.json() };
                const raw = (await res.text().catch(() => '')).trim();
                let said = raw;
                try {
                    said = JSON.parse(raw).error || raw;
                } catch {
                    // Plain text from a gate in front of the handler.
                }
                if (res.status === 429) return { ok: false, error: t('nettools.testTooMany', 'Too many tests. Wait a minute and try again.') };
                if (res.status === 409) return { ok: false, error: t('nettools.testBusy', 'A test of this host is already running.') };
                return { ok: false, error: said || t('nettools.testFailed', 'The test could not be run.') };
            } catch {
                return { ok: false, error: t('nettools.testFailed', 'The test could not be run.') };
            }
        },

        /** Read the bookmark's checks again; the section is redrawn unless a form is open. */
        async refreshBmNetChecks(b) {
            const st = this.bmNetState(b);
            try {
                const res = await global.fetch(`/api/net/checks?pageId=${encodeURIComponent(b.pageId)}&url=${encodeURIComponent(b.url)}`, { cache: 'no-store' });
                if (!res.ok) return;
                const body = await res.json();
                if (this._bmNet !== st) return;
                st.checks = Array.isArray(body.checks) ? body.checks : [];
                st.status = 'ready';
                if (!st.editing) this.paintBmNet(b);
            } catch {
                // The next open reads them again.
            }
            void this.loadBmNetIndex({ force: true });
        },

        /**
         * Open the form on a new check that starts from a one-off test: the
         * Tests tab's "Save as scheduled check". Resolves to false, with the
         * reason told, when the bookmark cannot take another check.
         */
        async startBmNetFromTest(b, result) {
            const st = this.bmNetState(b);
            if (st.status !== 'ready') {
                st.status = 'idle';
                await this.loadBmNetChecks(b);
            }
            if (st.status !== 'ready') return false;
            if (st.checks.length >= model().MAX_CHECKS_PER_BOOKMARK) {
                this.notify(this.bmNetT('nettools.maxChecks', 'This bookmark has the most checks it can hold.'), 'error');
                return false;
            }
            st.error = '';
            st.editing = { id: '', draft: this.bmNetDraftFrom(model().checkFromTest(result, b)), errors: {}, serverError: '', confirmDelete: false, test: null };
            return true;
        },

        /* ── Loading and saving ──────────────────────────────────────────── */

        /** Swap the Tests tab's body in place; the rest of the panel is left alone. */
        paintBmNet(b) {
            const panel = this._libPanel || document.getElementById('config-bm-panel');
            const root = panel?.querySelector('[data-bm-tests]');
            if (!root) return;
            if (this._bmNet?.key !== this.bmNetIndexKey(b)) return;
            // A repaint under a focused button or field must not lose the focus.
            const active = document.activeElement;
            let kept = '';
            if (active && root.contains(active)) {
                const attr = (n) => active.getAttribute(n);
                const part = (n) => (attr(n) ? `[${n}="${attr(n)}"]` : '');
                const own = ['data-net-action', 'data-net-field'].find((n) => attr(n));
                if (own) kept = `[${own}="${attr(own)}"]${part('data-net-id')}${part('data-net-type')}`;
            }
            root.innerHTML = this.renderBmTestsBody(b);
            if (kept) root.querySelector(`${kept}:not([disabled])`)?.focus?.({ preventScroll: true });
            this.syncBmNetPanel(b);
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

        /**
         * The names of the stored credentials, for a JSON check's picker: ids
         * and labels only, never a value. Read once; the form is drawn again
         * when they arrive.
         */
        async loadBmNetCredentials(b) {
            if (this._bmNetCredsLoading) return;
            const shared = this.dash.healthCredentials;
            if (shared && Object.keys(shared).length) {
                this._bmNetCreds = shared;
                return;
            }
            this._bmNetCredsLoading = true;
            try {
                const res = await global.fetch('/api/health/credentials', { cache: 'no-store' });
                const body = res.ok ? await res.json() : null;
                this._bmNetCreds = body?.credentials && typeof body.credentials === 'object' ? body.credentials : {};
            } catch {
                this._bmNetCreds = {};
            }
            this._bmNetCredsLoading = false;
            if (this.bmNetState(b).editing?.draft?.type === 'json') this.paintBmNet(b);
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
            this.bindBmNetClicks();
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
                    this.dash.netBadges?.adopt(body.items);
                    this._bmNetGen = (this._bmNetGen || 0) + 1;
                    document.getElementById('config-bm-workbench')?.classList.toggle('has-net-checks', this.bmNetHasScheduled());
                    this.invalidateVisibleBookmarks?.();
                    this.repaintBmNetDependents();
                    this.syncBmNetPanelOpen?.();
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

        /** Whether any bookmark has a scheduled check: the tags column then takes a little more room. */
        bmNetHasScheduled() {
            if (!this._bmNetIndex || !this.bmNetEnabled()) return false;
            for (const items of this._bmNetIndex.byKey.values()) {
                if (items.some((c) => c && c.enabled === true)) return true;
            }
            return false;
        },

        /** What a check says in words: "TLS 12 days: Warning · 9 days left". */
        bmNetDescribe(c) {
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const parts = [`${c.label || M.typeName(c.type)}: ${M.stateLabel(M.badgeState(c), t)}`];
            if (c.state?.detail) parts.push(c.state.detail);
            return parts.join(' · ');
        },

        /**
         * A row's scheduled checks as the chips of its tag cluster: problems
         * first (down, then warning, then slow), the rest in the checks' own
         * order. Two checks of one type would read the same ("TLS", "TLS"),
         * so those show their own label ("TLS 12 days"); a label shared as
         * well is numbered.
         */
        workbenchNetParts(b) {
            if (!this._bmNetIndex || !this.bmNetEnabled()) return null;
            const items = this.bmNetItems(b).filter((c) => c && c.enabled === true);
            if (!items.length) return null;
            const M = model();
            const esc = (v) => this.dash.escapeHtml(v);
            const sev = { down: 4, warn: 3, slow: 2, unknown: 1, ok: 0 };
            const sorted = items
                .map((c, i) => ({ c, i, state: M.badgeState(c) }))
                .sort((x, y) => ((sev[y.state] ?? 0) - (sev[x.state] ?? 0)) || (x.i - y.i));
            const typeCount = new Map();
            sorted.forEach(({ c }) => typeCount.set(c.type, (typeCount.get(c.type) || 0) + 1));
            const seen = new Map();
            const texts = sorted.map(({ c }) => {
                const text = typeCount.get(c.type) > 1 ? (c.label || M.typeName(c.type)) : M.typeName(c.type);
                const n = (seen.get(text) || 0) + 1;
                seen.set(text, n);
                return n > 1 ? `${text} ${n}` : text;
            });
            const chips = sorted.map(({ c, state }, i) => {
                const text = this.bmNetDescribe(c);
                return `<button type="button" class="config-bm-tag config-bm-tag--net" data-net-chip="${esc(c.checkId)}" data-state="${state}" tabindex="-1"`
                    + ` aria-label="${esc(text)}" title="${esc(text)}"><i aria-hidden="true"></i><span>${esc(texts[i])}</span></button>`;
            }).join('');
            const sig = sorted.map(({ c, state }) => `${c.checkId}:${state}:${c.state?.detail || ''}`).join(',');
            // A failing check is not shared a cell with a suggestion: the problem comes first.
            const problem = sorted.some(({ state }) => state === 'down' || state === 'warn' || state === 'slow');
            return { chips, sig, problem };
        },

        /** The "+n" chip of a cluster that holds checks: a button, since it opens everything it stands for. */
        workbenchNetMoreHtml() {
            return '<button type="button" class="config-bm-tag config-bm-tag--more" tabindex="-1" aria-haspopup="dialog" aria-expanded="false" hidden></button>';
        },

        /**
         * The checks beside the name, for a row whose tags column does not
         * carry them (column off, a Health reason in its place, a narrow
         * window). `narrow` marks the copy a row keeps next to its tags column:
         * shown only where that column is gone.
         */
        workbenchNetName(parts, narrow) {
            if (!parts) return '';
            return `<span class="config-bm-nets${narrow ? ' config-bm-nets--narrow' : ''}" data-bm-nets>${parts.chips}${this.workbenchNetMoreHtml()}</span>`;
        },

        /** Set the chips on the rows already drawn (the index landed or changed). */
        syncWorkbenchRowsNet() {
            const byKey = new Map();
            [...(this.dash.allBookmarks || []), ...(this.dash.unsortedBookmarks || [])].forEach((b) => {
                const key = this.bookmarkKey(b);
                if (!byKey.has(key)) byKey.set(key, b);
            });
            const list = document.getElementById('config-bm-list');
            if (!list) return;
            list.querySelectorAll('.config-bm-row').forEach((row) => {
                const b = byKey.get(this.bookmarkRowKey(row)) || null;
                const name = row.querySelector('.config-bm-name');
                if (!b || !name) return;
                const parts = this.workbenchNetParts(b);
                const sig = parts ? parts.sig : '';
                if ((row.getAttribute('data-bm-net-sig') || '') === sig) return;
                if (sig) row.setAttribute('data-bm-net-sig', sig);
                else row.removeAttribute('data-bm-net-sig');
                const cell = row.querySelector('.config-bm-tags');
                const merged = Boolean(cell) && !cell.querySelector('.config-bm-reason');
                name.querySelector('[data-bm-nets]')?.remove();
                if (cell) {
                    cell.querySelectorAll('.config-bm-tag--net').forEach((el) => el.remove());
                    if (merged && parts) {
                        cell.insertAdjacentHTML('afterbegin', parts.chips);
                        // The tags' own "+n" is a span; with checks in the cell it is a button.
                        const oldMore = cell.querySelector('.config-bm-tag--more');
                        if (oldMore && oldMore.tagName !== 'BUTTON') oldMore.remove();
                        if (!cell.querySelector('.config-bm-tag--more')) {
                            const offer = cell.querySelector('.tag-offer');
                            const more = this.workbenchNetMoreHtml();
                            if (offer) offer.insertAdjacentHTML('beforebegin', more);
                            else cell.insertAdjacentHTML('beforeend', more);
                        }
                    }
                }
                if (parts) {
                    const anchor = name.querySelector('.config-bm-ctr') || name.querySelector('.config-bm-title');
                    anchor?.insertAdjacentHTML('afterend', this.workbenchNetName(parts, merged));
                }
            });
            // The suggestions come and go with a problem on the row; this also fits the clusters again.
            if (this.refreshWorkbenchOfferChips) this.refreshWorkbenchOfferChips();
            else this.fitWorkbenchTags?.(list);
        },

        /**
         * Once the tag cluster is fitted: a "+n" that stands for checks says so
         * (label and tooltip list every hidden chip, checks and tags), and is
         * ours to open rather than the tags-only list of TagOfferRow.
         */
        syncBmNetMore(root) {
            (root || document).querySelectorAll('.config-bm-tags, .config-bm-nets').forEach((cell) => {
                const more = cell.querySelector('.config-bm-tag--more');
                if (!more || !cell.querySelector('.config-bm-tag--net')) return;
                more.classList.remove('tag-offer-own-more');
                delete more.dataset.tags;
                const hidden = [...cell.querySelectorAll('.config-bm-tag:not(.config-bm-tag--more):not(.config-bm-tag--offer)')]
                    .filter((chip) => chip.hidden);
                if (!hidden.length) {
                    more.removeAttribute('data-net-more');
                    more.removeAttribute('data-state');
                    more.removeAttribute('aria-label');
                    return;
                }
                const lines = hidden.map((chip) => chip.getAttribute('aria-label') || chip.textContent);
                // A problem among them tints the "+n": it is never hidden without a sign.
                const rank = { down: 3, warn: 2, slow: 1 };
                const worst = hidden.map((chip) => chip.getAttribute('data-state'))
                    .filter((state) => rank[state]).sort((a, b) => rank[b] - rank[a])[0];
                if (worst) more.setAttribute('data-state', worst);
                else more.removeAttribute('data-state');
                more.setAttribute('data-net-more', '');
                more.setAttribute('aria-label', lines.join(', '));
                more.title = lines.join('\n');
            });
        },

        /**
         * A click on a check chip opens that bookmark's Tests tab; a click on
         * "+n" opens everything hidden. Both are caught ahead of the row, so
         * neither selects the row nor opens its panel by itself.
         */
        bindBmNetClicks() {
            if (this._bmNetClicksBound) return;
            this._bmNetClicksBound = true;
            const bookmarkOf = (el) => {
                const row = el.closest('#config-bm-list .config-bm-row');
                return row ? this.findBookmarkByKey(row.getAttribute('data-bm-key')) : null;
            };
            const hit = (event) => event.target?.closest?.('#config-bm-list .config-bm-tag--net, #config-bm-list .config-bm-tag--more[data-net-more]');
            const onPress = (event) => {
                const el = hit(event);
                if (!el) return;
                event.preventDefault();
                event.stopPropagation();
                if (event.type !== 'click') return;
                if (el.matches('.config-bm-tag--more')) {
                    this.toggleBmNetMore(el);
                    return;
                }
                const b = bookmarkOf(el);
                if (b) void this.openLibraryOnBookmark?.(b.pageId, b.url, { tab: 'tests', focusRow: true });
            };
            document.addEventListener('click', onPress, true);
            document.addEventListener('auxclick', onPress, true);
            document.addEventListener('dblclick', (event) => {
                if (!hit(event)) return;
                event.preventDefault();
                event.stopPropagation();
            }, true);
            // A chip that holds focus (after a click) answers Enter and Space
            // itself; the list's own keys (j/k, Enter on the row) must not follow.
            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const el = hit(event);
                if (!el) return;
                event.preventDefault();
                event.stopPropagation();
                el.click();
            }, true);
        },

        closeBmNetMore() {
            this._bmNetPopClose?.();
        },

        /** Everything the "+n" stands for, in one popover; a check in it opens the Tests tab. */
        toggleBmNetMore(anchor) {
            if (this._bmNetPop && anchor.getAttribute('aria-expanded') === 'true') {
                this.closeBmNetMore();
                return;
            }
            this.closeBmNetMore();
            const cell = anchor.closest('.config-bm-tags, .config-bm-nets');
            const row = anchor.closest('.config-bm-row');
            const b = row ? this.findBookmarkByKey(row.getAttribute('data-bm-key')) : null;
            if (!cell || !b) return;
            const hidden = [...cell.querySelectorAll('.config-bm-tag:not(.config-bm-tag--more):not(.config-bm-tag--offer)')]
                .filter((chip) => chip.hidden);
            if (!hidden.length) return;
            const pop = document.createElement('div');
            pop.className = 'net-list-pop';
            pop.setAttribute('role', 'dialog');
            pop.setAttribute('aria-label', this.bmNetT('nettools.dashMore', 'More on this bookmark'));
            pop.tabIndex = -1;
            hidden.forEach((chip) => {
                const copy = chip.cloneNode(true);
                copy.hidden = false;
                copy.removeAttribute('tabindex');
                if (copy.matches('.config-bm-tag--net')) {
                    copy.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.closeBmNetMore();
                        void this.openLibraryOnBookmark?.(b.pageId, b.url, { tab: 'tests', focusRow: true });
                    });
                }
                pop.appendChild(copy);
            });
            document.body.appendChild(pop);
            const a = anchor.getBoundingClientRect();
            const box = pop.getBoundingClientRect();
            let top = a.bottom + 6;
            if (top + box.height > window.innerHeight - 4) top = Math.max(4, a.top - box.height - 6);
            pop.style.top = `${Math.round(top)}px`;
            pop.style.left = `${Math.round(Math.max(4, Math.min(a.left, window.innerWidth - box.width - 4)))}px`;
            anchor.setAttribute('aria-expanded', 'true');
            this._bmNetPop = pop;
            const onDown = (e) => {
                if (!pop.contains(e.target) && e.target !== anchor) this.closeBmNetMore();
            };
            const onKey = (e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.stopImmediatePropagation();
                this.closeBmNetMore();
                anchor.focus?.({ preventScroll: true });
            };
            const at = a.top;
            const onScroll = (e) => {
                if (pop.contains(e.target)) return;
                if (!anchor.isConnected || Math.abs(anchor.getBoundingClientRect().top - at) > 2) this.closeBmNetMore();
            };
            document.addEventListener('pointerdown', onDown, true);
            // On window: the list's and the page's own Escape handling listen on document and would take the key first.
            window.addEventListener('keydown', onKey, true);
            window.addEventListener('scroll', onScroll, true);
            window.addEventListener('resize', onScroll);
            this._bmNetPopClose = () => {
                document.removeEventListener('pointerdown', onDown, true);
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('scroll', onScroll, true);
                window.removeEventListener('resize', onScroll);
                anchor.setAttribute('aria-expanded', 'false');
                pop.remove();
                this._bmNetPop = null;
                this._bmNetPopClose = null;
            };
            (pop.querySelector('button') || pop).focus({ preventScroll: true });
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

        /** The Health tab's line: one button to the Tests tab. */
        bindBmNetLine(panel) {
            panel?.querySelector('[data-bm-net-line]')?.addEventListener('click', (event) => {
                if (event.target.closest('[data-net-action="open-tests"]')) this.setWorkbenchPanelTab?.('tests');
            });
        },

        bindBmNetChecks(panel, b) {
            const root = panel?.querySelector('[data-bm-tests]');
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
                if (name === 'type') {
                    // A change of type redraws the fields it asks for.
                    if (event.type === 'change') this.switchBmNetType(b, el.value);
                    return;
                }
                if (name === 'planning') {
                    const [mode, minutes] = el.value.split(':');
                    ed.draft.planning = mode;
                    ed.draft.intervalMinutes = mode === 'own' ? Number(minutes) || 0 : 0;
                } else if (name === 'muted') {
                    ed.draft.muted = el.value === 'muted';
                } else if (name === 'watchDrift') {
                    ed.draft.watchDrift = el.value === 'on';
                } else if (name === 'resolver') {
                    ed.draft.resolver = el.value;
                    // The explanation under the select follows the choice.
                    if (event.type === 'change') this.paintBmNet(b);
                } else if (name === 'record') {
                    ed.draft.record = el.value;
                    // Watching starts on or off as the record type suggests; the
                    // choice can be changed after.
                    ed.draft.watchDrift = model().driftDefault(el.value);
                    if (event.type === 'change') this.paintBmNet(b);
                } else if (name === 'timeoutSec') {
                    ed.draft.timeoutSec = Number(el.value) || 0;
                } else if (name === 'op') {
                    ed.draft.op = el.value;
                    // "exists" has no value to compare with: the field goes.
                    if (event.type === 'change') this.paintBmNet(b);
                } else {
                    ed.draft[name] = el.value;
                }
                const wrap = el.closest('[data-net-field-wrap]');
                if (wrap && ed.errors?.[name]) {
                    delete ed.errors[name];
                    wrap.classList.remove('is-error');
                    const status = wrap.querySelector('.config-bm-field-status');
                    if (status) status.textContent = '';
                }
                const explain = root.querySelector('[data-net-explain]');
                if (explain) explain.innerHTML = this.renderBmNetExplain(b);
                if (name === 'host' || name === 'port') this.paintBmNetTest(b);
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
                const type = M.toolTypes(this._bmNetCaps)[0] || 'tcp';
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
            } else if (action === 'open-tests') {
                this.setWorkbenchPanelTab?.('tests');
            } else if (action === 'run') {
                await this.runBmTestsOnce(b, btn.getAttribute('data-net-type') || '');
            } else if (action === 'save-as-check') {
                await this.saveBmTestAsCheck(b);
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
            } else if (action === 'retest') {
                if (st.testingId || !id) return;
                st.testingId = id;
                if (btn) btn.disabled = true;
                const out = await this.runBmNetTest(b, { checkId: id });
                st.testingId = '';
                st.error = '';
                // What the test found is shown under the check, whether or not it is scheduled.
                st.lastTest = { ...(st.lastTest || {}), [id]: out };
                await this.refreshBmNetChecks(b);
                this.paintBmNet(b);
            } else if (action === 'form-test') {
                const ed = st.editing;
                if (!ed || ed.test?.status === 'running') return;
                const stored = ed.id ? st.checks.find((c) => c.id === ed.id) : null;
                // A JSON test runs what the form says, saved or not: the path and
                // the value are exactly what is being tried out.
                const asDraft = ed.draft.type === 'json';
                const draftCheck = asDraft ? this.bmNetCheckFromDraft(ed.draft, ed.id, b) : null;
                if (asDraft) {
                    const verdict = model().validate(draftCheck, this._bmNetCaps, (k, f) => this.bmNetT(k, f));
                    const first = Object.values(verdict.errors)[0];
                    if (first) {
                        ed.errors = verdict.errors;
                        ed.test = { status: 'error', error: first };
                        this.paintBmNet(b);
                        return;
                    }
                }
                ed.test = { status: 'running' };
                this.paintBmNetTest(b);
                let request = stored ? { checkId: ed.id } : { type: ed.draft.type, record: ed.draft.record, resolver: ed.draft.resolver };
                if (asDraft) request = { type: 'json', json: draftCheck };
                const out = await this.runBmNetTest(b, request);
                if (st.editing !== ed) return;
                ed.test = out.ok ? { status: 'done', res: out.res } : { status: 'error', error: out.error };
                this.paintBmNetTest(b);
                if (stored && !asDraft && out.ok) void this.refreshBmNetChecks(b);
            } else if (action === 'accept-drift') {
                if (st.saving || !id) return;
                await this.acceptBmNetDrift(b, id);
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
            ['port', 'minDaysLeft', 'count', 'maxLossPct', 'maxMs'].forEach((name) => {
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

        /** Accept the changed DNS records of a check as its new baseline (POST /api/net/accept-baseline). */
        async acceptBmNetDrift(b, checkId) {
            const st = this.bmNetState(b);
            try {
                const res = await global.nextDashFetch('/api/net/accept-baseline', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ checkId }),
                });
                if (!res.ok) throw new Error('accept');
                st.error = '';
            } catch {
                st.error = this.bmNetT('nettools.acceptFailed', 'Could not accept the new records.');
            }
            await this.refreshBmNetChecks(b);
            this.paintBmNet(b);
            global.NetBellSource?.refresh?.();
        },

        /** Change the type of the check being written; what the old type asked for does not carry over. */
        switchBmNetType(b, type) {
            const st = this.bmNetState(b);
            const ed = st.editing;
            if (!ed || ed.draft.type === type) return;
            const keep = { label: ed.draft.label, host: ed.draft.host, planning: ed.draft.planning, intervalMinutes: ed.draft.intervalMinutes, timeoutSec: ed.draft.timeoutSec, muted: ed.draft.muted };
            ed.draft = { ...this.bmNetDraftFrom(model().blankCheck(type)), ...keep };
            ed.errors = {};
            ed.test = null;
            this.paintBmNet(b);
        },

        /** Fields a stored check may carry that the form owns: cleared so a removed value really goes. */
        bmNetClear(c) {
            return { label: '', host: '', port: 0, minDaysLeft: 0, count: 0, maxLossPct: 0, maxMs: 0, intervalMinutes: 0, timeoutSec: 0, muted: false, enabled: c.enabled, record: '', resolver: '', expect: '', watchDrift: false, endpoint: '', expectStatus: '', expectHeader: '', path: '', op: '', credentialId: '' };
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
