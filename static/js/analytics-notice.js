/**
 * One-time notice that privacy-friendly analytics is on.
 *
 * Shown a few seconds after the what's-new modal closes, but only when the
 * quick-start setup card is not competing for attention. A link on the card
 * opens a fuller explanation in the same modal style as what's new: why the
 * measurement exists, what it does and does not record, and the two ways to
 * switch it off.
 *
 * Seen-state lives in settings.quickStart.seenAnalyticsNotice (server-side, per
 * user) so the card appears exactly once per user rather than once per browser.
 * Nothing renders when analytics is already off or the operator disabled
 * telemetry, since there would be nothing to disclose.
 */
(function () {
    'use strict';

    const SHOW_DELAY_MS = 3500;

    let cardEl = null;
    let pending = null;

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

    function markSeen() {
        const qs = state();
        if (!qs || qs.seenAnalyticsNotice === true) return;
        qs.seenAnalyticsNotice = true;
        Promise.resolve(dash()?.saveSettings?.()).catch(() => {});
    }

    /**
     * Only disclose something that is actually happening: analytics on, not
     * already acknowledged, and no setup card or blocking modal in the way.
     */
    function shouldShow() {
        const d = dash();
        if (!d?.settings) return false;
        if (d.settings.enableUsageAnalytics === false) return false;
        if (state()?.seenAnalyticsNotice === true) return false;
        if (cardEl) return false;
        // Any quick-start card — the setup wizard *or* the checklist that follows
        // it — owns the same bottom-left corner, so wait until it is gone rather
        // than stacking a second card on top of it.
        if (document.querySelector('.quickstart-card:not(.analytics-notice-card)')) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        if (document.body.classList.contains('bookmark-inline-edit-active')) return false;
        return true;
    }

    function teardown() {
        const el = cardEl;
        if (!el) return;
        cardEl = null;
        el.classList.remove('show');
        setTimeout(() => { if (el.isConnected) el.remove(); }, 260);
    }

    function dismiss() {
        markSeen();
        teardown();
    }

    /** Full explanation, in the same modal chrome as what's new. */
    function openDetails() {
        if (!window.AppModal) return;
        markSeen();
        teardown();

        const section = (title, body) =>
            `<h3 class="analytics-notice-heading">${escape(title)}</h3><p>${body}</p>`;

        const html = `
            <div class="analytics-notice-modal-body">
                ${section(
                    t('dashboard.analyticsNoticeWhyTitle', 'Why this exists'),
                    escape(t('dashboard.analyticsNoticeWhyBody',
                        'nextDash had no picture of how it is actually used. Which views do people open? Does anyone use finders, the tag cloud, or the inbox? Where do people give up halfway through adding a bookmark? Without answers, every improvement is guesswork. These statistics answer exactly that — which features get used and what can be made better — and nothing else. They are not meant to follow you around: it is purely abstract, technical measurement of flow and feature usage, aggregated across everyone.'))
                )}
                ${section(
                    t('dashboard.analyticsNoticeNeverTitle', 'What is never recorded'),
                    escape(t('dashboard.analyticsNoticeNeverBody',
                        'No bookmark names, URLs, search queries, page or category names, notes, or tags. No cookies are set, no personal profile is built, and you are not tracked across other websites. Counts that could be revealing are rounded into buckets, and the instance is self-hosted, so nothing is shared with an advertising network.'))
                )}
                ${section(
                    t('dashboard.analyticsNoticeOffTitle', 'How to turn it off'),
                    escape(t('dashboard.analyticsNoticeOffBody',
                        'Go to Config → General → Advanced → Privacy and clear "Privacy-friendly analytics", or run :telemetry off from the command palette. It applies after the page reloads. When off, the tracker is not loaded at all and no request leaves your machine.'))
                )}
            </div>`;

        window.AppModal.show({
            title: t('dashboard.analyticsNoticeModalTitle', 'privacy-friendly analytics'),
            htmlMessage: html,
            confirmText: t('dashboard.analyticsNoticeOpenConfig', 'Open privacy settings'),
            cancelText: t('dashboard.analyticsNoticeClose', 'Close'),
            modalClass: 'whats-new-modal analytics-notice-modal',
            // #general/advanced/privacy is the form config's layer router expects:
            // it switches General to the Advanced layer and scrolls to the panel.
            // A plain #general-privacy anchor lands on Essentials, where the
            // Privacy card is not rendered at all.
            onConfirm: () => { window.location.href = '/config#general/advanced/privacy'; },
        });
    }

    /** @returns {boolean} whether the card was actually put on screen. */
    function render() {
        if (!shouldShow()) return false;

        const el = document.createElement('div');
        el.className = 'quickstart-card analytics-notice-card';
        el.setAttribute('role', 'complementary');
        el.setAttribute('aria-label', t('dashboard.analyticsNoticeTitle', 'Privacy-friendly analytics'));
        el.innerHTML = `
            <div class="quickstart-stripe"></div>
            <div class="quickstart-inner">
                <div class="quickstart-head">
                    <p class="quickstart-title">${escape(t('dashboard.analyticsNoticeTitle', 'Privacy-friendly analytics'))}</p>
                    <button type="button" class="quickstart-close" data-an-action="dismiss"
                            aria-label="${escape(t('dashboard.analyticsNoticeDismiss', 'Dismiss'))}">×</button>
                </div>
                <p class="analytics-notice-text">${escape(t('dashboard.analyticsNoticeBody',
                    'nextDash records anonymous usage statistics to see which features are used and what can be improved — never bookmark names, URLs, or searches. You can turn this off at any time.'))}</p>
                <div class="analytics-notice-actions">
                    <button type="button" class="quickstart-btn quickstart-btn-primary" data-an-action="details">${escape(t('dashboard.analyticsNoticeLearnMore', 'What is recorded?'))}</button>
                    <button type="button" class="quickstart-btn quickstart-btn-ghost" data-an-action="dismiss">${escape(t('dashboard.analyticsNoticeGotIt', 'Got it'))}</button>
                </div>
            </div>`;

        el.querySelectorAll('[data-an-action="dismiss"]').forEach((btn) => {
            btn.addEventListener('click', dismiss);
        });
        el.querySelector('[data-an-action="details"]')?.addEventListener('click', openDetails);

        document.body.appendChild(el);
        cardEl = el;
        requestAnimationFrame(() => el.classList.add('show'));
        return true;
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
            if (cardEl) return;
            if (state()?.seenAnalyticsNotice === true) return;
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
            if (cardEl || pending) return;              // already showing or queued
            if (state()?.seenAnalyticsNotice === true) return;
            if (dash()?.settings?.enableUsageAnalytics === false) return;

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
    };
})();
