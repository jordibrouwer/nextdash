/**
 * Multi-select in the Health view.
 *
 * Health surfaces exactly the lists a cleanup starts from — Broken, Duplicates,
 * Stale, Unused — and then made you fix them one row at a time. The dashboard
 * grid already had multi-select, but its module resolves rows through
 * data-bookmark-index against d.bookmarks, which does not exist here: a health
 * row is an issue record carrying its own pageId and index.
 *
 * Selection is a Set of issue keys (pageId:index), the same identity the
 * keyboard cursor and the row menus already use, so a re-render after a
 * re-check or a delete keeps the ticks on the right rows.
 *
 * Bulk delete goes to /api/health/delete-bookmarks rather than looping the
 * single-row endpoint. That endpoint deletes by position, and every delete
 * shifts the rows after it — looping it would remove the wrong bookmarks. The
 * bulk endpoint verifies the URL the client believes sits at each index and
 * deletes highest-index-first in one write per page.
 */
class DashboardHealthMultiSelect {
    constructor(health) {
        this.health = health;
        this.selected = new Set();
        this.anchorKey = null;
        this._toolbar = null;
    }

    get dash() {
        return this.health.dash;
    }

    t(key, fallback, vars) {
        return this.health.t(key, fallback, vars);
    }

    isActive() {
        return this.selected.size > 0;
    }

    clear({ render = true } = {}) {
        if (!this.selected.size && !this._toolbar) {
            return;
        }
        this.selected.clear();
        this.anchorKey = null;
        if (render) {
            this.syncRows();
            this.syncToolbar();
        }
    }

    has(key) {
        return this.selected.has(key);
    }

    toggle(key, { anchor = true } = {}) {
        if (!key) return;
        if (this.selected.has(key)) {
            this.selected.delete(key);
        } else {
            this.selected.add(key);
        }
        if (anchor) {
            this.anchorKey = key;
        }
        this.syncRows();
        this.syncToolbar();
    }

    selectAllVisible() {
        this.health.getFilteredIssues().forEach((issue) => {
            this.selected.add(this.health.issueKey(issue));
        });
        this.syncRows();
        this.syncToolbar();
    }

    /**
     * Extend from the anchor to `key` over the filtered order, so Shift+click and
     * Shift+↑/↓ pick up everything between rather than just the two ends.
     */
    extendTo(key) {
        const filtered = this.health.getFilteredIssues();
        const keys = filtered.map((issue) => this.health.issueKey(issue));
        const to = keys.indexOf(key);
        if (to < 0) return;
        const from = this.anchorKey ? keys.indexOf(this.anchorKey) : -1;
        if (from < 0) {
            this.toggle(key);
            return;
        }
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        for (let i = lo; i <= hi; i += 1) {
            this.selected.add(keys[i]);
        }
        this.syncRows();
        this.syncToolbar();
    }

    /**
     * Drop keys for rows the report no longer has at all.
     *
     * Deliberately measured against every issue rather than the filtered ones: a
     * tick has to survive a filter change, the same as in Config → Bookmarks.
     * Pruning to the filter would silently discard a selection the moment
     * someone switched from All to Broken to check something.
     */
    prune() {
        if (!this.selected.size) return;
        const live = new Set(this.allIssues().map((issue) => this.health.issueKey(issue)));
        let changed = false;
        this.selected.forEach((key) => {
            if (!live.has(key)) {
                this.selected.delete(key);
                changed = true;
            }
        });
        if (changed) {
            this.syncToolbar();
        }
    }

    /** Every issue in the report, regardless of the active filter. */
    allIssues() {
        return this.health.report?.issues || [];
    }

    /**
     * Everything ticked, including rows the current filter hides — that is what
     * Delete would actually take, so it is what the actions must operate on and
     * what the reach warning counts.
     */
    selectedIssues() {
        return this.allIssues().filter((issue) => this.selected.has(this.health.issueKey(issue)));
    }

    /** Ticked rows the active filter is not showing. */
    offscreenCount() {
        const visible = new Set(this.health.getFilteredIssues().map((issue) => this.health.issueKey(issue)));
        let hidden = 0;
        this.selected.forEach((key) => {
            if (!visible.has(key)) hidden += 1;
        });
        return hidden;
    }

    /** Drop the ticks the active filter is not showing. */
    keepVisibleOnly() {
        const visible = new Set(this.health.getFilteredIssues().map((issue) => this.health.issueKey(issue)));
        this.selected.forEach((key) => {
            if (!visible.has(key)) this.selected.delete(key);
        });
        this.syncRows();
        this.syncToolbar();
    }

    syncRows() {
        document.querySelectorAll('.health-view-item').forEach((row) => {
            const on = this.selected.has(row.dataset.healthKey);
            row.classList.toggle('is-multi-selected', on);
            const box = row.querySelector('.health-view-select-box');
            if (box) {
                box.checked = on;
            }
        });
        document.querySelector('.health-view-feed')?.classList.toggle('has-multi-select', this.isActive());
    }

    // ─── Toolbar ────────────────────────────────────────────────────────────
    //
    // Deliberately the same bar as Config → Bookmarks: it sits above the list
    // rather than floating over it, groups its actions, and pairs a <select>
    // with an Apply button instead of opening a popover. Health is the second
    // place in the app where you tick rows and act on them, so it should not be
    // a second thing to learn — only the actions differ, not the shape.

    /** The slot above the feed, created once and refilled, as config does. */
    toolbarHost() {
        let host = document.getElementById('health-bulk-bar');
        if (host?.isConnected) {
            return host;
        }
        // Anchored to the feed when there is one, but never dependent on it: a
        // filter that matches nothing renders an empty state instead of a feed,
        // and that is precisely when the bar must stay — rows are still ticked,
        // Delete still reaches them, and the reach warning is the only thing
        // saying so. Falls back to the end of the view.
        const feed = document.querySelector('.health-view-feed');
        const layout = document.getElementById('dashboard-layout');
        const parent = feed?.parentElement || layout;
        if (!parent) return null;
        host = document.createElement('div');
        host.id = 'health-bulk-bar';
        if (feed) {
            parent.insertBefore(host, feed);
        } else {
            parent.appendChild(host);
        }
        return host;
    }

    syncToolbar() {
        const host = this.toolbarHost();
        if (!host) return;
        // A render rebuilds the feed under the bar; put it back above the new one
        // so it never drifts below the list it belongs to.
        const feed = document.querySelector('.health-view-feed');
        if (feed && host.nextElementSibling !== feed && feed.parentElement === host.parentElement) {
            feed.parentElement.insertBefore(host, feed);
        }
        if (!this.selected.size) {
            host.innerHTML = '';
            this._toolbar = null;
            return;
        }
        host.innerHTML = this.renderToolbar();
        this._toolbar = host.firstElementChild;
        this.bindToolbar(host);
    }

    /**
     * Warns when part of the selection sits outside the active filter.
     *
     * Ticks survive a filter change, so selecting rows on All and then switching
     * to Broken leaves a bar reading "7 selected" above a list where nothing is
     * ticked — and Delete would still take all seven. Naming the hidden count,
     * with a way to drop them, keeps the destructive buttons honest about their
     * reach. Same wording and same escape hatch as Config → Bookmarks.
     */
    renderOffscreenNotice() {
        const hidden = this.offscreenCount();
        if (!hidden) return '';
        const esc = (v) => this.health.escape(v);
        return `
            <span class="config-bulk-offscreen">
                <span class="config-bulk-offscreen-text">${esc(this.t(
                    'dashboard.healthBulkSelectedOffscreen',
                    '{count} not shown by the current filter',
                    { count: hidden }
                ))}</span>
                <button type="button" class="config-btn config-btn--small" data-bulk="keep-visible">${esc(
                    this.t('dashboard.healthBulkKeepVisible', 'Select only these')
                )}</button>
            </span>`;
    }

    /**
     * Ticked rows that currently carry a drift finding.
     *
     * The Accept button is offered against this count rather than the whole
     * selection, because accepting is only meaningful for rows that have
     * something to accept — and the count is what the confirmation quotes.
     */
    driftingSelected() {
        return this.selectedIssues().filter((issue) => issue?.watchDrift && issue?.driftNoticed);
    }

    renderToolbar() {
        const esc = (v) => this.health.escape(v);
        const n = this.selected.size;
        const modeOpts = (window.CheckMode?.options?.() || [])
            .map((o) => `<option value="${esc(o.mode)}">${esc(o.label)}</option>`)
            .join('');
        // Only when the selection actually contains findings. A permanently
        // visible button that usually does nothing trains people to ignore it,
        // and this one discards evidence when it does fire.
        const driftCount = this.driftingSelected().length;
        const acceptDriftBtn = driftCount
            ? `<button type="button" class="config-btn config-btn--small" data-bulk="accept-drift">${esc(
                this.t('dashboard.healthBulkAcceptDrift', 'Accept drift ({count})', { count: driftCount })
            )}</button>`
            : '';
        return `
            <div class="config-bulk-bar health-bulk-bar" role="group"
                aria-label="${esc(this.t('dashboard.healthBulkActions', 'Bulk actions'))}">
                <span class="config-bulk-count">${esc(
                    this.t('dashboard.healthBulkCount', '{count} selected', { count: n })
                )}</span>
                ${this.renderOffscreenNotice()}
                <div class="config-bulk-group">
                    <select class="config-select" id="health-bulk-mode"
                        aria-label="${esc(this.t('dashboard.healthBulkCheckMode', 'Check mode'))}">${modeOpts}</select>
                    <button type="button" class="config-btn config-btn--small" data-bulk="checkmode">${esc(
                        this.t('dashboard.healthBulkCheckModeApply', 'Set checking')
                    )}</button>
                    <button type="button" class="config-btn config-btn--small" data-bulk="recheck">${esc(
                        this.t('dashboard.healthBulkRecheck', 'Re-check')
                    )}</button>
                    <!-- A domain move breaks twenty bookmarks at once, and the
                         redirect that fixes them is the same one. Detecting and
                         applying it per row meant twenty round trips through a
                         menu. -->
                    <button type="button" class="config-btn config-btn--small" data-bulk="heal">${esc(
                        this.t('dashboard.healthBulkHeal', 'Follow redirects')
                    )}</button>
                    ${acceptDriftBtn}
                    <!-- Muting is per-bookmark alert policy and was the one
                         health setting you most want to set on a group — twelve
                         bookmarks behind one outage meant twelve dialogs. -->
                    <button type="button" class="config-btn config-btn--small" data-bulk="mute">${esc(
                        this.t('dashboard.healthBulkMute', 'Mute alerts')
                    )}</button>
                    <button type="button" class="config-btn config-btn--small" data-bulk="unmute">${esc(
                        this.t('dashboard.healthBulkUnmute', 'Unmute')
                    )}</button>
                </div>
                <div class="config-bulk-group">
                    <button type="button" class="config-btn config-btn--small" data-bulk="open">${esc(
                        this.t('dashboard.healthBulkOpen', 'Open')
                    )}</button>
                    <button type="button" class="config-btn config-btn--small" data-bulk="copy">${esc(
                        this.t('dashboard.healthBulkCopy', 'Copy links')
                    )}</button>
                    <button type="button" class="config-btn config-btn--small config-btn--danger" data-bulk="delete">${esc(
                        this.t('dashboard.healthBulkDelete', 'Delete')
                    )}</button>
                    <button type="button" class="config-btn config-btn--small" data-bulk="clear">${esc(
                        this.t('dashboard.healthBulkClear', 'Clear selection')
                    )}</button>
                </div>
            </div>`;
    }

    bindToolbar(host) {
        const actions = {
            // The mode comes from the select beside it, the way every other
            // Apply button in the config bar reads its own control.
            checkmode: () => {
                const mode = host.querySelector('#health-bulk-mode')?.value;
                if (mode) void this.bulkSetCheckMode(mode);
            },
            recheck: () => void this.bulkRecheck(),
            heal: () => void this.bulkFollowRedirects(),
            mute: () => void this.bulkSetMuted(true),
            unmute: () => void this.bulkSetMuted(false),
            'accept-drift': () => void this.bulkAcceptDrift(),
            open: () => this.bulkOpen(),
            copy: () => void this.bulkCopy(),
            delete: () => void this.bulkDelete(),
            clear: () => this.clear(),
            'keep-visible': () => this.keepVisibleOnly(),
        };
        host.querySelectorAll('[data-bulk]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                actions[btn.getAttribute('data-bulk')]?.();
            });
        });
    }

    // ─── Bulk actions ───────────────────────────────────────────────────────

    async bulkRecheck() {
        const issues = this.selectedIssues();
        if (!issues.length) return;
        window.nextdashTrack?.('health:bulk-recheck', { count: issues.length });
        // Sequential on purpose: each re-check is a network probe of someone
        // else's server, and firing twenty at once looks like a burst of traffic
        // from one client.
        for (const issue of issues) {
            await this.health.recheckIssue(issue, { silent: true });
        }
        await this.health.loadAndRender({ refresh: true });
        this.dash.showNotification(
            this.t('dashboard.healthBulkRecheckDone', 'Re-checked {count} bookmark(s)', { count: issues.length }),
            'success'
        );
    }

    /**
     * Accept the drift findings on every ticked row at once.
     *
     * The situation this exists for is never one row: a rebrand, a docs move,
     * a migration to a new domain trips everything pointing at that site in the
     * same sweep. Clearing them individually is the tedium the bulk bar exists
     * to remove.
     *
     * Confirmed first, and deliberately not styled as a danger action — it
     * discards findings rather than data, and the next check re-establishes a
     * baseline either way. What the confirmation has to make clear is the part
     * that is not obvious: this says the new page is correct, so a page that
     * actually rotted would be marked healthy.
     */
    async bulkAcceptDrift() {
        const issues = this.driftingSelected();
        if (!issues.length) return;
        const count = issues.length;
        const confirmed = await this.health.confirm(
            this.t('dashboard.healthBulkAcceptDriftTitle', 'Accept drift on {count} bookmarks?', { count }),
            this.t(
                'dashboard.healthBulkAcceptDriftConfirm',
                'This tells nextDash the pages are correct as they are now. The findings are cleared and the next check records a fresh baseline.',
                { count }
            )
        );
        if (!confirmed) return;

        window.nextdashTrack?.('health:bulk-accept-drift', { count });
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/health/accept-drift', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targets: issues.map((issue) => ({
                        pageId: Number(issue.pageId),
                        index: Number(issue.index),
                        // The server refuses any row whose stored URL disagrees,
                        // the same guard every other health write uses.
                        url: issue.url,
                    })),
                }),
            });
            if (!res.ok) throw new Error(`accept drift HTTP ${res.status}`);
            const body = await res.json().catch(() => ({}));
            const accepted = Number(body.accepted) || 0;
            const skipped = Number(body.skipped) || 0;

            await this.health.loadAndRender({ refresh: true });
            this.dash.updateHealthBadge?.();

            if (skipped > 0) {
                this.dash.showNotification(
                    this.t(
                        'dashboard.healthBulkAcceptDriftPartial',
                        'Accepted {count}; {skipped} had changed — reload the report',
                        { count: accepted, skipped }
                    ),
                    'warning'
                );
                return;
            }
            this.dash.showNotification(
                this.t('dashboard.healthBulkAcceptDriftDone', 'Accepted drift on {count} bookmark(s)', { count: accepted }),
                'success'
            );
        } catch {
            this.dash.showNotification(
                this.t('dashboard.healthBulkAcceptDriftFailed', 'Could not accept the drift findings'),
                'error'
            );
        }
    }

    bulkOpen() {
        const issues = this.selectedIssues();
        if (!issues.length) return;
        window.nextdashTrack?.('health:bulk-open', { count: issues.length });
        issues.forEach((issue) => this.health.openIssue(issue));
    }

    async bulkCopy() {
        const urls = this.selectedIssues().map((issue) => issue.url).filter(Boolean);
        if (!urls.length) return;
        window.nextdashTrack?.('health:bulk-copy', { count: urls.length });
        try {
            await navigator.clipboard.writeText(urls.join('\n'));
            this.dash.showNotification(
                this.t('dashboard.healthBulkCopied', 'Copied {count} link(s)', { count: urls.length }),
                'success'
            );
        } catch {
            this.dash.showNotification(
                this.t('dashboard.healthBulkCopyFailed', 'Could not copy the links'),
                'error'
            );
        }
    }

    async bulkSetCheckMode(mode) {
        const issues = this.selectedIssues();
        if (!issues.length || !mode) return;
        window.nextdashTrack?.('health:bulk-checkmode', { count: issues.length, mode });
        let applied = 0;
        let stale = 0;
        for (const issue of issues) {
            // 'stale' means the row no longer describes that bookmark, which the
            // server refused — counted separately so the toast can say the report
            // needs reloading rather than claiming every row was set.
            const outcome = await this.health.setCheckMode(issue, mode, { silent: true });
            if (outcome === 'stale' || outcome === 'failed') {
                stale += 1;
            } else {
                applied += 1;
            }
        }
        await this.health.loadAndRender({ refresh: true });
        if (stale > 0) {
            this.dash.showNotification(
                this.t(
                    'dashboard.healthBulkCheckModePartial',
                    'Set {count} bookmark(s); {stale} had changed — reload the report',
                    { count: applied, stale }
                ),
                'warning'
            );
            return;
        }
        this.dash.showNotification(
            this.t('dashboard.healthBulkCheckModeDone', 'Check mode set on {count} bookmark(s)', { count: applied }),
            'success'
        );
    }

    /**
     * Mute or unmute alerts for the selection, in one request.
     *
     * Through the bulk expectations endpoint, which changes only the fields it
     * is given: muting must not also clear the keyword checks or the drift
     * baselines these bookmarks carry, which is exactly what sending them
     * through the single-bookmark endpoint — where every field replaces what is
     * stored — would have done.
     */
    /**
     * Ask every selected bookmark where it now redirects to, and apply the
     * answers in one go.
     *
     * The suggestion is fetched per row because that is what the endpoint
     * offers, but the *decision* is made once, over a list: seeing "14 of 18
     * moved to docs.example.org" is what makes a domain migration one action
     * instead of eighteen. Nothing is written before that confirmation, and the
     * server still pings each replacement before storing it — so a row that is
     * still broken afterwards is reported as such rather than as a fix.
     */
    async bulkFollowRedirects() {
        const issues = this.selectedIssues();
        if (!issues.length) return;
        window.nextdashTrack?.('health:bulk-heal', { count: issues.length });

        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const health = this.health;
        this.dash.showNotification(
            this.t('dashboard.healthBulkHealScanning', 'Looking for redirects on {count} bookmark(s)…', { count: issues.length }),
            'info',
            { duration: 2500 }
        );

        const found = [];
        for (const issue of issues) {
            const pageId = Number(issue.pageId ?? issue.pageID ?? 0);
            const index = Number(issue.index ?? -1);
            if (!(pageId > 0) || index < 0) continue;
            try {
                const res = await fetch(
                    `/api/health/auto-heal-suggest?pageId=${encodeURIComponent(pageId)}&index=${encodeURIComponent(index)}&redirectOnly=1`
                );
                if (!res.ok) continue;
                const suggestion = await res.json();
                const redirectUrl = String(suggestion?.redirectUrl || '').trim();
                if (redirectUrl && redirectUrl !== issue.url) {
                    found.push({ pageId, index, name: issue.name || issue.url, from: issue.url, to: redirectUrl });
                }
            } catch {
                // One unreachable row must not end the sweep: the others are
                // exactly what a bulk action is for.
            }
        }

        if (!found.length) {
            this.dash.showNotification(
                this.t('dashboard.healthBulkHealNone', 'No redirects found on the selected bookmarks'),
                'info'
            );
            return;
        }

        const preview = found.slice(0, 8).map((f) => `${f.name}\n  → ${f.to}`).join('\n');
        const more = found.length > 8
            ? `\n\n${this.t('dashboard.healthBulkHealMore', '…and {count} more', { count: found.length - 8 })}`
            : '';
        const ok = await health.confirm(
            this.t('dashboard.healthBulkHealTitle', 'Apply {count} redirect(s)?', { count: found.length }),
            `${preview}${more}`
        );
        if (!ok) return;

        let applied = 0;
        let stillBroken = 0;
        for (const fix of found) {
            try {
                const res = await fetcher('/api/health/auto-heal-apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pageId: fix.pageId, index: fix.index, newUrl: fix.to, refreshTitle: false }),
                });
                if (!res.ok) continue;
                const body = await res.json().catch(() => ({}));
                applied += 1;
                if (String(body?.lastError || '').trim()) stillBroken += 1;
            } catch {
                // Counted by omission: the summary reports what landed.
            }
        }

        await health.loadAndRender({ refresh: true });
        this.dash.updateHealthBadge?.();
        this.clear();
        this.dash.showNotification(
            stillBroken > 0
                ? this.t('dashboard.healthBulkHealPartial', 'Updated {count} bookmark(s); {broken} still fail', { count: applied, broken: stillBroken })
                : this.t('dashboard.healthBulkHealDone', 'Updated {count} bookmark(s)', { count: applied }),
            stillBroken > 0 ? 'warning' : 'success',
            { duration: 5000 }
        );
    }

    async bulkSetMuted(muted) {
        const issues = this.selectedIssues();
        if (!issues.length) return;
        window.nextdashTrack?.('health:bulk-mute', { count: issues.length, muted });

        const targets = issues
            .map((issue) => ({
                pageId: Number(issue.pageId ?? issue.pageID ?? 0),
                index: Number(issue.index ?? -1),
                url: issue.url || '',
            }))
            .filter((t) => t.pageId > 0 && t.index >= 0 && t.url);
        if (!targets.length) return;

        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/health/expectations-bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targets, notifyMuted: muted }),
            });
            if (!res.ok) {
                throw new Error(`bulk mute HTTP ${res.status}`);
            }
            const body = await res.json().catch(() => ({}));
            await this.health.loadAndRender({ refresh: true });
            const changed = Number(body?.changed) || 0;
            const skipped = Number(body?.skipped) || 0;
            if (skipped > 0) {
                // Same wording as the check-mode batch: a row the report has
                // gone stale on is not a failure to hide.
                this.dash.showNotification(
                    this.t(
                        'dashboard.healthBulkMutePartial',
                        'Changed {count} bookmark(s); {stale} had changed — reload the report',
                        { count: changed, stale: skipped }
                    ),
                    'warning'
                );
                return;
            }
            this.dash.showNotification(
                muted
                    ? this.t('dashboard.healthBulkMuteDone', 'Alerts muted on {count} bookmark(s)', { count: changed })
                    : this.t('dashboard.healthBulkUnmuteDone', 'Alerts unmuted on {count} bookmark(s)', { count: changed }),
                'success'
            );
        } catch (_error) {
            this.dash.showErrorNotification(
                this.t('dashboard.healthBulkMuteFailed', 'Could not change alert muting')
            );
        }
    }

    async bulkDelete() {
        const issues = this.selectedIssues();
        if (!issues.length) return;
        const count = issues.length;
        const confirmed = await this.health.confirm(
            this.t('dashboard.healthBulkDeleteTitle', 'Delete {count} bookmarks?', { count }),
            this.t(
                'dashboard.healthBulkDeleteConfirm',
                'Delete {count} bookmarks from your dashboard? They stay recoverable in the trash.',
                { count }
            ),
            { danger: true }
        );
        if (!confirmed) return;

        window.nextdashTrack?.('health:bulk-delete', { count });
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const d = this.dash;
        try {
            const res = await fetcher('/api/health/delete-bookmarks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: issues.map((issue) => ({
                        pageId: Number(issue.pageId),
                        index: Number(issue.index),
                        // The server refuses any row whose stored URL disagrees,
                        // which is what makes deleting by index safe here.
                        url: issue.url,
                    })),
                }),
            });
            if (!res.ok) throw new Error(`bulk delete HTTP ${res.status}`);
            const body = await res.json().catch(() => ({}));
            const deleted = Number(body.deleted) || 0;
            const skipped = Array.isArray(body.skipped) ? body.skipped.length : 0;

            this.clear({ render: false });
            this.health.selectedKey = null;

            // Keep the grid in step rather than waiting for a reload, the same as
            // the single-row delete does.
            const pageIds = new Set();
            issues.forEach((issue) => {
                d.removeBookmarkByUrl?.(issue.pageId, issue.url);
                pageIds.add(Number(issue.pageId));
            });
            pageIds.forEach((pid) => d.data?.invalidatePageDataCache?.(pid));
            void d.data?.fetchAndStoreDataRevision?.();
            d.renderDashboard?.({ incremental: false });

            await this.health.loadAndRender({ refresh: true });
            d.updateHealthBadge?.();

            if (skipped > 0) {
                d.showNotification(
                    this.t(
                        'dashboard.healthBulkDeletePartial',
                        'Deleted {count}; {skipped} had changed — reload the report',
                        { count: deleted, skipped }
                    ),
                    'warning'
                );
                return;
            }
            d.showNotification(
                this.t('dashboard.healthBulkDeleted', 'Deleted {count} bookmark(s)', { count: deleted }),
                'success',
                { duration: 4000 }
            );
        } catch {
            d.showNotification(this.t('dashboard.healthBulkDeleteFailed', 'Could not delete the bookmarks'), 'error');
        }
    }
}

window.DashboardHealthMultiSelect = DashboardHealthMultiSelect;
