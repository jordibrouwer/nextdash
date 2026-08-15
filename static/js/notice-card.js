/**
 * The bottom-left notice card, as one thing rather than three copies.
 *
 * The dashboard offers occasional one-time invitations in that corner — try the
 * side rail, turn analytics on, and previously turn outage alerts on. Each was
 * written out by hand: same markup skeleton, same show/teardown transition, same
 * "is the corner free" etiquette, same poll-with-retry startup. Three copies of
 * roughly two hundred lines, which is both a maintenance cost and a trap: the
 * corner rules in particular had already drifted between them.
 *
 * What is genuinely per-card is small — when to ask, what the buttons say, and
 * what they do — so that is all a caller provides. Everything below is shared.
 *
 * Adding a card:
 *
 *     NoticeCard.define({
 *         id: 'my-thing',                     // becomes .my-thing-card
 *         title: () => t('...', 'Try this'),
 *         body: () => t('...', 'Because …'),
 *         canShow: () => somethingIsWorthAsking(),
 *         actions: [
 *             { label: () => 'Try it', primary: true, onClick: (card) => { … } },
 *             { label: () => 'No thanks', onClick: (card) => card.close() },
 *         ],
 *         onDismiss: () => markAnswered(),    // the × in the corner
 *     });
 *
 * The returned handle exposes render/autoStart/close for tests and for a manual
 * re-prompt from config, matching what the hand-written cards exposed.
 */
(function initNoticeCard(global) {
    'use strict';

    const SHOW_DELAY_MS = 5000;
    const RETRY_MS = 2000;
    // How long a card keeps polling before it settles down to waiting on an
    // event. Long enough to outlast a slow first render, short enough that a
    // page nobody is looking at is not ticking all afternoon: whatever frees
    // the corner later — another card being answered, the what's-new modal
    // closing — wakes the queue directly.
    const POLL_WINDOW_MS = 40000;
    const TEARDOWN_MS = 260;

    function dash() {
        return global.dashboardInstance || null;
    }

    function escape(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Whether the corner is free and interrupting is reasonable at all.
     *
     * This is the part that had drifted between the hand-written copies, so it
     * lives in exactly one place now. `selfClass` is excluded from the
     * "another card is up" check so a card does not consider itself a blocker
     * when re-rendered.
     */
    function cornerIsFree(selfClass) {
        const d = dash();
        if (!d?.settings) return false;
        if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (d.onboardingStartedInSession) return false;
        if (d.settings.onboardingCompleted === false) return false;
        // Config, health and the inbox are hash routes on this same page, so
        // without this a card drops on top of whatever the user opened — including,
        // for a settings-related card, the very panel it is about. Only interrupt
        // the bookmarks view. ("bookmarks" is also the value before the first view
        // is assigned, which is the dashboard.)
        if (d.activeView && d.activeView !== 'bookmarks') return false;
        // Quick-start — the setup wizard *or* the checklist that follows it — owns
        // the same corner, as does any other notice card.
        if (document.querySelector(`.quickstart-card:not(.${selfClass})`)) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        if (document.querySelector('.whats-new-modal')) return false;
        if (document.body.classList.contains('bookmark-inline-edit-active')) return false;
        return true;
    }


/*
The queue.

Every card wants the same corner and only one may have it, so a card that
loses the moment has to be able to come back. It used to poll twenty times
at two-second intervals and then give up for good, which is fine when the
corner clears within forty seconds and useless when it does not: the side
rail's invitation stands until it is answered, and a reader who leaves it
alone never saw anything offered after it. Two cards with the same delay,
one script tag apart, decided it between them by load order.

So a card that cannot show now joins a queue instead of counting down.
The queue is tried again whenever the corner might have come free — a card
closing is the obvious case, but the what's-new modal is not a card and
closes without telling anyone, so a MutationObserver on the body covers
both. Order is registration order, which is the order the scripts load:
the queue decides *when*, never *whether*, and a card still asks its own
canShow every time.
*/
    const queue = [];
    let queueTimer = null;
    let queueDeadline = 0;
    let queueRunning = false;
    let bodyObserver = null;

    // Async because a card may gate on something that needs awaiting, which is
    // also why the pass is guarded: a card closing mid-await would otherwise
    // start a second walk over the same queue.
    async function runQueue() {
        queueTimer = null;
        if (queueRunning) return;
        queueRunning = true;
        try {
            // First come, first served, and only one: build() takes the corner,
            // so a second card in the same pass would be refused by
            // cornerIsFree anyway — stopping here says that on purpose rather
            // than by accident.
            for (const entry of [...queue]) {
                if (await entry.tryShow()) {
                    dequeue(entry.id);
                    break;
                }
            }
        } finally {
            queueRunning = false;
        }
        if (queue.length && Date.now() < queueDeadline && !queueTimer) {
            queueTimer = setTimeout(runQueue, RETRY_MS);
        }
    }

    /** Ask the queue to try again, and give it a fresh window to poll in. */
    function wakeQueue() {
        if (!queue.length) return;
        queueDeadline = Date.now() + POLL_WINDOW_MS;
        if (queueTimer) return;
        queueTimer = setTimeout(() => { void runQueue(); }, 0);
    }

    function watchBody() {
        if (bodyObserver || typeof MutationObserver !== 'function' || !document.body) return;
        bodyObserver = new MutationObserver((records) => {
            const freed = records.some((record) => [...record.removedNodes].some((node) =>
                node.nodeType === 1
                && (node.matches?.('.quickstart-card, .whats-new-modal')
                    || node.querySelector?.('.quickstart-card, .whats-new-modal'))));
            if (freed) wakeQueue();
        });
        bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    function enqueue(entry) {
        if (queue.some((queued) => queued.id === entry.id)) return;
        queue.push(entry);
        watchBody();
        wakeQueue();
    }

    function dequeue(id) {
        const at = queue.findIndex((entry) => entry.id === id);
        if (at >= 0) queue.splice(at, 1);
        if (!queue.length && queueTimer) {
            clearTimeout(queueTimer);
            queueTimer = null;
        }
    }

    function define(spec) {
        const cardClass = `${spec.id}-card`;
        let cardEl = null;
        let pending = null;

        const text = (value) => (typeof value === 'function' ? value() : value);

        function close() {
            const el = cardEl;
            if (!el) return;
            cardEl = null;
            el.classList.remove('show');
            setTimeout(() => {
                if (el.isConnected) el.remove();
                // Whoever is next has been waiting for exactly this.
                wakeQueue();
            }, TEARDOWN_MS);
        }

        /** Put a failure on the card, where it stays until the user acts on it. */
        function showError(message) {
            const el = cardEl;
            if (!el) return;
            let box = el.querySelector('.notice-card-error');
            if (!box) {
                box = document.createElement('p');
                box.className = 'notice-card-error';
                box.setAttribute('role', 'alert');
                el.querySelector('.notice-card-actions')?.before(box);
            }
            box.textContent = message;
        }

        const handle = { close, showError, get element() { return cardEl; } };

        function gateSync() {
            if (cardEl) return false;
            if (!cornerIsFree(cardClass)) return false;
            return spec.canShow?.() !== false;
        }

        async function shouldShow() {
            if (cardEl) return false;
            if (!cornerIsFree(cardClass)) return false;
            // Async so a card may consult something that needs awaiting.
            return (await spec.canShow?.()) !== false;
        }

        // Which attribute the action buttons carry. Defaults to a generic hook;
        // a card that already had its own (and tests written against it) keeps
        // that name rather than forcing a rename on every call site.
        const attr = spec.actionAttr || 'data-notice-action';

        function build() {
            const el = document.createElement('div');
            el.className = `quickstart-card notice-card ${cardClass}`;
            el.setAttribute('role', 'complementary');
            el.setAttribute('aria-label', text(spec.title));

            const note = spec.note ? text(spec.note) : '';
            // Keyed by the action's own name, not its position: a positional
            // hook says nothing at the call site and silently retargets the
            // moment a button is inserted before it.
            const actions = (spec.actions || []).map((action) => {
                const kind = action.primary ? 'quickstart-btn-primary' : 'quickstart-btn-ghost';
                return `<button type="button" class="quickstart-btn ${kind}" ${attr}="${escape(action.name)}">${escape(text(action.label))}</button>`;
            }).join('');

            el.innerHTML = `
                <div class="quickstart-stripe"></div>
                <div class="quickstart-inner">
                    <div class="quickstart-head">
                        <p class="quickstart-title">${escape(text(spec.title))}</p>
                        <button type="button" class="quickstart-close" data-notice-dismiss${spec.dismissName ? ` ${attr}="${escape(spec.dismissName)}"` : ''}
                                aria-label="${escape(text(spec.dismissLabel) || 'Dismiss')}">×</button>
                    </div>
                    <p class="notice-card-text ${spec.id}-text">${escape(text(spec.body))}</p>
                    ${note ? `<p class="notice-card-caveat">${escape(note)}</p>` : ''}
                    <div class="notice-card-actions">${actions}</div>
                </div>`;

            el.querySelector('[data-notice-dismiss]')?.addEventListener('click', () => {
                spec.onDismiss?.(handle);
                close();
            });
            (spec.actions || []).forEach((action) => {
                // `:not([data-notice-dismiss])` because a card that names its
                // × with `dismissName` puts that same attribute on the ×, and
                // the × comes first in the markup. A plain querySelector bound
                // the action to the × and left the button carrying the same
                // name with no listener at all — the side rail's "No thanks"
                // was dead from the day the cards were unified, and looked
                // fine because the × beside it still worked. The × keeps its
                // own handler above, which already calls onDismiss.
                el.querySelectorAll(`[${attr}="${action.name}"]:not([data-notice-dismiss])`)
                    .forEach((btn) => btn.addEventListener(
                        'click', (event) => action.onClick?.(handle, event.currentTarget)));
            });

            document.body.appendChild(el);
            cardEl = el;
            requestAnimationFrame(() => el.classList.add('show'));
            spec.onShown?.(handle);
            return true;
        }

        async function render() {
            if (!(await shouldShow())) return false;
            return build();
        }

        /**
         * Same as render(), for a card whose canShow is synchronous.
         *
         * Exists because several callers and tests treat the result as a plain
         * boolean rather than a promise. A card with async gating must use
         * render() — this one would see the pending promise as truthy.
         */
        function renderSync() {
            if (!gateSync()) return false;
            return build();
        }

        /**
         * Wait out this card's own delay, then join the queue.
         *
         * The delay is the card's alone — it is how long after arriving the
         * dashboard leaves someone in peace. Everything after it is shared: see
         * the queue above.
         */
        function autoStart() {
            pending = setTimeout(() => {
                pending = null;
                enqueue({
                    id: cardClass,
                    // render(), not renderSync(): a card may gate on something
                    // asynchronous, and the sync path would read the pending
                    // promise as a yes.
                    tryShow: async () => !cardEl && (await render()) === true,
                });
            }, spec.showDelayMs ?? SHOW_DELAY_MS);
        }

        function stop() {
            if (pending) {
                clearTimeout(pending);
                pending = null;
            }
            dequeue(cardClass);
        }

        return {
            render, renderSync, autoStart, close, stop, showError,
            shouldShow, shouldShowSync: gateSync,
            get element() { return cardEl; },
        };
    }

    global.NoticeCard = { define, cornerIsFree, wakeQueue };
}(typeof window !== 'undefined' ? window : globalThis));
