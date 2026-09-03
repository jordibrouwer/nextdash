/**
 * Inbox page — lightweight link capture (separate from bookmarks).
 */
class DashboardInbox {
    static VIEW = 'inbox';

    /**
     * The one-time tour's tip id, repeated from inbox-tutorial.js.
     *
     * Health can leave this to its tutorial module because the health view and
     * its tutorial load together. The inbox module loads during bootstrap so
     * unread badges work without opening the view, so the tutorial is fetched
     * separately — and the whole point of a seen-check here is to not fetch it
     * at all once the tour is done. Both copies must stay in step.
     */
    static TUTORIAL_TIP_ID = 'inboxTutorialV1';

    constructor(dashboard) {
        this.dash = dashboard;
        this.items = [];
        this.loading = false;
        this.filter = 'all';
        this.searchQuery = '';
        this.domainFilter = '';
        /** Active tag chip filter; cleared the same way the domain filter is. */
        this.tagFilter = '';
        this.sort = 'newest';
        this.visibleLimit = 50;
        this.selectedItemId = null;
        /** Deep-link target from `?ib_id=` — applied after the feed renders. */
        this.focusItemId = null;
        // Ids ticked for a bulk action. Kept separate from selectedItemId, which is
        // the keyboard cursor: moving the cursor must not change what is ticked.
        this.checkedIds = new Set();
        /** Last row ticked, the fixed end of a Shift-extended range. */
        this.checkAnchorId = null;
        /** Lifetime aggregate from /api/inbox-stats, loaded on first open. */
        this.stats = null;
        this.statsOpen = false;
        this._statsFailed = false;
        this.triage = typeof DashboardInboxTriage === 'function' ? new DashboardInboxTriage(this) : null;
        this._searchRenderTimer = null;
        this._searchFocusPending = false;
        this._fetchPromise = null;
        /** True after the first successful `/api/inbox` fetch this session. */
        this._itemsLoaded = false;
    }

    isEnabled() {
        return this.dash.settings?.inboxEnabled !== false;
    }

    /* ── Multi-select ──────────────────────────────────────────────────── */

    /**
     * Tick or untick one row. Re-renders only the affected card and the action
     * bar, so ticking twenty items does not rebuild the feed twenty times.
     */
    setChecked(id, on) {
        if (!id) return;
        if (on) this.checkedIds.add(id);
        else this.checkedIds.delete(id);
        const card = document.querySelector(`.inbox-item[data-inbox-id="${CSS.escape(String(id))}"]`);
        card?.classList.toggle('is-checked', on);
        const box = card?.querySelector('.inbox-item-check-input');
        if (box && box.checked !== Boolean(on)) box.checked = Boolean(on);
        this.renderBulkBar();
    }

    /** Ticked ids that are still on screen — a filter change can strand the rest. */
    checkedItems() {
        const visible = new Set(this.getFilteredItems().map((i) => i.id));
        return (this.items || []).filter((i) => this.checkedIds.has(i.id) && visible.has(i.id));
    }

    /**
     * Ticked rows the current filter is hiding.
     *
     * The bulk buttons only ever act on what checkedItems() returns, so a filter
     * change silently shrinks their reach: the count in the bar drops with no
     * explanation, and widening the filter brings the old ticks back. Naming the
     * hidden number is what makes the buttons honest about what they will touch.
     */
    offscreenCheckedCount() {
        const visible = new Set(this.getFilteredItems().map((i) => i.id));
        let hidden = 0;
        this.checkedIds.forEach((id) => {
            if (!visible.has(id)) hidden += 1;
        });
        return hidden;
    }

    /**
     * Tick (or untick) every row between the anchor and `id`, inclusive.
     *
     * Walks the filtered order rather than the DOM so the range means what the
     * user sees. Without an anchor there is no range to extend, so the caller
     * falls back to a plain toggle.
     */
    extendCheckedTo(id, on) {
        const visible = this.getFilteredItems();
        const from = visible.findIndex((item) => item.id === this.checkAnchorId);
        const to = visible.findIndex((item) => item.id === id);
        if (from < 0 || to < 0) {
            this.setChecked(id, on);
            return;
        }
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        for (let i = lo; i <= hi; i += 1) {
            this.setChecked(visible[i].id, on);
        }
    }

    /** Drop the ticks the filter is hiding, keeping only what is on screen. */
    keepOnlyVisibleChecked() {
        const visible = new Set(this.getFilteredItems().map((i) => i.id));
        [...this.checkedIds].forEach((id) => {
            if (!visible.has(id)) this.checkedIds.delete(id);
        });
        this.renderBulkBar();
    }

    /**
     * Tick every row the current filter shows, or clear them when they are all
     * ticked already — so the same chord undoes itself.
     *
     * Scoped to the filtered set rather than this.items: ticking rows the user
     * cannot see would arm the bulk buttons over a selection they never made.
     */
    checkAllVisible() {
        const visible = this.getFilteredItems();
        if (!visible.length) return;
        const allChecked = visible.every((item) => this.checkedIds.has(item.id));
        visible.forEach((item) => this.setChecked(item.id, !allChecked));
    }

    clearChecked() {
        if (!this.checkedIds.size) return;
        this.checkedIds.clear();
        this.checkAnchorId = null;
        document.querySelectorAll('.inbox-item.is-checked').forEach((el) => {
            el.classList.remove('is-checked');
            const box = el.querySelector('.inbox-item-check-input');
            if (box) box.checked = false;
        });
        this.renderBulkBar();
    }

    /**
     * The action bar for ticked rows, shown only when something is ticked.
     *
     * These act on the selection, where the toolbar's "Mark all read" acts on
     * everything — the distinction the inbox was missing: no way to act on five
     * specific items without touching the rest.
     */
    renderBulkBar() {
        const container = document.getElementById('dashboard-layout');
        if (!container || !this.isActiveView()) return;
        const existing = container.querySelector('.inbox-selection-bar');
        const count = this.checkedItems().length;
        if (!count) {
            existing?.remove();
            return;
        }

        const bar = existing || document.createElement('div');
        if (!existing) {
            bar.className = 'inbox-selection-bar';
            bar.setAttribute('role', 'toolbar');
            bar.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-inbox-selection]');
                if (!btn) {
                    return;
                }
                const action = btn.getAttribute('data-inbox-selection');
                if (action === 'read') {
                    void this.bulkMarkRead();
                } else if (action === 'delete') {
                    void this.bulkDelete();
                } else if (action === 'clear') {
                    this.clearChecked();
                } else if (action === 'snooze') {
                    this.openSnoozeMenu(null, btn, this.checkedItems());
                } else if (action === 'open') {
                    this.bulkOpen();
                } else if (action === 'copy') {
                    void this.bulkCopyLinks();
                } else if (action === 'promote') {
                    this.openBulkPromoteMenu(btn);
                } else if (action === 'keep-visible') {
                    this.keepOnlyVisibleChecked();
                }
            });
            container.querySelector('.inbox-toolbar')?.after(bar);
        }
        const hidden = this.offscreenCheckedCount();
        const offscreen = hidden
            ? `<span class="inbox-selection-offscreen">
                    <span class="inbox-selection-offscreen-text">${this.escape(this.t(
                        'dashboard.inboxSelectedOffscreen',
                        '{count} not shown by the current filter',
                        { count: hidden }
                    ))}</span>
                    <button type="button" class="inbox-bulk-btn" data-inbox-selection="keep-visible">${this.escape(
                        this.t('dashboard.inboxKeepVisible', 'Select only these')
                    )}</button>
               </span>`
            : '';

        bar.innerHTML = `
            <span class="inbox-selection-count">${this.escape(
                this.t('dashboard.inboxSelectedCount', '{count} selected', { count })
            )}</span>
            ${offscreen}
            <button type="button" class="inbox-bulk-btn" data-inbox-selection="promote">${this.escape(this.t('dashboard.inboxPromote', 'Promote'))}</button>
            <button type="button" class="inbox-bulk-btn" data-inbox-selection="open">${this.escape(this.t('dashboard.inboxSelectionOpen', 'Open'))}</button>
            <button type="button" class="inbox-bulk-btn" data-inbox-selection="copy">${this.escape(this.t('dashboard.inboxSelectionCopy', 'Copy links'))}</button>
            <button type="button" class="inbox-bulk-btn" data-inbox-selection="read">${this.escape(this.t('dashboard.inboxMarkRead', 'Mark read'))}</button>
            <button type="button" class="inbox-bulk-btn" data-inbox-selection="snooze">${this.escape(this.t('dashboard.inboxSnooze', 'Snooze'))}</button>
            <button type="button" class="inbox-bulk-btn inbox-bulk-btn--danger" data-inbox-selection="delete">${this.escape(this.t('dashboard.inboxDelete', 'Delete'))}</button>
            <button type="button" class="inbox-bulk-btn" data-inbox-selection="clear">${this.escape(this.t('dashboard.inboxSelectionClear', 'Clear selection'))}</button>
        `;
    }

    /**
     * Open every ticked link in a new tab.
     *
     * The most natural inbox bulk action and the one that was missing: the view
     * exists to work through links, and there was no way to open five at once.
     * Marked read as they go, because opening is what "read" means here — the
     * same rule openItem() applies to a single row.
     */
    bulkOpen() {
        const targets = this.checkedItems();
        if (!targets.length) return;
        this._trackAction('bulk-open', { size: this._countBucket(targets.length) });
        targets.forEach((item) => {
            const href = this.dash.safeBookmarkOpenHref?.(item.url) || item.url;
            if (href) window.open(href, '_blank', 'noopener,noreferrer');
        });
        const unread = targets.filter((item) => !item.readAt);
        if (unread.length) {
            void Promise.allSettled(unread.map((item) => this.markRead(item.id)))
                .then(() => {
                    if (this.isActiveView()) this.render();
                });
        }
    }

    /**
     * Promote every ticked link to a bookmark on one page.
     *
     * Promoting is what this view exists to produce, and it was single-row only:
     * ten links from the same docs site meant ten trips through the bookmark
     * form to say the same thing ten times. The per-row promote still opens the
     * full form — that is right for one link you want to name and file properly
     * — so this is the other half rather than a replacement: pick the
     * destination once, and the titles the inbox already captured are used as-is.
     */
    async bulkPromote(pageId) {
        const targets = this.checkedItems();
        if (!targets.length) return;
        this._trackAction('bulk-promote', { size: this._countBucket(targets.length) });

        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const results = await Promise.allSettled(targets.map(async (item) => {
            const res = await fetcher('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: Number(pageId),
                    bookmark: {
                        name: item.previewTitle || item.title || item.domain || item.url,
                        url: item.url,
                        category: '',
                        tags: Array.isArray(item.tags) ? item.tags : [],
                        createdAt: Date.now(),
                    },
                }),
            });
            // A link already saved as a bookmark is not a failure of this
            // promote — it is the reason the inbox entry can go. Counted apart
            // from real errors below so the message can say which happened.
            if (res.status === 409) {
                await this.completePromote(item.id);
                return { id: item.id, duplicate: true };
            }
            if (!res.ok) throw new Error(`promote HTTP ${res.status}`);
            // Only clear the inbox entry once its bookmark exists, so a failure
            // leaves the link here to try again rather than losing it.
            await this.completePromote(item.id);
            return { id: item.id, duplicate: false };
        }));

        const settled = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
        const duplicates = settled.filter((r) => r?.duplicate).length;
        const promoted = settled.length - duplicates;
        const failed = results.length - settled.length;
        this.clearChecked();
        if (this.isActiveView()) {
            await this.loadAndRender({ refresh: true });
        } else {
            await this.refreshBadge();
        }

        if (promoted) {
            this.dash.showNotification?.(
                this.t('dashboard.inboxPromotedCount', 'Promoted {count} links', { count: promoted }),
                'success',
                { duration: 3000 }
            );
        }
        if (duplicates) {
            this.dash.showNotification?.(
                this.t('dashboard.inboxPromoteDuplicate', '{count} were already saved as bookmarks',
                    { count: duplicates }),
                'info',
                { duration: 4000 }
            );
        }
        if (failed) {
            this.dash.showErrorNotification?.(
                this.t('dashboard.inboxPromotePartial', '{count} could not be promoted', { count: failed })
            );
        }
    }

    /** Pick the page the ticked links become bookmarks on. */
    openBulkPromoteMenu(anchor) {
        this.closeSnoozeMenu();
        const pages = Array.isArray(this.dash.pages) ? this.dash.pages : [];
        if (!pages.length) return;

        const menu = document.createElement('div');
        menu.className = 'inbox-snooze-menu inbox-promote-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `<p class="inbox-promote-menu-title">${this.escape(
            this.t('dashboard.inboxPromoteToPage', 'Promote to page')
        )}</p>` + pages.map((page) => `
            <button type="button" class="inbox-snooze-option" role="menuitem" data-promote-page="${this.escape(String(page.id))}">${this.escape(page.name || String(page.id))}</button>
        `).join('');

        document.body.appendChild(menu);
        this._snoozeMenu = menu;

        const rect = anchor?.getBoundingClientRect?.();
        if (rect) {
            menu.style.left = `${Math.round(rect.left)}px`;
            const below = rect.bottom + 6;
            menu.style.top = below + menu.offsetHeight > window.innerHeight - 8
                ? `${Math.round(rect.top - menu.offsetHeight - 6)}px`
                : `${Math.round(below)}px`;
        }

        menu.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-promote-page]');
            if (!btn) return;
            const pageId = btn.getAttribute('data-promote-page');
            this.closeSnoozeMenu();
            void this.bulkPromote(pageId);
        });

        const onOutside = (e) => {
            if (!menu.contains(e.target) && e.target !== anchor) {
                this.closeSnoozeMenu();
                document.removeEventListener('click', onOutside, true);
            }
        };
        setTimeout(() => document.addEventListener('click', onOutside, true), 0);
    }

    /**
     * Every ticked link's URL, one per line, on the clipboard.
     *
     * Same shape as multi-select's copySelectedLinks, execCommand fallback
     * included: the Clipboard API is unavailable on plain-HTTP LAN installs,
     * which is exactly where a self-hosted dashboard often runs.
     */
    async bulkCopyLinks() {
        const targets = this.checkedItems();
        const urls = targets.map((item) => String(item.url || '').trim()).filter(Boolean);
        if (!urls.length) return;
        this._trackAction('bulk-copy', { size: this._countBucket(urls.length) });

        const text = urls.join('\n');
        const done = () => this.dash.showNotification?.(
            this.t('dashboard.inboxCopiedLinks', 'Copied {count} links', { count: urls.length }),
            'success',
            { duration: 2500 }
        );
        const failed = () => this.dash.showErrorNotification?.(
            this.t('dashboard.inboxCopyFailed', 'Could not copy links to clipboard.')
        );

        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                done();
                return;
            } catch {
                // Falls through to the execCommand path below.
            }
        }
        if (this.execCopyFallback(text)) done();
        else failed();
    }

    /**
     * A row's tags, as chips that filter.
     *
     * InboxLink.Tags has been a real field all along — normalised on add and
     * restore, and the extension can send them — but nothing rendered them, so
     * a link could be filed with tags the user was never shown. Clicking one
     * filters to it, the way the domain button beside them already works.
     */
    /*
     * Where the link came from, when that is worth a word.
     *
     * Every item has carried a source since capture -- paste, the extension, an
     * import, the share sheet -- and it reached the CSV and the JSON export and
     * never the screen. Config aggregates it into a table two screens away.
     *
     * Paste is left unsaid: it is how most links arrive, so printing it on
     * every row would be a label that never distinguishes anything.
     */
    /*
     * Of everything decided, how much became a bookmark.
     *
     * Against triaged rather than added, since links still waiting have not
     * been decided and would drag the rate down for no reason.
     *
     * `kept` belongs in that sum and used to be missing here, so this panel and
     * Config -> Stats printed materially different numbers under the same
     * label -- and kept is the largest of the three, recorded on every
     * mark-read. Config had already corrected it, with a comment saying the
     * arithmetic otherwise failed to reconcile with the tiles beside it; the
     * same reasoning applies on this side, so this is the half that moves.
     */
    /*
     * Which way the backlog is going, in one line.
     *
     * The server keeps a bucket per day for four hundred days -- added,
     * promoted, deleted, kept -- and this panel never touched it, so the inbox
     * could say how many but never whether it was gaining on the pile. The
     * chart that answers it lives in Config and is better than anything that
     * fits here, so this states the week and points at it.
     */
    weekTrendFromStats(stats) {
        const buckets = stats?.dailyBuckets;
        if (!buckets || typeof buckets !== 'object') {
            return null;
        }
        const cutoff = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
        let added = 0;
        let handled = 0;
        for (const [day, counts] of Object.entries(buckets)) {
            if (day < cutoff) continue;
            added += Number(counts?.added) || 0;
            handled += (Number(counts?.promoted) || 0)
                + (Number(counts?.deleted) || 0)
                + (Number(counts?.kept) || 0);
        }
        // A week with nothing in it has no direction worth reporting.
        return added || handled ? { added, handled } : null;
    }

    /*
     * Of the links that were decided on, how many became bookmarks.
     *
     * Promoted and deleted are the two ways a link leaves, and they are the
     * whole denominator. Kept is deliberately not in it: the server writes a
     * kept event on every mark-read, and a link marked read is still sitting
     * in the inbox waiting to be decided on. Counting it here contradicted the
     * label beside the figure, and double-counted every link that was read
     * before it was promoted -- which is why the stub of 40 added links could
     * report 43 decisions.
     */
    promoteRateFromStats(stats) {
        const promoted = Number(stats?.totalPromoted) || 0;
        const triaged = promoted + (Number(stats?.totalDeleted) || 0);
        return triaged ? Math.round((promoted / triaged) * 100) : null;
    }

    renderItemSource(item) {
        const source = String(item?.source || '').trim();
        if (!source || source === 'paste') {
            return '';
        }
        return `<span class="inbox-item-source" data-inbox-source>${this.escape(source)}</span>`;
    }

    renderItemTags(item) {
        const tags = Array.isArray(item?.tags) ? item.tags.filter(Boolean) : [];
        if (!tags.length) return '';
        const chips = tags.map((tag) => `
            <button type="button" class="inbox-item-tag" data-inbox-tag="${this.escape(tag)}"
                title="${this.escape(this.t('dashboard.inboxFilterByTag', 'Show only #{tag}', { tag }))}">#${this.escape(tag)}</button>
        `).join('');
        return `<p class="inbox-item-tags">${chips}</p>`;
    }

    /**
     * Copy a shareable link to one item.
     *
     * buildItemShareUrl already existed and already preserved filter, sort,
     * query and domain alongside the id — but its only caller was the bookmark
     * context menu's Share, so nothing in the inbox itself offered it.
     */
    async copyItemLink(id) {
        const url = this.buildItemShareUrl(id);
        if (!url) return;
        const done = () => this.dash.showNotification?.(
            this.t('dashboard.inboxCopiedItemLink', 'Link copied'),
            'success',
            { duration: 2500 }
        );
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(url);
                done();
                return;
            } catch {
                // Falls through to the execCommand path.
            }
        }
        if (this.execCopyFallback(url)) done();
        else this.dash.showErrorNotification?.(this.t('dashboard.inboxCopyFailed', 'Could not copy links to clipboard.'));
    }

    /** Pre-Clipboard-API copy, kept for plain-HTTP LAN installs. */
    execCopyFallback(value) {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
        ta.remove();
        return ok;
    }

    async bulkMarkRead() {
        const targets = this.checkedItems().filter((i) => !i.readAt);
        if (!targets.length) return;
        this._trackAction('bulk-read', { size: this._countBucket(targets.length) });
        // The results were discarded outright, so a selection that failed to
        // save reported nothing at all — the ticks cleared and the rows simply
        // stayed unread.
        const results = await Promise.allSettled(targets.map((item) => this.markRead(item.id)));
        const failed = results.filter((r) => r.status === 'rejected').length;
        this.clearChecked();
        if (this.isActiveView()) {
            this.render();
        }
        if (failed) {
            this.dash.showNotification(
                this.t('dashboard.inboxMarkAllReadPartial', 'Marked read, {count} failed', { count: failed }),
                'info',
                { duration: 3000 }
            );
        }
    }

    async bulkSnooze(items, until) {
        const targets = (items || []).filter(Boolean);
        if (!targets.length || !until) return;
        this._trackAction('bulk-snooze', { size: this._countBucket(targets.length) });
        // Reported for the same reason bulkMarkRead reports: discarding the
        // results meant a selection that failed to save said nothing at all —
        // the ticks cleared and the rows simply stayed awake.
        const results = await Promise.allSettled(targets.map((item) => this.patchSnooze(item.id, until)));
        const failed = results.filter((r) => r.status === 'rejected').length;
        this.clearChecked();
        if (this.isActiveView()) {
            this.render();
        } else {
            await this.refreshBadge();
        }
        if (failed) {
            this.dash.showNotification(
                this.t('dashboard.inboxSnoozePartial', 'Snoozed, {count} failed', { count: failed }),
                'info',
                { duration: 3000 }
            );
        }
    }

    /**
     * Delete every ticked row. Confirmed first; snapshots allow one Undo to restore
     * the whole batch, matching Clear read.
     */
    async bulkDelete() {
        const targets = this.checkedItems();
        if (!targets.length) return;
        const message = this.t(
            'dashboard.inboxSelectionDeleteConfirm',
            'Delete {count} selected items?',
            { count: targets.length }
        );
        const ok = await this.confirmBulkDelete(message);
        if (!ok) return;
        this._trackAction('bulk-delete', { size: this._countBucket(targets.length) });
        const d = this.dash;
        const results = await Promise.allSettled(targets.map((item) => this.deleteItem(item.id)));
        // Only the items that really went are snapshotted: undoing a partial
        // batch used to re-PUT the survivors too, restoring items that were
        // never deleted.
        const snapshots = targets
            .filter((_, i) => results[i].status === 'fulfilled')
            .map((item) => JSON.parse(JSON.stringify(item)));
        const removed = snapshots.length;
        const failed = results.length - removed;
        this.clearChecked();
        if (this.isActiveView()) {
            this.render();
        } else {
            await this.refreshBadge();
        }
        if (!removed) {
            d.showNotification(this.t('dashboard.inboxDeleteFailed', 'Could not delete'), 'error');
            return;
        }
        if (failed) {
            // Named rather than folded into the success count: the ticks are
            // already cleared, so a silent partial leaves no way to tell which
            // rows still need dealing with.
            d.showNotification(
                this.t('dashboard.inboxSelectionDeletePartial', '{count} could not be deleted', { count: failed }),
                'info',
                { duration: 4000 }
            );
        }
        d.showNotification(
            this.t('dashboard.inboxSelectionDeleteDone', 'Removed {count} selected items', { count: removed }),
            'success',
            {
                duration: 8000,
                undoCallback: async () => {
                    const restores = await Promise.allSettled(snapshots.map((snap) => this.restoreItem(snap)));
                    const back = restores.filter((r) => r.status === 'fulfilled' && r.value).length;
                    // A full inbox is the one failure worth naming: it explains
                    // why undo did nothing and what to do about it, where the
                    // generic message leaves the user guessing.
                    const full = restores.some((r) => r.status === 'rejected' && r.reason?.atCapacity);
                    if (this.isActiveView()) {
                        await this.loadAndRender();
                    } else {
                        await this.refreshBadge();
                    }
                    let message = this.t('dashboard.inboxUndoFailed', 'Could not restore');
                    if (back) {
                        message = this.t('dashboard.inboxSelectionDeleteRestored', 'Restored {count} links', { count: back });
                    } else if (full) {
                        message = this.t('dashboard.inboxUndoFullInbox', 'Inbox is full — could not restore');
                    }
                    d.showNotification(message, back ? 'success' : 'error', { duration: 3000 });
                },
            }
        );
    }

    confirmBulkDelete(message) {
        if (typeof window.AppModal?.show !== 'function') {
            return Promise.resolve(window.confirm(message));
        }
        return new Promise((resolve) => {
            window.AppModal.show({
                title: this.t('dashboard.inboxDelete', 'Delete'),
                message,
                confirmText: this.t('dashboard.inboxDelete', 'Delete'),
                confirmClass: 'modal-button--danger',
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false),
                onHide: () => resolve(false),
            });
        });
    }

    /* ── View state: URL and persistence ───────────────────────────────── */

    static FILTERS = new Set(['all', 'unread', 'snoozed', 'noted']);
    static SORTS = new Set(['newest', 'oldest', 'title', 'domain']);
    static STATE_KEY = 'nextdash:inbox-view-state';

    /** Lowercase filter label for breadcrumbs. */
    filterLabel(filter = this.filter) {
        const labels = {
            all: this.t('dashboard.inboxFilterAll', 'All'),
            unread: this.t('dashboard.inboxFilterUnread', 'Unread'),
            snoozed: this.t('dashboard.inboxFilterSnoozed', 'Snoozed'),
            noted: this.t('dashboard.inboxFilterNoted', 'With note'),
        };
        return labels[filter] || String(filter || '');
    }

    /* ── Explaining the view ───────────────────────────────────────────── */

    /**
     * One sentence saying what the active filter selects.
     *
     * The inbox pills read more plainly than health's did — nobody has to be told
     * what "Unread" means — so these notes carry the part the label cannot: what
     * happens to a row afterwards, and why the list is ordered the way it is. A
     * note that only restated its pill would be the noise it looks like.
     */
    filterExplanation(filter = this.filter) {
        const notes = {
            all: this.t('dashboard.inboxNoteAll', 'Everything waiting for a decision. Snoozed links are not here — they come back on their own when their time is up.'),
            unread: this.t('dashboard.inboxNoteUnread', 'Links you have not opened or kept yet. Opening one marks it read; keeping it with r marks it read without opening.'),
            snoozed: this.t('dashboard.inboxNoteSnoozed', 'Set aside until a time you picked, soonest first. These are hidden from the other filters until they wake, and Wake now brings one back early.'),
            noted: this.t('dashboard.inboxNoteNoted', 'Links you left a note on — the reason you saved it, for when the title alone no longer says.'),
        };
        return notes[filter] || '';
    }

    /** The explanation line under the toolbar. */
    renderFilterNote() {
        const text = this.filterExplanation();
        if (!text) return null;
        const note = document.createElement('p');
        // Shared class styles it; the view-specific one stays as this view's hook.
        note.className = 'view-filter-note inbox-filter-note';
        note.textContent = text;
        return note;
    }

    /**
     * "How this works", behind the ℹ in the toolbar.
     *
     * Covers what the inbox is for and what each action does to a row, rather
     * than which key presses it — the legend under the list already owns the
     * keyboard. Paste routing is described in terms of the setting that decides
     * it rather than repeating the setting's own wording, which lives in config.
     */
    showInboxExplainer() {
        if (typeof window.AppModal?.show !== 'function') return;
        window.nextdashTrack?.('inbox:explainer');

        const esc = (v) => this.escape(v);
        const section = (title, body) => `<div class="view-explain-row inbox-explain-row">
            <h4>${esc(title)}</h4><p>${esc(body)}</p>
        </div>`;

        const html = `<div class="inbox-explain">
            ${section(
                this.t('dashboard.inboxExplainWhatTitle', 'What the inbox is for'),
                this.t('dashboard.inboxExplainWhat', 'A holding area for links worth keeping before you know where they belong. Paste a URL onto the dashboard and it lands here, becomes a bookmark, or asks you which — whichever you chose under Behavior. The browser extension can save here too, and a URL already in the inbox is turned away rather than duplicated.')
            )}
            ${section(
                this.t('dashboard.inboxExplainReadTitle', 'Read and unread'),
                this.t('dashboard.inboxExplainRead', 'A new link stays unread until you open it or keep it with r. Read links stay in the list — being read is not a reason to remove something — and Clear read deletes them in one go when you are done with them. The tab badge counts only what is unread and awake.')
            )}
            ${section(
                this.t('dashboard.inboxExplainSnoozeTitle', 'Snoozing'),
                this.t('dashboard.inboxExplainSnooze', 'Snoozing hides a link until a time you pick, so the list stays down to what you can act on now. Sleeping links are left out of every count and filter except Snoozed, and reappear on their own once the time passes.')
            )}
            ${section(
                this.t('dashboard.inboxExplainPromoteTitle', 'Promoting to a bookmark'),
                this.t('dashboard.inboxExplainPromote', 'Promote turns a link into a real bookmark, opening the full form with the page and category left for you to choose. The inbox entry goes once the bookmark is saved, so nothing ends up filed in two places.')
            )}
            ${section(
                this.t('dashboard.inboxExplainTriageTitle', 'Working through the backlog'),
                this.t('dashboard.inboxExplainTriage', 'Triage walks the list one link at a time without the mouse. Sorting oldest first is the other way through it: an inbox is cleared from the bottom, where the links you have been avoiding are. Filter, sort and search all appear in the address bar, so any view can be bookmarked or shared.')
            )}
        </div>`;

        window.AppModal.show({
            title: this.t('dashboard.inboxExplainTitle', 'How the inbox works'),
            htmlMessage: html,
            confirmText: this.t('dashboard.inboxExplainClose', 'Got it'),
            // Informational only: a Cancel button would suggest the explanation
            // could be declined.
            showCancel: false,
            modalClass: 'view-explain-modal inbox-explain-modal',
            // One column of prose: 34rem keeps lines inside the range the eye
            // tracks comfortably, matching the health explainer.
            modalMaxWidth: 'min(34rem, calc(100vw - 2.5rem))',
        });
    }

    /** Breadcrumb trail for the panel head — `inbox › filter` or `inbox › domain`. */
    headerBreadcrumb() {
        const root = this.t('dashboard.inboxPageTitle', 'Inbox').toLowerCase();
        const domain = String(this.domainFilter || '').trim();
        if (domain) {
            return `${root} › ${domain.toLowerCase()}`;
        }
        if (this.filter === 'all') {
            return root;
        }
        const label = this.filterLabel().toLowerCase();
        return label ? `${root} › ${label}` : root;
    }

    /**
     * Restore filter and sort, URL first and stored state second.
     *
     * A link someone shared has to win over what this browser last did, or the
     * link does not describe what the recipient sees. Search is deliberately not
     * persisted — a stored query would silently hide most of the inbox on the
     * next visit, with only a small input to explain why.
     */
    restoreViewState() {
        let fromUrl = false;
        try {
            const params = new URL(window.location.href).searchParams;
            const filter = (params.get('ib_filter') || '').toLowerCase();
            if (DashboardInbox.FILTERS.has(filter)) {
                this.filter = filter;
                fromUrl = true;
            }
            const sort = (params.get('ib_sort') || '').toLowerCase();
            if (DashboardInbox.SORTS.has(sort)) {
                this.sort = sort;
                fromUrl = true;
            }
            const query = params.get('ib_q');
            if (typeof query === 'string' && query.trim() !== '') {
                this.searchQuery = query.trim();
                fromUrl = true;
            }
            const domain = (params.get('ib_domain') || '').trim().toLowerCase();
            if (domain) {
                this.domainFilter = domain;
                fromUrl = true;
            }
            const tag = (params.get('ib_tag') || '').trim().toLowerCase();
            if (tag) {
                this.tagFilter = tag;
                fromUrl = true;
            }
            const itemId = (params.get('ib_id') || '').trim();
            if (itemId) {
                this.focusItemId = itemId;
                fromUrl = true;
            }
        } catch { /* a malformed URL just means no deep link */ }

        if (fromUrl) return;

        try {
            const stored = JSON.parse(localStorage.getItem(DashboardInbox.STATE_KEY) || '{}');
            if (DashboardInbox.FILTERS.has(stored.filter)) this.filter = stored.filter;
            if (DashboardInbox.SORTS.has(stored.sort)) this.sort = stored.sort;
            // A stored site can name a host that has since left the inbox;
            // pruneDomainFilter() drops it on the next render rather than
            // filtering the feed down to nothing.
            const domain = String(stored.domain || '').trim().toLowerCase();
            if (domain) this.domainFilter = domain;
        } catch { /* unreadable storage falls back to the defaults */ }
    }

    /**
     * Remember filter, sort and site for the next visit. Best-effort by design.
     *
     * The site filter is stored for the same reason the other two are: it is an
     * explicit choice made in a visible control that keeps saying what it is doing.
     * Search is still left out — a stored query hides most of the inbox behind a
     * small input that is easy to miss.
     */
    persistViewState() {
        try {
            localStorage.setItem(
                DashboardInbox.STATE_KEY,
                JSON.stringify({ filter: this.filter, sort: this.sort, domain: this.domainFilter || '' })
            );
        } catch { /* private mode / full quota: the view still works */ }
    }

    /**
     * Keep the address bar describing the current view so it can be copied and
     * shared. replaceState, not pushState: a filter click is not a navigation
     * step, and Back should leave the inbox rather than walk its filter history.
     */
    syncUrlState() {
        if (!this.isActiveView()) return;
        try {
            const url = new URL(window.location.href);
            const params = url.searchParams;
            const setOrDelete = (key, value, isDefault) => {
                if (value && !isDefault) params.set(key, value);
                else params.delete(key);
            };
            setOrDelete('ib_filter', this.filter, this.filter === 'all');
            setOrDelete('ib_sort', this.sort, this.sort === 'newest');
            setOrDelete('ib_q', String(this.searchQuery || '').trim(), !String(this.searchQuery || '').trim());
            setOrDelete('ib_domain', String(this.domainFilter || '').trim(), !String(this.domainFilter || '').trim());
            setOrDelete('ib_tag', String(this.tagFilter || '').trim(), !String(this.tagFilter || '').trim());
            setOrDelete('ib_id', String(this.focusItemId || '').trim(), !String(this.focusItemId || '').trim());
            const query = params.toString();
            history.replaceState(history.state, '', `${url.pathname}${query ? `?${query}` : ''}#inbox`);
        } catch { /* history is unavailable in some embedded contexts */ }
    }

    /** A shareable dashboard URL that opens this row in the inbox view. */
    buildItemShareUrl(itemOrId) {
        const item = typeof itemOrId === 'object' && itemOrId
            ? itemOrId
            : (this.items || []).find((entry) => entry.id === itemOrId);
        const id = String(item?.id || itemOrId || '').trim();
        if (!id) {
            return '';
        }
        const url = new URL(`${window.location.origin}${window.location.pathname}`);
        url.hash = 'inbox';
        url.searchParams.set('ib_id', id);
        if (this.filter !== 'all') {
            url.searchParams.set('ib_filter', this.filter);
        }
        if (this.sort !== 'newest') {
            url.searchParams.set('ib_sort', this.sort);
        }
        const query = String(this.searchQuery || '').trim();
        if (query) {
            url.searchParams.set('ib_q', query);
        }
        const domain = String(this.domainFilter || '').trim();
        if (domain) {
            url.searchParams.set('ib_domain', domain);
        }
        const tag = String(this.tagFilter || '').trim();
        if (tag) {
            url.searchParams.set('ib_tag', tag);
        }
        return url.toString();
    }

    /**
     * Report an inbox triage action. Tracked at the user-action layer rather than in
     * markRead()/patchSnooze(), so a bulk run fires one event with a size bucket
     * instead of one per item.
     */
    _trackAction(action, extra) {
        window.nextdashTrack?.('inbox:' + action, extra);
    }

    /** Bucket a count so bulk sizes stay low-cardinality. */
    _countBucket(n) {
        const count = Number(n) || 0;
        if (count <= 1) return '1';
        if (count <= 5) return '2-5';
        if (count <= 20) return '6-20';
        return '20+';
    }

    isActiveView() {
        return this.dash.activeView === DashboardInbox.VIEW;
    }

    t(key, fallback, params) {
        const d = this.dash;
        if (params && typeof d.formatDashboardLabel === 'function') {
            // formatDashboardLabel prepends 'dashboard.' itself, so hand it the bare
            // tail — passing the full key double-prefixes it and the lookup misses.
            const bare = String(key).startsWith('dashboard.') ? String(key).slice('dashboard.'.length) : key;
            const text = d.formatDashboardLabel(bare, params, fallback);
            if (text && text !== bare && text !== key) {
                return text;
            }
            // No translation: interpolate the fallback here rather than surface a raw
            // `{count}`.
            return Object.entries(params).reduce(
                (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                String(fallback || '')
            );
        }
        const raw = d.language?.t?.(key);
        return raw && raw !== key ? raw : fallback;
    }

    escape(text) {
        return this.dash.escapeHtml ? this.dash.escapeHtml(text) : String(text || '');
    }

    formatUrlDisplay(url) {
        try {
            const parsed = new URL(url);
            const path = parsed.pathname + parsed.search;
            const compact = parsed.host + (path && path !== '/' ? path : '');
            return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact;
        } catch {
            const raw = String(url || '');
            return raw.length > 72 ? `${raw.slice(0, 69)}…` : raw;
        }
    }

    unreadCount() {
        // A snoozed link is deliberately out of sight, so it must not drive the
        // unread badge — it would nag for something the user chose to defer.
        return (this.items || []).filter((item) => !item.readAt && !this.isSnoozed(item)).length;
    }

    /**
     * The items the "all" filter would show: everything awake.
     *
     * Snoozing is a promise that a link is out of the way until its wake time, and
     * every visible number has to keep that promise or they contradict each other.
     * This is the one definition of "in the inbox right now" that the tiles, the
     * header badge and the feed all count from.
     */
    activeItems() {
        return (this.items || []).filter((item) => !this.isSnoozed(item));
    }

    /**
     * How many rows a filter pill or tile would actually show.
     *
     * The tiles double as filters, so a tile reading 12 that opens a list of 9 is
     * the tile lying about where it leads. Deliberately ignores the search box and
     * the site select: those narrow the list the counts describe, and folding them
     * in would leave every tile reading 0 or 1 mid-search with no way to see what
     * is being hidden. Health counts its pills the same way.
     */
    filterCount(filter) {
        // Through the same site, tag and search narrowing the list itself goes
        // through, so a pill never promises rows the view will not show: with a
        // search on it used to read "All 12" above a single matching row.
        const narrow = (list) => this.narrowItems(list).length;
        if (filter === 'snoozed') {
            return narrow((this.items || []).filter((item) => this.isSnoozed(item)));
        }
        const active = this.activeItems();
        if (filter === 'unread') {
            return narrow(active.filter((item) => !item.readAt));
        }
        if (filter === 'noted') {
            return narrow(active.filter((item) => String(item.note || '').trim()));
        }
        return narrow(active);
    }

    /**
     * Server-side preview enrichment runs just after an item is added. An item with
     * neither a preview title nor image that was added in the last ~45s is treated as
     * still enriching — long enough to cover a slow fetch, short enough that a link
     * that genuinely has no preview does not pulse forever.
     */
    isPreviewPending(item) {
        if (item.previewImage || item.previewTitle) {
            return false;
        }
        const added = Number(item.addedAt || 0);
        if (!added) {
            return false;
        }
        return Date.now() - added < 45000;
    }

    /**
     * If any visible item is still enriching, poll once after a short delay so the
     * preview appears without the user reloading. Self-cancelling: it only reschedules
     * while something is pending and the view is still open.
     */
    schedulePreviewRefresh() {
        if (this._previewRefreshTimer) {
            return;
        }
        const pending = (this.items || []).some((item) => this.isPreviewPending(item));
        if (!pending || !this.isActiveView()) {
            return;
        }
        this._previewRefreshTimer = setTimeout(async () => {
            this._previewRefreshTimer = null;
            if (!this.isActiveView()) {
                return;
            }
            try {
                await this.fetchItems();
            } catch {
                return;
            }
            this.render();
        }, 4000);
    }

    /**
     * Re-render exactly when the soonest snoozed item is due to wake, so a deferred
     * link resurfaces on its own without a reload. One timer for the nearest wake;
     * re-armed on every render.
     */
    scheduleWakeRefresh() {
        if (this._wakeTimer) {
            clearTimeout(this._wakeTimer);
            this._wakeTimer = null;
        }
        if (!this.isActiveView()) {
            return;
        }
        const now = Date.now();
        const nextWake = (this.items || [])
            .map((item) => Number(item.snoozedUntil || 0))
            .filter((ts) => ts > now)
            .sort((a, b) => a - b)[0];
        if (!nextWake) {
            return;
        }
        // Cap the delay so a far-future snooze does not overflow the timer; it will
        // be re-scheduled on the next render long before then.
        const delay = Math.min(nextWake - now + 250, 6 * 3600000);
        this._wakeTimer = setTimeout(() => {
            this._wakeTimer = null;
            if (this.isActiveView()) {
                this.render();
                this.dash.pageNav?.updateInboxTabBadge?.();
            }
        }, delay);
    }

    async fetchItems() {
        if (this._fetchPromise) {
            return this._fetchPromise;
        }
        const preserveRead = new Map(
            (this.items || [])
                .filter((item) => item?.readAt)
                .map((item) => [item.id, Number(item.readAt)])
        );
        this._fetchPromise = (async () => {
            try {
                const res = await fetch('/api/inbox');
                if (!res.ok) {
                    throw new Error(`inbox HTTP ${res.status}`);
                }
                const data = await res.json();
                this.items = Array.isArray(data.items) ? data.items : [];
                this.items.forEach((item) => {
                    // An explicit "mark unread" outranks the snapshot: it says
                    // what the reader just asked for, where the snapshot only
                    // says what was true when the request left.
                    if (this._deliberateUnread?.has(item.id)) {
                        item.readAt = 0;
                        return;
                    }
                    const local = preserveRead.get(item.id);
                    if (local && (!item.readAt || Number(item.readAt) < local)) {
                        item.readAt = local;
                    }
                });
                this._itemsLoaded = true;
                return this.items;
            } finally {
                this._fetchPromise = null;
            }
        })();
        return this._fetchPromise;
    }

    async loadItems() {
        if (!this.isEnabled()) {
            this.items = [];
            return [];
        }
        try {
            return await this.fetchItems();
        } catch {
            this.items = [];
            return [];
        }
    }

    async refreshBadge() {
        await this.loadItems();
        this.dash.pageNav?.updateInboxTabBadge?.();
    }

    async addFromUrl(url, options = {}) {
        const d = this.dash;
        const trimmed = String(url || '').trim();
        if (!trimmed) {
            return null;
        }
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: trimmed,
                    source: options.source || 'paste',
                    // The endpoint takes these too, and options was already
                    // threaded through for `source` — a caller that knows the
                    // page title or wants the link tagged had no way to say so.
                    // Omitted rather than sent empty so the server's own
                    // fallbacks (title from the domain) still apply.
                    ...(options.title ? { title: String(options.title).trim() } : {}),
                    ...(options.note ? { note: String(options.note).trim() } : {}),
                    ...(Array.isArray(options.tags) && options.tags.length
                        ? { tags: options.tags }
                        : {}),
                }),
            });
            if (res.status === 409) {
                const body = await res.json().catch(() => ({}));
                const msg = this.t('dashboard.inboxDuplicate', 'Already in Inbox');
                d.showNotification(msg, 'info', { duration: 3500 });
                if (body?.item?.id) {
                    if (!this.isActiveView()) {
                        await this.openInboxView();
                    }
                    this.focusItem(body.item.id);
                }
                await this.refreshBadge();
                return body?.item || null;
            }
            if (!res.ok) {
                throw new Error(`inbox add HTTP ${res.status}`);
            }
            const body = await res.json();
            const item = body?.item || null;
            await this.refreshBadge();
            const toastMsg = this.t('dashboard.inboxAddedToast', 'Added to Inbox');
            d.showNotification(toastMsg, 'success', { duration: 3000 });
            // Adding at the cap pushes the oldest links out. That used to happen
            // in silence — saved items simply stopped existing — so it is named
            // at the moment it is caused, where the user can still act on it.
            const evicted = Number(body?.evicted) || 0;
            if (evicted > 0) {
                d.showNotification(
                    evicted === 1
                        ? this.t('dashboard.inboxEvictedOne', 'Inbox is full — the oldest link was removed')
                        : this.t('dashboard.inboxEvictedCount', 'Inbox is full — the {count} oldest links were removed', { count: evicted }),
                    'info',
                    { duration: 6000 }
                );
            }
            if (this.isActiveView()) {
                await this.loadAndRender();
            }
            return item;
        } catch (error) {
            console.error('Inbox add failed:', error);
            d.showNotification(
                this.t('dashboard.inboxAddFailed', 'Could not save to Inbox'),
                'error'
            );
            return null;
        }
    }

    async deleteItem(id, options = {}) {
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        // reason=promote lets the server attribute the delete as a conversion
        // (vs. a plain discard) in the durable inbox stats aggregate.
        const reasonParam = options.reason === 'promote' ? '&reason=promote' : '';
        const res = await fetcher(`/api/inbox?id=${encodeURIComponent(id)}${reasonParam}`, { method: 'DELETE' });
        if (!res.ok) {
            throw new Error(`inbox delete HTTP ${res.status}`);
        }
        this.items = this.items.filter((item) => item.id !== id);
        this.dash.pageNav?.updateInboxTabBadge?.();
    }

    async restoreItem(snapshot) {
        if (!snapshot?.id || !snapshot?.url) {
            return null;
        }
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await fetcher('/api/inbox', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item: snapshot }),
        });
        if (res.status === 409) {
            // The inbox filled up while the undo toast was on screen, so there
            // is no room to put the item back. Flagged rather than thrown as a
            // generic failure: the caller has to tell the user why undo did
            // nothing, and "inbox is full" is actionable where "could not
            // restore" is not.
            const err = new Error('inbox at capacity');
            err.atCapacity = true;
            throw err;
        }
        if (!res.ok) {
            throw new Error(`inbox restore HTTP ${res.status}`);
        }
        const body = await res.json();
        const item = body?.item || null;
        if (item) {
            const existing = this.items.findIndex((entry) => entry.id === item.id);
            if (existing >= 0) {
                this.items[existing] = item;
            } else {
                this.items.unshift(item);
            }
            this.dash.pageNav?.updateInboxTabBadge?.();
        }
        return item;
    }

    /**
     * The row the cursor should land on once `id` is gone: the one after it, or
     * the one before when it was last. Null when it was the only row.
     *
     * Read from the filtered order rather than the DOM so it is right even when
     * the caller renders later (or not at all).
     */
    neighbourItemId(id) {
        const visible = this.getFilteredItems();
        const index = visible.findIndex((item) => item.id === id);
        if (index < 0) {
            return this.selectedItemId;
        }
        const next = visible[index + 1] || visible[index - 1];
        return next ? next.id : null;
    }

    async deleteItemWithUndo(id, options = {}) {
        const d = this.dash;
        const snapshot = this.items.find((item) => item.id === id);
        // reason=promote deletes are the tail of a promote, already counted there.
        if (snapshot && options.reason !== 'promote') {
            this._trackAction('delete');
        }
        if (!snapshot) {
            return false;
        }
        const copy = JSON.parse(JSON.stringify(snapshot));
        // Worked out before the delete, while the row is still in the list:
        // afterwards there is nothing to take a position from. Without this the
        // cursor was simply dropped, so a run of deletes meant delete, hunt for
        // your place, arrow back down — the main friction in keyboard triage.
        const nextSelectedId = this.selectedItemId === id ? this.neighbourItemId(id) : this.selectedItemId;
        try {
            await this.deleteItem(id);
            this.selectedItemId = nextSelectedId;
            if (this.isActiveView() && !options.skipRender) {
                this.render();
            }
            if (!options.silent) {
                const msg = this.t('dashboard.inboxDeletedToast', 'Removed from Inbox');
                d.showNotification(msg, 'success', {
                    duration: 8000,
                    undoCallback: async () => {
                        try {
                            await this.restoreItem(copy);
                            if (this.isActiveView()) {
                                await this.loadAndRender();
                            } else {
                                await this.refreshBadge();
                            }
                            d.showNotification(
                                this.t('dashboard.inboxUndoRestored', 'Restored to Inbox'),
                                'success',
                                { duration: 3000 }
                            );
                        } catch (err) {
                            d.showNotification(
                                err?.atCapacity
                                    ? this.t('dashboard.inboxUndoFullInbox', 'Inbox is full — could not restore')
                                    : this.t('dashboard.inboxUndoFailed', 'Could not restore'),
                                'error'
                            );
                        }
                    },
                });
            }
            return true;
        } catch {
            if (!options.silent) {
                d.showNotification(this.t('dashboard.inboxDeleteFailed', 'Could not delete'), 'error');
            }
            return false;
        }
    }

    /**
     * Mark one item read on the server.
     *
     * Throws on failure, the same as patchSnooze and deleteItem. It used to
     * toast and return instead, which resolved — so every caller treated a
     * failed write as a success: the row greyed out, markAllRead's
     * partial-failure branch could never fire, and the user got an error toast
     * immediately followed by "Marked 1 read" about the same item. The row came
     * back unread on the next reload.
     *
     * Reporting is left to the caller for the same reason: a bulk run of twenty
     * failures should say so once, not stack twenty identical toasts.
     */
    async markRead(id) {
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await fetcher('/api/inbox', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, readAt: Date.now() }),
        });
        if (!res.ok) {
            throw new Error(`inbox mark read HTTP ${res.status}`);
        }
        const item = this.items.find((entry) => entry.id === id);
        if (item) {
            item.readAt = Date.now();
        }
        // Read again, so the unread override is spent.
        this._deliberateUnread?.delete(id);
        this.dash.pageNav?.updateInboxTabBadge?.();
    }

    /**
     * Put a link back to unread.
     *
     * The server has always accepted it — PatchInboxItem clamps a readAt of 0 or
     * less back to 0 — and no client route ever sent it. Unread is the whole
     * notion of "not dealt with yet" in the inbox, and it was the one state that
     * only went one way: snoozing, notes, tags and deletes are all reversible.
     * The only escape was Clear read, which removes the link.
     */
    async markUnread(id) {
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await fetcher('/api/inbox', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, readAt: 0 }),
        });
        if (!res.ok) {
            throw new Error(`inbox mark unread HTTP ${res.status}`);
        }
        const item = this.items.find((entry) => entry.id === id);
        if (item) {
            item.readAt = 0;
        }
        // Remembered, because fetchItems snapshots read stamps before its
        // request and re-applies them after. Marking unread while a fetch was
        // in flight -- the poll after a capture, an R refresh, the first load --
        // let that snapshot put the old stamp straight back, and the row
        // silently flipped to read again.
        if (!this._deliberateUnread) {
            this._deliberateUnread = new Set();
        }
        this._deliberateUnread.add(id);
        this.dash.pageNav?.updateInboxTabBadge?.();
    }

    /** markUnread with the row repaint and the error toast the row paths need. */
    async markUnreadFromRow(item) {
        if (!item?.id || !item.readAt) return;
        this._trackAction('mark-unread');
        try {
            await this.markUnread(item.id);
            if (this.isActiveView()) {
                this.render();
            }
        } catch (_error) {
            this.dash.showNotification?.(
                this.t('dashboard.inboxMarkUnreadFailed', 'Could not mark it unread'),
                'error'
            );
        }
    }

    /**
     * markRead plus the single-item error toast, for the paths that act on one
     * row and have nobody else to report for them. Returns whether it landed,
     * so a caller only updates the row when the write actually happened.
     */
    async markReadReporting(id) {
        try {
            await this.markRead(id);
            return true;
        } catch {
            this.dash.showNotification?.(
                this.t('dashboard.inboxMarkReadFailed', 'Could not mark as read'),
                'error'
            );
            return false;
        }
    }

    applySettingsChange() {
        const d = this.dash;
        if (!this.isEnabled()) {
            if (d.activeView === DashboardInbox.VIEW) {
                d.pageNav?.restoreBookmarksViewForPage?.(d.currentPageId);
            }
            return;
        }
        d.pageNav?.updateInboxTabBadge?.();
    }

    /**
     * Make the address bar say #inbox. This is the moment the inbox's URL is
     * final, so it is also the moment worth remembering: a push here is what
     * lets Back leave the view. The filters that land later through
     * syncUrlState stay replaceState -- they are not places you navigated to.
     */
    restoreInboxHash() {
        if (window.location.hash === '#inbox') return;
        const next = `${window.location.pathname}${window.location.search}#inbox`;
        if (!window.DashboardHistory?.pushLocation?.(next)) {
            history.replaceState(history.state, '', next);
        }
    }

    restoreViewIfNeeded() {
        if (!this.isActiveView() || !this.isEnabled()) {
            return;
        }
        this.restoreInboxHash();
        this.dash.pageNav?.setActiveInboxTab?.();
        const container = document.getElementById('dashboard-layout');
        if (!container?.classList.contains('inbox-layout')) {
            void this.loadAndRender();
        }
    }

    async openInboxView() {
        const d = this.dash;
        if (!this.isEnabled()) {
            return false;
        }
        if (d.activeView === DashboardInbox.VIEW) {
            return true;
        }
        if (d.isInlineEditActive() && !(await d.confirmInlineEditBeforeNavigation())) {
            return false;
        }
        d._abortInlineEditForRender?.();
        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
        this.clearKeyboardSelection();
        d.setActiveView(DashboardInbox.VIEW);
        window.nextdashTrack?.('view:inbox');
        d.pageNav?.setActiveInboxTab?.();
        d.pageNav?.updateDocumentTitle?.();
        d.pageNav?.markInboxTabDiscovered?.();
        // Before the first render, so the view is built in the requested shape
        // rather than rendering the default and then rearranging itself.
        this.restoreViewState();
        await this.loadAndRender();
        this.restoreInboxHash();
        this.syncUrlState();
        // A link shared from the phone lands here through /share, which can only
        // answer with a redirect — so the outcome travels in the URL and is
        // reported once, on arrival.
        this.reportCaptureOutcome();
        // Not awaited: the view is already usable, and a slow script fetch must
        // not hold up the navigation that asked for it.
        void this.maybeShowTutorial();
        return true;
    }

    /**
     * Say what happened to a shared link, then take the marker out of the URL.
     *
     * Removed after reporting so a reload — or a bookmark of this address — does
     * not claim a save that happened once, minutes ago.
     */
    reportCaptureOutcome() {
        let outcome = '';
        try {
            outcome = new URL(window.location.href).searchParams.get('captured') || '';
        } catch {
            return;
        }
        if (!outcome) return;

        const messages = {
            ok: [this.t('dashboard.inboxCapturedOk', 'Saved to your inbox'), 'success'],
            duplicate: [this.t('dashboard.inboxCapturedDuplicate', 'That link was already in your inbox'), 'info'],
            nourl: [this.t('dashboard.inboxCapturedNoUrl', 'No web address was found in what was shared'), 'warning'],
            full: [this.t('dashboard.inboxCapturedFull', 'Your inbox is full — clear some links first'), 'warning'],
            denied: [this.t('dashboard.inboxCapturedDenied', 'This nextDash needs a capture token to accept shared links'), 'error'],
            error: [this.t('dashboard.inboxCapturedError', 'That link could not be saved'), 'error'],
        };
        const [message, tone] = messages[outcome] || messages.error;
        this.dash.showNotification?.(message, tone, { duration: 4000 });

        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('captured');
            history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
        } catch {
            // A URL we cannot rewrite is not worth failing the view over.
        }
    }

    /**
     * Fetch and run the one-time tour, the first time someone lands here.
     *
     * The cheap guards are repeated before the fetch so a session that has
     * already seen it, or has session tips off, never asks for the script at
     * all. Everything else — an open modal, active search, mobile — is left to
     * the module, which re-checks the tip id too.
     */
    async maybeShowTutorial() {
        if (window.DiscoverabilityState?.hasSeenTip?.(DashboardInbox.TUTORIAL_TIP_ID)) return;
        if (this.dash.settings?.enableSessionTips === false) return;
        if (typeof window.InboxTutorial === 'undefined') {
            try {
                await window.LazyScript.loadScriptOnce('js/inbox-tutorial.js', 'inboxTutorialModule',
                    () => typeof window.InboxTutorial !== 'undefined');
            } catch {
                // A tour that cannot be fetched is not worth an error toast.
                return;
            }
        }
        window.InboxTutorial?.maybeShow?.();
    }

    async leaveInboxView(pageId) {
        const d = this.dash;
        this._teardownLoadMoreObserver();
        this.clearKeyboardSelection();
        d.setActiveView('bookmarks');
        return d.loadPageBookmarks(pageId, { skipInlineEditConfirm: true });
    }


    closeInboxView() {
        const d = this.dash;
        if (d.activeView !== DashboardInbox.VIEW) {
            return false;
        }
        this._teardownLoadMoreObserver();
        this.clearKeyboardSelection();
        const restored = d.pageNav?.restoreBookmarksViewForPage?.(d.currentPageId) ?? false;
        if (restored) {
            d.keyboardNavigation?.scheduleUpdate?.();
        }
        return restored;
    }


    setupEscapeShortcut() {
        const d = this.dash;
        if (this._escapeHandler) {
            document.removeEventListener('keydown', this._escapeHandler, true);
        }
        this._escapeHandler = (e) => {
            if (e.key !== 'Escape') return;
            if (this.triage?.isOpen?.()) return;
            if (d.activeView !== DashboardInbox.VIEW) return;
            if (window.DashboardTagCloud?.modalOpen) return;
            if (d.isModalOpen()) return;
            if (d.searchComponent?.isActive()) return;
            if (d.isInlineEditActive()) return;
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) {
                return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            this.closeInboxView();
        };
        document.addEventListener('keydown', this._escapeHandler, true);
    }


    bindPointerNavigation(container) {
        if (!container) {
            return;
        }
        if (this._pointerContainer === container && this._pointerHandler) {
            return;
        }
        if (this._pointerContainer && this._pointerHandler) {
            this._pointerContainer.removeEventListener('pointerover', this._pointerHandler, true);
        }
        this._pointerContainer = container;
        this._pointerHandler = (e) => {
            if (!this.isActiveView()) {
                return;
            }
            if (e.pointerType && e.pointerType !== 'mouse') {
                return;
            }
            const card = e.target.closest?.('.inbox-item');
            const id = card?.dataset?.inboxId;
            if (!id || id === this.selectedItemId) {
                return;
            }
            this.selectItemById(id);
        };
        container.addEventListener('pointerover', this._pointerHandler, true);
    }


    unbindPointerNavigation() {
        if (this._pointerContainer && this._pointerHandler) {
            this._pointerContainer.removeEventListener('pointerover', this._pointerHandler, true);
        }
        this._pointerContainer = null;
        this._pointerHandler = null;
    }


    selectItemById(id) {
        const nextId = String(id || '').trim();
        if (!nextId) {
            return;
        }
        this.selectedItemId = nextId;
        this.applyKeyboardSelection();
    }


    handleKeyboardNavigation(e) {
        const d = this.dash;
        if (!this.isActiveView() || !this.isEnabled()) {
            return false;
        }
        if (this.triage?.isOpen?.()) {
            return false;
        }
        // An open snooze menu owns the arrow keys: this handler runs first and
        // would otherwise consume them to move the row cursor behind the menu,
        // leaving the menu's own navigation dead.
        if (this._snoozeMenu?.isConnected) {
            return false;
        }
        if (window.DashboardTagCloud?.modalOpen) {
            return false;
        }
        if (d.searchComponent?.isActive?.()) {
            return false;
        }
        if (d.isInlineEditActive?.()) {
            return false;
        }
        const typingTarget = e.target?.tagName === 'INPUT'
            || e.target?.tagName === 'TEXTAREA'
            || e.target?.isContentEditable;

        // Ctrl/Cmd+A ticks every visible row, the one chord this view claims —
        // and only while the feed has the cursor, so it keeps its browser
        // meaning everywhere else. Handled before the modifier guard below,
        // which nothing else gets past. Matches the health view.
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
            && (e.key === 'a' || e.key === 'A') && !typingTarget) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.checkAllVisible();
            return true;
        }

        if (e.ctrlKey || e.altKey || e.metaKey) {
            return false;
        }

        const target = e.target;
        const tag = target?.tagName;
        const isInboxSearch = target?.classList?.contains('inbox-search-input');
        const listNavKeys = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' ']);
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
            if (!isInboxSearch || !listNavKeys.has(e.key)) {
                return false;
            }
        }

        // A key pressed while focus sits on a row control (an action button)
        // belongs to that control — without this, a letter shortcut typed while
        // tabbed into the actions would also fire the row-level action.
        const onRowControl = Boolean(
            target?.closest?.('.inbox-item')
            && target?.matches?.('button, a, input, select')
        );

        // View-level keys, handled before the empty-list guard below: they are
        // about the view rather than a row, so they have to keep working when a
        // filter or search has left nothing on screen. Escape in particular was
        // unreachable exactly when it was needed — the bulk bar hides itself once
        // the ticked rows are filtered out, but the ticks are still set, and this
        // was the only way to clear them.
        // Escape drops the selection before it closes anything else: an
        // accidental tick should be cheap to undo.
        if (e.key === 'Escape' && this.checkedIds.size) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.clearChecked();
            return true;
        }
        // Uppercase R, matching the health view. Lowercase r is taken here by
        // mark-read.
        if (e.key === 'R') {
            e.preventDefault();
            e.stopImmediatePropagation();
            void this.refreshFromKeyboard();
            return true;
        }

        const cards = this.getVisibleItemCards();
        if (!cards.length) {
            // t starts triage over whatever the filter currently selects, so on
            // an empty list there is genuinely nothing to start — but the keys
            // above had to come first.
            return false;
        }

        // Shift+arrow extends the tick range as it moves, the keyboard twin of
        // Shift+click. Handled before the plain arrows below, which would
        // otherwise swallow it and just move the cursor.
        if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (!this.checkAnchorId && this.selectedItemId) {
                this.checkAnchorId = this.selectedItemId;
                this.setChecked(this.selectedItemId, true);
            }
            this.moveKeyboardSelection(e.key === 'ArrowDown' ? 1 : -1, cards);
            if (this.selectedItemId) {
                this.extendCheckedTo(this.selectedItemId, true);
            }
            return true;
        }

        if (e.key === 'ArrowDown' || e.key === 'j') {
            if (e.key === 'j' && onRowControl) return false;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (isInboxSearch) {
                target.blur();
            }
            this.moveKeyboardSelection(1, cards);
            return true;
        }
        if (e.key === 'ArrowUp' || e.key === 'k') {
            if (e.key === 'k' && onRowControl) return false;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (isInboxSearch) {
                target.blur();
            }
            this.moveKeyboardSelection(-1, cards);
            return true;
        }
        if (onRowControl) {
            return false;
        }
        const selected = this.selectedItemId
            ? this.items.find((entry) => entry.id === this.selectedItemId)
            : null;
        if ((e.key === 'Enter' || e.key === ' ') && selected) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.openItem(selected);
            return true;
        }
        if (e.key === 'p' && selected) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.promoteItem(selected);
            return true;
        }
        if ((e.key === 'r') && selected) {
            e.preventDefault();
            e.stopImmediatePropagation();
            void this.markReadFromKeyboard(selected);
            return true;
        }
        if (e.key === 'n' && selected) {
            e.preventDefault();
            e.stopImmediatePropagation();
            void this.editNote(selected);
            return true;
        }
        // Same key the health view uses to tick a row, so the two feeds share one
        // vocabulary rather than each inventing their own.
        if (e.key === 'x' && selected) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.setChecked(selected.id, !this.checkedIds.has(selected.id));
            this.checkAnchorId = selected.id;
            // Advance after ticking, as the health view does: marking a run of
            // rows is x x x rather than x j x j.
            const next = this.neighbourItemId(selected.id);
            if (next && next !== selected.id) {
                this.selectedItemId = next;
                this.applyKeyboardSelection();
            }
            return true;
        }
        if (e.key === 'z' && selected) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (this.isSnoozed(selected)) {
                void this.wakeItem(selected);
            } else {
                const anchor = document.querySelector(`[data-inbox-id="${CSS.escape(selected.id)}"] [data-inbox-action="snooze"]`);
                this.openSnoozeMenu(selected, anchor);
            }
            return true;
        }
        if ((e.key === 'd' || e.key === 'Delete') && selected) {
            e.preventDefault();
            e.stopImmediatePropagation();
            void this.deleteItemWithUndo(selected.id);
            return true;
        }
        /*
         * Two actions that were reachable only by right-click.
         *
         * Both shipped as context-menu entries and nothing else -- no row
         * button, no key -- so on a phone, where there is no right-click at
         * all, neither could be done. `u` for unread and `l` for labels; `g` is
         * taken by "go to first" and `t` by triage.
         */
        if (e.key === 'u' && selected) {
            e.preventDefault();
            e.stopImmediatePropagation();
            void this.markUnreadFromRow(selected);
            return true;
        }
        if (e.key === 'l' && selected) {
            e.preventDefault();
            e.stopImmediatePropagation();
            void this.editTags(selected);
            return true;
        }
        if (e.key === 'g' || e.key === 'Home') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.selectedItemId = cards[0]?.dataset?.inboxId || null;
            this.applyKeyboardSelection(cards);
            return true;
        }
        if (e.key === 'G' || e.key === 'End') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.selectedItemId = cards[cards.length - 1]?.dataset?.inboxId || null;
            this.applyKeyboardSelection(cards);
            return true;
        }
        if (e.key === 't' && !onRowControl) {
            e.preventDefault();
            e.stopImmediatePropagation();
            void this.startTriage();
            return true;
        }
        return false;
    }

    /** Drop one row and refresh summary tiles without rebuilding the whole feed. */
    removeItemFromFeed(id) {
        const sid = String(id || '');
        if (!sid) {
            return;
        }
        document.querySelector(`[data-inbox-id="${CSS.escape(sid)}"]`)?.remove();
        this.refreshInboxSummary();
        const container = document.getElementById('dashboard-layout');
        if (this.isActiveView() && container && !container.querySelector('.inbox-item')) {
            if (!this.getFilteredItems().length) {
                this.render();
            }
        }
    }

    /** Patch the note line on an existing row after a light-weight edit. */
    syncItemNoteInFeed(id) {
        const item = this.items.find((entry) => entry.id === id);
        const card = document.querySelector(`[data-inbox-id="${CSS.escape(String(id))}"]`);
        if (!card || !item) {
            return;
        }
        let noteEl = card.querySelector('.inbox-item-note');
        const note = String(item.note || '').trim();
        if (note) {
            if (!noteEl) {
                noteEl = document.createElement('p');
                noteEl.className = 'inbox-item-note';
                card.querySelector('.inbox-item-body')?.appendChild(noteEl);
            }
            noteEl.textContent = note;
        } else {
            noteEl?.remove();
        }
    }

    /** Mark an item read without opening it — the keyboard "keep" action. */
    async markReadFromKeyboard(item) {
        if (item.readAt) {
            return;
        }
        this._trackAction('mark-read');
        // Only grey the row out once the write landed — it used to do so
        // regardless, so a failed PATCH left a row that looked read until the
        // next reload put it back.
        if (await this.markReadReporting(item.id)) {
            this.applyItemReadLocally(item.id);
        }
    }

    /** Row class + header tiles/toolbar after a read without a full re-render. */
    applyItemReadLocally(id) {
        const card = document.querySelector(`[data-inbox-id="${CSS.escape(String(id))}"]`);
        card?.classList.remove('is-unread');
        card?.classList.add('is-read');
        this.refreshInboxSummary();
    }

    /**
     * Sync summary tiles, header badges, and toolbar bulk buttons with this.items
     * after a lightweight mutation (mark read, open) rather than rebuilding the feed.
     */
    refreshInboxSummary() {
        const container = document.getElementById('dashboard-layout');
        if (!container?.classList.contains('inbox-layout') || !this.isActiveView()) {
            return;
        }

        // Same definitions render() uses, or a mark-read would quietly restate the
        // counts under a different rule than the ones drawn a moment ago.
        const count = this.filterCount('all');
        const unread = this.unreadCount();
        const readCount = this.activeItems().filter((entry) => entry.readAt).length;
        const snoozedCount = this.snoozedCount();
        const weekCount = this.weekAddedCount();

        const countBadge = container.querySelector('.inbox-count-badge');
        if (countBadge) {
            countBadge.textContent = String(count);
        }

        const headerMeta = container.querySelector('.inbox-header-meta');
        if (headerMeta) {
            let unreadBadge = headerMeta.querySelector('.inbox-unread-badge');
            if (unread > 0) {
                if (!unreadBadge) {
                    unreadBadge = document.createElement('span');
                    unreadBadge.className = 'inbox-unread-badge';
                    headerMeta.appendChild(unreadBadge);
                }
                unreadBadge.textContent = `${unread} ${this.t('dashboard.inboxUnread', 'unread')}`;
            } else {
                unreadBadge?.remove();
            }
        }

        const tileValues = { all: count, unread, snoozed: snoozedCount };
        container.querySelectorAll('[data-inbox-tile]').forEach((btn) => {
            const key = btn.getAttribute('data-inbox-tile');
            const value = tileValues[key];
            if (value === undefined) {
                return;
            }
            const valueEl = btn.querySelector('.inbox-tile-value');
            if (valueEl) {
                valueEl.textContent = String(value);
            }
            btn.classList.toggle('inbox-tile--zero', value === 0);
        });
        const weekValueEl = container.querySelector('.inbox-tiles > .inbox-tile:not([data-inbox-tile]) .inbox-tile-value');
        if (weekValueEl) {
            weekValueEl.textContent = String(weekCount);
            weekValueEl.closest('.inbox-tile')?.classList.toggle('inbox-tile--zero', weekCount === 0);
        }

        const toolbar = container.querySelector('.inbox-toolbar');
        if (!toolbar) {
            return;
        }

        // The pills carry counts too, and this path skips the toolbar rebuild.
        toolbar.querySelectorAll('[data-inbox-filter]').forEach((btn) => {
            const countEl = btn.querySelector('.inbox-filter-count');
            if (countEl) {
                countEl.textContent = String(this.filterCount(btn.getAttribute('data-inbox-filter')));
            }
        });

        let markAllBtn = toolbar.querySelector('[data-inbox-bulk="read"]');
        if (unread > 0) {
            if (!markAllBtn) {
                markAllBtn = document.createElement('button');
                markAllBtn.type = 'button';
                markAllBtn.className = 'inbox-bulk-btn';
                markAllBtn.dataset.inboxBulk = 'read';
                markAllBtn.textContent = this.t('dashboard.inboxMarkAllRead', 'Mark all read');
                markAllBtn.addEventListener('click', () => {
                    void this.markAllRead();
                });
                toolbar.querySelector('.inbox-triage-btn')?.before(markAllBtn);
            }
        } else {
            markAllBtn?.remove();
        }

        let clearReadBtn = toolbar.querySelector('[data-inbox-bulk="clear-read"]');
        if (readCount > 0) {
            if (!clearReadBtn) {
                clearReadBtn = document.createElement('button');
                clearReadBtn.type = 'button';
                clearReadBtn.className = 'inbox-bulk-btn';
                clearReadBtn.dataset.inboxBulk = 'clear-read';
                clearReadBtn.textContent = this.t('dashboard.inboxClearRead', 'Clear read');
                clearReadBtn.addEventListener('click', () => {
                    void this.clearReadItems();
                });
                toolbar.querySelector('.inbox-triage-btn')?.before(clearReadBtn);
            }
        } else {
            clearReadBtn?.remove();
        }
    }

    /* ── Snooze ────────────────────────────────────────────────────────────── */

    /**
     * Preset snooze durations. Each resolves to an absolute wake time at call time
     * (so "tomorrow" is anchored to the real clock, not a fixed offset).
     */
    snoozeDurations() {
        const now = new Date();
        const at = (d) => d.getTime();
        const laterToday = new Date(now.getTime() + 3 * 3600000);
        const tomorrowMorning = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
        const weekend = (() => {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
            // 6 = Saturday. Advance to the next Saturday (at least one day out).
            do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 6);
            return d;
        })();
        const nextWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 9, 0, 0, 0);
        return [
            { key: '3h', label: this.t('dashboard.inboxSnooze3h', 'In 3 hours'), until: at(laterToday) },
            { key: 'tomorrow', label: this.t('dashboard.inboxSnoozeTomorrow', 'Tomorrow'), until: at(tomorrowMorning) },
            { key: 'weekend', label: this.t('dashboard.inboxSnoozeWeekend', 'This weekend'), until: at(weekend) },
            { key: 'week', label: this.t('dashboard.inboxSnoozeNextWeek', 'Next week'), until: at(nextWeek) },
        ];
    }

    /** yyyy-mm-dd in local time, which is what <input type="date"> expects. */
    dateInputValue(ts) {
        const d = new Date(Number(ts) || Date.now());
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    /**
     * yyyy-mm-dd back to a timestamp at 09:00 local, matching the presets.
     *
     * Built from parts rather than parsed: `new Date('2026-08-01')` is UTC
     * midnight, which lands on the previous day for anyone west of Greenwich.
     */
    parseDateInput(value) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
        if (!m) return 0;
        const [, y, mo, d] = m;
        const at = new Date(Number(y), Number(mo) - 1, Number(d), 9, 0, 0, 0);
        return Number.isNaN(at.getTime()) ? 0 : at.getTime();
    }

    /**
     * Small popover of preset durations anchored to the Snooze button.
     *
     * `bulkTargets` reuses the same menu for the selection bar, so one date
     * picker and one preset list serve both paths rather than drifting apart.
     * `options.onApplied` runs after a single-item snooze (triage) instead of
     * the default full re-render path.
     */
    openSnoozeMenu(item, anchor, bulkTargets = null, options = {}) {
        this.closeSnoozeMenu();
        const menu = document.createElement('div');
        menu.className = 'inbox-snooze-menu';
        menu.setAttribute('role', 'menu');
        // Presets cover the common cases; the date field covers everything else.
        // Without it there is no way to park a link beyond "next week" at all.
        const minDate = this.dateInputValue(Date.now() + 86400000);
        menu.innerHTML = this.snoozeDurations()
            .map((d) => `<button type="button" class="inbox-snooze-option" role="menuitem" data-snooze-until="${d.until}">${this.escape(d.label)}</button>`)
            .join('')
            + `<div class="inbox-snooze-custom">
                <label class="inbox-snooze-custom-label" for="inbox-snooze-date">${this.escape(
                    this.t('dashboard.inboxSnoozeCustom', 'Pick a date')
                )}</label>
                <input type="date" id="inbox-snooze-date" class="inbox-snooze-date" min="${minDate}"
                    aria-label="${this.escape(this.t('dashboard.inboxSnoozeCustom', 'Pick a date'))}">
            </div>`;
        document.body.appendChild(menu);
        this._snoozeMenu = menu;

        // Position under the anchor, flipped up when there is no room below.
        const rect = anchor?.getBoundingClientRect?.();
        if (rect) {
            menu.style.left = `${Math.round(rect.left)}px`;
            const below = rect.bottom + 6;
            if (below + menu.offsetHeight > window.innerHeight - 8) {
                menu.style.top = `${Math.round(rect.top - menu.offsetHeight - 6)}px`;
            } else {
                menu.style.top = `${Math.round(below)}px`;
            }
        }

        const apply = (until) => {
            this.closeSnoozeMenu();
            if (Array.isArray(bulkTargets)) {
                void this.bulkSnooze(bulkTargets, until);
            } else if (typeof options.onApplied === 'function') {
                void (async () => {
                    const value = Number(until);
                    if (!(value > Date.now())) {
                        return;
                    }
                    this._trackAction('snooze');
                    const d = this.dash;
                    try {
                        await this.patchSnooze(item.id, value);
                        d.pageNav?.updateInboxTabBadge?.();
                        await options.onApplied(item, value);
                        d.showNotification(
                            this.t('dashboard.inboxSnoozedToast', 'Snoozed until {time}', {
                                time: this.formatSnoozeWake(value),
                            }),
                            'success',
                            {
                                duration: 6000,
                                undoCallback: async () => {
                                    try {
                                        await this.patchSnooze(item.id, 0);
                                        d.pageNav?.updateInboxTabBadge?.();
                                        if (this.isActiveView()) {
                                            this.render();
                                        }
                                    } catch {
                                        d.showNotification(
                                            this.t('dashboard.inboxSnoozeFailed', 'Could not snooze the link'),
                                            'error'
                                        );
                                    }
                                },
                            }
                        );
                    } catch {
                        d.showNotification(this.t('dashboard.inboxSnoozeFailed', 'Could not snooze the link'), 'error');
                    }
                })();
            } else {
                void this.snoozeItem(item, until);
            }
        };

        menu.querySelectorAll('[data-snooze-until]').forEach((btn) => {
            btn.addEventListener('click', () => {
                apply(Number(btn.getAttribute('data-snooze-until')) || 0);
            });
        });
        const dateInput = menu.querySelector('.inbox-snooze-date');
        dateInput?.addEventListener('change', () => {
            const until = this.parseDateInput(dateInput.value);
            // An empty or past date is a mis-tap, not an instruction to wake now.
            if (!until || until <= Date.now()) return;
            apply(until);
        });
        // The picker's own Escape/Enter must not reach the menu's global handlers.
        dateInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') return;
            e.stopPropagation();
        });

        menu.querySelector('.inbox-snooze-option')?.focus({ preventScroll: true });

        // Dismiss on outside click or Escape.
        this._snoozeOutside = (e) => {
            if (!menu.contains(e.target) && !anchor?.contains?.(e.target)) {
                this.closeSnoozeMenu();
            }
        };
        this._snoozeEsc = (e) => {
            if (e.key === 'Escape') {
                e.stopImmediatePropagation();
                this.closeSnoozeMenu();
                anchor?.focus?.({ preventScroll: true });
                return;
            }
            // role="menu" promises arrow navigation; without it the presets were
            // reachable only by Tab, which the menu role tells readers not to use.
            // The date field is the last stop so a custom date stays keyboard-only.
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
                return;
            }
            if (!menu.contains(document.activeElement)) {
                return;
            }
            const stops = [...menu.querySelectorAll('[role="menuitem"]')];
            if (dateInput) {
                stops.push(dateInput);
            }
            if (!stops.length) {
                return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            const last = stops.length - 1;
            const current = stops.indexOf(document.activeElement);
            const next = e.key === 'Home' ? 0
                : e.key === 'End' ? last
                    : e.key === 'ArrowDown' ? (current >= last ? 0 : current + 1)
                        : (current <= 0 ? last : current - 1);
            stops[next]?.focus({ preventScroll: true });
        };
        setTimeout(() => document.addEventListener('click', this._snoozeOutside, true), 0);
        document.addEventListener('keydown', this._snoozeEsc, true);
    }

    closeSnoozeMenu() {
        if (this._snoozeOutside) {
            document.removeEventListener('click', this._snoozeOutside, true);
            this._snoozeOutside = null;
        }
        if (this._snoozeEsc) {
            document.removeEventListener('keydown', this._snoozeEsc, true);
            this._snoozeEsc = null;
        }
        this._snoozeMenu?.remove();
        this._snoozeMenu = null;
    }

    /** Persist a snooze wake time (or 0 to wake) via PATCH. */
    async patchSnooze(id, snoozedUntil) {
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await fetcher('/api/inbox', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, snoozedUntil }),
        });
        if (!res.ok) {
            throw new Error(`inbox snooze HTTP ${res.status}`);
        }
        const body = await res.json().catch(() => ({}));
        const stored = this.items.find((entry) => entry.id === id);
        if (stored) {
            stored.snoozedUntil = Number(body?.item?.snoozedUntil || 0);
        }
        return stored;
    }

    async snoozeItem(item, until) {
        const d = this.dash;
        if (!(Number(until) > Date.now())) {
            return;
        }
        this._trackAction('snooze');
        try {
            await this.patchSnooze(item.id, until);
            this.dash.pageNav?.updateInboxTabBadge?.();
            if (this.isActiveView()) {
                this.render();
            }
            d.showNotification(
                this.t('dashboard.inboxSnoozedToast', 'Snoozed until {time}', { time: this.formatSnoozeWake(until) }),
                'success',
                {
                    duration: 6000,
                    undoCallback: async () => {
                        try {
                            await this.patchSnooze(item.id, 0);
                            this.dash.pageNav?.updateInboxTabBadge?.();
                            if (this.isActiveView()) this.render();
                        } catch {
                            d.showNotification(this.t('dashboard.inboxSnoozeFailed', 'Could not snooze the link'), 'error');
                        }
                    },
                }
            );
        } catch {
            d.showNotification(this.t('dashboard.inboxSnoozeFailed', 'Could not snooze the link'), 'error');
        }
    }

    async wakeItem(item) {
        const d = this.dash;
        this._trackAction('wake');
        try {
            await this.patchSnooze(item.id, 0);
            this.dash.pageNav?.updateInboxTabBadge?.();
            if (this.isActiveView()) {
                this.render();
            }
            d.showNotification(this.t('dashboard.inboxWokeToast', 'Back in the Inbox'), 'success', { duration: 2500 });
        } catch {
            d.showNotification(this.t('dashboard.inboxWakeFailed', 'Could not wake the link'), 'error');
        }
    }

    /** Human-readable wake time: a weekday + time, or "today HH:MM" when soon. */
    formatSnoozeWake(ts) {
        const value = Number(ts || 0);
        if (!value) return '';
        const wake = new Date(value);
        const now = new Date();
        const sameDay = wake.getFullYear() === now.getFullYear()
            && wake.getMonth() === now.getMonth()
            && wake.getDate() === now.getDate();
        const time = window.NextDashClock.formatTime(wake, this.dash?.settings);
        if (sameDay) {
            return this.t('dashboard.inboxSnoozeWakeToday', 'today {time}', { time });
        }
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const isTomorrow = wake.getFullYear() === tomorrow.getFullYear()
            && wake.getMonth() === tomorrow.getMonth()
            && wake.getDate() === tomorrow.getDate();
        if (isTomorrow) {
            return this.t('dashboard.inboxSnoozeWakeTomorrow', 'tomorrow {time}', { time });
        }
        const day = wake.toLocaleDateString(this.localeTag(), { weekday: 'short', day: 'numeric', month: 'short' });
        return `${day} ${time}`;
    }

    /** AppModal.confirm when present, window.confirm as the fallback. */
    async confirm(title, message, { danger = false } = {}) {
        if (typeof window.AppModal?.confirm === 'function') {
            return Boolean(await window.AppModal.confirm({
                title: title || '',
                message,
                confirmText: danger
                    ? this.t('dashboard.inboxClearReadAction', 'Clear')
                    : this.t('dashboard.inboxConfirmAction', 'Confirm'),
                cancelText: this.t('dashboard.healthCancel', 'Cancel'),
                confirmClass: danger ? 'danger' : '',
            }));
        }
        return window.confirm(message);
    }

    /**
     * Mark every unread item in the current view read in one go. Scoped to the
     * active filter/search (getFilteredItems) so the button does what the list
     * shows, not silently more.
     */
    async markAllRead() {
        const targets = this.getFilteredItems().filter((item) => !item.readAt);
        if (!targets.length) {
            return;
        }
        // One event for the whole run — markRead() per item would spam.
        this._trackAction('mark-all-read', { size: this._countBucket(targets.length) });
        // This branch was unreachable until markRead started throwing: it
        // resolved on failure too, so `failed` was always zero and the toast
        // claimed the whole batch had been marked.
        const results = await Promise.allSettled(targets.map((item) => this.markRead(item.id)));
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (this.isActiveView()) {
            this.render();
        }
        this.dash.showNotification(
            failed
                ? this.t('dashboard.inboxMarkAllReadPartial', 'Marked read, {count} failed', { count: failed })
                : this.t('dashboard.inboxMarkAllReadDone', 'Marked {count} read', { count: targets.length }),
            failed ? 'info' : 'success',
            { duration: 3000 }
        );
    }

    /**
     * Delete every read item. Snapshots them first so a single Undo can restore the
     * whole batch — a destructive bulk action needs an escape hatch.
     *
     * Snoozed rows are spared. They are invisible here, they are not counted by the
     * button that starts this, and deleting something the user deferred to a later
     * date — without it ever appearing in the confirm count — is the kind of
     * surprise an Undo should not have to be the answer to.
     */
    async clearReadItems() {
        // The rows on screen, not every awake read row: deleting past the edge of
        // a search or a site filter is not what the button in that view offers.
        const targets = this.getFilteredItems().filter((item) => item.readAt);
        if (!targets.length) {
            return;
        }
        this._trackAction('clear-read', { size: this._countBucket(targets.length) });
        const confirmed = await this.confirm(
            this.t('dashboard.inboxClearRead', 'Clear read'),
            this.t('dashboard.inboxClearReadConfirm', 'Remove {count} read links from the Inbox?', { count: targets.length }),
            { danger: true }
        );
        if (!confirmed) {
            return;
        }
        const d = this.dash;
        const snapshots = targets.map((item) => JSON.parse(JSON.stringify(item)));
        const results = await Promise.allSettled(targets.map((item) => this.deleteItem(item.id)));
        const removed = results.filter((r) => r.status === 'fulfilled').length;
        if (this.isActiveView()) {
            this.render();
        } else {
            await this.refreshBadge();
        }
        if (!removed) {
            d.showNotification(this.t('dashboard.inboxClearReadFailed', 'Could not clear read links'), 'error');
            return;
        }
        d.showNotification(
            this.t('dashboard.inboxClearReadDone', 'Removed {count} read links', { count: removed }),
            'success',
            {
                duration: 8000,
                undoCallback: async () => {
                    const restores = await Promise.allSettled(snapshots.map((snap) => this.restoreItem(snap)));
                    const back = restores.filter((r) => r.status === 'fulfilled' && r.value).length;
                    if (this.isActiveView()) {
                        await this.loadAndRender();
                    } else {
                        await this.refreshBadge();
                    }
                    d.showNotification(
                        back
                            ? this.t('dashboard.inboxClearReadRestored', 'Restored {count} links', { count: back })
                            : this.t('dashboard.inboxUndoFailed', 'Could not restore'),
                        back ? 'success' : 'error',
                        { duration: 3000 }
                    );
                },
            }
        );
    }


    getVisibleItemCards() {
        return Array.from(document.querySelectorAll('.inbox-feed .inbox-item'));
    }


    moveKeyboardSelection(delta, cards) {
        const list = Array.isArray(cards) && cards.length ? cards : this.getVisibleItemCards();
        if (!list.length) {
            return;
        }
        let index = this.selectedItemId
            ? list.findIndex((card) => card.dataset.inboxId === this.selectedItemId)
            : -1;
        if (index < 0) {
            index = delta > 0 ? 0 : list.length - 1;
        } else {
            index += delta;
            if (index < 0) {
                index = list.length - 1;
            } else if (index >= list.length) {
                index = 0;
            }
        }
        this.selectedItemId = list[index]?.dataset?.inboxId || null;
        this.applyKeyboardSelection(list);
    }


    applyKeyboardSelection(cards) {
        const list = Array.isArray(cards) && cards.length ? cards : this.getVisibleItemCards();
        list.forEach((card) => {
            const selected = card.dataset.inboxId === this.selectedItemId;
            card.classList.toggle('keyboard-selected', selected);
            // aria-current, not aria-selected: an <article> has no selected
            // state in ARIA, so the attribute was dropped and the row a screen
            // reader was sitting on read no differently from the rest.
            if (selected) {
                card.setAttribute('aria-current', 'true');
            } else {
                card.removeAttribute('aria-current');
            }
            if (selected) {
                card.scrollIntoView({
                    block: 'nearest',
                    behavior: document.body?.classList.contains('no-animations') ? 'instant' : 'smooth',
                });
            }
        });
    }


    clearKeyboardSelection() {
        this.selectedItemId = null;
        this.unbindPointerNavigation();
        this.closeSnoozeMenu();
        if (this._previewRefreshTimer) {
            clearTimeout(this._previewRefreshTimer);
            this._previewRefreshTimer = null;
        }
        if (this._wakeTimer) {
            clearTimeout(this._wakeTimer);
            this._wakeTimer = null;
        }
        document.querySelectorAll('.inbox-item.keyboard-selected').forEach((card) => {
            card.classList.remove('keyboard-selected');
            card.removeAttribute('aria-current');
        });
    }


    syncKeyboardSelectionAfterRender() {
        if (document.activeElement?.classList?.contains('inbox-search-input')) {
            return;
        }
        const cards = this.getVisibleItemCards();
        if (!this.selectedItemId || !cards.some((card) => card.dataset.inboxId === this.selectedItemId)) {
            this.selectedItemId = null;
        }
        this.applyKeyboardSelection(cards);
    }


    /**
     * The durable lifetime aggregate behind /api/inbox-stats.
     *
     * Fetched lazily and only when the panel is open, because it answers a
     * different question from the feed and most visits never ask it. Kept as
     * null on failure so the panel can say so rather than render zeros as if
     * they were real.
     */
    async loadStats() {
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/inbox-stats');
            if (!res.ok) throw new Error(`inbox stats HTTP ${res.status}`);
            this.stats = await res.json();
            this._statsFailed = false;
        } catch {
            this.stats = null;
            this._statsFailed = true;
        }
        if (this.isActiveView()) {
            this.render();
        }
    }

    /** Toggle the stats panel, loading the aggregate the first time it opens. */
    toggleStats() {
        this.statsOpen = !this.statsOpen;
        window.nextdashTrack?.('inbox:stats-toggle', { open: this.statsOpen });
        if (this.statsOpen && !this.stats && !this._statsFailed) {
            void this.loadStats();
            return;
        }
        this.render();
    }

    /** "3d" / "5h" / "20m", matching the config stats panel's format. */
    formatRetention(ms) {
        const n = Number(ms);
        if (!Number.isFinite(n) || n <= 0) return '—';
        const days = n / 86400000;
        if (days >= 1) return this.t('dashboard.inboxStatsDays', '{n}d', { n: Math.round(days) });
        const hours = n / 3600000;
        if (hours >= 1) return this.t('dashboard.inboxStatsHours', '{n}h', { n: Math.round(hours) });
        return this.t('dashboard.inboxStatsMinutes', '{n}m', { n: Math.max(1, Math.round(n / 60000)) });
    }

    /**
     * Lifetime figures for this inbox: how much comes in, how much becomes a
     * bookmark, and how long things sit here.
     *
     * The endpoint has existed all along but was only ever read by the config
     * view. "Am I actually promoting these, or just hoarding them" is the
     * inbox's own question, and answering it needed no new backend — the same
     * way the health view puts its fleet panel in the view rather than in
     * config.
     */
    renderStatsPanel() {
        if (!this.statsOpen) return null;

        const panel = document.createElement('section');
        panel.className = 'inbox-stats';
        panel.setAttribute('aria-label', this.t('dashboard.inboxStatsTitle', 'Inbox statistics'));

        if (this._statsFailed) {
            panel.innerHTML = `<p class="inbox-stats-empty">${this.escape(
                this.t('dashboard.inboxStatsFailed', 'Could not load statistics')
            )}</p>`;
            return panel;
        }
        if (!this.stats) {
            panel.innerHTML = `<p class="inbox-stats-empty">${this.escape(
                this.t('dashboard.inboxLoading', 'Loading…')
            )}</p>`;
            return panel;
        }

        const s = this.stats;
        const added = Number(s.totalAdded) || 0;
        const promoted = Number(s.totalPromoted) || 0;
        const deleted = Number(s.totalDeleted) || 0;
        const retentionCount = Number(s.retentionCount) || 0;
        const avgRetention = retentionCount
            ? Number(s.sumRetentionMs) / retentionCount
            : 0;
        const promoteRate = this.promoteRateFromStats(s);

        // The hint is read, not hovered. As a title it was unreachable from the
        // keyboard and on touch, which is where "Promote rate 55%" beside
        // "Added 19" is at its most misleading — the rate is not 6 of 19.
        const stat = (label, value, hint = '') => `
            <div class="inbox-stat">
                <span class="inbox-stat-label">${this.escape(label)}</span>
                <span class="inbox-stat-value">${this.escape(String(value))}</span>
                ${hint ? `<span class="inbox-stat-hint">${this.escape(hint)}</span>` : ''}
            </div>`;

        const trend = this.weekTrendFromStats(s);
        const trendLine = trend
            ? `<p class="inbox-stats-trend" data-inbox-trend>${this.escape(
                this.t('dashboard.inboxStatsWeek', '{added} arrived and {handled} were dealt with this week.')
                    .replace('{added}', String(trend.added))
                    .replace('{handled}', String(trend.handled))
            )} <button type="button" class="inbox-stats-trend-link" data-inbox-trend-more>${this.escape(
                this.t('dashboard.inboxStatsWeekMore', 'See the trend')
            )}</button></p>`
            : '';

        const since = Number(s.firstEventAt) || 0;
        const sinceLine = since
            ? `<p class="inbox-stats-since">${this.escape(
                this.t('dashboard.inboxStatsSince', 'Since {date}', {
                    date: new Date(since).toLocaleDateString(this.localeTag()),
                })
            )}</p>`
            : '';

        panel.innerHTML = `
            <div class="inbox-stats-grid">
                ${stat(this.t('dashboard.inboxStatsAdded', 'Added'), added)}
                ${stat(this.t('dashboard.inboxStatsPromoted', 'Promoted'), promoted)}
                ${stat(this.t('dashboard.inboxStatsDeleted', 'Deleted'), deleted)}
                ${promoteRate === null
                    ? ''
                    : stat(
                        this.t('dashboard.inboxStatsPromoteRate', 'Promote rate'),
                        `${promoteRate}%`,
                        this.t('dashboard.inboxStatsPromoteRateHint',
                            'Of the links you decided on, how many became bookmarks')
                    )}
                ${stat(
                    this.t('dashboard.inboxStatsRetention', 'Average stay'),
                    this.formatRetention(avgRetention),
                    this.t('dashboard.inboxStatsRetentionHint',
                        'How long a link sits here before you deal with it')
                )}
            </div>
            ${trendLine}
            ${sinceLine}`;
        // The chart itself lives in Config -> Statistics -> Inbox, which draws
        // the same buckets over a period you can pick. Building a second one in
        // a panel this size would be a worse copy of it.
        panel.querySelector('[data-inbox-trend-more]')?.addEventListener('click', () => {
            window.DashboardWidgetUtils?.openConfigTab?.(this.dash, 'stats', 'inbox');
        });
        return panel;
    }

    /**
     * Re-fetch the feed on demand.
     *
     * loadAndRender has always accepted `refresh`, but nothing ever passed it:
     * after the first load the list only changed through the preview poll or the
     * view's own mutations, so a link added from the extension or another tab
     * never appeared. Bound to R, as in the health view.
     */
    async refreshFromKeyboard() {
        window.nextdashTrack?.('inbox:refresh');
        await this.loadAndRender({ refresh: true });
        this.dash.showNotification?.(
            this.t('dashboard.inboxRefreshed', 'Inbox refreshed'),
            'success',
            { duration: 1500 }
        );
    }

    async loadAndRender({ refresh = false } = {}) {
        const needsFetch = refresh || !this._itemsLoaded;
        this.loading = needsFetch && !(this.items && this.items.length);
        if (this.loading) {
            this.render();
        }
        if (needsFetch) {
            try {
                await this.fetchItems();
                this._loadFailed = false;
            } catch {
                // Recorded so render() can tell "the load failed" from "there is
                // nothing here". Without it an unreachable server produced an
                // empty list, and the empty state told the user their inbox was
                // empty and invited them to add to it.
                this._loadFailed = true;
                if (!this.items?.length) {
                    this.items = [];
                }
            }
        }
        this.loading = false;
        if (this.focusItemId) {
            if (!this.prepareItemFocus(this.focusItemId)) {
                this.dash.showNotification?.(
                    this.t('dashboard.inboxDeepLinkNotFound', 'That inbox link is no longer available'),
                    'info'
                );
                this.focusItemId = null;
            }
        }
        this.render();
    }

    /** True while an item is snoozed into the future (hidden from the main list). */
    isSnoozed(item) {
        return Number(item?.snoozedUntil || 0) > Date.now();
    }

    snoozedCount() {
        return (this.items || []).filter((item) => this.isSnoozed(item)).length;
    }

    /**
     * Resolve a stored icon filename to a loadable src, matching the dashboard and
     * health view: bare filenames are served from /data/icons/; absolute and
     * root-relative URLs are left as-is. Returns '' when there is no icon.
     */
    resolveIconSrc(icon) {
        const value = String(icon || '').trim();
        if (!value) {
            return '';
        }
        if (/^(https?:|data:|\/)/i.test(value)) {
            return value;
        }
        return `/data/icons/${encodeURIComponent(value)}`;
    }

    /**
     * Items added in the last 7 days — the "this week" summary tile.
     *
     * Snoozed items are left out even though nothing filters to this tile: it sits
     * in a row with three that do, and counting a link the other three have agreed
     * to hide made one tile in four answer a different question.
     */
    weekAddedCount() {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        // Narrowed like the tiles beside it: four numbers in one row that answer
        // to different sets of rows is what makes a summary unreadable.
        return this.narrowItems(this.activeItems())
            .filter((item) => Number(item.addedAt || 0) >= cutoff).length;
    }

    /**
     * Absolute added date for a row, e.g. "3 Jul". The year is added only when the
     * item is not from the current year, so recent links stay compact. Sits beside
     * the relative "3d ago" label — one answers "how long ago", the other "when".
     */
    formatAddedDate(ts) {
        const value = Number(ts || 0);
        if (!value) {
            return '';
        }
        const date = new Date(value);
        const opts = { day: 'numeric', month: 'short' };
        if (date.getFullYear() !== new Date().getFullYear()) {
            opts.year = 'numeric';
        }
        return date.toLocaleDateString(this.localeTag(), opts);
    }

    /**
     * What the active pill selects, before the site, tag and search controls
     * narrow it any further.
     *
     * Split out of getFilteredItems so the domain picker and the pill counts can
     * ask the same question without repeating the rule — the picker used to read
     * this.items directly, which is how a site whose only link was asleep stayed
     * on offer and then answered with "no matching links".
     */
    filterBaseItems() {
        const list = Array.isArray(this.items) ? this.items.slice() : [];
        if (this.filter === 'snoozed') {
            // Snoozed view: only sleeping items, soonest to wake first.
            return list
                .filter((item) => this.isSnoozed(item))
                .sort((a, b) => Number(a.snoozedUntil || 0) - Number(b.snoozedUntil || 0));
        }
        // All / Unread hide anything still snoozed; an elapsed snooze reappears.
        const awake = list.filter((item) => !this.isSnoozed(item));
        if (this.filter === 'unread') {
            return awake.filter((item) => !item.readAt);
        }
        if (this.filter === 'noted') {
            return awake.filter((item) => String(item.note || '').trim());
        }
        return awake;
    }

    /**
     * Apply the site, tag and search controls to a list.
     *
     * `skip` leaves one of them out, which is what lets the site picker count
     * what each option would yield without counting itself away to one.
     */
    narrowItems(items, skip = '') {
        let list = items;
        const domainWant = skip === 'domain' ? '' : String(this.domainFilter || '').trim().toLowerCase();
        if (domainWant) {
            list = list.filter((item) => this.itemDomain(item) === domainWant);
        }
        const tagWant = String(this.tagFilter || '').trim().toLowerCase();
        if (tagWant) {
            list = list.filter((item) => (Array.isArray(item.tags) ? item.tags : [])
                .some((tag) => String(tag).toLowerCase() === tagWant));
        }
        const query = String(this.searchQuery || '').trim().toLowerCase();
        if (query) {
            list = list.filter((item) => {
                const haystack = [
                    item.url,
                    item.title,
                    item.previewTitle,
                    // The fetched summary, under the name the API actually
                    // sends: this read item.previewDescription for a day, a key
                    // that is never on the object, so the one consumer of the
                    // summary matched nothing at all.
                    item.previewDesc,
                    item.domain,
                    item.note,
                    // Tags were stored and never searched, so a link findable by
                    // its tag in principle was not findable in practice.
                    ...(Array.isArray(item.tags) ? item.tags : []),
                ].filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(query);
            });
        }
        return list;
    }

    getFilteredItems() {
        return this.sortItems(this.narrowItems(this.filterBaseItems()));
    }

    /** Whether a site, tag or search control is currently holding rows back. */
    isNarrowed() {
        return Boolean(String(this.domainFilter || '').trim()
            || String(this.tagFilter || '').trim()
            || String(this.searchQuery || '').trim());
    }

    /**
     * The locale the app is set to, for the date and time formatters.
     *
     * Left to the browser they answered in whatever language the browser is in,
     * so a Dutch dashboard printed English month names. Same source the clock in
     * the header reads.
     */
    localeTag() {
        const d = this.dash;
        return String(d?.settings?.language
            || document.documentElement.getAttribute('data-lang')
            || 'en');
    }

    /**
     * Distinct site hosts on offer in the domain filter, with how many rows each
     * one would leave — the site list is scoped to the active pill, so it never
     * offers a site the pill itself has already filtered away.
     */
    domainOptions() {
        const scope = this.narrowItems(this.filterBaseItems(), 'domain');
        const counts = new Map();
        scope.forEach((item) => {
            const host = this.itemDomain(item);
            if (host) {
                counts.set(host, (counts.get(host) || 0) + 1);
            }
        });
        // A site chosen earlier stays listed even when the search has narrowed it
        // to nothing, or picking it would remove the control that undoes it.
        const chosen = String(this.domainFilter || '').trim().toLowerCase();
        if (chosen && !counts.has(chosen)) {
            counts.set(chosen, 0);
        }
        return [...counts.entries()]
            .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
            .map(([host, count]) => ({ host, count }));
    }

    /** Just the hosts on offer, for the code that only needs to know what exists. */
    uniqueDomains() {
        return this.domainOptions().map((entry) => entry.host);
    }

    /** Every host stored in the inbox, asleep or awake. */
    allDomains() {
        const hosts = new Set();
        (this.items || []).forEach((item) => {
            const host = this.itemDomain(item);
            if (host) {
                hosts.add(host);
            }
        });
        return [...hosts];
    }

    /**
     * Drop a site filter that no longer matches anything.
     *
     * The select is built from the hosts present right now, so deleting or
     * snoozing the last item from the selected site removes its <option> while
     * `domainFilter` still holds the host. The control then falls back to
     * displaying "All sites" while the filter is very much still applied: an empty
     * list, and nothing on screen admitting why. Clearing it keeps the control and
     * the filter describing the same thing.
     */
    pruneDomainFilter() {
        const want = String(this.domainFilter || '').trim().toLowerCase();
        if (!want) {
            return false;
        }
        // An empty list before the first fetch is "not known yet", not "no such
        // site": pruning against it would throw away a filter restored from
        // storage or a shared link during the loading render, before the items
        // that justify it have arrived.
        if (this.loading || !this._itemsLoaded) {
            return false;
        }
        // Against every stored host rather than the ones the active pill shows:
        // a site whose links are all asleep is still a site in the inbox, and
        // clearing the filter under the user would be the wrong answer to it.
        if (this.allDomains().includes(want)) {
            return false;
        }
        this.domainFilter = '';
        return true;
    }

    /**
     * Adjust filter/search/domain/limit so `id` will appear in the next render.
     * Returns false when the item does not exist.
     */
    prepareItemFocus(id) {
        const sid = String(id || '').trim();
        if (!sid) {
            return false;
        }
        const item = (this.items || []).find((entry) => entry.id === sid);
        if (!item) {
            return false;
        }

        if (this.isSnoozed(item)) {
            this.filter = 'snoozed';
        } else {
            if (this.filter === 'snoozed') {
                this.filter = 'all';
            }
            if (this.filter === 'unread' && item.readAt) {
                this.filter = 'all';
            }
            if (this.filter === 'noted' && !String(item.note || '').trim()) {
                this.filter = 'all';
            }
        }
        this.searchQuery = '';
        this.domainFilter = '';
        this.tagFilter = '';

        let filtered = this.getFilteredItems();
        let index = filtered.findIndex((entry) => entry.id === sid);
        if (index < 0) {
            this.filter = 'all';
            this.searchQuery = '';
            this.domainFilter = '';
            this.tagFilter = '';
            filtered = this.getFilteredItems();
            index = filtered.findIndex((entry) => entry.id === sid);
        }
        if (index < 0) {
            return false;
        }
        if (index >= this.visibleLimit) {
            this.visibleLimit = Math.ceil((index + 1) / 50) * 50;
        }

        this.focusItemId = sid;
        this.selectedItemId = sid;
        return true;
    }

    /**
     * Scroll to, select, and highlight one item. Adjusts filter/search/domain so
     * the row is visible — used for `?ib_id=` deep links and duplicate paste.
     */
    focusItem(id, { updateUrl = true } = {}) {
        if (!this.prepareItemFocus(id)) {
            return false;
        }
        if (updateUrl) {
            this.syncUrlState();
        }
        if (this.isActiveView()) {
            this.render();
        }
        return true;
    }

    applyPendingItemFocus() {
        const id = this.focusItemId;
        if (!id) {
            return;
        }
        const card = document.querySelector(`[data-inbox-id="${CSS.escape(String(id))}"]`);
        if (!card) {
            return;
        }
        // Consumed here, once the focus has actually landed. Leaving it set made
        // the request permanent: every later render re-selected and re-flashed
        // this row, yanking the cursor back from wherever the user had arrowed
        // to, and every later loadAndRender re-ran prepareItemFocus — which
        // clears searchQuery and domainFilter unconditionally. Undoing a bulk
        // delete therefore threw away the active search and site filter.
        this.focusItemId = null;
        this.selectedItemId = id;
        this.applyKeyboardSelection();
        this.highlightItem(id);
    }

    /**
     * The sort modes. "Snoozed" keeps its own soonest-to-wake order — sorting a
     * wake queue by title would hide the only thing that matters about it.
     *
     * Oldest-first is the one that earns its place: an inbox is worked from the
     * bottom, and without it a backlog is only reachable by scrolling past
     * everything newer.
     */
    sortItems(items) {
        if (this.filter === 'snoozed') return items;
        const sorted = [...items];
        const added = (item) => Number(item.addedAt || 0);
        const byTitle = (a, b) => this.displayTitle(a).localeCompare(this.displayTitle(b), undefined, { sensitivity: 'base' });
        switch (this.sort) {
            case 'oldest':
                return sorted.sort((a, b) => added(a) - added(b));
            case 'title':
                // Newest breaks a tie so two identically-titled captures keep a
                // stable order across re-renders.
                return sorted.sort((a, b) => byTitle(a, b) || added(b) - added(a));
            case 'domain':
                return sorted.sort((a, b) => this.itemDomain(a).localeCompare(this.itemDomain(b), undefined, { sensitivity: 'base' })
                    || added(b) - added(a));
            case 'newest':
            default:
                return sorted.sort((a, b) => added(b) - added(a));
        }
    }

    /** Sorting on a date is what the date groups already say; anything else is flat. */
    isGroupedSort() {
        return this.sort === 'newest' || this.sort === 'oldest' || this.filter === 'snoozed';
    }

    /** The text a title sort compares — the same string the row shows. */
    displayTitle(item) {
        return String(item?.title || item?.previewTitle || item?.url || '').trim();
    }

    /** Host for domain sort, falling back to the raw URL for unparseable input. */
    itemDomain(item) {
        const raw = String(item?.domain || '').trim();
        if (raw) return raw.toLowerCase();
        try {
            return new URL(String(item?.url || '')).hostname.replace(/^www\./, '').toLowerCase();
        } catch {
            return String(item?.url || '').toLowerCase();
        }
    }

    getDateGroupKey(ts) {
        const value = Number(ts || 0);
        if (!value) {
            return 'older';
        }
        const date = new Date(value);
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        const dayMs = 86400000;
        if (startOfDate >= startOfToday) {
            return 'today';
        }
        if (startOfDate >= startOfToday - dayMs) {
            return 'yesterday';
        }
        if (startOfDate >= startOfToday - (7 * dayMs)) {
            return 'week';
        }
        return 'older';
    }

    getDateGroupLabel(key) {
        const labels = {
            today: this.t('dashboard.inboxGroupToday', 'Today'),
            yesterday: this.t('dashboard.inboxGroupYesterday', 'Yesterday'),
            week: this.t('dashboard.inboxGroupThisWeek', 'This week'),
            older: this.t('dashboard.inboxGroupOlder', 'Older'),
        };
        return labels[key] || labels.older;
    }

    groupFilteredItems(items) {
        // The snoozed view groups by when items wake, not when they were added.
        if (this.filter === 'snoozed') {
            return this.groupSnoozedItems(items);
        }
        // Under a title or domain sort the date headings would cut the ordering
        // into pieces — an A–Z list restarting at every "Yesterday" is not sorted
        // in any sense the user asked for. One unlabelled group keeps it whole.
        if (!this.isGroupedSort()) {
            return items.length ? [{ key: 'flat', label: '', items }] : [];
        }
        const order = ['today', 'yesterday', 'week', 'older'];
        const buckets = new Map(order.map((key) => [key, []]));
        items.forEach((item) => {
            const key = this.getDateGroupKey(item.addedAt);
            buckets.get(key)?.push(item);
        });
        return order
            .map((key) => ({ key, label: this.getDateGroupLabel(key), items: buckets.get(key) || [] }))
            .filter((group) => group.items.length > 0);
    }

    /** Bucket snoozed items by how soon they wake: later today, tomorrow, this week, later. */
    groupSnoozedItems(items) {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const dayMs = 86400000;
        const order = ['wakeToday', 'wakeTomorrow', 'wakeWeek', 'wakeLater'];
        const labels = {
            wakeToday: this.t('dashboard.inboxSnoozeGroupToday', 'Later today'),
            wakeTomorrow: this.t('dashboard.inboxSnoozeGroupTomorrow', 'Tomorrow'),
            wakeWeek: this.t('dashboard.inboxSnoozeGroupThisWeek', 'This week'),
            wakeLater: this.t('dashboard.inboxSnoozeGroupLater', 'Later'),
        };
        const bucketFor = (ts) => {
            const wake = Number(ts || 0);
            const wakeDay = new Date(new Date(wake).getFullYear(), new Date(wake).getMonth(), new Date(wake).getDate()).getTime();
            if (wakeDay <= startOfToday) return 'wakeToday';
            if (wakeDay <= startOfToday + dayMs) return 'wakeTomorrow';
            if (wakeDay <= startOfToday + (7 * dayMs)) return 'wakeWeek';
            return 'wakeLater';
        };
        const buckets = new Map(order.map((key) => [key, []]));
        items.forEach((item) => buckets.get(bucketFor(item.snoozedUntil))?.push(item));
        return order
            .map((key) => ({ key, label: labels[key], items: buckets.get(key) || [] }))
            .filter((group) => group.items.length > 0);
    }

    async startTriage() {
        if (!this.isEnabled()) {
            return false;
        }
        if (!this.isActiveView()) {
            const opened = await this.openInboxView();
            if (!opened) {
                return false;
            }
        }
        /*
         * What is left to read, not everything on screen.
         *
         * The queue was getFilteredItems(), so on the default All filter an
         * inbox of five unread and thirty-five read handed back all forty --
         * links already dealt with, presented again as work. The manual has
         * promised "unread items one by one" in three places since the feature
         * shipped; this is the code catching up with it.
         *
         * The active filter still applies. Triage started from a tag or from
         * Snoozed walks the unread items of that selection rather than
         * quietly widening to the whole inbox, because the list in front of
         * you is what you asked to work through.
         */
        const items = this.getFilteredItems().filter((item) => !item?.readAt);
        return this.triage?.start(items) ?? false;
    }

    formatRelativeTime(ts) {
        const value = Number(ts || 0);
        if (!value) {
            return '';
        }
        const diff = Date.now() - value;
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) {
            return this.t('dashboard.inboxTimeJustNow', 'just now');
        }
        if (minutes < 60) {
            return this.t('dashboard.inboxTimeMinutes', '{count}m ago', { count: minutes });
        }
        const hours = Math.floor(minutes / 60);
        if (hours < 48) {
            return this.t('dashboard.inboxTimeHours', '{count}h ago', { count: hours });
        }
        const days = Math.floor(hours / 24);
        return this.t('dashboard.inboxTimeDays', '{count}d ago', { count: days });
    }

    /**
     * Keyboard cheatsheet under the feed, mirroring the health view. One copy at the
     * bottom; hidden from assistive tech since the actions it describes are the row
     * buttons a screen reader already reaches.
     */
    /**
     * The "nothing here" panel, worded for the filter that came up empty.
     *
     * An empty Unread list is the goal, not a dead end, and "No matching links"
     * reads like a failed search in the one case where the user has just finished
     * the job. A live search or site filter is the exception: there the reason the
     * list is empty is the query, not the state of the inbox, so it says so.
     */
    renderEmptyState() {
        const messages = {
            all: [
                this.t('dashboard.inboxEmptyAll', 'Inbox zero'),
                this.t('dashboard.inboxEmptyAllHint', 'Nothing is waiting. Paste a URL onto the dashboard to save one for later.'),
            ],
            unread: [
                this.t('dashboard.inboxEmptyUnread', 'No unread links'),
                this.t('dashboard.inboxEmptyUnreadHint', "You're all caught up. Read links stay in All until you clear them."),
            ],
            snoozed: [
                this.t('dashboard.inboxEmptySnoozed', 'Nothing is snoozed'),
                this.t('dashboard.inboxEmptySnoozedHint', 'Snooze a link with z to set it aside until a time you pick. It comes back on its own.'),
            ],
            noted: [
                this.t('dashboard.inboxEmptyNoted', 'No links with a note'),
                this.t('dashboard.inboxEmptyNotedHint', 'Press n on a link to record why you saved it, for when the title alone no longer says.'),
            ],
        };
        const [title, hint] = messages[this.filter] || messages.all;
        /*
         * A narrowing the reader just applied, so the empty result is about
         * that and not about the inbox being clear.
         *
         * This counted the search box and the site filter and forgot the tag
         * filter, while isNarrowed() a few hundred lines up counts all three --
         * so clicking a tag nothing carries answered "Inbox zero, nothing is
         * waiting" while the links sat there, hidden by the filter.
         */
        const narrowed = this.isNarrowed();

        const empty = document.createElement('div');
        empty.className = 'inbox-empty-state';
        empty.innerHTML = `
            <p class="inbox-empty-title">${this.escape(narrowed ? this.t('dashboard.inboxNoMatches', 'No matching links') : title)}</p>
            <p class="inbox-empty-hint">${this.escape(narrowed ? this.t('dashboard.inboxNoMatchesHint', 'Try another filter or search term') : hint)}</p>
            ${narrowed ? `<button type="button" class="inbox-empty-clear" data-inbox-clear-filters>${
                this.escape(this.t('dashboard.inboxClearFilters', 'Clear filters'))}</button>` : ''}
        `;
        // Offered only where there is something to clear, and it clears all
        // three: telling someone which of the filters is the one hiding their
        // links is work the view can do for them.
        empty.querySelector('[data-inbox-clear-filters]')?.addEventListener('click', () => {
            this.searchQuery = '';
            this.domainFilter = '';
            this.tagFilter = '';
            const box = document.querySelector('[data-inbox-search]');
            if (box) box.value = '';
            this.render();
        });
        return empty;
    }

    renderLegend() {
        const legend = document.createElement('p');
        legend.className = 'inbox-legend';
        legend.setAttribute('aria-hidden', 'true');
        const keys = window.KeyboardViewLegends
            ? window.KeyboardViewLegends.toLegendPairs(
                window.KeyboardViewLegends.INBOX_VIEW,
                (key, fallback) => this.t(`dashboard.${key}`, fallback),
            )
            : [];
        if (keys.length > 1) {
            keys.splice(2, 0, ['dblclick', this.t('dashboard.inboxKeyDblClick', 'open')]);
        }
        legend.innerHTML = keys
            .map(([k, label]) => `<span><kbd>${this.escape(k)}</kbd> ${this.escape(label)}</span>`)
            .join('');
        return legend;
    }

    _teardownLoadMoreObserver() {
        this._loadMoreObserver?.disconnect?.();
        this._loadMoreObserver = null;
    }

    /**
     * Loads the next page of rows when the sentinel nears the viewport, matching
     * the health view. Uses the document scroll — no nested feed scrollbar.
     */
    _bindLoadMoreObserver(sentinel, filteredLength) {
        this._teardownLoadMoreObserver();
        if (!sentinel || this.visibleLimit >= filteredLength) return;

        if (typeof IntersectionObserver !== 'function') {
            return;
        }

        this._loadMoreObserver = new IntersectionObserver((entries) => {
            if (!this.isActiveView()) return;
            if (!entries.some((entry) => entry.isIntersecting)) return;
            const total = this.getFilteredItems().length;
            if (this.visibleLimit >= total) {
                this._teardownLoadMoreObserver();
                return;
            }
            // A feed says when it is loading; without it the rows simply appear
            // and a screen reader has nothing to relate them to.
            document.querySelector('.inbox-feed')?.setAttribute('aria-busy', 'true');
            this.visibleLimit = Math.min(total, this.visibleLimit + 50);
            this.render();
        }, { root: null, rootMargin: '320px 0px' });
        this._loadMoreObserver.observe(sentinel);
    }

    _appendLoadMoreFallback(container, filteredLength) {
        if (this.visibleLimit >= filteredLength) return;
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'inbox-load-more-btn';
        const remaining = filteredLength - this.visibleLimit;
        more.textContent = this.t('dashboard.inboxLoadMore', 'Show {count} more', { count: remaining });
        more.addEventListener('click', () => {
            this.visibleLimit = Math.min(filteredLength, this.visibleLimit + 50);
            this.render();
        });
        container.appendChild(more);
    }

    scheduleSearchRender() {
        if (this._searchRenderTimer) {
            clearTimeout(this._searchRenderTimer);
        }
        this._searchRenderTimer = setTimeout(() => {
            this._searchRenderTimer = null;
            // Ticks from a previous query would act on rows the user can no longer
            // see, so a search change starts the selection over (same as filter).
            this.checkedIds.clear();
            // The deep-link target is spent once its row has been shown; keeping it
            // would drag focus back to that row on every later keystroke.
            this.focusItemId = null;
            // Debounced with the render: syncing on every keystroke would rewrite
            // the address bar a dozen times per word.
            this.syncUrlState();
            this.render();
        }, 80);
    }

    finishInboxRenderFocus(container, preserveSearch, searchCaret) {
        if (preserveSearch) {
            const input = container.querySelector('.inbox-search-input');
            if (input) {
                input.focus({ preventScroll: true });
                const caret = searchCaret ?? this.searchQuery.length;
                input.setSelectionRange(caret, caret);
            }
            return;
        }
        this.syncKeyboardSelectionAfterRender();
        container.tabIndex = -1;
        // The triage overlay is modal and holds its own focus; a feed render
        // underneath it must not pull focus out to the container behind it.
        if (this.triage?.isOpen?.()) {
            return;
        }
        const active = document.activeElement;
        const focusInToolbar = active?.closest?.('.inbox-toolbar, .page-nav-btn');
        if (!active || active === document.body || focusInToolbar) {
            container.focus({ preventScroll: true });
        }
    }

    render() {
        const d = this.dash;
        const container = document.getElementById('dashboard-layout');
        if (!container) {
            return;
        }

        d._abortInlineEditForRender?.();
        d.updateTagFilterIndicator?.();

        const activeEl = document.activeElement;
        const preserveSearch = this._searchFocusPending
            || activeEl?.classList?.contains('inbox-search-input');
        const searchCaret = preserveSearch
            ? (activeEl?.classList?.contains('inbox-search-input') ? activeEl.selectionStart : this.searchQuery.length)
            : null;
        this._searchFocusPending = false;

        // The sentinel from the previous render is about to be thrown away with
        // the container's contents; an observer still watching it would keep the
        // detached node alive and never fire again.
        this._teardownLoadMoreObserver();

        // Before anything reads the filter state: a site filter left pointing at a
        // host that is no longer here would silently empty the feed, and the
        // breadcrumb below would still name the vanished site.
        if (this.pruneDomainFilter()) {
            this.syncUrlState();
        }

        container.innerHTML = '';
        container.className = 'inbox-layout';
        container.removeAttribute('aria-colcount');
        container.removeAttribute('aria-rowcount');
        // Not a feed: this element holds the heading, the tiles, the toolbar and
        // the legend as well as the rows, and a feed whose children are anything
        // but articles is read out as one. The role goes on the list itself.
        container.removeAttribute('role');
        container.removeAttribute('aria-label');
        container.removeAttribute('data-i18n-aria');

        const title = this.t('dashboard.inboxPageTitle', 'Inbox');
        const subtitle = this.t('dashboard.inboxPageSubtitle', 'Links saved to read or review later');
        const trail = this.headerBreadcrumb();
        const showTrail = trail.includes(' › ');
        const filtered = this.getFilteredItems();
        // The badge counts the rows the reader is looking at, which under a search
        // or a site filter is not the same as everything the "all" pill holds.
        const count = filtered.length;
        const unread = filtered.filter((item) => !item.readAt).length;

        const header = document.createElement('div');
        header.className = 'inbox-header';
        // Two rows, the same shape as the health view's header: the heading owns
        // the first line, and the count drops to the second to sit level with
        // the subtitle. Beside the heading it rode a line higher than health's
        // score badge, which is the one place the two views are seen in
        // succession and the difference reads as a misalignment.
        header.innerHTML = `
            <div class="inbox-header-text">
                <h2 class="inbox-title">${this.escape(title)}</h2>
                <p class="inbox-head-breadcrumb"${showTrail ? '' : ' hidden'}>${this.escape(trail)}</p>
            </div>
            <div class="inbox-header-second-row">
                <p class="inbox-subtitle">${this.escape(subtitle)}</p>
                <div class="inbox-header-meta">
                    <span class="inbox-count-badge">${count}</span>
                    ${unread > 0 ? `<span class="inbox-unread-badge">${unread} ${this.escape(this.t('dashboard.inboxUnread', 'unread'))}</span>` : ''}
                </div>
            </div>
        `;
        container.appendChild(header);

        // "Clear read" only ever removes awake rows, so a snoozed read item must
        // not be what makes the button appear. Counted over the rows on screen,
        // which is the set the button acts on.
        const readCount = filtered.filter((entry) => entry.readAt).length;
        const snoozedCount = this.snoozedCount();

        // Summary tiles, mirroring the health view. The first three double as
        // filters (Active → all, Unread → unread, Snoozed → snoozed); "This week"
        // is a plain readout with no matching filter, so it renders as a <div>.
        //
        // "Active", not "Total": what this counts is everything the list can show
        // right now, and a sleeping link is deliberately not part of that. Under
        // the old label the tile read 4 with five links in the inbox.
        const weekCount = this.weekAddedCount();
        const tiles = document.createElement('div');
        tiles.className = 'inbox-tiles';
        const tile = (label, value, opts = {}) => {
            const zero = value === 0 ? ' inbox-tile--zero' : '';
            const active = opts.filter && this.filter === opts.filter ? ' is-active' : '';
            const mod = opts.mod ? ` inbox-tile--${opts.mod}` : '';
            const body = `<span class="inbox-tile-label">${this.escape(label)}</span><span class="inbox-tile-value">${value}</span>`;
            if (opts.filter) {
                return `<button type="button" class="inbox-tile${mod}${zero}${active}" data-inbox-tile="${opts.filter}">${body}</button>`;
            }
            return `<div class="inbox-tile${mod}${zero}">${body}</div>`;
        };
        tiles.innerHTML = [
            tile(this.t('dashboard.inboxTileActive', 'Active'), this.filterCount('all'), { filter: 'all' }),
            tile(this.t('dashboard.inboxTileUnread', 'Unread'), this.filterCount('unread'), { filter: 'unread', mod: 'unread' }),
            tile(this.t('dashboard.inboxTileSnoozed', 'Snoozed'), this.filterCount('snoozed'), { filter: 'snoozed' }),
            tile(this.t('dashboard.inboxTileThisWeek', 'This week'), weekCount),
        ].join('');
        tiles.querySelectorAll('[data-inbox-tile]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.filter = btn.getAttribute('data-inbox-tile') || 'all';
                this._trackAction('filter', { filter: this.filter, via: 'tile' });
                this.visibleLimit = 50;
                this.checkedIds.clear();
                this.focusItemId = null;
                this.persistViewState();
                this.syncUrlState();
                this.render();
            });
        });
        container.appendChild(tiles);
        const toolbar = document.createElement('div');
        toolbar.className = 'inbox-toolbar';
        // The Snoozed pill only appears when something is asleep (or is the active
        // filter, so it does not vanish under the user when the last item wakes).
        const showSnoozePill = snoozedCount > 0 || this.filter === 'snoozed';
        const notedCount = this.filterCount('noted');
        const showNotedPill = notedCount > 0 || this.filter === 'noted';
        const domainEntries = this.domainOptions();
        const showDomainSelect = domainEntries.length > 0;

        const sortOptions = [
            ['newest', this.t('dashboard.inboxSortNewest', 'newest first')],
            ['oldest', this.t('dashboard.inboxSortOldest', 'oldest first')],
            ['title', this.t('dashboard.inboxSortTitle', 'title')],
            ['domain', this.t('dashboard.inboxSortDomain', 'site')],
        ].map(([value, label]) =>
            `<option value="${value}"${this.sort === value ? ' selected' : ''}>${this.escape(label)}</option>`
        ).join('');

        // Each option says how many rows it would leave, so the choice is made
        // before the click rather than found out after it.
        const domainOptions = [
            `<option value="">${this.escape(this.t('dashboard.inboxDomainAll', 'All sites'))}</option>`,
            ...domainEntries.map(({ host, count }) =>
                `<option value="${this.escape(host)}"${this.domainFilter === host ? ' selected' : ''}>${this.escape(`${host} (${count})`)}</option>`
            ),
        ].join('');

        // Every pill carries its own count, so the row says how much work is under
        // each one without having to click through them. Built from a list rather
        // than four near-identical lines of inline HTML, which is what let the
        // first two go without a count in the first place.
        const pills = [
            ['all', this.t('dashboard.inboxFilterAll', 'All'), true],
            ['unread', this.t('dashboard.inboxFilterUnread', 'Unread'), true],
            ['snoozed', this.t('dashboard.inboxFilterSnoozed', 'Snoozed'), showSnoozePill],
            ['noted', this.t('dashboard.inboxFilterNoted', 'With note'), showNotedPill],
        ].filter(([, , show]) => show).map(([key, label]) => {
            const active = this.filter === key;
            return `<button type="button" class="inbox-filter-btn${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" data-inbox-filter="${key}">${this.escape(label)}<span class="inbox-filter-count">${this.filterCount(key)}</span></button>`;
        }).join('');

        // "Mark all read" acts on the rows the filters leave, which under a search
        // or a site filter is not all of them — so the label stops saying "all".
        const narrowed = this.isNarrowed();
        const markReadLabel = narrowed
            ? this.t('dashboard.inboxMarkShownRead', 'Mark shown read')
            : this.t('dashboard.inboxMarkAllRead', 'Mark all read');
        const markReadHint = narrowed
            ? this.t('dashboard.inboxMarkShownReadHint', 'Marks the {count} links this view shows, not the whole inbox', { count: unread })
            : this.t('dashboard.inboxMarkAllReadHint', 'Marks every unread link in the inbox');

        toolbar.innerHTML = `
            <div class="inbox-filter-strip">
                <div class="inbox-filter-group" role="tablist" aria-label="${this.escape(this.t('dashboard.inboxFilterLabel', 'Filter inbox'))}">${pills}</div>
            </div>
            <div class="inbox-toolbar-search-row">
                ${showDomainSelect ? `<select class="inbox-domain-select" data-inbox-domain-filter aria-label="${this.escape(this.t('dashboard.inboxDomainFilterLabel', 'Filter by site'))}">${domainOptions}</select>` : ''}
                <input type="search" class="inbox-search-input" data-inbox-search value="${this.escape(this.searchQuery)}" placeholder="${this.escape(this.t('dashboard.inboxSearchPlaceholder', 'Search inbox…'))}" autocomplete="off" spellcheck="false" aria-label="${this.escape(this.t('dashboard.inboxSearchPlaceholder', 'Search inbox…'))}">
                ${this.filter === 'snoozed' ? '' : `<select class="inbox-sort-select" data-inbox-sort aria-label="${this.escape(this.t('dashboard.inboxSortLabel', 'Sort inbox'))}">${sortOptions}</select>`}
            </div>
            <div class="inbox-toolbar-actions">
                <button type="button" class="inbox-triage-btn inbox-triage-btn--primary">${this.escape(this.t('dashboard.inboxTriage', 'Triage'))}<kbd>t</kbd></button>
                <span class="inbox-menu-wrap">
                    <button type="button" class="inbox-toolbar-more" data-inbox-toolbar-more
                            aria-haspopup="menu" aria-expanded="false"
                            title="${this.escape(this.t('dashboard.inboxToolbarMore', 'More actions'))}"
                            aria-label="${this.escape(this.t('dashboard.inboxToolbarMore', 'More actions'))}">⋯</button>
                    <div class="inbox-menu" role="menu" hidden data-inbox-menu
                         aria-label="${this.escape(this.t('dashboard.inboxToolbarMore', 'More actions'))}">
                ${unread > 0 ? `<button type="button" class="inbox-bulk-btn" data-inbox-bulk="read" title="${this.escape(markReadHint)}">${this.escape(markReadLabel)}</button>` : ''}
                ${readCount > 0 ? `<button type="button" class="inbox-bulk-btn" data-inbox-bulk="clear-read">${this.escape(narrowed ? this.t('dashboard.inboxClearReadShown', 'Clear read here') : this.t('dashboard.inboxClearRead', 'Clear read'))}</button>` : ''}
                <button type="button" class="inbox-bulk-btn" data-inbox-export="csv" title="${this.escape(this.t('dashboard.inboxExportCsvHint', 'Download filtered list as CSV'))}">${this.escape(this.t('dashboard.inboxExportCsv', 'CSV'))}</button>
                <button type="button" class="inbox-bulk-btn" data-inbox-export="json" title="${this.escape(this.t('dashboard.inboxExportJsonHint', 'Download filtered list as JSON'))}">${this.escape(this.t('dashboard.inboxExportJson', 'JSON'))}</button>
                <button type="button" class="inbox-bulk-btn" data-inbox-import title="${this.escape(this.t('dashboard.inboxImportHint', 'Read a JSON file exported from an inbox back in'))}">${this.escape(this.t('dashboard.inboxImport', 'Import'))}</button>
                <button type="button" class="inbox-bulk-btn" data-inbox-stats aria-expanded="${this.statsOpen ? 'true' : 'false'}" aria-controls="inbox-stats-panel" title="${this.escape(this.t('dashboard.inboxStatsHint', 'How much of this inbox you actually turn into bookmarks'))}">${this.escape(this.t('dashboard.inboxStats', 'Stats'))}</button>
                    </div>
                </span>
                <button type="button" class="view-help-btn inbox-help-btn" data-inbox-help
                        aria-haspopup="dialog"
                        title="${this.escape(this.t('dashboard.inboxHelpHint', 'How the inbox works'))}"
                        aria-label="${this.escape(this.t('dashboard.inboxHelpHint', 'How the inbox works'))}">ℹ</button>
            </div>
        `;
        const filterBtns = [...toolbar.querySelectorAll('[data-inbox-filter]')];
        const applyFilter = (key, via) => {
            this.filter = key || 'all';
            this._trackAction('filter', { filter: this.filter, via });
            this.visibleLimit = 50;
            // Ticks from the previous filter would act on rows the user can no
            // longer see, so a filter change starts the selection over.
            this.checkedIds.clear();
            this.focusItemId = null;
            this.persistViewState();
            this.syncUrlState();
            this.render();
            this.dash.pageNav?.updatePageTitle?.();
            this.dash.pageNav?.updateDocumentTitle?.();
        };
        filterBtns.forEach((btn, i) => {
            btn.addEventListener('click', () => applyFilter(btn.getAttribute('data-inbox-filter'), 'pill'));
            // The group announces itself as a tablist, so the keys that role
            // promises have to work: arrows wrap, Home/End jump to the ends.
            btn.addEventListener('keydown', (e) => {
                const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
                if (!keys.includes(e.key)) return;
                e.preventDefault();
                const last = filterBtns.length - 1;
                const next = e.key === 'Home' ? 0
                    : e.key === 'End' ? last
                        : e.key === 'ArrowRight' ? (i === last ? 0 : i + 1)
                            : (i === 0 ? last : i - 1);
                const target = filterBtns[next];
                if (!target) return;
                const key = target.getAttribute('data-inbox-filter');
                target.focus();
                applyFilter(key, 'keyboard');
                // render() rebuilds the toolbar wholesale and drops the focus set
                // above, so re-focus the replacement to keep arrowing usable.
                if (!target.isConnected) {
                    document.querySelector(`[data-inbox-filter="${CSS.escape(key)}"]`)?.focus();
                }
            });
        });

        const sortSelect = toolbar.querySelector('.inbox-sort-select');
        sortSelect?.addEventListener('change', (e) => {
            this.sort = e.target.value || 'newest';
            this._trackAction('sort', { sort: this.sort });
            this.visibleLimit = 50;
            this.persistViewState();
            this.syncUrlState();
            this.render();
            // Same reason as the health view: a focused SELECT swallows every row
            // shortcut, so j/k/p/d would go dead until the user clicked away.
            document.getElementById('dashboard-layout')?.focus({ preventScroll: true });
        });

        const domainSelect = toolbar.querySelector('.inbox-domain-select');
        domainSelect?.addEventListener('change', (e) => {
            this.domainFilter = String(e.target.value || '').trim().toLowerCase();
            this._trackAction('filter', { filter: 'domain', via: 'domain-select' });
            this.visibleLimit = 50;
            this.checkedIds.clear();
            this.focusItemId = null;
            this.persistViewState();
            this.syncUrlState();
            this.render();
            this.dash.pageNav?.updatePageTitle?.();
            this.dash.pageNav?.updateDocumentTitle?.();
            document.getElementById('dashboard-layout')?.focus({ preventScroll: true });
        });

        const searchInput = toolbar.querySelector('.inbox-search-input');
        searchInput?.addEventListener('input', (e) => {
            this.searchQuery = e.target.value;
            this.visibleLimit = 50;
            this._searchFocusPending = true;
            this.scheduleSearchRender();
        });
        searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
                return;
            }
            if (e.ctrlKey || e.altKey || e.metaKey) {
                return;
            }
            e.stopPropagation();
        });
        toolbar.querySelector('[data-inbox-bulk="read"]')?.addEventListener('click', () => {
            void this.markAllRead();
        });
        toolbar.querySelector('[data-inbox-bulk="clear-read"]')?.addEventListener('click', () => {
            void this.clearReadItems();
        });
        toolbar.querySelector('.inbox-triage-btn')?.addEventListener('click', () => {
            void this.startTriage();
        });
        toolbar.querySelector('[data-inbox-stats]')?.addEventListener('click', () => {
            this.toggleStats();
        });

        /*
         * The hamburger, and the six buttons behind it.
         *
         * Nine controls stood between the filters and the first link, of which
         * Triage is the one anyone comes here for -- so it keeps the first slot
         * and its own styling, the way Work through does in the health view,
         * and the ℹ stays because it explains the view rather than acting on
         * it. Export, import and the counts wait behind the ⋯.
         *
         * The wrap around button and menu is what anchors it: positioned
         * against the toolbar instead, a menu lands at the far edge of the
         * window, which is exactly what went wrong in health.
         */
        const moreBtn = toolbar.querySelector('[data-inbox-toolbar-more]');
        const moreMenu = toolbar.querySelector('[data-inbox-menu]');
        if (moreBtn && moreMenu) {
            const closeMore = () => {
                moreMenu.hidden = true;
                moreBtn.setAttribute('aria-expanded', 'false');
            };
            moreBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = moreMenu.hidden;
                moreMenu.hidden = !open;
                moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
                if (!open) return;
                const onOutside = (event) => {
                    if (moreMenu.contains(event.target) || event.target === moreBtn) return;
                    closeMore();
                    document.removeEventListener('click', onOutside, true);
                };
                setTimeout(() => document.addEventListener('click', onOutside, true), 0);
            });
            // Escape closes it, and an action inside it closes it too: the menu
            // is a way to reach a button, not a place to stay.
            moreMenu.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    closeMore();
                    moreBtn.focus({ preventScroll: true });
                }
            });
            moreMenu.addEventListener('click', (e) => {
                if (e.target.closest('button')) closeMore();
            });
        }

        toolbar.querySelector('[data-inbox-help]')?.addEventListener('click', () => {
            this.showInboxExplainer();
        });
        toolbar.querySelector('[data-inbox-export="csv"]')?.addEventListener('click', () => {
            this.exportFilteredCsv();
        });
        toolbar.querySelector('[data-inbox-export="json"]')?.addEventListener('click', () => {
            this.exportFilteredJson();
        });
        toolbar.querySelector('[data-inbox-import]')?.addEventListener('click', () => {
            this.openImportPicker();
        });
        container.appendChild(toolbar);

        // What the active filter selects, in a sentence. Rendered before the
        // loading and empty branches below so the explanation is there while the
        // list is still arriving, and on a filter that turned up nothing — where
        // "what was being looked for" is the only useful thing left to say.
        const note = this.renderFilterNote();
        if (note) container.appendChild(note);

        // Above the loading and empty branches below: the lifetime figures are
        // about the inbox as a whole, so they stay readable while the feed is
        // arriving and on a filter that matched nothing.
        const stats = this.renderStatsPanel();
        if (stats) {
            stats.id = 'inbox-stats-panel';
            container.appendChild(stats);
        }

        if (this.loading) {
            const loading = document.createElement('p');
            loading.className = 'inbox-empty';
            loading.textContent = this.t('dashboard.inboxLoading', 'Loading…');
            container.appendChild(loading);
            this.finishInboxRenderFocus(container, preserveSearch, searchCaret);
            return;
        }

        // Checked before the empty state, because a failed load also leaves the
        // list empty and the two mean opposite things: one says there is nothing
        // to do, the other that we do not know. Same three-part panel the health
        // view uses, retry included.
        if (this._loadFailed && !this.items.length) {
            const failed = document.createElement('div');
            failed.className = 'inbox-empty-state';
            failed.innerHTML = `
                <p class="inbox-empty-title">${this.escape(this.t('dashboard.inboxLoadFailed', 'Unable to load the inbox'))}</p>
                <p class="inbox-empty-hint">${this.escape(this.t('dashboard.inboxLoadFailedHint', 'Check that the server is reachable and try again.'))}</p>
                <button type="button" class="inbox-retry-btn">${this.escape(this.t('dashboard.inboxRetry', 'Retry'))}</button>
            `;
            failed.querySelector('.inbox-retry-btn')?.addEventListener('click', () => {
                void this.loadAndRender({ refresh: true });
            });
            container.appendChild(failed);
            this.finishInboxRenderFocus(container, preserveSearch, searchCaret);
            return;
        }

        if (!this.items.length) {
            const empty = document.createElement('div');
            empty.className = 'inbox-empty-state';
            empty.innerHTML = `
                <p class="inbox-empty-title">${this.escape(this.t('dashboard.inboxEmpty', 'No links yet'))}</p>
                <p class="inbox-empty-hint">${this.escape(this.t('dashboard.inboxEmptyHint', 'Paste a URL with Ctrl+V to add a link'))}</p>
            `;
            container.appendChild(empty);
            this.announceListState(0);
            this.finishInboxRenderFocus(container, preserveSearch, searchCaret);
            return;
        }

        if (!filtered.length) {
            container.appendChild(this.renderEmptyState());
            // The empty view is where a sleeping link is most confusing: the row
            // the reader is looking for exists, and nothing here says where.
            const sleepingHere = this.renderSnoozedFooter();
            if (sleepingHere) container.appendChild(sleepingHere);
            // Announced here as well as at the end: a filter or search that
            // matches nothing returns early, and "no results" is precisely the
            // outcome a screen-reader user most needs told.
            this.announceListState(0);
            this.finishInboxRenderFocus(container, preserveSearch, searchCaret);
            return;
        }

        const visible = filtered.slice(0, this.visibleLimit);
        const groups = this.groupFilteredItems(visible);
        const list = document.createElement('div');
        list.className = 'feed-list inbox-feed';
        // The feed is the list of rows and nothing else. The date groups between
        // it and the articles are there for the eye — made presentational so the
        // articles read as the feed's own children, which is what lets a screen
        // reader say "3 of 120" while the rest is still behind the sentinel.
        list.setAttribute('role', 'feed');
        list.setAttribute('aria-label', this.t('dashboard.inboxPageTitle', 'Inbox'));
        list.setAttribute('aria-busy', 'false');
        let position = 0;
        groups.forEach((group) => {
            const section = document.createElement('section');
            section.className = 'inbox-date-group';
            section.setAttribute('role', 'presentation');
            // A flat sort has no heading; an empty <h3> would leave its margin
            // behind as a gap above the first row.
            section.innerHTML = group.label
                ? `<h3 class="inbox-date-group-title">${this.escape(group.label)}</h3>`
                : '';
            const groupList = document.createElement('div');
            groupList.className = 'inbox-date-group-items';
            groupList.setAttribute('role', 'presentation');
            group.items.forEach((item) => {
                position += 1;
                const card = this.createItemElement(item);
                card.setAttribute('aria-posinset', String(position));
                card.setAttribute('aria-setsize', String(filtered.length));
                groupList.appendChild(card);
            });
            section.appendChild(groupList);
            list.appendChild(section);
        });
        container.appendChild(list);

        if (filtered.length > this.visibleLimit) {
            const sentinel = document.createElement('div');
            sentinel.className = 'inbox-load-sentinel';
            sentinel.setAttribute('aria-hidden', 'true');
            container.appendChild(sentinel);
            this._bindLoadMoreObserver(sentinel, filtered.length);
            // No IntersectionObserver: the button is the way to reach the rest.
            if (!this._loadMoreObserver) {
                this._appendLoadMoreFallback(container, filtered.length);
            }
        }

        const sleeping = this.renderSnoozedFooter();
        if (sleeping) container.appendChild(sleeping);

        container.appendChild(this.renderLegend());
        this.renderBulkBar();

        if (container.querySelector('.inbox-feed')) {
            this.bindPointerNavigation(container);
        }

        this.schedulePreviewRefresh();
        this.scheduleWakeRefresh();
        this.applyPendingItemFocus();
        this.announceListState(filtered.length);
        this.finishInboxRenderFocus(container, preserveSearch, searchCaret);
    }

    /**
     * A line under the list for the links that are asleep.
     *
     * Outside its own tile a snoozed link is invisible: it is in no count, no
     * filter and no export, so "I saved that" and "it is not here" were both
     * true with nothing on screen to reconcile them. Says how many and when the
     * first one is due, and hands over to the Snoozed filter.
     */
    renderSnoozedFooter() {
        if (this.filter === 'snoozed') return null;
        const sleeping = (this.items || []).filter((item) => this.isSnoozed(item));
        if (!sleeping.length) return null;
        const next = sleeping
            .map((item) => Number(item.snoozedUntil || 0))
            .filter((ts) => ts > 0)
            .sort((a, b) => a - b)[0];

        const note = document.createElement('p');
        note.className = 'inbox-snoozed-note';
        const text = document.createElement('span');
        text.textContent = next
            ? this.t('dashboard.inboxSnoozedFooter', '{count} links are asleep, the first until {time}', {
                count: sleeping.length,
                time: this.formatSnoozeWake(next),
            })
            : this.t('dashboard.inboxSnoozedFooterPlain', '{count} links are asleep', { count: sleeping.length });
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'inbox-snoozed-note-btn';
        btn.dataset.inboxSnoozedNote = '';
        btn.textContent = this.t('dashboard.inboxSnoozedFooterShow', 'Show them');
        btn.addEventListener('click', () => {
            this.filter = 'snoozed';
            this._trackAction('filter', { filter: 'snoozed', via: 'footer' });
            this.visibleLimit = 50;
            this.checkedIds.clear();
            this.focusItemId = null;
            this.persistViewState();
            this.syncUrlState();
            this.render();
        });
        note.append(text, btn);
        return note;
    }

    /**
     * Say how many rows the current filter and search leave, for screen readers.
     *
     * The list changes under the user constantly — a debounced search, the wake
     * timer, the preview poll, a filter pill — and none of it was announced, so
     * filtering to Unread gave no indication of what happened. Mirrors the
     * pattern already in templates/dashboard.html for search results.
     */
    announceListState(count) {
        const container = document.getElementById('dashboard-layout');
        if (!container) return;
        let live = container.querySelector('.inbox-live-region');
        if (!live) {
            live = document.createElement('div');
            live.className = 'sr-only inbox-live-region';
            live.setAttribute('aria-live', 'polite');
            live.setAttribute('aria-atomic', 'true');
            container.appendChild(live);
        }
        const message = count === 1
            ? this.t('dashboard.inboxAnnounceOne', '1 link')
            : this.t('dashboard.inboxAnnounceCount', '{count} links', { count });
        // Only on change: repeating the same string does not re-announce in some
        // readers, and re-announcing an unchanged count on every poll would be
        // noise in the ones where it does.
        if (live.textContent !== message) {
            live.textContent = message;
        }
    }

    createItemElement(item) {
        const d = this.dash;
        const card = document.createElement('article');
        // feed-row is the shared card; the unread edge is the shared modifier.
        card.className = 'feed-row inbox-item'
            + (item.readAt ? ' is-read' : ' is-unread feed-row--edge-accent');
        card.dataset.inboxId = item.id;
        card.dataset.bookmarkUrl = item.url || '';
        card.dataset.inboxShareName = item.previewTitle || item.title || item.domain || '';
        card.tabIndex = -1;

        const title = item.previewTitle || item.title || item.domain || item.url;
        const domain = item.domain || this.formatUrlDisplay(item.url);
        const timeLabel = this.formatRelativeTime(item.addedAt);
        const addedLabel = this.formatAddedDate(item.addedAt);
        const snoozed = this.isSnoozed(item);
        if (snoozed) {
            card.classList.add('is-snoozed');
        }
        // A freshly-added item enriches its preview server-side; until that lands the
        // placeholder shows a "fetching preview" pulse rather than a bare link glyph.
        const enriching = this.isPreviewPending(item);
        // Icon like the health view: the stored favicon first (served from
        // /data/icons/), the preview image as a secondary, and the link glyph last.
        // The <img> carries the fallback chain in data-* so its error handler can
        // step down without re-rendering the row.
        const iconSrc = this.resolveIconSrc(item.icon);
        const previewSrc = String(item.previewImage || '').trim();
        let thumb;
        if (iconSrc || previewSrc) {
            const primary = iconSrc || previewSrc;
            const fallback = iconSrc && previewSrc ? previewSrc : '';
            thumb = `<div class="inbox-item-thumb" aria-hidden="true"><img class="inbox-item-thumb-img" src="${this.escape(primary)}" alt="" loading="lazy"${fallback ? ` data-fallback="${this.escape(fallback)}"` : ''}></div>`;
        } else {
            thumb = `<div class="inbox-item-thumb inbox-item-thumb--placeholder${enriching ? ' inbox-item-thumb--loading' : ''}" aria-hidden="true">🔗</div>`;
        }

        // On a snoozed card, swap the Snooze button for a Wake one and show when it
        // will resurface.
        const snoozeBtn = snoozed
            ? `<button type="button" class="inbox-action-btn" data-inbox-action="wake">${this.escape(this.t('dashboard.inboxWake', 'Wake now'))}<kbd>z</kbd></button>`
            : `<button type="button" class="inbox-action-btn" data-inbox-action="snooze">${this.escape(this.t('dashboard.inboxSnooze', 'Snooze'))}<kbd>z</kbd></button>`;
        const wakeLabel = snoozed
            ? `<span class="inbox-item-snooze">${this.escape(this.t('dashboard.inboxSnoozedUntil', 'Sleeping until {time}', { time: this.formatSnoozeWake(item.snoozedUntil) }))}</span>`
            : '';

        const checked = this.checkedIds.has(item.id);
        if (checked) {
            card.classList.add('is-checked');
        }
        // An article in a feed is announced by its own name; without one the row
        // is read as an unlabelled group and the title arrives a beat later.
        const titleId = `inbox-item-title-${item.id}`;
        card.setAttribute('aria-labelledby', titleId);
        card.innerHTML = `
            <label class="inbox-item-check">
                <input type="checkbox" class="inbox-item-check-input"${checked ? ' checked' : ''}
                    aria-label="${this.escape(this.t('dashboard.inboxSelectItem', 'Select {title}', { title }))}">
            </label>
            ${thumb}
            <div class="inbox-item-body">
                <h3 class="inbox-item-title" id="${this.escape(titleId)}">${this.escape(title)}</h3>
                <p class="inbox-item-meta">
                    <button type="button" class="inbox-item-domain inbox-item-domain-btn" data-inbox-domain="${this.escape(this.itemDomain(item))}">${this.escape(domain)}</button>
                    ${addedLabel ? `<span class="inbox-item-date" title="${this.escape(this.t('dashboard.inboxAddedOn', 'Added on {date}', { date: addedLabel }))}">${this.escape(addedLabel)}</span>` : ''}
                    ${timeLabel ? `<span class="inbox-item-time">${this.escape(timeLabel)}</span>` : ''}
                    ${this.renderItemSource(item)}
                    ${wakeLabel}
                </p>
                ${item.previewDesc ? `<p class="inbox-item-desc">${this.escape(item.previewDesc)}</p>` : ''}
                ${item.note ? `<p class="inbox-item-note">${this.escape(item.note)}</p>` : ''}
                ${this.renderItemTags(item)}
                <div class="feed-row-actions inbox-item-actions">
                    <div class="inbox-item-actions-inner">
                        <button type="button" class="inbox-action-btn" data-inbox-action="open">${this.escape(this.t('dashboard.inboxOpen', 'Open'))}</button>
                        <button type="button" class="inbox-action-btn" data-inbox-action="promote">${this.escape(this.t('dashboard.inboxPromote', 'Promote'))}<kbd>p</kbd></button>
                        ${item.readAt ? '' : `<button type="button" class="inbox-action-btn" data-inbox-action="read">${this.escape(this.t('dashboard.inboxMarkRead', 'Mark read'))}<kbd>r</kbd></button>`}
                        ${snoozeBtn}
                        <button type="button" class="inbox-action-btn" data-inbox-action="note">${this.escape(item.note ? this.t('dashboard.inboxEditNote', 'Edit note') : this.t('dashboard.inboxAddNote', 'Note'))}<kbd>n</kbd></button>
                        <button type="button" class="inbox-action-btn inbox-action-btn--danger" data-inbox-action="delete">${this.escape(this.t('dashboard.inboxDelete', 'Delete'))}<kbd>d</kbd></button>
                    </div>
                </div>
            </div>
        `;

        // Icon fallback chain: if the favicon fails, drop to the preview image
        // (data-fallback); if that fails too — or there was none — show the link
        // glyph, matching the health view's icon fallback.
        const thumbImg = card.querySelector('.inbox-item-thumb-img');
        thumbImg?.addEventListener('error', () => {
            const fallback = thumbImg.getAttribute('data-fallback');
            if (fallback) {
                thumbImg.removeAttribute('data-fallback');
                thumbImg.src = fallback;
                return;
            }
            const slot = thumbImg.parentElement;
            thumbImg.remove();
            if (slot) {
                slot.classList.add('inbox-item-thumb--placeholder');
                slot.textContent = '🔗';
            }
        });

        const checkInput = card.querySelector('.inbox-item-check-input');
        // Shift extends from the last row ticked, so a contiguous run is two
        // clicks rather than one per row. Read on click (change carries no
        // modifier state) and applied in change, which still fires after it.
        let shiftHeld = false;
        checkInput?.addEventListener('click', (e) => { shiftHeld = e.shiftKey; });
        checkInput?.addEventListener('change', () => {
            if (shiftHeld && this.checkAnchorId && this.checkAnchorId !== item.id) {
                this.extendCheckedTo(item.id, checkInput.checked);
            } else {
                this.setChecked(item.id, checkInput.checked);
            }
            shiftHeld = false;
            this.checkAnchorId = item.id;
        });
        // The checkbox is inside the row, which opens on click — without this,
        // ticking a box would also launch the link.
        card.querySelector('.inbox-item-check')?.addEventListener('click', (e) => e.stopPropagation());

        // Same shape as the domain button below: a chip is a filter you can
        // click, and clicking the active one clears it again.
        card.querySelectorAll('[data-inbox-tag]').forEach((chip) => {
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = String(e.currentTarget.getAttribute('data-inbox-tag') || '').trim().toLowerCase();
                if (!tag) return;
                this.tagFilter = this.tagFilter === tag ? '' : tag;
                this.filter = 'all';
                this.visibleLimit = 50;
                this.checkedIds.clear();
                this.focusItemId = null;
                this._trackAction('filter', { filter: 'tag', via: 'tag-click' });
                this.syncUrlState();
                this.render();
                this.dash.pageNav?.updatePageTitle?.();
            });
        });

        card.querySelector('.inbox-item-domain-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const host = String(e.currentTarget.getAttribute('data-inbox-domain') || '').trim().toLowerCase();
            if (!host) {
                return;
            }
            this.domainFilter = host;
            this.filter = 'all';
            this.visibleLimit = 50;
            this.checkedIds.clear();
            this.focusItemId = null;
            this._trackAction('filter', { filter: 'domain', via: 'domain-click' });
            this.syncUrlState();
            this.render();
            this.dash.pageNav?.updatePageTitle?.();
            this.dash.pageNav?.updateDocumentTitle?.();
        });

        card.querySelector('[data-inbox-action="open"]')?.addEventListener('click', () => {
            this.openItem(item);
        });
        card.querySelector('[data-inbox-action="promote"]')?.addEventListener('click', () => {
            this.promoteItem(item);
        });
        card.querySelector('[data-inbox-action="read"]')?.addEventListener('click', async () => {
            this.selectItemById(item.id);
            await this.markReadFromKeyboard(item);
        });
        card.querySelector('[data-inbox-action="snooze"]')?.addEventListener('click', (e) => {
            this.selectItemById(item.id);
            this.openSnoozeMenu(item, e.currentTarget);
        });
        card.querySelector('[data-inbox-action="wake"]')?.addEventListener('click', async () => {
            this.selectItemById(item.id);
            await this.wakeItem(item);
        });
        card.querySelector('[data-inbox-action="note"]')?.addEventListener('click', () => {
            this.selectItemById(item.id);
            void this.editNote(item);
        });
        card.querySelector('[data-inbox-action="delete"]')?.addEventListener('click', async () => {
            await this.deleteItemWithUndo(item.id);
        });

        // Pointer-hover selection is handled once at the container level via
        // bindPointerNavigation (pointerover); a per-card mouseenter would be a
        // redundant second binding for the same behaviour.

        card.addEventListener('click', (e) => {
            if (e.target.closest('.inbox-action-btn')) {
                return;
            }
            this.selectItemById(item.id);
        });
        card.addEventListener('dblclick', (e) => {
            if (e.target.closest('.inbox-action-btn')) {
                return;
            }
            e.preventDefault();
            this.openItem(item);
        });

        d.contextMenu?.bindRow?.(card);

        return card;
    }

    openItem(item) {
        const url = String(item?.url || '').trim();
        if (!url) {
            return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
        // The link is already open either way; only the read mark is in doubt,
        // so the row is updated when the write lands rather than optimistically.
        void this.markReadReporting(item.id).then((ok) => {
            if (ok) {
                this.applyItemReadLocally(item.id);
            }
        });
    }

    promoteItem(item) {
        const d = this.dash;
        // The inbox's main conversion: a captured link becoming a real bookmark.
        this._trackAction('promote');
        const handler = d.searchComponent?.commandsComponent?.newCommandHandler;
        if (!handler) {
            d.showNotification(this.t('dashboard.inboxPromoteFailed', 'Could not open bookmark form'), 'error');
            return;
        }
        d._pendingInboxPromoteId = item.id;
        handler.openModal({
            url: item.url,
            name: item.previewTitle || item.title || '',
            note: item.note || '',
        });
    }

    /**
     * Fire-and-forget a one-off server-side health check for a just-created
     * bookmark URL (used after an inbox promote). The server pings the URL and
     * writes the result into the health cache so the Health view reflects it
     * immediately instead of showing the bookmark as unchecked/missing. Failures
     * are swallowed — this is a best-effort nicety, not part of the promote.
     */
    triggerHealthCheckForUrl(url) {
        const target = String(url || '').trim();
        if (!target) {
            return;
        }
        const doFetch = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        Promise.resolve()
            .then(() => doFetch('/api/health/check-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: target }),
            }))
            .catch(() => {});
    }

    async completePromote(id) {
        if (this.dash.settings?.inboxDeleteAfterPromote === false) {
            // Best-effort, like the delete below it: the bookmark is already
            // saved, and failing to tidy the inbox entry afterwards is not
            // worth turning a successful promote into an error.
            try {
                await this.markRead(id);
            } catch { /* the promote itself succeeded */ }
            return;
        }
        try {
            await this.deleteItem(id, { reason: 'promote' });
            if (this.isActiveView()) {
                await this.loadAndRender();
            }
        } catch {
            // promote succeeded; inbox cleanup is best-effort
        }
    }

    /**
     * Add or edit the note on an item. The backend already stores a per-item note
     * (PATCH /api/inbox), it just had no way in from the list. clearNote=1 lets an
     * emptied field actually blank the note rather than being ignored as "unset".
     */
    async editNote(item, options = {}) {
        if (!item) {
            return;
        }
        const current = String(item.note || '');
        const next = await this.promptNote(current);
        if (next === null || next === current) {
            return;
        }
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const clearParam = next.trim() === '' ? '?clearNote=1' : '';
        try {
            const res = await fetcher(`/api/inbox${clearParam}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id, note: next }),
            });
            if (!res.ok) {
                throw new Error(`note HTTP ${res.status}`);
            }
            const stored = this.items.find((entry) => entry.id === item.id);
            if (stored) {
                stored.note = next.trim();
            }
            if (this.isActiveView()) {
                if (options.skipRender) {
                    this.syncItemNoteInFeed(item.id);
                } else {
                    this.render();
                }
            }
            this.dash.showNotification(
                next.trim()
                    ? this.t('dashboard.inboxNoteSaved', 'Note saved')
                    : this.t('dashboard.inboxNoteCleared', 'Note removed'),
                'success',
                { duration: 2500 }
            );
        } catch {
            this.dash.showNotification(this.t('dashboard.inboxNoteFailed', 'Could not save the note'), 'error');
        }
    }

    /** Textarea modal → the entered note, or null if the user cancelled. */
    /**
     * Edit a row's tags.
     *
     * A comma-separated field rather than the bookmark tag popover: an inbox
     * item is undecided by definition, so there is rarely an existing tag list
     * to pick from, and typing two words beats opening a chooser that is empty
     * for most people.
     */
    async editTags(item) {
        if (!item) return;
        const current = (Array.isArray(item.tags) ? item.tags : []).join(', ');
        const next = await this.promptTags(current);
        if (next === null) return;

        const tags = next.split(',')
            .map((tag) => tag.trim().toLowerCase())
            .filter((tag, i, all) => tag && all.indexOf(tag) === i);
        if (tags.join(',') === (Array.isArray(item.tags) ? item.tags : []).join(',')) {
            return;
        }

        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/inbox', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                // Sent even when empty: the server takes a null/absent tags field
                // as "unchanged", so clearing every tag has to send [].
                body: JSON.stringify({ id: item.id, tags }),
            });
            if (!res.ok) throw new Error(`tags HTTP ${res.status}`);
            const stored = this.items.find((entry) => entry.id === item.id);
            if (stored) stored.tags = tags;
            if (this.isActiveView()) this.render();
            this.dash.showNotification(
                tags.length
                    ? this.t('dashboard.inboxTagsSaved', 'Tags saved')
                    : this.t('dashboard.inboxTagsCleared', 'Tags removed'),
                'success',
                { duration: 2000 }
            );
        } catch {
            this.dash.showErrorNotification?.(
                this.t('dashboard.inboxTagsFailed', 'Could not save tags')
            );
        }
    }

    promptTags(current) {
        const modal = window.AppModal;
        if (!modal || typeof modal.show !== 'function') {
            const value = window.prompt(this.t('dashboard.inboxTagsPrompt', 'Tags'), current);
            return Promise.resolve(value === null ? null : value);
        }
        return new Promise((resolve) => {
            const label = this.escape(this.t('dashboard.inboxTagsLabel', 'Tags for this link, separated by commas'));
            const placeholder = this.escape(this.t('dashboard.inboxTagsPlaceholder', 'reading, work, later'));
            modal.show({
                title: this.t('dashboard.inboxTagsTitle', 'Inbox tags'),
                htmlMessage: `
                    <label class="inbox-note-modal-label" for="inbox-tags-modal-input">${label}</label>
                    <input id="inbox-tags-modal-input" class="inbox-note-modal-input" type="text" placeholder="${placeholder}">
                `,
                confirmText: this.t('dashboard.inboxTagsSave', 'Save tags'),
                cancelText: this.t('dashboard.healthCancel', 'Cancel'),
                initialFocusSelector: '#inbox-tags-modal-input',
                onConfirm: () => {
                    const input = document.getElementById('inbox-tags-modal-input');
                    resolve(input ? input.value : '');
                },
                onCancel: () => resolve(null),
            });
            const input = document.getElementById('inbox-tags-modal-input');
            if (input) input.value = current;
        });
    }

    promptNote(current) {
        const modal = window.AppModal;
        if (!modal || typeof modal.show !== 'function') {
            const value = window.prompt(this.t('dashboard.inboxNotePrompt', 'Note'), current);
            return Promise.resolve(value === null ? null : value);
        }
        return new Promise((resolve) => {
            const label = this.escape(this.t('dashboard.inboxNoteLabel', 'Add a note for this link'));
            const placeholder = this.escape(this.t('dashboard.inboxNotePlaceholder', 'Why you saved it, what to do with it…'));
            modal.show({
                title: this.t('dashboard.inboxNoteTitle', 'Inbox note'),
                htmlMessage: `
                    <label class="inbox-note-modal-label" for="inbox-note-modal-input">${label}</label>
                    <textarea id="inbox-note-modal-input" class="inbox-note-modal-input" rows="4" placeholder="${placeholder}"></textarea>
                `,
                confirmText: this.t('dashboard.inboxNoteSave', 'Save note'),
                cancelText: this.t('dashboard.healthCancel', 'Cancel'),
                initialFocusSelector: '#inbox-note-modal-input',
                onConfirm: () => {
                    const input = document.getElementById('inbox-note-modal-input');
                    resolve(input ? input.value : '');
                },
                onCancel: () => resolve(null),
            });
            // htmlMessage sets innerHTML but a textarea's value can't be expressed as
            // an attribute reliably (newlines, quotes), so seed it after mount.
            const input = document.getElementById('inbox-note-modal-input');
            if (input) {
                input.value = current;
            }
        });
    }

    /**
     * Name the download after everything that decided its contents.
     *
     * The filter and the site were in the name and the search term was not, so
     * two exports of two different lists — a search and the same view without it
     * — landed in the downloads folder under one name, the second as "(1)".
     */
    exportFileName(ext) {
        const slug = (value) => String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 24);
        const parts = ['nextdash-inbox', this.filter];
        const domain = slug(this.domainFilter);
        if (domain) parts.push(domain);
        const tag = slug(this.tagFilter);
        if (tag) parts.push(`tag-${tag}`);
        const query = slug(this.searchQuery);
        if (query) parts.push(`q-${query}`);
        parts.push(new Date().toISOString().slice(0, 10));
        return `${parts.filter(Boolean).join('-')}.${ext}`;
    }

    csvField(value) {
        let text = String(value ?? '');
        if (/^[=+\-@\t\r]/.test(text)) {
            text = `'${text}`;
        }
        return `"${text.replace(/"/g, '""')}"`;
    }

    downloadExportFile(filename, content, mime) {
        try {
            const blob = new Blob([content], { type: mime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            console.error('inbox export failed', error);
            this.dash.showNotification?.(
                this.t('dashboard.inboxExportFailed', 'Could not create the export file.'),
                'error'
            );
        }
    }

    exportFilteredCsv() {
        const items = this.getFilteredItems();
        if (!items.length) {
            this.dash.showNotification?.(
                this.t('dashboard.inboxExportEmpty', 'Nothing to export in this view.'),
                'info'
            );
            return;
        }
        const header = [
            this.t('dashboard.inboxExportColTitle', 'Title'),
            this.t('dashboard.inboxExportColUrl', 'URL'),
            this.t('dashboard.inboxExportColDomain', 'Domain'),
            this.t('dashboard.inboxExportColDescription', 'Description'),
            this.t('dashboard.inboxExportColNote', 'Note'),
            this.t('dashboard.inboxExportColTags', 'Tags'),
            this.t('dashboard.inboxExportColAdded', 'Added'),
            this.t('dashboard.inboxExportColRead', 'Read'),
            this.t('dashboard.inboxExportColSnoozedUntil', 'Snoozed until'),
            this.t('dashboard.inboxExportColSource', 'Source'),
        ];
        const rows = items.map((item) => [
            item.previewTitle || item.title || '',
            item.url || '',
            this.itemDomain(item),
            item.previewDesc || '',
            item.note || '',
            (Array.isArray(item.tags) ? item.tags : []).join(' '),
            item.addedAt ? new Date(item.addedAt).toISOString() : '',
            item.readAt ? new Date(item.readAt).toISOString() : '',
            item.snoozedUntil ? new Date(item.snoozedUntil).toISOString() : '',
            item.source || '',
        ]);
        const csv = '﻿' + [header, ...rows]
            .map((row) => row.map((cell) => this.csvField(cell)).join(','))
            .join('\r\n');
        this.downloadExportFile(this.exportFileName('csv'), csv, 'text/csv;charset=utf-8');
        this._trackAction('export-csv', { size: this._countBucket(items.length) });
    }

    exportFilteredJson() {
        const items = this.getFilteredItems();
        if (!items.length) {
            this.dash.showNotification?.(
                this.t('dashboard.inboxExportEmpty', 'Nothing to export in this view.'),
                'info'
            );
            return;
        }
        const payload = items.map((item) => ({
            id: item.id,
            url: item.url,
            title: item.title || '',
            previewTitle: item.previewTitle || '',
            domain: this.itemDomain(item),
            previewDesc: item.previewDesc || '',
            note: item.note || '',
            tags: Array.isArray(item.tags) ? item.tags : [],
            addedAt: item.addedAt || 0,
            readAt: item.readAt || 0,
            snoozedUntil: item.snoozedUntil || 0,
            source: item.source || '',
        }));
        this.downloadExportFile(
            this.exportFileName('json'),
            `${JSON.stringify(payload, null, 2)}\n`,
            'application/json;charset=utf-8'
        );
        this._trackAction('export-json', { size: this._countBucket(items.length) });
    }

    /**
     * Open a file picker and read an exported inbox back in.
     *
     * The export was one-way: a list could leave as JSON and had no way back, so
     * moving an inbox between installs, or restoring one without a full backup,
     * was not possible. Accepts what exportFilteredJson writes, and a bare array
     * of {url, title, …} with it, since that is what a hand-written list is.
     */
    openImportPicker() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.style.display = 'none';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            input.remove();
            if (file) void this.importFromFile(file);
        });
        document.body.appendChild(input);
        input.click();
    }

    /** Rows out of an import file, or null when the file is not one. */
    parseImportPayload(text) {
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            return null;
        }
        const rows = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : null);
        if (!rows) return null;
        return rows
            .map((row) => ({
                url: String(row?.url || '').trim(),
                title: String(row?.title || row?.previewTitle || '').trim(),
                note: String(row?.note || '').trim(),
                tags: Array.isArray(row?.tags) ? row.tags.map((tag) => String(tag)) : [],
                source: 'import',
            }))
            .filter((row) => row.url);
    }

    async importFromFile(file) {
        const text = await file.text().catch(() => '');
        const rows = this.parseImportPayload(text);
        if (!rows) {
            this.dash.showNotification?.(
                this.t('dashboard.inboxImportInvalid', 'That file is not an inbox export.'),
                'error'
            );
            return;
        }
        if (!rows.length) {
            this.dash.showNotification?.(
                this.t('dashboard.inboxImportEmpty', 'No links in that file.'),
                'info'
            );
            return;
        }
        const confirmed = await this.confirm(
            this.t('dashboard.inboxImport', 'Import'),
            this.t('dashboard.inboxImportConfirm', 'Add {count} links from {name} to the inbox?', {
                count: rows.length,
                name: file.name,
            })
        );
        if (!confirmed) return;

        this._trackAction('import', { size: this._countBucket(rows.length) });
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        let added = 0;
        let duplicates = 0;
        let failed = 0;
        let full = false;
        for (const row of rows) {
            // One at a time and in order: there is no bulk endpoint, and the
            // capacity cap means a later row can be the one that is refused.
            try {
                const res = await fetcher('/api/inbox', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(row),
                });
                if (res.ok) {
                    added += 1;
                    continue;
                }
                const body = await res.json().catch(() => ({}));
                if (body?.error === 'duplicate_url') {
                    duplicates += 1;
                } else if (body?.error === 'at_capacity') {
                    // Every row after this one would be refused too.
                    full = true;
                    break;
                } else {
                    failed += 1;
                }
            } catch {
                failed += 1;
            }
        }

        await this.loadAndRender({ refresh: true });
        this.dash.pageNav?.updateInboxTabBadge?.();

        // One line that accounts for every row in the file, rather than a bare
        // "done" over an import that skipped half of it.
        const parts = [this.t('dashboard.inboxImportAdded', '{count} added', { count: added })];
        if (duplicates) {
            parts.push(this.t('dashboard.inboxImportDuplicates', '{count} already here', { count: duplicates }));
        }
        if (failed) {
            parts.push(this.t('dashboard.inboxImportFailed', '{count} failed', { count: failed }));
        }
        if (full) {
            parts.push(this.t('dashboard.inboxImportFull', 'inbox full — the rest was left out'));
        }
        this.dash.showNotification?.(parts.join(' · '), full || failed ? 'warning' : 'success');
    }

    highlightItem(id) {
        const card = document.querySelector(`[data-inbox-id="${id}"]`);
        if (!card) {
            return;
        }
        card.classList.add('inbox-item--highlight', 'feed-row--highlight');
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        setTimeout(() => card.classList.remove('inbox-item--highlight', 'feed-row--highlight'), 1800);
    }
}
