/**
 * The bookmark panel's Tests tab: a bookmark's network checks and one-off tests.
 *
 * It is drawn like the Health and Usage tabs: one overview block (checks,
 * down, uptime), then an accordion per check (a dot and name in the head, the
 * answer on the right, the heartbeat and the facts inside), a "Run once"
 * accordion for a test that is never scheduled or stored, and "Add check".
 * Changing a check opens its form inside its own accordion.
 *
 * A one-off test asks POST /api/net/run for the bookmark's own host and port (a
 * request cannot name another), and its answer stays here, in memory, until the
 * side panel is closed. "Save as scheduled check..." opens the form on a new
 * check that starts from the test.
 *
 * The data side (the requests, the form, the failure blocks, the events) is in
 * dashboard-config-bookmarks-net.js; this file draws the tab.
 *
 * Loaded after that part, by ensureBookmarkRenderers.
 */
(function (global) {
    'use strict';
    if (typeof global.DashboardConfig !== 'function') return;

    const model = () => global.NetChecksModel;

    Object.assign(global.DashboardConfig.prototype, {
        /** What the last one-off run of a bookmark found; kept until the side panel is closed. */
        bmTestsRun(b) {
            if (!this._bmTestsMap) this._bmTestsMap = new Map();
            const key = this.bmNetIndexKey(b);
            if (!this._bmTestsMap.has(key)) this._bmTestsMap.set(key, { last: null, error: '', running: '' });
            return this._bmTestsMap.get(key);
        },

        /** The side panel was closed: what the tests found goes with it. */
        clearBmTestsResults() {
            this._bmTestsMap = new Map();
        },

        /** The tab's pane: a root the net part swaps in place when something changes. */
        renderBmTestsPane(b) {
            if (!this.bmNetEnabled?.()) return '';
            return `<div class="net-tests" data-bm-tests>${this.renderBmTestsBody(b)}</div>`;
        },

        renderBmTestsBody(b) {
            const esc = (v) => this.dash.escapeHtml(v);
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const st = this.bmNetState(b);
            if (st.status === 'error') return `<p class="net-inline-error" role="status">${esc(t('nettools.loadFailed', 'Could not read the checks.'))}</p>`;
            if (st.status !== 'ready' || !this._bmNetCaps) return `<p class="config-bm-panel-muted" role="status">${esc(t('nettools.loading', 'Loading checks...'))}</p>`;
            const caps = this._bmNetCaps;
            const checks = st.checks;
            const editing = st.editing;
            const canAdd = Boolean(caps.typesBuilt?.length) && checks.length < M.MAX_CHECKS_PER_BOOKMARK;
            const note = st.error && !editing ? `<p class="net-inline-error" role="status" data-net-error>${esc(st.error)}</p>` : '';
            const empty = !checks.length && !editing
                ? `<p class="config-bm-panel-muted net-empty">${esc(t('nettools.empty', 'No checks yet. A check tests one thing about this bookmark, on a schedule, or once, right now.'))}</p>`
                : '';
            const fresh = editing && !editing.id
                ? this.workbenchAcc('tests', 'new', t('nettools.formAdd', 'Add check'), '', this.renderBmNetCheckForm(b), true, { forceOpen: true })
                : '';
            const list = checks.length || fresh
                ? `<div class="config-bm-acc-list">${checks.map((c) => this.renderBmTestsCheck(b, c)).join('')}${fresh}</div>`
                : '';
            const add = !editing && canAdd
                ? `<div class="net-card-actions"><button type="button" class="config-btn config-btn--small config-btn--primary" data-net-action="add">${esc(t('nettools.addCheck', 'Add check'))}</button></div>`
                : '';
            return `
                ${this.renderBmTestsTiles(checks)}
                ${note}${empty}${list}
                ${this.renderBmTestsRunOnce(b, !checks.length && !editing)}
                ${add}`;
        },

        /** The overview block: how many checks, how many are down, the uptime of the last 24 hours. */
        renderBmTestsTiles(checks) {
            const esc = (v) => this.dash.escapeHtml(v);
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const health = this._bmHealthModule;
            const down = checks.filter((c) => M.badgeState(c) === 'down').length;
            const windows = checks.map((c) => c.stats?.uptime24h).filter((w) => w && w.samples > 0);
            const ratio = windows.length ? windows.reduce((sum, w) => sum + w.ratio, 0) / windows.length : null;
            const up = ratio != null && health ? health.formatUptime({ samples: 1, ratio }) : null;
            const none = '—';
            const downText = !checks.length ? none : (down ? `<span class="net-bad">${down}</span>` : '0');
            return `<div class="config-bm-usage-viz"><div class="config-bm-usage-tiles" data-net-tiles>
                    <div><b>${checks.length}</b>${esc(t('nettools.tileChecks', 'checks'))}</div>
                    <div><b>${downText}</b>${esc(t('nettools.tileDown', 'down'))}</div>
                    <div><b>${esc(up || none)}</b>${esc(t('nettools.tileUptime', 'up 24 h'))}</div>
                </div></div>`;
        },

        /** What a check's head says on the right: its state in a few words. */
        bmTestsAnswer(check) {
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const state = M.badgeState(check);
            if (state === 'off') return t('nettools.stateOff', 'Not scheduled');
            if (state === 'unknown') return t('nettools.noResult', 'No result yet');
            const last = check.state || {};
            if (state === 'down') {
                const since = Number(check.stats?.downSince) || 0;
                const health = this._bmHealthModule;
                return since && health
                    ? t('nettools.answerDown', 'down {duration}').replace('{duration}', health.formatDuration(Date.now() - since))
                    : M.stateLabel(state, t);
            }
            const ms = last.ok && Number(last.ms) > 0 ? `${Math.round(last.ms)} ms` : '';
            return [M.stateLabel(state, t), ms].filter(Boolean).join(' · ');
        },

        /** One check as an accordion: its facts and buttons, or its form while it is being changed. */
        renderBmTestsCheck(b, check) {
            const esc = (v) => this.dash.escapeHtml(v);
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const st = this.bmNetState(b);
            const state = M.badgeState(check);
            const name = M.labelFor(check, b);
            const editing = st.editing && st.editing.id === check.id;
            const head = `<span class="net-dot" data-state="${state}" aria-hidden="true"></span> ${esc(name)}`;
            const body = editing ? this.renderBmNetCheckForm(b) : this.renderBmTestsCheckBody(b, check, state);
            const out = this.workbenchAcc('tests', `check-${check.id}`, head, this.bmTestsAnswer(check), body, false, { labelHtml: true, forceOpen: editing });
            return out.replace('<details class="config-bm-acc"', `<details class="config-bm-acc" data-net-card="${esc(check.id)}" data-state="${state}"`);
        },

        renderBmTestsCheckBody(b, check, state) {
            const esc = (v) => this.dash.escapeHtml(v);
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const health = this._bmHealthModule;
            const st = this.bmNetState(b);
            const stats = check.stats || null;
            const last = check.state || null;
            const kv = (k, v) => `<div class="config-bm-usage-kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
            const strip = check.enabled === true && health && stats?.heartbeat?.length
                ? `<div class="health-monitor-strip net-strip">${health.renderHeartbeat(stats)}</div>` : '';
            const ago = last?.at && health
                ? t('nettools.ago', '{duration} ago').replace('{duration}', health.formatDuration(Date.now() - Number(last.at)))
                : '';
            const lastText = last ? [last.detail || M.stateLabel(state, t), last.viaTcp ? t('nettools.viaTcp', 'via TCP') : '', ago].filter(Boolean).join(' · ') : '';
            const minutes = M.intervalMinutes(check, b);
            const every = check.enabled === true
                ? (Number(check.intervalMinutes) > 0
                    ? M.intervalWords(minutes, t)
                    : t('nettools.everyLike', '{interval} (like the bookmark)').replace('{interval}', M.intervalWords(minutes, t)))
                : t('nettools.stateOff', 'Not scheduled');
            const since = Number(stats?.downSince) || 0;
            const uptime = health?.formatUptime?.(stats?.uptime24h);
            const fact = since
                ? kv(t('nettools.downSince', 'Down since'), new Date(since).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))
                : (uptime ? kv(t('nettools.uptime', 'Uptime'), `${uptime} ${t('nettools.last24h', 'in 24 h')}`) : '');
            const block = last && !last.ok ? this.renderBmNetErrorBlock(b, check) : '';
            const test = (st.lastTest || {})[check.id];
            let testLine = '';
            if (test) {
                testLine = test.ok
                    ? kv(t('nettools.testNow', 'Test now'), M.testSummary(test.res, t))
                    : `<p class="net-inline-error" role="status" data-net-error>${esc(test.error)}</p>`;
            }
            const busy = st.testingId === check.id;
            const muteLabel = check.muted ? t('nettools.unmute', 'Unmute') : t('nettools.mute', 'Mute');
            return `${strip}
                ${lastText ? kv(t('nettools.lastResult', 'Last result'), lastText) : ''}
                ${kv(t('nettools.everyLabel', 'Every'), every)}
                ${fact}${testLine}${block}
                <div class="net-card-actions">
                    <button type="button" class="config-btn config-btn--small" data-net-action="retest" data-net-id="${esc(check.id)}"${busy ? ' disabled' : ''}>${esc(t('nettools.testNow', 'Test now'))}</button>
                    <button type="button" class="config-btn config-btn--small" data-net-action="edit" data-net-id="${esc(check.id)}">${esc(t('nettools.edit', 'Edit'))}</button>
                    <button type="button" class="config-btn config-btn--small${check.muted ? ' is-active' : ''}" data-net-action="mute" data-net-id="${esc(check.id)}"
                            aria-pressed="${check.muted === true}" title="${esc(t('nettools.muteTitle', 'Silence the alerts of this check. Its history is still kept.'))}">${esc(muteLabel)}</button>
                </div>`;
        },

        /** "Run once": a button per type this install can run, and what the last run found. */
        renderBmTestsRunOnce(b, open) {
            const esc = (v) => this.dash.escapeHtml(v);
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const types = M.toolTypes(this._bmNetCaps);
            if (!types.length) return '';
            const run = this.bmTestsRun(b);
            const buttons = types.map((type) =>
                `<button type="button" class="config-btn config-btn--small" data-net-action="run" data-net-type="${esc(type)}"${run.running ? ' disabled' : ''}>${esc(M.typeName(type))}</button>`).join('');
            const status = run.running ? `<p class="config-bm-panel-muted" role="status">${esc(t('nettools.testing', 'Testing...'))}</p>` : '';
            const error = run.error ? `<p class="net-inline-error" role="status" data-tests-error>${esc(run.error)}</p>` : '';
            const body = `<div class="net-card-actions" data-net-run-types>${buttons}</div>
                ${status}${error}${run.last && !run.running ? this.renderBmTestsResult(b, run.last) : ''}`;
            const answer = types.map((type) => M.typeName(type).toLowerCase()).join(' · ');
            return `<div class="config-bm-acc-list">${this.workbenchAcc('tests', 'run', t('nettools.runOnce', 'Run once'), answer, body, open, { forceOpen: open })}</div>`;
        },

        /** What one run found, in the accordion's own rows; for a failure, the block that says what to do. */
        renderBmTestsResult(b, last) {
            const esc = (v) => this.dash.escapeHtml(v);
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const { type, res } = last;
            const state = M.testState(res);
            const kv = (k, v) => `<div class="config-bm-usage-kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
            const ms = Number(res.ms) > 0 ? `${Math.round(res.ms)} ms` : '';
            let rows;
            if (!res.ok) {
                rows = this.renderNetBlockHtml(M.testErrorBlock(res, t), { retest: `data-net-action="run" data-net-type="${esc(type)}"` });
            } else if (type === 'ping' && !(res.viaTcp || res.ping?.viaTcp)) {
                const p = res.ping || {};
                rows = [
                    kv(t('nettools.resResult', 'Result'), `${M.stateLabel(state, t)} · ${Math.round(p.avgMs || res.ms || 0)} ms avg`),
                    kv(t('nettools.resRange', 'Min / max'), `${Math.round(p.minMs || 0)} / ${Math.round(p.maxMs || 0)} ms`),
                    kv(t('nettools.resJitter', 'Jitter'), `${Math.round(p.jitterMs || 0)} ms`),
                    kv(t('nettools.resLoss', 'Loss'), `${Number(p.lossPct) || 0}% of ${p.sent || 0}`),
                    kv(t('nettools.resAddress', 'Address'), res.ip || res.host || ''),
                ].join('');
            } else {
                rows = [
                    kv(t('nettools.resResult', 'Result'), [type === 'tcp' ? t('nettools.resPortOpen', 'Port open') : t('nettools.resReachable', 'Reachable'), ms].filter(Boolean).join(' · ')),
                    kv(t('nettools.resAddress', 'Address'), `${res.ip || res.host || ''}${res.port ? `:${res.port}` : ''}`),
                    res.viaTcp || res.ping?.viaTcp
                        ? `<p class="config-bm-panel-muted">${esc(t('nettools.resViaTcp', 'ICMP is not allowed here, so this connected over TCP to port {port}. It says the host answers, not how fast ICMP is.').replace('{port}', res.port || '?'))}</p>`
                        : '',
                ].join('');
            }
            const checks = this._bmNet?.checks?.length || 0;
            const canSave = checks < M.MAX_CHECKS_PER_BOOKMARK && !this.bmNetState(b).editing;
            return `<div class="net-run-result" data-tests-result="${esc(type)}" data-state="${state}">
                    ${rows}
                    <div class="net-card-actions">
                        ${canSave ? `<button type="button" class="config-btn config-btn--small" data-net-action="save-as-check" data-net-type="${esc(type)}">${esc(t('nettools.toolsSave', 'Save as scheduled check...'))}</button>` : ''}
                        <button type="button" class="config-btn config-btn--small" data-net-action="run" data-net-type="${esc(type)}">${esc(t('nettools.runAgain', 'Run again'))}</button>
                    </div>
                </div>`;
        },

        /** Run one type once against the bookmark's own address; the answer is kept for this panel. */
        async runBmTestsOnce(b, type) {
            const run = this.bmTestsRun(b);
            // One at a time: the tests share the bookmark's host, and the
            // server lets a host be tested once at a time.
            if (run.running || !type) return false;
            run.running = type;
            run.error = '';
            this.paintBmNet(b);
            const out = await this.runBmNetTest(b, { type });
            run.running = '';
            if (out.ok) run.last = { type, res: out.res };
            else run.error = out.error;
            this.paintBmNet(b);
            return out.ok;
        },

        /** Open the form on a new check that starts from the last one-off test. */
        async saveBmTestAsCheck(b) {
            const last = this.bmTestsRun(b).last;
            if (!last) return;
            if (!(await this.startBmNetFromTest(b, last.res))) return;
            this.paintBmNet(b);
            this.focusBmNetForm(b);
        },

        bindBmTestsPane(panel) {
            const root = panel?.querySelector('[data-bm-tests]');
            const b = root && panel.dataset.bmPanelKey ? this.findBookmarkByKey(panel.dataset.bmPanelKey) : null;
            if (!root || !b) return;
            this.bindBmNetChecks(panel, b);
        },
    });

    global.DashboardConfigBookmarksTestsReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
