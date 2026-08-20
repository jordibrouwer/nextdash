/**
 * The Fresh walkthrough — four steps, opened on demand.
 *
 * Built like spread-tutorial.js, inbox-tutorial.js and health-tutorial.js: one
 * step at a time in the app modal, each a title, a small diagram made from the
 * shapes of the real thing, and two short paragraphs.
 *
 * Fresh needs the explanation more than most. It is off by default, it makes a
 * claim people have heard before and been disappointed by ("we will tell you
 * what is new"), and the thing that makes it cheap — the feed was already found
 * while a preview was fetched, and every poll is conditional — is invisible.
 * Left to a switch label it reads either as a feed reader, which it is not, or
 * as something that will hammer the sites you saved, which it does not.
 *
 * The last step ends in the switch itself when Fresh is off, because a
 * walkthrough that finishes with "now go and find the setting" wastes the one
 * moment the reader is convinced.
 */
(function (global) {
    'use strict';

    const TIP_ID = 'freshTutorialV1';

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback, params) {
        const lang = dash()?.language;
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

    function isOn() {
        return dash()?.settings?.feedsEnabled === true;
    }

    /** A stand-in bookmark row, optionally carrying the count Fresh adds. */
    function fakeRow(label, count) {
        return `<span class="fresh-tutorial-row">`
            + `<span class="fresh-tutorial-icon"></span>`
            + `<span class="fresh-tutorial-name">${esc(label)}</span>`
            + (count ? `<span class="fresh-tutorial-badge">${esc(count)}</span>` : '')
            + `</span>`;
    }

    function steps() {
        return [
            {
                title: t('freshTutorialStep1Title', 'A count on the rows that moved'),
                // The whole idea in one picture: two ordinary rows, one carrying
                // a small count, which is all Fresh ever adds to the grid.
                visual: `<div class="fresh-tutorial-visual">
                    <span class="fresh-tutorial-stack">
                        ${fakeRow(t('freshTutorialSampleBlog', 'Team blog'), '3')}
                        ${fakeRow(t('freshTutorialSampleDocs', 'Release notes'), '')}
                        ${fakeRow(t('freshTutorialSampleNews', 'Status page'), '1')}
                    </span>
                </div>`,
                body: `<p>${esc(t('freshTutorialStep1Body1',
                    'Some of the pages you save keep publishing: a blog, a changelog, a forum, a status page. You cannot tell by looking at the row, so you either open them on the off-chance or stop opening them at all.'))}</p>
                <p>${esc(t('freshTutorialStep1Body2',
                    'With Fresh on, a bookmark whose page has published something since you last opened it carries a small count. Opening it clears the count. That is the whole of what you have to do.'))}</p>`,
            },
            {
                title: t('freshTutorialStep2Title', 'And a collection that gathers them'),
                visual: `<div class="fresh-tutorial-visual">
                    <span class="fresh-tutorial-collection">
                        <span class="fresh-tutorial-collection-title">✳ ${esc(t('freshTutorialCollectionName', 'Fresh'))} <span class="fresh-tutorial-count">(2)</span></span>
                        ${fakeRow(t('freshTutorialSampleBlog', 'Team blog'), '3')}
                        ${fakeRow(t('freshTutorialSampleNews', 'Status page'), '1')}
                    </span>
                </div>`,
                body: `<p>${esc(t('freshTutorialStep2Body1',
                    'The same bookmarks gather in a Fresh collection between your categories, newest publication first, with the number in its title. It appears only when something is actually new — an empty Fresh would be a section that means nothing.'))}</p>
                <p>${esc(t('freshTutorialStep2Body2',
                    'It behaves like any other collection: it can be collapsed, and the rows in it are the real bookmarks, so editing one there edits it everywhere.'))}</p>`,
            },
            {
                title: t('freshTutorialStep3Title', 'It costs almost nothing'),
                // The route, drawn as chips: nothing here is a new fetch of the
                // page itself, which is the objection this step answers.
                visual: `<div class="fresh-tutorial-visual fresh-tutorial-visual--flow">
                    <span class="fresh-tutorial-chip">${esc(t('freshTutorialChipPage', 'Your bookmark'))}</span>
                    <span class="fresh-tutorial-arrow" aria-hidden="true">→</span>
                    <span class="fresh-tutorial-chip">${esc(t('freshTutorialChipFeed', 'Feed address'))}</span>
                    <span class="fresh-tutorial-arrow" aria-hidden="true">→</span>
                    <span class="fresh-tutorial-chip fresh-tutorial-chip--quiet">304</span>
                </div>`,
                body: `<p>${esc(t('freshTutorialStep3Body1',
                    'Switching Fresh on looks for feeds: it reads the head of each page you have saved, notes any feed advertised there, and remembers the pages that have none so it does not ask them again for a month. That is one request per bookmark, once.'))}</p>
                <p>${esc(t('freshTutorialStep3Body2',
                    'Known feeds are then asked once an hour, and each request only asks whether anything changed — a quiet site answers “no” in a few hundred bytes. A feed that keeps failing is retired rather than retried forever.'))}</p>`,
            },
            {
                title: t('freshTutorialStep4Title', 'If nothing shows up'),
                visual: `<div class="fresh-tutorial-visual">
                    <span class="fresh-tutorial-note">${esc(t('freshTutorialNotReader', 'Most saved pages carry no feed at all. Config → Behavior → Fresh says how many of yours do.'))}</span>
                </div>`,
                body: `<p>${esc(t('freshTutorialStep4Body1',
                    'An empty dashboard is the usual answer, and it is not a fault: a shop, a wiki page, a login screen publishes nothing. The Fresh tab counts it out for you — “12 of 40 bookmarks asked · 2 publish a feed” — with Find feeds now to look again after you have saved something new.'))}</p>
                <p>${esc(t('freshTutorialStep4Body2',
                    'And Fresh is not a feed reader: no articles, no headlines, no read state of its own — only how many entries are newer than your last visit. The switch is under Config → Behavior → Fresh, a tab of its own between Inbox and Status & health.'))}</p>`,
            },
        ];
    }

    let state = { index: 0 };
    let finished = false;

    /**
     * Switch Fresh on from the last step, and poll once so it says something.
     *
     * Same two moves config makes when the switch is flipped there: without the
     * poll the dashboard sits unchanged until the scheduler's next wake, and a
     * feature that appears to do nothing when you turn it on reads as broken.
     */
    async function turnOn() {
        const d = dash();
        if (!d?.settings) return;
        d.settings.feedsEnabled = true;
        await d.saveSettings?.();
        global.nextdashTrack?.('fresh-tutorial:enabled');
        try {
            await d.feeds?.pollNow?.();
        } catch {
            // The scheduler will get there on its own; the setting is what matters.
        }
        d.renderDashboard?.({ animate: false });
    }

    function render() {
        const all = steps();
        const step = all[state.index];
        const total = all.length;
        const isFirst = state.index === 0;
        const isLast = state.index === total - 1;
        // On the last step the primary button is the switch itself, unless the
        // reader already has Fresh on — then there is nothing to turn on and it
        // is an ordinary "got it".
        const offerSwitch = isLast && !isOn();

        const html = `
            <div class="fresh-tutorial">
                <div class="fresh-tutorial-progress">${esc(t('freshTutorialProgress', 'Step {n} of {total}',
                    { n: state.index + 1, total }))}</div>
                <h3 class="fresh-tutorial-step-title">${esc(step.title)}</h3>
                ${step.visual || ''}
                <div class="fresh-tutorial-step-body">${step.body}</div>
                <div class="fresh-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="fresh-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('freshTutorialTitle', 'Fresh'),
            htmlMessage: html,
            confirmText: offerSwitch
                ? t('freshTutorialTurnOn', 'Turn Fresh on')
                : (isLast ? t('freshTutorialDone', 'Got it') : t('freshTutorialNext', 'Next')),
            cancelText: isFirst ? t('freshTutorialSkip', 'Skip') : t('freshTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'fresh-tutorial-modal',
            modalMaxWidth: 'min(34rem, calc(100vw - 2.5rem))',
            onConfirm: () => {
                if (isLast) {
                    if (offerSwitch) {
                        void turnOn();
                        dash()?.showNotification?.(t('freshTutorialEnabled', 'Fresh is on. Counts appear as the feeds are read.'), 'success');
                    }
                    finish(offerSwitch ? 'enabled' : 'completed');
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
            onHide: () => finish('dismissed'),
        });
    }

    function finish(outcome) {
        if (finished) return;
        finished = true;
        global.DiscoverabilityState?.markTipSeen?.(TIP_ID);
        global.nextdashTrack?.('fresh-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /** Opened by the notice card, and by Config → Help. Never by itself. */
    function open() {
        if (!global.AppModal?.show) return false;
        state = { index: 0 };
        finished = false;
        render();
        global.nextdashTrack?.('fresh-tutorial:shown');
        return true;
    }

    global.FreshTutorial = { TIP_ID, open };
}(typeof window !== 'undefined' ? window : globalThis));
