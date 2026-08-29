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
            // Both, as every other mutator here does. syncRows() is what
            // maintains .has-multi-select on the feed, so pruning with only a
            // toolbar sync took the count to zero and left the checkbox column
            // standing open with nothing ticked in it.
            this.syncRows();
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
                    ${this.renderIgnoreButtons()}
                </div>
                <!-- Three things that fetch a page rather than reading the
                     report: what it looks like, what its icon is, and a copy of
                     it kept here. Each was already on a row's own menu, which
                     is where the tedium was — a filter that finds forty
                     bookmarks with no preview is exactly the case for doing
                     them at once. Grouped apart from the checking actions
                     because they are the slow ones. -->
                <div class="config-bulk-group">
                    <button type="button" class="config-btn config-btn--small" data-bulk="preview">${esc(
                        this.t('dashboard.healthBulkPreview', 'Rebuild previews')
                    )}</button>
                    <button type="button" class="config-btn config-btn--small" data-bulk="favicon">${esc(
                        this.t('dashboard.healthBulkFavicon', 'Refresh favicons')
                    )}</button>
                    <button type="button" class="config-btn config-btn--small" data-bulk="local-copy">${esc(
                        this.t('dashboard.healthBulkLocalCopy', 'Save a copy on this disk')
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
            ignore: () => void this.bulkIgnore(),
            unignore: () => void this.bulkClearIgnores(),
            'accept-drift': () => void this.bulkAcceptDrift(),
            preview: () => void this.bulkRebuildPreviews(),
            favicon: () => void this.bulkRefreshFavicons(),
            'local-copy': () => void this.bulkCaptureLocalCopies(),
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

    /*
     * The three slow ones share a shape, so they share a runner.
     *
     * Each fetches a page belonging to somebody else, one bookmark at a time.
     * Sequential is not caution about our own load: twenty parallel requests
     * from one client is a burst that a small server reads as an attack, and
     * bulkRecheck settled that question for the same reason.
     *
     * The overlay is what makes the wait bearable, and it has to be the
     * counting kind: the total is known here, and "12 of 40" is the difference
     * between waiting and knowing how long. One row failing never ends the
     * sweep — the others are what a bulk action is for — but a failure that
     * means every following row will fail too (monolith not installed) stops
     * it, because forty identical refusals is not information.
     */
    async runBulkOverEach(issues, { title, status, run, done }) {
        let ok = 0;
        let failed = 0;
        window.ProgressOverlay?.show(title, status);
        try {
            for (let i = 0; i < issues.length; i += 1) {
                window.ProgressOverlay?.update(i, issues.length,
                    this.t('dashboard.healthBulkProgress', '{done} of {total}', { done: i, total: issues.length }));
                let result;
                try {
                    result = await run(issues[i]);
                } catch {
                    result = 'failed';
                }
                if (result === 'stop') {
                    window.ProgressOverlay?.hide();
                    return { ok, failed, stopped: true };
                }
                if (result === 'failed') {
                    failed += 1;
                } else {
                    ok += 1;
                }
            }
            window.ProgressOverlay?.finish(done(ok, failed));
        } catch {
            window.ProgressOverlay?.hide();
        }
        return { ok, failed, stopped: false };
    }

    /** What the toolbar reports when a sweep is over. */
    reportBulkResult({ ok, failed, stopped }, doneKey, doneFallback) {
        if (stopped) return;
        if (!ok && failed) {
            this.dash.showNotification(
                this.t('dashboard.healthBulkAllFailed', 'None of the {count} could be done', { count: failed }),
                'error'
            );
            return;
        }
        const message = this.t(doneKey, doneFallback, { count: ok })
            + (failed
                ? ' ' + this.t('dashboard.healthBulkSomeFailed', '{count} failed.', { count: failed })
                : '');
        this.dash.showNotification(message, failed ? 'info' : 'success');
    }

    /*
     * Rebuild the preview of every ticked row.
     *
     * The filter this is reached from is usually "Missing preview", where the
     * toolbar already has a Fetch previews button — but that one walks the whole
     * collection. This walks the rows you ticked, which is what you want once
     * you have narrowed the list to the ones worth asking again.
     */
    async bulkRebuildPreviews() {
        const issues = this.selectedIssues();
        if (!issues.length) return;
        window.nextdashTrack?.('health:bulk-preview', { count: issues.length });
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;

        const result = await this.runBulkOverEach(issues, {
            title: this.t('dashboard.healthBulkPreviewTitle', 'Rebuilding previews…'),
            status: this.t('dashboard.healthBulkPreviewStatus', 'Asking each page what it says about itself'),
            run: async (issue) => {
                const url = String(issue?.url || '').trim();
                if (!url) return 'failed';
                // refresh=1 is the whole point: without it a cached answer comes
                // back and the sweep changes nothing.
                const res = await fetcher(`/api/bookmark-preview?refresh=1&url=${encodeURIComponent(url)}`);
                return res.ok ? 'ok' : 'failed';
            },
            done: (ok) => this.t('dashboard.healthBulkPreviewDone', 'Rebuilt {count}', { count: ok }),
        });
        this.reportBulkResult(result, 'dashboard.healthBulkPreviewDone', 'Rebuilt {count} preview(s)');
        if (result.ok) await this.health.loadAndRender({ refresh: true });
    }

    /*
     * Refresh the favicon of every ticked row.
     *
     * Grouped by page rather than done row by row. A single row's refresh reads
     * the whole page's bookmarks, changes one, and writes them all back —
     * there is no per-bookmark write — so twenty rows on one page would be
     * twenty loads and twenty saves of the same list, each one racing the last.
     * Fetching the icons first and writing each page once is both fewer
     * requests and the only version that cannot lose an earlier row's icon.
     */
    async bulkRefreshFavicons() {
        const issues = this.selectedIssues();
        if (!issues.length) return;
        const fetchIcon = window.BookmarkPreviewService?.fetchAndUploadFavicon;
        if (typeof fetchIcon !== 'function') {
            this.dash.showNotification(
                this.t('dashboard.healthFaviconFailed', 'Could not refresh the favicon'), 'error');
            return;
        }
        window.nextdashTrack?.('health:bulk-favicon', { count: issues.length });

        const icons = new Map();
        const result = await this.runBulkOverEach(issues, {
            title: this.t('dashboard.healthBulkFaviconTitle', 'Refreshing favicons…'),
            status: this.t('dashboard.healthBulkFaviconStatus', 'Fetching each site’s icon'),
            run: async (issue) => {
                const url = String(issue?.url || '').trim();
                const pageId = Number(issue?.pageId ?? issue?.pageID ?? 0);
                const index = Number(issue?.index ?? -1);
                if (!url || !(pageId > 0) || index < 0) return 'failed';
                const iconPath = await fetchIcon(url);
                if (!iconPath) return 'failed';
                if (!icons.has(pageId)) icons.set(pageId, new Map());
                icons.get(pageId).set(index, iconPath);
                return 'ok';
            },
            done: (ok) => this.t('dashboard.healthBulkFaviconDone', 'Updated {count}', { count: ok }),
        });

        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        let written = 0;
        for (const [pageId, byIndex] of icons) {
            try {
                const res = await fetch(`/api/bookmarks?page=${pageId}`);
                if (!res.ok) continue;
                const bookmarks = await res.json();
                if (!Array.isArray(bookmarks)) continue;
                let touched = 0;
                byIndex.forEach((iconPath, index) => {
                    if (bookmarks[index]) {
                        bookmarks[index].icon = iconPath;
                        touched += 1;
                    }
                });
                if (!touched) continue;
                const save = await fetcher(`/api/bookmarks?page=${pageId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bookmarks),
                });
                if (save.ok) written += touched;
            } catch {
                // A page that will not save leaves its rows unchanged; the
                // others are still worth writing.
            }
        }
        this.reportBulkResult({ ...result, ok: written, failed: result.failed + (result.ok - written) },
            'dashboard.healthBulkFaviconDone', 'Updated {count} favicon(s)');
        if (written) await this.health.loadAndRender({ refresh: true });
    }

    /*
     * Save a copy of every ticked page on this disk.
     *
     * By far the slowest of the three — monolith fetches every asset on a page,
     * and go.dev measured eleven seconds — so a selection of twenty is minutes
     * rather than seconds. That is what the confirmation is for: it names the
     * count so the number is a decision rather than a surprise.
     *
     * monolith not being installed answers 412, and it will answer 412 for
     * every remaining row. That stops the sweep and says what to do about it,
     * rather than spending four minutes proving the same thing forty times.
     */
    async bulkCaptureLocalCopies() {
        const issues = this.selectedIssues().filter((i) => String(i?.url || '').trim());
        if (!issues.length) return;
        const count = issues.length;
        const confirmed = await this.health.confirm(
            this.t('dashboard.healthBulkLocalCopyTitle', 'Save a copy of {count} pages?', { count }),
            this.t(
                'dashboard.healthBulkLocalCopyConfirm',
                'Each page is fetched in full, with its styling and images, and stored in your data directory. That takes several seconds per page.',
                { count }
            )
        );
        if (!confirmed) return;
        window.nextdashTrack?.('health:bulk-local-copy', { count });

        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        let missing = false;
        const result = await this.runBulkOverEach(issues, {
            title: this.t('dashboard.healthBulkLocalCopyRunning', 'Saving copies…'),
            status: this.t('dashboard.healthLocalCopySavingStatus', 'Fetching the page and everything on it'),
            run: async (issue) => {
                const url = String(issue.url).trim();
                const res = await fetcher(`/api/archives/capture?url=${encodeURIComponent(url)}`, { method: 'POST' });
                if (res.status === 412) {
                    missing = true;
                    return 'stop';
                }
                return res.ok ? 'ok' : 'failed';
            },
            done: (ok) => this.t('dashboard.healthBulkLocalCopyDone', 'Saved {count}', { count: ok }),
        });

        if (missing) {
            this.dash.showNotification(
                this.t('dashboard.healthLocalCopyMissing',
                    'monolith is not installed — see Config → Data & backups → Sources.'),
                'error'
            );
            return;
        }
        this.reportBulkResult(result, 'dashboard.healthBulkLocalCopyDone', 'Saved {count} copy(ies)');
    }

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

    /*
     * Ignore what this filter is about, or give everything back.
     *
     * The button names the condition, because "Ignore" alone on a bar above a
     * filtered list is the sort of button people press once and regret. On the
     * Ignored list it turns around: there the selection exists to be handed
     * back.
     */
    renderIgnoreButtons() {
        const esc = (v) => this.health.escape(v);
        if (this.health.filter === 'ignored') {
            return `<button type="button" class="config-btn config-btn--small" data-bulk="unignore">${esc(
                this.t('dashboard.healthBulkUnignore', 'Report these again')
            )}</button>`;
        }
        const flag = this.health.constructor.IGNORABLE_FLAGS?.has(this.health.filter)
            ? this.health.filter
            : '';
        if (!flag) return '';
        return `<button type="button" class="config-btn config-btn--small" data-bulk="ignore">${esc(
            this.t('dashboard.healthBulkIgnore', 'Ignore “{flag}”', { flag: this.health.flagLabel(flag) })
        )}</button>`;
    }

    /** The ticked rows as write targets, dropping anything the report cannot place. */
    ignoreTargets() {
        return this.selectedIssues()
            .map((issue) => ({
                pageId: Number(issue.pageId ?? issue.pageID ?? 0),
                index: Number(issue.index ?? -1),
                url: issue.url || '',
            }))
            .filter((t) => t.pageId > 0 && t.index >= 0 && t.url);
    }

    async bulkIgnore() {
        const flag = this.health.constructor.IGNORABLE_FLAGS?.has(this.health.filter)
            ? this.health.filter
            : '';
        const targets = this.ignoreTargets();
        if (!flag || !targets.length) return;
        window.nextdashTrack?.('health:bulk-ignore', { count: targets.length, flag });

        const body = await this.health.writeIgnores(targets, { add: [flag] });
        if (!body) return;
        this.clear();
        this.health.dash.showNotification(
            this.t('dashboard.healthBulkIgnored', '“{flag}” hidden for {count} bookmark(s).',
                { flag: this.health.flagLabel(flag), count: Number(body.changed) || targets.length }),
            'success',
            {
                duration: 8000,
                undoCallback: async () => {
                    await this.health.writeIgnores(targets, { remove: [flag] });
                },
            });
    }

    async bulkClearIgnores() {
        const targets = this.ignoreTargets();
        if (!targets.length) return;
        window.nextdashTrack?.('health:bulk-unignore', { count: targets.length });

        // What each row was hiding, so the undo can put back exactly that
        // rather than a guess.
        const before = this.selectedIssues().map((issue) => ({
            issue,
            flags: (this.health.ignoredFlagsOf(issue) || []).map((entry) => entry.flag),
        }));

        const body = await this.health.writeIgnores(targets, { clear: true });
        if (!body) return;
        this.clear();
        this.health.dash.showNotification(
            this.t('dashboard.healthBulkUnignored', 'Reporting {count} bookmark(s) again.',
                { count: Number(body.changed) || targets.length }),
            'success',
            {
                duration: 8000,
                undoCallback: async () => {
                    for (const entry of before) {
                        if (entry.flags.length) {
                            await this.health.writeIgnores(entry.issue, { add: entry.flags });
                        }
                    }
                },
            });
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
