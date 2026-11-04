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
 *         view: 'docker',                     // optional: the view it belongs in
 *     });
 *
 * A card shows in the bookmarks view unless it names another with `view`
 * (the value of the dashboard's `activeView`, such as 'docker' or 'inbox'):
 * a card about containers is for the Containers view, and would otherwise
 * never be shown, since every other view is held clear of interruptions.
 *
 * A card may be shown as a toast instead of a corner card, with `toast: { ... }`
 * on its spec: it keeps its gate, its delay and its place in the queue (so it
 * still waits for a free moment), but it appears as one line of text and no
 * button at all, so the message has to say where to go. A toast cannot be
 * answered, so `toast.onShown` records what the corner card's x used to
 * ("seen", or a snooze); the card's buttons are not offered.
 *
 *     toast: {
 *         message: () => t('...', 'One line, with the key in it'),  // default: title + body
 *         type: 'info',          // an AppNotification type; default 'info'
 *         duration: 12000,       // ms; default 12000
 *         onShown: () => markAnswered(),
 *     }
 *
 * A card may also report to the notifications bell in the navigation bar, with
 * `bell: { ... }`. The bell is a list of rows, each one a source that can say
 * "there is something here" at any moment; a card becomes such a source and
 * keeps its id. `kind` decides what happens to the corner:
 *
 *     // 'urgent': the card behaves exactly as above, in the corner, and also
 *     // has a row in the bell for as long as `state` reports something.
 *     bell: { kind: 'urgent', group: 'system', icon: '!', no: 'state',
 *             state: async () => (broken ? { count: 1, text: 'Alerts are off' } : null) }
 *
 *     // 'quiet': never in the corner and never a toast. autoStart() only
 *     // registers the row. For things worth knowing, not worth interrupting for.
 *     bell: { kind: 'quiet', group: 'cleanup', icon: '*', no: 'forever',
 *             state: async () => ({ count: unused.length, ids: unused, text: 'Unused icons' }) }
 *
 *     // 'tip': like 'quiet', for a suggestion; the bell offers "Mark read".
 *     bell: { kind: 'tip', group: 'tips', icon: '?', no: 'forever',
 *             state: async () => ({ count: 1, text: 'Try the side rail' }) }
 *
 *     // 'health': like 'quiet', for a monitored thing that is not well.
 *     bell: { kind: 'health', group: 'health', icon: '+', no: { threshold: 3 },
 *             state: async () => (down ? { count: down, text: `${down} down` } : null) }
 *
 * `bell.state` is required in practice: it is what decides whether the row is
 * there. A card's `canShow` is not turned into a state on its own, because
 * "may I interrupt now" and "is there something to report" are different
 * questions. Without `bell.state` the row falls back to canShow, with the
 * card's title and body as its text. `bell.actions` are the row's buttons;
 * without them the card's own `actions` are used, called with the card's
 * handle (close() on it does nothing when no corner card is up). The bell draws
 * its own "No" / "Mark read" button, so none is declared here. `bell.onNo(row)`
 * is called after the bell wrote its "No", for a card whose "No" is also an
 * answer other code must see (a promo marked seen, a setting recorded); `bell.onRead(row)` is
 * the same for a tip that was read ("Mark read", or a `marksRead` action). The corner's
 * etiquette (an unfinished onboarding, phones with corner cards hidden, the
 * quiet after the start guide) does not apply to the bell; it is not an
 * interruption.
 *
 * Tips share one slot: a card with `tipSlot: true` is not shown while another
 * tip card was drawn within the last seven days, and drawing one starts the
 * seven days. It comes on top of `minGapAfterCardMs`, which still applies.
 *
 *     NoticeCard.define({ id: 'tip-a', tipSlot: true, canShow: () => true, … });
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
    // How long after the start guide is finished no card is shown: ten seconds.
    const QUIET_AFTER_GUIDE_S = 10;

    // The one tip slot: a week between two tip cards.
    const TIP_SLOT_MS = 7 * 24 * 3600 * 1000;
    const BELL_ONLY = ['quiet', 'tip', 'health'];

    function dash() {
        return global.dashboardInstance || null;
    }

    const escape = window.NextDashHtml.escapeHtml;

    /**
     * Whether the corner is free and interrupting is reasonable at all.
     *
     * This is the part that had drifted between the hand-written copies, so it
     * lives in exactly one place now. `selfClass` is excluded from the
     * "another card is up" check so a card does not consider itself a blocker
     * when re-rendered.
     */
    function cornerIsFree(selfClass, { essential = false, view = 'bookmarks' } = {}) {
        const d = dash();
        if (!d?.settings) return false;
        // The public demo shows no corner cards: every visitor is new, and a
        // stack of invitations is not the product.
        if (global.DemoLock?.on) return false;
        // Hide corner cards on phones. Nothing is marked as answered: the card
        // is only not shown, so it comes back when the setting is turned off.
        if (global.isPhoneDevice?.() && d.settings.hideCornerCardsMobile === true) return false;
        // An essential card reports something that already happened and offers
        // its undo; it is not an invitation, so the phone layout and an
        // unfinished onboarding do not hold it back.
        if (!essential) {
            if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
            if (d.onboardingStartedInSession) return false;
            if (d.settings.onboardingCompleted === false) return false;
            // The start guide was only just finished: the corner stays quiet
            // for a while, so the cards that were waiting for it do not arrive
            // together the moment it is closed.
            const finishedAt = Number(d.settings.quickStart?.completedAt) || 0;
            if (finishedAt > 0 && Date.now() / 1000 - finishedAt < QUIET_AFTER_GUIDE_S) return false;
        }
        // Config, health and the inbox are hash routes on this same page, so
        // without this a card drops on top of whatever the user opened — including,
        // for a settings-related card, the very panel it is about. Only interrupt
        // the bookmarks view. ("bookmarks" is also the value before the first view
        // is assigned, which is the dashboard.) A card that belongs to another
        // view asks for that one instead, and only shows there.
        if (d.activeView && d.activeView !== view) return false;
        // Quick-start — the setup wizard *or* the checklist that follows it — owns
        // the same corner, as does any other notice card.
        // An essential card waits for another notice, but stands above the
        // checklist rather than waiting for it to be finished.
        const blocker = essential ? `.quickstart-card.notice-card:not(.${selfClass})` : `.quickstart-card:not(.${selfClass})`;
        if (document.querySelector(blocker)) return false;
        // Something that is not a card but stands in the corner too -- the
        // minimised weekly digest -- says so with this attribute.
        if (document.querySelector('[data-holds-corner]')) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        if (document.querySelector('.whats-new-modal')) return false;
        // The dialog that explains the move to Aurora Glass comes before every card.
        if (global.LookMigrationNotice?.blocking?.()) return false;
        // The block-move intro (animation, then its card) has the screen until it
        // is answered, and comes first when it is still to play in this load: it
        // wakes the queue once it is done or gives up.
        if (document.body.classList.contains('is-block-move-intro')) return false;
        if (global.DashboardBlockMoveIntro?.isPending?.()) return false;
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
                // One card whose gate throws is skipped, not the end of the
                // pass: thrown through, it also skipped the retry below and
                // every card queued behind it waited for the next load.
                let shown = false;
                try {
                    shown = await entry.tryShow();
                } catch (err) {
                    console.warn('notice card', entry.id, 'could not be shown', err);
                }
                if (shown) {
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
        wakeAfterQuiet();
    }

    /**
     * The quiet after the start guide ends without any event, so the poll
     * window (forty seconds) is long over by then and nothing would ask again:
     * the cards stayed queued until the next load. One timer, set for the end
     * of the quiet, wakes the queue then.
     */
    let quietTimer = null;
    function wakeAfterQuiet() {
        if (quietTimer || !queue.length) return;
        const finishedAt = Number(dash()?.settings?.quickStart?.completedAt) || 0;
        const leftMs = finishedAt > 0 ? (finishedAt + QUIET_AFTER_GUIDE_S) * 1000 - Date.now() : 0;
        if (leftMs <= 0) return;
        quietTimer = setTimeout(() => {
            quietTimer = null;
            wakeQueue();
        }, leftMs + 500);
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
                && (node.matches?.('.quickstart-card, .whats-new-modal, .block-intro-card')
                    || node.querySelector?.('.quickstart-card, .whats-new-modal, .block-intro-card'))));
            if (freed) wakeQueue();
        });
        bodyObserver.observe(document.body, { childList: true, subtree: true });
        // Two more things free the corner without removing a node. Coming back
        // from config, health or the inbox changes the hash, and the app modal
        // closes by losing its `show` class. Without these a card that waited
        // out its forty seconds while the reader was elsewhere stayed queued
        // until the next load. wakeQueue is cheap and a card still asks its own
        // canShow, so waking on any of them is safe.
        global.addEventListener('hashchange', wakeQueue);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') wakeQueue();
        });
        const appModal = document.getElementById('app-modal');
        if (appModal && typeof MutationObserver === 'function') {
            new MutationObserver(() => {
                if (!appModal.classList.contains('show')) wakeQueue();
            }).observe(appModal, { attributes: true, attributeFilter: ['class'] });
        }
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

    // Every card defined, for busy(): whether one is still to come.
    const registry = [];

    // When a corner card was last put up, kept across loads: a card may ask
    // (`minGapAfterCardMs`) to come no sooner than that long after any other.
    const LAST_CARD_KEY = 'nextdash:last-corner-card-at';
    let gapTimer = null;

    function lastCardAt() {
        try { return Number(global.localStorage?.getItem(LAST_CARD_KEY)) || 0; } catch { return 0; }
    }

    function noteCardShown() {
        try { global.localStorage?.setItem(LAST_CARD_KEY, String(Date.now())); } catch { /* the gap just is not kept */ }
    }

    /** True when the card must still wait out its gap; wakes the queue when it is over. */
    function waitingOutGap(spec) {
        const gap = Number(spec.minGapAfterCardMs) || 0;
        if (gap <= 0) return false;
        const remaining = lastCardAt() + gap - Date.now();
        if (remaining <= 0) return false;
        if (!gapTimer) {
            gapTimer = setTimeout(() => { gapTimer = null; wakeQueue(); }, remaining + 50);
        }
        return true;
    }

    /**
     * Whether a corner card is still on its way: up now, waiting out its own
     * delay, or queued and wanting to show. Essential cards (reports of
     * something that happened) do not count -- they are not part of the
     * line-up a later invitation waits for.
     */
    async function busy() {
        for (const card of registry) {
            if (card.spec.essential === true) continue;
            if (card.element()) return true;
            // A card for another view is not part of the line-up here.
            if (card.spec.view && dash()?.activeView !== card.spec.view) continue;
            // Waiting out its delay, but a card that would not show anyway (answered, or nothing
            // to offer) is not part of the line-up: nothing should wait the length of its delay.
            if (card.waiting()) {
                try {
                    if ((await card.spec.canShow?.()) === false) continue;
                } catch { /* a card that cannot answer may still come */ }
                return true;
            }
            // Queued and able to show now. A card the corner holds back for
            // the rest of this session (the first one, during onboarding)
            // comes on a later load; nothing should wait for it until then.
            if (queue.some((entry) => entry.id === card.id) && cornerIsFree(card.id, { view: card.spec.view })) {
                try {
                    if ((await card.spec.canShow?.()) !== false) return true;
                } catch { /* a card that cannot answer is not waiting */ }
            }
        }
        return false;
    }

    function define(spec) {
        const cardClass = `${spec.id}-card`;
        let cardEl = null;
        let pending = null;
        registry.push({ id: cardClass, spec, element: () => cardEl, waiting: () => pending != null });

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
            // A toast has no card to put the failure on: it becomes a toast of its own.
            if (!el && spec.toast) {
                dash()?.showNotification?.(message, 'error');
                return;
            }
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

        // A quiet, tip or health card lives in the bell only.
        const bellOnly = BELL_ONLY.includes(spec.bell?.kind);
        let bellHandle = null;

        /** Register with the bell, once; calling it again does nothing. */
        function registerWithBell() {
            if (!spec.bell || bellHandle || !global.NotificationBell) return;
            const b = spec.bell;
            const state = b.state || (async () => (
                (await spec.canShow?.()) !== false
                    ? { count: 1, text: `${text(spec.title)} \u2014 ${text(spec.body)}` }
                    : null));
            const actions = b.actions || (spec.actions || []).map((action) => ({
                label: text(action.label),
                primary: action.primary,
                onClick: () => action.onClick?.(handle),
            }));
            bellHandle = global.NotificationBell.register({
                id: spec.id, group: b.group, kind: b.kind, icon: b.icon, no: b.no, state, actions, onNo: b.onNo, onRead: b.onRead,
            });
        }

        /** True while the tip slot is taken by a card drawn in the last week. */
        function tipSlotTaken() {
            if (spec.tipSlot !== true) return false;
            const at = Number(global.DiscoverabilityState?.getTipCardShownAt?.()) || 0;
            return Date.now() - at < TIP_SLOT_MS;
        }

        function gateSync() {
            if (bellOnly) return false;
            if (cardEl) return false;
            if (tipSlotTaken()) return false;
            if (!cornerIsFree(cardClass, { essential: spec.essential === true, view: spec.view })) return false;
            if (waitingOutGap(spec)) return false;
            return spec.canShow?.() !== false;
        }

        async function shouldShow() {
            if (bellOnly) return false;
            if (cardEl) return false;
            if (tipSlotTaken()) return false;
            if (!cornerIsFree(cardClass, { essential: spec.essential === true, view: spec.view })) return false;
            if (waitingOutGap(spec)) return false;
            // Async so a card may consult something that needs awaiting.
            return (await spec.canShow?.()) !== false;
        }

        // Which attribute the action buttons carry. Defaults to a generic hook;
        // a card that already had its own (and tests written against it) keeps
        // that name rather than forcing a rename on every call site.
        const attr = spec.actionAttr || 'data-notice-action';

        /** The card as a toast: one line of text, no button. */
        function buildToast() {
            const d = dash();
            if (!d?.showNotification) return false;
            const cfg = spec.toast === true ? {} : spec.toast;
            const message = cfg.message ? text(cfg.message) : `${text(spec.title)} ${text(spec.body)}`.trim();
            const options = { duration: cfg.duration ?? 12000 };
            d.showNotification(message, cfg.type || 'info', options);
            noteCardShown();
            if (spec.tipSlot === true) global.DiscoverabilityState?.noteTipCardShown?.(Date.now());
            cfg.onShown?.(handle);
            spec.onShown?.(handle);
            return true;
        }

        function build() {
            if (spec.toast) return buildToast();
            const el = document.createElement('div');
            el.className = `quickstart-card notice-card ${cardClass}`;
            el.setAttribute('role', 'complementary');
            el.setAttribute('aria-label', text(spec.title));

            const note = spec.note ? text(spec.note) : '';
            // Keyed by the action's own name, not its position: a positional
            // hook says nothing at the call site and silently retargets the
            // moment a button is inserted before it.
            const actions = (spec.actions || []).map((action) => {
                // `quiet` is for an answer that belongs on the card but not in
                // the row of choices -- a postponement beside a yes and a no.
                let kind = 'quickstart-btn-ghost';
                if (action.primary) kind = 'quickstart-btn-primary';
                else if (action.quiet) kind = 'quickstart-btn-quiet';
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
            noteCardShown();
            if (spec.tipSlot === true) global.DiscoverabilityState?.noteTipCardShown?.(Date.now());
            if (spec.essential === true) {
                // Above the start guide bar when it holds the corner.
                const checklist = document.querySelector('.quickstart-card:not(.notice-card)');
                const top = checklist?.getBoundingClientRect?.().top;
                if (Number.isFinite(top) && top > 0) el.style.bottom = `${Math.round(window.innerHeight - top + 12)}px`;
            }
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
            registerWithBell();
            // The bell row is all a quiet card has; nothing is queued or drawn.
            if (bellOnly) return;
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

    global.NoticeCard = { define, cornerIsFree, wakeQueue, busy };
}(typeof window !== 'undefined' ? window : globalThis));
