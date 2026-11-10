/**
 * Network checks in Config -> Monitoring -> Checks: the status block under the
 * four settings (whether Ping can use ICMP here, and how many checks are
 * scheduled against the ceiling).
 *
 * The settings themselves are ordinary controls of the settings schema; only
 * this block is drawn here, filled in after the panel is on screen because it
 * needs GET /api/net/capabilities. ICMP is learned from the first real ping,
 * so "not tried yet" is a normal answer. A blocked ICMP is a status here and
 * in a ping check's result, never a bell row.
 *
 * Below it, an overview of every check on every bookmark: problems first, one
 * row each, turn several on or off at once (a PUT per bookmark to the route
 * the Tests tab uses, never a free host), and a click opens the bookmark's
 * Tests tab.
 *
 * Loaded on demand by DashboardConfig.hydrateNetToolsStatus.
 */
(function (global) {
    'use strict';
    if (typeof global.DashboardConfig !== 'function') return;

    Object.assign(global.DashboardConfig.prototype, {
        /** The status block's contents for one capabilities answer. */
        renderNetToolsStatus(caps) {
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(key, fallback);
            const M = global.NetChecksModel;
            const mode = caps.pingMode;
            let state = 'unknown';
            let label = t('nettools.settingsIcmpUnknown', 'Not tried yet');
            if (mode === 'off') {
                state = 'off';
                label = t('nettools.settingsIcmpOff', 'Switched off');
            } else if (mode === 'tcp-only') {
                state = 'off';
                label = t('nettools.settingsIcmpTcpOnly', 'Not used, TCP only');
            } else if (caps.icmp === 'ok') {
                state = 'ok';
                label = t('nettools.settingsIcmpOk', 'Works');
            } else if (caps.icmp === 'blocked') {
                state = 'warn';
                label = t('nettools.settingsIcmpBlocked', 'Blocked, Ping falls back to TCP');
            }
            const block = state === 'warn' && M
                ? M.errorBlock({ class: 'icmp' }, t)
                : null;
            const scheduled = t('nettools.settingsScheduled', '{n} of {max} checks scheduled')
                .replace('{n}', String(caps.scheduled ?? 0)).replace('{max}', String(caps.maxChecks ?? ''));
            const hint = state === 'unknown'
                ? `<p class="config-field-hint">${esc(t('nettools.settingsIcmpUnknownHint', 'nextDash finds out the first time a Ping check runs.'))}</p>`
                : '';
            const errorHtml = block ? `
                <div class="net-error is-${esc(block.tone)}" role="status" data-net-error-class="${esc(block.cls)}">
                    <b class="net-error-title">${esc(block.title)}</b>
                    <p>${esc(block.body)}</p>
                    <pre class="net-error-code">${esc(block.snippet || '')}</pre>
                    ${block.note ? `<p class="net-error-note">${esc(block.note)}</p>` : ''}
                    <div class="net-error-actions">
                        <button type="button" class="config-btn config-btn--small" data-net-settings-copy="${esc(block.snippet || '')}">${esc(t('nettools.copy', 'Copy'))}</button>
                    </div>
                </div>` : '';
            return `
                <div class="config-field-row">
                    <span class="config-field-label">${esc(t('nettools.settingsIcmpLabel', 'Ping (ICMP)'))}</span>
                    <span class="net-badge" data-state="${esc(state)}" data-net-icmp-status="${esc(caps.icmp || 'unknown')}">${esc(label)}</span>
                </div>
                ${hint}
                <p class="config-field-hint" data-net-scheduled>${esc(scheduled)}</p>
                ${errorHtml}`;
        },

        /** Problems first: failing, warning, slow, no result yet, fine, and what is not scheduled last. */
        netOverviewRank(item) {
            const state = global.NetChecksModel.badgeState(item);
            return { down: 0, warn: 1, slow: 2, unknown: 3, ok: 4, off: 5 }[state] ?? 6;
        },

        /** "just now", "12 minutes", "3 hours": how long ago, for the Last column. */
        netOverviewAgo(at) {
            const t = (key, fallback) => this.t(key, fallback);
            const minutes = Math.floor((Date.now() - Number(at)) / 60000);
            if (!(minutes >= 2)) return t('nettools.justNow', 'just now');
            return t('nettools.ago', '{duration} ago').replace('{duration}', global.NetChecksModel.intervalWords(minutes, t));
        },

        /** The overview: the count against the ceiling, bulk buttons and one row per check. */
        renderNetOverview(items, caps) {
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(key, fallback);
            const M = global.NetChecksModel;
            const ov = this._netOverview || (this._netOverview = { selected: new Set() });
            const ids = new Set(items.map((i) => i.checkId));
            ov.selected.forEach((id) => { if (!ids.has(id)) ov.selected.delete(id); });
            if (!items.length) {
                return `<p class="config-field-hint" data-net-ov-empty>${esc(t('nettools.overviewEmpty',
                    'No checks yet. Add them on a bookmark under Bookmarks, Tests.'))}</p>`;
            }
            const scheduled = items.filter((i) => i.enabled).length;
            const counter = t('nettools.settingsScheduled', '{n} of {max} checks scheduled')
                .replace('{n}', String(scheduled)).replace('{max}', String(caps?.maxChecks ?? ''));
            const sorted = items.slice().sort((a, b) => this.netOverviewRank(a) - this.netOverviewRank(b)
                || String(a.name || '').localeCompare(String(b.name || '')) || String(a.label || '').localeCompare(String(b.label || '')));
            const rows = sorted.map((item) => {
                const state = M.badgeState(item);
                const st = item.state;
                const last = st
                    ? `${st.ms > 0 ? `${st.ms} ms · ` : ''}${this.netOverviewAgo(st.at)}`
                    : '';
                const hostText = item.host ? `${item.host} (${item.label})` : item.label;
                const open = t('nettools.overviewOpen', 'Open in Tests');
                return `
                    <li class="config-crud-row net-ov-row" data-net-ov-row="${esc(item.checkId)}" data-state="${esc(state)}"
                        tabindex="0" title="${esc(open)}">
                        <input type="checkbox" data-net-ov-select="${esc(item.checkId)}"${ov.selected.has(item.checkId) ? ' checked' : ''}
                               aria-label="${esc(t('nettools.overviewSelectRow', 'Select this check'))}">
                        <span class="net-ov-type">${esc(M.typeName(item.type))}</span>
                        <span class="net-ov-bookmark">${esc(item.name || '')}</span>
                        <span class="net-ov-host">${esc(hostText)}</span>
                        <span class="net-ov-interval">${esc(item.intervalMinutes ? M.intervalWords(item.intervalMinutes, t) : '')}</span>
                        <span class="net-ov-last"${st?.detail ? ` title="${esc(st.detail)}"` : ''}>${esc(last)}</span>
                        <span class="net-badge" data-state="${esc(state)}">${esc(M.stateLabel(state, t))}</span>
                        <input type="checkbox" class="net-ov-enabled" data-net-ov-enabled="${esc(item.checkId)}"${item.enabled ? ' checked' : ''}
                               aria-label="${esc(t('nettools.colOn', 'On'))}">
                        <span class="net-ov-muted">${item.muted ? esc(t('nettools.alertsMuted', 'Muted')) : ''}</span>
                    </li>`;
            }).join('');
            const n = ov.selected.size;
            return `
                <div class="net-ov-bar">
                    <strong class="net-ov-count" data-net-ov-count>${esc(counter)}</strong>
                    <span class="net-ov-bulk">
                        <span class="config-field-hint" data-net-ov-selected>${esc(t('nettools.overviewSelected', '{n} selected').replace('{n}', String(n)))}</span>
                        <button type="button" class="config-btn config-btn--small" data-net-ov-bulk="on"${n ? '' : ' disabled'}>${esc(t('nettools.overviewTurnOn', 'Turn on'))}</button>
                        <button type="button" class="config-btn config-btn--small" data-net-ov-bulk="off"${n ? '' : ' disabled'}>${esc(t('nettools.overviewTurnOff', 'Turn off'))}</button>
                    </span>
                </div>
                <div class="net-ov-scroll">
                    <div class="net-ov-head">
                        <input type="checkbox" data-net-ov-all aria-label="${esc(t('nettools.overviewSelectAll', 'Select all checks'))}"${n === items.length ? ' checked' : ''}>
                        <span>${esc(t('nettools.colType', 'Type'))}</span>
                        <span>${esc(t('nettools.colBookmark', 'Bookmark'))}</span>
                        <span>${esc(t('nettools.colHost', 'Host'))}</span>
                        <span>${esc(t('nettools.everyLabel', 'Every'))}</span>
                        <span>${esc(t('nettools.lastResult', 'Last result'))}</span>
                        <span>${esc(t('nettools.colStatus', 'Status'))}</span>
                        <span>${esc(t('nettools.colOn', 'On'))}</span>
                        <span>${esc(t('nettools.alertsMuted', 'Muted'))}</span>
                    </div>
                    <ul class="config-crud-list config-crud-list--table net-ov-list" data-net-ov-list>${rows}</ul>
                </div>`;
        },

        /**
         * Turn checks on or off. Each bookmark's list is read and written back
         * whole (the route replaces the list), so nothing but `enabled` changes.
         */
        async setNetChecksEnabled(checkIds, enabled, container) {
            const ov = this._netOverview;
            const items = ov?.items || [];
            const want = new Set(checkIds);
            const t = (key, fallback) => this.t(key, fallback);
            if (enabled) {
                const free = (ov?.caps?.maxChecks ?? Infinity) - items.filter((i) => i.enabled).length;
                const adding = items.filter((i) => want.has(i.checkId) && !i.enabled).length;
                if (adding > free) {
                    this.notify(t('nettools.overviewCap', 'Only {n} more checks can be turned on. The limit is {max}.')
                        .replace('{n}', String(Math.max(0, free))).replace('{max}', String(ov.caps.maxChecks)), 'error');
                    await this.fillNetToolsStatus(container);
                    return;
                }
            }
            const byBookmark = new Map();
            items.filter((i) => want.has(i.checkId)).forEach((i) => {
                const key = `${i.pageId}|${i.url}`;
                if (!byBookmark.has(key)) byBookmark.set(key, { item: i, ids: new Set() });
                byBookmark.get(key).ids.add(i.checkId);
            });
            const api = typeof global.nextDashFetch === 'function' ? global.nextDashFetch : global.fetch;
            let failed = false;
            for (const { item, ids } of byBookmark.values()) {
                try {
                    const res = await global.fetch(`/api/net/checks?pageId=${encodeURIComponent(item.pageId)}&url=${encodeURIComponent(item.url)}`, { cache: 'no-store' });
                    if (!res.ok) throw new Error(String(res.status));
                    const body = await res.json();
                    const checks = (body.checks || []).map((c) => {
                        const { state, stats, display, ...stored } = c; // eslint-disable-line no-unused-vars
                        return ids.has(stored.id) ? { ...stored, enabled } : stored;
                    });
                    const put = await api('/api/net/checks', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pageId: item.pageId, url: item.url, checks }),
                    });
                    if (!put.ok) throw new Error(String(put.status));
                } catch {
                    failed = true;
                }
            }
            if (failed) this.notify(t('nettools.overviewFailed', 'Could not save the change.'), 'error');
            await this.fillNetToolsStatus(container);
        },

        bindNetOverview(host, container) {
            const ov = this._netOverview;
            const repaintBar = () => {
                const n = ov.selected.size;
                const label = host.querySelector('[data-net-ov-selected]');
                if (label) label.textContent = this.t('nettools.overviewSelected', '{n} selected').replace('{n}', String(n));
                host.querySelectorAll('[data-net-ov-bulk]').forEach((b) => { b.disabled = n === 0; });
                const all = host.querySelector('[data-net-ov-all]');
                if (all) all.checked = n > 0 && n === ov.items.length;
            };
            host.querySelector('[data-net-ov-all]')?.addEventListener('change', (e) => {
                ov.selected.clear();
                if (e.target.checked) ov.items.forEach((i) => ov.selected.add(i.checkId));
                host.querySelectorAll('[data-net-ov-select]').forEach((box) => { box.checked = e.target.checked; });
                repaintBar();
            });
            host.querySelectorAll('[data-net-ov-select]').forEach((box) => {
                box.addEventListener('change', () => {
                    const id = box.getAttribute('data-net-ov-select');
                    if (box.checked) ov.selected.add(id); else ov.selected.delete(id);
                    repaintBar();
                });
            });
            host.querySelectorAll('[data-net-ov-enabled]').forEach((box) => {
                box.addEventListener('change', () => {
                    box.disabled = true;
                    void this.setNetChecksEnabled([box.getAttribute('data-net-ov-enabled')], box.checked, container);
                });
            });
            host.querySelectorAll('[data-net-ov-bulk]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const ids = [...ov.selected];
                    if (!ids.length) return;
                    void this.setNetChecksEnabled(ids, btn.getAttribute('data-net-ov-bulk') === 'on', container);
                });
            });
            const openRow = (row) => {
                const item = ov.items.find((i) => i.checkId === row.getAttribute('data-net-ov-row'));
                if (item) void this.openLibraryOnBookmark?.(item.pageId, item.url, { tab: 'tests', focusRow: true });
            };
            host.querySelectorAll('[data-net-ov-row]').forEach((row) => {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('input, button, label')) return;
                    openRow(row);
                });
                row.addEventListener('keydown', (e) => {
                    if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return;
                    e.preventDefault();
                    openRow(row);
                });
            });
        },

        /** Fill every status block and overview inside `container` (there is at most one of each). */
        async fillNetToolsStatus(container) {
            const hosts = container.querySelectorAll('[data-net-tools-status]');
            if (!hosts.length) return;
            let caps = null;
            let items = null;
            try {
                const [capsRes, listRes] = await Promise.all([
                    global.fetch('/api/net/capabilities', { cache: 'no-store' }),
                    global.fetch('/api/net/checks', { cache: 'no-store' }),
                ]);
                if (capsRes.ok) caps = await capsRes.json();
                if (listRes.ok) items = (await listRes.json()).items || [];
            } catch { /* the block stays as the placeholder */ }
            if (items && caps) {
                const ov = this._netOverview || (this._netOverview = { selected: new Set() });
                ov.items = items;
                ov.caps = caps;
                container.querySelectorAll('[data-net-overview]').forEach((host) => {
                    if (!host.isConnected) return;
                    host.innerHTML = this.renderNetOverview(items, caps);
                    this.bindNetOverview(host, container);
                });
            }
            if (!caps) return;
            hosts.forEach((host) => {
                if (!host.isConnected) return;
                host.innerHTML = this.renderNetToolsStatus(caps);
                host.querySelectorAll('[data-net-settings-copy]').forEach((btn) => {
                    btn.addEventListener('click', async () => {
                        const text = btn.getAttribute('data-net-settings-copy') || '';
                        let ok = false;
                        try {
                            await global.navigator.clipboard.writeText(text);
                            ok = true;
                        } catch { /* the notice below says so */ }
                        this.notify(ok ? this.t('nettools.copied', 'Copied.') : this.t('nettools.copyFailed', 'Could not copy.'), ok ? 'success' : 'error');
                    });
                });
            });
        },
    });

    global.DashboardConfigNetToolsReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
