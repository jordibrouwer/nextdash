/**
 * One-time invitation to try the Widgets layout.
 *
 * The layout presets sit behind Config → Appearance → Grid, and a reader who
 * never opens that tab stays on whatever the install started them on. Widgets
 * is the one that changes the most: categories become cards, so the widgets
 * between them stop looking like strangers on the page -- and it is also the
 * layout the theme archetypes have the most to say on.
 *
 * Describing it is useless. So the card applies it, and the same card offers
 * the way back: the preset the reader had is remembered before the switch, and
 * Undo puts it back. Nothing here is a one-way door.
 *
 * The delay is deliberately not a plain timer. A card that appears five
 * seconds after load interrupts somebody who is still arriving; one that
 * appears after a fixed minute is the same interruption on a schedule. This
 * one spends a random budget of *active* time -- the tab visible, and a
 * pointer, a key or a scroll within the last three-quarters of a minute --
 * so it arrives while the reader is using the dashboard rather than while
 * they are away from it, and not at the same moment for everyone.
 *
 * The card itself (markup, transition, corner etiquette, retry loop) comes
 * from NoticeCard; only what is below is specific to this invitation.
 */
(function initWidgetsLayoutNotice(global) {
    'use strict';

    const PROMO_ID = 'widgets-layout-try-v1';
    const TARGET_PRESET = 'widgets';

    /*
     * The budget, in active milliseconds.
     *
     * Two to six minutes of actually using the dashboard. Long enough that the
     * card is never part of arriving, short enough that a reader who opens
     * nextDash for a working session sees it once in that session. Drawn once
     * per page load, so two people -- or two tabs -- do not get it at the same
     * point.
     */
    const MIN_ACTIVE_MS = 120_000;
    const MAX_ACTIVE_MS = 360_000;

    /** How long an interaction counts for. Reading a dashboard is not typing. */
    const IDLE_AFTER_MS = 45_000;
    const TICK_MS = 1000;

    const budgetMs = MIN_ACTIVE_MS + Math.floor(Math.random() * (MAX_ACTIVE_MS - MIN_ACTIVE_MS));

    let activeMs = 0;
    let lastInteraction = Date.now();
    let ticker = null;

    /** The preset the reader was on before the card changed it. */
    let previousPreset = null;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const value = lang.t(key);
        return value && value !== key ? value : fallback;
    }

    const escape = window.NextDashHtml.escapeHtml;

    function hasAnswered() {
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(PROMO_ID) === true;
    }

    /** Records the answer; each reader is asked once, ever. */
    function markAnswered() {
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    function currentPreset() {
        const stored = dash()?.settings?.layoutPreset;
        return global.LayoutUtils?.normalizeLayoutPreset?.(stored) || stored || 'default';
    }

    /** Only worth asking somebody who is not already there. */
    function worthAsking() {
        return !hasAnswered() && currentPreset() !== TARGET_PRESET;
    }

    /* ── The active clock ──────────────────────────────────────────────── */

    function noteInteraction() {
        lastInteraction = Date.now();
    }

    function isActive() {
        if (document.visibilityState === 'hidden') return false;
        return Date.now() - lastInteraction < IDLE_AFTER_MS;
    }

    function stopClock() {
        if (!ticker) return;
        clearInterval(ticker);
        ticker = null;
    }

    function tick(card) {
        // Someone who reaches the layout by themselves, or answers another
        // way, should not then be asked about it.
        if (!worthAsking()) {
            stopClock();
            return;
        }
        if (isActive()) activeMs += TICK_MS;
        if (activeMs < budgetMs) return;

        stopClock();
        // showDelayMs is 0: the waiting was this clock's job, and the queue
        // still decides whether the corner is free.
        card.autoStart();
    }

    function startClock(card) {
        if (ticker || !worthAsking()) return;
        ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']
            .forEach((event) => global.addEventListener(event, noteInteraction, { passive: true }));
        document.addEventListener('visibilitychange', noteInteraction);
        ticker = setInterval(() => tick(card), TICK_MS);
    }

    /* ── Applying, and putting it back ─────────────────────────────────── */

    function setPreset(preset) {
        const d = dash();
        if (!d?.settings) return;
        if (global.LayoutUtils?.applyLayoutPreset) {
            global.LayoutUtils.applyLayoutPreset(d.settings, preset, {
                syncDashboard: true,
                saveDashboard: true,
            });
            return;
        }
        d.settings.layoutPreset = preset;
        d.setupDOM?.();
        d.saveSettings?.();
    }

    /**
     * Swap the card for the one that offers the way back.
     *
     * The same card rather than a toast: the reader is looking at a dashboard
     * that just rearranged itself, and the undo has to be where their eyes
     * already are. It names the preset it would return to, because "undo" on
     * its own does not say what you get.
     */
    function showApplied(card) {
        const el = card.element;
        if (!el) return;
        el.classList.add('is-applied');
        const title = el.querySelector('.quickstart-title');
        if (title) title.textContent = t('dashboard.widgetsLayoutNoticeAppliedTitle', 'This is the Widgets layout');
        const body = el.querySelector('.notice-card-text');
        if (body) {
            body.textContent = t('dashboard.widgetsLayoutNoticeAppliedBody',
                'Categories are cards now, so the widgets between them sit on the same footing. It lives under Config → Appearance → Grid, where you can change it again whenever you like.');
        }
        const actions = el.querySelector('.notice-card-actions');
        if (!actions) return;
        const backLabel = t('dashboard.widgetsLayoutNoticeUndo', 'Put back {preset}')
            .replace('{preset}', presetLabel(previousPreset));
        actions.innerHTML = `
            <button type="button" class="quickstart-btn quickstart-btn-ghost" data-wl-action="undo">${escape(backLabel)}</button>
            <button type="button" class="quickstart-btn quickstart-btn-primary" data-wl-action="keep">${escape(t('dashboard.widgetsLayoutNoticeKeep', 'Keep it'))}</button>`;
        actions.querySelector('[data-wl-action="undo"]')?.addEventListener('click', () => undo(card));
        actions.querySelector('[data-wl-action="keep"]')?.addEventListener('click', () => card.close());
    }

    /** The reader-facing name of a preset, or the bare id if none is written. */
    function presetLabel(preset) {
        const key = `config.layoutPresetName.${preset}`;
        const label = t(key, '');
        return label || preset;
    }

    function tryIt(card) {
        previousPreset = currentPreset();
        markAnswered();
        setPreset(TARGET_PRESET);
        showApplied(card);
    }

    function undo(card) {
        if (previousPreset) setPreset(previousPreset);
        card.close();
    }

    const card = global.NoticeCard.define({
        id: 'widgets-layout-notice',
        // Nothing: this card's waiting is the active clock above.
        showDelayMs: 0,
        title: () => t('dashboard.widgetsLayoutNoticeTitle', 'Your widgets can sit on the page differently'),
        body: () => t('dashboard.widgetsLayoutNoticeBody',
            'The Widgets layout draws every category as a card, so the widgets between them stop looking like something pasted on top. It is one setting, it applies right now, and this card puts it back if you would rather have it the way it was.'),
        dismissLabel: () => t('dashboard.widgetsLayoutNoticeDismiss', 'Dismiss'),
        dismissName: 'dismiss',
        canShow: worthAsking,
        onDismiss: markAnswered,
        actionAttr: 'data-wl-action',
        actions: [
            {
                name: 'try',
                label: () => t('dashboard.widgetsLayoutNoticeTry', 'Try it'),
                primary: true,
                onClick: tryIt,
            },
            {
                name: 'dismiss',
                label: () => t('dashboard.widgetsLayoutNoticeNoThanks', 'No thanks'),
                onClick: (c) => { markAnswered(); c.close(); },
            },
        ],
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => startClock(card), { once: true });
    } else {
        startClock(card);
    }

    global.DashboardWidgetsLayoutNotice = {
        render: card.renderSync,
        shouldShow: card.shouldShowSync,
        dismiss: () => { markAnswered(); card.close(); },
        tryIt: () => tryIt(card),
        // For tests and for a manual re-prompt: skips the wait, not the gate.
        showNow: () => card.autoStart(),
        PROMO_ID,
    };
})(typeof window !== 'undefined' ? window : globalThis);
