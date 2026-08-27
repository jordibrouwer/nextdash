/**
 * One-time Inbox tutorial — a guided tour through the inbox, shown the first
 * time the Inbox view opens. Built the same way as health-tutorial.js and
 * sharing its guards, so a session that has turned session tips off, or is on
 * a phone, never sees either.
 *
 * The ℹ in the inbox toolbar explains the same model on demand, but that is
 * opt-in reading: the inbox looks like a list of links, so nothing about it
 * suggests there is a keyboard, a snooze clock or a promote step to find. This
 * exists to say so once, at the only moment the reader is looking at it.
 *
 * Where the ℹ explainer is five short definitions, this walks the actual loop —
 * how a link gets in, what read means, what to do with the ones that are not
 * for today, and how to clear a backlog without a mouse — in the order someone
 * meets those problems.
 */
(function (global) {
    'use strict';

    // Also named in dashboard-inbox.js, which checks it before fetching this
    // file at all. Both must agree.
    const TIP_ID = 'inboxTutorialV1';

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

    const esc = window.NextDashHtml.escapeHtml;

    /**
     * Each step is a title, an HTML body (trusted — assembled from esc()'d
     * pieces here, never from user input) and a small visual built from the
     * real class names of the control it describes, so the reader recognises
     * the thing rather than an illustration of it.
     */
    function steps() {
        const key = (k, label) => `<span class="inbox-tutorial-key"><kbd>${esc(k)}</kbd>${esc(label)}</span>`;
        const chip = (label) => `<span class="inbox-tutorial-chip">${esc(label)}</span>`;

        return [
            {
                title: t('inboxTutorialStep1Title', 'A place for links you have not decided about yet'),
                visual: `<div class="inbox-tutorial-visual">
                    <span class="inbox-tutorial-visual-url">https://example.com/long-read</span>
                    <span class="inbox-tutorial-visual-sources">${chip(t('inboxTutorialSourcePaste', 'Paste'))}${chip(t('inboxTutorialSourceExtension', 'Extension'))}</span>
                </div>`,
                body: `<p>${esc(t('inboxTutorialStep1Body1',
                    'Not every link worth keeping has a page and a category waiting for it. Paste a URL onto the dashboard and — depending on Paste destination under Config → Behavior — it lands here, becomes a bookmark straight away, or asks you which. The browser extension can save here too, and a URL already waiting is turned away rather than saved twice.'))}</p>
                <p>${esc(t('inboxTutorialStep1Body2',
                    'Nothing in here is a bookmark yet, and nothing expires. Leaving a link sitting for a week costs nothing — that is what the list is for. Seven short steps and you will know every way back out of it.'))}</p>`,
            },
            {
                title: t('inboxTutorialStep2Title', 'Read is not the same as dealt with'),
                visual: `<div class="inbox-tutorial-visual">
                    ${key('r', t('inboxTutorialKeyKeep', 'keep · mark read'))}
                    <span class="inbox-tutorial-visual-hint">${esc(t('inboxTutorialStep2VisualHint', 'Clear read empties them in one go'))}</span>
                </div>`,
                body: `<p>${esc(t('inboxTutorialStep2Body1',
                    'A new link stays unread until you open it or press r. Opening marks it read; r marks it read without opening, which is the quick way to say "yes, I still want this" about a link you already recognise.'))}</p>
                <p>${esc(t('inboxTutorialStep2Body2',
                    'Read links stay in the list. Having read something is not a reason to throw it away, so removing them is a separate, deliberate act — Clear read in the toolbar deletes them all at once. The number on the Inbox tab counts only what is unread and awake, so nothing that is read or snoozed keeps nagging at you.'))}</p>`,
            },
            {
                title: t('inboxTutorialStep3Title', 'Snooze the ones that are not for today'),
                visual: `<div class="inbox-tutorial-visual inbox-tutorial-visual--snooze">
                    ${key('z', t('inboxTutorialKeySnooze', 'snooze'))}
                    <span class="inbox-tutorial-visual-sources">${chip(t('inboxSnooze3h', 'In 3 hours'))}${chip(t('inboxSnoozeTomorrow', 'Tomorrow'))}${chip(t('inboxSnoozeWeekend', 'This weekend'))}${chip(t('inboxSnoozeNextWeek', 'Next week'))}</span>
                </div>`,
                body: `<p>${esc(t('inboxTutorialStep3Body1',
                    'z hides a link until a time you pick — in 3 hours, tomorrow, this weekend, next week, or a date of your own. While it sleeps it is left out of every filter and every count except Snoozed, and it comes back on its own when the time is up. Wake now brings one back early.'))}</p>
                <p>${esc(t('inboxTutorialStep3Body2',
                    'This is the habit that keeps the list honest. An inbox full of things you cannot act on right now is an inbox you stop reading — so if a link is genuinely for next month, snooze it to next month instead of scrolling past it thirty times first.'))}</p>`,
            },
            {
                title: t('inboxTutorialStep4Title', 'Write down why you saved it'),
                visual: `<div class="inbox-tutorial-visual inbox-tutorial-visual--note">
                    ${key('n', t('inboxTutorialKeyNote', 'note'))}
                    <span class="inbox-tutorial-visual-note">${esc(t('inboxTutorialStep4VisualNote', 'for the rate-limit section — compare with the other proposal'))}</span>
                </div>`,
                body: `<p>${esc(t('inboxTutorialStep4Body1',
                    'n leaves a note on a link. Two weeks later the title alone rarely says why it mattered, and a link you can no longer explain to yourself is one you end up deleting unread. One line is enough.'))}</p>
                <p>${esc(t('inboxTutorialStep4Body2',
                    'The Noted filter collects everything you have annotated, so a half-finished piece of research can be picked back up as a set rather than hunted for row by row. The note travels with the link into the bookmark form when you promote it, so the reason is not lost at the moment it becomes permanent.'))}</p>`,
            },
            {
                title: t('inboxTutorialStep5Title', 'Promote turns a link into a real bookmark'),
                visual: `<div class="inbox-tutorial-visual">
                    ${key('p', t('inboxTutorialKeyPromote', 'promote'))}
                    <span class="inbox-tutorial-visual-hint">${esc(t('inboxTutorialStep5VisualHint', 'Opens the full bookmark form, page and category still yours to pick'))}</span>
                </div>`,
                body: `<p>${esc(t('inboxTutorialStep5Body1',
                    'p opens the bookmark form with the URL, title and note already filled in, leaving you the one decision the inbox deliberately postponed: which page and which category. Tags, icon, description and health checking are all there too, the same as any other new bookmark.'))}</p>
                <p>${esc(t('inboxTutorialStep5Body2',
                    'Once the bookmark is saved the inbox entry goes, so nothing ends up filed in two places. If you would rather keep a record of everything that passed through, turn off Delete after promote under Behavior and promoted links stay behind, marked read. Cancelling the form changes nothing — the link is still sitting where it was.'))}</p>`,
            },
            {
                title: t('inboxTutorialStep6Title', 'Triage: the whole backlog, no mouse'),
                visual: `<div class="inbox-tutorial-visual inbox-tutorial-visual--keys">
                    ${key('t', t('inboxTutorialKeyTriage', 'triage'))}
                    ${key('j / k', t('inboxTutorialKeyMove', 'next / previous'))}
                    ${key('r', t('inboxTutorialKeyKeepShort', 'keep'))}
                    ${key('z', t('inboxTutorialKeySnooze', 'snooze'))}
                    ${key('p', t('inboxTutorialKeyPromote', 'promote'))}
                    ${key('d', t('inboxTutorialKeyDelete', 'delete'))}
                </div>`,
                body: `<p>${esc(t('inboxTutorialStep6Body1',
                    'Deciding about forty links one row at a time is slow mostly because of everything else on screen. t puts a single link in front of you with nothing around it: j and k move, o or Enter opens, r keeps, z snoozes, n notes, p promotes, d deletes, Escape leaves. Each decision is one keystroke and the next link is already there.'))}</p>
                <p>${esc(t('inboxTutorialStep6Body2',
                    'Set the sort to oldest first before you start. An inbox is cleared from the bottom, where the links you have been avoiding for a month are; the top is the part that still looks interesting and never actually needs you.'))}</p>`,
            },
            {
                title: t('inboxTutorialStep7Title', 'Selecting, narrowing, and sharing the view'),
                visual: `<div class="inbox-tutorial-visual inbox-tutorial-visual--keys">
                    ${key('x', t('inboxTutorialKeySelect', 'select'))}
                    ${key('Shift+↑ / ↓', t('inboxTutorialKeyExtend', 'extend'))}
                    ${key('Ctrl/Cmd+A', t('inboxTutorialKeyAll', 'all'))}
                    ${key('g / G', t('inboxTutorialKeyFirstLast', 'first / last'))}
                </div>`,
                body: `<p>${esc(t('inboxTutorialStep7Body1',
                    'x ticks a row, Shift with the arrow keys extends the selection, Ctrl/Cmd+A takes everything currently listed — and the toolbar actions then apply to the lot. Bulk promote is the exception worth knowing: it asks once which page the links belong on and files them all there, instead of opening the form forty times.'))}</p>
                <p>${esc(t('inboxTutorialStep7Body2',
                    'The Site dropdown narrows the list to one domain, which is how you find out that a single newsletter has quietly filled a third of your inbox. Filter, sort, search and site all show up in the address bar, so any view of the inbox can be bookmarked or sent to yourself on another machine.'))}</p>
                <p class="inbox-tutorial-closing">${esc(t('inboxTutorialStep7Closing',
                    'That is the whole loop: links land in one place, and leave it as a bookmark, a snooze, or a deletion — never by being quietly forgotten.'))}</p>`,
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

        const progress = t('inboxTutorialProgress', 'Step {n} of {total}', { n: state.index + 1, total });

        const html = `
            <div class="inbox-tutorial">
                <div class="inbox-tutorial-progress">${esc(progress)}</div>
                <h3 class="inbox-tutorial-step-title">${esc(step.title)}</h3>
                ${step.visual || ''}
                <div class="inbox-tutorial-step-body">${step.body}</div>
                <div class="inbox-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="inbox-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('inboxTutorialTitle', 'How the inbox works'),
            htmlMessage: html,
            confirmText: isLast
                ? t('inboxTutorialDone', 'Got it')
                : t('inboxTutorialNext', 'Next'),
            cancelText: isFirst
                ? t('inboxTutorialSkip', 'Skip')
                : t('inboxTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'inbox-tutorial-modal',
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
            // Escape, the backdrop and navigating away all count as seen. The ℹ
            // in the toolbar covers the same ground on demand, so reopening the
            // tour on every visit would only be nagging.
            onHide: () => finish('dismissed'),
        });
    }

    let finished = false;
    function finish(outcome) {
        if (finished) return;
        finished = true;
        global.DiscoverabilityState?.markTipSeen?.(TIP_ID);
        global.nextdashTrack?.('inbox-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /**
     * Called from DashboardInbox.openInboxView() once the list has rendered.
     * Same guard order as the health tutorial: seen-check first (cheapest),
     * then settings, then anything that would make popping a modal actively
     * wrong at this moment.
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
        global.nextdashTrack?.('inbox-tutorial:shown');
        return true;
    }

    global.InboxTutorial = { TIP_ID, maybeShow };
}(typeof window !== 'undefined' ? window : globalThis));
