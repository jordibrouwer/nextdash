/**
 * Inbox triage overlay — process items one-by-one with keyboard shortcuts.
 *
 * Drawn as Work through is in the Bookmarks view (health-focus.css): a pile
 * first, then one link at a time with where it came from and one clear next
 * step, then what the run did. Two tools for the same job -- one decision per
 * link -- should not look like two different apps.
 */
class DashboardInboxTriage {
    constructor(inbox) {
        this.inbox = inbox;
        this.queue = [];
        this.index = 0;
        this.overlay = null;
        this._keyHandler = null;
        // The start screen, while it is up: { piles, index }.
        this.chooser = null;
        // The pile a run walks, and what it has done so far.
        this.pile = null;
        this.tally = DashboardInboxTriage.emptyTally();
        // Promote hands the screen to the bookmark form and closes this; what
        // the run was, so a save can pick it up where it left off.
        this._resume = null;
    }

    static emptyTally() {
        return { promoted: 0, kept: 0, deleted: 0, snoozed: 0, read: 0 };
    }

    /*
     * The piles a run can take. Unread only -- a link already read has been
     * seen -- and never what is snoozed. "This list" is what triage walked
     * before there were piles: the unread of whatever the list shows now.
     */
    static WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    pileItems(id) {
        const now = Date.now();
        const unread = (this.inbox.items || []).filter((item) => item && !item.readAt && !this.inbox.isSnoozed(item));
        const age = (item) => now - (Number(item.addedAt) || now);
        if (id === 'waiting') {
            return unread.filter((item) => age(item) > DashboardInboxTriage.WEEK_MS)
                .sort((a, b) => (Number(a.addedAt) || 0) - (Number(b.addedAt) || 0));
        }
        if (id === 'new') {
            return unread.filter((item) => age(item) <= DashboardInboxTriage.WEEK_MS)
                .sort((a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0));
        }
        if (id === 'noted') {
            return unread.filter((item) => String(item.note || '').trim());
        }
        return (this.inbox.getFilteredItems?.() || []).filter((item) => item && !item.readAt);
    }

    /** The piles worth offering: the fullest first, the list as filtered last. */
    pileCounts() {
        const piles = ['waiting', 'new', 'noted']
            .map((id) => ({ id, count: this.pileItems(id).length }))
            .filter((pile) => pile.count > 0)
            .sort((a, b) => b.count - a.count);
        const list = this.pileItems('list').length;
        if (list > 0) piles.push({ id: 'list', count: list });
        return piles;
    }

    pileLabel(id) {
        const labels = {
            waiting: ['dashboard.inboxPileWaiting', 'Waiting longest'],
            new: ['dashboard.inboxPileNew', 'New this week'],
            noted: ['dashboard.inboxPileNoted', 'With a note'],
            list: ['dashboard.inboxPileList', 'This list, as filtered now'],
        };
        const [key, fallback] = labels[id] || labels.list;
        return this.t(key, fallback);
    }

    pileNote(id) {
        const notes = {
            waiting: ['dashboard.inboxPileWaitingNote', 'Unread for over a week — oldest first'],
            new: ['dashboard.inboxPileNewNote', 'Saved recently, not opened yet'],
            noted: ['dashboard.inboxPileNotedNote', 'You left yourself a reason'],
            list: ['dashboard.inboxPileListNote', 'Every unread link the list shows'],
        };
        const [key, fallback] = notes[id] || notes.list;
        return this.t(key, fallback);
    }

    /** The way in: which pile. False when there is nothing unread to walk. */
    openChooser() {
        const piles = this.pileCounts();
        if (!piles.length) {
            this.dash.showNotification(this.t('dashboard.inboxTriageEmpty', 'Nothing to triage'), 'info');
            return false;
        }
        this.queue = [];
        this.finished = false;
        this.chooser = { piles, index: 0 };
        this.mount();
        this.renderChooser();
        return this.isOpen();
    }

    startPile(id, { tally = null } = {}) {
        const items = this.pileItems(id);
        if (!items.length) {
            // The pile emptied after the chooser counted it. Starting it would
            // clear the chooser and leave its stale screen up with every key
            // but Escape dead; recount instead, or close when nothing is left.
            const piles = this.pileCounts();
            if (!piles.length) {
                this.close();
                this.dash.showNotification(this.t('dashboard.inboxTriageEmpty', 'Nothing to triage'), 'info');
                return false;
            }
            this.finished = false;
            this.chooser = { piles, index: 0 };
            if (!this.isOpen()) this.mount();
            this.renderChooser();
            return false;
        }
        this.chooser = null;
        return this.start(items, { pile: id, tally });
    }

    /** After a promote: the same pile, the run's tally, one more promoted. */
    canResume() {
        return Boolean(this._resume);
    }

    resume() {
        const state = this._resume;
        this._resume = null;
        if (!state) return false;
        const tally = { ...state.tally, promoted: state.tally.promoted + 1 };
        // Only what the run had not reached yet. The pile rebuilt from scratch
        // still holds every link skipped before the promote, which put the run
        // back on its first card.
        const ahead = new Set(state.ids || []);
        const items = this.pileItems(state.pile).filter((item) => ahead.has(item.id));
        if (!items.length) {
            // The promote was the last one: say so rather than opening nothing.
            this.pile = state.pile;
            this.tally = tally;
            this.startedWith = state.startedWith;
            this.finished = true;
            this.mount();
            this.render();
            return this.isOpen();
        }
        return this.start(items, { pile: state.pile, tally, startedWith: state.startedWith });
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

    start(items, { pile = 'list', tally = null, startedWith = null } = {}) {
        this.queue = Array.isArray(items) ? items.slice() : [];
        this.pile = pile;
        this.chooser = null;
        this.tally = tally ? { ...tally } : DashboardInboxTriage.emptyTally();
        // What the run began with. The queue itself only keeps survivors --
        // every delete, snooze and promote splices one out -- so counting it at
        // the end reported the kept links and silently dropped the decisions,
        // which are the work.
        this.startedWith = startedWith ?? this.queue.length;
        this.index = 0;
        // A fresh run, whatever the last one ended in.
        this.finished = false;
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
        this.chooser = null;
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
        overlay.className = 'health-focus-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', this.t('dashboard.inboxTriage', 'Triage inbox'));
        overlay.innerHTML = '<div class="health-focus-card inbox-triage-card"></div>';
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
            const pileBtn = e.target.closest('[data-triage-pile]');
            if (pileBtn) {
                this.startPile(pileBtn.getAttribute('data-triage-pile'));
                return;
            }
            const btn = e.target.closest('[data-triage]');
            if (!btn) {
                return;
            }
            const action = btn.getAttribute('data-triage');
            if (action === 'start' && this.chooser) {
                this.startPile(this.chooser.piles[this.chooser.index].id);
            } else if (action === 'back') {
                this.close();
            } else if (action === 'next-pile') {
                const next = btn.getAttribute('data-triage-next');
                if (next) this.startPile(next);
            } else if (action === 'next') {
                void this.actSkip();
            } else if (action === 'read') {
                void this.actMarkRead();
            } else if (action === 'open') {
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
        const primary = card.querySelector('[data-triage-pile][aria-selected="true"]')
            || card.querySelector('[data-triage="promote"]')
            || card.querySelector('[data-triage="next-pile"], [data-triage="back"]')
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
        // Enter and Space on a focused button press that button. Taking them
        // for the selected pile or for Open meant Tab to × and Enter started a
        // run, and Enter on Delete opened the link. Pile options stay with the
        // chooser below, which starts the selected one.
        if ((e.key === 'Enter' || e.key === ' ')
            && e.target?.closest?.('button:not([data-triage-pile])')
            && this.overlay?.contains(e.target)) {
            return;
        }

        if (this.chooser) {
            const piles = this.chooser.piles;
            const move = (delta) => {
                this.chooser.index = (this.chooser.index + delta + piles.length) % piles.length;
                this.renderChooser();
            };
            const k = e.key;
            if (k === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); return; }
            if (k === 'ArrowDown' || k === 'j') { e.preventDefault(); move(1); return; }
            if (k === 'ArrowUp' || k === 'k') { e.preventDefault(); move(-1); return; }
            if (k === 'Enter' || k === ' ') {
                e.preventDefault();
                // A pile reached by Tab is the one meant, not the highlighted one.
                const focused = e.target?.closest?.('[data-triage-pile]')?.getAttribute('data-triage-pile');
                this.startPile(focused || piles[this.chooser.index].id);
            }
            return;
        }
        if (this.finished) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); }
            return;
        }

        const key = e.key.toLowerCase();
        // Keep is Shift+K here as it is in the list, and read first: the
        // lowercase test below takes k for "previous".
        if (e.key === 'K') {
            e.preventDefault();
            void this.actKeep();
            return;
        }
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
        if (key === 'o' || e.key === 'Enter' || key === ' ') {
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
        // r marks read and moves on, as it marks read in the list. It used to
        // keep here and mark read there: one letter, two meanings a tab apart.
        if (e.key === 'r') {
            e.preventDefault();
            void this.actMarkRead();
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
                this.tally.read += 1;
            }
        }
        await this.afterAction(false, { readId: item.id });
    }

    /** Read, without opening it: the card stays in the run, the cursor moves on. */
    async actMarkRead() {
        const item = this.currentItem();
        if (!item) {
            return;
        }
        if (!item.readAt) {
            if (await this.inbox.markReadReporting(item.id)) {
                item.readAt = Date.now();
                this.tally.read += 1;
            }
        }
        await this.afterAction(false, { readId: item.id });
    }

    /** Next without deciding: the link stays where it is. */
    async actSkip() {
        if (!this.currentItem()) return;
        await this.afterAction(false, {});
    }

    actPromote() {
        const item = this.currentItem();
        if (!item) {
            return;
        }
        const d = this.dash;
        d._pendingInboxPromoteId = item.id;
        d._pendingInboxTriageAdvance = true;
        this._resume = {
            pile: this.pile || 'list',
            tally: { ...this.tally },
            startedWith: this.startedWith,
            ids: this.queue.slice(this.index + 1).map((entry) => entry.id),
        };
        this.inbox.promoteItem(item);
        this.close();
    }

    async actKeep() {
        const item = this.currentItem();
        if (!item) {
            return;
        }
        if (!(await this.inbox.keepItem(item))) {
            return;
        }
        this.tally.kept += 1;
        await this.afterAction(true, { removedId: item.id });
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
        this.tally.deleted += 1;
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
                this.tally.snoozed += 1;
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
                // Clearing every link is the best run there is, and it used to
                // be the one that closed without a word. Show the same panel a
                // partly-kept run gets.
                this.finished = true;
                this.index = 0;
                this.render();
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
            this.syncQueueItem(this.currentItem()?.id);
            this.render();
            return;
        }
        /*
         * The end of the run, said out loud.
         *
         * Keeping a link does not shorten the queue, so the last card used to
         * set index back to 0 and start over -- the counter reset, nothing
         * announced anything, and a run of thirty could not be finished, only
         * abandoned. The one moment triage exists for is the click of a job
         * done, and it was the one moment missing.
         */
        this.finished = true;
        this.render();
    }

    /** The start screen: which pile, each with its count and what it is for. */
    renderChooser() {
        const card = this.overlay?.querySelector('.inbox-triage-card');
        const chooser = this.chooser;
        if (!card || !chooser) return;
        const esc = (v) => this.escape(v);
        const selected = chooser.piles[chooser.index];
        card.innerHTML = `
            <div data-triage-chooser>
                <div class="health-focus-head">
                    <h2 class="health-focus-title">${esc(this.t('dashboard.inboxTriageChooserTitle', 'Triage your inbox'))}</h2>
                    <button type="button" class="health-focus-close inbox-triage-close" aria-label="${esc(this.t('dashboard.inboxTriageClose', 'Close'))}">×</button>
                </div>
                <p class="health-focus-chooser-lead">${esc(this.t('dashboard.inboxTriageChooserLead',
                    'One link at a time: where it came from, and where it should go. Pick a pile — the fullest is first.'))}</p>
                <div class="health-focus-piles" role="listbox" aria-label="${esc(this.t('dashboard.inboxTriageChooserTitle', 'Triage your inbox'))}">
                    ${chooser.piles.map((pile, i) => `
                        <button type="button" role="option" class="health-focus-pile${i === chooser.index ? ' is-selected' : ''}"
                                data-triage-pile="${esc(pile.id)}" aria-selected="${i === chooser.index ? 'true' : 'false'}">
                            <span class="health-focus-pile-name">${esc(this.pileLabel(pile.id))}</span>
                            <span class="health-focus-pile-note">${esc(this.pileNote(pile.id))}</span>
                            <span class="health-focus-pile-count">${pile.count}</span>
                        </button>`).join('')}
                </div>
                <div class="health-focus-chooser-foot">
                    <span class="health-focus-legend">${esc(this.t('dashboard.inboxTriageChooserLegend', '↑ ↓ to choose, Escape to leave'))}</span>
                    <button type="button" class="config-btn health-focus-primary" data-triage="start">${esc(
                        this.t('dashboard.inboxTriageStartPile', 'Start: {pile}', { pile: this.pileLabel(selected.id) }))}<kbd>↵</kbd></button>
                </div>
            </div>`;
        this.focusCard();
    }

    /*
     * What is left when the run is over: what it did, and the next pile.
     *
     * Counted from the decisions, not from what remains: keeping a link does
     * not shorten the list of kept links, and a run is the work, not the rest.
     */
    renderDone(card) {
        const esc = (v) => this.escape(v);
        const tally = this.tally;
        const nextPile = this.pileCounts().find((p) => p.id !== 'list' && p.id !== this.pile) || null;
        const stat = (n, key, fallback) => `<div class="health-focus-stat"><b>${n}</b><span>${esc(this.t(key, fallback))}</span></div>`;
        card.innerHTML = `
            <div class="health-focus-card--done inbox-triage-done">
                <div class="health-focus-head">
                    <h2 class="health-focus-title">${esc(this.t('dashboard.inboxTriageRunDone', '{pile}: done',
                        { pile: this.pileLabel(this.pile) }))}</h2>
                    <button type="button" class="health-focus-close inbox-triage-close" aria-label="${esc(this.t('dashboard.inboxTriageClose', 'Close'))}">×</button>
                </div>
                <div class="health-focus-stats">
                    ${stat(tally.promoted, 'dashboard.inboxTriageTallyPromoted', 'promoted')}
                    ${stat(tally.kept, 'dashboard.inboxTriageTallyKept', 'kept')}
                    ${stat(tally.deleted, 'dashboard.inboxTriageTallyDeleted', 'deleted')}
                    ${stat(tally.snoozed, 'dashboard.inboxTriageTallySnoozed', 'snoozed')}
                    ${stat(tally.read, 'dashboard.inboxTriageTallyRead', 'read')}
                </div>
                <div class="health-focus-done-foot">
                    <span class="health-focus-done-rest">${esc(nextPile
                        ? this.t('dashboard.inboxTriageNextPile', 'Next: {pile} · {count} waiting', { pile: this.pileLabel(nextPile.id), count: nextPile.count })
                        : this.t('dashboard.inboxTriageDoneBody', 'You went through {n} links.').replace('{n}', String(this.startedWith || 0)))}</span>
                    <div class="health-focus-actions">
                        <button type="button" class="config-btn" data-triage="back">${esc(
                            this.t('dashboard.inboxTriageBack', 'Back to the inbox'))}</button>
                        ${nextPile ? `<button type="button" class="config-btn health-focus-done-primary" data-triage="next-pile"
                            data-triage-next="${esc(nextPile.id)}">${esc(
                            this.t('dashboard.inboxTriageStartPile', 'Start: {pile}', { pile: this.pileLabel(nextPile.id) }))}</button>` : ''}
                    </div>
                </div>
            </div>`;
        this.focusCard();
    }

    /** Where the link came from: the source, how long ago, whether opened, the note. */
    renderWhy(item) {
        const esc = (v) => this.escape(v);
        const sources = {
            extension: ['dashboard.inboxSourceExtension', 'saved from the browser extension'],
            paste: ['dashboard.inboxSourcePaste', 'pasted into the dashboard'],
            share: ['dashboard.inboxSourceShare', 'shared from another app'],
            import: ['dashboard.inboxSourceImport', 'brought in by an import'],
        };
        const source = String(item.source || '').trim();
        const [skey, sfallback] = sources[source] || ['dashboard.inboxSourceOther', source ? `added via ${source}` : 'added by hand'];
        const when = this.inbox.formatRelativeTime(item.addedAt);
        const lines = [
            when ? `${when}, ${item.readAt
                ? this.t('dashboard.inboxWhyOpened', 'opened before')
                : this.t('dashboard.inboxWhyNeverOpened', 'never opened')}` : '',
            item.note ? this.t('dashboard.inboxWhyNote', 'Note: “{note}”', { note: item.note }) : '',
        ].filter(Boolean);
        return `<div class="health-focus-why">
            <p class="health-focus-why-title">${esc(this.t('dashboard.inboxWhyLabel', 'Where it came from'))}: ${esc(this.t(skey, sfallback))}</p>
            ${lines.length ? `<ul class="health-focus-reasons">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
        </div>`;
    }

    renderPreview(item) {
        const esc = (v) => this.escape(v);
        const desc = String(item.previewDesc || '').trim();
        const image = window.BookmarkUrlUtils?.safeHttpResourceUrl?.(item.previewImage) || '';
        if (!desc && !image) return '';
        return `<div class="health-focus-preview">
            ${image ? `<div class="health-focus-preview-image"><img class="inbox-triage-thumb-img" src="${esc(image)}" alt="" loading="lazy"></div>` : ''}
            <div class="health-focus-preview-text">
                ${desc ? `<p class="health-focus-preview-desc">${esc(desc)}</p>` : ''}
            </div>
        </div>`;
    }

    render() {
        const card = this.overlay?.querySelector('.inbox-triage-card');
        if (card && this.chooser) {
            this.renderChooser();
            return;
        }
        if (card && this.finished) {
            this.renderDone(card);
            return;
        }
        const item = this.currentItem();
        if (!card || !item) {
            this.close();
            return;
        }
        const hadFocusInCard = card.contains(document.activeElement);
        const esc = (v) => this.escape(v);
        const key = (k) => `<kbd>${esc(k)}</kbd>`;

        const title = item.previewTitle || item.title || item.domain || item.url;
        const domain = item.domain || this.inbox.formatUrlDisplay(item.url);
        const total = this.queue.length;
        const position = this.index + 1;
        const snoozed = this.inbox.isSnoozed(item);
        const iconSrc = this.inbox.resolveIconSrc(item.icon);
        const icon = iconSrc
            ? `<img class="health-focus-icon-img inbox-triage-thumb-img" src="${esc(iconSrc)}" alt="" loading="lazy">`
            : '🔗';
        const kept = this.inbox.keptEnabled?.();
        const keptCount = (this.inbox.dash.unsortedBookmarks || []).length;
        const tags = Array.isArray(item.tags) ? item.tags : [];
        const badges = [
            item.readAt ? this.t('dashboard.inboxDrawerReadBadge', 'read') : this.t('dashboard.inboxDrawerUnread', 'unread'),
            snoozed ? this.t('dashboard.inboxDrawerSleepingBadge', 'sleeping') : '',
            ...tags.map((tag) => `#${tag}`),
        ].filter(Boolean);

        card.innerHTML = `
            <div class="health-focus-head">
                <span class="health-focus-progress">${esc(this.pileLabel(this.pile))} · ${esc(this.t(
                    'dashboard.inboxTriagePosition', '{position} of {total}', { position, total }))}</span>
                ${kept ? `<span class="inbox-triage-kept-count" title="${esc(
                    this.t('dashboard.inboxKeepExplains', 'Keeps the link for good, in Bookmarks → Unsorted, without giving it a page yet'))}">${esc(
                    this.t('dashboard.inboxTriageKeptCount', `Kept ${keptCount}`, { count: keptCount }))}</span>` : ''}
                <button type="button" class="health-focus-close inbox-triage-close" aria-label="${esc(this.t('dashboard.inboxTriageClose', 'Close'))}">×</button>
            </div>
            <div class="health-focus-bar" aria-hidden="true"><span style="width:${Math.round((position / Math.max(1, total)) * 100)}%"></span></div>

            <div class="health-focus-identity">
                <div class="health-focus-icon" aria-hidden="true">${icon}</div>
                <div class="health-focus-identity-text">
                    <h2 class="health-focus-title"><button type="button" class="health-focus-title-link" data-triage="open"
                        title="${esc(this.t('dashboard.healthFocusOpenTitle', 'Open in a new tab'))}">${esc(title)}</button></h2>
                    <p class="health-focus-url">${esc(domain)}</p>
                </div>
                <button type="button" class="config-btn health-focus-open" data-triage="open">${esc(
                    this.t('dashboard.inboxOpen', 'Open'))}${key('o')}</button>
            </div>

            ${badges.length ? `<div class="health-focus-badges">${badges.map((b) => `<span class="inbox-triage-chip">${esc(b)}</span>`).join('')}</div>` : ''}

            ${this.renderPreview(item)}

            ${this.renderWhy(item)}

            <button type="button" class="config-btn health-focus-primary" data-triage="promote">
                <span>${esc(this.t('dashboard.inboxTriagePromote', 'Promote to a page'))}</span>${key('p')}</button>
            <div class="health-focus-alts">
                ${kept ? `<button type="button" class="health-focus-link" data-triage="keep">${esc(
                    this.t('dashboard.inboxTriageKeepUnsorted', 'Keep in Unsorted'))}${key('⇧K')}</button>` : ''}
                <button type="button" class="health-focus-link" data-triage="note">${esc(item.note
                    ? this.t('dashboard.inboxEditNote', 'Edit note')
                    : this.t('dashboard.inboxAddNote', 'Note'))}${key('n')}</button>
                <button type="button" class="health-focus-link is-danger" data-triage="delete">${esc(
                    this.t('dashboard.inboxDelete', 'Delete'))}${key('d')}</button>
            </div>
            ${kept ? `<p class="health-focus-legend inbox-triage-keep-hint">${esc(this.t('dashboard.inboxKeepExplains',
                'Keeps the link for good, in Bookmarks → Unsorted, without giving it a page yet'))}</p>` : ''}

            <div class="health-focus-foot">
                <span class="health-focus-foot-label">${esc(this.t('dashboard.healthFocusNotNow', 'Not now:'))}</span>
                <div class="health-focus-foot-actions">
                    <button type="button" class="health-focus-link" data-triage="snooze">${esc(snoozed
                        ? this.t('dashboard.inboxWake', 'Wake now')
                        : this.t('dashboard.inboxSnooze', 'Snooze'))}${key('z')}</button>
                    <button type="button" class="health-focus-link" data-triage="read">${esc(
                        this.t('dashboard.inboxMarkRead', 'Mark read'))}${key('r')}</button>
                    <button type="button" class="health-focus-link" data-triage="next">${esc(
                        this.t('dashboard.healthFocusSkip', 'Skip'))}${key('j')}</button>
                </div>
            </div>

            <p class="health-focus-legend inbox-triage-hint">${esc(this.t('dashboard.inboxTriageLegend',
                'j / k to move · Shift+K keeps it (to Unsorted) · Escape to leave'))}</p>
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
