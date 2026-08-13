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
    const MAX_ATTEMPTS = 20;
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
            setTimeout(() => { if (el.isConnected) el.remove(); }, TEARDOWN_MS);
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
                el.querySelector(`[${attr}="${action.name}"]`)
                    ?.addEventListener('click', (event) => action.onClick?.(handle, event.currentTarget));
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
         * Poll for a free moment rather than taking a single chance at a fixed
         * delay: quick-start, the what's-new modal and any other notice all
         * occupy this same corner on a fresh install.
         */
        function autoStart() {
            let attempts = 0;
            const tick = async () => {
                attempts += 1;
                if (cardEl) return;
                if (await render()) return;
                if (attempts < MAX_ATTEMPTS) {
                    pending = setTimeout(tick, RETRY_MS);
                }
            };
            pending = setTimeout(tick, spec.showDelayMs ?? SHOW_DELAY_MS);
        }

        function stop() {
            if (pending) {
                clearTimeout(pending);
                pending = null;
            }
        }

        return {
            render, renderSync, autoStart, close, stop, showError,
            shouldShow, shouldShowSync: gateSync,
            get element() { return cardEl; },
        };
    }

    global.NoticeCard = { define, cornerIsFree };
}(typeof window !== 'undefined' ? window : globalThis));
