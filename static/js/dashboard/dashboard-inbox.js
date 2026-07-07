/**
 * Inbox page — lightweight link capture (separate from bookmarks).
 */
class DashboardInbox {
    static VIEW = 'inbox';

    constructor(dashboard) {
        this.dash = dashboard;
        this.items = [];
        this.loading = false;
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
        await this.refreshBadge();
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
        d.activeView = DashboardInbox.VIEW;
        d.pageNav?.setActiveInboxTab?.();
        d.pageNav?.updateDocumentTitle?.();
        await this.loadAndRender();
        if (window.location.hash !== '#inbox') {
            window.location.hash = 'inbox';
        }
        return true;
    }

    async leaveInboxView(pageId) {
        const d = this.dash;
        d.activeView = 'bookmarks';
        return d.loadPageBookmarks(pageId, { skipInlineEditConfirm: true });
    }


    closeInboxView() {
        const d = this.dash;
        if (d.activeView !== DashboardInbox.VIEW) {
            return false;
        }
        return d.pageNav?.restoreBookmarksViewForPage?.(d.currentPageId) ?? false;
    }


    setupEscapeShortcut() {
        const d = this.dash;
        if (this._escapeHandler) {
            document.removeEventListener('keydown', this._escapeHandler, true);
        }
        this._escapeHandler = (e) => {
            if (e.key !== 'Escape') return;
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

    render() {
        const d = this.dash;
        const container = document.getElementById('dashboard-layout');
        if (!container) {
            return;
        }

        d._abortInlineEditForRender?.();
        d.updateTagFilterIndicator?.();
        container.innerHTML = '';
        container.classList.remove('page-transition', 'tag-filter-layout', 'tag-filter-view');
        container.classList.add('inbox-layout');
        container.setAttribute('role', 'feed');
        container.setAttribute(
            'aria-label',
            this.t('dashboard.inboxPageTitle', 'Inbox')
        );

        const title = this.t('dashboard.inboxPageTitle', 'Inbox');
        const subtitle = this.t('dashboard.inboxPageSubtitle', 'Links saved to read or review later');
        const count = this.items.length;
        const unread = this.unreadCount();

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

        if (this.loading) {
            const loading = document.createElement('p');
            loading.className = 'inbox-empty';
            loading.textContent = this.t('dashboard.inboxLoading', 'Loading…');
            container.appendChild(loading);
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
            return;
        }

        const list = document.createElement('div');
        list.className = 'inbox-feed';
        this.items.forEach((item) => {
            list.appendChild(this.createItemElement(item));
        });
        container.appendChild(list);
        d.syncBookmarkGridA11y?.();
    }

    createItemElement(item) {
        const d = this.dash;
        const card = document.createElement('article');
        card.className = 'inbox-item' + (item.readAt ? ' is-read' : ' is-unread');
        card.dataset.inboxId = item.id;

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
            try {
                await this.deleteItem(item.id);
                card.remove();
                if (!this.items.length) {
                    this.render();
                }
            } catch {
                d.showNotification(this.t('dashboard.inboxDeleteFailed', 'Could not delete'), 'error');
            }
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
