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

        /** Fill every status block inside `container` (there is at most one). */
        async fillNetToolsStatus(container) {
            const hosts = container.querySelectorAll('[data-net-tools-status]');
            if (!hosts.length) return;
            let caps = null;
            try {
                const res = await global.fetch('/api/net/capabilities', { cache: 'no-store' });
                if (res.ok) caps = await res.json();
            } catch { /* the block stays as the placeholder */ }
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
