/**
 * The spread-across-columns walkthrough — four steps, opened on demand.
 *
 * Built like inbox-tutorial.js and health-tutorial.js: a step at a time in the
 * app modal, each step a title, a small visual made from the real class names
 * of the thing it describes, and two short paragraphs. Unlike those two it is
 * never shown by itself — the notice card in the corner offers it, and Config →
 * Help links the same explanation — because spreading is a layout preference
 * rather than a view someone has just walked into for the first time.
 *
 * The one idea worth the four steps: spreading is a switch, and the number of
 * columns is not a setting. Everyone who meets this feature tries to find where
 * to type "2", so the third step exists purely to say that the answer comes
 * from the items-per-category limit and the size of the category.
 */
(function (global) {
    'use strict';

    const TIP_ID = 'spreadTutorialV1';

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

    /** A column of stand-in bookmark rows, `rows` tall. */
    function fakeColumn(rows, extraClass = '') {
        const lines = Array.from({ length: rows }, () => '<span class="spread-tutorial-row"></span>').join('');
        return `<span class="spread-tutorial-col ${extraClass}">${lines}</span>`;
    }

    function steps() {
        const chip = (label) => `<span class="spread-tutorial-chip">${esc(label)}</span>`;
        const key = (k, label) => `<span class="spread-tutorial-key"><kbd>${esc(k)}</kbd>${esc(label)}</span>`;

        return [
            {
                title: t('spreadTutorialStep1Title', 'One category, several columns'),
                // Before and after, side by side: the long single column that
                // pushes everything below it down, and the same bookmarks laid
                // out across two.
                visual: `<div class="spread-tutorial-visual spread-tutorial-visual--compare">
                    <span class="spread-tutorial-block">
                        <span class="spread-tutorial-cap">${esc(t('spreadTutorialBefore', 'Before'))}</span>
                        <span class="spread-tutorial-grid">${fakeColumn(6)}</span>
                    </span>
                    <span class="spread-tutorial-arrow" aria-hidden="true">→</span>
                    <span class="spread-tutorial-block">
                        <span class="spread-tutorial-cap">${esc(t('spreadTutorialAfter', 'After'))}</span>
                        <span class="spread-tutorial-grid spread-tutorial-grid--wide">${fakeColumn(3)}${fakeColumn(3)}</span>
                    </span>
                </div>`,
                body: `<p>${esc(t('spreadTutorialStep1Body1',
                    'A category normally lives in one column and grows downwards. A long one therefore towers over its neighbours, and the bookmarks past the limit disappear behind "+ N more".'))}</p>
                <p>${esc(t('spreadTutorialStep1Body2',
                    'Let it spread and the same bookmarks flow across two or three columns instead — same height as everything around it, more of it visible at once. It suits the categories made of many short entries.'))}</p>`,
            },
            {
                title: t('spreadTutorialStep2Title', 'Switch it on where the category is'),
                visual: `<div class="spread-tutorial-visual">
                    <span class="spread-tutorial-menu">
                        <span class="spread-tutorial-menu-row">✎ ${esc(t('categoryMenuRename', 'Rename'))}</span>
                        <span class="spread-tutorial-menu-row is-current">↔ ${esc(t('categoryMenuSpread', 'Spread across columns'))}<kbd>Shift+W</kbd></span>
                        <span class="spread-tutorial-menu-row">+ ${esc(t('categoryMenuAdd', 'Add category'))}</span>
                    </span>
                </div>`,
                body: `<p>${esc(t('spreadTutorialStep2Body1',
                    'Right-click a category header and pick Spread across columns, or press Shift+W with the category focused. It applies straight away — no reload, no settings page.'))}</p>
                <p>${esc(t('spreadTutorialStep2Body2',
                    'The same entry reads "Back to one column" once it is on, so the way out is where the way in was. Every category decides for itself; its neighbours are untouched.'))}</p>`,
            },
            {
                title: t('spreadTutorialStep3Title', 'You do not pick the number of columns'),
                // The sum, spelled out: this is the step the whole tour exists
                // for. Everyone looks for the field where they type "2".
                visual: `<div class="spread-tutorial-visual spread-tutorial-visual--sum">
                    ${chip(t('spreadTutorialSumBookmarks', '40 bookmarks'))}
                    <span class="spread-tutorial-op" aria-hidden="true">÷</span>
                    ${chip(t('spreadTutorialSumLimit', '15 per column'))}
                    <span class="spread-tutorial-op" aria-hidden="true">=</span>
                    <span class="spread-tutorial-grid spread-tutorial-grid--wide">${fakeColumn(3)}${fakeColumn(3)}${fakeColumn(3)}</span>
                </div>`,
                body: `<p>${esc(t('spreadTutorialStep3Body1',
                    'How wide a spread category gets follows from two things you have already set: Items per category, which caps the height of one column, and how many bookmarks are in it. Forty bookmarks at fifteen per column need three.'))}</p>
                <p>${esc(t('spreadTutorialStep3Body2',
                    'So it grows when you add bookmarks and shrinks when you delete them, and it never takes more columns than the grid has. That also means Items per category cannot be Unlimited while anything spreads — with no column height, nothing decides how many columns are needed.'))}</p>`,
            },
            {
                title: t('spreadTutorialStep4Title', 'The rest of the switches'),
                visual: `<div class="spread-tutorial-visual">
                    ${key('↔', t('spreadTutorialWhereRow', 'per row in Pages & tags → Categories'))}
                    <span class="spread-tutorial-hint">${esc(t('spreadTutorialWhereConfig',
                        'Appearance → Layout → Categories across columns'))}</span>
                </div>`,
                body: `<p>${esc(t('spreadTutorialStep4Body1',
                    'Config → Pages & tags → Categories has the same switch as a ↔ button on every row, which is the quicker way to go through a page in one sitting.'))}</p>
                <p>${esc(t('spreadTutorialStep4Body2',
                    'Under Appearance → Layout you will find what applies to all of them: whether a new category starts out spread, and a button that switches spreading off again — for this page or for every page.'))}</p>`,
            },
        ];
    }

    let state = { index: 0 };
    let finished = false;

    function render() {
        const all = steps();
        const step = all[state.index];
        const total = all.length;
        const isFirst = state.index === 0;
        const isLast = state.index === total - 1;

        const html = `
            <div class="spread-tutorial">
                <div class="spread-tutorial-progress">${esc(t('spreadTutorialProgress', 'Step {n} of {total}',
                    { n: state.index + 1, total }))}</div>
                <h3 class="spread-tutorial-step-title">${esc(step.title)}</h3>
                ${step.visual || ''}
                <div class="spread-tutorial-step-body">${step.body}</div>
                <div class="spread-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="spread-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('spreadTutorialTitle', 'Categories across columns'),
            htmlMessage: html,
            confirmText: isLast ? t('spreadTutorialDone', 'Got it') : t('spreadTutorialNext', 'Next'),
            cancelText: isFirst ? t('spreadTutorialSkip', 'Skip') : t('spreadTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'spread-tutorial-modal',
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
            onHide: () => finish('dismissed'),
        });
    }

    function finish(outcome) {
        if (finished) return;
        finished = true;
        global.DiscoverabilityState?.markTipSeen?.(TIP_ID);
        global.nextdashTrack?.('spread-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /** Opened by the notice card, and by Config → Help. Never by itself. */
    function open() {
        if (!global.AppModal?.show) return false;
        state = { index: 0 };
        finished = false;
        render();
        global.nextdashTrack?.('spread-tutorial:shown');
        return true;
    }

    global.SpreadTutorial = { TIP_ID, open };
}(typeof window !== 'undefined' ? window : globalThis));
