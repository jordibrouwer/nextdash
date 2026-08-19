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

    open_() {
        const issue = this.currentIssue();
        if (issue) this.health.openIssue(issue);
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
        const reasonList = reasons.length
            ? `<ul class="health-focus-reasons">${reasons
                .map((r) => `<li>${this.esc(r.label)}</li>`).join('')}</ul>`
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

                <h2 class="health-focus-title">${this.esc(title)}</h2>
                <p class="health-focus-url">${this.esc(this.health.formatUrlDisplay(issue.url))}</p>

                <div class="health-focus-badges">
                    ${this.health.renderCertBadge(issue)}
                    ${this.health.renderDriftBadge(issue)}
                    ${this.health.renderMutedBadge(issue)}
                </div>

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
        };
        host.querySelectorAll('[data-focus]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                actions[btn.getAttribute('data-focus')]?.();
            });
        });
        // Clicking the backdrop leaves, matching every other overlay in the app.
        host.addEventListener('mousedown', (e) => {
            if (e.target === host) this.close();
        });
    }
}

/**
 * What a review session is allowed to contain. Flags rather than status, for the
 * same reason the filters read flags: status is only the worst condition, and a
 * link that is both never opened and missing a preview belongs in a review under
 * either name.
 */
DashboardHealthFocus.REVIEW_FLAGS = ['broken', 'content', 'unused', 'stale'];

window.DashboardHealthFocus = DashboardHealthFocus;
