/**
 * Invitation to turn privacy-friendly analytics on, as a quiet row in the
 * notifications bell (Privacy).
 *
 * The row has two buttons: "Turn on", and "What is recorded?", which opens a
 * fuller explanation in the same modal style as what's new: why the
 * measurement exists and what it does and does not record. "No" in the bell
 * hides the row for good.
 *
 * Answer-state lives in settings.quickStart.analyticsChoiceMade (server-side,
 * per user), set when analytics is turned on. That is deliberately not the
 * older seenAnalyticsNotice flag: the card it belonged to only announced that
 * analytics was already on, so dismissing it acknowledged a statement instead
 * of answering a question. Those users still get the row.
 *
 * Nothing is reported when the user is already opted in, has already
 * answered, or the operator set DISABLE_TELEMETRY -- asking would then be
 * pointless or a lie.
 */
(function () {
    'use strict';

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

    // The shared escaper, loaded in the head. Asking the dashboard for one
    // left a fallback that escaped nothing whenever it was not there yet.
    function escape(text) {
        return window.NextDashHtml.escapeHtml(text);
    }

    function state() {
        const d = dash();
        if (!d?.settings) return null;
        if (!d.settings.quickStart || typeof d.settings.quickStart !== 'object') {
            d.settings.quickStart = {};
        }
        return d.settings.quickStart;
    }

    /** Whether the operator switched telemetry off for the whole server. */
    function lockedOff() {
        return !!document.querySelector('meta[name="nextdash-telemetry-locked"]');
    }

    /**
     * The bell row: 1 while analytics is off, not answered and not locked off,
     * null otherwise. Once someone opts in -- or has declined -- this never
     * returns.
     */
    async function bellState() {
        const d = dash();
        if (!d?.settings) return null;
        if (d.settings.analyticsOptIn === true) return null;
        // The operator kill switch makes the choice moot; asking would be a lie.
        if (lockedOff()) return null;
        if (state()?.analyticsChoiceMade === true) return null;
        return {
            count: 1,
            text: t('dashboard.analyticsNoticeTitle', 'Privacy-friendly analytics'),
        };
    }

    /**
     * "No" in the bell is a real decline, as "No thanks" on the old card was:
     * record the choice so Config and the next load see it as answered.
     */
    function declined() {
        const qs = state();
        if (!qs || qs.analyticsChoiceMade === true) return;
        qs.analyticsChoiceMade = true;
        Promise.resolve(dash()?.saveSettings?.({ keys: ['quickStart'] })).catch(() => {});
    }

    /** Undo `declined` when Config brings dismissed notifications back. */
    function undeclined() {
        const qs = state();
        if (!qs || qs.analyticsChoiceMade !== true) return;
        qs.analyticsChoiceMade = false;
        Promise.resolve(dash()?.saveSettings?.({ keys: ['quickStart'] })).catch(() => {});
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
            Promise.resolve(d.saveSettings({ keys: ['analyticsOptIn', 'quickStart'] })).then(done).catch(done);
        } else {
            done();
        }
    }

    /**
     * Full explanation, in the same modal chrome as what's new.
     *
     * Reading the detail is not itself an answer: only the modal's confirm
     * button (optIn) records one, so the row stays after it is closed.
     */
    function openDetails() {
        if (!window.AppModal) return;

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
                        'No bookmark names, URLs, search queries, page or category names, notes, or tags, and no container, image or widget names or addresses. No cookies are set, no personal profile is built, and you are not tracked across other websites. Counts that could be revealing are rounded into buckets, and the instance is self-hosted, so nothing is shared with an advertising network.'))
                )}
                ${section(
                    t('dashboard.analyticsNoticeOnTitle', 'How to turn it on'),
                    `${escape(t('dashboard.analyticsNoticeOnBody',
                        'Go to Config → Behavior → Privacy & sync and tick "Privacy-friendly analytics", or run :telemetry on from the command palette. It applies after the page reloads. While it is off, the tracker is not loaded at all and no request leaves your machine.'))
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

    // The row is a quiet bell source: the corner card, its snooze schedule and
    // the polling that waited for a free corner went with it.
    window.NoticeCard.define({
        id: 'analytics-notice',
        title: () => t('dashboard.analyticsNoticeTitle', 'Privacy-friendly analytics'),
        bell: {
            kind: 'quiet',
            group: 'privacy',
            icon: '\u{1F4CA}',
            no: 'forever',
            onNo: declined,
            onReset: undeclined,
            state: bellState,
            actions: [
                { label: () => t('dashboard.analyticsNoticeOptIn', 'Turn on'), primary: true, onClick: optIn },
                { label: () => t('dashboard.analyticsNoticeLearnMore', 'What is recorded?'), onClick: openDetails },
            ],
        },
    }).autoStart();

    window.DashboardAnalyticsNotice = {
        state: bellState,
        // Exposed so the detail modal can be opened without the card, e.g. from
        // help or a test.
        openDetails,
        openPrivacySettings,
    };
})();
