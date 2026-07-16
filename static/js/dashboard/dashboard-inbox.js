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
        this.visibleLimit = 50;
        this.selectedItemId = null;
        this.triage = typeof DashboardInboxTriage === 'function' ? new DashboardInboxTriage(this) : null;
        this._searchRenderTimer = null;
        this._searchFocusPending = false;
    }

    isEnabled() {
        return this.dash.settings?.inboxEnabled !== false;
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
        const res = await fetch('/api/inbox');
        if (!res.ok) {
            throw new Error(`inbox HTTP ${res.status}`);
        }
        const data = await res.json();
        this.items = Array.isArray(data.items) ? data.items : [];
        return this.items;
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
                if (body?.item?.id && this.isActiveView()) {
                    this.highlightItem(body.item.id);
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
        if (!snapshot) {
            return false;
        }
        const copy = JSON.parse(JSON.stringify(snapshot));
        try {
            await this.deleteItem(id);
            if (this.isActiveView()) {
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
        await fetcher('/api/inbox', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, readAt: Date.now() }),
        });
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
            window.InboxIntroModal?.scheduleShow?.();
            return true;
        }
        if (d.isInlineEditActive() && !(await d.confirmInlineEditBeforeNavigation())) {
            return false;
        }
        d._abortInlineEditForRender?.();
        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
        this.clearKeyboardSelection();
        d.activeView = DashboardInbox.VIEW;
        d.pageNav?.setActiveInboxTab?.();
        d.pageNav?.updateDocumentTitle?.();
        d.pageNav?.markInboxTabDiscovered?.();
        await this.loadAndRender();
        window.InboxIntroModal?.scheduleShow?.();
        this.restoreInboxHash();
        return true;
    }

    async leaveInboxView(pageId) {
        const d = this.dash;
        this.clearKeyboardSelection();
        d.activeView = 'bookmarks';
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


    setupKeyboardNavigation() {
        if (this._keyboardHandler) {
            document.removeEventListener('keydown', this._keyboardHandler, true);
            this._keyboardHandler = null;
        }
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
        if (e.key === 'g') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.selectedItemId = cards[0]?.dataset?.inboxId || null;
            this.applyKeyboardSelection(cards);
            return true;
        }
        if (e.key === 'G') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.selectedItemId = cards[cards.length - 1]?.dataset?.inboxId || null;
            this.applyKeyboardSelection(cards);
            return true;
        }
        return false;
    }

    /** Mark an item read without opening it — the keyboard "keep" action. */
    async markReadFromKeyboard(item) {
        if (item.readAt) {
            return;
        }
        await this.markRead(item.id);
        const card = document.querySelector(`[data-inbox-id="${CSS.escape(item.id)}"]`);
        card?.classList.remove('is-unread');
        card?.classList.add('is-read');
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

    /** Small popover of preset durations anchored to the Snooze button. */
    openSnoozeMenu(item, anchor) {
        this.closeSnoozeMenu();
        const menu = document.createElement('div');
        menu.className = 'inbox-snooze-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = this.snoozeDurations()
            .map((d) => `<button type="button" class="inbox-snooze-option" role="menuitem" data-snooze-until="${d.until}">${this.escape(d.label)}</button>`)
            .join('');
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

        menu.querySelectorAll('[data-snooze-until]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const until = Number(btn.getAttribute('data-snooze-until')) || 0;
                this.closeSnoozeMenu();
                void this.snoozeItem(item, until);
            });
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
            }
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


    async loadAndRender() {
        this.loading = true;
        try {
            await this.fetchItems();
        } catch {
            this.items = [];
        } finally {
            this.loading = false;
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
            }
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
        return list;
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
            ['Enter', this.t('dashboard.inboxKeyOpen', 'open')],
            ['p', this.t('dashboard.inboxKeyPromote', 'promote')],
            ['n', this.t('dashboard.inboxKeyNote', 'note')],
            ['r', this.t('dashboard.inboxKeyKeep', 'mark read')],
            ['z', this.t('dashboard.inboxKeySnooze', 'snooze')],
            ['d', this.t('dashboard.inboxKeyDelete', 'delete')],
            ['g / G', this.t('dashboard.inboxKeyFirstLast', 'first / last')],
            ['Esc', this.t('dashboard.inboxKeyClose', 'back to bookmarks')],
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
        const active = document.activeElement;
        const focusInToolbar = active?.closest?.('.inbox-toolbar, .page-nav-btn');
        if (!active || active === document.body || focusInToolbar) {
            container.focus({ preventScroll: true });
        }
        window.InboxIntroModal?.scheduleShow?.();
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
        const count = this.items.length;
        const unread = this.unreadCount();
        const filtered = this.getFilteredItems();

        const header = document.createElement('div');
        header.className = 'inbox-header';
        header.innerHTML = `
            <div class="inbox-header-text">
                <h2 class="inbox-title">${this.escape(title)}</h2>
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
        const toolbar = document.createElement('div');
        toolbar.className = 'inbox-toolbar';
        // The Snoozed pill only appears when something is asleep (or is the active
        // filter, so it does not vanish under the user when the last item wakes).
        const showSnoozePill = snoozedCount > 0 || this.filter === 'snoozed';
        toolbar.innerHTML = `
            <div class="inbox-filter-group" role="tablist" aria-label="${this.escape(this.t('dashboard.inboxFilterLabel', 'Filter inbox'))}">
                <button type="button" class="inbox-filter-btn${this.filter === 'all' ? ' is-active' : ''}" data-inbox-filter="all">${this.escape(this.t('dashboard.inboxFilterAll', 'All'))}</button>
                <button type="button" class="inbox-filter-btn${this.filter === 'unread' ? ' is-active' : ''}" data-inbox-filter="unread">${this.escape(this.t('dashboard.inboxFilterUnread', 'Unread'))}</button>
                ${showSnoozePill ? `<button type="button" class="inbox-filter-btn${this.filter === 'snoozed' ? ' is-active' : ''}" data-inbox-filter="snoozed">${this.escape(this.t('dashboard.inboxFilterSnoozed', 'Snoozed'))}<span class="inbox-filter-count">${snoozedCount}</span></button>` : ''}
            </div>
            <input type="search" class="inbox-search-input" value="${this.escape(this.searchQuery)}" placeholder="${this.escape(this.t('dashboard.inboxSearchPlaceholder', 'Search inbox…'))}" autocomplete="off" spellcheck="false" aria-label="${this.escape(this.t('dashboard.inboxSearchPlaceholder', 'Search inbox…'))}">
            ${unread > 0 ? `<button type="button" class="inbox-bulk-btn" data-inbox-bulk="read">${this.escape(this.t('dashboard.inboxMarkAllRead', 'Mark all read'))}</button>` : ''}
            ${readCount > 0 ? `<button type="button" class="inbox-bulk-btn" data-inbox-bulk="clear-read">${this.escape(this.t('dashboard.inboxClearRead', 'Clear read'))}</button>` : ''}
            <button type="button" class="inbox-triage-btn">${this.escape(this.t('dashboard.inboxTriage', 'Triage'))}</button>
        `;
        toolbar.querySelectorAll('[data-inbox-filter]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.filter = btn.getAttribute('data-inbox-filter') || 'all';
                this.visibleLimit = 50;
                this.render();
            });
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
            section.innerHTML = `<h3 class="inbox-date-group-title">${this.escape(group.label)}</h3>`;
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

        if (container.querySelector('.inbox-feed')) {
            this.bindPointerNavigation(container);
        }

        this.schedulePreviewRefresh();
        this.scheduleWakeRefresh();
        this.finishInboxRenderFocus(container, preserveSearch, searchCaret);
    }

    createItemElement(item) {
        const d = this.dash;
        const card = document.createElement('article');
        card.className = 'inbox-item' + (item.readAt ? ' is-read' : ' is-unread');
        card.dataset.inboxId = item.id;
        card.tabIndex = -1;
        card.setAttribute('aria-selected', 'false');

        const title = item.previewTitle || item.title || item.domain || item.url;
        const domain = item.domain || this.formatUrlDisplay(item.url);
        const timeLabel = this.formatRelativeTime(item.addedAt);
        const snoozed = this.isSnoozed(item);
        if (snoozed) {
            card.classList.add('is-snoozed');
        }
        // A freshly-added item enriches its preview server-side; until that lands the
        // placeholder shows a "fetching preview" pulse rather than a bare link glyph.
        const enriching = this.isPreviewPending(item);
        const thumb = item.previewImage
            ? `<div class="inbox-item-thumb" style="background-image:url('${this.escape(item.previewImage)}')"></div>`
            : `<div class="inbox-item-thumb inbox-item-thumb--placeholder${enriching ? ' inbox-item-thumb--loading' : ''}" aria-hidden="true">🔗</div>`;

        // On a snoozed card, swap the Snooze button for a Wake one and show when it
        // will resurface.
        const snoozeBtn = snoozed
            ? `<button type="button" class="inbox-action-btn" data-inbox-action="wake">${this.escape(this.t('dashboard.inboxWake', 'Wake now'))}<kbd>z</kbd></button>`
            : `<button type="button" class="inbox-action-btn" data-inbox-action="snooze">${this.escape(this.t('dashboard.inboxSnooze', 'Snooze'))}<kbd>z</kbd></button>`;
        const wakeLabel = snoozed
            ? `<span class="inbox-item-snooze">${this.escape(this.t('dashboard.inboxSnoozedUntil', 'Sleeping until {time}', { time: this.formatSnoozeWake(item.snoozedUntil) }))}</span>`
            : '';

        card.innerHTML = `
            ${thumb}
            <div class="inbox-item-body">
                <h3 class="inbox-item-title">${this.escape(title)}</h3>
                <p class="inbox-item-meta">
                    <span class="inbox-item-domain">${this.escape(domain)}</span>
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

        return card;
    }

    openItem(item) {
        const url = String(item?.url || '').trim();
        if (!url) {
            return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
        void this.markRead(item.id).then(() => {
            const card = document.querySelector(`[data-inbox-id="${item.id}"]`);
            card?.classList.remove('is-unread');
            card?.classList.add('is-read');
        });
    }

    promoteItem(item) {
        const d = this.dash;
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
    async editNote(item) {
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
                this.render();
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
