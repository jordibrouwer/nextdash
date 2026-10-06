/**
 * The bulk actions behind the Bookmarks view's selection.
 *
 * The view ticks bookmarks; bmHealthBulkRunner (dashboard-config-bookmarks-health.js)
 * hands this their health issue keys (pageId:index) in `selected`, and the
 * sweeps below run one row at a time behind the progress overlay. It was the
 * Health view's multi-select once; its toolbar and ticks went with that view.
 */
class DashboardHealthMultiSelect {
    constructor(health) {
        this.health = health;
        this.selected = new Set();
    }

    get dash() {
        return this.health.dash;
    }

    t(key, fallback, vars) {
        return this.health.t(key, fallback, vars);
    }

    /** Every issue in the report, regardless of the active filter. */
    allIssues() {
        return this.health.report?.issues || [];
    }

    /**
     * Everything ticked, including rows the current filter hides: what the
     * actions operate on.
     */
    selectedIssues() {
        return this.allIssues().filter((issue) => this.selected.has(this.health.issueKey(issue)));
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
        // The Bookmarks view's loop: a Stop button, and a 429 waits instead
        // of counting as failed. The toolbar reports the end itself.
        return window.BulkSweep.run(issues, {
            title,
            status,
            run,
            done,
            t: (key, fallback) => this.t(key, fallback),
        });
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
                if (res.status === 429) {
                    return { rateLimited: true, retryAfter: Number(res.headers.get('Retry-After')) || 60 };
                }
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
                if (!url || !(pageId > 0)) return 'failed';
                const outcome = await (window.BookmarkPreviewService?.fetchFaviconOutcome?.(url)
                    ?? fetchIcon(url).then((icon) => ({ icon, setIcon: false })));
                const iconPath = outcome.icon;
                // An app that shows its set icon needs none: not a failure.
                if (!iconPath) return outcome.setIcon ? 'skipped' : 'failed';
                if (!icons.has(pageId)) icons.set(pageId, []);
                icons.get(pageId).push({ url, icon: iconPath });
                return 'ok';
            },
            done: (ok) => this.t('dashboard.healthBulkFaviconDone', 'Updated {count}', { count: ok }),
        });

        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        let written = 0;
        // By URL, one field per row: the sweep takes minutes, and writing the
        // whole page back from a list read at the end -- by report-old index --
        // set icons on neighbours and undid edits made while it ran.
        for (const [pageId, updates] of icons) {
            try {
                const save = await fetcher('/api/bookmarks', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: pageId, updates }),
                });
                if (!save.ok) continue;
                const saved = await save.json().catch(() => ({}));
                written += Number(saved.updated) || 0;
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
        // from one client. BulkSweep counts what each re-check answered and
        // waits out the ping limit; counting the selection said every row was
        // re-checked when the limit had refused most of them.
        await window.BulkSweep.run(issues, {
            title: this.t('dashboard.bulkRecheckTitle', 'Re-checking…'),
            run: async (issue) => (await this.health.recheckIssue(issue, { silent: true })) ?? 'failed',
            done: (ok) => this.t('dashboard.healthBulkRecheckDone', 'Re-checked {count} bookmark(s)', { count: ok }),
            t: (key, fallback) => this.t(key, fallback),
            notify: (summary, type) => this.dash.showNotification(summary, type),
        });
        await this.health.loadAndRender({ refresh: true });
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
        const endWait = this.health.beginWait(this.t('dashboard.waitBulkUpdateTitle', 'Updating the selection…'), this.t('dashboard.waitBulkUpdateStatus', 'Saving each bookmark'));
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
            await this.health.refreshBookmarkCopies?.(targets);
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
        } finally {
            endWait();
        }
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
        const endWait = this.health.beginWait(this.t('dashboard.waitBulkUpdateTitle', 'Updating the selection…'), this.t('dashboard.waitBulkUpdateStatus', 'Saving each bookmark'));
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
            await this.health.refreshBookmarkCopies?.(issues);
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
        } finally {
            endWait();
        }
    }

}

window.DashboardHealthMultiSelect = DashboardHealthMultiSelect;
