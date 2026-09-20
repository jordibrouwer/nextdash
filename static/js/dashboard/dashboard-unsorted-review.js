/**
 * Working through the kept list, one link at a time.
 *
 * The list itself is a grid: it shows what is there and asks nothing. But
 * every row in it is a decision somebody postponed, and postponed decisions
 * are made one at a time, with the thing in front of you and the answers
 * underneath — which is what the queue next door does with `t`, and why this
 * borrows its card rather than inventing a second shape for the same ritual.
 *
 * What differs is the answers. A queued link asks "read, keep, or bin"; a kept
 * link asks the one question that empties this list: where does it go. So the
 * first button is the destination the collection already agrees on when there
 * is one, the tags it would be given are offered beside it, and the two ways
 * out — park it, throw it away — close the card.
 */
class DashboardUnsortedReview {
    constructor(unsorted) {
        this.unsorted = unsorted;
        this.dash = unsorted.dash;
        /** The bookmarks this run walks, in the order the list had them. */
        this.queue = [];
        this.index = 0;
        this.overlay = null;
        this.handled = 0;
        this.started = 0;
        this.finished = false;
        this._keyHandler = null;
        this._clickHandler = null;
    }

    t(key, fallback, vars) {
        return this.dash.formatDashboardLabel(key, vars || {}, fallback);
    }

    escape(value) {
        return this.dash.escapeHtml(String(value ?? ''));
    }

    isOpen() {
        return Boolean(this.overlay?.isConnected);
    }

    /**
     * Start a run over what the list is showing.
     *
     * The visible rows, not every kept bookmark: a reader who filtered to the
     * broken links, or searched for one site, has already said what this run
     * is about.
     */
    open() {
        const rows = this.unsorted._visibleBookmarks?.() || [];
        if (!rows.length) return false;
        this.queue = [...rows];
        this.index = 0;
        this.handled = 0;
        this.started = rows.length;
        this.finished = false;
        this.mount();
        this.render();
        window.nextdashTrack?.('unsorted:review-open', { count: rows.length });
        return true;
    }

    mount() {
        this.unmount();
        this._opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        document.body.classList.add('inbox-triage-active');
        const overlay = document.createElement('div');
        overlay.id = 'unsorted-review-overlay';
        // The queue's own classes carry the look; only the card is this view's,
        // so the two rituals cannot drift apart visually.
        overlay.className = 'inbox-triage-overlay unsorted-review-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', this.t('unsortedReviewTitle', 'Work through the kept links'));
        overlay.innerHTML = '<div class="inbox-triage-card unsorted-review-card"></div>';
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) this.close();
        });
        document.body.appendChild(overlay);
        this.overlay = overlay;

        this._clickHandler = (event) => {
            if (event.target.closest('.inbox-triage-close')) {
                this.close();
                return;
            }
            const btn = event.target.closest('[data-review-action]');
            if (!btn) return;
            this.act(btn.getAttribute('data-review-action'), btn);
        };
        overlay.querySelector('.unsorted-review-card')
            ?.addEventListener('click', this._clickHandler);

        this._keyHandler = (event) => this.handleKeydown(event);
        document.addEventListener('keydown', this._keyHandler, true);
        // The layer on top owns Escape. The inbox binds its own when the view
        // opens -- before this card exists -- so without saying so here the key
        // would close the whole view and leave the card over an empty page.
        window.EscapeOwner?.registerOwner?.('unsorted-review', {
            isOpen: () => this.isOpen(),
            handleEscape: () => this.close(),
        });
        window.FocusTrapUtils?.syncDashboardInert?.();
        this._scrollLock = window.ScrollLock?.acquire?.('unsorted-review') || null;
    }

    unmount() {
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler, true);
            this._keyHandler = null;
        }
        this.overlay?.remove();
        this.overlay = null;
        document.body.classList.remove('inbox-triage-active');
        window.FocusTrapUtils?.syncDashboardInert?.();
        this._scrollLock?.release?.();
        this._scrollLock = null;
    }

    close() {
        if (!this.isOpen()) return;
        this.unmount();
        this._opener?.focus?.({ preventScroll: true });
        this._opener = null;
        void this.unsorted.loadAndRender();
    }

    current() {
        return this.queue[this.index] || null;
    }

    /**
     * Move on. A row that was dealt with leaves the queue, so the next one
     * takes its place rather than the cursor stepping past it.
     */
    advance({ remove = false } = {}) {
        if (remove) {
            this.queue.splice(this.index, 1);
            this.handled += 1;
        } else {
            this.index += 1;
        }
        if (this.index >= this.queue.length) {
            if (remove || this.index > this.queue.length) this.index = this.queue.length;
        }
        if (!this.queue.length || this.index >= this.queue.length) {
            if (remove && !this.queue.length) {
                this.finished = true;
                this.render();
                return;
            }
            this.index = Math.max(0, this.queue.length - 1);
        }
        this.render();
    }

    handleKeydown(event) {
        if (!this.isOpen()) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const target = event.target;
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
            return;
        }
        const keys = {
            Escape: () => this.close(),
            j: () => this.step(1),
            k: () => this.step(-1),
            ArrowRight: () => this.step(1),
            ArrowLeft: () => this.step(-1),
            o: () => this.act('open'),
            Enter: () => this.act('open'),
            m: () => this.act('move'),
            z: () => this.act('snooze'),
            b: () => this.act('inbox'),
            d: () => this.act('delete'),
            s: () => this.act('skip'),
        };
        const handler = keys[event.key];
        if (!handler) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        handler();
    }

    /** Walk without deciding: the run keeps its place in the list. */
    step(by) {
        if (this.finished || !this.queue.length) return;
        const next = this.index + by;
        if (next < 0 || next >= this.queue.length) return;
        this.index = next;
        this.render();
    }

    act(action, anchorEl) {
        const bookmark = this.current();
        if (!bookmark) return;
        const select = this.unsorted.select;
        if (action === 'open') {
            const href = this.dash.safeBookmarkOpenHref?.(bookmark.url) || bookmark.url;
            if (href) window.open(href, '_blank', 'noopener,noreferrer');
            return;
        }
        if (action === 'skip') {
            this.step(1);
            return;
        }
        if (action === 'file') {
            const destination = window.DestinationSuggest?.forBookmark?.(this.dash, bookmark);
            if (!destination) return;
            void select?.moveSelectionTo(destination.pageId, destination.category, [bookmark])
                .then(() => this.advance({ remove: true }));
            return;
        }
        if (action === 'move') {
            // The picker anchors to the button that opened it, and closing the
            // card underneath would leave it pointing at nothing -- so the run
            // waits for the move to land.
            select?.openMovePopover(anchorEl || this.overlay, [bookmark]);
            this._awaitingMove = bookmark;
            return;
        }
        if (action === 'tag') {
            const tag = anchorEl?.getAttribute('data-review-tag');
            if (!tag) return;
            void select?.acceptSuggestion(bookmark, tag).then(() => this.render());
            return;
        }
        if (action === 'snooze') {
            this.dash.inbox?.openSnoozeMenu?.(null, anchorEl || this.overlay, null, {
                onPicked: (until) => {
                    void select?.sendToInbox([bookmark], { snoozeUntil: until })
                        .then(() => this.advance({ remove: true }));
                },
            });
            return;
        }
        if (action === 'inbox') {
            void select?.sendToInbox([bookmark]).then(() => this.advance({ remove: true }));
            return;
        }
        if (action === 'delete') {
            void this.deleteCurrent(bookmark);
        }
    }

    async deleteCurrent(bookmark) {
        const select = this.unsorted.select;
        if (!select) return;
        // Straight through, no confirm: the toast the bulk delete raises carries
        // the undo, and a dialog per link is what makes a run stop being one.
        select.selected = new Set([select.keyFor(bookmark)]);
        await select.deleteSelected({ confirmed: true });
        this.advance({ remove: true });
    }

    /** The tags the engine would give this link, offered on the card. */
    suggestionsFor(bookmark) {
        return window.TagSuggestLive?.forBookmark?.(this.dash, bookmark)?.slice(0, 2) || [];
    }

    render() {
        const card = this.overlay?.querySelector('.unsorted-review-card');
        if (!card) return;
        if (this.finished || !this.queue.length) {
            this.renderDone(card);
            return;
        }
        const bookmark = this.current();
        if (!bookmark) {
            this.close();
            return;
        }
        const destination = window.DestinationSuggest?.forBookmark?.(this.dash, bookmark);
        const place = destination
            ? (destination.categoryLabel
                ? `${destination.pageLabel} / ${destination.categoryLabel}`
                : destination.pageLabel)
            : '';
        const tags = this.suggestionsFor(bookmark);
        const title = bookmark.previewTitle || bookmark.name || bookmark.url;
        const age = this.unsorted._ageLabel?.(bookmark) || '';
        // What it already carries, as opposed to what it could be given: two
        // different claims, so two different rows.
        const own = (Array.isArray(bookmark.tags) ? bookmark.tags : []).filter(Boolean);
        /*
         * The picture, when there is one.
         *
         * The queue's card is a two-column grid with the thumbnail on the
         * left, and a body with only text in it puts that text in the 6.5rem
         * column meant for the image -- the title and the address came out as
         * ribbons. So: draw the image when the row has one, and say so when it
         * does not, which is what the single-column class is for.
         */
        const image = String(bookmark.previewImage || '').trim();
        const icon = String(bookmark.icon || '').trim();
        const thumb = image
            ? `<div class="inbox-triage-thumb"><img class="inbox-triage-thumb-img" src="${this.escape(image)}" alt="" loading="lazy"></div>`
            : (icon
                ? `<div class="inbox-triage-thumb"><img class="inbox-triage-thumb-img" src="${this.escape(icon)}" alt="" loading="lazy"></div>`
                : '');

        card.innerHTML = `
            <header class="inbox-triage-header">
                <p class="inbox-triage-kicker">${this.escape(this.t('unsortedReviewKicker', 'Kept links'))}</p>
                <p class="inbox-triage-progress unsorted-review-progress">${this.escape(
                    this.t('unsortedReviewProgress', `${this.index + 1} / ${this.queue.length}`,
                        { current: this.index + 1, total: this.queue.length }))}</p>
                <button type="button" class="inbox-triage-close" aria-label="${this.escape(
                    this.t('unsortedReviewClose', 'Close'))}">×</button>
            </header>
            <div class="inbox-triage-body${thumb ? '' : ' unsorted-review-body--bare'}">
                ${thumb}
                <div class="inbox-triage-text">
                    <h3 class="inbox-triage-title">${this.escape(title)}</h3>
                    <p class="inbox-triage-meta">
                        <span>${this.escape(this.unsorted._hostOf?.(bookmark.url) || bookmark.url)}</span>
                        ${age ? `<span class="unsorted-review-age">${this.escape(age)}</span>` : ''}
                    </p>
                    ${own.length ? `<p class="unsorted-review-own-tags">${own
                        .map((tag) => `<span class="unsorted-review-own-tag">#${this.escape(tag)}</span>`)
                        .join('')}</p>` : ''}
                    ${bookmark.previewDesc
                        ? `<p class="inbox-triage-note">${this.escape(bookmark.previewDesc)}</p>` : ''}
                </div>
            </div>
            ${tags.length ? `<div class="unsorted-review-tags"><span class="unsorted-review-tags-lead">${
                this.escape(this.t('unsortedReviewSuggested', 'Suggested'))}</span>${tags.map((offer) => `
                <button type="button" class="tag-suggest-chip-add" data-review-action="tag"
                        data-review-tag="${this.escape(offer.tag)}">#${this.escape(offer.tag)}</button>`).join('')}</div>` : ''}
            <div class="inbox-triage-actions unsorted-review-actions">
                <button type="button" class="inbox-action-btn" data-review-action="open">${this.escape(
                    this.t('unsortedReviewOpen', 'Open'))} <kbd>O</kbd></button>
                ${place ? `<button type="button" class="inbox-action-btn" data-review-action="file">${this.escape(
                    this.t('unsortedReviewFile', `File on ${place}`, { place }))}</button>` : ''}
                <button type="button" class="inbox-action-btn" data-review-action="move">${this.escape(
                    this.t('unsortedSelectMove', 'Move to…'))} <kbd>M</kbd></button>
                <button type="button" class="inbox-action-btn" data-review-action="snooze">${this.escape(
                    this.t('unsortedSelectSnooze', 'Snooze'))} <kbd>Z</kbd></button>
                <button type="button" class="inbox-action-btn" data-review-action="inbox">${this.escape(
                    this.t('unsortedSelectToInbox', 'Back to the inbox'))} <kbd>B</kbd></button>
                <button type="button" class="inbox-action-btn" data-review-action="skip">${this.escape(
                    this.t('unsortedReviewSkip', 'Skip'))} <kbd>S</kbd></button>
                <button type="button" class="inbox-action-btn inbox-action-btn--danger" data-review-action="delete">${this.escape(
                    this.t('unsortedSelectDelete', 'Delete'))} <kbd>D</kbd></button>
            </div>
            <p class="inbox-triage-hint">${this.escape(this.t('unsortedReviewHint',
                'J/K next · O open · M move · Z snooze · B back to the inbox · S skip · D delete · Esc close'))}</p>
        `;
        card.querySelector('[data-review-action="file"], [data-review-action="move"]')
            ?.focus?.({ preventScroll: true });
    }

    /**
     * The end of a run: what was dealt with.
     *
     * The count is the point. "You filed six of twenty" is a finished piece of
     * work; a card that simply vanished when the list ran out is not.
     */
    renderDone(card) {
        card.innerHTML = `
            <div class="inbox-triage-done unsorted-review-done">
                <h3 class="inbox-triage-title">${this.escape(this.t('unsortedReviewDoneTitle', 'That is the run'))}</h3>
                <p>${this.escape(this.t('unsortedReviewDoneCount',
                    `You dealt with ${this.handled} of ${this.started}.`,
                    { handled: this.handled, total: this.started }))}</p>
                <button type="button" class="inbox-triage-done-close" data-review-action="close">${this.escape(
                    this.t('unsortedReviewClose', 'Close'))}</button>
            </div>`;
        const close = card.querySelector('[data-review-action="close"]');
        close?.addEventListener('click', () => this.close());
        close?.focus?.({ preventScroll: true });
    }
}

window.DashboardUnsortedReview = DashboardUnsortedReview;
