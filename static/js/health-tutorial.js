/**
 * One-time Health tutorial — a short, guided tour through setting up one
 * monitored bookmark, shown the first time the Health view opens after the
 * release that added drift detection, maintenance windows and notification
 * presets. Everything it explains is also documented in Config → Help →
 * Health, in more depth; this exists because that page is opt-in reading and
 * a feature nobody knows to look for might as well not exist.
 *
 * Walks the same worked example as config.helpHealthWalkthroughBody — a
 * self-hosted status page behind a login, backed up nightly at 3am — so a
 * reader who later opens the help tab recognises it rather than learning a
 * second story.
 */
(function (global) {
    'use strict';

    const TIP_ID = 'healthTutorialV1';

    function t(key, fallback, params) {
        const lang = global.dashboardInstance?.language;
        let text = fallback;
        if (lang?.t) {
            const full = key.includes('.') ? key : `dashboard.${key}`;
            const value = lang.t(full);
            if (value && value !== full) text = value;
        }
        return params
            ? Object.entries(params).reduce(
                (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                String(text)
            )
            : text;
    }

    function esc(value) {
        return String(value).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    /**
     * Each step is a title, an HTML body (already trusted — built from esc()'d
     * pieces below, never from user input), and an optional small visual: a
     * fragment of the actual UI the step is describing, built from real class
     * names so it reads as "this exact control" rather than an illustration
     * that could drift from what shipped.
     */
    function steps() {
        const badge = (label, tone) => `<span class="health-tutorial-badge health-tutorial-badge--${tone}">${esc(label)}</span>`;

        return [
            {
                title: t('healthTutorialStep1Title', 'Health can do more than "is it up?"'),
                body: `<p>${esc(t('healthTutorialStep1Body1',
                    'A few checks in this release: watching for a page that quietly changed underneath a link, expected downtime that should not page anyone, and alerts that land in Slack, Discord, Telegram, Pushover or ntfy instead of a raw webhook nobody reads.'))}</p>
                <p>${esc(t('healthTutorialStep1Body2',
                    'This walks through all of it on one example — a status page you host yourself. Six short steps, then you are done. Config → Help → Health has the same walkthrough if you want it again later.'))}</p>`,
            },
            {
                title: t('healthTutorialStep2Title', 'Turn on Monitor'),
                visual: `<div class="health-tutorial-visual">
                    <span class="health-tutorial-visual-url">https://status.example.com</span>
                    <span class="health-tutorial-visual-modes">
                        <span class="bookmark-inline-checkmode-option">${esc(t('checkModeOff', 'Off'))}</span>
                        <span class="bookmark-inline-checkmode-option is-active">${esc(t('checkModeMonitor', 'Monitor'))}</span>
                    </span>
                </div>`,
                body: `<p>${esc(t('healthTutorialStep2Body1',
                    'Right-click a bookmark, or open its editor, and set availability checking to Monitor instead of Periodic. This is your own server — worth checking on a schedule whether or not the dashboard happens to be open.'))}</p>
                <p>${esc(t('healthTutorialStep2Body2',
                    'A Check interval row appears once it is monitored. A status page people rely on deserves closer watching than a personal blog — 5 minutes is a reasonable start.'))}</p>`,
            },
            {
                title: t('healthTutorialStep3Title', 'Tell it what "up" actually means'),
                visual: `<div class="health-tutorial-visual health-tutorial-visual--codes">
                    <code>200,401</code>
                    <span class="health-tutorial-visual-hint">${esc(t('healthTutorialStep3VisualHint', 'Status codes that count as healthy'))}</span>
                </div>`,
                body: `<p>${esc(t('healthTutorialStep3Body1',
                    'The status page sits behind a login, so it always answers 401 when the check has no session — normal, not a failure. Typing 200,401 into Status codes that count as healthy keeps a real outage from getting lost in the noise of an expected 401.'))}</p>
                <p>${esc(t('healthTutorialStep3Body2',
                    'If the page also shows a phrase only when the service it reports on is actually healthy — "All systems operational", say — Text the page must contain catches a page that loads fine but is quietly reporting its own incident.'))}</p>`,
            },
            {
                title: t('healthTutorialStep4Title', 'Watch for the page changing shape entirely'),
                visual: `<div class="health-tutorial-visual">
                    ${badge('Moved', 'moved')}${badge('Retitled', 'retitled')}${badge('Changed', 'changed')}
                </div>`,
                body: `<p>${esc(t('healthTutorialStep4Body1',
                    'Watch for redirects, retitling and rewrites keeps a baseline of where the link goes, what the page is titled, and roughly what it says — set once the checkbox is ticked, on the next check.'))}</p>
                <p>${esc(t('healthTutorialStep4Body2',
                    'A domain that lapses or a proxy that quietly starts sending traffic elsewhere would sail straight past the status-code and keyword rules above, because the request never reaches the real page at all. This is the check that still notices.'))}</p>`,
            },
            {
                title: t('healthTutorialStep5Title', 'Tell it about the backup window'),
                visual: `<div class="health-tutorial-visual health-tutorial-visual--window">
                    <span>${esc(t('healthTutorialStep5VisualDay', 'Every day'))}</span>
                    <code>03:00 – 03:10</code>
                </div>`,
                body: `<p>${esc(t('healthTutorialStep5Body1',
                    'The service restarts nightly at 3am for its backup. Without a maintenance window, that alone raises an incident and an alert every single night — and after a week of that, a real 3am outage reads exactly like the six before it that meant nothing.'))}</p>
                <p>${esc(t('healthTutorialStep5Body2',
                    'Config → Behavior → Status & health → Maintenance windows takes a day, a start time and an end time. Checks still run and the heartbeat still records what happened — only the alerting is held back.'))}</p>`,
            },
            {
                title: t('healthTutorialStep6Title', 'Get told when it actually breaks'),
                visual: `<div class="health-tutorial-visual health-tutorial-visual--services">
                    <span class="health-tutorial-visual-chip">Slack</span>
                    <span class="health-tutorial-visual-chip">Discord</span>
                    <span class="health-tutorial-visual-chip">Telegram</span>
                    <span class="health-tutorial-visual-chip">Pushover</span>
                    <span class="health-tutorial-visual-chip">ntfy</span>
                </div>`,
                body: `<p>${esc(t('healthTutorialStep6Body1',
                    'Downtime alerts now has a Service picker, so the message actually lands somewhere readable instead of a block of raw JSON a chat app silently drops. Pick the one your team already watches — only the fields that service needs are shown.'))}</p>
                <p>${esc(t('healthTutorialStep6Body2',
                    'Set Alert after to 3 so one dropped check during a blip does not page anyone, and click Send test alert once before trusting it with the real thing — a wrong chat ID otherwise fails silently, with nothing on screen to say why.'))}</p>
                <p class="health-tutorial-closing">${esc(t('healthTutorialStep6Closing',
                    'That is the whole loop: a heartbeat bar, an uptime percentage, and a message where you will actually see it — only when something is truly wrong.'))}</p>`,
            },
        ];
    }

    let state = { index: 0 };

    function render() {
        const all = steps();
        const step = all[state.index];
        const total = all.length;
        const isFirst = state.index === 0;
        const isLast = state.index === total - 1;

        const progress = t('healthTutorialProgress', 'Step {n} of {total}', { n: state.index + 1, total });

        const html = `
            <div class="health-tutorial">
                <div class="health-tutorial-progress">${esc(progress)}</div>
                <h3 class="health-tutorial-step-title">${esc(step.title)}</h3>
                ${step.visual || ''}
                <div class="health-tutorial-step-body">${step.body}</div>
                <div class="health-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="health-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('healthTutorialTitle', "What's new in Health"),
            htmlMessage: html,
            confirmText: isLast
                ? t('healthTutorialDone', 'Got it')
                : t('healthTutorialNext', 'Next'),
            cancelText: isFirst
                ? t('healthTutorialSkip', 'Skip')
                : t('healthTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'health-tutorial-modal',
            modalMaxWidth: 'min(34rem, calc(100vw - 2.5rem))',
            onConfirm: () => {
                if (isLast) {
                    finish('completed');
                    return;
                }
                state.index += 1;
                render();
            },
            onCancel: () => {
                if (isFirst) {
                    finish('skipped');
                    return;
                }
                state.index -= 1;
                render();
            },
            // Closing via the backdrop, Escape, or navigating away mid-tour is
            // still "seen" — reopening it every time someone dismisses it with
            // Escape would be the exact nagging behaviour the one-time badge
            // on the inbox icon deliberately avoids.
            onHide: () => finish('dismissed'),
        });
    }

    let finished = false;
    function finish(outcome) {
        if (finished) return;
        finished = true;
        global.DiscoverabilityState?.markTipSeen?.(TIP_ID);
        global.nextdashTrack?.('health-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /**
     * Called from DashboardHealth.openHealthView() once the view has actually
     * rendered. Mirrors showConfigIntro()'s guard order in
     * dashboard-keyboard-tip.js: seen-check first (cheapest), then settings,
     * then anything that would make popping a modal actively wrong right now.
     */
    function maybeShow() {
        if (global.DiscoverabilityState?.hasSeenTip?.(TIP_ID)) return false;
        const d = global.dashboardInstance;
        if (!d?.settings || d.settings.enableSessionTips === false) return false;
        if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        if (d.searchComponent?.isActive?.()) return false;
        if (!global.AppModal?.show) return false;

        state = { index: 0 };
        finished = false;
        render();
        global.nextdashTrack?.('health-tutorial:shown');
        return true;
    }

    global.HealthTutorial = { maybeShow };
}(typeof window !== 'undefined' ? window : globalThis));
