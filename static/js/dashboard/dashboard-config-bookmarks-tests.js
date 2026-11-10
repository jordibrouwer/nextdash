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
            this.bmHelpClose?.();
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
            const head = (label, key) => `<div class="net-sec-head"><span class="net-sec-label">${esc(label)}</span>${this.bmHelpBtn(key)}</div>`;
            return `
                ${head(t('nettools.secOverview', 'Overview'), 'Tests')}
                ${this.renderBmTestsTiles(checks)}
                ${note}${empty}${list ? head(t('nettools.secChecks', 'Checks'), 'Status') : ''}${list}
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
            // A certificate is read in days, not milliseconds.
            if (check.type === 'tls') return M.tlsDaysText(last.secondary, t);
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
            // A DNS check whose records changed: what changed, and the button that makes it the new normal.
            const drift = check.type === 'dns' && check.driftDiff
                ? `<div class="net-drift" data-net-drift role="status">
                        <span><b>${esc(t('nettools.driftTitle', 'DNS changed'))}</b> ${esc(check.driftDiff)}</span>
                        <button type="button" class="config-btn config-btn--small" data-net-action="accept-drift" data-net-id="${esc(check.id)}"${st.saving ? ' disabled' : ''}>${esc(t('nettools.driftAccept', 'Accept'))}</button>
                    </div>`
                : '';
            const test = (st.lastTest || {})[check.id];
            let testLine = '';
            if (test) {
                testLine = test.ok
                    ? kv(t('nettools.testNow', 'Test now'), M.testSummary(test.res, t))
                        + (check.type === 'http' && test.res?.http?.status ? this.renderBmTestsHttpRows(test.res, M.testState(test.res)) : '')
                        + (check.type === 'json' && test.res?.json ? this.renderBmTestsJsonRows(test.res, M.testState(test.res)) : '')
                    : `<p class="net-inline-error" role="status" data-net-error>${esc(test.error)}</p>`;
            }
            const busy = st.testingId === check.id;
            const muteLabel = check.muted ? t('nettools.unmute', 'Unmute') : t('nettools.mute', 'Mute');
            return `${strip}
                ${lastText ? kv(t('nettools.lastResult', 'Last result'), lastText) : ''}
                ${kv(t('nettools.everyLabel', 'Every'), every)}
                ${fact}${drift}${testLine}${block}
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
            // A JSON test needs a path and a value to look at: it is tried from its
            // own form ("Test first") or as a saved check, not from a button.
            const types = M.toolTypes(this._bmNetCaps).filter((type) => type !== 'json');
            if (!types.length) return '';
            const run = this.bmTestsRun(b);
            const buttons = types.map((type) =>
                `<button type="button" class="config-btn config-btn--small" data-net-action="run" data-net-type="${esc(type)}"${run.running ? ' disabled' : ''}>${esc(M.typeName(type))}</button>`).join('');
            const resolverSelect = types.includes('dns')
                ? `<label class="net-run-record"><span class="config-bm-panel-muted">${esc(t('nettools.runResolver', 'Resolver'))}</span>
                        <select class="config-select" data-net-run-resolver aria-label="${esc(t('nettools.runResolver', 'Resolver'))}">${M.DNS_RESOLVERS.map((r) => `<option value="${r}"${(run.resolver || '') === r ? ' selected' : ''}>${esc(r || t('nettools.resolverOptSystem', 'System'))}</option>`).join('')}</select></label>
                    <span class="config-bm-panel-muted" data-net-run-resolver-hint>${esc(M.resolverHint(run.resolver || '', t))}</span>`
                : '';
            const records = types.includes('dns')
                ? `<label class="net-run-record"><span class="config-bm-panel-muted">${esc(t('nettools.runRecord', 'DNS record'))}</span>
                        <select class="config-select" data-net-run-record aria-label="${esc(t('nettools.runRecord', 'DNS record'))}">${M.DNS_RECORDS.map((r) => `<option value="${r}"${(run.record || 'A') === r ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>`
                : '';
            const status = run.running ? `<p class="config-bm-panel-muted" role="status">${esc(t('nettools.testing', 'Testing...'))}</p>` : '';
            const error = run.error ? `<p class="net-inline-error" role="status" data-tests-error>${esc(run.error)}</p>` : '';
            const body = `<div class="net-card-actions" data-net-run-types>${buttons}${records}${resolverSelect}</div>
                ${status}${error}${run.last && !run.running ? this.renderBmTestsResult(b, run.last) : ''}`;
            const answer = types.map((type) => M.typeName(type).toLowerCase()).join(' · ');
            return `<div class="config-bm-acc-list">${this.workbenchAcc('tests', 'run', `${esc(t('nettools.runOnce', 'Run once'))}${this.bmHelpBtn('Run')}`, answer, body, open, { forceOpen: open, labelHtml: true })}</div>`;
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
                // A certificate that is not accepted is still shown: what is wrong is on it.
                if (type === 'tls' && res.tls?.chain?.length) rows += this.renderBmTestsTlsRows(res, state);
                if (type === 'http' && res.http?.status) rows += this.renderBmTestsHttpRows(res, state);
                if (type === 'json' && res.json) rows += this.renderBmTestsJsonRows(res, state);
            } else if (type === 'json') {
                rows = this.renderBmTestsJsonRows(res, state);
            } else if (type === 'http') {
                rows = this.renderBmTestsHttpRows(res, state);
            } else if (type === 'tls') {
                rows = this.renderBmTestsTlsRows(res, state);
            } else if (type === 'dns') {
                rows = this.renderBmTestsDnsRows(res, state, ms);
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

        /**
         * The answer of a DNS lookup (mockup a4): the record type, the resolver
         * and the time, the DNSSEC chip, then the records as a table (value,
         * priority for MX, TTL) and one line on how they compare with the baseline.
         */
        renderBmTestsDnsRows(res, state, ms) {
            const esc = (v) => this.dash.escapeHtml(v);
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const d = res.dns || {};
            const recs = Array.isArray(d.records) ? d.records : [];
            const isMx = d.record === 'MX';
            const kv = (k, v) => `<div class="config-bm-usage-kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
            const resolver = d.resolver === 'system' || !d.resolver ? t('nettools.resolverSystem', 'system resolver') : d.resolver;
            const head = kv(t('nettools.resRecord', 'Record'), [d.record, resolver, ms].filter(Boolean).join(' \u00b7 '));
            const hasTtl = recs.some((r) => Number(r.ttl) > 0);
            const dnssec = `<div class="net-chips" data-net-dnssec="${esc(d.dnssec || 'unknown')}"><span class="net-chip">${esc(M.dnssecChip(d.dnssec, t))}</span></div>`;
            const table = recs.length
                ? `<table class="net-dns-table" data-net-dns-table>
                        <thead><tr><th scope="col">${esc(t('nettools.dnsValue', 'Value'))}</th>${isMx ? `<th scope="col">${esc(t('nettools.dnsPrio', 'Prio'))}</th>` : ''}${hasTtl ? `<th scope="col">${esc(t('nettools.dnsTtl', 'TTL'))}</th>` : ''}</tr></thead>
                        <tbody>${recs.map((r) => `<tr><td>${esc(r.value)}</td>${isMx ? `<td>${esc(r.prio)}</td>` : ''}${hasTtl ? `<td>${esc(r.ttl || '')}</td>` : ''}</tr>`).join('')}</tbody>
                    </table>`
                : '';
            const compare = d.changed
                ? `<p class="net-error-note" data-net-dns-changed>${esc(t('nettools.dnsChanged', 'Changed since the baseline:'))} ${esc(d.diff || '')}</p>`
                : '';
            const status = state === 'slow' ? kv(t('nettools.resResult', 'Result'), M.stateLabel(state, t)) : '';
            return `${head}${dnssec}${status}${table}${compare}`;
        },

        /**
         * The answer of an HTTP-detail run (mockup a4): chips (status, protocol,
         * total time, size), the timeline as bars, the redirect chain (the hops,
         * then where it ended) and the response headers, the first few with the
         * rest folded away. A hop the address guard refused is in the chain,
         * marked, and was never requested.
         */
        renderBmTestsHttpRows(res, state) {
            const esc = (v) => this.dash.escapeHtml(v);
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const h = res.http || {};
            const tl = h.timings || {};
            const chipState = res.ok ? state : 'down';
            const chips = [
                h.status ? `<span class="net-badge" data-state="${chipState}" data-net-http-status>${esc(String(h.status))}</span>` : '',
                h.proto ? `<span class="net-chip">${esc(h.proto)}</span>` : '',
                tl.totalMs ? `<span class="net-chip">${esc(t('nettools.httpTotal', '{ms} ms total').replace('{ms}', String(tl.totalMs)))}</span>` : '',
                h.size ? `<span class="net-chip">${esc(M.sizeText(h.size))}${h.sizeCapped ? ` ${esc(t('nettools.httpSizeCapped', '(read up to here)'))}` : ''}</span>` : '',
            ].join('');
            const segs = h.timings ? M.httpSegments(tl, t) : [];
            const wf = segs.length
                ? `<div class="net-wf" data-net-wf role="img" aria-label="${esc(t('nettools.wfLabel', 'Timeline of the request'))}">${segs.map((g) =>
                    `<span class="net-wf-label">${esc(g.label)}</span><span class="net-wf-bar"><b class="net-wf-seg is-${g.key}" style="left:${g.left}%;width:${g.width}%"></b></span><span class="net-wf-ms">${esc(String(g.ms))} ms</span>`).join('')}</div>`
                : '';
            const hops = Array.isArray(h.redirects) ? h.redirects : [];
            const last = hops.some((x) => x.blocked) ? null : { url: h.url, status: h.status, ms: Math.max(0, (Number(tl.ttfbMs) || 0) - (Number(tl.redirectMs) || 0)) };
            const rows = [...hops, ...(last && last.url ? [last] : [])];
            const redirects = hops.length
                ? `<table class="net-http-table" data-net-redirects aria-label="${esc(t('nettools.httpRedirectsTitle', 'Redirects'))}">
                        <tbody>${rows.map((x) => `<tr${x.blocked ? ' class="is-blocked"' : ''}><td class="net-http-url">${esc(x.url)}</td><td>${x.blocked ? esc(t('nettools.httpBlocked', 'blocked')) : esc(String(x.status || ''))}</td><td class="net-http-num">${x.ms ? `${esc(String(x.ms))} ms` : ''}</td></tr>`).join('')}</tbody>
                    </table>`
                : '';
            const split = M.httpHeaderSplit(h.headers, 3);
            const hdrRow = (x) => `<tr><td class="net-http-name">${esc(x.name)}</td><td class="net-http-url">${esc(x.value)}</td></tr>`;
            const total = Number(h.headersTotal) || (h.headers || []).length;
            const shown = (h.headers || []).length;
            const more = split.rest.length
                ? `<details class="net-http-more"><summary>${esc(t('nettools.httpAllHeaders', 'Show all {n} headers').replace('{n}', String(shown)))}</summary>
                        <table class="net-http-table"><tbody>${split.rest.map(hdrRow).join('')}</tbody></table>
                        ${total > shown ? `<p class="config-bm-panel-muted">${esc(t('nettools.httpHeadersCut', '{n} more headers are not shown.').replace('{n}', String(total - shown)))}</p>` : ''}
                    </details>`
                : '';
            const headers = split.first.length
                ? `<div class="net-http-sub" data-net-headers><b>${esc(t('nettools.httpHeadersTitle', 'Headers ({shown} of {total})').replace('{shown}', String(split.first.length)).replace('{total}', String(total)))}</b>
                        <table class="net-http-table"><tbody>${split.first.map(hdrRow).join('')}</tbody></table>${more}</div>`
                : '';
            return `${chips ? `<div class="net-chips" data-net-http-chips>${chips}</div>` : ''}${wf}
                ${redirects ? `<div class="net-http-sub"><b>${esc(t('nettools.httpRedirectsTitle', 'Redirects'))}</b>${redirects}</div>` : ''}${headers}`;
        },

        /**
         * The answer of a JSON check (mockup a4): the path, the value found there
         * and its type, what was expected, and the outcome with the status, the
         * time and the size read. Only the one value: never the rest of the answer
         * (the server sends no more), and a value under a secret path arrives as
         * [hidden].
         */
        renderBmTestsJsonRows(res, state) {
            const esc = (v) => this.dash.escapeHtml(v);
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const j = res.json || {};
            const chipState = res.ok ? state : 'down';
            const ms = Number(res.ms) > 0 ? t('nettools.jsonMs', '{ms} ms').replace('{ms}', String(Math.round(res.ms))) : '';
            const chips = [
                `<span class="net-badge" data-state="${chipState}" data-net-json-outcome>${esc(res.ok ? t('nettools.jsonMeets', 'Meets the check') : t('nettools.jsonFails', 'Does not meet it'))}</span>`,
                j.status ? `<span class="net-chip" data-net-json-status>${esc(String(j.status))}</span>` : '',
                ms ? `<span class="net-chip">${esc(ms)}</span>` : '',
                j.size ? `<span class="net-chip">${esc(M.sizeText(j.size))}</span>` : '',
            ].join('');
            const found = j.found
                ? `${j.value || ''}${j.type ? ` (${j.type})` : ''}`
                : t('nettools.jsonNothing', 'nothing at this path');
            const expected = j.op === 'exists'
                ? t('nettools.jsonExpectExists', 'a value exists')
                : `${M.jsonOpText(j.op, t)} ${j.expect || ''}`.trim();
            const row = (key, label, value) => `<tr data-net-json-${key}><td class="net-http-name">${esc(label)}</td><td class="net-http-url">${esc(value)}</td></tr>`;
            return `<div class="net-chips" data-net-json-chips>${chips}</div>
                <table class="net-http-table" data-net-json-rows>
                    <tbody>
                        ${row('path', t('nettools.jsonPath', 'Path'), j.path || '')}
                        ${j.status && j.status >= 200 && j.status <= 299 ? row('found', t('nettools.jsonFound', 'Found'), found) : ''}
                        ${row('expected', t('nettools.jsonExpected', 'Expected'), expected)}
                    </tbody>
                </table>`;
        },

        /**
         * The answer of a TLS read (mockup a4): chips for the days left, the
         * version, the protocol and the cipher, then the chain as one entry per
         * certificate (subject, issuer, valid until, names). Only what the
         * server sent: at most 5 certificates and 20 names each.
         */
        renderBmTestsTlsRows(res, state) {
            const esc = (v) => this.dash.escapeHtml(v);
            const M = model();
            const t = (k, f) => this.bmNetT(k, f);
            const tl = res.tls || {};
            const date = (ms) => (Number(ms) > 0 ? new Date(Number(ms)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
            const days = tl.chain?.length ? M.tlsDaysText(tl.daysLeft, t) : '';
            const chips = [
                days ? `<span class="net-badge" data-state="${res.ok ? state : 'down'}" data-net-tls-days>${esc(days)}</span>` : '',
                tl.version ? `<span class="net-chip">${esc(tl.version)}</span>` : '',
                tl.alpn ? `<span class="net-chip">${esc(tl.alpn)}</span>` : '',
                tl.cipher ? `<span class="net-chip">${esc(tl.cipher)}</span>` : '',
            ].join('');
            const chain = (tl.chain || []).map((c, i) => {
                const names = Array.isArray(c.san) ? c.san : [];
                const more = Number(c.sanMore) > 0 ? ` +${c.sanMore}` : '';
                const meta = [
                    c.issuer ? `${t('nettools.tlsIssuer', 'Issuer')}: ${c.issuer}` : '',
                    c.notAfter ? `${t('nettools.tlsValidUntil', 'valid until')} ${date(c.notAfter)}` : '',
                    c.sigAlg || '',
                ].filter(Boolean).join(' · ');
                return `<li class="net-cert" data-net-cert="${i}">
                        <b>${esc(c.subject || '')}</b>
                        <span class="net-cert-meta">${esc(meta)}</span>
                        ${names.length ? `<span class="net-cert-meta">${esc(t('nettools.tlsNames', 'Names'))}: ${esc(names.join(', '))}${esc(more)}</span>` : ''}
                    </li>`;
            }).join('');
            const total = Number(tl.chainTotal) || 0;
            const cut = total > (tl.chain || []).length
                ? `<p class="config-bm-panel-muted">${esc(t('nettools.tlsChainCut', '{n} more certificates are not shown.').replace('{n}', String(total - tl.chain.length)))}</p>`
                : '';
            return `${chips ? `<div class="net-chips" data-net-tls-chips>${chips}</div>` : ''}
                ${chain ? `<ol class="net-chain" data-net-tls-chain>${chain}</ol>${cut}` : ''}`;
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
            const out = await this.runBmNetTest(b, { type, record: run.record || 'A', resolver: run.resolver || '' });
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
            this.bindBmHelp(root, b);
            root.addEventListener('change', (event) => {
                const pick = event.target.closest('[data-net-run-record]');
                if (pick) this.bmTestsRun(b).record = pick.value;
                const rpick = event.target.closest('[data-net-run-resolver]');
                if (rpick) {
                    this.bmTestsRun(b).resolver = rpick.value;
                    this.paintBmNet(b);
                }
            });
        },
    });

    global.DashboardConfigBookmarksTestsReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
