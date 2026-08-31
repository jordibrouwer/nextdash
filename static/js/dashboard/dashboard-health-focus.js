/**
 * Focus mode: work the list one bookmark at a time.
 *
 * The Health view answers "what is wrong" well and "now fix it" badly. Filter
 * to Broken, get 47 rows, and every one of them costs the same three moves —
 * find the row again after the list re-renders, aim at its action, decide.
 * The list is the right shape for surveying and the wrong shape for grinding.
 *
 * So this is not a second view. It is the same issues, the same actions, and
 * the same keys the list already binds (p re-check, Enter open, x, Escape),
 * shown one at a time with the decision made large. Anything it can do, the
 * list can do; what it removes is the re-aiming between rows.
 *
 * Two rules keep it from becoming its own thing:
 *
 *   - Every action delegates to the health view's own method. No second
 *     implementation of re-check or delete can drift from the first.
 *   - The queue is a snapshot of issue *keys*, not of issue objects. Rows
 *     re-render underneath (a re-check rewrites the row, a delete removes it),
 *     and holding objects would show stale data one card later.
 *
 * Leaving is always Escape, and always lands back on the row you were on, so
 * dipping in for three fixes and back out is not a mode switch you have to
 * think about.
 */
class DashboardHealthFocus {
    constructor(health) {
        this.health = health;
        this.active = false;
        /** Issue keys, in the order the filter had them when focus opened. */
        this.queue = [];
        this.position = 0;
        this.host = null;
        this._busy = false;
        this._onKeydown = null;
        this.scrollLockToken = null;
        /**
         * A review session: the same cards, bounded and countable.
         *
         * Null for the ordinary "work through this filter" open. When set it
         * holds how many the session started with and how many were actually
         * dealt with, so the end of the queue can be an ending — a count and a
         * "done for today" — rather than a toast saying the list ran out.
         */
        this.session = null;
        /**
         * Preview payloads by issue key, for the cards in this session.
         *
         * The report already carries whatever preview the bookmark has stored,
         * so this holds only what had to be asked for. Keyed rather than kept on
         * the card because the queue moves back and forth: stepping k then j
         * onto a card that was already filled in must not ask the server twice.
         * A key that resolved to nothing is stored as null, which is the
         * difference between "no preview exists" and "not asked yet" — without
         * it every render of a preview-less bookmark starts the same doomed
         * request again.
         */
        this._previews = new Map();
        /** Keys with a request in flight, so a re-render cannot start a second. */
        this._previewPending = new Set();
        /** Keys whose fetch failed, so the card stops retrying on every render. */
        this._previewFailed = new Set();
        /**
         * Keys opened from inside this session.
         *
         * Tracked rather than read off `lastOpened` alone: a bookmark opened
         * last week also has a timestamp, and striking "never opened" on a card
         * for something you did not just do would be the card claiming credit
         * for history. The strike-through means "you settled this one, here,
         * now" — so it has to be scoped to this session.
         */
        this._openedKeys = new Set();
        /**
         * Whether the preview panel is folded away, for the whole session.
         *
         * One setting rather than one per card: the choice being made is "do I
         * want to see previews while I work through this", and answering it
         * again on every card would be its own chore.
         */
        this.previewCollapsed = DashboardHealthFocus.readPreviewCollapsed();
    }

    get dash() {
        return this.health.dash;
    }

    t(key, fallback, vars) {
        return this.health.t(key, fallback, vars);
    }

    esc(v) {
        return this.health.escape(v);
    }

    isActive() {
        return this.active;
    }

    /**
     * Open on the row the cursor is on, or the first one when it is nowhere.
     *
     * Starting from the cursor matters: the way in is "I am looking at this
     * one, let me work from here", not "start over from the top".
     */
    open() {
        const filtered = this.health.getFilteredIssues();
        if (!filtered.length) {
            this.dash.showNotification?.(
                this.t('dashboard.healthFocusEmpty', 'Nothing to work through in this filter.'),
                'info'
            );
            return false;
        }

        this.queue = filtered.map((issue) => this.health.issueKey(issue));
        const from = this.health.selectedKey ? this.queue.indexOf(this.health.selectedKey) : -1;
        this.position = from >= 0 ? from : 0;
        this.active = true;

        window.nextdashTrack?.('health:focus-open', { count: this.queue.length });
        // Refcounted and token-based: the body's overflow is never written
        // directly, so a modal opened on top of this releases its own lock
        // without unlocking the page underneath it.
        this.scrollLockToken = window.ScrollLock?.acquire('health-focus');
        this.bindKeys();
        this.render();
        return true;
    }

    /**
     * Open a bounded review session: at most `limit` rows, worst first.
     *
     * The difference from open() is the shape, not the mechanics. Work through
     * takes whatever the filter holds, which is 47 rows as often as 4, and 47
     * is a number people learn to ignore. A session takes ten, says so, ends,
     * and can be declared done for the day — bounded and finishable is what
     * makes a backlog something someone clears.
     */
    openSession({ limit = 10 } = {}) {
        const candidates = this.reviewCandidates();
        if (!candidates.length) {
            this.dash.showNotification?.(
                this.t('dashboard.healthFocusNothingToReview', 'Nothing needs reviewing right now.'),
                'info'
            );
            return false;
        }

        const queue = candidates.slice(0, Math.max(1, limit));
        this.queue = queue.map((issue) => this.health.issueKey(issue));
        this.position = 0;
        this.active = true;
        this.session = { started: this.queue.length, handled: 0, remaining: candidates.length, limit };

        window.nextdashTrack?.('health:review-session', { count: this.queue.length });
        this.scrollLockToken = window.ScrollLock?.acquire('health-focus');
        this.bindKeys();
        this.render();
        return true;
    }

    /**
     * What a review session is made of, worst first.
     *
     * Only conditions a person can act on from a card: a dead link, a page that
     * stopped meeting its own expectation, and links never opened or long
     * unopened. Deliberately not duplicates (they are resolved between rows,
     * not on one) and not monitors (they resolve themselves).
     */
    reviewCandidates() {
        const issues = Array.isArray(this.health.report?.issues) ? this.health.report.issues : [];
        return issues
            .filter((issue) => {
                const flags = Array.isArray(issue.flags) ? issue.flags : [issue.status];
                return DashboardHealthFocus.REVIEW_FLAGS.some((flag) => flags.includes(flag));
            })
            .sort((a, b) => (Number(a.score) || 0) - (Number(b.score) || 0));
    }

    // ─── Preview ────────────────────────────────────────────────────────────

    /** Remembered across sessions: the fold is a preference, not a mode. */
    static readPreviewCollapsed() {
        try {
            return window.localStorage?.getItem(DashboardHealthFocus.PREVIEW_FOLD_KEY) === '1';
        } catch {
            // Storage refused (private browsing): showing the preview is the
            // better default to fall back to, since it is what the card is for.
            return false;
        }
    }

    static writePreviewCollapsed(collapsed) {
        try {
            window.localStorage?.setItem(DashboardHealthFocus.PREVIEW_FOLD_KEY, collapsed ? '1' : '0');
        } catch {
            /* nothing to fall back to, and nothing worth breaking over */
        }
    }

    /**
     * The preview for one issue: what the report already knew, else what was
     * fetched for it.
     *
     * The report's own fields come first so a bookmark with stored preview data
     * draws immediately, with no request and no skeleton.
     */
    previewFor(issue) {
        const stored = {
            title: String(issue?.previewTitle || '').trim(),
            description: String(issue?.previewDesc || '').trim(),
            image: String(issue?.previewImage || '').trim(),
        };
        if (stored.title || stored.description || stored.image) return stored;
        const key = this.health.issueKey(issue);
        return this._previews.get(key) || null;
    }

    /**
     * Has this key been settled — with a preview, with "there is none", or with
     * a failure this card has already absorbed?
     *
     * All three stop the card asking again. Only the first two survive leaving
     * and re-entering the session.
     */
    previewResolved(issue) {
        const key = this.health.issueKey(issue);
        return Boolean(this.previewFor(issue))
            || this._previews.has(key)
            || this._previewFailed.has(key);
    }

    /**
     * Ask the server for one bookmark's preview.
     *
     * The per-URL route, not the collection-wide refresh the toolbar offers:
     * this is about the card in front of you, and walking every bookmark to
     * fill in one card would be the wrong trade by three orders of magnitude.
     * Deliberately read-only — it does not write the preview back onto the
     * bookmark, because a review session should not silently edit the records
     * it is asking you about.
     */
    async fetchPreview(issue, { render = true } = {}) {
        const key = this.health.issueKey(issue);
        const url = String(issue?.url || '').trim();
        if (!key || !url) return;
        if (this._previewPending.has(key) || this.previewResolved(issue)) return;

        this._previewPending.add(key);
        if (render) this.syncPreviewLoading(key, true);
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher(`/api/bookmark-preview?url=${encodeURIComponent(url)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const preview = {
                title: String(data?.title || '').trim(),
                description: String(data?.description || '').trim(),
                image: String(data?.image || '').trim(),
            };
            // Stored even when empty: "asked, and there is nothing" is an answer,
            // and re-asking on every render would hammer a page that has no
            // metadata to give.
            this._previews.set(key, preview.title || preview.description || preview.image ? preview : null);
        } catch {
            // Remembered as failed rather than as an answer: the card stops
            // promising a preview is coming, and stops asking again on every
            // render — but the key is left out of _previews, so re-entering the
            // session tries once more instead of treating a network blip as the
            // permanent truth about the page.
            this._previewFailed.add(key);
        } finally {
            this._previewPending.delete(key);
            if (render) this.syncPreviewLoading(key, false);
        }

        // Only repaint if this is still the card on screen: a fetch that lands
        // after two more j presses must not redraw someone else's decision.
        if (render && this.active && this.health.issueKey(this.currentIssue() || {}) === key) {
            this.render();
        }
    }

    /**
     * Warm the next card's preview while this one is being decided.
     *
     * The queue is ordered and moved through one way far more often than the
     * other, so the next card is a good guess and the request has a whole
     * decision's worth of time to land. Only one ahead: prefetching further
     * would spend requests on cards that a delete or a run of skips means you
     * never see.
     */
    prefetchNext() {
        const nextKey = this.queue[this.position + 1];
        if (!nextKey) return;
        const issue = (this.health.report?.issues || [])
            .find((row) => this.health.issueKey(row) === nextKey);
        if (!issue) return;
        if (this.previewResolved(issue) || this._previewPending.has(nextKey)) return;
        void this.fetchPreview(issue, { render: false });
    }

    /** The skeleton state, toggled without rebuilding the card underneath it. */
    syncPreviewLoading(key, loading) {
        if (this.health.issueKey(this.currentIssue() || {}) !== key) return;
        this.host?.querySelector('.health-focus-preview')
            ?.classList.toggle('is-loading', Boolean(loading));
    }

    /**
     * Close, leaving the list's cursor on the card that was showing.
     *
     * Deliberately not "the row we started from": someone who worked five rows
     * deep and pressed Escape means to continue from there, not to be sent
     * back to where they entered.
     */
    close() {
        if (!this.active) return;
        this.active = false;
        this.session = null;
        const landingKey = this.queue[this.position] || null;

        window.ScrollLock?.release(this.scrollLockToken);
        this.scrollLockToken = null;
        this.unbindKeys();
        this.host?.remove();
        this.host = null;

        if (landingKey) {
            this.health.selectedKey = landingKey;
            this.health.focusIssueKey = landingKey;
        }
        // Re-render so the row the cursor landed on is highlighted and scrolled
        // into view, the same as any other selection change.
        this.health.render?.();
        this.health.syncUrlState?.();
    }

    /** The issue this card is showing, re-resolved from the live report. */
    currentIssue() {
        const key = this.queue[this.position];
        if (!key) return null;
        // Looked up against every issue, not the filtered set: an action can
        // move a row out of the current filter (re-checking a broken link that
        // now works), and the card should show what happened rather than
        // vanishing mid-decision.
        const all = this.health.report?.issues || [];
        return all.find((issue) => this.health.issueKey(issue) === key) || null;
    }

    /**
     * Step through the queue. Rows deleted underneath are skipped rather than
     * shown as blanks.
     */
    move(delta) {
        if (!this.active) return;
        const total = this.queue.length;
        if (!total) {
            this.close();
            return;
        }
        let next = this.position;
        for (let i = 0; i < total; i += 1) {
            next += delta;
            if (next < 0 || next >= total) {
                // A session ends; a filter run just stops. Both refuse to wrap
                // — hitting the end of a cleanup queue is information, and
                // silently starting over would hide that the work is done.
                if (this.session && delta > 0) {
                    this.renderSessionDone();
                    return;
                }
                this.dash.showNotification?.(
                    delta > 0
                        ? this.t('dashboard.healthFocusAtEnd', 'That was the last one.')
                        : this.t('dashboard.healthFocusAtStart', 'This is the first one.'),
                    'info'
                );
                return;
            }
            const key = this.queue[next];
            const stillThere = (this.health.report?.issues || [])
                .some((issue) => this.health.issueKey(issue) === key);
            if (stillThere) {
                this.position = next;
                this.render();
                return;
            }
        }
        // Everything left in the queue is gone — the list was worked to zero.
        this.close();
    }

    // ─── Actions ────────────────────────────────────────────────────────────
    //
    // Each one delegates to the health view's own method and then advances or
    // re-renders. None of them reimplement the action itself.

    async run(action) {
        if (this._busy) return;
        const issue = this.currentIssue();
        if (!issue) return;

        this._busy = true;
        this.syncBusy(true);
        try {
            await action(issue);
        } finally {
            this._busy = false;
            this.syncBusy(false);
        }
    }

    async recheck() {
        await this.run(async (issue) => {
            await this.health.recheckIssue(issue, { silent: true });
            await this.health.loadAndRender({ refresh: true });
            // The overlay survives the list re-rendering underneath it, so the
            // card is redrawn from the refreshed report rather than closing.
            this.render();
        });
    }

    async remove() {
        await this.run(async (issue) => {
            const key = this.health.issueKey(issue);
            await this.health.deleteIssue(issue);
            // deleteIssue confirms first and reports nothing back, so whether
            // it happened is read from the refreshed report. Checked against
            // this row's own key rather than a total, so a background refresh
            // that changes the count for unrelated reasons cannot be mistaken
            // for a delete that never ran.
            const stillListed = (this.health.report?.issues || [])
                .some((candidate) => this.health.issueKey(candidate) === key);
            if (stillListed) {
                this.render();
            } else {
                this.dropCurrentFromQueue();
            }
        });
    }

    /**
     * Open the bookmark, and let the card say that it happened.
     *
     * openIssue already records the open — it writes lastOpened and openCount
     * and tells analytics — but the only thing it repaints is the list row's
     * "last opened" label, behind this overlay. From here that repaint lands on
     * an element the card does not have, so the card went on saying "never
     * opened" about a link you had just opened, and the one action whose whole
     * point is that it changes the answer was the one action that looked like it
     * did nothing. The data was never the problem; showing it was.
     */
    open_() {
        const issue = this.currentIssue();
        if (!issue) return;
        this._openedKeys.add(this.health.issueKey(issue));
        this.health.openIssue(issue);
        // Re-read rather than trusting the object: openIssue mutates the issue
        // in the report, and re-rendering from the queue key is what every other
        // action here does.
        this.render();
    }

    /**
     * Remove the card's row from the queue after it stops being an issue, and
     * show whatever now occupies that position.
     */
    dropCurrentFromQueue() {
        this.queue.splice(this.position, 1);
        if (this.session) {
            // Counted here rather than per action: a row leaves the queue when
            // it stops being an issue, which is the only thing worth counting.
            // Skipping is not handling, and a re-check that changed nothing
            // leaves the row where it was.
            this.session.handled += 1;
        }
        if (!this.queue.length) {
            if (this.session) {
                this.renderSessionDone();
                return;
            }
            this.close();
            this.dash.showNotification?.(
                this.t('dashboard.healthFocusDone', 'Nothing left in this list.'),
                'success'
            );
            return;
        }
        if (this.position >= this.queue.length) {
            this.position = this.queue.length - 1;
        }
        this.render();
    }

    // ─── Keyboard ───────────────────────────────────────────────────────────

    /**
     * Focus mode owns the keyboard while it is open.
     *
     * Captured at the document, before the view's own handler, so the list
     * behind it never also acts on the same key. The bindings are deliberately
     * the ones the list already uses.
     */
    bindKeys() {
        this._onKeydown = (e) => {
            if (!this.active) return;
            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
            if (e.ctrlKey || e.altKey || e.metaKey) return;

            const handlers = {
                // Escape is deliberately absent: the health view installs its
                // own capture-phase Escape handler when it loads, which runs
                // ahead of this one and closes focus mode from there. Binding
                // it here as well would leave two paths for one key, only one
                // of which is ever reached.
                ArrowDown: () => this.move(1),
                j: () => this.move(1),
                ArrowUp: () => this.move(-1),
                k: () => this.move(-1),
                p: () => void this.recheck(),
                d: () => void this.remove(),
                Enter: () => this.open_(),
                ' ': () => this.move(1),
            };
            const handler = handlers[e.key];
            if (!handler) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            handler();
        };
        document.addEventListener('keydown', this._onKeydown, true);
    }

    unbindKeys() {
        if (this._onKeydown) {
            document.removeEventListener('keydown', this._onKeydown, true);
            this._onKeydown = null;
        }
    }

    // ─── Rendering ──────────────────────────────────────────────────────────

    ensureHost() {
        if (this.host?.isConnected) return this.host;
        const host = document.createElement('div');
        host.className = 'health-focus-overlay';
        host.setAttribute('role', 'dialog');
        host.setAttribute('aria-modal', 'true');
        host.setAttribute('aria-label', this.t('dashboard.healthFocusTitle', 'Work through the list'));
        document.body.appendChild(host);
        this.host = host;
        return host;
    }

    syncBusy(busy) {
        this.host?.classList.toggle('is-busy', Boolean(busy));
    }

    /**
     * The end of a session: what was dealt with, and what to do about the rest.
     *
     * The count is the point. "You handled 6 of 10" is a finished piece of work;
     * a list that silently ran out is not. "Done for today" is the other half —
     * declaring an end is what makes it a ritual rather than a backlog that
     * follows you around.
     */
    renderSessionDone() {
        const session = this.session;
        if (!session) return;
        const host = this.ensureHost();
        const left = Math.max(0, this.reviewCandidates().length);
        const moreAvailable = left > 0;

        host.innerHTML = `
            <div class="health-focus-card health-focus-card--done">
                <h2 class="health-focus-title">${this.esc(this.t(
                    'dashboard.healthReviewDoneTitle', 'That is the session'))}</h2>
                <p class="health-focus-done-count">${this.esc(this.t(
                    'dashboard.healthReviewDoneCount',
                    'You dealt with {handled} of {total}.',
                    { handled: session.handled, total: session.started }
                ))}</p>
                <p class="health-focus-done-rest">${this.esc(moreAvailable
                    ? this.t('dashboard.healthReviewDoneRest', '{count} still want a look, another day.',
                        { count: left })
                    : this.t('dashboard.healthReviewDoneClear', 'Nothing else is waiting.'))}</p>

                <div class="health-focus-actions">
                    ${moreAvailable ? `<button type="button" class="config-btn" data-focus="again">${this.esc(
                        this.t('dashboard.healthReviewAgain', 'Another ten'))}</button>` : ''}
                    <button type="button" class="config-btn health-focus-done-primary" data-focus="done-today">${this.esc(
                        this.t('dashboard.healthReviewDoneToday', 'Done for today'))}</button>
                </div>
            </div>`;

        const actions = {
            again: () => {
                const limit = session.limit;
                this.close();
                this.openSession({ limit });
            },
            'done-today': () => {
                window.HealthReviewSession?.markDoneToday?.();
                this.close();
                this.dash.showNotification?.(
                    this.t('dashboard.healthReviewSeeYouTomorrow', 'Nothing more today.'),
                    'success'
                );
            },
        };
        host.querySelectorAll('[data-focus]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                actions[btn.getAttribute('data-focus')]?.();
            });
        });
        host.addEventListener('mousedown', (e) => {
            if (e.target === host) this.close();
        });
    }

    /**
     * The bookmark's own favicon, so the card is recognisable before it is read.
     *
     * Same resolution and same 🔗 fallback as the list row — the icon is a bare
     * filename served from /data/icons/, and a card that resolved it differently
     * would show a broken image next to a row that showed the icon fine.
     */
    renderIcon(issue) {
        const src = this.health.resolveIssueIconSrc?.(issue?.icon) || '';
        const img = src
            ? `<img class="health-focus-icon-img" src="${this.esc(src)}" alt="" loading="lazy">`
            : '🔗';
        return `<div class="health-focus-icon" aria-hidden="true">${img}</div>`;
    }

    /**
     * When this bookmark was last opened, on the card rather than only in the row.
     *
     * This is the line the Open button changes, and the reason it exists here:
     * "never opened" is one of the four things a review session is made of, so
     * the card has to be able to show that it stopped being true.
     */
    renderOpened(issue) {
        const format = window.formatLastOpened;
        if (typeof format !== 'function') return '';
        const { label, title, never } = format(issue?.lastOpened, {
            t: (key, fallback, params) => this.t(key, fallback, params),
        });
        const cls = never ? 'health-focus-opened is-never' : 'health-focus-opened';
        return `<p class="${cls}" data-focus-opened title="${this.esc(title)}">${this.esc(label)}</p>`;
    }

    /**
     * Which of this row's reasons the card has already disproved.
     *
     * Only the two the card can settle by itself. Opening a link answers "never
     * opened" and "not opened in 30 days" outright — the timestamp is written
     * and there is nothing left to check. Every other reason (a dead link, a
     * changed page) is the server's to re-decide on the next re-check, and
     * guessing at those from here is how a card starts lying.
     */
    resolvedReasonCodes(issue) {
        const codes = new Set();
        if (Number(issue?.lastOpened) && this._openedKeys?.has(this.health.issueKey(issue))) {
            codes.add('never_opened');
            codes.add('not_opened_30_days');
        }
        return codes;
    }

    /**
     * What the page says about itself: image, title line and description.
     *
     * Folded away by choice, and the fold is remembered — someone clearing
     * eighty dead links wants the decision and nothing else, and someone
     * deciding whether a link is still worth keeping wants exactly this. The
     * panel keeps its place in the layout either way so the buttons do not walk
     * up and down the screen between cards.
     */
    renderPreview(issue) {
        const collapsed = this.previewCollapsed;
        const preview = this.previewFor(issue);
        const pending = this._previewPending.has(this.health.issueKey(issue));
        const asked = this.previewResolved(issue);

        const toggle = `<button type="button" class="health-focus-preview-toggle" data-focus="preview-toggle"
            aria-expanded="${collapsed ? 'false' : 'true'}">
            <span class="health-focus-preview-caret" aria-hidden="true">${collapsed ? '▸' : '▾'}</span>
            ${this.esc(this.t('dashboard.healthFocusPreview', 'Preview'))}
        </button>`;

        if (collapsed) {
            return `<div class="health-focus-preview is-collapsed">${toggle}</div>`;
        }

        let body;
        if (preview) {
            const image = window.BookmarkUrlUtils?.safeHttpResourceUrl?.(preview.image) || '';
            // The description is the useful half and the image is the fast half,
            // so a preview with only one of them still draws rather than being
            // treated as no preview at all.
            body = `
                ${image ? `<div class="health-focus-preview-image"><img src="${this.esc(image)}" alt="" loading="lazy"></div>` : ''}
                ${preview.title ? `<p class="health-focus-preview-title">${this.esc(preview.title)}</p>` : ''}
                ${preview.description ? `<p class="health-focus-preview-desc">${this.esc(preview.description)}</p>` : ''}`;
        } else if (pending || !asked) {
            // Not-yet-asked renders as the skeleton too: the fetch is started by
            // this very render, so anything else would flash "nothing here"
            // for one frame before the request even leaves.
            body = `<p class="health-focus-preview-empty">${this.esc(
                this.t('dashboard.healthFocusPreviewLoading', 'Fetching the preview…'))}</p>`;
        } else {
            body = `<p class="health-focus-preview-empty">${this.esc(
                this.t('dashboard.healthFocusPreviewNone', 'This page offers no preview.'))}</p>`;
        }

        return `<div class="health-focus-preview${pending ? ' is-loading' : ''}">
            ${toggle}
            <div class="health-focus-preview-body">${body}</div>
        </div>`;
    }

    render() {
        if (!this.active) return;
        const issue = this.currentIssue();
        if (!issue) {
            this.dropCurrentFromQueue();
            return;
        }

        const host = this.ensureHost();
        const title = issue.name || issue.previewTitle || this.health.formatUrlDisplay(issue.url);
        const reasons = this.health.reasonEntries(issue) || [];
        const resolved = this.resolvedReasonCodes(issue);
        /*
         * A reason the card has just disproved is struck through rather than
         * removed. Removing it would make the card disagree with the score and
         * the list behind it, which both still count it until the next report;
         * striking it says "this one is dealt with" without pretending the
         * report has caught up. The score is deliberately left alone for the
         * same reason opening does not re-sort the list.
         */
        const reasonList = reasons.length
            ? `<ul class="health-focus-reasons">${reasons
                .map((r) => {
                    const done = r.code && resolved.has(r.code);
                    return `<li${done ? ' class="is-resolved"' : ''}>${this.esc(r.label)}${
                        done ? ` <span class="health-focus-reason-done">${this.esc(
                            this.t('dashboard.healthFocusReasonResolved', 'just now'))}</span>` : ''}</li>`;
                }).join('')}</ul>`
            : '';

        host.innerHTML = `
            <div class="health-focus-card">
                <div class="health-focus-head">
                    <span class="health-focus-progress">${this.esc(this.session
                        ? this.t('dashboard.healthReviewProgress', 'Review · {position} of {total}',
                            { position: this.position + 1, total: this.queue.length })
                        : this.t('dashboard.healthFocusProgress', '{position} of {total}',
                            { position: this.position + 1, total: this.queue.length }))}</span>
                    <button type="button" class="health-focus-close" data-focus="close"
                        aria-label="${this.esc(this.t('dashboard.healthFocusClose', 'Close'))}">×</button>
                </div>

                <div class="health-focus-identity">
                    ${this.renderIcon(issue)}
                    <div class="health-focus-identity-text">
                        <h2 class="health-focus-title">${this.esc(title)}</h2>
                        <p class="health-focus-url">${this.esc(this.health.formatUrlDisplay(issue.url))}</p>
                    </div>
                </div>

                ${this.renderOpened(issue)}

                <div class="health-focus-badges">
                    ${this.health.renderCertBadge(issue)}
                    ${this.health.renderDriftBadge(issue)}
                    ${this.health.renderMutedBadge(issue)}
                </div>

                ${this.renderPreview(issue)}

                ${reasonList}

                <div class="health-focus-actions">
                    <button type="button" class="config-btn" data-focus="recheck">${this.esc(
                        this.t('dashboard.healthRecheck', 'Re-check'))}<kbd>p</kbd></button>
                    <button type="button" class="config-btn" data-focus="open">${this.esc(
                        this.t('dashboard.healthOpen', 'Open'))}<kbd>↵</kbd></button>
                    <button type="button" class="config-btn config-btn--danger" data-focus="delete">${this.esc(
                        this.t('dashboard.healthFocusDelete', 'Delete'))}<kbd>d</kbd></button>
                    <button type="button" class="config-btn" data-focus="next">${this.esc(
                        this.t('dashboard.healthFocusSkip', 'Skip'))}<kbd>j</kbd></button>
                </div>

                <p class="health-focus-legend">${this.esc(this.t(
                    'dashboard.healthFocusLegend',
                    'j / k to move, Escape to leave'
                ))}</p>
            </div>`;

        const actions = {
            close: () => this.close(),
            recheck: () => void this.recheck(),
            open: () => this.open_(),
            delete: () => void this.remove(),
            next: () => this.move(1),
            'preview-toggle': () => this.togglePreview(),
        };
        host.querySelectorAll('[data-focus]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                actions[btn.getAttribute('data-focus')]?.();
            });
        });
        // A preview that fails to load leaves the frame empty rather than
        // showing the browser's broken-image glyph in the middle of the card.
        const previewImg = host.querySelector('.health-focus-preview-image img');
        previewImg?.addEventListener('error', () => {
            previewImg.closest('.health-focus-preview-image')?.remove();
        }, { once: true });
        // Clicking the backdrop leaves, matching every other overlay in the app.
        host.addEventListener('mousedown', (e) => {
            if (e.target === host) this.close();
        });

        // Asked for after painting, so the card is on screen while the request
        // is in flight rather than the overlay waiting on the network to appear.
        // Both are no-ops for anything already known or already asked.
        if (!this.previewCollapsed) {
            void this.fetchPreview(issue);
        }
        this.prefetchNext();
    }

    /**
     * Fold the preview away, or back. Remembered for next time.
     *
     * Unfolding fetches what the fold had been skipping — the panel was not
     * merely hidden, it was not asked for, which is the point of a fold on a
     * card that costs a request.
     */
    togglePreview() {
        this.previewCollapsed = !this.previewCollapsed;
        DashboardHealthFocus.writePreviewCollapsed(this.previewCollapsed);
        window.nextdashTrack?.('health:focus-preview', { shown: !this.previewCollapsed });
        this.render();
    }
}

/** Where the fold is remembered. */
DashboardHealthFocus.PREVIEW_FOLD_KEY = 'nextdashHealthFocusPreviewCollapsed';

/**
 * What a review session is allowed to contain. Flags rather than status, for the
 * same reason the filters read flags: status is only the worst condition, and a
 * link that is both never opened and missing a preview belongs in a review under
 * either name.
 */
DashboardHealthFocus.REVIEW_FLAGS = ['broken', 'content', 'unused', 'stale'];

window.DashboardHealthFocus = DashboardHealthFocus;
