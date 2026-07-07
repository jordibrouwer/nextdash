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
            return d.formatDashboardLabel(key, params, fallback);
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
        return (this.items || []).filter((item) => !item.readAt).length;
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

    async deleteItem(id) {
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await fetcher(`/api/inbox?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
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

        const cards = this.getVisibleItemCards();
        if (!cards.length) {
            return false;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (isInboxSearch) {
                target.blur();
            }
            this.moveKeyboardSelection(1, cards);
            return true;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (isInboxSearch) {
                target.blur();
            }
            this.moveKeyboardSelection(-1, cards);
            return true;
        }
        if ((e.key === 'Enter' || e.key === ' ') && this.selectedItemId) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const item = this.items.find((entry) => entry.id === this.selectedItemId);
            if (item) {
                this.openItem(item);
            }
            return true;
        }
        return false;
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

    getFilteredItems() {
        let list = Array.isArray(this.items) ? this.items.slice() : [];
        if (this.filter === 'unread') {
            list = list.filter((item) => !item.readAt);
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

        const toolbar = document.createElement('div');
        toolbar.className = 'inbox-toolbar';
        toolbar.innerHTML = `
            <div class="inbox-filter-group" role="tablist" aria-label="${this.escape(this.t('dashboard.inboxFilterLabel', 'Filter inbox'))}">
                <button type="button" class="inbox-filter-btn${this.filter === 'all' ? ' is-active' : ''}" data-inbox-filter="all">${this.escape(this.t('dashboard.inboxFilterAll', 'All'))}</button>
                <button type="button" class="inbox-filter-btn${this.filter === 'unread' ? ' is-active' : ''}" data-inbox-filter="unread">${this.escape(this.t('dashboard.inboxFilterUnread', 'Unread'))}</button>
            </div>
            <input type="search" class="inbox-search-input" value="${this.escape(this.searchQuery)}" placeholder="${this.escape(this.t('dashboard.inboxSearchPlaceholder', 'Search inbox…'))}" autocomplete="off" spellcheck="false" aria-label="${this.escape(this.t('dashboard.inboxSearchPlaceholder', 'Search inbox…'))}">
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

        if (container.querySelector('.inbox-feed')) {
            this.bindPointerNavigation(container);
        }

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
        const thumb = item.previewImage
            ? `<div class="inbox-item-thumb" style="background-image:url('${this.escape(item.previewImage)}')"></div>`
            : `<div class="inbox-item-thumb inbox-item-thumb--placeholder" aria-hidden="true">🔗</div>`;

        card.innerHTML = `
            ${thumb}
            <div class="inbox-item-body">
                <h3 class="inbox-item-title">${this.escape(title)}</h3>
                <p class="inbox-item-meta">
                    <span class="inbox-item-domain">${this.escape(domain)}</span>
                    ${timeLabel ? `<span class="inbox-item-time">${this.escape(timeLabel)}</span>` : ''}
                </p>
                ${item.note ? `<p class="inbox-item-note">${this.escape(item.note)}</p>` : ''}
                <div class="inbox-item-actions">
                    <button type="button" class="inbox-action-btn" data-inbox-action="open">${this.escape(this.t('dashboard.inboxOpen', 'Open'))}</button>
                    <button type="button" class="inbox-action-btn" data-inbox-action="promote">${this.escape(this.t('dashboard.inboxPromote', 'Promote'))}</button>
                    <button type="button" class="inbox-action-btn inbox-action-btn--danger" data-inbox-action="delete">${this.escape(this.t('dashboard.inboxDelete', 'Delete'))}</button>
                </div>
            </div>
        `;

        card.querySelector('[data-inbox-action="open"]')?.addEventListener('click', () => {
            this.openItem(item);
        });
        card.querySelector('[data-inbox-action="promote"]')?.addEventListener('click', () => {
            this.promoteItem(item);
        });
        card.querySelector('[data-inbox-action="delete"]')?.addEventListener('click', async () => {
            await this.deleteItemWithUndo(item.id);
        });

        card.addEventListener('mouseenter', () => {
            if (!this.isActiveView()) {
                return;
            }
            this.selectItemById(item.id);
        });

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

    async completePromote(id) {
        if (this.dash.settings?.inboxDeleteAfterPromote === false) {
            await this.markRead(id);
            return;
        }
        try {
            await this.deleteItem(id);
            if (this.isActiveView()) {
                await this.loadAndRender();
            }
        } catch {
            // promote succeeded; inbox cleanup is best-effort
        }
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
