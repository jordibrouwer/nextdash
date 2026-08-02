/**
 * Inbox triage overlay — process items one-by-one with keyboard shortcuts.
 */
class DashboardInboxTriage {
    constructor(inbox) {
        this.inbox = inbox;
        this.queue = [];
        this.index = 0;
        this.overlay = null;
        this._keyHandler = null;
    }

    get dash() {
        return this.inbox.dash;
    }

    t(key, fallback, params) {
        return this.inbox.t(key, fallback, params);
    }

    escape(text) {
        return this.inbox.escape(text);
    }

    isOpen() {
        return Boolean(this.overlay?.isConnected);
    }

    start(items) {
        this.queue = Array.isArray(items) ? items.slice() : [];
        this.index = 0;
        if (!this.queue.length) {
            this.dash.showNotification(
                this.t('dashboard.inboxTriageEmpty', 'Nothing to triage'),
                'info'
            );
            return false;
        }
        this.mount();
        this.render();
        return this.isOpen();
    }

    close() {
        this.unmount();
        this.queue = [];
        this.index = 0;
    }

    unmount() {
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler, true);
            this._keyHandler = null;
        }
        const card = this.overlay?.querySelector('.inbox-triage-card');
        if (card && this._cardClickHandler) {
            card.removeEventListener('click', this._cardClickHandler);
        }
        if (card && this._cardErrorHandler) {
            card.removeEventListener('error', this._cardErrorHandler, true);
        }
        this._cardClickHandler = null;
        this._cardErrorHandler = null;
        this.overlay?.remove();
        this.overlay = null;
        document.body.classList.remove('inbox-triage-active');
    }

    currentItem() {
        return this.queue[this.index] || null;
    }

    mount() {
        this.unmount();
        document.body.classList.add('inbox-triage-active');
        const overlay = document.createElement('div');
        overlay.id = 'inbox-triage-overlay';
        overlay.className = 'inbox-triage-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', this.t('dashboard.inboxTriage', 'Triage inbox'));
        overlay.innerHTML = '<div class="inbox-triage-card"></div>';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.close();
            }
        });
        document.body.appendChild(overlay);
        this.overlay = overlay;

        const card = overlay.querySelector('.inbox-triage-card');
        this._cardClickHandler = (e) => {
            if (e.target.closest('.inbox-triage-close')) {
                this.close();
                return;
            }
            const btn = e.target.closest('[data-triage]');
            if (!btn) {
                return;
            }
            const action = btn.getAttribute('data-triage');
            if (action === 'open') {
                void this.actOpen();
            } else if (action === 'promote') {
                this.actPromote();
            } else if (action === 'keep') {
                void this.actKeep();
            } else if (action === 'delete') {
                void this.actDelete();
            }
        };
        card?.addEventListener('click', this._cardClickHandler);
        this._cardErrorHandler = (e) => {
            const img = e.target;
            if (!img?.matches?.('.inbox-triage-thumb-img')) {
                return;
            }
            const fallback = img.getAttribute('data-fallback');
            if (fallback) {
                img.removeAttribute('data-fallback');
                img.src = fallback;
                return;
            }
            const slot = img.parentElement;
            img.remove();
            if (slot) {
                slot.classList.add('inbox-triage-thumb--placeholder');
                slot.textContent = '🔗';
            }
        };
        card?.addEventListener('error', this._cardErrorHandler, true);

        this._keyHandler = (e) => this.handleKeydown(e);
        document.addEventListener('keydown', this._keyHandler, true);
    }

    renderThumb(item) {
        const iconSrc = this.inbox.resolveIconSrc(item.icon);
        const previewSrc = String(item.previewImage || '').trim();
        if (iconSrc || previewSrc) {
            const primary = iconSrc || previewSrc;
            const fallback = iconSrc && previewSrc ? previewSrc : '';
            return `<div class="inbox-triage-thumb" aria-hidden="true"><img class="inbox-triage-thumb-img" src="${this.escape(primary)}" alt="" loading="lazy"${fallback ? ` data-fallback="${this.escape(fallback)}"` : ''}></div>`;
        }
        return `<div class="inbox-triage-thumb inbox-triage-thumb--placeholder" aria-hidden="true">🔗</div>`;
    }

    handleKeydown(e) {
        if (!this.isOpen()) {
            return;
        }
        if (this.dash.isModalOpen?.() && e.key !== 'Escape') {
            return;
        }
        const tag = e.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
            return;
        }

        const key = e.key.toLowerCase();
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.close();
            return;
        }
        if (key === 'j' || e.key === 'ArrowDown') {
            e.preventDefault();
            this.advance(1);
            return;
        }
        if (key === 'k' || e.key === 'ArrowUp') {
            e.preventDefault();
            this.advance(-1);
            return;
        }
        if (key === 'o' || e.key === 'Enter') {
            e.preventDefault();
            void this.actOpen();
            return;
        }
        if (key === 'p') {
            e.preventDefault();
            this.actPromote();
            return;
        }
        if (key === 'd' || e.key === 'Delete') {
            e.preventDefault();
            void this.actDelete();
            return;
        }
        if (key === 'r' || key === ' ') {
            e.preventDefault();
            void this.actKeep();
        }
    }

    advance(delta) {
        if (!this.queue.length) {
            this.close();
            return;
        }
        this.index = Math.max(0, Math.min(this.queue.length - 1, this.index + delta));
        this.render();
    }

    async actOpen() {
        const item = this.currentItem();
        if (!item) {
            return;
        }
        this.inbox.openItem(item);
        await this.afterAction(false);
    }

    actPromote() {
        const item = this.currentItem();
        if (!item) {
            return;
        }
        const d = this.dash;
        d._pendingInboxPromoteId = item.id;
        d._pendingInboxTriageAdvance = true;
        this.inbox.promoteItem(item);
        this.close();
    }

    async actKeep() {
        const item = this.currentItem();
        if (!item) {
            return;
        }
        if (!item.readAt) {
            await this.inbox.markRead(item.id);
        }
        await this.afterAction(false);
    }

    async actDelete() {
        const item = this.currentItem();
        if (!item) {
            return;
        }
        await this.inbox.deleteItemWithUndo(item.id, { silent: true });
        await this.afterAction(true);
    }

    async afterAction(removed) {
        if (removed) {
            this.queue.splice(this.index, 1);
            if (!this.queue.length) {
                this.close();
                if (this.inbox.isActiveView()) {
                    await this.inbox.loadAndRender();
                }
                return;
            }
            if (this.index >= this.queue.length) {
                this.index = this.queue.length - 1;
            }
        } else if (this.index < this.queue.length - 1) {
            this.index += 1;
        } else if (this.queue.length > 1) {
            this.index = 0;
        }
        this.render();
        if (this.inbox.isActiveView()) {
            await this.inbox.loadAndRender();
        } else {
            await this.inbox.refreshBadge();
        }
    }

    render() {
        const card = this.overlay?.querySelector('.inbox-triage-card');
        const item = this.currentItem();
        if (!card || !item) {
            this.close();
            return;
        }

        const title = item.previewTitle || item.title || item.domain || item.url;
        const domain = item.domain || this.inbox.formatUrlDisplay(item.url);
        const timeLabel = this.inbox.formatRelativeTime(item.addedAt);
        const total = this.queue.length;
        const position = this.index + 1;
        const progress = this.t('dashboard.inboxTriageProgress', '{current} / {total}', {
            current: position,
            total,
        });
        const thumb = this.renderThumb(item);

        card.innerHTML = `
            <header class="inbox-triage-header">
                <p class="inbox-triage-kicker">${this.escape(this.t('dashboard.inboxTriage', 'Triage inbox'))}</p>
                <p class="inbox-triage-progress">${this.escape(progress)}</p>
                <button type="button" class="inbox-triage-close" aria-label="${this.escape(this.t('dashboard.inboxTriageClose', 'Close'))}">×</button>
            </header>
            <div class="inbox-triage-body">
                ${thumb}
                <div class="inbox-triage-text">
                    <h3 class="inbox-triage-title">${this.escape(title)}</h3>
                    <p class="inbox-triage-meta">
                        <span>${this.escape(domain)}</span>
                        ${timeLabel ? `<span>${this.escape(timeLabel)}</span>` : ''}
                    </p>
                    ${item.note ? `<p class="inbox-triage-note">${this.escape(item.note)}</p>` : ''}
                </div>
            </div>
            <div class="inbox-triage-actions">
                <button type="button" class="inbox-action-btn" data-triage="open">${this.escape(this.t('dashboard.inboxOpen', 'Open'))} <kbd>O</kbd></button>
                <button type="button" class="inbox-action-btn" data-triage="promote">${this.escape(this.t('dashboard.inboxPromote', 'Promote'))} <kbd>P</kbd></button>
                <button type="button" class="inbox-action-btn" data-triage="keep">${this.escape(this.t('dashboard.inboxTriageKeep', 'Keep'))} <kbd>R</kbd></button>
                <button type="button" class="inbox-action-btn inbox-action-btn--danger" data-triage="delete">${this.escape(this.t('dashboard.inboxDelete', 'Delete'))} <kbd>D</kbd></button>
            </div>
            <p class="inbox-triage-hint">${this.escape(this.t('dashboard.inboxTriageHint', 'J/K next · O open · P promote · R keep · D delete · Esc close'))}</p>
        `;
    }
}
