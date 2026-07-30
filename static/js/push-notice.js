/**
 * One-time invitation to turn browser notifications on.
 *
 * Appears a few seconds after load, in the same bottom-left card as the
 * quick-start and analytics notices — and waits for that corner to be free
 * rather than stacking on top of them. Existing installs see it too: the point
 * is that outage alerts are worth having whether or not you are a new user.
 *
 * Saying yes enables the server-side master switch *and* the monitoring and
 * health categories, because "notify me about outages" is the whole reason to
 * accept, then registers this device. Backup and release notices stay off; they
 * are opt-in from config, and bundling them would make a yes mean more than
 * the card asked for.
 *
 * Answer-state lives in settings.quickStart (server-side), so the question is
 * answered once per user rather than once per browser. Registering the device
 * is per browser, so the card can still return on a second machine once the
 * server switch is already on — that is intentional.
 *
 * IMPORTANT: the "turn on" handler must reach Notification.requestPermission()
 * before it awaits anything and before the button is disabled. Safari drops the
 * user gesture on both, and then refuses to show the permission dialog at all.
 * See PushNotifications.subscribe() for the same constraint.
 */
(function () {
    'use strict';

    const SHOW_DELAY_MS = 5000;

    // Escalating back-off when the question is left open, capped at the last
    // entry. Someone who keeps ignoring it is answering in practice.
    const SNOOZE_DAYS = [3, 14, 45];

    // Applied merely because the card was shown, so reloading past an untouched
    // card does not put it straight back up.
    const SHOWN_COOLDOWN_DAYS = 1;

    let cardEl = null;

    function nowSeconds() {
        return Math.floor(Date.now() / 1000);
    }

    function dash() {
        return window.dashboardInstance || null;
    }

    function t(key, fallback, vars) {
        const lang = dash()?.language;
        let text = fallback;
        if (lang?.t) {
            const value = lang.t(key);
            if (value && value !== key) text = value;
        }
        if (vars) {
            Object.entries(vars).forEach(([k, v]) => {
                text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
            });
        }
        return text;
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

    function save() {
        return Promise.resolve(dash()?.saveSettings?.()).catch(() => {});
    }

    /** A real answer — yes or no. The card does not come back. */
    function markChoiceMade() {
        const qs = state();
        if (!qs) return;
        qs.pushChoiceMade = true;
        qs.pushAskAfter = 0;
    }

    /** Left open rather than decided: back off, escalating each time. */
    function snooze() {
        const qs = state();
        if (!qs) return;
        const index = Math.min(Number(qs.pushSnoozes) || 0, SNOOZE_DAYS.length - 1);
        qs.pushSnoozes = index + 1;
        const until = nowSeconds() + SNOOZE_DAYS[index] * 86400;
        if (until > (Number(qs.pushAskAfter) || 0)) qs.pushAskAfter = until;
        save();
    }

    function coolDownAfterShowing() {
        const qs = state();
        if (!qs) return;
        const until = nowSeconds() + SHOWN_COOLDOWN_DAYS * 86400;
        if (until <= (Number(qs.pushAskAfter) || 0)) return;
        qs.pushAskAfter = until;
        save();
    }

    /**
     * Whether asking makes sense at all.
     *
     * Note this does *not* require the server switch to be off: the switch is
     * shared across devices, so a second browser still needs to be asked for its
     * own permission. What settles the question is the per-user answer flag and
     * whether this browser is already subscribed.
     */
    async function shouldShow() {
        const d = dash();
        if (!d?.settings) return false;
        if (cardEl) return false;

        const push = window.PushNotifications;
        // No point asking where it cannot work. Safari on http://localhost lands
        // here via isSecureContext being false only on plain http; the stricter
        // Safari refusal surfaces when the user actually clicks, and the error
        // text explains it.
        if (!push?.isSupported?.() || !push.isSecureContext?.()) return false;
        // Already blocked at browser level: the prompt cannot be reopened from
        // script, so the card would be a dead end.
        if (push.permission?.() === 'denied') return false;

        const qs = state();
        if (qs?.pushChoiceMade === true) return false;
        if (nowSeconds() < (Number(qs?.pushAskAfter) || 0)) return false;

        // This browser is already registered — nothing to ask.
        if (await push.isSubscribed?.()) return false;

        // Config, health and the inbox are hash routes on this same page, so a
        // card would otherwise drop on top of the settings the user is reading —
        // including the very panel this card is about. Only interrupt the
        // bookmarks view. ("bookmarks" is also the value before the first view
        // is assigned, which is the dashboard.)
        if (d.activeView && d.activeView !== 'bookmarks') return false;
        // The same bottom-left corner is used by quick-start and the analytics
        // notice; let those finish first.
        if (document.querySelector('.quickstart-card')) return false;
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

    function decline() {
        markChoiceMade();
        save();
        teardown();
    }

    function askLater() {
        snooze();
        teardown();
    }

    function notify(message) {
        window.AppNotification?.show?.(message);
    }

    /**
     * Turn notifications on, from the click that is still a user gesture.
     *
     * Deliberately NOT an async function: an `await` here would resolve after
     * the gesture is gone in Safari. subscribe() is called synchronously as the
     * first thing that happens, and only its returned promise is awaited.
     */
    function enable(button) {
        const push = window.PushNotifications;
        if (!push) return;

        // Start the subscribe (and with it the permission prompt) before touching
        // anything else — disabling the button first would end the gesture.
        //
        // beforeRegister runs once the user has granted permission but before the
        // server is contacted, which is the only point where switching push on is
        // both necessary (the register call refuses otherwise) and warranted (the
        // user has committed). Doing it when the card merely appeared would change
        // settings nobody asked to change.
        const pending = push.subscribe({ beforeRegister: enableServerSide });
        button.disabled = true;

        pending.then(async () => {
            markChoiceMade();
            await save();
            teardown();
            notify(t('dashboard.pushPromptDone', 'Outage alerts are on for this device.'));
            // Confirm delivery actually works, rather than leaving the user to
            // wonder until the first real outage.
            try { await push.sendTest(); } catch (err) { /* the toast above already confirmed the opt-in */ }
        }).catch((err) => {
            button.disabled = false;
            notify(t('dashboard.pushPromptFailed', 'Could not turn notifications on: {error}', {
                error: err?.message || String(err),
            }));
        });
    }

    /**
     * Switch push on server-side, as part of accepting.
     *
     * Called from subscribe()'s beforeRegister hook rather than when the card is
     * rendered: the register call refuses while the switch is off, but flipping
     * it merely because a card appeared would turn settings on for someone who
     * then declines — and nothing here turns them back off again.
     *
     * Monitoring and health alerts are the reason this card exists, so they come
     * on with it. Backup and release notices stay opt-in from config, because a
     * yes here should not mean more than the card asked for.
     */
    async function enableServerSide() {
        const d = dash();
        if (!d?.settings) return;
        d.settings.pushNotifyEnabled = true;
        d.settings.pushNotifyMonitor = true;
        await save();
    }

    /** Safari-only caveat, shown only where it applies. */
    function isSafari() {
        const ua = navigator.userAgent || '';
        return /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua);
    }

    async function render() {
        if (!(await shouldShow())) return false;

        const el = document.createElement('div');
        el.className = 'quickstart-card push-notice-card';
        el.setAttribute('role', 'complementary');
        el.setAttribute('aria-label', t('dashboard.pushPromptTitle', 'Turn on outage alerts?'));

        const safariNote = isSafari()
            ? `<p class="push-notice-caveat">${escape(t('dashboard.pushPromptSafari',
                'Note: Safari only allows notifications over HTTPS — on http://localhost it will refuse. Chrome does work on localhost.'))}</p>`
            : '';

        el.innerHTML = `
            <div class="quickstart-stripe"></div>
            <div class="quickstart-inner">
                <div class="quickstart-head">
                    <p class="quickstart-title">${escape(t('dashboard.pushPromptTitle', 'Turn on outage alerts?'))}</p>
                    <button type="button" class="quickstart-close" data-push-action="later"
                            aria-label="${escape(t('dashboard.pushPromptDismiss', 'Not now'))}">×</button>
                </div>
                <p class="push-notice-text">${escape(t('dashboard.pushPromptBody',
                    'Get a notification when a monitored bookmark goes down or comes back, even when nextDash is closed. Monitoring and health alerts are switched on by default.'))}</p>
                ${safariNote}
                <div class="push-notice-actions">
                    <button type="button" class="quickstart-btn quickstart-btn-primary" data-push-action="enable">${escape(t('dashboard.pushPromptEnable', 'Turn on'))}</button>
                    <button type="button" class="quickstart-btn quickstart-btn-ghost" data-push-action="decline">${escape(t('dashboard.pushPromptNoThanks', 'No thanks'))}</button>
                </div>
            </div>`;

        // × is "not now" (snooze); "No thanks" is a real decline.
        el.querySelector('[data-push-action="later"]')?.addEventListener('click', askLater);
        el.querySelector('[data-push-action="decline"]')?.addEventListener('click', decline);
        const enableBtn = el.querySelector('[data-push-action="enable"]');
        enableBtn?.addEventListener('click', () => enable(enableBtn));

        document.body.appendChild(el);
        cardEl = el;
        requestAnimationFrame(() => el.classList.add('show'));
        coolDownAfterShowing();
        return true;
    }

    /**
     * Poll for a free moment rather than taking the single chance at a fixed
     * delay: quick-start, the what's-new modal and the analytics notice all
     * occupy the same corner on a fresh install.
     */
    function autoStart() {
        let attempts = 0;
        const maxAttempts = 20; // ~20 × 2s ≈ 40s, then give up for this load

        const tick = async () => {
            attempts += 1;
            if (cardEl) return;
            if (document.querySelector('.whats-new-modal')) {
                if (attempts < maxAttempts) setTimeout(tick, 2000);
                return;
            }
            if (await render()) return;
            if (attempts < maxAttempts) setTimeout(tick, 2000);
        };

        setTimeout(tick, SHOW_DELAY_MS);
    }

    // Exposed for tests and for a manual re-prompt from config.
    window.PushNotice = { render, autoStart };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoStart, { once: true });
    } else {
        autoStart();
    }
})();
