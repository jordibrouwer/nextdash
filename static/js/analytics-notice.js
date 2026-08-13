/**
 * One-time invitation to turn privacy-friendly analytics on.
 *
 * Shown a few seconds after the what's-new modal closes, but only when the
 * quick-start setup card is not competing for attention. A button on the card
 * opens a fuller explanation in the same modal style as what's new: why the
 * measurement exists and what it does and does not record.
 *
 * Answer-state lives in settings.quickStart.analyticsChoiceMade (server-side,
 * per user) so the card is answered once per user rather than once per browser.
 * That is deliberately not the older seenAnalyticsNotice flag: the card it
 * belonged to only announced that analytics was already on, so dismissing it
 * acknowledged a statement instead of answering a question. Those users still
 * get asked exactly once.
 *
 * Leaving the question open is not an answer either. Closing the card with ×,
 * or reading the detail without deciding, snoozes it on an escalating schedule
 * (see SNOOZE_DAYS) rather than asking again on the next load — a hesitant user
 * should not be badgered, and should not be silently written off as a no.
 * Merely being shown also starts a short cooldown (SHOWN_COOLDOWN_DAYS), so
 * reloading past an untouched card does not put it straight back on screen.
 *
 * Nothing renders when the user is already opted in, has already answered, is
 * inside a snooze window, or the operator set DISABLE_TELEMETRY — asking would
 * then be pointless or a lie.
 */
(function () {
    'use strict';

    const SHOW_DELAY_MS = 3500;

    // Days to wait after each time the question is left open. Escalating, and
    // capped at the last entry: someone who keeps ignoring it is answering in
    // practice, so the card becomes rare rather than disappearing outright.
    const SNOOZE_DAYS = [3, 14, 45];

    // Cooldown applied the moment the card is shown, so reloading past an
    // untouched card does not re-show it. Short, because ignoring a card once is
    // much weaker evidence than actively dismissing it.
    const SHOWN_COOLDOWN_DAYS = 1;

    let pending = null;

    function nowSeconds() {
        return Math.floor(Date.now() / 1000);
    }

    function dash() {
        return window.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (lang?.t) {
            const value = lang.t(key);
            if (value && value !== key) return value;
        }
        return fallback;
    }

    function escape(text) {
        return dash()?.escapeHtml ? dash().escapeHtml(text) : String(text || '');
    }

    function state() {
        const d = dash();
        if (!d?.settings) return null;
        if (!d.settings.quickStart || typeof d.settings.quickStart !== 'object') {
            d.settings.quickStart = {};
        }
        return d.settings.quickStart;
    }

    /**
     * Record that the user actually answered — turned analytics on, or declined.
     *
     * Deliberately a different flag from the legacy seenAnalyticsNotice, which
     * only recorded that someone dismissed the older card announcing analytics
     * was already on. Acknowledging a statement is not answering a question, so
     * those users are asked once here.
     */
    function markChoiceMade() {
        const qs = state();
        if (!qs || qs.analyticsChoiceMade === true) return;
        qs.analyticsChoiceMade = true;
        qs.analyticsAskAfter = 0; // answered; no snooze left to honour
        Promise.resolve(dash()?.saveSettings?.()).catch(() => {});
    }

    /**
     * Put the question away for a while without recording an answer.
     *
     * Used when the user leaves it open rather than deciding — closing the card
     * with ×, or reading the detail and closing the modal. Asking again on the
     * very next load would badger someone who is merely hesitating, so back off
     * and raise the interval each time it happens.
     */
    function snooze() {
        const qs = state();
        if (!qs) return;
        // Escalate per *user* action, counted directly rather than inferred from
        // analyticsAskAfter: the shown-cooldown also pushes that timestamp into
        // the future, which would otherwise read as "already snoozed" and pin the
        // schedule at its first step forever.
        const index = Math.min(Number(qs.analyticsSnoozes) || 0, SNOOZE_DAYS.length - 1);
        qs.analyticsSnoozes = index + 1;
        const until = nowSeconds() + SNOOZE_DAYS[index] * 86400;
        if (until > (Number(qs.analyticsAskAfter) || 0)) {
            qs.analyticsAskAfter = until;
        }
        Promise.resolve(dash()?.saveSettings?.()).catch(() => {});
    }

    /**
     * Cool down simply because the card was put on screen.
     *
     * Without this, reloading while the card sits there untouched shows it again
     * on every single load: nothing is persisted until the user clicks. Someone
     * who opens the dashboard ten times a day would face it ten times.
     *
     * Deliberately does not touch analyticsSnoozes — being shown is not the user
     * hesitating, so it must not consume a step of the escalating schedule. A
     * later × or detail-close still escalates from where the user actually left
     * off, and only extends the window (never shortens it).
     */
    function coolDownAfterShowing() {
        const qs = state();
        if (!qs) return;
        const until = nowSeconds() + SHOWN_COOLDOWN_DAYS * 86400;
        if (until <= (Number(qs.analyticsAskAfter) || 0)) return;
        qs.analyticsAskAfter = until;
        Promise.resolve(dash()?.saveSettings?.()).catch(() => {});
    }

    /**
     * Only ask when there is something to ask for: analytics still off, the
     * invitation not already answered, and no setup card or blocking modal in
     * the way. Once someone opts in — or declines — this never returns.
     */
    function shouldShow() {
        const d = dash();
        if (!d?.settings) return false;
        if (d.settings.analyticsOptIn === true) return false;
        // The operator kill switch makes the choice moot; asking would be a lie.
        if (document.querySelector('meta[name="nextdash-telemetry-locked"]')) return false;
        if (state()?.analyticsChoiceMade === true) return false;
        // Still inside a snooze window from an earlier, undecided visit.
        if (nowSeconds() < (Number(state()?.analyticsAskAfter) || 0)) return false;
        if (isOpen()) return false;
        // Config, health and the inbox are hash routes on this same page, so
        // without this the card drops on top of whatever the user opened. Only
        // interrupt the bookmarks view. ("bookmarks" is also the value before the
        // first view is assigned, which is the dashboard.)
        if (d.activeView && d.activeView !== 'bookmarks') return false;
        // Any quick-start card — the setup wizard *or* the checklist that follows
        // it — owns the same bottom-left corner, so wait until it is gone rather
        // than stacking a second card on top of it.
        if (document.querySelector('.quickstart-card:not(.analytics-notice-card)')) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        if (document.body.classList.contains('bookmark-inline-edit-active')) return false;
        return true;
    }

    // The card element belongs to the shared helper, so closing goes through it.
    function teardown() {
        card.close();
    }

    /** Whether this card is currently on screen. */
    function isOpen() {
        return card.element !== null;
    }

    /** "No thanks" — a real answer, so the card does not come back. */
    function dismiss() {
        markChoiceMade();
        teardown();
    }

    /** × — no answer given; back off and ask again later. */
    function askLater() {
        snooze();
        teardown();
    }

    /**
     * Turn analytics on. The tracker <script> is emitted server-side, so the page
     * has to reload before anything is actually measured — same as the config
     * checkbox and `:telemetry on`.
     */
    function optIn() {
        const d = dash();
        if (!d?.settings) return;
        // Set both flags before saving so the choice and the opt-in travel in a
        // single request, rather than racing two saves against the reload below.
        const qs = state();
        if (qs) {
            qs.analyticsChoiceMade = true;
            // Clear any snooze from an earlier hesitation; the question is answered.
            qs.analyticsAskAfter = 0;
        }
        d.settings.analyticsOptIn = true;
        teardown();
        const done = () => {
            d.isNavigatingAway = true;
            // The reload is what actually loads the tracker, but it also throws
            // away wherever you were — so opting in used to leave you back on
            // the dashboard with nothing to show for it. Land on the setting
            // that was just changed instead, by reloading into its deep link.
            const target = `${window.location.pathname}${window.location.search}#config/behavior/privacy`;
            window.location.replace(target);
        };
        if (typeof d.saveSettings === 'function') {
            Promise.resolve(d.saveSettings()).then(done).catch(done);
        } else {
            done();
        }
    }

    /**
     * Full explanation, in the same modal chrome as what's new.
     *
     * Reading the detail is not itself an answer: only the modal's confirm
     * button (optIn) or "No thanks" records one.
     *
     * The snooze is applied up front rather than from onCancel, because that
     * callback only fires for the cancel button — Escape and click-outside
     * close the modal without it, and those must not leave the question
     * un-snoozed. Opting in from here overwrites the snooze anyway.
     */
    function openDetails() {
        if (!window.AppModal) return;
        snooze();
        teardown();

        const section = (title, body) =>
            `<h3 class="analytics-notice-heading">${escape(title)}</h3><p>${body}</p>`;

        const html = `
            <div class="analytics-notice-modal-body">
                ${section(
                    t('dashboard.analyticsNoticeWhyTitle', 'Why this exists'),
                    escape(t('dashboard.analyticsNoticeWhyBody',
                        'nextDash had no picture of how it is actually used. Which views do people open? Does anyone use finders, the tag cloud, or the inbox? Where do people give up halfway through adding a bookmark? Without answers, every improvement is guesswork. These statistics answer exactly that — which features get used and what can be made better — and nothing else. They are not meant to follow you around: it is purely abstract, technical measurement of flow and feature usage, aggregated across everyone. Turning it on helps a lot, even if you only leave it on for a few days — a short stretch of real usage already says more than months of guessing, and you are welcome to switch it back off afterwards.'))
                )}
                ${section(
                    t('dashboard.analyticsNoticeNeverTitle', 'What is never recorded'),
                    escape(t('dashboard.analyticsNoticeNeverBody',
                        'No bookmark names, URLs, search queries, page or category names, notes, or tags. No cookies are set, no personal profile is built, and you are not tracked across other websites. Counts that could be revealing are rounded into buckets, and the instance is self-hosted, so nothing is shared with an advertising network.'))
                )}
                ${section(
                    t('dashboard.analyticsNoticeOnTitle', 'How to turn it on'),
                    `${escape(t('dashboard.analyticsNoticeOnBody',
                        'Go to Config → Behavior → Privacy and tick "Privacy-friendly analytics", or run :telemetry on from the command palette. It applies after the page reloads. While it is off, the tracker is not loaded at all and no request leaves your machine.'))
                    }<br><button type="button" class="quickstart-btn quickstart-btn-ghost" data-an-action="open-privacy">${
                        escape(t('dashboard.analyticsNoticeOpenSettings', 'Open privacy settings'))
                    }</button>`
                )}
            </div>`;

        window.AppModal.show({
            title: t('dashboard.analyticsNoticeModalTitle', 'privacy-friendly analytics'),
            htmlMessage: html,
            confirmText: t('dashboard.analyticsNoticeOptIn', 'Turn on'),
            cancelText: t('dashboard.analyticsNoticeClose', 'Close'),
            modalClass: 'whats-new-modal analytics-notice-modal',
            // Confirm is the opt-in itself — reading the detail is the most likely
            // moment someone decides yes, so make that the one-click path rather
            // than sending them to config to find the checkbox.
            onConfirm: optIn,
        });

        // Delegated rather than bound directly: AppModal.show may mount its
        // markup asynchronously, so querying for the button right here can find
        // nothing. Registered once, guarded by a flag.
        if (!bodyPrivacyDelegateBound) {
            bodyPrivacyDelegateBound = true;
            document.addEventListener('click', (e) => {
                const btn = e.target?.closest?.('[data-an-action="open-privacy"]');
                if (!btn) return;
                e.preventDefault();
                window.AppModal?.hide?.();
                openPrivacySettings();
            });
        }
    }

    let bodyPrivacyDelegateBound = false;

    /**
     * Open Config → Behavior → Privacy.
     *
     * Prefers the in-page config view; falls back to the deep-link hash so the
     * button still works if the view is unavailable for any reason.
     */
    function openPrivacySettings() {
        const d = window.dashboardInstance;
        if (d?.config?.openConfigView) {
            d.config.behaviorTab = 'privacy';
            void d.config.openConfigView('behavior');
            return;
        }
        window.location.hash = 'config/behavior/privacy';
    }

    // The card mechanism (markup, transition, corner etiquette) is shared; only
    // the gating and the three actions below are specific to this notice.
    // shouldShow() stays here rather than moving into canShow: it is exported and
    // several tests call it directly.
    const card = window.NoticeCard.define({
        id: 'analytics-notice',
        title: () => t('dashboard.analyticsNoticeTitle', 'Privacy-friendly analytics'),
        body: () => t('dashboard.analyticsNoticeBody',
            'Analytics is off. Turning it on shares anonymous usage statistics so it is visible which features are used and what can be improved — never bookmark names, URLs, or searches. You can switch it back off at any time.'),
        dismissLabel: () => t('dashboard.analyticsNoticeDismiss', 'Dismiss'),
        canShow: () => shouldShow(),
        // × is "not now" (snooze); "No thanks" below is an actual decline. Same
        // visual affordance, deliberately different meaning.
        onDismiss: askLater,
        onShown: coolDownAfterShowing,
        actionAttr: 'data-an-action',
        dismissName: 'later',
        actions: [
            { name: 'optin', label: () => t('dashboard.analyticsNoticeOptIn', 'Turn on'), primary: true, onClick: optIn },
            { name: 'details', label: () => t('dashboard.analyticsNoticeLearnMore', 'What is recorded?'), onClick: openDetails },
            { name: 'dismiss', label: () => t('dashboard.analyticsNoticeNoThanks', 'No thanks'), onClick: dismiss },
        ],
    });

    /**
     * @returns {boolean} whether the card was actually put on screen.
     *
     * Synchronous on purpose: several callers and tests treat the return value
     * as a plain boolean. This card's gating is synchronous too, so renderSync
     * gives the answer without a promise.
     */
    function render() {
        return card.renderSync();
    }

    /** Called when the what's-new modal closes; waits a beat so it doesn't stack. */
    function scheduleAfterWhatsNew() {
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
            pending = null;
            // A quick-start card may still be up; keep retrying rather than
            // burning the single chance to disclose this.
            if (!render()) waitForClearCorner();
        }, SHOW_DELAY_MS);
    }

    /** Poll until whatever is occupying the corner goes away, then show. */
    function waitForClearCorner() {
        let attempts = 0;
        const maxAttempts = 40; // ~40 × 1.5s ≈ 60s
        const tick = () => {
            attempts += 1;
            if (isOpen()) return;
            if (state()?.analyticsChoiceMade === true) return;
            if (nowSeconds() < (Number(state()?.analyticsAskAfter) || 0)) return;
            if (render()) return;
            if (attempts < maxAttempts) setTimeout(tick, 1500);
        };
        setTimeout(tick, 1500);
    }

    /**
     * Show the notice on its own when no what's-new modal is coming.
     *
     * Hanging it solely off that modal meant anyone who had already seen the
     * current release — most existing users — would never be told analytics is
     * on, which defeats the point of disclosing it. So poll briefly after load:
     * if the modal does appear, its onClose path takes over and this stays
     * quiet; if nothing shows up, the card comes out by itself.
     */
    function autoStart() {
        let attempts = 0;
        const maxAttempts = 20; // ~20 × 1.5s ≈ 30s, then give up for this load

        const tick = () => {
            attempts += 1;
            if (isOpen() || pending) return;            // already showing or queued
            if (state()?.analyticsChoiceMade === true) return;
            if (nowSeconds() < (Number(state()?.analyticsAskAfter) || 0)) return;
            if (dash()?.settings?.analyticsOptIn === true) return;

            // Let the release notes go first when they are on screen or pending.
            const whatsNewVisible = !!document.querySelector('.whats-new-modal');
            if (shouldShow() && !whatsNewVisible) {
                render();
                return;
            }
            if (attempts < maxAttempts) {
                setTimeout(tick, 1500);
            }
        };

        // Long enough for the dashboard to settle and any auto what's-new to open.
        setTimeout(tick, 6000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoStart, { once: true });
    } else {
        autoStart();
    }

    window.DashboardAnalyticsNotice = {
        scheduleAfterWhatsNew,
        render,
        shouldShow,
        // Exposed so the detail modal can be opened without the card, e.g. from
        // help or a test.
        openDetails,
        openPrivacySettings,
    };
})();
