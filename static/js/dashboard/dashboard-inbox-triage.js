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
        this.focusCard();
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
        const wasOpen = Boolean(this.overlay);
        this.overlay?.remove();
        this.overlay = null;
        document.body.classList.remove('inbox-triage-active');
        if (wasOpen) {
            // Drop inert before restoring focus: the opener is inside the
            // background that was just made unreachable, so focusing it first
            // would be refused.
            window.FocusTrapUtils?.syncDashboardInert?.();
            const opener = this._opener;
            this._opener = null;
            if (opener) {
                // Closing re-renders the feed, which rebuilds the toolbar and
                // detaches the button that opened this. Fall back to the live
                // replacement so focus still lands where the user left it.
                const fallback = opener.classList?.contains('inbox-triage-btn')
                    ? document.querySelector('.inbox-triage-btn')
                    : null;
                if (window.FocusTrapUtils?.focusIfConnected) {
                    window.FocusTrapUtils.focusIfConnected(opener, fallback);
                } else {
                    (opener.isConnected ? opener : fallback)?.focus?.({ preventScroll: true });
                }
            }
        }
    }

    currentItem() {
        return this.queue[this.index] || null;
    }

    /** Keep the in-memory queue row aligned with this.items after a mutation. */
    syncQueueItem(id) {
        if (!id) {
            return;
        }
        const stored = this.inbox.items.find((entry) => entry.id === id);
        const slot = this.queue.find((entry) => entry.id === id);
        if (stored && slot) {
            Object.assign(slot, stored);
        }
    }

    mount() {
        this.unmount();
        // Remember who opened it so focus can go back there on close; without
        // this the caret lands at the top of the document and a keyboard user
        // has to tab back down to where they were.
        this._opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
            } else if (action === 'snooze') {
                void this.actSnooze(btn);
            } else if (action === 'note') {
                void this.actNote();
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
        // The overlay is aria-modal, so the dashboard behind it must stop being
        // reachable — by Tab or by screen reader — while it is up.
        window.FocusTrapUtils?.syncDashboardInert?.();
    }

    /**
     * Put focus on the primary action once a card is on screen.
     *
     * Called after render() rather than from mount(): the card is empty until
     * render fills it, so there is nothing to focus at mount time.
     */
    focusCard() {
        if (!this.isOpen()) {
            return;
        }
        const card = this.overlay?.querySelector('.inbox-triage-card');
        if (!card || card.contains(document.activeElement)) {
            return;
        }
        const primary = card.querySelector('[data-triage="open"]')
            || card.querySelector('.inbox-triage-close');
        primary?.focus({ preventScroll: true });
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

    /**
     * Whether a modal sits on top of triage.
     *
     * Deliberately not dash.isModalOpen(): that one reports triage itself as a
     * modal, which is right for the dashboard's own handlers and wrong here.
     */
    isLayeredModalOpen() {
        if (document.getElementById('app-modal')?.classList.contains('show')) return true;
        if (document.getElementById('config-confirm-modal')) return true;
        if (document.getElementById('paste-choice-modal')?.classList.contains('show')) return true;
        if (document.getElementById('new-bookmark-modal')?.classList.contains('show')) return true;
        if (document.getElementById('bookmark-form-modal')?.classList.contains('show')) return true;
        if (document.getElementById('date-popover')) return true;
        if (document.getElementById('move-popover')) return true;
        if (document.getElementById('tag-popover')) return true;
        return false;
    }

    handleKeydown(e) {
        if (!this.isOpen()) {
            return;
        }
        // Tab is trapped before every other check: the overlay is aria-modal, so
        // focus must not leave it even while a notification or quickstart card is
        // on screen, and even when the caret sits in the note input below.
        if (e.key === 'Tab' && this.overlay) {
            if (window.FocusTrapUtils?.trapTabKey(e, this.overlay)) {
                return;
            }
        }
        // isModalOpen() counts this overlay itself (see dashboard-ui-helpers),
        // so asking it here meant every key but Escape was swallowed by the
        // very thing that was open — j and k did nothing and triage sat on the
        // first link. Ask whether something is layered *over* triage instead.
        if (this.isLayeredModalOpen() && e.key !== 'Escape') {
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
            return;
        }
        if (key === 'z') {
            e.preventDefault();
            const anchor = this.overlay?.querySelector('[data-triage="snooze"]');
            void this.actSnooze(anchor);
            return;
        }
        if (key === 'n') {
            e.preventDefault();
            void this.actNote();
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
        const url = String(item.url || '').trim();
        if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
        if (!item.readAt) {
            // Only record it locally once the write landed. Opening is the
            // point of this action and the tab is already open, so a failed
            // read mark advances anyway rather than trapping the user on a row
            // they have dealt with — it reports and moves on.
            if (await this.inbox.markReadReporting(item.id)) {
                item.readAt = Date.now();
            }
        }
        await this.afterAction(false, { readId: item.id });
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
            // Unlike Open, the read mark *is* this action. Advancing past a
            // failure would move the card on from an item that is still unread,
            // so a failed keep reports and stays put for another try.
            if (!(await this.inbox.markReadReporting(item.id))) {
                return;
            }
            item.readAt = Date.now();
        }
        await this.afterAction(false, { readId: item.id });
    }

    async actDelete() {
        const item = this.currentItem();
        if (!item) {
            return;
        }
        // The result decides whether the card may go. It was discarded before,
        // and `silent` suppresses the toast as well, so a failed delete removed
        // the card from the queue and the row from the feed while the item was
        // still on the server — reappearing on the next reload, with nothing
        // said. Same shape as actOpen's markReadReporting check above.
        const deleted = await this.inbox.deleteItemWithUndo(item.id, { silent: true, skipRender: true });
        if (!deleted) {
            this.inbox.dash.showErrorNotification?.(
                this.inbox.t('dashboard.inboxDeleteFailed', 'Could not delete')
            );
            return;
        }
        await this.afterAction(true, { removedId: item.id });
    }

    async actSnooze(anchor) {
        const item = this.currentItem();
        if (!item) {
            return;
        }
        if (this.inbox.isSnoozed(item)) {
            await this.inbox.wakeItem(item);
            this.syncQueueItem(item.id);
            this.render();
            return;
        }
        this.inbox.openSnoozeMenu(item, anchor, null, {
            onApplied: async () => {
                await this.afterAction(true, { removedId: item.id });
            },
        });
    }

    async actNote() {
        const item = this.currentItem();
        if (!item) {
            return;
        }
        await this.inbox.editNote(item, { skipRender: true });
        this.syncQueueItem(item.id);
        this.render();
    }

    async afterAction(removed, sync = {}) {
        if (removed) {
            const removedId = sync.removedId ?? this.queue[this.index]?.id;
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
            this.render();
            if (this.inbox.isActiveView()) {
                if (removedId) {
                    this.inbox.removeItemFromFeed(removedId);
                }
            } else {
                await this.inbox.refreshBadge();
            }
            return;
        }

        if (sync.readId) {
            this.inbox.applyItemReadLocally(sync.readId);
        }
        if (this.index < this.queue.length - 1) {
            this.index += 1;
        } else if (this.queue.length > 1) {
            this.index = 0;
        }
        this.syncQueueItem(this.currentItem()?.id);
        this.render();
    }

    render() {
        const card = this.overlay?.querySelector('.inbox-triage-card');
        const item = this.currentItem();
        if (!card || !item) {
            this.close();
            return;
        }
        const hadFocusInCard = card.contains(document.activeElement);

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
        const snoozed = this.inbox.isSnoozed(item);
        const snoozeLabel = snoozed
            ? this.t('dashboard.inboxWake', 'Wake now')
            : this.t('dashboard.inboxSnooze', 'Snooze');
        const noteLabel = item.note
            ? this.t('dashboard.inboxEditNote', 'Edit note')
            : this.t('dashboard.inboxAddNote', 'Note');

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
                <button type="button" class="inbox-action-btn" data-triage="snooze">${this.escape(snoozeLabel)} <kbd>Z</kbd></button>
                <button type="button" class="inbox-action-btn" data-triage="note">${this.escape(noteLabel)} <kbd>N</kbd></button>
                <button type="button" class="inbox-action-btn inbox-action-btn--danger" data-triage="delete">${this.escape(this.t('dashboard.inboxDelete', 'Delete'))} <kbd>D</kbd></button>
            </div>
            <p class="inbox-triage-hint">${this.escape(this.t('dashboard.inboxTriageHint', 'J/K next · O open · P promote · R keep · Z snooze · N note · D delete · Esc close'))}</p>
        `;

        // Rewriting the card destroys whatever was focused inside it, which
        // would drop focus to <body> — outside the trap — every time the queue
        // advanced. Only re-focus when focus was already in the card, so this
        // never steals it from the note prompt or a modal opened on top.
        if (hadFocusInCard) {
            this.focusCard();
        }
    }
}
