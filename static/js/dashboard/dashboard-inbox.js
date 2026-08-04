/**
 * Inbox page — lightweight link capture (separate from bookmarks).
 */
class DashboardInbox {
    static VIEW = 'inbox';

    constructor(dashboard) {
        this.dash = dashboard;
        this.items = [];
        this.loading = false;
        this.filter = 'all';
        this.searchQuery = '';
        this.domainFilter = '';
        this.sort = 'newest';
        this.visibleLimit = 50;
        this.selectedItemId = null;
        /** Deep-link target from `?ib_id=` — applied after the feed renders. */
        this.focusItemId = null;
        // Ids ticked for a bulk action. Kept separate from selectedItemId, which is
        // the keyboard cursor: moving the cursor must not change what is ticked.
        this.checkedIds = new Set();
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

    clearChecked() {
        if (!this.checkedIds.size) return;
        this.checkedIds.clear();
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
                }
            });
            container.querySelector('.inbox-toolbar')?.after(bar);
        }
        bar.innerHTML = `
            <span class="inbox-selection-count">${this.escape(
                this.t('dashboard.inboxSelectedCount', '{count} selected', { count })
            )}</span>
            <button type="button" class="inbox-bulk-btn" data-inbox-selection="read">${this.escape(this.t('dashboard.inboxMarkRead', 'Mark read'))}</button>
            <button type="button" class="inbox-bulk-btn" data-inbox-selection="snooze">${this.escape(this.t('dashboard.inboxSnooze', 'Snooze'))}</button>
            <button type="button" class="inbox-bulk-btn inbox-bulk-btn--danger" data-inbox-selection="delete">${this.escape(this.t('dashboard.inboxDelete', 'Delete'))}</button>
            <button type="button" class="inbox-bulk-btn" data-inbox-selection="clear">${this.escape(this.t('dashboard.inboxSelectionClear', 'Clear selection'))}</button>
        `;
    }

    async bulkMarkRead() {
        const targets = this.checkedItems().filter((i) => !i.readAt);
        if (!targets.length) return;
        this._trackAction('bulk-read', { size: this._countBucket(targets.length) });
        await Promise.allSettled(targets.map((item) => this.markRead(item.id)));
        this.clearChecked();
        if (this.isActiveView()) {
            this.render();
        }
    }

    async bulkSnooze(items, until) {
        const targets = (items || []).filter(Boolean);
        if (!targets.length || !until) return;
        this._trackAction('bulk-snooze', { size: this._countBucket(targets.length) });
        await Promise.allSettled(targets.map((item) => this.patchSnooze(item.id, until)));
        this.clearChecked();
        if (this.isActiveView()) {
            this.render();
        } else {
            await this.refreshBadge();
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
        const snapshots = targets.map((item) => JSON.parse(JSON.stringify(item)));
        const results = await Promise.allSettled(targets.map((item) => this.deleteItem(item.id)));
        const removed = results.filter((r) => r.status === 'fulfilled').length;
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
        d.showNotification(
            this.t('dashboard.inboxSelectionDeleteDone', 'Removed {count} selected items', { count: removed }),
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
                            ? this.t('dashboard.inboxSelectionDeleteRestored', 'Restored {count} links', { count: back })
                            : this.t('dashboard.inboxUndoFailed', 'Could not restore'),
                        back ? 'success' : 'error',
                        { duration: 3000 }
                    );
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
        } catch { /* unreadable storage falls back to the defaults */ }
    }

    /** Remember filter and sort for the next visit. Best-effort by design. */
    persistViewState() {
        try {
            localStorage.setItem(
                DashboardInbox.STATE_KEY,
                JSON.stringify({ filter: this.filter, sort: this.sort })
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
        try {
            await this.deleteItem(id);
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
                        } catch {
                            d.showNotification(
                                this.t('dashboard.inboxUndoFailed', 'Could not restore'),
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

    async markRead(id) {
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await fetcher('/api/inbox', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, readAt: Date.now() }),
        });
        if (!res.ok) {
            this.dash.showNotification?.(
                this.t('dashboard.inboxMarkReadFailed', 'Could not mark as read'),
                'error'
            );
            return;
        }
        const item = this.items.find((entry) => entry.id === id);
        if (item) {
            item.readAt = Date.now();
        }
        this.dash.pageNav?.updateInboxTabBadge?.();
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

    restoreInboxHash() {
        if (window.location.hash !== '#inbox') {
            history.replaceState(
                history.state,
                '',
                `${window.location.pathname}${window.location.search}#inbox`
            );
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
        return true;
    }

    async leaveInboxView(pageId) {
        const d = this.dash;
        this.clearKeyboardSelection();
        d.setActiveView('bookmarks');
        return d.loadPageBookmarks(pageId, { skipInlineEditConfirm: true });
    }


    closeInboxView() {
        const d = this.dash;
        if (d.activeView !== DashboardInbox.VIEW) {
            return false;
        }
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

        const cards = this.getVisibleItemCards();
        if (!cards.length) {
            return false;
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
            return true;
        }
        if (e.key === 'Escape' && this.checkedIds.size) {
            // Escape drops the selection before it closes anything else: an
            // accidental tick should be cheap to undo.
            e.preventDefault();
            e.stopImmediatePropagation();
            this.clearChecked();
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
        await this.markRead(item.id);
        this.applyItemReadLocally(item.id);
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

        const count = this.items.length;
        const unread = this.unreadCount();
        const readCount = this.items.filter((entry) => entry.readAt).length;
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
        const time = wake.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
        const day = wake.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
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
     */
    async clearReadItems() {
        const targets = this.items.filter((item) => item.readAt);
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
            card.setAttribute('aria-selected', selected ? 'true' : 'false');
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
            card.setAttribute('aria-selected', 'false');
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


    async loadAndRender({ refresh = false } = {}) {
        const needsFetch = refresh || !this._itemsLoaded;
        this.loading = needsFetch && !(this.items && this.items.length);
        if (this.loading) {
            this.render();
        }
        if (needsFetch) {
            try {
                await this.fetchItems();
            } catch {
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

    /** Items added in the last 7 days — the "this week" summary tile. */
    weekAddedCount() {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return (this.items || []).filter((item) => Number(item.addedAt || 0) >= cutoff).length;
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
        return date.toLocaleDateString(undefined, opts);
    }

    getFilteredItems() {
        let list = Array.isArray(this.items) ? this.items.slice() : [];
        if (this.filter === 'snoozed') {
            // Snoozed view: only sleeping items, soonest to wake first.
            list = list
                .filter((item) => this.isSnoozed(item))
                .sort((a, b) => Number(a.snoozedUntil || 0) - Number(b.snoozedUntil || 0));
        } else {
            // All / Unread hide anything still snoozed; an elapsed snooze reappears.
            list = list.filter((item) => !this.isSnoozed(item));
            if (this.filter === 'unread') {
                list = list.filter((item) => !item.readAt);
            } else if (this.filter === 'noted') {
                list = list.filter((item) => String(item.note || '').trim());
            }
        }
        const domainWant = String(this.domainFilter || '').trim().toLowerCase();
        if (domainWant) {
            list = list.filter((item) => this.itemDomain(item) === domainWant);
        }
        const query = String(this.searchQuery || '').trim().toLowerCase();
        if (query) {
            list = list.filter((item) => {
                const haystack = [
                    item.url,
                    item.title,
                    item.previewTitle,
                    item.domain,
                    item.note,
                ].filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(query);
            });
        }
        return this.sortItems(list);
    }

    /** Distinct site hosts currently in the inbox, for the domain filter control. */
    uniqueDomains() {
        const hosts = new Set();
        (this.items || []).forEach((item) => {
            const host = this.itemDomain(item);
            if (host) {
                hosts.add(host);
            }
        });
        return [...hosts].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
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

        let filtered = this.getFilteredItems();
        let index = filtered.findIndex((entry) => entry.id === sid);
        if (index < 0) {
            this.filter = 'all';
            this.searchQuery = '';
            this.domainFilter = '';
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
        const items = this.getFilteredItems();
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
    renderLegend() {
        const legend = document.createElement('p');
        legend.className = 'inbox-legend';
        legend.setAttribute('aria-hidden', 'true');
        const keys = [
            ['j / k', this.t('dashboard.inboxKeyMove', 'move')],
            ['Enter / Space', this.t('dashboard.inboxKeyOpen', 'open')],
            ['dblclick', this.t('dashboard.inboxKeyDblClick', 'open')],
            ['p', this.t('dashboard.inboxKeyPromote', 'promote')],
            ['n', this.t('dashboard.inboxKeyNote', 'note')],
            ['r', this.t('dashboard.inboxKeyKeep', 'mark read')],
            ['z', this.t('dashboard.inboxKeySnooze', 'snooze')],
            ['x', this.t('dashboard.inboxKeySelect', 'select')],
            ['d', this.t('dashboard.inboxKeyDelete', 'delete')],
            ['g / G / Home / End', this.t('dashboard.inboxKeyFirstLast', 'first / last')],
            ['t', this.t('dashboard.inboxKeyTriage', 'triage')],
            ['Esc', this.t('dashboard.inboxKeyEsc', 'clear selection · back to bookmarks')],
        ];
        legend.innerHTML = keys
            .map(([k, label]) => `<span><kbd>${this.escape(k)}</kbd> ${this.escape(label)}</span>`)
            .join('');
        return legend;
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
            // Ticks from a previous query would act on rows the user can no longer
            // see, so a search change starts the selection over (same as filter).
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

        container.innerHTML = '';
        container.className = 'inbox-layout';
        container.removeAttribute('aria-colcount');
        container.removeAttribute('aria-rowcount');
        container.setAttribute('role', 'feed');
        container.setAttribute(
            'aria-label',
            this.t('dashboard.inboxPageTitle', 'Inbox')
        );
        container.removeAttribute('data-i18n-aria');

        const title = this.t('dashboard.inboxPageTitle', 'Inbox');
        const subtitle = this.t('dashboard.inboxPageSubtitle', 'Links saved to read or review later');
        const trail = this.headerBreadcrumb();
        const showTrail = trail.includes(' › ');
        const count = this.items.length;
        const unread = this.unreadCount();
        const filtered = this.getFilteredItems();

        const header = document.createElement('div');
        header.className = 'inbox-header';
        header.innerHTML = `
            <div class="inbox-header-text">
                <h2 class="inbox-title">${this.escape(title)}</h2>
                <p class="inbox-head-breadcrumb"${showTrail ? '' : ' hidden'}>${this.escape(trail)}</p>
                <p class="inbox-subtitle">${this.escape(subtitle)}</p>
            </div>
            <div class="inbox-header-meta">
                <span class="inbox-count-badge">${count}</span>
                ${unread > 0 ? `<span class="inbox-unread-badge">${unread} ${this.escape(this.t('dashboard.inboxUnread', 'unread'))}</span>` : ''}
            </div>
        `;
        container.appendChild(header);

        const readCount = this.items.filter((entry) => entry.readAt).length;
        const snoozedCount = this.snoozedCount();

        // Summary tiles, mirroring the health view. The first three double as
        // filters (Total → all, Unread → unread, Snoozed → snoozed); "This week"
        // is a plain readout with no matching filter, so it renders as a <div>.
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
            tile(this.t('dashboard.inboxTileTotal', 'Total'), count, { filter: 'all' }),
            tile(this.t('dashboard.inboxTileUnread', 'Unread'), unread, { filter: 'unread', mod: 'unread' }),
            tile(this.t('dashboard.inboxTileSnoozed', 'Snoozed'), snoozedCount, { filter: 'snoozed' }),
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
        const notedCount = (this.items || []).filter(
            (item) => !this.isSnoozed(item) && String(item.note || '').trim()
        ).length;
        const showNotedPill = notedCount > 0 || this.filter === 'noted';
        const domains = this.uniqueDomains();
        const showDomainSelect = domains.length > 0;

        const sortOptions = [
            ['newest', this.t('dashboard.inboxSortNewest', 'newest first')],
            ['oldest', this.t('dashboard.inboxSortOldest', 'oldest first')],
            ['title', this.t('dashboard.inboxSortTitle', 'title')],
            ['domain', this.t('dashboard.inboxSortDomain', 'site')],
        ].map(([value, label]) =>
            `<option value="${value}"${this.sort === value ? ' selected' : ''}>${this.escape(label)}</option>`
        ).join('');

        const domainOptions = [
            `<option value="">${this.escape(this.t('dashboard.inboxDomainAll', 'All sites'))}</option>`,
            ...domains.map((host) =>
                `<option value="${this.escape(host)}"${this.domainFilter === host ? ' selected' : ''}>${this.escape(host)}</option>`
            ),
        ].join('');

        toolbar.innerHTML = `
            <div class="inbox-filter-group" role="tablist" aria-label="${this.escape(this.t('dashboard.inboxFilterLabel', 'Filter inbox'))}">
                <button type="button" class="inbox-filter-btn${this.filter === 'all' ? ' is-active' : ''}" role="tab" aria-selected="${this.filter === 'all'}" tabindex="${this.filter === 'all' ? 0 : -1}" data-inbox-filter="all">${this.escape(this.t('dashboard.inboxFilterAll', 'All'))}</button>
                <button type="button" class="inbox-filter-btn${this.filter === 'unread' ? ' is-active' : ''}" role="tab" aria-selected="${this.filter === 'unread'}" tabindex="${this.filter === 'unread' ? 0 : -1}" data-inbox-filter="unread">${this.escape(this.t('dashboard.inboxFilterUnread', 'Unread'))}</button>
                ${showSnoozePill ? `<button type="button" class="inbox-filter-btn${this.filter === 'snoozed' ? ' is-active' : ''}" role="tab" aria-selected="${this.filter === 'snoozed'}" tabindex="${this.filter === 'snoozed' ? 0 : -1}" data-inbox-filter="snoozed">${this.escape(this.t('dashboard.inboxFilterSnoozed', 'Snoozed'))}<span class="inbox-filter-count">${snoozedCount}</span></button>` : ''}
                ${showNotedPill ? `<button type="button" class="inbox-filter-btn${this.filter === 'noted' ? ' is-active' : ''}" role="tab" aria-selected="${this.filter === 'noted'}" tabindex="${this.filter === 'noted' ? 0 : -1}" data-inbox-filter="noted">${this.escape(this.t('dashboard.inboxFilterNoted', 'With note'))}<span class="inbox-filter-count">${notedCount}</span></button>` : ''}
            </div>
            ${showDomainSelect ? `<select class="inbox-domain-select" aria-label="${this.escape(this.t('dashboard.inboxDomainFilterLabel', 'Filter by site'))}">${domainOptions}</select>` : ''}
            <input type="search" class="inbox-search-input" value="${this.escape(this.searchQuery)}" placeholder="${this.escape(this.t('dashboard.inboxSearchPlaceholder', 'Search inbox…'))}" autocomplete="off" spellcheck="false" aria-label="${this.escape(this.t('dashboard.inboxSearchPlaceholder', 'Search inbox…'))}">
            ${this.filter === 'snoozed' ? '' : `<select class="inbox-sort-select" aria-label="${this.escape(this.t('dashboard.inboxSortLabel', 'Sort inbox'))}">${sortOptions}</select>`}
            ${unread > 0 ? `<button type="button" class="inbox-bulk-btn" data-inbox-bulk="read">${this.escape(this.t('dashboard.inboxMarkAllRead', 'Mark all read'))}</button>` : ''}
            ${readCount > 0 ? `<button type="button" class="inbox-bulk-btn" data-inbox-bulk="clear-read">${this.escape(this.t('dashboard.inboxClearRead', 'Clear read'))}</button>` : ''}
            <button type="button" class="inbox-bulk-btn" data-inbox-export="csv" title="${this.escape(this.t('dashboard.inboxExportCsvHint', 'Download filtered list as CSV'))}">${this.escape(this.t('dashboard.inboxExportCsv', 'CSV'))}</button>
            <button type="button" class="inbox-bulk-btn" data-inbox-export="json" title="${this.escape(this.t('dashboard.inboxExportJsonHint', 'Download filtered list as JSON'))}">${this.escape(this.t('dashboard.inboxExportJson', 'JSON'))}</button>
            <button type="button" class="inbox-triage-btn">${this.escape(this.t('dashboard.inboxTriage', 'Triage'))}<kbd>t</kbd></button>
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
        toolbar.querySelector('[data-inbox-export="csv"]')?.addEventListener('click', () => {
            this.exportFilteredCsv();
        });
        toolbar.querySelector('[data-inbox-export="json"]')?.addEventListener('click', () => {
            this.exportFilteredJson();
        });
        container.appendChild(toolbar);

        if (this.loading) {
            const loading = document.createElement('p');
            loading.className = 'inbox-empty';
            loading.textContent = this.t('dashboard.inboxLoading', 'Loading…');
            container.appendChild(loading);
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
            this.finishInboxRenderFocus(container, preserveSearch, searchCaret);
            return;
        }

        if (!filtered.length) {
            const empty = document.createElement('div');
            empty.className = 'inbox-empty-state';
            empty.innerHTML = `
                <p class="inbox-empty-title">${this.escape(this.t('dashboard.inboxNoMatches', 'No matching links'))}</p>
                <p class="inbox-empty-hint">${this.escape(this.t('dashboard.inboxNoMatchesHint', 'Try another filter or search term'))}</p>
            `;
            container.appendChild(empty);
            this.finishInboxRenderFocus(container, preserveSearch, searchCaret);
            return;
        }

        const visible = filtered.slice(0, this.visibleLimit);
        const groups = this.groupFilteredItems(visible);
        const list = document.createElement('div');
        list.className = 'inbox-feed';
        groups.forEach((group) => {
            const section = document.createElement('section');
            section.className = 'inbox-date-group';
            // A flat sort has no heading; an empty <h3> would leave its margin
            // behind as a gap above the first row.
            section.innerHTML = group.label
                ? `<h3 class="inbox-date-group-title">${this.escape(group.label)}</h3>`
                : '';
            const groupList = document.createElement('div');
            groupList.className = 'inbox-date-group-items';
            group.items.forEach((item) => {
                groupList.appendChild(this.createItemElement(item));
            });
            section.appendChild(groupList);
            list.appendChild(section);
        });
        container.appendChild(list);

        if (filtered.length > this.visibleLimit) {
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'inbox-load-more-btn';
            const remaining = filtered.length - this.visibleLimit;
            more.textContent = this.t('dashboard.inboxLoadMore', 'Show {count} more', { count: remaining });
            more.addEventListener('click', () => {
                this.visibleLimit += 50;
                this.render();
            });
            container.appendChild(more);
        }

        container.appendChild(this.renderLegend());
        this.renderBulkBar();

        if (container.querySelector('.inbox-feed')) {
            this.bindPointerNavigation(container);
        }

        this.schedulePreviewRefresh();
        this.scheduleWakeRefresh();
        this.applyPendingItemFocus();
        this.finishInboxRenderFocus(container, preserveSearch, searchCaret);
    }

    createItemElement(item) {
        const d = this.dash;
        const card = document.createElement('article');
        card.className = 'inbox-item' + (item.readAt ? ' is-read' : ' is-unread');
        card.dataset.inboxId = item.id;
        card.dataset.bookmarkUrl = item.url || '';
        card.dataset.inboxShareName = item.previewTitle || item.title || item.domain || '';
        card.tabIndex = -1;
        card.setAttribute('aria-selected', 'false');

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
        card.innerHTML = `
            <label class="inbox-item-check">
                <input type="checkbox" class="inbox-item-check-input"${checked ? ' checked' : ''}
                    aria-label="${this.escape(this.t('dashboard.inboxSelectItem', 'Select {title}', { title }))}">
            </label>
            ${thumb}
            <div class="inbox-item-body">
                <h3 class="inbox-item-title">${this.escape(title)}</h3>
                <p class="inbox-item-meta">
                    <button type="button" class="inbox-item-domain inbox-item-domain-btn" data-inbox-domain="${this.escape(this.itemDomain(item))}">${this.escape(domain)}</button>
                    ${addedLabel ? `<span class="inbox-item-date" title="${this.escape(this.t('dashboard.inboxAddedOn', 'Added on {date}', { date: addedLabel }))}">${this.escape(addedLabel)}</span>` : ''}
                    ${timeLabel ? `<span class="inbox-item-time">${this.escape(timeLabel)}</span>` : ''}
                    ${wakeLabel}
                </p>
                ${item.note ? `<p class="inbox-item-note">${this.escape(item.note)}</p>` : ''}
                <div class="inbox-item-actions">
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
        checkInput?.addEventListener('change', () => {
            this.setChecked(item.id, checkInput.checked);
        });
        // The checkbox is inside the row, which opens on click — without this,
        // ticking a box would also launch the link.
        card.querySelector('.inbox-item-check')?.addEventListener('click', (e) => e.stopPropagation());

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
        void this.markRead(item.id).then(() => {
            this.applyItemReadLocally(item.id);
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
            await this.markRead(id);
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
            this.t('dashboard.inboxExportColNote', 'Note'),
            this.t('dashboard.inboxExportColAdded', 'Added'),
            this.t('dashboard.inboxExportColRead', 'Read'),
            this.t('dashboard.inboxExportColSnoozedUntil', 'Snoozed until'),
            this.t('dashboard.inboxExportColSource', 'Source'),
        ];
        const rows = items.map((item) => [
            item.previewTitle || item.title || '',
            item.url || '',
            this.itemDomain(item),
            item.note || '',
            item.addedAt ? new Date(item.addedAt).toISOString() : '',
            item.readAt ? new Date(item.readAt).toISOString() : '',
            item.snoozedUntil ? new Date(item.snoozedUntil).toISOString() : '',
            item.source || '',
        ]);
        const csv = '﻿' + [header, ...rows]
            .map((row) => row.map((cell) => this.csvField(cell)).join(','))
            .join('\r\n');
        const stamp = new Date().toISOString().slice(0, 10);
        const suffix = this.domainFilter ? `-${this.domainFilter}` : '';
        this.downloadExportFile(`nextdash-inbox-${this.filter}${suffix}-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
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
            note: item.note || '',
            addedAt: item.addedAt || 0,
            readAt: item.readAt || 0,
            snoozedUntil: item.snoozedUntil || 0,
            source: item.source || '',
        }));
        const stamp = new Date().toISOString().slice(0, 10);
        const suffix = this.domainFilter ? `-${this.domainFilter}` : '';
        this.downloadExportFile(
            `nextdash-inbox-${this.filter}${suffix}-${stamp}.json`,
            `${JSON.stringify(payload, null, 2)}\n`,
            'application/json;charset=utf-8'
        );
        this._trackAction('export-json', { size: this._countBucket(items.length) });
    }

    highlightItem(id) {
        const card = document.querySelector(`[data-inbox-id="${id}"]`);
        if (!card) {
            return;
        }
        card.classList.add('inbox-item--highlight');
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        setTimeout(() => card.classList.remove('inbox-item--highlight'), 1800);
    }
}
